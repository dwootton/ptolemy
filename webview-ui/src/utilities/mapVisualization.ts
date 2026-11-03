export interface MapVisualizationOptions {
  width: number;
  height: number;
  padding: number;
}

export function createMapVisualization(options: MapVisualizationOptions) {
  const { width, height, padding } = options;

  return {
    getViewBox: () => `0 0 ${width} ${height}`,
    getEffectiveWidth: () => width - (padding * 2),
    getEffectiveHeight: () => height - (padding * 2),
    getBounds: () => ({
      minX: padding,
      maxX: width - padding,
      minY: padding,
      maxY: height - padding,
      width: width - (padding * 2),
      height: height - (padding * 2)
    })
  };
}

export function getNodeSize(isSelected?: boolean, isHovered?: boolean): number {
  if (isSelected) return 8;
  if (isHovered) return 7;
  return 6;
}

export function getNodeOpacity(isSelected?: boolean, isHovered?: boolean, isDragging?: boolean, isMaterialized?: boolean): string {
  if (isDragging) return "0.8";
  if (isSelected) return "1.0";
  if (isHovered) return "0.9";
  if (isMaterialized) return "0.8";
  return "0.2"; // Unmaterialized analets
}

export function getStrokeProps(isSelected?: boolean, isHovered?: boolean, isDragging?: boolean) {
  if (isSelected) return { stroke: "#0078D4", strokeWidth: "2" };
  if (isHovered) return { stroke: "#0078D4", strokeWidth: "1" };
  if (isDragging) return { stroke: "#005a9b", strokeWidth: "1" };
  return { stroke: "none", strokeWidth: "0" };
}

export function getRingOpacity(isSelected?: boolean, isHovered?: boolean): string {
  // Ring is always visible for discoverability, with slight variations for states
  if (isSelected) return "1.0";
  if (isHovered) return "0.9";
  return "0.8"; // Always visible ring for unmaterialized analets
} 