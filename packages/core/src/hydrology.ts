/**
 * Hydrology derived from the heightmap: depression filling, D8 flow, flow accumulation,
 * river polylines and lakes. Rivers always run downhill to the sea and only merge.
 *
 * How much water a river carries is the runoff of the land that drains into it (wetter, cooler ground sheds more; a desert's rain mostly never
 * reaches a river), plus any river sources (a great spring or waterfall that feeds a river from beyond what the map shows).
 */
import { dilate, erode, removeSmall } from "./fields.ts";
import { Simplex2D, smoothstep } from "./noise.ts";

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
}

export interface Hydrology {
  /** The flow the rivers were traced on (receivers, accumulation, the filled surface). */
  flow: FlowField;
  rivers: RiverPath[];
  /** 1 = lake cell. */
  lakes: Uint8Array;
  riverThreshold: number;
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
  for (const head of heads) {
    const cells: number[] = [];
    let c = head;
    for (;;) {
      cells.push(c);
      if (visited[c]) break;
      visited[c] = 1;
      const nx = f.receiver[c];
      if (nx < 0 || h[nx] <= seaLevel) { if (nx >= 0) cells.push(nx); break; }
      if (lakes[nx]) { cells.push(nx); break; }
      c = nx;
    }
    if (cells.length < 3) continue;
    rivers.push(smoothRiver(cells, W, f.acc, thr, meander, h, donors));
  }
  return { flow: f, rivers, lakes, riverThreshold: thr };
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
function smoothRiver(cells: number[], W: number, acc: Float32Array, thr: number, noise: Simplex2D, h: Float32Array, donors: Uint8Array): RiverPath {
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
      const amp = 0.3 + 1.25 * (1 - smoothstep(1, 6, drop));
      const taper = smoothstep(0, 4, near[k]);
      const off = (noise.noise(x / 7, y / 7) + 0.35 * noise.noise(x / 3 + 91, y / 3)) * amp * taper;
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
  for (const [x, y, a] of pts) {
    flat.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
    widths.push(Math.round((0.45 + Math.log2(Math.max(a, thr) / thr) * 0.32) * 100) / 100);
  }
  return { pts: flat, widths };
}

export interface ErodeParams {
  /** 0..1 how hard to erode per pass (default 0.5). */
  strength?: number;
  /** Number of erosion passes (default 4). */
  passes?: number;
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
