  // Debug log at the very top to ensure file is loaded
import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Analet, AnalysisComponent, Bearing } from "../../types/analet";
import { useMessageHandler } from "../../hooks/useMessageHandler";
import { ConstraintService } from "../../services/ConstraintService";
import { StateService } from "../../services/StateService";
import { useAnaletDrag } from "./hooks/useAnaletDrag";
import { useAnaletVisibility } from "../../hooks/useAnaletVisibility";
import { Tooltip } from "./Tooltip";
// COMMENTED OUT: No longer needed with text annotations disabled
// import { generateUniqueLabels } from "../../utilities/labelGeneration";
// COMMENTED OUT: No longer needed with text annotations disabled
// import { forceDirectedLabeling, filterLabelsByProximity } from "../../utilities/forceDirectedLabeling";
// COMMENTED OUT FOR CLEANUP - import { TightBubbleSet, hexToRgba } from "./components/TightBubbleSet";
// CLEANED UP - removed unused hexToRgba function
import { MapOverlayPanel } from "./components/MapOverlayPanel";
// COMMENTED OUT - Bearing UI components hidden for now
// import { MapMasthead } from "./components/MapMasthead";
// import { BearingModal } from "./components/BearingModal";
import { TightBubbleSet } from "./components/TightBubbleSet";
import { HierarchyService } from "../../services/HierarchyService";
import { EmbeddingCursor } from "./components/EmbeddingCursor";
import { computeConvexHull, isPointInPolygon } from "../../utilities/convexHull";
import { MapNoteEditor } from "./components/MapNoteEditor";
import { MapNotes } from "./components/MapNotes";
import { LabelLayer } from "./components/LabelLayer";
import { computeLabelLayout } from "./utils/labelLayout";
import { useMapNotes } from "./hooks/useMapNotes";
import { createUMAPInversion } from "../../utilities/umapInversion";
import { getAnaletNodeColor } from "../../utilities/analetsColors";
import { useAnalysisMapInstrumentation } from '../../hooks/useInstrumentation';
import { useGridPositions } from "../../utilities/gridLayout";
import { FeatureFlags } from "../../utils/featureFlags";
import { useSessionState } from "../../hooks/useSessionState";
// (duplicate import avoided) HierarchyService already imported above
// CSS for the pulse animation
const pulseCss = `
@keyframes pulse {
  0% {
    transform: translateX(-50%) scale(1);
    box-shadow: 0 4px 12px rgba(147, 51, 234, 0.4);
  }
  50% {
    transform: translateX(-50%) scale(1.05);
    box-shadow: 0 6px 18px rgba(147, 51, 234, 0.6);
  }
  100% {
    transform: translateX(-50%) scale(1);
    box-shadow: 0 4px 12px rgba(147, 51, 234, 0.4);
  }
}
`;

// Inject CSS into the head
if (typeof document !== 'undefined' && !document.getElementById('analet-map-styles')) {
  const style = document.createElement('style');
  style.id = 'analet-map-styles';
  style.textContent = pulseCss;
  document.head.appendChild(style);
}

interface SharedSelection {
  selectionState: {
    selectedAnaletIds: Set<number>;
    selectedBearingIds?: Set<number>;
    lastSelectedId?: number;
    lastSelectedType?: 'analet' | 'bearing';
    hoveredAnaletId?: number;
    hoveredBearingId?: number;
  };
  selectAnalet: (analetId: number, multiSelect?: boolean, rangeSelect?: boolean, analetList?: Analet[]) => void;
  selectBearing?: (bearingId: number, multiSelect?: boolean, rangeSelect?: boolean, bearingList?: Bearing[]) => void;
  clearSelection: () => void;
  isAnaletSelected: (analetId: number) => boolean;
  isBearingSelected?: (bearingId: number) => boolean;
  getSelectedCount: () => number;
  getSelectedAnalets: (analets: Analet[]) => Analet[];
  getSelectedBearings?: (bearings: Bearing[]) => Bearing[];
  setHoveredAnalet: (analetId: number | undefined) => void;
  setHoveredBearing?: (bearingId: number | undefined) => void;
  getHoveredAnaletId: () => number | undefined;
  getHoveredBearingId?: () => number | undefined;
}

interface AnalysisMapProps {
  projectedAnalets: Analet[];
  analysisComponents?: AnalysisComponent[];
  width?: number;
  height?: number;
  padding?: number;
  onAnaletClick?: (analet: Analet) => void;
  sharedSelection?: SharedSelection;
  constraintService?: ConstraintService;
  onAnaletDragEnd?: (analet: Analet, newPosition: { x: number; y: number }) => void;
  selectedFolderName?: string | null; // Name of currently selected folder
  onCreateFolderFromCluster?: (analetIds: number[], folderName: string) => void;
  clusterFolderState?: {
    isLoading: boolean;
    progress: string | null;
  };
  stateService?: StateService;
  isTrackingEnabled?: boolean;
  onTrackingToggle?: (enabled: boolean) => void;
  onNoteEditingChange?: (isEditing: boolean, targetAnalet: Analet | null, content: string) => void;
}

export const AnalysisMap: React.FC<AnalysisMapProps> = (props) => {
  const { sendMessage, onMessage } = useMessageHandler();
  const visibility = useAnaletVisibility();
  const {
    trackClick,
    trackHoverStart,
    trackHoverEnd,
    trackDragStart,
    trackDragEnd
  } = useAnalysisMapInstrumentation();

  // Get session state for notes
  const { analysisComponents } = useSessionState();

      // Debug log analysisComponents changes
    useEffect(() => {
    }, [analysisComponents]);

  // Map notes functionality
  const {
    mapNotes,
    selectedNoteId,
    // setSelectedNoteId,
    createMapNote,
    moveMapNote,
    allNotes  // Get allNotes which includes analet notes
  } = useMapNotes();

  // Visibility toggle for map note text (HTML overlay)
  const [visibleMapNoteIds, setVisibleMapNoteIds] = useState<Set<number>>(new Set());
  const toggleMapNoteVisibility = useCallback((noteId: number) => {
    setVisibleMapNoteIds(prev => {
      const next = new Set(prev);
      const id = Number(noteId);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Optimistic drag positions for map notes
  const [dragNotePositions, setDragNotePositions] = useState<Map<number, { x: number; y: number }>>(new Map());

      // Debug log mapNotes changes
    useEffect(() => {
    }, [mapNotes]);


  // Function to get connected notes for an analet using hierarchy edges + allNotes
  const getConnectedNotes = useCallback((analetId: number) => {
    const hierarchyService = HierarchyService.getInstance();
    const analetNodeId = `analet-${analetId}`;
    const childEdges = hierarchyService.getChildren(analetNodeId) || [];
    const noteEdges = childEdges.filter(e => typeof e.childId === 'string' && e.childId.startsWith('note-'));

    const edgeNoteIds = noteEdges
      .map(e => parseInt(e.childId.replace('note-', ''), 10))
      .filter(id => Number.isFinite(id));

    const notesById = new Map(allNotes.map(n => [n.id, n] as const));
    const matchedNotes = edgeNoteIds
      .map(id => notesById.get(id))
              .filter((n): n is typeof allNotes[number] => !!n && n.status === 'active')
        .slice(0, 8);


      return matchedNotes;
  }, [allNotes]);

  // Grid layout state
  const stateService = StateService.getInstance();
  const [gridLayoutEnabled, setGridLayoutEnabled] = useState(stateService.getGridLayoutEnabled());
  const [hoveredAnalet, setHoveredAnalet] = useState<{ analet: Analet; x: number; y: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const analetHoverEpochRef = useRef(0);

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, selectedCount: number } | null>(null);
  const [statementContextMenu, setStatementContextMenu] = useState<{ x: number, y: number, analet: Analet } | null>(null);
  const [analetContextMenu, setAnaletContextMenu] = useState<{ x: number, y: number, analet: Analet } | null>(null);

  // Map note state
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{ x: number, y: number, mapPosition: { x: number, y: number } } | null>(null);
  const [noteContextMenu, setNoteContextMenu] = useState<{ x: number, y: number, note: any } | null>(null);
  const [mapNoteEditor, setMapNoteEditor] = useState<{ isVisible: boolean, position: { x: number, y: number }, note?: any }>({
    isVisible: false,
    position: { x: 0, y: 0 },
  });
  const [derivePromptDialog, setDerivePromptDialog] = useState<{ analet: Analet } | null>(null);
  const [derivePromptText, setDerivePromptText] = useState('');
  const [selectionBrush, setSelectionBrush] = useState<{ startX: number, startY: number, currentX: number, currentY: number, isActive: boolean } | null>(null);
  // CLEANED UP - removed unused transformReady state
  const [newNodeButton, setNewNodeButton] = useState<{ analetId: number, position: { x: number, y: number } } | null>(null);
  const [newNodeTimer, setNewNodeTimer] = useState<NodeJS.Timeout | null>(null);
  // Per-analet label visibility: start with none visible by default
  const [visibleLabelIds, setVisibleLabelIds] = useState<Set<number>>(new Set());

  // Overlay panel state
  const isTrackingEnabled = props.isTrackingEnabled || false;
  const [isEmbeddingCursorEnabled, setIsEmbeddingCursorEnabled] = useState(false);
  // COMMENTED OUT - Bearing edit mode state no longer needed
  // const [isEditBearingMode, setIsEditBearingMode] = useState<null | number>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  // COMMENTED OUT - Bearing modal state no longer needed
  // const [isBearingModalOpen, setIsBearingModalOpen] = useState(false);

  // Focus generation loading state
  const [isFocusGenerating, setIsFocusGenerating] = useState(false);
  // Force re-render on active bearing changes so bubble set updates
  const [bearingRenderTick, setBearingRenderTick] = useState(0);
  useEffect(() => {
    const handler = () => setBearingRenderTick((v) => v + 1);
    window.addEventListener('activeBearingChanged', handler as EventListener);
    window.addEventListener('bearingsUpdated', handler as EventListener);
    return () => {
      window.removeEventListener('activeBearingChanged', handler as EventListener);
      window.removeEventListener('bearingsUpdated', handler as EventListener);
    };
  }, []);
  // Use tick to avoid unused warning by referencing in memo
  void bearingRenderTick;

  // Note editing state
  const [isAddingNote, setIsAddingNote] = useState(false);

  useEffect(() => {
  }, [props.projectedAnalets]);

  // Sync tracking with global events and persistence
  useEffect(() => {
    const saved = (() => { try { return localStorage.getItem('autoTrackEnabled'); } catch { return null; } })();
    if (saved != null) {
      const enabled = saved === '1';
      if (enabled !== isTrackingEnabled) {
        try { props.onTrackingToggle?.(enabled); } catch {}
      }
    }
    const handler = (e: any) => {
      const enabled = !!e?.detail?.enabled;
      try { localStorage.setItem('autoTrackEnabled', enabled ? '1' : '0'); } catch {}
      try { props.onTrackingToggle?.(enabled); } catch {}
    };
    window.addEventListener('toggleAutoTrack' as any, handler);
    return () => window.removeEventListener('toggleAutoTrack' as any, handler);
  }, [props.onTrackingToggle, isTrackingEnabled]);

  // Recompute convex hull whenever projectedAnalets change (disabled in grid layout)
  useEffect(() => {
    if (gridLayoutEnabled) {
      setHullPoints([]);
      return;
    }
    // Get all analets from state service to include framing analets in convex hull
    let allAnalets = props.projectedAnalets || [];
    if (props.stateService) {
      try {
        const stateAnalets = props.stateService.getAvailableAnalets();
        if (stateAnalets && stateAnalets.length > 0) {
          // Combine projected analets with all analets from state, removing duplicates
          const projectedIds = new Set(props.projectedAnalets.map(a => a.id));
          const additionalAnalets = stateAnalets.filter(a => !projectedIds.has(a.id));
          allAnalets = [...props.projectedAnalets, ...additionalAnalets];
        }
      } catch (error) {
        console.warn('[AnalysisMap] Failed to get all analets from state service:', error);
      }
    }

    const pts = allAnalets
      .map(a => ({ x: a.location?.x || 0, y: a.location?.y || 0 }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length >= 3) {
      setHullPoints(pts.length ? computeConvexHull(pts) : []);
    } else {
      setHullPoints([]);
    }
  }, [props.projectedAnalets, props.stateService, gridLayoutEnabled]);

  // Toast notification function
  const showNoAnaletToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);

    // Auto-hide after 3 seconds
    setTimeout(() => {
      setToastVisible(false);
      // Clear message after fade animation
      setTimeout(() => setToastMessage(null), 300);
    }, 3000);
  }, []);

  // Embedding cursor state
  const [cursorPosition, setCursorPosition] = useState({ x: 200, y: 150 });
  const [cursorDescription, setCursorDescription] = useState<string | undefined>(undefined);
  const [isCursorLoading, setIsCursorLoading] = useState(false);
  const [umapInversion, setUmapInversion] = useState<any>(null);
  const [hullPoints, setHullPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [isCursorOutsideHull, setIsCursorOutsideHull] = useState(false);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const hoverTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const transformRef = React.useRef<any>(null);

  // Get or create constraint service
  const constraintService = props.constraintService || ConstraintService.getInstance();

  // Removed: new analet creation UI handling. Map renders whatever projectedAnalets are passed in.

  // Listen for notebook cell selection to highlight corresponding analet
  useEffect(() => {
    const cleanupSelection = onMessage('notebook-cell-selection-result', (data: any) => {
      if (!data?.analetId) return;
      const rawId = data?.analetId;
      const analetId = typeof rawId === 'number' ? rawId : Number(rawId);

      // Highlight the corresponding analet
      if (props.sharedSelection && Number.isFinite(analetId)) {
        // TIMING FIX: Ensure the analet exists in frontend state before selecting
        const stateService = StateService.getInstance();
        const existingAnalet = stateService.getAvailableAnalets().find((a: any) => a.id === analetId);

        if (!existingAnalet && data.analet) {
          // Analet doesn't exist in frontend yet - add it first
          stateService.addAnalet(data.analet, { isFromNotebook: true });
        }

        props.sharedSelection.selectAnalet(analetId, false);

        // Verify selection was applied
        setTimeout(() => {
          // selection state sync check intentionally no-op
        }, 100);

        // Only pan to the analet if autotrack/tracking is enabled
        if (isTrackingEnabled && transformRef.current) {
          // Find the analet in all projected analets to get accurate position for panning
          const actualAnalet = props.projectedAnalets?.find(a => a.id === analetId);

          if (actualAnalet) {
            // Get actual container dimensions
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (!containerRect) {
              return;
            }

            const { x, y } = getAnaletRenderPosition(actualAnalet);
            const currentScale = transformRef.current.instance.transformState.scale;

            // Calculate target transform to center the analet using actual viewport center
            const centerX = containerRect.width / 2;
            const centerY = containerRect.height / 2;
            const targetX = centerX - x * currentScale;
            const targetY = centerY - y * currentScale;
            transformRef.current.setTransform(
              targetX,
              targetY,
              currentScale,
              300  // Animation duration
            );
          }
        }
      }
    });
    const cleanupDeselection = onMessage('notebook-cell-selection-result', (data: any) => {
      if (data && data.analetId) return; // not a deselect
      // Clear analet selection
      if (props.sharedSelection) {
        props.sharedSelection.clearSelection();
      }
    });

    const cleanupNoAnalet = onMessage('notebook-cell-no-analet', (data: any) => {
      // Clear any existing selection
      if (props.sharedSelection) {
        props.sharedSelection.clearSelection();
      }

      // Show toast notification
      showNoAnaletToast(data.reason || 'No analet created for this cell');
    });

    // Listen for autotrack navigation to new analets
    const cleanupAutotrackNew = onMessage('autotrack-new-analet', (data: any) => {
      if (!isTrackingEnabled) {
        return;
      }

      // Find the analet and pan to it
      const analet = props.projectedAnalets?.find(a => a.id === data.analetId);
      if (analet && transformRef.current) {
        const { x, y } = getAnaletRenderPosition(analet);
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        const centerX = containerRect.width / 2;
        const centerY = containerRect.height / 2;
        const targetX = centerX - x * 1.0; // Moderate zoom for new analets
        const targetY = centerY - y * 1.0;
        transformRef.current.setTransform(targetX, targetY, 1.0, 400);

        // Also select the analet to highlight it
        if (props.sharedSelection) {
          props.sharedSelection.selectAnalet(data.analetId, false);
        }
      }
    });

    // Listen for autotrack navigation to updated analets
    const cleanupAutotrackUpdated = onMessage('autotrack-updated-analet', (data: any) => {
      if (!isTrackingEnabled) {
        return;
      }

      // Find the analet and pan to it with a different animation for updates
      const analet = props.projectedAnalets?.find(a => a.id === data.analetId);
      if (analet && transformRef.current) {
        const { x, y } = getAnaletRenderPosition(analet);
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        const centerX = containerRect.width / 2;
        const centerY = containerRect.height / 2;
        const currentScale = transformRef.current.instance.transformState.scale;
        const targetX = centerX - x * currentScale;
        const targetY = centerY - y * currentScale;
        transformRef.current.setTransform(targetX, targetY, currentScale, 300);

        // Select and add a temporary highlight effect
        if (props.sharedSelection) {
          props.sharedSelection.selectAnalet(data.analetId, false);
        }
      }
    });

    // Listen for focus generation completion
    const cleanupFocusGeneration = onMessage('fetch-analet-data', (data: any) => {
      if (data.generatedFromFocus || data.fallbackUsed) {
        setIsFocusGenerating(false);
      }
    });

    return () => {
      cleanupSelection();
      cleanupDeselection();
      cleanupNoAnalet();
      cleanupAutotrackNew();
      cleanupAutotrackUpdated();
      cleanupFocusGeneration();
    };
  }, [onMessage, props.sharedSelection, props.projectedAnalets, props.width, props.height]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (newNodeTimer) {
        clearTimeout(newNodeTimer);
      }
    };
  }, [newNodeTimer]);

  // Add note at center event handler
  useEffect(() => {
    const handler = () => {
      try {
        const container = containerRef.current;
        const containerRect = container?.getBoundingClientRect();
        const transform = transformRef.current?.instance?.transformState;
        if (!containerRect || !transform) return;
        const scale = transform.scale || 1;
        const translateX = transform.positionX || 0;
        const translateY = transform.positionY || 0;
        // Compute map (SVG) center coords
        const mapX = (-translateX + containerRect.width / 2) / scale;
        const mapY = (-translateY + containerRect.height / 2) / scale;
        // Convert to viewport coords for editor placement
        const svgElement = document.querySelector('svg');
        const svgRect = svgElement?.getBoundingClientRect();
        const viewportPosition = svgRect
          ? { x: svgRect.left + mapX, y: svgRect.top + mapY }
          : { x: mapX, y: mapY };
        setMapNoteEditor({ isVisible: true, position: viewportPosition });
      } catch {}
    };
    window.addEventListener('addMapNoteAtCenter' as any, handler);
    return () => window.removeEventListener('addMapNoteAtCenter' as any, handler);
  }, []);


  // Handle "go to new node" button click
  const handleGoToNewNode = useCallback(() => {
    if (newNodeButton && props.sharedSelection) {
      // Select the new analet
      props.sharedSelection.selectAnalet(newNodeButton.analetId, false);

      // Pan to the analet's position
      if (transformRef.current) {
        const { x, y } = newNodeButton.position;
        transformRef.current.setTransform(
          -x + (props.width || 800) / 2,
          -y + (props.height || 600) / 2,
          1.5, // Zoom in a bit
          200  // Animation duration
        );
      }

      // Hide the button
      if (newNodeTimer) {
        clearTimeout(newNodeTimer);
      }
      setNewNodeButton(null);
      setNewNodeTimer(null);
    }
  }, [newNodeButton, props.sharedSelection, props.width, props.height, newNodeTimer]);

  // Generate unique labels for all analets (COMMENTED OUT - no longer needed with text annotations disabled)
  // const labelMap = React.useMemo(() => {
  //   return generateUniqueLabels(props.projectedAnalets);
  // }, [props.projectedAnalets]);

  // ✅ Issue #3 Fix: Analets are now pre-filtered in App.tsx - use directly
  // Dedupe projectedAnalets by id at render boundary and log
  const displayAnalets = useMemo(() => {
    const map = new Map<number, Analet>();
    const dupes: number[] = [];
    for (const a of props.projectedAnalets || []) {
      if (map.has(a.id)) dupes.push(a.id);
      map.set(a.id, a);
    }
    const arr = Array.from(map.values());

    return arr;
  }, [props.projectedAnalets]);

  // Listen for grid layout changes
  useEffect(() => {
    const onGridLayoutToggle = (e: any) => {
      const enabled = !!e?.detail?.enabled;
      setGridLayoutEnabled(enabled);
    };
    window.addEventListener('gridLayoutChanged' as any, onGridLayoutToggle);
    return () => window.removeEventListener('gridLayoutChanged' as any, onGridLayoutToggle);
  }, []);

  // Calculate grid positions when grid layout is enabled
  const gridPositions = useGridPositions(
    displayAnalets,
    { width: props.width || 800, height: props.height || 400 },
    gridLayoutEnabled ? undefined : { containerWidth: 0, containerHeight: 0 } // Disable when not in grid mode
  );


  /* COMMENTED OUT: Label positioning calculations (no longer needed with text annotations disabled)
  // Use force-directed labeling for optimal label positioning
  const labelPositions = React.useMemo(() => {
    const result = forceDirectedLabeling(
      displayAnalets,
      [],
      labelMap,
      new Map(),
      40 // maxDistance for proximity check - increased to give labels more space
    );
    return result.analetLabelPositions;
  }, [displayAnalets, labelMap]);

  // CLEANED UP - removed unused clusterLabelPositions

  // Create anchor maps for proximity filtering
  const analetAnchors = React.useMemo(() => {
    const anchors = new Map<number, { x: number; y: number }>();
    displayAnalets.forEach(analet => {
      anchors.set(analet.id, { x: analet.location?.x || 0, y: analet.location?.y || 0 });
    });
    return anchors;
  }, [displayAnalets]);

  // CLEANED UP - removed unused clusterAnchors

  // Filter visible labels based on proximity
  const visibleLabels = React.useMemo(() => {
    return filterLabelsByProximity(labelPositions, analetAnchors, 40);
  }, [labelPositions, analetAnchors]);
  */

  // Bearings are not rendered on the analysis map; keep analysis map analet-only

  // CLEANED UP - removed unused visibleClusterLabels


  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  // Drag and drop functionality
  const {
    dragState,
    dragRef,
    startDrag,
    handleMouseMove: handleMouseMoveOriginal,
    endDrag: endDragOriginal,
    cancelDrag: cancelDragOriginal
  } = useAnaletDrag({
    constraintService,
    onDragStart: (analet) => {
      // Track drag start
      trackDragStart('analet_drag', { x: 0, y: 0 }, {
        analetId: analet.id,
        analetType: analet.type
      });

      // Hide tooltip during drag
      setHoveredAnalet(null);
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    },
    onDragEnd: (analet, newPosition) => {
      // Track drag end
      trackDragEnd('analet_drag', analet.fixedPosition || { x: 0, y: 0 }, newPosition, {
        analetId: analet.id,
        analetType: analet.type
      });

      props.onAnaletDragEnd?.(analet, newPosition);

      // Always persist exact drop position as a manual placement (even in grid mode)
      try {
        import('../../services/AnaletStateService').then(({ AnaletStateService }) => {
          const analetState = AnaletStateService.getInstance();
          const updated = { ...analet, isFixed: true, fixedPosition: { x: newPosition.x, y: newPosition.y }, constraintStrength: 1.0 };
          analetState.updateAnalet(updated);
          window.dispatchEvent(new CustomEvent('analetsUpdated'));
        });
      } catch { }

      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    },
    momentumFactor: 2.0// Higher momentum to prevent jarring changes
  });

  // Local manual positions to avoid post-drop snap before global state updates
  const [localManualPositions, setLocalManualPositions] = React.useState<Map<number, { x: number; y: number }>>(() => new Map());

  // Prune local manual positions when analets carry fixed positions in global state
  React.useEffect(() => {
    if (!displayAnalets || displayAnalets.length === 0) return;
    setLocalManualPositions(prev => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const a of displayAnalets) {
        if (a && (a.isFixed || a.fixedPosition)) {
          next.delete(a.id);
        }
      }
      // Return same ref if unchanged to avoid extra renders
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [displayAnalets]);

  // Custom drag handling
  const handleDragMove = useCallback((event: React.MouseEvent) => {
    // Call original drag handler
    handleMouseMoveOriginal(event);
  }, [handleMouseMoveOriginal]);

  // Wrap drag handlers
  const endDrag = useCallback((event: React.MouseEvent) => {
    // Capture final position from hook before it resets
    if (dragState.isDragging && dragState.draggedAnalet && dragRef.current) {
      const svgEl = dragRef.current;
      const pt = svgEl.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const ctm = svgEl.getScreenCTM();
      if (ctm) {
        const svgPos = pt.matrixTransform(ctm.inverse());
        const finalPos = {
          x: svgPos.x - dragState.dragOffset.x,
          y: svgPos.y - dragState.dragOffset.y
        };
        setLocalManualPositions(prev => {
          const next = new Map(prev);
          next.set(dragState.draggedAnalet!.id, finalPos);
          return next;
        });
      }
    }
    endDragOriginal(event);
  }, [endDragOriginal, dragState, dragRef]);

  const cancelDrag = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    cancelDragOriginal();
  }, [cancelDragOriginal]);

  // Compute the position used for rendering an analet, mirroring the render logic
  const getAnaletRenderPosition = useCallback((analet: Analet): { x: number; y: number } => {
    const id = analet.id;
    const localOverride = localManualPositions.get(id);
    if (localOverride) {
      return { x: localOverride.x, y: localOverride.y };
    }

    const hasManualPlacement = !!(analet.isFixed || analet.fixedPosition);
    const isBeingDragged = !!(dragState.isDragging && dragState.draggedAnalet?.id === id);
    const manualX = analet.fixedPosition?.x ?? analet.location?.x ?? 0;
    const manualY = analet.fixedPosition?.y ?? analet.location?.y ?? 0;
    const gridPos = gridLayoutEnabled && !hasManualPlacement && !isBeingDragged && !localOverride ? gridPositions.get(id) : null;
    const x = gridPos?.x ?? manualX;
    const y = gridPos?.y ?? manualY;
    return { x, y };
  }, [localManualPositions, dragState.isDragging, dragState.draggedAnalet, gridLayoutEnabled, gridPositions]);

  const handleAnaletClick = useCallback((analet: Analet, event: React.MouseEvent) => {
    // Don't handle click if we're dragging
    if (dragState.isDragging) {
      return;
    }

    // Track the click
    trackClick('analet_click', {
      analetId: analet.id,
      analetType: analet.type,
      isMultiSelect: event.metaKey || event.ctrlKey || event.shiftKey,
      isMaterialized: visibility.isMaterialized(analet.id),
      position: { x: event.clientX, y: event.clientY }
    });

    // Materialize analet on first click
    if (!visibility.isMaterialized(analet.id)) {
      visibility.materializeAnalet(analet.id);
    }

    // Handle shared selection
    // Treat Shift like multi-select (add/toggle), not range-select
    const isMultiSelect = event.metaKey || event.ctrlKey || event.shiftKey; // Cmd/Ctrl/Shift + click
    const isRangeSelect = false; // Disable range-select on map clicks

    if (props.sharedSelection) {
      props.sharedSelection.selectAnalet(analet.id, isMultiSelect, isRangeSelect, props.projectedAnalets);
    }

    // Only open notebook for single clicks (not multi-select)
    // This ensures consistent behavior with the AnaletFolderList component
    if (!isMultiSelect) {
      // Use unified API - backend will handle create vs open logic automatically
      sendMessage('create-or-open-cell', {
        analetId: analet.id
      });
    }

    if (props.onAnaletClick) {
      props.onAnaletClick(analet);
    }

    // Ensure this analet's label becomes visible on analet click
    setVisibleLabelIds(prev => {
      const next = new Set(prev);
      next.add(analet.id);
      return next;
    });
  }, [sendMessage, props.onAnaletClick, props.sharedSelection, dragState.isDragging, visibility]);

  const handleAnaletHover = useCallback((analet: Analet, event: React.MouseEvent) => {
    // Don't show tooltip during drag
    if (dragState.isDragging) {
      return;
    }

    // Track hover start
    trackHoverStart('analet_hover', {
      analetId: analet.id,
      analetType: analet.type,
      isMaterialized: visibility.isMaterialized(analet.id)
    });

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const x = event.clientX - containerRect.left;
    const y = event.clientY - containerRect.top;

    // Cancel any pending hide to prevent stale timeouts from clearing the new hover
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    // Bump epoch to invalidate any previously scheduled hides
    analetHoverEpochRef.current += 1;
    setHoveredAnalet({ analet, x, y });
    try { props.sharedSelection?.setHoveredAnalet?.(analet.id); } catch { }
  }, [dragState.isDragging]);

  const handleAnaletLeave = useCallback(() => {
    // Track hover end
    trackHoverEnd();

    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Set a delayed hide timeout to allow moving to tooltip
    const scheduledEpoch = analetHoverEpochRef.current;
    hoverTimeoutRef.current = setTimeout(() => {
      // Only hide if no newer hover has occurred
      if (analetHoverEpochRef.current === scheduledEpoch) {
        setHoveredAnalet(null);
        try { props.sharedSelection?.setHoveredAnalet?.(undefined); } catch { }
      }
    }, 200); // small delay to allow quick transitions
  }, []);

  // Bearing hover handlers removed (no bearing markers on map)

  const handleTooltipEnter = useCallback(() => {
    // Cancel the hide timeout when entering tooltip
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const handleTooltipLeave = useCallback(() => {
    // Hide tooltip immediately when leaving it
    setHoveredAnalet(null);
  }, []);

  // CLEANED UP - removed unused isPointInViewport function


  const handleCondenseSelection = useCallback(() => {
    if (!props.sharedSelection || !constraintService) return;

    const selectedAnalets = props.sharedSelection.getSelectedAnalets(displayAnalets);
    if (selectedAnalets.length < 2) return;
    // Calculate centroid of selected analets
    const centroid = selectedAnalets.reduce(
      (acc, analet) => ({
        x: acc.x + (analet.location?.x || 0),
        y: acc.y + (analet.location?.y || 0)
      }),
      { x: 0, y: 0 }
    );
    centroid.x /= selectedAnalets.length;
    centroid.y /= selectedAnalets.length;

    // Create tight cluster around centroid
    const radius = 50; // Tight clustering radius
    const angleStep = (2 * Math.PI) / selectedAnalets.length;

    selectedAnalets.forEach((analet, index) => {
      const angle = index * angleStep;
      const x = centroid.x + Math.cos(angle) * radius;
      const y = centroid.y + Math.sin(angle) * radius;

      // Apply position constraint
      constraintService.setAnaletFixed(analet, { x, y }, 1.0);
    });

    setContextMenu(null);
  }, [props.sharedSelection, props.projectedAnalets, constraintService]);

  const handleGenerateAnaletsFromStatement = useCallback(async () => {
    if (!statementContextMenu) return;

    const statement = statementContextMenu.analet;
    setStatementContextMenu(null);

    try {
      // Request analet generation from the statement
      sendMessage('generate-analets-from-statement', {
        statementText: statement.statement,
        statementId: statement.id,
        statementLocation: statement.location
      });
    } catch (error) {
      console.error('❌ [AnalysisMap] Error generating analets from statement:', error);
    }
  }, [statementContextMenu, sendMessage]);

  // Analet context menu handlers
  const handleAnaletNodeRightClick = useCallback((event: React.MouseEvent, analet: Analet) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setAnaletContextMenu({ x, y, analet });
  }, []);

  const handleDeriveFromAnalet = useCallback(() => {
    if (!analetContextMenu) return;

    setDerivePromptDialog({ analet: analetContextMenu.analet });
    setAnaletContextMenu(null);
  }, [analetContextMenu]);

  const handlePerturbAnalet = useCallback(async () => {
    if (!analetContextMenu) return;

    const analet = analetContextMenu.analet;
    setAnaletContextMenu(null);

    try {
      sendMessage('perturb-analet', {
        analetId: analet.id,
        analetData: analet
      });
    } catch (error) {
      console.error('❌ [AnalysisMap] Error perturbing analet:', error);
    }
  }, [analetContextMenu, sendMessage]);

  const handleDeleteAnalet = useCallback(async () => {
    if (!analetContextMenu) return;

    const analet = analetContextMenu.analet;
    setAnaletContextMenu(null);

    try {
      sendMessage('delete-analet', {
        analetId: analet.id
      });
    } catch (error) {
      console.error('❌ [AnalysisMap] Error deleting analet:', error);
    }
  }, [analetContextMenu, sendMessage]);

  const handleAddNoteToAnalet = useCallback(() => {
    if (!analetContextMenu) return;

    const analet = analetContextMenu.analet;
    setAnaletContextMenu(null);

    // Notify parent component about note editing
    if (props.onNoteEditingChange) {
      props.onNoteEditingChange(true, analet, '');
    } else {
      // Fallback to local state if no callback provided
      setIsAddingNote(true);
    }
  }, [analetContextMenu, props.onNoteEditingChange]);

  // Handle right click on note
  const handleNoteRightClick = useCallback((note: any, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    setNoteContextMenu({
      x: event.clientX,
      y: event.clientY,
      note: note,
    });
  }, []);

  // Handle edit note
  const handleEditNote = useCallback(() => {
    if (!noteContextMenu) return;
    const note = noteContextMenu.note;
    setNoteContextMenu(null);

    // Convert SVG coordinates to viewport coordinates for the editor
    const svgElement = document.querySelector('svg');
    if (svgElement) {
      const svgRect = svgElement.getBoundingClientRect();
      const viewportPosition = {
        x: svgRect.left + note.position!.x,
        y: svgRect.top + note.position!.y,
      };

      setMapNoteEditor({
        isVisible: true,
        position: viewportPosition,
        note: note,
      });
    } else {
      // Fallback to note position if SVG not found
      setMapNoteEditor({
        isVisible: true,
        position: note.position!,
        note: note,
      });
    }
  }, [noteContextMenu]);

  // Handle delete note
  const handleDeleteNote = useCallback(async () => {
    if (!noteContextMenu) return;
    const note = noteContextMenu.note;
    setNoteContextMenu(null);

    try {
      await sendMessage('delete-analysis-note', { id: note.id });
    } catch (error) {
      console.error('❌ [AnalysisMap] Error deleting note:', error);
    }
  }, [noteContextMenu, sendMessage]);

  const handleGenerateRandomAnalets = useCallback(async () => {
    try {
      sendMessage('add-waypoint-analets', {
        count: 20
      });
    } catch (error) {
      console.error('❌ [AnalysisMap] Error generating random analets:', error);
    }
  }, [sendMessage]);

  const handleDerivePromptSubmit = useCallback(async () => {
    if (!derivePromptDialog || !derivePromptText.trim()) return;

    const analet = derivePromptDialog.analet;
    setDerivePromptDialog(null);
    setDerivePromptText('');

    try {
      sendMessage('derive-analet', {
        sourceAnaletId: analet.id,
        sourceAnaletData: analet,
        derivationPrompt: derivePromptText.trim()
      });
    } catch (error) {
      console.error('❌ [AnalysisMap] Error deriving analet:', error);
    }
  }, [derivePromptDialog, derivePromptText, sendMessage]);

  const handleDerivePromptCancel = useCallback(() => {
    setDerivePromptDialog(null);
    setDerivePromptText('');
  }, []);

  // Overlay panel callbacks
  const handleTrackingToggle = useCallback((enabled: boolean) => {
    try { localStorage.setItem('autoTrackEnabled', enabled ? '1' : '0'); } catch {}
    try { window.dispatchEvent(new CustomEvent('toggleAutoTrack', { detail: { enabled } })); } catch {}
    props.onTrackingToggle?.(enabled);
  }, [props.onTrackingToggle]);

  const handleEmbeddingCursorToggle = useCallback((enabled: boolean) => {
    setIsEmbeddingCursorEnabled(enabled);
    if (enabled && !umapInversion && displayAnalets.length > 0) {
      // Initialize UMAP inversion when cursor is first enabled
      // Use rendered positions (grid/manual) so inversion matches what's on screen
      const positionedAnalets = displayAnalets.map(a => {
        const pos = getAnaletRenderPosition(a);
        return { ...a, location: { x: pos.x, y: pos.y } } as typeof a;
      });
      const inversion = createUMAPInversion(positionedAnalets);
      setUmapInversion(inversion);
    }
  }, [umapInversion, displayAnalets, getAnaletRenderPosition]);


  // Embedding cursor callbacks
  const handleCursorMove = useCallback((x: number, y: number) => {
    setCursorPosition({ x, y });
    if (hullPoints.length >= 3) {
      setIsCursorOutsideHull(!isPointInPolygon({ x, y }, hullPoints));
    } else {
      setIsCursorOutsideHull(false);
    }
  }, [hullPoints]);

  const handleCursorDragEnd = useCallback(async (x: number, y: number) => {
    if (!umapInversion || !isEmbeddingCursorEnabled) return;

    // Update UMAP inversion with latest analet data
    // Use rendered positions (grid/manual) so cursor sampling aligns with grid in canvas mode
    const positionedAnalets = displayAnalets.map(a => {
      const pos = getAnaletRenderPosition(a);
      return { ...a, location: { x: pos.x, y: pos.y } } as typeof a;
    });
    umapInversion.updateAnalets(positionedAnalets);

    // Get embedding at this position
    const embedding = umapInversion.invertPosition(x, y);
    if (!embedding) {
      setCursorDescription('Cannot determine embedding at this position');
      return;
    }

    setIsCursorLoading(true);
    setCursorDescription(undefined);

    try {
      // Request description from backend
      const requestId = Math.random().toString(36);
      sendMessage('generate-embedding-description', {
        embedding,
        x,
        y,
        requestId
      });
    } catch (error) {
      console.error('❌ [AnalysisMap] Error requesting embedding description:', error);
      setIsCursorLoading(false);
      setCursorDescription('Error generating NN-based analet');
    }
  }, [umapInversion, isEmbeddingCursorEnabled, displayAnalets, sendMessage]);

  // Trigger initial description when cursor is first enabled
  useEffect(() => {
    if (isEmbeddingCursorEnabled && umapInversion) {
      // Small delay to ensure everything is initialized
      const timer = setTimeout(() => {
        handleCursorDragEnd(cursorPosition.x, cursorPosition.y);
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [isEmbeddingCursorEnabled, umapInversion, handleCursorDragEnd, cursorPosition.x, cursorPosition.y]);

  const handleGenerateAnaletAtCursor = useCallback(async () => {
    // Confirm-create flow: take the latest preview idea (if any) and request creation
    if (!isEmbeddingCursorEnabled) return;
    const x = cursorPosition.x;
    const y = cursorPosition.y;
    if (!cursorDescription || typeof cursorDescription !== 'string') return;
    // Try to detect an idea from the preview text (backend also returns idea directly now)
    const idea = (cursorIdeaRef.current || '').trim();
    const finalIdea = idea && idea.length > 0 ? idea : cursorDescription.replace(/^✅ Generated:\s*/, '').replace(/^"|"$/g, '').trim();
    if (!finalIdea) return;
    const requestId = Math.random().toString(36);
    sendMessage('create-analet-from-embedding', { idea: finalIdea, x, y, requestId });
  }, [isEmbeddingCursorEnabled, cursorPosition, cursorDescription, sendMessage]);

  // Track most recent idea and interpolated position from backend preview
  const cursorIdeaRef = React.useRef<string>('');
  const cursorInterpRef = React.useRef<{ x: number; y: number } | null>(null);

  // Listen for embedding NN preview responses
  useEffect(() => {
    const cleanup = onMessage('embedding-description-response', (data: any) => {
      setIsCursorLoading(false);

      if (data?.success) {
        cursorIdeaRef.current = (data.idea || '').trim();
        cursorInterpRef.current = (data.position && typeof data.position.x === 'number' && typeof data.position.y === 'number')
          ? { x: data.position.x, y: data.position.y }
          : null;
        // Show only the generated idea in tooltip
        setCursorDescription(cursorIdeaRef.current || '');
      } else {
        setCursorDescription('Error: ' + (data?.error || 'Failed to generate preview'));
      }
    });

    return cleanup;
  }, [onMessage, props.stateService]);

  // Centralized refresh handled by MessageService via 'refresh-analets'

  // Tracking mode: auto-focus on selected analets from other views
  useEffect(() => {
    if (!isTrackingEnabled || !props.sharedSelection || !transformRef.current) return;

    let lastSelectedAnaletId: number | null = null;

    const handleSelectionChange = () => {
      const selectedAnalets = props.sharedSelection?.getSelectedAnalets(displayAnalets);
      if (selectedAnalets && selectedAnalets.length === 1) {
        const selectedAnalet = selectedAnalets[0];

        // Only center if this is a different analet than the last one we centered on
        if (selectedAnalet.id !== lastSelectedAnaletId) {
          lastSelectedAnaletId = selectedAnalet.id;

          // Use the same position used for rendering to center correctly in any mode
          const { x, y } = getAnaletRenderPosition(selectedAnalet);

          // Center the transform on the selected analet using setTransform instead of centerView
          if (transformRef.current?.setTransform) {
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (containerRect) {
              const centerX = containerRect.width / 2;
              const centerY = containerRect.height / 2;
              const targetX = centerX - x * 0.8;
              const targetY = centerY - y * 0.8;
              transformRef.current.setTransform(targetX, targetY, 0.8, 300);
            }
          }
        }
      } else if (selectedAnalets && selectedAnalets.length === 0) {
        // Clear the last selected ID when nothing is selected
        lastSelectedAnaletId = null;
      }
    };

    // Listen for selection changes with a longer interval to allow manual panning/zooming
    // Only check every 500ms instead of 100ms to reduce interference with user interactions
    const checkInterval = setInterval(handleSelectionChange, 500);

    return () => clearInterval(checkInterval);
  }, [isTrackingEnabled, props.sharedSelection, displayAnalets, gridLayoutEnabled, gridPositions]);

  // Bearings are not managed on the map anymore; no centering logic needed

  // Close context menus on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
      setStatementContextMenu(null);
      setAnaletContextMenu(null);
      setNoteContextMenu(null);
    };
    if (contextMenu || statementContextMenu || analetContextMenu || noteContextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu, statementContextMenu, analetContextMenu, noteContextMenu]);

  // Selection brush functionality
  const handleBrushStart = useCallback((event: React.MouseEvent) => {
    // Only start brush if SHIFT is held and we're not already dragging
    if (!event.shiftKey || dragState.isDragging) return;

    event.preventDefault();
    event.stopPropagation();

    // Get SVG element to convert coordinates
    const svgElement = (event.target as Element).closest('svg');
    if (!svgElement) return;

    const rect = svgElement.getBoundingClientRect();
    const svgPoint = svgElement.createSVGPoint();
    svgPoint.x = event.clientX - rect.left;
    svgPoint.y = event.clientY - rect.top;
    const svgCoords = svgPoint.matrixTransform(svgElement.getScreenCTM()?.inverse());

    setSelectionBrush({
      startX: svgCoords.x,
      startY: svgCoords.y,
      currentX: svgCoords.x,
      currentY: svgCoords.y,
      isActive: true
    });

    // Disable panning during brush selection
    const transformWrapper = svgElement.closest('.react-transform-wrapper');
    if (transformWrapper) {
      (transformWrapper as any).setPanning(false);
    }
  }, [dragState.isDragging]);

  const handleBrushMove = useCallback((event: MouseEvent) => {
    if (!selectionBrush?.isActive) return;

    // Get SVG element to convert coordinates
    const svgElement = document.querySelector('svg');
    if (!svgElement) return;

    const rect = svgElement.getBoundingClientRect();
    const svgPoint = svgElement.createSVGPoint();
    svgPoint.x = event.clientX - rect.left;
    svgPoint.y = event.clientY - rect.top;
    const svgCoords = svgPoint.matrixTransform(svgElement.getScreenCTM()?.inverse());

    setSelectionBrush(prev => prev ? {
      ...prev,
      currentX: svgCoords.x,
      currentY: svgCoords.y
    } : null);
  }, [selectionBrush?.isActive]);

  const handleBrushEnd = useCallback(() => {
    if (!selectionBrush?.isActive || !props.sharedSelection) {
      setSelectionBrush(null);
      return;
    }

    // Calculate selection rectangle bounds
    const minX = Math.min(selectionBrush.startX, selectionBrush.currentX);
    const maxX = Math.max(selectionBrush.startX, selectionBrush.currentX);
    const minY = Math.min(selectionBrush.startY, selectionBrush.currentY);
    const maxY = Math.max(selectionBrush.startY, selectionBrush.currentY);

    // Find analets within the selection rectangle
    const selectedAnaletIds: number[] = [];
    displayAnalets.forEach(analet => {
      const x = analet.location?.x || 0;
      const y = analet.location?.y || 0;

      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        selectedAnaletIds.push(analet.id);
      }
    });

    // Update selection
    if (selectedAnaletIds.length > 0) {
      props.sharedSelection.clearSelection();
      selectedAnaletIds.forEach(analetId => {
        props.sharedSelection!.selectAnalet(analetId, true);
      });
    }

    setSelectionBrush(null);

    // Re-enable panning
    const svgElement = document.querySelector('svg');
    const transformWrapper = svgElement?.closest('.react-transform-wrapper');
    if (transformWrapper) {
      (transformWrapper as any).setPanning(true);
    }
  }, [selectionBrush, props.sharedSelection, props.projectedAnalets]);

  const r = 8;
      // how round the corner is
  // Initialize transform ready state with a small delay
  useEffect(() => {
    const timer = setTimeout(() => {
      if (transformRef.current && transformRef.current.instance?.transformState) {
        // CLEANED UP - removed setTransformReady call
      }
    }, 100); // Small delay to ensure TransformWrapper is ready

    return () => clearTimeout(timer);
  }, []);

  // Global mouse event listeners for brush selection
  useEffect(() => {
    if (selectionBrush?.isActive) {
      document.addEventListener('mousemove', handleBrushMove);
      document.addEventListener('mouseup', handleBrushEnd);
      return () => {
        document.removeEventListener('mousemove', handleBrushMove);
        document.removeEventListener('mouseup', handleBrushEnd);
      };
    }
  }, [selectionBrush?.isActive, handleBrushMove, handleBrushEnd]);

  return (
    <div
      ref={containerRef}
      style={{
        width: props.width || '100%',
        height: props.height || '100%',
        backgroundColor: '#1a1a1a',
        position: 'relative',
        flex: 1,
        minHeight: 0
      }}
    >
      {/* COMMENTED OUT - Active bearing UI hidden for now
      {isTrackingEnabled && (
        <MapMasthead
          onOpenBearingModal={() => setIsBearingModalOpen(true)}
        />)}
      */}

      {/* Focus Generation Loading Indicator */}
      {isFocusGenerating && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 1000,
            backgroundColor: 'var(--vscode-editor-background)',
            border: '1px solid var(--vscode-widget-border)',
            borderRadius: '8px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: 'var(--vscode-foreground)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
          }}
        >
          <div
            style={{
              width: '16px',
              height: '16px',
              border: '2px solid var(--vscode-button-background)',
              borderTop: '2px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}
          />
          Generating focus analets...
        </div>
      )}

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Temporary "Go to New Node" Button */}
      {newNodeButton && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid var(--vscode-button-border)',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '500',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
            userSelect: 'none',
            transition: 'all 0.2s ease'
          }}
          onClick={handleGoToNewNode}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--vscode-button-hoverBackground)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--vscode-button-background)';
          }}
          title="Click to navigate to your newly created analysis node"
        >
          → New Node
        </div>
      )}

      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.1}
        maxScale={10}
        centerOnInit={true}
        limitToBounds={false}
        panning={{ disabled: dragState.isDragging ? true : false }}
        wheel={{ disabled: false }}
        doubleClick={{ disabled: false }}
      >
        <TransformComponent
          wrapperStyle={{
            width: '100%',
            height: '100%'
          }}
          contentStyle={{
            width: '100%',
            height: '100%'
          }}
        >
          <svg
            ref={dragRef}
            width="100%"
            height="100%"
            style={{ overflow: 'visible' }}
            onMouseMove={handleDragMove}
            onMouseUp={endDrag}
            onMouseLeave={cancelDrag}
            onMouseDown={handleBrushStart}
            onContextMenu={(event) => {
              // Handle right-click - be less restrictive about target
              const target = event.target as Element;
              const svg = event.currentTarget as SVGSVGElement;

              // Check if clicked on background (svg itself or defs/style children, not analets)
              const isBackground = target === svg ||
                target.tagName === 'defs' ||
                target.tagName === 'style' ||
                target.closest('[data-analet-id]') === null;
              if (isBackground) {
                event.preventDefault();
                event.stopPropagation();
                const rect = svg.getBoundingClientRect();
                const mapX = event.clientX - rect.left;
                const mapY = event.clientY - rect.top;

                setEmptySpaceContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  mapPosition: { x: mapX, y: mapY },
                });
              }
            }}
          >
            <defs>
              <style>
                {`
                  @keyframes pulse {
                    0% {
                      stroke-opacity: 0.6;
                      r: 12px;
                    }
                    50% {
                      stroke-opacity: 0.3;
                      r: 16px;
                    }
                    100% {
                      stroke-opacity: 0.6;
                      r: 12px;
                    }
                  }
                `}
              </style>
              <pattern
                id="grid"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 20 0 L 0 0 0 20"
                  fill="none"
                  stroke="#333333"
                  strokeWidth="1"
                />
              </pattern>
            </defs>

            {/* Grid background */}
            <rect
              x="-10000"
              y="-10000"
              width="20000"
              height="20000"
              fill="url(#grid)"
              style={{ backgroundColor: '#1a1a1a' }}
            />

            {/* Convex Hull dashed overlay (only when embedding cursor is enabled) */}
            {isEmbeddingCursorEnabled && !gridLayoutEnabled && hullPoints.length >= 3 && (
              <polyline
                points={hullPoints.concat([hullPoints[0]]).map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#9ca3af"
                strokeWidth={1}
                strokeDasharray="6,4"
                opacity={0.6}
              />
            )}


            {/* Tight Bubble set visualization for selected analets OR active bearing members */}
            {(() => {
              let bubbleAnalets = [] as typeof displayAnalets;
              if (props.sharedSelection && props.sharedSelection.getSelectedCount() > 1) {
                bubbleAnalets = props.sharedSelection.getSelectedAnalets(displayAnalets);
              } else {
                // Fallback: active bearing
                const activeId = StateService.getInstance().getActiveBearingId();
                if (activeId != null) {
                  try {
                    const hs = HierarchyService.getInstance();
                    const edges = hs.getEdges();
                    const startId = `bearing-${activeId}`;
                    const visited = new Set<string>();
                    const queue: string[] = [startId];
                    const childMap = new Map<string, string[]>();
                    // Build adjacency for quick traversal
                    for (const e of edges) {
                      if (!childMap.has(e.parentId)) childMap.set(e.parentId, []);
                      childMap.get(e.parentId)!.push(e.childId);
                    }
                    const analetIds = new Set<number>();
                    while (queue.length > 0) {
                      const id = queue.shift()!;
                      if (visited.has(id)) continue;
                      visited.add(id);
                      const kids = childMap.get(id) || [];
                      for (const c of kids) {
                        if (c.startsWith('analet-')) {
                          const num = Number(c.replace('analet-', ''));
                          if (Number.isFinite(num)) analetIds.add(num);
                        } else {
                          queue.push(c);
                        }
                      }
                    }
                    if (analetIds.size > 1) {
                      const byId = new Map(displayAnalets.map(a => [a.id, a]));
                      bubbleAnalets = Array.from(analetIds).map(id => byId.get(id)).filter(Boolean) as typeof displayAnalets;
                    }
                  } catch {}
                }
              }
              if (bubbleAnalets.length <= 1) return null;

              // Calculate centroid for label positioning
              const points = bubbleAnalets.map(analet => ({
                x: analet.location?.x || 0,
                y: analet.location?.y || 0
              }));

              const centroid = points.reduce(
                (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
                { x: 0, y: 0 }
              );
              centroid.x /= points.length;
              centroid.y /= points.length;

              // Compute average UMAP distance between bubbleAnalets
              const pairwiseAvgDistance = (() => {
                let sum = 0;
                let count = 0;
                for (let i = 0; i < points.length; i++) {
                  for (let j = i + 1; j < points.length; j++) {
                    const dx = points[i].x - points[j].x;
                    const dy = points[i].y - points[j].y;
                    sum += Math.hypot(dx, dy);
                    count++;
                  }
                }
                return count > 0 ? sum / count : 0;
              })();

              // Map distance to color from blue (tight) to red (spread). Use red tint for active bearing groups.
              const mapDistanceToColor = (avg: number) => {
                const minD = 0;
                const maxD = 400; // heuristic
                const t = Math.min(1, Math.max(0, (avg - minD) / (maxD - minD)));
                const blue = { r: 0, g: 120, b: 212, a: 0.18 };
                const red = { r: 239, g: 68, b: 68, a: 0.18 };
                return {
                  r: Math.round(blue.r * (1 - t) + red.r * t),
                  g: Math.round(blue.g * (1 - t) + red.g * t),
                  b: Math.round(blue.b * (1 - t) + red.b * t),
                  a: blue.a * (1 - t) + red.a * t,
                };
              };
              const bubbleColor = mapDistanceToColor(pairwiseAvgDistance);

              // Find optimal label position to avoid overlap with selected nodes
              const findOptimalLabelPositionForSelected = () => {
                const nodeRadius = 8; // Max node size
                const labelPadding = 15; // Additional padding for label clearance
                const minDistance = nodeRadius + labelPadding;

                // Try positions: top, bottom, left, right, then diagonal positions
                const candidateOffsets = [
                  { x: 0, y: -minDistance }, // Top
                  { x: 0, y: minDistance },  // Bottom
                  { x: -minDistance, y: 0 }, // Left
                  { x: minDistance, y: 0 },  // Right
                  { x: -minDistance * 0.7, y: -minDistance * 0.7 }, // Top-left
                  { x: minDistance * 0.7, y: -minDistance * 0.7 },  // Top-right
                  { x: -minDistance * 0.7, y: minDistance * 0.7 },  // Bottom-left
                  { x: minDistance * 0.7, y: minDistance * 0.7 }    // Bottom-right
                ];

                for (const offset of candidateOffsets) {
                  const labelPos = { x: centroid.x + offset.x, y: centroid.y + offset.y };

                  // Check if this position is clear of all selected nodes
                  const isClear = points.every(point => {
                    const distance = Math.sqrt(
                      (labelPos.x - point.x) ** 2 + (labelPos.y - point.y) ** 2
                    );
                    return distance >= minDistance;
                  });

                  if (isClear) {
                    return labelPos;
                  }
                }

                // Fallback: use top position with extra padding
                return { x: centroid.x, y: centroid.y - (minDistance + 5) };
              };

              const selectedLabelPosition = findOptimalLabelPositionForSelected();

              return (
                <g>
                  {/* Tight Bubble Set for selected analets + bearings with dynamic color */}
                  <TightBubbleSet
                    analets={bubbleAnalets}
                    color={bubbleColor}
                    sigma={5}
                    threshold={0.01}
                  />

                  {/* Interactive overlay for right-click on selected bubble set */}
                  <g
                    style={{
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      // Show context menu for condensation
                      if (props.sharedSelection && props.sharedSelection.getSelectedCount() >= 2) {
                        const containerRect = containerRef.current?.getBoundingClientRect();
                        if (containerRect) {
                          const x = event.clientX - containerRect.left;
                          const y = event.clientY - containerRect.top;
                          setContextMenu({
                            x,
                            y,
                            selectedCount: props.sharedSelection.getSelectedCount()
                          });
                        }
                      }
                    }}
                  >
                    {/* Invisible interaction area covering the bubble set */}
                    {bubbleAnalets.map((analet) => (
                      <circle
                        key={`selected-${analet.id}`}
                        cx={analet.location?.x || 0}
                        cy={analet.location?.y || 0}
                        r={15}
                        fill="transparent"
                        stroke="none"
                      />
                    ))}
                  </g>

                  {/* Folder name and selection count label */}
                  {props.selectedFolderName ? (
                    <g>
                      <text
                        x={selectedLabelPosition.x}
                        y={selectedLabelPosition.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#0078D4"
                        fontSize="14"
                        fontWeight="bold"
                        style={{
                          textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                        }}
                      >
                        {props.selectedFolderName}
                      </text>
                      <text
                        x={selectedLabelPosition.x}
                        y={selectedLabelPosition.y + 15}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#0078D4"
                        fontSize="10"
                        opacity="0.8"
                        style={{
                          textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                        }}
                      >
                        {bubbleAnalets.length} items
                      </text>
                    </g>
                  ) : (
                    <text
                      x={selectedLabelPosition.x}
                      y={selectedLabelPosition.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#0078D4"
                      fontSize="12"
                      fontWeight="bold"
                      style={{
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                      }}
                    >
                      {bubbleAnalets.length} selected
                    </text>
                  )}
                </g>
              );
            })()}


            {/* Analets */}
            {displayAnalets.map((analet: Analet) => {
              // Prefer manual placement (fixedPosition/location) over grid; use grid only for initial placement
              const hasManualPlacement = !!(analet.isFixed || analet.fixedPosition);
              const isBeingDragged = !!(dragState.isDragging && dragState.draggedAnalet?.id === analet.id);
              const manualX = analet.fixedPosition?.x ?? analet.location?.x ?? 0;
              const manualY = analet.fixedPosition?.y ?? analet.location?.y ?? 0;
              const localOverride = localManualPositions.get(analet.id);
              const gridPos = gridLayoutEnabled && !hasManualPlacement && !isBeingDragged && !localOverride ? gridPositions.get(analet.id) : null;
              const x = localOverride?.x ?? (isBeingDragged ? (analet.location?.x ?? manualX) : (gridPos?.x ?? manualX));
              const y = localOverride?.y ?? (isBeingDragged ? (analet.location?.y ?? manualY) : (gridPos?.y ?? manualY));
              // Unified color scheme for all analets
              const baseColor = getAnaletNodeColor(false, false, analet);
              const isSelected = props.sharedSelection?.isAnaletSelected(analet.id) || false;
              const isHovered = hoveredAnalet?.analet.id === analet.id;
              const isHoveredFromFolder = props.sharedSelection?.getHoveredAnaletId?.() === analet.id;

              // Selected analets get a brighter version of their base color
              const fillColor = isSelected ? '#0078D4' : baseColor;
              const strokeColor = isSelected ? fillColor : '#e5e7eb';
              const strokeWidth = isSelected ? '3' : '2';

              const s = 0.35 * r; // tweak to taste (0.2–0.6 * r works well)
              // const c = Math.min(s * 0.6, 10);     // how round the corner is
            const clipId = `note-clip-${analet.id}`;
              // Generate unique labels for all analets (COMMENTED OUT - no longer needed with text annotations disabled)
              // const shortLabel = labelMap.get(analet.id) || `Analysis ${analet.id}`;

              // Focus mode active: do not alter opacity; leave selection/hover/materialization logic intact

              const connectedNotes = getConnectedNotes(analet.id);
              const hasNotes = connectedNotes.length > 0;

              return (
                <g key={analet.id}>

                  {/* Selection ring with pulse animation */}
                  {isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r={12}
                      fill="none"
                      stroke="#0078D4"
                      strokeWidth="2"
                      strokeOpacity="0.6"
                      style={{
                        animation: 'pulse 2s ease-in-out infinite'
                      }}
                    />
                  )}

                  {/* Hover ring from folder view */}
                  {isHoveredFromFolder && !isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r={10}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="2"
                      strokeOpacity="0.8"
                      style={{
                        animation: 'pulse 1.5s ease-in-out infinite'
                      }}
                    />
                  )}

                  {/* Main analet shape - unified circles for all analets with materialization opacity */}
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    style={{
                      cursor: FeatureFlags.FREEZE_ANALET_DRAG ? 'pointer' : (dragState.isDragging ? 'grabbing' : 'grab'),
                      transition: dragState.isDragging ? 'none' : 'all 0.2s ease',
                      filter: isHovered ? 'brightness(1.2)' : 'none',
                      opacity: (() => {
                        // Focus mode should not affect opacity; use existing materialization/selection logic only
                        const isMaterialized = visibility.isMaterialized(analet.id);
                        if (dragState.draggedAnalet?.id === analet.id) return 0.8; // Dragging
                        if (isSelected) return 1.0; // Selected
                        if (isHovered) return 0.9; // Hovered
                        if (isMaterialized) return 0.8; // Materialized
                        return 0.2; // Unmaterialized
                      })()
                    }}
                    onClick={(event) => handleAnaletClick(analet, event)}
                    onContextMenu={(event) => handleAnaletNodeRightClick(event, analet)}
                    onMouseDown={(event) => { if (!FeatureFlags.FREEZE_ANALET_DRAG) startDrag(analet, event, { initialX: x, initialY: y }); }}
                    onMouseEnter={(event) => handleAnaletHover(analet, event)}
                    onMouseLeave={handleAnaletLeave}
                  />

                                // const c = Math.min(s * 0.6, 10);     // how round the corner is
                  {/* Define a clipPath that exactly matches the circle */}
  <defs>
    <clipPath id={clipId}>
      <circle cx={x} cy={y} r={r+1} />
    </clipPath>
  </defs>

  {/* Gold extrusion: a rect that starts at the circle center and goes up/right beyond the circle.
      The clipPath makes the visible result = (rect ∩ circle). */}
  {hasNotes && (
  <rect
    x={x + 1}                    // shift right by 1px
    y={y - (r + s) - 1}          // shift up by 1px
    width={r + s}
    height={r + s}
    rx={2}                       // rounded corner radius
    ry={2}
    fill="#FFD700"
    clipPath={`url(#${clipId})`}
    pointerEvents="none"
  />
)}
                  {/* Note dots removed per latest design */}

                  {/* Short analet label with hover support - only show if within 30px */}
                  {/* COMMENTED OUT: Text annotation layer
                  {visibleLabels.has(analet.id) && (
                    <text
                      x={labelPositions.get(analet.id)?.x || x}
                      y={labelPositions.get(analet.id)?.y || y + 20}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#e5e7eb"
                      fontSize="9"
                      fontWeight="500"
                      opacity={(isHovered || isSelected) ? 0.9 : 0.4}
                      style={{
                        pointerEvents: 'auto',
                        transition: 'opacity 0.2s ease',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(event) => handleAnaletHover(analet, event)}
                      onMouseLeave={handleAnaletLeave}
                      onClick={(event) => handleAnaletClick(analet, event)}
                    >
                      {shortLabel}
                    </text>
                  )}
                  */}
                </g>
              );
            })}

            {/* Bearings removed from map */}

            {/* Empty state */}
            {displayAnalets.length === 0 && (() => {
              // Calculate viewport center in SVG coordinates to keep text centered during pan/zoom
              const container = containerRef.current;
              const containerRect = container?.getBoundingClientRect();
              const transform = transformRef.current?.instance?.transformState;

              let viewportCenterX = 0;
              let viewportCenterY = 0;
              if (containerRect && transform && typeof transform.scale === 'number') {
                const scale = transform.scale;
                const translateX = transform.positionX || 0;
                const translateY = transform.positionY || 0;

                // Calculate center of viewport in SVG coordinates
                viewportCenterX = (-translateX + containerRect.width / 2) / scale;
                viewportCenterY = (-translateY + containerRect.height / 2) / scale;
              }
              return (
                <g>
                  <text
                    x={viewportCenterX}
                    y={viewportCenterY - 10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#9ca3af"
                    fontSize="14"
                  >
                    {props.projectedAnalets.length > 0
                      ? 'No new analets'
                      : 'Add Analyses'
                    }
                  </text>
                  {props.projectedAnalets.length === 0 && (
                    <text
                      x={viewportCenterX}
                      y={viewportCenterY + 15}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="var(--vscode-textLink-foreground)"
                      fontSize="12"
                      style={{ cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => {
                        sendMessage('add-waypoint-analets', { count: 20 });
                      }}
                    >
                      Add Analyses
                    </text>
                  )}
                </g>
              );
            })()}

            {/* Selection brush rectangle */}
            {selectionBrush?.isActive && (
              <rect
                x={Math.min(selectionBrush.startX, selectionBrush.currentX)}
                y={Math.min(selectionBrush.startY, selectionBrush.currentY)}
                width={Math.abs(selectionBrush.currentX - selectionBrush.startX)}
                height={Math.abs(selectionBrush.currentY - selectionBrush.startY)}
                fill="rgba(0, 123, 255, 0.1)"
                stroke="rgba(0, 123, 255, 0.5)"
                strokeWidth="1"
                strokeDasharray="5,5"
                style={{

                  pointerEvents: 'none'
                }}
              />
            )}

            {/* Embedding Cursor */}
            <EmbeddingCursor
              x={cursorPosition.x}
              y={cursorPosition.y}
              isVisible={isEmbeddingCursorEnabled}
              isLoading={isCursorLoading}
              description={cursorDescription}
              onMove={handleCursorMove}
              onDragEnd={handleCursorDragEnd}
              onGenerateAnalet={handleGenerateAnaletAtCursor}
              persistentTooltip={isEmbeddingCursorEnabled}
              isOutsideHull={isCursorOutsideHull}
            />

            {/* Map note diamond markers (SVG layer) */}
            {mapNotes.map(note => {
              if (!note.position) return null;
              const pos = dragNotePositions.get(note.id) ?? note.position;
              const isVisible = visibleMapNoteIds.has(Number(note.id));
              return (
                <g
                  key={`map-note-marker-${note.id}`}
                  onClick={() => toggleMapNoteVisibility(note.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Rounded rect marker that follows drag; hides (opacity 0) when text is visible */}
                  <rect
                    x={pos.x - 5}
                    y={pos.y - 5}
                    width={10}
                    height={10}
                    rx={2}
                    ry={2}
                    fill="#FFD700"
                    stroke="#FFD700"
                    strokeWidth={0.75}
                    opacity={isVisible ? 0 : 1}
                  />
                </g>
              );
            })}

          </svg>

          {/* Analet shortname labels (HTML overlay inside transform to follow pan/zoom) */}
          {(() => {
            const base = displayAnalets.filter(a => visibleLabelIds.has(a.id)).map((analet) => {
              const hasManualPlacement = !!(analet.isFixed || analet.fixedPosition);
              const isBeingDragged = !!(dragState.isDragging && dragState.draggedAnalet?.id === analet.id);
              const manualX = analet.fixedPosition?.x ?? analet.location?.x ?? 0;
              const manualY = analet.fixedPosition?.y ?? analet.location?.y ?? 0;
              const localOverride = localManualPositions.get(analet.id);
              const gridPos = gridLayoutEnabled && !hasManualPlacement && !isBeingDragged && !localOverride ? gridPositions.get(analet.id) : null;
              const x = localOverride?.x ?? (isBeingDragged ? (analet.location?.x ?? manualX) : (gridPos?.x ?? manualX));
              const y = localOverride?.y ?? (isBeingDragged ? (analet.location?.y ?? manualY) : (gridPos?.y ?? manualY));
              const text = (analet.shortName && analet.shortName.trim().length > 0)
                ? analet.shortName
                : (analet.statement ? analet.statement : `Analet ${analet.id}`);
              const isSelected = !!props.sharedSelection?.isAnaletSelected(analet.id);
              return { id: analet.id, text, anchorX: x, anchorY: y - (r + 6), isSelected };
            });

            const placed = computeLabelLayout(base, {
              labelWidth: 75,
              lineHeight: 12,
              maxCharsPerLine: 12,
              nodeRadius: r,
              minGap: 2,
              maxGap: 20
            });

            return (
              <LabelLayer
                labels={placed.map(p => ({ id: p.id, text: p.text, x: p.x, y: p.y, isSelected: p.isSelected }))}
                onLabelClick={(id, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  // Clicking a label hides it (remove from visible set)
                  setVisibleLabelIds(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                }}
                // Label hover should highlight the analet (without tooltip)
                onLabelHoverIn={(id) => {
                  try { props.sharedSelection?.setHoveredAnalet?.(id); } catch {}
                }}
                onLabelHoverOut={() => {
                  try { props.sharedSelection?.setHoveredAnalet?.(undefined); } catch {}
                }}
                onLabelContextMenu={(id, event) => {
                  const analet = displayAnalets.find(a => a.id === id);
                  if (analet) {
                    handleAnaletNodeRightClick(event, analet);
                  }
                }}
              />
            );
          })()}

          {/* Map Notes - outside SVG since they use HTML elements */}
          <MapNotes
            notes={mapNotes
              .filter(n => visibleMapNoteIds.has(n.id))
              .map(n => ({
                ...n,
                position: dragNotePositions.get(n.id) ?? n.position
              }))}
            selectedNoteId={selectedNoteId}
            scale={transformRef.current?.instance?.transformState?.scale || 1}
            onNoteClick={(note) => {
              // Clicking the text toggles it off and re-shows the diamond
              toggleMapNoteVisibility(note.id);
            }}
            onNoteDoubleClick={(note) => {
              // Convert SVG coordinates to viewport coordinates for the editor
              const svgElement = document.querySelector('svg');
              if (svgElement) {
                const svgRect = svgElement.getBoundingClientRect();
                const viewportPosition = {
                  x: svgRect.left + note.position!.x,
                  y: svgRect.top + note.position!.y,
                };

                setMapNoteEditor({
                  isVisible: true,
                  position: viewportPosition,
                  note: note,
                });
              } else {
                // Fallback to note position if SVG not found
                setMapNoteEditor({
                  isVisible: true,
                  position: note.position!,
                  note: note,
                });
              }
            }}
            onNoteRightClick={handleNoteRightClick}
            onNoteDragStart={(note) => {
              setDragNotePositions(prev => new Map(prev).set(note.id, note.position!));
            }}
            onNoteDragMove={(note, position) => {
              setDragNotePositions(prev => new Map(prev).set(note.id, position));
            }}
            onNoteDragEnd={(note, position) => {
              moveMapNote(note.id, position);
              // Keep optimistic position until state syncs back from backend
              setDragNotePositions(prev => new Map(prev).set(note.id, position));
            }}
          />
        </TransformComponent>
      </TransformWrapper>


      {/* Analet Tooltip */}
      {hoveredAnalet && (
        <Tooltip
          analet={hoveredAnalet.analet}
          x={hoveredAnalet.x}
          y={hoveredAnalet.y}
          notes={getConnectedNotes(hoveredAnalet.analet.id)}
          onMouseEnter={handleTooltipEnter}
          onMouseLeave={handleTooltipLeave}
          onNoteEdit={(note) => {
            if (props.onNoteEditingChange && note) {
              const existingContent = note.content || '';
              props.onNoteEditingChange(true, hoveredAnalet.analet, existingContent);
            }
          }}
        />
      )}


      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: 'var(--vscode-menu-background)',
            border: '1px solid var(--vscode-menu-border)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            zIndex: 1000,
            minWidth: '120px'
          }}
        >
          <div
            className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer"
            onClick={handleCondenseSelection}
          >
            Condense ({contextMenu.selectedCount})
          </div>
        </div>
      )}


      {/* Overlay Panel */}
      <MapOverlayPanel
        isTrackingEnabled={isTrackingEnabled}
        isEmbeddingCursorEnabled={isEmbeddingCursorEnabled}
        onTrackingToggle={handleTrackingToggle}
        onEmbeddingCursorToggle={handleEmbeddingCursorToggle}
        onGenerateRandomAnalets={() => {
          const activeId = StateService.getInstance().getActiveBearingId();
          if (activeId != null) {
            try {
              setIsFocusGenerating(true);
              // Include bearingStatement from the bearing's statement (not name)
              const activeBearing = StateService.getInstance().getActiveBearing?.();
              const bearingStatement = activeBearing?.statement ? String(activeBearing.statement) : undefined;
              sendMessage('add-waypoint-analets-for-bearing', { count: 5, bearingId: activeId, ...(bearingStatement ? { bearingStatement } : {}) });
            } catch (e) {
              console.error('❌ [AnalysisMap] Failed focus-aware generation:', e);
              setIsFocusGenerating(false);
            }
          } else {
            handleGenerateRandomAnalets();
          }
        }}
      />

      {/* COMMENTED OUT - Bearing modal hidden for now
      <BearingModal isOpen={isBearingModalOpen} onClose={() => { setIsBearingModalOpen(false); setIsEditBearingMode(null); }} initialBearingId={isEditBearingMode ?? undefined} />
      */}

      {/* Statement Context Menu */}
      {statementContextMenu && (
        <>
          {void 0}
          <div
            style={{
              position: 'absolute',
              left: statementContextMenu.x,
              top: statementContextMenu.y,
              backgroundColor: 'var(--vscode-menu-background)',
              border: '1px solid var(--vscode-menu-border)',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
              zIndex: 1000,
              minWidth: '180px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer"
              onClick={handleGenerateAnaletsFromStatement}
            >
              🔬 Generate Analets from Statement
            </div>
          </div>
        </>
      )}

      {/* Analet Context Menu */}
      {analetContextMenu && (
        <div
          style={{
            position: 'absolute',
            left: analetContextMenu.x,
            top: analetContextMenu.y,
            backgroundColor: 'var(--vscode-menu-background)',
            border: '1px solid var(--vscode-menu-border)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            zIndex: 1000,
            minWidth: '160px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer border-b border-[var(--vscode-menu-separatorBackground)]"
            onClick={handleAddNoteToAnalet}
          >
            📝 Add Note
          </div>
          <div
            className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer border-b border-[var(--vscode-menu-separatorBackground)]"
            onClick={handleDeriveFromAnalet}
          >
            🔬 Derive from
          </div>
          <div
            className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer border-b border-[var(--vscode-menu-separatorBackground)]"
            onClick={handlePerturbAnalet}
          >
            🎲 Perturb (4 variants)
          </div>
          <div
            className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer text-[var(--vscode-errorForeground)]"
            onClick={handleDeleteAnalet}
          >
            🗑️ Delete
          </div>
        </div>
      )}

      {/* Note Context Menu */}
      {noteContextMenu && (
        <div
          style={{
            position: 'absolute',
            left: noteContextMenu.x,
            top: noteContextMenu.y,
            backgroundColor: 'var(--vscode-menu-background)',
            border: '1px solid var(--vscode-menu-border)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            zIndex: 1000,
            minWidth: '120px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer border-b border-[var(--vscode-menu-separatorBackground)]"
            onClick={handleEditNote}
          >
            ✏️ Edit Note
          </div>
          <div
            className="px-3 py-2 text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] cursor-pointer text-[var(--vscode-errorForeground)]"
            onClick={handleDeleteNote}
          >
            🗑️ Delete Note
          </div>
        </div>
      )}

      {/* Derive Prompt Dialog */}
      {derivePromptDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={handleDerivePromptCancel}
        >
          <div
            style={{
              backgroundColor: 'var(--vscode-editor-background)',
              border: '1px solid var(--vscode-widget-border)',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-[var(--vscode-foreground)] mb-4">
              🔬 Derive from Analet
            </h3>
            <div className="text-sm text-[var(--vscode-descriptionForeground)] mb-4">
              Source: <span className="text-[var(--vscode-foreground)]">{derivePromptDialog.analet.statement}</span>
            </div>
            <textarea
              value={derivePromptText}
              onChange={(e) => setDerivePromptText(e.target.value)}
              placeholder="Describe how you want to modify this analet..."
              className="w-full h-24 bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded p-3 text-[var(--vscode-input-foreground)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={handleDerivePromptCancel}
                className="px-4 py-2 text-sm bg-[var(--vscode-button-background)] text-[var(--vscode-button-secondaryForeground)] rounded hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
              >
                Cancel
              </button>
              <button
                onClick={handleDerivePromptSubmit}
                disabled={!derivePromptText.trim()}
                className="px-4 py-2 text-sm bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Derive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Yellow "Add Note" text at bottom when analet is selected */}
      {props.sharedSelection && props.sharedSelection.getSelectedCount() === 1 && !isAddingNote && props.onNoteEditingChange && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 215, 0, 0.9)',
            color: '#000',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
            fontWeight: '500',
            cursor: 'pointer',
            userSelect: 'none',
            zIndex: 1000,
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
          }}
          onClick={() => {
            const selectedAnaletIds = Array.from(props.sharedSelection!.selectionState.selectedAnaletIds);
            if (selectedAnaletIds.length === 1) {
              const analet = displayAnalets.find(a => a.id === selectedAnaletIds[0]);
              if (analet) {
                if (props.onNoteEditingChange) {
                  props.onNoteEditingChange(true, analet, '');
                } else {
                  // Fallback to local state
                  setIsAddingNote(true);
                }
              }
            }
          }}
        >
          📝 Add Note
        </div>
      )}


      {/* Toast notification for cells with no analet */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--vscode-notifications-background)',
            color: 'var(--vscode-notifications-foreground)',
            border: '1px solid var(--vscode-notifications-border)',
            borderRadius: '4px',
            padding: '12px 16px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 9999,
            fontSize: '14px',
            fontWeight: '500',
            transition: 'opacity 300ms ease-in-out',
            opacity: toastVisible ? 1 : 0,
            pointerEvents: 'none',
            maxWidth: '300px',
            textAlign: 'center'
          }}
        >
          📝 {toastMessage}
        </div>
      )}

      {/* Empty space context menu */}
      {emptySpaceContextMenu && (() => {
        return (
          <div
            className="fixed z-50 bg-[var(--vscode-menu-background)] border border-[var(--vscode-menu-border)] rounded-md shadow-lg py-1 min-w-[120px]"
            style={{
              left: emptySpaceContextMenu.x,
              top: emptySpaceContextMenu.y,
            }}
            onMouseLeave={() => {
              setEmptySpaceContextMenu(null);
            }}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)]"
              onClick={() => {
                setEmptySpaceContextMenu(null);

                // Convert SVG coordinates to viewport coordinates for the editor
                const svgElement = document.querySelector('svg');
                if (svgElement) {
                  const svgRect = svgElement.getBoundingClientRect();
                  const viewportPosition = {
                    x: svgRect.left + emptySpaceContextMenu.mapPosition.x,
                    y: svgRect.top + emptySpaceContextMenu.mapPosition.y,
                  };
                  setMapNoteEditor({
                    isVisible: true,
                    position: viewportPosition,
                  });
                } else {
                  // Fallback to map position if SVG not found
                  setMapNoteEditor({
                    isVisible: true,
                    position: emptySpaceContextMenu.mapPosition,
                  });
                }
              }}
            >
              📝 Add Note
            </button>
          </div>
        );
      })()}

      {/* Map note editor */}
      <MapNoteEditor
        isVisible={mapNoteEditor.isVisible}
        position={mapNoteEditor.position}
        note={mapNoteEditor.note}
        onSave={async (note) => {
          if (mapNoteEditor.note) {
            // Update existing note - handled by MapNoteEditor internally
          } else {
            await createMapNote(note.content, note.position!);
          }
          setMapNoteEditor({ isVisible: false, position: { x: 0, y: 0 } });
        }}
        onCancel={() => {
          setMapNoteEditor({ isVisible: false, position: { x: 0, y: 0 } });
        }}
      />
    </div>
  );
};
