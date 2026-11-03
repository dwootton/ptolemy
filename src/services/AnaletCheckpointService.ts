import * as fs from 'fs';
import * as path from 'path';
import { Analet, AnalysisNote } from '../types/analet';
import { StateManagementService, type ConceptAxis, type UIState, type ActiveFilters, type DimensionMetadata, type DatasetInfo } from './StateManagementService';

export interface AnaletCheckpoint {
  id: string;
  timestamp: string;
  createdAt: Date;
  analets: Analet[];
  datasetName?: string;
  description: string;
  analetsCount: number;
  // Extended snapshot fields to restore full view state
  dimensions?: ConceptAxis[];
  dimensionMetadata?: DimensionMetadata;
  uiState?: UIState | null;
  activeFilters?: ActiveFilters | null;
  materializedAnaletIds?: number[];
  notes?: AnalysisNote[];
  analetConstraints?: Array<{ id: string; analetId: number; position?: { x: number; y: number }; strength?: number; timestamp?: number; type?: string; data?: any }>;
}

export class AnaletCheckpointService {
  private static instance: AnaletCheckpointService;
  private checkpointsDir: string | null = null;

  private constructor() {}

  public static getInstance(): AnaletCheckpointService {
    if (!AnaletCheckpointService.instance) {
      AnaletCheckpointService.instance = new AnaletCheckpointService();
    }
    return AnaletCheckpointService.instance;
  }

  /**
   * Initialize the checkpoints directory for the current workspace
   */
  public async initialize(workspaceRoot: string): Promise<void> {
    this.checkpointsDir = path.join(workspaceRoot, '.meridian', 'checkpoints');
    
    // Create checkpoints directory if it doesn't exist
    if (!fs.existsSync(this.checkpointsDir)) {
      fs.mkdirSync(this.checkpointsDir, { recursive: true });
    }
  }

  // === Baseline Checkpoint (dataset-scoped) ===
  public getBaselinePath(datasetRoot: string): string {
    return path.join(datasetRoot, '.meridian', 'checkpoint.json');
  }

  public ensureMeridianDir(datasetRoot: string): void {
    const dir = path.join(datasetRoot, '.meridian');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public async readBaseline(datasetRoot: string): Promise<BaselineCheckpoint | null> {
    try {
      const baselinePath = this.getBaselinePath(datasetRoot);
      if (!fs.existsSync(baselinePath)) return null;
      const raw = fs.readFileSync(baselinePath, 'utf8');
      const parsed = JSON.parse(raw) as BaselineCheckpoint;
      return parsed;
    } catch (error) {
      console.error('❌ [AnaletCheckpointService] Failed to read baseline:', error);
      return null;
    }
  }

  public async writeBaseline(datasetRoot: string, baseline: BaselineCheckpoint): Promise<void> {
    try {
      this.ensureMeridianDir(datasetRoot);
      const baselinePath = this.getBaselinePath(datasetRoot);
      fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
    } catch (error) {
      console.error('❌ [AnaletCheckpointService] Failed to write baseline:', error);
      throw error;
    }
  }

  /**
   * Create a new checkpoint with provided analets and optional metadata
   */
  public async createCheckpoint(analets: Analet[], datasetName?: string, description?: string): Promise<AnaletCheckpoint> {
    if (!this.checkpointsDir) {
      throw new Error('AnaletCheckpointService not initialized');
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const id = `checkpoint_${timestamp}`;
    
    const checkpoint: AnaletCheckpoint = {
      id,
      timestamp,
      createdAt: now,
      analets: analets.map(analet => ({
        ...analet,
        // Ensure we have clean data for storage with proper location structure
        location: analet.location || { id: `loc_${Date.now()}_${Math.random()}`, x: 0, y: 0 }
      })),
      datasetName,
      description: description || `Auto-checkpoint: ${analets.length} analets`,
      analetsCount: analets.length,
      // Extended fields left undefined in this method
      dimensions: undefined,
      uiState: undefined,
      activeFilters: undefined
    };

    const checkpointPath = path.join(this.checkpointsDir, `${id}.json`);
    
    try {
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
      // Clean up old checkpoints (keep last 20)
      await this.cleanupOldCheckpoints();
      
      return checkpoint;
    } catch (error) {
      console.error('❌ [AnaletCheckpointService] Failed to create checkpoint:', error);
      throw error;
    }
  }

  /**
   * Create a comprehensive checkpoint from the current workspace state
   */
  public async createCheckpointFromState(stateService: StateManagementService, description?: string): Promise<AnaletCheckpoint> {
    // Gather current state snapshot
    const [analets, dimensions, dimMeta, uiState, activeFilters, dataset, materializedIds, notes, analetConstraints] = await Promise.all([
      stateService.getAnalets(),
      stateService.loadDimensions(),
      stateService.getDimensionMetadata(),
      stateService.loadUIState(),
      stateService.loadActiveFilters(),
      stateService.loadDataset(),
      stateService.loadMaterializedAnalets(),
      (async () => (await stateService.getContext().workspaceState.get('analysis-notes')) as AnalysisNote[] || [])(),
      stateService.loadAnaletConstraints()
    ]);

    const datasetName = dataset?.datasetInfo?.name;
    const checkpoint = await this.createCheckpoint(analets, datasetName, description || 'Manual checkpoint');

    // Attach extended snapshot data and persist again
    const enriched: AnaletCheckpoint = {
      ...checkpoint,
      dimensions: dimensions || [],
      dimensionMetadata: dimMeta || undefined,
      uiState: uiState || null,
      activeFilters: activeFilters || null,
      materializedAnaletIds: materializedIds || [],
      notes: notes || [],
      analetConstraints: analetConstraints || []
    };

    const checkpointPath = path.join(this.checkpointsDir!, `${checkpoint.id}.json`);
    fs.writeFileSync(checkpointPath, JSON.stringify(enriched, null, 2));
    return enriched;
  }

  /**
   * Load all available checkpoints
   */
  public async getCheckpoints(): Promise<AnaletCheckpoint[]> {
    if (!this.checkpointsDir) {
      throw new Error('AnaletCheckpointService not initialized');
    }

    try {
      const files = fs.readdirSync(this.checkpointsDir)
        .filter(file => file.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Most recent first

      const checkpoints: AnaletCheckpoint[] = [];

      for (const file of files) {
        try {
          const filePath = path.join(this.checkpointsDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const checkpoint = JSON.parse(content) as AnaletCheckpoint;
          
          // Convert timestamp back to Date object
          checkpoint.createdAt = new Date(checkpoint.createdAt);
          
          checkpoints.push(checkpoint);
        } catch (error) {
          console.warn(`⚠️ [AnaletCheckpointService] Failed to load checkpoint ${file}:`, error);
        }
      }

      return checkpoints;
    } catch (error) {
      console.error('❌ [AnaletCheckpointService] Failed to load checkpoints:', error);
      return [];
    }
  }

  /**
   * Restore analets from a checkpoint
   */
  public async restoreCheckpoint(checkpointId: string): Promise<AnaletCheckpoint> {
    if (!this.checkpointsDir) {
      throw new Error('AnaletCheckpointService not initialized');
    }

    const checkpointPath = path.join(this.checkpointsDir, `${checkpointId}.json`);
    
    try {
      if (!fs.existsSync(checkpointPath)) {
        throw new Error(`Checkpoint ${checkpointId} does not exist`);
      }

      const content = fs.readFileSync(checkpointPath, 'utf8');
      const checkpoint = JSON.parse(content) as AnaletCheckpoint;
      return checkpoint;
    } catch (error) {
      console.error('❌ [AnaletCheckpointService] Failed to restore checkpoint:', error);
      throw error;
    }
  }

  /**
   * Delete a specific checkpoint
   */
  public async deleteCheckpoint(checkpointId: string): Promise<void> {
    if (!this.checkpointsDir) {
      throw new Error('AnaletCheckpointService not initialized');
    }

    const checkpointPath = path.join(this.checkpointsDir, `${checkpointId}.json`);
    
    try {
      if (fs.existsSync(checkpointPath)) {
        fs.unlinkSync(checkpointPath);
      }
    } catch (error) {
      console.error('❌ [AnaletCheckpointService] Failed to delete checkpoint:', error);
      throw error;
    }
  }

  /**
   * Clean up old checkpoints, keeping only the most recent 20
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    if (!this.checkpointsDir) {
      return;
    }

    try {
      const files = fs.readdirSync(this.checkpointsDir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(this.checkpointsDir!, file),
          stats: fs.statSync(path.join(this.checkpointsDir!, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime()); // Most recent first

      // Keep only the 20 most recent
      const filesToDelete = files.slice(20);
      
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      console.warn('⚠️ [AnaletCheckpointService] Failed to cleanup old checkpoints:', error);
    }
  }

  /**
   * Get checkpoint statistics
   */
  public async getCheckpointStats(): Promise<{ count: number; totalSize: number; oldestDate?: Date; newestDate?: Date }> {
    if (!this.checkpointsDir) {
      return { count: 0, totalSize: 0 };
    }

    try {
      const files = fs.readdirSync(this.checkpointsDir)
        .filter(file => file.endsWith('.json'));

      let totalSize = 0;
      let oldestDate: Date | undefined;
      let newestDate: Date | undefined;

      for (const file of files) {
        const filePath = path.join(this.checkpointsDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;

        if (!oldestDate || stats.mtime < oldestDate) {
          oldestDate = stats.mtime;
        }
        if (!newestDate || stats.mtime > newestDate) {
          newestDate = stats.mtime;
        }
      }

      return {
        count: files.length,
        totalSize,
        oldestDate,
        newestDate
      };
    } catch (error) {
      console.error('❌ [AnaletCheckpointService] Failed to get checkpoint stats:', error);
      return { count: 0, totalSize: 0 };
    }
  }
}

// === Types for baseline checkpoint ===
export interface BaselineCheckpoint {
  version: number;
  createdAt: string;
  dataset: {
    path: string; // absolute or relative to datasetRoot
    name?: string;
    rowCount?: number;
    columns?: string[];
    checksum?: string;
  };
  dataDefinitions?: {
    conceptAxes?: ConceptAxis[];
    dimensionMetadata?: DimensionMetadata;
  };
  analets: Analet[];
  notes?: AnalysisNote[];
  // Extended view/config state for exact restoration
  uiState?: import('./StateManagementService').UIState | null;
  activeFilters?: import('./StateManagementService').ActiveFilters | null;
  materializedAnaletIds?: number[];
  analetConstraints?: Array<{ id: string; analetId: number; position?: { x: number; y: number }; strength?: number; timestamp?: number; type?: string; data?: any }>;
  // Bearing metrics snapshot
  bearingMetrics?: Record<string, any>;
}
