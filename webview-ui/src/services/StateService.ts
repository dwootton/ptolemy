import { Analet, Bearing, ConceptualStatement, VariableModification, SemanticLayer } from '../types/analet';
import { DatasetInfo } from '../components/DatasetLoader';
import { HierarchyState } from '../types/hierarchy';
import { DetectedCluster } from '../utilities/clusterDetection';
import { MeridianConfig, DEFAULT_CONFIG } from '../types/config';

export class StateService {
  private static instance: StateService;
  private readonly STORAGE_KEY = 'meridian-ui-state';

  // Simple state management for React transition
  private _selectedAnalets: Analet[] = [];
  private _availableAnalets: Analet[] = [];
  private _datasetInfo: DatasetInfo | null = null;
  private _hasDataset: boolean = false;
  private _isInitialized: boolean = false;


  // Hierarchy and cluster state
  private _hierarchyState: HierarchyState | null = null;
  private _detectedClusters: DetectedCluster[] = [];
  private _selectedFolderName: string | null = null;

  // Semantic layer state
  private _conceptualStatements: ConceptualStatement[] = [];
  private _conceptualFolders: any[] = [];
  private _bearings: Bearing[] = [];
  private _activeBearingId: number | null = null;

  // Debouncing for hierarchy state persistence
  private hierarchyStateTimer: NodeJS.Timeout | null = null;
  private readonly HIERARCHY_SAVE_DEBOUNCE_MS = 1000; // 1 second debounce

  // Configuration state
  private _config: MeridianConfig = DEFAULT_CONFIG;

  // Analet visibility/materialization state
  private _materializedAnaletIds: Set<number> = new Set();

  // Method to prevent TypeScript unused warnings
  private preventUnusedWarnings(): void {
    void this._conceptualFolders;
  }
  private _variableModifications: { [variableName: string]: VariableModification } = {};

  private constructor() {
    // Simple constructor for React version
    this.loadConfigFromStorage();
    this.loadBearings();
    this.loadActiveBearing();
    this.loadMaterializedAnalets();
    this.initializeFromPersistentState();
    this.preventUnusedWarnings();
  }

  public static getInstance(): StateService {
    if (!StateService.instance) {
      StateService.instance = new StateService();
    }
    return StateService.instance;
  }

  // Helper method to filter out deleted analets
  private filterActiveAnalets(analets: Analet[]): Analet[] {
    return analets.filter(analet => analet.status !== 'deleted');
  }

  // Initialize from persistent state via extension
  private async initializeFromPersistentState(): Promise<void> {
    if (this._isInitialized) return;

    try {
      // Use dynamic import to avoid circular dependency
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();

      // Listen for dataset-restored message from extension
      messageService.onMessage('dataset-restored', (data: any) => {
        if (data.dataset) {
          this._datasetInfo = data.dataset;
          this._hasDataset = true;
          this.saveDatasetToStorage(data.dataset);
        }
      });

      // Listen for fetch-analet-data message (unified source of truth for all analets)
      messageService.onMessage('fetch-analet-data', (data: any) => {
        try {
          if (Array.isArray(data.analets)) {
            // const sourceBreakdown = data.analets.reduce((acc: any, a: any) => {
            //   const k = a?.source || 'undefined';
            //   acc[k] = (acc[k] || 0) + 1;
            //   return acc;
            // }, {} as Record<string, number>);
            // const sample = data.analets.slice(0, 10).map((a: any) => ({ id: a.id, source: a.source }));
          }
        } catch (e) {
          console.warn('[DEBUG-HIER] breakdown logging failed', e);
        }
        if (data.analets && data.analets.length > 0) {
          // Filter out deleted analets before storing in state
          const activeAnalets = this.filterActiveAnalets(data.analets);
          this._availableAnalets = activeAnalets;
          // Manually dispatch analetsUpdated event to ensure UI refresh
          window.dispatchEvent(new CustomEvent('analetsUpdated', {
            detail: {
              action: data.promotedFromFraming ? 'promoted-from-framing' : 'data-loaded',
              count: data.analets.length,
              newAnaletsCount: data.newAnaletsCount || 0,
              promotedFromFraming: data.promotedFromFraming || false
            }
          }));
        }
      });

      // Listen for analets restored during initialization
      messageService.onMessage('analets-restored', (data: any) => {
        try {
          if (data?.success && Array.isArray(data.analets)) {
            const activeAnalets = this.filterActiveAnalets(data.analets);
            this._availableAnalets = activeAnalets;
            // Notify UI to refresh
            window.dispatchEvent(new CustomEvent('analetsUpdated', {
              detail: { action: 'restored', count: activeAnalets.length }
            }));
          }
        } catch (e) {
          console.warn('⚠️ StateService: Failed processing analets-restored:', e);
        }
      });

      // REMOVED: analet-created listener - all analets now come via fetch-analet-data
      // This eliminates the triple duplication issue

      // Listen for debug test messages to verify message routing
      messageService.onMessage('debug-test-message', (_data: any) => {
      });

      // Listen for analet updates (unified)
      messageService.onMessage('analet-updated', (data: any) => {
        try {
          const updated = data?.analet;
          if (!updated || typeof updated.id !== 'number') return;
          const idx = this._availableAnalets.findIndex(a => a.id === updated.id);
          if (idx >= 0) {
            // Capture previous to compute meaningful-change flags
            const prev = this._availableAnalets[idx];
            // Strategic: if shallow merge fails to trigger UI changes, replace then re-insert to break referential equality
            const replaced = { ...this._availableAnalets[idx], ...updated };
            this._availableAnalets.splice(idx, 1);
            this._availableAnalets.push(replaced);
            // Determine if UMAP-relevant fields changed (embedding or location)
            const prevLoc = prev?.location ? { x: prev.location.x || 0, y: prev.location.y || 0 } : { x: 0, y: 0 };
            const newLoc = replaced?.location ? { x: replaced.location.x || 0, y: replaced.location.y || 0 } : { x: 0, y: 0 };
            const locationChanged = Math.abs(prevLoc.x - newLoc.x) > 0 || Math.abs(prevLoc.y - newLoc.y) > 0;
            const prevEmb = Array.isArray(prev?.embedding) ? prev!.embedding! : [];
            const newEmb = Array.isArray(replaced?.embedding) ? replaced!.embedding! : [];
            const embeddingChanged = (prevEmb.length !== newEmb.length) || (prevEmb[0] !== newEmb[0]) || (prevEmb[1] !== newEmb[1]) || (prevEmb[2] !== newEmb[2]);

            // Only nudge UMAP consumers when necessary
            if (locationChanged || embeddingChanged) {
              window.dispatchEvent(new CustomEvent('umapConfigChanged', { detail: { reason: 'analet-updated', id: updated.id, locationChanged, embeddingChanged } }));
            }
          } else {
            // If not present, add (defensive)
            this._availableAnalets.push(updated);
          }
          window.dispatchEvent(new CustomEvent('analetUpdated', { detail: updated }));
          window.dispatchEvent(new CustomEvent('analetsUpdated', { detail: { action: 'updated', id: updated.id } }));
        } catch (e) {
          console.error('❌ StateService: Failed to process analet-updated:', e);
        }
      });

      // Listen for analet deletion due to notebook deletion
      messageService.onMessage('analets-deleted-notebook', (data: any) => {
        if (data.removedAnaletIds && data.removedAnaletIds.length > 0) {
          // Remove the deleted analets from local state
          this._availableAnalets = this._availableAnalets.filter(
            analet => !data.removedAnaletIds.includes(analet.id)
          );
          // Also remove from selected analets if any were selected
          this._selectedAnalets = this._selectedAnalets.filter(
            analet => !data.removedAnaletIds.includes(analet.id)
          );
          // Trigger a global event to notify other components that might be listening
          window.dispatchEvent(new CustomEvent('analetsUpdated', {
            detail: {
              action: 'deleted',
              count: data.removedCount,
              notebookFileName: data.notebookFileName
            }
          }));
        }
      });

      // Listen for individual analet deletion responses
      messageService.onMessage('delete-analet-response', (data: any) => {
        if (data.success && data.deletedAnaletId) {
          // Remove the deleted analet from local state
          const deletedId = data.deletedAnaletId;
          this._availableAnalets = this._availableAnalets.filter(
            analet => analet.id !== deletedId
          );
          // Also remove from selected analets if it was selected
          this._selectedAnalets = this._selectedAnalets.filter(
            analet => analet.id !== deletedId
          );
          // Update with remaining analets from backend if provided
          if (data.remainingAnalets && Array.isArray(data.remainingAnalets)) {
            // Filter out deleted analets before storing
            const activeAnalets = this.filterActiveAnalets(data.remainingAnalets);
            this._availableAnalets = activeAnalets;
          }
          // Dispatch update event to notify UI components (especially the map)
          window.dispatchEvent(new CustomEvent('analetsUpdated', {
            detail: {
              action: 'deleted',
              deletedAnaletId: deletedId,
              analetsCount: this._availableAnalets.length
            }
          }));
        }
      });

      // Listen for purge-data-response to handle purge completion
      messageService.onMessage('purge-data-response', (data: any) => {
        if (data.success) {
          // Clear all local UI state comprehensively (includes bearings + storage keys)
          this.clearAllState();
          // Notify UI for analet-driven views explicitly
          try {
            window.dispatchEvent(new CustomEvent('analetsUpdated', {
              detail: { action: 'purged', analetsCount: 0 }
            }));
          } catch {}
        } else {
          console.warn('❌ StateService: Extension purge failed:', data.error);
        }
      });

      // Listen for hierarchy state restoration from extension
      messageService.onMessage('hierarchy-state-restored', (data: any) => {
        if (data.success) {
          // Restore hierarchy state
          if (data.hierarchyState) {
            // Check size before restoring to prevent loading corrupted massive states
            const stateSize = this.estimateObjectSize(data.hierarchyState);
            if (stateSize > 5 * 1024 * 1024) { // 5MB limit
              console.warn('🚫 StateService: Received hierarchy state that is too large:', Math.round(stateSize / 1024), 'KB - ignoring restoration');
            } else {
              // Convert object back to Map/Set if needed
              const hierarchyState = {
                ...data.hierarchyState,
                flatMap: data.hierarchyState.flatMap instanceof Map
                  ? data.hierarchyState.flatMap
                  : new Map(Object.entries(data.hierarchyState.flatMap || {})),
                expandedFolders: (data.hierarchyState as any).expandedFolders instanceof Set
                  ? (data.hierarchyState as any).expandedFolders
                  : new Set(Array.isArray((data.hierarchyState as any).expandedFolders) ? (data.hierarchyState as any).expandedFolders : []),
                selectionState: {
                  ...data.hierarchyState.selectionState,
                  selectedIds: (data.hierarchyState as any).selectionState?.selectedIds instanceof Set
                    ? (data.hierarchyState as any).selectionState.selectedIds
                    : new Set(Array.isArray((data.hierarchyState as any)?.selectionState?.selectedIds) ? (data.hierarchyState as any).selectionState.selectedIds : [])
                }
              } as HierarchyState;
              this._hierarchyState = hierarchyState;
              try { window.dispatchEvent(new CustomEvent('hierarchyStateUpdated')); } catch {}
            }
          }

          // Restore detected clusters
          if (data.detectedClusters) {
            this._detectedClusters = data.detectedClusters;
          }

          // Restore selected folder
          if (data.selectedFolderName !== undefined) {
            this._selectedFolderName = data.selectedFolderName;
          }
        } else {
          console.warn('❌ StateService: Hierarchy state restoration failed:', data.error);
        }
      });

      // Listen for dataset-cleared message
      messageService.onMessage('dataset-cleared', (data: any) => {
        if (data.success) {
          this._datasetInfo = null;
          this._hasDataset = false;
          this.clearDatasetFromStorage();
        }
      });

      // Listen for formalism inverter messages
      messageService.onMessage('formalism-inverter-started', (_data: any) => {
        // Could show a loading indicator here
      });

      messageService.onMessage('formalism-inverter-completed', (data: any) => {
        if (!(data.success)) {
          console.warn(`❌ StateService: Formalism inverter failed for analet ${data.analetId}:`, data.error);
        }
      });

      // Listen for semantic layer responses
      messageService.onMessage('semantic-layer-load-response', (data: any) => {
        if (data.success && data.semanticLayer) {
          this._conceptualStatements = data.semanticLayer.conceptualStatements || [];
          this._variableModifications = data.semanticLayer.variableModifications || {};
        }
      });

      messageService.onMessage('conceptual-statements-save-response', (data: any) => {
        if (!(data.success)) {
          console.warn('❌ StateService: Failed to save conceptual statements:', data.error);
        }
      });

      messageService.onMessage('variable-modifications-save-response', (data: any) => {
        if (!(data.success)) {
          console.warn('❌ StateService: Failed to save variable modifications:', data.error);
        }
      });

      messageService.onMessage('semantic-layer-export-response', (data: any) => {
        if (!(data.success)) {
          console.warn('❌ StateService: Failed to export semantic layer:', data.error);
        }
      });

      // Handle dataset data requests from frontend
      messageService.onMessage('dataset-data-response', (data: any) => {
        if (data.success && data.data && this._datasetInfo) {
          // Update the current dataset info with the received data
          this._datasetInfo = {
            ...this._datasetInfo,
            data: data.data
          };
          // Save updated dataset to storage
          this.saveDatasetToStorage(this._datasetInfo);
        } else {
          console.warn('❌ StateService: Failed to receive dataset data:', data.error);
        }
      });

      // Load semantic layer data on initialization (after all listeners are set up)
      this.loadSemanticLayer();

      this._isInitialized = true;
    } catch (error) {
      console.warn('Failed to initialize from persistent state:', error);
    }
  }

  // Getters for direct value access (React compatible)
  public getSelectedAnalets(): Analet[] {
    return this._selectedAnalets;
  }

  public getAvailableAnalets(): Analet[] {
    return this._availableAnalets;
  }

  public getDatasetInfo(): DatasetInfo | null {
    return this._datasetInfo;
  }

  public getHasDataset(): boolean {
    return this._hasDataset;
  }

  // Configuration getters and setters
  public getConfig(): MeridianConfig {
    return this._config;
  }

  public updateConfig(config: Partial<MeridianConfig>): void {
    this._config = {
      ...this._config,
      ...config,
      umap: {
        ...this._config.umap,
        ...(config.umap || {})
      },
      telemetry: {
        ...(this._config.telemetry || {} as any),
        ...((config as any).telemetry || {})
      },
      ui: {
        ...(this._config.ui || {}),
        ...(config.ui || {})
      }
    } as MeridianConfig;

    // Persist config to localStorage
    try {
      localStorage.setItem(this.STORAGE_KEY + '-config', JSON.stringify(this._config));
    } catch (error) {
      console.warn('⚠️ [StateService] Failed to persist configuration:', error);
    }

    // Notify listeners
    try { window.dispatchEvent(new CustomEvent('configUpdated', { detail: { config: this._config } })); } catch {}
  }

  public getUMAPImplementation(): 'custom' | 'umap-js' {
    return this._config.umap.implementation;
  }

  public setUMAPImplementation(implementation: 'custom' | 'umap-js'): void {
    this.updateConfig({
      umap: {
        ...this._config.umap,
        implementation
      }
    });
  }

  // === Telemetry configuration ===
  public isRRWebEnabled(): boolean {
    return !!this._config.telemetry?.rrwebEnabled;
  }

  public setRRWebEnabled(enabled: boolean): void {
    this.updateConfig({
      telemetry: {
        ...(this._config.telemetry || {}),
        rrwebEnabled: enabled
      }
    } as Partial<MeridianConfig>);
  }

  public getTelemetryMaskAllInputs(): boolean {
    return !!this._config.telemetry?.maskAllInputs;
  }

  public setTelemetryMaskAllInputs(mask: boolean): void {
    this.updateConfig({
      telemetry: {
        ...(this._config.telemetry || {}),
        maskAllInputs: mask
      }
    } as Partial<MeridianConfig>);
  }

  // === UI configuration ===
  public getGridLayoutEnabled(): boolean {
    return !!this._config.ui?.gridLayout;
  }

  public setGridLayoutEnabled(enabled: boolean): void {
    this.updateConfig({
      ui: {
        gridLayout: enabled,
        viewMode: this._config.ui?.viewMode || 'full'
      }
    });
  }

  public getViewMode(): 'full' | 'map' | 'canvas' | 'tree' {
    return this._config.ui?.viewMode || 'full';
  }

  public setViewMode(mode: 'full' | 'map' | 'canvas' | 'tree'): void {
    // Determine grid layout state based on view mode
    let finalGridLayout: boolean;
    if (mode === 'canvas') {
      finalGridLayout = true; // Always enable grid in canvas mode
    } else {
      finalGridLayout = false; // Disable grid for map/full/tree modes (use spatial UMAP layout)
    }

    this.updateConfig({
      ui: {
        gridLayout: finalGridLayout,
        viewMode: mode
      }
    });

    // Dispatch custom event to notify components of view mode change
    window.dispatchEvent(new CustomEvent('viewModeChanged', { detail: { mode } }));

    // Always dispatch grid layout change event to ensure components update
    window.dispatchEvent(new CustomEvent('gridLayoutChanged', { detail: { enabled: finalGridLayout } }));
  }

  private loadConfigFromStorage(): void {
    try {
      const savedConfig = localStorage.getItem(this.STORAGE_KEY + '-config');
      if (savedConfig) {
        const parsedConfig = JSON.parse(savedConfig);
        this._config = {
          ...DEFAULT_CONFIG,
          ...parsedConfig,
          umap: {
            ...DEFAULT_CONFIG.umap,
            ...parsedConfig.umap
          },
          ui: {
            ...DEFAULT_CONFIG.ui,
            ...parsedConfig.ui
          }
        };
      }
    } catch (error) {
      console.warn('⚠️ [StateService] Failed to load configuration from storage, using defaults:', error);
      this._config = DEFAULT_CONFIG;
    }
  }

  // Hierarchy state getters and setters
  public getHierarchyState(): HierarchyState | null {
    return this._hierarchyState;
  }

  private hierarchyStateBlocked: boolean = false;
  private blockResetTimer: NodeJS.Timeout | null = null;

  public setHierarchyState(state: HierarchyState): void {
    // Circuit breaker: if we're blocked, ignore all requests
    if (this.hierarchyStateBlocked) {
      console.warn('🚫 StateService: Hierarchy state updates BLOCKED due to corruption - ignoring');
      return;
    }

    // Check size before setting to prevent corruption
    const stateSize = this.estimateObjectSize(state);
    if (stateSize > 1 * 1024 * 1024) { // Reduced to 1MB limit for safety
      console.error('🚫 StateService: Attempted to set hierarchy state that is too large:', Math.round(stateSize / 1024), 'KB - BLOCKING future updates');

      // EMERGENCY: Block all future hierarchy state updates
      this.hierarchyStateBlocked = true;
      this._hierarchyState = null;
      this._detectedClusters = [];
      this._selectedFolderName = null;

      // Clear all related storage immediately
      this.emergencyCleanup();

      // Reset block after 30 seconds to allow recovery
      if (this.blockResetTimer) clearTimeout(this.blockResetTimer);
      this.blockResetTimer = setTimeout(() => {
        this.hierarchyStateBlocked = false;
      }, 30000);

      return;
    }

    this._hierarchyState = state;
    this.debouncedSaveHierarchyState(state);
  }

  private debouncedSaveHierarchyState(state: HierarchyState): void {
    // Debounce both localStorage saves and extension persistence to prevent infinite loops
    if (this.hierarchyStateTimer) {
      clearTimeout(this.hierarchyStateTimer);
    }

    this.hierarchyStateTimer = setTimeout(() => {
      // Save to localStorage (with size checks to prevent repeated warnings)
      this.saveHierarchyToStorageDebounced(state);

      // Send to extension
      this.sendHierarchyStateToExtension().catch(error => {
        console.warn('Failed to send hierarchy state to extension:', error);
      });

      this.hierarchyStateTimer = null;
    }, this.HIERARCHY_SAVE_DEBOUNCE_MS);
  }

  private saveHierarchyToStorageDebounced(state: HierarchyState): void {
    try {
      // First, create a size-limited version to prevent JSON.stringify errors
      const limitedState = this.createLimitedHierarchyState(state);
      if (!limitedState) {
        console.warn('⚠️ StateService: Cannot create limited hierarchy state, skipping save');
        return;
      }

      // Convert Map/Set to serializable structures for storage
      const serializable = {
        ...limitedState,
        flatMap: Object.fromEntries(limitedState.flatMap),
        expandedFolders: Array.from(limitedState.expandedFolders || []),
        selectionState: {
          ...limitedState.selectionState,
          selectedIds: Array.from(limitedState.selectionState?.selectedIds || [])
        }
      } as any;

      let dataString: string;
      try {
        dataString = JSON.stringify(serializable);
      } catch (stringifyError) {
        console.warn('⚠️ StateService: JSON.stringify failed for hierarchy state:', stringifyError);
        // Try with an even more limited version
        const veryLimitedState = this.createVeryLimitedHierarchyState(state);
        if (veryLimitedState) {
          const veryLimitedSerializable = {
            ...veryLimitedState,
            flatMap: Object.fromEntries(veryLimitedState.flatMap),
            expandedFolders: Array.from(veryLimitedState.expandedFolders || []),
            selectionState: {
              ...veryLimitedState.selectionState,
              selectedIds: Array.from(veryLimitedState.selectionState?.selectedIds || [])
            }
          } as any;
          dataString = JSON.stringify(veryLimitedSerializable);
        } else {
          console.error('❌ StateService: Cannot serialize hierarchy state even with minimal data');
          return;
        }
      }

      // Check if data is too large for localStorage (approximate 5MB limit)
      if (dataString.length > 5 * 1024 * 1024) {
        console.warn('⚠️ StateService: Hierarchy state too large for localStorage, skipping local storage (debounced)');
        return; // Don't attempt to save or show repeated warnings
      }

      localStorage.setItem(this.STORAGE_KEY + '-hierarchy', dataString);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        console.warn('⚠️ StateService: LocalStorage quota exceeded, clearing old hierarchy data and retrying (debounced)');
        this.clearOldHierarchyData();
        // Try one more time with a truncated version
        this.saveHierarchyToStorageCompressed(state);
      } else {
        console.warn('Failed to save hierarchy to storage (debounced):', e);
      }
    }
  }

  public getDetectedClusters(): DetectedCluster[] {
    return this._detectedClusters;
  }

  public setDetectedClusters(clusters: DetectedCluster[]): void {
    this._detectedClusters = clusters;
    this.saveClustersToStorage(clusters);
    // Send updated hierarchy state (including clusters) to extension
    this.sendHierarchyStateToExtension().catch(error => {
      console.warn('Failed to send hierarchy state to extension after cluster update:', error);
    });
  }

  public getSelectedFolderName(): string | null {
    return this._selectedFolderName;
  }

  public setSelectedFolderName(folderName: string | null): void {
    this._selectedFolderName = folderName;
    this.saveSelectedFolderToStorage(folderName);
    // Send updated hierarchy state (including selected folder) to extension
    this.sendHierarchyStateToExtension().catch(error => {
      console.warn('Failed to send hierarchy state to extension after folder selection:', error);
    });
  }

  // Set dataset information
  public setDataset(dataset: DatasetInfo, skipPersistence: boolean = false): void {
    this._datasetInfo = dataset;
    this._hasDataset = true;

    // Use enhanced storage service
    this.saveDatasetToStorage(dataset);

    // Only persist to extension if not already coming from extension
    if (!skipPersistence) {
      this.persistDatasetToExtension(dataset);
    }
  }

  private isClearing = false;

  // Clear dataset information
  public clearDataset(): void {
    if (this.isClearing) {
      return;
    }
    this.isClearing = true;

    this._datasetInfo = null;
    this._hasDataset = false;
    this.clearDatasetFromStorage();

    // Also clear from backend persistence using dynamic import to avoid circular dependency
    import('./MessageService').then(({ MessageService }) => {
      const messageService = MessageService.getInstance();
      messageService.sendMessage('clear-dataset');
      this.isClearing = false; // Reset flag after backend call
    }).catch(error => {
      console.warn('Failed to send clear-dataset message:', error);
      this.isClearing = false; // Reset flag on error
    });
  }

  // Request cancellation of all ongoing operations
  public requestOperationCancellation(): void {
    localStorage.setItem('meridian-cancellation-requested', 'true');

    // Also send cancellation message to backend
    this.sendCancellationMessage();
  }

  // Check if operations should be cancelled
  public isOperationCancelled(): boolean {
    return localStorage.getItem('meridian-cancellation-requested') === 'true';
  }

  // Clear cancellation flag
  public clearCancellationFlag(): void {
    localStorage.removeItem('meridian-cancellation-requested');
  }

  // Send cancellation message to backend
  private async sendCancellationMessage(): Promise<void> {
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();
      messageService.sendMessage('cancel-all-operations', {
        reason: 'purge-requested',
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn('⚠️ StateService: Failed to send cancellation message:', error);
    }
  }

  // Clear all state
  public clearAllState(): void {
    // First, request cancellation of all ongoing operations
    this.requestOperationCancellation();

    // Reset circuit breaker
    this.hierarchyStateBlocked = false;
    if (this.blockResetTimer) {
      clearTimeout(this.blockResetTimer);
      this.blockResetTimer = null;
    }

    this._selectedAnalets = [];
    this._availableAnalets = [];
    this._datasetInfo = null;
    this._hasDataset = false;
    this._hierarchyState = null;
    this._detectedClusters = [];
    this._selectedFolderName = null;
    this._conceptualStatements = [];
    this._conceptualFolders = [];
    this._variableModifications = {};
    this._variableModifications = {};
    // Bearings: clear memory and active id
    this._bearings = [];
    this._activeBearingId = null;
    // Clear materialized analets
    this._materializedAnaletIds.clear();

    // Clear all localStorage keys that StateService might use
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(this.STORAGE_KEY) || key.startsWith('StateService_'))) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    // Explicitly remove bearings and materialization storage keys
    try {
      localStorage.removeItem('meridian-bearings');
      localStorage.removeItem('meridian-active-bearing');
      localStorage.removeItem('meridian-materialized-analets');
    } catch {}

    // Storage cleared via SessionStateService
    this.clearDatasetFromStorage();

    // Sync clear with BearingStateService (if present)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BearingStateService } = require('./BearingStateService');
      const bearingSvc = BearingStateService.getInstance();
      if (bearingSvc?.clearStorage) bearingSvc.clearStorage();
      else if (bearingSvc?.reset) bearingSvc.reset();
    } catch {}

    // Notify listeners that bearings and active state changed
    try { window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'purged' } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('activeBearingChanged', { detail: { id: null } })); } catch {}

    // Clear the cancellation flag after a short delay to allow operations to see it
    setTimeout(() => {
      this.clearCancellationFlag();
    }, 2000);
  }


  // Public method to purge all data (for UI components)
  public async purgeAllData(): Promise<void> {
    // Only clear local state, don't trigger extension purge
    // Extension purge should be initiated from UI components
    this.clearAllState();
  }

  // Set available analets (called when data is loaded)
  public setAnaletsData(analets: Analet[]): void {
    // Enforce uniqueness by id and log diagnostics
    const incoming = analets || [];

    const map = new Map<number, Analet>();
    const duplicates: number[] = [];
    for (const a of incoming) {
      if (a && typeof a.id === 'number') {
        if (map.has(a.id)) duplicates.push(a.id);
        map.set(a.id, a);
      }
    }
    this._availableAnalets = Array.from(map.values());
    try {
      if (duplicates.length > 0) {
        // Note: duplicates exist but not currently used
      }
    } catch {}

    // Mark notebook-synced analets as visited (materialized)
    try {
      const notebookSynced = this._availableAnalets.filter(a => !!(a.notebookFileName || a.notebookCellMetadata));
      if (notebookSynced.length > 0) {
        let added = 0;
        for (const a of notebookSynced) {
          if (!this._materializedAnaletIds.has(a.id)) {
            this._materializedAnaletIds.add(a.id);
            added++;
          }
        }
        if (added > 0) {
          this.saveMaterializedAnalets();
          try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}
        }
      }
    } catch {}
  }

  // Select an analet
  public selectAnalet(analet: Analet): void {
    const current = this._selectedAnalets;
    const isAlreadySelected = current.some(a => a.id === analet.id);

    if (!isAlreadySelected) {
      this._selectedAnalets = [...current, analet];
    }
  }

  // Check if analet is selected
  public isAnaletSelected(analet: Analet): boolean {
    return this._selectedAnalets.some(a => a.id === analet.id);
  }

  // Add analet to available list (for notebook-derived analets)
  public addAnalet(analet: Analet, options?: { isFromNotebook?: boolean }): void {
    // Check if analet already exists
    const existingIndex = this._availableAnalets.findIndex(a => a.id === analet.id);


    if (existingIndex >= 0) {
      // Update existing analet
      this._availableAnalets[existingIndex] = analet;

    } else {
      // Add new analet
      // Defensive: avoid accidental duplicates by id
      if (!this._availableAnalets.some(a => a.id === analet.id)) {
        this._availableAnalets = [...this._availableAnalets, analet];

      }
    }

    // If this analet is from a notebook (explicit or inferred), mark as visited/materialized
    try {
      const fromNotebook = options?.isFromNotebook === true || !!(analet.notebookFileName || analet.notebookCellMetadata) || analet.source === 'notebook';
      if (fromNotebook) {
        if (!this._materializedAnaletIds.has(analet.id)) {
          this._materializedAnaletIds.add(analet.id);
          this.saveMaterializedAnalets();
          try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}
        }
      }
    } catch {}
  }

  // Remove analet from available list
  public removeAnalet(analetId: number): void {
    this._availableAnalets = this._availableAnalets.filter(a => a.id !== analetId);
    this._selectedAnalets = this._selectedAnalets.filter(a => a.id !== analetId);
  }

  // Remove analets by notebook filename
  public removeAnaletsByNotebook(notebookFileName: string): number {
    const initialAvailableCount = this._availableAnalets.length;
    const initialSelectedCount = this._selectedAnalets.length;

    this._availableAnalets = this._availableAnalets.filter(a => a.notebookFileName !== notebookFileName);
    this._selectedAnalets = this._selectedAnalets.filter(a => a.notebookFileName !== notebookFileName);

    const removedCount = initialAvailableCount - this._availableAnalets.length;
    void initialSelectedCount;
    return removedCount;
  }

  // Persist dataset to extension's StateManagementService
  private async persistDatasetToExtension(dataset: DatasetInfo): Promise<void> {
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();
      messageService.sendMessage('analyze-dataset', { dataset });
    } catch (error) {
      console.warn('Failed to persist dataset to extension:', error);
    }
  }

  // Enhanced dataset storage methods
  private async saveDatasetToStorage(dataset: DatasetInfo): Promise<void> {
    try {
      const { DatasetStateService } = await import('./StateServices/DatasetStateService');
      const ds = DatasetStateService.getInstance();
      ds.setDataset(dataset, true);
    } catch (error) {
      console.error('❌ [StateService] Failed to save dataset to enhanced storage:', error);
      // Fallback to old localStorage method
      this.fallbackSaveToLocalStorage(dataset);
    }
  }

  private fallbackSaveToLocalStorage(dataset: DatasetInfo): void {
    try {
      // Remove data to avoid localStorage size limits
      const { data, ...datasetWithoutData } = dataset;
      localStorage.setItem(this.STORAGE_KEY + '-dataset', JSON.stringify(datasetWithoutData));
    } catch (e) {
      console.warn('❌ [StateService] Even fallback localStorage save failed:', e);
    }
  }

  private async clearDatasetFromStorage(): Promise<void> {
    try {
      const { DatasetStateService } = await import('./StateServices/DatasetStateService');
      const ds = DatasetStateService.getInstance();
      // Local-only clear to avoid triggering backend 'clear-dataset' during purge/reset
      ds.clearAllState();
      // Also clear old localStorage keys
      localStorage.removeItem(this.STORAGE_KEY + '-dataset');
    } catch (e) {
      console.warn('❌ [StateService] Failed to clear dataset from storage:', e);
    }
  }

  // Public method to get dataset with data
  public async getDatasetWithData(): Promise<DatasetInfo | null> {
    try {
      const { DatasetStateService } = await import('./StateServices/DatasetStateService');
      const ds = DatasetStateService.getInstance();
      const dataset = ds.getDatasetInfo();
      if (dataset) {
        return dataset;
      }

      // Fallback to current in-memory dataset
      return this._datasetInfo;
    } catch (error) {
      console.error('❌ [StateService] Error retrieving dataset with data:', error);
      return this._datasetInfo;
    }
  }

  // Hierarchy and cluster state persistence

  private clearOldHierarchyData(): void {
    try {
      // Remove hierarchy-related localStorage items
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('hierarchy')) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
      });
    } catch (e) {
      console.warn('Failed to clear old hierarchy data:', e);
    }
  }

  private saveHierarchyToStorageCompressed(state: HierarchyState): void {
    try {
      // Create a compressed version by limiting the flatMap size
      const serializable = {
        ...state,
        flatMap: Object.fromEntries(
          Array.from(state.flatMap.entries()).slice(0, 1000) // Limit to 1000 entries
        ),
        expandedFolders: Array.from(state.expandedFolders || []),
        selectionState: {
          ...state.selectionState,
          selectedIds: Array.from(state.selectionState?.selectedIds || [])
        }
      } as any;

      const dataString = JSON.stringify(serializable);
      localStorage.setItem(this.STORAGE_KEY + '-hierarchy', dataString);
    } catch (e) {
      console.warn('Failed to save even compressed hierarchy to storage:', e);
      // Fallback: just store basic structure without flatMap
      try {
        const basicState = {
          ...state,
          flatMap: {},
          expandedFolders: Array.from(state.expandedFolders || []),
          selectionState: {
            ...state.selectionState,
            selectedIds: Array.from(state.selectionState?.selectedIds || [])
          }
        } as any;
        localStorage.setItem(this.STORAGE_KEY + '-hierarchy', JSON.stringify(basicState));
      } catch (finalError) {
        console.error('Failed to save even minimal hierarchy state:', finalError);
      }
    }
  }

  private saveClustersToStorage(clusters: DetectedCluster[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY + '-clusters', JSON.stringify(clusters));
    } catch (e) {
      console.warn('Failed to save clusters to storage:', e);
    }
  }

  private saveSelectedFolderToStorage(folderName: string | null): void {
    try {
      if (folderName) {
        localStorage.setItem(this.STORAGE_KEY + '-selected-folder', folderName);
      } else {
        localStorage.removeItem(this.STORAGE_KEY + '-selected-folder');
      }
    } catch (e) {
      console.warn('Failed to save selected folder to storage:', e);
    }
  }

  // Send hierarchy state to extension for persistence
  private async sendHierarchyStateToExtension(): Promise<void> {
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();

      // Don't send during purge operations
      if (!this._hierarchyState) {
        return;
      }

      // Quick size check before processing - if the raw state is already too large, clear it
      const rawStateSize = this.estimateObjectSize(this._hierarchyState);
      if (rawStateSize > 10 * 1024 * 1024) { // 10MB - definitely corrupted
        console.error('🚫 StateService: Hierarchy state is corrupted (too large):', Math.round(rawStateSize / 1024), 'KB - clearing it');
        this._hierarchyState = null;
        this._detectedClusters = [];
        this._selectedFolderName = null;
        // Clear hierarchy from storage
        try {
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.includes('hierarchy') || key.includes('clusters') || key.includes('folder'))) {
              keysToRemove.push(key);
            }
          }

          keysToRemove.forEach(key => {
            localStorage.removeItem(key);
          });
        } catch (e) {
          console.warn('Failed to clear corrupted hierarchy data:', e);
        }
        return;
      }

      // Create a size-limited version of the hierarchy state
      const limitedHierarchyState = this.createLimitedHierarchyState(this._hierarchyState);

      const payload = {
        hierarchyState: limitedHierarchyState,
        detectedClusters: this._detectedClusters,
        selectedFolderName: this._selectedFolderName
      };

      // Check payload size before sending - be more conservative
      const payloadSize = this.estimateObjectSize(payload);
      if (payloadSize > 2 * 1024 * 1024) { // 2MB limit (more conservative)
        console.warn('🚫 StateService: Hierarchy state too large for persistence:', Math.round(payloadSize / 1024), 'KB');
        // Try to save just the structure without analet data
        const minimalPayload = {
          hierarchyState: null, // Skip hierarchy for now
          detectedClusters: [],
          selectedFolderName: this._selectedFolderName
        };
        messageService.sendMessage('save-hierarchy-state', minimalPayload);
        return;
      }

      messageService.sendMessage('save-hierarchy-state', payload);
    } catch (error) {
      console.warn('Failed to send hierarchy state to extension:', error);
      // Don't crash on persistence errors
    }
  }

  // Create a size-limited version of hierarchy state for persistence
  private createLimitedHierarchyState(hierarchyState: HierarchyState | null): HierarchyState | null {
    if (!hierarchyState) return null;

    // Create a deep clone but with reduced analet data
    const limitedFlatMap = new Map<string, any>();

    // For each node in flatMap, create a reduced version
    hierarchyState.flatMap.forEach((node, key) => {
      const limitedNode = { ...node };

      // If this node contains analet, reduce its size
      if (limitedNode.analet) {
        limitedNode.analet = {
          id: limitedNode.analet.id,
          statement: limitedNode.analet.statement,
          explanation: limitedNode.analet.explanation,
          tags: limitedNode.analet.tags,
          location: limitedNode.analet.location,
          conceptAxes: limitedNode.analet.conceptAxes?.slice(0, 5) || [], // Limit concept axes
          // Exclude heavy data: embedding, notebook content, comments
        };
      }

      limitedFlatMap.set(key, limitedNode);
    });

    // Create limited root by traversing and applying same reductions
    const limitedRoot = this.limitNodeRecursively(hierarchyState.root);

    return {
      ...hierarchyState,
      flatMap: limitedFlatMap,
      root: limitedRoot,
      // Keep other lightweight properties as-is
    };
  }

  // Recursively limit node data
  private limitNodeRecursively(node: any): any {
    const limitedNode = { ...node };

    // Reduce analets in this node
    if (limitedNode.analets && Array.isArray(limitedNode.analets)) {
      limitedNode.analets = limitedNode.analets.map((analet: any) => ({
        id: analet.id,
        statement: analet.statement,
        explanation: analet.explanation,
        tags: analet.tags,
        location: analet.location,
        conceptAxes: analet.conceptAxes?.slice(0, 5) || [], // Limit concept axes
      }));
    }

    // Recursively limit children
    if (limitedNode.children && Array.isArray(limitedNode.children)) {
      limitedNode.children = limitedNode.children.map((child: any) =>
        this.limitNodeRecursively(child)
      );
    }

    return limitedNode;
  }

  // Create a very limited version with only essential data for extreme cases
  private createVeryLimitedHierarchyState(hierarchyState: HierarchyState | null): HierarchyState | null {
    if (!hierarchyState) return null;

    try {
      // Create an extremely minimal version with only IDs and names
      const veryLimitedFlatMap = new Map<string, any>();

      // Keep only essential structure - limit to first 100 nodes
      let nodeCount = 0;
      const maxNodes = 100;

      for (const [key, node] of hierarchyState.flatMap) {
        if (nodeCount >= maxNodes) break;

        const minimalNode = {
          id: node.id,
          name: node.name?.slice(0, 50) || '', // Truncate names
          type: node.type,
          parentId: node.parentId,
          isExpanded: node.isExpanded || false,
          // Only include analet ID if it exists
          ...(node.analet?.id && { analetId: node.analet.id })
        };

        veryLimitedFlatMap.set(key, minimalNode);
        nodeCount++;
      }

      // Create minimal root structure
      const minimalRoot = {
        id: hierarchyState.root?.id || 'root',
        name: hierarchyState.root?.name?.slice(0, 50) || 'Root',
        type: hierarchyState.root?.type || 'folder',
        children: [], // Don't include full children hierarchy
        isExpanded: true
      };

      return {
        ...hierarchyState,
        flatMap: veryLimitedFlatMap,
        root: minimalRoot,
        // Keep existing properties but limit their size
        expandedFolders: new Set(Array.from(hierarchyState.expandedFolders).slice(0, 20)), // Limit expanded folders
        links: hierarchyState.links.slice(0, 10), // Limit links
        selectionState: {
          selectedIds: new Set(Array.from(hierarchyState.selectionState.selectedIds).slice(0, 5)),
          lastSelectedId: hierarchyState.selectionState.lastSelectedId,
          contextMenuOpen: false // Reset context menu state
        }
      };
    } catch (error) {
      console.error('Failed to create very limited hierarchy state:', error);
      return null;
    }
  }

  // Estimate object size in bytes (rough approximation)
  private estimateObjectSize(obj: any): number {
    try {
      return JSON.stringify(obj).length * 2; // Rough estimate: 2 bytes per character
    } catch (error) {
      console.warn('Failed to estimate object size:', error);
      return Infinity; // Assume too large if we can't stringify
    }
  }

  // Load persisted hierarchy and cluster state
  public loadPersistedState(): {
    hierarchyState: HierarchyState | null;
    detectedClusters: DetectedCluster[];
    selectedFolderName: string | null;
  } {
    try {
      // Load hierarchy state
      let hierarchyState: HierarchyState | null = null;
      const hierarchyData = localStorage.getItem(this.STORAGE_KEY + '-hierarchy');
      if (hierarchyData) {
        const parsed = JSON.parse(hierarchyData);
        // Convert object back to Map/Set
        hierarchyState = {
          ...parsed,
          flatMap: new Map(Object.entries(parsed.flatMap || {})),
          expandedFolders: new Set(Array.isArray(parsed.expandedFolders) ? parsed.expandedFolders : []),
          selectionState: {
            ...parsed.selectionState,
            selectedIds: new Set(Array.isArray(parsed.selectionState?.selectedIds) ? parsed.selectionState.selectedIds : [])
          }
        } as HierarchyState;
        this._hierarchyState = hierarchyState;
        try { window.dispatchEvent(new CustomEvent('hierarchyStateUpdated')); } catch {}
      }

      // Load detected clusters
      let detectedClusters: DetectedCluster[] = [];
      const clustersData = localStorage.getItem(this.STORAGE_KEY + '-clusters');
      if (clustersData) {
        detectedClusters = JSON.parse(clustersData);
        this._detectedClusters = detectedClusters;
      }

      // Load selected folder
      let selectedFolderName: string | null = null;
      const folderData = localStorage.getItem(this.STORAGE_KEY + '-selected-folder');
      if (folderData) {
        selectedFolderName = folderData;
        this._selectedFolderName = selectedFolderName;
      }

      return { hierarchyState, detectedClusters, selectedFolderName };
    } catch (e) {
      console.warn('Failed to load persisted state:', e);
      return { hierarchyState: null, detectedClusters: [], selectedFolderName: null };
    }
  }

  // === SEMANTIC LAYER METHODS ===

  public getConceptualStatements(): ConceptualStatement[] {
    return this._conceptualStatements;
  }

  public setConceptualStatements(statements: ConceptualStatement[]): void {
    this._conceptualStatements = statements;
    this.saveConceptualStatements();
  }

  public addConceptualStatement(statement: ConceptualStatement): void {
    this._conceptualStatements.unshift(statement);
    this.saveConceptualStatements();
  }

  // === Bearing Methods ===
  public getBearings(): Bearing[] {
    return this._bearings;
  }

  public addBearing(bearing: Bearing): void {
    // Assign default name if missing
    const withName = {
      ...bearing,
      name: bearing.name || `Bearing ${this._bearings.length + 1}`
    } as Bearing;
    this._bearings.unshift(withName);
    // Keep BearingStateService in sync for any consumers still reading from it
    try {
      // Dynamic import to avoid circular deps at module eval
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BearingStateService } = require('./BearingStateService');
      BearingStateService.getInstance().addBearing(withName);
    } catch {}
    this.saveBearings();
    try { window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'add', id: withName.id } })); } catch {}
  }

  public updateBearing(bearingId: number, statement: string): void {
    const index = this._bearings.findIndex(b => b.id === bearingId);
    if (index !== -1) {
      this._bearings[index].statement = statement;
      // Sync to BearingStateService
      try {
        const { BearingStateService } = require('./BearingStateService');
        const b = this._bearings[index];
        BearingStateService.getInstance().updateBearing({ ...b });
      } catch {}
      this.saveBearings();
      try { window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'update', id: bearingId } })); } catch {}
    }
  }

  public deleteBearing(bearingId: number): void {
    this._bearings = this._bearings.filter(b => b.id !== bearingId);
    // Sync to BearingStateService
    try {
      const { BearingStateService } = require('./BearingStateService');
      BearingStateService.getInstance().removeBearing(bearingId);
    } catch {}
    this.saveBearings();
    try { window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'remove', id: bearingId } })); } catch {}
  }

  public updateBearingEmbedding(bearingId: number, embedding: number[]): void {
    const index = this._bearings.findIndex(b => b.id === bearingId);
    if (index !== -1) {
      this._bearings[index] = { ...this._bearings[index], embedding };
      // Sync to BearingStateService
      try {
        const { BearingStateService } = require('./BearingStateService');
        const b = this._bearings[index];
        BearingStateService.getInstance().updateBearing({ ...b });
      } catch {}
      this.saveBearings();
      try { window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'embedding', id: bearingId } })); } catch {}
    }
  }

  public updateBearingLocation(bearingId: number, location: { x: number; y: number }): void {
    const index = this._bearings.findIndex(b => b.id === bearingId);
    if (index !== -1) {
      const prev = this._bearings[index];
      this._bearings[index] = {
        ...prev,
        location: { id: prev.location?.id || `bearing-${bearingId}`, x: location.x, y: location.y },
        isFixed: true,
        fixedPosition: { x: location.x, y: location.y },
        constraintStrength: 1.0
      };
      // Sync to BearingStateService
      try {
        const { BearingStateService } = require('./BearingStateService');
        const b = this._bearings[index];
        BearingStateService.getInstance().updateBearing({ ...b });
      } catch {}
      this.saveBearings();
      try { window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'location', id: bearingId } })); } catch {}
    }
  }

  private saveBearings(): void {
    try {
      localStorage.setItem('meridian-bearings', JSON.stringify(this._bearings));
    } catch (error) {
      console.error('Failed to save bearings to localStorage:', error);
    }
  }

  private loadBearings(): void {
    try {
      const stored = localStorage.getItem('meridian-bearings');
      if (stored) {
        this._bearings = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load bearings from localStorage:', error);
      this._bearings = [];
    }
  }

  // Active bearing state
  public getActiveBearingId(): number | null {
    return this._activeBearingId;
  }

  public getActiveBearing(): Bearing | null {
    const id = this._activeBearingId;
    if (id == null) return null;
    return this._bearings.find(b => b.id === id) || null;
  }

  public setActiveBearingId(id: number | null): void {
    this._activeBearingId = id;
    try {
      if (id == null) {
        localStorage.removeItem('meridian-active-bearing');
      } else {
        localStorage.setItem('meridian-active-bearing', String(id));
      }
    } catch {}
    try { window.dispatchEvent(new CustomEvent('activeBearingChanged', { detail: { id } })); } catch {}
  }

  private loadActiveBearing(): void {
    try {
      const v = localStorage.getItem('meridian-active-bearing');
      if (v != null) {
        const parsed = Number(v);
        if (!Number.isNaN(parsed)) this._activeBearingId = parsed;
      }
    } catch {}
  }

  // === ANALET MATERIALIZATION METHODS ===

  private loadMaterializedAnalets(): void {
    // Try backend first, fallback to localStorage
    this.loadMaterializedFromBackend();
  }

  /**
   * Load materialized analets from backend (primary method)
   */
  private loadMaterializedFromBackend(): void {
    try {
      import('./MessageService').then(({ MessageService }) => {
        const msg = MessageService.getInstance();
        const off = msg.onMessage('materialized-analets-loaded', (data: any) => {
          const materializedIds = Array.isArray(data?.materializedIds) ? data.materializedIds : [];
          if (materializedIds.length > 0) {
            this._materializedAnaletIds = new Set(materializedIds.filter((id: any) => typeof id === 'number'));
            // Update localStorage cache
            this.saveMaterializedAnalets();
            try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}

            // Remove one-time listener
            off();
          } else {
            // Fallback to localStorage if backend has no data
            this.loadMaterializedFromStorage();
            off();
          }
        });
        msg.sendMessage('load-materialized-analets', {});
      });
    } catch (e) {
      console.error('[visiteddebug] Error loading from backend:', e);
      // Fallback to localStorage
      this.loadMaterializedFromStorage();
    }
  }

  /**
   * Load materialized analets from localStorage (fallback method)
   */
  private loadMaterializedFromStorage(): void {
    try {
      const stored = localStorage.getItem('meridian-materialized-analets');
      if (stored) {
        const materializedIds = JSON.parse(stored);
        if (Array.isArray(materializedIds)) {
          this._materializedAnaletIds = new Set(materializedIds.filter((id: any) => typeof id === 'number'));
          try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}
        }
      }
    } catch (error) {
      console.error('[visiteddebug] Failed to load materialized analets from localStorage:', error);
      this._materializedAnaletIds = new Set();
    }
  }

  private saveMaterializedAnalets(): void {
    // Save to backend as primary storage
    this.saveMaterializedToBackend();
    // Also save to localStorage as backup/cache
    this.saveMaterializedToStorage();
  }

  /**
   * Save materialized analets to backend (primary method)
   */
  private saveMaterializedToBackend(): void {
    try {
      import('./MessageService').then(({ MessageService }) => {
        const msg = MessageService.getInstance();
        const materializedIds = Array.from(this._materializedAnaletIds);
        msg.sendMessage('save-materialized-analets', {
          materializedIds,
          datasetName: this._datasetInfo?.name
        });
      });
    } catch (e) {
      console.error('[visiteddebug] Error saving to backend:', e);
    }
  }

  /**
   * Save materialized analets to localStorage (backup method)
   */
  private saveMaterializedToStorage(): void {
    try {
      const materializedIds = Array.from(this._materializedAnaletIds);
      localStorage.setItem('meridian-materialized-analets', JSON.stringify(materializedIds));
    } catch (error) {
      console.error('[visiteddebug] Failed to save materialized analets to localStorage:', error);
    }
  }

  public getMaterializedAnaletIds(): Set<number> {
    return new Set(this._materializedAnaletIds);
  }

  public setMaterializedAnaletIds(materializedIds: Set<number>): void {
    this._materializedAnaletIds = new Set(materializedIds);
    this.saveMaterializedAnalets();
    try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}
  }

  public addMaterializedAnalet(analetId: number): void {
    this._materializedAnaletIds.add(analetId);
    this.saveMaterializedAnalets();
    try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}
  }

  public removeMaterializedAnalet(analetId: number): void {
    this._materializedAnaletIds.delete(analetId);
    this.saveMaterializedAnalets();
    try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}
  }

  public isMaterialized(analetId: number): boolean {
    return this._materializedAnaletIds.has(analetId);
  }

  public clearMaterializedAnalets(): void {
    this._materializedAnaletIds.clear();
    this.saveMaterializedAnalets();
    try { window.dispatchEvent(new CustomEvent('materializedAnaletsUpdated', { detail: { size: this._materializedAnaletIds.size } })); } catch {}
  }

  public updateConceptualStatement(statementId: number, text: string): void {
    const index = this._conceptualStatements.findIndex(s => s.id === statementId);
    if (index !== -1) {
      this._conceptualStatements[index].text = text;
      this.saveConceptualStatements();
    }
  }

  public getVariableModifications(): { [variableName: string]: VariableModification } {
    return this._variableModifications;
  }

  public setVariableModification(variableName: string, modification: VariableModification): void {
    this._variableModifications[variableName] = modification;
    this.saveVariableModifications();
  }

  /**
   * Batch set multiple variable modifications at once and persist in one save.
   * If merge is true (default), merges with existing modifications; otherwise replaces the entire map.
   */
  public setVariableModifications(
    modifications: { [variableName: string]: VariableModification },
    merge: boolean = true
  ): void {
    if (merge) {
      this._variableModifications = {
        ...this._variableModifications,
        ...modifications
      };
    } else {
      this._variableModifications = { ...modifications };
    }
    this.saveVariableModifications();
  }

  public updateVariableField(variableName: string, field: keyof VariableModification, value: any): void {
    if (!this._variableModifications[variableName]) {
      this._variableModifications[variableName] = {
        name: variableName,
        comments: []
      };
    }
    (this._variableModifications[variableName] as any)[field] = value;
    this.saveVariableModifications();
  }

  private async saveConceptualStatements(): Promise<void> {
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();

      messageService.sendMessage('save-conceptual-statements', {
        statements: this._conceptualStatements
      });
    } catch (error) {
      console.error('Failed to save conceptual statements:', error);
    }
  }

  private async saveVariableModifications(): Promise<void> {
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();

      messageService.sendMessage('save-variable-modifications', {
        modifications: this._variableModifications
      });
    } catch (error) {
      console.error('Failed to save variable modifications:', error);
    }
  }

  public async loadSemanticLayer(): Promise<void> {
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();

      messageService.sendMessage('load-semantic-layer');
    } catch (error) {
      console.error('❌ [StateService] Failed to load semantic layer:', error);
    }
  }

  public async exportSemanticLayerYAML(): Promise<void> {
    try {
      const { MessageService } = await import('./MessageService');
      const messageService = MessageService.getInstance();

      // Build semantic layer data
      const semanticLayer: SemanticLayer = {
        id: `semantic-layer-${Date.now()}`,
        datasetName: this._datasetInfo?.name || 'unknown',
        conceptualStatements: this._conceptualStatements,
        variableModifications: this._variableModifications,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: '1.0'
      };

      messageService.sendMessage('export-semantic-layer-yaml', {
        semanticLayer
      });
    } catch (error) {
      console.error('Failed to export semantic layer:', error);
    }
  }

  // Value comment management methods
  public getValueComments(columnName: string, rawValue: string): any[] {
    if (!this._variableModifications[columnName]?.valueComments) {
      return [];
    }
    return this._variableModifications[columnName].valueComments![rawValue] || [];
  }

  public saveValueComments(columnName: string, rawValue: string, comments: any[]): void {
    if (!this._variableModifications[columnName]) {
      this._variableModifications[columnName] = {
        name: columnName,
        comments: [],
        valueComments: {},
        conceptualStatementReferences: []
      };
    }

    if (!this._variableModifications[columnName].valueComments) {
      this._variableModifications[columnName].valueComments = {};
    }

    this._variableModifications[columnName].valueComments![rawValue] = comments;
    this.saveVariableModifications();
  }

  /**
   * Emergency cleanup method for StateService
   */
  public emergencyCleanup(): void {
    // Clear critical storage patterns immediately
    const criticalPatterns = ['hierarchy', 'clusters', 'folder', 'analet'];

    for (const pattern of criticalPatterns) {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes(pattern)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
      });
    }
  }
}
