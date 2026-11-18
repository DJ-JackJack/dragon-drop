/**
 * Climate and the other "derived" layers (computed from the heightmap, never edited directly):
 * temperature, moisture, coast distances, lakes and rivers. The server recomputes these after
 * edits settle and sends them to the editor.
 */
import type { MapDoc } from "./doc.ts";
import { distanceTo, gaussianBlur, removeSpires, upwindMax, upwindMaxDir } from "./fields.ts";
import { type RiverInflow, type RiverPath, computeHydrology } from "./hydrology.ts";
import { type HydroSummary, summariseHydrology } from "./hydroSummary.ts";
import { type ClimateNoise, styleScale } from "./noisecache.ts";
import { applyClimateRegions, regionRock, regionVolcanic } from "./regions.ts";
import { upsampleBase } from "./regional.ts";
import { smoothstep } from "./noise.ts";

/** Elevation that maps to 1.0 in the style's normalised units (matches the prototype). */
export const STYLE_E = 4000;

export type WindName = "west" | "east" | "north" | "south" | "northwest" | "northeast" | "southwest" | "southeast" | "none";
export const WIND_NAMES: WindName[] = ["west", "northwest", "north", "northeast", "east", "southeast", "south", "southwest", "none"];

/** The direction (x right, y down) a wind blows TOWARD: northwesterlies blow to the south-east. */
export const WIND_TRAVEL: Record<Exclude<WindName, "none">, [number, number]> = {
  west: [1, 0], east: [-1, 0], north: [0, 1], south: [0, -1], northwest: [1, 1], northeast: [-1, 1], southwest: [1, -1], southeast: [-1, -1],
};

export interface ClimateParams {
  /** Latitude at the top / bottom edge: 0 = equator, 1 = pole (negative = southern hemisphere). */
  latTop: number;
  latBot: number;
  /** Base wetness, noise amount, and extra wetness near coasts. */
  moistureBias: number;
  moistureNoise: number;
  coastMoisture: number;
  /** + = wetter toward the cold edge, drier toward the warm edge. */
  moistureLat: number;
  /** Snowline at the warm edge, metres; it drops toward the poles by snowLat. */
  snowlineM: number;
  snowLat: number;
  /** Prevailing wind, named for where it blows FROM (west = westerlies): rain shadows fall downwind of ranges. */
  wind: WindName;
  /** 0..1 more = more, smaller rivers. */
  riverDensity: number;
}

export const DEFAULT_CLIMATE: ClimateParams = {
  latTop: 0.62, latBot: 0.38, moistureBias: 0.55, moistureNoise: 0.45, coastMoisture: 0.3, moistureLat: 0.3,
  snowlineM: 2900, snowLat: 0.4, wind: "west", riverDensity: 0.5,
};

export function climateOf(doc: MapDoc): ClimateParams {
  return { ...DEFAULT_CLIMATE, ...(doc.meta.climate ?? {}) };
}

/**
 * How much of the rain on a cell ends up in rivers, 0..~1.5 (an average wet, temperate cell is about 0.6). Wetter ground sheds more, and hot ground
 * loses more to evaporation, so a desert's rare rain mostly never becomes a river while a jungle's does.
 */
export function runoffOf(temp: number, moist: number): number {
  return 0.04 + 1.9 * Math.pow(Math.min(1, Math.max(0, moist)), 1.6) * (1.1 - 0.35 * Math.min(1, Math.max(0, temp)));
}

/** Extra inputs to the derived layers that don't come from the document itself. */
export interface DeriveExtras {
  /** River sources (see resolveRiverSources). */
  inflows?: RiverInflow[];
}

export interface Derived {
  W: number;
  H: number;
  /** Heightmap change number these were computed from. */
  seq: number;
  temp: Uint8Array;
  moist: Uint8Array;
  /** Distance to the nearest land (sea cells) / sea (land cells), px, clamped to 255. */
  seaDist: Uint8Array;
  landDist: Uint8Array;
  lakes: Uint8Array;
  /** Ground snow from climate regions, 0..255. */
  snow: Uint8Array;
  /** Bare dark stone cover from climate regions, 0..255 (absent when no region has it). */
  rock?: Uint8Array;
  /** Volcanic ground cover from climate regions, 0..255 (absent when no region has it). */
  volcanic?: Uint8Array;
  rivers: RiverPath[];
  /** An account of the water (not sent to the editor). */
  hydro?: HydroSummary;
}

export function latAt(c: ClimateParams, y: number, H: number) {
  return Math.abs(c.latTop + (c.latBot - c.latTop) * (y / H));
}

/**
 * How far each cell sits below the highest barrier upwind (0 = no shadow). Rain shadows come
 * from barriers: air flows around a lone spire, so peaks that are narrow in every direction
 * (under ~70 km) are removed before the upwind sweep; ridges stay. It's a broad effect, so
 * maps wider than 1536 px compute it at half resolution.
 */
function rainShadow(elev: Float32Array, W: number, H: number, k: number, wind: ClimateParams["wind"]): Float32Array {
  const N = W * H;
  if (wind === "none") return new Float32Array(N);
  const f = W > 1536 ? 2 : 1;
  const w = Math.ceil(W / f), h = Math.ceil(H / f);
  let e = elev;
  if (f > 1) {
    e = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
        const xx = x * f + dx, yy = y * f + dy;
        if (xx < W && yy < H) { sum += elev[yy * W + xx]; n++; }
      }
      e[y * w + x] = sum / n;
    }
  }
  const kk = k / f;
  const barrier = removeSpires(e, w, h, Math.max(1, Math.round(8 * kk)));
  const reach = Math.round(90 * kk), [dx, dy] = WIND_TRAVEL[wind];
  const up = dy === 0 ? upwindMax(barrier, w, h, reach, dx === 1 ? 1 : -1) : upwindMaxDir(barrier, w, h, reach, dx, dy);
  const low = new Float32Array(w * h);
  for (let i = 0; i < low.length; i++) low[i] = Math.max(0, up[i] - barrier[i]);
  if (f === 1) return low;
  const out = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(h - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(gy), y1 = Math.min(h - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(w - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(gx), x1 = Math.min(w - 1, x0 + 1), fx = gx - x0;
      out[y * W + x] = (low[y0 * w + x0] * (1 - fx) + low[y0 * w + x1] * fx) * (1 - fy) + (low[y1 * w + x0] * (1 - fx) + low[y1 * w + x1] * fx) * fy;
    }
  }
  return out;
}

function q(a: Float32Array, scale: number): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(a[i] * scale)));
  return out;
}

export function computeDerived(doc: MapDoc, noise: ClimateNoise, seq: number, extras: DeriveExtras = {}): Derived {
  const { w: W, h: H, data } = doc.height;
  const sea = doc.meta.seaLevel;
  const c = climateOf(doc);
  const k = styleScale(W);
  const N = W * H;
  const isSea = new Uint8Array(N), isLand = new Uint8Array(N);
  const elev = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const e = data[i] - sea;
    if (e > 0) { isLand[i] = 1; elev[i] = e / STYLE_E; } else isSea[i] = 1;
  }
  const seaDist = distanceTo(isLand, W, H); // for sea cells
  const landDist = distanceTo(isSea, W, H); // for land cells

  if (doc.baseClimate) {
    // regional map: the parent's climate, refined by this map's finer elevation
    const b = doc.baseClimate;
    const tB = upsampleBase(b.temp, b.w, b.h, W, H), mB = upsampleBase(b.moist, b.w, b.h, W, H);
    const eB = upsampleBase(b.elev, b.w, b.h, W, H), sB = upsampleBase(b.snow, b.w, b.h, W, H);
    const eLocal = gaussianBlur(elev, W, H, Math.max(1, 4 * k));
    for (let i = 0; i < N; i++) {
      tB[i] = Math.min(1, Math.max(0, tB[i] / 255 - (eLocal[i] - eB[i]) * 0.45));
      mB[i] = Math.min(1, Math.max(0, mB[i] / 255 + (noise.climateDetail[i] / 127) * 0.05));
    }
    const snow = applyClimateRegions(doc.features?.regions, tB, mB, W, H, doc.meta.kmPerPx);
    const rock = regionRock(doc.features?.regions, W, H, doc.meta.kmPerPx);
    const volcanic = regionVolcanic(doc.features?.regions, W, H, doc.meta.kmPerPx);
    for (let i = 0; i < N; i++) snow[i] = Math.max(snow[i], Math.round(sB[i]));
    // lakes only where the parent has them (with a little slack for the finer shoreline)
    const lb = upsampleBase(b.lakes, b.w, b.h, W, H);
    const lakeMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) lakeMask[i] = lb[i] > 0.15 ? 1 : 0;
    const hy = computeHydrology(data, W, H, sea, { riverDensity: c.riverDensity, seed: doc.meta.seed, lakeMask, runoff: runoffField(data, sea, tB, mB), inflows: extras.inflows });
    return {
      W, H, seq,
      temp: q(tB, 255), moist: q(mB, 255),
      seaDist: q(seaDist, 1), landDist: q(landDist, 1),
      lakes: hy.lakes, snow, rivers: hy.rivers, ...(rock && { rock }), ...(volcanic && { volcanic }),
      hydro: summariseHydrology({ h: data, W, H, sea, kmPerPx: doc.meta.kmPerPx, hy, moist: mB, inflows: extras.inflows }),
    };
  }

  // temperature: latitude + altitude lapse + gentle noise
  const temp = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const lat = latAt(c, y, H);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      temp[i] = 1 - Math.pow(lat, 1.3) * 1.05 - elev[i] * 0.3 + (noise.climateT[i] / 127) * 0.1;
    }
  }
  const tB = gaussianBlur(temp, W, H, Math.max(1, 4 * k));
  for (let i = 0; i < N; i++) tB[i] = smoothstep(0.1, 0.95, tB[i]);

  // moisture: noise + coasts + rain shadow downwind of ranges + latitude trend
  const moist = new Float32Array(N);
  const shadow = rainShadow(elev, W, H, k, c.wind);
  let latMean = 0;
  for (let y = 0; y < H; y++) latMean += latAt(c, y, H) / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      moist[i] = c.moistureBias + (noise.climateM[i] / 127) * c.moistureNoise
        + Math.exp(-landDist[i] / (60 * k)) * c.coastMoisture
        - shadow[i] * 0.9;
    }
  }
  const mB = gaussianBlur(moist, W, H, Math.max(1, 4 * k));
  for (let y = 0; y < H; y++) {
    const lat = latAt(c, y, H);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      mB[i] = smoothstep(0.08, 0.7, mB[i] + (noise.climateDetail[i] / 127) * 0.12 + c.moistureLat * (lat - latMean));
    }
  }

  // climate regions replace the gradient inside their borders
  const snow = applyClimateRegions(doc.features?.regions, tB, mB, W, H, doc.meta.kmPerPx);
  const rock = regionRock(doc.features?.regions, W, H, doc.meta.kmPerPx);
  const volcanic = regionVolcanic(doc.features?.regions, W, H, doc.meta.kmPerPx);

  const hy = computeHydrology(data, W, H, sea, { riverDensity: c.riverDensity, seed: doc.meta.seed, runoff: runoffField(data, sea, tB, mB), inflows: extras.inflows });
  return {
    W, H, seq,
    temp: q(tB, 255), moist: q(mB, 255),
    seaDist: q(seaDist, 1), landDist: q(landDist, 1),
    lakes: hy.lakes, snow, rivers: hy.rivers, ...(rock && { rock }), ...(volcanic && { volcanic }),
    hydro: summariseHydrology({ h: data, W, H, sea, kmPerPx: doc.meta.kmPerPx, hy, moist: mB, inflows: extras.inflows }),
  };
}

/** The runoff of every land cell (0 in the sea), from the final temperature and moisture (regions included). */
function runoffField(h: Float32Array, sea: number, temp: Float32Array, moist: Float32Array): Float32Array {
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) if (h[i] > sea) out[i] = runoffOf(temp[i], moist[i]);
  return out;
}
