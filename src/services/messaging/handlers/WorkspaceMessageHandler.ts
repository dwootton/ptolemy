import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';
import { ActiveWorkspaceManager } from '../../ActiveWorkspaceManager';
import { TelemetryService } from '../../TelemetryService';
import { AnaletCheckpointService } from '../../AnaletCheckpointService';

export class WorkspaceMessageHandler extends BaseMessageHandler {
  constructor() {
    super([
      'workspace:choose',
      'workspace:switch',
      'workspace:info',
      'workspace:create-from-dataset',
      'workspace:switch-to-checkpoint',
      'workspace:list-local-folders'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    switch (messageType) {
      case 'workspace:choose':
        await this.handleChooseWorkspace();
        break;
      case 'workspace:switch':
        await this.handleSwitchWorkspace(data);
        break;
      case 'workspace:info':
        await this.handleWorkspaceInfo();
        break;
      case 'workspace:create-from-dataset':
        await this.handleCreateWorkspaceFromDataset(data);
        break;
      case 'workspace:switch-to-checkpoint':
        await this.handleSwitchToCheckpoint(data);
        break;
      case 'workspace:list-local-folders':
        await this.handleListLocalFolders();
        break;
      default:
        throw new Error(`Unsupported message type: ${messageType}`);
    }
  }

  private async handleChooseWorkspace(): Promise<void> {
    try {
      const mgr = ActiveWorkspaceManager.getInstance(this.context?.stateService?.getContext());
      const chosen = await mgr.chooseWorkspaceFolder();
      if (!chosen) {

        await this.sendMessage('workspace:choose:result', { success: false, cancelled: true });
        return;
      }

      const quick = mgr.discoverQuickActions(chosen);
      await this.sendMessage('workspace:choose:result', {
        success: true,
        path: chosen,
        quickActions: quick
      });
    } catch (error) {
      try { console.error('[workspace-change] choose error', error); } catch {}
      this.log('error', 'Failed to choose workspace', error);
      await this.sendMessage('workspace:choose:result', { success: false, error: String(error) });
    }
  }

  // List local folders under the current VS Code workspace root (non-recursive)
  private async handleListLocalFolders(): Promise<void> {
    try {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) throw new Error('No VS Code workspace root');
      const entries = fs.readdirSync(root, { withFileTypes: true });
      const folders = entries
        .filter(e => e.isDirectory())
        .map(e => {
          const dirPath = path.join(root, e.name);
          const meridianDir = path.join(dirPath, '.meridian');
          const hasMeridian = fs.existsSync(meridianDir);
          let csvCount = 0;
          let checkpointCount = 0;
          try {
            const sub = fs.readdirSync(dirPath, { withFileTypes: true });
            csvCount = sub.filter(s => s.isFile() && s.name.toLowerCase().endsWith('.csv')).length;
          } catch {}
          try {
            const ckDir = path.join(dirPath, '.meridian', 'checkpoints');
            if (fs.existsSync(ckDir)) {
              checkpointCount = fs.readdirSync(ckDir).filter(n => n.endsWith('.json')).length;
            }
          } catch {}
          return {
            name: e.name,
            path: dirPath,
            hasMeridian,
            csvCount,
            checkpointCount
          };
        });
      await this.sendMessage('workspace:list-local-folders:result', { success: true, root, folders });
    } catch (error) {
      await this.sendMessage('workspace:list-local-folders:result', { success: false, error: String(error) });
    }
  }

  private async handleSwitchWorkspace(data: any): Promise<void> {
    try {
      const nextPath: string | undefined = data?.path;
      if (!nextPath || typeof nextPath !== 'string') throw new Error('Missing workspace path');

      const stateService = this.context?.stateService;
      if (!stateService) throw new Error('StateService not available');

      const ctx = stateService.getContext();
      const telemetry = TelemetryService.getInstance(ctx);
      const checkpoint = AnaletCheckpointService.getInstance();
      const mgr = ActiveWorkspaceManager.getInstance(ctx);

      // 1) Save current workspace to checkpoint (baseline of full state)
      try {
        await checkpoint.initialize(mgr.getActiveRoot());
        await checkpoint.createCheckpointFromState(stateService, 'Auto-save before workspace switch');

      } catch (e) {
        try { console.warn('[workspace-change] checkpoint save failed', e); } catch {}
        this.log('warn', 'Failed to save checkpoint before workspace switch', e);
      }

      // 2) Flush telemetry and disable instrumentation
      try {
        await telemetry.flushAll();
        telemetry.setInstrumentationEnabled(false);

      } catch (e) {
        this.log('warn', 'Failed to flush telemetry before workspace switch', e);
      }

      // 3) Purge state
      try {
        stateService.clearAllData();

      } catch (e) {
        this.log('warn', 'Failed to clear state during workspace switch', e);
      }

      // 4) Disable analytics flag for webview (persist a workspace-level flag) and notify UI
      try {
        await ctx.workspaceState.update('meridian.analytics.enabled', false);
        await this.sendMessage('instrumentation-status-changed', { enabled: false });

      } catch {}

      // 5) Set new active workspace path and scaffold
      await mgr.setActiveWorkspacePath(nextPath);


      // 6) Re-initialize dependent services to point to new root
      try {
        telemetry.refreshPathsFromActiveWorkspace(true);

      } catch (e) {
        this.log('warn', 'Failed to refresh TelemetryService paths after workspace switch', e);
      }
      try {
        await checkpoint.initialize(mgr.getActiveRoot());

      } catch (e) {
        this.log('warn', 'Failed to reinitialize checkpoint service in new workspace', e);
      }

      // 7) Purge frontend storage and signal UI reset before announcing switch complete
      try {
        await this.sendMessage('purge-frontend-storage', { emergency: false });

      } catch (e) {
        this.log('warn', 'Failed to request frontend storage purge on workspace switch', e);
      }

      const quick = mgr.discoverQuickActions();

      await this.sendMessage('workspace:switch:result', {
        success: true,
        path: nextPath,
        quickActions: quick,
        analyticsEnabled: false
      });

      // Also emit a purge-like response to trigger UI clearing flows
      await this.sendMessage('purge-data-response', {
        success: true,
        message: 'Workspace switched; data purged'
      });
    } catch (error) {
      try { console.error('[workspace-change] switch error', error); } catch {}
      this.log('error', 'Failed to switch workspace', error);
      await this.sendMessage('workspace:switch:result', { success: false, error: String(error) });
    }
  }

  private async handleWorkspaceInfo(): Promise<void> {
    try {
      const ctx = this.context?.stateService?.getContext();
      const mgr = ActiveWorkspaceManager.getInstance(ctx);
      const path = mgr.getActiveWorkspacePath();
      const quick = mgr.discoverQuickActions(path);
      const analyticsEnabled = !!ctx?.workspaceState.get('meridian.analytics.enabled');

      await this.sendMessage('workspace:info:result', {
        success: true,
        path: path || null,
        quickActions: quick,
        analyticsEnabled
      });
    } catch (error) {
      try { console.error('[workspace-change] info error', error); } catch {}
      this.log('error', 'Failed to get workspace info', error);
      await this.sendMessage('workspace:info:result', { success: false, error: String(error) });
    }
  }

  // Create a new workspace folder named after the dataset and switch to it
  private async handleCreateWorkspaceFromDataset(data: any): Promise<void> {
    try {
      const filePath: string | undefined = data?.filePath;
      if (!filePath) throw new Error('filePath is required');
      const ctx = this.context?.stateService?.getContext();
      const mgr = ActiveWorkspaceManager.getInstance(ctx);
      // Set the active workspace to the existing folder containing the dataset
      const datasetDir = path.dirname(filePath);
      mgr.ensureMeridianScaffold(datasetDir);
      await mgr.setActiveWorkspacePath(datasetDir);
      const telemetry = TelemetryService.getInstance(ctx!);
      telemetry.refreshPathsFromActiveWorkspace(true);

      await this.sendMessage('workspace:create-from-dataset:result', { success: true, path: datasetDir });
    } catch (error) {
      await this.sendMessage('workspace:create-from-dataset:result', { success: false, error: String(error) });
    }
  }

  // Switch to the workspace that contains the checkpoint and restore it
  private async handleSwitchToCheckpoint(data: any): Promise<void> {
    try {
      const filePath: string | undefined = data?.filePath;
      if (!filePath) throw new Error('filePath is required');
      const checkpointDir = path.dirname(filePath);
      const workspaceRoot = path.dirname(path.dirname(checkpointDir)); // <root>/.meridian/checkpoints
      const ctx = this.context?.stateService?.getContext();
      const mgr = ActiveWorkspaceManager.getInstance(ctx);

      await mgr.setActiveWorkspacePath(workspaceRoot);
      const telemetry = TelemetryService.getInstance(ctx!);
      telemetry.refreshPathsFromActiveWorkspace(true);

      // Restore from file
      await this.context?.messageRouter.handleMessage({ type: 'restore-checkpoint-file', data: { filePath } });
    } catch (error) {
      await this.sendMessage('error', { message: String(error), messageType: 'workspace:switch-to-checkpoint', originalData: data });
    }
  }
}


