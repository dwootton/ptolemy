import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MessageServiceFactory } from './services/messaging/MessageServiceFactory';
import { EnvironmentService } from './services/EnvironmentService';
import { StateManagementService, ConceptAxis } from './services/StateManagementService';
import { NotebookWatcherService } from './services/NotebookWatcherService';
import { AnaletStorageService } from './services/AnaletStorageService';
import { AnaletCheckpointService } from './services/AnaletCheckpointService';
import { ENABLE_SESSION_STATE_RESTORE } from './constants';
import { getUri } from './utilities/getUri';
import { getNonce } from './utilities/getNonce';
import { getOpenAIKey, isValidApiKeyFormat } from './config/apiKey';
import { TelemetryService } from './services/TelemetryService';
import { ActiveWorkspaceManager } from './services/ActiveWorkspaceManager';

export async function activate(context: vscode.ExtensionContext) {
  try {
    // Emit a clear build/version banner to verify deployment
    const pkgJsonPath = path.join(context.extensionPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { version?: string };
    const version = pkg.version || 'unknown';
    console.log('[dataset-bug][extension] activate', { version, ts: new Date().toISOString() });
  } catch (e) {
    try { console.warn('[dataset-bug][extension] activate banner failed', e); } catch {}
  }
  // Initialize environment service
  const envService = EnvironmentService.getInstance();
  envService.initialize(context.extensionPath);

  // Initialize OpenAI API key (fail gracefully if not available)
  try {
    const openaiApiKey = getOpenAIKey();
    if (openaiApiKey && !isValidApiKeyFormat(openaiApiKey)) {
      console.warn('⚠️ [Extension] OpenAI API key format appears invalid');
    }
  } catch (error) {
    console.error('❌ [Extension] Failed to load OpenAI API key:', error);
  }

  // Initialize state management service (only if enabled)
  const stateService = ENABLE_SESSION_STATE_RESTORE ? StateManagementService.getInstance(context) : undefined;
  // Initialize telemetry without recording until the user enables it.
  try {
    // Initialize active workspace manager so TelemetryService picks correct root
    ActiveWorkspaceManager.getInstance(context);
    TelemetryService.getInstance(context);
  } catch (e) {
    console.warn('⚠️ [Extension] Failed to initialize TelemetryService early:', e);
  }
  // Initialize checkpoint service
  const checkpointService = AnaletCheckpointService.getInstance();
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const activeManager = ActiveWorkspaceManager.getInstance(context);
    const workspaceRoot = activeManager.getActiveRoot();
    await checkpointService.initialize(workspaceRoot);
  }

  // Initialize notebook watcher service
  let notebookWatcherService: NotebookWatcherService | undefined;
  if (stateService && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    try {
      notebookWatcherService = NotebookWatcherService.getInstance();
      // Start watching immediately so we capture events even if the UI isn't opened
      notebookWatcherService.initialize();
      // Register cleanup on deactivation
      context.subscriptions.push({
        dispose: () => {
          notebookWatcherService!.dispose();
        }
      });
    } catch (error) {
      console.error('❌ [Extension] Failed to initialize notebook watcher:', error);
    }
  }


  // Register sidebar webview view provider
  const provider = new MeridianViewProvider(context.extensionUri, stateService, context, notebookWatcherService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('meridian-v2.sidebar', provider)
  );


  // Command to focus on the sidebar view instead of opening panel
  const command = 'meridian-v2.open';
  const commandHandler = () => {
    vscode.commands.executeCommand('workbench.view.extension.meridian');
  };
  context.subscriptions.push(vscode.commands.registerCommand(command, commandHandler));

  // OpenAI smoke test command for Codespaces verification
  const smokeTestCommand = 'meridian.openaiSmokeTest';
  const smokeTestHandler = async () => {
    try {
      const apiKey = getOpenAIKey();
      if (!apiKey) {
        vscode.window.showErrorMessage(
          '❌ OpenAI Smoke Test Failed: No API key available. ' +
          'Please add OPENAI_API_KEY to your Codespaces secrets or VS Code settings.'
        );
        return;
      }

      if (!isValidApiKeyFormat(apiKey)) {
        vscode.window.showErrorMessage(
          '❌ OpenAI Smoke Test Failed: API key format appears invalid. ' +
          'Please verify your OpenAI API key.'
        );
        return;
      }

      // Show loading message
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Testing OpenAI connection...",
        cancellable: false
      }, async () => {
        const { testApiKey } = await import('./config/apiKey');
        const isValid = await testApiKey(apiKey);

        if (isValid) {
          vscode.window.showInformationMessage(
            '✅ OpenAI Smoke Test Passed: API connection successful! ' +
            'Ptolemy extension is ready to generate analyses.'
          );
        } else {
          vscode.window.showErrorMessage(
            '❌ OpenAI Smoke Test Failed: Unable to connect to OpenAI API. ' +
            'Please verify your API key has sufficient credits and permissions.'
          );
        }
      });
    } catch (error) {
      console.error('❌ [Extension] Smoke test error:', error);
      vscode.window.showErrorMessage(
        `❌ OpenAI Smoke Test Failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };
  context.subscriptions.push(vscode.commands.registerCommand(smokeTestCommand, smokeTestHandler));

  // Create note from Jupyter cell command
  const createNoteFromCellCommand = 'meridian.createNoteFromCell';
  const createNoteFromCellHandler = async (cell?: vscode.NotebookCell) => {
    try {
      if (!cell) {
        vscode.window.showErrorMessage('No cell selected for creating note');
        return;
      }

      // Get the associated analet for this cell
      const notebookPath = cell.notebook.uri.fsPath;
      const cellIndex = cell.index;

      // Send message to webview to create note for this cell
      const activeProvider = getActiveWebviewProvider();
      if (activeProvider) {
        const messageService = activeProvider.getMessageService();
        if (messageService) {
          await messageService.sendMessage('create-note-from-cell', {
            notebookPath,
            cellIndex,
            cellContent: cell.document.getText()
          });
        }
      }

    } catch (error) {
      console.error('❌ [Extension] Failed to create note from cell:', error);
      vscode.window.showErrorMessage(
        `Failed to create note from cell: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };
  context.subscriptions.push(vscode.commands.registerCommand(createNoteFromCellCommand, createNoteFromCellHandler));

  // Create note command (general)
  const createNoteCommand = 'meridian.createNote';
  const createNoteHandler = async () => {
    try {
      const activeProvider = getActiveWebviewProvider();
      if (activeProvider) {
        const messageService = activeProvider.getMessageService();
        if (messageService) {
          await messageService.sendMessage('create-note', {});
        }
      }
    } catch (error) {
      console.error('❌ [Extension] Failed to create note:', error);
      vscode.window.showErrorMessage(
        `Failed to create note: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };
  context.subscriptions.push(vscode.commands.registerCommand(createNoteCommand, createNoteHandler));

  // Create note from active cell command (for context menus that don't pass cell)
  const createNoteFromActiveCellCommand = 'meridian.createNoteFromActiveCell';
  const createNoteFromActiveCellHandler = async () => {
    try {
      // Get the active notebook editor
      const activeNotebookEditor = vscode.window.activeNotebookEditor;
      if (!activeNotebookEditor) {
        vscode.window.showErrorMessage('No active notebook found');
        return;
      }

      // Get the selected cell (or first cell if none selected)
      const selections = activeNotebookEditor.selections;
      const cellIndex = selections.length > 0 ? selections[0].start : 0;
      if (cellIndex >= activeNotebookEditor.notebook.cellCount) {
        vscode.window.showErrorMessage('No valid cell found');
        return;
      }

      const cell = activeNotebookEditor.notebook.cellAt(cellIndex);
      const notebookPath = cell.notebook.uri.fsPath;
      const cellContent = cell.document.getText();
      // Send message to webview to create note for this cell
      const activeProvider = getActiveWebviewProvider();
      if (activeProvider) {
        const messageService = activeProvider.getMessageService();
        if (messageService) {
          await messageService.sendMessage('create-note-from-cell', {
            notebookPath,
            cellIndex,
            cellContent
          });
        }
      }

    } catch (error) {
      console.error('❌ [Extension] Failed to create note from active cell:', error);
      vscode.window.showErrorMessage(
        `Failed to create note from cell: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };
  context.subscriptions.push(vscode.commands.registerCommand(createNoteFromActiveCellCommand, createNoteFromActiveCellHandler));
  // Helper function to get the active webview provider
  function getActiveWebviewProvider(): MeridianViewProvider | undefined {
    return provider; // Reference to the provider created above
  }
}

class MeridianViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'meridian-v2.sidebar';
  private _view?: vscode.WebviewView;
  private _messageService?: any; // MessageRouter
  private _stateService?: StateManagementService;
  private _extensionContext: vscode.ExtensionContext;
  private _notebookWatcherService?: NotebookWatcherService;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    stateService?: StateManagementService,
    extensionContext?: vscode.ExtensionContext,
    notebookWatcherService?: NotebookWatcherService
  ) {
    this._stateService = stateService;
    this._extensionContext = extensionContext!;
    this._notebookWatcherService = notebookWatcherService;
  }

  public getMessageService(): any | undefined { // Returns MessageRouter from modular architecture
    return this._messageService;
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    this._messageService = await MessageServiceFactory.createAndInitialize(webviewView.webview, this._stateService!);

    // Connect the message service to the notebook watcher service

    // Initialize the notebook watcher service with the message service
    if (this._notebookWatcherService && this._messageService) {
      this._notebookWatcherService.initialize(this._messageService);
    }


    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'out'),
        vscode.Uri.joinPath(this._extensionUri, 'webview-ui/dist')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    this._setWebviewMessageListener(webviewView.webview);

    // Send initial state to webview after it's ready
    setTimeout(async () => {
      await this._sendInitialStateToWebview();
    }, 100);
  }


  private async _sendInitialStateToWebview(): Promise<void> {
    if (this._messageService && this._stateService) {
      try {
        const uiState = await this._stateService.loadUIState();
        const activeFilters = await this._stateService.loadActiveFilters();
        const recentActivities = await this._stateService.getRecentActivities();
        const analetsExist = await this._stateService.analetsExist();
        const dimensionsExist = await this._stateService.dimensionsExist();

        const hasExistingState = analetsExist || dimensionsExist || (uiState !== null);

        await this._messageService.sendMessage('initial-state', {
          uiState: uiState || {
            selectedAnaletIds: [],
            mapView: { zoom: 1, pan: { x: 0, y: 0 }, center: { x: 0, y: 0 } },
            panelLayout: { width: 350, height: 600, collapsed: true },
            lastActiveTab: 'map',
            theme: 'dark'
          },
          activeFilters: activeFilters || {
            dimensions: {},
            tags: [],
            searchQuery: ''
          },
          recentActivities: recentActivities || [],
          hasExistingState,
          isRestore: hasExistingState
        });
        // Note: Automatic analets/dimensions loading is handled by AnaletLoader and ConceptExplorer components
        // to avoid conflicts with dataset purge/reload cycles

      } catch (error) {
        console.error('❌ [Extension] Error sending initial state to webview:', error);
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'assets', 'index.js']);
    const styleUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'assets', 'index.css']);
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
          <link rel="stylesheet" type="text/css" href="${styleUri}">
          <style>
            :root {
              --vscode-button-background: #8AA0C0 !important;
              --vscode-button-hoverBackground: #7A90B0 !important;
            }
          </style>
          <title>Ptolemy</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>`;
  }

  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(
      (message: any) => {
        if (this._messageService) {
          this._messageService.handleMessage(message);
        }
      }
    );
  }
}

// Panel view removed - extension now only uses sidebar view

export function deactivate() {}
