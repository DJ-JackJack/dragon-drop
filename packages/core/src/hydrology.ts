/**
 * Hydrology derived from the heightmap: depression filling, D8 flow, flow accumulation,
 * river polylines and lakes. Rivers always run downhill to the sea and only merge.
 *
 * How much water a river carries is the runoff of the land that drains into it (wetter, cooler ground sheds more; a desert's rain mostly never
 * reaches a river), plus any river sources (a great spring or waterfall that feeds a river from beyond what the map shows).
 */
import { dilate, erode, removeSmall } from "./fields.ts";
import { Simplex2D, smoothstep } from "./noise.ts";
import { type Rect, type Shape, clipRect, expandRect, shapeBounds, shapeSize, signedDistance } from "./geom.ts";

const D8X = [-1, 0, 1, -1, 1, -1, 0, 1];
const D8Y = [-1, -1, -1, 0, 0, 1, 1, 1];
const D8L = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

/** Min-heap of (key, value) on typed arrays. */
class Heap {
  keys: Float64Array;
  vals: Int32Array;
  n = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number) {
    let i = this.n++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p];
      i = p;
    }
    K[i] = k; V[i] = v;
  }
  pop(): number {
    const K = this.keys, V = this.vals;
    const top = V[0];
    const k = K[--this.n], v = V[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c]; V[i] = V[c];
      i = c;
    }
    K[i] = k; V[i] = v;
    return top;
  }
}

export interface FlowField {
  W: number;
  H: number;
  /** Depression-filled surface (m). */
  filled: Float32Array;
  /** Index of the downstream neighbour, or -1 for outlets/sea. */
  receiver: Int32Array;
  /** Upstream runoff, in units of one average cell of rain (land only; with no runoff given, simply the upstream area in cells). */
  acc: Float32Array;
  landCells: number;
  /** The runoff of the whole map's land (the sum of the weights; without weights, the number of land cells). Sources are not part of it. */
  runoffTotal: number;
}

/** Extra flow added at a point: a source feeding a river from beyond what the map shows (a great spring, a waterfall's upstream basin). */
export interface RiverInflow {
  /** Map px. */
  x: number;
  y: number;
  /** The share of the whole map's runoff it adds (0.03 is about the size of the biggest ordinary rivers). */
  share: number;
}

/** Priority-flood (Barnes et al.) + steepest-descent receivers + accumulation. */
export function computeFlow(h: Float32Array, W: number, H: number, seaLevel: number, weights?: Float32Array, inflow?: Map<number, number>): FlowField {
  const N = W * H;
  const filled = new Float32Array(h);
  const closed = new Uint8Array(N);
  const order = new Int32Array(N);
  let nOrder = 0;
  const heap = new Heap(N);
  let landCells = 0;
  for (let i = 0; i < N; i++) {
    if (h[i] <= seaLevel) { closed[i] = 1; continue; }
    landCells++;
    const x = i % W, y = (i / W) | 0;
    let seed = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    for (let k = 0; k < 8 && !seed; k++) {
      const nx = x + D8X[k], ny = y + D8Y[k];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && h[ny * W + nx] <= seaLevel) seed = true;
    }
    if (seed) { closed[i] = 1; heap.push(filled[i], i); }
  }
  const EPS = 0.02;
  while (heap.n) {
    const c = heap.pop();
    order[nOrder++] = c;
    const cx = c % W, cy = (c / W) | 0, fc = filled[c];
    for (let k = 0; k < 8; k++) {
      const nx = cx + D8X[k], ny = cy + D8Y[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (closed[n]) continue;
      closed[n] = 1;
      if (filled[n] <= fc) filled[n] = fc + EPS;
      heap.push(filled[n], n);
    }
  }

  const receiver = new Int32Array(N).fill(-1);
  for (let t = 0; t < nOrder; t++) {
    const i = order[t];
    const x = i % W, y = (i / W) | 0;
    let best = 0, bestJ = -1;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8X[k], ny = y + D8Y[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const drop = (filled[i] - (h[j] <= seaLevel ? Math.min(h[j], seaLevel) : filled[j])) / D8L[k];
      if (drop > best) { best = drop; bestJ = j; }
    }
    receiver[i] = bestJ;
  }

  const acc = new Float32Array(N);
  let runoffTotal = 0;
  for (let t = 0; t < nOrder; t++) { const w = weights ? weights[order[t]] : 1; acc[order[t]] = w; runoffTotal += w; }
  if (inflow) for (const [c, extra] of inflow) if (h[c] > seaLevel) acc[c] += extra;
  for (let t = nOrder - 1; t >= 0; t--) {
    const i = order[t];
    const j = receiver[i];
    if (j >= 0 && h[j] > seaLevel) acc[j] += acc[i];
  }
  return { W, H, filled, receiver, acc, landCells, runoffTotal };
}

export interface RiverPath {
  /** Flat [x0, y0, x1, y1, ...] in map px (cell centres, smoothed). */
  pts: number[];
  /** Width in map px at each point. */
  widths: number[];
  /** Why the tracing stopped: it reached the sea, a lake, a river already traced (its last point is on that one), or the map's edge. Missing on rivers made elsewhere. */
  end?: "sea" | "lake" | "join" | "edge";
}

export interface Hydrology {
  /** The flow the rivers were traced on (receivers, accumulation, the filled surface). */
  flow: FlowField;
  rivers: RiverPath[];
  /** 1 = lake cell. */
  lakes: Uint8Array;
  riverThreshold: number;
  /** Lowland rivers only: oxbow lakes (1 = water), cut-off loops beside the big rivers on flat ground. Painted as lakes; not lakes for the water's account. */
  oxbows?: Uint8Array;
}

export interface HydrologyOptions {
  /** 0..1 more = more, smaller rivers (default 0.5). */
  riverDensity?: number;
  /** Minimum depression depth (m) that holds a lake. */
  lakeMinDepthM?: number;
  /**
   * Regional maps: lakes are only allowed where this mask (full size) is set, so a hollow the
   * parent map doesn't show as a lake isn't invented as one when zoomed in.
   */
  lakeMask?: Uint8Array;
  seed?: number;
  /**
   * How much water each land cell sheds (see runoffOf in climate.ts). Without it every cell counts the same, and a river's size is just the
   * area that drains into it.
   */
  runoff?: Float32Array;
  /** River sources: extra flow at a point. */
  inflows?: RiverInflow[];
  /**
   * Lowland rivers (water model stage 4, a map's choice, off by default so existing maps keep their rivers): big rivers on flat ground wander in wide meanders, with
   * oxbow lakes beside them, and widen into an estuary where they meet the sea.
   */
  lowland?: boolean;
}

export function computeHydrology(h: Float32Array, W: number, H: number, seaLevel: number, opts: HydrologyOptions = {}, flow?: FlowField): Hydrology {
  const N = W * H;
  let f = flow;
  if (!f) {
    // sources: extra flow at the land cell nearest each point (a source on the sea is ignored)
    let inflow: Map<number, number> | undefined;
    if (opts.inflows?.length) {
      const total = opts.runoff ? opts.runoff.reduce((s, v, i) => s + (h[i] > seaLevel ? v : 0), 0) : h.reduce((s, v) => s + (v > seaLevel ? 1 : 0), 0);
      inflow = new Map();
      for (const s of opts.inflows) {
        const c = landCellNear(h, W, H, seaLevel, s.x, s.y);
        if (c >= 0) inflow.set(c, (inflow.get(c) ?? 0) + Math.max(0, s.share) * total);
      }
    }
    f = computeFlow(h, W, H, seaLevel, opts.runoff, inflow);
  }
  const scale = (W * H) / (1024 * 1024);
  const density = Math.min(1, Math.max(0, opts.riverDensity ?? 0.5));
  // a river must carry a given share of the map's runoff (as before, a given share of its land), and at least 25 average cells' worth
  const meanRunoff = f.runoffTotal / Math.max(1, f.landCells);
  const thr = Math.max(25 * meanRunoff, f.runoffTotal * (0.0035 - 0.003 * density));

  // --- lakes: deep enough depressions, opened (no slivers), not tiny
  let lakes: Uint8Array = new Uint8Array(N);
  const minDepth = opts.lakeMinDepthM ?? 45;
  for (let i = 0; i < N; i++) if (h[i] > seaLevel && f.filled[i] - h[i] > minDepth) lakes[i] = 1;
  const it = Math.max(1, Math.round(3 * Math.sqrt(scale)));
  lakes = dilate(erode(lakes, W, H, it), W, H, it);
  lakes = removeSmall(lakes, W, H, Math.max(8, Math.round(60 * scale)));
  if (opts.lakeMask) for (let i = 0; i < N; i++) if (!opts.lakeMask[i]) lakes[i] = 0;

  // --- rivers: trace from heads down to a junction / the sea / a lake
  const isRiver = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (f.acc[i] >= thr && h[i] > seaLevel) isRiver[i] = 1;
  const donors = new Uint8Array(N);
  // lake cells don't count as donors: the river that leaves a lake starts afresh at its outlet (it used to be missing)
  for (let i = 0; i < N; i++) if (isRiver[i] && !lakes[i] && f.receiver[i] >= 0) donors[f.receiver[i]]++;
  const heads: number[] = [];
  for (let i = 0; i < N; i++) if (isRiver[i] && !lakes[i] && donors[i] === 0) heads.push(i);
  heads.sort((a, b) => f.acc[b] - f.acc[a]);
  const visited = new Uint8Array(N);
  const meander = new Simplex2D(opts.seed ?? 17);
  const rivers: RiverPath[] = [];
  const lowland = !!opts.lowland;
  const oxbows = lowland ? new Uint8Array(N) : undefined;
  for (const head of heads) {
    const cells: number[] = [];
    let c = head, atSea = false, end: RiverPath["end"] = "edge";
    for (;;) {
      cells.push(c);
      if (visited[c]) { end = "join"; break; }
      visited[c] = 1;
      const nx = f.receiver[c];
      if (nx < 0 || h[nx] <= seaLevel) { if (nx >= 0) { cells.push(nx); atSea = true; end = "sea"; } break; }
      if (lakes[nx]) { cells.push(nx); end = "lake"; break; }
      c = nx;
    }
    if (cells.length < 3) continue;
    const river: RiverPath = { ...smoothRiver(cells, W, f.acc, thr, meander, h, donors, lowland, atSea), end };
    rivers.push(river);
    if (oxbows) addOxbows(oxbows, river, cells, W, H, h, seaLevel, f.acc, thr, lakes, meander);
  }
  // (an oxbow never sits on a river's own line)
  if (oxbows) for (const r of rivers) for (let k = 0; k < r.pts.length; k += 2) { const x = Math.floor(r.pts[k]), y = Math.floor(r.pts[k + 1]); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) oxbows[Y * W + X] = 0; } }
  return { flow: f, rivers, lakes, riverThreshold: thr, ...(oxbows && { oxbows }) };
}

/**
 * Oxbow lakes beside a lowland river: on its flat stretches (dropping under a third of a metre a cell) where it is big (eight times the smallest river or more), now and then a
 * crescent of water off to one side, as a loop the river has cut off would leave. Only on land, never in a lake or the sea.
 */
function addOxbows(out: Uint8Array, r: RiverPath, cells: number[], W: number, H: number, h: Float32Array, sea: number, acc: Float32Array, thr: number, lakes: Uint8Array, noise: Simplex2D) {
  const p = r.pts, n = p.length / 2;
  if (n < 12) return;
  let gap = 0, side = 1;
  for (let k = 6; k < n - 6; k++) {
    gap += Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]); // (map px along the river since the last one)
    // the cell under this point, and how steep and big the river is there
    const c = Math.floor(p[k * 2 + 1]) * W + Math.floor(p[k * 2]);
    const ci = Math.min(cells.length - 1, Math.round((k / n) * cells.length)), ca = Math.max(0, ci - 3), cb = Math.min(cells.length - 1, ci + 3);
    const drop = Math.max(0, (h[cells[ca]] - h[cells[cb]]) / Math.max(1, cb - ca));
    if (drop > 0.35 || acc[cells[ci]] < thr * 8 || h[c] <= sea) continue;
    const every = 45 + 40 * (noise.noise(p[k * 2] / 13 + 7, p[k * 2 + 1] / 13) + 1);
    if (gap < every) continue;
    gap = 0; side = -side;
    const tx = p[k * 2 + 2] - p[k * 2 - 2], ty = p[k * 2 + 3] - p[k * 2 - 1], tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
    const w = r.widths[k], rad = 1.6 + 1.4 * Math.min(1.5, w), off = rad + 1.2 + w;
    const cx = p[k * 2] + nx * off * side, cy = p[k * 2 + 1] + ny * off * side;
    // a crescent: a ring two-thirds round, opening toward the river, about one cell thick
    const facing = Math.atan2(-ny * side, -nx * side);
    for (let y = Math.floor(cy - rad - 2); y <= Math.ceil(cy + rad + 2); y++) for (let x = Math.floor(cx - rad - 2); x <= Math.ceil(cx + rad + 2); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      if (Math.abs(d - rad) > 0.75) continue;
      let a = Math.atan2(dy, dx) - facing;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) < Math.PI * 0.33) continue; // (the open side, toward the river)
      const i = y * W + x;
      if (h[i] > sea && !lakes[i]) out[i] = 1;
    }
  }
}

/** The land cell closest to (x, y) within a few cells, or -1. */
export function landCellNear(h: Float32Array, W: number, H: number, sea: number, x: number, y: number, radius = 3): number {
  const cx = Math.round(x), cy = Math.round(y);
  let best = -1, bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || h[ny * W + nx] <= sea) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = ny * W + nx; }
  }
  return best;
}

/**
 * A river's path, smoothed and made to wander. How much it wanders follows how steeply it drops: a river on a steep slope runs nearly straight,
 * one on flat ground meanders. Where a tributary joins (cells with several donors) the wander dies away, so the two still meet exactly.
 */
function smoothRiver(cells: number[], W: number, acc: Float32Array, thr: number, noise: Simplex2D, h: Float32Array, donors: Uint8Array, lowland = false, atSea = false): RiverPath {
  // Flow never decreases downstream (the outlet cell itself - sea or lake - carries no accumulation).
  let run = 0;
  let pts: [number, number, number][] = cells.map((i) => {
    run = Math.max(run, acc[i]);
    return [(i % W) + 0.5, ((i / W) | 0) + 0.5, run];
  });
  // meander: push points sideways along the local normal (ends stay put)
  if (pts.length > 3) {
    const n = pts.length;
    // how many cells from each point to the nearest junction (a cell that several rivers drain into)
    const near = new Float32Array(n).fill(99);
    for (let k = 0; k < n; k++) if (donors[cells[k]] >= 2) near[k] = 0;
    for (let k = 1; k < n; k++) near[k] = Math.min(near[k], near[k - 1] + 1);
    for (let k = n - 2; k >= 0; k--) near[k] = Math.min(near[k], near[k + 1] + 1);
    const out: [number, number, number][] = [pts[0]];
    for (let k = 1; k < n - 1; k++) {
      const [x, y, a] = pts[k];
      const dx = pts[k + 1][0] - pts[k - 1][0], dy = pts[k + 1][1] - pts[k - 1][1];
      const len = Math.hypot(dx, dy) || 1;
      // metres dropped per cell over the next few cells either side
      const ka = Math.max(0, k - 3), kb = Math.min(n - 1, k + 3);
      const run = Math.hypot(pts[kb][0] - pts[ka][0], pts[kb][1] - pts[ka][1]) || 1;
      const drop = Math.max(0, (h[cells[ka]] - h[cells[kb]]) / run);
      let amp = 0.3 + 1.25 * (1 - smoothstep(1, 6, drop));
      // lowland rivers: a big river on flat ground swings in wide, slow loops (the bigger, the wider)
      const big = lowland ? Math.min(1.3, Math.max(0, Math.log2(Math.max(a, thr) / thr) / 3)) : 0;
      if (lowland) amp += 2.4 * big * (1 - smoothstep(0.3, 2.5, drop));
      const taper = smoothstep(0, 4, near[k]);
      const f = lowland && big > 0.3 ? 11 : 7;
      const off = (noise.noise(x / f, y / f) + 0.35 * noise.noise(x / 3 + 91, y / 3)) * amp * taper;
      out.push([x - (dy / len) * off, y + (dx / len) * off, a]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  for (let iter = 0; iter < 3 && pts.length > 2; iter++) {
    const next: [number, number, number][] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  const flat: number[] = [];
  const widths: number[] = [];
  const n = pts.length;
  pts.forEach(([x, y, a], k) => {
    flat.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
    let w = 0.45 + Math.log2(Math.max(a, thr) / thr) * 0.32;
    // a lowland river that reaches the sea widens into an estuary over its last stretch
    if (lowland && atSea && w >= 0.8) w *= 1 + 2.2 * smoothstep(0.82, 1, k / Math.max(1, n - 1));
    widths.push(Math.round(w * 100) / 100);
  });
  return { pts: flat, widths };
}

export interface ErodeParams {
  /** 0..1 how hard to erode per pass (default 0.5). */
  strength?: number;
  /** Number of erosion passes (default 4). */
  passes?: number;
  /** Only inside this area (with a soft edge inside it): nothing outside it changes. */
  area?: Shape;
  /** Land higher than this (metres above the sea) keeps its height: a named peak stays as tall as it was. */
  keepAboveM?: number;
}

/**
 * Erode (see erodeTerrain), held to an area and keeping the heights above `keepAboveM`: the whole map is eroded (water needs the whole map to know where it runs), then
 * everything outside the area, and the land above the kept height, is put back (blending across a soft edge). Returns the box that may have changed.
 */
export function erodeTerrainWithin(h: Float32Array, W: number, H: number, seaLevel: number, p: ErodeParams): Rect {
  if (!p.area && p.keepAboveM === undefined) { erodeTerrain(h, W, H, seaLevel, p); return { x: 0, y: 0, w: W, h: H }; }
  const pre = h.slice();
  erodeTerrain(h, W, H, seaLevel, p);
  const box = p.area ? clipRect(expandRect(shapeBounds(p.area, W, H), 1), W, H) : { x: 0, y: 0, w: W, h: H };
  const feather = p.area ? Math.max(2, Math.min(40, shapeSize(p.area, W, H) * 0.1)) : 0, keep = p.keepAboveM;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (h[i] === pre[i]) continue;
    let w = 1;
    if (p.area) {
      const inBox = box && x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h;
      w = inBox ? smoothstep(0, feather, signedDistance(p.area, x + 0.5, y + 0.5)) : 0;
    }
    if (keep !== undefined && w > 0) w *= 1 - smoothstep(keep - 150, keep, pre[i] - seaLevel);
    h[i] = w >= 1 ? h[i] : w <= 0 ? pre[i] : pre[i] + (h[i] - pre[i]) * w;
  }
  return box ?? { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Stream-power fluvial erosion + thermal smoothing. Carves dendritic valleys and
 * sharpens ridges so mountains read as weathered rather than lumpy.
 */
export function erodeTerrain(h: Float32Array, W: number, H: number, seaLevel: number, p: ErodeParams = {}): void {
  const k = 0.0032 * Math.min(1, Math.max(0.05, p.strength ?? 0.5));
  const passes = Math.min(12, Math.max(1, Math.round(p.passes ?? 4)));
  for (let pass = 0; pass < passes; pass++) {
    const f = computeFlow(h, W, H, seaLevel);
    for (let i = 0; i < h.length; i++) {
      if (h[i] <= seaLevel) continue;
      const j = f.receiver[i];
      if (j < 0) continue;
      const dx = Math.abs((i % W) - (j % W)), dy = Math.abs(((i / W) | 0) - ((j / W) | 0));
      const dist = dx && dy ? Math.SQRT2 : 1;
      const base = Math.max(seaLevel, h[j] <= seaLevel ? seaLevel : f.filled[j]);
      const drop = Math.max(0, f.filled[i] - base);
      const e = Math.min(200, k * Math.sqrt(f.acc[i]) * drop / dist);
      // never below the cell it drains to (no pits, so no false lakes), and never into the sea
      const floor = Math.max(seaLevel + 2, base + 0.05 * drop);
      if (h[i] > floor) h[i] = Math.max(floor, h[i] - e);
    }
    // thermal / diffusion smoothing on land
    const src = new Float32Array(h);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (src[i] <= seaLevel) continue;
        const lap = src[i - 1] + src[i + 1] + src[i - W] + src[i + W] - 4 * src[i];
        h[i] = Math.max(seaLevel + 4, src[i] + 0.12 * lap);
      }
    }
  }
}
