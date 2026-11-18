/**
 * Climate regions: rasterise each outline to a weight map (soft or hard border) and blend
 * its climate over the natural gradient. Used by computeDerived.
 */
import type { ClimateRegion } from "./features.ts";
import { gaussianBlur } from "./fields.ts";

/** Fill a polygon (even-odd rule, sampled at pixel centres) inside the box [x0,x0+w) x [y0,y0+h). */
function fillPolygon(poly: [number, number][], x0: number, y0: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const py = y0 + y + 0.5;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j], [bx, by] = poly[i];
      if ((ay <= py) !== (by <= py)) xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5 - x0)), b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5 - x0));
      for (let x = a; x <= b; x++) out[y * w + x] = 1;
    }
  }
  return out;
}

export interface RegionWeight {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** 0..1 per cell of the box, strength included. */
  data: Float32Array;
}

/** A region's weight over its bounding box (plus room for a soft border). */
export function regionWeight(r: ClimateRegion, W: number, H: number, kmPerPx: number): RegionWeight | null {
  if (r.polygon.length < 3) return null;
  const soft = (r.border ?? "soft") === "soft";
  const sigma = soft ? Math.max(1, (r.blendKm ?? 80) / Math.max(0.01, kmPerPx) / 2.5) : 0.7;
  const pad = Math.ceil(sigma * 3) + 2;
  const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad), y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)) + pad), y1 = Math.min(H, Math.ceil(Math.max(...ys)) + pad);
  if (x1 <= x0 || y1 <= y0) return null;
  const w = x1 - x0, h = y1 - y0;
  const data = gaussianBlur(fillPolygon(r.polygon, x0, y0, w, h), w, h, sigma);
  const s = Math.min(1, Math.max(0, r.strength ?? 1));
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, data[i]) * s;
  return { x0, y0, w, h, data };
}

/**
 * Blend each region's temperature and moisture (0..1) over the natural fields, in order, and
 * return the ground-snow layer (0..255).
 */
export function applyClimateRegions(
  regions: ClimateRegion[] | undefined, temp: Float32Array, moist: Float32Array, W: number, H: number, kmPerPx: number,
): Uint8Array {
  const snow = new Uint8Array(W * H);
  for (const r of regions ?? []) {
    const wt = regionWeight(r, W, H, kmPerPx);
    if (!wt) continue;
    const T = r.temperature, M = r.moisture, S = r.snow ? Math.min(1, Math.max(0, r.snow)) * 255 : 0;
    for (let y = 0; y < wt.h; y++) {
      for (let x = 0; x < wt.w; x++) {
        const a = wt.data[y * wt.w + x];
        if (a <= 0.001) continue;
        const i = (wt.y0 + y) * W + wt.x0 + x;
        if (T !== undefined) temp[i] = temp[i] * (1 - a) + T * a;
        if (M !== undefined) moist[i] = moist[i] * (1 - a) + M * a;
        if (S) snow[i] = Math.max(snow[i], Math.round(S * a));
      }
    }
  }
  return snow;
}

/**
 * The bare-stone layer (0..255) from the regions that have a `rock` cover; undefined when none do. Like ground snow, it
 * follows the region's soft or hard edge and its strength.
 */
export function regionRock(regions: ClimateRegion[] | undefined, W: number, H: number, kmPerPx: number): Uint8Array | undefined {
  let out: Uint8Array | undefined;
  for (const r of regions ?? []) {
    const R = r.rock ? Math.min(1, Math.max(0, r.rock)) * 255 : 0;
    if (!R) continue;
    const wt = regionWeight(r, W, H, kmPerPx);
    if (!wt) continue;
    out ??= new Uint8Array(W * H);
    for (let y = 0; y < wt.h; y++) {
      for (let x = 0; x < wt.w; x++) {
        const a = wt.data[y * wt.w + x];
        if (a <= 0.001) continue;
        const i = (wt.y0 + y) * W + wt.x0 + x;
        out[i] = Math.max(out[i], Math.round(R * a));
      }
    }
  }
  return out;
}

/** The volcanic-ground layer (0..255) from the regions that have a `volcanic` cover; undefined when none do. */
export function regionVolcanic(regions: ClimateRegion[] | undefined, W: number, H: number, kmPerPx: number): Uint8Array | undefined {
  let out: Uint8Array | undefined;
  for (const r of regions ?? []) {
    const R = r.volcanic ? Math.min(1, Math.max(0, r.volcanic)) * 255 : 0;
    if (!R) continue;
    const wt = regionWeight(r, W, H, kmPerPx);
    if (!wt) continue;
    out ??= new Uint8Array(W * H);
    for (let y = 0; y < wt.h; y++) {
      for (let x = 0; x < wt.w; x++) {
        const a = wt.data[y * wt.w + x];
        if (a <= 0.001) continue;
        const i = (wt.y0 + y) * W + wt.x0 + x;
        out[i] = Math.max(out[i], Math.round(R * a));
      }
    }
  }
  return out;
}

/** Area-weighted centre of a polygon (for its name). */
export function polygonCentroid(poly: [number, number][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}
