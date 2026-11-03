import { Analet, Bearing, AnalysisComponent } from '../types/analet';
import { DatasetInfo } from '../components/DatasetLoader';
import { HierarchyState } from '../types/hierarchy';

/**
 * Core application state that needs to persist across extension navigation
 */
interface SessionState {
  version: string;
  timestamp: Date;
  
  // Core data
  analets: Analet[];
  analysisComponents: AnalysisComponent[];
  bearings: Bearing[];
  
  // Dataset context
  datasetInfo: DatasetInfo | null;
  hasDataset: boolean;
  
  // UI state that should survive navigation
  selectedFolderName: string | null;
  hierarchyState: HierarchyState | null;
  
  // Shared selection state
  selectedAnaletIds: number[];
  selectedBearingIds: number[];
  lastSelectedId: number | undefined;
  lastSelectedType: 'analet' | 'bearing' | undefined;
  
  // Checkpoints/constraints
  userConstraints: any[]; // TODO: Add proper constraint type
  checkpoints: any[]; // TODO: Add proper checkpoint type
}

interface SessionStateOptions {
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Focused state service for session persistence across VS Code extension navigation.
 * Only handles essential state that needs to survive when user navigates away from extension.
 */
export class SessionStateService {
  private static instance: SessionStateService | null = null;
  private readonly STORAGE_KEY = 'meridian-session-state';
  private readonly VERSION = '1.0.0';
  
  // Current session state
  private state: SessionState;
  
  // Persistence settings
  private options: Required<SessionStateOptions>;
  private persistenceTimer: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;
  
  private constructor(options: SessionStateOptions = {}) {
    this.options = {
      enabled: true,
      debounceMs: 500,
      ...options
    };
    
    // Initialize with empty state
    this.state = this.getEmptyState();
  }

  public static getInstance(options?: SessionStateOptions): SessionStateService {
    if (!SessionStateService.instance) {
      SessionStateService.instance = new SessionStateService(options);
    }
    return SessionStateService.instance;
  }

  private getEmptyState(): SessionState {
    return {
      version: this.VERSION,
      timestamp: new Date(),
      analets: [],
      analysisComponents: [],
      bearings: [],
      datasetInfo: null,
      hasDataset: false,
      selectedFolderName: null,
      hierarchyState: null,
      selectedAnaletIds: [],
      selectedBearingIds: [],
      lastSelectedId: undefined,
      lastSelectedType: undefined,
      userConstraints: [],
      checkpoints: []
    };
  }

  /**
   * Restore complete session state on app mount
   */
  async hydrateSession(): Promise<boolean> {
    if (!this.options.enabled) {
      return false;
    }

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        return false;
      }

      const parsed: SessionState = JSON.parse(stored);
      
      // Validate version compatibility
      if (parsed.version !== this.VERSION) {
        console.warn(`⚠️ [SessionState] Version mismatch (${parsed.version} vs ${this.VERSION}), using empty state`);
        return false;
      }

      // Validate data structure
      if (!this.isValidState(parsed)) {
        console.warn('⚠️ [SessionState] Invalid stored state, using empty state');
        return false;
      }

      // Sanitize persisted analysisComponents: never restore notes from session storage
      const sanitizedComponents = Array.isArray(parsed.analysisComponents)
        ? parsed.analysisComponents.filter((c: any) => c && c.kind !== 'note')
        : [];

      this.state = {
        ...parsed,
        analysisComponents: sanitizedComponents,
        timestamp: new Date(parsed.timestamp) // Convert string back to Date
      };
      return true;

    } catch (error) {
      console.error('❌ [SessionState] Failed to restore session:', error);
      this.state = this.getEmptyState();
      return false;
    }
  }

  /**
   * Persist current state (debounced for performance)
   */
  private persistSession(): void {
    if (!this.options.enabled || !this.isDirty) {
      return;
    }

    // Clear existing timer
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
    }

    // Debounce persistence
    this.persistenceTimer = setTimeout(() => {
      try {
        this.state.timestamp = new Date();
        const serialized = JSON.stringify(this.state);
        localStorage.setItem(this.STORAGE_KEY, serialized);
        
        this.isDirty = false;
      } catch (error) {
        console.error('❌ [SessionState] Failed to persist session:', error);
      }
    }, this.options.debounceMs);
  }

  private markDirty(): void {
    this.isDirty = true;
    this.persistSession();
  }

  private isValidState(state: any): boolean {
    return (
      state &&
      typeof state.version === 'string' &&
      Array.isArray(state.analets) &&
      Array.isArray(state.analysisComponents) &&
      Array.isArray(state.selectedAnaletIds) &&
      Array.isArray(state.selectedBearingIds)
    );
  }

  // === GETTERS ===

  getAnalets(): Analet[] {
    return this.state.analets;
  }

  getAnalysisComponents(): AnalysisComponent[] {
    return this.state.analysisComponents;
  }

  getBearings(): Bearing[] {
    return this.state.bearings;
  }

  getDatasetInfo(): DatasetInfo | null {
    return this.state.datasetInfo;
  }

  hasDataset(): boolean {
    return this.state.hasDataset;
  }

  getSelectedFolderName(): string | null {
    return this.state.selectedFolderName;
  }

  getHierarchyState(): HierarchyState | null {
    return this.state.hierarchyState;
  }

  // Selection state
  getSelectedAnaletIds(): Set<number> {
    return new Set(this.state.selectedAnaletIds);
  }

  getSelectedBearingIds(): Set<number> {
    return new Set(this.state.selectedBearingIds);
  }

  getLastSelectedId(): number | undefined {
    return this.state.lastSelectedId;
  }

  getLastSelectedType(): 'analet' | 'bearing' | undefined {
    return this.state.lastSelectedType;
  }

  // === SETTERS ===

  setAnalets(analets: Analet[]): void {
    this.state.analets = analets;
    this.markDirty();
  }

  setAnalysisComponents(components: AnalysisComponent[]): void {
    this.state.analysisComponents = components;
    this.markDirty();
  }

  setBearings(bearings: Bearing[]): void {
    this.state.bearings = bearings;
    this.markDirty();
  }

  setDatasetInfo(datasetInfo: DatasetInfo | null, hasDataset: boolean = true): void {
    this.state.datasetInfo = datasetInfo;
    this.state.hasDataset = hasDataset;
    this.markDirty();
  }

  setSelectedFolderName(folderName: string | null): void {
    this.state.selectedFolderName = folderName;
    this.markDirty();
  }

  setHierarchyState(hierarchyState: HierarchyState | null): void {
    this.state.hierarchyState = hierarchyState;
    this.markDirty();
  }

  // Selection state setters
  setSelectedAnaletIds(ids: Set<number>): void {
    this.state.selectedAnaletIds = Array.from(ids);
    this.markDirty();
  }

  setSelectedBearingIds(ids: Set<number>): void {
    this.state.selectedBearingIds = Array.from(ids);
    this.markDirty();
  }

  setLastSelected(id: number | undefined, type: 'analet' | 'bearing' | undefined): void {
    this.state.lastSelectedId = id;
    this.state.lastSelectedType = type;
    this.markDirty();
  }

  // === UTILITY METHODS ===

  /**
   * Clear all session state
   */
  clearSession(): void {
    this.state = this.getEmptyState();
    if (this.options.enabled) {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  /**
   * Get summary of current session state
   */
  getSessionSummary(): object {
    return {
      version: this.state.version,
      timestamp: this.state.timestamp,
      analetsCount: this.state.analets.length,
      componentsCount: this.state.analysisComponents.length,
      bearingsCount: this.state.bearings.length,
      hasDataset: this.state.hasDataset,
      selectedFolder: this.state.selectedFolderName,
      selectedAnalets: this.state.selectedAnaletIds.length,
      selectedBearings: this.state.selectedBearingIds.length
    };
  }

  /**
   * Check if we have meaningful state to restore
   */
  hasRestoredData(): boolean {
    return (
      this.state.analets.length > 0 ||
      this.state.analysisComponents.length > 0 ||
      this.state.hasDataset
    );
  }
}
