/**
 * Custom hook for handling AnalysisMap interactions
 */

import { useCallback } from "react";
import { Analet } from "../../../types/analet";
import { ConstraintService } from "../../../services/ConstraintService";
import { useMessageHandler } from "../../../hooks/useMessageHandler";
import { TelemetryService } from "../../../services/TelemetryService";
import { MapStateHookReturn } from "./useMapState";
import {
  calculateCentroid,
  calculateCircularPositions,
  calculateSelectionBounds,
  isAnaletInSelection,
  generateRequestId
} from "../utils/mapMath";

export interface SharedSelection {
  selectionState: {
    selectedAnaletIds: Set<number>;
    lastSelectedId?: number;
    hoveredAnaletId?: number;
  };
  selectAnalet: (analetId: number, multiSelect?: boolean, rangeSelect?: boolean, analetList?: Analet[]) => void;
  clearSelection: () => void;
  isAnaletSelected: (analetId: number) => boolean;
  getSelectedCount: () => number;
}

export interface MapInteractionsProps {
  projectedAnalets: Analet[];
  sharedSelection: SharedSelection;
  constraintService?: ConstraintService;
  mapState: MapStateHookReturn;
}

export interface MapInteractionsHookReturn {
  handleAnaletClick: (analet: Analet, event: React.MouseEvent) => void;
  handleAnaletDoubleClick: (analet: Analet, event: React.MouseEvent) => void;
  handleMapClick: (event: React.MouseEvent) => void;
  handleMapDoubleClick: (event: React.MouseEvent) => void;
  handleMouseDown: (event: React.MouseEvent) => void;
  handleMouseMove: (event: React.MouseEvent) => void;
  handleMouseUp: (event: React.MouseEvent) => void;
  handleMapRightClick: (event: React.MouseEvent) => void;
  handleAnaletRightClick: (analet: Analet, event: React.MouseEvent) => void;
  handleTightCluster: () => void;
  handleGenerateAnaletsFromStatement: () => void;
  handleAddNote: (analets: Analet[]) => void;
  handleAddNoteToAnalet: (analet: Analet) => void;
  handleAddNoteToMap: (position: { x: number; y: number }) => void;
  handleGoToNewNode: () => void;
  performSelectionBrushSelect: () => void;
}

export function useMapInteractions({
  projectedAnalets,
  sharedSelection,
  constraintService = ConstraintService.getInstance(),
  mapState
}: MapInteractionsProps): MapInteractionsHookReturn {

  const { sendMessage } = useMessageHandler();

  // Handle analet click
  const handleAnaletClick = useCallback((analet: Analet, event: React.MouseEvent) => {
    event.stopPropagation();

    // Treat Shift like multi-select (add/toggle), not range-select
    const isMultiSelect = event.ctrlKey || event.metaKey || event.shiftKey;
    const isRangeSelect = false;

    sharedSelection.selectAnalet(analet.id, isMultiSelect, isRangeSelect, projectedAnalets);
    mapState.clearAllMenus();
  }, [sharedSelection, projectedAnalets, mapState]);

  // Handle analet double click
  const handleAnaletDoubleClick = useCallback((analet: Analet, event: React.MouseEvent) => {
    event.stopPropagation();

    const startTime = performance.now();
    // Single source of truth: Only send analet ID, backend will fetch fresh data
    sendMessage('create-or-open-cell', { analetId: analet.id, startTime: startTime });
    try {
      const telemetry = TelemetryService.getInstance();
      telemetry.recordEvent('navigation', { origin: 'analysis-map', analetId: analet.id, startTime });
    } catch {}
  }, [sendMessage]);

  // Handle map click (background)
  const handleMapClick = useCallback((event: React.MouseEvent) => {
    // Only clear selection if not clicking on an analet
    if (event.target === event.currentTarget) {
      sharedSelection.clearSelection();
      mapState.clearAllMenus();
    }
  }, [sharedSelection, mapState]);

  // Handle map double click
  const handleMapDoubleClick = useCallback((event: React.MouseEvent) => {
    if (event.target !== event.currentTarget) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // Set cursor position for potential analet generation
    mapState.setCursorPosition({ x, y });

    // Could trigger analet generation modal here
    sendMessage('request-analet-generation', { position: { x, y } });
  }, [mapState, sendMessage]);

  // Handle mouse down for selection brush
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return; // Only left click
    if (event.target !== event.currentTarget) return; // Only on map background

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    mapState.setSelectionBrush({
      isActive: true,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
  }, [mapState]);

  // Handle mouse move for selection brush
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!mapState.selectionBrush.isActive) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    mapState.setSelectionBrush({
      ...mapState.selectionBrush,
      currentX: x,
      currentY: y,
    });
  }, [mapState]);

  // Handle mouse up for selection brush
  const handleMouseUp = useCallback((_event: React.MouseEvent) => {
    if (!mapState.selectionBrush.isActive) return;

    performSelectionBrushSelect();

    mapState.setSelectionBrush({
      ...mapState.selectionBrush,
      isActive: false,
    });
  }, [mapState]);

  // Perform selection brush select
  const performSelectionBrushSelect = useCallback(() => {
    if (!mapState.selectionBrush.isActive) return;

    const bounds = calculateSelectionBounds(
      mapState.selectionBrush.startX,
      mapState.selectionBrush.startY,
      mapState.selectionBrush.currentX,
      mapState.selectionBrush.currentY
    );

    const selectedAnalets = projectedAnalets.filter(analet =>
      isAnaletInSelection(analet, bounds)
    );

    if (selectedAnalets.length > 0) {
      // Clear existing selection and select all in brush
      sharedSelection.clearSelection();
      selectedAnalets.forEach(analet => {
        sharedSelection.selectAnalet(analet.id, true);
      });
    }
  }, [mapState, projectedAnalets, sharedSelection]);

  // Handle right click on map
  const handleMapRightClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();

    if (event.target !== event.currentTarget) {
      return;
    }

    const selectedAnalets = projectedAnalets.filter(analet =>
      sharedSelection.isAnaletSelected(analet.id)
    );
    if (selectedAnalets.length > 0) {
      mapState.setContextMenu({
        x: event.clientX,
        y: event.clientY,
        analets: selectedAnalets,
      });
    } else {
      // No analets selected - show empty space context menu
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const mapX = event.clientX - rect.left;
      const mapY = event.clientY - rect.top;
      mapState.setEmptySpaceContextMenu({
        x: event.clientX,
        y: event.clientY,
        mapPosition: { x: mapX, y: mapY },
      });
    }
  }, [projectedAnalets, sharedSelection, mapState]);

  // Handle right click on analet
  const handleAnaletRightClick = useCallback((analet: Analet, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Check if analet represents a statement (has specific properties)
    if (analet.statement && analet.statement.length > 0) {
      mapState.setStatementContextMenu({
        x: event.clientX,
        y: event.clientY,
        analet,
      });
    }
  }, [mapState]);

  // Handle tight cluster action
  const handleTightCluster = useCallback(() => {
    const selectedAnalets = projectedAnalets.filter(analet =>
      sharedSelection.isAnaletSelected(analet.id)
    );

    if (selectedAnalets.length === 0) {
      mapState.showToast("No analets selected for clustering");
      return;
    }

    // Calculate centroid of selected analets
    const centroid = calculateCentroid(selectedAnalets);

    // Create tight cluster around centroid
    const positions = calculateCircularPositions(selectedAnalets, centroid, 50);

    positions.forEach(({ analet, position }) => {
      constraintService.setAnaletFixed(analet, position, 1.0);
    });

    mapState.setContextMenu(null);
  }, [projectedAnalets, sharedSelection, constraintService, mapState]);

  // Handle generate analets from statement
  const handleGenerateAnaletsFromStatement = useCallback(async () => {
    if (!mapState.statementContextMenu) return;

    const statement = mapState.statementContextMenu.analet;
    mapState.setStatementContextMenu(null);

    try {
      const requestId = generateRequestId();

      sendMessage('generate-analets-from-statement', {
        statementText: statement.statement,
        statementId: statement.id,
        requestId,
        position: statement.location,
      });

      mapState.showToast(`Generating analets from "${statement.statement}"...`);
    } catch (error) {
      console.error('❌ [AnalysisMap] Error generating analets from statement:', error);
      mapState.showToast("Failed to generate analets from statement");
    }
  }, [mapState, sendMessage]);

  // Handle go to new node
  const handleGoToNewNode = useCallback(() => {
    if (!mapState.newNodeButton) return;

    const analetId = mapState.newNodeButton.analetId;
    const analet = projectedAnalets.find(a => a.id === analetId);

    if (analet && mapState.transformRef.current) {
      // Center the map on the new analet
      mapState.transformRef.current.setTransform(
        -(analet.location?.x ?? 0) * 1 + 400, // Center X with some offset
        -(analet.location?.y ?? 0) * 1 + 300, // Center Y with some offset
        1 // Default zoom level
      );

      // Select the analet
      sharedSelection.selectAnalet(analetId);

      // Clear the button
      mapState.setNewNodeButton(null);
      if (mapState.newNodeTimer) {
        clearTimeout(mapState.newNodeTimer);
        mapState.setNewNodeTimer(null);
      }
    }
  }, [mapState, projectedAnalets, sharedSelection]);

  // Handle add note to selected analets
  const handleAddNote = useCallback((analets: Analet[]) => {
    if (analets.length === 0) return;

    mapState.setContextMenu(null);

    if (analets.length === 1) {
      // Single analet - create note as child
      sendMessage('create-note', { parentId: `analet-${analets[0].id}` });
    } else {
      // Multiple analets - create note at root level
      sendMessage('create-note', {
        parentId: 'root'
      });
    }
  }, [sendMessage, mapState]);

  // Handle add note to specific analet
  const handleAddNoteToAnalet = useCallback((analet: Analet) => {
    mapState.setStatementContextMenu(null);

    sendMessage('create-note', {
      parentId: `analet-${analet.id}`,
      title: `Note for: ${analet.shortName || analet.statement.substring(0, 50)}`,
      body: `Analysis note for analet: ${analet.statement}`
    });
  }, [sendMessage, mapState]);

  // Handle add note to map at specific position
  const handleAddNoteToMap = useCallback((position: { x: number; y: number }) => {
    mapState.setEmptySpaceContextMenu(null);

    // Start map note creation with position
    mapState.setMapNoteEditor({
      isVisible: true,
      position: position,
    });
  }, [mapState]);

  // Removed: new analet creation handling here. The map should just render given projectedAnalets.

  return {
    handleAnaletClick,
    handleAnaletDoubleClick,
    handleMapClick,
    handleMapDoubleClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMapRightClick,
    handleAnaletRightClick,
    handleTightCluster,
    handleGenerateAnaletsFromStatement,
    handleAddNote,
    handleAddNoteToAnalet,
    handleAddNoteToMap,
    handleGoToNewNode,
    performSelectionBrushSelect,
  };
}
