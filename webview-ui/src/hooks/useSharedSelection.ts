import { useState, useCallback, useEffect, useRef } from 'react';
import { Analet, Bearing } from '../types/analet';

interface SharedSelectionState {
  selectedAnaletIds: Set<number>;
  selectedBearingIds: Set<number>;
  lastSelectedId?: number;
  lastSelectedType?: 'analet' | 'bearing';
  hoveredAnaletId?: number;
  hoveredBearingId?: number;
}

export function useSharedSelection() {
  const [selectionState, setSelectionState] = useState<SharedSelectionState>({
    selectedAnaletIds: new Set<number>(),
    selectedBearingIds: new Set<number>(),
    lastSelectedId: undefined,
    lastSelectedType: undefined,
    hoveredAnaletId: undefined,
    hoveredBearingId: undefined
  });

  // Track recent selections to prevent double-calls
  const recentSelections = useRef<Map<number, number>>(new Map());

  useEffect(() => {
  }, [selectionState]);

  // Clean up old entries from recentSelections periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const entries = Array.from(recentSelections.current.entries());
      for (const [analetId, timestamp] of entries) {
        if (now - timestamp > 1000) { // Remove entries older than 1 second
          recentSelections.current.delete(analetId);
        }
      }
    }, 5000); // Clean every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const selectAnalet = useCallback((analetId: number, multiSelect: boolean = false, rangeSelect: boolean = false, analetList?: Analet[]) => {
    // Check for recent double-calls (within 100ms)
    const now = Date.now();
    const lastCallTime = recentSelections.current.get(analetId);
    if (lastCallTime && (now - lastCallTime) < 100) {
      return;
    }
    recentSelections.current.set(analetId, now);

    setSelectionState(prev => {
      const newSelectedIds = new Set(prev.selectedAnaletIds);

      if (rangeSelect && prev.lastSelectedId && analetList) {
        // Range selection: select all analets between lastSelectedId and analetId
        const currentIndex = analetList.findIndex(a => a.id === analetId);
        const lastIndex = analetList.findIndex(a => a.id === prev.lastSelectedId);

        if (currentIndex !== -1 && lastIndex !== -1) {
          const startIndex = Math.min(currentIndex, lastIndex);
          const endIndex = Math.max(currentIndex, lastIndex);

          // Add all analets in the range to selection
          for (let i = startIndex; i <= endIndex; i++) {
            newSelectedIds.add(analetList[i].id);
          }
        } else {
          // Fallback to regular selection if indices not found
          newSelectedIds.add(analetId);
        }
      } else if (multiSelect) {
        // Multi-select: toggle the selected state
        if (newSelectedIds.has(analetId)) {
          newSelectedIds.delete(analetId);
        } else {
          newSelectedIds.add(analetId);
        }
      } else {
        // Single selection: clear all and select this one
        newSelectedIds.clear();
        newSelectedIds.add(analetId);
      }
      return {
        ...prev,
        selectedAnaletIds: newSelectedIds,
        selectedBearingIds: multiSelect ? prev.selectedBearingIds : new Set<number>(), // Clear bearings unless multi-select
        lastSelectedId: analetId,
        lastSelectedType: 'analet'
      };
    });
  }, []);

  const selectBearing = useCallback((bearingId: number, multiSelect: boolean = false, rangeSelect: boolean = false, bearingList?: Bearing[]) => {
    // Check for recent double-calls (within 100ms)
    const now = Date.now();
    const lastCallTime = recentSelections.current.get(bearingId);
    if (lastCallTime && (now - lastCallTime) < 100) {
      return;
    }
    recentSelections.current.set(bearingId, now);

    setSelectionState(prev => {
      const newSelectedIds = new Set(prev.selectedBearingIds);

      if (multiSelect) {
        // Multi-select: toggle the bearing
        if (newSelectedIds.has(bearingId)) {
          newSelectedIds.delete(bearingId);
        } else {
          newSelectedIds.add(bearingId);
        }
      } else if (rangeSelect && prev.lastSelectedId && prev.lastSelectedType === 'bearing' && bearingList) {
        // Range selection for bearings
        const lastIndex = bearingList.findIndex(b => b.id === prev.lastSelectedId);
        const currentIndex = bearingList.findIndex(b => b.id === bearingId);

        if (lastIndex !== -1 && currentIndex !== -1) {
          const startIndex = Math.min(lastIndex, currentIndex);
          const endIndex = Math.max(lastIndex, currentIndex);

          for (let i = startIndex; i <= endIndex; i++) {
            newSelectedIds.add(bearingList[i].id);
          }
        } else {
          newSelectedIds.add(bearingId);
        }
      } else {
        // Single selection: clear all and select this one
        newSelectedIds.clear();
        newSelectedIds.add(bearingId);
      }
      return {
        ...prev,
        selectedBearingIds: newSelectedIds,
        selectedAnaletIds: multiSelect ? prev.selectedAnaletIds : new Set<number>(), // Clear analets unless multi-select
        lastSelectedId: bearingId,
        lastSelectedType: 'bearing'
      };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionState(prev => ({
      selectedAnaletIds: new Set<number>(),
      selectedBearingIds: new Set<number>(),
      lastSelectedId: undefined,
      lastSelectedType: undefined,
      hoveredAnaletId: prev.hoveredAnaletId,
      hoveredBearingId: prev.hoveredBearingId
    }));
  }, []);

  const setHoveredAnalet = useCallback((analetId: number | undefined) => {
    setSelectionState(prev => ({
      ...prev,
      hoveredAnaletId: analetId
    }));
  }, []);

  const setHoveredBearing = useCallback((bearingId: number | undefined) => {
    setSelectionState(prev => ({
      ...prev,
      hoveredBearingId: bearingId
    }));
  }, []);

  const isAnaletSelected = useCallback((analetId: number) => {
    return selectionState.selectedAnaletIds.has(analetId);
  }, [selectionState.selectedAnaletIds]);

  const isBearingSelected = useCallback((bearingId: number) => {
    return selectionState.selectedBearingIds.has(bearingId);
  }, [selectionState.selectedBearingIds]);

  const getSelectedCount = useCallback(() => {
    return selectionState.selectedAnaletIds.size + selectionState.selectedBearingIds.size;
  }, [selectionState.selectedAnaletIds, selectionState.selectedBearingIds]);

  const getSelectedAnalets = useCallback((analets: Analet[]) => {
    return analets.filter(analet => selectionState.selectedAnaletIds.has(analet.id));
  }, [selectionState.selectedAnaletIds]);

  const getSelectedBearings = useCallback((bearings: Bearing[]) => {
    return bearings.filter(bearing => selectionState.selectedBearingIds.has(bearing.id));
  }, [selectionState.selectedBearingIds]);

  return {
    selectionState,
    selectAnalet,
    selectBearing,
    clearSelection,
    isAnaletSelected,
    isBearingSelected,
    getSelectedCount,
    getSelectedAnalets,
    getSelectedBearings,
    setHoveredAnalet,
    setHoveredBearing,
    getHoveredAnaletId: () => selectionState.hoveredAnaletId,
    getHoveredBearingId: () => selectionState.hoveredBearingId
  };
}
