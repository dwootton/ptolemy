import React, { useState, useCallback, useRef, useEffect } from 'react';

interface EmbeddingCursorProps {
  x: number;
  y: number;
  isVisible: boolean;
  isLoading: boolean;
  description?: string;
  onMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onGenerateAnalet: () => void;
  persistentTooltip?: boolean;
  isOutsideHull?: boolean;
}

export const EmbeddingCursor: React.FC<EmbeddingCursorProps> = ({
  x,
  y,
  isVisible,
  isLoading,
  description,
  onMove,
  onDragEnd,
  onGenerateAnalet,
  persistentTooltip = true,
  isOutsideHull = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [showTooltip, setShowTooltip] = useState(persistentTooltip);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRef = useRef<SVGGElement>(null);

  // Update tooltip visibility when persistentTooltip changes
  useEffect(() => {
    if (persistentTooltip) {
      setShowTooltip(true);
    }
  }, [persistentTooltip]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Get the SVG element to convert coordinates (matching useAnaletDragging pattern)
    const svgElement = (event.target as Element).closest('svg');
    if (!svgElement) return;

    // Create SVG point for coordinate conversion
    const svgPoint = svgElement.createSVGPoint();
    
    // Convert mouse coordinates to SVG coordinates
    const convertMouseToSVG = (clientX: number, clientY: number) => {
      svgPoint.x = clientX;
      svgPoint.y = clientY;
      const transformed = svgPoint.matrixTransform(svgElement.getScreenCTM()?.inverse());
      return { x: transformed.x, y: transformed.y };
    };

    const startSVGPos = convertMouseToSVG(event.clientX, event.clientY);

    // Store the offset from cursor position to mouse click point
    dragStartRef.current = {
      x: startSVGPos.x - x,
      y: startSVGPos.y - y
    };
    
    setIsDragging(true);
    setShowTooltip(false);
  }, [x, y]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current) return;
      
      const svgElement = cursorRef.current?.closest('svg');
      if (!svgElement) return;
      
      // Use the same SVG coordinate conversion pattern as useAnaletDragging
      const svgPoint = svgElement.createSVGPoint();
      
      const convertMouseToSVG = (clientX: number, clientY: number) => {
        svgPoint.x = clientX;
        svgPoint.y = clientY;
        const transformed = svgPoint.matrixTransform(svgElement.getScreenCTM()?.inverse());
        return { x: transformed.x, y: transformed.y };
      };

      const currentSVGPos = convertMouseToSVG(event.clientX, event.clientY);
      
      // Calculate new cursor position accounting for the drag offset
      const newX = currentSVGPos.x - dragStartRef.current.x;
      const newY = currentSVGPos.y - dragStartRef.current.y;
      
      // Allow unlimited movement - no constraints
      onMove(newX, newY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      setShowTooltip(true); // Always show after drag ends
      
      // Request description when drag ends
      onDragEnd(x, y);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onMove, onDragEnd, x, y]);

  const handleMouseEnter = useCallback(() => {
    if (!isDragging) {
      setShowTooltip(true);
    }
  }, [isDragging]);

  const handleMouseLeave = useCallback(() => {
    if (!isDragging && !persistentTooltip) {
      setShowTooltip(false);
    }
  }, [isDragging, persistentTooltip]);

  if (!isVisible) return null;

  return (
    <g ref={cursorRef}>
      {/* Main cursor dot */}
      <circle
        cx={x}
        cy={y}
        r="6"
        fill={isOutsideHull ? "#ef4444" : "white"}
        stroke={isOutsideHull ? "#991b1b" : "#4B5563"}
        strokeWidth="2"
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
          transition: isDragging ? 'none' : 'all 0.2s ease'
        }}
        onMouseDown={handleMouseDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
      
      {/* Loading indicator */}
      {isLoading && (
        <circle
          cx={x}
          cy={y}
          r="10"
          fill="none"
          stroke={isOutsideHull ? "#ef4444" : "#6366F1"}
          strokeWidth="2"
          strokeDasharray="8,3"
          strokeLinecap="round"
          opacity="0.8"
          style={{ animation: 'spin 1.5s linear infinite', transformOrigin: `${x}px ${y}px` }}
        />
      )}
      
      {/* Crosshairs */}
      <g opacity="0.6">
        <line
          x1={x - 15}
          y1={y}
          x2={x - 8}
          y2={y}
          stroke={isOutsideHull ? "#ef4444" : "#4B5563"}
          strokeWidth="1"
        />
        <line
          x1={x + 8}
          y1={y}
          x2={x + 15}
          y2={y}
          stroke={isOutsideHull ? "#ef4444" : "#4B5563"}
          strokeWidth="1"
        />
        <line
          x1={x}
          y1={y - 15}
          x2={x}
          y2={y - 8}
          stroke={isOutsideHull ? "#ef4444" : "#4B5563"}
          strokeWidth="1"
        />
        <line
          x1={x}
          y1={y + 8}
          x2={x}
          y2={y + 15}
          stroke={isOutsideHull ? "#ef4444" : "#4B5563"}
          strokeWidth="1"
        />
      </g>

      {/* Tooltip */}
      {showTooltip && (
        <foreignObject
          x={x + 20}
          y={y - 60}
          width="280"
          height="120"
          style={{ overflow: 'visible' }}
        >
          <div
            className="bg-[var(--vscode-editorHoverWidget-background)] border border-[var(--vscode-editorHoverWidget-border)] rounded-lg shadow-xl p-3 text-sm text-[var(--vscode-editorHoverWidget-foreground)]"
            style={{ 
              position: 'relative',
              minWidth: '260px',
              maxWidth: '280px',
              zIndex: 1000
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-[var(--vscode-editorHoverWidget-foreground)]">
                NN Analet Generator
              </div>
              <button
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                onClick={() => onDragEnd(x, y)}
                title="Refresh at this position"
                aria-label="Refresh"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
                  <path d="M19.146 4.854l-1.489 1.489A8 8 0 1 0 12 20a8.094 8.094 0 0 0 7.371-4.886 1 1 0 1 0-1.842-.779A6.071 6.071 0 0 1 12 18a6 6 0 1 1 4.243-10.243l-1.39 1.39a.5.5 0 0 0 .354.854H19.5A.5.5 0 0 0 20 9.5V5.207a.5.5 0 0 0-.854-.353z"/>
                </svg>
              </button>
            </div>
            
            {isOutsideHull && (
              <div className="mb-2 p-2 bg-[var(--vscode-inputValidation-warningBackground)] border border-[var(--vscode-inputValidation-warningBorder)] rounded text-xs text-[var(--vscode-inputValidation-warningForeground)]">
                ⚠️ Cursor is outside the analysis space. Results may be less useful.
              </div>
            )}
            
            {isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-3 h-3 border-2 border-[var(--vscode-progressBar-background)] border-t-[var(--vscode-button-background)] rounded-full animate-spin"></div>
                <span className="text-xs opacity-75">Finding nearest neighbors & generating analet...</span>
              </div>
            ) : description ? (
              <div className="space-y-2">
                <div className="text-xs opacity-90 leading-relaxed">
                  {description}
                </div>
                <button
                  className="w-full bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] px-3 py-1 rounded text-xs hover:bg-[var(--vscode-button-hoverBackground)] transition-colors"
                  onClick={onGenerateAnalet}
                  title="Create this analet"
                >
                  Create analet
                </button>
              </div>
            ) : (
              <div className="text-xs opacity-75">
                Move cursor to generate analets from nearest neighbors
              </div>
            )}
            
            {/* Tooltip arrow */}
            <div 
              className="absolute -left-2 top-4 w-0 h-0"
              style={{
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderRight: '6px solid var(--vscode-editorHoverWidget-border)'
              }}
            ></div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}; 