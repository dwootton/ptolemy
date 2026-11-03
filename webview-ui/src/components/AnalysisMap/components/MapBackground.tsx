import React from "react";

export interface MapBackgroundProps {
  width: number;
  height: number;
  gridSize?: number;
}

export const MapBackground: React.FC<MapBackgroundProps> = (props) => {
  const gridSize = props.gridSize || 20;

  return (
    <>
      {/* Grid pattern definition */}
      <defs>
        <pattern
          id="grid"
          width={gridSize}
          height={gridSize}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
            fill="none"
            stroke="var(--vscode-panel-border)"
            strokeWidth="0.5"
            opacity="0.3"
          />
        </pattern>
      </defs>
      
      {/* Grid background */}
      <rect width="100%" height="100%" fill="url(#grid)" />
    </>
  );
}; 