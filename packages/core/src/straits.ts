/**
 * Finding the straits of an archipelago: the gaps between the islands of an outer ring. Land is split into islands,
 * the ones far from the middle form the ring, and the narrowest crossing between each neighbouring pair (where
 * their coasts come closest) is a strait. Used to lay razor reefs across them, but it only measures: nothing is changed.
 */
import type { HeightField } from "./doc.ts";

export interface RingIsland {
  /** Position in the ring (0 = the first clockwise from north). */
  index: number;
  areaPx: number;
  areaKm2: number;
  /** Map px. */
  centroid: [number, number];
  /** Compass direction from the middle of the ring. */
  compass: string;
}

export interface Strait {
  /** The two islands either side (indices into `islands`). */
  between: [number, number];
  widthPx: number;
  widthKm: number;
  /** Where the two coasts come closest, and the middle of that line (map px). */
  from: [number, number];
  to: [number, number];
  mid: [number, number];
  /** Compass direction of the strait from the middle of the ring. */
  compass: string;
}

export interface StraitsResult {
  centre: [number, number];
  islands: RingIsland[];
  straits: Strait[];
}

export interface StraitOptions {
  /** The middle of the ring (map px). Default: the middle of all the land. */
  centre?: [number, number];
  /** Ignore islands smaller than this many px² (default 0.15% of the map). */
  minIslandPx?: number;
  /** An island is part of the ring when its middle is at least this fraction of the farthest island's distance from the centre (default 0.55). */
  ringFraction?: number;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compassOf = (dx: number, dy: number): string => COMPASS[(Math.round((Math.atan2(dx, -dy) * 180) / Math.PI / 45) + 8) % 8];

/** The islands of a map and the outer ring they form (shared by the strait and coast finders). */
interface Analysis {
  S: number; w: number; h: number;
  land: Uint8Array; label: Int32Array;
  ring: { area: number; sx: number; sy: number; coast: number[]; id: number }[];
  centre: [number, number];
}

function analyse(height: HeightField, seaLevel: number, opts: StraitOptions): Analysis | null {
  const W = height.w, H = height.h;
  const S = Math.max(1, Math.round(Math.max(W, H) / 1024)), w = Math.ceil(W / S), h = Math.ceil(H / S);
  const land = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) land[y * w + x] = height.data[Math.min(H - 1, y * S) * W + Math.min(W - 1, x * S)] > seaLevel ? 1 : 0;
  // islands: connected pieces of land, with their coast cells
  const label = new Int32Array(w * h).fill(-1);
  interface Comp { id: number; area: number; sx: number; sy: number; coast: number[] }
  const comps: Comp[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!land[i] || label[i] >= 0) continue;
    const id = comps.length, c: Comp = { id, area: 0, sx: 0, sy: 0, coast: [] };
    comps.push(c);
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const k = stack.pop()!, x = k % w, y = (k - x) / w;
      c.area++; c.sx += x; c.sy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !land[k - 1] || !land[k + 1] || !land[k - w] || !land[k + w]) c.coast.push(k);
      if (x > 0 && land[k - 1] && label[k - 1] < 0) { label[k - 1] = id; stack.push(k - 1); }
      if (x < w - 1 && land[k + 1] && label[k + 1] < 0) { label[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && land[k - w] && label[k - w] < 0) { label[k - w] = id; stack.push(k - w); }
      if (y < h - 1 && land[k + w] && label[k + w] < 0) { label[k + w] = id; stack.push(k + w); }
    }
  }
  const minArea = (opts.minIslandPx ?? Math.max(50, 0.0015 * W * H)) / (S * S);
  const big = comps.filter((c) => c.area >= minArea);
  if (big.length < 3) return null;
  const cent = (c: Comp): [number, number] => [(c.sx / c.area) * S, (c.sy / c.area) * S];
  const totalArea = big.reduce((a, c) => a + c.area, 0);
  const centre: [number, number] = opts.centre ?? [big.reduce((a, c) => a + cent(c)[0] * c.area, 0) / totalArea, big.reduce((a, c) => a + cent(c)[1] * c.area, 0) / totalArea];
  const dist = (c: Comp) => Math.hypot(cent(c)[0] - centre[0], cent(c)[1] - centre[1]);
  const far = Math.max(...big.map(dist));
  const bearing = (c: Comp) => ((Math.atan2(cent(c)[0] - centre[0], -(cent(c)[1] - centre[1])) * 180) / Math.PI + 360) % 360;
  // the ring, starting at the first island clockwise from north
  const ring = big.filter((c) => dist(c) >= (opts.ringFraction ?? 0.55) * far).sort((a, b) => bearing(a) - bearing(b));
  return { S, w, h, land, label, ring, centre };
}

export function findStraits(height: HeightField, seaLevel: number, kmPerPx: number, opts: StraitOptions = {}): StraitsResult {
  const an = analyse(height, seaLevel, opts);
  const empty: StraitsResult = { centre: opts.centre ?? [height.w / 2, height.h / 2], islands: [], straits: [] };
  if (!an) return empty;
  const { S, w, ring, centre } = an;
  const cent = (c: { sx: number; sy: number; area: number }): [number, number] => [(c.sx / c.area) * S, (c.sy / c.area) * S];
  const islands: RingIsland[] = ring.map((c, index) => ({
    index, areaPx: c.area * S * S, areaKm2: Math.round(c.area * S * S * kmPerPx * kmPerPx), centroid: [Math.round(cent(c)[0]), Math.round(cent(c)[1])],
    compass: compassOf(cent(c)[0] - centre[0], cent(c)[1] - centre[1]),
  }));
  if (ring.length < 3) return { centre, islands, straits: [] };
  // the closest approach between each pair of neighbours around the ring
  const thin = (cells: number[]) => (cells.length > 3000 ? cells.filter((_, i) => i % Math.ceil(cells.length / 3000) === 0) : cells);
  const straits: Strait[] = [];
  for (let a = 0; a < ring.length; a++) {
    const b = (a + 1) % ring.length;
    let best = Infinity, pa = 0, pb = 0;
    const ca = thin(ring[a].coast), cb = thin(ring[b].coast);
    for (const p of ca) {
      const px = p % w, py = (p - px) / w;
      for (const q of cb) {
        const qx = q % w, qy = (q - qx) / w, d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        if (d < best) { best = d; pa = p; pb = q; }
      }
    }
    const ax = (pa % w) * S, ay = Math.floor(pa / w) * S, bx = (pb % w) * S, by = Math.floor(pb / w) * S, widthPx = Math.sqrt(best) * S;
    const mid: [number, number] = [Math.round((ax + bx) / 2), Math.round((ay + by) / 2)];
    straits.push({
      between: [a, b], widthPx: Math.round(widthPx), widthKm: Math.round(widthPx * kmPerPx), from: [ax, ay], to: [bx, by], mid,
      compass: compassOf(mid[0] - centre[0], mid[1] - centre[1]),
    });
  }
  return { centre: [Math.round(centre[0]), Math.round(centre[1])], islands, straits };
}

export interface CoastOptions extends StraitOptions {
  /** Areas to leave clear (map px): a polygon, or a circle. The coast inside them gets no reef. */
  clear?: ({ polygon: [number, number][] } | { circle: [number, number, number] })[];
  /** How far to the seaward side of the shore the reef line sits (map px, default 2). */
  offsetPx?: number;
  /** Drop pieces shorter than this (map px, default 14). */
  minLengthPx?: number;
}

/** A stretch of coast: a polyline in map px, and the ring island it belongs to. */
export interface CoastPiece {
  island: number;
  points: [number, number][];
  lengthPx: number;
}

const inPoly = (x: number, y: number, poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
  }
  return inside;
};

/** Douglas-Peucker. */
function simplifyLine(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  let idx = -1, dmax = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = l2 ? Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2)) : 0;
    const d = Math.hypot(pts[i][0] - (ax + dx * t), pts[i][1] - (ay + dy * t));
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplifyLine(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(idx), tol)];
}

/**
 * The outer coasts of the ring islands: the shores that face the open ocean outside the ring (not the inner sea),
 * minus any cleared areas, as polylines a little way out to sea. The straits are treated as closed, so the water
 * inside the ring is not "outside". Measures only.
 */
export function findOuterCoasts(height: HeightField, seaLevel: number, kmPerPx: number, opts: CoastOptions = {}): CoastPiece[] {
  const an = analyse(height, seaLevel, opts);
  if (!an || an.ring.length < 3) return [];
  const { S, w, h, land, label, ring } = an;
  const straits = findStraits(height, seaLevel, kmPerPx, opts).straits;
  // close the straits with their shortest lines, then flood the open ocean in from the map's edge
  const closed = new Uint8Array(w * h);
  for (const st of straits) {
    const n = Math.ceil(Math.hypot(st.to[0] - st.from[0], st.to[1] - st.from[1]) / S) * 2 + 2;
    for (let k = 0; k <= n; k++) {
      const cx = Math.round((st.from[0] + ((st.to[0] - st.from[0]) * k) / n) / S), cy = Math.round((st.from[1] + ((st.to[1] - st.from[1]) * k) / n) / S);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < w && y < h) closed[y * w + x] = 1; }
    }
  }
  const outer = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (x: number, y: number) => { const i = y * w + x; if (!land[i] && !closed[i] && !outer[i]) { outer[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const k = stack.pop()!, x = k % w, y = (k - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  const ringId = new Map(ring.map((c, i) => [c.id, i] as const));
  const clear = opts.clear ?? [];
  const cleared = (x: number, y: number) => clear.some((c) => ("polygon" in c ? inPoly(x, y, c.polygon) : Math.hypot(x - c.circle[0], y - c.circle[1]) <= c.circle[2]));
  const offset = (opts.offsetPx ?? 2) / S, minLen = opts.minLengthPx ?? 14;
  const isOuterCoast = (i: number) => {
    if (!land[i] || !ringId.has(label[i])) return false;
    const x = i % w, y = (i - x) / w;
    return (x > 0 && outer[i - 1]) || (x < w - 1 && outer[i + 1]) || (y > 0 && outer[i - w]) || (y < h - 1 && outer[i + w]) || x === 0 || y === 0 || x === w - 1 || y === h - 1;
  };
  // the coast cells of each island, kept unless cleared, then chained into runs by walking neighbours
  const pieces: CoastPiece[] = [];
  for (const c of ring) {
    const cells = c.coast.filter((i) => isOuterCoast(i) && !cleared((i % w) * S, Math.floor(i / w) * S));
    const set = new Set(cells), remaining = new Set(cells);
    // neighbours in the set, straight ones first so a chain follows the shore rather than cutting corners
    const near = (i: number, only?: Set<number>) => {
      const x = i % w, y = (i - x) / w, out: number[] = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if ((only ?? set).has(j)) out.push(j);
      }
      return out;
    };
    while (remaining.size) {
      // start at the end of a run if there is one (a cell with at most one neighbour), else anywhere
      let start = -1;
      for (const i of remaining) { if (start < 0) start = i; if (near(i).length <= 1) { start = i; break; } }
      remaining.delete(start);
      const chain: number[] = [start];
      for (let cur = start; ;) { const nx = near(cur, remaining)[0]; if (nx === undefined) break; chain.push(nx); remaining.delete(nx); cur = nx; }
      for (let cur = start; ;) { const nx = near(cur, remaining)[0]; if (nx === undefined) break; chain.unshift(nx); remaining.delete(nx); cur = nx; }
      if (chain.length < 3) continue;
      let pts = chain.map((i) => [(i % w) * S, Math.floor(i / w) * S] as [number, number]);
      pts = simplifyLine(pts, 1.4 * S);
      // move each point out to sea: the side of the line where the open ocean is
      if (offset > 0) {
        pts = pts.map((p, k) => {
          const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
          const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
          const water = (sx: number) => { const gx = Math.round((p[0] + nx * sx * S * 1.6) / S), gy = Math.round((p[1] + ny * sx * S * 1.6) / S); return gx >= 0 && gy >= 0 && gx < w && gy < h && outer[gy * w + gx] ? 1 : 0; };
          const side = water(1) >= water(-1) ? 1 : -1;
          return [p[0] + nx * side * offset * S, p[1] + ny * side * offset * S] as [number, number];
        });
      }
      const lengthPx = pts.reduce((acc, p, k) => (k ? acc + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0);
      if (lengthPx >= minLen) pieces.push({ island: ringId.get(c.id)!, points: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]), lengthPx: Math.round(lengthPx) });
    }
  }
  return pieces;
}
