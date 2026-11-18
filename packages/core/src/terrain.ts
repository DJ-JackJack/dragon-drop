/**
 * Terrain operations. Each mutates doc.height in place and returns the rect it touched
 * (already clipped to the map), or null if nothing changed.
 */
import type { MapDoc } from "./doc.ts";
import {
  type Point, type Rect, type Shape, clipRect, expandRect, shapeBounds, shapeSize, signedDistance, distToPolyline,
} from "./geom.ts";
import { Simplex2D, clamp, lerp, mulberry32, smoothstep, subSeed } from "./noise.ts";

export type TerrainTemplate = "ocean" | "island" | "archipelago" | "continent" | "noise";

export interface GenerateTerrainParams {
  template: TerrainTemplate;
  seed: number;
  /** Fraction of the map that ends up above sea level (ignored for "ocean"). */
  landFraction?: number;
  /** 0..1 how mountainous the land is. */
  mountains?: number;
  /** Highest peaks, metres. */
  maxElevationM?: number;
  /** Deepest ocean, metres (positive number). */
  maxDepthM?: number;
}

/** Replace the whole heightfield with a generated one. */
export function generateTerrain(doc: MapDoc, p: GenerateTerrainParams): Rect {
  const { w: W, h: H, data } = doc.height;
  const sea = doc.meta.seaLevel;
  const S = Math.min(W, H);
  const n0 = new Simplex2D(subSeed(p.seed, 1));
  const n1 = new Simplex2D(subSeed(p.seed, 2));
  const n2 = new Simplex2D(subSeed(p.seed, 3));
  const rand = mulberry32(subSeed(p.seed, 4));
  const maxDepth = p.maxDepthM ?? 4500;
  const maxElev = p.maxElevationM ?? 3200;
  const mountains = clamp(p.mountains ?? 0.5, 0, 1);

  if (p.template === "ocean") {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = n0.fbm(x, y, S * 0.3, 5);
        data[y * W + x] = sea - maxDepth * (0.7 + 0.15 * v);
      }
    }
    return { x: 0, y: 0, w: W, h: H };
  }

  // Island "cores" for archipelagos: elongated gaussian blobs.
  const cores: { cx: number; cy: number; rx: number; ry: number; a: number; k: number }[] = [];
  if (p.template === "archipelago") {
    const count = 8 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i++) {
      const r = (0.05 + rand() * 0.09) * S;
      cores.push({
        cx: (0.15 + rand() * 0.7) * W,
        cy: (0.15 + rand() * 0.7) * H,
        rx: r,
        ry: r * (0.35 + rand() * 0.4),
        a: rand() * Math.PI,
        k: 0.5 + rand() * 0.5,
      });
    }
  }

  const f = new Float32Array(W * H);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = x + n1.fbm(x, y, S * 0.12, 4) * S * 0.06;
      const wy = y + n2.fbm(x, y, S * 0.12, 4) * S * 0.06;
      const noise = n0.fbm(wx, wy, S * 0.22, 6, 0.52);
      let shape = 0;
      switch (p.template) {
        case "island": {
          const d = Math.hypot(wx - cx, wy - cy) / (S * 0.36);
          shape = 1 - d * d;
          break;
        }
        case "continent": {
          const d = Math.hypot((wx - cx) / W, (wy - cy) / H) / 0.42;
          shape = 1 - Math.pow(d, 1.6);
          break;
        }
        case "archipelago": {
          for (const c of cores) {
            const dx = wx - c.cx, dy = wy - c.cy;
            const u = (dx * Math.cos(c.a) + dy * Math.sin(c.a)) / c.rx;
            const v = (-dx * Math.sin(c.a) + dy * Math.cos(c.a)) / c.ry;
            shape += c.k * Math.exp(-(u * u + v * v) * 1.3);
          }
          shape -= 0.3;
          break;
        }
        case "noise":
          shape = 0;
          break;
      }
      // keep land off the map border
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y) / S;
      const fall = smoothstep(0, 0.07, edge);
      f[y * W + x] = (0.6 * shape + 0.55 * noise) * fall - 0.4 * (1 - fall);
    }
  }

  // Sea level so that `landFraction` of the map is land.
  const lf = clamp(p.landFraction ?? 0.35, 0.02, 0.95);
  const sorted = Float32Array.from(f).sort();
  const thr = sorted[Math.floor((1 - lf) * (sorted.length - 1))];
  let fmax = 1e-6, fmin = -1e-6;
  for (let i = 0; i < f.length; i++) {
    const v = f[i] - thr;
    f[i] = v;
    if (v > fmax) fmax = v;
    if (v < fmin) fmin = v;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = f[i];
      if (v > 0) {
        const t = v / fmax; // 0 at coast .. 1 at the most inland point
        const low = 20 + 420 * Math.pow(t, 0.8);
        const zone = smoothstep(0.1, 0.55, n1.fbm(x, y, S * 0.25, 3) * 0.5 + 0.5);
        const ridge = n2.ridged(x, y, S * 0.06, 6);
        const mtn = mountains * zone * smoothstep(0.05, 0.4, t) * ridge * maxElev;
        data[i] = sea + low + mtn;
      } else {
        const t = v / fmin; // 0 at coast .. 1 deepest
        data[i] = sea - 10 - maxDepth * Math.pow(t, 1.25);
      }
    }
  }
  return { x: 0, y: 0, w: W, h: H };
}

export interface AddLandmassParams {
  shape: Shape;
  /** Typical inland elevation of the new land, metres above sea level. */
  heightM?: number;
  /** 0 = smooth coast, 1 = very ragged coast. */
  coastRoughness?: number;
  seed: number;
}

/** Raise new land (an island or peninsula) inside a shape, with a ragged coast and a shallow shelf. */
export function addLandmass(doc: MapDoc, p: AddLandmassParams): Rect | null {
  const { w: W, h: H, data } = doc.height;
  const sea = doc.meta.seaLevel;
  const size = Math.max(4, shapeSize(p.shape, W, H));
  const rough = clamp(p.coastRoughness ?? 0.5, 0, 1);
  const heightM = p.heightM ?? 250;
  const shelf = size * 0.35 + 6;
  const rect = clipRect(expandRect(shapeBounds(p.shape, W, H), shelf + size * rough * 0.3 + 2), W, H);
  if (!rect) return null;
  const n = new Simplex2D(subSeed(p.seed, 11));
  const m = new Simplex2D(subSeed(p.seed, 12));
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = y * W + x;
      const warp = n.fbm(x, y, Math.max(8, size * 0.45), 5) * size * 0.32 * rough;
      const sd = signedDistance(p.shape, x, y) + warp;
      if (sd > 0) {
        const t = smoothstep(0, size * 0.5, sd);
        const target = sea + 8 + heightM * (0.25 + 0.75 * t) * (0.85 + 0.3 * m.fbm(x, y, size * 0.3, 4));
        if (data[i] < target) data[i] = lerp(data[i], target, smoothstep(0, 3, sd));
      } else if (sd > -shelf) {
        const t = -sd / shelf;
        const shelfDepth = sea - 15 - 250 * Math.pow(t, 1.6);
        if (data[i] < shelfDepth) data[i] = lerp(shelfDepth, data[i], smoothstep(0.6, 1, t));
      }
    }
  }
  return rect;
}

export interface MountainRangeParams {
  path: Point[];
  /** Half-width of the range core, px. */
  widthPx: number;
  peakM?: number;
  /** 0..1 how jagged / broken the crest is. */
  roughness?: number;
  seed: number;
}

/** Add a mountain range along a polyline: ridged crest, varying height, foothills. */
export function addMountainRange(doc: MapDoc, p: MountainRangeParams): Rect | null {
  const { w: W, h: H, data } = doc.height;
  const wpx = Math.max(1.5, p.widthPx);
  const peak = p.peakM ?? 2800;
  const rough = clamp(p.roughness ?? 0.6, 0, 1);
  const rect = clipRect(expandRect(shapeBounds({ type: "stroke", points: p.path, r: 0 }, W, H), wpx * 3 + 4), W, H);
  if (!rect) return null;
  const n = new Simplex2D(subSeed(p.seed, 21));
  const r = new Simplex2D(subSeed(p.seed, 22));
  const a = new Simplex2D(subSeed(p.seed, 23));
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const warp = n.fbm(x, y, wpx * 2, 3) * wpx * 0.45;
      const d = distToPolyline(x, y, p.path) + warp;
      if (d > wpx * 3) continue;
      const core = Math.exp(-((d / wpx) ** 2));
      const foot = Math.exp(-((d / (wpx * 2.2)) ** 2)) * 0.18;
      const ridge = r.ridged(x, y, Math.max(3, wpx * 0.9), 6);
      const along = 0.55 + 0.45 * smoothstep(-0.35, 0.35, a.fbm(x, y, wpx * 4, 3));
      const crest = (1 - rough * 0.65) + rough * 0.65 * ridge;
      data[y * W + x] += peak * (core * crest * along + foot * (0.5 + 0.5 * ridge));
    }
  }
  return rect;
}

export type SculptMode = "raise" | "lower" | "smooth" | "flatten" | "set" | "roughen" | "land" | "water";

export interface SculptParams {
  mode: SculptMode;
  shape: Shape;
  /** Metres for raise/lower/roughen. */
  amountM?: number;
  /** Target elevation for flatten/set (flatten defaults to the elevation at the shape's centre). */
  targetM?: number;
  /** 0..1 blend strength for smooth/flatten. */
  strength?: number;
  /** 0..1 fraction of the shape's size used as a soft edge. */
  falloff?: number;
  seed?: number;
}

function shapeCentre(s: Shape, W: number, H: number): Point {
  const b = shapeBounds(s, W, H);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Brush-style edits inside a shape with a soft edge. */
export function sculpt(doc: MapDoc, p: SculptParams): Rect | null {
  const { w: W, h: H, data } = doc.height;
  const rect = clipRect(expandRect(shapeBounds(p.shape, W, H), 1), W, H);
  if (!rect) return null;
  const size = Math.max(1, shapeSize(p.shape, W, H));
  const feather = Math.max(0.75, clamp(p.falloff ?? 0.5, 0, 1) * size);
  const strength = clamp(p.strength ?? 0.6, 0, 1);
  const amount = p.amountM ?? 100;
  const weight = new Float32Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const sd = signedDistance(p.shape, rect.x + x + 0.5, rect.y + y + 0.5);
      weight[y * rect.w + x] = sd <= 0 ? 0 : p.shape.type === "all" ? 1 : smoothstep(0, feather, sd);
    }
  }

  if (p.mode === "smooth") {
    const passes = 1 + Math.round(strength * 4);
    for (let pass = 0; pass < passes; pass++) {
      const src = doc.height.copyRect(rect);
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const wgt = weight[y * rect.w + x];
          if (wgt <= 0) continue;
          let sum = 0, cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= rect.h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= rect.w) continue;
              sum += src[yy * rect.w + xx];
              cnt++;
            }
          }
          const i = (rect.y + y) * W + rect.x + x;
          data[i] = lerp(data[i], sum / cnt, wgt * (0.35 + 0.65 * strength));
        }
      }
    }
    return rect;
  }

  let target = p.targetM;
  if (p.mode === "flatten" && target === undefined) {
    const [cx, cy] = shapeCentre(p.shape, W, H);
    target = doc.height.sample(cx, cy);
  }
  const noise = p.mode === "roughen" ? new Simplex2D(subSeed(p.seed ?? 1, 31)) : null;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const wgt = weight[y * rect.w + x];
      if (wgt <= 0) continue;
      const gx = rect.x + x, gy = rect.y + y;
      const i = gy * W + gx;
      switch (p.mode) {
        case "raise": data[i] += amount * wgt; break;
        case "lower": data[i] -= amount * wgt; break;
        case "flatten": data[i] = lerp(data[i], target as number, wgt * strength); break;
        case "set": data[i] = lerp(data[i], target ?? data[i], wgt); break;
        case "roughen": data[i] += amount * wgt * (noise as Simplex2D).fbm(gx, gy, Math.max(3, size * 0.4), 4); break;
        case "land": {
          // push the coast outward: lift sea floor to low land (higher toward the brush centre)
          const target = doc.meta.seaLevel + 25 + (p.amountM ?? 120) * wgt;
          if (data[i] < target) data[i] = lerp(data[i], target, Math.min(1, wgt * 1.6));
          break;
        }
        case "water": {
          // pull the coast inward: sink land below the sea, deeper toward the centre
          const target = doc.meta.seaLevel - 30 - (p.amountM ?? 120) * wgt;
          if (data[i] > target) data[i] = lerp(data[i], target, Math.min(1, wgt * 1.6));
          break;
        }
      }
    }
  }
  return rect;
}
