import React from "react";
import { Analet } from "../../../types/analet";
import { AnaletCluster } from "./AnaletCluster";
import { MapEmptyState } from "./MapEmptyState";
import { DragState } from "../hooks/useAnaletPositioning";

export interface MapContentProps {
  analets: Analet[];
  hoveredAnalet?: Analet | null;
  loadingAnalets?: number[];
  recentlyCreatedAnalets?: number[];
  dragState: DragState;
  getAnaletPosition: (analet: Analet) => { x: number; y: number };
  transform: { x: number; y: number; scale: number };
  mapWidth: number;
  mapHeight: number;
  isLoading?: boolean;
  onAnaletOpen?: (analet: Analet) => void;
  onAnaletHover?: (analet: Analet | null) => void;
  onDragStart?: (analet: Analet, startPos: { x: number; y: number }) => void;
  onDragMove?: (position: { x: number; y: number }) => void;
  onDragEnd?: () => void;
  onAnaletRightClick?: (analet: Analet, event: React.MouseEvent) => void;
  onGenerateAnalets?: () => void;
}

export const MapContent: React.FC<MapContentProps> = (props) => {
  // Debug conditions that determine what gets rendered
  const shouldShowEmptyState = !props.isLoading && props.analets.length === 0;
  const shouldShowAnalets = props.analets.length > 0;


  return (
    <g transform={`translate(${props.transform.x}, ${props.transform.y}) scale(${props.transform.scale})`}>
      {/* Empty state message */}
      {shouldShowEmptyState && (
        <MapEmptyState
          width={props.mapWidth}
          height={props.mapHeight}
          onGenerateAnalets={props.onGenerateAnalets}
        />
      )}

      {/* Render analet nodes using projected analets directly */}
      {shouldShowAnalets && (
        <AnaletCluster
          analets={props.analets}
          hoveredAnalet={props.hoveredAnalet}
          loadingAnalets={props.loadingAnalets}
          recentlyCreatedAnalets={props.recentlyCreatedAnalets}
          dragState={props.dragState}
          getAnaletPosition={props.getAnaletPosition}
          onAnaletOpen={props.onAnaletOpen}
          onAnaletHover={props.onAnaletHover}
          onDragStart={props.onDragStart}
          onDragMove={props.onDragMove}
          onDragEnd={props.onDragEnd}
          onAnaletRightClick={props.onAnaletRightClick}
        />
      )}
    </g>
  );
};
