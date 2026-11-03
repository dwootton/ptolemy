import React from "react";
import { Analet } from "../../../types/analet";
import { MapBackground } from "./MapBackground";
import { MapContent } from "./MapContent";
import { MapOverlay } from "./MapOverlay";
import { DragState } from "../hooks/useAnaletPositioning";

export interface MapCanvasProps {
  analets: Analet[];
  hoveredAnalet?: Analet | null;
  loadingAnalets?: number[];
  recentlyCreatedAnalets?: number[];
  dragState: DragState;
  getAnaletPosition: (analet: Analet) => { x: number; y: number };
  transform: { x: number; y: number; scale: number };
  panZoomHandlers: Record<string, (e: any) => void>;
  mapWidth: number;
  mapHeight: number;
  viewBox: string;
  isLoading?: boolean;
  loadingMessage?: string;
  onAnaletOpen?: (analet: Analet) => void;
  onAnaletHover?: (analet: Analet | null) => void;
  onDragStart?: (analet: Analet, startPos: { x: number; y: number }) => void;
  onDragMove?: (position: { x: number; y: number }) => void;
  onDragEnd?: () => void;
  onGenerateAnalets?: () => void;
}

export const MapCanvas: React.FC<MapCanvasProps> = (props) => {
  return (
    <div className="relative w-full h-full">
      {/* Loading overlay */}
      <MapOverlay 
        isLoading={props.isLoading}
        loadingMessage={props.loadingMessage}
      />

      {/* SVG visualization */}
      <svg
        viewBox={props.viewBox}
        className="w-full h-full cursor-default"
        style={{ background: "var(--vscode-editor-background)" }}
        {...props.panZoomHandlers}
      >
        <defs>
          <style>
            {`
              @keyframes pulse {
                0% { opacity: 0.4; transform: scale(1); }
                50% { opacity: 0.8; transform: scale(1.1); }
                100% { opacity: 0.4; transform: scale(1); }
              }
            `}
          </style>
        </defs>
        
        {/* Grid background */}
        <MapBackground
          width={props.mapWidth}
          height={props.mapHeight}
          gridSize={20}
        />

        {/* Main content group with pan/zoom transform */}
        <MapContent
          analets={props.analets}
          hoveredAnalet={props.hoveredAnalet}
          loadingAnalets={props.loadingAnalets}
          recentlyCreatedAnalets={props.recentlyCreatedAnalets}
          dragState={props.dragState}
          getAnaletPosition={props.getAnaletPosition}
          transform={props.transform}
          mapWidth={props.mapWidth}
          mapHeight={props.mapHeight}
          isLoading={props.isLoading}
          onAnaletOpen={props.onAnaletOpen}
          onAnaletHover={props.onAnaletHover}
          onDragStart={props.onDragStart}
          onDragMove={props.onDragMove}
          onDragEnd={props.onDragEnd}
          onGenerateAnalets={props.onGenerateAnalets}
        />
      </svg>
    </div>
  );
}; 