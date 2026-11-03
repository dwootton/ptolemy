import * as vscode from 'vscode';
import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { StudyApplicationController } from '../../StudyApplicationController';
import { TelemetryService } from '../../TelemetryService';
import { ActiveWorkspaceManager } from '../../ActiveWorkspaceManager';
import { AnaletCheckpointService } from '../../AnaletCheckpointService';

export class StudyApplicationMessageHandler extends BaseMessageHandler {
  private initializedStudyController?: StudyApplicationController;

  private get studyController(): StudyApplicationController {
    if (!this.initializedStudyController) {
      throw new Error('StudyApplicationMessageHandler is not initialized');
    }
    return this.initializedStudyController;
  }
  private isAdvancing: boolean = false;

  constructor() {
    super([
      'study:initialize',
      'study:initialize-with-code',
      'study:get-current-config',
      'study:get-progress',
      'study:get-restore-info',
      'study:restore-session',
      'study:advance-stage',
      'study:goto-stage',
      'study:switch-workspace',
      'study:finish-condition',
      'study:reset',
      'study:export-config'
    ]);
  }

  public async initialize(context: MessageContext): Promise<void> {
    await super.initialize(context);
    if (!context.stateService) {
      throw new Error('StateService is required for StudyApplicationMessageHandler');
    }
    this.initializedStudyController = StudyApplicationController.getInstance(context.stateService.getContext());
    this.log('info', 'Initialized StudyApplicationMessageHandler');
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'study:initialize':
        await this.handleInitializeStudy(data);
        break;
      case 'study:initialize-with-code':
        await this.handleInitializeStudyWithCode(data);
        break;
      case 'study:get-current-config':
        await this.handleGetCurrentConfig();
        break;
      case 'study:get-progress':
        await this.handleGetProgress();
        break;
      case 'study:get-restore-info':
        await this.handleGetRestoreInfo();
        break;
      case 'study:restore-session':
        await this.handleRestoreSession();
        break;
      case 'study:advance-stage':
        await this.handleAdvanceStage();
        break;
      case 'study:goto-stage':
        await this.handleGotoStage(data);
        break;
      case 'study:switch-workspace':
        await this.handleSwitchWorkspace();
        break;
      case 'study:finish-condition':
        await this.handleFinishCondition();
        break;
      case 'study:reset':
        await this.handleResetStudy();
        break;
      case 'study:export-config':
        await this.handleExportConfig(data);
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  /**
   * Jump to a specific study stage index (0-based)
   */
  private async handleGotoStage(data: any): Promise<void> {
    try {
      const tStart = Date.now();
      console.log('[StudyNext][extension] goto-stage: start', { index: typeof data?.index === 'number' ? data.index : data?.index, now: tStart });
      const index = typeof data?.index === 'number' ? data.index : NaN;
      if (!Number.isFinite(index)) {
        await this.sendMessage('study:goto-stage:result', { success: false, error: 'Invalid stage index' });
        return;
      }

      // Before leaving current stage, create a 'load_' checkpoint so returning restores state
      try {
        if (this.context?.stateService) {
          const stateService = this.context.stateService;
          const ctx = stateService.getContext();
          const mgr = ActiveWorkspaceManager.getInstance(ctx);
          const root = mgr.getActiveRoot();
          const checkpointService = AnaletCheckpointService.getInstance();
          await checkpointService.initialize(root);
          const cp = await checkpointService.createCheckpointFromState(stateService, 'Auto-checkpoint before goto-stage');
          const dir = require('path').join(root, '.meridian', 'checkpoints');
          const fs = require('fs');
          const oldPath = require('path').join(dir, `${cp.id}.json`);
          const newPath = require('path').join(dir, `load_${cp.id}.json`);
          try { fs.renameSync(oldPath, newPath); } catch {}
        }
      } catch (e) {
        this.log('warn', 'Failed to create pre-goto checkpoint', e);
      }

      // Purge current state similarly to advance to avoid carryover
      try {
        const stateService = this.context?.stateService;
        const telemetry = this.context?.telemetryService as TelemetryService | undefined;
        if (telemetry) await telemetry.flushAll();
        if (stateService) {
          stateService.clearAllData();
          if (this.context?.analetStore) {
            await this.context.analetStore.clearAll();
          }
        }
        await this.sendMessage('purge-frontend-storage', { emergency: false });
      } catch {}

      console.log('[StudyNext][extension] goto-stage: state purged', { tookMs: Date.now() - tStart });

      const setResult = await this.studyController.gotoStage(index);
      if (!setResult.success) {
        await this.sendMessage('study:goto-stage:result', setResult);
        return;
      }
      console.log('[StudyNext][extension] goto-stage: controller set stage', { tookMs: Date.now() - tStart });

      // Switch workspace for task stages
      const switchResult = await this.studyController.switchToCurrentStageWorkspace();
      if (!switchResult.success) {
        await this.sendMessage('study:goto-stage:result', switchResult);
        return;
      }
      console.log('[StudyNext][extension] goto-stage: workspace switched', { tookMs: Date.now() - tStart });

      const currentStage = this.studyController.getCurrentStage();
      const progress = this.studyController.getProgressInfo();

      // Notify workspace switched
      try {
        const ctx = this.context?.stateService?.getContext();
        const mgr = ActiveWorkspaceManager.getInstance(ctx);
        const path = mgr.getActiveWorkspacePath();
        const quick = mgr.discoverQuickActions(path);
          await this.sendMessage('workspace:switch:result', { success: true, path, quickActions: quick, analyticsEnabled: false });
          console.log('[dataset-bug] workspace:switch:result', { path, quickCsvs: quick?.csvPaths, checkpoints: (quick?.checkpointFiles || []).length });
      } catch {}

      // Emit stage changed
      await this.sendMessage('study:stage-changed', { stage: currentStage, progress });
      console.log('[StudyNext][extension] goto-stage: stage-changed sent', { tookMs: Date.now() - tStart });

      // Attempt dataset-restored notification and push analets
      try {
        const stateService = this.context?.stateService;
        if (stateService) {
          const ds = await stateService.loadDataset();
          if (ds?.datasetInfo) {
            try {
              console.log('[dataset-bug][extension] goto-stage:loaded-from-state', {
                name: ds.datasetInfo?.name,
                hasSavedProfile: !!ds.datasetProfile,
                savedProfileCols: (ds as any)?.datasetProfile?.columns?.length,
              });
            } catch {}
            // Try to include dataset profile as well (fallback to saved profile)
            let profile: any = null;
            try {
              const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
              const summarizer = DatasetSummarizerService.getInstance();
              profile = summarizer.getDatasetProfile();
              if (!profile && (ds as any)?.datasetProfile) {
                summarizer.setDatasetWithProfile(ds.datasetInfo as any, (ds as any).datasetProfile as any);
                profile = (ds as any).datasetProfile;
              }
              // Compute if still missing and we have a path
              if (!profile) {
                const meta: any = ds.metadata || {};
                let abs = meta?.absoluteFilePath || meta?.filePath || (ds.datasetInfo as any)?.filePath;
                if (abs && typeof abs === 'string') {
                  const pathMod = require('path');
                  if (!pathMod.isAbsolute(abs)) {
                    try {
                      const ctx = this.context?.stateService?.getContext();
                      const mgr = (await import('../../ActiveWorkspaceManager')).ActiveWorkspaceManager.getInstance(ctx);
                      const root = mgr.getActiveWorkspacePath();
                      abs = pathMod.join(root, abs);
                    } catch {}
                  }
                  const fsMod = require('fs');
                  if (fsMod.existsSync(abs)) {
                    const computed = await summarizer.analyzeCSVFile(abs);
                    profile = computed;
                    try { await this.context?.stateService?.saveDataset(ds.datasetInfo as any, computed as any, { source: 'file_path', filePath: abs, absoluteFilePath: abs } as any); } catch {}
                  }
                }
              }
            } catch {}
            await this.sendMessage('dataset-restored', { success: true, dataset: ds.datasetInfo, profile, enhanced: !!profile });
            console.log('[dataset-bug] dataset-restored (goto)', { name: ds.datasetInfo?.name, filePath: ds.datasetInfo?.filePath, hasProfile: !!profile });
            console.log('[StudyNext][extension] goto-stage: dataset-restored sent', { tookMs: Date.now() - tStart });
            try {
              const analets = await stateService.getAnalets();
              if (analets && analets.length > 0) {
                await this.sendMessage('fetch-analet-data', { analets, success: true, loadedFromCache: true });
              }
            } catch {}
          } else {
            const stage = this.studyController.getCurrentStage();
            await this.sendMessage('dataset-restored', {
              success: true,
              dataset: { name: stage?.datasetSlug || 'dataset', rowCount: 0, columnCount: 0, columns: [], firstTwoRows: [] }
            });
            console.log('[dataset-bug] dataset-restored minimal (goto)', { name: stage?.datasetSlug });
          }
        }
      } catch {}

      await this.sendMessage('study:goto-stage:result', { success: true, stage: currentStage, progress });
      console.log('[StudyNext][extension] goto-stage: result sent', { totalMs: Date.now() - tStart });

    } catch (error) {
      this.log('error', 'Failed to goto stage', error);
      await this.sendMessage('study:goto-stage:result', { success: false, error: String(error) });
    }
  }

  /**
   * Initialize study session with participant ID
   */
  private async handleInitializeStudy(data: any): Promise<void> {
    try {
      const participantId = data?.participantId;

      if (!participantId || typeof participantId !== 'number' || participantId < 1) {
        await this.sendMessage('study:initialize:result', {
          success: false,
          error: 'Valid participant ID is required'
        });
        return;
      }

      this.log('info', `Initializing study for participant ${participantId}`);

      const result = await this.studyController.initializeStudy(participantId);
      await this.sendMessage('study:initialize:result', result);

      // If successful, automatically switch to first stage workspace
      if (result.success && result.config) {
        const switchResult = await this.studyController.switchToCurrentStageWorkspace();
        if (switchResult.success) {
          this.log('info', 'Successfully switched to initial stage workspace');

          // Notify frontend about workspace switch and current stage
          await this.sendMessage('study:stage-changed', {
            stage: this.studyController.getCurrentStage(),
            progress: this.studyController.getProgressInfo()
          });

          // Also notify dataset restored if available in state (or send fallback to unblock UI)
          try {
            const stateService = this.context?.stateService;
            if (stateService) {
              const ds = await stateService.loadDataset();
              if (ds?.datasetInfo) {
                try {
                  console.log('[dataset-bug][extension] initialize:loaded-from-state', {
                    name: ds.datasetInfo?.name,
                    hasSavedProfile: !!ds.datasetProfile,
                    savedProfileCols: (ds as any)?.datasetProfile?.columns?.length,
                  });
                } catch {}
                // Try to get profile for enhanced flag (fallback to saved; compute if missing)
                let profile: any = null;
                try {
                  const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
                  const summarizer = DatasetSummarizerService.getInstance();
                  profile = summarizer.getDatasetProfile();
                  if (!profile && (ds as any)?.datasetProfile) {
                    summarizer.setDatasetWithProfile(ds.datasetInfo as any, (ds as any).datasetProfile as any);
                    profile = (ds as any).datasetProfile;
                  }
                  if (!profile) {
                    const meta: any = ds.metadata || {};
                    let abs = meta?.absoluteFilePath || meta?.filePath || (ds.datasetInfo as any)?.filePath;
                    if (abs && typeof abs === 'string') {
                      const pathMod = require('path');
                      if (!pathMod.isAbsolute(abs)) {
                        try {
                          const ctx = this.context?.stateService?.getContext();
                          const mgr = (await import('../../ActiveWorkspaceManager')).ActiveWorkspaceManager.getInstance(ctx);
                          const root = mgr.getActiveWorkspacePath();
                          abs = pathMod.join(root, abs);
                        } catch {}
                      }
                      const fsMod = require('fs');
                      if (fsMod.existsSync(abs)) {
                        const computed = await summarizer.analyzeCSVFile(abs);
                        profile = computed;
                        try { await this.context?.stateService?.saveDataset(ds.datasetInfo as any, computed as any, { source: 'file_path', filePath: abs, absoluteFilePath: abs } as any); } catch {}
                      }
                    }
                  }
                } catch {}
                await this.sendMessage('dataset-restored', {
                  success: true,
                  dataset: ds.datasetInfo,
                  profile,
                  enhanced: !!profile
                });
                try {
                  console.log('[dataset-bug][extension] dataset-restored (initialize)', {
                    name: ds.datasetInfo?.name,
                    sentProfile: !!profile,
                    savedProfileExisted: !!ds.datasetProfile,
                  });
                } catch {}
          } else {
            // Second-chance after init: proactively analyze CSV from quick actions
                try {
                  const ctx2 = this.context?.stateService?.getContext();
                  const mgr2 = ActiveWorkspaceManager.getInstance(ctx2);
                  const activePath = mgr2.getActiveWorkspacePath();
                  const quick2 = mgr2.discoverQuickActions(activePath);
                  const stage = this.studyController.getCurrentStage();
                  const csvs: string[] = quick2?.csvPaths || [];
                  const preferred = csvs.find(p => p.toLowerCase().includes(String(stage?.datasetSlug || '').toLowerCase())) || csvs[0];
                  if (preferred) {
                    const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
                    const summarizer = DatasetSummarizerService.getInstance();
                    await summarizer.analyzeCSVFile(preferred);
                    const info = summarizer.getDatasetInfo();
                    if (info) {
                      (info as any).filePath = require('path').basename(preferred);
                      await this.context?.stateService?.saveDataset(info, undefined, { source: 'file_path', filePath: preferred, absoluteFilePath: preferred } as any);
                      await this.sendMessage('dataset-restored', { success: true, dataset: info, enhanced: !!summarizer.getDatasetProfile(), profile: summarizer.getDatasetProfile() });
                      return;
                    }
                  }
                } catch (e) {
                  this.log('warn', 'Proactive CSV analyze after init failed', e);
                }
                // Fallback: signal readiness with minimal dataset info for this stage
                const stage = this.studyController.getCurrentStage();
                await this.sendMessage('dataset-restored', {
                  success: true,
                  dataset: { name: stage?.datasetSlug || 'dataset', rowCount: 0, columnCount: 0, columns: [], firstTwoRows: [] }
                });
              }
            }
          } catch (e) {
            this.log('warn', 'Failed to notify dataset-restored after init', e);
          }
        } else {
          this.log('warn', 'Failed to switch to initial workspace:', switchResult.error);
        }
      }

    } catch (error) {
      this.log('error', 'Failed to initialize study', error);
      await this.sendMessage('study:initialize:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Initialize study session with participant code (P1-P12)
   */
  private async handleInitializeStudyWithCode(data: any): Promise<void> {
    try {
      const participantCode = data?.participantCode;
      const adminOptions = data?.adminOptions as { conditionCode?: 'Map'|'Tree'|'Canvas'; participantId?: number } | undefined;
      const rawCodeLabel = data?.rawCodeLabel as string | undefined;

      if (!participantCode || typeof participantCode !== 'string') {
        await this.sendMessage('study:initialize:result', {
          success: false,
          error: 'Valid participant code is required (e.g., P1, P7, P12)'
        });
        return;
      }

      this.log('info', `Initializing study with participant code: ${participantCode}`);

      // Support special admin/test codes; pass label and admin options
      const result = await this.studyController.initializeStudyWithCode(participantCode, { adminOptions, rawCodeLabel });
      await this.sendMessage('study:initialize:result', result);

      // If successful, automatically switch to first stage workspace
      if (result.success && result.config) {
        const switchResult = await this.studyController.switchToCurrentStageWorkspace();
        if (switchResult.success) {
          this.log('info', 'Successfully switched to initial stage workspace');

          // Notify frontend about workspace switch and current stage
          await this.sendMessage('study:stage-changed', {
            stage: this.studyController.getCurrentStage(),
            progress: this.studyController.getProgressInfo()
          });
          // Also try to notify dataset restored and current analets so UI can proceed without loader
          try {
            const stateService = this.context?.stateService;
            if (stateService) {
              const ds = await stateService.loadDataset();
              if (ds?.datasetInfo) {
                // Ensure profile exists; compute if missing
                let ensuredProfile: any = (ds as any)?.datasetProfile;
                try {
                  if (!ensuredProfile) {
                    const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
                    const summarizer = DatasetSummarizerService.getInstance();
                    let abs = (ds.metadata as any)?.absoluteFilePath || (ds.metadata as any)?.filePath || (ds.datasetInfo as any)?.filePath;
                    if (abs && typeof abs === 'string') {
                      const pathMod = require('path');
                      if (!pathMod.isAbsolute(abs)) {
                        try {
                          const ctx = this.context?.stateService?.getContext();
                          const mgr = (await import('../../ActiveWorkspaceManager')).ActiveWorkspaceManager.getInstance(ctx);
                          const root = mgr.getActiveWorkspacePath();
                          abs = pathMod.join(root, abs);
                        } catch {}
                      }
                      const fsMod = require('fs');
                      if (fsMod.existsSync(abs)) {
                        ensuredProfile = await summarizer.analyzeCSVFile(abs);
                        try { await this.context?.stateService?.saveDataset(ds.datasetInfo as any, ensuredProfile as any, { source: 'file_path', filePath: abs, absoluteFilePath: abs } as any); } catch {}
                      }
                    }
                  }
                } catch {}
                await this.sendMessage('dataset-restored', { success: true, dataset: ds.datasetInfo, profile: ensuredProfile, enhanced: !!ensuredProfile });
                try {
                  console.log('[dataset-bug][extension] dataset-restored (initialize-with-code)', {
                    name: ds.datasetInfo?.name,
                    sentProfile: !!ensuredProfile,
                    savedProfileExisted: !!(ds as any)?.datasetProfile,
                  });
                } catch {}
                try {
                  const analets = await stateService.getAnalets();
                  if (analets && analets.length > 0) {
                    await this.sendMessage('fetch-analet-data', { analets, success: true, loadedFromCache: true });
                  }
                } catch {}
              } else {
                await this.sendMessage('dataset-restored', { success: false, enhanced: false, reason: 'no-dataset-after-init-with-code' } as any);
              }
            }
          } catch {}
        } else {
          this.log('warn', 'Failed to switch to initial workspace:', switchResult.error);
        }
      }

    } catch (error) {
      this.log('error', 'Failed to initialize study with code', error);
      await this.sendMessage('study:initialize:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Get current study configuration
   */
  private async handleGetCurrentConfig(): Promise<void> {
    try {
      const config = this.studyController.getCurrentStudyConfig();
      const isActive = this.studyController.isStudyInProgress();
      const currentStage = this.studyController.getCurrentStage();
      const progress = this.studyController.getProgressInfo();
      await this.sendMessage('study:current-config:result', {
        success: true,
        config,
        isActive,
        currentStage,
        progress
      });

    } catch (error) {
      this.log('error', 'Failed to get current study config', error);
      await this.sendMessage('study:current-config:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Get study progress information
   */
  private async handleGetProgress(): Promise<void> {
    try {
      const progress = this.studyController.getProgressInfo();
      const currentStage = this.studyController.getCurrentStage();
      const isActive = this.studyController.isStudyInProgress();

      await this.sendMessage('study:progress:result', {
        success: true,
        progress,
        currentStage,
        isActive
      });

    } catch (error) {
      this.log('error', 'Failed to get study progress', error);
      await this.sendMessage('study:progress:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Get session restore information
   */
  private async handleGetRestoreInfo(): Promise<void> {
    try {
      const restoreInfo = this.studyController.getSessionRestoreInfo();
      await this.sendMessage('study:restore-info:result', {
        success: true,
        restoreInfo
      });

    } catch (error) {
      this.log('error', 'Failed to get session restore info', error);
      await this.sendMessage('study:restore-info:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Restore study session
   */
  private async handleRestoreSession(): Promise<void> {
    try {
      this.log('info', 'Restoring study session');

      const result = await this.studyController.restoreStudySession();

      if (result.success) {
        this.log('info', 'Study session restored successfully');

        // Notify frontend about successful restoration
        await this.sendMessage('study:restore-session:result', {
          success: true,
          stage: result.stage,
          progress: this.studyController.getProgressInfo(),
          message: `Study session restored to stage ${result.stage?.stageIndex !== undefined ? result.stage.stageIndex + 1 : 'unknown'}`
        });

        // Also notify about stage change
        await this.sendMessage('study:stage-changed', {
          stage: result.stage,
          progress: this.studyController.getProgressInfo(),
          restored: true
        });

        // Also notify dataset restored if available (or proactively analyze, then fallback)
        try {
          const stateService = this.context?.stateService;
          if (stateService) {
            const ds = await stateService.loadDataset();
            if (ds?.datasetInfo) {
              let profile: any = null;
              try {
                const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
                const summarizer = DatasetSummarizerService.getInstance();
                profile = summarizer.getDatasetProfile();
                if (!profile && (ds as any)?.datasetProfile) {
                  summarizer.setDatasetWithProfile(ds.datasetInfo as any, (ds as any).datasetProfile as any);
                  profile = (ds as any).datasetProfile;
                }
              } catch {}
              await this.sendMessage('dataset-restored', {
                success: true,
                dataset: ds.datasetInfo,
                profile,
                enhanced: !!profile
              });
            } else {
              // Second-chance after restore: proactively analyze CSV from quick actions
              try {
                const ctx2 = this.context?.stateService?.getContext();
                const mgr2 = ActiveWorkspaceManager.getInstance(ctx2);
                const activePath = mgr2.getActiveWorkspacePath();
                const quick2 = mgr2.discoverQuickActions(activePath);
                const stage = this.studyController.getCurrentStage();
                const csvs: string[] = quick2?.csvPaths || [];
                const preferred = csvs.find(p => p.toLowerCase().includes(String(stage?.datasetSlug || '').toLowerCase())) || csvs[0];
                if (preferred) {
                  const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
                  const summarizer = DatasetSummarizerService.getInstance();
                  await summarizer.analyzeCSVFile(preferred);
                  const info = summarizer.getDatasetInfo();
                  if (info) {
                    (info as any).filePath = require('path').basename(preferred);
                    await this.context?.stateService?.saveDataset(info, undefined, { source: 'file_path', filePath: preferred, absoluteFilePath: preferred } as any);
                    await this.sendMessage('dataset-restored', { success: true, dataset: info, enhanced: !!summarizer.getDatasetProfile(), profile: summarizer.getDatasetProfile() });
                    return;
                  }
                }
              } catch (e) {
                this.log('warn', 'Proactive CSV analyze after restore failed', e);
              }
              // Fallback: send empty to unblock UI
              await this.sendMessage('dataset-restored', { success: false, enhanced: false, reason: 'no-dataset-after-restore' } as any);
            }
          }
        } catch (e) {
          this.log('warn', 'Failed to notify dataset-restored after restore', e);
        }
      } else {
        await this.sendMessage('study:restore-session:result', {
          success: false,
          error: result.error
        });
      }

    } catch (error) {
      this.log('error', 'Failed to restore study session', error);
      await this.sendMessage('study:restore-session:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Advance to next stage (finish current condition)
   */
  private async handleAdvanceStage(): Promise<void> {
    try {
      const tStart = Date.now();
      console.log('[StudyNext][extension] advance-stage: start');
      if (this.isAdvancing) {
        console.warn('[flow-debug][extension] handleAdvanceStage ignored (already advancing)');
        return;
      }
      this.isAdvancing = true;
      this.log('info', 'Advancing to next study stage');
      // 0) Before advancing, save a 'load' checkpoint in the current workspace for auto-restore when revisiting
      try {
        if (this.context?.stateService) {
          const stateService = this.context.stateService;
          const ctx = stateService.getContext();
          const mgr = ActiveWorkspaceManager.getInstance(ctx);
          const root = mgr.getActiveRoot();
          const checkpointService = AnaletCheckpointService.getInstance();
          await checkpointService.initialize(root);
          const cp = await checkpointService.createCheckpointFromState(stateService, 'Auto-checkpoint before stage advance');
          const dir = require('path').join(root, '.meridian', 'checkpoints');
          const fs = require('fs');
          const oldPath = require('path').join(dir, `${cp.id}.json`);
          const newPath = require('path').join(dir, `load_${cp.id}.json`);
          try { fs.renameSync(oldPath, newPath); } catch {}
        }
      } catch (e) {
        this.log('warn', 'Failed to create pre-advance checkpoint', e);
      }

      // 0.5) Flush telemetry and purge all data/state before switching
      try {
        const stateService = this.context?.stateService;
        const telemetry = this.context?.telemetryService as TelemetryService | undefined;
        if (telemetry) {
          await telemetry.flushAll();
        }
        if (stateService) {
          // Clear backend state and analet store
          stateService.clearAllData();
          if (this.context?.analetStore) {
            await this.context.analetStore.clearAll();
          }
        }
        // Ask frontend to purge its storage
        await this.sendMessage('purge-frontend-storage', { emergency: false });
        // Also notify UI that purge completed for reset flows to trigger
        await this.sendMessage('purge-data-response', { success: true, message: 'Stage advance purge complete' });
      } catch (e) {
        this.log('warn', 'Failed to flush/purge before advancing stage', e);
      }
      console.log('[StudyNext][extension] advance-stage: after purge', { tookMs: Date.now() - tStart });

      // First advance the stage configuration
      const result = await this.studyController.advanceToNextStage();
      if (!result.success) {
        await this.sendMessage('study:advance-stage:result', result);
        return;
      }
      console.log('[StudyNext][extension] advance-stage: controller advanced', { tookMs: Date.now() - tStart });

      // If study is completed
      if (result.completed) {
        this.log('info', 'Study completed successfully');
        console.log('[StudyNext][extension] advance-stage: completed', { totalMs: Date.now() - tStart });
        await this.sendMessage('study:advance-stage:result', {
          success: true,
          completed: true,
          message: 'Study completed successfully!'
        });

        // Export final configuration
        await this.studyController.exportAllStudyJson();
        return;
      }

      // For task stages, switch workspace; for survey/review, skip switching
      let switchOk = true;
      try {
        // Peek at next stage type from controller
        const peek = this.studyController.getCurrentStage() as any;
        if (!peek || !peek.stageType || peek.stageType === 'task') {
          const switchResult = await this.studyController.switchToCurrentStageWorkspace();
          if (!switchResult.success) {
            switchOk = false;
            this.log('error', 'Failed to switch to next stage workspace', switchResult.error);
            await this.sendMessage('study:advance-stage:result', {
              success: false,
              error: `Stage advanced but workspace switch failed: ${switchResult.error}`
            });
            return;
          }
          console.log('[StudyNext][extension] advance-stage: workspace switched', { tookMs: Date.now() - tStart });
        } else {
          this.log('info', `Advanced to interstitial stage: ${peek.stageType}; no workspace switch needed`);
        }
      } catch (e) {
        // If something unexpected happens, report but continue
        this.log('warn', 'Error during stage switch handling', e);
      }

      // Notify webview of workspace switch (path + quick actions), if we switched
      try {
        const ctx = this.context?.stateService?.getContext();
        const mgr = ActiveWorkspaceManager.getInstance(ctx);
        const path = mgr.getActiveWorkspacePath();
        const quick = mgr.discoverQuickActions(path);
        await this.sendMessage('workspace:switch:result', {
          success: true,
          path,
          quickActions: quick,
          analyticsEnabled: false
        });
        console.log('[StudyNext][extension] advance-stage: workspace:switch:result sent', { tookMs: Date.now() - tStart });
      } catch (e) {
        this.log('warn', 'Failed to send workspace:switch:result after stage switch', e);
      }

      // Success - send updated stage information
      const currentStage = this.studyController.getCurrentStage();
      const progress = this.studyController.getProgressInfo();

      await this.sendMessage('study:advance-stage:result', {
        success: true,
        nextStage: currentStage,
        progress,
        message: `Advanced to stage ${progress?.currentStage}/${progress?.totalStages}`
      });
      console.log('[StudyNext][extension] advance-stage: result sent', { tookMs: Date.now() - tStart });

      // Also notify about stage change
      await this.sendMessage('study:stage-changed', {
        stage: currentStage,
        progress
      });
      console.log('[StudyNext][extension] advance-stage: stage-changed sent', { tookMs: Date.now() - tStart });

      // Notify frontend to refresh/reset state for new condition when entering task stage
      if ((currentStage as any)?.stageType === 'task' || !(currentStage as any)?.stageType) {
        await this.sendMessage('study:condition-changed', {
          newCondition: currentStage?.conditionCode,
          newDataset: currentStage?.datasetSlug
        });

      // After switching workspaces and controller analysis, emit dataset-restored if dataset is present
      try {
        const stateService = this.context?.stateService;
        if (stateService) {
          const ds = await stateService.loadDataset();
          if (ds?.datasetInfo) {
            try {
              console.log('[dataset-bug][extension] advance:loaded-from-state', {
                name: ds.datasetInfo?.name,
                hasSavedProfile: !!ds.datasetProfile,
                savedProfileCols: (ds as any)?.datasetProfile?.columns?.length,
              });
            } catch {}
            let profile: any = null;
            try {
              const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
              const summarizer = DatasetSummarizerService.getInstance();
              profile = summarizer.getDatasetProfile();
              if (!profile && (ds as any)?.datasetProfile) {
                summarizer.setDatasetWithProfile(ds.datasetInfo as any, (ds as any).datasetProfile as any);
                profile = (ds as any).datasetProfile;
              }
              if (!profile) {
                const meta: any = ds.metadata || {};
                let abs = meta?.absoluteFilePath || meta?.filePath || (ds.datasetInfo as any)?.filePath;
                if (abs && typeof abs === 'string') {
                  const pathMod = require('path');
                  if (!pathMod.isAbsolute(abs)) {
                    try {
                      const ctx = this.context?.stateService?.getContext();
                      const mgr = (await import('../../ActiveWorkspaceManager')).ActiveWorkspaceManager.getInstance(ctx);
                      const root = mgr.getActiveWorkspacePath();
                      abs = pathMod.join(root, abs);
                    } catch {}
                  }
                  const fsMod = require('fs');
                  if (fsMod.existsSync(abs)) {
                    const computed = await summarizer.analyzeCSVFile(abs);
                    profile = computed;
                    try { await this.context?.stateService?.saveDataset(ds.datasetInfo as any, computed as any, { source: 'file_path', filePath: abs, absoluteFilePath: abs } as any); } catch {}
                  }
                }
              }
            } catch {}
            await this.sendMessage('dataset-restored', {
              success: true,
              dataset: ds.datasetInfo,
              profile,
              enhanced: !!profile
            });
            try {
              console.log('[dataset-bug][extension] dataset-restored (advance)', {
                name: ds.datasetInfo?.name,
                sentProfile: !!profile,
                savedProfileExisted: !!ds.datasetProfile,
              });
            } catch {}
            // Also push analets so the webview doesn't trigger generation
            try {
              const analets = await stateService.getAnalets();
              if (analets && analets.length > 0) {
                await this.sendMessage('fetch-analet-data', { analets, success: true, loadedFromCache: true });
              }
            } catch {}
          } else {
            // Second-chance: try to proactively analyze a CSV from quick actions
            try {
              const ctx2 = this.context?.stateService?.getContext();
              const mgr2 = ActiveWorkspaceManager.getInstance(ctx2);
              const activePath = mgr2.getActiveWorkspacePath();
              const quick2 = mgr2.discoverQuickActions(activePath);
              const stage = this.studyController.getCurrentStage();
              const csvs: string[] = quick2?.csvPaths || [];
              const preferred = csvs.find(p => p.toLowerCase().includes(String(stage?.datasetSlug || '').toLowerCase())) || csvs[0];
              if (preferred) {
                const { DatasetSummarizerService } = await import('../../DatasetSummarizerService');
                const summarizer = DatasetSummarizerService.getInstance();
                await summarizer.analyzeCSVFile(preferred);
                const info = summarizer.getDatasetInfo();
                if (info) {
                  (info as any).filePath = require('path').basename(preferred);
                  await this.context?.stateService?.saveDataset(info, undefined, { source: 'file_path', filePath: preferred, absoluteFilePath: preferred } as any);
                  await this.sendMessage('dataset-restored', { success: true, dataset: info, enhanced: !!summarizer.getDatasetProfile(), profile: summarizer.getDatasetProfile() });
                  return;
                }
              }
            } catch (e) {
              this.log('warn', 'Proactive CSV analyze after advance failed', e);
            }
            // Fallback: notify with minimal dataset info
            await this.sendMessage('dataset-restored', {
              success: true,
              dataset: { name: this.studyController.getCurrentStage()?.datasetSlug || 'dataset', rowCount: 0, columnCount: 0, columns: [], firstTwoRows: [] }
            });
          }
        }
      } catch (e) {
        this.log('warn', 'Failed to notify dataset-restored after advance', e);
      }
      }

    } catch (error) {
      this.log('error', 'Failed to advance study stage', error);
      await this.sendMessage('study:advance-stage:result', {
        success: false,
        error: String(error)
      });
    } finally {
      this.isAdvancing = false;
    }
  }

  /**
   * Switch to current stage workspace (manual)
   */
  private async handleSwitchWorkspace(): Promise<void> {
    try {
      const result = await this.studyController.switchToCurrentStageWorkspace();

      if (result.success) {
        const currentStage = this.studyController.getCurrentStage();
        const progress = this.studyController.getProgressInfo();

        await this.sendMessage('study:switch-workspace:result', {
          success: true,
          stage: currentStage,
          progress
        });
      } else {
        await this.sendMessage('study:switch-workspace:result', result);
      }

    } catch (error) {
      this.log('error', 'Failed to switch workspace', error);
      await this.sendMessage('study:switch-workspace:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Finish current condition (legacy compatibility)
   * This is an alias for advance-stage to maintain compatibility
   */
  private async handleFinishCondition(): Promise<void> {
    this.log('info', 'Handling finish condition (routing to advance stage)');
    await this.handleAdvanceStage();
  }

  /**
   * Reset/end current study
   */
  private async handleResetStudy(): Promise<void> {
    try {
      this.log('info', 'Resetting study session');

      await this.studyController.resetStudy();

      await this.sendMessage('study:reset:result', {
        success: true,
        message: 'Study session reset successfully'
      });

      // Notify frontend about study end
      await this.sendMessage('study:ended', {
        reason: 'manual_reset'
      });

    } catch (error) {
      this.log('error', 'Failed to reset study', error);
      await this.sendMessage('study:reset:result', {
        success: false,
        error: String(error)
      });
    }
  }

  /**
   * Export current study configuration as JSON
   */
  private async handleExportConfig(data: any): Promise<void> {
    try {
      const outputPath = data?.outputPath;
      const result = await this.studyController.exportAllStudyJson(outputPath);

      await this.sendMessage('study:export-config:result', result);

    } catch (error) {
      this.log('error', 'Failed to export study config', error);
      await this.sendMessage('study:export-config:result', {
        success: false,
        error: String(error)
      });
    }
  }
}
