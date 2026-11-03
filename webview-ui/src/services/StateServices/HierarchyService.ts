/**
 * HierarchyService - Handles hierarchy state and cluster detection
 */

import { HierarchyState } from '../../types/hierarchy';
import { DetectedCluster } from '../../utilities/clusterDetection';

export class HierarchyService {
  private static instance: HierarchyService;
  private readonly STORAGE_KEY = 'meridian-ui-state';

  private _hierarchyState: HierarchyState | null = null;
  private _detectedClusters: DetectedCluster[] = [];
  private _selectedFolderName: string | null = null;

  // Debouncing for hierarchy state persistence
  private hierarchyStateTimer: NodeJS.Timeout | null = null;
  private readonly HIERARCHY_SAVE_DEBOUNCE_MS = 1000; // 1 second debounce

  // Circuit breaker for corrupted states
  private hierarchyStateBlocked: boolean = false;
  private blockResetTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.loadPersistedState();
  }

  public static getInstance(): HierarchyService {
    if (!HierarchyService.instance) {
      HierarchyService.instance = new HierarchyService();
    }
    return HierarchyService.instance;
  }

  // === HIERARCHY STATE ===
  
  public getHierarchyState(): HierarchyState | null {
    return this._hierarchyState;
  }

  public setHierarchyState(state: HierarchyState): void {
    // Circuit breaker: if we're blocked, ignore all requests
    if (this.hierarchyStateBlocked) {
      console.warn('🚫 [Hierarchy] Hierarchy state updates BLOCKED due to corruption - ignoring');
      return;
    }

    // Check size before setting to prevent corruption
    const stateSize = this.estimateObjectSize(state);
    if (stateSize > 1 * 1024 * 1024) { // 1MB limit for safety
      console.error('🚫 [Hierarchy] Attempted to set hierarchy state that is too large:', Math.round(stateSize / 1024), 'KB - BLOCKING future updates');
      
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

  // === DETECTED CLUSTERS ===

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

  // === SELECTED FOLDER ===

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

  // === PERSISTENCE ===

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
        console.warn('⚠️ [Hierarchy] Cannot create limited hierarchy state, skipping save');
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
        console.warn('⚠️ [Hierarchy] JSON.stringify failed for hierarchy state:', stringifyError);
        return;
      }
      
      // Check if data is too large for localStorage (5MB limit)
      if (dataString.length > 5 * 1024 * 1024) {
        console.warn('⚠️ [Hierarchy] Hierarchy state too large for localStorage, skipping');
        return;
      }
      
      localStorage.setItem(this.STORAGE_KEY + '-hierarchy', dataString);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        console.warn('⚠️ [Hierarchy] LocalStorage quota exceeded, clearing old hierarchy data');
        this.clearOldHierarchyData();
      } else {
        console.warn('Failed to save hierarchy to storage (debounced):', e);
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

  // === UTILITY METHODS ===

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

  // Send hierarchy state to extension for persistence
  private async sendHierarchyStateToExtension(): Promise<void> {
    try {
      const { MessageService } = await import('../MessageService');
      const messageService = MessageService.getInstance();
      
      // Don't send during purge operations
      if (!this._hierarchyState) {
        return;
      }
      
      // Quick size check before processing
      const rawStateSize = this.estimateObjectSize(this._hierarchyState);
      if (rawStateSize > 10 * 1024 * 1024) { // 10MB - definitely corrupted
        console.error('🚫 [Hierarchy] Hierarchy state is corrupted (too large):', Math.round(rawStateSize / 1024), 'KB - clearing it');
        this._hierarchyState = null;
        this._detectedClusters = [];
        this._selectedFolderName = null;
        this.clearOldHierarchyData();
        return;
      }
      
      // Create a size-limited version of the hierarchy state
      const limitedHierarchyState = this.createLimitedHierarchyState(this._hierarchyState);
      
      const payload = {
        hierarchyState: limitedHierarchyState,
        detectedClusters: this._detectedClusters,
        selectedFolderName: this._selectedFolderName
      };
      
      // Check payload size before sending
      const payloadSize = this.estimateObjectSize(payload);
      if (payloadSize > 2 * 1024 * 1024) { // 2MB limit
        console.warn('🚫 [Hierarchy] Hierarchy state too large for persistence:', Math.round(payloadSize / 1024), 'KB');
        return;
      }
      
      messageService.sendMessage('save-hierarchy-state', payload);
    } catch (error) {
      console.warn('Failed to send hierarchy state to extension:', error);
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
        conceptAxes: analet.conceptAxes?.slice(0, 5) || [],
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

  // Estimate object size in bytes (rough approximation)
  private estimateObjectSize(obj: any): number {
    try {
      return JSON.stringify(obj).length * 2; // Rough estimate: 2 bytes per character
    } catch (error) {
      console.warn('Failed to estimate object size:', error);
      return Infinity; // Assume too large if we can't stringify
    }
  }

  // Update hierarchy state from backend restoration
  public updateFromBackend(data: any): void {
    if (data.hierarchyState) {
      // Check size before restoring to prevent loading corrupted massive states
      const stateSize = this.estimateObjectSize(data.hierarchyState);
      if (stateSize > 5 * 1024 * 1024) { // 5MB limit
        console.warn('🚫 [Hierarchy] Received hierarchy state that is too large:', Math.round(stateSize / 1024), 'KB - ignoring restoration');
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
  }

  // Emergency cleanup
  public emergencyCleanup(): void {
    // Clear critical storage patterns immediately
    const criticalPatterns = ['hierarchy', 'clusters', 'folder'];
    
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

  // Clear all state
  public clearAllState(): void {
    // Reset circuit breaker
    this.hierarchyStateBlocked = false;
    if (this.blockResetTimer) {
      clearTimeout(this.blockResetTimer);
      this.blockResetTimer = null;
    }
    
    this._hierarchyState = null;
    this._detectedClusters = [];
    this._selectedFolderName = null;
    
    // Clear storage
    this.clearOldHierarchyData();
    localStorage.removeItem(this.STORAGE_KEY + '-clusters');
    localStorage.removeItem(this.STORAGE_KEY + '-selected-folder');
  }
}