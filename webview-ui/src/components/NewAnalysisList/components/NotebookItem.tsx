import React, { useState } from 'react';
import { NotebookFileNode } from '../../../services/NotebookHierarchyService';
import { Analet } from '../../../types/analet';
import { FileIcon } from './FileIcon';
import { formatFileDate } from '../../../utilities/dateFormatting';

interface NotebookItemProps {
  node: NotebookFileNode;
  level: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (newName: string) => void;
  onClick: () => void;
  onOpen: () => void;
  onAnaletClick?: (analet: Analet) => void;
}

export const NotebookItem: React.FC<NotebookItemProps> = ({
  node,
  level,
  isExpanded,
  onToggle,
  onRename,
  onClick,
  onOpen,
  onAnaletClick
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

  const handleAnaletClick = (analet: Analet, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAnaletClick) {
      onAnaletClick(analet);
    }
  };

  const hasAnalets = node.analets && node.analets.length > 0;
  const analetCount = node.analets?.length || 0;
  // Show caret for all notebooks by default (they can potentially contain analets)
  const isNotebook = node.type === 'notebook';

  return (
    <div className="select-none">
      {/* Notebook item */}
      <div
        className={`flex items-center gap-2 py-1 px-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer rounded ${
          isExpanded ? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]' : ''
        }`}
        style={{ paddingLeft: `${12 + (level * 16)}px` }}
        onClick={() => {
          // Only handle notebook opening when NOT clicking the caret
          onOpen();
        }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Expansion toggle - show for all notebooks */}
        {isNotebook && (
          <button
            className="w-3 h-3 flex items-center justify-center hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              // Load analets if not loaded, otherwise just toggle
              if (!node.analets) {
                onClick(); // This will load analets and auto-expand
              } else {
                onToggle(); // Just toggle expansion
              }
            }}
            title={isExpanded ? 'Collapse analets' : 'Expand analets'}
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
        
        {/* No toggle space for non-notebooks */}
        {!isNotebook && <div className="w-4" />}
        
        {/* Notebook icon */}
        <FileIcon fileName={node.name} />
        
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
        
        {/* Analet count badge */}
        {hasAnalets && (
          <span className="px-1.5 py-0.5 text-xs bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded-full">
            {analetCount}
          </span>
        )}

        
        {/* Last modified info */}
        {node.lastModified && (
          <span className="text-xs text-[var(--vscode-descriptionForeground)] opacity-60">
            {formatFileDate(node.lastModified)}
          </span>
        )}
      </div>
      
      {/* Expanded analets */}
      {isExpanded && hasAnalets && (
        <div className="space-y-1 mt-1" style={{ marginLeft: `${12 + ((level + 1) * 16)}px` }}>
          {node.analets?.map(analet => (
            <div
              key={analet.id}
              className="flex items-center gap-2 py-1 px-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer rounded group"
              onClick={(e) => handleAnaletClick(analet, e)}
              title={analet.explanation || analet.statement}
            >
              {/* Analet icon - blue dot for consistency */}
              <svg className="w-3 h-3" fill="#0078D4" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="3"/>
              </svg>
              
              {/* Question */}
              <span className="flex-1 truncate text-[var(--vscode-descriptionForeground)]">
                {analet.statement}
              </span>
              
              {/* Tags */}
              {analet.tags && analet.tags.length > 0 && (
                <div className="flex gap-1">
                  {analet.tags.slice(0, 2).map((tag, index) => (
                    <span
                      key={index}
                      className="px-1 py-0.5 text-xs bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded opacity-60"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          
          {/* Loading indicator for analets */}
          {!node.analets && (
            <div className="flex items-center gap-2 py-1 px-2 text-sm opacity-60">
              <div className="animate-spin rounded-full h-3 w-3 border border-[var(--vscode-descriptionForeground)] border-t-transparent"></div>
              <span className="text-[var(--vscode-descriptionForeground)]">Loading analets...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};