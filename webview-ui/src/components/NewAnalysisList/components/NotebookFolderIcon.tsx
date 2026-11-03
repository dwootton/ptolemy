import React, { useState } from 'react';
import { NotebookFileNode } from '../../../services/NotebookHierarchyService';

interface NotebookFolderItemProps {
  node: NotebookFileNode;
  level: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onClick: () => void;
}

export const NotebookFolderItem: React.FC<NotebookFolderItemProps> = ({
  node,
  level,
  isExpanded,
  onToggle,
  onRename,
  onDelete,
  onClick
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(node.name);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(node.name);
    }
  };

  const handleSaveRename = () => {
    if (editValue.trim() && editValue !== node.name) {
      onRename(editValue.trim());
    }
    setIsEditing(false);
  };

  const hasChildren = node.children && node.children.length > 0;
  const childCount = node.children?.length || 0;
  const notebookCount = node.children?.filter(child => child.type === 'notebook').length || 0;

  return (
    <div
      className={`flex items-center gap-2 py-1 px-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer rounded group ${
        isExpanded ? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]' : ''
      }`}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Expansion toggle - using consistent carets */}
      {hasChildren && (
        <button
          className="w-3 h-3 flex items-center justify-center hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={isExpanded ? 'Collapse folder' : 'Expand folder'}
        >
          {isExpanded ? (
            // Down arrow (∨) when expanded
            <svg className="w-2 h-2 text-[var(--vscode-icon-foreground)]" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 5L8 11L14 5H2Z"/>
            </svg>
          ) : (
            // Right arrow (>) when compressed
            <svg className="w-2 h-2 text-[var(--vscode-icon-foreground)]" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 12L12 8L6 4V12Z"/>
            </svg>
          )}
        </button>
      )}
      
      {/* No toggle space for empty folders */}
      {!hasChildren && <div className="w-4" />}
      
      {/* Folder icon */}
      <svg 
        className={`w-4 h-4 ${
          isExpanded 
            ? 'text-[var(--vscode-icon-foreground)]' 
            : 'text-[var(--vscode-icon-foreground)]'
        }`} 
        fill="currentColor" 
        viewBox="0 0 16 16"
      >
        {isExpanded ? (
          <path d="M2.5 3a.5.5 0 00-.5.5V4h12v-.5a.5.5 0 00-.5-.5H9.414a1 1 0 01-.707-.293L7.293 1.793A1 1 0 006.586 1.5H2.5z"/>
        ) : (
          <path d="M1.75 2A1.75 1.75 0 000 3.75v8.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0016 12.25v-8.5A1.75 1.75 0 0014.25 2H9.586a1.75 1.75 0 01-1.238-.513L6.513 0.513A1.75 1.75 0 005.275 0H1.75z"/>
        )}
      </svg>
      
      {/* Name or edit input */}
      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSaveRename}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded px-1 text-sm"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate" title={node.path}>
          {node.name}
        </span>
      )}
      
      {/* Child count badges */}
      {hasChildren && (
        <div className="flex items-center gap-1">
          {notebookCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded-full">
              {notebookCount}
              <svg className="w-2.5 h-2.5 inline ml-0.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3 0a2 2 0 00-2 2v12a2 2 0 002 2h9.414A2 2 0 0014 14.586V4.414A2 2 0 0012.586 3H11V1a1 1 0 10-2 0v2H7V1a1 1 0 10-2 0v2H3z"/>
              </svg>
            </span>
          )}
          
          {childCount > notebookCount && (
            <span className="px-1.5 py-0.5 text-xs bg-[var(--vscode-descriptionForeground)] text-[var(--vscode-editor-background)] rounded-full opacity-60">
              {childCount - notebookCount}
            </span>
          )}
        </div>
      )}
      
      {/* Action buttons */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        {/* Delete button */}
        <button
          className="p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded text-[var(--vscode-errorForeground)] transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete folder"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
            <path d="M6.5 1h3a.5.5 0 01.5.5v1H6v-1a.5.5 0 01.5-.5zM11 2.5v-1A1.5 1.5 0 009.5 0h-3A1.5 1.5 0 005 1.5v1H2.5a.5.5 0 000 1h.085c.068 0 .108.047.157.107L4 14.5A1.5 1.5 0 005.5 16h5a1.5 1.5 0 001.5-1.5L13.258 3.607c.049-.06.089-.107.157-.107H13.5a.5.5 0 000-1H11z"/>
          </svg>
        </button>
      </div>
    </div>
  );
};