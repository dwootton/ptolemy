/**
 * Mathematical utilities for AnalysisMap calculations
 */

import { Analet } from "../../../types/analet";

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Calculate the distance between two points
 */
export function calculateDistance(point1: Point, point2: Point): number {
  return Math.sqrt(
    Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2)
  );
}

/**
 * Calculate the centroid (center point) of a set of analets
 */
export function calculateCentroid(analets: Analet[]): Point {
  if (analets.length === 0) {
    return { x: 0, y: 0 };
  }

  const sum = analets.reduce(
    (acc, analet) => ({
      x: acc.x + (analet.location?.x || 0),
      y: acc.y + (analet.location?.y || 0),
    }),
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / analets.length,
    y: sum.y / analets.length,
  };
}

/**
 * Position analets in a circular cluster around a centroid
 */
export function calculateCircularPositions(
  analets: Analet[],
  centroid: Point,
  radius: number = 50
): Array<{ analet: Analet; position: Point }> {
  const angleStep = (2 * Math.PI) / analets.length;
  
  return analets.map((analet, index) => {
    const angle = index * angleStep;
    const position = {
      x: centroid.x + Math.cos(angle) * radius,
      y: centroid.y + Math.sin(angle) * radius,
    };
    
    return { analet, position };
  });
}

/**
 * Calculate bounding box for a selection area
 */
export function calculateSelectionBounds(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): BoundingBox {
  const minX = Math.min(startX, currentX);
  const maxX = Math.max(startX, currentX);
  const minY = Math.min(startY, currentY);
  const maxY = Math.max(startY, currentY);
  
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

/**
 * Check if a point is within a bounding box
 */
export function isPointInBounds(point: Point, bounds: BoundingBox): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Check if an analet is within a selection area
 */
export function isAnaletInSelection(
  analet: Analet,
  bounds: BoundingBox
): boolean {
  if (!analet.location) return false;
  return isPointInBounds(analet.location, bounds);
}

/**
 * Filter analets by minimum distance from each other
 */
export function filterAnaletsByDistance(
  analets: Analet[],
  minDistance: number
): Analet[] {
  return analets.filter((analet, index) => {
    if (!analet.location) return true;
    // Check if this analet is too close to any previous analet
    for (let i = 0; i < index; i++) {
      const otherAnalet = analets[i];
      if (!otherAnalet.location) continue;
      const distance = calculateDistance(analet.location, otherAnalet.location);
      if (distance < minDistance) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Generate a random request ID for operations
 */
export function generateRequestId(): string {
  return Math.random().toString(36);
}