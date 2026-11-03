import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TreeNode } from '../../services/HierarchyService';

interface HierarchyCursorProps {
  currentPath: string[];
  currentDepth: number;
  parentContext?: TreeNode;
  siblingContext: TreeNode[];
  ancestorContext: TreeNode[];
  ordinalDistances: Array<{
    targetId: string;
    targetTitle: string;
    targetKind: 'analet' | 'bearing' | 'note';
    distance: number;
    relationship: 'sibling' | 'ancestor' | 'descendant';
    description: string;
  }>;
  previewIdea?: string;
  isLoading: boolean;
  onPathChange: (newPath: string[]) => void;
  onGenerateAnalet: (idea: string, path: string[]) => void;
  onMove: (direction: 'up' | 'down' | 'left' | 'right') => void;
  isVisible: boolean;
  persistentTooltip?: boolean;
}

export const HierarchyCursor: React.FC<HierarchyCursorProps> = ({
  currentPath,
  parentContext,
  siblingContext,
  ordinalDistances,
  previewIdea,
  isLoading,
  onGenerateAnalet,
  onMove,
  isVisible,
  persistentTooltip = true
}) => {
  const [showTooltip, setShowTooltip] = useState(persistentTooltip);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const cursorRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Update tooltip visibility when persistentTooltip changes
  useEffect(() => {
    if (persistentTooltip) {
      setShowTooltip(true);
    }
  }, [persistentTooltip]);

  const handleMouseEnter = useCallback(() => {
    if (!isDragging) {
      setShowTooltip(true);
    }
  }, [isDragging]);

  const handleMouseLeave = useCallback(() => {
    if (!persistentTooltip && !isDragging) {
      setShowTooltip(false);
    }
  }, [persistentTooltip, isDragging]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    const rect = cursorRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragStartRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    setIsDragging(true);
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current) return;
      
      setDragPosition({
        x: event.clientX - dragStartRef.current.x,
        y: event.clientY - dragStartRef.current.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      if (persistentTooltip) {
        setShowTooltip(true);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, persistentTooltip]);

  const handleGenerateAnalet = useCallback(() => {
    if (!previewIdea || isLoading) return;
    onGenerateAnalet(previewIdea, currentPath);
  }, [previewIdea, isLoading, onGenerateAnalet, currentPath]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        onMove('up');
        break;
      case 'ArrowDown':
        event.preventDefault();
        onMove('down');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        onMove('left');
        break;
      case 'ArrowRight':
        event.preventDefault();
        onMove('right');
        break;
      case 'Enter':
        event.preventDefault();
        handleGenerateAnalet();
        break;
      case 'Escape':
        event.preventDefault();
        setShowTooltip(false);
        break;
    }
  }, [onMove, handleGenerateAnalet]);

  if (!isVisible) return null;

  const breadcrumbPath = currentPath.join(' > ');
  const parentTitle = parentContext?.title || 'Root';
  const siblingCount = siblingContext.length;

  return (
    <div
      ref={cursorRef}
      className="hierarchy-cursor"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      style={{
        position: isDragging ? 'fixed' : 'relative',
        left: isDragging ? dragPosition.x : 'auto',
        top: isDragging ? dragPosition.y : 'auto',
        display: 'inline-block',
        cursor: isDragging ? 'grabbing' : 'grab',
        outline: 'none',
        zIndex: isDragging ? 1000 : 10,
        opacity: isDragging ? 0.8 : 1,
        transition: isDragging ? 'none' : 'all 0.2s ease'
      }}
    >
      {/* Main cursor indicator - ghost-like appearance */}
      <div
        className="hierarchy-cursor-indicator"
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: 'white',
          border: '2px solid #4B5563',
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.5)',
          position: 'relative',
          zIndex: 10,
          filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2))'
        }}
      >
        {/* Inner dot */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: isLoading ? '#6366F1' : '#10B981',
            opacity: 0.9
          }}
        />
        
        {/* Loading indicator */}
        {isLoading && (
          <div
            className="hierarchy-cursor-loading"
            style={{
              position: 'absolute',
              top: '-6px',
              left: '-6px',
              width: '28px',
              height: '28px',
              border: '2px solid #6366F1',
              borderTop: '2px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              opacity: 0.7
            }}
          />
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && !isDragging && (
        <div
          className="hierarchy-cursor-tooltip"
          style={{
            position: 'absolute',
            top: '-100px',
            left: '25px',
            minWidth: '320px',
            maxWidth: '420px',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid rgba(75, 85, 99, 0.3)',
            borderRadius: '8px',
            padding: '14px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8)',
            zIndex: 1000,
            fontSize: '12px',
            lineHeight: '1.4',
            backdropFilter: 'blur(8px)',
            color: '#374151'
          }}
        >
          <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#1F2937' }}>
            Hierarchy Cursor
          </div>
          
          <div style={{ marginBottom: '6px', color: '#6B7280' }}>
            <strong>Path:</strong> {breadcrumbPath}
          </div>
          
          <div style={{ marginBottom: '6px', color: '#6B7280' }}>
            <strong>Parent:</strong> {parentTitle}
          </div>
          
          <div style={{ marginBottom: '6px', color: '#6B7280' }}>
            <strong>Siblings:</strong> {siblingCount} items
          </div>

          {ordinalDistances.length > 0 && (
            <div style={{ marginBottom: '6px', color: '#6B7280' }}>
              <strong>Ordinal Relationships:</strong>
              <div style={{ marginTop: '4px', fontSize: '11px' }}>
                {ordinalDistances.slice(0, 3).map((distance, index) => (
                  <div key={index} style={{ marginBottom: '2px', color: '#9CA3AF' }}>
                    • {distance.description}
                  </div>
                ))}
                {ordinalDistances.length > 3 && (
                  <div style={{ fontStyle: 'italic', color: '#9CA3AF' }}>
                    ... and {ordinalDistances.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )}

          {previewIdea && (
            <div style={{ marginTop: '8px', padding: '10px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <div style={{ marginBottom: '4px', fontWeight: 'bold', color: '#059669' }}>
                Generated Idea:
              </div>
              <div style={{ color: '#047857', fontStyle: 'italic' }}>
                "{previewIdea}"
              </div>
            </div>
          )}

          <div style={{ marginTop: '8px', fontSize: '11px', color: '#9CA3AF' }}>
            <div>🖱️ Drag to move • ⌨️ Arrow keys to navigate</div>
            <div>⏎ Press Enter to create analet • ⎋ Press Escape to hide</div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
