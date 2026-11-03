import { useState, useCallback, useEffect, useRef } from 'react';
import { Analet } from '../types/analet';
import { StateService } from '../services/StateService';

interface AnaletVisibilityState {
  materializedAnaletIds: Set<number>;
}

export function useAnaletVisibility() {
  const [visibilityState, setVisibilityState] = useState<AnaletVisibilityState>({
    materializedAnaletIds: new Set<number>()
  });
  const persistRequestedRef = useRef<boolean>(false);

  // Load materialized analets from StateService on initialization
  useEffect(() => {
    const loadMaterializedAnalets = () => {
      try {
        const stateService = StateService.getInstance();
        const materializedIds = stateService.getMaterializedAnaletIds();
        if (materializedIds.size > 0) {
          setVisibilityState({
            materializedAnaletIds: materializedIds
          });
        }
      } catch (error) {
        console.warn('[visiteddebug] Failed to load materialized analets:', error);
      }
    };

    // Initial load
    loadMaterializedAnalets();
    
    // Set up a delayed check to catch backend-loaded data
    // This handles the case where backend data arrives after initial render
    const delayedCheck = setTimeout(() => {
      loadMaterializedAnalets();
    }, 1000);

    // Subscribe to materialization changes broadcast
    const onMat = () => {
      try {
        const stateService = StateService.getInstance();
        const materializedIds = stateService.getMaterializedAnaletIds();
        // External update; prevent persist loop
        persistRequestedRef.current = false;
        setVisibilityState({ materializedAnaletIds: materializedIds });
      } catch (e) {
        console.warn('[visiteddebug] Failed to handle materializedAnaletsUpdated:', e);
      }
    };
    window.addEventListener('materializedAnaletsUpdated', onMat as EventListener);

    return () => {
      clearTimeout(delayedCheck);
      window.removeEventListener('materializedAnaletsUpdated', onMat as EventListener);
    };
  }, []);

  // Persist only for local-origin changes
  useEffect(() => {
    if (!persistRequestedRef.current) return;
    try {
      const stateService = StateService.getInstance();
      stateService.setMaterializedAnaletIds(visibilityState.materializedAnaletIds);
    } catch (error) {
      console.warn('[visiteddebug] Failed to persist visibility state:', error);
    } finally {
      persistRequestedRef.current = false;
    }
  }, [visibilityState.materializedAnaletIds]);

  const materializeAnalet = useCallback((analetId: number) => {
    setVisibilityState(prev => {
      const newMaterializedIds = new Set(prev.materializedAnaletIds);
      newMaterializedIds.add(analetId);
      return {
        ...prev,
        materializedAnaletIds: newMaterializedIds
      };
    });
    persistRequestedRef.current = true;
  }, []);

  const dematerializeAnalet = useCallback((analetId: number) => {
    setVisibilityState(prev => {
      const newMaterializedIds = new Set(prev.materializedAnaletIds);
      newMaterializedIds.delete(analetId);
      return {
        ...prev,
        materializedAnaletIds: newMaterializedIds
      };
    });
    persistRequestedRef.current = true;
  }, []);

  const isMaterialized = useCallback((analetId: number): boolean => {
    return visibilityState.materializedAnaletIds.has(analetId);
  }, [visibilityState.materializedAnaletIds]);

  const getMaterializedAnalets = useCallback((analets: Analet[]): Analet[] => {
    return analets.filter(analet => visibilityState.materializedAnaletIds.has(analet.id));
  }, [visibilityState.materializedAnaletIds]);

  const getUnmaterializedAnalets = useCallback((analets: Analet[]): Analet[] => {
    return analets.filter(analet => !visibilityState.materializedAnaletIds.has(analet.id));
  }, [visibilityState.materializedAnaletIds]);

  const getMaterializedCount = useCallback((): number => {
    return visibilityState.materializedAnaletIds.size;
  }, [visibilityState.materializedAnaletIds]);

  const clearAllMaterialized = useCallback(() => {
    setVisibilityState({
      materializedAnaletIds: new Set<number>()
    });
  }, []);

  return {
    visibilityState,
    materializeAnalet,
    dematerializeAnalet,
    isMaterialized,
    getMaterializedAnalets,
    getUnmaterializedAnalets,
    getMaterializedCount,
    clearAllMaterialized
  };
}