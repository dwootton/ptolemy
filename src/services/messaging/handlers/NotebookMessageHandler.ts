/**
 * NotebookMessageHandler - Handles Jupyter notebook operations with simplified API
 * 
 * REFACTORED: Clean 4-operation API using NotebookSyncController:
 * 1. create-notebook-from-analet: Create notebook from analet
 * 2. notebook-cell-selected: Handle cell selection → analet selection
 * 3. sync-notebooks: Sync recently edited cells
 * 4. reconcile-notebook-metadata: Ensure metadata consistency
 */

import * as vscode from 'vscode';
import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { NotebookSyncController } from '../../NotebookSyncController';
import { JupyterNotebookService } from '../../JupyterNotebookService';
import { AnaletMessageHandler } from './AnaletMessageHandler';
import { StateManagementService } from '../../StateManagementService';
import { CellSyncConfigService } from '../../CellSyncConfigService';

export class NotebookMessageHandler extends BaseMessageHandler {
	private syncController!: NotebookSyncController;
	private syncConfigService!: CellSyncConfigService;
	private pendingRequests = new Set<number>(); // Track analetIds currently being processed

	constructor() {
			super([
				// Unified notebook operations API
				'create-or-open-cell',
				'open-notebook-cell',
				// Core operations
				'create-notebook',
				'notebook-cell-selected', 
				'sync-configured-cells',
				'sync-single-cell',
				'load-notebook-hierarchy',
				'reconcile-notebook-metadata',
				// Sync configuration operations
				'load-sync-modal',
				'toggle-cell-sync',
				'save-sync-config',
				'get-sync-stats'
			]);
	}

	/**
	 * Initialize the sync controller with required services
	 */
	public async initializeSyncController(): Promise<void> {
		if (!this.context?.stateService) {
			throw new Error('NotebookMessageHandler requires stateService in context');
		}
		const extensionContext = this.context.stateService.getContext();
		const jupyterService = JupyterNotebookService.getInstance();
		this.syncController = NotebookSyncController.getInstance(
			extensionContext,
			this.context.stateService,
			jupyterService
		);

		// Initialize CellSyncConfigService
		this.syncConfigService = CellSyncConfigService.getInstance(this.context.stateService);
		await this.syncConfigService.initialize();
		this.log('info', 'CellSyncConfigService initialized');

		// Wire AnaletController from AnaletMessageHandler if available via router context hook
		try {
			const analetHandler = (this.context.messageRouter as any)?._analetHandler as AnaletMessageHandler | undefined;
			const analetController = analetHandler?.getAnaletController?.();
			if (analetController) {
				this.syncController.setAnaletController(analetController);
				this.log('info', 'AnaletController wired to NotebookSyncController');
			}
		} catch {}

	}

	public async handle(messageType: string, data: any, _context: MessageContext): Promise<void> {
		// Initialize sync controller if not already done
		if (!this.syncController || !this.syncConfigService) {
			await this.initializeSyncController();
		}

			switch (messageType) {
			case 'create-or-open-cell':
				await this.handleCreateOrOpenCell(data);
				break;
			case 'open-notebook-cell':
				await this.handleOpenNotebookCell(data);
				break;
			case 'create-notebook':
				await this.handleCreateNotebook(data);
				break;
			case 'notebook-cell-selected':
				await this.handleNotebookCellSelected(data);
				break;
			case 'sync-configured-cells':
				await this.handleSyncConfiguredCells(data);
				break;
			case 'sync-single-cell':
				await this.handleSyncSingleCell(data);
				break;
			case 'load-notebook-hierarchy':
				await this.handleLoadNotebookHierarchy(data);
				break;
			case 'reconcile-notebook-metadata':
				await this.handleReconcileNotebookMetadata(data);
				break;
			case 'load-sync-modal':
				await this.handleLoadSyncModal(data);
				break;
			case 'toggle-cell-sync':
				await this.handleToggleCellSync(data);
				break;
			case 'save-sync-config':
				await this.handleSaveSyncConfig(data);
				break;
			case 'get-sync-stats':
				await this.handleGetSyncStats(data);
				break;
			default:
				throw new Error(`Unsupported message type: ${messageType}`);
		}
	}

	/**
	 * NEW: Refresh a single notebook cell and upsert its analet
	 * Always treats the target as a configured cell for a one-off pull
	 */
	private async handleSyncSingleCell(data: any): Promise<void> {
		try {
			const validation = this.validateData(data, ['notebookPath', 'cellId']);
			if (!validation.isValid) {
				throw new Error(validation.error);
			}

			const { notebookPath, cellId, cellIndex } = data;
			this.log('info', '🔄 Refreshing single cell', { notebookPath, cellId, cellIndex });

			// Run a targeted upsert for just this cell. Force isConfiguredCell=true for one-off pull.
			const result = await this.syncController.syncSingleCell(
				notebookPath,
				cellId,
				cellIndex
			);

			// Determine analet after upsert
			let analetId: number | null = null;
			try {
				analetId = await (this.syncController as any).linkService.getAnaletByCellWithResolution(
					notebookPath,
					cellId,
					cellIndex
				);
			} catch {}

			let analet: any = null;
			if (analetId !== null && this.context?.stateService) {
				analet = await this.context.stateService.getAnaletById(analetId);
			}

			// If we created/updated, notify frontend to refresh that analet
			if ((result?.created || result?.updated) && analet) {
				await this.sendMessage('refresh-analets', {
					success: true,
					source: 'single_cell_sync',
					analet
				});
			}

			// Provide hypotheses when nothing changed
			const hypotheses: string[] = [];
			if (!result?.created && !result?.updated) {
				hypotheses.push('Cell content unchanged (same content hash)');
				hypotheses.push('Cell empty or lacks analyzable content');
				hypotheses.push('Analet generation returned no results');
				hypotheses.push('Link resolution failed (missing cell id/metadata)');
			}

			await this.sendMessage('sync-single-cell-result', {
				success: true,
				notebookPath,
				cellId,
				cellIndex,
				created: !!result?.created,
				updated: !!result?.updated,
				metadataUpdated: !!result?.metadataUpdated,
				analetId,
				message: result?.created
					? 'Analet created from cell'
					: (result?.updated ? 'Analet metadata updated' : 'No changes detected'),
				hypotheses
			});

			this.log('info', 'Single cell refresh complete', { 
				notebookPath, cellId, created: !!result?.created, updated: !!result?.updated 
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('sync-single-cell', err, data);
			// Also emit a completion payload so the UI can clear spinners
			await this.sendMessage('sync-single-cell-result', {
				success: false,
				notebookPath: data?.notebookPath,
				cellId: data?.cellId,
				cellIndex: data?.cellIndex,
				error: err.message
			});
		}
	}

	/**
	 * UNIFIED OPERATION: Create or Open Cell
	 * Smart handler that checks if analet has existing notebook, then either opens existing cell or creates new notebook
	 */
	private async handleCreateOrOpenCell(data: any): Promise<void> {
		try {
			const validation = this.validateData(data, ['analetId']);
			if (!validation.isValid) {
				throw new Error(validation.error);
			}

			const { analetId, startTime } = data;

			// Check if this analet is already being processed to prevent duplicates
			if (this.pendingRequests.has(analetId)) {
				this.log('info', 'Duplicate request ignored - notebook operation already in progress', { analetId });
				
				// Send a response indicating this was a duplicate
				await this.sendMessage('cell-opened', {
					success: false,
					analetId,
					action: 'duplicate_request_ignored',
					message: 'Notebook operation already in progress for this analet'
				});
				return;
			}

			// Mark this analet as being processed
			this.pendingRequests.add(analetId);
			const backendStartTime = Date.now();
			const frontendElapsed = startTime ? backendStartTime - startTime : 'unknown';
			this.log('info', '🔍 [DEBUG] Create or open cell for analet', { analetId });

			// Get the analet to check if it has existing notebook metadata
            let analet = await this.context?.stateService?.getAnaletById(analetId);
            if (!analet) {
                // Fallback 1: force-load from persistent storage and search by ID
                try {
                    const all = await this.context?.stateService?.getAnalets();
                    analet = (all || []).find(a => a.id === analetId) || null as any;
                } catch {}
            }
            if (!analet && this.context?.analetStore) {
                // Fallback 2: hydrate AnaletStore from storage then search again
                try {
                    await this.context.analetStore.loadFromStorage();
                    const all = await this.context.stateService?.getAnalets();
                    analet = (all || []).find(a => a.id === analetId) || null as any;
                } catch {}
            }
            if (!analet) {
                throw new Error(`Analet ${analetId} not found`);
            }
			this.log('info', '📋 [DEBUG] Analet metadata check', { 
				analetId, 
				hasNotebookMetadata: !!analet.notebookCellMetadata,
				notebookPath: analet.notebookCellMetadata?.filePath || analet.notebookCellMetadata?.notebookPath
			});

			if (analet.notebookCellMetadata) {
				// Analet has notebook metadata - check if the file still exists
				const notebookPath = analet.notebookCellMetadata.filePath || analet.notebookCellMetadata.notebookPath;
				const fileExists = await this.fileExists(notebookPath);
				if (notebookPath && fileExists) {
					// File exists - open the existing cell
					this.log('info', 'Opening existing notebook cell', { 
						analetId, 
						notebookPath 
					});
					
					await this.handleOpenExistingCell(analet.notebookCellMetadata, analetId, backendStartTime);
				} else {
					// File doesn't exist - create new notebook and update analet metadata
					this.log('info', 'Notebook file no longer exists, creating new notebook', { 
						analetId, 
						missingPath: notebookPath 
					});
					
					// Clear the stale metadata before creating new notebook
					const analetWithClearedMetadata = { ...analet, notebookCellMetadata: undefined };
					await this.context?.stateService?.updateAnalet(analetWithClearedMetadata);
					await this.handleCreateNewNotebook(analetId, backendStartTime);
				}
			} else {
				// Analet doesn't have notebook metadata - check for existing notebooks as fallback
				this.log('info', 'No notebook metadata, checking for existing notebooks', { analetId });
				
				// Try to find an existing notebook for this analet by scanning the workspace
				const recoveredMetadata = await this.tryRecoverNotebookMetadata(analetId, analet.statement);
				
				if (recoveredMetadata) {
					// Update the analet with recovered metadata
					const updatedAnalet = { ...analet, notebookCellMetadata: recoveredMetadata };
					await this.context?.stateService?.updateAnalet(updatedAnalet);
					
					// Open the recovered notebook
					await this.handleOpenExistingCell(recoveredMetadata, analetId, backendStartTime);
				} else {
					// No existing notebook found, create new one
					await this.handleCreateNewNotebook(analetId, backendStartTime);
				}
			}

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('create-or-open-cell', err, data);
		} finally {
			// Always clean up the pending request, regardless of success or failure
			if (data?.analetId) {
				this.pendingRequests.delete(data.analetId);
			}
		}
	}

	/**
	 * Helper: Open existing notebook cell and navigate to it
	 */
	private async handleOpenExistingCell(notebookCellMetadata: any, analetId: number, startTime?: number): Promise<void> {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Opening existing notebook...",
			cancellable: false
		}, async () => {
		const notebookPath: string = notebookCellMetadata.filePath || notebookCellMetadata.notebookPath;
		const cellId: string | undefined = notebookCellMetadata.cellId;

		if (!notebookPath) {
			throw new Error('Missing notebookPath/filePath in notebookCellMetadata');
		}

		// Open the notebook file in VS Code Jupyter viewer
		const uri = vscode.Uri.file(notebookPath);
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook', vscode.ViewColumn.One);
			this.log('info', 'Opened notebook in Jupyter viewer', { notebookPath });
		} catch (error) {
			this.log('warn', 'Failed to open notebook in Jupyter viewer, falling back to text editor', { notebookPath, error });
			// Fallback to text editor if Jupyter viewer fails
			try {
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc, { preview: false });
			} catch (fallbackError) {
				this.log('error', 'Failed to open notebook in any viewer', { notebookPath, error: fallbackError });
			}
		}

		// Resolve the cell index via stable meridian cell id before selection
		let resolvedIndex: number | undefined = undefined;
		if (cellId) {
			try {
				const jup = JupyterNotebookService.getInstance();
				const found = await jup.findCellIndexByMeridianId(notebookPath, cellId);
				if (found) {
					resolvedIndex = found.cellIndex;
				}
			} catch {}
		}
		// Handle cell selection to link with analet (pass resolved index only for navigation, not identity)
		await this.handleNotebookCellSelected({ 
			notebookPath, 
			cellIndex: resolvedIndex, 
			cellId 
		});

		// Send unified response
		await this.sendMessage('cell-opened', {
			success: true,
			analetId,
			action: 'opened_existing',
			notebookPath,
			cellId,
			cellIndex: resolvedIndex,
			message: 'Successfully opened existing notebook cell'
		});
		this.log('info', '✅ [DEBUG] Opened existing notebook cell', { 
			analetId, 
			notebookPath, 
			cellId, 
			cellIndex: resolvedIndex 
		});
		});
	}

	/**
	 * NEW: Open notebook by path and optionally navigate/select a target cell
	 */
	private async handleOpenNotebookCell(data: any): Promise<void> {
		try {
			const validation = this.validateData(data, ['notebookPath']);
			if (!validation.isValid) {
				throw new Error(validation.error);
			}

			const { notebookPath, cellId, cellIndex } = data;
			const uri = vscode.Uri.file(notebookPath);

			try {
				await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook', vscode.ViewColumn.One);
			} catch (error) {
				// Fallback to text editor if Jupyter viewer fails
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc, { preview: false });
			}

			// Best-effort: notify selection for downstream link/selection behavior
			await this.handleNotebookCellSelected({ notebookPath, cellId, cellIndex });

			await this.sendMessage('notebook-cell-opened', {
				success: true,
				notebookPath,
				cellId,
				cellIndex,
				timestamp: new Date().toISOString()
			});
		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('open-notebook-cell', err, data);
		}
	}

	/**
	 * Helper: Create new notebook and open to primary cell
	 */
	private async handleCreateNewNotebook(analetId: number, startTime?: number): Promise<void> {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Creating new notebook...",
			cancellable: false
		}, async () => {
		// Use the existing NotebookSyncController to create the notebook
		const result = await this.syncController.createNotebookFromAnalet(analetId, startTime);

		if (!result.success) {
			throw new Error(result.message || 'Failed to create notebook');
		}

		// Open the newly created notebook in VS Code Jupyter viewer
		const uri = vscode.Uri.file(result.notebookPath);
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook', vscode.ViewColumn.One);
			this.log('info', 'Opened newly created notebook in Jupyter viewer', { 
				notebookPath: result.notebookPath 
			});
		} catch (error) {
			this.log('warn', 'Failed to open newly created notebook in Jupyter viewer, falling back to text editor', { 
				notebookPath: result.notebookPath, 
				error 
			});
			// Fallback to text editor if Jupyter viewer fails
			try {
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc, { preview: false });
			} catch (fallbackError) {
				this.log('error', 'Failed to open newly created notebook in any viewer', { 
					notebookPath: result.notebookPath, 
					error: fallbackError 
				});
			}
		}

		// Send unified response
		await this.sendMessage('cell-opened', {
			success: true,
			analetId,
			action: 'created_new',
			notebookPath: result.notebookPath,
			cellId: result.cellId,
			cellIndex: result.primaryCellIndex,
			message: 'Successfully created and opened new notebook'
		});
		this.log('info', '🆕 [DEBUG] Created new notebook', { 
			analetId, 
			notebookPath: result.notebookPath, 
			cellId: result.cellId, 
			cellIndex: result.primaryCellIndex 
		});

		// Debug: Verify the analet was updated with notebook metadata (from returned result)
		const updatedAnalet = result.updatedAnalet;
		// CRITICAL: Notify frontend about the updated analet to maintain single source of truth
		if (updatedAnalet) {
			// DEBUG: Send a test message first to verify message routing works
			await this.sendMessage('debug-test-message', {
				analetId: updatedAnalet.id,
				message: 'Testing if frontend receives messages'
			});
			await this.sendMessage('analet-updated', {
				analet: updatedAnalet,
				source: 'notebook-creation',
				timestamp: new Date().toISOString()
			});
		}
		});
	}

	/**
	 * CORE OPERATION: Create a new empty notebook at optional parentPath with optional name
	 */
	private async handleCreateNotebook(data?: { parentPath?: string; name?: string }): Promise<void> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('No workspace folder is open');
			}

			const parentPath = (data && typeof data.parentPath === 'string' ? data.parentPath : '').trim();
			const nameInput = (data && typeof data.name === 'string' ? data.name : 'Untitled.ipynb').trim();
			const fileName = nameInput.toLowerCase().endsWith('.ipynb') ? nameInput : `${nameInput}.ipynb`;

			const pathMod = require('path');
			const baseDir = parentPath
				? (pathMod.isAbsolute(parentPath) ? parentPath : pathMod.join(workspaceFolder.uri.fsPath, parentPath))
				: workspaceFolder.uri.fsPath;

			const fs = await import('fs');
			const filePath = pathMod.join(baseDir, fileName);

			// Ensure directory exists
			await fs.promises.mkdir(pathMod.dirname(filePath), { recursive: true });

			// Minimal valid notebook JSON
			const notebookContent = {
				cells: [],
				metadata: {
					kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
					language_info: { name: 'python', version: '3.8.0' }
				},
				nbformat: 4,
				nbformat_minor: 4
			};

			await fs.promises.writeFile(filePath, JSON.stringify(notebookContent, null, 2), 'utf8');

			// Open with Jupyter viewer
			const uri = vscode.Uri.file(filePath);
			await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook', vscode.ViewColumn.One);

			// Notify webview about file creation/open
			await this.sendMessage('file-created', { success: true, path: filePath, name: fileName });
			await this.sendMessage('file-opened', { success: true, path: filePath });
		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('create-notebook', err, data);
		}
	}

	/**
	 * CORE OPERATION 2: Handle cell selection → analet selection
	 * When a notebook cell is clicked, select the corresponding analet in the shared service
	 */
	private async handleNotebookCellSelected(data: any): Promise<void> {
		try {
			const validation = this.validateData(data, ['notebookPath']);
			if (!validation.isValid) {
				throw new Error(validation.error);
			}

			const { notebookPath, cellId, cellIndex } = data;
			this.log('info', 'Handling notebook cell selection', { 
				notebookPath, 
				cellId, 
				cellIndex 
			});

			const result = await this.syncController.onNotebookCellSelected(
				notebookPath,
				cellId,
				cellIndex
			);

			await this.sendMessage('notebook-cell-selection-result', {
				success: result.success,
				analetId: result.analetId,
				analet: result.analet,
				wasLinked: result.wasLinked,
				message: result.message,
				notebookPath,
				cellId,
				cellIndex
			});

			// Back-compat: also emit the original event name the webview listens for
			if (result.analetId) {
				await this.sendMessage('notebook-cell-selected', {
					analetId: result.analetId,
					notebookPath,
					cellId,
					cellIndex,
					timestamp: new Date().toISOString()
				});
			} else {
				await this.sendMessage('notebook-cell-deselected', {
					notebookPath,
					cellId,
					cellIndex,
					timestamp: new Date().toISOString()
				});
			}

			if (result.analetId) {
				this.log('info', 'Cell selection resulted in analet selection', { 
					analetId: result.analetId,
					cellId 
				});
			} else {
				this.log('info', 'Cell selection - no analet linked', { cellId });
			}

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('notebook-cell-selected', err, data);
		}
	}

	/**
	 * CORE OPERATION 3: Sync configured cells
	 * Processes only cells explicitly configured for sync in the sync modal
	 */
	private async handleSyncConfiguredCells(data: any): Promise<void> {
		try {
			this.log('info', 'Starting sync of configured cells');

			const result = await this.syncController.syncConfiguredCellsOnly();

			// If analets were created/updated, explicitly refresh the frontend
			if (result.success && (result.analetsCreated > 0 || result.analetsUpdated > 0)) {
				this.log('info', 'Sync created/updated analets, refreshing frontend state');
				
				// Get all current analets and send them to frontend
				const allAnalets = await this.context?.stateService?.getAnalets();
				if (allAnalets) {
					await this.sendMessage('fetch-analet-data', {
						analets: allAnalets,
						success: true,
						source: 'notebook_sync',
						newAnaletsCount: result.analetsCreated,
						updatedAnaletsCount: result.analetsUpdated,
						timestamp: new Date().toISOString()
					});
				}
			}

			// Send detailed result for potential debugging/logging
			await this.sendMessage('sync-configured-cells-result', {
				success: result.success,
				cellsProcessed: result.cellsProcessed,
				analetsUpdated: result.analetsUpdated,
				analetsCreated: result.analetsCreated,
				conflictsResolved: result.conflictsResolved,
				metadataUpdated: result.metadataUpdated,
				errors: result.errors,
				timestamp: new Date().toISOString()
			});

			// Send completion signal for UI state management  
			await this.sendMessage('notebook-sync-complete', {
				success: result.success,
				changedCells: result.cellsProcessed,
				newAnalets: result.analetsCreated,
				updatedAnalets: result.analetsUpdated,
				timestamp: new Date().toISOString()
			});

			this.log('info', 'Completed sync of configured cells', {
				cellsProcessed: result.cellsProcessed,
				analetsUpdated: result.analetsUpdated,
				analetsCreated: result.analetsCreated,
				success: result.success
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('sync-configured-cells', err, data);
			
			// Send completion signal even on error to reset UI state
			await this.sendMessage('notebook-sync-complete', {
				success: false,
				changedCells: 0,
				newAnalets: 0,
				updatedAnalets: 0,
				error: err.message,
				timestamp: new Date().toISOString()
			});
		}
	}

	/**
	 * CORE OPERATION 4: Reconcile notebook metadata
	 * Ensures notebook cell metadata always reflects the current analet state
	 */
	private async handleReconcileNotebookMetadata(data: any): Promise<void> {
		try {
			const validation = this.validateData(data, ['analetId']);
			if (!validation.isValid) {
				throw new Error(validation.error);
			}

			const { analetId } = data;
			this.log('info', 'Reconciling notebook metadata for analet', { analetId });

			const success = await this.syncController.reconcileCellMetadata(analetId);

			await this.sendMessage('reconcile-metadata-result', {
				success,
				analetId,
				message: success 
					? 'Metadata reconciled successfully'
					: 'Failed to reconcile metadata - analet or link not found',
				timestamp: new Date().toISOString()
			});

			this.log('info', 'Completed metadata reconciliation', { 
				analetId, 
				success 
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('reconcile-notebook-metadata', err, data);
		}
	}

	/**
	 * NEW OPERATION: Load notebook hierarchy for frontend display
	 * Lightweight operation that only gathers notebook structure without triggering sync
	 */
	private async handleLoadNotebookHierarchy(data: any): Promise<void> {
		try {
			this.log('info', 'Loading notebook hierarchy');

			// Get notebook hierarchy from sync controller without triggering full sync
			const hierarchyData = await this.syncController.getNotebookHierarchy();

			await this.sendMessage('notebook-hierarchy-loaded', {
				success: true,
				hierarchy: hierarchyData,
				timestamp: new Date().toISOString()
			});

			this.log('info', 'Completed loading notebook hierarchy', { 
				notebookCount: hierarchyData?.notebooks?.length || 0 
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('load-notebook-hierarchy', err, data);
		}
	}

	/**
	 * Try to recover notebook metadata by scanning for existing notebooks that contain the analet
	 */
	private async tryRecoverNotebookMetadata(analetId: number, _analetStatement: string): Promise<any | null> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				return null;
			}

			// Look for .ipynb files in the workspace
			const notebookPattern = new vscode.RelativePattern(workspaceFolder, '**/*.ipynb');
			const notebookFiles = await vscode.workspace.findFiles(notebookPattern);

			for (const notebookUri of notebookFiles) {
				try {
					const notebookContent = await vscode.workspace.fs.readFile(notebookUri);
					const notebookData = JSON.parse(notebookContent.toString());

					// Check if any cell has metadata linking to this analet
					if (notebookData.cells) {
						for (let cellIndex = 0; cellIndex < notebookData.cells.length; cellIndex++) {
							const cell = notebookData.cells[cellIndex];
							const cellMetadata = cell.metadata?.meridian;

							if (cellMetadata?.analetId === analetId) {
								// Found a matching cell!
								return {
									filePath: notebookUri.fsPath,
									notebookPath: notebookUri.fsPath,
									cellId: cellMetadata.cellId,
									cellIndex: cellIndex,
									contentHash: cellMetadata.contentHash
								};
							}
						}
					}
				} catch (parseError) {
					// Skip invalid notebook files
					console.warn('⚠️ [NOTEBOOK-DEBUG] Failed to parse notebook', { 
						path: notebookUri.fsPath, 
						error: parseError 
					});
				}
			}

			return null;
		} catch (error) {
			console.error('❌ [NOTEBOOK-DEBUG] Failed to recover notebook metadata:', error);
			return null;
		}
	}

	/**
	 * Helper method to check if a file exists
	 */
	private async fileExists(filePath: string): Promise<boolean> {
		try {
			const uri = vscode.Uri.file(filePath);
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch (error) {
			return false;
		}
	}

	/**
	 * SYNC CONFIG OPERATION: Load sync modal data
	 * Get notebooks hierarchy with sync status for modal display
	 */
	private async handleLoadSyncModal(data: any): Promise<void> {
		try {
			this.log('info', 'Loading sync modal data');

			// Get notebook hierarchy from sync controller
			const hierarchyData = await this.syncController.getNotebookHierarchy();
			
			// Enhance with sync configuration data
			const enhancedHierarchy = {
				...hierarchyData,
				notebooks: await Promise.all(hierarchyData.notebooks.map(async (notebook: any) => {
					const syncConfigs = this.syncConfigService.getSyncedCellsForNotebook(notebook.path);
					const syncedCellIds = new Set(syncConfigs.map(config => config.cellId));
					
					// Enhance cells with sync status
					const enhancedCells = notebook.cells.map((cell: any) => ({
						...cell,
						isSynced: syncedCellIds.has(cell.cellId),
						syncType: syncConfigs.find(config => config.cellId === cell.cellId)?.syncType || 'manual'
					}));

					return {
						...notebook,
						cells: enhancedCells,
						syncedCellCount: syncConfigs.length
					};
				}))
			};

			// Get sync statistics
			const syncStats = this.syncConfigService.getSyncStats();

			await this.sendMessage('sync-modal-loaded', {
				success: true,
				hierarchy: enhancedHierarchy,
				syncStats,
				timestamp: new Date().toISOString()
			});

			this.log('info', 'Sync modal data loaded successfully', {
				notebookCount: hierarchyData?.notebooks?.length || 0,
				totalSyncedCells: syncStats.syncedCells
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('load-sync-modal', err, data);
		}
	}

	/**
	 * SYNC CONFIG OPERATION: Toggle cell sync status
	 */
	private async handleToggleCellSync(data: any): Promise<void> {
		try {
			const validation = this.validateData(data, ['notebookPath', 'cellId', 'cellIndex']);
			if (!validation.isValid) {
				throw new Error(validation.error);
			}

			const { notebookPath, cellId, cellIndex } = data;
			this.log('info', 'Toggling cell sync', { notebookPath, cellId, cellIndex });

			const newState = await this.syncConfigService.toggleCellSync(
				notebookPath,
				cellId,
				cellIndex
			);

			// Get updated config for response
			const config = this.syncConfigService.getCellSyncConfig(notebookPath, cellId);

			await this.sendMessage('cell-sync-toggled', {
				success: true,
				notebookPath,
				cellId,
				cellIndex,
				isEnabled: newState,
				syncType: config?.syncType || 'manual',
				message: `Cell sync ${newState ? 'enabled' : 'disabled'}`,
				timestamp: new Date().toISOString()
			});

			this.log('info', 'Cell sync toggled successfully', { 
				notebookPath, 
				cellId, 
				newState 
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('toggle-cell-sync', err, data);
		}
	}

	/**
	 * SYNC CONFIG OPERATION: Save bulk sync configuration
	 * Handles saving multiple cell configurations from modal
	 */
	private async handleSaveSyncConfig(data: any): Promise<void> {
		try {
			const validation = this.validateData(data, ['configs']);
			if (!validation.isValid) {
				throw new Error(validation.error);
			}

			const { configs } = data;
			this.log('info', 'Saving bulk sync configuration', { 
				configCount: configs?.length || 0 
			});

			let savedCount = 0;
			let errorCount = 0;

			// Save each configuration
			for (const config of configs) {
				try {
					await this.syncConfigService.setSyncConfig({
						notebookPath: config.notebookPath,
						cellId: config.cellId,
						cellIndex: config.cellIndex,
						isEnabled: config.isEnabled,
						syncType: config.syncType || 'manual',
						lastSyncHash: config.lastSyncHash
					});
					savedCount++;
				} catch (configError) {
					console.error('Failed to save sync config:', configError);
					errorCount++;
				}
			}

			// Get updated statistics
			const syncStats = this.syncConfigService.getSyncStats();

			await this.sendMessage('sync-config-saved', {
				success: errorCount === 0,
				savedCount,
				errorCount,
				totalConfigs: configs.length,
				syncStats,
				message: errorCount === 0 
					? `Saved ${savedCount} sync configurations`
					: `Saved ${savedCount} configurations with ${errorCount} errors`,
				timestamp: new Date().toISOString()
			});

			this.log('info', 'Bulk sync configuration saved', { 
				savedCount, 
				errorCount,
				totalSyncedCells: syncStats.syncedCells
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('save-sync-config', err, data);
		}
	}

	/**
	 * SYNC CONFIG OPERATION: Get sync statistics
	 */
	private async handleGetSyncStats(data: any): Promise<void> {
		try {
			this.log('info', 'Getting sync statistics');

			const syncStats = this.syncConfigService.getSyncStats();
			const syncedNotebookPaths = this.syncConfigService.getSyncedNotebookPaths();

			await this.sendMessage('sync-stats', {
				success: true,
				stats: syncStats,
				syncedNotebooks: syncedNotebookPaths.length,
				syncedNotebookPaths,
				timestamp: new Date().toISOString()
			});

			this.log('info', 'Sync statistics retrieved', {
				totalSyncedCells: syncStats.syncedCells,
				syncedNotebooks: syncedNotebookPaths.length
			});

		} catch (error: any) {
			const err = error instanceof Error ? error : new Error(String(error));
			await this.sendError('get-sync-stats', err, data);
		}
	}
}
