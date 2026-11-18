/**
 * Regional maps: a separate, more detailed map of one area of a parent map. Terrain is the
 * parent's, upscaled in steps with new detail at each scale. Climate is inherited: the
 * parent's temperature, moisture and ground snow are carried over (so rain shadows and
 * climate regions from beyond the area still apply) and refined by the finer elevation.
 */
import { STYLE_E } from "./climate.ts";
import type { Derived } from "./climate.ts";
import type { HeightField, MapDoc } from "./doc.ts";
import { type Features, type MapLine, emptyFeatures } from "./features.ts";
import { gaussianBlur } from "./fields.ts";
import type { Rect } from "./geom.ts";
import { upscaleHeights } from "./upscale.ts";

/** Where a regional map sits in its parent (parent map px) and how much finer it is. */
export interface ParentLink {
  id: string;
  name: string;
  rect: Rect;
  factor: number;
}

/** The parent's climate over the area, at the parent's resolution. */
export interface BaseClimate {
  w: number;
  h: number;
  temp: Uint8Array;
  moist: Uint8Array;
  snow: Uint8Array;
  /** The parent's lakes (0/1): a regional map only has lakes where its parent does. */
  lakes: Uint8Array;
  /** The parent's elevation (height above sea / STYLE_E, blurred like its climate), for the lapse correction. */
  elev: Float32Array;
}

export interface RegionalPlan {
  rect: Rect;
  factor: number;
  width: number;
  height: number;
}

export const REGIONAL_MAX_SIDE = 2048;

/** Snap an area to whole pixels and pick the largest power-of-two factor that keeps the map within maxSide. */
export function planRegional(r: Rect, parentW: number, parentH: number, maxSide = REGIONAL_MAX_SIDE): RegionalPlan | { error: string } {
  const x0 = Math.max(0, Math.floor(Math.min(r.x, r.x + r.w))), y0 = Math.max(0, Math.floor(Math.min(r.y, r.y + r.h)));
  const x1 = Math.min(parentW, Math.ceil(Math.max(r.x, r.x + r.w))), y1 = Math.min(parentH, Math.ceil(Math.max(r.y, r.y + r.h)));
  const w = x1 - x0, h = y1 - y0;
  if (w < 24 || h < 24) return { error: "That area is too small: make it at least 24 map px on each side." };
  let factor = 16;
  while (factor > 1 && Math.max(w, h) * factor > maxSide) factor /= 2;
  if (factor < 2) return { error: `That area is too large for a regional map: keep it under ${maxSide / 2} map px on each side.` };
  return { rect: { x: x0, y: y0, w, h }, factor, width: w * factor, height: h * factor };
}

/** The parent's terrain over the plan's area, upscaled x2 per step with detail and erosion at each scale. */
export function regionalHeights(parent: HeightField, plan: RegionalPlan, seaLevel: number, seed: number) {
  const { rect, factor } = plan;
  const m = 8; // context around the area, so coasts, drainage and filtering behave at its edges
  const cx0 = Math.max(0, rect.x - m), cy0 = Math.max(0, rect.y - m);
  const cx1 = Math.min(parent.w, rect.x + rect.w + m), cy1 = Math.min(parent.h, rect.y + rect.h + m);
  let W = cx1 - cx0, H = cy1 - cy0;
  let data = parent.copyRect({ x: cx0, y: cy0, w: W, h: H });
  let level = 0;
  for (let f = 1; f < factor; f *= 2) {
    const up = upscaleHeights(data, W, H, seaLevel, { seed: seed + 101 * ++level, erosionPasses: 3 });
    data = up.data; W = up.W; H = up.H;
  }
  const ox = (rect.x - cx0) * factor, oy = (rect.y - cy0) * factor;
  const out = new Float32Array(plan.width * plan.height);
  for (let y = 0; y < plan.height; y++) out.set(data.subarray((oy + y) * W + ox, (oy + y) * W + ox + plan.width), y * plan.width);
  return { data: out, W: plan.width, H: plan.height };
}

/** Sample the parent's derived climate over the area. */
export function sampleBaseClimate(parent: MapDoc, d: Derived, rect: Rect): BaseClimate {
  const { w: W, h: H, data } = parent.height;
  const sea = parent.meta.seaLevel;
  const e = new Float32Array(W * H);
  for (let i = 0; i < e.length; i++) e[i] = Math.max(0, data[i] - sea) / STYLE_E;
  const blurred = gaussianBlur(e, W, H, Math.max(1, (4 * W) / 2048));
  const n = rect.w * rect.h;
  const out: BaseClimate = { w: rect.w, h: rect.h, temp: new Uint8Array(n), moist: new Uint8Array(n), snow: new Uint8Array(n), lakes: new Uint8Array(n), elev: new Float32Array(n) };
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const gi = (rect.y + y) * W + rect.x + x, i = y * rect.w + x;
      out.temp[i] = d.temp[gi]; out.moist[i] = d.moist[gi]; out.snow[i] = d.snow ? d.snow[gi] : 0; out.lakes[i] = d.lakes[gi] ? 1 : 0; out.elev[i] = blurred[gi];
    }
  }
  return out;
}

/** Bilinear upsample of a base layer to W x H (pixel centres aligned). */
export function upsampleBase(src: ArrayLike<number>, w: number, h: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const fx = w / W, fy = h / H;
  for (let y = 0; y < H; y++) {
    const gy = Math.min(h - 1, Math.max(0, (y + 0.5) * fy - 0.5)), y0 = Math.floor(gy), y1 = Math.min(h - 1, y0 + 1), ty = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(w - 1, Math.max(0, (x + 0.5) * fx - 0.5)), x0 = Math.floor(gx), x1 = Math.min(w - 1, x0 + 1), tx = gx - x0;
      out[y * W + x] = (src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx) * (1 - ty) + (src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx) * ty;
    }
  }
  return out;
}

/** Places and labels inside the area, moved into the regional map's coordinates (ids kept). */
export function regionalFeatures(f: Features | undefined, rect: Rect, factor: number): Features {
  const src = f ?? emptyFeatures();
  const inside = (x: number, y: number) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
  const tx = (x: number) => (x - rect.x) * factor, ty = (y: number) => (y - rect.y) * factor;
  return {
    places: src.places.filter((p) => inside(p.x, p.y)).map((p) => ({ ...p, x: tx(p.x), y: ty(p.y) })),
    labels: src.labels.filter((l) => inside(l.x, l.y)).map((l) => ({
      ...l, x: tx(l.x), y: ty(l.y), ...(l.path && { path: l.path.map(([x, y]) => [tx(x), ty(y)] as [number, number]) }),
    })),
    regions: [],
    lines: (src.lines ?? []).flatMap((l) => clipLine(l, rect).map((c) => ({ ...c, points: c.points.map(([x, y]) => [tx(x), ty(y)] as [number, number]) }))),
  };
}

/** The parts of a line inside rect (map coordinates), as separate lines. A closed border wholly inside stays closed. */
export function clipLine(l: MapLine, rect: Rect): MapLine[] {
  const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
  const pts = l.closed && l.points.length > 2 ? [...l.points, l.points[0]] : l.points;
  if (l.closed && l.points.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) return [{ ...l }];
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    let ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as [number, number][]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
    const sx = ax + dx * t0, sy = ay + dy * t0, ex = ax + dx * t1, ey = ay + dy * t1;
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - sx, last[1] - sy) > 1e-6) { if (cur.length > 1) runs.push(cur); cur = [[sx, sy]]; }
    cur.push([ex, ey]);
  }
  if (cur.length > 1) runs.push(cur);
  return runs.map((points, k) => ({ id: k ? `${l.id}-${k}` : l.id, kind: l.kind, name: l.name, notes: l.notes, points }));
}

/** Pack / unpack a base climate for disk. */
export function packBaseClimate(b: BaseClimate): Uint8Array {
  const n = b.w * b.h;
  const out = new Uint8Array(8 + 4 * n + 4 * n);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, b.w, true); dv.setUint32(4, b.h, true);
  out.set(b.temp, 8); out.set(b.moist, 8 + n); out.set(b.snow, 8 + 2 * n); out.set(b.lakes, 8 + 3 * n);
  out.set(new Uint8Array(b.elev.buffer, b.elev.byteOffset, 4 * n), 8 + 4 * n);
  return out;
}

export function unpackBaseClimate(bytes: Uint8Array): BaseClimate {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true), n = w * h;
  const elev = new Float32Array(n);
  new Uint8Array(elev.buffer).set(bytes.subarray(8 + 4 * n, 8 + 8 * n));
  return { w, h, temp: bytes.slice(8, 8 + n), moist: bytes.slice(8 + n, 8 + 2 * n), snow: bytes.slice(8 + 2 * n, 8 + 3 * n), lakes: bytes.slice(8 + 3 * n, 8 + 4 * n), elev };
}
