import React, { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { TreeNode } from '../../../services/HierarchyService';
import { AnalysisNote } from '../../../types/analet';
import { useMessageHandler } from '../../../hooks/useMessageHandler';
import { InlineAnalysisNoteCard } from '../../AnalysisNotes/InlineAnalysisNoteCard';

interface SharedSelectionLike {
  setHoveredAnalet?: (analetId: number | undefined) => void;
}

interface NoteItemProps {
  node: TreeNode;
  level: number;
  isSelected: boolean;
  isHovered?: boolean;
  isChildrenExpanded: boolean;
  isDetailsOpen: boolean;
  dropIndicator?: { position: 'above' | 'below' | 'inside' };
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick?: (event: React.MouseEvent) => void;
  onToggleChildrenExpand: () => void;
  onToggleDetails: () => void;
  sharedSelection?: SharedSelectionLike;
  isDragging?: boolean;
  previewIndentPx?: number;
  // Note-specific props for inline editing
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  variables?: any[];
  groups?: any[];
  datasetData?: any[];
  profile?: any;
}

export const NoteItem: React.FC<NoteItemProps> = (props) => {
  const note = props.node.data as AnalysisNote;
  const { sendMessage } = useMessageHandler();
  
  // Context menu state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  const handleDeleteNote = async () => {
    setShowContextMenu(false);
    
    try {
      await sendMessage('delete-analysis-note', { id: note.id });
    } catch (error) {
      console.error('❌ [NoteItem] Error deleting note:', error);
    }
  };

  const handleEditNote = () => {
    setShowContextMenu(false);
    if (props.onToggleExpanded) {
      props.onToggleExpanded();
    }
  };

  // Draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
  } = useDraggable({
    id: props.node.id,
    data: { type: 'note', node: props.node }
  });

  // Droppable (allow above/below/inside)
  const { setNodeRef: setDropRef } = useDroppable({
    id: props.node.id,
    data: { type: 'note', node: props.node }
  });

  // Combine refs
  const setNodeRef = (element: HTMLElement | null) => {
    setDragRef(element);
    setDropRef(element);
  };

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  // Keep icon aligned with peers; do not shift icon on preview. Only shift content text slightly when previewing inside.
  const basePadding = 12 + (props.level * 24);
  const paddingLeft = basePadding; 
  const showAboveIndicator = props.dropIndicator?.position === 'above';
  const showBelowIndicator = props.dropIndicator?.position === 'below';
  const showInsideIndicator = props.dropIndicator?.position === 'inside';
  const hoveredOutline = props.isHovered ? 'ring-1 ring-[var(--vscode-focusBorder)]' : '';
  const selectedTint = props.isSelected ? 'bg-yellow-400/10 border-2 border-yellow-400' : '';

  // Removed ringColor since we no longer use the blue circle selection ring

  // Note: We always render the note item, and show the editor below it when expanded

  return (
    <div>
      {/* Above drop indicator (indent with potential next level when previewing inside on this target) */}
      {showAboveIndicator && (
        <div className="h-0.5 bg-[#007ACC] mb-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}

      {/* Note item */}
      <div
        ref={setNodeRef}
        style={style}
        className={`
          group relative flex items-start gap-2 px-2 py-1 rounded text-sm cursor-pointer select-none
          hover:bg-[var(--vscode-list-hoverBackground)]
          ${showInsideIndicator ? 'bg-[#007ACC]/20 shadow-md shadow-blue-500/20 ring-1 ring-blue-500/50' : ''}
          ${selectedTint} ${hoveredOutline}
        `}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          props.onClick(e);
          // Let parent decide whether to toggle details
        }}
        onDoubleClick={(e) => {
          if (props.onDoubleClick) {
            props.onDoubleClick(e);
          }
        }}
        onContextMenu={handleContextMenu}
      >
        {/* Fixed chevron slot to keep alignment consistent */}
        <div style={{ paddingLeft: paddingLeft }}>
          <div className="mr-1 flex items-center justify-center" style={{ width: 20, height: 20 }}>
            {props.node.children.length > 0 ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  props.onToggleChildrenExpand();
                }}
                className="w-5 h-5 flex items-center justify-center hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
                title={props.isChildrenExpanded ? 'Collapse' : 'Expand'}
              >
                <svg 
                  className={`w-3 h-3 text-[var(--vscode-icon-foreground)] transition-transform ${props.isChildrenExpanded ? 'rotate-90' : ''}`}
                  viewBox="0 0 16 16" 
                  fill="currentColor"
                >
                  <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
              </button>
            ) : (
              <span className="inline-block" style={{ width: 20, height: 20 }} />
            )}
          </div>
        </div>

        {/* Note icon (no selection ring - selection is shown on container) */}
        <div
          className="relative flex-shrink-0"
          style={{ width: 16, height: 16, zIndex: transform ? 50 : undefined }}
        >
          <svg 
            className="w-3 h-3 text-yellow-400 absolute left-[2px] top-[2px]" 
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

        {/* Note title (shift text only when previewing inside on dragged row) */}
        {!props.isDetailsOpen ? (
          <span 
            className={`flex-1 text-xs min-w-0 truncate text-[var(--vscode-foreground)]`}
            style={props.previewIndentPx ? { marginLeft: props.previewIndentPx } : undefined}
            title={note.content || `Note ${note.id}`}
          >
            {note.content || `Note ${note.id}`}
          </span>
        ) : (
          // Note Card view when expanded
          <div className="flex-1 min-w-0">
            <div className="text-[var(--vscode-foreground)] text-xs font-medium mb-1 truncate" title={note.content || `Note ${note.id}`}>
              {note.content || `Note ${note.id}`}
            </div>
            <div className="mt-1 grid grid-cols-1 gap-3 p-2 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded" style={{ minHeight: 160 }}>
              <div>
                <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Note Content</div>
                <div className="mt-1 text-xs text-[var(--vscode-foreground)] max-h-24 overflow-y-auto pr-2">
                  {note.content || 'No content provided'}
                </div>
              </div>
              {note.createdAt && (
                <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                  Created: {new Date(note.createdAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Children count indicator */}
        {props.node.children.length > 0 && (
          <span className="text-xs text-[var(--vscode-descriptionForeground)] bg-yellow-500/20 px-1 rounded">
            {props.node.children.length}
          </span>
        )}
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <>
          {/* Backdrop to close menu */}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setShowContextMenu(false)}
          />
          
          {/* Context Menu */}
          <div
            className="fixed z-50 bg-[var(--vscode-menu-background)] border border-[var(--vscode-menu-border)] rounded shadow-lg py-1"
            style={{
              left: contextMenuPos.x,
              top: contextMenuPos.y,
              minWidth: '160px'
            }}
          >
            {/* Edit Note option */}
            <button
              onClick={handleEditNote}
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708L10.5 8.207l-3-3L12.146.146zM11.207 9L8 5.793 2.5 11.293V13.5a.5.5 0 0 0 .5.5h2.207L11.207 9zM1 11.793l6.5-6.5 3 3L4 14.793V11.793z"/>
              </svg>
              Edit Note
            </button>

            {/* Delete Note option */}
            <button
              onClick={handleDeleteNote}
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
              </svg>
              Delete Note
            </button>
          </div>
        </>
      )}

      {/* Expanded inline editor (shown below the note item when expanded) */}
      {props.isExpanded && props.onToggleExpanded && (
        <div className="mt-2" style={{ marginLeft: basePadding }}>
          <InlineAnalysisNoteCard
            note={note}
            level={props.level}
            isExpanded={props.isExpanded}
            onToggleExpanded={props.onToggleExpanded}
            onSave={() => {
              if (props.onToggleExpanded) {
                props.onToggleExpanded(); // Collapse after save
              }
            }}
            onCancel={() => {
              if (props.onToggleExpanded) {
                props.onToggleExpanded(); // Collapse on cancel
              }
            }}
            variables={props.variables || []}
            groups={props.groups || []}
            datasetData={props.datasetData || []}
            profile={props.profile}
          />
        </div>
      )}

      {/* Below drop indicator */}
      {showBelowIndicator && (
        <div className="h-0.5 bg-[#007ACC] mt-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}
    </div>
  );
};

// Local keyframes for the selection ring (reuse the same as analet)
if (typeof document !== 'undefined' && !document.getElementById('analet-list-pulse')) {
  const style = document.createElement('style');
  style.id = 'analet-list-pulse';
  style.textContent = `
  @keyframes pulse {
    0% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.12); opacity: 0.5; }
    100% { transform: scale(1); opacity: 0.8; }
  }`;
  document.head.appendChild(style);
}
