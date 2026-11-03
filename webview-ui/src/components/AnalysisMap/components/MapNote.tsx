/**
 * MapNote component for rendering standalone notes on the analysis map
 */

import React, { useCallback, useState } from 'react';
import { AnalysisNote } from '../../../types/analet';

interface MapNoteProps {
  note: AnalysisNote;
  onDragStart?: (note: AnalysisNote, event: React.MouseEvent) => void;
  onDragMove?: (note: AnalysisNote, position: { x: number; y: number }) => void;
  onDragEnd?: (note: AnalysisNote, position: { x: number; y: number }) => void;
  onClick?: (note: AnalysisNote) => void;
  onDoubleClick?: (note: AnalysisNote) => void;
  onRightClick?: (note: AnalysisNote, event: React.MouseEvent) => void;
  isSelected?: boolean;
  isDragging?: boolean;
  scale?: number; // current zoom scale to correct drag delta
}

export function MapNote({
  note,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClick,
  onDoubleClick,
  onRightClick,
  isSelected = false,
  isDragging = false,
  scale = 1,
}: MapNoteProps) {
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startPosition: { x: number; y: number } | null;
    offset: { x: number; y: number } | null;
  }>({
    isDragging: false,
    startPosition: null,
    offset: null,
  });
  // Ensure note has position
  if (!note.position) {
    console.warn('[note-debug] MapNote: note missing position', note);
    return null;
  }

  // Wrap text at 200px width (approximately 28-30 characters per line)
  const wrapText = (text: string, maxCharsPerLine: number = 28): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      
      if (testLine.length <= maxCharsPerLine) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          // Single word is longer than max chars - break it
          lines.push(word);
          currentLine = '';
        }
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  };

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const startPosition = {
      x: event.clientX,
      y: event.clientY,
    };

    let hasDragged = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startPosition.x;
      const deltaY = moveEvent.clientY - startPosition.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Start drag if moved more than 5 pixels
      if (distance > 5) {
        hasDragged = true;
        
        if (!dragState.isDragging) {
          setDragState({
            isDragging: true,
            startPosition,
            offset: null,
          });
          
          if (onDragStart) {
            onDragStart(note, event);
          }
        }

        // Update position during drag
        if (onDragMove) {
          const newPosition = {
            x: note.position!.x + deltaX / (scale || 1),
            y: note.position!.y + deltaY / (scale || 1),
          };
          onDragMove(note, newPosition);
        }
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      if (hasDragged) {
        // Was a drag
        const deltaX = upEvent.clientX - startPosition.x;
        const deltaY = upEvent.clientY - startPosition.y;
        
        if (onDragEnd) {
          const newPosition = {
            x: note.position!.x + deltaX / (scale || 1),
            y: note.position!.y + deltaY / (scale || 1),
          };
          onDragEnd(note, newPosition);
        }
      } else {
        // Was a click
        if (onClick) {
          onClick(note);
        }
      }

      setDragState({
        isDragging: false,
        startPosition: null,
        offset: null,
      });

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [note, onDragStart, onDragMove, onDragEnd, onClick, dragState]);

  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (onDoubleClick) {
      onDoubleClick(note);
    }
  }, [note, onDoubleClick]);

  const handleRightClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (onRightClick) {
      onRightClick(note, event);
    }
  }, [note, onRightClick]);

  const wrappedLines = wrapText(note.content);
  const lineHeight = 16;
  const noteWidth = 200;

  return (
    <div
      style={{
        position: 'absolute',
        left: note.position.x, // Anchor at click position (center)
        top: note.position.y,  // Anchor at click position (center)
        transform: `translate(-50%, -50%) ${isDragging ? 'scale(1.02)' : 'scale(1)'}`,
        width: noteWidth,
        color: '#FFD700', // Match analysis note gold
        fontSize: '12px',
        lineHeight: `${lineHeight}px`,
        fontFamily: 'var(--vscode-editor-font-family)',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        zIndex: isSelected ? 1001 : 1000,
        transition: 'none',
        textAlign: 'center',
        textShadow: isSelected 
          ? '0 0 8px rgba(255, 247, 204, 0.9), 0 0 3px rgba(255, 247, 204, 0.7)'
          : '0 0 3px rgba(0, 0, 0, 0.8)', // Dark outline for readability
        fontWeight: 'bold',
        opacity: 0.6,
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleRightClick}
      title={`Note: ${note.content.length > 50 ? note.content.substring(0, 50) + '...' : note.content}`}
    >
      {/* Just the note content, no background or borders */}
      {wrappedLines.map((line, index) => (
        <div
          key={index}
          style={{
            marginBottom: index < wrappedLines.length - 1 ? '2px' : '0',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
