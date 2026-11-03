import { useState } from "react";
import { Analet } from "../../../types/analet";

export interface AnaletDragHandlers {
  onDragStart?: (analet: Analet, startPos: { x: number; y: number }) => void;
  onDragMove?: (position: { x: number; y: number }) => void;
  onDragEnd?: () => void;
}

export function useAnaletDragging(handlers: AnaletDragHandlers) {
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startMousePos: { x: number; y: number } | null;
    hasDragged: boolean;
  }>({
    isDragging: false,
    startMousePos: null,
    hasDragged: false
  });

  const DRAG_THRESHOLD = 5; // Minimum pixels to consider it a drag

  const handleMouseDown = (analet: Analet, onClick?: (analet: Analet) => void) => {
    return (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Get the SVG element to convert coordinates
      const svgElement = (e.target as Element).closest('svg');
      if (!svgElement) return;
      
      const svgPoint = svgElement.createSVGPoint();
      
      // Convert mouse coordinates to SVG coordinates
      const convertMouseToSVG = (clientX: number, clientY: number) => {
        svgPoint.x = clientX;
        svgPoint.y = clientY;
        const transformed = svgPoint.matrixTransform(svgElement.getScreenCTM()?.inverse());
        return { x: transformed.x, y: transformed.y };
      };
      
      const startSVGPos = convertMouseToSVG(e.clientX, e.clientY);
      
      setDragState({
        isDragging: true,
        startMousePos: startSVGPos,
        hasDragged: false
      });

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const current = dragState;
        if (!current.isDragging || !current.startMousePos) return;

        const currentSVGPos = convertMouseToSVG(moveEvent.clientX, moveEvent.clientY);
        const deltaX = currentSVGPos.x - current.startMousePos.x;
        const deltaY = currentSVGPos.y - current.startMousePos.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance > DRAG_THRESHOLD) {
          if (!current.hasDragged) {
            // First time crossing threshold - start drag
            setDragState({
              ...current,
              hasDragged: true
            });
            handlers.onDragStart?.(analet, currentSVGPos);
          }
          
          // Update drag position using absolute SVG coordinates
          handlers.onDragMove?.(currentSVGPos);
        }
      };

      const handleMouseUp = () => {
        const current = dragState;
        
        if (current.hasDragged) {
          // Was a drag - end drag
          handlers.onDragEnd?.();
        } else {
          // Was a click - trigger click handler
          onClick?.(analet);
        }

        // Reset drag state
        setDragState({
          isDragging: false,
          startMousePos: null,
          hasDragged: false
        });

        // Remove event listeners
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      // Add global event listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
  };

  const isDragging = () => dragState.isDragging;
  const hasDragged = () => dragState.hasDragged;

  return {
    handleMouseDown,
    isDragging,
    hasDragged
  };
} 