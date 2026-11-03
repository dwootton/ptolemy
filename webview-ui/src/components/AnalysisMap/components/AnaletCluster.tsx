import React from "react";
import { Analet } from "../../../types/analet";
import { AnaletNode } from "./AnaletNode";
import { DragState } from "../hooks/useAnaletPositioning";

export interface AnaletClusterProps {
  analets: Analet[];
  selectedAnalets?: Analet[];
  hoveredAnalet?: Analet | null;
  loadingAnalets?: number[];
  recentlyCreatedAnalets?: number[];
  dragState: DragState;
  getAnaletPosition: (analet: Analet) => { x: number; y: number };
  onAnaletOpen?: (analet: Analet) => void;
  onAnaletHover?: (analet: Analet | null) => void;
  onDragStart?: (analet: Analet, startPos: { x: number; y: number }) => void;
  onDragMove?: (position: { x: number; y: number }) => void;
  onDragEnd?: () => void;
  onAnaletRightClick?: (analet: Analet, event: React.MouseEvent) => void;
}

export const AnaletCluster: React.FC<AnaletClusterProps> = (props) => {
  return (
    <g>
      {props.analets.map((analet) => {
        const position = props.getAnaletPosition(analet);
        const isDragged = props.dragState.draggedAnalet?.id === analet.id;
        
        return (
          <AnaletNode
            key={analet.id}
            analet={analet}
            position={position}
            isSelected={props.selectedAnalets?.some(selected => selected.id === analet.id) || false}
            isHovered={props.hoveredAnalet?.id === analet.id}
            isLoading={props.loadingAnalets?.includes(analet.id) || false}
            wasRecentlyCreated={props.recentlyCreatedAnalets?.includes(analet.id) || false}
            isDragging={isDragged}
            globalDragState={props.dragState}
            onClick={props.onAnaletOpen}
            onHover={props.onAnaletHover}
            onDragStart={props.onDragStart}
            onDragMove={props.onDragMove}
            onDragEnd={props.onDragEnd}
            onRightClick={props.onAnaletRightClick}
          />
        );
      })}
    </g>
  );
}; 