import { useState, useEffect, useCallback, useMemo } from 'react';
import { Analet, Bearing, AnalysisNote } from '../types/analet';
import { HierarchyState, FolderOperations, DragState, DropIndicator, AnaletFolderNode } from '../types/hierarchy';
import { HierarchyUtils } from '../utilities/hierarchyUtils';
import { generateFolderName } from '../utilities/folderNaming';
import { StateService } from '../services/StateService';

interface SharedSelection {
  selectionState: { selectedAnaletIds: Set<number>; lastSelectedId?: number };
  selectAnalet: (analetId: number, multiSelect?: boolean) => void;
  clearSelection: () => void;
  isAnaletSelected: (analetId: number) => boolean;
  getSelectedCount: () => number;
  getSelectedAnalets: (analets: Analet[]) => Analet[];
}

interface UseAnaletHierarchyProps {
  analets: Analet[];
  bearings?: Bearing[];
  notes?: AnalysisNote[];
  onAnaletClick?: (analet: Analet) => void;
  sharedSelection?: SharedSelection;
  sendMessage?: (type: string, data: any) => void;
}

export function useAnaletHierarchy({ analets, bearings = [], notes = [], onAnaletClick, sharedSelection, sendMessage }: UseAnaletHierarchyProps) {
  // Ensure analets are unique by ID to prevent duplicates - use useMemo to prevent infinite rerenders
  const uniqueAnalets = useMemo(() => {
    const unique = analets.reduce((acc, analet) => {
      if (!acc.some(existing => existing.id === analet.id)) {
        acc.push(analet);
      }
      return acc;
    }, [] as Analet[]);
    return unique;
  }, [analets]);

  const [hierarchyState, setHierarchyState] = useState<HierarchyState>(() => {
    // Initialize with empty hierarchy, will be populated by useEffect
    return {
      root: { id: 'root', name: 'All Analets', type: 'folder', isExpanded: true, children: [] },
      flatMap: new Map([['root', { id: 'root', name: 'All Analets', type: 'folder', isExpanded: true, children: [] }]]),
      expandedFolders: new Set(['root']),
      selectionState: { selectedIds: new Set<string>(), contextMenuOpen: false },
      links: [],
      hoveredItemId: undefined
    };
  });
  
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false
  });
  // Rehydrate from StateService on mount and listen for external restores
  useEffect(() => {
    (async () => {
      try {
        const { StateService } = await import('../services/StateService');
        const stateService = StateService.getInstance();
        const restored = stateService.getHierarchyState();
        if (restored) {
          setHierarchyState(restored);
        }
      } catch (e) {
        // Ignore
      }
    })();
    const onUpdated = () => {
      (async () => {
        try {
          const { StateService } = await import('../services/StateService');
          const stateService = StateService.getInstance();
          const restored = stateService.getHierarchyState();
          if (restored) setHierarchyState(restored);
        } catch {}
      })();
    };
    window.addEventListener('hierarchyStateUpdated', onUpdated as any);
    return () => window.removeEventListener('hierarchyStateUpdated', onUpdated as any);
  }, []);

  
  // Loading state for folder name generation
  const [folderNamingState, setFolderNamingState] = useState<{
    isLoading: boolean;
    progress: string | null;
  }>({ isLoading: false, progress: null });

  // Update hierarchy when analets change
  useEffect(() => {
    setHierarchyState(prev => HierarchyUtils.updateAnaletsInHierarchy(prev, uniqueAnalets));
  }, [uniqueAnalets]);

  // Update hierarchy when bearings change
  useEffect(() => {
    setHierarchyState(prev => HierarchyUtils.updateBearingsInHierarchy(prev, bearings));
  }, [bearings]);

  // Update hierarchy when notes change
  useEffect(() => {
    setHierarchyState(prev => {
      const updated = HierarchyUtils.updateNotesInHierarchy(prev, notes);
      return updated;
    });
  }, [notes]);

  // Compute bearing embeddings as the average of member analet embeddings whenever hierarchy or analets change
  useEffect(() => {
    try {
      const stateService = StateService.getInstance();
      // Iterate bearing nodes and compute average from children analets
      hierarchyState.flatMap.forEach((node) => {
        if (node.type === 'bearing' && node.children && node.bearingId) {
          const childAnaletEmbeddings: number[][] = node.children
            .map((child) => child.type === 'analet' ? child.analet?.embedding : undefined)
            .filter((emb): emb is number[] => Array.isArray(emb) && emb.length > 0);
          if (childAnaletEmbeddings.length > 0) {
            const dim = childAnaletEmbeddings[0].length;
            const allSameDim = childAnaletEmbeddings.every((e) => e.length === dim);
            if (allSameDim) {
              const avg = new Array(dim).fill(0);
              for (const vec of childAnaletEmbeddings) {
                for (let i = 0; i < dim; i++) avg[i] += vec[i];
              }
              for (let i = 0; i < dim; i++) avg[i] /= childAnaletEmbeddings.length;
              stateService.updateBearingEmbedding(node.bearingId, avg);
            }
          }
          // Compute centroid of child analets for bearing location
          const childPositions = (node.children || [])
            .map((child) => child.type === 'analet' ? child.analet?.location : undefined)
            .filter((loc): loc is { x: number; y: number } => !!loc && typeof loc.x === 'number' && typeof loc.y === 'number');
          if (childPositions.length > 0) {
            const sum = childPositions.reduce((acc, p) => ({ x: acc.x + (p.x || 0), y: acc.y + (p.y || 0) }), { x: 0, y: 0 });
            const cx = sum.x / childPositions.length;
            const cy = sum.y / childPositions.length;
            stateService.updateBearingLocation(node.bearingId, { x: cx, y: cy });
          }
        }
      });
    } catch {}
  }, [hierarchyState, uniqueAnalets]);

  // Define createBearingFromSelection first
  const createBearingFromSelection = useCallback(async (bearingName?: string) => {
    try {
      let selectedAnalets: AnaletFolderNode[];
      
      // Get selected analets from shared selection if available
      if (sharedSelection) {
        const selectedAnaletIds = Array.from(sharedSelection.selectionState.selectedAnaletIds);
        selectedAnalets = selectedAnaletIds
          .map(analetId => Array.from(hierarchyState.flatMap.values())
            .find(node => node.type === 'analet' && node.analetId === analetId)
          )
          .filter((node): node is AnaletFolderNode => 
            node !== undefined && node.type === 'analet' && node.analetId !== undefined
          );
      } else {
        // Fall back to internal selection state
        selectedAnalets = Array.from(hierarchyState.selectionState.selectedIds)
          .map(id => hierarchyState.flatMap.get(id))
          .filter((node): node is AnaletFolderNode => 
            node !== undefined && node.type === 'analet' && node.analetId !== undefined
          );
      }

      if (selectedAnalets.length < 1) {
        console.warn('Need at least 1 analet to create a bearing');
        return;
      }
      const selectedAnaletObjects = selectedAnalets
        .map(node => uniqueAnalets.find(a => a.id === node.analetId))
        .filter((analet): analet is Analet => analet !== undefined);
      
      // Generate a conceptual statement about what groups these analets together
      let bearingStatement = bearingName;
      
      if (!bearingStatement && sendMessage) {
        // Set loading state
        setFolderNamingState({ isLoading: true, progress: 'Generating conceptual statement...' });
        
        bearingStatement = await generateFolderName(
          selectedAnaletObjects, 
          sendMessage,
          (progress) => {
            setFolderNamingState({ isLoading: true, progress });
          }
        );
        
        setFolderNamingState({ isLoading: false, progress: null });
      } else {
        setFolderNamingState({ isLoading: false, progress: null });
        bearingStatement = bearingStatement || `Conceptual grouping of ${selectedAnalets.length} analets`;
      }
      // Create bearing folder that groups the selected analets
      const selectedAnaletIds = selectedAnalets.map(node => node.analetId!);
      setHierarchyState(prev => HierarchyUtils.createBearingFromAnalets(
        prev, 
        selectedAnaletIds, 
        bearingStatement,
        bearingStatement
      ));
      
      // Clear selection
      if (sharedSelection) {
        sharedSelection.clearSelection();
      }
      
    } catch (error) {
      console.error('❌ [useAnaletHierarchy] Failed to create bearing:', error);
      setFolderNamingState({ isLoading: false, progress: null });
    }
  }, [hierarchyState, uniqueAnalets, sharedSelection, sendMessage]);

  // Folder operations
  const operations: FolderOperations = {
    // No-op: folders are not supported
    createFolder: useCallback((_name?: string, _parentId: string = 'root') => {
      console.warn('Folders are not supported in this view.');
    }, []),

    renameFolder: useCallback((id: string, newName: string) => {
      setHierarchyState(prev => {
        const node = prev.flatMap.get(id);
        // If this is a bearing, persist the rename to the underlying bearing statement
        if (node && node.type === 'bearing' && node.bearingId !== undefined) {
          const stateService = StateService.getInstance();
          // Normalize incoming name: strip any leading "Bearing:" label
          const normalizedStatement = newName.replace(/^\s*Bearing:\s*/i, '');
          stateService.updateBearing(node.bearingId, normalizedStatement);
          // UI will refresh from bearingsUpdated → useAnalysisComponents → props.bearings
          return prev;
        }

        // Default: rename folder/analet node locally
        const newRoot = { ...prev.root };
        const nodeToUpdate = HierarchyUtils.findNodeById(newRoot, id);
        if (nodeToUpdate) {
          nodeToUpdate.name = newName;
          nodeToUpdate.updatedAt = new Date().toISOString();
        }
        // Rebuild flat map
        const newFlatMap = new Map(prev.flatMap);
        const updatedNode = newFlatMap.get(id);
        if (updatedNode) {
          updatedNode.name = newName;
          updatedNode.updatedAt = new Date().toISOString();
        }
        return { ...prev, root: newRoot, flatMap: newFlatMap };
      });
    }, []),

    deleteFolder: useCallback((id: string) => {
      setHierarchyState(prev => {
        const node = prev.flatMap.get(id);
        if (node && node.type === 'bearing' && node.bearingId !== undefined) {
          // Persist delete for bearing
          const stateService = StateService.getInstance();
          stateService.deleteBearing(node.bearingId);
          // Hierarchy will refresh from bearingsUpdated; return prev to avoid double local mutation
          return prev;
        }
        return HierarchyUtils.deleteItem(prev, id);
      });
    }, []),

    moveItem: useCallback((itemId: string, targetId: string, position: 'above' | 'below' | 'inside') => {
      setHierarchyState(prev => {
        // Resolve target: if dropping on an analet that belongs to a bearing and position is inside,
        // redirect drop to the bearing container to ensure proper nesting
        let resolvedTargetId = targetId;
        let resolvedPosition = position;
        try {
          const targetNode = prev.flatMap.get(targetId);
          if (targetNode && targetNode.type === 'analet') {
            const parent = targetNode.parentId ? prev.flatMap.get(targetNode.parentId) : undefined;
            if (parent && parent.type === 'bearing') {
              resolvedTargetId = parent.id;
              resolvedPosition = 'inside';
            }
          }
        } catch {}

        const next = HierarchyUtils.moveItem(prev, itemId, resolvedTargetId, resolvedPosition);
        try {
          // Persist using edges API (new hierarchy model)
          const moved = next.flatMap.get(itemId);
          const effTarget = next.flatMap.get(resolvedTargetId);
          if (moved && effTarget && moved.type === 'analet' && effTarget.type === 'bearing' && typeof effTarget.bearingId === 'number') {
            const parentId = `item:bearing:${effTarget.bearingId}`;
            const childId = `item:analet:${moved.analetId}`;
            const orderIndex = 1e9; // let backend compact
            if (sendMessage) {
              sendMessage('edges-add', {
                edges: [{ parentId, childId, type: 'contains', orderIndex }],
                idempotencyKey: `add-${childId}-to-${parentId}`
              });
            }
          }
        } catch {}
        return next;
      });
    }, [sendMessage]),

    // No-op: folders are not supported
    createFolderFromAnalets: useCallback((_analet1Id: number, _analet2Id: number, _folderName?: string) => {
      console.warn('Folders are not supported in this view.');
    }, []),

    toggleFolder: useCallback((id: string) => {
      setHierarchyState(prev => {
        // Deep clone the root to safely mutate
        const newRoot = HierarchyUtils.cloneHierarchy((prev as any).root);
        const target = HierarchyUtils.findNodeById(newRoot, id);
        if (target) {
          target.isExpanded = !target.isExpanded;
        }
        // Rebuild flat map
        const newFlatMap = new Map<string, AnaletFolderNode>();
        (HierarchyUtils as any).buildFlatMap(newRoot, newFlatMap);
        // Maintain expandedFolders set
        const newExpanded = new Set(prev.expandedFolders);
        if (target?.isExpanded) newExpanded.add(id); else newExpanded.delete(id);
        return {
          ...prev,
          root: newRoot,
          flatMap: newFlatMap,
          expandedFolders: newExpanded
        } as HierarchyState;
      });
    }, []),

    selectItem: useCallback((id: string, multiSelect: boolean = false) => {
      // If using shared selection, delegate to shared selection for analets
      const node = hierarchyState.flatMap.get(id);
      if (sharedSelection && node?.type === 'analet' && node.analetId) {
        sharedSelection.selectAnalet(node.analetId, multiSelect);
        return;
      }
      
      // Otherwise use internal selection state
      setHierarchyState(prev => {
        const newSelectedIds = new Set(prev.selectionState.selectedIds);
        
        if (multiSelect) {
          if (newSelectedIds.has(id)) {
            newSelectedIds.delete(id);
          } else {
            newSelectedIds.add(id);
          }
        } else {
          newSelectedIds.clear();
          newSelectedIds.add(id);
        }
        
        return {
          ...prev,
          selectionState: {
            ...prev.selectionState,
            selectedIds: newSelectedIds,
            lastSelectedId: id
          }
        };
      });
    }, [hierarchyState.flatMap, sharedSelection]),

    clearSelection: useCallback(() => {
      // If using shared selection, clear it
      if (sharedSelection) {
        sharedSelection.clearSelection();
      }
      
      // Also clear internal selection state
      setHierarchyState(prev => ({
        ...prev,
        selectionState: {
          ...prev.selectionState,
          selectedIds: new Set(),
          lastSelectedId: undefined
        }
      }));
    }, [sharedSelection]),

    // Reinterpret: creating a folder from selection actually creates a Bearing from selection
    createFolderFromSelection: useCallback(async (folderName?: string) => {
      // Avoid referencing operations inside its own definition to satisfy TS
      await createBearingFromSelection(folderName);
    }, [createBearingFromSelection]),

    createBearingFromSelection,

    renameAnalet: useCallback((id: string, newName: string) => {
      setHierarchyState(prev => {
        const node = prev.flatMap.get(id);
        if (node && node.type === 'analet' && node.analetId) {
          const updatedQuestion = newName.trim();
          import('../services/AnaletStateService').then(({ AnaletStateService }) => {
            const analetState = AnaletStateService.getInstance();
            const existing = analetState.getAnaletById(node.analetId!);
            if (existing) {
              analetState.updateAnalet({ ...existing, statement: updatedQuestion });
              window.dispatchEvent(new CustomEvent('analetsUpdated'));
            }
          });
          return prev;
        }

        // Default local rename as fallback
        const newRoot = { ...prev.root };
        const nodeToUpdate = HierarchyUtils.findNodeById(newRoot, id);
        if (nodeToUpdate) {
          nodeToUpdate.name = newName;
          nodeToUpdate.updatedAt = new Date().toISOString();
        }
        const newFlatMap = new Map(prev.flatMap);
        const updatedNode = newFlatMap.get(id);
        if (updatedNode) {
          updatedNode.name = newName;
          updatedNode.updatedAt = new Date().toISOString();
        }
        return { ...prev, root: newRoot, flatMap: newFlatMap };
      });
    }, []),

    linkSelectedItems: useCallback(() => {
      if (!sharedSelection) return;
      
      const selectedIds = Array.from(sharedSelection.selectionState.selectedAnaletIds);
      if (selectedIds.length !== 2) {
        console.warn('Need exactly 2 items selected to link them');
        return;
      }

      const [fromId, toId] = selectedIds;
      const linkId = `link-${fromId}-${toId}-${Date.now()}`;
      
      setHierarchyState(prev => ({
        ...prev,
        links: [
          ...prev.links,
          {
            id: linkId,
            fromId,
            toId,
            createdAt: new Date().toISOString(),
            type: 'thread'
          }
        ]
      }));
    }, [sharedSelection]),

    unlinkItems: useCallback((itemId1: string, itemId2: string) => {
      const id1 = parseInt(itemId1.replace('analet-', ''));
      const id2 = parseInt(itemId2.replace('analet-', ''));
      
      setHierarchyState(prev => ({
        ...prev,
        links: prev.links.filter(link => 
          !((link.fromId === id1 && link.toId === id2) || 
            (link.fromId === id2 && link.toId === id1))
        )
      }));
    }, [])
  };

  // Drag and drop operations
  const dragOperations = {
    startDrag: useCallback((id: string, type: 'folder' | 'analet' | 'bearing' | 'note') => {
      setDragState({
        isDragging: true,
        draggedId: id,
        draggedType: type
      });
    }, []),

    endDrag: useCallback(() => {
      setDragState(currentDragState => {
        // Execute drop if there's a valid drop indicator
        if (currentDragState.dropIndicator && currentDragState.draggedId) {
          let { targetId, position, type } = currentDragState.dropIndicator;
          // If target is an analet under a bearing and operation is insert, redirect to bearing container
          try {
            const targetNode = hierarchyState.flatMap.get(targetId);
            const parent = targetNode?.parentId ? hierarchyState.flatMap.get(targetNode.parentId) : undefined;
            if (targetNode?.type === 'analet' && parent?.type === 'bearing' && type === 'insert') {
              targetId = parent.id;
              position = 'inside';
            }
          } catch {}
          if (type === 'folder-creation' && currentDragState.draggedType === 'analet') {
            // Create folder from two analets
            const draggedNode = hierarchyState.flatMap.get(currentDragState.draggedId);
            const targetNode = hierarchyState.flatMap.get(targetId);
            
            if (draggedNode?.analetId && targetNode?.analetId) {
              operations.createFolderFromAnalets(draggedNode.analetId, targetNode.analetId);
            }
          } else {
            // Regular move operation
            operations.moveItem(currentDragState.draggedId, targetId, position);
          }
        }
        
        return { isDragging: false };
      });
    }, [hierarchyState.flatMap, operations]),

    updateDropIndicator: useCallback((dropIndicator: DropIndicator | undefined) => {
      setDragState(prev => ({ ...prev, dropIndicator }));
    }, []),

    updateHover: useCallback((hoveredId: string | undefined, canCreateFolder: boolean = false) => {
      setDragState(prev => {
        // Clear existing hover timeout
        if (prev.hoverExpandTimeout) {
          clearTimeout(prev.hoverExpandTimeout);
        }

        // If hovering over a folder or bearing during drag, set up auto-expand
        let hoverExpandTimeout: NodeJS.Timeout | undefined;
        if (hoveredId && prev.isDragging) {
          const hoveredNode = hierarchyState.flatMap.get(hoveredId);
          if ((hoveredNode?.type === 'folder' || hoveredNode?.type === 'bearing') && !hierarchyState.expandedFolders.has(hoveredId)) {
            // macOS-style hover expansion after 1 second
            hoverExpandTimeout = setTimeout(() => {
              operations.toggleFolder(hoveredId);
            }, 1000);
          }
        }

        return { 
          ...prev, 
          hoveredId, 
          canCreateFolder: canCreateFolder && prev.draggedType === 'analet',
          hoverStartTime: hoveredId ? Date.now() : undefined,
          hoverExpandTimeout
        };
      });
    }, [hierarchyState.flatMap, hierarchyState.expandedFolders, operations])
  };

  // Handle analet clicks
  const handleAnaletClick = useCallback((analet: Analet) => {
    if (onAnaletClick) {
      onAnaletClick(analet);
    }
  }, [onAnaletClick]);

  // Helper function to check if item can be dropped on target
  const canDropOn = useCallback((draggedId: string, targetId: string, position: 'above' | 'below' | 'inside'): boolean => {
    if (draggedId === targetId) return false;
    
    const draggedNode = hierarchyState.flatMap.get(draggedId);
    const targetNode = hierarchyState.flatMap.get(targetId);
    
    if (!draggedNode || !targetNode) return false;

    // Can't drop folder on its own children
    if (draggedNode.type === 'folder') {
      let current: typeof targetNode | undefined = targetNode;
      while (current) {
        if (current.id === draggedId) return false;
        current = current.parentId ? hierarchyState.flatMap.get(current.parentId) : undefined;
      }
    }

    // Can only drop inside folders and bearings
    if (position === 'inside' && targetNode.type !== 'folder' && targetNode.type !== 'bearing') return false;

    return true;
  }, [hierarchyState.flatMap]);

  // Helper function to check if folder creation is possible
  const canCreateFolderWith = useCallback((draggedId: string, targetId: string): boolean => {
    const draggedNode = hierarchyState.flatMap.get(draggedId);
    const targetNode = hierarchyState.flatMap.get(targetId);
    
    return !!(
      draggedNode?.type === 'analet' && 
      targetNode?.type === 'analet' && 
      draggedId !== targetId
    );
  }, [hierarchyState.flatMap]);

  // Hover management for showing link connections
  const setHoveredItem = useCallback((itemId: string | undefined) => {
    setHierarchyState(prev => ({
      ...prev,
      hoveredItemId: itemId
    }));
  }, []);

  return {
    hierarchyState,
    dragState,
    operations,
    dragOperations,
    handleAnaletClick,
    canDropOn,
    canCreateFolderWith,
    setHoveredItem,
    // Selection helpers
    isSelected: useCallback((id: string) => {
      // Check shared selection first for analets
      const node = hierarchyState.flatMap.get(id);
      if (sharedSelection && node?.type === 'analet' && node.analetId) {
        return sharedSelection.isAnaletSelected(node.analetId);
      }
      
      // Fall back to internal selection state
      return hierarchyState.selectionState.selectedIds.has(id);
    }, [hierarchyState.flatMap, hierarchyState.selectionState.selectedIds, sharedSelection?.selectionState]),
    
    getSelectedCount: useCallback(() => {
      // If using shared selection, return shared selection count
      if (sharedSelection) {
        return sharedSelection.getSelectedCount();
      }
      
      // Fall back to internal selection state
      return hierarchyState.selectionState.selectedIds.size;
    }, [hierarchyState.selectionState.selectedIds, sharedSelection?.selectionState]),
    
    // Loading state for folder naming
    folderNamingState
  };
}

 