import React from "react";

export interface MapEmptyStateProps {
  width: number;
  height: number;
  message?: string;
  onGenerateAnalets?: () => void;
}

export const MapEmptyState: React.FC<MapEmptyStateProps> = (props) => {
  const message = props.message || "No analyses available";
  const showGenerateLink = !props.message && props.onGenerateAnalets;

  if (showGenerateLink) {
    return (
      <g>
       
        <text
          x={props.width / 2}
          y={props.height / 2}
          textAnchor="middle"
          style={{
            fill: "var(--vscode-textLink-foreground)",
            fontSize: "12px",
            cursor: "pointer",
            textDecoration: "underline"
          }}
          onClick={() => props.onGenerateAnalets?.()}
        >
          Generate random analets
        </text>
      </g>
    );
  }

  return (
    <text
      x={props.width / 2}
      y={props.height / 2}
      textAnchor="middle"
      style={{
        fill: "var(--vscode-descriptionForeground)",
        fontSize: "12px"
      }}
    >
      {message}
    </text>
  );
}; 