
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EmbeddingCursorIcon } from '../Icons/EmbeddingCursorIcon';
import { AddNoteIcon } from '../Icons/AddNoteIcon';
import { AutoTrackIcon } from '../Icons/AutoTrackIcon';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragMoveEvent,
  useSensor,
  useSensors,
  PointerSensor,
  closestCenter
} from '@dnd-kit/core';
import { Analet, Bearing, AnalysisNote, AnalysisComponent } from '../../types/analet';
import { useMessageHandler } from '../../hooks/useMessageHandler';
import { HierarchyService, TreeNode } from '../../services/HierarchyService';
import { StateService } from '../../services/StateService';
import { useAnaletVisibility } from '../../hooks/useAnaletVisibility';
// import { NotebookTree } from '../AnalysisList/components/NotebookTree';
import { NewAnaletItem } from './components/NewAnaletItem';
import { NewBearingItem } from './components/NewBearingItem';
import { NoteItem } from './components/NoteItem';
import { createAnaletFilter, createGenericFilter } from '../../utilities/filterParser';
import { useAnimatedDots } from '../../hooks/useAnimatedDots';
import { MessageService } from '../../services/MessageService';
import { FeatureFlags } from '../../utils/featureFlags';
import { orderAnaletsByEmbedding, buildOrderIndexMap } from '../../utilities/embeddingSeriation';
import { useAnalysisListInstrumentation } from '../../hooks/useInstrumentation';

import { HierarchyCursorItem } from '../HierarchyCursor/HierarchyCursorItem';
import { useHierarchyCursor } from '../../hooks/useHierarchyCursor';

// [Dnd-AL] Debug helpers
// const dbgNode = (n: TreeNode) => ({ id: n.id, kind: n.kind, title: n.title, childCount: n.children.length });
// const logTreeRoots = (label: string, t: TreeNode[]) => {
//   try {
//   } catch {}
// };

interface SharedSelection {
  selectionState: {
    selectedAnaletIds: Set<number>;
    selectedBearingIds: Set<number>;
    lastSelectedId?: number;
    lastSelectedType?: 'analet' | 'bearing';
    hoveredAnaletId?: number;
    hoveredBearingId?: number
  };
  selectAnalet: (analetId: number, multiSelect?: boolean, rangeSelect?: boolean, analetList?: Analet[]) => void;
  selectBearing: (bearingId: number, multiSelect?: boolean, rangeSelect?: boolean, bearingList?: Bearing[]) => void;
  clearSelection: () => void;
  isAnaletSelected: (analetId: number) => boolean;
  isBearingSelected: (bearingId: number) => boolean;
  getSelectedCount: () => number;
  getSelectedAnalets: (analets: Analet[]) => Analet[];
  getSelectedBearings: (bearings: Bearing[]) => Bearing[];
  setHoveredAnalet: (analetId: number | undefined) => void;
  setHoveredBearing: (bearingId: number | undefined) => void;
  getHoveredAnaletId: () => number | undefined;
  getHoveredBearingId: () => number | undefined;
}

interface ConceptualStatementsProps {
  variables?: Array<{name: string, displayName: string, type: string}>;
  groups?: Array<{id: number, name: string, expanded: boolean, variables: string[]}>;
  onSendStatementToMap?: (statement: string) => void;
  onPanToStatement?: (statement: string) => void;
  stateService?: any;
  datasetData?: any[];
  messageService?: any;
  onAnaletGenerated?: (analet: Analet) => void;
}

interface NewAnalysisListProps {
  analets: Analet[];
  bearings: Bearing[];
  notes?: AnalysisNote[];
  analysisComponents?: AnalysisComponent[];
  onAnaletClick?: (analet: Analet) => void;
  height?: number;
  sharedSelection?: SharedSelection;
  onFolderSelected?: (folderName: string | null) => void;
  stateService?: StateService;
  isLoading?: boolean;
  filterText?: string;
  conceptualStatementsProps?: ConceptualStatementsProps;
}

// type ViewMode = 'analets' | 'notebooks';

export const NewAnalysisList: React.FC<NewAnalysisListProps> = (props) => {
  const { sendMessage, onMessage } = useMessageHandler();
  const { isMaterialized, materializeAnalet } = useAnaletVisibility();
  const dots = useAnimatedDots(400, 3);
  const { trackInteraction } = useAnalysisListInstrumentation();

  // Debug conceptual statements props for dataset variables
  // Derive notes from analysisComponents if provided

  const derivedNotes = React.useMemo(() => {
    if (!props.analysisComponents) return props.notes || [];
    const n = props.analysisComponents
      .filter((c) => c.kind === 'note')
      .map((c) => (c as { kind: 'note'; entity: AnalysisNote }).entity);
    return n;
  }, [props.analysisComponents, props.notes]);

  // Services
  const [hierarchyService] = useState(() => HierarchyService.getInstance());

  // State
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [filteredTree, setFilteredTree] = useState<TreeNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<TreeNode | null>(null);
  // Notebook view disabled; keep type for future but do not use state
  // const [viewMode, setViewMode] = useState<ViewMode>('analets');
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string;
    position: 'above' | 'below' | 'inside';
  } | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<'above' | 'below' | 'inside' | null>(null);
  // Track auto-track state for list autoscroll on selection
  const [isAutoTrackEnabled, setIsAutoTrackEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('autoTrackEnabled') === '1'; } catch { return false; }
  });

  // Scroll container ref for auto-scroll during drag
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track drag start X for indentation delta
  const dragStartXRef = useRef<number | null>(null);

  // Track which analets have their details (CellQL/explanation) expanded
  const [detailsExpandedAnaletIds, setDetailsExpandedAnaletIds] = useState<Set<number>>(new Set());

  // Track which notes are expanded for inline editing
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());

  // Track local tree selection (for notes and other tree items not in sharedSelection)
  const [selectedTreeNodeId, setSelectedTreeNodeId] = useState<string | null>(null);

  // Track pending note creation for reactive expansion/editing
  const [pendingNoteCreation, setPendingNoteCreation] = useState<{
    noteId: string;
    numericId: number;
    parentId: string;
  } | null>(null);

  // Hierarchy cursor state
  const [isHierarchyCursorEnabled, setIsHierarchyCursorEnabled] = useState(false);
  const hierarchyCursor = useHierarchyCursor({
    tree,
    onAnaletClick: props.onAnaletClick,
    onExpandNode: (nodeId: string) => {
      setExpandedNodes(prev => new Set(prev).add(nodeId));
    }
  });

  // Create hierarchy cursor node - memoized to prevent unnecessary recreations
  const hierarchyCursorNode = useMemo((): TreeNode => {
    const { currentPath, currentDepth, parentContext, siblingContext, ancestorContext, ordinalDistances, previewIdea, isLoading } = hierarchyCursor.cursorState;
    return {
      id: 'hierarchy-cursor',
      kind: 'hierarchy-cursor' as any,
      title: 'Hierarchy Cursor',
      children: [],
      orderIndex: 0,
      edgeId: `hierarchy-cursor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, // Add edge ID for proper placement
      data: {
        currentPath,
        currentDepth,
        parentContext,
        siblingContext,
        ancestorContext,
        ordinalDistances,
        previewIdea,
        isLoading
      } as any
    };
  }, [
    hierarchyCursor.cursorState.currentPath?.join(','), // Convert array to string for stable comparison
    hierarchyCursor.cursorState.previewIdea,
    hierarchyCursor.cursorState.isLoading,
    hierarchyCursor.cursorState.isVisible
  ]); // Only depend on essential state changes

  // Insert hierarchy cursor at its correct position in the tree
  const insertCursorAtPath = useCallback((tree: TreeNode[], cursorNode: TreeNode, path: string[]): TreeNode[] => {
    // Note: We don't check for existing cursor here because the cursor needs to be in the tree
    // The issue is that the cursor is being recreated on every render, not that it's being duplicated

    // Check if this is actually a root-level path (not 'item:root')
    const isRootLevel = path.length <= 1 && (path.length === 0 || path[0] === 'root');

    if (isRootLevel) {
      // At root level, respect drop indicator if available
      const dp = hierarchyCursor.cursorState.dropPosition;
      if (dp && dp.targetId) {
        const targetIndex = tree.findIndex(n => n.id === dp.targetId);
        if (targetIndex >= 0) {
          const insertIndex = dp.position === 'above' ? targetIndex : targetIndex + 1;
          const before = tree.slice(0, insertIndex);
          const after = tree.slice(insertIndex);
          return [...before, cursorNode, ...after];
        }
      }
      // Default to beginning if no drop position
      return [cursorNode, ...tree];
    }

    // Handle special case where path is ['item:root'] - this should be treated as root level
    if (path.length === 1 && path[0] === 'item:root') {
      return [cursorNode, ...tree];
    }

    // Find the parent node and insert cursor as its child, honoring drop position
    const targetId = path[path.length - 1];
    const insertAtParent = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map(node => {
        // If we’re inserting inside, the drop target may be the parent itself
        const dp = hierarchyCursor.cursorState.dropPosition;
        if (node.id === targetId) {
          // Determine insertion strategy
          if (dp && dp.position === 'inside' && dp.targetId === node.id) {
            // Insert relative to the parent’s children — use top by default
            return {
              ...node,
              children: [cursorNode, ...node.children]
            };
          }
          // Otherwise insert as first child of target
          return {
            ...node,
            children: [cursorNode, ...node.children]
          };
        } else if (node.children.length > 0) {
          // If drop was above/below a child, find that child index and insert accordingly
          const dp = hierarchyCursor.cursorState.dropPosition;
          if (dp && (dp.position === 'above' || dp.position === 'below')) {
            const childIndex = node.children.findIndex(c => c.id === dp.targetId);
            if (childIndex >= 0) {
              const insertIndex = dp.position === 'above' ? childIndex : childIndex + 1;
              return {
                ...node,
                children: [
                  ...node.children.slice(0, insertIndex),
                  cursorNode,
                  ...node.children.slice(insertIndex)
                ]
              };
            }
          }
          return {
            ...node,
            children: insertAtParent(node.children)
          };
        }
        return node;
      });
    };

    const result = insertAtParent(tree);
    return result;
  }, []);

  // Update hierarchy service with notes when they change
  useEffect(() => {
    hierarchyService.setNotes(derivedNotes);
  }, [hierarchyService, derivedNotes]);

  // Process pending note creation when tree updates
  useEffect(() => {
    if (pendingNoteCreation && tree.length > 0) {
      // Check if the note now exists in the tree
      const findNodeInTree = (nodes: TreeNode[], targetId: string): TreeNode | null => {
        for (const node of nodes) {
          if (node.id === targetId) {
            return node;
          }
          const found = findNodeInTree(node.children, targetId);
          if (found) return found;
        }
        return null;
      };

      const noteNode = findNodeInTree(tree, pendingNoteCreation.noteId);
      if (noteNode) {
        // Step 1: Expand parent if not root
        if (pendingNoteCreation.parentId !== 'item:root') {
          setExpandedNodes(prev => {
            const newSet = new Set(prev);
            newSet.add(pendingNoteCreation.parentId);
            return newSet;
          });
        }

        // Step 2: Select the note
        setSelectedTreeNodeId(pendingNoteCreation.noteId);

        // Step 3: Expand the note for editing
        setExpandedNotes(prev => {
          const newSet = new Set(prev);
          newSet.add(pendingNoteCreation.numericId);
          return newSet;
        });

        // Step 4: Clear shared selection
        if (props.sharedSelection) {
          props.sharedSelection.clearSelection();
        }

        // Clear pending creation
        setPendingNoteCreation(null);
      }
    }
  }, [tree, pendingNoteCreation, props.sharedSelection]);

  // Load hierarchy on mount and subscribe to updates
  const updateTree = useCallback(() => {
    const newTree = hierarchyService.getTree();
    setTree(newTree);
    // logTreeRoots('updateTree: roots', newTree);
  }, [hierarchyService]);

  useEffect(() => {

    // Initial load
    updateTree();

    // Subscribe to hierarchy updates
    const cleanup = () => {
      window.removeEventListener('hierarchyUpdated', updateTree);
      window.removeEventListener('analetsUpdated', updateTree as any);
      window.removeEventListener('bearingsUpdated', updateTree as any);
    };
    window.addEventListener('hierarchyUpdated', (_e: any) => {
      updateTree();
    });
    // Also refresh when analets change (e.g., promotions change type/filtering)
    window.addEventListener('analetsUpdated', (_e: any) => {

      updateTree();
    });
    // Refresh when bearings change (creation, rename, delete)
    window.addEventListener('bearingsUpdated', (_e: any) => {
      updateTree();
    });

    return cleanup;
  }, [hierarchyService, updateTree]);

  // Sync auto-track state from persisted storage and toggle events
  useEffect(() => {
    // Initialize from storage on mount
    try {
      const saved = localStorage.getItem('autoTrackEnabled');
      if (saved != null) setIsAutoTrackEnabled(saved === '1');
    } catch {}
    const handler = (e: any) => {
      const enabled = !!e?.detail?.enabled;
      try { localStorage.setItem('autoTrackEnabled', enabled ? '1' : '0'); } catch {}
      setIsAutoTrackEnabled(enabled);
    };
    window.addEventListener('toggleAutoTrack', handler as EventListener);
    return () => window.removeEventListener('toggleAutoTrack', handler as EventListener);
  }, []);

  // Listen for note creation events to auto-expand inline editor
  useEffect(() => {
    const handleNoteCreated = (event: CustomEvent) => {
      const { note } = event.detail;
      if (note) {
        // Auto-expand editor for newly created notes
        setExpandedNotes(prev => new Set(prev).add(note.id));
        // Auto-expand the parent item in the hierarchy so the note is visible
        if (note.parentId && note.parentId !== 'root' && note.parentId !== 'item:root') {
          setExpandedNodes(prev => {
            const newSet = new Set(prev);
            newSet.add(note.parentId);
            return newSet;
          });
        }
      }
    };

    const handleNoteEditorOpen = (event: CustomEvent) => {
      const { note } = event.detail;
      if (note) {
        // Expand editor when explicitly requested
        setExpandedNotes(prev => new Set(prev).add(note.id));
      }
    };

    // Listen for the custom events dispatched by MessageService
    window.addEventListener('analysisNoteCreated', handleNoteCreated as EventListener);
    window.addEventListener('openNoteEditor', handleNoteEditorOpen as EventListener);

    return () => {
      window.removeEventListener('analysisNoteCreated', handleNoteCreated as EventListener);
      window.removeEventListener('openNoteEditor', handleNoteEditorOpen as EventListener);
    };
  }, []);


  // Tree filtering based on filterText using multi-query expressions
  const filterText = props.filterText || '';

  const filterNodes = useCallback((nodes: TreeNode[]): TreeNode[] => {
    const matchesNode = (node: TreeNode): boolean => {
      if (!filterText.trim()) return true;

      // For analets, use the comprehensive analet filter
      if (node.kind === 'analet' && node.data) {
        const analetFilter = createAnaletFilter(filterText);
        return analetFilter(node.data as Analet);
      }

      // For bearings, use a generic filter on statement and title
      if (node.kind === 'bearing' && node.data) {
        const bearingFilter = createGenericFilter(filterText, (bearing: Bearing) => {
          return [bearing.statement, bearing.name, node.title].filter(Boolean).join(' ');
        });
        return bearingFilter(node.data as Bearing);
      }

      // For other nodes (folders, etc.), use generic filter on title
      const genericFilter = createGenericFilter(filterText, () => node.title || '');
      return genericFilter(node);
    };

    const recurse = (node: TreeNode): TreeNode | null => {
      // Recurse into children first
      const filteredChildren = node.children
        .map(recurse)
        .filter((n): n is TreeNode => n !== null);
      // Keep node if it matches or any child matched
      if (matchesNode(node) || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    return nodes
      .map(recurse)
      .filter((n): n is TreeNode => n !== null);
  }, [filterText]);

  useEffect(() => {
    if (!filterText.trim()) {
      setFilteredTree(tree);
      return;
    }
    const ft = filterNodes(tree);
    setFilteredTree(ft);
  }, [tree, filterText, filterNodes]);

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Embedding-based order for analets (flagged)
  const analetEmbeddingOrder = useMemo(() => {
    if (!FeatureFlags.LIST_ANCHORED_NOTES) return null;
    const ids = orderAnaletsByEmbedding(props.analets || []);
    return buildOrderIndexMap(ids);
  }, [props.analets]);

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const nodeId = active.id as string;
    // Handle hierarchy cursor specially since it's not in the tree
    if (nodeId === 'hierarchy-cursor') {
      setDraggedItem(hierarchyCursorNode);
    } else {
      const node = findNodeById(tree, nodeId);
      if (node) {
        // Freeze analet dragging in list view when flag enabled
        if (FeatureFlags.LIST_FREEZE_ANALET_DND && (node.kind === 'analet' || node.kind === 'bearing')) {
          setDraggedItem(null);
          return;
        }
        setDraggedItem(node);
      }
    }
    // Capture starting X from activatorEvent or active rect
    const startX = (event.activatorEvent as MouseEvent | undefined)?.clientX;
    if (typeof startX === 'number') {
      dragStartXRef.current = startX;
    } else {
      const r = (event.active.rect as any)?.initial;
      if (r && typeof r.left === 'number' && typeof r.width === 'number') {
        dragStartXRef.current = r.left + r.width / 2;
      } else {
        dragStartXRef.current = null;
      }
    }

  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !active) {
      setDropIndicator(null);
      return;
    }

    const draggedId = active.id as string;
    const targetId = over.id as string;
    if (draggedId === targetId) {
      setDropIndicator(null);
      return;
    }

    // In anchored-notes mode, only allow notes to drop relative to analets (gaps = above/below)
    if (FeatureFlags.LIST_ANCHORED_NOTES) {
      const draggedNode = findNodeById(tree, draggedId);
      const overNode = findNodeById(tree, targetId);
      if (draggedNode && draggedNode.kind === 'note') {
        if (!overNode || overNode.kind !== 'analet') {
          setDropIndicator(null);
          return;
        }
      }
    }

    // Calculate drop position using vertical and horizontal intent
    const rect = over.rect;
    // Use dnd-kit active rect to approximate current pointer center
    const activeRect = (event.active.rect as any)?.current?.translated || (event.active.rect as any)?.current;
    const pointerX = (activeRect && typeof activeRect.left === 'number' && typeof activeRect.width === 'number')
      ? (activeRect.left + activeRect.width / 2)
      : undefined;
    const pointerYAbs = (activeRect && typeof activeRect.top === 'number' && typeof activeRect.height === 'number')
      ? (activeRect.top + activeRect.height / 2)
      : undefined;
    const relativeY = (typeof pointerYAbs === 'number') ? (pointerYAbs - rect.top) : (rect.height / 2);
    // Narrow bands near top/bottom to signal above/below; default to sibling moves
    const bandMargin = rect.height * 0.2; // 20% zones
    const y = Math.max(0, Math.min(rect.height, relativeY));
    // Horizontal indent logic: require substantial x-shift to nest
    const startX = dragStartXRef.current;
    const deltaX = (typeof startX === 'number' && typeof pointerX === 'number') ? (pointerX - startX) : 0;
    const indentTriggerPx = 50; // user-requested 50px threshold for nesting

    let position: 'above' | 'below' | 'inside';
    let effectiveTargetId = targetId;

    if (deltaX >= indentTriggerPx) {
      // Default to child insert when indented at least 50px
      position = 'inside';
    } else {
      // Use narrow top/bottom zones for line indicator placement
      if (y < bandMargin) position = 'above';
      else if (y > rect.height - bandMargin) position = 'below';
      else position = y < rect.height / 2 ? 'above' : 'below';
    }

    // Unnest when dragged left substantially
    if (deltaX <= -indentTriggerPx) {
      const parentId = hierarchyService.getParentId(targetId) || 'item:root';
      effectiveTargetId = parentId;
      if (position === 'inside') position = 'below';
    }

    // Block inside drops for notes in anchored-notes mode
    if (FeatureFlags.LIST_ANCHORED_NOTES) {
      const draggedNode = findNodeById(tree, draggedId);
      if (draggedNode && draggedNode.kind === 'note' && position === 'inside') {
        position = 'below';
      }
    }

    setDropIndicator({ targetId: effectiveTargetId, position });
    // Keep cursor hook aware of current potential drop spot
    try {
      if ((active.id as string) === 'hierarchy-cursor') {
        hierarchyCursor.updateDropPosition(effectiveTargetId, position);
      }
    } catch {}
    setDragPreviewPosition(position);

  };

  // Auto-scroll the container when dragging near edges to avoid ghost lag
  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const el = scrollRef.current;
    const pointerY = (event.activatorEvent as MouseEvent | undefined)?.clientY;
    if (!el || typeof pointerY !== 'number') return;
    const r = el.getBoundingClientRect();
    const threshold = 40; // px
    const scrollStep = 24; // px per move event
    if (pointerY < r.top + threshold) {
      el.scrollTop = el.scrollTop - scrollStep;
    } else if (pointerY > r.bottom - threshold) {
      el.scrollTop = el.scrollTop + scrollStep;
    }
  }, []);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedItem(null);
    setDropIndicator(null);
    dragStartXRef.current = null;

    if (!over || !active || !dropIndicator) {
      return;
    }

    const draggedId = active.id as string;
    const targetId = dropIndicator.targetId;
    const position = dropIndicator.position;
    try {
      const draggedNode = findNodeById(tree, draggedId);
      await handleDrop(draggedId, targetId, position);
      // Log note move events
      if (draggedNode && draggedNode.kind === 'note') {
        trackInteraction('note_move', {
          noteId: draggedId,
          toTargetId: targetId,
          toPosition: position,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('❌ [NewAnalysisList] Error in handleDrop:', error);
    }
  };

  // Keyboard affordance: move selected note up/down among root gaps
  const handleKeyDown = useCallback(async (e: KeyboardEvent) => {
    if (!FeatureFlags.LIST_ANCHORED_NOTES) return;
    if (!selectedTreeNodeId) return;
    const node = findNodeById(tree, selectedTreeNodeId);
    if (!node || node.kind !== 'note') return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    try {
      const parentId = hierarchyService.getParentId(node.id) || 'item:root';
      const siblings = hierarchyService.getChildren(parentId);
      const orderedChildIds = siblings.map(edge => edge.childId);
      const idx = orderedChildIds.indexOf(node.id);
      if (idx === -1) return;
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      const newIdx = Math.max(0, Math.min(orderedChildIds.length - 1, idx + delta));
      if (newIdx === idx) return;
      orderedChildIds.splice(idx, 1);
      orderedChildIds.splice(newIdx, 0, node.id);
      const ok = await hierarchyService.reorderChildren(parentId, orderedChildIds);
      if (ok) updateTree();
    } catch (err) {
      console.error('❌ [NewAnalysisList] Keyboard move failed:', err);
    }
  }, [selectedTreeNodeId, tree, hierarchyService, updateTree]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: any) => handleKeyDown(e as KeyboardEvent);
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [handleKeyDown]);

  // Drop logic
  const handleDrop = async (draggedId: string, targetId: string, position: 'above' | 'below' | 'inside') => {
    try {
      // Handle hierarchy cursor drop
      if (draggedId === 'hierarchy-cursor') {
        await hierarchyCursor.handleDragEnd(targetId, position);
        return;
      }

      const currentParentId = hierarchyService.getParentId(draggedId);
      const existingEdge = currentParentId ? hierarchyService.findEdge(currentParentId, draggedId) : undefined;
      const targetParentId = hierarchyService.getParentId(targetId);
      if (position === 'inside') {
        // Nest under target
        if (existingEdge) {
          // Move under new parent
          const ok = await hierarchyService.moveEdge(existingEdge.edgeId, targetId);
          if (!ok) console.error('Failed to move edge');
          if (ok) updateTree();
        } else {
          // Ensure dragged becomes child of target
          const ok = await hierarchyService.addEdge(targetId, draggedId);
          if (!ok) console.error('Failed to add edge');
          if (ok) updateTree();
        }
        // Expand the new parent by default
        try {
          setExpandedNodes(prev => {
            const s = new Set(prev);
            s.add(targetId);
            return s;
          });
        } catch {}
        // setTimeout(() => logTreeRoots('post-optimistic:roots', hierarchyService.getTree()), 50);
        return;
      }

      // Above/below reordering
      if (!targetParentId) {
        // Target at root; ensure dragged is in root as well using reorder emulation
        const siblings = hierarchyService.getChildren('item:root');
        // If target is not in root siblings, initialize root edges from current tree order
        const targetInRoot = siblings.some(e => e.childId === targetId);
        if (!targetInRoot) {
          // Build ordered root ids from current displayed tree
          const currentRoots = tree.map(n => n.id);
          // Create edges for any roots missing an explicit root edge
          const existing = hierarchyService.getChildren('item:root');
          if (existing.length === 0) {
            // Initialize all roots in one batch to avoid partial state/timeouts
            await hierarchyService.addEdges('item:root', currentRoots, 0);
          } else {
            for (let i = 0; i < currentRoots.length; i++) {
              const id = currentRoots[i];
              const exists = existing.some(e => e.childId === id);
              if (!exists) {
                await hierarchyService.addEdge('item:root', id, existing.length + i);
              }
            }
          }
        }
        const targetIndex = siblings.findIndex(e => e.childId === targetId);
        if (targetIndex >= 0) {
          const newIndex = position === 'above' ? targetIndex : targetIndex + 1;
          const orderedChildIds = siblings.map(e => e.childId);
          const draggedIndex = orderedChildIds.indexOf(draggedId);
          if (draggedIndex >= 0) orderedChildIds.splice(draggedIndex, 1);
          orderedChildIds.splice(newIndex, 0, draggedId);
          const ok = await hierarchyService.reorderChildren('item:root', orderedChildIds);
          if (!ok) console.error('Failed to reorder root children');
          if (ok) updateTree();
        }
        // setTimeout(() => logTreeRoots('post-optimistic:roots', hierarchyService.getTree()), 50);
        return;
      }

      // Siblings under a parent
      const siblings = hierarchyService.getChildren(targetParentId);
      const targetIndex = siblings.findIndex(edge => edge.childId === targetId);
      if (targetIndex < 0) return;

      const newIndex = position === 'above' ? targetIndex : targetIndex + 1;
      const orderedChildIds = siblings.map(edge => edge.childId);

      // Remove dragged from its current parent ordering, possibly different parent
      const draggedIndex = orderedChildIds.indexOf(draggedId);
      if (draggedIndex >= 0) orderedChildIds.splice(draggedIndex, 1);

      // If moving across parents and an edge exists, move first then reorder
      if (existingEdge && currentParentId !== targetParentId) {
        const ok = await hierarchyService.moveEdge(existingEdge.edgeId, targetParentId, newIndex);
        if (!ok) console.error('Failed to move edge across parents');
        if (ok) updateTree();
        // After move, nothing else to do; mutations trigger reload
        // setTimeout(() => logTreeRoots('post-optimistic:roots', hierarchyService.getTree()), 50);
        return;
      }

      // If coming from root (no edge), add then reorder
      if (!existingEdge && (!currentParentId || currentParentId !== targetParentId)) {
        const okAdd = await hierarchyService.addEdge(targetParentId, draggedId, newIndex);
        if (!okAdd) console.error('Failed to add edge into new parent');
        if (okAdd) updateTree();
        // setTimeout(() => logTreeRoots('post-optimistic:roots', hierarchyService.getTree()), 50);
        return;
      }

      // Same parent reorder
      orderedChildIds.splice(newIndex, 0, draggedId);
      const ok = await hierarchyService.reorderChildren(targetParentId, orderedChildIds);

      if (!ok) console.error('Failed to reorder children');
      if (ok) updateTree();
      // setTimeout(() => logTreeRoots('post-optimistic:roots', hierarchyService.getTree()), 50);
    } catch (error) {
      console.error('Drop operation failed:', error);
    }
  };

  // Helper functions
  const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
    return null;
  };

  // Note creation handlers
  const handleCreateNote = useCallback(async () => {
    try {
      // Get the currently selected item to determine parent
      let parentId = 'item:root'; // Use consistent root ID format

      // Check if local tree selection exists and is valid
      if (selectedTreeNodeId) {
        const selectedNode = findNodeById(tree, selectedTreeNodeId);
        if (selectedNode) {
          parentId = selectedTreeNodeId;
        }
      } else if (props.sharedSelection && props.sharedSelection.getSelectedCount() === 1) {
        // Fall back to shared selection (analets/bearings)
        const selectedAnaletIds = Array.from(props.sharedSelection.selectionState.selectedAnaletIds);
        const selectedBearingIds = Array.from(props.sharedSelection.selectionState.selectedBearingIds);

        if (selectedAnaletIds.length > 0) {
          parentId = `analet-${selectedAnaletIds[0]}`;
        } else if (selectedBearingIds.length > 0) {
          parentId = `bearing-${selectedBearingIds[0]}`;
        }
      }

      // Step 1: Create the note without parent info (backend will handle note creation)
      // Listen for the response
      const cleanup = onMessage('create-blank-note', async (data: any) => {
        if (data?.note) {
          const noteId = `note-${data.note.id}`;

          // Step 2: Create the edge using the same method as drag-and-drop
          const edgeCreated = await hierarchyService.addEdge(parentId, noteId, parentId === 'item:root' ? 0 : undefined);

          if (edgeCreated) {
            // If adding to root with no selection, ensure it appears at the top
            if (parentId === 'item:root') {
              try {
                const siblings = hierarchyService.getChildren('item:root');
                const existingIds = siblings.map(e => e.childId).filter(id => id !== noteId);
                const ordered = [noteId, ...existingIds];
                await hierarchyService.reorderChildren('item:root', ordered);
              } catch (e) {
                console.error('Failed to reorder root to place new note at top:', e);
              }
            }
            // Set pending note creation - this will be processed when hierarchy updates
            setPendingNoteCreation({
              noteId,
              numericId: data.note.id,
              parentId
            });
          } else {
            console.error('Failed to create edge for note');
          }
        } else {
          console.error('Failed to create note');
        }

        // Clean up the listener
        cleanup();
      });

      // Send the request
      sendMessage('create-blank-note', {});
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  }, [sendMessage, onMessage, props.sharedSelection, selectedTreeNodeId, tree, props.analets, props.bearings, hierarchyService, setExpandedNodes, setExpandedNotes]);


  const handleNodeClick = useCallback((node: TreeNode, event: React.MouseEvent) => {
    const isMultiSelect = event.metaKey || event.ctrlKey;
    const isRangeSelect = event.shiftKey;

    // Clear local tree selection when clicking on analets/bearings (they use sharedSelection)
    // But set local selection when clicking on notes
    if (node.kind === 'note') {
      // Handle note selection locally
      if (!isMultiSelect && !isRangeSelect) {
        const isCurrentlySelected = selectedTreeNodeId === node.id;
        if (isCurrentlySelected) {
          setSelectedTreeNodeId(null); // Deselect if already selected
        } else {
          setSelectedTreeNodeId(node.id); // Select this note
        }
        // Clear shared selection when selecting a note
        if (props.sharedSelection) {
          props.sharedSelection.clearSelection();
        }
      }
    } else {
      // Clear local tree selection when selecting analets/bearings
      setSelectedTreeNodeId(null);
    }

    if (node.kind === 'analet' && node.data) {
      const analet = node.data as Analet;

      // Handle selection
      if (props.sharedSelection) {
        const isCurrentlySelected = props.sharedSelection.isAnaletSelected(analet.id);
        ///TODODODYLAN
        if (!isMultiSelect && !isRangeSelect && isCurrentlySelected) {
          if (props.sharedSelection.getSelectedCount() === 1) {
            props.sharedSelection.clearSelection();
          } else {
            props.sharedSelection.selectAnalet(analet.id, false, false, undefined);
          }
        } else {
          props.sharedSelection.selectAnalet(analet.id, isMultiSelect, isRangeSelect, props.analets);
        }
      }

      // On single click: optimistically materialize and toggle details view (CellQL/explanation)
      if (!isMultiSelect && !isRangeSelect) {
        if (!isMaterialized(analet.id)) materializeAnalet(analet.id);
        setDetailsExpandedAnaletIds(prev => {
          const next = new Set(prev);
          if (next.has(analet.id)) next.delete(analet.id); else next.add(analet.id);
          return next;
        });
      }
      sendMessage('create-or-open-cell', {
        analetId: analet.id
      });
    } else if (node.kind === 'bearing' && node.data) {
      const bearing = node.data as Bearing;

      // Handle bearing selection
      if (props.sharedSelection) {
        const isCurrentlySelected = props.sharedSelection.isBearingSelected(bearing.id);
        if (!isMultiSelect && !isRangeSelect && isCurrentlySelected) {
          if (props.sharedSelection.getSelectedCount() === 1) {
            props.sharedSelection.clearSelection();
          } else {
            props.sharedSelection.selectBearing(bearing.id, false, false, undefined);
          }
        } else {
          props.sharedSelection.selectBearing(bearing.id, isMultiSelect, isRangeSelect, props.bearings);
        }
      }
      // Set active bearing for map integrations (bubble set, generation context)
      try { StateService.getInstance().setActiveBearingId(bearing.id); } catch {}
    }
  }, [props.sharedSelection, props.analets, props.bearings, isMaterialized, materializeAnalet, selectedTreeNodeId]);

  // Handle double-click on notes to open for editing
  const handleNodeDoubleClick = useCallback((node: TreeNode, _event: React.MouseEvent) => {
    if (node.kind === 'note' && node.data) {
      const note = node.data as AnalysisNote;

      // Select the note
      setSelectedTreeNodeId(node.id);

      // Expand the note for editing
      setExpandedNotes(prev => {
        const newSet = new Set(prev);
        newSet.add(note.id);
        return newSet;
      });

      // Clear shared selection
      if (props.sharedSelection) {
        props.sharedSelection.clearSelection();
      }
    }
  }, [props.sharedSelection]);

  // Toggle children visibility for a tree node
  const handleToggleChildrenExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  }, []);

  // Toggle details visibility for an analet
  const handleToggleDetails = useCallback((analetId: number) => {
    setDetailsExpandedAnaletIds(prev => {
      const next = new Set(prev);
      if (next.has(analetId)) next.delete(analetId); else next.add(analetId);
      return next;
    });
  }, []);

  // Expand ancestor chain for a node id
  const expandAncestors = useCallback((nodeId: string) => {
    try {
      const toExpand: string[] = [];
      let current: string | undefined | null = nodeId;
      while (current && current !== 'item:root') {
        const parent = hierarchyService.getParentId(current);
        if (!parent || parent === 'item:root') break;
        toExpand.push(parent);
        current = parent;
      }
      if (toExpand.length > 0) {
        setExpandedNodes(prev => {
          const next = new Set(prev);
          toExpand.forEach(id => next.add(id));
          return next;
        });
      }
    } catch {}
  }, [hierarchyService]);

  // Check if a node exists in the currently rendered tree (respects filtering)
  const nodeExistsInRenderedTree = useCallback((nodes: TreeNode[], targetId: string): boolean => {
    for (const n of nodes) {
      if (n.id === targetId) return true;
      if (n.children && n.children.length > 0) {
        if (nodeExistsInRenderedTree(n.children, targetId)) return true;
      }
    }
    return false;
  }, []);

  // Auto-track: when a single analet is selected, center it (or top if near edges)
  useEffect(() => {
    if (!isAutoTrackEnabled) return;
    if (!props.sharedSelection) return;
    const selectedAnaletIds = Array.from(props.sharedSelection.selectionState.selectedAnaletIds || []);
    if (selectedAnaletIds.length !== 1) return;
    const selectedAnaletId = selectedAnaletIds[0];
    const selectedNodeId = `analet-${selectedAnaletId}`;

    // Expand parents so the item becomes visible
    expandAncestors(selectedNodeId);

    // Verify the node exists in the currently rendered tree (respect filters)
    const treeToRender = (props.filterText && props.filterText.trim()) ? filteredTree : tree;
    const present = nodeExistsInRenderedTree(treeToRender, selectedNodeId);
    if (!present) return;

    // Scroll after DOM updates. Use double RAF to wait for expand render.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (!container) return;
        const el = container.querySelector<HTMLElement>(`[data-node-id="${selectedNodeId}"]`);
        if (!el) return;

        // If already fully visible, skip
        const cr = container.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const fullyVisible = er.top >= cr.top && er.bottom <= cr.bottom;
        if (fullyVisible) return;

        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        const relativeTop = (er.top - cr.top) + container.scrollTop;
        const centerTop = Math.round(relativeTop - (container.clientHeight - el.clientHeight) / 2);
        const canCenter = centerTop >= 0 && centerTop <= maxScroll;
        const targetTop = canCenter ? centerTop : relativeTop;
        container.scrollTo({ top: Math.max(0, Math.min(maxScroll, targetTop)), behavior: 'smooth' });
      });
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [isAutoTrackEnabled, props.sharedSelection?.selectionState.lastSelectedId, props.sharedSelection?.selectionState.lastSelectedType, tree, filteredTree, props.filterText]);

  // Render tree node
  const renderTreeNode = (node: TreeNode, level: number = 0): React.ReactNode => {
    const forceExpandDueToFilter = filterText.trim().length > 0;
    const isChildrenExpanded = forceExpandDueToFilter ? true : expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = node.kind === 'analet' && node.data ?
      props.sharedSelection?.isAnaletSelected((node.data as Analet).id) :
      node.kind === 'bearing' && node.data ?
      props.sharedSelection?.isBearingSelected((node.data as Bearing).id) :
      false;
    const hoveredAnaletId = props.sharedSelection?.getHoveredAnaletId?.();
    const isHovered = node.kind === 'analet' && node.data ? hoveredAnaletId === (node.data as Analet).id : false;

    const nodeDropIndicator = dropIndicator?.targetId === node.id ? dropIndicator : undefined;

    if (node.kind === 'analet') {
      const analetId = (node.data as Analet).id;
      const isDetailsOpen = detailsExpandedAnaletIds.has(analetId);
      return (
        <div key={node.id}>
          <NewAnaletItem
            node={node}
            level={level}
            isSelected={isSelected || false}
            isHovered={isHovered}
            isChildrenExpanded={isChildrenExpanded}
            isDetailsOpen={isDetailsOpen}
            dropIndicator={nodeDropIndicator}
            onClick={(e: React.MouseEvent) => handleNodeClick(node, e)}
            onToggleChildrenExpand={() => handleToggleChildrenExpand(node.id)}
            onToggleDetails={() => handleToggleDetails(analetId)}
            isMaterialized={node.data ? isMaterialized((node.data as Analet).id) : false}
            sharedSelection={props.sharedSelection}
            isDragging={draggedItem?.id === node.id}
            previewIndentPx={draggedItem?.id === node.id && dragPreviewPosition === 'inside' ? 24 : undefined}
          />
          {isChildrenExpanded && hasChildren && (
            <div>
              {node.children.map(child => renderTreeNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    } else if (node.kind === 'bearing') {
      return (
        <div key={node.id}>
          <NewBearingItem
            node={node}
            level={level}
            isSelected={isSelected || false}
            isExpanded={isChildrenExpanded}
            dropIndicator={nodeDropIndicator}
            onClick={(e: React.MouseEvent) => handleNodeClick(node, e)}
            onToggleExpand={() => handleToggleChildrenExpand(node.id)}
            onRename={async (_newName: string) => {
              // TODO: Implement bearing rename
            }}
            onDelete={async () => {
              // TODO: Implement bearing delete
            }}
            previewIndentPx={draggedItem?.id === node.id && dragPreviewPosition === 'inside' ? 24 : undefined}
          />

          {/* Render children if expanded */}
          {isChildrenExpanded && hasChildren && (
            <div>
              {node.children.map(child => renderTreeNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    } else if (node.kind === 'note') {
      const note = node.data as AnalysisNote;
      const isNoteExpanded = expandedNotes.has(note.id);
      return (
        <div key={node.id}>
          <NoteItem
            node={node}
            level={level}
            isSelected={selectedTreeNodeId === node.id}
            isHovered={false}
            isChildrenExpanded={isChildrenExpanded}
            isDetailsOpen={false}
            dropIndicator={nodeDropIndicator}
            onClick={(e: React.MouseEvent) => handleNodeClick(node, e)}
            onDoubleClick={(e: React.MouseEvent) => handleNodeDoubleClick(node, e)}
            onToggleChildrenExpand={() => {
              // Only allow hierarchy expansion if the note actually has children
              if (node.children.length > 0) {
                setExpandedNodes(prev => {
                  const newSet = new Set(prev);
                  if (newSet.has(node.id)) {
                    newSet.delete(node.id);
                  } else {
                    newSet.add(node.id);
                  }
                  return newSet;
                });
              }
            }}
            onToggleDetails={() => {
              // Details toggle for notes not implemented yet
            }}
            sharedSelection={props.sharedSelection}
            isDragging={draggedItem?.id === node.id}
            previewIndentPx={draggedItem?.id === node.id && dragPreviewPosition === 'inside' ? 24 : undefined}
            // Note-specific props for inline editing
            isExpanded={isNoteExpanded}
            onToggleExpanded={() => {
              setExpandedNotes(prev => {
                const newSet = new Set(prev);
                if (newSet.has(note.id)) {
                  newSet.delete(note.id);
                } else {
                  newSet.add(note.id);
                }
                return newSet;
              });
            }}
            variables={props.conceptualStatementsProps?.variables || []}
            groups={props.conceptualStatementsProps?.groups || []}
            datasetData={props.conceptualStatementsProps?.datasetData || []}
            profile={undefined}
          />
          {/* Render children if expanded */}
          {isChildrenExpanded && node.children.length > 0 && (
            <div>
              {node.children.map(child => renderTreeNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    } else if (node.kind === 'hierarchy-cursor') {
      const cursorData = node.data as any;
      const isCursorExpanded = expandedNodes.has(node.id);
      return (
        <div key={node.id}>
          <HierarchyCursorItem
            node={node}
            level={level}
            isSelected={selectedTreeNodeId === node.id}
            isHovered={false}
            isChildrenExpanded={isChildrenExpanded}
            isDetailsOpen={isCursorExpanded}
            dropIndicator={nodeDropIndicator}
            onClick={() => {
              // Double-click disabled; use Save button on the item

            }}
            onToggleChildrenExpand={() => {
              setExpandedNodes(prev => {
                const newSet = new Set(prev);
                if (newSet.has(node.id)) {
                  newSet.delete(node.id);
                } else {
                  newSet.add(node.id);
                }
                return newSet;
              });
            }}
            onToggleDetails={() => {
              setExpandedNodes(prev => {
                const newSet = new Set(prev);
                if (newSet.has(node.id)) {
                  newSet.delete(node.id);
                } else {
                  newSet.add(node.id);
                }
                return newSet;
              });
            }}
            isMaterialized={true}
            sharedSelection={props.sharedSelection}
            isDragging={draggedItem?.id === node.id}
            previewIndentPx={draggedItem?.id === node.id && dragPreviewPosition === 'inside' ? 24 : undefined}
            parentContext={cursorData.parentContext}
            siblingContext={cursorData.siblingContext}
            ancestorContext={cursorData.ancestorContext}
            ordinalDistances={cursorData.ordinalDistances}
            previewIdea={cursorData.previewIdea}
            previewAnalet={hierarchyCursor.cursorState.previewAnalet}
            isLoading={cursorData.isLoading}
            onGenerateAnalet={hierarchyCursor.generateAnalet}
          />
          {/* Render children if expanded */}
          {isChildrenExpanded && node.children.length > 0 && (
            <div>
              {node.children.map(child => renderTreeNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  // Show loading state
  if (props.isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-[var(--vscode-editor-background)] rounded-lg overflow-hidden shadow-lg shadow-black/10 text-center space-y-2"
        style={{ height: props.height || 700 }}
      >
        <div className="animate-spin rounded-full h-4 w-4 border border-[var(--vscode-descriptionForeground)] border-t-transparent"></div>
        <div className="text-sm text-[var(--vscode-descriptionForeground)]">
          Preparing analysis
          <span className="inline-block align-baseline" style={{ minWidth: '3ch' }}>{dots}</span>
        </div>
        <div>
          <button
            onClick={() => {
              try {
                console.log('[framing][webview] Refresh clicked (list): requesting generate-analyses');
                const msg = MessageService.getInstance();
                msg.sendMessage('generate-analyses', { forceGenerate: false });
              } catch (e) {
                console.error('❌ [NewAnalysisList] Failed to refresh analyses:', e);
              }
            }}
            className="px-2 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] text-xs"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col bg-[var(--vscode-editor-background)] rounded-lg overflow-hidden shadow-lg shadow-black/10"
      style={{ height: props.height || 700 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-[var(--vscode-panel-border)]">
        <div />
        <div className="flex items-center gap-2">
          {/* Hierarchy Cursor Toggle */}
          <button
            onClick={() => {
              const newEnabled = !isHierarchyCursorEnabled;
              setIsHierarchyCursorEnabled(newEnabled);
              hierarchyCursor.setCursorVisible(newEnabled);
              try { window.dispatchEvent(new CustomEvent('hierarchyCursorChanged', { detail: { enabled: newEnabled } })); } catch {}
              if (newEnabled) {
                hierarchyCursor.moveToPath(['root']);
              }
            }}
            className={`p-2 rounded-md transition-all duration-200 ${
              isHierarchyCursorEnabled
                ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                : 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-list-hoverBackground)]'
            }`}
            title="Toggle Hierarchy Cursor"
            aria-label="Toggle Hierarchy Cursor"
          >
            <EmbeddingCursorIcon />
          </button>
          <button
            onClick={handleCreateNote}
            className="p-2 rounded-md transition-all duration-200 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
            title={props.sharedSelection?.getSelectedCount() === 1
              ? 'Create note as child of selected item'
              : 'Create new analysis note'}
            aria-label="Create note"
          >
            <AddNoteIcon />
          </button>
          <button
            onClick={() => {
              const current = (() => { try { return localStorage.getItem('autoTrackEnabled') === '1'; } catch { return isAutoTrackEnabled; } })();
              const next = !current;
              // Immediate local state update for responsive UI
              setIsAutoTrackEnabled(next);
              try { localStorage.setItem('autoTrackEnabled', next ? '1' : '0'); } catch {}
              try { window.dispatchEvent(new CustomEvent('toggleAutoTrack', { detail: { enabled: next } })); } catch {}
            }}
            className={`p-2 rounded-md transition-all duration-200 ${
              isAutoTrackEnabled
                ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                : 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-list-hoverBackground)]'
            }`}
            title="Toggle Auto Track"
            aria-label="Toggle Auto Track"
            aria-pressed={isAutoTrackEnabled}
          >
            <AutoTrackIcon enabled={isAutoTrackEnabled} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-2" ref={(el) => { scrollRef.current = el; containerRef.current = el; }} tabIndex={0}>
        {(
          tree.length === 0 ? (
            // Empty state
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <div className="text-[var(--vscode-descriptionForeground)] mb-4">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
                No analets to display
              </div>
              <button
                onClick={() => {
                  sendMessage('add-waypoint-analets', { count: 20 });
                }}
                className="px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded text-sm font-medium transition-colors"
              >
                Add Analyses
              </button>
            </div>
          ) : (
            // Tree view with drag and drop
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
            >
              <div className="space-y-1">
                {(() => {
                  const baseTree = props.filterText ? filteredTree : tree;
                  if (FeatureFlags.LIST_ANCHORED_NOTES && analetEmbeddingOrder) {
                    // Re-bin non-analet roots to the preceding analet’s embedding order index
                    const analetNodes: TreeNode[] = [];
                    const bins: Record<number, TreeNode[]> = {};
                    const findPrevAnaletIndex = (idx: number) => {
                      for (let i = idx - 1; i >= 0; i--) {
                        const n = baseTree[i];
                        if (n.kind === 'analet') return analetEmbeddingOrder.get((n.data as Analet).id) ?? 0;
                      }
                      return 0;
                    };
                    baseTree.forEach((n, i) => {
                      if (n.kind === 'analet') {
                        analetNodes.push(n);
                      } else {
                        const binIndex = findPrevAnaletIndex(i);
                        if (!bins[binIndex]) bins[binIndex] = [];
                        bins[binIndex].push(n);
                      }
                    });
                    // Sort analet nodes by embedding order
                    analetNodes.sort((a, b) => {
                      const ai = analetEmbeddingOrder.get((a.data as Analet).id) ?? 0;
                      const bi = analetEmbeddingOrder.get((b.data as Analet).id) ?? 0;
                      return ai - bi;
                    });

                    const orderedRoots: TreeNode[] = [];
                    analetNodes.forEach((an) => {
                      const oi = analetEmbeddingOrder.get((an.data as Analet).id) ?? 0;
                      if (bins[oi]) {
                        orderedRoots.push(...bins[oi]);
                        delete bins[oi];
                      }
                      orderedRoots.push(an);
                    });
                    // Append any trailing bin content
                    const remainingKeys = Object.keys(bins).map(k => Number(k)).sort((a, b) => a - b);
                    remainingKeys.forEach(k => { orderedRoots.push(...bins[k]); });

                    const renderList = orderedRoots;
                    if (isHierarchyCursorEnabled && hierarchyCursor.cursorState.isVisible) {
                      const treeWithCursor = insertCursorAtPath(renderList, hierarchyCursorNode, hierarchyCursor.cursorState.currentPath);
                      return treeWithCursor.map(node => renderTreeNode(node, 0));
                    }
                    return renderList.map(node => renderTreeNode(node, 0));
                  }

                  // Default rendering
                  if (isHierarchyCursorEnabled && hierarchyCursor.cursorState.isVisible) {
                    const treeWithCursor = insertCursorAtPath(baseTree, hierarchyCursorNode, hierarchyCursor.cursorState.currentPath);
                    return treeWithCursor.map(node => renderTreeNode(node, 0));
                  }
                  return baseTree.map(node => renderTreeNode(node, 0));
                })()}
              </div>
            </DndContext>
          )
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 text-xs text-[var(--vscode-descriptionForeground)] border-t border-[var(--vscode-panel-border)]">
        <div className="flex justify-between items-center">
          <span>{`${props.analets.length} analets • ${props.bearings.length} bearings • ${tree.length} root items`}</span>
          <span className="text-[var(--vscode-descriptionForeground)] opacity-75">{'Drag to nest • ⌘/Ctrl+Click: Multi-select • Shift+Click: Range select'}</span>
        </div>
      </div>

    </div>
  );
};
