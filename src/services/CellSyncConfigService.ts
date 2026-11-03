import * as vscode from 'vscode';
import { StateManagementService } from './StateManagementService';

// Core data structures for cell sync configuration
export interface CellSyncConfig {
  notebookPath: string;
  cellId: string;
  cellIndex: number;
  isEnabled: boolean;
  syncType: 'auto' | 'manual';
  lastSyncHash?: string;
  createdAt: string;
  lastModified: string;
}

export interface NotebookSyncState {
  [notebookPath: string]: {
    [cellId: string]: CellSyncConfig;
  };
}

export interface SyncConfigStats {
  totalNotebooks: number;
  totalCells: number;
  syncedCells: number;
  autoCells: number;
  manualCells: number;
}

/**
 * CellSyncConfigService - Manages persistent sync configuration for notebook cells
 * 
 * Features:
 * - Persistent sync preferences using VS Code workspace state
 * - Cell-level sync enablement/disablement  
 * - Default sync rules for analet-generated cells
 * - Efficient lookup during sync operations
 * - Statistics and reporting for UI
 */
export class CellSyncConfigService {
  private static instance: CellSyncConfigService;
  private stateService: StateManagementService;
  private syncConfigs: NotebookSyncState = {};
  private configsLoaded = false;

  private constructor(stateService: StateManagementService) {
    this.stateService = stateService;
  }

  public static getInstance(stateService?: StateManagementService): CellSyncConfigService {
    if (!CellSyncConfigService.instance) {
      if (!stateService) {
        throw new Error('StateManagementService required for first initialization');
      }
      CellSyncConfigService.instance = new CellSyncConfigService(stateService);
    }
    return CellSyncConfigService.instance;
  }

  /**
   * Initialize service by loading existing sync configurations from workspace state
   */
  public async initialize(): Promise<void> {
    if (this.configsLoaded) {
      return;
    }

    try {
      await this.loadSyncConfigs();
      this.configsLoaded = true;
    } catch (error) {
      console.error('❌ [CellSyncConfig] Failed to initialize service:', error);
      throw error;
    }
  }

  /**
   * Load sync configurations from persistent workspace state
   */
  public async loadSyncConfigs(): Promise<void> {
    try {
      const configs = await this.stateService.getWorkspaceState<NotebookSyncState>('meridian.cell.sync.configs');
      this.syncConfigs = configs || {};
    } catch (error) {
      console.error('❌ [CellSyncConfig] Failed to load sync configs:', error);
      this.syncConfigs = {};
    }
  }

  /**
   * Save sync configurations to persistent workspace state
   */
  public async saveSyncConfigs(): Promise<void> {
    try {
      await this.stateService.setWorkspaceState('meridian.cell.sync.configs', this.syncConfigs);
    } catch (error) {
      console.error('❌ [CellSyncConfig] Failed to save sync configs:', error);
      throw error;
    }
  }

  /**
   * Check if a specific cell is configured for sync
   */
  public isCellSynced(notebookPath: string, cellId: string): boolean {
    if (!this.configsLoaded) {
      console.warn('⚠️ [CellSyncConfig] Service not initialized, returning false for cell sync check');
      return false;
    }

    const notebookConfigs = this.syncConfigs[notebookPath];
    if (!notebookConfigs) {
      return false;
    }

    const config = notebookConfigs[cellId];
    return config ? config.isEnabled : false;
  }

  /**
   * Get sync configuration for a specific cell
   */
  public getCellSyncConfig(notebookPath: string, cellId: string): CellSyncConfig | null {
    const notebookConfigs = this.syncConfigs[notebookPath];
    if (!notebookConfigs) {
      return null;
    }
    return notebookConfigs[cellId] || null;
  }

  /**
   * Set sync configuration for a specific cell
   */
  public async setSyncConfig(config: Omit<CellSyncConfig, 'createdAt' | 'lastModified'>): Promise<void> {
    const { notebookPath, cellId } = config;
    
    // Ensure notebook config exists
    if (!this.syncConfigs[notebookPath]) {
      this.syncConfigs[notebookPath] = {};
    }

    const now = new Date().toISOString();
    const existingConfig = this.syncConfigs[notebookPath][cellId];
    
    // Create or update config
    this.syncConfigs[notebookPath][cellId] = {
      ...config,
      createdAt: existingConfig?.createdAt || now,
      lastModified: now
    };
    await this.saveSyncConfigs();
  }

  /**
   * Toggle sync enabled state for a specific cell
   */
  public async toggleCellSync(
    notebookPath: string, 
    cellId: string, 
    cellIndex: number
  ): Promise<boolean> {
    const config = this.getCellSyncConfig(notebookPath, cellId);
    const newEnabledState = !config?.isEnabled;

    await this.setSyncConfig({
      notebookPath,
      cellId,
      cellIndex,
      isEnabled: newEnabledState,
      syncType: 'manual', // User-toggled cells default to manual
      lastSyncHash: config?.lastSyncHash
    });
    return newEnabledState;
  }

  /**
   * Enable sync for analet-generated cells (auto-sync type)
   * This is called when analets create notebook cells
   */
  public async enableAnaletCellSync(
    notebookPath: string,
    cellId: string,
    cellIndex: number,
    contentHash?: string
  ): Promise<void> {
    await this.setSyncConfig({
      notebookPath,
      cellId,
      cellIndex,
      isEnabled: true,
      syncType: 'auto', // Auto-enabled for analet cells
      lastSyncHash: contentHash
    });
  }

  /**
   * Get all synced cells for a specific notebook
   */
  public getSyncedCellsForNotebook(notebookPath: string): CellSyncConfig[] {
    const notebookConfigs = this.syncConfigs[notebookPath];
    if (!notebookConfigs) {
      return [];
    }

    return Object.values(notebookConfigs).filter(config => config.isEnabled);
  }

  /**
   * Get all synced cells across all notebooks
   */
  public getAllSyncedCells(): CellSyncConfig[] {
    const allSyncedCells: CellSyncConfig[] = [];
    
    for (const notebookPath in this.syncConfigs) {
      const syncedCells = this.getSyncedCellsForNotebook(notebookPath);
      allSyncedCells.push(...syncedCells);
    }

    return allSyncedCells;
  }

  /**
   * Remove sync configuration for a specific cell
   */
  public async removeCellSyncConfig(notebookPath: string, cellId: string): Promise<void> {
    const notebookConfigs = this.syncConfigs[notebookPath];
    if (!notebookConfigs || !notebookConfigs[cellId]) {
      return;
    }

    delete notebookConfigs[cellId];

    // Clean up empty notebook config
    if (Object.keys(notebookConfigs).length === 0) {
      delete this.syncConfigs[notebookPath];
    }
    await this.saveSyncConfigs();
  }

  /**
   * Remove all sync configurations for a notebook (e.g., when notebook is deleted)
   */
  public async removeNotebookSyncConfigs(notebookPath: string): Promise<void> {
    if (!this.syncConfigs[notebookPath]) {
      return;
    }

    const removedCount = Object.keys(this.syncConfigs[notebookPath]).length;
    delete this.syncConfigs[notebookPath];
    await this.saveSyncConfigs();
  }

  /**
   * Update last sync hash for a cell (tracks content changes)
   */
  public async updateCellSyncHash(
    notebookPath: string,
    cellId: string,
    contentHash: string
  ): Promise<void> {
    const config = this.getCellSyncConfig(notebookPath, cellId);
    if (!config) {
      return;
    }

    config.lastSyncHash = contentHash;
    config.lastModified = new Date().toISOString();

    await this.saveSyncConfigs();
  }

  /**
   * Get sync configuration statistics for reporting and UI
   */
  public getSyncStats(): SyncConfigStats {
    let totalNotebooks = 0;
    let totalCells = 0;
    let syncedCells = 0;
    let autoCells = 0;
    let manualCells = 0;

    for (const notebookPath in this.syncConfigs) {
      totalNotebooks++;
      const notebookConfigs = this.syncConfigs[notebookPath];
      
      for (const cellId in notebookConfigs) {
        const config = notebookConfigs[cellId];
        totalCells++;
        
        if (config.isEnabled) {
          syncedCells++;
          if (config.syncType === 'auto') {
            autoCells++;
          } else {
            manualCells++;
          }
        }
      }
    }

    return {
      totalNotebooks,
      totalCells,
      syncedCells,
      autoCells,
      manualCells
    };
  }

  /**
   * Get all notebook paths that have sync configurations
   */
  public getSyncedNotebookPaths(): string[] {
    return Object.keys(this.syncConfigs);
  }

  /**
   * Clear all sync configurations (for testing/reset)
   */
  public async clearAllSyncConfigs(): Promise<void> {
    this.syncConfigs = {};
    await this.saveSyncConfigs();
  }

  /**
   * Get total count of configured cells across all notebooks
   */
  private getTotalConfigCount(): number {
    let count = 0;
    for (const notebookPath in this.syncConfigs) {
      count += Object.keys(this.syncConfigs[notebookPath]).length;
    }
    return count;
  }

  /**
   * Check if service is initialized
   */
  public isInitialized(): boolean {
    return this.configsLoaded;
  }
}