import { Analet } from "../types/analet";

type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interleaveBits16(x: number, y: number): number {
  let xx = x & 0xffff;
  let yy = y & 0xffff;

  xx = (xx | (xx << 8)) & 0x00ff00ff;
  xx = (xx | (xx << 4)) & 0x0f0f0f0f;
  xx = (xx | (xx << 2)) & 0x33333333;
  xx = (xx | (xx << 1)) & 0x55555555;

  yy = (yy | (yy << 8)) & 0x00ff00ff;
  yy = (yy | (yy << 4)) & 0x0f0f0f0f;
  yy = (yy | (yy << 2)) & 0x33333333;
  yy = (yy | (yy << 1)) & 0x55555555;

  return (yy << 1) | xx;
}

export function computeMortonOrder(
  analets: Analet[],
  getPosition: (a: Analet) => Point | undefined,
  bitsPerAxis: number = 16
): Map<number, number> {
  const positions: { id: number; p: Point }[] = [];
  for (const a of analets) {
    const pos = getPosition(a);
    if (pos && isFinite(pos.x) && isFinite(pos.y)) positions.push({ id: a.id, p: pos });
  }
  if (positions.length === 0) return new Map();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { p } of positions) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const maxCoord = (1 << bitsPerAxis) - 1;

  const keyed = positions.map(({ id, p }) => {
    const nx = clamp(Math.round(((p.x - minX) / rangeX) * maxCoord), 0, maxCoord);
    const ny = clamp(Math.round(((p.y - minY) / rangeY) * maxCoord), 0, maxCoord);
    const key = interleaveBits16(nx, ny);
    return { id, key };
  });

  keyed.sort((a, b) => (a.key - b.key) || (a.id - b.id));

  const indexById = new Map<number, number>();
  for (let i = 0; i < keyed.length; i++) indexById.set(keyed[i].id, i);
  return indexById;
}

export function sortAnaletsByOrder(analets: Analet[], order: Map<number, number>): Analet[] {
  if (order.size === 0) return [...analets];
  const maxIndex = order.size + analets.length;
  return [...analets].sort((a, b) => {
    const ia = order.has(a.id) ? (order.get(a.id) as number) : maxIndex + a.id;
    const ib = order.has(b.id) ? (order.get(b.id) as number) : maxIndex + b.id;
    return ia - ib || (a.id - b.id);
  });
}




