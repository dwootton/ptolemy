import { MessageService } from './MessageService';
import { StateService } from './StateService';
import { HierarchyService, Edge as HierarchyEdge } from './HierarchyService';
import { convexHull, polygonArea } from '../utils/geometry';

type BearingMetricsState = {
  bearingId: number;
  windowSize: number; // defaults to 4
  zThreshold: number; // configurable later
  minAbsDelta: number; // default 0
  deltas: number[];
  hullArea: number;
  stats: { mean: number; std: number };
  lastJumpAt?: number;
  reflections?: Array<{ at: number; z: number; delta: number; note?: string }>;
  memberIds: number[];
  addedSinceLastJump: number;
  forceEveryThirdAnalet: boolean;
};

export class BearingMetricsService {
  private static instance: BearingMetricsService;
  private messageService = MessageService.getInstance();
  private stateService = StateService.getInstance();
  private hierarchy = HierarchyService.getInstance();

  private metricsByBearing: Map<number, BearingMetricsState> = new Map();
  private prevChildren: Map<number, Set<number>> = new Map();

  private constructor() {
    // Load persisted metrics from extension
    this.loadPersistedMetrics().catch(() => {});

    // React to hierarchy changes (drag/drop)
    window.addEventListener('hierarchyUpdated', this.handleHierarchyUpdated as EventListener);

    // Refresh after checkpoint restore
    this.messageService.onMessage('checkpoint-restored', () => this.loadPersistedMetrics());
    this.messageService.onMessage('bearing-metrics-restored', (data: any) => this.hydrateFromMap(data?.bearingMetrics || {}));

    // Actions from extension toast
    this.messageService.onMessage('bearing:exit', (_data: any) => {
      try {
        this.stateService.setActiveBearingId(null);
      } catch {}
    });
    this.messageService.onMessage('bearing:add-note', async (data: any) => {
      const bearingId = data?.bearingId;
      if (typeof bearingId === 'number') {
        try {
          const off = this.messageService.onMessage('create-blank-note', async (resp: any) => {
            try { off(); } catch {}
            const note = resp?.note;
            if (!note || typeof note.id !== 'number') return;
            const noteId = `note-${note.id}`;
            const parentId = `bearing-${bearingId}`;
            try {
              const hs = this.hierarchy;
              await hs.addEdge(parentId, noteId);
            } catch {}
            try {
              window.dispatchEvent(new CustomEvent('openNoteEditor', { detail: { note } }));
            } catch {}
          });
          this.messageService.sendMessage('create-blank-note', {});
        } catch (e) {}
      }
    });
  }

  public static getInstance(): BearingMetricsService {
    if (!BearingMetricsService.instance) {
      BearingMetricsService.instance = new BearingMetricsService();
    }
    return BearingMetricsService.instance;
  }

  private async loadPersistedMetrics(): Promise<void> {
    try {
      const off = this.messageService.onMessage('bearing-metrics-load-response', (data: any) => {
        try { this.hydrateFromMap(data?.bearingMetrics || {}); } catch {}
        off();
      });
      this.messageService.sendMessage('bearing-metrics-load', {});
    } catch (e) {
      // ignore
    }
  }

  private hydrateFromMap(map: Record<string, BearingMetricsState>): void {
    this.metricsByBearing.clear();
    Object.keys(map || {}).forEach(key => {
      const entry = map[key];
      if (entry && typeof entry.bearingId === 'number') {
        this.metricsByBearing.set(entry.bearingId, entry);
      }
    });
  }

  private handleHierarchyUpdated = () => {
    try {
      // Build mapping of bearing -> direct analet children from current edges
      const edges: HierarchyEdge[] = this.hierarchy.getEdges();
      const bearingToChildren = new Map<number, Set<number>>();

      for (const e of edges) {
        if (typeof e.parentId === 'string' && e.parentId.startsWith('bearing-') && typeof e.childId === 'string' && e.childId.startsWith('analet-')) {
          const bearingId = Number(e.parentId.replace('bearing-', ''));
          const analetId = Number(e.childId.replace('analet-', ''));
          if (!Number.isFinite(bearingId) || !Number.isFinite(analetId)) continue;
          if (!bearingToChildren.has(bearingId)) bearingToChildren.set(bearingId, new Set());
          bearingToChildren.get(bearingId)!.add(analetId);
        }
      }

      // Detect additions per bearing
      for (const [bearingId, currentSet] of bearingToChildren.entries()) {
        const prev = this.prevChildren.get(bearingId) || new Set<number>();
        const added: number[] = [];
        currentSet.forEach(id => { if (!prev.has(id)) added.push(id); });

        if (added.length > 0) {
          // Recompute metrics once per change batch
          this.processAdd(bearingId, Array.from(currentSet));
        }
      }

      // Update snapshot for next diff
      this.prevChildren = bearingToChildren;
    } catch (e) {
      // Swallow to avoid UI disruption
    }
  };

  private getOrInitMetrics(bearingId: number): BearingMetricsState {
    let s = this.metricsByBearing.get(bearingId);
    if (!s) {
      s = {
        bearingId,
        windowSize: 4,
        zThreshold: 2.0,
        minAbsDelta: 0,
        deltas: [],
        hullArea: 0,
        stats: { mean: 0, std: 0 },
        memberIds: [],
        addedSinceLastJump: 0,
        forceEveryThirdAnalet: true
      };
      this.metricsByBearing.set(bearingId, s);
    }
    return s;
  }

  private processAdd(bearingId: number, memberIds: number[]): void {
    const s = this.getOrInitMetrics(bearingId);
    // Build points from current analets under bearing
    const analets = this.stateService.getAvailableAnalets();
    const byId = new Map<number, any>(analets.map(a => [a.id, a]));
    const points = memberIds
      .map(id => byId.get(id))
      .filter(a => a && a.location && Number.isFinite(a.location.x) && Number.isFinite(a.location.y))
      .map(a => ({ x: a.location.x as number, y: a.location.y as number }));

    const hull = convexHull(points);
    const area = polygonArea(hull);
    const delta = area - (s.hullArea || 0);

    // Update rolling window
    const deltas = s.deltas.slice();
    deltas.push(delta);
    while (deltas.length > s.windowSize) deltas.shift();

    // Stats
    const mean = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const variance = deltas.length > 1 ? deltas.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (deltas.length - 1) : 0;
    const std = Math.sqrt(variance);
    const eps = 1e-6;
    const z = (delta - mean) / Math.max(std, eps);

    // Update base state
    s.hullArea = area;
    s.deltas = deltas;
    s.stats = { mean, std };
    s.memberIds = memberIds.slice();
    s.addedSinceLastJump = (s.addedSinceLastJump || 0) + 1;

    const now = Date.now();
    const cooldownMs = 60_000; // default cooldown
    const inCooldown = s.lastJumpAt && (now - s.lastJumpAt) < cooldownMs;

    // Determine jump
    let jumped = false;
    let reason: 'forced' | 'zscore' | null = null;
    if (!inCooldown && s.forceEveryThirdAnalet && s.addedSinceLastJump >= 3) {
      jumped = true; reason = 'forced';
    } else if (!inCooldown) {
      const hasEnough = deltas.length >= Math.min(4, s.windowSize);
      if (hasEnough && Math.abs(delta) >= (s.minAbsDelta || 0) && z >= (s.zThreshold || 2.0)) {
        jumped = true; reason = 'zscore';
      }
    }

    if (jumped) {
      s.lastJumpAt = now;
      s.addedSinceLastJump = 0;
      // Persist and notify
      this.persist(bearingId);
      let bearingStatement: string | undefined;
      try {
        const bList = this.stateService.getBearings ? this.stateService.getBearings() : [];
        const b = bList.find(b => b.id === bearingId);
        bearingStatement = b?.statement || b?.name || undefined;
      } catch {}
      const explanation = `Possible semantic jump (${reason || 'z-score'}). z=${z.toFixed(2)}, Δ=${delta.toFixed(2)}, members=${memberIds.length}`;
      this.messageService.sendMessage('bearing-jump', { bearingId, delta, z, memberCount: memberIds.length, reason, bearingStatement, explanation });
    } else {
      // Persist regular update
      this.persist(bearingId);
    }
  }

  private persist(bearingId: number): void {
    const s = this.metricsByBearing.get(bearingId);
    if (!s) return;
    const key = `bearing-${bearingId}`;
    // Send partial update to extension to merge
    this.messageService.sendMessage('bearing-metrics-update', { key, state: s });
  }
}

// Initialize eagerly (side-effect)
void BearingMetricsService.getInstance();
