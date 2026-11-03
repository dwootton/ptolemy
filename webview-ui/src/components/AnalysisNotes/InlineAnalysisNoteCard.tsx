import React, { useState, useEffect, useRef } from "react";
import { AnalysisNote } from '../../types/analet';
import { useMessageHandler } from '../../hooks/useMessageHandler';
import { ConceptualTextInput } from '../ConceptualStatements/ConceptualTextInput';

interface Variable {
  name: string;
  displayName: string;
  type: string;
}

interface ConceptualGroup {
  id: number;
  name: string;
  expanded: boolean;
  variables: string[];
}

interface InlineAnalysisNoteCardProps {
  note: AnalysisNote;
  level: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onSave: (updatedNote: AnalysisNote) => void;
  onCancel: () => void;
  variables?: Variable[];
  groups?: ConceptualGroup[];
  datasetData?: any[];
  profile?: any;
}

export const InlineAnalysisNoteCard: React.FC<InlineAnalysisNoteCardProps> = ({
  note,
  level,
  isExpanded,
  onToggleExpanded,
  onSave,
  onCancel,
  variables = [],
  groups = [],
  datasetData = [],
  profile
}) => {
  // Debug dataset variables
  const [content, setContent] = useState(note.content);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  const { sendMessage } = useMessageHandler();
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Track changes
  useEffect(() => {
    const contentChanged = content !== note.content;
    setHasChanges(contentChanged);
  }, [content, note.content]);

  // Reset form when note changes or expanded state changes
  useEffect(() => {
    if (isExpanded) {
      setContent(note.content);
      setHasChanges(false);
      // Focus content when expanding
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [note, isExpanded]);

  const handleSave = async () => {
    if (!content.trim()) return;

    setIsSubmitting(true);
    try {
      const updatedNote: AnalysisNote = {
        ...note,
        content: content.trim(),
        updatedAt: new Date().toISOString()
      };

      await sendMessage('update-analysis-note', {
        id: note.id,
        content: content.trim()
      });

      onSave(updatedNote);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save analysis note:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setContent(note.content);
    setHasChanges(false);
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const indentStyle = { paddingLeft: `${level * 16 + 8}px` };

  return (
    <div style={indentStyle} onKeyDown={handleKeyDown}>
      {/* Collapsed Header */}
      <div
        className={`
          group relative flex items-center min-h-[32px] px-2 py-1 text-sm cursor-pointer
          hover:bg-gray-700/50 transition-colors
          ${isExpanded ? 'bg-gray-700/30' : ''}
        `}
        onClick={onToggleExpanded}
      >
        {/* Expand/Collapse Icon */}
        <div className="flex-shrink-0 w-4 h-4 mr-2 flex items-center justify-center">
          <svg 
            className={`w-3 h-3 text-yellow-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="currentColor" 
            viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </div>

        {/* Note content preview */}
        <div className="flex-1 truncate text-gray-200">
          {note.content || `Note ${note.id}`}
        </div>

        {/* Last updated indicator */}
        <div className="flex-shrink-0 text-xs text-gray-500 ml-2">
          {new Date(note.updatedAt).toLocaleDateString()}
        </div>
      </div>

      {/* Expanded Editor */}
      {isExpanded && (
        <div className="mt-2 p-4 bg-gray-800/50 border border-gray-600 rounded-md space-y-4">
          {/* Content Editor */}
          <div>
            <label htmlFor={`note-content-${note.id}`} className="block text-sm font-medium text-gray-300 mb-2">
              Note Content
              <span className="text-gray-500 font-normal ml-2">
                Use @variable syntax to reference dataset variables
              </span>
            </label>
            
            <ConceptualTextInput
              value={content}
              onChange={setContent}
              variables={variables}
              groups={groups}
              datasetData={datasetData}
              profile={profile}
              placeholder="Write your analysis note here. Use @variable to reference dataset variables..."
              className="w-full"
              minHeight="150px"
              disabled={isSubmitting}
            />
            
            {/* Debug info for dataset variables */}
            {variables.length === 0 && (
              <div className="text-xs text-yellow-500 mt-1">
                ⚠️ No dataset variables available. Variables: {JSON.stringify(variables)}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors disabled:opacity-50"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
              disabled={!content.trim() || isSubmitting || !hasChanges}
            >
              {isSubmitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              )}
              Save Note
            </button>
          </div>

          {/* Keyboard Shortcuts Hint */}
          <div className="text-xs text-gray-500 text-right">
            Cmd+Enter to save • Escape to cancel
          </div>
        </div>
      )}
    </div>
  );
};