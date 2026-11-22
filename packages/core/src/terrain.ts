/**
 * Terrain operations. Each mutates doc.height in place and returns the rect it touched
 * (already clipped to the map), or null if nothing changed.
 */
import type { MapDoc } from "./doc.ts";
import { type LakeAmount, drainTerrain } from "./terrainDrain.ts";
import {
  type Point, type Rect, type Shape, clipRect, expandRect, rectUnion, shapeBounds, shapeSize, signedDistance, distToPolyline,
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
  /** How many lakes the new land keeps: the rest of its hollows are drained so the water runs to the sea (terrainDrain.ts). Default "few". */
  lakes?: LakeAmount;
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
  // the ridged mountains leave deep closed hollows: drain all but a few, or a new continent comes out a fifth lake
  drainTerrain(data, W, H, sea, p.lakes ?? "few");
  return { x: 0, y: 0, w: W, h: H };
}

export interface AddLandmassParams {
  shape: Shape;
  /** Typical inland elevation of the new land, metres above sea level. */
  heightM?: number;
  /** 0 = smooth coast, 1 = very ragged coast. */
  coastRoughness?: number;
  /**
   * 0..1 how much the land rises and falls inside: 0 (the default, as before) is a gently domed plain at about heightM; more gives rolling uplands, hills and dales
   * (up to about twice heightM in places), so the land has character before any mountains are added.
   */
  relief?: number;
  /** A ring of land this many px wide along the shape's outline instead of the whole shape (an atoll, a crater rim, a ring of islands round an inner sea). */
  ringPx?: number;
  seed: number;
}

/** Raise new land (an island or peninsula) inside a shape (or a ring along its outline), with a ragged coast and a shallow shelf. */
export function addLandmass(doc: MapDoc, p: AddLandmassParams): Rect | null {
  const { w: W, h: H, data } = doc.height;
  const sea = doc.meta.seaLevel;
  const ring = p.ringPx && p.ringPx > 0 ? Math.max(2, p.ringPx) : 0;
  const size = ring ? Math.max(4, ring) : Math.max(4, shapeSize(p.shape, W, H));
  const rough = clamp(p.coastRoughness ?? 0.5, 0, 1);
  const relief = clamp(p.relief ?? 0, 0, 1);
  const heightM = p.heightM ?? 250;
  const shelf = size * 0.35 + 6;
  const rect = clipRect(expandRect(shapeBounds(p.shape, W, H), shelf + size * rough * 0.3 + 2 + ring / 2), W, H);
  if (!rect) return null;
  const n = new Simplex2D(subSeed(p.seed, 11));
  const m = new Simplex2D(subSeed(p.seed, 12));
  const hills = new Simplex2D(subSeed(p.seed, 13)), broad = new Simplex2D(subSeed(p.seed, 14)), girth = new Simplex2D(subSeed(p.seed, 15));
  const big = Math.max(4, shapeSize(p.shape, W, H));
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = y * W + x;
      const warp = n.fbm(x, y, Math.max(8, size * 0.45), 5) * size * 0.32 * rough;
      const raw = signedDistance(p.shape, x, y);
      // a ring is wider in places and narrows to necks (or breaks into islands, when the coast is ragged) in others, never an even band
      const half = ring ? (ring / 2) * Math.max(0.1, 1 + (0.25 + 0.35 * rough) * girth.fbm(x, y, Math.max(8, big * 0.45), 2) * 1.5) : 0;
      const sd = (ring ? half - Math.abs(raw) : raw) + warp;
      if (sd > 0) {
        const t = smoothstep(0, size * 0.5, sd);
        // the land's own rise and fall: broad uplands and lowlands, and hills on them (none when relief is 0, as before)
        const up = relief ? 1 + relief * 0.9 * broad.fbm(x, y, big * 0.45, 3) : 1;
        const hill = relief ? relief * heightM * 1.5 * t * Math.max(0, hills.ridged(x, y, Math.max(4, big * 0.09), 5) - 0.3) : 0;
        const target = sea + 8 + heightM * (0.25 + 0.75 * t) * (0.85 + 0.3 * m.fbm(x, y, size * 0.3, 4)) * Math.max(0.3, up) + hill;
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
  /** The crest height at each point of the path (metres added; between points it changes smoothly): a range that rises to a massif and falls away. Default peakM everywhere. */
  heightsM?: number[];
  /** The half-width at each point of the path (px): broad in the middle, narrow at the ends. Default widthPx everywhere. */
  widthsPx?: number[];
  /** 0..1 how many side ridges (spurs) branch off the range: lower, narrower, falling away from the crest. Default 0. */
  spurs?: number;
  seed: number;
}

/** The nearest point of a polyline to (x, y): its distance, and which segment (k, t along it). */
function nearestOnPath(x: number, y: number, pts: Point[]): { d: number; k: number; t: number } {
  if (pts.length === 1) return { d: Math.hypot(x - pts[0][0], y - pts[0][1]), k: 0, t: 0 };
  let best = { d: Infinity, k: 0, t: 0 };
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best.d) best = { d, k, t };
  }
  return best;
}

/** Add a mountain range along a polyline: ridged crest, varying height, foothills; optionally a height and width that change along it, and spurs. */
export function addMountainRange(doc: MapDoc, p: MountainRangeParams): Rect | null {
  const { w: W, h: H, data } = doc.height;
  const n0 = p.path.length;
  const per = (vals: number[] | undefined, dflt: number) => (vals && vals.length === n0 ? vals : null) ?? Array.from({ length: n0 }, () => dflt);
  const peaks = per(p.heightsM, p.peakM ?? 2800);
  const widths = per(p.widthsPx, p.widthPx).map((w) => Math.max(1.5, w));
  const wmax = Math.max(...widths);
  const rough = clamp(p.roughness ?? 0.6, 0, 1);
  let rect = clipRect(expandRect(shapeBounds({ type: "stroke", points: p.path, r: 0 }, W, H), wmax * 3 + 4), W, H);
  if (!rect) return null;
  const n = new Simplex2D(subSeed(p.seed, 21));
  const r = new Simplex2D(subSeed(p.seed, 22));
  const a = new Simplex2D(subSeed(p.seed, 23));
  const vary = !!p.heightsM || !!p.widthsPx;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      let wpx = widths[0], peak = peaks[0], dd: number;
      if (vary) {
        const near = nearestOnPath(x, y, p.path), k2 = Math.min(n0 - 1, near.k + 1);
        wpx = widths[near.k] + (widths[k2] - widths[near.k]) * near.t;
        peak = peaks[near.k] + (peaks[k2] - peaks[near.k]) * near.t;
        dd = near.d;
      } else dd = distToPolyline(x, y, p.path);
      const warp = n.fbm(x, y, wpx * 2, 3) * wpx * 0.45;
      const d = dd + warp;
      if (d > wpx * 3) continue;
      const core = Math.exp(-((d / wpx) ** 2));
      const foot = Math.exp(-((d / (wpx * 2.2)) ** 2)) * 0.18;
      const ridge = r.ridged(x, y, Math.max(3, wpx * 0.9), 6);
      const along = 0.55 + 0.45 * smoothstep(-0.35, 0.35, a.fbm(x, y, wpx * 4, 3));
      const crest = (1 - rough * 0.65) + rough * 0.65 * ridge;
      data[y * W + x] += peak * (core * crest * along + foot * (0.5 + 0.5 * ridge));
    }
  }
  // spurs: side ridges branching off the crest, alternately left and right, lower and narrower, falling away from it
  const spurs = clamp(p.spurs ?? 0, 0, 1);
  if (spurs > 0 && n0 >= 2) {
    let len = 0;
    for (let k = 1; k < n0; k++) len += Math.hypot(p.path[k][0] - p.path[k - 1][0], p.path[k][1] - p.path[k - 1][1]);
    const count = Math.round(spurs * len / Math.max(4, wmax * 2.5));
    const rnd = mulberry32(subSeed(p.seed, 24));
    for (let s = 0; s < count; s++) {
      // where along the range, and its height, width and heading there
      const at = ((s + 0.5 + (rnd() - 0.5) * 0.6) / count) * len;
      let walked = 0, k = 0;
      while (k < n0 - 2 && walked + Math.hypot(p.path[k + 1][0] - p.path[k][0], p.path[k + 1][1] - p.path[k][1]) < at) { walked += Math.hypot(p.path[k + 1][0] - p.path[k][0], p.path[k + 1][1] - p.path[k][1]); k++; }
      const [ax, ay] = p.path[k], [bx, by] = p.path[k + 1], seg = Math.hypot(bx - ax, by - ay) || 1, t = Math.max(0, Math.min(1, (at - walked) / seg));
      const ox = ax + (bx - ax) * t, oy = ay + (by - ay) * t, w = widths[k] + (widths[k + 1] - widths[k]) * t, pk = peaks[k] + (peaks[k + 1] - peaks[k]) * t;
      const side = s % 2 ? 1 : -1, ang = Math.atan2(by - ay, bx - ax) + side * (Math.PI / 2 - 0.35 + rnd() * 0.5);
      const reach = w * (2.6 + rnd() * 2.4), bend = (rnd() - 0.5) * 0.6;
      const mid: Point = [ox + Math.cos(ang) * reach * 0.5, oy + Math.sin(ang) * reach * 0.5];
      const tip: Point = [ox + Math.cos(ang + bend) * reach, oy + Math.sin(ang + bend) * reach];
      const sr = addMountainRange(doc, { path: [[ox, oy], mid, tip], widthPx: w * 0.5, heightsM: [pk * 0.55, pk * 0.4, pk * 0.15], widthsPx: [w * 0.55, w * 0.45, w * 0.3], roughness: rough, seed: subSeed(p.seed, 100 + s) });
      if (sr) rect = rectUnion(rect, sr);
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
  /**
   * Smooth only: how far the smoothing reaches, in map px. Missing (or under 2): the brush's own few pixels, as it always was. Wider, it spreads a
   * sharp step or ridge over about this width, so a straight step tens of pixels across becomes a slope; hills narrower than it are flattened too.
   */
  reachPx?: number;
  /** Smooth with a reach only: keep every cell on its side of the sea level, so the coast stays where it is (default true). */
  keepCoast?: boolean;
  seed?: number;
}

/** The widest reach a smoothing may have (map px): wider than this is a different job (copy the land again, or restore an area). */
export const MAX_SMOOTH_REACH_PX = 128;

/**
 * A wide blur of a box of heights: three box blurs of radius r one after the other (close to a Gaussian whose spread is about r),
 * along the rows and then the columns, with running sums so it costs the same whatever r is. Edges repeat their last cell.
 */
export function wideBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  const col = new Float64Array(w); // (the columns' running sums: the vertical blur goes row by row, which keeps it in the cache)
  const inv = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    // along the rows: a into b
    for (let y = 0; y < h; y++) {
      const row = y * w, last = row + w - 1;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        b[row + x] = sum * inv;
        const add = x + r + 1 < w ? row + x + r + 1 : last;
        const sub = x - r > 0 ? row + x - r : row;
        sum += a[add] - a[sub];
      }
    }
    // along the columns: b back into a
    col.fill(0);
    for (let k = -r; k <= r; k++) {
      const row = Math.min(h - 1, Math.max(0, k)) * w;
      for (let x = 0; x < w; x++) col[x] += b[row + x];
    }
    for (let y = 0; y < h; y++) {
      const row = y * w, add = Math.min(h - 1, y + r + 1) * w, sub = Math.max(0, y - r) * w;
      for (let x = 0; x < w; x++) {
        a[row + x] = col[x] * inv;
        col[x] += b[add + x] - b[sub + x];
      }
    }
  }
  return a;
}

/** The smooth brush with a reach: blur a box around the shape widely, then blend the blurred heights in by the shape's weight. */
function smoothWide(doc: MapDoc, rect: Rect, weight: Float32Array, reachPx: number, strength: number, keepCoast: boolean): Rect {
  const { w: W, h: H, data } = doc.height;
  const r = Math.max(1, Math.round(Math.min(MAX_SMOOTH_REACH_PX, reachPx) / 2));
  const ctx = clipRect(expandRect(rect, 3 * r + 1), W, H) as Rect; // (the blur reads this far beyond the shape)
  const blurred = wideBlur(doc.height.copyRect(ctx), ctx.w, ctx.h, r);
  const sea = doc.meta.seaLevel;
  const blend = 0.35 + 0.65 * strength;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const wgt = weight[y * rect.w + x];
      if (wgt <= 0) continue;
      const i = (rect.y + y) * W + rect.x + x;
      let v = blurred[(rect.y + y - ctx.y) * ctx.w + rect.x + x - ctx.x];
      if (keepCoast) v = data[i] >= sea ? Math.max(v, sea + 1) : Math.min(v, sea - 1);
      data[i] = lerp(data[i], v, wgt * blend);
    }
  }
  return rect;
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

  if (p.mode === "smooth" && (p.reachPx ?? 0) >= 2) return smoothWide(doc, rect, weight, p.reachPx as number, strength, p.keepCoast ?? true);
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
