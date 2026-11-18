/**
 * Lava flows on volcanic ground, worked out the way rivers are (steepest descent over the heightmap) but with a lava's own physics.
 *
 * Water collects: tributaries merge into ever bigger rivers that run all the way to the sea or a lake, and hollows fill and spill over. Lava is thick and
 * cools as it goes, so here:
 *  - it starts at vents (the summits of volcanic ground), not from rain;
 *  - each flow has a budget of heat that every step spends: cheap on a steep flank, dear on flat ground where lava stalls, so flows run far down slopes
 *    and stop short on the flats (and they stop in a hollow rather than filling it);
 *  - it spreads wide and thick on gentle ground and runs in a narrow channel on steep ground, and thins towards its front;
 *  - it splits around obstacles (a flow forks, and the branches don't merge into a trunk);
 *  - it stays on volcanic ground (a flow ends where the region does) and enters the sea at the coast;
 *  - some flows are fresh (they glow), most are old and have cooled to black basalt.
 * Like the water, the result depends only on the heightmap and the volcanic plane, so every tile of a repaint agrees.
 */
import type { HeightField } from "./doc.ts";
import { type Rect, clipRect } from "./geom.ts";
import { computeFlow } from "./hydrology.ts";
import { smoothstep } from "./noise.ts";

export interface LavaFlow {
  /** Flat [x0, y0, x1, y1, ...] in map px (smoothed). */
  pts: number[];
  /** Width in map px at each point. */
  widths: number[];
  /** 1 = fresh and glowing, small = old and cooled to black basalt. */
  heat: number;
}

const D8X = [-1, 0, 1, -1, 1, -1, 0, 1];
const D8Y = [-1, -1, -1, 0, 0, 1, 1, 1];
const D8L = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

/** A fixed pseudo-random number 0..1 from two integers (so the same map always gives the same lava). */
function hash01(a: number, b: number): number {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** A 3x3 box blur, twice, so single-pixel bumps don't trap a flow. */
function soften(h: Float32Array, W: number, H: number): Float32Array {
  let a = h;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += a[yy * W + xx]; n++; }
      }
      b[y * W + x] = s / n;
    }
    a = b;
  }
  return a;
}

/** Round the corners of a polyline (Chaikin), carrying a value along with each point. */
function chaikin(pts: number[], vals: number[], rounds: number): { pts: number[]; vals: number[] } {
  let p = pts, v = vals;
  for (let r = 0; r < rounds; r++) {
    const n = p.length >> 1;
    if (n < 3) break;
    const np: number[] = [p[0], p[1]], nv: number[] = [v[0]];
    for (let i = 0; i + 1 < n; i++) {
      const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * i + 2], by = p[2 * i + 3];
      np.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
      nv.push(0.75 * v[i] + 0.25 * v[i + 1], 0.25 * v[i] + 0.75 * v[i + 1]);
    }
    np.push(p[2 * n - 2], p[2 * n - 1]); nv.push(v[n - 1]);
    p = np; v = nv;
  }
  return { pts: p, vals: v };
}

/** Let a flow wander sideways in long, shallow bends and swell and shrink in lobes (it follows the ground, but not like a ruled line). Changes the points in place. */
function wander(pts: number[], widths: number[], phase: number) {
  const n = pts.length >> 1;
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i) s += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1], len = Math.hypot(tx, ty) || 1;
    const fade = Math.min(1, s / 4); // (the vent itself stays put)
    const off = (Math.sin(s * 0.55 + phase) * 0.55 + Math.sin(s * 0.21 + phase * 1.7) * 0.7) * fade;
    pts[2 * i] += (-ty / len) * off; pts[2 * i + 1] += (tx / len) * off;
    widths[i] *= 1 + 0.28 * Math.sin(s * 0.4 + phase * 2.3);
  }
}

/** Where lava can come from at the most: the vents (summits of volcanic ground) of a map. */
const MAX_VENTS = 56;

/**
 * Lava flows for a map: from each vent a few flows run downhill over the volcanic ground until their heat is spent. `volcanic` is the 0..255 plane of
 * volcanic ground (Derived.volcanic). The flow is worked out on the volcanic part of the map only (with a margin), with the same depression-filling
 * descent the rivers use: a flow fills a small hollow and spills over it, but pays dearly for the flat ground, and stops in a deep basin.
 */
export function lavaFlows(h: Float32Array, W: number, H: number, seaLevel: number, volcanic: Uint8Array, kmPerPx: number): LavaFlow[] {
  // the volcanic part of the map, with a margin for the flows that run off it
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (volcanic[y * W + x] >= 40 && h[y * W + x] > seaLevel) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return [];
  const m = 24;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const hh = new Float32Array(cw * ch), vv = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { hh[y * cw + x] = h[(y0 + y) * W + x0 + x]; vv[y * cw + x] = volcanic[(y0 + y) * W + x0 + x]; }
  const fl = computeFlow(hh, cw, ch, seaLevel).filled; // (small hollows are filled, so a flow never gets stuck on a pit one pixel deep)
  const hs = soften(hh, cw, ch);

  // vents: the summits of volcanic ground, spread out
  const cand: { c: number; z: number }[] = [];
  const R = 5;
  for (let y = R; y < ch - R; y += 2) for (let x = R; x < cw - R; x += 2) {
    const c = y * cw + x;
    if (vv[c] < 150 || hs[c] <= seaLevel + 8) continue;
    let top = true;
    for (let dy = -R; dy <= R && top; dy += 2) for (let dx = -R; dx <= R; dx += 2) if (hs[(y + dy) * cw + x + dx] > hs[c]) { top = false; break; }
    if (top) cand.push({ c, z: hs[c] });
  }
  cand.sort((a, b) => b.z - a.z || a.c - b.c);
  const vents: number[] = [];
  const minGap = 16;
  for (const v of cand) {
    const vx = v.c % cw, vy = (v.c / cw) | 0;
    if (vents.every((u) => Math.hypot((u % cw) - vx, ((u / cw) | 0) - vy) >= minGap)) vents.push(v.c);
    if (vents.length >= MAX_VENTS) break;
  }

  // flank vents: fissures on the upper half of the volcanic ground, so the flows don't all start from the few summits
  const heights: number[] = [];
  for (let c = 0; c < cw * ch; c++) if (vv[c] >= 150 && hs[c] > seaLevel + 8) heights.push(hs[c]);
  if (heights.length) {
    heights.sort((a, b) => a - b);
    const thr = heights[Math.floor(heights.length * 0.5)], gap = 10, step = 11;
    for (let gy = 0; gy < ch && vents.length < MAX_VENTS; gy += step) for (let gx = 0; gx < cw && vents.length < MAX_VENTS; gx += step) {
      const x = Math.min(cw - 2, Math.max(1, gx + Math.floor(hash01(gx, gy) * step))), y = Math.min(ch - 2, Math.max(1, gy + Math.floor(hash01(gy, gx + 5) * step))), c = y * cw + x;
      if (vv[c] < 150 || hs[c] < thr || hash01(gx + 3, gy + 9) > 0.4) continue;
      if (vents.every((u) => Math.hypot((u % cw) - x, ((u / cw) | 0) - y) >= gap)) vents.push(c);
    }
  }

  // how far a flow can run (steps that cost 1), and how wide it is, from the map's scale
  const E0 = Math.min(160, Math.max(12, 240 / kmPerPx));
  const baseW = Math.min(6, Math.max(1.6, 7.5 / kmPerPx));
  const flows: LavaFlow[] = [];

  const trace = (start: number, budget: number, pick: number, key: number, forks: { left: number }, queue: { start: number; budget: number; pick: number; key: number }[]): { pts: number[]; w: number[] } | null => {
    const pts: number[] = [], w: number[] = [];
    const seen = new Set<number>();
    let c = start, E = budget, dxp = 0, dyp = 0;
    for (let step = 0; step < 600 && E > 0; step++) {
      seen.add(c);
      const x = c % cw, y = (c / cw) | 0;
      const opts: { j: number; k: number; drop: number; score: number }[] = [];
      for (let k = 0; k < 8; k++) {
        const nx = x + D8X[k], ny = y + D8Y[k];
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const j = ny * cw + nx;
        if (seen.has(j)) continue;
        const drop = (fl[c] - (hh[j] <= seaLevel ? Math.min(hh[j], seaLevel) : fl[j])) / D8L[k];
        if (drop <= 0) continue;
        const dot = (D8X[k] * dxp + D8Y[k] * dyp) / D8L[k];
        opts.push({ j, k, drop, score: drop * (1 + 0.25 * dot) });
      }
      if (!opts.length) break; // the edge of what was worked out, or nowhere lower to go
      opts.sort((a, b) => b.score - a.score || a.j - b.j);
      const o = step === 0 ? opts[pick % opts.length] : opts[0];
      const grade = o.drop / (kmPerPx * 1000); // rise over run
      const flat = 1 - smoothstep(0.001, 0.01, grade); // lava stalls on gentle ground (a world-map pixel is km wide, so even a mountain flank is only a degree or two)
      pts.push(x0 + x + 0.5, y0 + y + 0.5);
      const run = 1 - Math.max(0, E) / budget; // how far through its heat the flow is: narrow at the vent, spreading into broad lobes, with a blunt front
      w.push(baseW * (0.8 + 1.2 * flat) * (0.7 + 0.6 * run) * (1 - 0.55 * smoothstep(0.85, 1, run)));
      E -= 1 + 4 * flat;
      // a deep basin holds the lava: it pools and stops
      if (fl[c] - hh[c] > 90) break;
      // it splits around obstacles: a fork carries on half of what is left
      if (step > 2 && E > 0.35 * budget && forks.left > 0 && opts.length > 1 && hash01(c, key) < 0.07) {
        forks.left--;
        queue.push({ start: c, budget: E * 0.55, pick: 1, key: key + 7 + forks.left });
        E *= 0.7;
      }
      dxp = D8X[o.k] / D8L[o.k]; dyp = D8Y[o.k] / D8L[o.k];
      c = o.j;
      if (hh[c] <= seaLevel) break; // into the sea
      if (vv[c] < 40) break; // off the volcanic ground
    }
    if (pts.length < 6) return null;
    return { pts, w };
  };

  for (const vent of vents) {
    const count = 2 + (hash01(vent, 11) < 0.5 ? 1 : 0);
    for (let n = 0; n < count; n++) {
      const key = vent * 7 + n;
      const heat = hash01(vent, 100 + n) < 0.35 ? 1 : 0.12;
      const queue = [{ start: vent, budget: E0 * (0.7 + 0.45 * hash01(vent, 200 + n)), pick: n, key }];
      const forks = { left: 3 };
      while (queue.length) {
        const q = queue.shift()!;
        const t = trace(q.start, q.budget, q.pick, q.key, forks, queue);
        if (!t) continue;
        const sm = chaikin(t.pts, t.w, 3);
        wander(sm.pts, sm.vals, hash01(vent, 300 + n) * 6.28);
        flows.push({ pts: sm.pts, widths: sm.vals, heat });
      }
    }
  }
  return flows;
}

// ------------------------------------------------------------------------------------------------- painting

/** Farthest (map px) that the glow and scorch reach from a flow's edge. */
export const LAVA_REACH = 5;
export const NO_LAVA = 1e3;

export interface LavaRaster {
  /** The tile (clipped to the map). */
  r: Rect;
  /** Distance (map px) to the nearest flow's edge; negative inside. */
  edge: Float32Array;
  /** The nearest flow's half width (map px). */
  hw: Float32Array;
  /** 1 = fresh, small = cooled. */
  heat: Float32Array;
  /** Distance (map px) along that flow from its vent. */
  along: Float32Array;
}

/** Distance, width, heat and place along the flow for every pixel within reach of a lava flow, in `tile`. Null when none comes near. */
export function rasterLava(flows: LavaFlow[], hf: HeightField, tile: Rect): LavaRaster | null {
  const r = clipRect(tile, hf.w, hf.h);
  if (!r || !flows.length) return null;
  const m = LAVA_REACH + 6, wx0 = tile.x - m, wy0 = tile.y - m, wx1 = tile.x + tile.w + m, wy1 = tile.y + tile.h + m;
  let edge: Float32Array | null = null, hwA: Float32Array | null = null, heat: Float32Array | null = null, along: Float32Array | null = null;
  for (const f of flows) {
    const p = f.pts, n = p.length >> 1;
    let touches = false;
    for (let k = 0; k < n && !touches; k++) { const x = p[2 * k], y = p[2 * k + 1]; if (x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1) touches = true; }
    if (!touches) continue;
    if (!edge) { edge = new Float32Array(r.w * r.h).fill(NO_LAVA); hwA = new Float32Array(r.w * r.h); heat = new Float32Array(r.w * r.h); along = new Float32Array(r.w * r.h); }
    const s = new Float32Array(n);
    for (let k = 1; k < n; k++) s[k] = s[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    for (let q = 0; q + 1 < n; q++) {
      const ax = p[2 * q], ay = p[2 * q + 1], bx = p[2 * q + 2], by = p[2 * q + 3];
      const hw = (f.widths[q] + f.widths[q + 1]) / 4, reach = hw + LAVA_REACH;
      const x0 = Math.max(r.x, Math.floor(Math.min(ax, bx) - reach)), x1 = Math.min(r.x + r.w - 1, Math.ceil(Math.max(ax, bx) + reach));
      const y0 = Math.max(r.y, Math.floor(Math.min(ay, by) - reach)), y1 = Math.min(r.y + r.h - 1, Math.ceil(Math.max(ay, by) + reach));
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
      for (let y = y0; y <= y1; y++) {
        const row = (y - r.y) * r.w - r.x;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          let t = ((px - ax) * dx + (py - ay) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const e = Math.hypot(ax + t * dx - px, ay + t * dy - py) - hw;
          const i = row + x;
          // a fresh flow wins where two cross (it is the newer one)
          if (e < edge![i] - (f.heat > heat![i] && e < 0.3 ? 0.4 : 0)) { edge![i] = e; hwA![i] = hw; heat![i] = f.heat; along![i] = s[q] + t * (s[q + 1] - s[q]); }
        }
      }
    }
  }
  return edge ? { r, edge, hw: hwA!, heat: heat!, along: along! } : null;
}

// the flows of a Derived (the volcanic plane and the heights it was worked out with), worked out once and shared by every tile
const memo = new WeakMap<object, LavaFlow[]>();
export function lavaOf(key: object, hf: HeightField, seaLevel: number, volcanic: Uint8Array | undefined, kmPerPx: number): LavaFlow[] {
  if (!volcanic) return [];
  let f = memo.get(key);
  if (!f) { f = lavaFlows(hf.data, hf.w, hf.h, seaLevel, volcanic, kmPerPx); memo.set(key, f); }
  return f;
}

