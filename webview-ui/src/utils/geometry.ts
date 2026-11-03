export interface Point { x: number; y: number }

// Monotonic chain convex hull. Returns hull vertices in counter-clockwise order.
export function convexHull(points: Point[]): Point[] {
  const pts = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length <= 1) return pts.slice();
  const sorted = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }

  // Concatenate lower and upper to get full hull; remove duplicate endpoints
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Polygon area via shoelace formula. Assumes vertices are ordered around the polygon.
export function polygonArea(vertices: Point[]): number {
  const n = vertices.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

