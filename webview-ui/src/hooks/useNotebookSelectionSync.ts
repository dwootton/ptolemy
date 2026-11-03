import { useEffect, useRef } from 'react';
import { useMessageHandler } from './useMessageHandler';
import { StateService } from '../services/StateService';
import { TelemetryService } from '../services/TelemetryService';

interface SharedSelectionLike {
  selectAnalet: (analetId: number, multiSelect?: boolean, rangeSelect?: boolean) => void;
  clearSelection: () => void;
}

export function useNotebookSelectionSync(sharedSelection: SharedSelectionLike) {
  const { onMessage } = useMessageHandler();
  const lastSelectionTsRef = useRef<number>(0);
  const RECENT_SELECTION_MS = 400;

  useEffect(() => {
    // Handler for the main message with full analet data
    const offMainSelected = onMessage('notebook-cell-selection-result', (data: any) => {
      handleCellSelection(data, 'main');
    });
    
    // Handler for back-compat message (only has analetId)
    const offBackCompatSelected = onMessage('notebook-cell-selected', (data: any) => {
      handleCellSelection(data, 'back-compat');
    });
    
    // Handler for deselection (both message types)
    const offMainDeselected = onMessage('notebook-cell-selection-result', (data: any) => {
      if (data && data.analetId) return; // Not a deselection
      // Be conservative with clearing when selection-result is used; usually explicit select comes too
      const now = Date.now();
      if (now - lastSelectionTsRef.current < RECENT_SELECTION_MS) {
        return;
      }
      sharedSelection.clearSelection();
    });
    
    const offBackCompatDeselected = onMessage('notebook-cell-deselected', (data: any) => {
      // Only clear selection if:
      // - reason === 'non-analet' and it's not within the recent-selection window
      // - or no reason (older extension) and not within recent window
      const reason: string | undefined = data?.reason;
      const now = Date.now();
      const withinRecent = now - lastSelectionTsRef.current < RECENT_SELECTION_MS;
      if (reason === 'no-selection' || reason === 'no-active-editor') {
        // Ignore transient no-selection/editor switches
        return;
      }
      if (withinRecent) {
        return;
      }
      // For 'non-analet' or unknown reason after the window, clear selection
      sharedSelection.clearSelection();
    });
    
    // Unified selection handler
    const handleCellSelection = (data: any, source: string) => {
      if (!data?.analetId) {
        return;
      }
      
      const rawId = data?.analetId;
      const analetId = typeof rawId === 'number' ? rawId : Number(rawId);
      if (Number.isFinite(analetId)) {
        lastSelectionTsRef.current = Date.now();
        // TIMING FIX: Ensure the analet exists in frontend state before selecting
        const stateService = StateService.getInstance();
        const existingAnalet = stateService.getAvailableAnalets().find((a: any) => a.id === analetId);
        if (!existingAnalet && data.analet) {
          // Analet doesn't exist in frontend yet - add it first
          stateService.addAnalet(data.analet, { isFromNotebook: true });
          
          // Trigger UI updates for the new analet
          window.dispatchEvent(new CustomEvent('analetsUpdated', { 
            detail: { action: 'notebook-selection-sync-add', analetId, count: 1 }
          }));
        } else if (!existingAnalet && !data.analet) {
          console.warn('⚠️ [NotebookSelectionSync] Analet not in frontend state and no analet data provided. Cannot add analet.', { analetId, source });
        }
        
        // Now select the analet
        sharedSelection.selectAnalet(analetId, false, false);

        // Telemetry: navigation via notebook
        try {
          const telemetry = TelemetryService.getInstance();
          telemetry.recordEvent('navigation', { origin: 'notebook', analetId, source });
        } catch {}
      }
    };

    return () => {
      offMainSelected();
      offBackCompatSelected();
      offMainDeselected();
      offBackCompatDeselected();
    };
  }, [onMessage, sharedSelection]);
}


