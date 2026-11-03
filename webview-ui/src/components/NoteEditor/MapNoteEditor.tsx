import React, { useState, useCallback } from "react";
import { Analet } from "../../types/analet";
import { useMessageHandler } from "../../hooks/useMessageHandler";
import { ConceptualTextInput } from "../ConceptualStatements/ConceptualTextInput";
import { HierarchyService } from "../../services/HierarchyService";

interface MapNoteEditorProps {
  isVisible: boolean;
  targetAnalet: Analet | null;
  initialContent: string;
  onSave: () => void;
  onCancel: () => void;
  variables?: Array<{name: string; displayName: string; type: string}>;
  groups?: Array<{id: number; name: string; expanded: boolean; variables: string[]}>;
  datasetData?: any[];
}

export const MapNoteEditor: React.FC<MapNoteEditorProps> = ({
  isVisible,
  targetAnalet,
  initialContent,
  onSave,
  onCancel,
  variables = [],
  groups = [],
  datasetData = []
}) => {
  const [noteContent, setNoteContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const { sendMessage, onMessage } = useMessageHandler();
  const hierarchyService = HierarchyService.getInstance();

  const handleSave = useCallback(async () => {
    if (!targetAnalet || !noteContent.trim() || isSaving) return;

    setIsSaving(true);
    try {
      // Create a blank note first
      const cleanup = onMessage('create-blank-note', async (data: any) => {
        if (data?.note) {
          const noteId = `note-${data.note.id}`;
          const analetNodeId = `analet-${targetAnalet.id}`;

          // Update the note content
          const updateCleanup = onMessage('update-analysis-note', () => {
            updateCleanup();
          });
          sendMessage('update-analysis-note', {
            id: data.note.id,
            content: noteContent.trim()
          });

          // Create the edge using hierarchy service
          const edgeCreated = await hierarchyService.addEdge(analetNodeId, noteId);

          if (!(edgeCreated)) {
            console.error('Failed to create edge for note');
          }

          onSave();
        } else {
          console.error('Failed to create note');
        }

        setIsSaving(false);
        cleanup();
      });

      // Send the request to create a blank note
      sendMessage('create-blank-note', {});
    } catch (error) {
      console.error('❌ [MapNoteEditor] Error saving note:', error);
      setIsSaving(false);
    }
  }, [targetAnalet, noteContent, isSaving, sendMessage, onMessage, hierarchyService, onSave]);

  const handleCancel = useCallback(() => {
    setNoteContent('');
    onCancel();
  }, [onCancel]);

  if (!isVisible || !targetAnalet) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        right: '20px',
        maxWidth: '800px',
        margin: '0 auto',
        backgroundColor: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '6px',
        padding: '12px',
        zIndex: 10000,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}
    >
      <div className="flex items-center gap-2 mb-2 text-sm text-[var(--vscode-descriptionForeground)]">
        <span>📝</span>
        <span>Adding note to analet {targetAnalet.id}: {targetAnalet.statement.slice(0, 50)}...</span>
      </div>

      <ConceptualTextInput
        value={noteContent}
        onChange={setNoteContent}
        variables={variables}
        groups={groups}
        datasetData={datasetData}
        placeholder="Write your note here... Use @variable to reference dataset columns"
        className="mb-3"
        minHeight="80px"
      />

      <div className="flex justify-between items-center">
        <div className="text-xs text-[var(--vscode-descriptionForeground)]">
          Use @variable to reference dataset columns • Rendered outside map for full visibility
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-3 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!noteContent.trim() || isSaving}
            className="px-3 py-1 text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {isSaving ? (
              <>
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"></div>
                Saving...
              </>
            ) : (
              'Save Note'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
