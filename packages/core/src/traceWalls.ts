/**
 * Walls around painted floor: the outline between floor and empty (void) cells, found with marching squares,
 * simplified into straight pieces, with the rounded corners of the cell grid put back to sharp ones.
 * Works for anything you can paint: rooms, caves, corridors, islands with holes.
 */
import { battleSpec } from "./battle.ts";
import type { MapDoc } from "./doc.ts";
import type { MapWall } from "./features.ts";

type Pt = [number, number];

export interface TraceOptions {
  /** Only keep outline pieces whose middle is inside this rectangle (squares). */
  region?: { x: number; y: number; w: number; h: number };
  /** Drop outlines shorter than this many squares around (default 2). */
  minPerimeter?: number;
  /** How closely the straight pieces follow the outline, in squares (default 0.06). */
  tolerance?: number;
}

/** Closed outlines (each an array of points in squares, without repeating the first point). */
export function traceFloorOutlines(doc: MapDoc, opts: TraceOptions = {}): Pt[][] {
  const spec = battleSpec(doc);
  const { w: CW, h: CH, data } = doc.height;
  const sub = spec.sub;
  // lattice of cell centres, with a void border so outlines close at the map edge
  const W = CW + 2, H = CH + 2;
  const f = new Float32Array(W * H);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) f[(y + 1) * W + x + 1] = data[y * CW + x] !== 0 ? 1 : 0;
  // a light smoothing (1-2-1 in each direction) takes the stair steps out of diagonal edges; straight edges stay where they are
  const g = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let acc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) acc += f[(y + dy) * W + x + dx] * (dx ? 1 : 2) * (dy ? 1 : 2);
    g[y * W + x] = acc / 16;
  }
  f.set(g);
  // marching squares at 0.5 over the lattice; vertices sit on lattice edges (identified by an integer)
  const hEdge = (x: number, y: number) => (y * W + x) * 2;      // between (x,y) and (x+1,y)
  const vEdge = (x: number, y: number) => (y * W + x) * 2 + 1;  // between (x,y) and (x,y+1)
  const point = (id: number): Pt => {
    const vertical = id & 1, k = id >> 1, x = k % W, y = (k / W) | 0;
    // the centre of lattice point (x, y) is at cell coordinates (x - 0.5, y - 0.5); the outline crosses the edge where the value passes 0.5
    const v0 = f[y * W + x], v1 = vertical ? f[(y + 1) * W + x] : f[y * W + x + 1];
    const t = v1 === v0 ? 0.5 : Math.min(1, Math.max(0, (0.5 - v0) / (v1 - v0)));
    return vertical ? [x - 0.5, y - 0.5 + t] : [x - 0.5 + t, y - 0.5];
  };
  const next = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    (next.get(b) ?? next.set(b, []).get(b)!).push(a);
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = f[y * W + x], b = f[y * W + x + 1], c = f[(y + 1) * W + x + 1], d = f[(y + 1) * W + x];
      const code = (a > 0.5 ? 1 : 0) | (b > 0.5 ? 2 : 0) | (c > 0.5 ? 4 : 0) | (d > 0.5 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = hEdge(x, y), right = vEdge(x + 1, y), bottom = hEdge(x, y + 1), left = vEdge(x, y);
      switch (code) {
        case 1: case 14: link(left, top); break;
        case 2: case 13: link(top, right); break;
        case 4: case 11: link(right, bottom); break;
        case 8: case 7: link(bottom, left); break;
        case 3: case 12: link(left, right); break;
        case 6: case 9: link(top, bottom); break;
        case 5: link(left, top); link(right, bottom); break;   // saddle: keep the two floor corners apart
        case 10: link(top, right); link(bottom, left); break;
      }
    }
  }
  // follow the links into closed loops (every contour vertex has exactly two neighbours)
  const seen = new Set<number>();
  const loops: Pt[][] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ids: number[] = [];
    let prev = -1, cur = start;
    for (let guard = 0; guard < 8_000_000; guard++) {
      seen.add(cur);
      ids.push(cur);
      const nb = next.get(cur)!;
      const n = nb[0] === prev ? (nb[1] ?? nb[0]) : nb[0];
      prev = cur;
      cur = n;
      if (cur === start) break;
    }
    // the points are already in cell units, where a cell spans [i, i + 1]
    if (ids.length >= 4) loops.push(ids.map((id) => { const p = point(id); return [p[0] / sub, p[1] / sub] as Pt; }));
  }
  const tol = opts.tolerance ?? 0.06, minPer = opts.minPerimeter ?? 2;
  const out: Pt[][] = [];
  for (const loop of loops) {
    let simp = simplifyClosed(loop, tol);
    simp = squareCorners(simp, 0.3);
    simp = dropCollinear(simp, 0.01);
    simp = snapAxes(simp, 1 / sub);
    if (simp.length < 3 || perimeter(simp) < minPer) continue;
    if (opts.region) {
      const r = opts.region, m = simp[Math.floor(simp.length / 2)];
      if (m[0] < r.x || m[1] < r.y || m[0] > r.x + r.w || m[1] > r.y + r.h) continue;
    }
    out.push(simp);
  }
  return out;
}

/** Walls (one closed wall per outline). */
export function wallsAroundFloor(doc: MapDoc, newId: () => string, opts: TraceOptions = {}): MapWall[] {
  return traceFloorOutlines(doc, opts).map((pts) => ({ id: newId(), kind: "wall" as const, points: pts, closed: true, auto: true }));
}

// ---------------------------------------------------------------- geometry
const perimeter = (p: Pt[]) => p.reduce((n, q, i) => n + Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]), 0);

function perpDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  if (l === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / l;
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = eps;
    for (let i = a + 1; i < b; i++) { const d = perpDist(pts[i], pts[a], pts[b]); if (d > wd) { wd = d; worst = i; } }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed loop: split it at its two farthest-apart points and simplify each half. */
function simplifyClosed(loop: Pt[], eps: number): Pt[] {
  if (loop.length < 4) return loop;
  let ia = 0, ib = 0, best = -1;
  const step = Math.max(1, Math.floor(loop.length / 64));
  for (let i = 0; i < loop.length; i += step) for (let j = i + 1; j < loop.length; j += step) {
    const d = Math.hypot(loop[i][0] - loop[j][0], loop[i][1] - loop[j][1]);
    if (d > best) { best = d; ia = i; ib = j; }
  }
  if (ia > ib) [ia, ib] = [ib, ia];
  const first = loop.slice(ia, ib + 1), second = [...loop.slice(ib), ...loop.slice(0, ia + 1)];
  const a = rdp(first, eps), b = rdp(second, eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/**
 * The grid (and the smoothing) round a corner off into a few tiny edges: wherever a run of short edges sits between two
 * long sides, put the sharp corner back at the point where those sides meet.
 */
function squareCorners(p: Pt[], shortLen: number): Pt[] {
  const n = p.length;
  if (n < 4) return p;
  const edge = (pts: Pt[], i: number) => Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
  const first = p.findIndex((_, i) => edge(p, i) >= shortLen);
  if (first < 0) return p;
  const q = [...p.slice(first), ...p.slice(0, first)]; // starts with a long edge, so no run of short edges wraps around the start
  const L = q.map((_, i) => edge(q, i));
  const replace = new Map<number, Pt | null>();
  let i = 0;
  while (i < n) {
    if (L[i] >= shortLen) { i++; continue; }
    let b = i;
    while (b + 1 < n && L[b + 1] < shortLen) b++;
    // short edges i..b join vertices i..b+1; the long sides are the edge before i and the edge after b
    const x = intersect(q[(i + n - 1) % n], q[i], q[(b + 1) % n], q[(b + 2) % n]);
    const mid: Pt = [(q[i][0] + q[(b + 1) % n][0]) / 2, (q[i][1] + q[(b + 1) % n][1]) / 2];
    if (x && Math.hypot(x[0] - mid[0], x[1] - mid[1]) < shortLen * 1.6) {
      for (let v = i; v <= b + 1; v++) replace.set(v % n, null);
      replace.set(i, x);
    }
    i = b + 1;
  }
  const out: Pt[] = [];
  q.forEach((pt, v) => { const r = replace.has(v) ? replace.get(v)! : pt; if (r) out.push(r); });
  return out;
}

/**
 * Sides that are (nearly) horizontal or vertical belong on a cell line, because painted edges always fall on cell lines:
 * snap both ends of such a side onto it, which gives rectangular rooms exact corners.
 */
function snapAxes(p: Pt[], cell: number): Pt[] {
  const n = p.length;
  const q = p.map((pt) => [pt[0], pt[1]] as Pt);
  const snap = (v: number) => Math.round(v / cell) * cell;
  for (let i = 0; i < n; i++) {
    const a = q[i], b = q[(i + 1) % n];
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    if (dx < 0.09 && dy > 0.4) { const x = snap((a[0] + b[0]) / 2); if (Math.abs(x - (a[0] + b[0]) / 2) < 0.06) { a[0] = x; b[0] = x; } }
    else if (dy < 0.09 && dx > 0.4) { const y = snap((a[1] + b[1]) / 2); if (Math.abs(y - (a[1] + b[1]) / 2) < 0.06) { a[1] = y; b[1] = y; } }
  }
  return q;
}

function intersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]], s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

function dropCollinear(p: Pt[], eps: number): Pt[] {
  let pts = p.slice(), changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (perpDist(b, a, c) < eps || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}

/** A closed polygon approximating a circle (squares). */
export function circlePolygon(cx: number, cy: number, r: number, segments?: number): Pt[] {
  const n = segments ?? Math.max(16, Math.min(72, Math.round(r * 6)));
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)] as Pt);
}
