/**
 * Selection brush component for AnalysisMap
 */

// React import not needed for JSX in modern React
import { SelectionBrush as SelectionBrushType } from "../hooks/useMapState";
import { calculateSelectionBounds } from "../utils/mapMath";

interface SelectionBrushProps {
  selectionBrush: SelectionBrushType;
}

export function SelectionBrush({ selectionBrush }: SelectionBrushProps) {
  if (!selectionBrush.isActive) {
    return null;
  }

  const bounds = calculateSelectionBounds(
    selectionBrush.startX,
    selectionBrush.startY,
    selectionBrush.currentX,
    selectionBrush.currentY
  );

  return (
    <div
      className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none z-30"
      style={{
        left: bounds.minX,
        top: bounds.minY,
        width: bounds.width,
        height: bounds.height,
      }}
    />
  );
}