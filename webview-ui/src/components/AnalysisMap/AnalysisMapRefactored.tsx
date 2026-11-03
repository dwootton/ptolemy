import React, { useEffect, useCallback } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Analet } from "../../types/analet";
import { ConstraintService } from "../../services/ConstraintService";
// import { useAnaletDrag } from "./hooks/useAnaletDrag";
// import { Tooltip } from "./Tooltip"; // Commented out for now
import { MapOverlayPanel } from "./components/MapOverlayPanel";
import { EmbeddingCursor } from "./components/EmbeddingCursor";
import { MapNoteEditor } from "./components/MapNoteEditor";
import { MapNotes } from "./components/MapNotes";
import { useMapNotes } from "./hooks/useMapNotes";
import { createUMAPInversion } from "../../utilities/umapInversion";

// Extracted components and hooks
import { useMapState } from "./hooks/useMapState";
import { useMapInteractions, SharedSelection } from "./hooks/useMapInteractions";
import { MapContextMenus } from "./components/MapContextMenus";
import { SelectionBrush } from "./components/SelectionBrush";
import { MapToast } from "./components/MapToast";
import { NewNodeButton } from "./components/NewNodeButton";
import { AnaletNodes } from "./components/AnaletNodes";
import { filterAnaletsByDistance } from "./utils/mapMath";

// CSS for animations
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

// Inject CSS
if (typeof document !== 'undefined' && !document.getElementById('analet-map-styles')) {
  const style = document.createElement('style');
  style.id = 'analet-map-styles';
  style.textContent = pulseCss;
  document.head.appendChild(style);
}

interface AnalysisMapProps {
  projectedAnalets: Analet[];
  sharedSelection: SharedSelection;
  constraintService?: ConstraintService;
  onAnaletPositionChange?: (analet: Analet, newPosition: { x: number; y: number }) => void;
  className?: string;
}

export function AnalysisMapRefactored({
  projectedAnalets,
  sharedSelection,
  constraintService,
  // onAnaletPositionChange, // Unused for now
  className = "",
}: AnalysisMapProps) {
  
  // Map state management
  const mapState = useMapState();
  const { 
    mapNotes, 
    selectedNoteId, 
    setSelectedNoteId, 
    createMapNote, 
    moveMapNote 
  } = useMapNotes();

  // Debug log mapNotes changes
  React.useEffect(() => {
  }, [mapNotes]);

  // Map interactions
  const mapInteractions = useMapInteractions({
    projectedAnalets,
    sharedSelection,
    constraintService,
    mapState,
  });

  // Drag functionality can be added later
  // const { dragState } = useAnaletDrag();

  // Initialize UMAP inversion when needed
  useEffect(() => {
    if (projectedAnalets.length > 0 && !mapState.umapInversion) {
      const inversion = createUMAPInversion(projectedAnalets);
      mapState.setUmapInversion(inversion);
    }
  }, [projectedAnalets, mapState]);

  // Handle hovering
  const handleAnaletHover = useCallback((analet: Analet | null) => {
    if (mapState.hoverTimerRef.current) {
      clearTimeout(mapState.hoverTimerRef.current);
    }

    if (analet) {
      const timer = setTimeout(() => {
        // Set hovered analet in shared selection
        // Note: This would need to be handled through a proper state update function
      }, 100);
      mapState.setHoverTimer(timer);
    }
  }, [mapState]);

  // Handle new node button dismiss
  const handleDismissNewNode = useCallback(() => {
    mapState.setNewNodeButton(null);
    if (mapState.newNodeTimer) {
      clearTimeout(mapState.newNodeTimer);
      mapState.setNewNodeTimer(null);
    }
  }, [mapState]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[var(--vscode-editor-background)] ${className}`}>
      {/* Main map container */}
      <TransformWrapper
        ref={mapState.transformRef}
        initialScale={1}
        minScale={0.1}
        maxScale={5}
        centerOnInit={false}
        limitToBounds={false}
        panning={{ velocityDisabled: true }}
      >
        <TransformComponent
          wrapperClass="w-full h-full"
          contentClass="w-full h-full"
        >
          <div
            ref={mapState.containerRef}
            className="w-full h-full relative cursor-crosshair"
            onClick={mapInteractions.handleMapClick}
            onDoubleClick={mapInteractions.handleMapDoubleClick}
            onMouseDown={mapInteractions.handleMouseDown}
            onMouseMove={mapInteractions.handleMouseMove}
            onMouseUp={mapInteractions.handleMouseUp}
            onContextMenu={mapInteractions.handleMapRightClick}
            style={{ minWidth: '2000px', minHeight: '1500px' }}
          >
            {/* Analet nodes */}
            <AnaletNodes
              projectedAnalets={projectedAnalets}
              sharedSelection={sharedSelection}
              onAnaletClick={mapInteractions.handleAnaletClick}
              onAnaletDoubleClick={mapInteractions.handleAnaletDoubleClick}
              onAnaletRightClick={mapInteractions.handleAnaletRightClick}
              onAnaletHover={handleAnaletHover}
              filterAnaletsByDistance={filterAnaletsByDistance}
            />

            {/* Selection brush */}
            <SelectionBrush selectionBrush={mapState.selectionBrush} />

            {/* Embedding cursor */}
            <EmbeddingCursor
              x={mapState.cursorState.position.x}
              y={mapState.cursorState.position.y}
              isVisible={true}
              description={mapState.cursorState.description}
              isLoading={mapState.cursorState.isLoading}
              onMove={(x, y) => mapState.setCursorPosition({ x, y })}
              onDragEnd={(x, y) => mapState.setCursorPosition({ x, y })}
              onGenerateAnalet={() => void 0}
            />

            {/* Map notes */}
            <MapNotes
              notes={mapNotes}
              selectedNoteId={selectedNoteId}
              onNoteClick={(note) => setSelectedNoteId(note.id)}
              onNoteDoubleClick={(note) => {
                // Start editing the note
                mapState.setMapNoteEditor({
                  isVisible: true,
                  position: note.position!,
                  note: note,
                });
              }}
              onNoteDragEnd={(note, position) => {
                moveMapNote(note.id, position);
              }}
            />
          </div>
        </TransformComponent>
      </TransformWrapper>

      {/* Context menus */}
      <MapContextMenus
        contextMenu={mapState.contextMenu}
        statementContextMenu={mapState.statementContextMenu}
        emptySpaceContextMenu={mapState.emptySpaceContextMenu}
        onTightCluster={mapInteractions.handleTightCluster}
        onGenerateFromStatement={mapInteractions.handleGenerateAnaletsFromStatement}
        onAddNote={mapInteractions.handleAddNote}
        onAddNoteToAnalet={mapInteractions.handleAddNoteToAnalet}
        onAddNoteToMap={mapInteractions.handleAddNoteToMap}
        onCloseContextMenu={() => mapState.setContextMenu(null)}
        onCloseStatementMenu={() => mapState.setStatementContextMenu(null)}
        onCloseEmptySpaceMenu={() => mapState.setEmptySpaceContextMenu(null)}
      />

      {/* Toast notification */}
      <MapToast
        toastState={mapState.toastState}
        onClose={mapState.hideToast}
      />

      {/* New node button */}
      <NewNodeButton
        newNodeButton={mapState.newNodeButton}
        onGoToNode={mapInteractions.handleGoToNewNode}
        onDismiss={handleDismissNewNode}
      />

      {/* Map overlay panel */}
      <MapOverlayPanel
        isTrackingEnabled={true}
        isEmbeddingCursorEnabled={true}
        onTrackingToggle={() => void 0}
        onEmbeddingCursorToggle={() => void 0}
        onGenerateRandomAnalets={() => mapState.setIsGeneratingRandomAnalets(true)}
      />

      {/* Map note editor */}
      <MapNoteEditor
        isVisible={mapState.mapNoteEditor.isVisible}
        position={mapState.mapNoteEditor.position}
        note={mapState.mapNoteEditor.note}
        onSave={async (note) => {
          if (mapState.mapNoteEditor.note) {
            // Update existing note - this will be handled by the MapNoteEditor internally
          } else {
            // Create new note
            await createMapNote(note.content, note.position!);
          }
          mapState.setMapNoteEditor({ isVisible: false, position: { x: 0, y: 0 } });
        }}
        onCancel={() => {
          mapState.setMapNoteEditor({ isVisible: false, position: { x: 0, y: 0 } });
        }}
      />

      {/* Tooltip - commented out for now, needs proper state management */}
      {/* <Tooltip analet={someAnalet} x={0} y={0} /> */}
    </div>
  );
}