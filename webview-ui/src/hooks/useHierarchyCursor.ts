import { useState, useCallback, useRef, useEffect } from 'react';
import { TreeNode } from '../services/HierarchyService';
import { HierarchySimilarityService, OrdinalDistance } from '../services/HierarchySimilarityService';
import { useMessageHandler } from './useMessageHandler';

export interface HierarchyCursorState {
  currentPath: string[];
  currentDepth: number;
  parentContext?: TreeNode;
  siblingContext: TreeNode[];
  ancestorContext: TreeNode[];
  ordinalDistances: OrdinalDistance[];
  previewIdea?: string;
  previewAnalet?: any; // Store the generated analet
  isLoading: boolean;
  isVisible: boolean;
  similarAnalets: any[];
  // New properties for draggable item approach
  isDragging: boolean;
  dropPosition?: { targetId: string; position: 'above' | 'below' | 'inside' };
  // Correlation and gating
  lastPreviewRequestId?: string;
  lastAnaletPreviewRequestId?: string;
  hasAnaletPreviewForPath?: boolean;
}

export interface UseHierarchyCursorProps {
  tree: TreeNode[];
  onAnaletClick?: (analet: any) => void;
  onExpandNode?: (nodeId: string) => void;
}

export function useHierarchyCursor({ tree, onExpandNode }: UseHierarchyCursorProps) {
  const { sendMessage, onMessage } = useMessageHandler();
  const hierarchySimilarityService = HierarchySimilarityService.getInstance();

  const [cursorState, setCursorState] = useState<HierarchyCursorState>({
    currentPath: ['root'],
    currentDepth: 0,
    parentContext: undefined,
    siblingContext: [],
    ancestorContext: [],
    ordinalDistances: [],
    previewIdea: undefined,
    previewAnalet: undefined,
    isLoading: false,
    isVisible: false,
    similarAnalets: [],
    isDragging: false,
    dropPosition: undefined,
    lastPreviewRequestId: undefined,
    lastAnaletPreviewRequestId: undefined,
    hasAnaletPreviewForPath: false
  });

  const cursorIdeaRef = useRef<string>('');
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Find node by path
  const findNodeByPath = useCallback((path: string[], nodes: TreeNode[]): TreeNode | null => {
    if (path.length === 0) return null;

    let currentNodes = nodes;
    let targetNode: TreeNode | null = null;

    for (let i = 0; i < path.length; i++) {
      const pathSegment = path[i];
      targetNode = currentNodes.find(node => node.id === pathSegment) || null;

      if (!targetNode) return null;

      if (i < path.length - 1) {
        currentNodes = targetNode.children || [];
      }
    }

    return targetNode;
  }, []);

  // Find full path (including 'root') to a node id by traversing the current tree
  const findPathToNode = useCallback((targetId: string, nodes: TreeNode[], acc: string[] = ['root']): string[] | null => {
    for (const node of nodes) {
      const nextPath = [...acc, node.id];
      if (node.id === targetId) {
        return nextPath;
      }
      const found = findPathToNode(targetId, node.children || [], nextPath);
      if (found) return found;
    }
    return null;
  }, []);

  // Get parent, sibling, and ancestor context for current path
  const getContextForPath = useCallback((path: string[]): {
    parent?: TreeNode;
    siblings: TreeNode[];
    ancestors: TreeNode[];
    ordinalDistances: OrdinalDistance[];
  } => {
    // Normalize path: strip synthetic 'root' if present
    const normPath = Array.isArray(path) && path[0] === 'root' ? path.slice(1) : path;
    if (normPath.length === 0) {
      // true root level
      const ordinalDistances = hierarchySimilarityService.calculateOrdinalDistances(
        ['root'],
        0,
        tree,
        []
      );

      return { parent: undefined, siblings: tree, ancestors: [], ordinalDistances };
    }
    // Do not treat single-segment paths as root-level; resolve to that node
    // Resolve parent/siblings using dropPosition first (inside → target; above/below → target's parent)
    let parentNode: TreeNode | undefined;
    let siblingsResolved: TreeNode[] = [];
    let consumed: string[] = [];
    if (cursorState.dropPosition && cursorState.dropPosition.targetId) {
      const { targetId, position } = cursorState.dropPosition;
      const pathToTarget = findPathToNode(targetId, tree) || ['root'];
      const normTargetPath = pathToTarget[0] === 'root' ? pathToTarget.slice(1) : pathToTarget;
      if (position === 'inside') {
        parentNode = findNodeByPath(normTargetPath, tree) || undefined;
        consumed = normTargetPath.slice();
        siblingsResolved = parentNode?.children || [];
      } else {
        const parentPath = normTargetPath.slice(0, -1);
        parentNode = parentPath.length > 0 ? findNodeByPath(parentPath, tree) || undefined : undefined;
        consumed = parentPath.slice();
        siblingsResolved = parentNode ? (parentNode.children || []) : tree;
      }
    }
    // Fallback: Walk down the tree as far as we can along normPath
    if (!parentNode) {
      let currentNodes = tree;
      for (let i = 0; i < normPath.length; i++) {
        const seg = normPath[i];
        const next = currentNodes.find(n => n.id === seg);
        if (!next) break;
        consumed.push(seg);
        parentNode = next;
        currentNodes = next.children || [];
      }
      siblingsResolved = parentNode?.children || [];
    }
    if (!parentNode) {
      try {
        console.warn('[cursor][context] parent not found', { path, normPath });
      } catch {}
      return {
        parent: undefined,
        siblings: [],
        ancestors: [],
        ordinalDistances: []
      };
    }
    // Build ancestor chain (direct lineage up to root)
    const ancestors: TreeNode[] = [];
    for (let i = consumed.length - 1; i > 0; i--) {
      const ancestorNode = findNodeByPath(consumed.slice(0, i), tree);
      if (ancestorNode) {
        ancestors.push(ancestorNode);
      }
    }
    // Calculate ordinal distances
    const ordinalDistances = hierarchySimilarityService.calculateOrdinalDistances(['root', ...consumed], consumed.length, siblingsResolved, ancestors);
    const result = {
      parent: parentNode,
      siblings: siblingsResolved,
      ancestors,
      ordinalDistances
    };

    return result;
  }, [tree, findNodeByPath, hierarchySimilarityService]);

  // Move cursor to a new path
  const moveToPath = useCallback((newPath: string[]) => {
    const { parent, siblings, ancestors, ordinalDistances } = getContextForPath(newPath);
    const depth = newPath.length - 1;
    setCursorState(prev => ({
      ...prev,
      currentPath: newPath,
      currentDepth: depth,
      parentContext: parent,
      siblingContext: siblings,
      ancestorContext: ancestors,
      ordinalDistances,
      isVisible: true
    }));
  }, [getContextForPath]);

  // Navigate cursor in different directions
  const navigateCursor = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const { currentPath, siblingContext } = cursorState;

    switch (direction) {
      case 'up':
        // Move to parent level
        if (currentPath.length > 1) {
          const newPath = currentPath.slice(0, -1);
          moveToPath(newPath);
        }
        break;

      case 'down':
        // Move to first child if available
        if (siblingContext.length > 0) {
          const firstChild = siblingContext[0];
          const newPath = [...currentPath, firstChild.id];
          moveToPath(newPath);
        }
        break;

      case 'left': {
        // Move to previous sibling
        const currentIndex = siblingContext.findIndex(node => node.id === currentPath[currentPath.length - 1]);
        if (currentIndex > 0) {
          const newPath = [...currentPath.slice(0, -1), siblingContext[currentIndex - 1].id];
          moveToPath(newPath);
        }
        break;
      }

      case 'right': {
        // Move to next sibling
        const currentIndexRight = siblingContext.findIndex(node => node.id === currentPath[currentPath.length - 1]);
        if (currentIndexRight < siblingContext.length - 1) {
          const newPath = [...currentPath.slice(0, -1), siblingContext[currentIndexRight + 1].id];
          moveToPath(newPath);
        }
        break;
      }
    }
  }, [cursorState, moveToPath]);

  // Generate preview for a path (fresh context), default to current
  const generatePreview = useCallback(async (overridePath?: string[]) => {
    const pathToUse = overridePath || cursorState.currentPath;
    if (pathToUse.length === 0) return;
    const depth = pathToUse.length - 1;
    const { parent, siblings, ancestors, ordinalDistances } = getContextForPath(pathToUse);
    // Clear stale preview immediately to avoid showing previous content
    setCursorState(prev => ({
      ...prev,
      isLoading: true,
      previewIdea: undefined,
      previewAnalet: undefined,
      hasAnaletPreviewForPath: false
    }));
    try {
      const requestId = Math.random().toString(36);
      setCursorState(prev => ({ ...prev, lastPreviewRequestId: requestId }));
      const generationMode = (cursorState.dropPosition?.position === 'inside') ? 'followup' : 'sibling';
      sendMessage('generate-hierarchy-description', {
        path: pathToUse,
        depth,
        parentContext: parent ? { kind: parent.kind, title: parent.title, data: parent.data } : undefined,
        siblingContext: siblings.map(s => ({ kind: s.kind, title: s.title, data: s.data })),
        ancestorContext: ancestors.map(a => ({ kind: a.kind, title: a.title, data: a.data })),
        ordinalDistances: ordinalDistances.map(d => ({ targetId: d.targetId, targetTitle: d.targetTitle, targetKind: d.targetKind, distance: d.distance, relationship: d.relationship, description: d.description })),
        generationMode,
        requestId
      });
    } catch (error) {
      console.error('❌ [useHierarchyCursor] Error generating preview:', error);
      setCursorState(prev => ({ ...prev, isLoading: false }));
    }
  }, [cursorState.currentPath, getContextForPath, sendMessage]);

  // Generate full analet during preview (stores in state)
  const generatePreviewAnalet = useCallback(async (overridePath?: string[]) => {
    const pathToUse = overridePath || cursorState.currentPath;
    if (pathToUse.length === 0) return;
    const depth = pathToUse.length - 1;
    const { parent, siblings, ancestors, ordinalDistances } = getContextForPath(pathToUse);
    try {
      const requestId = Math.random().toString(36);
      setCursorState(prev => ({ ...prev, lastAnaletPreviewRequestId: requestId }));
      const generationMode = (cursorState.dropPosition?.position === 'inside') ? 'followup' : 'sibling';
      sendMessage('generate-hierarchy-analet', {
        path: pathToUse,
        depth,
        parentContext: parent ? { kind: parent.kind, title: parent.title, data: parent.data } : undefined,
        siblingContext: siblings.map(s => ({ kind: s.kind, title: s.title, data: s.data })),
        ancestorContext: ancestors.map(a => ({ kind: a.kind, title: a.title, data: a.data })),
        ordinalDistances: ordinalDistances.map(d => ({ targetId: d.targetId, targetTitle: d.targetTitle, targetKind: d.targetKind, distance: d.distance, relationship: d.relationship, description: d.description })),
        similarAnalets: [],
        generationMode,
        requestId
      });
    } catch (error) {
      console.error('❌ [useHierarchyCursor] Error generating preview analet:', error);
    }
  }, [cursorState.currentPath, getContextForPath, sendMessage]);

  // Generate analet at current position or specified path
  const generateAnalet = useCallback(async (idea: string, targetPath?: string[]) => {
    // Use target path if provided, otherwise use current path
    const pathToUse = targetPath || cursorState.currentPath;
    const fullIdea = cursorState.previewAnalet?.statement || idea;
    // Check if we have a stored analet for this path
    if (cursorState.previewAnalet && pathToUse.join(',') === cursorState.currentPath.join(',')) {
      // Use the stored analet and just save it
      try {
        const requestId = Math.random().toString(36);
        sendMessage('save-analet-from-hierarchy', {
          analet: cursorState.previewAnalet,
          path: pathToUse,
          requestId
        });
        return;
      } catch (error) {
        console.error('❌ [useHierarchyCursor] Error saving stored analet:', error);
      }
    }

    // Fallback: generate new analet if no stored one available
    // Compute explicit parentId and orderIndex based on last drop position if present
    let parentIdOverride: string | undefined;
    let orderIndex: number | undefined;
    try {
      if (cursorState.dropPosition && cursorState.dropPosition.targetId) {
        const { targetId, position } = cursorState.dropPosition;
        const pathToTarget = findPathToNode(targetId, tree) || ['root'];
        if (position === 'inside') {
          parentIdOverride = targetId;
          orderIndex = 0;
        } else {
          // Sibling placement relative to target
          const parentPath = pathToTarget.slice(0, -1);
          const parentNode = parentPath.length > 1 ? findNodeByPath(parentPath.slice(1), tree) : null;
          const siblingsList = parentNode?.children || (parentPath.length <= 1 ? tree : []);
          const idx = siblingsList.findIndex(c => c.id === targetId);
          orderIndex = Math.max(0, (position === 'above' ? idx : idx + 1));
          const parentSeg = parentPath.length > 0 ? parentPath[parentPath.length - 1] : 'item:root';
          parentIdOverride = parentSeg === 'root' ? 'item:root' : parentSeg;
        }
      } else {
        // Fallback to current path semantics
        parentIdOverride = pathToUse.length <= 1 ? 'item:root' : (pathToUse[pathToUse.length - 1] === 'root' ? 'item:root' : pathToUse[pathToUse.length - 1]);
        orderIndex = 0;
      }
    } catch {
      parentIdOverride = pathToUse.length <= 1 ? 'item:root' : (pathToUse[pathToUse.length - 1] === 'root' ? 'item:root' : pathToUse[pathToUse.length - 1]);
      orderIndex = 0;
    }

    // Get fresh context for the path we're using
    const { parent, siblings, ancestors, ordinalDistances } = getContextForPath(pathToUse);

    try {
      const requestId = Math.random().toString(36);
      const messageData = {
        idea: fullIdea,
        path: pathToUse,
        depth: pathToUse.length - 1,
        parentIdOverride,
        orderIndex,
        parentContext: parent ? {
          kind: parent.kind,
          title: parent.title,
          data: parent.data
        } : undefined,
        siblingContext: siblings.map(sibling => ({
          kind: sibling.kind,
          title: sibling.title,
          data: sibling.data
        })),
        ancestorContext: ancestors.map(ancestor => ({
          kind: ancestor.kind,
          title: ancestor.title,
          data: ancestor.data
        })),
        ordinalDistances: ordinalDistances.map(distance => ({
          targetId: distance.targetId,
          targetTitle: distance.targetTitle,
          targetKind: distance.targetKind,
          distance: distance.distance,
          relationship: distance.relationship,
          description: distance.description
        })),
        similarAnalets: [],
        requestId
      };
      // If we have a pre-generated analet stored for this path, just save it with placement
      if (cursorState.previewAnalet && pathToUse.join(',') === cursorState.currentPath.join(',')) {
        sendMessage('save-analet-from-hierarchy', {
          analet: cursorState.previewAnalet,
          path: pathToUse,
          parentIdOverride,
          orderIndex,
          requestId: messageData.requestId
        });
      } else {
        sendMessage('create-analet-from-hierarchy', messageData);
      }
    } catch (error) {
      console.error('❌ [useHierarchyCursor] Error creating analet:', error);
    }
  }, [cursorState.currentPath, cursorState.previewAnalet, cursorState.dropPosition, sendMessage, getContextForPath, findPathToNode, tree, findNodeByPath]);

  // Handle drag start
  const handleDragStart = useCallback(() => {
    setCursorState(prev => ({ ...prev, isDragging: true }));
  }, []);

  // Handle drag end and create analet at drop position
  const handleDragEnd = useCallback(async (targetId: string, position: 'above' | 'below' | 'inside') => {
    setCursorState(prev => ({ ...prev, isDragging: false, dropPosition: { targetId, position } }));
    // Calculate new path based on actual tree and drop position
    const pathToTarget = findPathToNode(targetId, tree) || ['root'];
    let newPath: string[];
    if (position === 'inside') {
      // Drop inside target - parent is target node
      newPath = pathToTarget;
      // Auto-expand the parent so the new child is visible
      if (onExpandNode) {
        onExpandNode(targetId);
      }
    } else {
      // Drop above/below - parent is the parent of the target
      newPath = pathToTarget.slice(0, -1);
      if (newPath.length === 0) newPath = ['root'];
    }
    // Update cursor position to the new path
    try {
      moveToPath(newPath);
    } catch (error) {
      console.error('❌ [useHierarchyCursor] moveToPath failed:', error);
      return;
    }

    // Do NOT create on drop. Trigger previews only.
    try {
      await Promise.resolve();
      generatePreview(newPath);
      generatePreviewAnalet(newPath);
    } catch (e) {
      console.warn('❌ [useHierarchyCursor] Failed to trigger previews after drop:', e);
    }
  }, [cursorState, generateAnalet, sendMessage, onExpandNode, moveToPath, getContextForPath]);

  // Update drop position during drag
  const updateDropPosition = useCallback((targetId: string, position: 'above' | 'below' | 'inside') => {
    setCursorState(prev => ({ ...prev, dropPosition: { targetId, position } }));
  }, []);

  // Listen for hierarchy preview responses
  useEffect(() => {
    const cleanup = onMessage('hierarchy-description-response', (data: any) => {
      setCursorState(prev => ({ ...prev, isLoading: false }));
      const pathMatches = Array.isArray(data?.path) ? (data.path.join(',') === cursorState.currentPath.join(',')) : true;
      const requestMatches = !cursorState.lastPreviewRequestId || data?.requestId === cursorState.lastPreviewRequestId;
      const allow = pathMatches && requestMatches && !cursorState.hasAnaletPreviewForPath;
      if (data?.success && allow) {
        cursorIdeaRef.current = (data.idea || '').trim();
        setCursorState(prev => ({
          ...prev,
          previewIdea: cursorIdeaRef.current,
          similarAnalets: data.similarAnalets || []
        }));
      } else if (!data?.success) {
        try {
          console.warn('[cursor][preview] description failed. Current ctx:', {
            path: cursorState.currentPath,
            parentId: cursorState.parentContext?.id,
            parentKind: cursorState.parentContext?.kind,
            siblingIds: cursorState.siblingContext.map(s => s.id),
            ancestorIds: cursorState.ancestorContext.map(a => a.id)
          });
        } catch {}
        setCursorState(prev => ({
          ...prev,
          previewIdea: 'Error: ' + (data?.error || 'Failed to generate preview')
        }));
      }
    });

    return cleanup;
  }, [onMessage]);

  // Listen for hierarchy analet generation responses
  useEffect(() => {
    const cleanup = onMessage('hierarchy-analet-response', (data: any) => {
      const pathMatches = Array.isArray(data?.path) ? (data.path.join(',') === cursorState.currentPath.join(',')) : true;
      const requestMatches = !cursorState.lastAnaletPreviewRequestId || data?.requestId === cursorState.lastAnaletPreviewRequestId;
      const allow = pathMatches && requestMatches;
      if (data?.success && data?.analet && allow) {
        setCursorState(prev => ({
          ...prev,
          previewAnalet: data.analet,
          hasAnaletPreviewForPath: true
        }));
      }
    });

    return cleanup;
  }, [onMessage]);

  // Listen for analet creation to hide cursor
  useEffect(() => {
    const cleanup = onMessage('refresh-analets', (data: any) => {
      if (data?.action === 'created-from-hierarchy' || data?.action === 'saved-from-hierarchy') {
        setCursorState(prev => ({
          ...prev,
          isVisible: false,
          previewIdea: undefined,
          previewAnalet: undefined,
          hasAnaletPreviewForPath: false,
          isLoading: false
        }));
      }
    });

    return cleanup;
  }, [onMessage]);

  // Auto-generate preview when cursor position changes (but not when preview idea changes)
  useEffect(() => {
    // Only trigger if visible, has path, and not currently loading
    if (cursorState.isVisible && cursorState.currentPath.length > 0 && !cursorState.isLoading) {
      // Clear existing timeout
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }

      // Set new timeout for preview generation
      previewTimeoutRef.current = setTimeout(() => {
        generatePreview();
        generatePreviewAnalet();
      }, 200); // shorter delay for snappier updates
    }

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [cursorState.currentPath, cursorState.isVisible]); // keep deps minimal to avoid loops

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, []);

  return {
    cursorState,
    moveToPath,
    navigateCursor,
    generatePreview,
    generatePreviewAnalet,
    generateAnalet,
    handleDragStart,
    handleDragEnd,
    updateDropPosition,
    setCursorVisible: (visible: boolean) => setCursorState(prev => ({ ...prev, isVisible: visible }))
  };
}
