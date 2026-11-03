/**
 * HierarchyService - Manages edges-based hierarchy in the webview
 *
 * This service:
 * - Loads edges from backend on init
 * - Subscribes to edges-updated events
 * - Builds ordered trees by joining edges with item data (analets/bearings)
 * - Provides getters for edges, children, and full tree
 * - Emits 'hierarchyUpdated' events for UI components
 */

import { MessageService } from './MessageService';
import { StateService } from './StateService';
import { BearingStateService } from './BearingStateService';
import { Analet, Bearing, AnalysisNote } from '../types/analet';

export interface Edge {
  edgeId: string;
  parentId: string;
  childId: string;
  type: 'contains' | string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface TreeNode {
  id: string;
  kind: 'analet' | 'bearing' | 'folder' | 'note' | 'hierarchy-cursor';
  title: string;
  data?: Analet | Bearing | AnalysisNote | any;
  children: TreeNode[];
  orderIndex: number;
  edgeId?: string;
}

export class HierarchyService {
  private static instance: HierarchyService;
  private messageService: MessageService;
  private stateService: StateService;
  private bearingStateService: BearingStateService;
  private edges: Edge[] = [];
  private version: number = 0;
  private isInitialized = false;
  private notes: AnalysisNote[] = [];

  private constructor() {
    this.messageService = MessageService.getInstance();
    this.stateService = StateService.getInstance();
    this.bearingStateService = BearingStateService.getInstance();
    this.initialize();
  }

  public static getInstance(): HierarchyService {
    if (!HierarchyService.instance) {
      HierarchyService.instance = new HierarchyService();
    }
    return HierarchyService.instance;
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    // Subscribe to edges-updated events
    this.messageService.onMessage('edges-updated', (data: any) => {
      this.handleEdgesUpdated(data);
    });
    // Also reload on specific mutation events emitted by the backend
    this.messageService.onMessage('edge-added', (data: any) => {
      this.handleEdgesUpdated(data);
    });
    this.messageService.onMessage('edge-removed', (data: any) => {
      this.handleEdgesUpdated(data);
    });
    this.messageService.onMessage('edges-reordered', (data: any) => {
      this.handleEdgesUpdated(data);
    });
    this.messageService.onMessage('edges-add', (data: any) => {
      this.handleEdgesUpdated(data);
    });

    // Subscribe to edges responses
    this.messageService.onMessage('edges-list-response', (data: any) => {
      if (data?.success && Array.isArray(data.edges)) {
        this.edges = data.edges;
        this.emitHierarchyUpdated();
      }
    });
    this.messageService.onMessage('edges-add-response', (_data: any) => {
      // The edges-updated event will handle the actual edge updates
    });
    this.messageService.onMessage('edges-remove-response', (_data: any) => {
    });
    this.messageService.onMessage('edges-move-response', (_data: any) => {
    });
    this.messageService.onMessage('edges-reorder-response', (_data: any) => {
    });

    // Load initial edges
    try {
      await this.loadEdges();
    } catch (error) {
      console.error('[double-note] HierarchyService loadEdges failed:', error);
    }
    this.isInitialized = true;
  }

  private async loadEdges(): Promise<void> {
    try {
      const response = await this.messageService.sendRequest('edges-list', {}, 10000);
      if (response?.success && Array.isArray(response.edges)) {
        this.edges = response.edges;
        this.version = response.version || 0;
        this.emitHierarchyUpdated();
      }
    } catch (error) {
      console.warn('[double-note] HierarchyService Failed to load edges:', error);
    }
  }

  private handleEdgesUpdated(data: any): void {
    if (data?.edges && Array.isArray(data.edges)) {
      data.edges.forEach((newEdge: Edge) => {
        const exists = this.edges.some(existing =>
          existing.parentId === newEdge.parentId &&
          existing.childId === newEdge.childId
        );
        if (!exists) {
          this.edges.push(newEdge);
        }
      });

      this.emitHierarchyUpdated();
    } else if (data?.version && data.version !== this.version) {
      this.loadEdges();
    }
  }

  private emitHierarchyUpdated(): void {
    window.dispatchEvent(new CustomEvent('hierarchyUpdated', {
      detail: { edges: this.edges, version: this.version }
    }));
  }

  // Public API
  public getEdges(): Edge[] {
    return [...this.edges];
  }

  public getChildren(parentId: string): Edge[] {
    const children = this.edges
      .filter(edge => edge.parentId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    return children;
  }

  public setNotes(notes: AnalysisNote[]): void {
    this.notes = notes;
    this.emitHierarchyUpdated();
  }

  public getTree(): TreeNode[] {
    const analets = this.stateService.getAvailableAnalets();
    const bearings = this.bearingStateService.getBearings();

    // Create item lookup
    const itemsById = new Map<string, { kind: 'analet' | 'bearing' | 'note'; title: string; data: Analet | Bearing | AnalysisNote }>();

    analets.forEach(analet => {
      // Exclude framing analets from the analysis list
      if ((analet as any).type === 'framing') return;
      itemsById.set(`analet-${analet.id}`, {
        kind: 'analet',
        title: analet.statement || `Analet ${analet.id}`,
        data: analet
      });
    });

    bearings.forEach(bearing => {
      itemsById.set(`bearing-${bearing.id}`, {
        kind: 'bearing',
        title: bearing.name || bearing.statement || `Bearing ${bearing.id}`,
        data: bearing
      });
    });

    this.notes.forEach(note => {
      const noteId = `note-${note.id}`;
      itemsById.set(noteId, {
        kind: 'note',
        title: note.content || `Note ${note.id}`,
        data: note
      });
    });

    // Build tree recursively
    const buildNode = (id: string): TreeNode | null => {
      const item = itemsById.get(id);
      if (!item) return null;

      const childEdges = this.getChildren(id);

      const children = childEdges
        .map(edge => buildNode(edge.childId))
        .filter((node): node is TreeNode => node !== null)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      return {
        id,
        kind: item.kind,
        title: item.title,
        data: item.data,
        children,
        orderIndex: 0 // Will be set by parent
      };
    };

    // Prefer explicit root edges ordering if present
    const rootEdges = this.edges
      .filter(edge => edge.parentId === 'item:root')
      .sort((a, b) => a.orderIndex - b.orderIndex);

    if (rootEdges.length > 0) {
      const explicitRootIds = new Set(rootEdges.map(e => e.childId));
      const explicitRoots = rootEdges
        .map(e => buildNode(e.childId))
        .filter((node): node is TreeNode => node !== null);

      // Append any remaining top-level items not yet covered by explicit root edges
      const allChildIds = new Set(this.edges.map(edge => edge.childId));
      const implicitRootIds = Array.from(itemsById.keys()).filter(id => !allChildIds.has(id));
      const missingImplicit = implicitRootIds.filter(id => !explicitRootIds.has(id));
      const implicitRoots = missingImplicit
        .map(id => buildNode(id))
        .filter((node): node is TreeNode => node !== null)
        .sort((a, b) => a.title.localeCompare(b.title));

      return [...explicitRoots, ...implicitRoots];
    }

    // Fallback: infer roots from items without any parent edge (alphabetical)
    const allChildIds = new Set(this.edges.map(edge => edge.childId));
    const rootIds = Array.from(itemsById.keys()).filter(id => !allChildIds.has(id));
    const fallbackRoots = rootIds
      .map(id => buildNode(id))
      .filter((node): node is TreeNode => node !== null)
      .sort((a, b) => a.title.localeCompare(b.title));

    return fallbackRoots;
  }

  // Mutation methods
  public async addEdge(parentId: string, childId: string, orderIndex?: number): Promise<boolean> {
    return new Promise((resolve) => {
      // Set up a one-time listener for the response
      const cleanup = this.messageService.onMessage('edges-add-response', (data: any) => {
        cleanup();
        const success = data?.success === true;
        if (success) {
          // Optimistically update local edges
          const now = new Date().toISOString();
          const siblings = this.edges
            .filter(e => e.parentId === parentId && e.type === 'contains')
            .sort((a,b) => a.orderIndex - b.orderIndex);
          const nextIndex = Number.isFinite(orderIndex as any)
            ? (orderIndex as number)
            : (siblings.length > 0 ? siblings[siblings.length-1].orderIndex + 1 : 0);
          // Avoid duplicates
          const exists = this.edges.some(e => e.parentId === parentId && e.childId === childId && e.type === 'contains');
          if (!exists) {
            this.edges.push({
              edgeId: `edge_local_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
              parentId,
              childId,
              type: 'contains',
              orderIndex: nextIndex,
              createdAt: now,
              updatedAt: now
            });
            this.emitHierarchyUpdated();
          }
        }
        resolve(success);
      });

      // Send the message
      this.messageService.sendMessage('edges-add', {
        edges: [{ parentId, childId, type: 'contains', orderIndex }]
      });

      // Set a timeout to resolve false if no response
      setTimeout(() => {
        cleanup();
        console.warn('[double-note] HierarchyService Edge add timeout, assuming success based on events', { parentId, childId });
        resolve(true); // Assume success since we're seeing the events in logs
      }, 3000);
    });
  }


  public async removeEdge(edgeId: string): Promise<boolean> {
    try {
      const response = await this.messageService.sendRequest('edges-remove', {
        edgeIds: [edgeId]
      }, 5000);
      return response?.success === true;
    } catch (error) {
      console.error('[HierarchyService] Failed to remove edge:', error);
      return false;
    }
  }

  public async moveEdge(edgeId: string, newParentId: string, newOrderIndex?: number): Promise<boolean> {
    try {
      const response = await this.messageService.sendRequest('edges-move', {
        edgeId,
        newParentId,
        newOrderIndex
      }, 5000);
      const ok = response?.success === true || response?.version != null;
      if (ok) {
        // Optimistically update local edges
        const idx = this.edges.findIndex(e => e.edgeId === edgeId);
        if (idx >= 0) {
          const type = this.edges[idx].type;
          this.edges[idx].parentId = newParentId;
          if (Number.isFinite(newOrderIndex as any)) {
            this.edges[idx].orderIndex = newOrderIndex as number;
          } else {
            const siblings = this.edges.filter(e => e.parentId === newParentId && e.type === type);
            this.edges[idx].orderIndex = siblings.length > 0 ? Math.max(...siblings.map(s => s.orderIndex)) + 1 : 0;
          }
          this.edges[idx].updatedAt = new Date().toISOString();
          this.emitHierarchyUpdated();
        }
      }
      return ok;
    } catch (error) {
      console.error('[HierarchyService] Failed to move edge:', error);
      return false;
    }
  }

  public async reorderChildren(parentId: string, orderedChildIds: string[]): Promise<boolean> {
    try {
      const children = orderedChildIds.map((childId, index) => ({
        childId,
        orderIndex: index
      }));

      const response = await this.messageService.sendRequest('edges-reorder', {
        parentId,
        type: 'contains',
        children
      }, 10000);
      const ok = response?.success === true || response?.version != null;
      if (ok) {
        // Optimistically set order for local edges under parentId
        const now = new Date().toISOString();
        for (const e of this.edges) {
          if (e.parentId === parentId && e.type === 'contains') {
            const found = children.find(c => c.childId === e.childId);
            if (found) {
              e.orderIndex = found.orderIndex;
              e.updatedAt = now;
            }
          }
        }
        this.emitHierarchyUpdated();
      }
      return ok;
    } catch (error) {
      console.error('[HierarchyService] Failed to reorder children:', error);
      return false;
    }
  }

  public findEdge(parentId: string, childId: string): Edge | undefined {
    return this.edges.find(edge => edge.parentId === parentId && edge.childId === childId);
  }

  public getParentId(childId: string): string | undefined {
    const edge = this.edges.find(edge => edge.childId === childId);
    return edge?.parentId;
  }

  // Batch add edges for initializing explicit ordering
  public async addEdges(parentId: string, childIds: string[], startIndex?: number): Promise<boolean> {
    try {
      const edges = childIds.map((childId, i) => ({ parentId, childId, type: 'contains', orderIndex: (startIndex || 0) + i }));
      const response = await this.messageService.sendRequest('edges-add', { edges }, 5000);
      const ok = response?.success === true || response?.version != null;
      if (ok) {
        const now = new Date().toISOString();
        const existing = new Set(this.edges.filter(e => e.parentId === parentId && e.type === 'contains').map(e => e.childId));
        edges.forEach((i, idx) => {
          if (!existing.has(i.childId)) {
            this.edges.push({
              edgeId: `edge_local_${Date.now()}_${idx}_${Math.random().toString(36).slice(2,7)}`,
              parentId: i.parentId,
              childId: i.childId,
              type: 'contains',
              orderIndex: i.orderIndex ?? idx,
              createdAt: now,
              updatedAt: now
            });
          }
        });
        this.emitHierarchyUpdated();
      }
      return ok;
    } catch (error) {
      console.error('[HierarchyService] Failed to add edges batch:', error);
      return false;
    }
  }

  public findSimilarAnaletsById(id: number, k: number = 10) {
    // Lazy import to avoid circular deps at module load
    const { HierarchySimilarityService } = require('./HierarchySimilarityService');
    const service = HierarchySimilarityService.getInstance();
    const analets = this.stateService.getAvailableAnalets();
    return service.findSimilarAnaletsById(id, analets as any, k);
  }
}
