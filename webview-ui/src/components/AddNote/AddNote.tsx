import React, { useState, useRef, useCallback } from "react";
import { useMessageHandler } from '../../hooks/useMessageHandler';
import { HierarchyService } from '../../services/HierarchyService';

interface AddNoteProps {
  selectedAnaletId?: number | null;
  onNoteCreated?: () => void;
  isVisible?: boolean;
}

export const AddNote: React.FC<AddNoteProps> = ({
  selectedAnaletId,
  onNoteCreated,
  isVisible = true
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { sendMessage, onMessage } = useMessageHandler();
  const hierarchyService = HierarchyService.getInstance();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCreateNote = useCallback(async () => {
    if (!noteText.trim() || isCreating) return;

    setIsCreating(true);

    try {
      // Create a blank note first
      const cleanup = onMessage('create-blank-note', async (data: any) => {
        if (data?.note) {
          const noteId = `note-${data.note.id}`;

          // Update the note content
          const updateCleanup = onMessage('update-analysis-note', () => {
            updateCleanup();
          });

          sendMessage('update-analysis-note', {
            id: data.note.id,
            content: noteText.trim()
          });

          // If we have a selected analet, create the hierarchy edge
          if (selectedAnaletId) {
            const analetNodeId = `analet-${selectedAnaletId}`;
            const edgeCreated = await hierarchyService.addEdge(analetNodeId, noteId);

            if (!(edgeCreated)) {
              console.error('Failed to create edge for note');
            }
          }

          // Reset form
          setNoteText('');
          setIsExpanded(false);
          setIsCreating(false);

          if (onNoteCreated) {
            onNoteCreated();
          }
        } else {
          console.error('Failed to create note');
          setIsCreating(false);
        }

        // Clean up the listener
        cleanup();
      });

      // Send the request to create a blank note
      sendMessage('create-blank-note', {});
    } catch (error) {
      console.error('Error creating note:', error);
      setIsCreating(false);
    }
  }, [noteText, selectedAnaletId, isCreating, sendMessage, onMessage, hierarchyService, onNoteCreated]);

  const handleCancel = useCallback(() => {
    setNoteText('');
    setIsExpanded(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCreateNote();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleCreateNote, handleCancel]);

  if (!isVisible) return null;

  return (
    <div className="bg-[var(--vscode-editor-background)] border-y border-[var(--vscode-panel-border)] px-3 py-2">
      {!isExpanded ? (
        <button
          onClick={() => {
            setIsExpanded(true);
            // Focus textarea after expansion
            setTimeout(() => textareaRef.current?.focus(), 0);
          }}
          className="w-full text-left px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)] rounded transition-colors flex items-center gap-2"
        >
          <span>📝</span>
          <span>
            {selectedAnaletId
              ? "Add a note to selected analet..."
              : "Add a new analysis note..."}
          </span>
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-[var(--vscode-descriptionForeground)]">
            <span>📝</span>
            <span>
              {selectedAnaletId
                ? `Adding note to analet ${selectedAnaletId}`
                : "Creating new analysis note"}
            </span>
          </div>

          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write your note here... (Cmd/Ctrl+Enter to save, Esc to cancel)"
            className="w-full min-h-[80px] max-h-[200px] resize-y bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-2 text-[var(--vscode-input-foreground)] placeholder-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
            autoFocus
          />

          <div className="flex justify-between items-center">
            <div className="text-xs text-[var(--vscode-descriptionForeground)]">
              Cmd/Ctrl+Enter to save • Esc to cancel
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={isCreating}
                className="px-3 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNote}
                disabled={!noteText.trim() || isCreating}
                className="px-3 py-1 text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {isCreating ? (
                  <>
                    <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"></div>
                    Creating...
                  </>
                ) : (
                  'Create Note'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
