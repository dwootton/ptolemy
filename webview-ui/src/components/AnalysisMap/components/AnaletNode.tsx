import React, { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import { Analet } from "../../../types/analet";
import { getAnaletHighlightColor, getBlueDiffuseGlow, blueDiffuseKeyframes } from "../../../utilities/analetsColors";
import { getNodeSize, getNodeOpacity, getStrokeProps, getRingOpacity } from "../../../utilities/mapVisualization";
import { DragState } from "../hooks/useAnaletPositioning";
import { FeatureFlags } from "../../../utils/featureFlags";

interface AnaletNodeProps {
  analet: Analet;
  position?: { x: number; y: number }; // Override position for drag
  isSelected?: boolean;
  isHovered?: boolean;
  isLoading?: boolean;
  wasRecentlyCreated?: boolean;
  isDragging?: boolean;
  isMaterialized?: boolean; // Whether this analet has been created/materialized
  globalDragState?: DragState; // Global drag state to prevent animations during any drag
  onClick?: (analet: Analet) => void;
  onHover?: (analet: Analet | null) => void;
  onDragStart?: (analet: Analet, startPos: { x: number; y: number }) => void;
  onDragMove?: (offset: { x: number; y: number }) => void;
  onDragEnd?: () => void;
  onRightClick?: (analet: Analet, event: React.MouseEvent) => void;
}

// Inject CSS keyframes into document if not already present
if (typeof document !== 'undefined' && !document.getElementById('blue-diffuse-keyframes')) {
  const style = document.createElement('style');
  style.id = 'blue-diffuse-keyframes';
  style.textContent = blueDiffuseKeyframes;
  document.head.appendChild(style);
}

export const AnaletNode: React.FC<AnaletNodeProps> = (props) => {
  const [isLocalHovered, setIsLocalHovered] = useState(false);
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startMousePos: { x: number; y: number } | null;
    hasDragged: boolean;
  }>({
    isDragging: false,
    startMousePos: null,
    hasDragged: false
  });

  // Reference to the g element for d3 manipulation
  const gRef = useRef<SVGGElement>(null);

  // Helper function to get current position from DOM element
  const getCurrentDOMPosition = (): { x: number; y: number } => {
    if (!gRef.current) return { x: 0, y: 0 };
    
    const transform = gRef.current.getAttribute("transform");
    if (transform) {
      // Match "translate(x, y)" or "translate(x)"
      const match = transform.match(/translate\(\s*([-\d.]+)(?:\s*,\s*([-\d.]+))?\s*\)/);
      if (match) {
        const x = parseFloat(match[1]);
        const y = match[2] !== undefined ? parseFloat(match[2]) : 0;
        return { x, y };
      }
    }
    return { x: 0, y: 0 };
  };

  // Initialize position and set up d3 animation effect
  useEffect(() => {
    const targetPos = props.position || props.analet.location;
    
    // Skip if no target position is available
    if (!targetPos) {
      return;
    }
    
    // Skip animation if we're dragging OR if any analet is being dragged
    if (dragState.isDragging || props.isDragging || props.globalDragState?.isDragging) {
      return;
    }
    
    if (!gRef.current) {
      return;
    }

    // Get the current position from DOM element
    const currentDOMPos = getCurrentDOMPosition();
    
    // If DOM position is 0,0, it means the element was just created
    // Use the target position as both start and end (no animation needed)
    if (currentDOMPos.x === 0 && currentDOMPos.y === 0) {
      d3.select(gRef.current).attr("transform", `translate(${targetPos.x}, ${targetPos.y})`);
      return;
    }
    
    // Check if we need to animate (position has changed)
    const hasPositionChanged = Math.abs(currentDOMPos.x - targetPos.x) > 0.1 || 
                               Math.abs(currentDOMPos.y - targetPos.y) > 0.1;
    
    if (hasPositionChanged) {
      d3.select(gRef.current)
        .transition()
        .duration(2000) // 2 second transition as requested
        .ease(d3.easeCubicOut) // Fixed: Use standard D3 easing function
        .attr("transform", `translate(${targetPos.x}, ${targetPos.y})`)
        .on("end", () => {
          // Animation complete - position is now in the DOM
        });
    }
  }, [props.position, props.analet.location, props.analet.id, dragState.isDragging, props.isDragging, props.globalDragState?.isDragging]);

  // const nodeColor = getAnaletNodeColor(props.isLoading, props.wasRecentlyCreated, props.analet);
  const isHovered = props.isHovered || isLocalHovered;
  const nodeSize = getNodeSize(props.isSelected, isHovered);
  const nodeOpacity = getNodeOpacity(props.isSelected, isHovered, props.isDragging, props.isMaterialized);
  const ringOpacity = getRingOpacity(props.isSelected, isHovered);
  const strokeProps = getStrokeProps(props.isSelected, props.isHovered, props.isDragging);
  
  // Use blue highlighting when hovered from details pane, orange when dragging, blue for self-created
  const highlightColor = getAnaletHighlightColor(props.isDragging, props.isHovered, props.analet);
  
  // Get blue diffuse glow styles for newly created waypoints
  const blueDiffuseStyle = getBlueDiffuseGlow(props.wasRecentlyCreated);

  const DRAG_THRESHOLD = 5; // Minimum pixels to consider it a drag

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // If dragging is frozen, treat as a simple click and exit
    if (FeatureFlags.FREEZE_ANALET_DRAG) {
      props.onClick?.(props.analet);
      return;
    }
    
    // Stop any active d3 animation when starting drag
    if (gRef.current) {
      d3.select(gRef.current).interrupt();
    }
    
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
      if (!dragState.isDragging || !dragState.startMousePos) return;

      const currentSVGPos = convertMouseToSVG(moveEvent.clientX, moveEvent.clientY);
      const deltaX = currentSVGPos.x - dragState.startMousePos.x;
      const deltaY = currentSVGPos.y - dragState.startMousePos.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (distance > DRAG_THRESHOLD) {
        if (!dragState.hasDragged) {
          // First time crossing threshold - start drag
          setDragState({
            ...dragState,
            hasDragged: true
          });
          props.onDragStart?.(props.analet, currentSVGPos);
        }
        
        // Update position directly during drag (bypass d3 animation)
        if (gRef.current) {
          d3.select(gRef.current).attr("transform", `translate(${currentSVGPos.x}, ${currentSVGPos.y})`);
        }
        props.onDragMove?.(currentSVGPos);
      }
    };

    const handleMouseUp = () => {
      if (dragState.hasDragged) {
        // Was a drag - end drag and allow d3 to handle transition to final position
        props.onDragEnd?.();
      } else {
        // Was a click - trigger click handler
        props.onClick?.(props.analet);
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

  return (
    <g
      ref={gRef}
      className={`cursor-pointer ${FeatureFlags.FREEZE_ANALET_DRAG ? 'cursor-pointer' : (props.isDragging ? 'cursor-grabbing' : 'cursor-grab')}`}
      style={{ 
        opacity: nodeOpacity,
        ...blueDiffuseStyle
      }}
      // Ensure clicks still work when dragging is frozen
      onClick={() => { if (FeatureFlags.FREEZE_ANALET_DRAG) props.onClick?.(props.analet); }}
      onMouseEnter={() => {
        if (!dragState.isDragging) {
          setIsLocalHovered(true);
          props.onHover?.(props.analet);
        }
      }}
      onMouseLeave={() => {
        if (!dragState.isDragging) {
          setIsLocalHovered(false);
          props.onHover?.(null);
        }
      }}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        if (props.analet.source === 'conceptual_statement') {
          e.preventDefault();
          e.stopPropagation();
          props.onRightClick?.(props.analet, e);
        }
      }}
    >
      {/* Ring - always visible for discoverability */}
      {props.analet.cellQL === 'BEARING' ? (
        <rect
          x={-nodeSize}
          y={-nodeSize}
          width={nodeSize * 2}
          height={nodeSize * 2}
          fill="none"
          stroke={props.isDragging ? "#ff6b35" : (isHovered ? "#ffa500" : "#ea580c")}
          strokeWidth="2"
          opacity={ringOpacity}
          rx={2}
        />
      ) : (
        <circle
          r={nodeSize}
          fill="none"
          stroke={highlightColor}
          strokeWidth="2"
          opacity={ringOpacity}
        />
      )}

      {/* Main node fill - uses materialization opacity */}
      {props.analet.cellQL === 'BEARING' ? (
        <rect
          x={-nodeSize}
          y={-nodeSize}
          width={nodeSize * 2}
          height={nodeSize * 2}
          fill={props.isDragging ? "#ff6b35" : (isHovered ? "#ffa500" : "#ea580c")} // Orange variations for BEARING
          opacity={nodeOpacity}
          stroke={strokeProps.stroke}
          strokeWidth={strokeProps.strokeWidth}
          rx={2} // Small border radius for rounded corners
        />
      ) : (
        <circle
          r={nodeSize}
          fill={highlightColor}
          opacity={nodeOpacity}
          stroke={strokeProps.stroke}
          strokeWidth={strokeProps.strokeWidth}
        />
      )}
      
      {/* Loading spinner - simple grayscale rotating circle */}
      {props.isLoading && (
        <circle
          r={nodeSize + (props.analet.cellQL === 'BEARING' ? 3 : 2)}
          fill="none"
          stroke="#888888"
          strokeWidth="1.5"
          strokeDasharray="8,3"
          strokeLinecap="round"
          opacity="0.7"
          style={{ animation: 'spin 2s linear infinite', transformOrigin: 'center' }}
        />
      )}
    </g>
  );
}; 
