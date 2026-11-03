/**
 * CheckpointMessageHandler - Handles checkpoint/snapshot operations for state management
 *
 * API CONSOLIDATION OPPORTUNITIES:
 * 1. Merge checkpoint operations into single 'checkpoint-operation' endpoint with action parameter
 * 2. Standardize checkpoint metadata format across operations
 * 3. Add bulk checkpoint operations (delete multiple, compare, etc.)
 */

import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { AnaletCheckpointService, BaselineCheckpoint } from '../../AnaletCheckpointService';
import { StateManagementService, WORKSPACE_KEYS, type DatasetInfo } from '../../StateManagementService';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ActiveWorkspaceManager } from '../../ActiveWorkspaceManager';

export class CheckpointMessageHandler extends BaseMessageHandler {

  constructor() {
    super([
      // Unified checkpoint operations
      'checkpoint-operation',

      // Legacy endpoints (deprecated, maintained for compatibility)
      'get-checkpoints',
      'restore-checkpoint',
      'save-checkpoint',
      'restore-checkpoint-file',
      'delete-checkpoint'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'checkpoint-operation':
        await this.handleCheckpointOperation(data);
        break;
      case 'get-checkpoints':
        await this.handleGetCheckpoints(data);
        break;
      case 'restore-checkpoint':
        await this.handleRestoreCheckpoint(data);
        break;
      case 'save-checkpoint':
        await this.handleSaveCheckpoint(data);
        break;
      case 'restore-checkpoint-file':
        await this.handleRestoreCheckpointFile(data);
        break;
      case 'delete-checkpoint':
        await this.handleDeleteCheckpoint(data);
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Unified checkpoint operation handler
   * Consolidates all checkpoint operations into a single, clean API
   */
  private async handleCheckpointOperation(data: any): Promise<void> {
    try {
      const { action, payload } = data;

      switch (action) {
        case 'list':
          return this.performGetCheckpoints(payload);
        case 'save':
          return this.performSaveCheckpoint(payload);
        case 'restore':
          return this.performRestoreCheckpoint(payload);
        case 'delete':
          return this.performDeleteCheckpoint(payload);
        case 'compare':
          return this.performCompareCheckpoints(payload);
        case 'bulk-delete':
          return this.performBulkDeleteCheckpoints(payload);
        default:
          throw new Error(`Unsupported checkpoint action: ${action}`);
      }
    } catch (error) {
      await this.sendMessage('checkpoint-operation-result', {
        success: false,
        action: data?.action,
        error: error instanceof Error ? error.message : 'Checkpoint operation failed'
      });
    }
  }

  /**
   * Get list of available checkpoints
   * CONSOLIDATION: Could be part of unified checkpoint operation
   */
  private async handleGetCheckpoints(data?: any): Promise<void> {
    try {
      this.log('info', 'Getting available checkpoints', {
        includeMetadata: data?.includeMetadata
      });

      const checkpointService = AnaletCheckpointService.getInstance();

      // Get all checkpoints with optional metadata
      const checkpoints = await checkpointService.getCheckpoints();

      // Format checkpoint data for frontend
      const formattedCheckpoints = checkpoints.map(checkpoint => ({
        id: checkpoint.id,
        description: checkpoint.description || `Checkpoint ${checkpoint.id}`,
        createdAt: checkpoint.createdAt,
        analetCount: checkpoint.analetsCount || 0,
        datasetName: checkpoint.datasetName || undefined
      }));

      await this.sendMessage('checkpoints-loaded', {
        success: true,
        checkpoints: formattedCheckpoints,
        totalCount: checkpoints.length
      });

    } catch (error: any) {
      await this.sendError('get-checkpoints', error?.message || error, data);
    }
  }

  /**
   * Restore from a checkpoint
   * CONSOLIDATION: Could be part of unified checkpoint operation with action: 'restore'
   */
  private async handleRestoreCheckpoint(data: any): Promise<void> {
    try {
      const checkpointService = AnaletCheckpointService.getInstance();
      const stateService = this.context?.stateService as StateManagementService;
      if (!stateService) throw new Error('StateService not available');

    const { datasetRoot } = data || {};
    const ctx = stateService.getContext();
    const mgr = ActiveWorkspaceManager.getInstance(ctx);
    const resolvedRoot = datasetRoot || mgr.getActiveRoot();
      if (!resolvedRoot) throw new Error('datasetRoot or datasetSlug is required to restore baseline');

      this.log('info', 'Restoring from baseline', { datasetRoot: resolvedRoot });

      const baseline = await checkpointService.readBaseline(resolvedRoot);
      if (!baseline) throw new Error('Baseline checkpoint not found');

      await this.clearWorkspaceState(stateService);

      const datasetInfo: DatasetInfo = {
        name: baseline.dataset.name || path.basename(baseline.dataset.path),
        rowCount: baseline.dataset.rowCount || 0,
        columnCount: (baseline.dataset.columns || []).length,
        columns: baseline.dataset.columns || [],
        firstTwoRows: [],
        filePath: this.resolveDatasetPath(resolvedRoot, baseline.dataset.path)
      };
      // Attempt to compute and persist profile from CSV path
      try {
        const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
        const summarizer = DatasetSummarizerService.getInstance();
        const profile = await summarizer.analyzeCSVFile(datasetInfo.filePath!);
        const info = summarizer.getDatasetInfo() || datasetInfo;
        await stateService.saveDataset(info as any, profile as any, { source: 'file_path', filePath: datasetInfo.filePath });
        await this.sendMessage('dataset-restored', { success: true, dataset: info, profile, enhanced: true });
      } catch (e) {
        await stateService.saveDataset(datasetInfo, undefined, { source: 'file_path', filePath: datasetInfo.filePath });
        await this.sendMessage('dataset-restored', { success: true, dataset: datasetInfo, enhanced: false });
      }

      if (baseline.dataDefinitions) {
        await stateService.saveDimensions(baseline.dataDefinitions.conceptAxes || [], baseline.dataDefinitions.dimensionMetadata || undefined);
      }

      await stateService.saveAnalets(baseline.analets || []);
      // Keep AnaletStore in sync after restore
      try { await this.context?.analetStore?.loadFromStorage(); } catch {}

      try {
        const ctx = stateService.getContext();
        await ctx.workspaceState.update('analysis-notes', baseline.notes || []);
      } catch {}

      // Restore extended UI/config state for exact view reconstruction
      try { if (baseline.uiState) await stateService.saveUIState(baseline.uiState); } catch {}
      try { if (baseline.activeFilters) await stateService.saveActiveFilters(baseline.activeFilters); } catch {}
      try { if (Array.isArray(baseline.materializedAnaletIds)) await stateService.saveMaterializedAnalets(baseline.materializedAnaletIds, baseline.dataset?.name); } catch {}
      try { if (Array.isArray(baseline.analetConstraints)) await stateService.saveAnaletConstraints(baseline.analetConstraints); } catch {}

      // dataset-restored already sent above with or without profile
      await this.sendMessage('fetch-analet-data', { analets: baseline.analets || [] });
      if (Array.isArray(baseline.materializedAnaletIds)) {
        await this.sendMessage('materialized-analets-loaded', { success: true, materializedIds: baseline.materializedAnaletIds });
      }
      // Restore bearing metrics if present
      try { if ((baseline as any).bearingMetrics) await stateService.setWorkspaceState(WORKSPACE_KEYS.BEARING_METRICS, (baseline as any).bearingMetrics); } catch {}
      try { await this.sendMessage('bearing-metrics-restored', { success: true, bearingMetrics: (baseline as any).bearingMetrics || {} }); } catch {}
      await this.sendMessage('checkpoint-restored', { success: true });

      this.log('info', 'Baseline restoration completed', { itemsRestored: (baseline.analets || []).length });
    } catch (error: any) {
      await this.sendError('restore-checkpoint', error?.message || error, data);
    }
  }

  /**
   * Restore from a specific checkpoint file path (absolute)
   */
  private async handleRestoreCheckpointFile(data: any): Promise<void> {
    try {
      const stateService = this.context?.stateService as StateManagementService;
      if (!stateService) throw new Error('StateService not available');

      const filePath = data?.filePath as string;
      if (!filePath || typeof filePath !== 'string') throw new Error('filePath is required');

      const checkpointService = AnaletCheckpointService.getInstance();
      // Directly read file
      if (!fs.existsSync(filePath)) throw new Error('Checkpoint file not found');
      const content = fs.readFileSync(filePath, 'utf8');
      const checkpoint = JSON.parse(content) as any;

      await this.clearWorkspaceState(stateService);

      // Restore dataset if present
      if (checkpoint?.dataset?.path) {
        const dsPath = checkpoint.dataset.path as string;
        const resolved = path.isAbsolute(dsPath) ? dsPath : path.join(path.dirname(path.dirname(filePath)), dsPath);
        const datasetInfo: DatasetInfo = {
          name: checkpoint.dataset.name || path.basename(resolved, '.csv'),
          rowCount: checkpoint.dataset.rowCount || 0,
          columnCount: (checkpoint.dataset.columns || []).length,
          columns: checkpoint.dataset.columns || [],
          firstTwoRows: [],
          filePath: resolved
        };
        try {
          const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
          const summarizer = DatasetSummarizerService.getInstance();
          const profile = await summarizer.analyzeCSVFile(datasetInfo.filePath!);
          const info = summarizer.getDatasetInfo() || datasetInfo;
          await stateService.saveDataset(info as any, profile as any, { source: 'file_path', filePath: datasetInfo.filePath } as any);
          await this.sendMessage('dataset-restored', { success: true, dataset: info, profile, enhanced: true });
        } catch (e) {
          await stateService.saveDataset(datasetInfo, undefined, { source: 'file_path', filePath: datasetInfo.filePath } as any);
          await this.sendMessage('dataset-restored', { success: true, dataset: datasetInfo, enhanced: false });
        }
      }

      if (checkpoint.dataDefinitions) {
        await stateService.saveDimensions(checkpoint.dataDefinitions.conceptAxes || [], checkpoint.dataDefinitions.dimensionMetadata || undefined);
      }

      await stateService.saveAnalets(checkpoint.analets || []);
      // Keep AnaletStore in sync after restore
      try { await this.context?.analetStore?.loadFromStorage(); } catch {}

      try {
        const ctx = stateService.getContext();
        await ctx.workspaceState.update('analysis-notes', checkpoint.notes || []);
      } catch {}

      // Restore extended UI/config state for exact view reconstruction
      try { if (checkpoint.uiState) await stateService.saveUIState(checkpoint.uiState); } catch {}
      try { if (checkpoint.activeFilters) await stateService.saveActiveFilters(checkpoint.activeFilters); } catch {}
      try { if (Array.isArray(checkpoint.materializedAnaletIds)) await stateService.saveMaterializedAnalets(checkpoint.materializedAnaletIds, checkpoint.dataset?.name); } catch {}
      try { if (Array.isArray(checkpoint.analetConstraints)) await stateService.saveAnaletConstraints(checkpoint.analetConstraints); } catch {}

      // dataset-restored already sent above with or without profile
      await this.sendMessage('fetch-analet-data', { analets: checkpoint.analets || [] });
      if (Array.isArray(checkpoint.materializedAnaletIds)) {
        await this.sendMessage('materialized-analets-loaded', { success: true, materializedIds: checkpoint.materializedAnaletIds });
      }
      await this.sendMessage('checkpoint-restored', { success: true });
    } catch (error: any) {
      await this.sendError('restore-checkpoint-file', error?.message || error, data);
    }
  }

  /**
   * Save current state as checkpoint
   * CONSOLIDATION: Could be part of unified checkpoint operation with action: 'save'
   */
  private async handleSaveCheckpoint(data: any = {}): Promise<void> {
    try {
      const stateService = this.context?.stateService as StateManagementService;
      if (!stateService) throw new Error('StateService not available');

    const { datasetRoot } = data || {};
    const ctx = stateService.getContext();
    const mgr = ActiveWorkspaceManager.getInstance(ctx);
    const resolvedRoot = datasetRoot || mgr.getActiveRoot();
      if (!resolvedRoot) throw new Error('datasetRoot or datasetSlug is required to save baseline');

      const checkpointService = AnaletCheckpointService.getInstance();

      const [analets, dims, dimMeta, dataset, uiState, activeFilters, materializedIds, analetConstraints, bearingMetrics] = await Promise.all([
        stateService.getAnalets(),
        stateService.loadDimensions(),
        stateService.getDimensionMetadata(),
        stateService.loadDataset(),
        stateService.loadUIState(),
        stateService.loadActiveFilters(),
        stateService.loadMaterializedAnalets(),
        stateService.loadAnaletConstraints(),
        stateService.getWorkspaceState(WORKSPACE_KEYS.BEARING_METRICS)
      ]);

      const baseline: BaselineCheckpoint = {
        version: 1,
        createdAt: new Date().toISOString(),
        dataset: {
          path: dataset?.metadata?.filePath || dataset?.metadata?.absoluteFilePath || dataset?.datasetInfo?.filePath || dataset?.datasetInfo?.name || '',
          name: dataset?.datasetInfo?.name,
          rowCount: dataset?.datasetInfo?.rowCount,
          columns: dataset?.datasetInfo?.columns
        },
        dataDefinitions: {
          conceptAxes: dims || undefined,
          dimensionMetadata: dimMeta || undefined
        },
        analets: analets || [],
        notes: (await stateService.getContext().workspaceState.get('analysis-notes')) as any[] || [],
        // Extended state for exact restoration
        uiState: uiState || null,
        activeFilters: activeFilters || null,
        materializedAnaletIds: materializedIds || [],
        analetConstraints: analetConstraints || [],
        bearingMetrics: bearingMetrics || {}
      };

      await checkpointService.writeBaseline(resolvedRoot, baseline);

      await this.sendMessage('checkpoint-saved', { success: true });
      this.log('info', 'Baseline saved successfully', { datasetRoot: resolvedRoot });
    } catch (error: any) {
      await this.sendError('save-checkpoint', error?.message || error, data);
    }
  }

  /**
   * Delete a checkpoint
   * CONSOLIDATION: Could be part of unified checkpoint operation with action: 'delete'
   */
  private async handleDeleteCheckpoint(data: any): Promise<void> {
    try {
      const validation = this.validateData(data, ['checkpointId']);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { checkpointId } = data;
      this.log('info', 'Deleting checkpoint', { checkpointId });

      const checkpointService = AnaletCheckpointService.getInstance();

      // Validate checkpoint exists
      // Delete checkpoint (throws if missing)
      await checkpointService.deleteCheckpoint(checkpointId);

      await this.sendMessage('checkpoint-deleted', {
        success: true,
        checkpointId,
        description: `Deleted checkpoint ${checkpointId}`
      });

      this.log('info', 'Checkpoint deleted successfully', { checkpointId });

    } catch (error: any) {
      await this.sendError('delete-checkpoint', error?.message || error, data);
    }
  }


  // UNIFIED OPERATIONS: Simplified, consistent response methods
  private async performGetCheckpoints(payload: any) {
    const { datasetRoot } = payload || {};
    const svc = AnaletCheckpointService.getInstance();
    const ctx = this.context?.stateService?.getContext();
    const mgr = ActiveWorkspaceManager.getInstance(ctx);
    const resolvedRoot = datasetRoot || mgr.getActiveRoot();
    const exists = resolvedRoot ? fs.existsSync(svc.getBaselinePath(resolvedRoot)) : false;
    await this.sendMessage('checkpoint-operation-result', {
      success: true,
      action: 'list',
      data: { checkpoints: exists ? [{ id: 'baseline', description: 'Dataset baseline' }] : [] }
    });
  }

  private async performSaveCheckpoint(payload: any) {
    return this.handleSaveCheckpoint(payload);
  }

  private async performRestoreCheckpoint(payload: any) {
    return this.handleRestoreCheckpoint(payload);
  }

  private async performDeleteCheckpoint(payload: any) {
    // Delegate to legacy method for now
    return this.handleDeleteCheckpoint(payload);
  }

  private async performCompareCheckpoints(payload: any) {
    // Not implemented in service yet
    await this.sendMessage('checkpoint-operation-result', {
      success: false,
      action: 'compare',
      error: 'Compare operation not yet implemented'
    });
  }

  private async performBulkDeleteCheckpoints(payload: any) {
    const checkpointService = AnaletCheckpointService.getInstance();
    const results = [];

    for (const checkpointId of payload.checkpointIds) {
      try {
        await checkpointService.deleteCheckpoint(checkpointId);
        results.push({ checkpointId, success: true });
      } catch (error) {
        results.push({
          checkpointId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    await this.sendMessage('checkpoint-operation-result', {
      success: true,
      action: 'bulk-delete',
      data: { results }
    });
  }

  // Helpers
  private async clearWorkspaceState(stateService: StateManagementService): Promise<void> {
    const ctx = stateService.getContext();
    const keys = Object.values(WORKSPACE_KEYS);
    for (const key of keys) {
      try { await ctx.workspaceState.update(key, undefined); } catch {}
    }
    try { await ctx.workspaceState.update('analysis-notes', undefined); } catch {}
  }

  private resolveDatasetPath(datasetRoot: string, datasetPath: string): string {
    if (path.isAbsolute(datasetPath)) return datasetPath;
    return path.join(datasetRoot, datasetPath);
  }
}
