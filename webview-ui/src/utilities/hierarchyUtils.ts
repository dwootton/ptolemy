import { hierarchy } from 'd3-hierarchy';
import { Analet, Bearing, AnalysisNote } from '../types/analet';
import { AnaletFolderNode, AnaletHierarchyNode, HierarchyState } from '../types/hierarchy';

export class HierarchyUtils {
  
  /**
   * Generate automatic group name by finding next available number
   */
  static generateGroupName(hierarchyState: HierarchyState): string {
    const existingGroupNumbers = new Set<number>();
    
    // Scan all folders for "group X" pattern
    hierarchyState.flatMap.forEach(node => {
      if (node.type === 'folder' && node.name.toLowerCase().startsWith('group ')) {
        const match = node.name.match(/^group (\d+)$/i);
        if (match) {
          const groupNumber = parseInt(match[1], 10);
          existingGroupNumbers.add(groupNumber);
        }
      }
    });
    
    // Find next available number
    let nextNumber = 1;
    while (existingGroupNumbers.has(nextNumber)) {
      nextNumber++;
    }
    
    return `group ${nextNumber}`;
  }

  /**
   * Create initial hierarchy structure from flat analet array
   */
  static createInitialHierarchy(analets: Analet[]): HierarchyState {
    const root: AnaletFolderNode = {
      id: 'root',
      name: 'All Analets',
      type: 'folder',
      isExpanded: true,
      children: analets.map(analet => ({
        id: `analet-${analet.id}`,
        name: analet.shortName || analet.statement,
        type: 'analet' as const,
        analetId: analet.id,
        analet: analet,
        parentId: 'root'
      }))
    };

    const flatMap = new Map<string, AnaletFolderNode>();
    const expandedFolders = new Set<string>(['root']);

    // Build flat map for quick lookups
    this.buildFlatMap(root, flatMap);

    return {
      root,
      flatMap,
      expandedFolders,
      selectionState: {
        selectedIds: new Set<string>(),
        contextMenuOpen: false
      },
      links: [],
      hoveredItemId: undefined
    };
  }

  /**
   * Build flat map for quick node lookups
   */
  public static buildFlatMap(node: AnaletFolderNode, flatMap: Map<string, AnaletFolderNode>) {
    flatMap.set(node.id, node);
    if (node.children) {
      node.children.forEach(child => this.buildFlatMap(child, flatMap));
    }
  }

  /**
   * Update hierarchy when bearings change
   */
  static updateBearingsInHierarchy(hierarchyState: HierarchyState, newBearings: Bearing[]): HierarchyState {
    const existingBearingIds = new Set<number>();
    const bearingsToAdd: Bearing[] = [];
    const bearingsToUpdate: Bearing[] = [];
    
    // Find existing bearings and ones to add/update
    this.traverseNodes(hierarchyState.root, (node) => {
      if (node.type === 'bearing' && node.bearingId !== undefined) {
        existingBearingIds.add(node.bearingId);
      }
    });

    // Identify new bearings to add and existing ones to update
    newBearings.forEach(bearing => {
      if (!existingBearingIds.has(bearing.id)) {
        bearingsToAdd.push(bearing);
      } else {
        bearingsToUpdate.push(bearing);
      }
    });

    // Remove bearings that are no longer in the new bearings list
    const newBearingIds = new Set(newBearings.map(b => b.id));
    let hasChanges = false;

    // Update existing bearing references in the hierarchy
    const updateBearingReferences = (node: AnaletFolderNode): AnaletFolderNode => {
      if (node.type === 'bearing' && node.bearingId !== undefined) {
        const updatedBearing = newBearings.find(b => b.id === node.bearingId);
        if (updatedBearing) {
          // Update the bearing reference and name if they've changed
          const updatedNode = {
            ...node,
            name: `Bearing: ${updatedBearing.statement}`,
            bearing: updatedBearing,
            bearingStatement: updatedBearing.statement
          };
          if (updatedNode.name !== node.name || updatedNode.bearing !== node.bearing) {
            hasChanges = true;
          }
          return updatedNode;
        } else if (!newBearingIds.has(node.bearingId)) {
          // This bearing is no longer in the list, mark for removal
          hasChanges = true;
          return null as any; // Will be filtered out
        }
      }
      
      if (node.children) {
        const updatedChildren = node.children
          .map(updateBearingReferences)
          .filter(child => child !== null);
        
        if (updatedChildren.length !== node.children.length) {
          hasChanges = true;
        }
        
        return {
          ...node,
          children: updatedChildren
        };
      }
      
      return node;
    };

    let newRoot = updateBearingReferences(hierarchyState.root);

    // Add new bearings to root
    if (bearingsToAdd.length > 0) {
      hasChanges = true;
      const existingChildren = newRoot.children || [];
      const newBearingNodes = bearingsToAdd.map(bearing => ({
        id: `bearing-${bearing.id}`,
        name: `Bearing: ${bearing.statement}`,
        type: 'bearing' as const,
        bearingId: bearing.id,
        bearing: bearing,
        bearingStatement: bearing.statement,
        parentId: 'root',
        // Auto-expand newly added bearings so users can see contents immediately
        isExpanded: true,
        children: [], // Bearings start without children, they get analets through drag&drop or grouping
        createdAt: bearing.timestamp,
        updatedAt: bearing.timestamp
      }));
      
      // Ensure no duplicates by filtering out any existing nodes with same bearingId
      const existingBearingNodeIds = new Set(
        existingChildren
          .filter(child => child.type === 'bearing')
          .map(child => child.bearingId)
      );
      
      const filteredNewNodes = newBearingNodes.filter(
        node => !existingBearingNodeIds.has(node.bearingId)
      );
      newRoot = {
        ...newRoot,
        children: [
          ...existingChildren,
          ...filteredNewNodes
        ]
      };
    }

    // Only rebuild if there were actual changes
    if (hasChanges) {
      // Rebuild flat map
      const newFlatMap = new Map<string, AnaletFolderNode>();
      this.buildFlatMap(newRoot, newFlatMap);

      return {
        ...hierarchyState,
        root: newRoot,
        flatMap: newFlatMap
      };
    }

    return hierarchyState;
  }

  /**
   * Update hierarchy when analets change
   */
  static updateAnaletsInHierarchy(hierarchyState: HierarchyState, newAnalets: Analet[]): HierarchyState {
    const existingAnaletIds = new Set<number>();
    const analetsToAdd: Analet[] = [];
    const analetsToUpdate: Analet[] = [];
    
    // Find existing analets and ones to add/update
    this.traverseNodes(hierarchyState.root, (node) => {
      if (node.type === 'analet' && node.analetId !== undefined) {
        existingAnaletIds.add(node.analetId);
      }
    });

    // Identify new analets to add and existing ones to update
    newAnalets.forEach(analet => {
      if (!existingAnaletIds.has(analet.id)) {
        analetsToAdd.push(analet);
      } else {
        analetsToUpdate.push(analet);
      }
    });

    // Remove analets that are no longer in the new analets list
    const newAnaletIds = new Set(newAnalets.map(a => a.id));
    let hasChanges = false;

    // Update existing analet references in the hierarchy
    const updateAnaletReferences = (node: AnaletFolderNode): AnaletFolderNode => {
      if (node.type === 'analet' && node.analetId !== undefined) {
        const updatedAnalet = newAnalets.find(a => a.id === node.analetId);
        if (updatedAnalet) {
          // Update the analet reference and name if they've changed
          const updatedNode = {
            ...node,
            name: updatedAnalet.shortName || updatedAnalet.statement,
            analet: updatedAnalet
          };
          if (updatedNode.name !== node.name || updatedNode.analet !== node.analet) {
            hasChanges = true;
          }
          return updatedNode;
        } else if (!newAnaletIds.has(node.analetId)) {
          // This analet is no longer in the list, mark for removal
          hasChanges = true;
          return null as any; // Will be filtered out
        }
      }
      
      if (node.children) {
        const updatedChildren = node.children
          .map(updateAnaletReferences)
          .filter(child => child !== null);
        
        if (updatedChildren.length !== node.children.length) {
          hasChanges = true;
        }
        
        return {
          ...node,
          children: updatedChildren
        };
      }
      
      return node;
    };

    let newRoot = updateAnaletReferences(hierarchyState.root);

    // Add new analets, supporting generic parent-child nesting
    if (analetsToAdd.length > 0) {
      hasChanges = true;
      const existingChildren = newRoot.children || [];
      const newAnaletNodes = analetsToAdd.map(analet => ({
        id: `analet-${analet.id}`,
        name: analet.shortName || analet.statement,
        type: 'analet' as const,
        analetId: analet.id,
        analet: analet,
        parentId: 'root'
      }));
      
      // Ensure no duplicates by filtering out any existing nodes with same analetId
      const existingAnaletNodeIds = new Set(
        existingChildren
          .filter(child => child.type === 'analet')
          .map(child => child.analetId)
      );
      
      const filteredNewNodes = newAnaletNodes.filter(
        node => !existingAnaletNodeIds.has(node.analetId)
      );
      // Generic placement by parent pointers (bearing or analet)
      try {
        const { StateService } = require('../services/StateService');
        const stateService = StateService.getInstance();
        const bearings = stateService.getBearings?.() || [];
        const bearingIdToNodeId = new Map<number, string>();
        // Index existing bearing nodes in hierarchy
        (newRoot.children || []).forEach(child => {
          if (child.type === 'bearing' && (child as any).bearingId != null) {
            bearingIdToNodeId.set((child as any).bearingId as number, child.id);
          }
        });
        // Ensure placeholders for bearings we know about
        for (const b of bearings) {
          if (!bearingIdToNodeId.has(b.id)) {
            const nodeId = `bearing-${b.id}`;
            const placeholder: AnaletFolderNode = {
              id: nodeId,
              name: `Bearing: ${b.statement}`,
              type: 'bearing',
              parentId: 'root',
              isExpanded: true,
              bearingId: b.id as any,
              bearing: b as any,
              bearingStatement: b.statement as any,
              children: []
            } as any;
            newRoot.children = [...(newRoot.children || []), placeholder];
            bearingIdToNodeId.set(b.id, nodeId);
          }
        }
        // Build a quick lookup for analet nodes by analetId
        const analetIdToNodeId = new Map<number, string>();
        const buildAnaletIndex = (node: AnaletFolderNode) => {
          if (node.type === 'analet' && node.analetId != null) analetIdToNodeId.set(node.analetId, node.id);
          (node.children || []).forEach(buildAnaletIndex);
        };
        buildAnaletIndex(newRoot);
        // Helper to find node by id
        const findNodeById = (id: string) => (HierarchyUtils as any).findNodeById(newRoot, id);

        // Two-pass placement: try to attach by parent pointers; remaining go to root
        let pending = [...filteredNewNodes];
        for (let pass = 0; pass < 2 && pending.length > 0; pass++) {
          const nextPending: typeof pending = [];
          for (const n of pending) {
            const a = (n as any).analet;
            const parentAnaletId: number | undefined = a?.parentAnaletId;
            let parentNodeId: string | undefined;
            // Use parentAnaletId for derivation relationships only
            if (typeof parentAnaletId === 'number') {
              parentNodeId = analetIdToNodeId.get(parentAnaletId);
            }
            if (parentNodeId) {
              const parentNode = findNodeById(parentNodeId);
              if (parentNode) {
                parentNode.children = parentNode.children || [];
                parentNode.children.push({ ...n, parentId: parentNodeId });
                // Index this analet node now that it exists
                if ((n as any).analetId != null) analetIdToNodeId.set((n as any).analetId, (n as any).id);
                continue;
              }
            }
            nextPending.push(n);
          }
          pending = nextPending;
        }
        // Any remaining pending nodes get added to root
        if (pending.length > 0) {
          newRoot = {
            ...newRoot,
            children: [
              ...((newRoot.children || []).filter(child => !pending.some(p => p.id === child.id))),
              ...existingChildren,
              ...pending
            ]
          };
        }
      } catch {
        newRoot = {
          ...newRoot,
          children: [
            ...existingChildren,
            ...filteredNewNodes
          ]
        };
      }
    }

    // Only rebuild if there were actual changes
    if (hasChanges) {
      // Rebuild flat map
      const newFlatMap = new Map<string, AnaletFolderNode>();
      this.buildFlatMap(newRoot, newFlatMap);

      return {
        ...hierarchyState,
        root: newRoot,
        flatMap: newFlatMap
      };
    }

    return hierarchyState;
  }

  /**
   * Create folder from two analets
   */
  static createFolderFromAnalets(
    hierarchyState: HierarchyState,
    analet1Id: number,
    analet2Id: number,
    folderName?: string
  ): HierarchyState {
    const analet1Node = Array.from(hierarchyState.flatMap.values())
      .find(node => node.type === 'analet' && node.analetId === analet1Id);
    const analet2Node = Array.from(hierarchyState.flatMap.values())
      .find(node => node.type === 'analet' && node.analetId === analet2Id);

    if (!analet1Node || !analet2Node) {
      console.warn('Could not find analets for folder creation');
      return hierarchyState;
    }

    const newFolderId = `folder-${Date.now()}`;
    const newFolder: AnaletFolderNode = {
      id: newFolderId,
      name: folderName || this.generateGroupName(hierarchyState),
      type: 'folder',
      isExpanded: true,
      parentId: analet1Node.parentId || 'root',
      children: [
        { ...analet1Node, parentId: newFolderId },
        { ...analet2Node, parentId: newFolderId }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Remove analets from their current parent and add folder at the earliest position
    const newRoot = this.cloneHierarchy(hierarchyState.root);
    const parent = this.findNodeById(newRoot, analet1Node.parentId || 'root');
    
    if (parent && parent.children) {
      // Find the positions of both analets
      const analet1Index = parent.children.findIndex(child => child.id === analet1Node.id);
      const analet2Index = parent.children.findIndex(child => child.id === analet2Node.id);
      
      // Get the earlier position to insert the folder
      const insertPosition = Math.min(analet1Index, analet2Index);
      
      // Remove both analets
      parent.children = parent.children.filter(
        child => child.id !== analet1Node.id && child.id !== analet2Node.id
      );
      
      // Insert new folder at the position of the first analet
      if (insertPosition >= 0) {
        parent.children.splice(insertPosition, 0, newFolder);
      } else {
        // Fallback to end if position not found
        parent.children.push(newFolder);
      }
    }

    // Rebuild flat map and add to expanded folders
    const newFlatMap = new Map<string, AnaletFolderNode>();
    this.buildFlatMap(newRoot, newFlatMap);
    const newExpandedFolders = new Set([...hierarchyState.expandedFolders, newFolderId]);

    return {
      root: newRoot,
      flatMap: newFlatMap,
      expandedFolders: newExpandedFolders,
      selectionState: hierarchyState.selectionState,
      links: hierarchyState.links,
      hoveredItemId: hierarchyState.hoveredItemId
    };
  }

  /**
   * Create folder with single analet
   */
  static createFolderWithSingleAnalet(
    hierarchyState: HierarchyState,
    analetId: number,
    folderName?: string
  ): HierarchyState {
    const analetNode = Array.from(hierarchyState.flatMap.values())
      .find(node => node.type === 'analet' && node.analetId === analetId);

    if (!analetNode) {
      console.warn('Could not find analet for folder creation');
      return hierarchyState;
    }

    const newFolderId = `folder-${Date.now()}`;
    const newFolder: AnaletFolderNode = {
      id: newFolderId,
      name: folderName || this.generateGroupName(hierarchyState),
      type: 'folder',
      isExpanded: true,
      parentId: analetNode.parentId || 'root',
      children: [
        { ...analetNode, parentId: newFolderId }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Remove analet from its current parent and add folder at the analet's position
    const newRoot = this.cloneHierarchy(hierarchyState.root);
    const parent = this.findNodeById(newRoot, analetNode.parentId || 'root');
    
    if (parent && parent.children) {
      // Find the position of the analet
      const analetIndex = parent.children.findIndex(child => child.id === analetNode.id);
      
      // Remove analet
      parent.children = parent.children.filter(
        child => child.id !== analetNode.id
      );
      
      // Insert new folder at the analet's position
      if (analetIndex >= 0) {
        parent.children.splice(analetIndex, 0, newFolder);
      } else {
        // Fallback to end if position not found
        parent.children.push(newFolder);
      }
    }

    // Rebuild flat map and add to expanded folders
    const newFlatMap = new Map<string, AnaletFolderNode>();
    this.buildFlatMap(newRoot, newFlatMap);
    const newExpandedFolders = new Set([...hierarchyState.expandedFolders, newFolderId]);

    return {
      root: newRoot,
      flatMap: newFlatMap,
      expandedFolders: newExpandedFolders,
      selectionState: hierarchyState.selectionState,
      links: hierarchyState.links,
      hoveredItemId: hierarchyState.hoveredItemId
    };
  }

  /**
   * Move item to new position
   */
  static moveItem(
    hierarchyState: HierarchyState,
    itemId: string,
    targetId: string,
    position: 'above' | 'below' | 'inside'
  ): HierarchyState {
    const item = hierarchyState.flatMap.get(itemId);
    const target = hierarchyState.flatMap.get(targetId);
    
    if (!item || !target) {
      console.warn('Could not find item or target for move operation');
      return hierarchyState;
    }
    const newRoot = this.cloneHierarchy(hierarchyState.root);
    
    // Remove item from current parent
    const currentParent = this.findNodeById(newRoot, item.parentId || 'root');
    if (currentParent && currentParent.children) {
      currentParent.children = currentParent.children.filter(child => child.id !== itemId);
    }

    // Add item to new position
    if (position === 'inside' && (target.type === 'folder' || target.type === 'bearing')) {
      // Add to folder or bearing (nesting operation)
      const targetNode = this.findNodeById(newRoot, targetId);
      if (targetNode) {
        targetNode.children = targetNode.children || [];
        targetNode.children.push({ ...item, parentId: targetId });
      }
    } else {
      // Add above or below target
      const targetParent = this.findNodeById(newRoot, target.parentId || 'root');
      if (targetParent && targetParent.children) {
        const targetIndex = targetParent.children.findIndex(child => child.id === targetId);
        const insertIndex = position === 'above' ? targetIndex : targetIndex + 1;
        targetParent.children.splice(insertIndex, 0, { ...item, parentId: target.parentId || 'root' });
      }
    }

    // Rebuild flat map
    const newFlatMap = new Map<string, AnaletFolderNode>();
    this.buildFlatMap(newRoot, newFlatMap);
    return {
      ...hierarchyState,
      root: newRoot,
      flatMap: newFlatMap
    };
  }

  /**
   * Create new folder
   */
  static createFolder(
    hierarchyState: HierarchyState,
    name?: string,
    parentId: string = 'root'
  ): HierarchyState {
    const newFolderId = `folder-${Date.now()}`;
    const newFolder: AnaletFolderNode = {
      id: newFolderId,
      name: name || this.generateGroupName(hierarchyState),
      type: 'folder',
      isExpanded: true,
      parentId,
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const newRoot = this.cloneHierarchy(hierarchyState.root);
    const parent = this.findNodeById(newRoot, parentId);
    
    if (parent) {
      parent.children = parent.children || [];
      parent.children.push(newFolder);
    }

    // Rebuild flat map
    const newFlatMap = new Map<string, AnaletFolderNode>();
    this.buildFlatMap(newRoot, newFlatMap);
    const newExpandedFolders = new Set([...hierarchyState.expandedFolders, newFolderId]);

    return {
      root: newRoot,
      flatMap: newFlatMap,
      expandedFolders: newExpandedFolders,
      selectionState: hierarchyState.selectionState,
      links: hierarchyState.links,
      hoveredItemId: hierarchyState.hoveredItemId
    };
  }

  /**
   * Delete folder or analet
   * For folders: moves children to parent folder
   * For analets: removes the analet
   */
  static deleteItem(hierarchyState: HierarchyState, itemId: string): HierarchyState {
    const item = hierarchyState.flatMap.get(itemId);
    if (!item || itemId === 'root') {
      return hierarchyState;
    }

    const newRoot = this.cloneHierarchy(hierarchyState.root);
    const parent = this.findNodeById(newRoot, item.parentId || 'root');
    
    if (!parent || !parent.children) {
      return hierarchyState;
    }

    if (item.type === 'folder' || item.type === 'bearing') {
      // For folders and bearings: move children to parent before deleting
      const containerNode = this.findNodeById(newRoot, itemId);
      if (containerNode && containerNode.children) {
        // Find the position of the container being deleted
        const containerIndex = parent.children.findIndex(child => child.id === itemId);

        // Update parent IDs of children and insert them at the container's position
        const childrenToMove = containerNode.children.map(child => ({
          ...child,
          parentId: item.parentId || 'root'
        }));

        // Remove the container
        parent.children = parent.children.filter(child => child.id !== itemId);

        // Insert children at the container's position
        if (containerIndex >= 0) {
          parent.children.splice(containerIndex, 0, ...childrenToMove);
        } else {
          // Fallback: add to end if position not found
          parent.children.push(...childrenToMove);
        }

        // label kept for clarity in earlier logs; no-op here
      } else {
        // Empty container, just remove it
        parent.children = parent.children.filter(child => child.id !== itemId);
        // no-op
      }
    } else {
      // For analets: simply remove them
      parent.children = parent.children.filter(child => child.id !== itemId);
    }

    // Rebuild flat map
    const newFlatMap = new Map<string, AnaletFolderNode>();
    this.buildFlatMap(newRoot, newFlatMap);
    const newExpandedFolders = new Set(hierarchyState.expandedFolders);
    newExpandedFolders.delete(itemId);

    return {
      root: newRoot,
      flatMap: newFlatMap,
      expandedFolders: newExpandedFolders,
      selectionState: hierarchyState.selectionState,
      links: hierarchyState.links,
      hoveredItemId: hierarchyState.hoveredItemId
    };
  }

  /**
   * Utility functions
   */
  public static cloneHierarchy(node: AnaletFolderNode): AnaletFolderNode {
    return {
      ...node,
      children: node.children?.map(child => this.cloneHierarchy(child))
    };
  }

  static findNodeById(root: AnaletFolderNode, id: string): AnaletFolderNode | null {
    if (root.id === id) return root;
    if (root.children) {
      for (const child of root.children) {
        const found = this.findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  private static traverseNodes(node: AnaletFolderNode, callback: (node: AnaletFolderNode) => void) {
    callback(node);
    if (node.children) {
      node.children.forEach(child => this.traverseNodes(child, callback));
    }
  }

  /**
   * Convert hierarchy to d3 hierarchy for advanced operations
   */
  static toD3Hierarchy(node: AnaletFolderNode): AnaletHierarchyNode {
    return hierarchy(node, d => d.children);
  }

  /**
   * Create bearing from multiple analets
   */
  static createBearingFromAnalets(
    hierarchyState: HierarchyState,
    analetIds: number[],
    bearingName?: string,
    bearingStatement?: string
  ): HierarchyState {
    const analetNodes = analetIds
      .map(id => Array.from(hierarchyState.flatMap.values())
        .find(node => node.type === 'analet' && node.analetId === id))
      .filter((node): node is AnaletFolderNode => node !== undefined);

    if (analetNodes.length === 0) {
      console.warn('Could not find any analets for bearing creation');
      return hierarchyState;
    }

    const newBearingId = `bearing-${Date.now()}`;
    const newBearing: AnaletFolderNode = {
      id: newBearingId,
      name: bearingName || `Bearing: ${bearingStatement || 'Conceptual grouping'}`,
      type: 'bearing',
      isExpanded: true,
      parentId: 'root', // Always create bearings at root level
      children: analetNodes.map(node => ({ ...node, parentId: newBearingId })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isBearing: true,
      bearingStatement: bearingStatement || bearingName
    };

    // Remove analets from their current locations and add bearing
    const newRoot = this.cloneHierarchy(hierarchyState.root);
    
    // Remove all analets from their current parents first
    analetNodes.forEach(analetNode => {
      const parent = this.findNodeById(newRoot, analetNode.parentId || 'root');
      if (parent && parent.children) {
        parent.children = parent.children.filter(child => child.id !== analetNode.id);
      }
    });

    // Add bearing to root
    if (newRoot.children) {
      newRoot.children.push(newBearing);
    } else {
      newRoot.children = [newBearing];
    }

    // Rebuild flat map and add to expanded folders
    const newFlatMap = new Map<string, AnaletFolderNode>();
    this.buildFlatMap(newRoot, newFlatMap);
    const newExpandedFolders = new Set([...hierarchyState.expandedFolders, newBearingId]);

    return {
      root: newRoot,
      flatMap: newFlatMap,
      expandedFolders: newExpandedFolders,
      selectionState: hierarchyState.selectionState,
      links: hierarchyState.links,
      hoveredItemId: hierarchyState.hoveredItemId
    };
  }

  /**
   * Update hierarchy when analysis notes change
   */
  static updateNotesInHierarchy(hierarchyState: HierarchyState, newNotes: AnalysisNote[]): HierarchyState {
    const existingNoteIds = new Set<number>();
    const notesToAdd: AnalysisNote[] = [];
    const notesToUpdate: AnalysisNote[] = [];
    
    // Find existing notes and ones to add/update
    this.traverseNodes(hierarchyState.root, (node) => {
      if (node.type === 'note' && node.noteId !== undefined) {
        existingNoteIds.add(node.noteId);
      }
    });
    // Identify new notes to add and existing ones to update
    newNotes.forEach(note => {
      if (!existingNoteIds.has(note.id)) {
        notesToAdd.push(note);
      } else {
        notesToUpdate.push(note);
      }
    });
    // Remove notes that are no longer in the new notes list
    const newNoteIds = new Set(newNotes.map(n => n.id));
    let hasChanges = false;

    // Update existing note references in the hierarchy
    const updateNoteReferences = (node: AnaletFolderNode): AnaletFolderNode => {
      if (node.type === 'note' && node.noteId !== undefined) {
        const updatedNote = newNotes.find(n => n.id === node.noteId);
        if (updatedNote) {
          // Update the note reference and name if they've changed
          const updatedNode = {
            ...node,
            name: updatedNote.content || `Note ${updatedNote.id}`,
            note: updatedNote
          };
          if (updatedNode.name !== node.name || updatedNode.note !== node.note) {
            hasChanges = true;
          }
          return updatedNode;
        } else if (!newNoteIds.has(node.noteId)) {
          // This note is no longer in the list, mark for removal
          hasChanges = true;
          return null as any; // Will be filtered out
        }
      }
      
      if (node.children) {
        const updatedChildren = node.children
          .map(updateNoteReferences)
          .filter(child => child !== null);
        
        if (updatedChildren.length !== node.children.length) {
          hasChanges = true;
        }
        
        return {
          ...node,
          children: updatedChildren
        };
      }
      
      return node;
    };

    let newRoot = updateNoteReferences(hierarchyState.root);

    // Add new notes to their correct parent nodes
    if (notesToAdd.length > 0) {
      hasChanges = true;
      
      const newNoteNodes = notesToAdd.map(note => ({
        id: `note-${note.id}`,
        name: note.content || `Note ${note.id}`,
        type: 'note' as const,
        noteId: note.id,
        note: note,
        parentId: note.parentId || 'root',
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      }));
      
      // Function to add notes to their correct parent nodes
      const addNotesToParents = (node: AnaletFolderNode): AnaletFolderNode => {
        // Check if any new notes should be children of this node
        const notesForThisNode = newNoteNodes.filter(noteNode => 
          noteNode.parentId === node.id
        );
        
        if (notesForThisNode.length > 0) {
          const existingChildren = node.children || [];
          
          // Ensure no duplicates by filtering out any existing nodes with same noteId
          const existingNoteNodeIds = new Set(
            existingChildren
              .filter(child => child.type === 'note')
              .map(child => child.noteId)
          );
          
          const filteredNewNodes = notesForThisNode.filter(
            noteNode => !existingNoteNodeIds.has(noteNode.noteId)
          );
          
          if (filteredNewNodes.length > 0) {
            return {
              ...node,
              children: [...existingChildren, ...filteredNewNodes]
            };
          }
        }
        
        // Recursively process children
        if (node.children) {
          const updatedChildren = node.children.map(addNotesToParents);
          const hasChildChanges = updatedChildren.some((child, idx) => child !== node.children![idx]);
          
          if (hasChildChanges) {
            return {
              ...node,
              children: updatedChildren
            };
          }
        }
        
        return node;
      };
      
      newRoot = addNotesToParents(newRoot);
    }

    // Return original state if no changes
    if (!hasChanges) {
      return hierarchyState;
    }

    // Rebuild flat map
    const newFlatMap = new Map<string, AnaletFolderNode>();
    this.buildFlatMap(newRoot, newFlatMap);

    return {
      ...hierarchyState,
      root: newRoot,
      flatMap: newFlatMap
    };
  }

  /**
   * Get all analets from hierarchy in flat array
   */
  static getAllAnalets(hierarchyState: HierarchyState): Analet[] {
    const analets: Analet[] = [];
    this.traverseNodes(hierarchyState.root, (node) => {
      if (node.type === 'analet' && node.analet) {
        analets.push(node.analet);
      }
    });
    return analets;
  }

  /**
   * Get all analysis notes from hierarchy in flat array
   */
  static getAllNotes(hierarchyState: HierarchyState): AnalysisNote[] {
    const notes: AnalysisNote[] = [];
    this.traverseNodes(hierarchyState.root, (node) => {
      if (node.type === 'note' && node.note) {
        notes.push(node.note);
      }
    });
    return notes;
  }
} 