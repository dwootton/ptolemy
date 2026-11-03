import React, { useState } from 'react';
import { AnalysisNote } from '../../types/analet';
import { useMessageHandler } from '../../hooks/useMessageHandler';
import { InlineAnalysisNoteCard } from './InlineAnalysisNoteCard';

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

interface AnalysisNoteItemProps {
  note: AnalysisNote;
  level: number;
  isSelected?: boolean;
  isExpanded?: boolean;
  onClick: (event: React.MouseEvent) => void;
  onEdit?: (note: AnalysisNote) => void;
  onDelete?: (note: AnalysisNote) => void;
  onToggleExpanded?: () => void;
  variables?: Variable[];
  groups?: ConceptualGroup[];
  datasetData?: any[];
  profile?: any;
}

export const AnalysisNoteItem: React.FC<AnalysisNoteItemProps> = ({
  note,
  level,
  isSelected = false,
  isExpanded = false,
  onClick,
  onEdit,
  onDelete,
  onToggleExpanded,
  variables = [],
  groups = [],
  datasetData = [],
  profile
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const { sendMessage } = useMessageHandler();

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  const handleEdit = () => {
    setShowContextMenu(false);
    if (onToggleExpanded) {
      onToggleExpanded();
    } else if (onEdit) {
      onEdit(note);
    }
  };

  const handleDelete = async () => {
    setShowContextMenu(false);
    if (onDelete) {
      onDelete(note);
    } else {
      try {
        await sendMessage('delete-analysis-note', { id: note.id });
      } catch (error) {
        console.error('Failed to delete analysis note:', error);
      }
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (showContextMenu) {
      setShowContextMenu(false);
      return;
    }
    onClick(e);
  };

  const handleSave = (_updatedNote: AnalysisNote) => {
    // Note is already saved via sendMessage in InlineAnalysisNoteCard
    if (onToggleExpanded) {
      onToggleExpanded(); // Collapse after save
    }
  };

  const handleCancel = () => {
    if (onToggleExpanded) {
      onToggleExpanded(); // Collapse on cancel
    }
  };

  // Close context menu when clicking outside
  React.useEffect(() => {
    if (showContextMenu) {
      const handleClickOutside = () => setShowContextMenu(false);
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showContextMenu]);

  // If using inline editing, render the InlineAnalysisNoteCard
  if (onToggleExpanded) {
    return (
      <>
        <InlineAnalysisNoteCard
          note={note}
          level={level}
          isExpanded={isExpanded}
          onToggleExpanded={onToggleExpanded}
          onSave={handleSave}
          onCancel={handleCancel}
          variables={variables}
          groups={groups}
          datasetData={datasetData}
          profile={profile}
        />
        {/* Context Menu */}
        {showContextMenu && (
          <div
            className="fixed bg-gray-800 border border-gray-600 rounded-md shadow-lg py-1 z-50"
            style={{
              left: contextMenuPos.x,
              top: contextMenuPos.y,
              minWidth: '150px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              onClick={handleEdit}
            >
              {isExpanded ? 'Collapse Note' : 'Edit Note'}
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700 transition-colors"
              onClick={handleDelete}
            >
              Delete Note
            </button>
          </div>
        )}
      </>
    );
  }

  // Original compact view for backward compatibility
  const indentStyle = { paddingLeft: `${level * 16 + 8}px` };

  return (
    <>
      <div
        className={`
          group relative flex items-center min-h-[32px] px-2 py-1 text-sm cursor-pointer
          hover:bg-gray-700/50 transition-colors
          ${isSelected ? 'bg-blue-600/30 border-l-2 border-blue-500' : ''}
        `}
        style={indentStyle}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Note icon */}
        <div className="flex-shrink-0 w-4 h-4 mr-2 flex items-center justify-center">
          <svg 
            className="w-3 h-3 text-yellow-400" 
            viewBox="0 0 192 192" 
            fill="none"
            stroke="currentColor"
          >
            <g strokeWidth="12" strokeDasharray="none">
              <path 
                d="M-97.45 37.046h52.12zm0 23.074h65.31zm0 23.075h75.676zm0 23.075h75.676zm0 23.074h32.57z" 
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="none"
                transform="translate(155.578 12.805)"
              />
              <path 
                d="M157.068 54.9 127.729 22H40c-2.357 0-5 2.643-5 5v138c0 2.357 2.643 5 5 5h112c2.357 0 4.999-2.643 5-5z" 
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="none"
                transform="translate(-.034)"
              />
            </g>
          </svg>
        </div>

        {/* Note title */}
        <div className="flex-1 truncate text-gray-200">
          {note.content || `Note ${note.id}`}
        </div>

        {/* Last updated indicator */}
        <div className="flex-shrink-0 text-xs text-gray-500 ml-2">
          {new Date(note.updatedAt).toLocaleDateString()}
        </div>
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-600 rounded-md shadow-lg py-1 z-50"
          style={{
            left: contextMenuPos.x,
            top: contextMenuPos.y,
            minWidth: '150px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 transition-colors"
            onClick={handleEdit}
          >
            Edit Note
          </button>
          <button
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700 transition-colors"
            onClick={handleDelete}
          >
            Delete Note
          </button>
        </div>
      )}
    </>
  );
};