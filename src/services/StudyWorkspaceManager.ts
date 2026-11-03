import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * StudyWorkspaceManager
 * - Manages per-dataset study workspace directories under {workspaceRoot}/user-study/{dataset}/
 * - Provides dataset-aware paths for logs and notebooks
 * - Maintains current study context for the extension side
 */
export class StudyWorkspaceManager {
  private static instance: StudyWorkspaceManager;
  private context: vscode.ExtensionContext | undefined;
  private workspaceRoot: string = '';
  private activeDatasetSlug: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses' | undefined;
  private isStudyMode: boolean = false;
  private participantId: number | undefined;
  private conditionCode: 'Map' | 'Tree' | 'Canvas' | undefined;

  private constructor() {}

  public static getInstance(context?: vscode.ExtensionContext): StudyWorkspaceManager {
    if (!StudyWorkspaceManager.instance) {
      StudyWorkspaceManager.instance = new StudyWorkspaceManager();
    }
    if (context) {
      StudyWorkspaceManager.instance.initialize(context);
    }
    return StudyWorkspaceManager.instance;
  }

  private initialize(context: vscode.ExtensionContext): void {
    if (this.context) return;
    this.context = context;
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || context.globalStorageUri.fsPath;
  }

  public updateStudyContext(context: {
    isStudyMode?: boolean;
    participantId?: number;
    datasetSlug?: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses';
    conditionCode?: 'Map' | 'Tree' | 'Canvas';
  }): void {
    if (typeof context.isStudyMode === 'boolean') this.isStudyMode = context.isStudyMode;
    if (typeof context.participantId === 'number') this.participantId = context.participantId;
    if (context.datasetSlug) this.activeDatasetSlug = context.datasetSlug;
    if (context.conditionCode) this.conditionCode = context.conditionCode;
    if (this.isStudyMode && this.activeDatasetSlug) {
      this.ensureStudyDirectories();
    }
  }

  public isStudyModeActive(): boolean {
    return this.isStudyMode === true;
  }

  /**
   * Check if the current dataset workspace has a template checkpoint configured or present
   */
  public hasTemplateCheckpoint(): boolean {
    try {
      const root = this.getDatasetRoot();
      // Check study.json for from_template
      const studyJsonRoot = path.join(root, 'study.json');
      const studyJsonDot = path.join(root, '.meridian', 'study.json');
      const studyPath = fs.existsSync(studyJsonRoot) ? studyJsonRoot : (fs.existsSync(studyJsonDot) ? studyJsonDot : '');
      if (studyPath) {
        try {
          const raw = fs.readFileSync(studyPath, 'utf8');
          const meta = JSON.parse(raw || '{}');
          if (typeof meta.from_template === 'string' && meta.from_template.trim().length > 0) {
            return true;
          }
        } catch {}
      }
      // Check for any template_*.json in checkpoints
      const ckDir = path.join(root, '.meridian', 'checkpoints');
      if (fs.existsSync(ckDir)) {
        const hasTemplate = fs.readdirSync(ckDir).some(f => f.startsWith('template_') && f.endsWith('.json'));
        if (hasTemplate) return true;
      }
    } catch {}
    return false;
  }

  public setActiveDataset(datasetSlug: 'vehicles' | 'diamonds' | 'listings' | 'cars' | 'houses'): void {
    this.activeDatasetSlug = datasetSlug;
    if (this.isStudyMode) this.ensureStudyDirectories();
  }

  public getDatasetRoot(): string {
    if (!this.isStudyMode || !this.activeDatasetSlug) {
      return this.workspaceRoot;
    }
    // Study dataset root under .user-study/{dataset}
    const base = path.join(this.workspaceRoot, '.user-study', this.activeDatasetSlug);
    // Do NOT include condition subfolder; stage changes are dataset-level
    return base;
  }

  public getLogsDir(): string {
    if (!this.isStudyMode || !this.activeDatasetSlug) {
      return path.join(this.workspaceRoot, 'logs', 'sessions');
    }
    return path.join(this.getDatasetRoot(), 'logs', 'sessions');
  }

  public getNotebooksDir(): string {
    if (!this.isStudyMode || !this.activeDatasetSlug) {
      return path.join(this.workspaceRoot, 'notebooks');
    }
    return path.join(this.getDatasetRoot(), 'notebooks');
  }

  public getWorkspaceKeyPrefix(): string {
    if (!this.isStudyMode || !this.activeDatasetSlug) return '';
    const cond = this.conditionCode ? `:${this.conditionCode}` : '';
    return `study:${this.activeDatasetSlug}${cond}::`;
  }

  private ensureStudyDirectories(): void {
    const datasetRoot = this.getDatasetRoot();
    const logsDir = this.getLogsDir();
    const notebooksDir = this.getNotebooksDir();
    const meridianDir = path.join(datasetRoot, '.meridian');

    // Only create subdirectories if the dataset root exists; do not create datasetRoot in study mode
    if (fs.existsSync(datasetRoot)) {
      [logsDir, notebooksDir, meridianDir].forEach((p) => {
        if (!fs.existsSync(p)) {
          try { fs.mkdirSync(p, { recursive: true }); } catch {}
        }
      });
    }

    // Create default study.json if missing
    const studyJsonPath = path.join(this.getDatasetRoot(), 'study.json');
    if (fs.existsSync(datasetRoot) && !fs.existsSync(studyJsonPath)) {
      const defaultStudy = {
        participantId: this.participantId ?? null,
        participantLabel: this.participantId ? `P${this.participantId}` : null,
        condition: this.mapConditionCodeToInterface(this.conditionCode),
        conditionCode: this.conditionCode ?? null,
        dataset: this.activeDatasetSlug,
        conditionOrder: undefined,
        datasetOrder: undefined,
        // Template checkpoint reference for initial workspace restore
        from_template: '/template_checkpoint.json'
      };
      try {
        fs.writeFileSync(studyJsonPath, JSON.stringify(defaultStudy, null, 2), 'utf-8');
      } catch {}
    }

    // Ensure default dataset CSV exists for known slugs
    try {
      const expectedCsvMap: Record<string, string> = {
        vehicles: 'vehicles.csv',
        diamonds: 'diamonds.csv',
        listings: 'listings.csv',
        cars: 'vehicles.csv',
        houses: 'listings.csv'
      };
      const slug = this.activeDatasetSlug as string | undefined;
      if (slug && fs.existsSync(datasetRoot)) {
        const expectedName = expectedCsvMap[slug];
        if (expectedName) {
          const expectedPath = path.join(datasetRoot, expectedName);
          // Do not create CSVs automatically in study mode validation
        }
      }
    } catch {}
  }

  private mapConditionCodeToInterface(code?: 'Map' | 'Tree' | 'Canvas' | null): 'tree' | 'map' | 'canvas' | null {
    if (!code) return null;
    const mapping: Record<'Map' | 'Tree' | 'Canvas', 'tree' | 'map' | 'canvas'> = {
      Tree: 'tree',
      Map: 'map',
      Canvas: 'canvas'
    };
    return mapping[code];
  }
}
