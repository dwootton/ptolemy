import { Analet } from "../types/analet";

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Returns analet IDs ordered by a simple greedy nearest-neighbor seriation
 * over their embedding vectors. Falls back to alphabetical statement order
 * when embeddings are missing or insufficient.
 */
export function orderAnaletsByEmbedding(analets: Analet[]): number[] {
  const withEmb = analets.filter(a => Array.isArray(a.embedding) && a.embedding.length > 0);
  if (withEmb.length <= 2) {
    return [...analets]
      .sort((a, b) => (a.statement || '').localeCompare(b.statement || ''))
      .map(a => a.id);
  }

  // Pick start as the point with smallest norm to reduce bias
  const startIdx = (() => {
    let best = 0;
    let bestNorm = Infinity;
    for (let i = 0; i < withEmb.length; i++) {
      const e = withEmb[i].embedding as number[];
      let norm = 0;
      for (let k = 0; k < e.length; k++) norm += (e[k] || 0) * (e[k] || 0);
      if (norm < bestNorm) { bestNorm = norm; best = i; }
    }
    return best;
  })();

  const visited = new Set<number>();
  const order: number[] = [];
  let current = withEmb[startIdx];
  visited.add(current.id);
  order.push(current.id);

  while (order.length < withEmb.length) {
    let bestId: number | null = null;
    let bestDist = Infinity;
    for (const a of withEmb) {
      if (visited.has(a.id)) continue;
      const d = euclidean(current.embedding as number[], a.embedding as number[]);
      if (d < bestDist) { bestDist = d; bestId = a.id; }
    }
    if (bestId == null) break;
    visited.add(bestId);
    order.push(bestId);
    current = withEmb.find(a => a.id === bestId)!;
  }

  // Append any items without embeddings at the end by statement
  const withoutEmb = analets.filter(a => !visited.has(a.id));
  withoutEmb.sort((a, b) => (a.statement || '').localeCompare(b.statement || ''));
  for (const a of withoutEmb) order.push(a.id);

  return order;
}

export function buildOrderIndexMap(ids: number[]): Map<number, number> {
  const m = new Map<number, number>();
  ids.forEach((id, idx) => m.set(id, idx));
  return m;
}

