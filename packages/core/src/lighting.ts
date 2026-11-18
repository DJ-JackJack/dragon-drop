/**
 * What a light can see: walls and closed doors block it, windows, open doors and invisible walls don't.
 * The result is a "visibility" around the light: for every direction, how far the light travels before hitting something.
 */
import { type MapLight, type MapWall, wallSegments } from "./features.ts";

export function blocksLight(w: MapWall): boolean {
  return w.kind === "wall" || ((w.kind === "door" || w.kind === "secret") && !w.open);
}

type Seg = [number, number, number, number];

/** Rays around a light, sorted by angle: the distance each travels (up to `max`) and the nearest segment it points at (-1: none), even one beyond `max`. */
export interface Visibility {
  x: number;
  y: number;
  max: number;
  ang: Float64Array;
  dist: Float64Array;
  seg: Int32Array;
  segs: Seg[];
}

export function blockingSegments(walls: MapWall[] | undefined): Seg[] {
  const out: Seg[] = [];
  for (const w of walls ?? []) if (blocksLight(w)) for (const [a, b] of wallSegments(w)) out.push([a[0], a[1], b[0], b[1]]);
  return out;
}

/** Distance along the ray (cos, sin) from (ox, oy) to the segment, or Infinity. */
function rayHit(ox: number, oy: number, dx: number, dy: number, s: Seg): number {
  const sx = s[2] - s[0], sy = s[3] - s[1];
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((s[0] - ox) * sy - (s[1] - oy) * sx) / den;
  const u = ((s[0] - ox) * dy - (s[1] - oy) * dx) / den;
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

/** Visibility from (x, y) out to `max` squares. `segments` are the light-blocking wall pieces (see blockingSegments). */
export function visibilityFrom(x: number, y: number, max: number, segments: Seg[]): Visibility {
  // only walls that could matter
  const near = segments.filter((s) => Math.min(s[0], s[2]) <= x + max && Math.max(s[0], s[2]) >= x - max && Math.min(s[1], s[3]) <= y + max && Math.max(s[1], s[3]) >= y - max);
  const angles: number[] = [];
  const eps = 1e-4;
  for (const s of near) {
    for (const [px, py] of [[s[0], s[1]], [s[2], s[3]]]) {
      const a = Math.atan2(py - y, px - x);
      angles.push(a - eps, a, a + eps);
    }
  }
  for (let k = 0; k < 24; k++) angles.push(-Math.PI + (k / 24) * 2 * Math.PI); // so the open parts of the circle are smooth
  const wrap = (a: number) => { while (a <= -Math.PI) a += 2 * Math.PI; while (a > Math.PI) a -= 2 * Math.PI; return a; };
  const sorted = [...new Set(angles.map(wrap))].sort((a, b) => a - b);
  const ang = new Float64Array(sorted.length), dist = new Float64Array(sorted.length), seg = new Int32Array(sorted.length);
  sorted.forEach((a, i) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    // the nearest wall even when it is beyond the light's reach: neighbouring rays that hit the same wall are then
    // exact between them (otherwise a long wall just out of range looked like "nothing" and shadows collapsed)
    let best = Infinity, hit = -1;
    for (let k = 0; k < near.length; k++) { const t = rayHit(x, y, dx, dy, near[k]); if (t < best) { best = t; hit = k; } }
    ang[i] = a; dist[i] = Math.min(best, max); seg[i] = hit;
  });
  return { x, y, max, ang, dist, seg, segs: near };
}

export function lightVisibility(l: MapLight, walls: MapWall[] | undefined): Visibility {
  return visibilityFrom(l.x, l.y, l.radius, l.shadows === false ? [] : blockingSegments(walls));
}

/** How far the light reaches in direction `a` (radians). */
export function visibleDistance(v: Visibility, a: number): number {
  const n = v.ang.length;
  if (!n) return v.max;
  let lo = 0, hi = n; // first ray with angle > a
  while (lo < hi) { const m = (lo + hi) >> 1; if (v.ang[m] > a) hi = m; else lo = m + 1; }
  const i = (lo - 1 + n) % n, j = lo % n;
  if (v.seg[i] >= 0 && v.seg[i] === v.seg[j]) {
    const t = rayHit(v.x, v.y, Math.cos(a), Math.sin(a), v.segs[v.seg[i]]);
    if (t < Infinity) return Math.min(v.max, t);
  }
  return Math.min(v.dist[i], v.dist[j]);
}

/** The lit area as a polygon (squares), for drawing. It reaches a little beyond the light's radius, so clip to the circle. */
export function visibilityPolygon(v: Visibility): [number, number][] {
  const pts: [number, number][] = [];
  const far = v.max * 1.25;
  for (let i = 0; i < v.ang.length; i++) {
    const d = v.seg[i] >= 0 && v.dist[i] < v.max - 1e-9 ? v.dist[i] : far;
    pts.push([v.x + Math.cos(v.ang[i]) * d, v.y + Math.sin(v.ang[i]) * d]);
  }
  return pts;
}
