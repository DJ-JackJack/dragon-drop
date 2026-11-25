/**
 * The look of a settlement's ground: each kind (grass, sand, water...) has its colour (the climate's, or the map's own: cityLand.ts `cityGroundColours`)
 * and a gradient between a lighter and a darker shade of it that follows a pattern: soft patches, in from its edges (water pale at the shore and deep in
 * the middle), or the height of the land. A kind can also be covered with a ground texture of the asset packs, tiled every so many metres.
 * `CitySpec.groundLook` holds what the map sets (`GroundLook` by the kind's name); every kind has a gentle gradient of its own when the map sets none
 * (`DEFAULT_GROUND_LOOK`). `groundCellColours` gives each ground cell its colour with the gradient: the editor's ground picture and the server's
 * pictures (cityRender.ts) both use it, and draw the textures over it (`groundTexel` for the server's).
 */
import { MATERIALS } from "./battle.ts";

/** A decoded square texture (as the hub gives roof and ground pictures). */
type TileData = { data: Uint8ClampedArray; size: number };
import { lookKit } from "./battleLook.ts";
import type { MapDoc } from "./doc.ts";
import { type CitySpec, citySpec } from "./city.ts";
import { cityClimate, cityGroundColours, groundMaterialId, landGrid } from "./cityLand.ts";
import { defaultTileSquares, parseAssetId } from "./assets.ts";

type RGB = [number, number, number];
const { clamp, vnoise } = lookKit;

export type GroundPattern = "patches" | "edges" | "height" | "flat";
export const GROUND_PATTERNS: readonly { id: GroundPattern; name: string; hint: string }[] = [
  { id: "patches", name: "Patches", hint: "Soft patches of lighter and darker ground, of the size you set." },
  { id: "edges", name: "From the edges", hint: "Lighter where this ground meets another and darker further in (water pale at the shore, deep in the middle), over the width you set." },
  { id: "height", name: "With the height", hint: "Lighter up the hills and darker in the hollows (the land's own height: the Land tool)." },
  { id: "flat", name: "Flat", hint: "One colour all over." },
];

/** What a map sets for one kind of ground (everything is optional: missing is the kind's own default). */
export interface GroundLook {
  /** The gradient's light and dark ends, "#rrggbb" (missing: a lighter and a darker shade of the kind's colour). */
  light?: string;
  dark?: string;
  pattern?: GroundPattern;
  /** How far toward its ends the colour goes, 0 (one colour) to 1. */
  strength?: number;
  /** Patches: how big, in metres; from the edges: how far in it runs. */
  size?: number;
  /** A ground texture of the asset packs ("<pack>:<path>") covering this kind, every `tile` metres. */
  texture?: string;
  tile?: number;
}

/** Each kind's own gradient when the map sets none: natural ground in patches, water from its shore, paving barely worn. */
export const DEFAULT_GROUND_LOOK: Record<string, { pattern: GroundPattern; strength: number; size: number }> = {
  grass: { pattern: "patches", strength: 0.45, size: 70 },
  "forest floor": { pattern: "patches", strength: 0.5, size: 40 },
  dirt: { pattern: "patches", strength: 0.4, size: 30 },
  mud: { pattern: "patches", strength: 0.4, size: 25 },
  sand: { pattern: "patches", strength: 0.35, size: 90 },
  snow: { pattern: "patches", strength: 0.25, size: 80 },
  rock: { pattern: "patches", strength: 0.4, size: 20 },
  lava: { pattern: "patches", strength: 0.6, size: 15 },
  "shallow water": { pattern: "edges", strength: 0.5, size: 25 },
  "deep water": { pattern: "edges", strength: 0.6, size: 120 },
};
const PAVED = { pattern: "patches" as GroundPattern, strength: 0.15, size: 20 };

export const GROUND_SIZE_MIN = 2, GROUND_SIZE_MAX = 400, GROUND_TILE_MIN = 0.25, GROUND_TILE_MAX = 60;
/** A pack texture's tile size in metres when the map sets none and its picture's size isn't known. */
export const DEFAULT_GROUND_TILE_M = 3;

/** A pack texture's own tile size in metres: the battlemap squares its picture is drawn at (`defaultTileSquares`, one square 5 ft, 1.524 m). What a chosen texture starts at. */
export function groundTileMetres(pixelWidth: number | undefined): number {
  return pixelWidth ? Math.round(clamp(defaultTileSquares(pixelWidth) * 1.524, GROUND_TILE_MIN, GROUND_TILE_MAX) * 4) / 4 : DEFAULT_GROUND_TILE_M;
}

const HEX = /^#?([0-9a-fA-F]{6})$/;
const hexRgb = (h: string | undefined): RGB | undefined => { const m = h ? HEX.exec(h) : null; return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : undefined; };
const mix = (a: readonly number[], b: readonly number[], t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as RGB;

/** A lighter, warmer shade of a colour, and a darker, a little richer one: a gradient's ends when the map sets none. */
export function groundShades(c: readonly number[]): { light: RGB; dark: RGB } {
  const light = mix(c, [255, 248, 220], 0.28);
  const d = c.map((v) => v * 0.68), g = (d[0] + d[1] + d[2]) / 3;
  return { light: light.map((v) => Math.round(clamp(v, 0, 255))) as RGB, dark: d.map((v) => Math.round(clamp(g + (v - g) * 1.2, 0, 255))) as RGB };
}

export interface ResolvedGroundLook { colour: RGB; light: RGB; dark: RGB; pattern: GroundPattern; strength: number; size: number; texture?: string; tile: number }

/** Every kind's look on this map, by material id: its colour, gradient ends, pattern, strength and size, and texture if any. */
export function groundLooks(spec: CitySpec): ResolvedGroundLook[] {
  const cols = cityGroundColours(cityClimate(spec), spec.ground);
  return MATERIALS.map((m, id) => {
    const own = spec.groundLook?.[m.name] ?? {}, def = DEFAULT_GROUND_LOOK[m.name] ?? PAVED, colour = (cols[id] ?? [128, 128, 128]) as RGB, shades = groundShades(colour);
    return {
      colour, light: hexRgb(own.light) ?? shades.light, dark: hexRgb(own.dark) ?? shades.dark,
      pattern: own.pattern ?? def.pattern, strength: own.strength ?? def.strength, size: own.size ?? def.size,
      ...(own.texture && { texture: own.texture }), tile: own.tile ?? DEFAULT_GROUND_TILE_M,
    };
  });
}

/** Ground looks from outside (a message or a tool), checked and tidied; an error names the first bad one. A kind with nothing left is left out. */
export function cleanGroundLook(raw: unknown): Record<string, GroundLook> | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "ground looks are a kind of ground's name to its look" };
  const out: Record<string, GroundLook> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = groundMaterialId(k);
    if (id === undefined) return { error: `there is no ground "${k}"` };
    if (!v || typeof v !== "object") return { error: `the look of ${k} must be an object` };
    const o = v as Record<string, unknown>, l: GroundLook = {};
    for (const end of ["light", "dark"] as const) if (o[end] !== undefined) { const c = typeof o[end] === "string" ? HEX.exec(o[end] as string) : null; if (!c) return { error: `the ${end} colour of ${k} must be "#rrggbb"` }; l[end] = `#${c[1].toLowerCase()}`; }
    if (o.pattern !== undefined) { if (!GROUND_PATTERNS.some((p) => p.id === o.pattern)) return { error: `the pattern of ${k} must be one of ${GROUND_PATTERNS.map((p) => p.id).join(", ")}` }; l.pattern = o.pattern as GroundPattern; }
    if (o.strength !== undefined) { if (typeof o.strength !== "number" || !Number.isFinite(o.strength)) return { error: `the strength of ${k} must be a number from 0 to 1` }; l.strength = Math.round(clamp(o.strength, 0, 1) * 100) / 100; }
    if (o.size !== undefined) { if (typeof o.size !== "number" || !Number.isFinite(o.size)) return { error: `the size of ${k} must be metres` }; l.size = Math.round(clamp(o.size, GROUND_SIZE_MIN, GROUND_SIZE_MAX)); }
    if (o.texture !== undefined && o.texture !== null && o.texture !== "") { if (typeof o.texture !== "string" || o.texture.length > 300 || !parseAssetId(o.texture)) return { error: `the texture of ${k} must be an asset id from the packs` }; l.texture = o.texture; }
    if (o.tile !== undefined) { if (typeof o.tile !== "number" || !Number.isFinite(o.tile)) return { error: `the tile size of ${k} must be metres` }; l.tile = Math.round(clamp(o.tile, GROUND_TILE_MIN, GROUND_TILE_MAX) * 100) / 100; }
    if (Object.keys(l).length) out[MATERIALS[id].name] = l;
  }
  return out;
}

/** A number from the map's id, so two maps' patches differ but one map's never change. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) + 17.3;
}

/**
 * The colour of each ground cell in `rect` (cells; default the whole ground) with its kind's gradient, three bytes a cell, row by row.
 * The textures are not in it: they are laid over it where they are drawn.
 */
export function groundCellColours(doc: MapDoc, rect?: { x: number; y: number; w: number; h: number }): { rgb: Uint8ClampedArray; x: number; y: number; w: number; h: number } {
  const spec = citySpec(doc), hf = doc.height, W = hf.w, H = hf.h, c = spec.cellM;
  const x0 = Math.max(0, rect?.x ?? 0), y0 = Math.max(0, rect?.y ?? 0), x1 = Math.min(W, rect ? rect.x + rect.w : W), y1 = Math.min(H, rect ? rect.y + rect.h : H);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), out = new Uint8ClampedArray(w * h * 3);
  const looks = groundLooks(spec), seed = seedOf(doc.meta.id ?? "");
  const kind = (x: number, y: number) => Math.round(hf.data[y * W + x]);
  // from the edges: each cell's distance (metres) to the nearest cell of another kind, in a window round the rect wide enough for the widest edge
  let dist: Float32Array | null = null, ex0 = 0, ey0 = 0, ew = 0;
  const edgeM = Math.max(0, ...looks.map((l) => (l.pattern === "edges" ? l.size : 0)));
  if (edgeM > 0) {
    const E = Math.ceil(edgeM / c) + 2;
    ex0 = Math.max(0, x0 - E); ey0 = Math.max(0, y0 - E);
    const ex1 = Math.min(W, x1 + E), ey1 = Math.min(H, y1 + E), eh = ey1 - ey0;
    ew = ex1 - ex0;
    dist = new Float32Array(ew * eh).fill(1e9);
    for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) {
      const X = ex0 + x, Y = ey0 + y, k = kind(X, Y);
      if ((X > 0 && kind(X - 1, Y) !== k) || (X < W - 1 && kind(X + 1, Y) !== k) || (Y > 0 && kind(X, Y - 1) !== k) || (Y < H - 1 && kind(X, Y + 1) !== k)) dist[y * ew + x] = 0;
    }
    const D = Math.SQRT2;
    for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) {
      const i = y * ew + x; let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + 1);
      if (y > 0) { v = Math.min(v, dist[i - ew] + 1); if (x > 0) v = Math.min(v, dist[i - ew - 1] + D); if (x < ew - 1) v = Math.min(v, dist[i - ew + 1] + D); }
      dist[i] = v;
    }
    for (let y = eh - 1; y >= 0; y--) for (let x = ew - 1; x >= 0; x--) {
      const i = y * ew + x; let v = dist[i];
      if (x < ew - 1) v = Math.min(v, dist[i + 1] + 1);
      if (y < eh - 1) { v = Math.min(v, dist[i + ew] + 1); if (x < ew - 1) v = Math.min(v, dist[i + ew + 1] + D); if (x > 0) v = Math.min(v, dist[i + ew - 1] + D); }
      dist[i] = v;
    }
  }
  // with the height: the land's height over its own range
  const land = looks.some((l) => l.pattern === "height") ? landGrid(doc) : null;
  let lo = 0, hi = 0;
  if (land) { lo = Infinity; hi = -Infinity; for (const v of land.data) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = kind(x, y), L = looks[k] ?? looks[5], mx = (x + 0.5) * c, my = (y + 0.5) * c;
    let v = 0;
    if (L.pattern === "patches") {
      const s = Math.max(1, L.size), n = 0.65 * vnoise(mx / s + seed, my / s - seed) + 0.35 * vnoise(mx / (s * 0.43) - seed, my / (s * 0.43) + seed);
      v = clamp((n - 0.5) * 2.8, -1, 1);
    } else if (L.pattern === "edges" && dist) {
      const t = clamp((dist[(y - ey0) * ew + (x - ex0)] * c) / Math.max(1, L.size), 0, 1), s = t * t * (3 - 2 * t);
      v = clamp(1 - 2 * s + 0.5 * (vnoise(mx / 18 + seed, my / 18) - 0.5), -1, 1);
    } else if (L.pattern === "height" && land && hi > lo) {
      v = ((land.data[y * W + x] - lo) / (hi - lo)) * 2 - 1;
    }
    const col = v >= 0 ? mix(L.colour, L.light, v * L.strength) : mix(L.colour, L.dark, -v * L.strength);
    const o = ((y - y0) * w + (x - x0)) * 3;
    out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2];
  }
  return { rgb: out, x: x0, y: y0, w, h };
}

/**
 * The gradient over a texture: how much lighter or darker a cell's gradient colour is than its kind's own colour, as a grey (128: neither) per channel,
 * laid over the texture by soft light (`softLight`; the editor uses the canvas's "soft-light", the same formula), so a textured kind keeps its patches
 * and edges and its repeats are broken up.
 */
export function gradientShade(cell: readonly number[], own: readonly number[]): RGB {
  // (by brightness only, the same grey in every channel: a gradient whose light end is warmer than the kind's colour would otherwise tint the texture)
  const lum = (c: readonly number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const g = Math.round(clamp((128 * lum(cell)) / Math.max(1, lum(own)), 0, 255));
  return [g, g, g];
}

/** The soft light blend (as the W3C's compositing defines it) of `shade` over `base`, both 0-255 per channel. */
export function softLight(base: readonly number[], shade: readonly number[]): RGB {
  return [0, 1, 2].map((k) => {
    const a = base[k] / 255, b = shade[k] / 255;
    const d = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
    return Math.round(255 * (b <= 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (d - a)));
  }) as RGB;
}

/** The textures a settlement's ground uses (asset ids), for loading them before drawing. */
export function groundTextures(spec: CitySpec): string[] {
  return [...new Set(Object.values(spec.groundLook ?? {}).map((l) => l.texture).filter((t): t is string => !!t))];
}

/** A tile's halved copies (2 x 2 pixels averaged each time, down to 4 px), made once per tile: a texture drawn small is sampled from the copy nearest its size, so it doesn't break into a grid of dots. */
const mipmaps = new WeakMap<TileData, TileData[]>();
function mipsOf(t: TileData): TileData[] {
  const hit = mipmaps.get(t);
  if (hit) return hit;
  const out: TileData[] = [t];
  let cur = t;
  while (cur.size >= 8 && cur.size % 2 === 0) {
    const n = cur.size / 2, d = new Uint8ClampedArray(n * n * 4), s = cur.data, S = cur.size;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let k = 0; k < 4; k++) {
      const a = ((2 * y) * S + 2 * x) * 4 + k;
      d[(y * n + x) * 4 + k] = (s[a] + s[a + 4] + s[a + S * 4] + s[a + S * 4 + 4]) / 4;
    }
    cur = { data: d, size: n };
    out.push(cur);
  }
  mipmaps.set(t, out);
  return out;
}

/** A tile's average colour, worked out once per tile: what a texture looks like from far off (its pattern is finer than a pixel). */
const averages = new WeakMap<TileData, RGB>();
export function tileAverage(t: TileData): RGB {
  const hit = averages.get(t);
  if (hit) return hit;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < t.data.length; i += 16) { if (t.data[i + 3] < 128) continue; r += t.data[i]; g += t.data[i + 1]; b += t.data[i + 2]; n++; }
  const avg: RGB = n ? [r / n, g / n, b / n] : [128, 128, 128];
  averages.set(t, avg);
  return avg;
}

/**
 * How much of a texture's own detail shows for a tile `tilePx` pixels across: none under 8 px (its average colour), all of it from 48 px, a blend between,
 * so a texture's repeats don't show as a lattice from further off (the kind's gradient gives the ground its variety there). The editor uses it too.
 */
export const textureDetail = (tilePx: number) => clamp((tilePx - 8) / 40, 0, 1);

/** A texture's colour at a spot (metres), tiled every `tileM` metres, for a picture of `px` pixels a metre: its own pixel, its average colour, or a blend (`textureDetail`). */
export function groundTexel(t: TileData, tileM: number, mx: number, my: number, px: number): RGB {
  const avg = tileAverage(t), k = textureDetail(tileM * px);
  if (k <= 0) return avg;
  // (the smallest halved copy that still has a pixel for every pixel the tile covers)
  const mips = mipsOf(t), want = tileM * px;
  let m = mips[0];
  for (const c of mips) if (c.size >= want) m = c;
  const u = ((mx / tileM) % 1 + 1) % 1, v = ((my / tileM) % 1 + 1) % 1, o = ((Math.floor(v * m.size) * m.size) + Math.floor(u * m.size)) * 4;
  const p: RGB = [m.data[o], m.data[o + 1], m.data[o + 2]];
  return k >= 1 ? p : mix(avg, p, k);
}
