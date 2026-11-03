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

interface AnalysisNoteEditorProps {
  isOpen: boolean;
  onClose: () => void;
  note?: AnalysisNote | null;
  variables?: Variable[];
  groups?: ConceptualGroup[];
  datasetData?: any[];
  profile?: any;
}


export const AnalysisNoteEditor: React.FC<AnalysisNoteEditorProps> = ({
  isOpen,
  onClose,
  note,
  variables = [],
  groups = [],
  datasetData = [],
  profile
}) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { sendMessage } = useMessageHandler();
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Initialize form when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.content || '');
      setBody('');
      setTags(note.tags || []);
    } else {
      setTitle('');
      setBody('');
      setTags([]);
    }
  }, [note]);

  // Focus title input when modal opens
  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    setIsSubmitting(true);
    try {
      if (note) {
        // Update existing note
        await sendMessage('update-analysis-note', {
          id: note.id,
          title: title.trim(),
          body: body.trim(),
          tags
        });
      } else {
        // Create new note
        await sendMessage('create-analysis-note', {
          title: title.trim(),
          body: body.trim(),
          tags
        });
      }
      onClose();
    } catch (error) {
      console.error('Failed to save analysis note:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onKeyDown={handleKeyDown}>
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">
            {note ? 'Edit Analysis Note' : 'Create Analysis Note'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            disabled={isSubmitting}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-300 mb-2">
              Title
            </label>
            <input
              ref={titleInputRef}
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter a descriptive title for your note..."
              required
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="body" className="block text-sm font-medium text-gray-300 mb-2">
              Body
              <span className="text-gray-500 font-normal ml-2">
                Use @variable syntax to reference dataset variables
              </span>
            </label>
            
            <ConceptualTextInput
              value={body}
              onChange={setBody}
              variables={variables}
              groups={groups}
              datasetData={datasetData}
              profile={profile}
              placeholder="Write your analysis note here. Use @variable to reference dataset variables..."
              className="w-full"
              minHeight="200px"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Tags (optional)
            </label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagInputKeyDown}
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add a tag..."
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50"
                  disabled={!tagInput.trim() || isSubmitting}
                >
                  Add
                </button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-600 text-white text-sm rounded-md"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-gray-300 hover:text-white ml-1"
                        disabled={isSubmitting}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </form>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors disabled:opacity-50"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
            disabled={!title.trim() || !body.trim() || isSubmitting}
          >
            {isSubmitting && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            )}
            {note ? 'Update Note' : 'Create Note'}
          </button>
        </div>
      </div>
    </div>
  );
};