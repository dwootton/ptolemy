/**
 * Grid Layout Utility for Analysis Canvas
 * Provides functions to calculate grid positions for analets with alphabetical sorting
 */

import { Analet } from '../types/analet';

export interface GridLayoutOptions {
  containerWidth: number;
  containerHeight: number;
  nodeSize: number;
  spacing: number;
  padding: number;
}

export interface GridPosition {
  x: number;
  y: number;
}

/**
 * Calculate grid positions for analets sorted alphabetically
 * @param analets Array of analets to position
 * @param options Grid layout configuration
 * @returns Map of analet IDs to grid positions
 */
export function calculateGridPositions(
  analets: Analet[],
  options: GridLayoutOptions
): Map<number, GridPosition> {
  const positions = new Map<number, GridPosition>();
  
  if (analets.length === 0) {
    return positions;
  }

  // Sort analets with custom sort weight priority, then alphabetically by statement
  const sortedAnalets = [...analets].sort((a, b) => {
    // First priority: custom grid sort weight (if set)
    const weightA = a.gridSortWeight;
    const weightB = b.gridSortWeight;
    
    // If both have custom weights, sort by weight
    if (typeof weightA === 'number' && typeof weightB === 'number') {
      return weightA - weightB;
    }
    
    // If only one has weight, prioritize it
    if (typeof weightA === 'number' && typeof weightB !== 'number') return -1;
    if (typeof weightA !== 'number' && typeof weightB === 'number') return 1;
    
    // Fall back to alphabetical sorting by statement
    const textA = (a.statement || '').toLowerCase().trim();
    const textB = (b.statement || '').toLowerCase().trim();
    
    // If both have statements, sort alphabetically
    if (textA && textB) {
      const comparison = textA.localeCompare(textB);
      return comparison !== 0 ? comparison : a.id - b.id;
    }
    
    // If only one has a statement, prioritize the one with a statement
    if (textA && !textB) return -1;
    if (!textA && textB) return 1;
    
    // If neither has a statement, sort by ID
    return a.id - b.id;
  });

  // Calculate optimal number of columns based on container width
  const cellWidth = options.nodeSize + options.spacing;
  const availableWidth = options.containerWidth - (2 * options.padding);
  const maxColumns = Math.max(1, Math.floor(availableWidth / cellWidth));
  
  // Calculate positions for each analet
  sortedAnalets.forEach((analet, index) => {
    const row = Math.floor(index / maxColumns);
    const col = index % maxColumns;
    
    const x = options.padding + (col * cellWidth) + (options.nodeSize / 2);
    const y = options.padding + (row * (options.nodeSize + options.spacing)) + (options.nodeSize / 2);
    
    positions.set(analet.id, { x, y });
  });

  return positions;
}

/**
 * Default grid layout options for analysis canvas
 */
export const DEFAULT_GRID_OPTIONS: GridLayoutOptions = {
  containerWidth: 800,
  containerHeight: 400,
  nodeSize: 16,
  spacing: 60,
  padding: 20
};

/**
 * Hook-friendly function that recalculates grid positions when dependencies change
 * @param analets Current analets array
 * @param containerDimensions Container width and height
 * @param customOptions Optional custom grid options
 * @returns Map of analet IDs to grid positions
 */
export function useGridPositions(
  analets: Analet[],
  containerDimensions: { width: number; height: number },
  customOptions?: Partial<GridLayoutOptions>
): Map<number, GridPosition> {
  const options: GridLayoutOptions = {
    ...DEFAULT_GRID_OPTIONS,
    containerWidth: containerDimensions.width,
    containerHeight: containerDimensions.height,
    ...customOptions
  };

  return calculateGridPositions(analets, options);
}

/**
 * Get sorted analets for grid layout (useful for debugging or other purposes)
 * @param analets Array of analets to sort
 * @returns Sorted array of analets
 */
export function getSortedAnalets(analets: Analet[]): Analet[] {
  return [...analets].sort((a, b) => {
    const textA = (a.statement || '').toLowerCase().trim();
    const textB = (b.statement || '').toLowerCase().trim();
    
    if (textA && textB) {
      const comparison = textA.localeCompare(textB);
      return comparison !== 0 ? comparison : a.id - b.id;
    }
    
    if (textA && !textB) return -1;
    if (!textA && textB) return 1;
    
    return a.id - b.id;
  });
}
