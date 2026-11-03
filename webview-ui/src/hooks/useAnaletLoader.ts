import { useEffect, useMemo, useRef, useState } from "react";
import { Analet } from "../types/analet";
import { useAnaletData } from "./data/useAnaletData";
import { useSimpleUMAPProjection } from "./data/useUMAPProjection";
import { useMessageHandler } from "./useMessageHandler";
import { StateService } from "../services/StateService";
import { ConstraintService } from "../services/ConstraintService";
import { StudyConfigurationService } from "../services/StudyConfigurationService";

interface UseAnaletLoaderProps {
  width: number;
  height: number;
  padding?: number;
}

interface UseAnaletLoaderReturn {
  projectedAnalets: Analet[];
  isLoading: boolean;
  isAnalysisLoading: boolean;
  isProjectionLoading: boolean;
  loadingMessage: string;
  requestAnaletData: (forceGenerate?: boolean) => void;
}

export function useAnaletLoader(props: UseAnaletLoaderProps): UseAnaletLoaderReturn {
  // Message handling (only for extension communication)
  const { sendMessage, onMessage } = useMessageHandler();

  // Stable service references to avoid infinite loops
  const stateServiceRef = useRef(StateService.getInstance());
  const constraintServiceRef = useRef(ConstraintService.getInstance());

  // Analet data hook (gets analets from backend)
  const { analets: backendAnalets, loadingState, requestAnaletData, getLoadingMessage } = useAnaletData({
    sendMessage,
    onMessage,
    setUsingMockData: () => {} // Not needed for this hook
  });

  // Single source of truth: Use StateService as primary analet source
  // Backend analets are automatically synced to StateService via MessageService
  const [allAnalets, setAllAnalets] = useState<Analet[]>([]);

  // Listen for StateService changes and use it as single source
  useEffect(() => {
    const prevAvailableSigRef = { current: '' as string } as any;
    const updateAnalets = (force?: boolean) => {
      const stateService = stateServiceRef.current;
      const availableAnalets = stateService.getAvailableAnalets();
      // H2+ guard: skip state update if stable signature (ids + rounded loc) unchanged
      try {
        const sig = (list: Analet[]) => list
          .slice()
          .sort((x, y) => x.id - y.id)
          .map(x => {
            const lx = Math.round((x.location?.x || 0) * 10) / 10;
            const ly = Math.round((x.location?.y || 0) * 10) / 10;
            const t = x.type || '';
            const s = (x as any).status || '';
            return `${x.id}:${lx},${ly}:${t}:${s}`;
          })
          .join('|');
        const nextSig = sig(availableAnalets);
        if (!(!force && prevAvailableSigRef.current === nextSig)) {
          prevAvailableSigRef.current = nextSig;
          setAllAnalets(availableAnalets);
        }
      } catch {
        setAllAnalets(availableAnalets);
      }

    };

    // Initial load
    updateAnalets();

    // Listen for StateService events
    const handleAnaletsUpdated = (e: any) => {
      const detail = e?.detail || {};
      const force = detail.promotedFromFraming === true || detail.action === 'promoted-from-framing';
      if (force) {
        // Invalidate signature and force update to reflect type changes from promotion
        prevAvailableSigRef.current = '';
        updateAnalets(true);
      } else {
        updateAnalets();
      }
    };

    const handleSingleAnaletUpdate = () => {
      updateAnalets();
    };

    window.addEventListener('analetsUpdated', handleAnaletsUpdated as any);
    window.addEventListener('analetUpdated', handleSingleAnaletUpdate);

    return () => {
      window.removeEventListener('analetsUpdated', handleAnaletsUpdated as any);
      window.removeEventListener('analetUpdated', handleSingleAnaletUpdate);
    };
  }, []); // No dependencies to prevent infinite loops

  // Monitor backend analets for initial sync only
  useEffect(() => {

  }, [backendAnalets.length]); // Only watch length, not full array

  // Get ALL analets including non-materialized ones for UMAP training
  const [allAnaletsForUMAP, setAllAnaletsForUMAP] = useState<Analet[]>([]);

  useEffect(() => {
    const stateService = stateServiceRef.current;
    // Get ALL analets from StateService without any filtering
    const allAvailableAnalets = stateService.getAvailableAnalets() || [];
    setAllAnaletsForUMAP(allAvailableAnalets);

  }, [allAnalets]); // Update when allAnalets changes

  // Clean UMAP projection using ALL analets for training
  const { projectedAnalets: allProjectedAnalets, isProjecting, error } = useSimpleUMAPProjection(
    allAnaletsForUMAP,
    props.width,
    props.height,
    props.padding || 20,
    constraintServiceRef.current
  );

  // Filter projected results to match the displayed analets
  const projectedAnalets = useMemo(() => {
    const displayedIds = new Set(allAnalets.map(a => a.id));
    const filtered = allProjectedAnalets.filter(analet => displayedIds.has(analet.id));
    // Dedupe by id to prevent duplicate render nodes
    const mapById = new Map<number, Analet>();
    const dupes: number[] = [];
    for (const a of filtered) {
      if (mapById.has(a.id)) dupes.push(a.id);
      mapById.set(a.id, a);
    }
    const unique = Array.from(mapById.values());


    return unique;
  }, [allProjectedAnalets, allAnalets]);

  // Auto-load data on mount - use a ref to prevent infinite loops
  const hasAutoLoaded = useRef(false);
  const lastDatasetName = useRef<string | null>(null);

  // Memoize dataset state to prevent unnecessary re-renders
  const datasetState = useMemo(() => {
    const stateService = stateServiceRef.current;
    return {
      hasDataset: stateService.getHasDataset(),
      datasetInfo: stateService.getDatasetInfo()
    };
  }, []); // Empty dependency array - we'll handle updates manually

  // Update dataset state when it actually changes
  const [currentDatasetName, setCurrentDatasetName] = useState<string | null>(
    () => datasetState.datasetInfo?.name || null
  );

  // Monitor for dataset changes with polling mechanism
  useEffect(() => {
    const checkDatasetChange = () => {
      const stateService = stateServiceRef.current;
      const newDatasetName = stateService.getDatasetInfo()?.name || null;

      // Only update if dataset name actually changed
      if (newDatasetName !== currentDatasetName) {
        setCurrentDatasetName(newDatasetName);

        // Reset auto-load flag when dataset changes
        if (newDatasetName !== lastDatasetName.current) {
          hasAutoLoaded.current = false;
          lastDatasetName.current = newDatasetName;
        }
      }
    };

    // Check immediately and then poll every 500ms (reduced frequency) to catch dataset restoration
    checkDatasetChange();
    const interval = setInterval(checkDatasetChange, 500);

    return () => clearInterval(interval);
  }, [currentDatasetName, requestAnaletData]); // Add requestAnaletData to dependencies

  // Auto-load effect - runs when dataset or loading state changes
  useEffect(() => {
    const stateService = stateServiceRef.current;
    const hasDataset = stateService.getHasDataset();
    const datasetInfo = stateService.getDatasetInfo();
    // Only auto-load if:
    // 1. We haven't already auto-loaded for this dataset
    // 2. We have a dataset
    // 3. We have dataset info
    // 4. We're not already loading
    // 5. Dataset name matches current dataset name (ensures we're in sync)
    // 6. We don't have any analets yet (prevents re-triggering after individual operations)
    const isStudyMode = StudyConfigurationService.isStudyMode && StudyConfigurationService.isStudyMode();
    const studyConfigured = (() => {
      try { return !!StudyConfigurationService.getInstance().getConfiguration(); } catch { return false; }
    })();
    // In study mode, do NOT auto-trigger generation; rely on checkpoint/template restore
    if (isStudyMode && studyConfigured) {
      hasAutoLoaded.current = true;
      return;
    }
    if (!hasAutoLoaded.current && hasDataset && datasetInfo && loadingState === 'idle' && currentDatasetName === datasetInfo.name && allAnalets.length === 0) {
      try { console.log('[framing][webview] Auto-load: requesting framing analyses'); } catch {}
      // Step 1: Ensure framing analets exist (existing behavior)
      requestAnaletData(false);
      hasAutoLoaded.current = true;

      // Step 2: After a short delay, promote 20 framing analets to waypoints by default
      // This delay allows initial framing analets to be loaded first
      setTimeout(() => {
        try {
          console.log('[framing][webview] Auto-promote: requesting 20 waypoint analets');
          sendMessage('add-waypoint-analets', { count: 20 });
        } catch (e) {
          console.error('❌ [useAnaletLoader] Failed to auto-promote framing analets:', e);
        }
      }, 500);
    } else if (allAnalets.length > 0 && !hasAutoLoaded.current) {
      // If we already have analets but flag is false, just set it to true without loading
      hasAutoLoaded.current = true;
    }
  }, [currentDatasetName, loadingState, requestAnaletData, allAnalets.length]);

  // Update state service when ALL projected analets change (including non-displayed ones)
  useEffect(() => {
    // Skip updates if no projected analets or if they're identical to what we already have
    if (allProjectedAnalets.length === 0) {
      return;
    }
    const stateService = stateServiceRef.current;
    const current = stateService.getAvailableAnalets() || [];

    // Check if this is actually a meaningful change by comparing IDs and locations
    const currentMap = new Map(current.map(a => [a.id, a]));
    let hasChanges = false;

    // Check for new analets or changed locations
    for (const projected of allProjectedAnalets) {
      const existing = currentMap.get(projected.id);
      if (!existing) {
        hasChanges = true;
        break;
      }

      // Check if location changed significantly (more than 1 pixel)
      const oldLoc = existing.location || { x: 0, y: 0 };
      const newLoc = projected.location || { x: 0, y: 0 };
      if (Math.abs((oldLoc.x || 0) - (newLoc.x || 0)) > 1 || Math.abs((oldLoc.y || 0) - (newLoc.y || 0)) > 1) {
        hasChanges = true;
        break;
      }
    }

    // Also check if any current analets were removed
    if (!hasChanges) {
      const projectedIds = new Set(allProjectedAnalets.map(a => a.id));
      hasChanges = current.some(a => !projectedIds.has(a.id));
    }

    if (!hasChanges) {
      return;
    }
    const projectedMap = new Map(allProjectedAnalets.map(a => [a.id, a]));
    const merged = current.map((a: Analet) => {
      const p = projectedMap.get(a.id);
      if (!p) return a;
      // If there is a fixed constraint, do not overwrite the user position
      const isFixed = a.isFixed === true || (stateService.getConfig().umap.implementation === 'umap-js' && ConstraintService.getInstance().isAnaletFixed(a.id));
      if (isFixed && a.location) {
        return a; // keep user-fixed location
      }
      return { ...a, location: p.location };
    });

    // Also bring in any new ids from projection that aren't in current
    const mergedMap = new Map<number, Analet>(merged.map(a => [a.id, a]));
    for (const p of allProjectedAnalets) {
      if (!mergedMap.has(p.id)) {
        mergedMap.set(p.id, p);
      }
    }
    const finalAnalets = Array.from(mergedMap.values());

    // H2 test: Skip setAnaletsData if stable signature (ids + rounded locations) is unchanged
    const sig = (list: Analet[]) => list
      .slice()
      .sort((x, y) => x.id - y.id)
      .map(x => {
        const lx = Math.round((x.location?.x || 0) * 10) / 10;
        const ly = Math.round((x.location?.y || 0) * 10) / 10;
        const t = x.type || '';
        const s = (x as any).status || '';
        return `${x.id}:${lx},${ly}:${t}:${s}`;
      })
      .join('|');
    const prevSig = sig(current);
    const nextSig = sig(finalAnalets);
    if (prevSig === nextSig) {
      return;
    }
    stateService.setAnaletsData(finalAnalets);
  }, [allProjectedAnalets]);

  // Log UMAP errors
  useEffect(() => {
    if (error) {
      console.error('❌ [useAnaletLoader] UMAP projection error:', error);
    }
  }, [error]);

  // Combine loading states
  const isAnalysisLoading = useMemo(() => loadingState !== 'idle', [loadingState]);
  const isProjectionLoading = useMemo(() => !!isProjecting, [isProjecting]);
  const isLoading = useMemo(() => {
    return isAnalysisLoading || isProjectionLoading;
  }, [isAnalysisLoading, isProjectionLoading]);

  return {
    projectedAnalets,
    isLoading,
    isAnalysisLoading,
    isProjectionLoading,
    loadingMessage: getLoadingMessage(),
    requestAnaletData
  };
}
