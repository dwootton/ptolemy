import * as vscode from 'vscode';
import { TelemetryService } from './TelemetryService';
import { NotebookLinkService } from './NotebookLinkService';
import { ActiveWorkspaceManager } from './ActiveWorkspaceManager';
// Legacy import removed - using generic interface

/**
 * Service that watches VS Code notebook cell selections and notifies the webview
 * to highlight corresponding analets in the analysis map using direct cell metadata
 */
export class NotebookWatcherService {
  private static instance: NotebookWatcherService;
  private messageService?: any; // MessageRouter interface
  private disposables: vscode.Disposable[] = [];
  private deselectTimer: NodeJS.Timeout | undefined;
  private static readonly DESELECT_DEBOUNCE_MS = 250;
  private telemetryService?: TelemetryService;
  private notebookLinkService?: NotebookLinkService;
  private initialized = false;
  // Coalesce duplicate execution events per cell
  private executionBuffer: Map<string, { timer: NodeJS.Timeout; data: {
    notebookPath: string;
    cellId: string;
    cellIndex: number;
    analetId?: number;
    outputText?: string;
    hasError?: boolean;
    errorName?: string;
    errorMessage?: string;
    success?: boolean;
    startTime?: number;
    endTime?: number;
    executionOrder?: number;
    action?: 'execute' | 'output_change';
    codeContent?: string;
    cellType?: string;
    cellLanguage?: string;
    outputCount?: number;
  }}> = new Map();
  private lastSentAt: Map<string, number> = new Map();

  private constructor() {
    // No dependencies needed - reads cell metadata directly
  }

  public static getInstance(): NotebookWatcherService {
    if (!NotebookWatcherService.instance) {
      NotebookWatcherService.instance = new NotebookWatcherService();
    }
    return NotebookWatcherService.instance;
  }

  /**
   * Initialize the watcher and start listening for notebook events
   */
  public initialize(messageService?: any): void { // MessageRouter interface
    // Always set/refresh the message service reference
    this.messageService = messageService;
    this.telemetryService = TelemetryService.getInstance();

    try {
      this.notebookLinkService = NotebookLinkService.getInstance();
    } catch (error) {
      console.warn('⚠️ [NotebookWatcherService] Could not initialize NotebookLinkService:', error);
    }

    // Avoid double-registering listeners if already initialized
    if (this.initialized) return;

    this.registerEventListeners();
    this.initialized = true;
  }

  /**
   * Register VS Code event listeners for notebook interactions
   */
  private registerEventListeners(): void {
    // Listen for notebook editor selection changes
    const selectionDisposable = vscode.window.onDidChangeNotebookEditorSelection(
      this.handleCellSelectionChange.bind(this)
    );
    this.disposables.push(selectionDisposable);

    // Listen for active notebook editor changes
    const editorDisposable = vscode.window.onDidChangeActiveNotebookEditor(
      this.handleActiveNotebookChange.bind(this)
    );
    this.disposables.push(editorDisposable);

    // Listen for notebook cell execution completion
    const executionDisposable = vscode.workspace.onDidChangeNotebookDocument(
      this.handleNotebookDocumentChange.bind(this)
    );
    this.disposables.push(executionDisposable);

    // Listen for notebook document content changes (including cell edits)
    const cellEditDisposable = vscode.workspace.onDidChangeTextDocument(
      this.handleTextDocumentChange.bind(this)
    );
    this.disposables.push(cellEditDisposable);
  }

  /**
   * Handle notebook cell selection changes
   */
  private async handleCellSelectionChange(event: vscode.NotebookEditorSelectionChangeEvent): Promise<void> {
    try {
      const { notebookEditor, selections } = event;

      if (!notebookEditor || !selections || selections.length === 0) {
        // No selection or empty selection - schedule deselection (debounced)
        this.scheduleDeselection('no-selection');
        return;
      }

      const notebookDocument = notebookEditor.notebook;
      const notebookPath = notebookDocument.uri.fsPath;

      // Scope to active workspace path
      try {
        const root = ActiveWorkspaceManager.getInstance().getActiveRoot();
        if (!notebookPath.startsWith(root)) {
          return;
        }
      } catch {}

      // Get the first selected cell (VS Code typically only allows single cell selection in notebooks)
      const firstSelection = selections[0];
      const cellIndex = firstSelection.start;
      if (cellIndex >= notebookDocument.cellCount) {
        return;
      }

      const cell = notebookDocument.cellAt(cellIndex);
      // Try to find analet ID for this cell
      const analetId = this.findAnaletIdForCell(cell);
      const cellId = cell.document.uri.fragment || `cell-${cellIndex}`;

      // Record navigation telemetry regardless of whether it's an analet cell
      if (this.telemetryService) {
        this.telemetryService.recordCellEvent(
          'cell_navigated',
          notebookPath,
          cellId,
          cellIndex,
          analetId || undefined,
          undefined, // No variables for navigation
          undefined, // No output for navigation
          'select',
          {
            hasAnaletLink: !!analetId,
            cellType: vscode.NotebookCellKind[cell.kind],
            cellLanguage: cell.document.languageId
          }
        );
      }

      if (analetId) {
        // Use relative path for webview message
        const relativeNotebookPath = vscode.workspace.asRelativePath(notebookPath);
        // Cancel any pending deselection since we have a valid analet selection
        this.cancelPendingDeselection();
        this.notifyWebviewOfCellSelection(analetId, cellIndex, relativeNotebookPath);
      } else {
        // Selected cell is explicitly not an analet - schedule deselection (debounced)
        this.scheduleDeselection('non-analet');
      }

    } catch (error) {
      console.error('❌ [NotebookWatcher] Error handling cell selection change:', error);
    }
  }

  /**
   * Handle active notebook editor changes
   */
  private async handleActiveNotebookChange(editor: vscode.NotebookEditor | undefined): Promise<void> {
    if (!editor) {
      // No active notebook - schedule deselection
      this.scheduleDeselection('no-active-editor');
      return;
    }

    // When a new notebook becomes active, check if there's a current selection
    const selections = editor.selections;
    if (selections && selections.length > 0) {
      // Trigger selection handling for the current selection
      await this.handleCellSelectionChange({
        notebookEditor: editor,
        selections: selections
      } as vscode.NotebookEditorSelectionChangeEvent);
    } else {
      // No selection in the active editor - schedule deselection
      this.scheduleDeselection('no-selection');
    }
  }


  /**
   * Find analet ID for a cell using direct cell metadata
   */
  private findAnaletIdForCell(cell: vscode.NotebookCell): number | null {
    try {
      // Check cell metadata directly - this is now our single source of truth
      //@ts-ignore - cell.metadata can sometimes be nested into cell.metadata.metadata by VS Code jupyter extension...
      const meridianData = extractMetadata(cell);
      if (meridianData) {

        // Only return analet ID if this is an analet cell (not non-analet)
        if (meridianData.type === 'analet' && meridianData.id) {
          return meridianData.id;
        } else if (meridianData.type === 'non-analet') {
          return null;
        }
      }

      // No analet metadata found
      return null;

    } catch (error) {
      console.error('❌ [NotebookWatcher] Error finding analet ID for cell:', error);
      return null;
    }
  }

  /**
   * Notify webview of cell selection
   */
  private notifyWebviewOfCellSelection(analetId: number, cellIndex: number, notebookPath: string): void {
    if (!this.messageService) {
      return;
    }

    const messageData = {
      analetId,
      cellIndex,
      notebookPath,
      timestamp: new Date().toISOString()
    };
    this.messageService.sendMessage('notebook-cell-selected', messageData);
  }

  /**
   * Notify webview of cell deselection
   */
  private notifyWebviewOfCellDeselection(reason?: 'non-analet' | 'no-selection' | 'no-active-editor'): void {
    if (!this.messageService) {
      return;
    }
    this.messageService.sendMessage('notebook-cell-deselected', {
      timestamp: new Date().toISOString(),
      reason
    });
  }

  // Debounced deselection helpers
  private scheduleDeselection(reason: 'non-analet' | 'no-selection' | 'no-active-editor'): void {
    this.cancelPendingDeselection();
    this.deselectTimer = setTimeout(() => {
      this.notifyWebviewOfCellDeselection(reason);
      this.deselectTimer = undefined;
    }, NotebookWatcherService.DESELECT_DEBOUNCE_MS);
  }

  private cancelPendingDeselection(): void {
    if (this.deselectTimer) {
      clearTimeout(this.deselectTimer);
      this.deselectTimer = undefined;
    }
  }

  // Helper: truncate long strings for logging
  private truncate(s: string | undefined, max: number = 4000): string | undefined {
    if (!s) return s;
    return s.length <= max ? s : s.slice(0, max);
  }

  // Helper: basic masking for secrets in logs
  private sanitizeForLogs(s: string | undefined): string | undefined {
    if (!s) return s;
    try {
      let out = s;
      // Mask OpenAI-style keys
      out = out.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-****');
      // Mask common env assignments
      out = out.replace(/(OPENAI_API_KEY\s*=\s*['"][^'"\n]+['"])/gi, (_m) => 'OPENAI_API_KEY="***"');
      return out;
    } catch {
      return s;
    }
  }

  // Helper: summarize outputs for error detection and small text preview
  private extractCellOutputSummary(cell: vscode.NotebookCell): { outputText?: string; hasError: boolean; errorName?: string; errorMessage?: string } {
    let outputText: string | undefined;
    let hasError = false;
    let errorName: string | undefined;
    let errorMessage: string | undefined;

    try {
      const outputs = cell.outputs || [];
      for (const out of outputs) {
        for (const item of out.items) {
          const mime = item.mime;
          // VS Code error payload
          if (mime === 'application/vnd.code.notebook.error') {
            try {
              const raw = Buffer.from(item.data).toString('utf8');
              const err = JSON.parse(raw);
              hasError = true;
              errorName = err?.name || errorName;
              errorMessage = err?.message || errorMessage;
              if (!outputText) outputText = this.truncate(`${errorName || 'Error'}: ${errorMessage || ''}`);
            } catch {
              hasError = true;
              if (!outputText) outputText = 'Execution error (unparsed)';
            }
            continue;
          }
          // Stderr stream
          if (mime === 'application/vnd.jupyter.stderr' || mime === 'text/x.stderr') {
            hasError = true;
            const txt = Buffer.from(item.data).toString('utf8');
            if (!outputText) outputText = this.truncate(txt);
            continue;
          }
          // First text-like output
          if (!outputText && (mime === 'text/plain' || mime === 'text/html' || mime === 'application/json')) {
            const txt = Buffer.from(item.data).toString('utf8');
            outputText = this.truncate(txt);
          }
        }
      }
    } catch {
      // ignore
    }

    return { outputText, hasError, errorName, errorMessage };
  }

  /**
   * Handle notebook document changes (including cell execution completion)
   */
  private async handleNotebookDocumentChange(event: vscode.NotebookDocumentChangeEvent): Promise<void> {
    try {
      if (!event.notebook.uri.fsPath.endsWith('.ipynb')) {
        return; // Only handle Jupyter notebooks
      }

      const notebookPath = event.notebook.uri.fsPath;
      try {
        const root = ActiveWorkspaceManager.getInstance().getActiveRoot();
        if (!notebookPath.startsWith(root)) {
          return;
        }
      } catch {}

      // Process content changes, focusing on cell execution completion
      for (const change of event.contentChanges) {
        if (change.addedCells) {
          // Handle new cells added
          for (const cell of change.addedCells) {
            await this.processCellChange(cell, notebookPath, 'cell_added');
          }
        }

        if (change.removedCells) {
          // Handle cells removed
          for (const cell of change.removedCells) {
            await this.processCellChange(cell, notebookPath, 'cell_removed');
          }
        }
      }

      // Handle cell execution state changes (detect when execution completes)
      for (const change of event.cellChanges) {
        const cell = change.cell;

        // Check if this was a cell execution completion
        if (change.executionSummary) {
          await this.processCellExecution(cell, notebookPath, change.executionSummary);
        }

        // Check if cell outputs changed (alternative indicator of execution)
        if (change.outputs) {
          await this.processCellOutputChange(cell, notebookPath);
        }
      }
    } catch (error) {
      console.error('❌ [NotebookWatcherService] Error handling notebook document change:', error);
    }
  }

  /**
   * Handle text document changes (for cell content edits)
   */
  private async handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    try {
      // Check if this is a notebook cell document
      if (!event.document.uri.scheme.includes('notebook') && !event.document.uri.scheme.includes('vscode-notebook-cell')) {
        return;
      }

      // Extract notebook path and cell info from the URI
      const uriPath = event.document.uri.path;
      const notebookPathMatch = uriPath.match(/^\/([^#]+)\.ipynb#/);
      if (!notebookPathMatch) {
        return;
      }

      const notebookPath = notebookPathMatch[1] + '.ipynb';
      try {
        const root = ActiveWorkspaceManager.getInstance().getActiveRoot();
        if (!notebookPath.startsWith(root)) {
          return;
        }
      } catch {}

      // Find the cell that was edited
      const editors = vscode.window.visibleNotebookEditors;
      for (const editor of editors) {
        if (editor.notebook.uri.path.includes(notebookPath)) {
          // Find which cell corresponds to this document
          for (let i = 0; i < editor.notebook.cellCount; i++) {
            const cell = editor.notebook.cellAt(i);
            if (cell.document === event.document) {
              await this.processCellEdit(cell, notebookPath, i);
              break;
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error('❌ [NotebookWatcherService] Error handling text document change:', error);
    }
  }

  /**
   * Process cell changes (added/removed)
   */
  private async processCellChange(cell: vscode.NotebookCell, notebookPath: string, action: string): Promise<void> {
    const analetId = this.findAnaletIdForCell(cell);

    if (this.telemetryService) {
      this.telemetryService.recordCellEvent(
        'cell_edited',
        notebookPath,
        cell.document.uri.fragment || `cell-${cell.index}`,
        cell.index,
        analetId || undefined,
        undefined, // No variables for cell structure changes
        undefined, // No output for cell structure changes
        action,
        {
          cellType: vscode.NotebookCellKind[cell.kind],
          cellLanguage: cell.document.languageId
        }
      );
    }
  }

  /**
   * Process cell execution completion
   */
  private async processCellExecution(cell: vscode.NotebookCell, notebookPath: string, executionSummary: vscode.NotebookCellExecutionSummary): Promise<void> {
    const analetId = this.findAnaletIdForCell(cell);
    const cellId = cell.document.uri.fragment || `cell-${cell.index}`;
    const summaryRaw = this.extractCellOutputSummary(cell);
    const summary = { ...summaryRaw, outputText: this.sanitizeForLogs(summaryRaw.outputText) };
    const codeContent = cell.kind === vscode.NotebookCellKind.Code ? this.sanitizeForLogs(this.truncate(cell.document.getText(), 4000)) : undefined;
    this.queueExecutionEvent({
      notebookPath,
      cellId,
      cellIndex: cell.index,
      analetId: analetId || undefined,
      outputText: summary.outputText,
      hasError: summary.hasError,
      errorName: summary.errorName,
      errorMessage: summary.errorMessage,
      success: executionSummary.success,
      startTime: executionSummary.timing?.startTime,
      endTime: executionSummary.timing?.endTime,
      executionOrder: executionSummary.executionOrder,
      action: 'execute',
      codeContent,
      cellType: vscode.NotebookCellKind[cell.kind],
      cellLanguage: cell.document.languageId
    });
  }

  /**
   * Process cell output changes (alternative execution detection)
   */
  private async processCellOutputChange(cell: vscode.NotebookCell, notebookPath: string): Promise<void> {
    const analetId = this.findAnaletIdForCell(cell);
    const cellId = cell.document.uri.fragment || `cell-${cell.index}`;

    // This is fired when outputs change, which usually indicates execution
    const summaryRaw = this.extractCellOutputSummary(cell);
    const summary = { ...summaryRaw, outputText: this.sanitizeForLogs(summaryRaw.outputText) };
    const codeContent = cell.kind === vscode.NotebookCellKind.Code ? this.sanitizeForLogs(this.truncate(cell.document.getText(), 4000)) : undefined;
    this.queueExecutionEvent({
      notebookPath,
      cellId,
      cellIndex: cell.index,
      analetId: analetId || undefined,
      outputText: summary.outputText,
      hasError: summary.hasError,
      errorName: summary.errorName,
      errorMessage: summary.errorMessage,
      success: !summary.hasError,
      outputCount: cell.outputs?.length || 0,
      action: 'output_change',
      codeContent,
      cellType: vscode.NotebookCellKind[cell.kind],
      cellLanguage: cell.document.languageId
    });
  }

  /**
   * Process cell edits
   */
  private async processCellEdit(cell: vscode.NotebookCell, notebookPath: string, cellIndex: number): Promise<void> {
    const analetId = this.findAnaletIdForCell(cell);
    const cellId = cell.document.uri.fragment || `cell-${cellIndex}`;

    if (this.telemetryService) {
      this.telemetryService.recordCellEvent(
        'cell_edited',
        notebookPath,
        cellId,
        cellIndex,
        analetId || undefined,
        undefined, // No variables for edits
        undefined, // No output for edits
        'edit',
        {
          contentLength: cell.document.getText().length,
          cellType: vscode.NotebookCellKind[cell.kind],
          cellLanguage: cell.document.languageId
        }
      );
    }
  }

  private queueExecutionEvent(partial: {
    notebookPath: string;
    cellId: string;
    cellIndex: number;
    analetId?: number;
    outputText?: string;
    hasError?: boolean;
    errorName?: string;
    errorMessage?: string;
    success?: boolean;
    startTime?: number;
    endTime?: number;
    executionOrder?: number;
    action?: 'execute' | 'output_change';
    codeContent?: string;
    cellType?: string;
    cellLanguage?: string;
    outputCount?: number;
  }): void {
    const key = `${partial.notebookPath}::${partial.cellId}`;
    const now = Date.now();
    const last = this.lastSentAt.get(key) || 0;
    // If we sent something very recently (< 200ms), extend cooldown and merge
    const existing = this.executionBuffer.get(key);
    const merged = existing ? { ...existing.data } : {
      notebookPath: partial.notebookPath,
      cellId: partial.cellId,
      cellIndex: partial.cellIndex
    } as any;

    // Merge fields with preference for explicit/defined values and error info
    for (const k of [
      'analetId','outputText','hasError','errorName','errorMessage','success','startTime','endTime','executionOrder','action','codeContent','cellType','cellLanguage','outputCount'] as const) {
      const v = (partial as any)[k];
      if (v !== undefined && v !== null) {
        if (k === 'hasError') {
          merged.hasError = merged.hasError || !!v;
        } else if (k === 'action') {
          // Prefer 'execute' over 'output_change'
          merged.action = merged.action === 'execute' ? 'execute' : v;
        } else {
          (merged as any)[k] = v;
        }
      }
    }

    const schedule = () => {
      const timer = setTimeout(() => {
        this.executionBuffer.delete(key);
        // Final duplicate suppression window (750ms)
        const since = Date.now() - (this.lastSentAt.get(key) || 0);
        if (since < 100) return; // ultra-rapid duplicate guard
        this.lastSentAt.set(key, Date.now());
        if (this.telemetryService) {
          this.telemetryService.recordCellEvent(
            'cell_executed',
            merged.notebookPath,
            merged.cellId,
            merged.cellIndex,
            merged.analetId,
            undefined,
            merged.outputText,
            merged.action || 'execute',
            {
              outputCount: merged.outputCount,
              cellType: merged.cellType,
              cellLanguage: merged.cellLanguage,
              success: merged.success,
              hasError: merged.hasError,
              errorName: merged.errorName,
              errorMessage: merged.errorMessage,
              startTime: merged.startTime,
              endTime: merged.endTime,
              executionOrder: merged.executionOrder,
              codeContent: merged.codeContent
            }
          );
        }
      }, existing ? 120 : 200); // small debounce; slightly shorter on merges
      this.executionBuffer.set(key, { timer, data: merged });
    };

    if (existing) {
      try { clearTimeout(existing.timer); } catch {}
      this.executionBuffer.set(key, { timer: existing.timer, data: merged });
      schedule();
    } else {
      // If we sent very recently, push out the debounce a bit to avoid bursts
      schedule();
    }
  }

  /**
   * Dispose of all event listeners
   */
  public dispose(): void {
    this.cancelPendingDeselection();
    // Clear buffers
    for (const entry of this.executionBuffer.values()) {
      try { clearTimeout(entry.timer); } catch {}
    }
    this.executionBuffer.clear();
    this.disposables.forEach(disposable => disposable.dispose());
    this.disposables = [];
  }
}

// This is necessary as the cell metadata can sometimes be nested into cell.metadata.metadata by VS Code jupyter extension...
function extractMetadata(cell: vscode.NotebookCell): any {
  // Inside findAnaletIdForCell
  const meta: any = (cell as any).metadata;
  // 1) Correct location
  if (meta?.meridian_analet?.type === 'analet' && meta.meridian_analet.id) {
    return meta.meridian_analet;
  }
  if (meta?.meridian_analet?.type === 'non-analet') return null;

  // 2) Incorrect nested location (diagnose loudly)
  if (meta?.metadata?.meridian_analet?.type === 'analet' && meta.metadata.meridian_analet.id) {
    // console.error('⚠️ [NotebookWatcher] meridian_analet found under metadata.metadata. This should NEVER be written this way.');
    return meta.metadata.meridian_analet;
  }

  // 3) VS Code custom surface
  if (meta?.custom?.meridian_analet?.type === 'analet' && meta.custom.meridian_analet.id) {
    return meta.custom.meridian_analet;
  }
}
