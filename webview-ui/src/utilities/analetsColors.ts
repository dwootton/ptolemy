import React from "react";
import { Analet } from "../types/analet";

export function getAnaletColor(analet: Analet): string {
  // Color based on formalism content or other properties
  if (analet.cellQL?.includes("hypothesis")) return "#60A5FA"; // blue-400
  if (analet.cellQL?.includes("fact")) return "#34D399"; // emerald-400
  if (analet.cellQL?.includes("artifact")) return "#F472B6"; // pink-400
  return "#9CA3AF"; // gray-400
}

export function getAnaletNodeColor(isLoading?: boolean, wasRecentlyCreated?: boolean, _analet?: Analet): string {
  if (isLoading) return '#77B0DB'; // Blue for loading
  if (wasRecentlyCreated) return '#77B0DB'; // Blue for recently created waypoints (with red diffuse animation)
  
  // Unified color scheme - all analets are blue
  return '#77B0DB'; // Blue for all analets
}

export function getAnaletHighlightColor(isDragging?: boolean, isHovered?: boolean, analet?: Analet): string {
  if (isDragging) return '#005a9b'; // Darker blue for dragging
  if (isHovered) return '#0078D4'; // Selected/hover blue
  return getAnaletNodeColor(false, false, analet); // Default color (pass analet for self-created check)
}

export function getAnaletFolderColor(_analet?: Analet): string {
  // Unified color scheme - all analets are blue in folder list
  return '#0066bb'; // Blue for all analets in folder list
}

// Helper function to get blue diffuse glow style for newly added waypoints
export function getBlueDiffuseGlow(wasRecentlyCreated?: boolean): React.CSSProperties {
  if (!wasRecentlyCreated) return {};
  
  return {
    filter: 'drop-shadow(0 0 8px rgba(0, 120, 212, 0.8)) drop-shadow(0 0 16px rgba(0, 120, 212, 0.4))',
    animation: 'blueDiffusePulse 3s ease-out forwards'
  };
}

// CSS keyframes for blue diffuse animation (needs to be injected into document)
export const blueDiffuseKeyframes = `
@keyframes blueDiffusePulse {
  0% {
    filter: drop-shadow(0 0 12px rgba(0, 120, 212, 1)) drop-shadow(0 0 24px rgba(0, 120, 212, 0.6));
  }
  50% {
    filter: drop-shadow(0 0 8px rgba(0, 120, 212, 0.8)) drop-shadow(0 0 16px rgba(0, 120, 212, 0.4));
  }
  100% {
    filter: none;
  }
}
`; 