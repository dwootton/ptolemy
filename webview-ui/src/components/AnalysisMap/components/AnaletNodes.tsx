/**
 * Analet nodes rendering component for AnalysisMap
 */

import React from "react";
import { Analet } from "../../../types/analet";
import { getAnaletNodeColor } from "../../../utilities/analetsColors";
import { SharedSelection } from "../hooks/useMapInteractions";

interface AnaletNodesProps {
  projectedAnalets: Analet[];
  sharedSelection: SharedSelection;
  onAnaletClick: (analet: Analet, event: React.MouseEvent) => void;
  onAnaletDoubleClick: (analet: Analet, event: React.MouseEvent) => void;
  onAnaletRightClick: (analet: Analet, event: React.MouseEvent) => void;
  onAnaletHover: (analet: Analet | null) => void;
  filterAnaletsByDistance?: (analets: Analet[], minDistance: number) => Analet[];
}

export function AnaletNodes({
  projectedAnalets,
  sharedSelection,
  onAnaletClick,
  onAnaletDoubleClick,
  onAnaletRightClick,
  onAnaletHover,
  filterAnaletsByDistance,
}: AnaletNodesProps) {
  // Filter analets if function is provided
  const filteredAnalets = filterAnaletsByDistance 
    ? filterAnaletsByDistance(projectedAnalets, 30)
    : projectedAnalets;

  const handleMouseEnter = (analet: Analet) => {
    onAnaletHover(analet);
  };

  const handleMouseLeave = () => {
    onAnaletHover(null);
  };

  return (
    <>
      {filteredAnalets.map((analet) => {
        const isSelected = sharedSelection.isAnaletSelected(analet.id);
        const isHovered = sharedSelection.selectionState.hoveredAnaletId === analet.id;
        const nodeColor = getAnaletNodeColor(false, false, analet);

        return (
          <div
            key={analet.id}
            className={`
              absolute rounded-full cursor-pointer transition-all duration-200
              ${isSelected 
                ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-[var(--vscode-editor-background)] z-20' 
                : 'z-10'
              }
              ${isHovered 
                ? 'scale-125 shadow-lg z-30' 
                : 'scale-100'
              }
            `}
            style={{
              left: (analet.location?.x ?? 0) - 8,
              top: (analet.location?.y ?? 0) - 8,
              width: '16px',
              height: '16px',
              backgroundColor: nodeColor,
              border: `2px solid ${isSelected ? '#3b82f6' : 'rgba(255, 255, 255, 0.8)'}`,
              boxShadow: isSelected 
                ? '0 4px 12px rgba(59, 130, 246, 0.4)' 
                : isHovered 
                ? '0 4px 12px rgba(0, 0, 0, 0.3)'
                : '0 2px 4px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(event) => onAnaletClick(analet, event)}
            onDoubleClick={(event) => onAnaletDoubleClick(analet, event)}
            onContextMenu={(event) => onAnaletRightClick(analet, event)}
            onMouseEnter={() => handleMouseEnter(analet)}
            onMouseLeave={handleMouseLeave}
            title={analet.statement || `Analet ${analet.id}`}
          >
            {/* Inner dot for better visibility */}
            <div
              className="absolute inset-1 rounded-full"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                transform: 'scale(0.6)',
              }}
            />
          </div>
        );
      })}
    </>
  );
}