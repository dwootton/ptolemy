/**
 * MapNoteEditor component for creating and editing map notes with live preview
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AnalysisNote } from '../../../types/analet';
import { useMessageHandler } from '../../../hooks/useMessageHandler';

interface MapNoteEditorProps {
  isVisible: boolean;
  position: { x: number; y: number };
  note?: AnalysisNote; // Existing note for editing, undefined for new note
  onSave?: (note: AnalysisNote) => void;
  onCancel?: () => void;
  onPreviewUpdate?: (content: string, position: { x: number; y: number }) => void;
}

export function MapNoteEditor({
  isVisible,
  position,
  note,
  onSave,
  onCancel,
  onPreviewUpdate,
}: MapNoteEditorProps) {
  const [content, setContent] = useState(note?.content || '');
  const [isSaving, setIsSaving] = useState(false);
  const { sendMessage, onMessage } = useMessageHandler();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Debug log when props change
  React.useEffect(() => {
  }, [isVisible, position, note]);

  // Focus textarea and reset content when editor becomes visible
  useEffect(() => {
    if (isVisible) {
      // Reset content for new notes
      if (!note) {
        setContent('');
      }
      // Focus textarea
      if (textareaRef.current) {
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    }
  }, [isVisible, note]);

  // Reset content when note changes or when editor becomes visible for a new note
  useEffect(() => {
    if (isVisible) {
      setContent(note?.content || '');
    }
  }, [note, isVisible]);

  // Update preview when content changes
  useEffect(() => {
    if (onPreviewUpdate && content.trim()) {
      onPreviewUpdate(content, position);
    }
  }, [content, position, onPreviewUpdate]);

  const handleSave = useCallback(async () => {
    if (!content.trim() || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      if (note) {
        // Update existing note
        await sendMessage('update-analysis-note', {
          id: note.id,
          content: content.trim(),
          position: position,
        });
        
        const updatedNote: AnalysisNote = {
          ...note,
          content: content.trim(),
          position: position,
          updatedAt: new Date().toISOString(),
        };
        onSave?.(updatedNote);
      } else {
        // Create new map note - let parent component handle the message sending
        const newNote: AnalysisNote = {
          id: 0, // Temporary ID, will be set by backend
          content: content.trim(),
          type: 'note',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          position: position,
        };
        onSave?.(newNote);
      }
    } catch (error) {
      console.error('[note-debug] Failed to save map note:', error);
    } finally {
      setIsSaving(false);
    }
  }, [content, position, note, isSaving, sendMessage, onMessage, onSave]);

  const handleCancel = useCallback(() => {
    setContent(note?.content || '');
    onCancel?.();
  }, [note, onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  // Wrap text to preview how it will appear (28-30 chars per line)
  const wrapTextPreview = (text: string): string[] => {
    if (!text.trim()) return ['Enter note text...'];
    
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    const maxCharsPerLine = 28;

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      
      if (testLine.length <= maxCharsPerLine) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
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

  if (!isVisible) return null;

  const previewLines = wrapTextPreview(content);
  const lineHeight = 16;
  const padding = 8;
  const previewHeight = previewLines.length * lineHeight + padding * 2 + 20; // +20 for header
  const previewWidth = 200;

  return (
    <>
      {/* Live preview overlay */}
      <div
        style={{
          position: 'absolute',
          left: position.x - previewWidth / 2,
          top: position.y - previewHeight / 2,
          width: previewWidth,
          minHeight: previewHeight,
          backgroundColor: 'rgba(45, 27, 0, 0.7)', // Slightly transparent
          border: '2px dashed #FFD700',
          borderRadius: '6px',
          padding: `${padding}px`,
          color: '#FFF8DC',
          fontSize: '12px',
          lineHeight: `${lineHeight}px`,
          fontFamily: 'var(--vscode-editor-font-family)',
          zIndex: 999,
          pointerEvents: 'none',
          animation: 'pulse 2s ease-in-out infinite',
        }}
      >
        {/* Preview header */}
        <div style={{
          textAlign: 'center',
          fontWeight: 'bold',
          fontSize: '11px',
          color: '#FFD700',
          marginBottom: '4px',
          opacity: 0.8,
        }}>
          📝 Note Preview
        </div>

        {/* Preview content */}
        <div style={{ textAlign: 'center' }}>
          {previewLines.map((line, index) => (
            <div
              key={index}
              style={{
                marginBottom: index < previewLines.length - 1 ? '2px' : '0',
                opacity: content.trim() ? 1 : 0.5,
                fontStyle: content.trim() ? 'normal' : 'italic',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* Editor modal */}
      <div
        style={{
          position: 'fixed',
          left: Math.max(20, Math.min(position.x - 200, window.innerWidth - 420)), // Center on x position, clamp to viewport
          top: Math.max(20, Math.min(position.y + 50, window.innerHeight - 200)), // Below click position, clamp to viewport
          width: Math.min(400, Math.max(300, window.innerWidth - 40)), // Responsive width: min 300px, max 400px, with 20px margin
          maxWidth: '90vw', // Never exceed 90% of viewport width
          backgroundColor: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '8px',
          padding: '16px',
          zIndex: 10000,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-3 text-sm text-[var(--vscode-descriptionForeground)]">
          <span>📝</span>
          <span>
            {note ? 'Edit map note' : 'Add note to map'} at position ({Math.round(position.x)}, {Math.round(position.y)})
          </span>
        </div>

        {/* Content input */}
        <div className="mb-4">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write your note here..."
            className="w-full px-3 py-2 bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded text-[var(--vscode-input-foreground)] placeholder-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder)] focus:border-transparent resize-none"
            rows={3}
            disabled={isSaving}
            style={{
              fontSize: '13px',
              fontFamily: 'var(--vscode-editor-font-family)',
            }}
          />
          <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
            Text will wrap at 200px width. Press Ctrl+Enter to save, Esc to cancel.
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center">
          <div className="text-xs text-[var(--vscode-descriptionForeground)]">
            {content.length} characters
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="px-3 py-2 text-sm bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] border border-[var(--vscode-button-border)] rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!content.trim() || isSaving}
              className="px-3 py-2 text-sm bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving && (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              )}
              {note ? 'Update Note' : 'Create Note'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
