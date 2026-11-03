import * as vscode from 'vscode';
import { Analet } from '../types/analet';
import { StateManagementService } from './StateManagementService';

export type AnaletType = 'framing' | 'waypoint';

export interface AnaletStoreMetadata {
  totalAnalets: number;
  framingAnalets: number;
  waypointAnalets: number;
  lastUpdated: string;
  version: string;
}

/**
 * Centralized store for all analet management
 * Handles both framing analets (used for UMAP training but not displayed by default)
 * and waypoint analets (displayed on map and in lists)
 */
export class AnaletStore {
  private static instance: AnaletStore;
  private stateService: StateManagementService;
  private analets: Map<number, Analet> = new Map();
  private nextId: number = 1;

  private constructor(stateService: StateManagementService) {
    this.stateService = stateService;
  }

  public static getInstance(context?: vscode.ExtensionContext): AnaletStore {
    if (!AnaletStore.instance) {
      if (!context) {
        throw new Error('ExtensionContext required for first initialization');
      }
      const stateService = StateManagementService.getInstance(context);
      AnaletStore.instance = new AnaletStore(stateService);
    }
    return AnaletStore.instance;
  }

  /**
   * Load all analets from persistent storage
   */
  public async loadFromStorage(): Promise<void> {
    try {
      const storedAnalets = await this.stateService.loadAnalets();
      
      if (!storedAnalets || storedAnalets.length === 0) {
        return;
      }

      // Clear current state
      this.analets.clear();
      
      // Load analets into memory
      storedAnalets.forEach(analet => {
        // Ensure analet has proper type classification
        const processedAnalet = this.processAnaletType(analet);
        this.analets.set(analet.id, processedAnalet);
        
        // Update next ID to prevent conflicts
        if (analet.id >= this.nextId) {
          this.nextId = analet.id + 1;
        }
      });
      this.logStoreMetrics();
    } catch (error) {
      console.error('❌ [AnaletStore] Failed to load from storage:', error);
      throw error;
    }
  }

  /**
   * Save all analets to persistent storage
   */
  public async saveToStorage(): Promise<void> {
    try {
      const analetsArray = Array.from(this.analets.values());
      await this.stateService.saveAnalets(analetsArray);
    } catch (error) {
      console.error('❌ [AnaletStore] Failed to save to storage:', error);
      throw error;
    }
  }

  /**
   * Add a new analet to the store with unique ID
   */
  public async addAnalet(analet: Omit<Analet, 'id'>, type: AnaletType = 'waypoint'): Promise<Analet> {
    const newAnalet: Analet = {
      ...analet,
      id: this.nextId++,
      type: type,
      source: type === 'framing' ? 'framing' : (analet.source || 'generated')
    };

    const processedAnalet = this.processAnaletType(newAnalet);
    this.analets.set(processedAnalet.id, processedAnalet);
    
    await this.saveToStorage();
    return processedAnalet;
  }

  /**
   * Add multiple analets at once
   */
  public async addAnalets(analets: Omit<Analet, 'id'>[], type: AnaletType = 'waypoint'): Promise<Analet[]> {
    const newAnalets: Analet[] = [];
    
    for (const analet of analets) {
      const newAnalet: Analet = {
        ...analet,
        id: this.nextId++,
        type: type,
        source: type === 'framing' ? 'framing' : (analet.source || 'generated')
      };

      const processedAnalet = this.processAnaletType(newAnalet);
      this.analets.set(processedAnalet.id, processedAnalet);
      newAnalets.push(processedAnalet);
    }
    
    await this.saveToStorage();
    return newAnalets;
  }

  /**
   * Update an existing analet
   */
  public async updateAnalet(updatedAnalet: Analet): Promise<void> {
    if (!this.analets.has(updatedAnalet.id)) {
      throw new Error(`Analet with ID ${updatedAnalet.id} not found`);
    }

    const processedAnalet = this.processAnaletType(updatedAnalet);
    this.analets.set(updatedAnalet.id, processedAnalet);
    
    await this.saveToStorage();
  }

  /**
   * Add an existing analet with its original ID (for generation services)
   */
  public async addExistingAnalet(analet: Analet): Promise<void> {
    const processedAnalet = this.processAnaletType(analet);
    this.analets.set(analet.id, processedAnalet);
    
    // Update nextId to ensure no collisions
    if (analet.id >= this.nextId) {
      this.nextId = analet.id + 1;
    }
  }

  /**
   * Remove an analet from the store
   */
  public async removeAnalet(analetId: number): Promise<boolean> {
    const existed = this.analets.delete(analetId);
    
    if (existed) {
      await this.saveToStorage();
    }
    
    return existed;
  }

  /**
   * Get a specific analet by ID
   */
  public getAnalet(analetId: number): Analet | undefined {
    return this.analets.get(analetId);
  }

  /**
   * Get all analets
   */
  public getAllAnalets(): Analet[] {
    return Array.from(this.analets.values());
  }

  /**
   * Get all framing analets (used for UMAP training but not displayed by default)
   */
  public getFramingAnalets(): Analet[] {
    return Array.from(this.analets.values()).filter(analet => analet.type === 'framing');
  }

  /**
   * Get all waypoint analets (displayed on map and in lists)
   */
  public getWaypointAnalets(): Analet[] {
    return Array.from(this.analets.values()).filter(analet => analet.type === 'waypoint');
  }

  /**
   * Promote framing analets to waypoint analets
   */
  public async promoteFramingAnalets(analetIds: number[]): Promise<Analet[]> {
    const promotedAnalets: Analet[] = [];
    
    for (const id of analetIds) {
      const analet = this.analets.get(id);
      if (analet && analet.type === 'framing') {
        const promotedAnalet = {
          ...analet,
          type: 'waypoint' as const,
          source: 'generated' as const // Promoted analets become waypoint-generated
        };
        
        this.analets.set(id, promotedAnalet);
        promotedAnalets.push(promotedAnalet);
      }
    }
    
    if (promotedAnalets.length > 0) {
      await this.saveToStorage();
    }
    
    return promotedAnalets;
  }

  /**
   * Randomly promote N framing analets to waypoint analets
   */
  public async promoteRandomFramingAnalets(count: number = 5): Promise<Analet[]> {
    const framingAnalets = this.getFramingAnalets();
    
    if (framingAnalets.length === 0) {
      return [];
    }
    
    // Randomly select framing analets to promote
    const shuffled = [...framingAnalets].sort(() => 0.5 - Math.random());
    const selectedIds = shuffled.slice(0, Math.min(count, framingAnalets.length)).map(a => a.id);
    
    return await this.promoteFramingAnalets(selectedIds);
  }

  /**
   * Clear all analets from the store
   */
  public async clearAll(): Promise<void> {
    this.analets.clear();
    this.nextId = 1;
    await this.saveToStorage();
  }

  /**
   * Get store metadata and statistics
   */
  public getMetadata(): AnaletStoreMetadata {
    const allAnalets = this.getAllAnalets();
    const framingAnalets = this.getFramingAnalets();
    const waypointAnalets = this.getWaypointAnalets();
    
    return {
      totalAnalets: allAnalets.length,
      framingAnalets: framingAnalets.length,
      waypointAnalets: waypointAnalets.length,
      lastUpdated: new Date().toISOString(),
      version: '1.0'
    };
  }

  /**
   * Process analet to ensure proper type classification
   */
  private processAnaletType(analet: Analet): Analet {
    // Determine type based on source if not explicitly set
    if (!analet.type) {
      analet.type = analet.source === 'framing' ? 'framing' : 'waypoint';
    }
    
    // Ensure source is consistent with type
    if (analet.type === 'framing' && analet.source !== 'framing') {
      analet.source = 'framing';
    }
    
    return analet;
  }

  /**
   * Log current store metrics for debugging
   */
  private logStoreMetrics(): void {
    const metadata = this.getMetadata();
  }

  /**y onds
   * Restore from checkpoint or backup data
   */
  public async restoreFromBackup(analets: Analet[]): Promise<void> {
    this.analets.clear();
    this.nextId = 1;
    
    analets.forEach(analet => {
      const processedAnalet = this.processAnaletType(analet);
      this.analets.set(analet.id, processedAnalet);
      
      if (analet.id >= this.nextId) {
        this.nextId = analet.id + 1;
      }
    });
    
    await this.saveToStorage();
    this.logStoreMetrics();
  }
}