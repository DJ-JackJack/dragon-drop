/**
 * Draining a newly generated map, so its water runs to the sea instead of standing in dozens of lakes. The generator's ridged mountains leave deep closed hollows between them,
 * and every hollow deeper than the lake depth (45 m) was a lake: a mountainous continent came out about a fifth lake. Here each hollow gets an outlet cut through the lowest
 * way out of it (a gorge through its rim, a little valley around it), or, when that would mean cutting very deep or very far, it is filled level; the largest few are kept as
 * lakes on purpose, as many as `lakes` asks for. Only new maps are drained (generateTerrain): an existing map's water is never changed by itself.
 */
import { computeFlow } from "./hydrology.ts";

export const LAKE_AMOUNTS = ["none", "few", "some", "many"] as const;
export type LakeAmount = (typeof LAKE_AMOUNTS)[number];

/** Lakes kept per million cells (a 1024 x 1024 map), and the most of the land they may cover; "many" drains nothing (the generator's hollows as they were). */
const KEEP_PER_MEGA: Record<LakeAmount, number> = { none: 0, few: 5, some: 14, many: Infinity };
const KEEP_SHARE: Record<LakeAmount, number> = { none: 0, few: 0.015, some: 0.04, many: 1 };
/** A hollow deeper than this is a lake (as `computeHydrology` sees it). */
const LAKE_DEPTH = 45;
/** Cutting an outlet deeper than this (metres) or longer than this (cells) fills the hollow instead. */
const MAX_CUT_M = 350, MAX_CUT_CELLS = 90;
/** A hollow filled instead keeps its shape, this deep at most (metres): well under LAKE_DEPTH. */
const FILL_BOWL_M = 25;

export interface DrainResult {
  /** Lakes before and after. */
  before: number;
  after: number;
  /** Hollows given an outlet, and hollows filled level. */
  breached: number;
  filled: number;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Min-heap of cells by cost. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    let i = this.ids.length;
    this.ids.push(id); this.keys.push(key);
    while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p] <= key) break; this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p; }
    this.ids[i] = id; this.keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys, top = ids[0], li = ids.pop()!, lk = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < ids.length && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < ids.length && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m]; i = m;
      }
      ids[i] = li; keys[i] = lk;
    }
    return top;
  }
}

interface Hollow { id: number; cells: number[]; pit: number; depth: number }

/** The closed hollows of the land: cells the water would stand in (the filled surface above the ground), grouped, with each one's lowest cell and depth. */
function hollows(h: Float32Array, W: number, H: number, sea: number, label: Int32Array): Hollow[] {
  const f = computeFlow(h, W, H, sea).filled, N = W * H, out: Hollow[] = [];
  label.fill(-1);
  for (let i = 0; i < N; i++) {
    if (label[i] >= 0 || h[i] <= sea || f[i] - h[i] <= 0.5) continue;
    const id = out.length, cells: number[] = [i];
    label[i] = id;
    let pit = i, depth = 0;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k], cx = c % W, cy = (c / W) | 0;
      if (h[c] < h[pit]) pit = c;
      if (f[c] - h[c] > depth) depth = f[c] - h[c];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (label[n] < 0 && h[n] > sea && f[n] - h[n] > 0.5) { label[n] = id; cells.push(n); }
      }
    }
    out.push({ id, cells, pit, depth });
  }
  // (the filled level of each hollow, for filling it)
  (out as (Hollow & { f?: Float32Array })[]).forEach((o) => { o.f = f; });
  return out;
}

/**
 * Give a hollow an outlet: the way out of it that needs the least cutting (searched from its lowest cell to lower ground outside it), cut down to just below the lowest cell,
 * with gently rising sides. Returns false when that would cut deeper or longer than MAX_CUT_*: the hollow is then left for filling.
 */
function breach(h: Float32Array, W: number, H: number, sea: number, label: Int32Array, o: Hollow): boolean {
  const pitH = h[o.pit], cost = new Map<number, number>(), from = new Map<number, number>(), heap = new Heap();
  cost.set(o.pit, 0); heap.push(o.pit, 0);
  let end = -1, visited = 0;
  while (heap.size && visited < 250_000) {
    const c = heap.pop(), cc = cost.get(c)!;
    visited++;
    if (c !== o.pit && label[c] !== o.id && (h[c] <= sea || h[c] < pitH - 0.5)) { end = c; break; }
    const cx = c % W, cy = (c / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx, nc = cc + Math.max(0, h[n] - pitH) + 0.5; // (the cutting needed, and a little for length)
      if (nc < (cost.get(n) ?? Infinity)) { cost.set(n, nc); from.set(n, c); heap.push(n, nc); }
    }
  }
  if (end < 0) return false;
  const path: number[] = [];
  for (let v: number | undefined = end; v !== undefined; v = from.get(v)) path.push(v);
  path.reverse();
  let maxCut = 0;
  for (let k = 0; k < path.length; k++) maxCut = Math.max(maxCut, h[path[k]] - (pitH - 0.05 * k));
  if (maxCut > MAX_CUT_M || path.length > MAX_CUT_CELLS) return false;
  // cut the channel, falling a little all the way, and let its sides rise gently from it (a small valley, not a slot)
  for (let k = 0; k < path.length; k++) {
    const c = path[k], z = Math.min(h[c], pitH - 0.05 * k);
    if (h[c] <= z) continue;
    h[c] = z;
    const cx = c % W, cy = (c / W) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (h[n] > sea) h[n] = Math.min(h[n], z + Math.hypot(dx, dy) * 35);
    }
  }
  return true;
}

/**
 * Drain a heightfield in place: every hollow deeper than a lake gets an outlet (or is filled), except the largest few, kept as lakes (`lakes`: none, few, some, many).
 * Runs a few rounds, as one outlet can open into another hollow.
 */
export function drainTerrain(h: Float32Array, W: number, H: number, sea: number, lakes: LakeAmount = "few"): DrainResult {
  const res: DrainResult = { before: 0, after: 0, breached: 0, filled: 0 };
  const label = new Int32Array(W * H);
  let lakesNow = hollows(h, W, H, sea, label).filter((o) => o.depth > LAKE_DEPTH);
  res.before = lakesNow.length;
  if (lakes === "many") { res.after = res.before; return res; }
  const keepN = lakes === "none" ? 0 : Math.max(1, Math.round((KEEP_PER_MEGA[lakes] * W * H) / (1024 * 1024)));
  // the lakes kept: the largest that fit in the share of the land lakes may cover, remembered by their lowest cell (which no outlet touches)
  let landCells = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > sea) landCells++;
  let room = KEEP_SHARE[lakes] * landCells;
  const keep = new Set<number>();
  for (const o of [...lakesNow].sort((a, b) => b.cells.length - a.cells.length)) {
    if (keep.size >= keepN) break;
    if (o.cells.length > room) continue;
    keep.add(o.pit); room -= o.cells.length;
  }
  for (let round = 0; round < 4; round++) {
    const all = round ? hollows(h, W, H, sea, label) : null;
    const now = all ? all.filter((o) => o.depth > LAKE_DEPTH) : lakesNow;
    const keptIds = new Set([...keep].map((p) => label[p]).filter((id) => id >= 0));
    const drain = now.filter((o) => !keptIds.has(o.id)).sort((a, b) => a.cells.length - b.cells.length);
    if (!drain.length) break;
    for (const o of drain) {
      if (breach(h, W, H, sea, label, o)) { res.breached++; continue; }
      // too deep or too far to cut through: raised into a shallow bowl of the same shape (at most FILL_BOWL_M deep: too shallow to hold a lake, and not a flat plate)
      const f = (o as Hollow & { f?: Float32Array }).f!, k = Math.min(1, FILL_BOWL_M / o.depth);
      for (const c of o.cells) h[c] = Math.max(h[c], f[c] - (f[c] - h[c]) * k);
      res.filled++;
    }
    lakesNow = [];
  }
  res.after = hollows(h, W, H, sea, label).filter((o) => o.depth > LAKE_DEPTH).length;
  return res;
}
