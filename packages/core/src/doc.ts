import type { ClimateParams } from "./climate.ts";
import { type Features, emptyFeatures } from "./features.ts";
import type { Rect } from "./geom.ts";
import type { MapFurniture } from "./furniture.ts";
import type { MapGrid } from "./grid.ts";
import type { BattleSpec } from "./battle.ts";
import type { BaseClimate, ParentLink } from "./regional.ts";

export type MapStyle = "painted" | "relief";

/** Elevations are stored in metres relative to the datum; sea level is meta.seaLevel. */
export class HeightField {
  readonly w: number;
  readonly h: number;
  readonly data: Float32Array;

  constructor(w: number, h: number, data?: Float32Array) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Float32Array(w * h);
    if (this.data.length !== w * h) throw new Error(`height data length ${this.data.length} != ${w}x${h}`);
  }

  get(x: number, y: number): number {
    const xi = x < 0 ? 0 : x >= this.w ? this.w - 1 : x | 0;
    const yi = y < 0 ? 0 : y >= this.h ? this.h - 1 : y | 0;
    return this.data[yi * this.w + xi];
  }

  /** Bilinear sample at fractional coordinates (clamped to the edges). */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = this.get(x0, y0);
    const b = this.get(x0 + 1, y0);
    const c = this.get(x0, y0 + 1);
    const d = this.get(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  copyRect(r: Rect): Float32Array {
    const out = new Float32Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) {
      const src = (r.y + y) * this.w + r.x;
      out.set(this.data.subarray(src, src + r.w), y * r.w);
    }
    return out;
  }

  pasteRect(r: Rect, values: Float32Array): void {
    for (let y = 0; y < r.h; y++) {
      const dst = (r.y + y) * this.w + r.x;
      this.data.set(values.subarray(y * r.w, (y + 1) * r.w), dst);
    }
  }

  clone(): HeightField {
    return new HeightField(this.w, this.h, new Float32Array(this.data));
  }
}

export interface MapMeta {
  id: string;
  name: string;
  /** Version of the saved files (see format.ts). Missing on maps saved before it existed: that means 1. */
  formatVersion?: number;
  /** "world": a terrain map. "battle": a grid battlemap, where the field holds floor materials (see battle.ts). */
  kind: "world" | "battle";
  width: number;
  height: number;
  /** Real-world size of one map pixel, in kilometres. */
  kmPerPx: number;
  /** Elevation of the sea surface, metres. */
  seaLevel: number;
  seed: number;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  /** Render style (default "painted"). */
  style?: MapStyle;
  /** Climate settings; missing values fall back to DEFAULT_CLIMATE. */
  climate?: Partial<ClimateParams>;
  /** Square or hex grid overlay (a drawing aid; doesn't change the terrain). */
  grid?: MapGrid;
  /** Title, scale bar, compass and frame drawn over the map and in exports. */
  furniture?: MapFurniture;
  /** Set on a regional map: the map and area it was made from. */
  parent?: ParentLink;
  /**
   * How many times finer than a world map this one is (regional maps: the parent's zoom x
   * the detail factor; default 1). The painted style shades landforms at this scale too.
   */
  zoom?: number;
  /** Battlemaps: grid size and image scale. */
  battle?: BattleSpec;
  /** Battlemaps made from a spot on a world map: which map and where. */
  origin?: { id: string; name: string; x: number; y: number };
}

export interface MapDoc {
  meta: MapMeta;
  height: HeightField;
  /** Named places and labels (optional for docs built before features existed). */
  features?: Features;
  /** Regional maps: the parent's climate over this area (replaces the latitude/wind model). */
  baseClimate?: BaseClimate;
}

export function createDoc(opts: {
  id: string;
  name: string;
  width: number;
  height: number;
  kmPerPx?: number;
  seed?: number;
  fill?: number;
}): MapDoc {
  const now = new Date().toISOString();
  const hf = new HeightField(opts.width, opts.height);
  hf.data.fill(opts.fill ?? -3000);
  return {
    meta: {
      id: opts.id,
      name: opts.name,
      kind: "world",
      width: opts.width,
      height: opts.height,
      kmPerPx: opts.kmPerPx ?? 2,
      seaLevel: 0,
      seed: opts.seed ?? 1,
      createdAt: now,
      updatedAt: now,
    },
    height: hf,
    features: emptyFeatures(),
  };
}

export interface MapStats {
  minM: number;
  maxM: number;
  landFraction: number;
  meanLandM: number;
}

export function mapStats(doc: MapDoc, r?: Rect): MapStats {
  const { height: hf, meta } = doc;
  const rect = r ?? { x: 0, y: 0, w: hf.w, h: hf.h };
  let min = Infinity, max = -Infinity, land = 0, landSum = 0, n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const v = hf.data[y * hf.w + x];
      if (v < min) min = v;
      if (v > max) max = v;
      if (v > meta.seaLevel) {
        land++;
        landSum += v - meta.seaLevel;
      }
      n++;
    }
  }
  return {
    minM: Math.round(min),
    maxM: Math.round(max),
    landFraction: n ? land / n : 0,
    meanLandM: land ? Math.round(landSum / land) : 0,
  };
}
