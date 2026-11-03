import { useState, useCallback, useRef } from 'react';
import { Analet } from '../../../types/analet';
import { ConstraintService } from '../../../services/ConstraintService';

interface DragState {
  isDragging: boolean;
  draggedAnalet: Analet | null;
  dragOffset: { x: number; y: number };
  startPosition: { x: number; y: number };
  startMousePosition: { x: number; y: number };
  hasMoved: boolean;
}

interface UseAnaletDragOptions {
  constraintService: ConstraintService;
  onDragStart?: (analet: Analet) => void;
  onDragEnd?: (analet: Analet, newPosition: { x: number; y: number }) => void;
  momentumFactor?: number; // 0-1, how much momentum to apply (0 = no momentum, 1 = full momentum)
}

export const useAnaletDrag = (options: UseAnaletDragOptions) => {
  const { constraintService, onDragStart, onDragEnd, momentumFactor = 0.9 } = options;
  
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    draggedAnalet: null,
    dragOffset: { x: 0, y: 0 },
    startPosition: { x: 0, y: 0 },
    startMousePosition: { x: 0, y: 0 },
    hasMoved: false
  });
  
  const dragRef = useRef<SVGSVGElement>(null);
  
  const startDrag = useCallback((analet: Analet, event: React.MouseEvent, initial?: { initialX: number; initialY: number }) => {
    event.preventDefault();
    event.stopPropagation();
    const svgEl = dragRef.current;
    if (!svgEl) return;
    // Convert mouse to SVG coordinates (accounts for pan/zoom)
    const pt = svgEl.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const svgPos = pt.matrixTransform(ctm.inverse());
    // Use provided initial rendered position if available (e.g., grid-based), otherwise fallback to analet.location
    const analetX = initial?.initialX ?? analet.location?.x ?? 0;
    const analetY = initial?.initialY ?? analet.location?.y ?? 0;
    // Calculate offset from mouse to analet center in SVG space
    const dragOffset = {
      x: svgPos.x - analetX,
      y: svgPos.y - analetY
    };
    
    setDragState({
      isDragging: true,
      draggedAnalet: analet,
      dragOffset,
      startPosition: { x: analetX, y: analetY },
      startMousePosition: { x: svgPos.x, y: svgPos.y },
      hasMoved: false
    });
    onDragStart?.(analet);
  }, [onDragStart]);
  
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!dragState.isDragging || !dragState.draggedAnalet) return;
    const svgEl = dragRef.current;
    if (!svgEl) return;
    const pt = svgEl.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const svgPos = pt.matrixTransform(ctm.inverse());
    
    // Check if mouse has moved enough to constitute a drag (threshold of 3 pixels)
    const mouseMoveDistance = Math.sqrt(
      Math.pow(svgPos.x - dragState.startMousePosition.x, 2) + 
      Math.pow(svgPos.y - dragState.startMousePosition.y, 2)
    );
    
    // Only mark as moved if mouse has moved significantly
    if (mouseMoveDistance > 3 && !dragState.hasMoved) {
      setDragState(prev => ({ ...prev, hasMoved: true }));
    }
    
    // Always update position for visual feedback during drag
    if (dragState.isDragging) {
      // Calculate new position - place exactly where mouse is (minus offset)
      const newPosition = {
        x: svgPos.x - dragState.dragOffset.x,
        y: svgPos.y - dragState.dragOffset.y
      };
      
      // Update the analet's position temporarily during drag for visual feedback
      dragState.draggedAnalet.location = {
        id: dragState.draggedAnalet.location?.id || `analet-${dragState.draggedAnalet.id}`,
        x: newPosition.x,
        y: newPosition.y
      };
      
      // Force a re-render by updating the drag state
      setDragState(prev => ({ ...prev, isDragging: true }));
    }
    
  }, [dragState]);
  
  const endDrag = useCallback((event: React.MouseEvent) => {
    if (!dragState.isDragging || !dragState.draggedAnalet) return;
    
    // If we haven't moved, this is just a click - don't treat as drag
    if (!dragState.hasMoved) {
      setDragState({
        isDragging: false,
        draggedAnalet: null,
        dragOffset: { x: 0, y: 0 },
        startPosition: { x: 0, y: 0 },
        startMousePosition: { x: 0, y: 0 },
        hasMoved: false
      });
      return;
    }
    
    const svgEl = dragRef.current;
    if (!svgEl) return;
    const pt = svgEl.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const svgPos = pt.matrixTransform(ctm.inverse());
    
    const exactFinalPosition = {
      x: svgPos.x - dragState.dragOffset.x,
      y: svgPos.y - dragState.dragOffset.y
    };
    // Set constraint with EXACT position and full strength
    const constraintStrength = 1.0; // Full constraint strength for exact placement
    constraintService.setAnaletFixed(dragState.draggedAnalet, exactFinalPosition, constraintStrength);
    
    // Update the analet's position to exact drop location
    dragState.draggedAnalet.location = {
      id: dragState.draggedAnalet.location?.id || `analet-${dragState.draggedAnalet.id}`,
      x: exactFinalPosition.x,
      y: exactFinalPosition.y
    };
    
    onDragEnd?.(dragState.draggedAnalet, exactFinalPosition);
    
    setDragState({
      isDragging: false,
      draggedAnalet: null,
      dragOffset: { x: 0, y: 0 },
      startPosition: { x: 0, y: 0 },
      startMousePosition: { x: 0, y: 0 },
      hasMoved: false
    });
  }, [dragState, momentumFactor, constraintService, onDragEnd]);
  
  const cancelDrag = useCallback(() => {
    if (dragState.isDragging && dragState.draggedAnalet) {
      // Restore original position
      dragState.draggedAnalet.location = {
        id: dragState.draggedAnalet.location?.id || `analet-${dragState.draggedAnalet.id}`,
        x: dragState.startPosition.x,
        y: dragState.startPosition.y
      };
    }
    
    setDragState({
      isDragging: false,
      draggedAnalet: null,
      dragOffset: { x: 0, y: 0 },
      startPosition: { x: 0, y: 0 },
      startMousePosition: { x: 0, y: 0 },
      hasMoved: false
    });
  }, [dragState]);
  
  return {
    dragState,
    dragRef,
    startDrag,
    handleMouseMove,
    endDrag,
    cancelDrag,
    isDragging: dragState.isDragging,
    draggedAnalet: dragState.draggedAnalet
  };
};