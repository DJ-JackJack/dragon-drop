/**
 * What changed between two sets of derived layers (climate, coasts, lakes, snow, rock). After a small edit the server
 * recomputes everything, but only a small part of the picture actually differs: the editor repaints just that part
 * instead of the whole map (which cost about two seconds of frozen screen on a 2048 map).
 */
import type { Derived } from "./climate.ts";
import type { Rect } from "./geom.ts";
import type { RiverPath } from "./hydrology.ts";
import { RIVER_REACH } from "./riverPaint.ts";

/** "none": nothing a pixel depends on changed; "all": not comparable (a different size); otherwise the box around every changed cell. */
export type DerivedChange = Rect | "none" | "all";

const PLANES = ["temp", "moist", "seaDist", "landDist", "lakes", "snow", "rock", "volcanic", "ground", "groundW"] as const;

export function derivedChange(a: Derived, b: Derived): DerivedChange {
  if (a.W !== b.W || a.H !== b.H) return "all";
  const { W, H } = a;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  let zero: Uint8Array | null = null;
  for (const name of PLANES) {
    // the stone and volcanic layers only exist when a region has them
    const optional = name === "rock" || name === "volcanic" || name === "ground" || name === "groundW";
    const pa = a[name] ?? (optional ? (zero ??= new Uint8Array(W * H)) : undefined);
    const pb = b[name] ?? (optional ? (zero ??= new Uint8Array(W * H)) : undefined);
    if (!pa || !pb) return "all";
    for (let y = 0; y < H; y++) {
      const o = y * W;
      // first and last differing cell of the row, scanning in from both ends: unchanged rows are read once, changed rows stop early
      let l = 0;
      while (l < W && pa[o + l] === pb[o + l]) l++;
      if (l === W) continue;
      let r = W - 1;
      while (r > l && pa[o + r] === pb[o + r]) r--;
      if (l < x0) x0 = l;
      if (r > x1) x1 = r;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  // rivers are painted into the map: a river that appeared, went or moved changes the pixels round it
  for (const r of changedRivers(a.rivers ?? [], b.rivers ?? [])) {
    const bb = riverBounds(r);
    if (bb.x0 < x0) x0 = Math.max(0, bb.x0);
    if (bb.y0 < y0) y0 = Math.max(0, bb.y0);
    if (bb.x1 > x1) x1 = Math.min(W - 1, bb.x1);
    if (bb.y1 > y1) y1 = Math.min(H - 1, bb.y1);
  }
  if (x1 < 0) return "none";
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function riverSignature(r: RiverPath): string {
  const n = r.pts.length;
  let s = 0, w = 0;
  for (let k = 0; k < n; k += 2) s += r.pts[k] + r.pts[k + 1] * 3.1;
  for (const v of r.widths) w += v;
  return `${n}:${r.pts[0]}:${r.pts[1]}:${r.pts[n - 2]}:${r.pts[n - 1]}:${s.toFixed(2)}:${w.toFixed(2)}`;
}

function riverBounds(r: RiverPath) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < r.pts.length; k += 2) {
    if (r.pts[k] < x0) x0 = r.pts[k];
    if (r.pts[k] > x1) x1 = r.pts[k];
    if (r.pts[k + 1] < y0) y0 = r.pts[k + 1];
    if (r.pts[k + 1] > y1) y1 = r.pts[k + 1];
  }
  const m = RIVER_REACH + 2;
  return { x0: Math.floor(x0 - m), y0: Math.floor(y0 - m), x1: Math.ceil(x1 + m), y1: Math.ceil(y1 + m) };
}

/** The rivers in one set that the other doesn't have (by shape and size): those that appeared, went or changed. */
function changedRivers(a: RiverPath[], b: RiverPath[]): RiverPath[] {
  const left = new Map<string, number>();
  for (const r of a) { const s = riverSignature(r); left.set(s, (left.get(s) ?? 0) + 1); }
  const out: RiverPath[] = [];
  for (const r of b) {
    const s = riverSignature(r), n = left.get(s) ?? 0;
    if (n > 0) left.set(s, n - 1); else out.push(r);
  }
  const gone = new Map<string, number>();
  for (const r of b) { const s = riverSignature(r); gone.set(s, (gone.get(s) ?? 0) + 1); }
  for (const r of a) {
    const s = riverSignature(r), n = gone.get(s) ?? 0;
    if (n > 0) gone.set(s, n - 1); else out.push(r);
  }
  return out;
}
