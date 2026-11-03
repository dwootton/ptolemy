/**
 * Layout and positioning utilities for AnalysisMap
 */

import { Analet } from "../../../types/analet";
import { Point, calculateDistance } from "./mapMath";

export interface TooltipPosition {
  x: number;
  y: number;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

export interface LabelData {
  analet: Analet;
  x: number;
  y: number;
  text: string;
  visible: boolean;
}

/**
 * Calculate optimal tooltip position to avoid viewport edges
 */
export function calculateTooltipPosition(
  mouseX: number,
  mouseY: number,
  tooltipWidth: number = 200,
  tooltipHeight: number = 100,
  viewportWidth: number,
  viewportHeight: number,
  offset: number = 10
): TooltipPosition {
  let x = mouseX + offset;
  let y = mouseY + offset;
  let placement: 'top' | 'bottom' | 'left' | 'right' = 'bottom';

  // Check if tooltip would go off the right edge
  if (x + tooltipWidth > viewportWidth) {
    x = mouseX - tooltipWidth - offset;
    placement = 'left';
  }

  // Check if tooltip would go off the bottom edge
  if (y + tooltipHeight > viewportHeight) {
    y = mouseY - tooltipHeight - offset;
    placement = placement === 'left' ? 'left' : 'top';
  }

  // Check if tooltip would go off the top edge
  if (y < 0) {
    y = mouseY + offset;
    placement = placement === 'left' ? 'left' : 'bottom';
  }

  // Check if tooltip would go off the left edge
  if (x < 0) {
    x = mouseX + offset;
    placement = 'right';
  }

  return { x, y, placement };
}

/**
 * Filter labels by proximity to avoid overlap
 */
export function filterLabelsByProximity(
  labels: LabelData[],
  minDistance: number = 30
): LabelData[] {
  const filteredLabels: LabelData[] = [];
  
  // Sort by some priority (could be selection state, size, etc.)
  const sortedLabels = [...labels].sort((a, b) => {
    // Prioritize selected analets
    const aSelected = a.analet.id ? 1 : 0;
    const bSelected = b.analet.id ? 1 : 0;
    return bSelected - aSelected;
  });

  for (const label of sortedLabels) {
    let tooClose = false;
    
    for (const existingLabel of filteredLabels) {
      const distance = calculateDistance(
        { x: label.x, y: label.y },
        { x: existingLabel.x, y: existingLabel.y }
      );
      
      if (distance < minDistance) {
        tooClose = true;
        break;
      }
    }
    
    if (!tooClose) {
      filteredLabels.push({ ...label, visible: true });
    } else {
      filteredLabels.push({ ...label, visible: false });
    }
  }
  
  return filteredLabels;
}

/**
 * Calculate optimal label positions to avoid overlaps
 */
export function calculateLabelPositions(
  analets: Analet[],
  nodeRadius: number = 8,
  labelOffset: number = 15
): LabelData[] {
  return analets.map(analet => ({
    analet,
    x: analet.location?.x ?? 0,
    y: (analet.location?.y ?? 0) - nodeRadius - labelOffset,
    text: analet.statement || `Analet ${analet.id}`,
    visible: true,
  }));
}

/**
 * Check if two rectangles overlap
 */
export function doRectsOverlap(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    rect1.x + rect1.width < rect2.x ||
    rect2.x + rect2.width < rect1.x ||
    rect1.y + rect1.height < rect2.y ||
    rect2.y + rect2.height < rect1.y
  );
}

/**
 * Get viewport bounds from a container element
 */
export function getViewportBounds(
  containerElement: HTMLElement | null
): { width: number; height: number } {
  if (!containerElement) {
    return { width: 800, height: 600 }; // Default fallback
  }

  const rect = containerElement.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Clamp a value between min and max bounds
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between two values
 */
export function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * clamp(factor, 0, 1);
}

/**
 * Convert screen coordinates to map coordinates considering zoom/pan
 */
export function screenToMapCoords(
  screenX: number,
  screenY: number,
  transform: { scale: number; positionX: number; positionY: number }
): Point {
  return {
    x: (screenX - transform.positionX) / transform.scale,
    y: (screenY - transform.positionY) / transform.scale,
  };
}

/**
 * Convert map coordinates to screen coordinates considering zoom/pan
 */
export function mapToScreenCoords(
  mapX: number,
  mapY: number,
  transform: { scale: number; positionX: number; positionY: number }
): Point {
  return {
    x: mapX * transform.scale + transform.positionX,
    y: mapY * transform.scale + transform.positionY,
  };
}