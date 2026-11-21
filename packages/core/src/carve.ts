/**
 * Valleys cut by the water (water model stage 2). Opt-in and never automatic: the DM (or Claude, when asked) carves an existing map once the rivers are where they want them,
 * with a checkpoint first, as one edit that Undo takes back.
 *
 * Along every river the land is lowered into a valley: deeper and wider for a bigger river, a narrow V where it drops steeply, and (with `floodplains`) a broad flat floor
 * where a big river crosses low, flat ground. The river's bed never climbs going downstream, so the water keeps to its valley when the rivers are worked out again. With
 * `deltas`, a big river that reaches the sea over flat ground builds a fan of new low land into it, which the painter shows as marsh. Nothing is ever raised except that
 * new delta land, and nothing on land is cut below the sea.
 */
import type { RiverPath } from "./hydrology.ts";

export interface CarveOptions {
  /** 0..1: how deep and wide (default 0.5). */
  strength?: number;
  /** Broad flat floors where big rivers cross low flat ground (default true). */
  floodplains?: boolean;
  /** Fans of new low land where big rivers meet the sea over flat ground (default true). */
  deltas?: boolean;
  /** km per map px (valleys are sized in kilometres, so a map at any scale gets valleys of a believable size). */
  kmPerPx: number;
}

export interface CarveResult {
  heights: Float32Array;
  /** Cells lowered, cells of new delta land, and the deepest cut (m). */
  lowered: number;
  deltaCells: number;
  deepestM: number;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Carve the rivers' valleys into a copy of the heights (see the top of this file). */
export function carveValleys(h: Float32Array, W: number, H: number, sea: number, rivers: readonly RiverPath[], o: CarveOptions): CarveResult {
  const s = Math.max(0, Math.min(1, o.strength ?? 0.5)), kmPx = Math.max(0.01, o.kmPerPx);
  const out = h.slice();
  let deepest = 0;
  // the biggest rivers first: a tributary's valley then meets the main valley's floor
  const order = rivers.map((r, i) => ({ i, w: Math.max(...r.widths) })).sort((a, b) => b.w - a.w);
  for (const { i } of order) {
    const r = rivers[i], p = r.pts, n = p.length / 2;
    if (n < 2) continue;
    // the bed along the river: the ground under it less the cut, never higher than upstream, never below the sea on land
    const bed = new Float32Array(n), ground = new Float32Array(n);
    for (let k = 0; k < n; k++) ground[k] = sample(h, W, H, p[k * 2], p[k * 2 + 1]);
    for (let k = 0; k < n; k++) {
      const w = r.widths[k];
      const cut = (12 + 38 * w) * (0.4 + 1.2 * s);
      bed[k] = Math.max(sea + 1, ground[k] - cut);
      if (k > 0) bed[k] = Math.min(bed[k], bed[k - 1]);
    }
    for (let k = 0; k + 1 < n; k++) {
      const ax = p[k * 2], ay = p[k * 2 + 1], bx = p[k * 2 + 2], by = p[k * 2 + 3];
      const w = (r.widths[k] + r.widths[k + 1]) / 2;
      // how steep it is here: a steep river cuts a narrow V, a slow one a broad U
      const drop = Math.max(0, ground[Math.max(0, k - 2)] - ground[Math.min(n - 1, k + 3)]) / Math.max(0.5, 5 * kmPx);
      const steep = smooth(Math.min(1, drop / 20));
      // the valley's half-width, map px: a few km for a small river, more for a big one, narrower when steep
      let half = ((1.2 + 2.2 * w) * (0.6 + 0.9 * s) / Math.sqrt(kmPx)) * (1 - 0.45 * steep);
      const flat = o.floodplains !== false && w >= 1.1 && steep < 0.15 && ground[k] < sea + 300;
      if (flat) half *= 2.2;
      half = Math.max(1.5, half);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + half + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + half + 1));
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i2 = y * W + x;
        if (h[i2] <= sea) continue;
        const px = x + 0.5, py = y + 0.5, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
        if (d >= half) continue;
        const b = bed[k] + (bed[k + 1] - bed[k]) * t, u = d / half;
        // the profile: V-shaped when steep, U-shaped when slow; a floodplain keeps its floor flat for the inner part
        const prof = flat ? smooth(Math.max(0, (u - 0.45) / 0.55)) : steep > 0.5 ? u : smooth(u);
        const target = b + (h[i2] - b) * prof;
        if (target < out[i2]) { deepest = Math.max(deepest, h[i2] - target); out[i2] = Math.max(sea + 0.5, target); }
      }
    }
  }
  let lowered = 0;
  for (let i = 0; i < out.length; i++) if (out[i] < h[i] - 0.01) lowered++;
  // deltas: a fan of low new land where a big river reaches the sea over flat ground
  let deltaCells = 0;
  if (o.deltas !== false) {
    for (const r of rivers) {
      const p = r.pts, n = p.length / 2;
      if (n < 6) continue;
      const ex = p[n * 2 - 2], ey = p[n * 2 - 1], w = r.widths[n - 1];
      if (w < 1.1 || sample(h, W, H, ex, ey) > sea) continue; // (only rivers that end in the sea)
      const back = Math.max(0, n - 6), slope = (sample(h, W, H, p[back * 2], p[back * 2 + 1]) - sea) / Math.max(1, 5 * kmPx);
      if (slope > 25) continue; // (a river falling steeply into the sea leaves no delta)
      const dirx = ex - p[back * 2], diry = ey - p[back * 2 + 1], dl = Math.hypot(dirx, diry) || 1, ux = dirx / dl, uy = diry / dl;
      const len = ((4 + 6 * w) * (0.5 + s)) / Math.sqrt(kmPx), spread = 0.65;
      for (let y = Math.max(0, Math.floor(ey - len)); y <= Math.min(H - 1, Math.ceil(ey + len)); y++) for (let x = Math.max(0, Math.floor(ex - len)); x <= Math.min(W - 1, Math.ceil(ex + len)); x++) {
        const i2 = y * W + x;
        if (out[i2] > sea) continue;
        const vx = x + 0.5 - ex, vy = y + 0.5 - ey, along = vx * ux + vy * uy, across = -vx * uy + vy * ux;
        if (along < -1) continue;
        // a fan: as wide as it is far out, with a ragged edge
        const reach = len * (1 - Math.abs(across) / Math.max(1, (along + 2) * spread * 1.6)) * (0.8 + 0.2 * Math.cos(across * 1.7 + along * 0.9));
        if (along > reach || Math.abs(across) > (along + 2) * spread) continue;
        const depth = sea - out[i2];
        if (depth > 40) continue; // (only the shallow sea fills in)
        out[i2] = sea + 0.5 + 2.5 * (1 - along / Math.max(1, len));
        deltaCells++;
      }
    }
  }
  return { heights: out, lowered, deltaCells, deepestM: Math.round(deepest) };
}

function sample(h: Float32Array, W: number, H: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(W - 1, Math.floor(x))), cy = Math.max(0, Math.min(H - 1, Math.floor(y)));
  return h[cy * W + cx];
}
