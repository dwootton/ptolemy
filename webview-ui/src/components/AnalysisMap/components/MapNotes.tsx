/**
 * MapNotes component for rendering all standalone map notes
 */

import React from 'react';
import { AnalysisNote } from '../../../types/analet';
import { MapNote } from './MapNote';

interface MapNotesProps {
  notes: AnalysisNote[];
  selectedNoteId: number | null;
  onNoteClick?: (note: AnalysisNote) => void;
  onNoteDoubleClick?: (note: AnalysisNote) => void;
  onNoteRightClick?: (note: AnalysisNote, event: React.MouseEvent) => void;
  onNoteDragStart?: (note: AnalysisNote, event: React.MouseEvent) => void;
  onNoteDragMove?: (note: AnalysisNote, position: { x: number; y: number }) => void;
  onNoteDragEnd?: (note: AnalysisNote, position: { x: number; y: number }) => void;
  scale?: number;
}

export function MapNotes({
  notes,
  selectedNoteId,
  onNoteClick,
  onNoteDoubleClick,
  onNoteRightClick,
  onNoteDragStart,
  onNoteDragMove,
  onNoteDragEnd,
  scale = 1,
}: MapNotesProps) {
  // Filter to only map notes with valid positions
  const validMapNotes = notes.filter(note => 
    note.position && 
    typeof note.position.x === 'number' && 
    typeof note.position.y === 'number' &&
    !note.parentId &&
    note.status === 'active'
  );
  return (
    <>
      {validMapNotes.map(note => {
        return (
          <MapNote
            key={note.id}
            note={note}
            isSelected={selectedNoteId === note.id}
            onClick={onNoteClick}
            onDoubleClick={onNoteDoubleClick}
            onRightClick={onNoteRightClick}
            onDragStart={onNoteDragStart}
            onDragMove={onNoteDragMove}
            onDragEnd={onNoteDragEnd}
            scale={scale}
          />
        );
      })}
    </>
  );
}
