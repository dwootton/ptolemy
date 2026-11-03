import React from 'react';

interface LabelDatum {
  id: number;
  text: string;
  x: number;
  y: number;
  isSelected?: boolean;
}

interface LabelLayerProps {
  labels: LabelDatum[];
  onLabelClick?: (id: number, event: React.MouseEvent) => void;
  onLabelHoverIn?: (id: number, event: React.MouseEvent) => void;
  onLabelHoverOut?: (id: number) => void;
  onLabelContextMenu?: (id: number, event: React.MouseEvent) => void;
}

export const LabelLayer: React.FC<LabelLayerProps> = (props) => {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
      {props.labels.map((label) => (
        <div
          key={label.id}
          className="absolute -translate-x-1/2 -translate-y-full -mt-[6px] pointer-events-auto select-none"
          style={{ left: label.x, top: label.y }}
          onClick={(e) => props.onLabelClick?.(label.id, e)}
          onMouseEnter={(e) => props.onLabelHoverIn?.(label.id, e)}
          onMouseLeave={() => props.onLabelHoverOut?.(label.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onLabelContextMenu?.(label.id, e);
          }}
          title={label.text}
        >
          <div
            className={
              `w-[75px] break-words hyphens-auto leading-tight text-center ` +
              `${label.isSelected ? 'text-[var(--vscode-textLink-foreground)] font-medium' : 'text-[var(--vscode-descriptionForeground)]'} ` +
              `text-[10px]`
            }
          >
            {label.text}
          </div>
        </div>
      ))}
    </div>
  );
};


