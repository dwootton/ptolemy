import { useState, useEffect, useCallback } from 'react';
import { MessageService } from '../services/MessageService';

export interface SyncStats {
  totalNotebooks: number;
  totalCells: number;
  syncedCells: number;
  autoCells: number;
  manualCells: number;
}

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

/**
 * React hook for managing notebook sync configuration state
 * 
 * Provides:
 * - Current sync statistics
 * - Methods to toggle cell sync
 * - Modal state management
 * - Real-time updates from backend
 */
export function useNotebookSyncConfig() {
  // State
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Services
  const messageService = MessageService.getInstance();

  // Load sync stats on mount
  useEffect(() => {
    loadSyncStats();
  }, []);

  // Message listeners for real-time updates
  useEffect(() => {
    const unsubscribe1 = messageService.onMessage('sync-stats', (data: any) => {
      if (data.success) {
        setSyncStats(data.stats);
        setLastUpdated(new Date());
        setIsLoading(false);
      } else {
        console.error('Failed to get sync stats:', data.error);
        setIsLoading(false);
      }
    });

    const unsubscribe2 = messageService.onMessage('sync-config-saved', (data: any) => {
      if (data.success && data.syncStats) {
        setSyncStats(data.syncStats);
        setLastUpdated(new Date());
      }
    });

    const unsubscribe3 = messageService.onMessage('cell-sync-toggled', (data: any) => {
      if (data.success) {
        // Refresh stats after individual cell toggle
        loadSyncStats();
      }
    });

    // Also listen for notebook sync completion to update stats
    const unsubscribe4 = messageService.onMessage('notebook-sync-complete', () => {
      // Slight delay to ensure backend state is consistent
      setTimeout(() => {
        loadSyncStats();
      }, 500);
    });

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
      unsubscribe4();
    };
  }, []);

  /**
   * Load current sync statistics from backend
   */
  const loadSyncStats = useCallback(async () => {
    setIsLoading(true);
    try {
      await messageService.sendMessage('get-sync-stats', {
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to load sync stats:', error);
      setIsLoading(false);
    }
  }, []);

  /**
   * Refresh sync statistics
   */
  const refreshStats = useCallback(() => {
    loadSyncStats();
  }, [loadSyncStats]);

  /**
   * Toggle sync for a specific cell
   */
  const toggleCellSync = useCallback(async (
    notebookPath: string,
    cellId: string,
    cellIndex: number
  ): Promise<boolean> => {
    try {
      await messageService.sendMessage('toggle-cell-sync', {
        notebookPath,
        cellId,
        cellIndex,
        timestamp: Date.now()
      });
      return true;
    } catch (error) {
      console.error('Failed to toggle cell sync:', error);
      return false;
    }
  }, []);

  /**
   * Open the sync configuration modal
   */
  const openSyncModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  /**
   * Close the sync configuration modal
   */
  const closeSyncModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  /**
   * Save bulk sync configuration
   */
  const saveSyncConfig = useCallback(async (configs: Array<{
    notebookPath: string;
    cellId: string;
    cellIndex: number;
    isEnabled: boolean;
    syncType: 'auto' | 'manual';
    lastSyncHash?: string;
  }>): Promise<boolean> => {
    try {
      await messageService.sendMessage('save-sync-config', {
        configs,
        timestamp: Date.now()
      });
      return true;
    } catch (error) {
      console.error('Failed to save sync config:', error);
      return false;
    }
  }, []);

  /**
   * Get formatted sync summary text
   */
  const getSyncSummary = useCallback((): string => {
    if (!syncStats) {
      return 'Loading sync status...';
    }
    
    if (syncStats.syncedCells === 0) {
      return 'No cells synced';
    }

    const parts: string[] = [];
    
    if (syncStats.syncedCells === 1) {
      parts.push('1 cell synced');
    } else {
      parts.push(`${syncStats.syncedCells} cells synced`);
    }

    if (syncStats.totalNotebooks > 0) {
      parts.push(`across ${syncStats.totalNotebooks} notebook${syncStats.totalNotebooks !== 1 ? 's' : ''}`);
    }

    return parts.join(' ');
  }, [syncStats]);

  /**
   * Check if sync is configured (has any synced cells)
   */
  const hasSyncConfig = useCallback((): boolean => {
    return syncStats ? syncStats.syncedCells > 0 : false;
  }, [syncStats]);

  /**
   * Get sync efficiency percentage (synced vs total cells)
   */
  const getSyncEfficiency = useCallback((): number => {
    if (!syncStats || syncStats.totalCells === 0) {
      return 0;
    }
    return Math.round((syncStats.syncedCells / syncStats.totalCells) * 100);
  }, [syncStats]);

  return {
    // State
    syncStats,
    isLoading,
    isModalOpen,
    lastUpdated,
    
    // Actions
    loadSyncStats,
    refreshStats,
    toggleCellSync,
    openSyncModal,
    closeSyncModal,
    saveSyncConfig,
    
    // Computed values
    getSyncSummary,
    hasSyncConfig,
    getSyncEfficiency
  };
}