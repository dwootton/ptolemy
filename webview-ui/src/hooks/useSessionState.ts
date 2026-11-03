import { useState, useEffect, useCallback } from 'react';
import { Analet, Bearing, AnalysisComponent } from '../types/analet';
import { DatasetInfo } from '../components/DatasetLoader';
import { HierarchyState } from '../types/hierarchy';
import { SessionStateService } from '../services/SessionStateService';

interface UseSessionStateReturn {
  // Simple hydration status
  isHydrating: boolean;

  // Core data getters
  analets: Analet[];
  analysisComponents: AnalysisComponent[];
  bearings: Bearing[];
  datasetInfo: DatasetInfo | null;
  hasDataset: boolean;

  // UI state
  selectedFolderName: string | null;
  hierarchyState: HierarchyState | null;

  // Note: Selection state removed - handled by useSharedSelection hook directly

  // Core data setters
  setAnalets: (analets: Analet[]) => void;
  setAnalysisComponents: (components: AnalysisComponent[]) => void;
  setBearings: (bearings: Bearing[]) => void;
  setDatasetInfo: (datasetInfo: DatasetInfo | null, hasDataset?: boolean) => void;

  // UI state setters
  setSelectedFolderName: (folderName: string | null) => void;
  setHierarchyState: (hierarchyState: HierarchyState | null) => void;

  // Note: Selection methods removed - useSharedSelection handles this

  // Utility methods
  clearSession: () => void;
  getSessionSummary: () => object;
}

/**
 * Main hook for session state management across extension navigation.
 * Integrates with existing patterns while adding persistence.
 */
export function useSessionState(): UseSessionStateReturn {
  const [sessionService] = useState(() => SessionStateService.getInstance());
  const [isHydrating, setIsHydrating] = useState(true);
  const [stateVersion, setStateVersion] = useState(0);

  // Simple state update trigger
  const triggerUpdate = useCallback(() => {
    setStateVersion(v => v + 1);
  }, []);

  // Hydrate session state on mount
  useEffect(() => {
    let isMounted = true;

    async function hydrateSession() {
      try {
        await sessionService.hydrateSession();

        if (isMounted) {
          setIsHydrating(false);


        }
      } catch (error) {
        console.error('❌ [useSessionState] Hydration failed:', error);
        if (isMounted) {
          setIsHydrating(false);
        }
      }
    }

    hydrateSession();

    return () => {
      isMounted = false;
    };
  }, [sessionService]);

  // Core data getters (reactive to stateVersion)
  const analets = sessionService.getAnalets();
  const analysisComponents = sessionService.getAnalysisComponents();
  const bearings = sessionService.getBearings();
  const datasetInfo = sessionService.getDatasetInfo();
  const hasDataset = sessionService.hasDataset();

  // UI state getters
  const selectedFolderName = sessionService.getSelectedFolderName();
  const hierarchyState = sessionService.getHierarchyState();

  // Use stateVersion to ensure reactivity
  void stateVersion;

  // Core data setters
  const setAnalets = useCallback((analets: Analet[]) => {
    sessionService.setAnalets(analets);
    triggerUpdate();
  }, [sessionService, triggerUpdate]);

  const setAnalysisComponents = useCallback((components: AnalysisComponent[]) => {
    sessionService.setAnalysisComponents(components);
    triggerUpdate();
  }, [sessionService, triggerUpdate]);

  const setBearings = useCallback((bearings: Bearing[]) => {
    sessionService.setBearings(bearings);
    triggerUpdate();
  }, [sessionService, triggerUpdate]);

  const setDatasetInfo = useCallback((datasetInfo: DatasetInfo | null, hasDataset: boolean = true) => {
    sessionService.setDatasetInfo(datasetInfo, hasDataset);
    triggerUpdate();
  }, [sessionService, triggerUpdate]);

  // UI state setters
  const setSelectedFolderName = useCallback((folderName: string | null) => {
    sessionService.setSelectedFolderName(folderName);
    triggerUpdate();
  }, [sessionService, triggerUpdate]);

  const setHierarchyState = useCallback((hierarchyState: HierarchyState | null) => {
    sessionService.setHierarchyState(hierarchyState);
    triggerUpdate();
  }, [sessionService, triggerUpdate]);

  // Utility methods
  const clearSession = useCallback(() => {
    sessionService.clearSession();
    triggerUpdate();
  }, [sessionService, triggerUpdate]);

  const getSessionSummary = useCallback(() => {
    return sessionService.getSessionSummary();
  }, [sessionService]);

  return {
    // Simple hydration status
    isHydrating,

    // Core data
    analets,
    analysisComponents,
    bearings,
    datasetInfo,
    hasDataset,

    // UI state
    selectedFolderName,
    hierarchyState,

    // Core data setters
    setAnalets,
    setAnalysisComponents,
    setBearings,
    setDatasetInfo,

    // UI state setters
    setSelectedFolderName,
    setHierarchyState,

    // Utility methods
    clearSession,
    getSessionSummary
  };
}
