import { useState, useEffect } from "react";

interface UseMapPanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
}

export function useMapPanZoom(options: UseMapPanZoomOptions = {}) {
  const minZoom = options.minZoom || 0.1;
  const maxZoom = options.maxZoom || 10;

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY;
    const scaleChange = -delta * 0.001;
    const currentTransform = transform;
    const newScale = Math.max(minZoom, Math.min(maxZoom, currentTransform.scale * (1 + scaleChange)));

    // Calculate zoom point in SVG coordinates
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Calculate new position to zoom towards mouse
    const scaleRatio = newScale / currentTransform.scale;
    const dx = x - (x * scaleRatio + currentTransform.x * scaleRatio - currentTransform.x);
    const dy = y - (y * scaleRatio + currentTransform.y * scaleRatio - currentTransform.y);

    setTransform({
      x: currentTransform.x + dx,
      y: currentTransform.y + dy,
      scale: newScale,
    });
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button === 0) { // Left click only
      setIsDragging(true);
      setDragStart({
        x: event.clientX - transform.x,
        y: event.clientY - transform.y,
      });
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (isDragging) {
      const start = dragStart;
      setTransform({
        ...transform,
        x: event.clientX - start.x,
        y: event.clientY - start.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Clean up event listeners
  useEffect(() => {
    return () => {
      setIsDragging(false);
    };
  }, []);

  return {
    transform,
    panZoomHandlers: {
      onWheel: handleWheel,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
    },
  };
} 