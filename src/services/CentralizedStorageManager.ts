/**
 * CentralizedStorageManager - Single source of truth for ALL storage operations
 * This manager handles clearing, restoration, and management of ALL storage mechanisms
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface StorageLocation {
  type: 'workspace' | 'global' | 'file' | 'message';
  key?: string;
  path?: string;
  description: string;
  clearMethod: () => Promise<void>;
}

export class CentralizedStorageManager {
  private static instance: CentralizedStorageManager;
  private context: vscode.ExtensionContext;
  private storageLocations: StorageLocation[] = [];

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.initializeStorageLocations();
  }

  public static getInstance(context?: vscode.ExtensionContext): CentralizedStorageManager {
    if (!CentralizedStorageManager.instance) {
      if (!context) {
        throw new Error('CentralizedStorageManager requires ExtensionContext for initialization');
      }
      CentralizedStorageManager.instance = new CentralizedStorageManager(context);
    }
    return CentralizedStorageManager.instance;
  }

  private initializeStorageLocations(): void {
    // Workspace State Storage
    const workspaceKeys = [
      'meridian.analets',
      'meridian.analet.metadata', 
      'meridian.embeddings',
      'meridian.notebooks.mapping',
      'meridian.notebook.metadata',
      'meridian.dimensions',
      'meridian.dimension.values',
      'meridian.dimension.metadata',
      'meridian.dataset.info',
      'meridian.dataset.profile',
      'meridian.dataset.metadata',
      'meridian.ui.state',
      'meridian.filters.active',
      'meridian.selected.analets',
      'meridian.map.view.state',
      'meridian.panel.layout',
      'meridian.recent.activities',
      'meridian.hierarchy.state',
      'MERIDIAN_EDGES_V1',
      'MERIDIAN_EDGES_VERSION_V1',
      'meridian.detected.clusters',
      'meridian.selected.folder',
      'meridian.semantic.layer',
      'meridian.conceptual.statements',
      'meridian.variable.modifications',
      'meridian.stakeholder.descriptions',
      'meridian.analysis.goals',
      'analysis-notes'
    ];

    workspaceKeys.forEach(key => {
      this.storageLocations.push({
        type: 'workspace',
        key,
        description: `Workspace State: ${key}`,
        clearMethod: async () => {
          await this.context.workspaceState.update(key, undefined);
        }
      });
    });

    // Global State Storage
    const globalKeys = [
      'meridian.global.settings',
      'meridian.global.cache',
      'meridian.user.preferences'
    ];

    globalKeys.forEach(key => {
      this.storageLocations.push({
        type: 'global',
        key,
        description: `Global State: ${key}`,
        clearMethod: async () => {
          await this.context.globalState.update(key, undefined);
        }
      });
    });

    // File System Storage
    this.storageLocations.push({
      type: 'file',
      path: '.meridian',
      description: 'Dataset files in .meridian directory',
      clearMethod: async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const meridianDir = path.join(workspaceFolder.uri.fsPath, '.meridian');
        try {
          if (fs.existsSync(meridianDir)) {
            const files = fs.readdirSync(meridianDir);
            // Only remove CSV dataset files, preserve other .meridian files like checkpoints
            for (const file of files) {
              if (file.endsWith('.csv')) {
                const filePath = path.join(meridianDir, file);
                fs.unlinkSync(filePath);
              }
            }
          }
        } catch (error) {
          console.warn('⚠️ [CentralizedStorage] Error clearing dataset files:', error);
        }
      }
    });

    // Frontend Storage (sent via message)
    this.storageLocations.push({
      type: 'message',
      description: 'Frontend localStorage, indexedDB, and sessionStorage',
      clearMethod: async () => {
        // This will be handled by sending a message to the webview
      }
    });
  }

  /**
   * Complete purge of ALL storage locations
   */
  public async purgeAllStorage(): Promise<void> {
    const errors: string[] = [];
    let clearedCount = 0;

    for (const location of this.storageLocations) {
      try {
        await location.clearMethod();
        clearedCount++;
      } catch (error) {
        const errorMsg = `Failed to clear ${location.description}: ${error}`;
        errors.push(errorMsg);
        console.error('❌ [CentralizedStorage]', errorMsg);
      }
    }
    if (errors.length > 0) {
      console.warn(`⚠️ [CentralizedStorage] ${errors.length} errors during purge:`, errors);
    }

    // Send message to frontend to clear its storage
    await this.requestFrontendStoragePurge();
    return;
  }

  /**
   * Get storage usage information
   */
  public async getStorageInfo(): Promise<{ [key: string]: any }> {
    const info: { [key: string]: any } = {};
    
    // Workspace state info
    const workspaceInfo: { [key: string]: any } = {};
    for (const location of this.storageLocations) {
      if (location.type === 'workspace' && location.key) {
        const data = this.context.workspaceState.get(location.key);
        if (data) {
          const size = JSON.stringify(data).length;
          workspaceInfo[location.key] = {
            exists: true,
            sizeBytes: size,
            sizeKB: Math.round(size / 1024),
            preview: typeof data === 'object' ? Object.keys(data).slice(0, 5) : String(data).substring(0, 100)
          };
        }
      }
    }
    info.workspaceState = workspaceInfo;

    // File system info
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const meridianDir = path.join(workspaceFolder.uri.fsPath, '.meridian');
      try {
        if (fs.existsSync(meridianDir)) {
          const files = fs.readdirSync(meridianDir);
          const csvFiles = files.filter(file => file.endsWith('.csv'));
          info.fileSystem = {
            meridianDir: meridianDir,
            fileCount: csvFiles.length,
            files: csvFiles.map(file => {
              const filePath = path.join(meridianDir, file);
              const stats = fs.statSync(filePath);
              return {
                name: file,
                sizeBytes: stats.size,
                sizeKB: Math.round(stats.size / 1024),
                modified: stats.mtime
              };
            })
          };
        }
      } catch (error) {
        info.fileSystem = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    return info;
  }

  /**
   * Request frontend to purge its storage (placeholder)
   */
  private async requestFrontendStoragePurge(): Promise<void> {
    try {
      // Use MessageRouter via state service to post a message to the webview
      // We cannot import router here; instead, write a flag to workspaceState the webview listens for
      await this.context.workspaceState.update('meridian.frontend.purge.request', {
        requestedAt: Date.now()
      });
      // Also emit a console for visibility; actual message routing is handled in SystemMessageHandler
    } catch (error) {
      console.warn('⚠️ [CentralizedStorage] Failed to request frontend purge:', error);
    }
  }

  /**
   * Emergency cleanup for corrupted states
   */
  public async emergencyCleanup(): Promise<void> {
    // Focus on the most problematic storage locations first
    const criticalKeys = [
      'meridian.hierarchy.state',
      'meridian.detected.clusters', 
      'meridian.selected.folder',
      'meridian.analets',
      'meridian.embeddings'
    ];

    for (const key of criticalKeys) {
      try {
        const data = this.context.workspaceState.get(key);
        if (data) {
          const size = JSON.stringify(data).length;
          if (size > 5 * 1024 * 1024) { // 5MB threshold
            console.warn(`🚨 [CentralizedStorage] Emergency: Clearing oversized ${key} (${Math.round(size / 1024)} KB)`);
            await this.context.workspaceState.update(key, undefined);
          }
        }
      } catch (error) {
        console.error(`❌ [CentralizedStorage] Emergency cleanup failed for ${key}:`, error);
      }
    }
  }

  /**
   * List all registered storage locations
   */
  public getStorageLocations(): StorageLocation[] {
    return [...this.storageLocations];
  }
}