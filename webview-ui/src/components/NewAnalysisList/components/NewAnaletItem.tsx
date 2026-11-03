import React, { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { TreeNode } from '../../../services/HierarchyService';
import { Analet } from '../../../types/analet';
import { getAnaletNodeColor } from '../../../utilities/analetsColors';
import { useMessageHandler } from '../../../hooks/useMessageHandler';
import { HierarchyService } from '../../../services/HierarchyService';
import { StateService } from '../../../services/StateService';
import { FeatureFlags } from '../../../utils/featureFlags';

interface SharedSelectionLike {
  setHoveredAnalet?: (analetId: number | undefined) => void;
}

interface NewAnaletItemProps {
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
  sharedSelection?: SharedSelectionLike;
  isDragging?: boolean;
  previewIndentPx?: number;
}

export const NewAnaletItem: React.FC<NewAnaletItemProps> = (props) => {
  const analet = props.node.data as Analet;
  const { sendMessage, onMessage } = useMessageHandler();
  
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

  const handleAddNote = async () => {
    setShowContextMenu(false);
    
    try {
      // Create a blank note, then attach via hierarchy edge to this analet
      const hierarchyService = HierarchyService.getInstance();
      const cleanup = onMessage('create-blank-note', async (data: any) => {
        cleanup();
        try {
          const note = data?.note;
          if (!note || typeof note.id !== 'number') {
            console.error('❌ [NewAnaletItem] Invalid create-blank-note response:', data);
            return;
          }
          const noteId = `note-${note.id}`;
          const parentId = `analet-${analet.id}`;
          const ok = await hierarchyService.addEdge(parentId, noteId);
          if (!ok) {
            console.error('❌ [NewAnaletItem] Failed to create hierarchy edge for note');
          }
        } catch (e) {
          console.error('❌ [NewAnaletItem] Error handling create-blank-note response:', e);
        }
      });
      sendMessage('create-blank-note', {});
    } catch (error) {
      console.error('❌ [NewAnaletItem] Error creating note:', error);
    }
  };

  const handleDelete = async () => {
    setShowContextMenu(false);
    
    try {
      // Send delete message to backend
      sendMessage('delete-analet', {
        analetId: analet.id
      });
    } catch (error) {
      console.error('❌ [NewAnaletItem] Error deleting analet:', error);
    }
  };

  const handleAddBearing = async () => {
    setShowContextMenu(false);
    try {
      const stateService = StateService.getInstance();
      const now = Date.now();
      const newBearing = {
        id: now,
        name: `Bearing ${(stateService.getBearings ? (stateService.getBearings().length + 1) : 1)}`,
        statement: analet.statement || `Bearing ${now}`,
        timestamp: new Date().toISOString(),
        tags: ['bearing'],
        location: analet.location ? { id: `bearing-${now}`, x: analet.location.x, y: analet.location.y } : undefined
      } as any;
      stateService.addBearing(newBearing);
      try { stateService.setActiveBearingId(newBearing.id); } catch {}

      const hierarchy = HierarchyService.getInstance();
      // Ensure bearing appears at root
      await hierarchy.addEdge('item:root', `bearing-${newBearing.id}`);

      // Reparent this analet under the new bearing: remove any existing parent edges, then add new one
      const edges = hierarchy.getEdges();
      const childId = `analet-${analet.id}`;
      const existing = edges.filter(e => e.childId === childId && e.type === 'contains');
      for (const e of existing) {
        if (e.edgeId) {
          try { await hierarchy.removeEdge(e.edgeId); } catch {}
        }
      }
      await hierarchy.addEdge(`bearing-${newBearing.id}`, childId);

      // Expand bearing node by default by emitting hierarchyUpdated (handled internally by service)
      try { window.dispatchEvent(new CustomEvent('bearingsUpdated', { detail: { action: 'add', id: newBearing.id } })); } catch {}
    } catch (e) {
      console.error('❌ [NewAnaletItem] Failed to add bearing:', e);
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
    data: { type: 'analet', node: props.node },
    disabled: FeatureFlags.LIST_FREEZE_ANALET_DND
  });

  // Droppable (allow above/below/inside)
  const { setNodeRef: setDropRef } = useDroppable({
    id: props.node.id,
    data: { type: 'analet', node: props.node }
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
  const parentId = HierarchyService.getInstance().getParentId(props.node.id);
  const underBearing = typeof parentId === 'string' && parentId.startsWith('bearing-');
  const baseOpacity = props.isMaterialized ? (underBearing ? 'opacity-60' : '') : 'opacity-40';
  const selectedTint = props.isSelected ? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]' : '';

  const baseColor = getAnaletNodeColor(false, false, analet);
  const ringColor = '#0078D4';

  return (
    <div>
      {/* Above drop indicator (indent with potential next level when previewing inside on this target) */}
      {showAboveIndicator && (
        <div className="h-0.5 bg-[#007ACC] mb-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}

      {/* Analet item */}
      <div
        ref={setNodeRef}
        style={style}
        data-node-id={props.node.id}
        className={`
          group relative flex items-start gap-2 px-2 py-1 rounded text-sm cursor-pointer select-none
          hover:bg-[var(--vscode-list-hoverBackground)]
          ${showInsideIndicator ? 'bg-[#007ACC]/20 shadow-md shadow-blue-500/20 ring-1 ring-blue-500/50' : ''}
          ${selectedTint} ${hoveredOutline} ${baseOpacity}
        `}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          props.onClick(e);
          // Let parent decide whether to toggle details
        }}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => props.sharedSelection?.setHoveredAnalet?.((props.node.data as Analet).id)}
        onMouseLeave={() => props.sharedSelection?.setHoveredAnalet?.(undefined)}
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

        {/* Analet icon with centered selection ring (icon position remains aligned across rows) */}
        <div
          className="relative flex-shrink-0"
          style={{ width: 16, height: 16, zIndex: transform ? 50 : undefined }}
          onMouseEnter={() => props.sharedSelection?.setHoveredAnalet?.((props.node.data as Analet).id)}
          onMouseLeave={() => props.sharedSelection?.setHoveredAnalet?.(undefined)}
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
          <svg 
            className={`absolute left-[2px] top-[2px] w-3 h-3`} 
            viewBox="0 0 16 16" 
            fill="currentColor"
          >
            <circle cx="8" cy="8" r="5" fill={baseColor} stroke="#e5e7eb" strokeWidth="1" />
          </svg>
        </div>

        {/* Analet statement (shift text only when previewing inside on dragged row) */}
        {!props.isDetailsOpen ? (
          <span 
            className={`flex-1 text-xs min-w-0 truncate ${props.isMaterialized ? 'text-[var(--vscode-foreground)]' : 'text-[var(--vscode-descriptionForeground)]'}`}
            style={props.previewIndentPx ? { marginLeft: props.previewIndentPx } : undefined}
            title={analet.statement}
          >
            {analet.shortName || analet.statement || `Analet ${analet.id}`}
          </span>
        ) : (
          // Analet Card view when expanded
          <div className="flex-1 min-w-0">
            <div className="text-[var(--vscode-foreground)] text-xs font-medium mb-1 truncate" title={analet.statement}>
              {analet.shortName || analet.statement || `Analet ${analet.id}`}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-3 p-2 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded" style={{ minHeight: 160 }}>
              <div>
                <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">CellQL</div>
                <div className="mt-1 text-xs font-mono bg-[var(--vscode-textCodeBlock-background)] p-2 rounded border max-h-24 overflow-y-auto">
                  {(analet.cellQL || 'No CellQL available')}
                </div>
                {analet.semantic_hints_text && (
                  <div className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-editorCodeLens-foreground)]/10 p-2 rounded">
                    {analet.semantic_hints_text}
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Explanation</div>
                <div className="mt-1 text-xs text-[var(--vscode-foreground)] max-h-24 overflow-y-auto pr-2">
                  {analet.explanation || 'No explanation provided'}
                </div>
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
            {/* Add Note option */}
            <button
              onClick={handleAddNote}
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414L2 13.414V2a1 1 0 0 1 1-1h11zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353L4.293 11H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
                <path d="M3 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM3 6a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 6zm0 2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/>
              </svg>
              Add Note
            </button>

            {/* Set as Bearing option */}
            <button
              onClick={handleAddBearing}
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm3.9 6.1l-2.3 6.2-6.2 2.3 2.3-6.2 6.2-2.3zM12 11a1 1 0 110 2 1 1 0 010-2z" />
              </svg>
              Set as Bearing
            </button>
            
            {/* Separator */}
            <div className="border-t border-[var(--vscode-menu-separatorBackground)] my-1" />
            
            {/* Delete option */}
            <button
              onClick={handleDelete}
              className="w-full px-3 py-2 text-left text-sm text-[var(--vscode-menu-foreground)] hover:bg-[var(--vscode-menu-selectionBackground)] hover:text-[var(--vscode-menu-selectionForeground)] flex items-center gap-2"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
              </svg>
              Delete
            </button>
          </div>
        </>
      )}

      {/* Below drop indicator */}
      {showBelowIndicator && (
        <div className="h-0.5 bg-[#007ACC] mt-1 rounded" style={{ marginLeft: (props.level * 24) + 12, marginRight: 8 }} />
      )}
    </div>
  );
};

// Local keyframes for the selection ring
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
