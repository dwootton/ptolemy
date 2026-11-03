import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TelemetryService } from './TelemetryService';
import { ActiveWorkspaceManager } from './ActiveWorkspaceManager';
import { AnaletCheckpointService, BaselineCheckpoint } from './AnaletCheckpointService';
import { StateManagementService } from './StateManagementService';
import { StudyConfigurationService } from './StudyConfigurationService';

export interface StudyStage {
  id: string;
  stageType: 'task' | 'survey' | 'review';
  participantId: number;
  datasetSlug: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';
  conditionCode: 'Map' | 'Tree' | 'Canvas';
  workspacePath: string;
  checkpointPath?: string;
  instrumentationEnabled: boolean;
  stageIndex: number;
  totalStages: number;
}

export interface AllStudyConfig {
  participantId: number;
  participantLabel?: string; // Optional label (e.g., admin-21ee) for logging/filenames
  stages: StudyStage[];
  currentStageIndex: number;
  sessionStartTime: string;
  studyMetadata: {
    conditionOrder: string;
    datasetOrder: string;
  };
  isCompleted: boolean;
}

export interface ParticipantMapping {
  participantId: number;
  conditionOrder: string;
  datasetOrder: string;
}

export class StudyApplicationController {
  private static instance: StudyApplicationController;
  private context: vscode.ExtensionContext;
  private currentStudyConfig: AllStudyConfig | null = null;
  private isStudyActive: boolean = false;

  // Built-in participant mapping table (base schedule for P1–P9). Runover repeats.
  // Schedule key: A=Map, B=Canvas, C=Tree. X=vehicles, Y=diamonds, Z=listings.
  private readonly participantMappings: ParticipantMapping[] = [
    // 1: ABC, XYZ -> (Map,Canvas,Tree) × (X,Y,Z)
    { participantId: 1, conditionOrder: 'MapCanvasTree', datasetOrder: 'XYZ' },
    // 2: ACB, XYZ -> (Map,Tree,Canvas) × (X,Y,Z)
    { participantId: 2, conditionOrder: 'MapTreeCanvas', datasetOrder: 'XYZ' },
    // 3: BAC, YZX -> (Canvas,Map,Tree) × (Y,Z,X)
    { participantId: 3, conditionOrder: 'CanvasMapTree', datasetOrder: 'YZX' },
    // 4: BCA, XYZ -> (Canvas,Tree,Map) × (X,Y,Z)
    { participantId: 4, conditionOrder: 'CanvasTreeMap', datasetOrder: 'XYZ' },
    // 5: CAB, YZX -> (Tree,Map,Canvas) × (Y,Z,X)
    { participantId: 5, conditionOrder: 'TreeMapCanvas', datasetOrder: 'YZX' },
    // 6: CBA, ZXY -> (Tree,Canvas,Map) × (Z,X,Y)
    { participantId: 6, conditionOrder: 'TreeCanvasMap', datasetOrder: 'ZXY' },
    // 7: ABC, YZX -> (Map,Canvas,Tree) × (Y,Z,X)
    { participantId: 7, conditionOrder: 'MapCanvasTree', datasetOrder: 'YZX' },
    // 8: BCA, ZXY -> (Canvas,Tree,Map) × (Z,X,Y)
    { participantId: 8, conditionOrder: 'CanvasTreeMap', datasetOrder: 'ZXY' },
    // 9: CAB, ZXY -> (Tree,Map,Canvas) × (Z,X,Y)
    { participantId: 9, conditionOrder: 'TreeMapCanvas', datasetOrder: 'ZXY' },
  ];

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadStudyState();
  }

  /**
   * Infer dataset file for a stage workspace and save dataset info
   * Returns true if dataset saved, false otherwise
   */
  private async inferAndSaveDatasetForStage(targetWorkspacePath: string, datasetSlug: string): Promise<boolean> {
    try {
      const stateService = StateManagementService.getInstance(this.context);
      // If current saved dataset mismatches stage, clear it to avoid stickiness
      try {
        const exist = await stateService.loadDataset();
        if (exist?.datasetInfo && exist.datasetInfo.name !== datasetSlug) {
          console.log('[dataset-bug] infer: clearing mismatched dataset before infer', { prev: exist.datasetInfo.name, expected: datasetSlug });
          await stateService.clearDataset();
        }
      } catch {}
      // Priority 0: known pattern <slug>/<slug>.csv under this stage workspace
      try {
        const canonical = path.join(targetWorkspacePath, datasetSlug, `${datasetSlug}.csv`);
        if (fs.existsSync(canonical)) {
          console.log('[dataset-bug] infer: using canonical slug path', { canonical });
          const { DatasetSummarizerService } = await import('./DatasetSummarizerService');
          const summarizerService = DatasetSummarizerService.getInstance();
          const profile = await summarizerService.analyzeCSVFile(canonical);
          const datasetInfo = summarizerService.getDatasetInfo();
          if (datasetInfo) {
            (datasetInfo as any).filePath = path.basename(canonical);
            await stateService.saveDataset(datasetInfo, profile as any, {
              loadedAt: new Date().toISOString(),
              source: 'file_path',
              filePath: canonical,
              absoluteFilePath: canonical
            } as any);
            console.log('[dataset-bug] infer: saved dataset (canonical)', { name: datasetInfo.name, filePath: canonical });
            return true;
          }
        }
      } catch (e) {
        console.warn('[dataset-bug] infer: canonical slug path check failed', e);
      }
      // Try study.json datasetCsv
      let csvPath = '';
      try {
        const studyJsonRoot = path.join(targetWorkspacePath, 'study.json');
        const studyJsonDot = path.join(targetWorkspacePath, '.meridian', 'study.json');
        const studyPath = fs.existsSync(studyJsonRoot) ? studyJsonRoot : (fs.existsSync(studyJsonDot) ? studyJsonDot : '');
        if (studyPath) {
          const raw = fs.readFileSync(studyPath, 'utf8');
          const studyMeta = JSON.parse(raw || '{}');
          if (typeof studyMeta.datasetCsv === 'string' && studyMeta.datasetCsv.trim().length > 0) {
            csvPath = path.isAbsolute(studyMeta.datasetCsv)
              ? studyMeta.datasetCsv
              : path.join(targetWorkspacePath, studyMeta.datasetCsv);
            console.log('[dataset-bug] infer: study.json datasetCsv', { studyPath, csvPath });
          }
        }
      } catch {}
      // Fallback mapping
      if (!csvPath) {
        const csvMap: Record<string, string> = {
          vehicles: 'vehicles.csv',
          diamonds: 'diamonds.csv',
          listings: 'listings.csv'
        };
        csvPath = path.join(targetWorkspacePath, csvMap[datasetSlug] || `${datasetSlug}.csv`);
        console.log('[dataset-bug] infer: fallback mapping path', { datasetSlug, csvPath });
      }
      // If missing, pick a CSV under workspace (prefer one containing dataset slug)
      if (!fs.existsSync(csvPath)) {
        try {
          const entries = fs.readdirSync(targetWorkspacePath, { withFileTypes: true });
          const csvs = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.csv')).map(e => e.name);
          const preferred = csvs.find(n => n.toLowerCase().includes(datasetSlug.toLowerCase())) || csvs[0];
          if (preferred) csvPath = path.join(targetWorkspacePath, preferred);
          console.log('[dataset-bug] infer: scanned workspace files', { entries: csvs, chosen: csvPath });
        } catch {}
      }
      if (csvPath && fs.existsSync(csvPath)) {
        try {
          const { DatasetSummarizerService } = await import('./DatasetSummarizerService');
          const summarizerService = DatasetSummarizerService.getInstance();
          const profile = await summarizerService.analyzeCSVFile(csvPath);
          const datasetInfo = summarizerService.getDatasetInfo();
          if (datasetInfo) {
            (datasetInfo as any).filePath = path.basename(csvPath);
            await stateService.saveDataset(datasetInfo, profile as any, {
              loadedAt: new Date().toISOString(),
              source: 'file_path',
              filePath: csvPath,
              absoluteFilePath: csvPath
            } as any);
            console.log('[dataset-bug] infer: saved dataset', { name: datasetInfo.name, filePath: csvPath });
            return true;
          }
        } catch {}
      }
      console.log('[dataset-bug] infer: unable to save dataset for stage', { datasetSlug, targetWorkspacePath });
    } catch {}
    return false;
  }
  public static getInstance(context: vscode.ExtensionContext): StudyApplicationController {
    if (!StudyApplicationController.instance) {
      StudyApplicationController.instance = new StudyApplicationController(context);
    }
    return StudyApplicationController.instance;
  }

  /**
   * Parse participant code (P1-P12 or 1-12) into numeric participant ID
   */
  public static parseParticipantCode(code: string): number | null {
    if (!code || typeof code !== 'string') {
      return null;
    }

    const trimmedCode = code.trim();

    // Handle P1-P15 format (case insensitive)
    const pCodeMatch = trimmedCode.match(/^[Pp](\d+)(?:-(Map|Tree|Canvas))?$/i);
    if (pCodeMatch) {
      const numericId = parseInt(pCodeMatch[1], 10);
      return (numericId >= 1 && numericId <= 15) ? numericId : null;
    }

    // Handle direct numeric format (1-15) for backward compatibility
    const numericId = parseInt(trimmedCode, 10);
    if (!isNaN(numericId) && numericId >= 1 && numericId <= 15) {
      return numericId;
    }

    return null;
  }

  /**
   * Initialize study session with participant code (P1-P12) or ID (1-12)
   */
  public async initializeStudyWithCode(participantCode: string, options?: { adminOptions?: { conditionCode?: 'Map'|'Tree'|'Canvas'; participantId?: number }, rawCodeLabel?: string }): Promise<{ success: boolean; error?: string; config?: AllStudyConfig }> {
    const raw = (participantCode || '').trim();
    const lower = raw.toLowerCase();
    const label = options?.rawCodeLabel || raw;

    // Admin code: preview with optional participant override; condition is optional
    if (lower.startsWith('admin')) {
      const condition = options?.adminOptions?.conditionCode;
      const participantIdOverride = options?.adminOptions?.participantId;
      return this.initializeAdminSession(condition, label, participantIdOverride);
    }

    // Test user code: initialize a test session (uses default mapping)
    if (lower.startsWith('test')) {
      return this.initializeTestSession(label);
    }

    // Support P1-Map style suffix to jump to a specific condition
    const suffixMatch = raw.match(/^[Pp](\d+)(?:-(Map|Tree|Canvas))?$/i);
    const participantId = suffixMatch ? parseInt(suffixMatch[1], 10) : StudyApplicationController.parseParticipantCode(raw);
    if (participantId === null || isNaN(participantId)) {
      return {
        success: false,
        error: 'Invalid participant code. Use P1-P15 or P1-Map/Tree/Canvas.'
      };
    }
    const desiredCond = (suffixMatch && suffixMatch[2]) ? (suffixMatch[2][0].toUpperCase() + suffixMatch[2].slice(1).toLowerCase()) as 'Map'|'Tree'|'Canvas' : undefined;
    if (desiredCond) {
      // Use admin session path to honor participant mapping and start at desired condition
      return this.initializeAdminSession(desiredCond, label, participantId);
    }
    return this.initializeStudy(participantId, label);
  }

  /**
   * Initialize study session with participant ID (internal method)
   */
  public async initializeStudy(participantId: number, participantLabel?: string): Promise<{ success: boolean; error?: string; config?: AllStudyConfig }> {
    try {
      // Validate participant ID
      if (participantId < 1) {
        return { success: false, error: 'Participant ID must be a positive number' };
      }

      // Get or create mapping
      const mapping = this.getParticipantMapping(participantId);
      // Generate tentative configuration
      const studyConfig = this.generateAllStudyConfig(mapping);
      if (participantLabel) {
        (studyConfig as any).participantLabel = participantLabel;
      }

      // Validate required study dataset folders and CSVs exist under .user_study or .user-study
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const baseUnderscore = path.join(root, '.user_study');
      const baseHyphen = path.join(root, '.user-study');
      const base = fs.existsSync(baseUnderscore) ? baseUnderscore : baseHyphen;
      const csvMap: Record<string, string> = {
        vehicles: 'vehicles.csv',
        diamonds: 'diamonds.csv',
        listings: 'listings.csv'
      };
      if (!fs.existsSync(base)) {
        return { success: false, error: `Missing study directory: ${baseUnderscore} (or .user-study). Create study datasets with dataset subfolders.` };
      }
      const missing: string[] = [];
      for (const stage of studyConfig.stages) {
        const folder = path.join(base, stage.datasetSlug);
        const csvName = csvMap[stage.datasetSlug] || `${stage.datasetSlug}.csv`;
        const csvPath = path.join(folder, csvName);
        if (!fs.existsSync(folder)) missing.push(`Folder: ${folder}`);
        if (!fs.existsSync(csvPath)) missing.push(`CSV: ${csvPath}`);
      }
      if (missing.length) {
        return { success: false, error: `Study data missing:\n- ${missing.join('\n- ')}` };
      }

      // Save configuration
      this.currentStudyConfig = studyConfig;
      this.isStudyActive = true;
      await this.saveStudyState();
      // Write per-workspace study.json metadata to assist auto-loading
      try { this.writeWorkspaceStudyFiles(studyConfig); } catch {}

      // Configure telemetry with study context
      const telemetryService = TelemetryService.getInstance(this.context);
      telemetryService.setStudyContext({
        isStudyMode: true,
        participantId: participantId,
        datasetSlug: studyConfig.stages[0]?.datasetSlug,
        conditionCode: studyConfig.stages[0]?.conditionCode,
        studyLabel: participantLabel
      });

      // Set the study label without changing the user's logging preferences.
      try {
        const cfg = vscode.workspace.getConfiguration('meridian.firebase');
        const userId = participantLabel || `P${participantId}`;
        await cfg.update('userId', userId, vscode.ConfigurationTarget.Workspace);
      } catch (e) {
        console.warn('[StudyApplicationController] Failed to set the study logging label', e);
      }
      return { success: true, config: studyConfig };

    } catch (error) {
      console.error(`[StudyApplicationController] Failed to initialize study:`, error);
      return { success: false, error: String(error) };
    }
  }

  /** Initialize a test session (uses default mapping and first condition) */
  public async initializeTestSession(participantLabel?: string): Promise<{ success: boolean; error?: string; config?: AllStudyConfig }> {
    try {
      const mapping = this.getParticipantMapping(1); // default mapping baseline
      const studyConfig = this.generateAllStudyConfig({ ...mapping, participantId: 98 });
      if (participantLabel) (studyConfig as any).participantLabel = participantLabel;
      this.currentStudyConfig = studyConfig;
      this.isStudyActive = true;
      await this.saveStudyState();
      try { this.writeWorkspaceStudyFiles(studyConfig); } catch {}
      const telemetryService = TelemetryService.getInstance(this.context);
      const first = studyConfig.stages[0];
      telemetryService.setStudyContext({ isStudyMode: true, participantId: 98, datasetSlug: first?.datasetSlug, conditionCode: first?.conditionCode, studyLabel: participantLabel });
      try {
        const cfg = vscode.workspace.getConfiguration('meridian.firebase');
        const userId = participantLabel || 'test-98';
        await cfg.update('userId', userId, vscode.ConfigurationTarget.Workspace);
      } catch (e) {
        console.warn('[StudyApplicationController] Failed to set the test session logging label', e);
      }
      return { success: true, config: studyConfig };
    } catch (error) {
      console.error('[StudyApplicationController] Failed to initialize test study:', error);
      return { success: false, error: String(error) };
    }
  }

  /** Initialize an admin session with selected condition */
  public async initializeAdminSession(condition: 'Map'|'Tree'|'Canvas' | undefined, participantLabel?: string, participantIdOverride?: number): Promise<{ success: boolean; error?: string; config?: AllStudyConfig }> {
    try {
      const participantId = (participantIdOverride && participantIdOverride > 0) ? participantIdOverride : 99;
      const baseMapping = this.getParticipantMapping(participantId);
      const studyConfig = this.generateAllStudyConfig({ ...baseMapping, participantId });
      // Set label if provided
      if (participantLabel) (studyConfig as any).participantLabel = participantLabel;
      // Set current stage based on requested condition
      if (condition) {
        const idx = studyConfig.stages.findIndex(s => s.conditionCode === condition);
        studyConfig.currentStageIndex = idx >= 0 ? idx : 0;
      } else {
        studyConfig.currentStageIndex = 0;
      }
      this.currentStudyConfig = studyConfig;
      this.isStudyActive = true;
      await this.saveStudyState();
      try { this.writeWorkspaceStudyFiles(studyConfig); } catch {}
      const current = this.getCurrentStage();
      const telemetryService = TelemetryService.getInstance(this.context);
      telemetryService.setStudyContext({ isStudyMode: true, participantId, datasetSlug: current?.datasetSlug, conditionCode: current?.conditionCode, studyLabel: participantLabel });
      try {
        const cfg = vscode.workspace.getConfiguration('meridian.firebase');
        const userId = participantLabel || `P${participantId}`;
        await cfg.update('userId', userId, vscode.ConfigurationTarget.Workspace);
      } catch (e) {
        console.warn('[StudyApplicationController] Failed to set the admin session logging label', e);
      }
      return { success: true, config: studyConfig };
    } catch (error) {
      console.error('[StudyApplicationController] Failed to initialize admin study:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get current study configuration
   */
  public getCurrentStudyConfig(): AllStudyConfig | null {
    return this.currentStudyConfig;
  }

  /**
   * Check if study is currently active
   */
  public isStudyInProgress(): boolean {
    return this.isStudyActive && this.currentStudyConfig !== null && !this.currentStudyConfig.isCompleted;
  }

  /**
   * Get current stage information
   */
  public getCurrentStage(): StudyStage | null {
    if (!this.currentStudyConfig || this.currentStudyConfig.currentStageIndex >= this.currentStudyConfig.stages.length) {
      return null;
    }
    return this.currentStudyConfig.stages[this.currentStudyConfig.currentStageIndex];
  }

  /**
   * Advance to next stage
   */
  public async advanceToNextStage(): Promise<{ success: boolean; error?: string; completed?: boolean; nextStage?: StudyStage }> {
    try {
      if (!this.currentStudyConfig) {
        return { success: false, error: 'No active study session' };
      }

      if (this.currentStudyConfig.isCompleted) {
        return { success: false, error: 'Study already completed' };
      }

      // Flush telemetry from current stage
      const telemetryService = TelemetryService.getInstance(this.context);
      await telemetryService.flushAll();
      // Advance stage index
      this.currentStudyConfig.currentStageIndex++;

      // Check if study is completed
      if (this.currentStudyConfig.currentStageIndex >= this.currentStudyConfig.stages.length) {
        this.currentStudyConfig.isCompleted = true;
        this.isStudyActive = false;
        await this.saveStudyState();
        return { success: true, completed: true };
      }

      // Get next stage
      const nextStage = this.currentStudyConfig.stages[this.currentStudyConfig.currentStageIndex];

      // Update telemetry context for next stage
      telemetryService.setStudyContext({
        isStudyMode: true,
        participantId: this.currentStudyConfig.participantId,
        datasetSlug: nextStage.datasetSlug,
        conditionCode: nextStage.conditionCode
      });

      // Restart session for new stage
      telemetryService.restartSession();

      // Save updated configuration
      await this.saveStudyState();
      return { success: true, nextStage, completed: false };

    } catch (error) {
      console.error(`[StudyApplicationController] Failed to advance to next stage:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Switch to the workspace for current stage
   */
  public async switchToCurrentStageWorkspace(): Promise<{ success: boolean; error?: string }> {
    try {
      const currentStage = this.getCurrentStage();
      if (!currentStage) {
        return { success: false, error: 'No current stage available' };
      }
      console.log('[dataset-bug] switchToCurrentStageWorkspace: stage', {
        datasetSlug: currentStage.datasetSlug,
        conditionCode: currentStage.conditionCode,
        workspacePath: currentStage.workspacePath,
        stageIndex: (currentStage as any).stageIndex
      });

      // Update study workspace context (prefixes keys per dataset+condition)
      try {
        const mgr = (require('./StudyWorkspaceManager') as typeof import('./StudyWorkspaceManager')).StudyWorkspaceManager.getInstance(this.context);
        mgr.updateStudyContext({
          isStudyMode: true,
          participantId: currentStage.participantId,
          datasetSlug: currentStage.datasetSlug,
          conditionCode: currentStage.conditionCode
        });
      } catch {}

      // Interstitial stages (survey/review) do not require workspace switches
      if ((currentStage as any).stageType && (currentStage as any).stageType !== 'task') {
        return { success: true };
      }

      // Resolve workspace path to tolerate .user_study vs .user-study differences
      let targetWorkspacePath = currentStage.workspacePath;
      if (!fs.existsSync(targetWorkspacePath)) {
        const alt = targetWorkspacePath.includes('.user_study')
          ? targetWorkspacePath.replace('.user_study', '.user-study')
          : targetWorkspacePath.replace('.user-study', '.user_study');
        if (fs.existsSync(alt)) {
          targetWorkspacePath = alt;
        }
      }
      const workspaceManager = ActiveWorkspaceManager.getInstance(this.context);

      // Validate required study dataset folder exists; do not create silently
      if (!fs.existsSync(targetWorkspacePath)) {
        return { success: false, error: `Study dataset folder not found: ${targetWorkspacePath}. Expected .user_study/.user-study <dataset> with CSV.` };
      }

      // Ensure only internal scaffold (.meridian) exists inside an existing dataset folder
      workspaceManager.ensureMeridianScaffold(targetWorkspacePath);

      // Set active workspace
      await workspaceManager.setActiveWorkspacePath(targetWorkspacePath);
      console.log('[dataset-bug] ActiveWorkspaceManager.setActiveWorkspacePath ->', targetWorkspacePath);

      // Update telemetry paths
      const telemetryService = TelemetryService.getInstance(this.context);
      telemetryService.refreshPathsFromActiveWorkspace(false);

      // Initialize checkpoint service for new workspace
      const checkpointService = AnaletCheckpointService.getInstance();
      await checkpointService.initialize(targetWorkspacePath);
      console.log('[dataset-bug] CheckpointService initialized at', targetWorkspacePath);

      // Track first-visit per participant/dataset/condition to prefer template restore on initial load
      const visitKey = `study:first-visit:${currentStage.participantId}:${currentStage.datasetSlug}:${currentStage.conditionCode}`;
      const hasVisited = !!this.context.globalState.get<boolean>(visitKey);
      let appliedTemplate = false;

      // Proactively clear previous dataset if it doesn't match this stage
      try {
        const stateService = StateManagementService.getInstance(this.context);
        const before = await stateService.loadDataset();
        console.log('[dataset-bug] pre-switch dataset (before ensure)', { name: before?.datasetInfo?.name });
        if (before?.datasetInfo && before.datasetInfo.name !== currentStage.datasetSlug) {
          console.log('[dataset-bug] clearing previous dataset due to mismatch', { prev: before.datasetInfo.name, expected: currentStage.datasetSlug });
          await stateService.clearDataset();
        }
      } catch (e) {
        console.warn('[dataset-bug] failed to clear mismatched dataset', e);
      }

      // Helper: ensure dataset info is saved for this stage (try study.json datasetCsv, then default mapping, then quick actions)
      const ensureDatasetForStage = async () => {
        try {
          const stateService = StateManagementService.getInstance(this.context);
          const ds = await stateService.loadDataset();
          if (ds?.datasetInfo) {
            // If profile is missing, attempt to compute it using CSV on disk
            if (!ds.datasetProfile) {
              try {
                const { DatasetSummarizerService } = await import('./DatasetSummarizerService');
                const summarizerService = DatasetSummarizerService.getInstance();
                // Resolve absolute CSV path
                const meta: any = ds.metadata || {};
                let absPath: string | undefined = meta.absoluteFilePath || meta.filePath;
                if (!absPath) {
                  const fp = (ds.datasetInfo as any)?.filePath as string | undefined;
                  if (fp) {
                    absPath = path.isAbsolute(fp) ? fp : path.join(targetWorkspacePath, fp);
                  }
                }
                if (!absPath) {
                  // Try common locations
                  const canonical = path.join(targetWorkspacePath, currentStage.datasetSlug, `${currentStage.datasetSlug}.csv`);
                  const fallback = path.join(targetWorkspacePath, `${currentStage.datasetSlug}.csv`);
                  absPath = fs.existsSync(canonical) ? canonical : (fs.existsSync(fallback) ? fallback : undefined);
                }
                if (absPath && fs.existsSync(absPath)) {
                  const profile = await summarizerService.analyzeCSVFile(absPath);
                  const info = summarizerService.getDatasetInfo() || ds.datasetInfo;
                  (info as any).filePath = path.basename(absPath);
                  await stateService.saveDataset(info as any, profile as any, { source: 'file_path', filePath: absPath, absoluteFilePath: absPath } as any);
                  console.log('[dataset-bug] ensureDatasetForStage: computed missing profile', { name: info?.name, absPath });
                }
              } catch (e) {
                console.warn('[dataset-bug] ensureDatasetForStage: failed to compute missing profile', e);
              }
            }
            return true;
          }
          const ensured = await this.inferAndSaveDatasetForStage(targetWorkspacePath, currentStage.datasetSlug);
          console.log('[dataset-bug] ensureDatasetForStage result', { ensured, datasetSlug: currentStage.datasetSlug, path: targetWorkspacePath });
          return ensured;
        } catch { return false; }
      };

      // Priority 0: If study.json declares a template checkpoint, restore from it (first visit preference)
      try {
        if (!hasVisited) {
        const studyJsonRoot = path.join(targetWorkspacePath, 'study.json');
        const studyJsonDot = path.join(targetWorkspacePath, '.meridian', 'study.json');
        const studyPath = fs.existsSync(studyJsonRoot) ? studyJsonRoot : (fs.existsSync(studyJsonDot) ? studyJsonDot : '');
        let templateRef: string | undefined;
        if (studyPath) {
          try {
            const raw = fs.readFileSync(studyPath, 'utf8');
            const studyMeta = JSON.parse(raw || '{}');
            // Support both correct and misspelled keys
            templateRef = (typeof studyMeta.from_template === 'string' && studyMeta.from_template) ||
                          (typeof studyMeta.from_tempalte === 'string' && studyMeta.from_tempalte) || undefined;
          } catch {}
        }
        if (templateRef) {
          const ckDir = path.join(targetWorkspacePath, '.meridian', 'checkpoints');
          let candidate: string | undefined;
          // Normalize a leading "/name.json" convention to be treated as workspace-relative
          const normalizedRef = templateRef.startsWith('/') ? templateRef.slice(1) : templateRef;
          // Only treat as absolute if it wasn't a leading-slash shorthand
          if (!templateRef.startsWith('/') && path.isAbsolute(templateRef) && fs.existsSync(templateRef)) {
            candidate = templateRef;
          } else {
            // Try relative to workspace root
            const relFromRoot = path.join(targetWorkspacePath, normalizedRef);
            if (fs.existsSync(relFromRoot)) {
              candidate = relFromRoot;
            } else {
              // Try under .meridian (in case a bare filename was provided)
              const relMeridian = path.join(targetWorkspacePath, '.meridian', normalizedRef);
              if (fs.existsSync(relMeridian)) {
                candidate = relMeridian;
              } else if (fs.existsSync(ckDir)) {
                // Treat as filename or identifier present under checkpoints
                const files = fs.readdirSync(ckDir).filter(f => f.endsWith('.json'));
                // Prefer exact filename match, else prefix template_ that includes the ref substring
                const exact = files.find(f => f === normalizedRef || f === `${normalizedRef}.json`);
                if (exact) {
                  candidate = path.join(ckDir, exact);
                } else {
                  const fuzzy = files
                    .filter(f => f.startsWith('template_') && f.includes(normalizedRef))
                    .map(f => ({ name: f, p: path.join(ckDir, f), m: fs.statSync(path.join(ckDir, f)).mtime }))
                    .sort((a, b) => b.m.getTime() - a.m.getTime());
                  if (fuzzy.length > 0) candidate = fuzzy[0].p;
                }
              }
            }
          }
          if (candidate && fs.existsSync(candidate)) {
            const raw = fs.readFileSync(candidate, 'utf8');
            const cp = JSON.parse(raw || '{}');
            const stateService = StateManagementService.getInstance(this.context);
            try { if (cp.dimensions) await stateService.saveDimensions(cp.dimensions, undefined); } catch {}
            try { if (cp.uiState) await stateService.saveUIState(cp.uiState); } catch {}
            try { if (cp.activeFilters) await stateService.saveActiveFilters(cp.activeFilters); } catch {}
            try { if (Array.isArray(cp.analets)) await stateService.saveAnalets(cp.analets); } catch {}
            // Attempt to refresh AnaletStore after restore
            try {
              const store = (require('./AnaletStore') as typeof import('./AnaletStore')).AnaletStore.getInstance(this.context);
              await store.loadFromStorage();
            } catch {}
            try { if (Array.isArray(cp.materializedAnaletIds)) await stateService.saveMaterializedAnalets(cp.materializedAnaletIds, undefined); } catch {}
            try { if (Array.isArray(cp.analetConstraints)) await stateService.saveAnaletConstraints(cp.analetConstraints); } catch {}
            try { if (Array.isArray(cp.notes)) await this.context.workspaceState.update('analysis-notes', cp.notes); } catch {}
            // Ensure dataset info is saved for this stage workspace
            try {
              const ds = await stateService.loadDataset();
              if (!ds?.datasetInfo) {
                const ensured = await this.inferAndSaveDatasetForStage(targetWorkspacePath, currentStage.datasetSlug);
                if (!ensured) {
                  await stateService.saveDataset({
                    name: currentStage.datasetSlug,
                    rowCount: 0,
                    columnCount: 0,
                    columns: [],
                    firstTwoRows: []
                  } as any, undefined, { source: 'manual' } as any);
                }
              }
            } catch {}
            try {
              const hasAnalets = Array.isArray(cp.analets) && cp.analets.length > 0;
              const hasDims = Array.isArray(cp.dimensions) && cp.dimensions.length > 0;
              const hasMat = Array.isArray(cp.materializedAnaletIds) && cp.materializedAnaletIds.length > 0;
              appliedTemplate = !!(hasAnalets || hasDims || hasMat);
            } catch { appliedTemplate = true; }
          }
        } else {
          // No from_template key; try common default filenames at first visit
          const defaults = ['template_checkpoint.json', 'template_map.json', 'template.json'];
          for (const name of defaults) {
            const cand1 = path.join(targetWorkspacePath, name);
            const cand2 = path.join(targetWorkspacePath, '.meridian', name);
            const candidate = fs.existsSync(cand1) ? cand1 : (fs.existsSync(cand2) ? cand2 : '');
            if (candidate) {
              try {
                const raw = fs.readFileSync(candidate, 'utf8');
                const cp = JSON.parse(raw || '{}');
                const stateService = StateManagementService.getInstance(this.context);
                try { if (cp.dimensions) await stateService.saveDimensions(cp.dimensions, undefined); } catch {}
                try { if (cp.uiState) await stateService.saveUIState(cp.uiState); } catch {}
                try { if (cp.activeFilters) await stateService.saveActiveFilters(cp.activeFilters); } catch {}
                try { if (Array.isArray(cp.analets)) await stateService.saveAnalets(cp.analets); } catch {}
                try {
                  const store = (require('./AnaletStore') as typeof import('./AnaletStore')).AnaletStore.getInstance(this.context);
                  await store.loadFromStorage();
                } catch {}
                try { if (Array.isArray(cp.materializedAnaletIds)) await stateService.saveMaterializedAnalets(cp.materializedAnaletIds, undefined); } catch {}
                try { if (Array.isArray(cp.analetConstraints)) await stateService.saveAnaletConstraints(cp.analetConstraints); } catch {}
                try { if (Array.isArray(cp.notes)) await this.context.workspaceState.update('analysis-notes', cp.notes); } catch {}
                try {
                  const hasAnalets = Array.isArray(cp.analets) && cp.analets.length > 0;
                  const hasDims = Array.isArray(cp.dimensions) && cp.dimensions.length > 0;
                  const hasMat = Array.isArray(cp.materializedAnaletIds) && cp.materializedAnaletIds.length > 0;
                  appliedTemplate = !!(hasAnalets || hasDims || hasMat);
                } catch { appliedTemplate = true; }
                break;
              } catch {}
            }
          }
        }
        }
      } catch (e) {
        console.warn('[StudyApplicationController] Template checkpoint auto-restore skipped:', e);
      }

      // After template attempt, ensure dataset info is present
      try { await ensureDatasetForStage(); } catch {}

      // If a template was applied on first visit, persist an immediate load_ checkpoint for this stage
      try {
        if (appliedTemplate) {
          const stateService = StateManagementService.getInstance(this.context);
          const cp = await checkpointService.createCheckpointFromState(stateService, 'Auto-checkpoint after template restore');
          const dir = path.join(targetWorkspacePath, '.meridian', 'checkpoints');
          const fs = require('fs');
          const oldPath = path.join(dir, `${cp.id}.json`);
          const newPath = path.join(dir, `load_${cp.id}.json`);
          try { fs.renameSync(oldPath, newPath); } catch {}
        }
      } catch (e) {
        console.warn('[StudyApplicationController] Failed to save post-template load_ checkpoint:', e);
      }

      // Priority 1: Auto-restore any 'load_' checkpoint in this workspace
      try {
        let restoredLoad = false;
        let createdInitialLoad = false;
        // If a template has been applied on first visit, skip load_ on initial entry
        if (!appliedTemplate) {
          const ckDir = path.join(targetWorkspacePath, '.meridian', 'checkpoints');
          if (fs.existsSync(ckDir)) {
            const files = fs.readdirSync(ckDir)
              .filter(f => f.startsWith('load_') && f.endsWith('.json'))
              .map(f => ({ name: f, path: path.join(ckDir, f), mtime: fs.statSync(path.join(ckDir, f)).mtime }))
              .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            if (files.length > 0) {
              const loadFile = files[0].path;
              const raw = fs.readFileSync(loadFile, 'utf8');
              const cp = JSON.parse(raw);
              const stateService = StateManagementService.getInstance(this.context);
              // Ensure dataset is loaded (CSV fallback below will handle if not yet loaded)
              if (cp.dimensions || cp.dimensionMetadata) {
                try { await stateService.saveDimensions(cp.dimensions || [], cp.dimensionMetadata); } catch {}
              }
              if (cp.uiState) {
                try { await stateService.saveUIState(cp.uiState); } catch {}
              }
              if (cp.activeFilters) {
                try { await stateService.saveActiveFilters(cp.activeFilters); } catch {}
              }
              if (Array.isArray(cp.analets)) {
                await stateService.saveAnalets(cp.analets);
                // Keep AnaletStore in sync after restore
                try {
                  const store = (require('./AnaletStore') as typeof import('./AnaletStore')).AnaletStore.getInstance(this.context);
                  await store.loadFromStorage();
                } catch {}
              }
              // Restore extended state similar to template restore
              try { if (Array.isArray(cp.materializedAnaletIds)) await stateService.saveMaterializedAnalets(cp.materializedAnaletIds, undefined); } catch {}
              try { if (Array.isArray(cp.analetConstraints)) await stateService.saveAnaletConstraints(cp.analetConstraints); } catch {}
              try { if (Array.isArray(cp.notes)) await this.context.workspaceState.update('analysis-notes', cp.notes); } catch {}
              // Ensure dataset info is saved for this stage workspace
              try {
                const ds = await stateService.loadDataset();
                if (!ds?.datasetInfo) {
                  const ensured = await this.inferAndSaveDatasetForStage(targetWorkspacePath, currentStage.datasetSlug);
                  if (!ensured) {
                    await stateService.saveDataset({
                      name: currentStage.datasetSlug,
                      rowCount: 0,
                      columnCount: 0,
                      columns: [],
                      firstTwoRows: []
                    } as any, undefined, { source: 'manual' } as any);
                  }
                }
              } catch {}
              restoredLoad = true;
            }
            // If no existing load_ and we didn't restore a template, create an initial one now
            if (!restoredLoad && files.length === 0) {
              try {
                const stateService = StateManagementService.getInstance(this.context);
                const cp = await checkpointService.createCheckpointFromState(stateService, 'Initial load checkpoint');
                const oldPath = path.join(ckDir, `${cp.id}.json`);
                const newPath = path.join(ckDir, `load_${cp.id}.json`);
                try { fs.renameSync(oldPath, newPath); } catch {}
                createdInitialLoad = true;
              } catch {}
            }
          }
        }
        // Mark visit only if we actually applied template, restored load, or created an initial load
        if (!hasVisited && (appliedTemplate || restoredLoad || createdInitialLoad)) {
          try { await this.context.globalState.update(visitKey, true); } catch {}
        }
      } catch (e) {
        console.warn('[StudyApplicationController] Auto-restore load_ checkpoint failed:', e);
      }

      // Ensure dataset after load_ restore
      try { await ensureDatasetForStage(); } catch {}

      // Priority 2: If no analets present, try from_template again (even if visited), then fallback to latest template_*
      try {
        const stateService = StateManagementService.getInstance(this.context);
        const loaded = await stateService.loadDataset();
        const haveAnalets = (await stateService.getAnalets?.())?.length > 0;
        const ckDir = path.join(targetWorkspacePath, '.meridian', 'checkpoints');
        if (!haveAnalets) {
          // Try study.json from_template again even if visited
          try {
            const studyJsonRoot = path.join(targetWorkspacePath, 'study.json');
            const studyJsonDot = path.join(targetWorkspacePath, '.meridian', 'study.json');
            const studyPath = fs.existsSync(studyJsonRoot) ? studyJsonRoot : (fs.existsSync(studyJsonDot) ? studyJsonDot : '');
            if (studyPath) {
              try {
                const raw = fs.readFileSync(studyPath, 'utf8');
                const studyMeta = JSON.parse(raw || '{}');
                const templateRef = (typeof studyMeta.from_template === 'string' && studyMeta.from_template) || (typeof studyMeta.from_tempalte === 'string' && studyMeta.from_tempalte) || '';
                if (templateRef) {
                  const normalizedRef = templateRef.startsWith('/') ? templateRef.slice(1) : templateRef;
                  let candidate: string | undefined;
                  if (!templateRef.startsWith('/') && path.isAbsolute(templateRef) && fs.existsSync(templateRef)) {
                    candidate = templateRef;
                  } else {
                    const relFromRoot = path.join(targetWorkspacePath, normalizedRef);
                    if (fs.existsSync(relFromRoot)) candidate = relFromRoot; else {
                      const relMeridian = path.join(targetWorkspacePath, '.meridian', normalizedRef);
                      if (fs.existsSync(relMeridian)) candidate = relMeridian;
                    }
                  }
                  if (candidate && fs.existsSync(candidate)) {
                    const traw = fs.readFileSync(candidate, 'utf8');
                    const cp = JSON.parse(traw || '{}');
                    try { await stateService.saveDimensions(cp.dimensions || [], cp.dimensionMetadata); } catch {}
                    try { if (cp.uiState) await stateService.saveUIState(cp.uiState); } catch {}
                    try { if (cp.activeFilters) await stateService.saveActiveFilters(cp.activeFilters); } catch {}
                    try { if (Array.isArray(cp.analets)) await stateService.saveAnalets(cp.analets); } catch {}
                    try {
                      const store = (require('./AnaletStore') as typeof import('./AnaletStore')).AnaletStore.getInstance(this.context);
                      await store.loadFromStorage();
                    } catch {}
                    try { if (Array.isArray(cp.materializedAnaletIds)) await stateService.saveMaterializedAnalets(cp.materializedAnaletIds, undefined); } catch {}
                    try { if (Array.isArray(cp.analetConstraints)) await stateService.saveAnaletConstraints(cp.analetConstraints); } catch {}
                    try { if (Array.isArray(cp.notes)) await this.context.workspaceState.update('analysis-notes', cp.notes); } catch {}
                    // After applying from_template on fallback, also create a load_ for future returns
                    try {
                      const checkpointService = AnaletCheckpointService.getInstance();
                      await checkpointService.initialize(targetWorkspacePath);
                      const cp2 = await checkpointService.createCheckpointFromState(stateService, 'Auto-checkpoint after fallback template restore');
                      const oldPath = path.join(targetWorkspacePath, '.meridian', 'checkpoints', `${cp2.id}.json`);
                      const newPath = path.join(targetWorkspacePath, '.meridian', 'checkpoints', `load_${cp2.id}.json`);
                      try { fs.renameSync(oldPath, newPath); } catch {}
                    } catch {}
                    // Template restore done; proceed with remaining initialization without early return
                  }
                }
              } catch {}
            }
          } catch {}
          // Fallback to latest template_*.json in checkpoints
          if (fs.existsSync(ckDir)) {
            const files = fs.readdirSync(ckDir)
              .filter(f => f.startsWith('template_') && f.endsWith('.json'))
              .map(f => ({ name: f, p: path.join(ckDir, f), m: fs.statSync(path.join(ckDir, f)).mtime }))
              .sort((a, b) => b.m.getTime() - a.m.getTime());
            if (files.length > 0) {
              const raw2 = fs.readFileSync(files[0].p, 'utf8');
              const cp = JSON.parse(raw2 || '{}');
              try { await stateService.saveDimensions(cp.dimensions || [], cp.dimensionMetadata); } catch {}
              try { if (cp.uiState) await stateService.saveUIState(cp.uiState); } catch {}
              try { if (cp.activeFilters) await stateService.saveActiveFilters(cp.activeFilters); } catch {}
              try { if (Array.isArray(cp.analets)) await stateService.saveAnalets(cp.analets); } catch {}
              try {
                const store = (require('./AnaletStore') as typeof import('./AnaletStore')).AnaletStore.getInstance(this.context);
                await store.loadFromStorage();
              } catch {}
              try { if (Array.isArray(cp.materializedAnaletIds)) await stateService.saveMaterializedAnalets(cp.materializedAnaletIds, undefined); } catch {}
              try { if (Array.isArray(cp.analetConstraints)) await stateService.saveAnaletConstraints(cp.analetConstraints); } catch {}
              try { if (Array.isArray(cp.notes)) await this.context.workspaceState.update('analysis-notes', cp.notes); } catch {}
            }
          }
        }
      } catch (e) {
        console.warn('[StudyApplicationController] Fallback template_ checkpoint restore skipped:', e);
      }

      // Ensure dataset after template_ fallback
      try { await ensureDatasetForStage(); } catch {}

      // If there's a baseline checkpoint in this workspace, auto-restore it for smooth study onboarding
      try {
        const baseline = await checkpointService.readBaseline(targetWorkspacePath);
        if (baseline) {
          const stateService = StateManagementService.getInstance(this.context);
          // Build dataset info; resolve relative dataset path under dataset root
          const dsPath = baseline.dataset.path || '';
          const resolvedPath = path.isAbsolute(dsPath) ? dsPath : path.join(targetWorkspacePath, dsPath);
          const datasetInfo = {
            name: baseline.dataset.name || path.basename(resolvedPath),
            rowCount: baseline.dataset.rowCount || 0,
            columnCount: (baseline.dataset.columns || []).length,
            columns: baseline.dataset.columns || [],
            firstTwoRows: [],
            // Surface a workspace-relative path for UI display/use; keep absolute in metadata
            filePath: path.basename(resolvedPath)
          } as any;
          await stateService.saveDataset(datasetInfo, undefined, { source: 'file_path', filePath: resolvedPath, absoluteFilePath: resolvedPath } as any);
          if (baseline.dataDefinitions) {
            await stateService.saveDimensions(baseline.dataDefinitions.conceptAxes || [], baseline.dataDefinitions.dimensionMetadata || undefined);
          }
          await stateService.saveAnalets(baseline.analets || []);
          try {
            const store = (require('./AnaletStore') as typeof import('./AnaletStore')).AnaletStore.getInstance(this.context);
            await store.loadFromStorage();
          } catch {}
          try {
            await this.context.workspaceState.update('analysis-notes', baseline.notes || []);
          } catch {}
        }
      } catch (e) {
        console.warn('[StudyApplicationController] Baseline auto-restore skipped:', e);
      }

      // Fallback: if no baseline restore happened, try to ensure dataset is analyzed from CSV path
      try {
        const stateService = StateManagementService.getInstance(this.context);
        const loaded = await stateService.loadDataset();
        if (!loaded?.datasetInfo) {
          // Try reading study.json for datasetCsv
          let csvPath = '';
          try {
            const studyJsonRoot = path.join(targetWorkspacePath, 'study.json');
            const studyJsonDot = path.join(targetWorkspacePath, '.meridian', 'study.json');
            const studyPath = fs.existsSync(studyJsonRoot) ? studyJsonRoot : (fs.existsSync(studyJsonDot) ? studyJsonDot : '');
            if (studyPath) {
              const raw = fs.readFileSync(studyPath, 'utf8');
              const studyMeta = JSON.parse(raw || '{}');
              if (typeof studyMeta.datasetCsv === 'string' && studyMeta.datasetCsv.trim().length > 0) {
                csvPath = path.isAbsolute(studyMeta.datasetCsv)
                  ? studyMeta.datasetCsv
                  : path.join(targetWorkspacePath, studyMeta.datasetCsv);
              }
            }
          } catch {}

          // Fallback mapping
          if (!csvPath) {
            const csvMap: Record<string, string> = {
              vehicles: 'vehicles.csv',
              diamonds: 'diamonds.csv',
              listings: 'listings.csv'
            };
            csvPath = path.join(targetWorkspacePath, csvMap[currentStage.datasetSlug] || `${currentStage.datasetSlug}.csv`);
          }

          // If still missing, pick first CSV in folder (prefer one containing dataset slug)
          if (!fs.existsSync(csvPath)) {
            try {
              const entries = fs.readdirSync(targetWorkspacePath, { withFileTypes: true });
              const csvs = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.csv')).map(e => e.name);
              const preferred = csvs.find(n => n.toLowerCase().includes(currentStage.datasetSlug.toLowerCase())) || csvs[0];
              if (preferred) csvPath = path.join(targetWorkspacePath, preferred);
            } catch {}
          }

          if (csvPath && fs.existsSync(csvPath)) {
            const { DatasetSummarizerService } = await import('./DatasetSummarizerService');
            const summarizerService = DatasetSummarizerService.getInstance();
            await summarizerService.analyzeCSVFile(csvPath);
            const datasetInfo = summarizerService.getDatasetInfo();
            if (datasetInfo) {
              // Ensure UI sees a workspace-relative path
              (datasetInfo as any).filePath = path.basename(csvPath);
              await stateService.saveDataset(datasetInfo, undefined, {
                loadedAt: new Date().toISOString(),
                source: 'file_path',
                filePath: csvPath,
                absoluteFilePath: csvPath
              } as any);
            }
          }

          // If still no dataset loaded, consult quick actions for deeper CSVs
          const stillNone = !(await stateService.loadDataset())?.datasetInfo;
          if (stillNone) {
            try {
              const mgr = ActiveWorkspaceManager.getInstance(this.context);
              const quick = mgr.discoverQuickActions(targetWorkspacePath);
              const csvs: string[] = quick?.csvPaths || [];
              if (csvs.length > 0) {
                // Prefer CSVs with dataset slug in their path
                const preferred = csvs.find(p => p.toLowerCase().includes(String(currentStage.datasetSlug).toLowerCase())) || csvs[0];
                const { DatasetSummarizerService } = await import('./DatasetSummarizerService');
                const summarizerService = DatasetSummarizerService.getInstance();
                const profile = await summarizerService.analyzeCSVFile(preferred);
                const datasetInfo = summarizerService.getDatasetInfo();
                if (datasetInfo) {
                  (datasetInfo as any).filePath = path.basename(preferred);
                  await stateService.saveDataset(datasetInfo, profile as any, {
                    loadedAt: new Date().toISOString(),
                    source: 'file_path',
                    filePath: preferred,
                    absoluteFilePath: preferred
                  } as any);
                }
              }
            } catch (e) {
              console.warn('[StudyApplicationController] Quick actions CSV load failed:', e);
            }
          }
        }
      } catch (e) {
        console.warn('[StudyApplicationController] Fallback CSV analyze failed:', e);
      }

      // Update study configuration in dataset folder
      const studyConfigService = StudyConfigurationService.getInstance(this.context);
      // Compute 1-based order index among task stages
      let orderIdx: number | undefined = undefined;
      try {
        const cfg = this.getCurrentStudyConfig();
        const tasks = (cfg?.stages || []).filter(s => (s as any).stageType === 'task');
        const idx = tasks.findIndex(s => s.workspacePath === currentStage.workspacePath);
        if (idx >= 0) orderIdx = idx + 1;
      } catch {}
      const currentConfig = this.getCurrentStudyConfig();
      studyConfigService.writeConfig({
        participantId: currentStage.participantId,
        participantLabel: `P${currentStage.participantId}`,
        dataset: currentStage.datasetSlug,
        condition: currentStage.conditionCode.toLowerCase() as 'map' | 'tree' | 'canvas',
        conditionCode: this.mapConditionToCode(currentStage.conditionCode),
        order: orderIdx,
        conditionOrder: currentConfig?.studyMetadata?.conditionOrder,
        datasetOrder: currentConfig?.studyMetadata?.datasetOrder
      });
      return { success: true };

    } catch (error) {
      console.error(`[StudyApplicationController] Failed to switch to stage workspace:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Reset/end current study
   */
  public async resetStudy(): Promise<void> {
    // Flush any remaining telemetry
    try {
      const telemetryService = TelemetryService.getInstance(this.context);
      await telemetryService.flushAll();
      telemetryService.setStudyContext({ isStudyMode: false });
    } catch (error) {
      console.warn('Failed to flush telemetry during study reset:', error);
    }

    // Clear study state
    this.currentStudyConfig = null;
    this.isStudyActive = false;
    await this.clearStudyState();
  }

  /**
   * Get participant mapping or create default
   */
  private getParticipantMapping(participantId: number): ParticipantMapping {
    // Find mapping for base schedule; preserve the unique participantId
    const baseMapping = this.participantMappings.find(m => m.participantId === participantId);
    if (baseMapping) {
      // Already in base table; return as-is
      return baseMapping;
    }
    // Runover: derive condition/dataset order from normalized participant index,
    // but keep the original participantId to avoid label/id mismatches (e.g., P15 → id 15)
    const baseSize = this.participantMappings.length; // 9
    const normalizedId = ((participantId - 1) % baseSize) + 1;
    const normalized = this.participantMappings.find(m => m.participantId === normalizedId);
    const conditionOrder = normalized?.conditionOrder || 'MapCanvasTree';
    const datasetOrder = normalized?.datasetOrder || 'XYZ';
    return { participantId, conditionOrder, datasetOrder };
  }

  /**
   * Generate comprehensive all_study.json configuration
   */
  private generateAllStudyConfig(mapping: ParticipantMapping): AllStudyConfig {
    const stages: StudyStage[] = [];
    const conditions = this.parseConditionOrder(mapping.conditionOrder);
    const datasets = this.parseDatasetOrder(mapping.datasetOrder);

    // Resolve study datasets base directory: prefer existing path among .user_study or .user-study
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const underscore = path.join(root, '.user_study');
    const hyphen = path.join(root, '.user-study');
    const baseWorkspacePath = fs.existsSync(underscore)
      ? underscore
      : (fs.existsSync(hyphen) ? hyphen : underscore);

    let stageIndex = 0;
    // One-to-one pairing of dataset and condition by position
    const pairCount = Math.min(datasets.length, conditions.length);

    // Build alternating sequence: task -> survey for each pair, then final review
    for (let i = 0; i < pairCount; i++) {
      const dataset = datasets[i];
      const condition = conditions[i];

      // Workspace path for this stage = dataset folder under study base
      const workspacePath = path.join(baseWorkspacePath, dataset);

      // Create checkpoint path (baseline checkpoint)
      const checkpointPath = path.join(workspacePath, '.meridian', 'checkpoint.json');

      // Task stage (actual condition work)
      stages.push({
        id: `stage_${stageIndex}`,
        stageType: 'task',
        participantId: mapping.participantId,
        datasetSlug: dataset,
        conditionCode: condition,
        workspacePath,
        checkpointPath: fs.existsSync(checkpointPath) ? checkpointPath : undefined,
        instrumentationEnabled: TelemetryService.getInstance(this.context).isInstrumentationActive(),
        stageIndex,
        totalStages: 0 // placeholder; will set after array is complete
      });
      stageIndex++;

      // Survey stage (interstitial page/link)
      stages.push({
        id: `stage_${stageIndex}`,
        stageType: 'survey',
        participantId: mapping.participantId,
        datasetSlug: dataset,
        conditionCode: condition,
        workspacePath, // keep same for reference; no switch needed
        checkpointPath: undefined,
        instrumentationEnabled: false,
        stageIndex,
        totalStages: 0
      });
      stageIndex++;
    }

    // Final review stage after the last survey
    if (pairCount > 0) {
      const lastDataset = datasets[pairCount - 1];
      const lastCondition = conditions[pairCount - 1];
      const workspacePath = path.join(baseWorkspacePath, lastDataset);
      stages.push({
        id: `stage_${stageIndex}`,
        stageType: 'review',
        participantId: mapping.participantId,
        datasetSlug: lastDataset,
        conditionCode: lastCondition,
        workspacePath,
        checkpointPath: undefined,
        instrumentationEnabled: false,
        stageIndex,
        totalStages: 0
      });
    }

    // Fill totalStages now that we know final length
    const totalStages = stages.length;
    for (let i = 0; i < stages.length; i++) {
      (stages[i] as any).totalStages = totalStages;
      (stages[i] as any).stageIndex = i; // ensure accurate index after insertions
    }

    return {
      participantId: mapping.participantId,
      stages,
      currentStageIndex: 0,
      sessionStartTime: new Date().toISOString(),
      studyMetadata: {
        conditionOrder: mapping.conditionOrder,
        datasetOrder: mapping.datasetOrder
      },
      isCompleted: false
    };
  }

  /**
   * Parse condition order string into array
   */
  private parseConditionOrder(conditionOrder: string): ('Map' | 'Tree' | 'Canvas')[] {
    // Parse strings like 'MapTreeCanvas' into ['Map', 'Tree', 'Canvas']
    const conditions: ('Map' | 'Tree' | 'Canvas')[] = [];

    if (conditionOrder.includes('Map')) conditions.push('Map');
    if (conditionOrder.includes('Tree')) conditions.push('Tree');
    if (conditionOrder.includes('Canvas')) conditions.push('Canvas');

    // If the order matters, parse it properly
    const orderMapping: Record<string, ('Map' | 'Tree' | 'Canvas')[]> = {
      'MapTreeCanvas': ['Map', 'Tree', 'Canvas'],
      'MapCanvasTree': ['Map', 'Canvas', 'Tree'],
      'TreeMapCanvas': ['Tree', 'Map', 'Canvas'],
      'TreeCanvasMap': ['Tree', 'Canvas', 'Map'],
      'CanvasMapTree': ['Canvas', 'Map', 'Tree'],
      'CanvasTreeMap': ['Canvas', 'Tree', 'Map']
    };

    return orderMapping[conditionOrder] || ['Map', 'Tree', 'Canvas'];
  }

  /**
   * Parse dataset order string into array
   */
  private parseDatasetOrder(datasetOrder: string): ('vehicles' | 'diamonds' | 'listings')[] {
    // Map X, Y, Z to actual datasets
    const datasetMapping: Record<string, 'vehicles' | 'diamonds' | 'listings'> = {
      'X': 'vehicles',
      'Y': 'diamonds',
      'Z': 'listings'
    };

    return datasetOrder.split('').map(letter => datasetMapping[letter as 'X'|'Y'|'Z'] || 'vehicles') as any;
  }

  /**
   * Write per-workspace study.json files with dataset metadata (at root and under .meridian)
   */
  private writeWorkspaceStudyFiles(config: AllStudyConfig): void {
    try {
      const csvMap: Record<'vehicles'|'diamonds'|'listings'|'cars'|'houses', string> = {
        vehicles: 'vehicles.csv',
        diamonds: 'diamonds.csv',
        listings: 'listings.csv',
        cars: 'cars.csv',
        houses: 'houses.csv'
      } as any;
      const seen = new Set<string>();
      // Precompute order (1..3) per workspace from task stages
      const taskStages = config.stages.filter(s => (s as any).stageType === 'task');
      const orderByWorkspace = new Map<string, number>();
      taskStages.forEach((s, i) => orderByWorkspace.set(s.workspacePath, i + 1));
      // Precompute condition (name + code) per workspace from task stages
      const conditionByWorkspace = new Map<string, { name: 'map' | 'tree' | 'canvas'; code: 'A' | 'B' | 'C' }>();
      const nameMap: Record<'Map' | 'Tree' | 'Canvas', 'map' | 'tree' | 'canvas'> = {
        Map: 'map',
        Tree: 'tree',
        Canvas: 'canvas'
      };
      taskStages.forEach((s) => {
        const cond = (s as any).conditionCode as 'Map' | 'Tree' | 'Canvas';
        const code = this.mapConditionToCode(cond);
        const name = nameMap[cond];
        conditionByWorkspace.set(s.workspacePath, { name, code });
      });
      for (const stage of config.stages) {
        if (seen.has(stage.workspacePath)) continue;
        seen.add(stage.workspacePath);
        const meridianDir = path.join(stage.workspacePath, '.meridian');
        try { fs.mkdirSync(meridianDir, { recursive: true }); } catch {}
        const cond = conditionByWorkspace.get(stage.workspacePath);
        const studyMeta = {
          participantId: config.participantId,
          participantLabel: (config as any).participantLabel,
          datasetSlug: stage.datasetSlug,
          datasetCsv: csvMap[stage.datasetSlug] || `${stage.datasetSlug}.csv`,
          order: orderByWorkspace.get(stage.workspacePath),
          // Condition info for this workspace (lowercase name and A/B/C code)
          condition: cond?.name,
          conditionCode: cond?.code,
          // Template checkpoint reference for initial workspace restore
          from_template: '/template_checkpoint.json'
        };
        try {
          fs.writeFileSync(path.join(stage.workspacePath, 'study.json'), JSON.stringify(studyMeta, null, 2));
        } catch (e) {
          console.warn('[StudyApplicationController] Failed to write root study.json for', stage.workspacePath, e);
        }
        try {
          fs.writeFileSync(path.join(meridianDir, 'study.json'), JSON.stringify(studyMeta, null, 2));
        } catch (e) {
          console.warn('[StudyApplicationController] Failed to write .meridian/study.json for', stage.workspacePath, e);
        }
      }
    } catch (e) {
      console.warn('[StudyApplicationController] writeWorkspaceStudyFiles failed', e);
    }
  }

  /**
   * Map condition to code (A, B, C)
   */
  private mapConditionToCode(condition: 'Map' | 'Tree' | 'Canvas'): 'A' | 'B' | 'C' {
    // Schedule key: A=Map, B=Canvas, C=Tree
    const mapping = { 'Map': 'A', 'Canvas': 'B', 'Tree': 'C' } as const;
    return mapping[condition];
  }

  /**
   * Save study state to VS Code workspace state
   */
  private async saveStudyState(): Promise<void> {
    try {
      await this.context.workspaceState.update('meridian.study.config', this.currentStudyConfig);
      await this.context.workspaceState.update('meridian.study.active', this.isStudyActive);
    } catch (error) {
      console.error('[StudyApplicationController] Failed to save study state:', error);
    }
  }

  /**
   * Load study state from VS Code workspace state
   */
  private loadStudyState(): void {
    try {
      this.currentStudyConfig = this.context.workspaceState.get('meridian.study.config', null);
      this.isStudyActive = this.context.workspaceState.get('meridian.study.active', false);

      this.currentStudyConfig;
    } catch (error) {
      console.error('[StudyApplicationController] Failed to load study state:', error);
      this.currentStudyConfig = null;
      this.isStudyActive = false;
    }
  }

  /**
   * Clear study state from VS Code workspace state
   */
  private async clearStudyState(): Promise<void> {
    try {
      await this.context.workspaceState.update('meridian.study.config', undefined);
      await this.context.workspaceState.update('meridian.study.active', undefined);
    } catch (error) {
      console.error('[StudyApplicationController] Failed to clear study state:', error);
    }
  }

  /**
   * Get progress information
   */
  public getProgressInfo(): { currentStage: number; totalStages: number; isCompleted: boolean } | null {
    if (!this.currentStudyConfig) {
      return null;
    }

    return {
      currentStage: this.currentStudyConfig.currentStageIndex + 1,
      totalStages: this.currentStudyConfig.stages.length,
      isCompleted: this.currentStudyConfig.isCompleted
    };
  }

  /**
   * Get session restore information
   */
  public getSessionRestoreInfo(): {
    canRestore: boolean;
    participantCode: string | null;
    currentStage: number | null;
    totalStages: number | null;
    lastAccessTime: string | null;
  } {
    if (!this.currentStudyConfig || !this.isStudyActive || this.currentStudyConfig.isCompleted) {
      return {
        canRestore: false,
        participantCode: null,
        currentStage: null,
        totalStages: null,
        lastAccessTime: null
      };
    }

    return {
      canRestore: true,
      participantCode: this.currentStudyConfig.participantLabel || `P${this.currentStudyConfig.participantId}`,
      currentStage: this.currentStudyConfig.currentStageIndex + 1,
      totalStages: this.currentStudyConfig.stages.length,
      lastAccessTime: this.currentStudyConfig.sessionStartTime
    };
  }

  /**
   * Jump directly to a stage by index (0-based)
   */
  public async gotoStage(index: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.currentStudyConfig || !this.isStudyActive) {
        return { success: false, error: 'No active study session' };
      }
      if (index < 0 || index >= this.currentStudyConfig.stages.length) {
        return { success: false, error: 'Invalid stage index' };
      }
      this.currentStudyConfig.currentStageIndex = index;
      await this.saveStudyState();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * Restore study session (switch to current stage workspace)
   */
  public async restoreStudySession(): Promise<{ success: boolean; error?: string; stage?: StudyStage }> {
    try {
      if (!this.isStudyInProgress()) {
        return { success: false, error: 'No active study session to restore' };
      }

      const currentStage = this.getCurrentStage();
      if (!currentStage) {
        return { success: false, error: 'No current stage to restore to' };
      }
      // Switch to current stage workspace
      const switchResult = await this.switchToCurrentStageWorkspace();
      if (!switchResult.success) {
        return { success: false, error: switchResult.error };
      }

      // Update telemetry context for restored stage
      const telemetryService = TelemetryService.getInstance(this.context);
      telemetryService.setStudyContext({
        isStudyMode: true,
        participantId: this.currentStudyConfig!.participantId,
        datasetSlug: currentStage.datasetSlug,
        conditionCode: currentStage.conditionCode
      });
      return { success: true, stage: currentStage };

    } catch (error) {
      console.error(`[StudyApplicationController] Failed to restore study session:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Export current configuration as all_study.json
   */
  public async exportAllStudyJson(outputPath?: string): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      if (!this.currentStudyConfig) {
        return { success: false, error: 'No active study configuration to export' };
      }

      const defaultPath = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        'extension-test',
        `all_study_${(this.currentStudyConfig.participantLabel || ('p'+this.currentStudyConfig.participantId)).toString().replace(/[^a-zA-Z0-9-_]+/g,'_')}.json`
      );

      const exportPath = outputPath || defaultPath;

      // Ensure directory exists
      const exportDir = path.dirname(exportPath);
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      // Write configuration
      fs.writeFileSync(exportPath, JSON.stringify(this.currentStudyConfig, null, 2));
      return { success: true, path: exportPath };

    } catch (error) {
      console.error(`[StudyApplicationController] Failed to export study configuration:`, error);
      return { success: false, error: String(error) };
    }
  }
}
