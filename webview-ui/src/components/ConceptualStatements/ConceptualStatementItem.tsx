import React, { useState, useRef, useCallback } from 'react';
import { ConceptualStatement } from '../../types/analet';

interface ConceptualStatementItemProps {
  statement: ConceptualStatement;
  isExpanded?: boolean;
  nestingLevel?: number;
  isLastChild?: boolean; // For line drawing
  hasChildren?: boolean; // For icon and behavior
  children?: React.ReactNode; // For nested analets
  onToggleExpand?: (statementId: number) => void;
  onMaterialize?: (statement: ConceptualStatement) => void;
  onEdit?: (statement: ConceptualStatement) => void;
  onDelete?: (statementId: number) => void;
  onPanTo?: (statement: ConceptualStatement) => void;
}

export const ConceptualStatementItem: React.FC<ConceptualStatementItemProps> = ({
  statement,
  isExpanded = false,
  nestingLevel = 0,
  isLastChild = false,
  hasChildren = false,
  children,
  onToggleExpand,
  onMaterialize,
  onEdit,
  onDelete,
  onPanTo
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const itemRef = useRef<HTMLDivElement>(null);

  const handleRightClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleContextMenuAction = useCallback((action: string) => {
    setShowContextMenu(false);
    
    switch (action) {
      case 'materialize':
        onMaterialize?.(statement);
        break;
      case 'edit':
        onEdit?.(statement);
        break;
      case 'delete':
        onDelete?.(statement.id);
        break;
      case 'panTo':
        onPanTo?.(statement);
        break;
    }
  }, [statement, onMaterialize, onEdit, onDelete, onPanTo]);

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand?.(statement.id);
  }, [statement.id, onToggleExpand]);

  // Calculate positioning for hierarchy lines
  const baseIndent = 20; // Base indentation
  const levelIndent = 32; // Additional indentation per level
  const totalIndent = baseIndent + (nestingLevel * levelIndent);
  const lineLeft = baseIndent + (nestingLevel > 0 ? (nestingLevel - 1) * levelIndent + 12 : 0); // Line position

  return (
    <>
      <div
        ref={itemRef}
        className="relative group"
        onContextMenu={handleRightClick}
      >
        {/* Hierarchy Connecting Lines */}
        {nestingLevel > 0 && (
          <svg 
            className="absolute top-0 left-0 pointer-events-none" 
            style={{ width: totalIndent + 40, height: '100%' }}
          >
            {/* Vertical line from parent */}
            <line
              x1={lineLeft}
              y1={0}
              x2={lineLeft}
              y2={isLastChild ? 24 : '100%'}
              stroke="rgb(59 130 246 / 0.3)"
              strokeWidth="2"
              strokeDasharray="none"
            />
            
            {/* Horizontal line to current item */}
            <line
              x1={lineLeft}
              y1={24}
              x2={lineLeft + 20}
              y2={24}
              stroke="rgb(59 130 246 / 0.3)"
              strokeWidth="2"
              strokeDasharray="none"
            />
            
            {/* Small connecting circle */}
            <circle
              cx={lineLeft + 20}
              cy={24}
              r="3"
              fill="rgb(59 130 246 / 0.4)"
              stroke="rgb(59 130 246 / 0.6)"
              strokeWidth="1"
            />
          </svg>
        )}

        {/* Main Statement Item - Enhanced Blue Square Design */}
        <div
          className="flex items-center gap-3 p-3 mb-2 bg-gradient-to-r from-blue-500/8 to-blue-600/10 border border-blue-500/30 rounded-lg hover:from-blue-500/15 hover:to-blue-600/20 hover:border-blue-500/50 transition-all duration-300 cursor-pointer shadow-sm"
          style={{ marginLeft: totalIndent }}
          onClick={() => onPanTo?.(statement)}
        >
          {/* Enhanced Blue Square Icon with Folder Indicator */}
          <div className="flex-shrink-0 relative">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-600 rounded-md flex items-center justify-center shadow-md border border-blue-400/20">
              <div className="w-3.5 h-3.5 bg-blue-100 rounded-sm opacity-80" />
            </div>
            
            {/* Folder indicator */}
            {(hasChildren || children) && (
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-400 rounded-full flex items-center justify-center">
                <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
          
          {/* Expand/Collapse Button */}
          {(hasChildren || children) && (
            <button
              onClick={handleToggleExpand}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-all duration-200"
              title={isExpanded ? 'Collapse folder' : 'Expand folder'}
            >
              <svg 
                className={`w-3.5 h-3.5 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          
          {/* Statement Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[var(--vscode-foreground)] leading-relaxed font-medium">
              {statement.text}
            </p>
            
            {/* Enhanced Metadata */}
            <div className="flex items-center gap-3 mt-1.5 text-xs">
              <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded font-mono">
                #{statement.id}
              </span>
              {statement.createdAt && (
                <span className="text-[var(--vscode-descriptionForeground)]">
                  {new Date(statement.createdAt).toLocaleDateString()}
                </span>
              )}
              {(hasChildren || children) && (
                <span className="flex items-center gap-1 text-blue-400">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                  </svg>
                  Folder
                </span>
              )}
            </div>
          </div>
          
          {/* Enhanced Action Buttons */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(statement);
              }}
              className="p-1.5 rounded-md text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] transition-all duration-200"
              title="Edit statement"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMaterialize?.(statement);
              }}
              className="p-1.5 rounded-md text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-all duration-200"
              title="Materialize into analets"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Enhanced Nested Content with Connection Lines */}
        {isExpanded && children && (
          <div className="relative">
            {/* Extended connecting line for children */}
            <svg 
              className="absolute top-0 left-0 pointer-events-none" 
              style={{ width: totalIndent + 32, height: '100%' }}
            >
              <line
                x1={totalIndent + 12}
                y1={0}
                x2={totalIndent + 12}
                y2="100%"
                stroke="rgb(59 130 246 / 0.25)"
                strokeWidth="2"
                strokeDasharray="none"
              />
            </svg>
            
            <div className="pt-2">
              {children}
            </div>
          </div>
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
            className="fixed z-50 bg-[var(--vscode-menu-background)] border border-[var(--vscode-menu-border)] rounded-md shadow-lg py-1 min-w-48"
            style={{
              left: contextMenuPosition.x,
              top: contextMenuPosition.y,
            }}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
              onClick={() => handleContextMenuAction('materialize')}
            >
              <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Materialize
            </button>
            
            <button
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
              onClick={() => handleContextMenuAction('edit')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Edit
            </button>
            
            <button
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
              onClick={() => handleContextMenuAction('panTo')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Pan to Statement
            </button>
            
            <div className="border-t border-[var(--vscode-menu-separatorBackground)] my-1" />
            
            <button
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
              onClick={() => handleContextMenuAction('delete')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
};