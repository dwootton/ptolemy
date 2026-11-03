import { Analet, AnaletConstraint } from '../types/analet';

export class ConstraintService {
  private static instance: ConstraintService;
  private constraints = new Map<number, AnaletConstraint>();
  private changeCallbacks: (() => void)[] = [];
  private readonly STORAGE_KEY = 'meridian-analet-constraints-v1';
  private isInitializing = true;

  // Singleton pattern
  public static getInstance(): ConstraintService {
    if (!ConstraintService.instance) {
      ConstraintService.instance = new ConstraintService();
    }
    return ConstraintService.instance;
  }

  private constructor() {
    // Load persisted constraints on service initialization - prioritize backend over localStorage
    this.loadFromBackend();
  }

  /**
   * Register a callback to be called when constraints change
   */
  onConstraintsChanged(callback: () => void): () => void {
    this.changeCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.changeCallbacks.indexOf(callback);
      if (index > -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all callbacks that constraints have changed
   */
  private notifyChange(): void {
    // Skip notifications during initialization to prevent infinite loops
    if (this.isInitializing) {
      return;
    }


    // Persist to backend as primary storage
    this.saveToBackend();
    // Also save to localStorage as backup/cache
    this.saveToStorage();
    this.changeCallbacks.forEach(callback => callback());
  }

  /**
   * Set an analet as fixed at a specific position
   */
  setAnaletFixed(analet: Analet, position: {x: number, y: number}, strength = 1.0): void {
    const constraint: AnaletConstraint = {
      id: `constraint-${analet.id}-${Date.now()}`,
      type: 'fixed-position',
      analetId: analet.id,
      position,
      strength: Math.max(0, Math.min(1, strength)), // Clamp between 0-1
      timestamp: Date.now()
    };

    this.constraints.set(analet.id, constraint);
    this.notifyChange();
  }

  /**
   * Remove constraint for an analet
   */
  removeConstraint(analetId: number): boolean {
    const removed = this.constraints.delete(analetId);
    if (removed) {
      this.notifyChange();
    }
    return removed;
  }

  /**
   * Get all current constraints
   */
  getConstraints(): AnaletConstraint[] {
    return Array.from(this.constraints.values());
  }

  /**
   * Check if an analet is fixed
   */
  isAnaletFixed(analetId: number): boolean {
    return this.constraints.has(analetId);
  }

  /**
   * Get constraint strength for an analet
   */
  getConstraintStrength(analetId: number): number {
    const constraint = this.constraints.get(analetId);
    return constraint ? (constraint.strength ?? 0) : 0;
  }

  /**
   * Get constraint position for an analet
   */
  getConstraintPosition(analetId: number): {x: number, y: number} | null {
    const constraint = this.constraints.get(analetId);
    const position = constraint ? (constraint.position ?? null) : null;

    return position;
  }

  /**
   * Update constraint strength for an analet
   */
  updateConstraintStrength(analetId: number, strength: number): boolean {
    const constraint = this.constraints.get(analetId);
    if (constraint) {
      constraint.strength = Math.max(0, Math.min(1, strength));
      this.notifyChange();
      return true;
    }
    return false;
  }

  /**
   * Clear all constraints
   */
  clearAllConstraints(): void {
    const count = this.constraints.size;
    this.constraints.clear();
    if (count > 0) {
      this.notifyChange();
    }
  }

  /**
   * Get constraints count
   */
  getConstraintsCount(): number {
    return this.constraints.size;
  }

  /**
   * Convert constraints to UMAP format for a given list of analets
   */
  toUMAPConstraints(analets: Analet[], dimensions: {width: number, height: number}): {
    fixedIndices: number[];
    fixedPositions: number[][];
    constraintStrengths: number[];
  } {
    const fixedIndices: number[] = [];
    const fixedPositions: number[][] = [];
    const constraintStrengths: number[] = [];

    analets.forEach((analet, index) => {
      const constraint = this.constraints.get(analet.id);
      if (constraint) {
        fixedIndices.push(index);
        // Convert UI coordinates to UMAP coordinate space (normalized 0-1)
        if (constraint.position) {
          const normalizedX = constraint.position.x / dimensions.width;
          const normalizedY = constraint.position.y / dimensions.height;
          fixedPositions.push([normalizedX, normalizedY]);
          constraintStrengths.push(constraint.strength ?? 1.0);
        }
      }
    });

    return {
      fixedIndices,
      fixedPositions,
      constraintStrengths
    };
  }

  /**
   * Persist constraints to localStorage
   */
  private saveToStorage(): void {
    try {
      const data = Array.from(this.constraints.values()).map(c => ({
        id: c.id,
        type: c.type,
        analetId: c.analetId,
        position: c.position,
        strength: c.strength,
        timestamp: c.timestamp
      }));
      if (typeof window !== 'undefined' && window.localStorage) {
        const jsonData = JSON.stringify(data);
        window.localStorage.setItem(this.STORAGE_KEY, jsonData);
        // Verify it was saved
        // const saved = window.localStorage.getItem(this.STORAGE_KEY);
      }
    } catch (e) {
      console.error('[constraintsdebug] Error saving to storage:', e);
      // Fail silently; persistence is best-effort in the webview environment
    }
  }

  /**
   * Load constraints from localStorage
   */
  private loadFromStorage(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        this.isInitializing = false;
        return;
      }
      // Debug: show all localStorage keys
      const allKeys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        allKeys.push(window.localStorage.key(i));
      }
      const raw = window.localStorage.getItem(this.STORAGE_KEY);
      if (!raw) {
        this.isInitializing = false;
        return;
      }
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        this.isInitializing = false;
        return;
      }
      this.constraints.clear();
      for (const item of arr) {
        if (!item || typeof item.analetId !== 'number') continue;
        const constraint: AnaletConstraint = {
          id: String(item.id || `constraint-${item.analetId}`),
          type: 'fixed-position',
          analetId: item.analetId,
          position: item.position && typeof item.position.x === 'number' && typeof item.position.y === 'number'
            ? { x: item.position.x, y: item.position.y }
            : undefined,
          strength: typeof item.strength === 'number' ? item.strength : 1.0,
          timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
          data: item.data
        };
        this.constraints.set(item.analetId, constraint);
      }
      // Mark initialization as complete
      this.isInitializing = false;
      // Only notify listeners if constraints were actually loaded during initial load
      if (this.constraints.size > 0) {
        this.changeCallbacks.forEach(callback => callback());
      }
    } catch (e) {
      console.error('[constraintsdebug] Error loading from storage:', e);
      // Ignore malformed storage
      this.constraints.clear();
      // Still mark initialization as complete even on error
      this.isInitializing = false;
    }
  }

  /**
   * Load constraints from backend (primary method)
   */
  private loadFromBackend(): void {
    try {
      import('./MessageService').then(({ MessageService }) => {
        const msg = MessageService.getInstance();
        const off = msg.onMessage('analet-constraints-loaded', (data: any) => {
          const arr = Array.isArray(data?.constraints) ? data.constraints : [];
          if (arr.length > 0) {
            this.constraints.clear();
            for (const item of arr) {
              if (!item || typeof item.analetId !== 'number') continue;
              const constraint: AnaletConstraint = {
                id: String(item.id || `constraint-${item.analetId}`),
                type: 'fixed-position',
                analetId: item.analetId,
                position: item.position,
                strength: typeof item.strength === 'number' ? item.strength : 1.0,
                timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
                data: item.data
              };
              this.constraints.set(item.analetId, constraint);
            }
            // Update localStorage cache
            this.saveToStorage();

            // Mark initialization as complete and notify listeners
            this.isInitializing = false;
            this.changeCallbacks.forEach(callback => callback());

            // Remove one-time listener
            off();
          } else {
            // Fallback to localStorage if backend has no data
            this.loadFromStorage();
          }
        });
        msg.sendMessage('load-analet-constraints', {});
      });
    } catch (e) {
      console.error('[constraintsdebug] Error loading from backend:', e);
      // Fallback to localStorage
      this.loadFromStorage();
    }

    // Ensure initialization is always completed after a reasonable timeout
    setTimeout(() => {
      if (this.isInitializing) {
        this.isInitializing = false;
      }
    }, 1000);
  }

  /**
   * Save constraints to backend (primary method)
   */
  private saveToBackend(): void {
    try {
      import('./MessageService').then(({ MessageService }) => {
        const msg = MessageService.getInstance();
        const constraints = this.getConstraints().map(c => ({
          id: c.id,
          analetId: c.analetId,
          position: c.position,
          strength: c.strength,
          timestamp: c.timestamp,
          type: c.type,
          data: c.data
        }));
        msg.sendMessage('save-analet-constraints', { constraints });
      });
    } catch (e) {
      console.error('[constraintsdebug] Error saving to backend:', e);
    }
  }
}
