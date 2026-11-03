import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { Analet } from '../types/analet';
import { NotebookLinkService, RecentCellActivity } from './NotebookLinkService';
import { JupyterNotebookService } from './JupyterNotebookService';
import { StateManagementService } from './StateManagementService';
import { OpenAIService } from './OpenAIService';
import { NotebookAdapter } from './analet/adapters/NotebookAdapter';
import { createAnaletController, AnaletController } from './analet';
import { CellSyncConfigService } from './CellSyncConfigService';
/**
 * Result of notebook creation from analet
 */
export interface NotebookCreationResult {
  notebookPath: string;
  primaryCellIndex: number;
  cellId: string;
  success: boolean;
  message?: string;
  updatedAnalet?: Analet;  // Return the updated analet to avoid race conditions
}

/**
 * Result of analet selection from cell
 */
export interface AnaletSelectionResult {
  analetId: number | null;
  analet: Analet | null;
  wasLinked: boolean;
  success: boolean;
  message?: string;
}

/**
 * Result of sync operation
 */
export interface SyncResult {
  cellsProcessed: number;
  analetsUpdated: number;
  analetsCreated: number;
  conflictsResolved: number;
  metadataUpdated: number;
  errors: string[];
  success: boolean;
}

/**
 * Incremental sync levels for performance control
 */
export type SyncLevel = 'fast' | 'normal' | 'full';

/**
 * NotebookSyncController - User-facing API orchestrator for notebook-analet operations
 *
 * Responsibilities:
 * - Orchestrate the 4 core notebook-analet workflows
 * - Coordinate between NotebookLinkService, StateManagementService, and JupyterNotebookService
 * - Handle incremental sync with performance optimization
 * - Ensure metadata consistency and conflict resolution
 * - Provide clean, minimal API surface
 */
export class NotebookSyncController {
  private static instance: NotebookSyncController;
  private linkService: NotebookLinkService;
  private stateService: StateManagementService;
  private jupyterService: JupyterNotebookService;
  private analetController?: AnaletController;
  private syncConfigService: CellSyncConfigService;

  private constructor(
    context: vscode.ExtensionContext,
    stateService: StateManagementService,
    jupyterService: JupyterNotebookService
  ) {
    this.linkService = NotebookLinkService.getInstance(context);
    this.stateService = stateService;
    this.jupyterService = jupyterService;
    this.syncConfigService = CellSyncConfigService.getInstance(stateService);

    // Initialize sync config service
    this.syncConfigService.initialize().catch(error => {
      console.error('Failed to initialize CellSyncConfigService:', error);
    });

    // Set up file watcher for automatic sync enablement of new cells
    this.setupNotebookFileWatcher(context);
  }

  // Prevent duplicate concurrent creations for the same cell within a sync window
  private creationLocks = new Set<string>();

  public setAnaletController(controller: AnaletController): void {
    this.analetController = controller;
  }

  public static getInstance(
    context?: vscode.ExtensionContext,
    stateService?: StateManagementService,
    jupyterService?: JupyterNotebookService
  ): NotebookSyncController {
    if (!NotebookSyncController.instance) {
      if (!context || !stateService || !jupyterService) {
        throw new Error('NotebookSyncController requires context, stateService, and jupyterService for initialization');
      }
      NotebookSyncController.instance = new NotebookSyncController(context, stateService, jupyterService);
    }
    return NotebookSyncController.instance;
  }


  /**
   * CORE WORKFLOW 1: Create notebook from analet
   * Generates a new notebook, writes it to disk, and links the primary analysis cell
   */
  public async createNotebookFromAnalet(analetId: number, startTime?: number): Promise<NotebookCreationResult> {
    try {
      const controllerStartTime = Date.now();
      // Get the analet from state service
      const analet = await this.stateService.getAnaletById(analetId);
      if (!analet) {
        return {
          notebookPath: '',
          primaryCellIndex: -1,
          cellId: '',
          success: false,
          message: `Analet ${analetId} not found`
        };
      }
      // Generate notebook content
      const notebookData = await this.jupyterService.generateNotebookFromAnalet(analet, true, startTime);
      // Generate unique notebook path
      const notebookPath = await this.generateUniqueNotebookPath(analet);
      // Write notebook to disk
      const notebookContent = this.jupyterService.generateNotebookContent(notebookData);
      const uri = vscode.Uri.file(notebookPath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(notebookContent, 'utf8'));
      // Find the primary analysis cell (first cell with analet metadata)
      const primaryCellIndex = this.findPrimaryAnalysisCell(notebookData);
      const primaryCell = notebookData.cells[primaryCellIndex];
      const cellId = primaryCell?.id || `cell-${primaryCellIndex}`;
      // Link the analet to the primary analysis cell
      const contentHash = this.generateContentHash(primaryCell?.source || []);
      await this.linkService.linkAnaletToCell(
        analetId,
        notebookPath,
        cellId,
        primaryCellIndex,
        contentHash
      );
      // Write cell metadata to match analet (provide fallback index for reliability)
      await this.writeCellMetadataFromAnalet(notebookPath, cellId, analet, primaryCellIndex);

      // CRITICAL FIX: Update the analet object with notebook metadata
      const updatedAnalet: Analet = {
        ...analet,
        notebookCellMetadata: {
          filePath: notebookPath,
          cellId: cellId,
          cellIndex: primaryCellIndex,
          lastModified: new Date().toISOString()
        }
      };
      // Save the updated analet back to state
      await this.stateService.updateAnalet(updatedAnalet);

      // IMPORTANT: Auto-enable sync for analet-generated cells
      try {
        await this.syncConfigService.enableAnaletCellSync(
          notebookPath,
          cellId,
          primaryCellIndex,
          contentHash
        );
      } catch (syncConfigError) {
        console.warn('⚠️ [SYNC-CONFIG] Failed to enable sync for analet cell', {
          analetId,
          error: syncConfigError
        });
        // Don't fail the entire operation if sync config fails
      }
      return {
        notebookPath,
        primaryCellIndex,
        cellId,
        success: true,
        message: 'Notebook created successfully',
        updatedAnalet: updatedAnalet  // Return the updated analet
      };

    } catch (error) {
      return {
        notebookPath: '',
        primaryCellIndex: -1,
        cellId: '',
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * CORE WORKFLOW 2: Handle cell selection → analet selection
   * When a notebook cell is clicked, select the corresponding analet in the shared service
   */
  public async onNotebookCellSelected(
    notebookPath: string,
    cellId?: string,
    cellIndex?: number
  ): Promise<AnaletSelectionResult> {
    try {

      // Record the cell activity
      if (cellId) {
        this.linkService.recordCellActivity(notebookPath, cellId, 'selection', cellIndex);
      }

      // Try to find linked analet
      let analetId: number | null = null;

      if (cellId) {
        analetId = this.linkService.getAnaletByCell(notebookPath, cellId);
      }

      // If not found, try resolution with fallback strategies
      if (analetId === null) {
        analetId = await this.linkService.getAnaletByCellWithResolution(notebookPath, cellId, cellIndex);
      }

      // If still not found, check if cell metadata indicates it should be linked
      if (analetId === null && cellId) {
        const cellMetadata = await this.readCellMetadata(notebookPath, cellId);
        if (cellMetadata?.meridian_analet?.type === 'analet' && cellMetadata.meridian_analet.id) {
          // Cell claims to be linked to an analet - try to restore the link
          const claimedAnaletId = cellMetadata.meridian_analet.id;
          const analet = await this.stateService.getAnaletById(claimedAnaletId);
          if (analet) {
            // Restore the link
            await this.linkService.linkAnaletToCell(claimedAnaletId, notebookPath, cellId, cellIndex);
            analetId = claimedAnaletId;
          }
        }
      }

      if (analetId !== null) {
        // Get the analet data
        const analet = await this.stateService.getAnaletById(analetId);
        if (analet) {

          return {
            analetId,
            analet,
            wasLinked: true,
            success: true,
            message: 'Analet selected successfully'
          };
        }
      }

      // No analet found or linked
      return {
        analetId: null,
        analet: null,
        wasLinked: false,
        success: true,
        message: 'No analet linked to this cell'
      };

    } catch (error) {
      return {
        analetId: null,
        analet: null,
        wasLinked: false,
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * CORE WORKFLOW 3: Sync recent cells with targeted updates
   * Processes only recently edited/selected cells and updates analets only when grammar changes
   */
  public async syncRecentCells(options: {
    limit?: number;
    sinceMs?: number;
    level?: SyncLevel;
    scanDirectory?: boolean;
  } = {}): Promise<SyncResult> {
    const { limit = 20, sinceMs = 60 * 60 * 1000, level = 'normal', scanDirectory = false } = options; // Default 1 hour


    const result: SyncResult = {
      cellsProcessed: 0,
      analetsUpdated: 0,
      analetsCreated: 0,
      conflictsResolved: 0,
      metadataUpdated: 0,
      errors: [],
      success: true
    };

    try {
      let allCandidates: RecentCellActivity[] = [];

      if (scanDirectory) {
        // Scan all notebook files in workspace
        const allNotebookCells = await this.getAllNotebookCells();
        allCandidates = allNotebookCells;
      } else {
        // Get recent cell activities (existing behavior)
        const recentCells = this.linkService.getRecentCells(limit, sinceMs);

        // Add currently selected/open cells if available
        const additionalCells = await this.getCurrentlyActiveCells();
        allCandidates = this.deduplicateCells([...recentCells, ...additionalCells]);
      }

      // IMPORTANT: Filter candidates based on sync configuration
      // Only process cells that are explicitly configured for sync
      let syncFilteredCandidates = allCandidates.filter(cellActivity => {
        const isSynced = this.syncConfigService.isCellSynced(
          cellActivity.notebookPath,
          cellActivity.cellId
        );


        return isSynced;
      });
      // Fallback bootstrap: if scanning directory and no configured cells found,
      // process all candidates so analet-marked cells can be created/linked.
      if (scanDirectory && syncFilteredCandidates.length === 0 && allCandidates.length > 0) {
        syncFilteredCandidates = allCandidates;
      }

      // Process each sync-enabled candidate cell
      for (const cellActivity of syncFilteredCandidates) {
        try {
          const cellResult = await this.upsertAnaletFromCell(
            cellActivity.notebookPath,
            cellActivity.cellId,
            cellActivity.cellIndex,
            level,
            cellActivity.contentHash,
            true // This is also a configured cell (filtered above)
          );

          result.cellsProcessed++;

          if (cellResult.created) {
            result.analetsCreated++;
          } else if (cellResult.updated) {
            result.analetsUpdated++;
          }

          if (cellResult.metadataUpdated) {
            result.metadataUpdated++;
          }

          if (cellResult.conflictResolved) {
            result.conflictsResolved++;
          }

        } catch (error) {
          const errorMsg = `Failed to process cell ${cellActivity.cellId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMsg);
          console.error('[NotebookSyncController] upsert error', errorMsg);
        }
      }

      // Cleanup orphaned links
      const existingAnaletIds = new Set((await this.stateService.getAnalets()).map(a => a.id));
      const orphanedCount = await this.linkService.cleanupOrphanedLinks(existingAnaletIds);


    } catch (error) {
      result.success = false;
      result.errors.push(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return result;
  }

  /**
   * CORE WORKFLOW 4: Reconcile cell metadata with analet store
   * Ensures notebook cell metadata always reflects the current analet state
   */
  public async reconcileCellMetadata(analetId: number): Promise<boolean> {
    try {

      // Get analet and its link
      const analet = await this.stateService.getAnaletById(analetId);
      const link = this.linkService.getCellByAnalet(analetId);

      if (!analet || !link) {
        return false;
      }

      // Write current analet data to cell metadata
      await this.writeCellMetadataFromAnalet(link.notebookPath, link.cellId, analet);

      return true;

    } catch (error) {
      return false;
    }
  }

  /**
   * Upsert analet from notebook cell content
   * This is the core logic for sync operations
   */
  private async upsertAnaletFromCell(
    notebookPath: string,
    cellId: string,
    cellIndex?: number,
    level: SyncLevel = 'normal',
    activityContentHash?: string,
    isConfiguredCell: boolean = false
  ): Promise<{
    created: boolean;
    updated: boolean;
    metadataUpdated: boolean;
    conflictResolved: boolean;
  }> {
    const result = {
      created: false,
      updated: false,
      metadataUpdated: false,
      conflictResolved: false
    };

    // Resolve cell identity first via link service strategies (include activity content hash if available)
    const resolved = await this.linkService.resolveCellIdentity(notebookPath, cellId, cellIndex, activityContentHash);
    const effectiveCellId = (resolved.found && resolved.cellId) ? resolved.cellId : cellId;
    const effectiveIndex = (resolved.found && typeof resolved.cellIndex === 'number') ? resolved.cellIndex : cellIndex;


    try {
      const notebookData = await this.jupyterService.readNotebook(notebookPath);
      notebookData && Array.isArray(notebookData.cells);
    } catch {}

    // Read cell content and metadata (centralized service)
    const cellData = await this.jupyterService.readCellData(notebookPath, effectiveCellId, effectiveIndex);
    if (!cellData) {
      throw new Error('Could not read cell data');
    }

    const { source, metadata, cellType } = cellData;
    const contentHash = this.jupyterService.generateContentHash(source);

    // Debug: always log cell content after reading from notebook
    try {
      const fullTextAll = Array.isArray(source) ? source.join('\n') : String(source);
    } catch {}

    // Check if cell is linked to an analet (robust resolution first)
    let linkedAnaletId: number | null = await this.linkService.getAnaletByCellWithResolution(
      notebookPath,
      effectiveCellId,
      typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
      contentHash
    );
    if (linkedAnaletId === null) {
      // Fallback to direct lookup by exact cellId
      linkedAnaletId = this.linkService.getAnaletByCell(notebookPath, effectiveCellId);
    }

    if (linkedAnaletId) {
      // Cell is linked - check if analet needs updating
      const existingAnalet = await this.stateService.getAnaletById(linkedAnaletId);
      if (!existingAnalet) {
        // Orphaned link - remove it
        await this.linkService.unlinkAnalet(linkedAnaletId);
        result.conflictResolved = true;
        return result;
      }
      // For linked cells, optionally update via controller in 'full' mode (future enhancement)
      // For now, just refresh metadata and link activity; enrichment/persistence handled elsewhere

      // Update link activity
      await this.linkService.updateLinkActivity(linkedAnaletId, contentHash);

      // Update sync configuration content hash
      try {
        await this.syncConfigService.updateCellSyncHash(
          notebookPath,
          effectiveCellId,
          contentHash
        );
      } catch (syncConfigError) {
        console.warn('⚠️ [SYNC-CONFIG] Failed to update sync hash', {
          notebookPath,
          cellId: effectiveCellId,
          error: syncConfigError
        });
      }

      // Ensure metadata is consistent
      // Refresh metadata; also ensure meridian cell id exists for future linking
      await this.jupyterService.writeCellMetadataFromAnalet(
        notebookPath,
        effectiveCellId,
        existingAnalet,
        typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
        contentHash
      );
      result.metadataUpdated = true;
    } else {
      // Cell not linked – try to restore from cell metadata first
      const meridian = metadata?.meridian_analet;
      if (meridian?.type === 'analet' && typeof meridian.id === 'number') {
        // Guard: ensure the referenced analet actually exists before linking/writing metadata
        const analetForMetadata = await this.stateService.getAnaletById(meridian.id);
        if (analetForMetadata) {
          await this.linkService.linkAnaletToCell(
            meridian.id,
            notebookPath,
            effectiveCellId,
            typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
            contentHash
          );
          await this.jupyterService.writeCellMetadataFromAnalet(
            notebookPath,
            effectiveCellId,
            analetForMetadata,
            typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
            contentHash
          );
          result.metadataUpdated = true;
          return result;
        } else {
          console.warn('⚠️ [NotebookSyncController] Cell metadata references missing analet id; skipping metadata write', {
            notebookPath,
            effectiveCellId,
            referencedAnaletId: meridian.id
          });
          // Mark as resolved to avoid repeated attempts; continue with other strategies below
          result.conflictResolved = true;
        }
      }

      // Create analet for configured cells only (no marker required)
      if (isConfiguredCell) {
        const lockKey = `${notebookPath}:${effectiveCellId}`;
        if (this.creationLocks.has(lockKey)) {
          return result;
        }
        this.creationLocks.add(lockKey);
        // Guard: prevent duplicate creation if link already exists for this cell
        const existingAnaletForCell = await this.linkService.getAnaletByCellWithResolution(
          notebookPath,
          effectiveCellId,
          typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
          contentHash
        );
        if (existingAnaletForCell !== null) {
          this.creationLocks.delete(lockKey);
          return result;
        }
        // Single-pipe: Adapter → AnaletController → Repo/StateSync
        if (!this.analetController) {
          this.analetController = createAnaletController(this.stateService);
        }
        const cellContent = Array.isArray(source) ? source.join('\n') : String(source);
        const generation = await this.analetController.generateAnalets({
          command: {
            type: 'from_notebook',
            cellContent,
            filePath: notebookPath,
            cellIndex: typeof effectiveIndex === 'number' ? effectiveIndex : 0,
            notebookMetadata: {
              cellId: effectiveCellId,
              changeType: 'new'
            },
            metadata: undefined
          } as any
        });
        if (generation.success && generation.analets && generation.analets.length > 0) {
          const created = generation.analets[0];
          // Write metadata first to ensure we have a stable meridian cell id
          const writeResult = await this.jupyterService.writeCellMetadataFromAnalet(
            notebookPath,
            effectiveCellId,
            created,
            typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
            contentHash
          );
          const stableCellId = writeResult.meridianCellId || effectiveCellId;
          // Link using stable cell id from metadata
          await this.linkService.linkAnaletToCell(
            created.id,
            notebookPath,
            stableCellId,
            writeResult.cellIndex,
            contentHash
          );

          // IMPORTANT: Auto-enable sync for newly created analet cells
          try {
            await this.syncConfigService.enableAnaletCellSync(
              notebookPath,
              stableCellId,
              writeResult.cellIndex,
              contentHash
            );
          } catch (syncConfigError) {
            console.warn('⚠️ [SYNC-CONFIG] Failed to enable sync for new analet cell', {
              analetId: created.id,
              error: syncConfigError
            });
            // Don't fail the entire operation if sync config fails
          }

          result.created = true;
          result.metadataUpdated = true;
        } else {
          console.warn('⚠️ [NotebookSyncController] Generation failed for cell', { notebookPath, effectiveCellId });
        }
        this.creationLocks.delete(lockKey);
      } else {
        // FALLBACK: Check if this cell previously had an analet (even without marker)
        // This handles the case where user edits a cell but loses metadata/marker
        const previousAnaletForCell = await this.linkService.getAnaletByCellWithResolution(
          notebookPath,
          effectiveCellId,
          typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
          contentHash
        );

        if (previousAnaletForCell !== null) {
          // Update the existing analet with new content
          if (!this.analetController) {
            this.analetController = createAnaletController(this.stateService);
          }

          // Get the existing analet to update
          const existingAnalet = await this.stateService.getAnaletById(previousAnaletForCell);
          if (!existingAnalet) {
            console.warn('⚠️ [NotebookSyncController] Previous analet not found for update', { analetId: previousAnaletForCell });
            return result;
          }

          // Preserve the existing analet but update metadata and timestamp
          // Note: We don't update the analet content itself - if user wants new content,
          // they should add a marker like "# analet: new_name" to trigger regeneration
          const updatedAnalet: Analet = {
            ...existingAnalet,
            notebookCellMetadata: {
              ...existingAnalet.notebookCellMetadata,
              notebookPath,
              cellId: effectiveCellId,
              changeType: 'content_update'
            }
          };

          try {
            await this.stateService.updateAnalet(updatedAnalet);

            // Refresh the link to ensure it's current
            await this.linkService.linkAnaletToCell(
              previousAnaletForCell,
              notebookPath,
              effectiveCellId,
              typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
              contentHash
            );

            // Update cell metadata to reflect the updated analet
            await this.jupyterService.writeCellMetadataFromAnalet(
              notebookPath,
              effectiveCellId,
              updatedAnalet,
              typeof effectiveIndex === 'number' ? effectiveIndex : undefined,
              contentHash
            );

            result.updated = true;
            result.metadataUpdated = true;
          } catch (updateError) {
            console.warn('⚠️ [NotebookSyncController] Failed to update existing analet', {
              analetId: previousAnaletForCell,
              effectiveCellId,
              error: updateError instanceof Error ? updateError.message : 'Unknown error'
            });
          }
        }
      }
    }

    return result;
  }


  /**
   * Helper methods for notebook operations
   */

  private async generateUniqueNotebookPath(analet: Analet): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      throw new Error('No workspace folder found');
    }

    // If the dataset was loaded from a file path, prefer creating notebooks in that folder
    let baseDir = workspaceFolder;
    try {
      const dataset = await this.stateService.loadDataset();
      const filePath = dataset?.metadata?.filePath || dataset?.datasetInfo?.filePath;
      if (filePath && typeof filePath === 'string') {
        const candidate = path.dirname(filePath);
        if (candidate && candidate.length > 0) {
          baseDir = candidate;
        }
      }
    } catch {}

    const sanitizedStatement = analet.statement
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase()
      .substring(0, 50);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(baseDir));

    let counter = 1;
    let notebookPath: string;

    do {
      const filename = counter === 1
        ? `${sanitizedStatement}.ipynb`
        : `${sanitizedStatement}_${counter}.ipynb`;
      notebookPath = path.join(baseDir, filename);
      counter++;
    } while (await this.fileExists(notebookPath));

    return notebookPath;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  private findPrimaryAnalysisCell(notebookData: any): number {
    // Find first code cell with analet metadata
    for (let i = 0; i < notebookData.cells.length; i++) {
      const cell = notebookData.cells[i];
      if (cell.cell_type === 'code' && cell.metadata?.meridian_analet?.type === 'analet') {
        return i;
      }
    }

    // Fallback to first code cell
    for (let i = 0; i < notebookData.cells.length; i++) {
      if (notebookData.cells[i].cell_type === 'code') {
        return i;
      }
    }

    return 0;
  }

  private generateContentHash(source: string | string[]): string {
    const content = Array.isArray(source) ? source.join('') : source;
    return crypto.createHash('sha256').update(content.trim()).digest('hex').slice(0, 16);
  }

  private async getCurrentlyActiveCells(): Promise<RecentCellActivity[]> {
    // This would integrate with VS Code's active editor to get currently open/selected cells
    // For now, return empty array
    return [];
  }

  /**
   * Scan directory for all notebook files and extract their cells
   */
  private async getAllNotebookCells(): Promise<RecentCellActivity[]> {
    const notebookCells: RecentCellActivity[] = [];

    try {
      // Find all .ipynb files in the workspace
      const notebookFiles = await vscode.workspace.findFiles(
        '**/*.ipynb',
        '**/node_modules/**' // Exclude node_modules
      );


      for (const notebookUri of notebookFiles) {
        try {
          const notebookPath = notebookUri.fsPath;
          const content = await vscode.workspace.fs.readFile(notebookUri);
          const notebookData = JSON.parse(Buffer.from(content).toString('utf8'));

          // Extract all code cells from the notebook
          if (notebookData.cells && Array.isArray(notebookData.cells)) {
            notebookData.cells.forEach((cell: any, index: number) => {
              if (cell.cell_type === 'code' && cell.source) {
                // Create a RecentCellActivity for each cell
                notebookCells.push({
                  notebookPath,
                  cellId: cell.id || `cell_${index}`,
                  cellIndex: index,
                  lastActivity: new Date().toISOString(), // Current time for directory scan
                  contentHash: this.generateContentHash(Array.isArray(cell.source) ? cell.source : [cell.source]),
                  activityType: 'directory_scan'
                });
              }
            });
          }

        } catch (error) {
        }
      }


    } catch (error) {
    }

    return notebookCells;
  }

  /**
   * Get notebook hierarchy for frontend display without triggering sync operations
   * Lightweight method that only gathers file structure and basic metadata
   */
  public async getNotebookHierarchy(): Promise<{ notebooks: any[]; totalCells: number }> {
    const notebooks: any[] = [];
    let totalCells = 0;

    try {
      // Find all .ipynb files in the workspace
      const notebookFiles = await vscode.workspace.findFiles(
        '**/*.ipynb',
        '**/node_modules/**'
      );

      for (const notebookUri of notebookFiles) {
        try {
          const notebookPath = notebookUri.fsPath;
          const content = await vscode.workspace.fs.readFile(notebookUri);
          const notebookData = JSON.parse(Buffer.from(content).toString('utf8'));

          // Count cells and gather basic metadata
          const codeCells = notebookData.cells?.filter((cell: any) => cell.cell_type === 'code') || [];
          const allCellsWithMetadata = [];
          let cellsWithAnalets = 0;

          // Process ALL code cells, not just ones with analets
          for (let i = 0; i < codeCells.length; i++) {
            const cell = codeCells[i];
            const cellId = cell.id || `cell_${i}`;

            // Check if this cell has an associated analet
            const analetId = await this.linkService.getAnaletByCellWithResolution(
              notebookPath,
              cellId,
              i
            );

            if (analetId !== null) {
              cellsWithAnalets++;
            }

            // Get cell preview (first few lines of source)
            const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
            const preview = source.split('\n').slice(0, 2).join('\n').substring(0, 100);

            allCellsWithMetadata.push({
              cellId,
              cellIndex: i,
              cellType: 'code' as const,
              analetId: analetId || undefined,
              preview: preview || '(empty cell)',
              isSynced: false, // Will be populated by message handler
              syncType: 'manual' as const
            });
          }

          notebooks.push({
            path: notebookPath,
            name: notebookPath.split('/').pop()?.replace('.ipynb', ''),
            totalCells: codeCells.length,
            cellsWithAnalets,
            cells: allCellsWithMetadata // Return ALL cells, not just ones with analets
          });

          totalCells += codeCells.length;

        } catch (error) {
          console.warn('[NotebookSyncController] Error reading notebook:', notebookUri.fsPath, error);
        }
      }

    } catch (error) {
      console.error('[NotebookSyncController] Error building notebook hierarchy:', error);
    }

    return { notebooks, totalCells };
  }

  private deduplicateCells(cells: RecentCellActivity[]): RecentCellActivity[] {
    const seen = new Set<string>();
    return cells.filter(cell => {
      const key = `${cell.notebookPath}:${cell.cellId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  // Use JupyterNotebookService for cell IO

  private async readCellMetadata(notebookPath: string, cellId: string): Promise<any | null> {
    const cellData = await this.jupyterService.readCellData(notebookPath, cellId);
    return cellData?.metadata || null;
  }

  private async writeCellMetadataFromAnalet(
    notebookPath: string,
    cellId: string,
    analet: Analet,
    fallbackIndex?: number,
    contentHash?: string
  ): Promise<void> {
    await this.jupyterService.writeCellMetadataFromAnalet(
      notebookPath,
      cellId,
      analet,
      fallbackIndex,
      contentHash
    );
  }

  /**
   * Get access to sync configuration service for external integrations
   */
  public getSyncConfigService(): CellSyncConfigService {
    return this.syncConfigService;
  }

  /**
   * Public: Sync a single specific cell (one-off pull)
   */
  public async syncSingleCell(
    notebookPath: string,
    cellId: string,
    cellIndex?: number
  ): Promise<{ created: boolean; updated: boolean; metadataUpdated: boolean; conflictResolved: boolean }> {
    return await this.upsertAnaletFromCell(
      notebookPath,
      cellId,
      cellIndex,
      'normal',
      undefined,
      true // force treat as configured for a one-off pull
    );
  }

  /**
   * Create a new sync configuration method that only syncs configured cells
   * This replaces the existing scanDirectory approach with explicit config filtering
   */
  public async syncConfiguredCellsOnly(): Promise<SyncResult> {
    const result: SyncResult = {
      cellsProcessed: 0,
      analetsUpdated: 0,
      analetsCreated: 0,
      conflictsResolved: 0,
      metadataUpdated: 0,
      errors: [],
      success: true
    };

    try {
      // Get all cells configured for sync
      const syncedCells = this.syncConfigService.getAllSyncedCells();
      // Convert to RecentCellActivity format for processing
      const cellActivities: RecentCellActivity[] = syncedCells.map(config => ({
        notebookPath: config.notebookPath,
        cellId: config.cellId,
        cellIndex: config.cellIndex,
        lastActivity: new Date().toISOString(),
        contentHash: config.lastSyncHash || '',
        activityType: 'config_sync' as any
      }));

      // Process each configured cell
      for (const cellActivity of cellActivities) {
        try {
          const cellResult = await this.upsertAnaletFromCell(
            cellActivity.notebookPath,
            cellActivity.cellId,
            cellActivity.cellIndex,
            'normal', // Use normal sync level
            cellActivity.contentHash,
            true // This is a configured cell
          );

          result.cellsProcessed++;

          if (cellResult.created) {
            result.analetsCreated++;
          } else if (cellResult.updated) {
            result.analetsUpdated++;
          }

          if (cellResult.metadataUpdated) {
            result.metadataUpdated++;
          }

          if (cellResult.conflictResolved) {
            result.conflictsResolved++;
          }

        } catch (error) {
          const errorMsg = `Failed to process configured cell ${cellActivity.cellId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMsg);
          console.error('[NotebookSyncController] sync error', errorMsg);
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push(`Config-only sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Set up file watcher to automatically enable sync for new cells when notebooks are saved
   */
  private setupNotebookFileWatcher(context: vscode.ExtensionContext): void {
    // Watch for notebook file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.ipynb');

    // Track notebook cell counts to detect new cells
    const notebookCellCounts = new Map<string, number>();

    watcher.onDidChange(async (uri) => {
      try {
        const notebookPath = uri.fsPath;
        // Read the updated notebook
        const content = await vscode.workspace.fs.readFile(uri);
        const notebookData = JSON.parse(Buffer.from(content).toString('utf8'));
        const codeCells = notebookData.cells?.filter((cell: any) => cell.cell_type === 'code') || [];

        const previousCount = notebookCellCounts.get(notebookPath) || 0;
        const currentCount = codeCells.length;

        // If we have more cells than before, auto-enable sync for new cells
        if (currentCount > previousCount) {
          // Process the new cells (from previousCount to currentCount)
          for (let i = previousCount; i < currentCount; i++) {
            const cell = codeCells[i];
            const cellId = cell.id || `cell_${i}`;

            // Auto-enable sync for new code cells
            try {
              await this.syncConfigService.setSyncConfig({
                notebookPath,
                cellId,
                cellIndex: i,
                isEnabled: true,
                syncType: 'auto' // Mark as auto-enabled
              });
            } catch (error) {
              console.warn('⚠️ [AUTO-SYNC] Failed to enable sync for new cell', {
                notebookPath,
                cellId,
                error
              });
            }
          }
        }

        // Update our tracking
        notebookCellCounts.set(notebookPath, currentCount);

      } catch (error) {
        console.error('❌ [AUTO-SYNC] Error processing notebook change:', error);
      }
    });

    // Initialize cell counts for existing notebooks
    this.initializeNotebookCellCounts(notebookCellCounts);

    // Clean up watcher when extension is disposed
    context.subscriptions.push(watcher);
  }

  /**
   * Initialize cell counts for existing notebooks
   */
  private async initializeNotebookCellCounts(notebookCellCounts: Map<string, number>): Promise<void> {
    try {
      const notebookFiles = await vscode.workspace.findFiles('**/*.ipynb', '**/node_modules/**');

      for (const notebookUri of notebookFiles) {
        try {
          const notebookPath = notebookUri.fsPath;
          const content = await vscode.workspace.fs.readFile(notebookUri);
          const notebookData = JSON.parse(Buffer.from(content).toString('utf8'));
          const codeCells = notebookData.cells?.filter((cell: any) => cell.cell_type === 'code') || [];

          notebookCellCounts.set(notebookPath, codeCells.length);
        } catch (error) {
          console.warn('⚠️ [AUTO-SYNC] Failed to initialize notebook', {
            path: notebookUri.fsPath,
            error
          });
        }
      }
    } catch (error) {
      console.error('❌ [AUTO-SYNC] Failed to initialize notebook tracking:', error);
    }
  }
}
