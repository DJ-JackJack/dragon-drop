/** Rectangles and shapes in map-pixel coordinates (origin top-left, y down). */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Point = [number, number];

export type Shape =
  | { type: "circle"; x: number; y: number; r: number }
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "polygon"; points: Point[] }
  | { type: "stroke"; points: Point[]; r: number }
  | { type: "all" };

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Clip a rect to [0,W)×[0,H) and round outward to whole pixels. Returns null if empty. */
export function clipRect(r: Rect, W: number, H: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w));
  const y1 = Math.min(H, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function expandRect(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

export function shapeBounds(s: Shape, W: number, H: number): Rect {
  switch (s.type) {
    case "circle":
      return { x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r };
    case "rect":
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case "polygon":
    case "stroke": {
      const pad = s.type === "stroke" ? s.r : 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of s.points) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    }
    case "all":
      return { x: 0, y: 0, w: W, h: H };
  }
}

/** A characteristic size of the shape in px (used to scale feathering and noise). */
export function shapeSize(s: Shape, W: number, H: number): number {
  switch (s.type) {
    case "circle": return s.r;
    case "stroke": return s.r;
    case "rect": return Math.min(s.w, s.h) / 2;
    case "polygon": {
      const b = shapeBounds(s, W, H);
      return Math.min(b.w, b.h) / 2;
    }
    case "all": return Math.min(W, H) / 2;
  }
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

export function distToPolyline(px: number, py: number, pts: Point[]): number {
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

export function pointInPolygon(px: number, py: number, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance in px: positive inside the shape, negative outside. */
export function signedDistance(s: Shape, px: number, py: number): number {
  switch (s.type) {
    case "circle":
      return s.r - Math.hypot(px - s.x, py - s.y);
    case "rect": {
      const dx = Math.min(px - s.x, s.x + s.w - px);
      const dy = Math.min(py - s.y, s.y + s.h - py);
      if (dx >= 0 && dy >= 0) return Math.min(dx, dy);
      const ox = Math.max(0, -dx);
      const oy = Math.max(0, -dy);
      return -Math.hypot(ox, oy);
    }
    case "polygon": {
      const closed: Point[] = [...s.points, s.points[0]];
      const d = distToPolyline(px, py, closed);
      return pointInPolygon(px, py, s.points) ? d : -d;
    }
    case "stroke":
      return s.r - distToPolyline(px, py, s.points);
    case "all":
      return 1e9;
  }
}
