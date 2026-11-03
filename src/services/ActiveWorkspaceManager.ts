import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ActiveWorkspaceManager
 * - Manages a user-selected workspace folder distinct from the VS Code workspace root
 * - Ensures .meridian subfolders exist in the selected workspace
 * - Provides helpers for logs/checkpoints/datasets directories and quick action discovery
 */
export class ActiveWorkspaceManager {
  private static instance: ActiveWorkspaceManager;
  private context: vscode.ExtensionContext | undefined;
  private static readonly STATE_KEY = 'meridian.activeWorkspacePath';

  private constructor() {}

  public static getInstance(context?: vscode.ExtensionContext): ActiveWorkspaceManager {
    if (!ActiveWorkspaceManager.instance) {
      ActiveWorkspaceManager.instance = new ActiveWorkspaceManager();
    }
    if (context) ActiveWorkspaceManager.instance.initialize(context);
    return ActiveWorkspaceManager.instance;
  }

  private initialize(context: vscode.ExtensionContext): void {
    if (this.context) return;
    this.context = context;

  }

  public getActiveWorkspacePath(): string | undefined {
    const ctx = this.context as vscode.ExtensionContext;
    const p = ctx?.workspaceState.get<string>(ActiveWorkspaceManager.STATE_KEY) || undefined;

    return p;
  }

  public async setActiveWorkspacePath(folderPath: string | undefined): Promise<void> {
    const ctx = this.context as vscode.ExtensionContext;
    await ctx.workspaceState.update(ActiveWorkspaceManager.STATE_KEY, folderPath);

    if (folderPath) this.ensureMeridianScaffold(folderPath);
  }

  /** Returns the preferred root for operations (active workspace if set, else VS Code workspace root) */
  public getActiveRoot(): string {
    const selected = this.getActiveWorkspacePath();
    if (selected && selected.trim().length > 0) return selected;
    const fallback = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || this.context?.globalStorageUri.fsPath || process.cwd();

    return fallback;
  }

  public getLogsDir(): string {
    return path.join(this.getActiveRoot(), '.meridian', 'logs', 'sessions');
  }

  public getCheckpointsDir(): string {
    return path.join(this.getActiveRoot(), '.meridian', 'checkpoints');
  }

  public getDatasetsDir(): string {
    return path.join(this.getActiveRoot(), '.meridian', 'datasets');
  }

  /** Ensure .meridian and expected subfolders exist */
  public ensureMeridianScaffold(root: string): void {

    const dirs = [
      path.join(root, '.meridian'),
      path.join(root, '.meridian', 'logs'),
      path.join(root, '.meridian', 'logs', 'sessions'),
      path.join(root, '.meridian', 'checkpoints'),
      path.join(root, '.meridian', 'datasets')
    ];
    for (const d of dirs) {
      try {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      } catch {}
    }
  }

  /** Allow user to choose a folder (non-blocking); returns path or undefined if cancelled */
  public async chooseWorkspaceFolder(): Promise<string | undefined> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Select workspace folder'
    });
    if (!uris || uris.length === 0) return undefined;
    const chosen = uris[0].fsPath;

    this.ensureMeridianScaffold(chosen);
    return chosen;
  }

  /** Discover quick actions in the active root: common CSVs and checkpoints */
  public discoverQuickActions(root?: string): {
    csvPaths: string[];
    hasVehiclesFinal: boolean;
    baselineCheckpointPath?: string;
    checkpointFiles: string[];
  } {
    const base = root || this.getActiveRoot();

    const csvPaths: string[] = [];
    const checkpointFiles: string[] = [];
    let hasVehiclesFinal = false;
    let baselineCheckpointPath: string | undefined;

    // Walk up to 2 levels deep to discover CSVs
    const maxDepth = 2;
    const ignoreDirs = new Set(['node_modules', '.git', '.idea', '.vscode']);
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const full = path.join(dir, name);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.isDirectory()) {
          if (ignoreDirs.has(name)) continue;
          walk(full, depth + 1);
        } else if (stat.isFile()) {
          if (name.toLowerCase().endsWith('.csv')) {
            csvPaths.push(full);
            if (name.toLowerCase() === 'vehicles_final.csv') hasVehiclesFinal = true;
          }
        }
      }
    };
    walk(base, 0);

    // Baseline checkpoint
    const baseline = path.join(base, '.meridian', 'checkpoint.json');
    if (fs.existsSync(baseline)) baselineCheckpointPath = baseline;

    // Additional checkpoints directory
    const ckDir = path.join(base, '.meridian', 'checkpoints');
    try {
      if (fs.existsSync(ckDir)) {
        const files = fs.readdirSync(ckDir)
          .filter(f => f.endsWith('.json'))
          .map(f => path.join(ckDir, f))
          .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
        checkpointFiles.push(...files);
      }
    } catch {}


    return { csvPaths, hasVehiclesFinal, baselineCheckpointPath, checkpointFiles };
  }
}


