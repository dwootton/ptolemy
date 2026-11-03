/**
 * SystemMessageHandler - Handles system-level operations like purge, telemetry, and cancellation
 */

import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { CentralizedStorageManager } from '../../CentralizedStorageManager';
import { TelemetryService } from '../../TelemetryService';
import * as fs from 'fs';
import * as path from 'path';
import { ActiveWorkspaceManager } from '../../ActiveWorkspaceManager';

export class SystemMessageHandler extends BaseMessageHandler {
  private activeOperations = new Map<string, any>();
  private cancelledOperations = new Set<string>();
  private activePurgeOperation = false;

  constructor() {
    super([
      'purge-all-data',
      'purge-data',
      'cancel-all-operations',
      'telemetry-event',
      'track-activity',
      'rrweb-event',
      'instrumentation-event',
      'set-instrumentation-enabled',
      'get-instrumentation-status',
      'frontend-storage-purged',
      'ready',
      'webview-initialized',
      'error',
      'study-context-update',
      'study-finish-condition',
      'save-participant-id',
      'load-participant-id'
      ,
      'set-study-mode',
      'get-study-mode-status'
      ,
      'debug:list-message-types'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'purge-all-data':
      case 'purge-data':
        await this.handlePurgeData(data);
        break;
      case 'cancel-all-operations':
        await this.handleCancelAllOperations(data);
        break;
      case 'telemetry-event':
        await this.handleTelemetryEvent(data);
        break;
      case 'track-activity':
        await this.handleTrackActivity(data);
        break;
      case 'rrweb-event':
        await this.handleRRWebEvent(data);
        break;
      case 'instrumentation-event':
        await this.handleInstrumentationEvent(data);
        break;
      case 'set-instrumentation-enabled':
        await this.handleSetInstrumentationEnabled(data);
        break;
      case 'get-instrumentation-status':
        await this.handleGetInstrumentationStatus(data);
        break;
      case 'frontend-storage-purged':
        await this.handleFrontendStoragePurged(data);
        break;
      case 'ready':
        await this.handleReady();
        break;
      case 'webview-initialized':
        await this.handleWebviewInitialized();
        break;
      case 'error':
        await this.handleError(data);
        break;
      case 'study-context-update':
        await this.handleStudyContextUpdate(data);
        break;
      case 'study-finish-condition':
        await this.handleStudyFinishCondition(data);
        break;
      case 'save-participant-id':
        await this.handleSaveParticipantId(data);
        break;
      case 'load-participant-id':
        await this.handleLoadParticipantId(data);
        break;
      case 'set-study-mode':
        await this.handleSetStudyMode(data);
        break;
      case 'get-study-mode-status':
        await this.handleGetStudyModeStatus();
        break;
      case 'debug:list-message-types':
        await this.handleListMessageTypes();
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Handle purge data operations
   */
  private async handlePurgeData(data: any): Promise<void> {
    if (this.activePurgeOperation) {
      this.log('warn', 'Purge operation already in progress, ignoring request');
      return;
    }

    try {
      this.activePurgeOperation = true;
      this.log('info', 'Starting data purge operation', { emergency: data?.emergency });

      // Flush telemetry locally and to Firebase before any destructive operation
      try {
        if (this.context?.telemetryService) {
          const telemetryService = this.context.telemetryService as TelemetryService;
          await telemetryService.flushAll();
          this.log('info', 'Flushed telemetry before purge');
        }
      } catch (error) {
        this.log('warn', 'Failed to flush telemetry before purge', error);
      }

      // Cancel all active operations first
      await this.cancelAllOperationsInternal();

      // Clear state service data
      if (this.context?.stateService) {
        this.context.stateService.clearAllData();
        this.log('info', 'Cleared StateService data');
      }

      // Clear analet store
      if (this.context?.analetStore) {
        await this.context.analetStore.clearAll();
        this.log('info', 'Cleared AnaletStore data');
      }

      // Clear hierarchy edges
      try {
        await this.sendMessage('edges-clear', {});
        this.log('info', 'Cleared hierarchy edges');
      } catch (error) {
        this.log('warn', 'Failed to clear hierarchy edges', error);
      }

      // Clear analysis notes
      try {
        await this.sendMessage('clear-all-notes', {});
        this.log('info', 'Cleared analysis notes');
      } catch (error) {
        console.error('❌ [SystemMessageHandler] Failed to clear analysis notes:', error);
        this.log('warn', 'Failed to clear analysis notes', error);
      }

      // Clear centralized storage (ensure manager is initialized with context)
      const storageManager = CentralizedStorageManager.getInstance(this.context?.stateService?.getContext?.());
      
      if (data?.emergency) {
        this.log('info', 'Performing emergency storage cleanup');
        await storageManager.emergencyCleanup();
      }
      
      await storageManager.purgeAllStorage();

      // Also rename any auto-load checkpoints so they won't auto-load next time
      try {
        const ctx = this.context?.stateService?.getContext();
        const mgr = ActiveWorkspaceManager.getInstance(ctx);
        const root = mgr.getActiveRoot();
        const ckDir = require('path').join(root, '.meridian', 'checkpoints');
        const fs = require('fs');
        if (fs.existsSync(ckDir)) {
          for (const name of fs.readdirSync(ckDir)) {
            if (name.startsWith('load_') && name.endsWith('.json')) {
              const oldPath = require('path').join(ckDir, name);
              const newPath = require('path').join(ckDir, name.replace(/^load_/, 'checkpoint_'));
              try { fs.renameSync(oldPath, newPath); } catch {}
            }
          }
        }
      } catch (e) {
        this.log('warn', 'Failed to rename load_ checkpoints during purge', e);
      }
      // Explicitly ask webview to purge its storage to avoid relying on state flags
      await this.sendMessage('purge-frontend-storage', { emergency: !!data?.emergency });
      this.log('info', 'Completed centralized storage purge');

      // Clear operation tracking
      this.activeOperations.clear();
      this.cancelledOperations.clear();

      await this.sendMessage('purge-data-response', {
        success: true,
        message: 'All data purged successfully'
      });

    } catch (error: any) {
      const errMsg = error instanceof Error ? error : new Error(String(error));
      this.log('error', 'Failed to purge data', errMsg);
      await this.sendError('purge-data', errMsg, data);
    } finally {
      this.activePurgeOperation = false;
    }
  }

  /**
   * Cancel all active operations
   */
  private async handleCancelAllOperations(data: any): Promise<void> {
    try {
      this.log('info', 'Cancelling all active operations', { 
        reason: data?.reason,
        activeCount: this.activeOperations.size 
      });

      await this.cancelAllOperationsInternal();

      await this.sendMessage('cancel-operations-response', {
        success: true,
        cancelledCount: this.cancelledOperations.size
      });

    } catch (error: any) {
      const errMsg = error instanceof Error ? error : new Error(String(error));
      await this.sendError('cancel-all-operations', errMsg, data);
    }
  }

  /**
   * Internal method to cancel all operations
   */
  private async cancelAllOperationsInternal(): Promise<void> {
    // Cancel all tracked operations
    for (const [operationId, operation] of this.activeOperations) {
      try {
        if (operation.abortController) {
          operation.abortController.abort();
        }
        this.cancelledOperations.add(operationId);
        this.log('info', `Cancelled operation: ${operationId}`);
      } catch (error: any) {
        const errMsg = error instanceof Error ? error : new Error(String(error));
        this.log('error', `Failed to cancel operation ${operationId}`, errMsg);
      }
    }

    this.activeOperations.clear();
  }

  /**
   * Handle telemetry events
   */
  private async handleTelemetryEvent(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) {
        this.log('warn', 'Telemetry service not available');
        return;
      }

      const telemetryService = this.context.telemetryService as TelemetryService;

      // Be lenient: record even if fields are missing to avoid crashing init flows
      const eventType = typeof data?.event === 'string' && data.event.length > 0 ? data.event : 'unknown_event';
      const payload = (data && typeof data === 'object') ? (data.properties ?? data) : {};

      await telemetryService.recordTelemetryEvent(eventType, payload);
      this.log('info', 'Tracked telemetry event', { event: data.event });

    } catch (error) {
      this.log('error', 'Failed to track telemetry event', error);
      // Don't send error response for telemetry failures
    }
  }

  /**
   * Handle activity tracking
   */
  private async handleTrackActivity(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) {
        this.log('warn', 'Telemetry service not available for activity tracking');
        return;
      }

      const telemetryService = this.context.telemetryService as TelemetryService;
      
      // Track user activity
      await telemetryService.recordTelemetryEvent(data?.activity || 'unknown', data?.metadata);
      this.log('info', 'Tracked user activity', { activity: data?.activity });

    } catch (error) {
      this.log('error', 'Failed to track activity', error);
    }
  }

  /**
   * Handle RRWeb events for session recording
   */
  private async handleRRWebEvent(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) {
        this.log('warn', 'Telemetry service not available for RRWeb events');
        return;
      }

      const telemetryService = this.context.telemetryService as TelemetryService;
      
      // Process RRWeb event
      await telemetryService.recordRRWebEvent(data);
      
      // Don't log individual RRWeb events as they're frequent
      
    } catch (error) {
      this.log('error', 'Failed to process RRWeb event', error);
    }
  }

  /**
   * Handle study context updates from webview (participant/dataset/condition)
   */
  private async handleStudyContextUpdate(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) {
        this.log('warn', 'Telemetry service not available for study context update');
        return;
      }
      const telemetryService = this.context.telemetryService as TelemetryService;
      telemetryService.setStudyContext({
        isStudyMode: !!data?.isStudyMode,
        participantId: typeof data?.participantId === 'number' ? data.participantId : undefined,
        datasetSlug: data?.datasetSlug,
        conditionCode: data?.conditionCode
      });
      this.log('info', 'Study context updated', {
        isStudyMode: !!data?.isStudyMode,
        participantId: data?.participantId,
        datasetSlug: data?.datasetSlug,
        conditionCode: data?.conditionCode
      });
      await this.sendMessage('study-context-ack', { success: true });
    } catch (error) {
      this.log('error', 'Failed to handle study context update', error);
    }
  }

  /**
   * Handle finishing a condition: advance condition code, rotate state/logs
   */
  private async handleStudyFinishCondition(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) return;
      const telemetryService = this.context.telemetryService as TelemetryService;
      // Rotate session immediately to a new file set
      telemetryService.restartSession();
      await this.sendMessage('study-finish-ack', { success: true });
    } catch (error) {
      this.log('error', 'Failed to finish study condition', error);
      await this.sendMessage('study-finish-ack', { success: false, error: String(error) });
    }
  }

  /**
   * Handle saving participant ID to workspace settings
   */
  private async handleSaveParticipantId(data: any): Promise<void> {
    try {
      if (!this.context?.stateService) {
        this.log('warn', 'StateService not available for saving participant ID');
        return;
      }

      const participantId = data?.participantId;
      if (typeof participantId !== 'number' || participantId < 1) {
        throw new Error('Invalid participant ID');
      }

      // Save to workspace state via StateService context
      const extensionContext = this.context.stateService.getContext();
      await extensionContext.workspaceState.update('meridian.participantId', participantId);
      
      this.log('info', 'Participant ID saved to workspace', { participantId });
      await this.sendMessage('participant-id-saved', { success: true, participantId });

    } catch (error) {
      this.log('error', 'Failed to save participant ID', error);
      await this.sendMessage('participant-id-saved', { success: false, error: String(error) });
    }
  }

  /**
   * Handle loading participant ID from workspace settings
   */
  private async handleLoadParticipantId(data: any): Promise<void> {
    try {
      if (!this.context?.stateService) {
        this.log('warn', 'StateService not available for loading participant ID');
        await this.sendMessage('participant-id-loaded', { success: false, participantId: null });
        return;
      }

      const extensionContext = this.context.stateService.getContext();
      const participantId = extensionContext.workspaceState.get<number>('meridian.participantId');
      
      this.log('info', 'Participant ID loaded from workspace', { participantId });
      await this.sendMessage('participant-id-loaded', { 
        success: true, 
        participantId: participantId || null 
      });

    } catch (error) {
      this.log('error', 'Failed to load participant ID', error);
      await this.sendMessage('participant-id-loaded', { success: false, participantId: null });
    }
  }

  /**
   * Toggle Study Mode via runtime override and optional reload
   */
  private async handleSetStudyMode(data: any): Promise<void> {
    try {
      const enabled = data?.enabled === true;
      const reload = data?.reload === true;
      const context = this.context?.stateService?.getContext();
      const cfg = context ? context.workspaceState : undefined;

      // Persist VS Code configuration override so FeatureFlags picks it up on next activation
      const settings = require('vscode').workspace.getConfiguration('meridian');
      // New model: default is enabled; disable flag explicitly when enabled=false
      await settings.update('disableStudyMode', !enabled, require('vscode').ConfigurationTarget.Workspace);
      // Clean up legacy key if present
      try { await settings.update('studyModeOverride', undefined, require('vscode').ConfigurationTarget.Workspace); } catch {}

      // Reply first so UI shows success
      await this.sendMessage('set-study-mode:result', { success: true, enabled });

      // Optional: reload window to apply handler registration and UI changes
      if (reload) {
        try {
          await require('vscode').commands.executeCommand('workbench.action.reloadWindow');
        } catch (e) {
          this.log('warn', 'Failed to trigger reloadWindow; ask user to reload manually', e);
        }
      }
    } catch (error) {
      this.log('error', 'Failed to set study mode', error);
      await this.sendMessage('set-study-mode:result', { success: false, error: String(error) });
    }
  }

  /**
   * Report current Study Mode status from settings
   */
  private async handleGetStudyModeStatus(): Promise<void> {
    try {
      const settings = require('vscode').workspace.getConfiguration('meridian');
      const enabled = settings.get('studyModeOverride', false) === true;
      await this.sendMessage('get-study-mode-status:result', { success: true, enabled });
    } catch (error) {
      this.log('error', 'Failed to get study mode status', error);
      await this.sendMessage('get-study-mode-status:result', { success: false, enabled: false });
    }
  }

  /**
   * Debug: list supported message types registered in the router
   */
  private async handleListMessageTypes(): Promise<void> {
    try {
      const types = this.context?.messageRouter?.getSupportedMessageTypes?.() || [];
      await this.sendMessage('debug:list-message-types:result', { success: true, types });
    } catch (error) {
      this.log('error', 'Failed to list message types', error);
      await this.sendMessage('debug:list-message-types:result', { success: false, error: String(error), types: [] });
    }
  }

  /**
   * Handle instrumentation events
   */
  private async handleInstrumentationEvent(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) {
        this.log('warn', 'Telemetry service not available for instrumentation events');
        return;
      }

      const telemetryService = this.context.telemetryService as TelemetryService;
      
      // Process instrumentation event
      await telemetryService.recordInstrumentationEvent(data);
      
    } catch (error) {
      this.log('error', 'Failed to process instrumentation event', error);
    }
  }

  /**
   * Handle setting instrumentation enabled/disabled
   */
  private async handleSetInstrumentationEnabled(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) {
        this.log('warn', 'Telemetry service not available for instrumentation control');
        return;
      }

      const telemetryService = this.context.telemetryService as TelemetryService;
      const enabled = data?.enabled === true;
      
      telemetryService.setInstrumentationEnabled(enabled);
      this.log('info', `Instrumentation ${enabled ? 'enabled' : 'disabled'}`);
      
      // Send response back to webview
      await this.sendMessage('instrumentation-status-changed', { enabled });
      
    } catch (error) {
      this.log('error', 'Failed to set instrumentation status', error);
    }
  }

  /**
   * Handle getting instrumentation status
   */
  private async handleGetInstrumentationStatus(data: any): Promise<void> {
    try {
      if (!this.context?.telemetryService) {
        this.log('warn', 'Telemetry service not available for instrumentation status');
        return;
      }

      const telemetryService = this.context.telemetryService as TelemetryService;
      const enabled = telemetryService.isInstrumentationActive();
      
      // Send response back to webview
      await this.sendMessage('instrumentation-status', { enabled });
      
    } catch (error) {
      this.log('error', 'Failed to get instrumentation status', error);
    }
  }

  /**
   * Handle frontend storage purged notification
   */
  private async handleFrontendStoragePurged(data: any): Promise<void> {
    try {
      this.log('info', 'Frontend storage purged notification received');
      
      // Acknowledge the purge
      await this.sendMessage('frontend-purge-acknowledged', {
        success: true,
        timestamp: Date.now()
      });

    } catch (error) {
      this.log('error', 'Failed to handle frontend storage purged', error);
    }
  }

  /**
   * Handle webview ready signal
   */
  private async handleReady(): Promise<void> {
    try {
      this.log('info', 'Webview ready signal received');
      await this.sendMessage('extension-ready', {
        timestamp: Date.now(),
        version: '1.0' // TODO: Get from package.json
      });
    } catch (error) {
      this.log('error', 'Failed to handle ready signal', error);
    }
  }

  /**
   * Handle webview initialization
   */
  private async handleWebviewInitialized(): Promise<void> {
    try {
      this.log('info', 'Webview initialized');
      // Send extension-ready immediately to prevent UI freeze
      await this.sendMessage('extension-ready', {
        timestamp: Date.now(),
        initialized: true
      });
      
      // If active workspace appears to be a .user-study dataset folder but has no study.json,
      // proactively instruct the frontend to purge its storage so nothing restores.
      try {
        const ctx = this.context?.stateService?.getContext();
        const mgr = ActiveWorkspaceManager.getInstance(ctx);
        const root = mgr.getActiveRoot();
        const isUserStudy = root.includes(`${path.sep}.user-study${path.sep}`) || root.includes(`${path.sep}.user_study${path.sep}`);
        if (isUserStudy) {
          const studyAtRoot = path.join(root, 'study.json');
          const studyInDot = path.join(root, '.meridian', 'study.json');
          const hasStudy = fs.existsSync(studyAtRoot) || fs.existsSync(studyInDot);
          if (!hasStudy) {
            this.log('info', 'No study.json detected in user-study workspace; purging frontend storage');
            await this.sendMessage('purge-frontend-storage', { emergency: false, reason: 'missing-study-json' });
          }
        }
      } catch (e) {
        this.log('warn', 'Failed user-study missing study.json check', e);
      }
      
      // Perform heavy operations asynchronously without blocking
      setImmediate(async () => {
        try {
          this.log('info', 'Starting background initialization tasks...');
          // Restore state if available
          if (this.context?.stateService) {
            await this.restoreApplicationState();
          }
          
          this.log('info', 'Background initialization completed');
        } catch (error) {
          this.log('error', 'Error during background initialization', error);
        }
      });

    } catch (error) {
      this.log('error', 'Failed to handle webview initialization', error);
    }
  }

  /**
   * Handle error messages from frontend
   */
  private async handleError(data: any): Promise<void> {
    try {
      this.log('error', 'Frontend error received', {
        message: data?.message,
        stack: data?.stack,
        context: data?.context
      });

      // Track error in telemetry if available
      if (this.context?.telemetryService) {
        const telemetryService = this.context.telemetryService as TelemetryService;
        await telemetryService.recordTelemetryEvent('frontend_error', {
          message: data?.message || 'Unknown error',
          context: data?.context || 'unknown',
          timestamp: Date.now()
        });
      }

    } catch (error) {
      this.log('error', 'Failed to handle frontend error', error);
    }
  }

  /**
   * Restore application state on initialization
   */
  private async restoreApplicationState(): Promise<void> {
    try {
      if (!this.context?.stateService) {
        return;
      }

      const stateService = this.context.stateService;
      
      // Restore dataset state
      const dataset = await stateService.loadDataset();
      if (dataset?.datasetInfo) {
        try {
          console.log('[dataset-bug][extension] restoreApplicationState.loadDataset', {
            name: dataset.datasetInfo?.name,
            hasSavedProfile: !!dataset.datasetProfile,
            savedProfileCols: (dataset as any)?.datasetProfile?.columns?.length,
          });
        } catch {}
        // Try to rehydrate summarizer with saved profile and file path
        let profile = dataset.datasetProfile || null;
        try {
          const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
          const summarizerService = DatasetSummarizerService.getInstance();
          if (dataset.datasetProfile) {
            summarizerService.setDatasetWithProfile(dataset.datasetInfo, dataset.datasetProfile as any);
          } else {
            summarizerService.setDataset(dataset.datasetInfo);
          }
          const fp = (dataset.metadata as any)?.absoluteFilePath || (dataset.metadata as any)?.filePath;
          if (fp) {
            summarizerService.setCSVFilePath(fp);
          }
          if (!profile) {
            profile = summarizerService.getDatasetProfile();
          }
        } catch (error) {
          console.warn('⚠️ [SystemMessageHandler] Could not rehydrate dataset profile during restoration:', error);
        }

        // If still no profile but we have an absolute file path, compute it now and persist
        try {
          if (!profile) {
            const abs = (dataset.metadata as any)?.absoluteFilePath as string | undefined;
            if (abs && typeof abs === 'string') {
              const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
              const summarizerService = DatasetSummarizerService.getInstance();
              const computed = await summarizerService.analyzeCSVFile(abs);
              profile = computed;
              const info = summarizerService.getDatasetInfo() || dataset.datasetInfo;
              await stateService.saveDataset(info as any, computed as any, { ...(dataset.metadata as any), filePath: abs, absoluteFilePath: abs } as any);
            }
          }
        } catch (e) {
          this.log('warn', 'Failed to compute missing profile during restoration', e);
        }

        await this.sendMessage('dataset-restored', {
          success: true,
          dataset: dataset.datasetInfo,
          profile: profile, // Include profile if available
          enhanced: !!profile // Flag to indicate if enhanced profile is available
        });
        if (profile) {
          await this.sendMessage('dataset-profile', { profile, enhanced: true });
        }
        try {
          console.log('[dataset-bug][extension] dataset-restored (restoreApplicationState)', {
            name: dataset.datasetInfo?.name,
            sentProfile: !!profile,
            savedProfileExisted: !!dataset.datasetProfile,
          });
        } catch {}
        this.log('info', 'Restored dataset state', { 
          name: dataset.datasetInfo.name,
          hasProfile: !!profile,
          profileColumns: profile?.columns?.length 
        });
      }

      // Restore hierarchy state
      const hierarchyState = await stateService.loadHierarchyState();
      if (hierarchyState) {
        await this.sendMessage('hierarchy-state-restored', {
          success: true,
          hierarchyState,
          detectedClusters: await stateService.loadDetectedClusters(),
          selectedFolderName: await stateService.loadSelectedFolder()
        });
        this.log('info', 'Restored hierarchy state');
      }

      // Restore analets state
      if (this.context?.analetStore) {
        await this.context.analetStore.loadFromStorage();
        const analets = await this.context.analetStore.getAllAnalets();
        if (analets.length > 0) {
          await this.sendMessage('analets-restored', {
            success: true,
            analets,
            count: analets.length
          });
          this.log('info', 'Restored analets state', { count: analets.length });
        }
      }

    } catch (error) {
      this.log('error', 'Failed to restore application state', error);
    }
  }

  /**
   * Track an operation for cancellation
   */
  public trackOperation(id: string, type: string, abortController?: AbortController): void {
    this.activeOperations.set(id, {
      id,
      type,
      startTime: Date.now(),
      abortController
    });
    
    this.log('info', `Tracking operation: ${id} (${type})`);
  }

  /**
   * Complete an operation
   */
  public completeOperation(id: string): void {
    if (this.activeOperations.has(id)) {
      this.activeOperations.delete(id);
      this.log('info', `Completed operation: ${id}`);
    }
  }

  /**
   * Check if an operation was cancelled
   */
  public isOperationCancelled(id: string): boolean {
    return this.cancelledOperations.has(id);
  }

  public dispose(): void {
    super.dispose();
    
    // Cancel all operations
    this.cancelAllOperationsInternal().catch(error => {
      this.log('error', 'Error cancelling operations during disposal', error);
    });
  }
}
