import { BaseMessageHandler } from '../BaseMessageHandler';
import { MessageContext } from '../types';

type Edge = {
  edgeId: string;
  parentId: string;
  childId: string;
  type: 'contains' | string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

const EDGES_KEY = 'MERIDIAN_EDGES_V1';
const EDGES_VERSION_KEY = 'MERIDIAN_EDGES_VERSION_V1';

export class HierarchyMessageHandler extends BaseMessageHandler {
  constructor() {
    super([
      'edges-list',
      'edges-add',
      'edges-remove',
      'edges-reorder',
      'edges-move',
      'edges-clear',
      'hierarchy-children',
      'hierarchy-view',
      'hierarchy-snapshot-save',
      'hierarchy-snapshot-load'
    ]);
  }

  public async handle(messageType: string, data: any, context: MessageContext): Promise<void> {
    await this.initialize(context);
    try {
      switch (messageType) {
        case 'edges-list':
          return this.handleEdgesList(data);
        case 'edges-add':
          return this.handleEdgesAdd(data);
        case 'edges-remove':
          return this.handleEdgesRemove(data);
        case 'edges-reorder':
          return this.handleEdgesReorder(data);
        case 'edges-move':
          return this.handleEdgesMove(data);
        case 'edges-clear':
          return this.handleEdgesClear(data);
        case 'hierarchy-children':
          return this.handleChildren(data);
        case 'hierarchy-view':
          return this.handleView(data);
        case 'hierarchy-snapshot-save':
          return this.handleSnapshotSave();
        case 'hierarchy-snapshot-load':
          return this.handleSnapshotLoad();
        default:
          throw new Error(`Unsupported message type: ${messageType}`);
      }
    } catch (error) {
      await this.sendError(messageType, error as Error, data);
    }
  }

  private async getEdges(): Promise<Edge[]> {
    const raw = await this.context!.stateService.getWorkspaceState(EDGES_KEY);
    const edges = Array.isArray(raw) ? raw as Edge[] : [];
    return edges;
  }

  private async saveEdges(edges: Edge[]): Promise<void> {
    await this.context!.stateService.setWorkspaceState(EDGES_KEY, edges);
  }

  private async bumpVersion(): Promise<number> {
    const current = await this.context!.stateService.getWorkspaceState(EDGES_VERSION_KEY);
    const next = (typeof current === 'number' ? current : 0) + 1;
    await this.context!.stateService.setWorkspaceState(EDGES_VERSION_KEY, next);
    return next;
  }

  private genId(): string {
    return `edge_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private normalizeType(t?: string): 'contains' | string { return (t as any) || 'contains'; }

  // === Handlers ===
  private async handleEdgesList(data: any): Promise<void> {
    const edges = await this.getEdges();
    const filtered = edges.filter(e =>
      (data?.parentId ? e.parentId === data.parentId : true) &&
      (data?.childId ? e.childId === data.childId : true) &&
      (data?.type ? e.type === data.type : true)
    );
    const version = await this.context!.stateService.getWorkspaceState(EDGES_VERSION_KEY) || 0;
    await this.sendSuccess('edges-list-response', { edges: filtered, version });
  }

  private async handleEdgesAdd(data: any): Promise<void> {
    const edges = await this.getEdges();
    const toAdd = Array.isArray(data?.edges) ? data.edges : [];
    const now = new Date().toISOString();
    for (const i of toAdd) {
      const type = this.normalizeType(i.type);
      if (edges.some(e => e.parentId === i.parentId && e.childId === i.childId && e.type === type)) {
        try { this.log('info', '[HIERARCHY-MOVE-NEST] edges-add:duplicate-skip', { parentId: i.parentId, childId: i.childId }); } catch {}
        continue;
      }
      const siblings = edges.filter(e => e.parentId === i.parentId && e.type === type).sort((a,b)=>a.orderIndex-b.orderIndex);
      const orderIndex = Number.isFinite(i.orderIndex) ? i.orderIndex : (siblings.length > 0 ? siblings[siblings.length-1].orderIndex + 1 : 0);
      edges.push({ edgeId: this.genId(), parentId: i.parentId, childId: i.childId, type, orderIndex, createdAt: now, updatedAt: now });
    }
    await this.saveEdges(edges);
    const version = await this.bumpVersion();
    try { this.log('info', '[HIERARCHY-MOVE-NEST] edges-add:success', { count: toAdd.length, version }); } catch {}
    await this.sendSuccess('edges-add-response', { version });
    await this.sendMessage('edges-updated', { version, action: 'added' });
  }

  private async handleEdgesRemove(data: any): Promise<void> {
    const ids: string[] = Array.isArray(data?.edgeIds) ? data.edgeIds : [];
    const edges = await this.getEdges();
    const before = edges.length;
    const after = edges.filter(e => !ids.includes(e.edgeId));
    await this.saveEdges(after);
    const version = await this.bumpVersion();
    await this.sendSuccess('edges-remove-response', { removedCount: before - after.length, version });
    await this.sendMessage('edge-removed', { version });
  }

  private async handleEdgesReorder(data: any): Promise<void> {
    const parentId = data?.parentId;
    const type = this.normalizeType(data?.type);
    const children: Array<{ childId: string; orderIndex: number }>= Array.isArray(data?.children) ? data.children : [];
    const edges = await this.getEdges();
    const now = new Date().toISOString();
    try { this.log('info', '[HIERARCHY-MOVE-NEST] edges-reorder:req', { parentId, count: children.length }); } catch {}
    for (const e of edges) {
      if (e.parentId === parentId && e.type === type) {
        const found = children.find(c => c.childId === e.childId);
        if (found && Number.isFinite(found.orderIndex)) {
          e.orderIndex = found.orderIndex;
          e.updatedAt = now;
        }
      }
    }
    // Normalize ordering
    const siblings = edges.filter(e => e.parentId === parentId && e.type === type).sort((a,b)=>a.orderIndex-b.orderIndex);
    siblings.forEach((s, idx) => s.orderIndex = idx);
    await this.saveEdges(edges);
    const version = await this.bumpVersion();
    try { this.log('info', '[HIERARCHY-MOVE-NEST] edges-reorder:success', { parentId, version }); } catch {}
    await this.sendSuccess('edges-reorder-response', { version });
    await this.sendMessage('edges-reordered', { version, parentId });
  }

  private async handleEdgesMove(data: any): Promise<void> {
    const edgeId = data?.edgeId;
    const newParentId = data?.newParentId;
    const newOrderIndex: number | undefined = data?.newOrderIndex;
    const edges = await this.getEdges();
    const idx = edges.findIndex(e => e.edgeId === edgeId);
    if (idx < 0) throw new Error('edge not found');
    const type = edges[idx].type;
    edges[idx].parentId = newParentId;
    if (Number.isFinite(newOrderIndex)) {
      edges[idx].orderIndex = newOrderIndex as number;
    } else {
      const siblings = edges.filter(e => e.parentId === newParentId && e.type === type);
      edges[idx].orderIndex = siblings.length > 0 ? Math.max(...siblings.map(s => s.orderIndex)) + 1 : 0;
    }
    edges[idx].updatedAt = new Date().toISOString();
    await this.saveEdges(edges);
    const version = await this.bumpVersion();
    try { this.log('info', '[HIERARCHY-MOVE-NEST] edges-move:success', { edgeId, newParentId, version }); } catch {}
    await this.sendSuccess('edges-move-response', { version });
    await this.sendMessage('edges-reordered', { version, parentId: newParentId });
  }

  private async handleChildren(data: any): Promise<void> {
    const parentId = data?.parentId;
    const type = this.normalizeType(data?.type);
    const edges = await this.getEdges();
    const children = edges
      .filter(e => e.parentId === parentId && e.type === type)
      .sort((a,b)=>a.orderIndex-b.orderIndex)
      .map(e => ({ childId: e.childId, orderIndex: e.orderIndex }));
    await this.sendSuccess('hierarchy-children-response', { parentId, children });
  }

  private async handleView(data: any): Promise<void> {
    // Minimal view: just return top-level children under provided root (or synthetic root)
    const rootId = data?.rootId || 'item:root';
    const edges = await this.getEdges();
    const children = edges.filter(e => e.parentId === rootId).sort((a,b)=>a.orderIndex-b.orderIndex);
    await this.sendSuccess('hierarchy-view-response', { root: { id: rootId, children } });
  }

  private async handleSnapshotSave(): Promise<void> {
    const version = await this.bumpVersion();
    await this.sendSuccess('hierarchy-snapshot-save-response', { version });
  }

  private async handleSnapshotLoad(): Promise<void> {
    const version = await this.context!.stateService.getWorkspaceState(EDGES_VERSION_KEY) || 0;
    await this.sendSuccess('hierarchy-snapshot-load-response', { version });
  }

  private async handleEdgesClear(data: any): Promise<void> {
    await this.saveEdges([]);
    const version = await this.bumpVersion();
    await this.sendSuccess('edges-clear-response', { version });
    await this.sendMessage('edges-updated', { version, action: 'cleared' });
  }
}


