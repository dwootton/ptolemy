import React, { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { TreeNode } from '../../../services/HierarchyService';
import { Bearing } from '../../../types/analet';

interface NewBearingItemProps {
  node: TreeNode;
  level: number;
  isSelected: boolean;
  isExpanded: boolean;
  dropIndicator?: { position: 'above' | 'below' | 'inside' };
  onClick: (event: React.MouseEvent) => void;
  onToggleExpand: () => void;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  previewIndentPx?: number;
}

export const NewBearingItem: React.FC<NewBearingItemProps> = (props) => {
  const bearing = props.node.data as Bearing;
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(props.node.title);
  
  // Draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
  } = useDraggable({
    id: props.node.id,
    data: { type: 'bearing', node: props.node }
  });

  // Droppable
  const {
    setNodeRef: setDropRef,
  } = useDroppable({
    id: props.node.id,
    data: { type: 'bearing', node: props.node }
  });

  // Combine refs
  const setNodeRef = (element: HTMLElement | null) => {
    setDragRef(element);
    setDropRef(element);
  };

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const basePadding = 12 + (props.level * 24);
  const paddingLeft = basePadding;
  const showAboveIndicator = props.dropIndicator?.position === 'above';
  const showBelowIndicator = props.dropIndicator?.position === 'below';
  const showInsideIndicator = props.dropIndicator?.position === 'inside';

  const handleSubmitEdit = async () => {
    if (editName.trim() && editName !== props.node.title) {
      await props.onRename(editName.trim());
    }
    setIsEditing(false);
    setEditName(props.node.title);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditName(props.node.title);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmitEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <div>
      {/* Above drop indicator */}
      {showAboveIndicator && (
        <div className="h-0.5 bg-[#007ACC] mb-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}

      {/* Bearing item */}
      <div
        ref={setNodeRef}
        style={style}
        className={`
          group relative flex items-start gap-2 px-2 py-1 rounded text-sm cursor-pointer select-none
          hover:bg-[var(--vscode-list-hoverBackground)]
          ${showInsideIndicator ? 'bg-[#007ACC]/20 shadow-md shadow-blue-500/20 ring-1 ring-blue-500/50' : ''}
          ${props.isSelected ? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]' : ''}
        `}
        {...attributes}
        {...listeners}
        onClick={props.onClick}
      >
        {/* Fixed chevron slot */}
        <div style={{ paddingLeft: paddingLeft }}>
          <div className="mr-1" style={{ width: 12, height: 12 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleExpand();
              }}
              className="w-3 h-3 flex items-center justify-center hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
            >
              <svg 
                className={`w-2 h-2 text-[var(--vscode-icon-foreground)] transition-transform ${props.isExpanded ? 'rotate-90' : ''}`}
                viewBox="0 0 16 16" 
                fill="currentColor"
              >
                <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" fill="none"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Bearing icon (red compass) */}
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="1.5" fill="none"/>
          <path d="M15.9 8.1l-2.7 7.2-7.2 2.7 2.7-7.2 7.2-2.7z" fill="#ef4444"/>
          <circle cx="12" cy="12" r="1" fill="#ffffff"/>
        </svg>

        {/* Bearing name (editable); shift text on preview only */}
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSubmitEdit}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-[var(--vscode-input-background)] rounded px-2 py-0.5 text-[var(--vscode-input-foreground)] text-xs shadow-inner shadow-black/20 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span 
            className="flex-1 text-[var(--vscode-foreground)] text-xs select-none min-w-0 font-medium truncate"
            style={props.previewIndentPx ? { marginLeft: props.previewIndentPx } : undefined}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            title={bearing.statement || props.node.title}
          >
            {props.node.title}
          </span>
        )}

        {/* Children count indicator */}
        {props.node.children.length > 0 && (
          <span className="text-xs text-[var(--vscode-descriptionForeground)] bg-blue-500/20 px-1 rounded">
            {props.node.children.length}
          </span>
        )}

        {/* Hover overlay with action buttons */}
        <div className="absolute right-1 top-0 bottom-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="bg-[var(--vscode-list-hoverBackground)] rounded px-1 flex items-center gap-1 shadow-md shadow-black/10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="w-5 h-5 flex items-center justify-center hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
              title="Rename bearing"
            >
              <svg className="w-2.5 h-2.5 text-[var(--vscode-icon-foreground)]" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61z"/>
              </svg>
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onDelete();
              }}
              className="w-5 h-5 flex items-center justify-center hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded text-[var(--vscode-errorForeground)]"
              title="Delete bearing"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.5 1h3a.5.5 0 01.5.5v1H6v-1a.5.5 0 01.5-.5zM11 2.5v-1A1.5 1.5 0 009.5 0h-3A1.5 1.5 0 005 1.5v1H2.506a.58.58 0 000 1.157h.538l.632 9.966A1.5 1.5 0 005.18 15h5.64a1.5 1.5 0 001.504-1.377l.632-9.966h.538a.58.58 0 000-1.157H11z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Below drop indicator */}
      {showBelowIndicator && (
        <div className="h-0.5 bg-[#007ACC] mt-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}
    </div>
  );
};
