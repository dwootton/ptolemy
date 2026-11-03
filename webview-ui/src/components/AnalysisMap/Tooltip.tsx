import React from 'react';
import { Analet, AnalysisNote } from '../../types/analet';

interface TooltipProps {
  analet: Analet;
  x: number;
  y: number;
  notes?: AnalysisNote[];
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onNoteEdit?: (note: AnalysisNote) => void;
}

export const Tooltip: React.FC<TooltipProps> = ({ analet, x, y, notes = [], onMouseEnter, onMouseLeave, onNoteEdit }) => {
  const maxCharsPerLine = 40;
  
  // Helper function to wrap text into lines
  const wrapText = (text: string) => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxCharsPerLine) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines;
  };

  // Prepare content sections
  const shortNameLines = analet.shortName ? wrapText(analet.shortName) : [];
  const statementLines = wrapText(analet.statement);
  
  // Show shortName if available, otherwise show statement
  const showBothSections = analet.shortName && analet.statement !== analet.shortName;
  const analetLines = showBothSections 
    ? [...shortNameLines, '—', ...statementLines]
    : (analet.shortName ? shortNameLines : statementLines);

  // Prepare notes section with mapping of rendered lines to a specific note index
  const notesLines: string[] = [];
  const lineToNoteIndex: number[] = [];
  if (notes.length > 0) {
    notesLines.push('—'); // Separator
    notesLines.push('📝 Notes:');
    lineToNoteIndex.push(-1, -1);
    notes.slice(0, 3).forEach(note => { // Show max 3 notes
      const noteContent = note.content || 'Empty note';
      const noteLines = wrapText(noteContent);
      // Show first 2 lines of each note
      const slice = noteLines.slice(0, 2);
      notesLines.push(...slice);
      slice.forEach(() => lineToNoteIndex.push(notes.indexOf(note)));
      if (noteLines.length > 2) {
        notesLines.push('...');
        lineToNoteIndex.push(notes.indexOf(note));
      }
    });
    if (notes.length > 3) {
      notesLines.push(`... and ${notes.length - 3} more notes`);
      lineToNoteIndex.push(-1);
    }
  }

  const allLines = [...analetLines, ...notesLines];

  const lineHeight = 16;
  const padding = 12;
  const tooltipHeight = allLines.length * lineHeight + padding * 2;
  const tooltipWidth = Math.max(...allLines.map(line => line.length)) * 7 + padding * 2;

  return (
    <div
      style={{
        position: 'absolute',
        left: x - tooltipWidth / 2,
        top: y - tooltipHeight - 20, // 20px above the analet
        width: tooltipWidth,
        height: tooltipHeight,
        backgroundColor: '#374151',
        border: '1px solid #6b7280',
        borderRadius: '8px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
        padding: `${padding}px`,
        color: '#f9fafb',
        fontSize: '12px',
        lineHeight: `${lineHeight}px`,
        pointerEvents: 'auto',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        cursor: 'pointer'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {allLines.map((line, index) => {
        const isShortName = showBothSections && index < shortNameLines.length;
        const isSeparator = line === '—';
        const isNotesHeader = line === '📝 Notes:';
        const isInNotesSection = index >= analetLines.length && notesLines.length > 0;
        const mappedIdx = isInNotesSection ? lineToNoteIndex[index - analetLines.length] : -1;
        
        return (
          <div 
            key={index} 
            style={{ 
              textAlign: 'center',
              fontWeight: isShortName || isNotesHeader ? 'bold' : 'normal',
              opacity: isSeparator ? 0.5 : 1,
              fontSize: isShortName ? '13px' : '12px',
              marginBottom: isSeparator ? '4px' : '0',
              color: isNotesHeader ? '#FFD700' : '#f9fafb',
              cursor: isInNotesSection && mappedIdx >= 0 ? 'pointer' : 'default'
            }}
            onDoubleClick={mappedIdx >= 0 && onNoteEdit ? () => onNoteEdit(notes[mappedIdx]) : undefined}
            title={mappedIdx >= 0 ? 'Double-click to edit this note' : undefined}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};