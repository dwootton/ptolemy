/**
 * Service for synchronizing analet state across different layers
 * Handles workspace state, frontend communication, and notebook metadata
 */

import { Analet } from '../../../types/analet';
import { StateManagementService } from '../../StateManagementService';

export interface StateSyncService {
  syncToWorkspace(analets: Analet[]): Promise<void>;
  syncToFrontend(analets: Analet[]): Promise<void>;
  syncDeletion(analetId: number): Promise<void>;
  syncBulkUpdate(analets: Analet[]): Promise<void>;
  fullStateRefresh(): Promise<void>;
}

export class UnifiedStateSyncService implements StateSyncService {
  constructor(
    private stateService: StateManagementService,
    private messageService?: any // MessageRouter interface
  ) {}

  async syncToWorkspace(analets: Analet[]): Promise<void> {
    try {
      // Get current analets and merge with new ones
      const currentAnalets = await this.stateService.getAnalets();
      const analetMap = new Map(currentAnalets.map(a => [a.id, a]));

      // Update or add analets
      for (const analet of analets) {
        analetMap.set(analet.id, analet);
      }

      // Save updated collection
      await this.stateService.saveAnalets(Array.from(analetMap.values()));
    } catch (error) {
      console.error(`❌ [StateSync] Failed to sync to workspace:`, error);
      throw error;
    }
  }

  async syncToFrontend(analets: Analet[]): Promise<void> {
    try {
      if (!this.messageService) {
        console.warn('⚠️ [StateSync] No message service available for frontend sync');
        return;
      }

      // Get all current analets to send complete state
      const allAnalets = await this.stateService?.getAnalets() || analets;


      // SINGLE SOURCE OF TRUTH: Send only the complete analets data
      // This includes all existing analets plus any new ones that were just created
      await this.messageService.sendMessage('fetch-analet-data', {
        analets: allAnalets,
        success: true,
        usingMockData: false,
        loadedFromCache: false,
        generationSource: 'unified_controller',
        newAnaletsCount: analets.length // For UI feedback
      });

      // REMOVED: Individual analet-created events to prevent duplication
      // The frontend will receive all analets (including new ones) via fetch-analet-data

    } catch (error) {
      console.error(`❌ [StateSync] Failed to sync to frontend:`, error);
      // Don't throw - frontend sync failures shouldn't break the operation
    }
  }

  async syncDeletion(analetId: number): Promise<void> {
    try {
      // Remove from workspace state (already done by repository, but ensure consistency)
      const currentAnalets = await this.stateService.getAnalets();
      const filteredAnalets = currentAnalets.filter(a => a.id !== analetId);

      if (filteredAnalets.length < currentAnalets.length) {
        await this.stateService.saveAnalets(filteredAnalets);
      }

      // Notify frontend
      if (this.messageService) {
        await this.messageService.sendMessage('analet-deleted', {
          analetId,
          type: 'delete',
          source: 'controller'
        });
      }
    } catch (error) {
      console.error(`❌ [StateSync] Failed to sync deletion:`, error);
      throw error;
    }
  }

  async syncBulkUpdate(analets: Analet[]): Promise<void> {
    try {
      // Update workspace state
      await this.syncToWorkspace(analets);

      // For bulk updates, use the unified fetch-analet-data approach
      await this.syncToFrontend(analets);

    } catch (error) {
      console.error(`❌ [StateSync] Failed to sync bulk update:`, error);
      throw error;
    }
  }

  /**
   * Sync a single analet update (for individual edits, not creation)
   * This is the ONLY method that should send individual analet events
   */
  async syncSingleUpdate(analet: Analet): Promise<void> {
    try {
      // Update workspace state
      await this.syncToWorkspace([analet]);

      // For single updates, send individual event
      if (this.messageService) {
        await this.messageService.sendMessage('analet-updated', {
          analet,
          type: 'update',
          source: 'edit'
        });
      }
    } catch (error) {
      console.error(`❌ [StateSync] Failed to sync single update:`, error);
      throw error;
    }
  }

  /**
   * Full state refresh - useful for initialization or recovery
   */
  async fullStateRefresh(): Promise<void> {
    try {
      const allAnalets = await this.stateService.getAnalets();

      if (this.messageService && allAnalets.length > 0) {
        await this.messageService.sendMessage('fetch-analet-data', {
          analets: allAnalets,
          loadedFromCache: true
        });
      }
    } catch (error) {
      console.error(`❌ [StateSync] Failed to refresh state:`, error);
      throw error;
    }
  }
}
