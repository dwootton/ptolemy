import React, { useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { TreeNode } from '../../services/HierarchyService';
import { OrdinalDistance } from '../../services/HierarchySimilarityService';

interface HierarchyCursorItemProps {
  node: TreeNode;
  level: number;
  isSelected: boolean;
  isHovered?: boolean;
  isChildrenExpanded: boolean;
  isDetailsOpen: boolean;
  dropIndicator?: { position: 'above' | 'below' | 'inside' };
  onClick: (event: React.MouseEvent) => void;
  onToggleChildrenExpand: () => void;
  onToggleDetails: () => void;
  isMaterialized: boolean;
  sharedSelection?: any;
  isDragging?: boolean;
  previewIndentPx?: number;
  // Hierarchy cursor specific props
  parentContext?: TreeNode | null;
  siblingContext: TreeNode[];
  ancestorContext?: TreeNode[];
  ordinalDistances: OrdinalDistance[];
  previewIdea?: string;
  previewAnalet?: any;
  isLoading: boolean;
  onGenerateAnalet: (idea: string, path?: string[]) => void;
}

export const HierarchyCursorItem: React.FC<HierarchyCursorItemProps> = (props) => {
  
  // Draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
  } = useDraggable({
    id: props.node.id,
    data: { type: 'hierarchy-cursor', node: props.node }
  });

  // Droppable (allow above/below/inside)
  const { setNodeRef: setDropRef } = useDroppable({
    id: props.node.id,
    data: { type: 'hierarchy-cursor', node: props.node }
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
  const baseOpacity = props.isMaterialized ? '' : 'opacity-40';
  const selectedTint = props.isSelected ? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]' : '';

  // Hierarchy cursor specific styling - ghost-like appearance
  const baseColor = '#10B981'; // Green for ready state
  const ringColor = '#0078D4';

  const handleGenerateAnalet = useCallback(() => {
    const idea = props.previewAnalet?.statement || props.previewIdea || ((props.parentContext && ((props.parentContext.data as any)?.statement || props.parentContext.title)) || '');
    if (!idea || props.isLoading) return;
    // Use the current path from the hierarchy cursor state
    const currentPath = (props.node.data as any)?.currentPath || ['root'];
    props.onGenerateAnalet(idea, currentPath);
  }, [props.previewIdea, props.previewAnalet, props.parentContext, props.isLoading, props.onGenerateAnalet, props.node.data]);

  return (
    <div>
      {/* Above drop indicator */}
      {showAboveIndicator && (
        <div className="h-0.5 bg-[#007ACC] mb-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}

      {/* Hierarchy Cursor item */}
      <div
        ref={setNodeRef}
        style={{
          ...style,
          backgroundColor: 'white',
          border: '1px solid rgba(75, 85, 99, 0.3)',
          position: 'relative'
        }}
        className={`
          group relative flex items-start gap-2 px-2 py-1 rounded text-sm cursor-pointer select-none
          hover:bg-[var(--vscode-list-hoverBackground)]
          ${showInsideIndicator ? 'bg-[#007ACC]/20 shadow-md shadow-blue-500/20 ring-1 ring-blue-500/50' : ''}
          ${selectedTint} ${hoveredOutline} ${baseOpacity}
          ${props.isDragging ? 'opacity-50' : ''}
        `}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          props.onClick(e);
        }}
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

        {/* Hierarchy cursor icon - ghost-like appearance */}
        <div
          className="relative flex-shrink-0"
          style={{ width: 16, height: 16, zIndex: transform ? 50 : undefined }}
        >
          {props.isSelected && (
            <span
              className="absolute"
              style={{
                left: 0,
                top: 0,
                width: 16,
                height: 16,
                borderRadius: 9999,
                border: `2px solid ${ringColor}`,
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
          )}
          {/* Ghost-like cursor icon */}
          <div
            className="absolute left-[2px] top-[2px] w-3 h-3 rounded-full"
            style={{
              backgroundColor: 'white',
              border: '1px solid #4B5563',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1))'
            }}
          >
            {/* Inner dot indicating status */}
            <div
              className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full transform -translate-x-1/2 -translate-y-1/2"
              style={{
                backgroundColor: props.isLoading ? '#6366F1' : baseColor,
                opacity: 0.9
              }}
            />
          </div>
          
          {/* Loading indicator - properly centered */}
          {props.isLoading && (
            <div
              className="absolute top-0 left-0 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
              style={{ opacity: 0.7 }}
            />
          )}
        </div>

        {/* Hierarchy cursor content */}
        {!props.isDetailsOpen ? (
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span 
              className="text-xs min-w-0 text-black font-medium whitespace-normal break-words"
              style={props.previewIndentPx ? { marginLeft: props.previewIndentPx } : undefined}
              title="Hierarchy Cursor"
            >

              {props.isLoading 
                ? 'Generating...'
                : (
                  props.previewAnalet?.statement ||
                  props.previewIdea ||
                  ((props.parentContext && ((props.parentContext.data as any)?.statement || props.parentContext.title)) || 'Hierarchy Cursor')
                )}
            </span>
            {/* Save button in collapsed view (always visible, disabled until preview ready) */}
            <button
              className="ml-auto px-2 py-0.5 text-[10px] rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50"
              onClick={(e) => { e.stopPropagation(); handleGenerateAnalet(); }}
              disabled={props.isLoading || !(
                (props.previewAnalet?.statement && String(props.previewAnalet?.statement).trim().length > 0)
                || (props.previewIdea && String(props.previewIdea).trim().length > 0)
                || !!(props.parentContext && (((props.parentContext.data as any)?.statement || props.parentContext.title)))
              )}
              title="Save analet here"
            >
              Save
            </button>
          </div>
        ) : (
          // Hierarchy cursor details view when expanded
          <div className="flex-1 min-w-0">
            <div className="text-[var(--vscode-foreground)] text-xs font-medium mb-1">
              Hierarchy Cursor
            </div>
            <div className="mt-1 grid grid-cols-1 gap-3 p-2 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded" style={{ minHeight: 120 }}>
              {/* Role Context: Parent / Ancestors / Siblings */}
              {(props.parentContext || (props.ancestorContext && props.ancestorContext.length) || (props.siblingContext && props.siblingContext.length)) && (
                <div>
                  <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">Local Context</div>
                  <div className="space-y-1">
                    {props.parentContext && (
                      <div className="text-xs text-[var(--vscode-foreground)]">
                        <span className="uppercase text-[10px] text-[var(--vscode-descriptionForeground)] mr-1">Parent:</span>
                        {(props.parentContext.data as any)?.statement || props.parentContext.title}
                      </div>
                    )}
                    {(props.ancestorContext || []).slice(0, 2).map((a, i) => (
                      <div key={`anc-${i}`} className="text-xs text-[var(--vscode-foreground)]">
                        <span className="uppercase text-[10px] text-[var(--vscode-descriptionForeground)] mr-1">Ancestor:</span>
                        {(a.data as any)?.statement || a.title}
                      </div>
                    ))}
                    {props.siblingContext.slice(0, 3).map((s, i) => (
                      <div key={`sib-${i}`} className="text-xs text-[var(--vscode-foreground)]">
                        <span className="uppercase text-[10px] text-[var(--vscode-descriptionForeground)] mr-1">Sibling:</span>
                        {(s.data as any)?.statement || s.title}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ordinal Relationships */}
              {props.ordinalDistances.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">Ordinal Relationships</div>
                  <div className="space-y-1">
                    {props.ordinalDistances.slice(0, 5).map((distance, index) => (
                      <div key={index} className="text-xs text-[var(--vscode-foreground)]">
                        • {distance.description}
                      </div>
                    ))}
                    {props.ordinalDistances.length > 5 && (
                      <div className="text-xs text-[var(--vscode-descriptionForeground)] italic">
                        ... and {props.ordinalDistances.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Generated Idea */}
              {(props.previewAnalet?.statement || props.previewIdea || props.parentContext) && (
                <div>
                  <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-2">Generated Idea</div>
                  <div className="text-xs text-[var(--vscode-foreground)] bg-green-500/10 p-2 rounded border border-green-500/20 mb-3">
                    "{props.previewAnalet?.statement || props.previewIdea || ((props.parentContext && ((props.parentContext.data as any)?.statement || props.parentContext.title)) || '')}"
                  </div>
                </div>
              )}

              {/* Create Analet Button - always shown, disabled until preview ready */}
              <button
                className="w-full bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] px-3 py-2 rounded text-xs hover:bg-[var(--vscode-button-hoverBackground)] transition-colors font-medium disabled:opacity-50"
                onClick={handleGenerateAnalet}
                disabled={props.isLoading || !(
                  (props.previewAnalet?.statement && String(props.previewAnalet?.statement).trim().length > 0)
                  || (props.previewIdea && String(props.previewIdea).trim().length > 0)
                  || !!(props.parentContext && (((props.parentContext.data as any)?.statement || props.parentContext.title)))
                )}
                title="Create this analet at current position"
              >
                {props.isLoading ? 'Generating...' : 'Create Analet'}
              </button>
              
              {/* Instructions */}
              <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                <div>🖱️ Drag to move • ⌨️ Arrow keys to navigate</div>
                <div>⏎ Double-click to create analet • ⎋ Press Escape to hide</div>
              </div>
            </div>
          </div>
        )}

        {/* Children count indicator */}
        {props.node.children.length > 0 && (
          <span className="text-xs text-[var(--vscode-descriptionForeground)] bg-blue-500/20 px-1 rounded">
            {props.node.children.length}
          </span>
        )}
      </div>

      {/* Below drop indicator */}
      {showBelowIndicator && (
        <div className="h-0.5 bg-[#007ACC] mt-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}
    </div>
  );
};



// Local keyframes for the selection ring
if (typeof document !== 'undefined' && !document.getElementById('hierarchy-cursor-pulse')) {
  const style = document.createElement('style');
  style.id = 'hierarchy-cursor-pulse';
  style.textContent = `
  @keyframes pulse {
    0% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.12); opacity: 0.5; }
    100% { transform: scale(1); opacity: 0.8; }
  }`;
  document.head.appendChild(style);
}
