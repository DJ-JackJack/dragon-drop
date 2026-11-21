/**
 * A battlemap from a spot on a world map: what the ground is like there (climate, slope, water, coast, river)
 * decides the floors of the scene. The scene is a few dozen metres across, so the world map supplies the biome
 * and the water features that run through that point; local variety (patches, wobble) comes from seeded noise.
 */
import type { Derived } from "./climate.ts";
import type { MapDoc } from "./doc.ts";
import { battleSpec } from "./battle.ts";

const M = { dirt: 4, grass: 5, sand: 6, shallow: 7, deep: 8, snow: 9, rock: 13, mud: 14, forest: 15 };

export interface WorldSample {
  x: number;
  y: number;
  /** Metres above sea level (negative: under water). */
  elevM: number;
  underwater: boolean;
  /** Rise over run of the ground. */
  slope: number;
  /** Which way the ground rises (a unit direction on the map; y runs down), when it isn't flat. */
  uphill?: { dx: number; dy: number };
  /** 0..1 */
  temp: number;
  moist: number;
  snow: number;
  lake: boolean;
  /** A river passing through: unit direction and width in world px. */
  river?: { dx: number; dy: number; widthPx: number };
  /** Land next to the sea: unit direction towards the sea. */
  coast?: { dx: number; dy: number };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function sampleWorld(parent: MapDoc, d: Derived | null, x: number, y: number): WorldSample {
  const hf = parent.height, sea = parent.meta.seaLevel;
  const px = clamp(Math.round(x), 0, hf.w - 1), py = clamp(Math.round(y), 0, hf.h - 1);
  const i = py * hf.w + px;
  const elevM = hf.get(px, py) - sea;
  const gx = (hf.get(px + 1, py) - hf.get(px - 1, py)) / 2, gy = (hf.get(px, py + 1) - hf.get(px, py - 1)) / 2;
  const slope = Math.hypot(gx, gy) / (parent.meta.kmPerPx * 1000);
  const out: WorldSample = {
    x: px, y: py, elevM, underwater: elevM <= 0, slope,
    temp: d && d.W === hf.w ? d.temp[i] / 255 : 0.5, moist: d && d.W === hf.w ? d.moist[i] / 255 : 0.5, snow: d && d.W === hf.w ? d.snow[i] / 255 : 0,
    lake: !!d && d.W === hf.w && d.lakes[i] > 0,
  };
  if (Math.hypot(gx, gy) > 1e-6) { const l = Math.hypot(gx, gy); out.uphill = { dx: gx / l, dy: gy / l }; }
  if (!out.underwater) {
    let sx = 0, sy = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && hf.get(px + dx, py + dy) <= sea) { sx += dx; sy += dy; n++; }
    if (n) { const l = Math.hypot(sx, sy) || 1; out.coast = { dx: sx / l, dy: sy / l }; }
    if (d) {
      let best = 1.6, found: WorldSample["river"];
      for (const r of d.rivers) {
        for (let k = 0; k + 1 < r.pts.length / 2; k++) {
          const dist = Math.hypot(r.pts[k * 2] - x, r.pts[k * 2 + 1] - y);
          if (dist >= best) continue;
          const a = Math.max(0, k - 1), b = Math.min(r.pts.length / 2 - 1, k + 1);
          const dx = r.pts[b * 2] - r.pts[a * 2], dy = r.pts[b * 2 + 1] - r.pts[a * 2 + 1], l = Math.hypot(dx, dy) || 1;
          best = dist;
          found = { dx: dx / l, dy: dy / l, widthPx: r.widths[k] ?? 1 };
        }
      }
      if (found) out.river = found;
    }
  }
  return out;
}

export function describeSample(s: WorldSample): string {
  const parts: string[] = [];
  if (s.underwater) return s.elevM > -60 ? "shallow sea" : "open sea";
  if (s.slope > 0.22 || s.elevM > 2600) parts.push("rocky mountainside");
  else if (s.temp < 0.2 || s.snow > 0.55) parts.push("snowy ground");
  else if (s.moist < 0.22) parts.push("desert");
  else if (s.moist < 0.4) parts.push("dry grassland");
  else if (s.moist > 0.62) parts.push(s.temp > 0.7 ? "jungle" : "woodland");
  else parts.push("meadow");
  if (s.lake) parts.push("beside a lake");
  if (s.river) parts.push("a river crossing it");
  if (s.coast) parts.push("on the coast");
  return parts.join(", ");
}

// ---------------------------------------------------------------- noise
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy, seed) * (1 - sx) + hash(ix + 1, iy, seed) * sx) * (1 - sy) + (hash(ix, iy + 1, seed) * (1 - sx) + hash(ix + 1, iy + 1, seed) * sx) * sy;
}

const fbm = (x: number, y: number, seed: number) => (vnoise(x, y, seed) * 0.55 + vnoise(x * 2.1, y * 2.1, seed + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, seed + 13) * 0.15);

/** The value above which `fraction` of the values lie. */
function quantile(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - fraction) * sorted.length)))];
}

/** Fill a battlemap's floor from a world sample. Every cell gets a material (no void). */
export function battleFloorFromWorld(doc: MapDoc, s: WorldSample, seed: number): void {
  const spec = battleSpec(doc);
  const { w: CW, h: CH, data } = doc.height;
  const sub = spec.sub, SX = spec.squaresX, SY = spec.squaresY;
  const N = CW * CH;
  const xs = new Float32Array(N), ys = new Float32Array(N);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { xs[y * CW + x] = (x + 0.5) / sub; ys[y * CW + x] = (y + 0.5) / sub; }
  const noise = (scale: number, salt: number) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = fbm(xs[i] * scale, ys[i] * scale, seed + salt); return a; };

  if (s.underwater) {
    const depth = -s.elevM, n = noise(0.12, 1);
    for (let i = 0; i < N; i++) data[i] = n[i] * 1.6 < depth / 120 ? M.deep : M.shallow;
    return;
  }

  // ground
  let base = M.grass, alt = M.dirt, frac = 0.2;
  const forested = s.moist > 0.62;
  if (s.slope > 0.22 || s.elevM > 2600) { base = M.rock; alt = M.dirt; frac = 0.3; }
  else if (s.temp < 0.2 || s.snow > 0.55) { base = M.snow; alt = M.rock; frac = 0.15; }
  else if (s.moist < 0.22) { base = M.sand; alt = M.dirt; frac = 0.25; }
  else if (s.moist < 0.4) { base = M.dirt; alt = M.grass; frac = 0.35; }
  else if (forested) { base = M.forest; alt = M.grass; frac = 0.28; }
  const patches = noise(0.16, 2), patchAt = quantile(patches, frac);
  for (let i = 0; i < N; i++) data[i] = patches[i] >= patchAt ? alt : base;
  if (s.temp < 0.32 && base !== M.snow) { // a cold place: snow lies in drifts
    const drift = noise(0.2, 3), at = quantile(drift, clamp((0.32 - s.temp) * 2.2, 0.05, 0.6));
    for (let i = 0; i < N; i++) if (drift[i] >= at) data[i] = M.snow;
  }
  if (s.moist > 0.7 && s.slope < 0.05 && base !== M.snow) { // wet and flat: mud
    const wet = noise(0.22, 4), at = quantile(wet, 0.1);
    for (let i = 0; i < N; i++) if (wet[i] >= at) data[i] = M.mud;
  }
  const bank = base === M.snow || base === M.rock ? M.rock : s.moist > 0.55 ? M.mud : M.sand;
  const cx = SX / 2, cy = SY / 2;

  // the sea on one side
  if (s.coast) {
    const { dx, dy } = s.coast, half = Math.abs(dx) * SX / 2 + Math.abs(dy) * SY / 2, t0 = 0.15 * half;
    const wob = noise(0.1, 5);
    for (let i = 0; i < N; i++) {
      const t = (xs[i] - cx) * dx + (ys[i] - cy) * dy - t0 - (wob[i] - 0.5) * 5;
      if (t > 4) data[i] = M.deep; else if (t > 0) data[i] = M.shallow; else if (t > -3) data[i] = bank;
    }
  }

  // a lake in the middle
  if (s.lake) {
    const wob = noise(0.13, 6);
    for (let i = 0; i < N; i++) {
      const dd = Math.hypot((xs[i] - cx) / (SX * 0.34), (ys[i] - cy) / (SY * 0.34)) * (1 + (0.5 - wob[i]) * 0.7);
      if (dd < 0.55) data[i] = M.deep; else if (dd < 1) data[i] = M.shallow; else if (dd < 1.22) data[i] = bank;
    }
  }

  // a river through the middle, along its real direction
  if (s.river) {
    const { dx, dy } = s.river, width = clamp(2 + s.river.widthPx * 2.5, 2.5, 9);
    const wob = noise(0.09, 7);
    for (let i = 0; i < N; i++) {
      const u = (xs[i] - cx) * dx + (ys[i] - cy) * dy, v = -(xs[i] - cx) * dy + (ys[i] - cy) * dx;
      const off = 1.6 * Math.sin(u * 0.33 + seed) + (wob[i] - 0.5) * 3;
      const a = Math.abs(v - off);
      if (a < width / 2) data[i] = width >= 5 && a < width / 5 ? M.deep : M.shallow;
      else if (a < width / 2 + 1.2 && data[i] !== M.deep && data[i] !== M.shallow) data[i] = bank;
    }
  }
}
