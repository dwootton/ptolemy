import { useState, useEffect } from "react";
import { Analet } from "../../../types/analet";
import { ConstraintService } from "../../../services/ConstraintService";

export interface AnaletPositioningOptions {
  constraintService: ConstraintService;
  enablePositionLogging?: boolean;
}

export interface DragState {
  isDragging: boolean;
  draggedAnalet: Analet | null;
  currentPosition: { x: number; y: number } | null;
}

export interface PositionChangeEvent {
  analet: Analet;
  oldPosition: { x: number; y: number };
  newPosition: { x: number; y: number };
  changeType: 'drag' | 'constraint' | 'umap_update';
}

export function useAnaletPositioning(options: AnaletPositioningOptions) {
  const { constraintService, enablePositionLogging = false } = options;

  // Drag state management
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    draggedAnalet: null,
    currentPosition: null
  });

  // Position change tracking for animation coordination
  const [positionChangeEvents, setPositionChangeEvents] = useState<PositionChangeEvent[]>([]);

  // Track position changes for constraint applications
  const [constraintUpdates, setConstraintUpdates] = useState<number>(0);

  // Listen for constraint changes
  useEffect(() => {
    const unsubscribe = constraintService.onConstraintsChanged(() => {

      setConstraintUpdates(prev => prev + 1);
    });

    return unsubscribe;
  }, [constraintService, enablePositionLogging]);

  // Get current position for an analet (priority: dragged position > constraint > original UMAP position)
  const getAnaletPosition = (analet: Analet): { x: number; y: number } => {
    const current = dragState;

    // Check if analet has valid location coordinates
    const hasValidLocation = analet.location &&
                           typeof analet.location.x === 'number' &&
                           typeof analet.location.y === 'number' &&
                           !isNaN(analet.location.x) &&
                           !isNaN(analet.location.y);

    const originalPos = hasValidLocation ?
      { x: analet.location!.x, y: analet.location!.y } :
      { x: 100, y: 100 }; // Fallback position

    // Only log when using fallback position (indicates potential issue)
    if (!hasValidLocation && enablePositionLogging) {
      console.warn(`⚠️ [useAnaletPositioning] Analet ${analet.id} using fallback position:`, {
        locationObject: analet.location,
        fallbackPos: originalPos
      });
    }

    // Check if we have a constraint for this analet
    const constraintPosition = constraintService.getConstraintPosition(analet.id);
    const basePosition = constraintPosition || originalPos;


    // If currently being dragged, use the current drag position
    if (current.isDragging && current.draggedAnalet?.id === analet.id && current.currentPosition) {
      return current.currentPosition;
    }

    return basePosition;
  };

  // Handle drag start
  const handleDragStart = (analet: Analet, startPos: { x: number; y: number }) => {
    // Emit position change event for animation coordination
    const oldPosition = getAnaletPosition(analet);
    setPositionChangeEvents(prev => [...prev, {
      analet,
      oldPosition,
      newPosition: startPos,
      changeType: 'drag'
    }]);

    setDragState({
      isDragging: true,
      draggedAnalet: analet,
      currentPosition: startPos
    });
  };

  // Handle drag move
  const handleDragMove = (position: { x: number; y: number }) => {
    const current = dragState;
    if (current.isDragging && current.draggedAnalet) {
      const oldPosition = current.currentPosition || position;

      // Only emit events for significant position changes during drag
      const distance = Math.sqrt(
        Math.pow(position.x - oldPosition.x, 2) +
        Math.pow(position.y - oldPosition.y, 2)
      );

      if (distance > 5) {
        setPositionChangeEvents(prev => [...prev, {
          analet: current.draggedAnalet!,
          oldPosition,
          newPosition: position,
          changeType: 'drag'
        }]);
      }

      setDragState({
        ...current,
        currentPosition: position
      });
    }
  };

  // Handle drag end - Apply constraint immediately to prevent race conditions
  const handleDragEnd = () => {
    const current = dragState;
    if (current.isDragging && current.draggedAnalet && current.currentPosition) {
      const oldPosition = getAnaletPosition(current.draggedAnalet);
      const finalPosition = current.currentPosition;
      const analet = current.draggedAnalet;

      // Apply constraint immediately to prevent race conditions with UMAP re-projection
      constraintService.setAnaletFixed(analet, finalPosition);

      // Emit constraint application event
      setPositionChangeEvents(prev => [...prev, {
        analet,
        oldPosition,
        newPosition: finalPosition,
        changeType: 'constraint'
      }]);

      // Reset drag state after constraint is applied
      setDragState({
        isDragging: false,
        draggedAnalet: null,
        currentPosition: null
      });
    }
  };

  // Check if an analet has a constraint applied
  const hasConstraint = (analetId: number): boolean => {
    return constraintService.isAnaletFixed(analetId);
  };

  // Get constraint strength for an analet
  const getConstraintStrength = (analetId: number): number => {
    return constraintService.getConstraintStrength(analetId);
  };

  // Clear position change events (useful for animation coordination)
  const clearPositionChangeEvents = () => {
    setPositionChangeEvents([]);
  };

  return {
    dragState,
    positionChangeEvents,
    constraintUpdates,
    getAnaletPosition,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    hasConstraint,
    getConstraintStrength,
    clearPositionChangeEvents
  };
}
