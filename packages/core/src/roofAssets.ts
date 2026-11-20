/**
 * Roof pictures from the asset packs for city buildings. A building is drawn from a roof texture of the packs whenever an appropriate one exists, and only drawn procedurally
 * (the four looks of battleRoof.ts) when none does. This is the rule, shared by Claude's tools and the editor: which pictures are roof textures, which look each one is,
 * how big one repeat is on a city (metres), and which one a building gets (a stable pick, so a street of tile roofs is not one texture stamped over and over).
 *
 * A "roof texture" is a picture meant to be tiled across a roof: the packs keep them under patterns, roofs or terrain, with "roof" in their path
 * ("Roof_Pattern/Roof_Texture_Tile_Red_A1", "TC_Roof Tiles 01_2x2"). Anything under an objects folder is not one, even in a folder called Roofs: whole roofs, chimneys, roof
 * linings, awnings and domes are objects with a fixed size and shape, placed and not tiled. (Checked against a real library of 400,000 pictures: the tileable roof textures are
 * all under patterns, and everything under objects that mentions a roof is a part or a whole object.)
 */
import { PROP_PX_PER_SQUARE } from "./assets.ts";
import { type RoofStyle, ROOF_STYLES } from "./features.ts";

/** The part of an asset item the roof rules use (an `AssetItem` from the library or the server). */
export interface RoofAsset {
  id: string;
  pack?: string;
  packName?: string;
  path: string;
  name?: string;
  cat?: string;
  /** Pixel size, when known. */
  w?: number;
  h?: number;
}

export type RoofPools = Record<RoofStyle, RoofAsset[]>;

/** Packs from another setting (modern, sci-fi) are never picked for a building on their own: a medieval city would get a rooftop of a space station. Asking for one by id still works. */
export const ROOF_PACKS_SKIPPED = /cyber|sci-?fi|modern|futur|vehicle|space/i;
export const ROOF_TEXTURE_CATEGORIES: readonly string[] = ["patterns", "roofs", "terrain"];

/** The words of a path or name, lower case, digits kept ("Roof_Texture_Tile_Red_A1.webp" gives roof, texture, tile, red, a1, webp: a number tells variants apart). */
export const pathWords = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const LOOK_WORDS: [RoofStyle, string[]][] = [
  ["thatch", ["thatch", "thatched", "hay", "straw", "reed", "reeds"]],
  ["slate", ["slate", "slates"]],
  ["shingle", ["shingle", "shingles", "shake", "shakes", "plank", "planks", "wood", "wooden"]],
  ["tile", ["tile", "tiles", "tiled", "terracotta", "clay", "pantile"]],
];

/** Which roof look a picture is, if it is a roof texture of a setting that fits a city of the old world; null when it is not one. */
export function roofLookOfAsset(a: { path: string; packName?: string; cat?: string }): RoofStyle | null {
  if (a.cat && !ROOF_TEXTURE_CATEGORIES.includes(a.cat)) return null;
  if (a.packName && ROOF_PACKS_SKIPPED.test(a.packName)) return null;
  const w = pathWords(a.path);
  if (w.includes("object") || w.includes("objects")) return null;
  if (!w.includes("roof") && !w.includes("roofs") && !w.includes("roofing")) return null;
  for (const [look, names] of LOOK_WORDS) if (w.some((x) => names.includes(x))) return look;
  return null;
}

/** Sort the roof textures among some assets into one pool for each look (each in a fixed order, so picks are stable). */
export function groupRoofAssets(items: RoofAsset[]): RoofPools {
  const pools: RoofPools = { slate: [], tile: [], thatch: [], shingle: [] };
  for (const it of items) {
    const look = roofLookOfAsset(it);
    if (look) pools[look].push(it);
  }
  for (const k of ROOF_STYLES) {
    pools[k].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    // (the same texture often comes in several packs, or in two versions of one: keep the first of each name)
    const seen = new Set<string>();
    pools[k] = pools[k].filter((a) => { const n = (a.path.split("/").pop() ?? a.path).toLowerCase(); if (seen.has(n)) return false; seen.add(n); return true; });
  }
  return pools;
}

/** The pictures of a pool that fit some wanted words ("red", "mossy", "dark"): those with the most of them in their name, or the whole pool when none has any. */
export function matchRoofAssets(pool: RoofAsset[], match?: string): RoofAsset[] {
  const want = pathWords(match ?? "");
  if (!want.length) return pool;
  const scored = pool.map((a) => { const w = pathWords(a.path); return { a, n: want.filter((x) => w.includes(x)).length }; });
  const best = Math.max(0, ...scored.map((s) => s.n));
  return best === 0 ? pool : scored.filter((s) => s.n === best).map((s) => s.a);
}

/**
 * Roof pictures that are poor choices when nothing was asked for: winter roofs, untinted "colorable" ones (a plain grey made to be coloured) and, for tiles, the glazed colours an old-world
 * town does not have. They are still in the pools, and asking for them by name (a match like "purple" or "snowy", or the picture's id) picks them.
 */
const UNUSUAL_ROOF_WORDS: Record<"all" | RoofStyle, string[]> = {
  all: ["frosty", "snowy", "snow", "frozen", "icy", "ice", "colorable", "colourable"],
  tile: ["purple", "green", "blue", "pink"],
  slate: [], thatch: [], shingle: [],
};

/** The pool for a look as a default pick sees it: without the unusual pictures (unless that would leave none), or the pictures that fit `match` when words are given. */
export function fittingRoofAssets(pool: RoofAsset[], look: RoofStyle, match?: string): RoofAsset[] {
  if (pathWords(match ?? "").length) return matchRoofAssets(pool, match);
  const skip = [...UNUSUAL_ROOF_WORDS.all, ...UNUSUAL_ROOF_WORDS[look]];
  const usual = pool.filter((a) => !pathWords(a.path).some((w) => skip.includes(w)));
  return usual.length ? usual : pool;
}

const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** A stable pick from a pool: the same seed (a building's id) always gets the same picture, different seeds spread over the pool. Null for an empty pool. */
export function pickRoofAsset(pool: RoofAsset[], seed: string): RoofAsset | null {
  return pool.length ? pool[hash32(seed) % pool.length] : null;
}

/** A battlemap square is 5 ft. */
export const SQUARE_M = 1.524;
/** Metres one repeat of a roof texture covers when nothing says otherwise (4 squares: a 1024 px picture). */
export const DEFAULT_ROOF_TILE_M = 6;

/** How many metres one repeat of a roof texture covers on a city: its name says in squares ("..._2x2"), else its width in pixels does (256 px a square), else 4 squares. */
export function roofTileMetres(a: { path: string; w?: number }): number {
  const m = /_(\d+)x(\d+)(?:\.[a-z0-9]+)?$/i.exec(a.path);
  const squares = m ? Number(m[1]) : a.w ? Math.round(a.w / PROP_PX_PER_SQUARE) : 4;
  return Math.round(Math.max(1, Math.min(16, squares)) * SQUARE_M * 100) / 100;
}

/**
 * How many rows from the top of a roof picture belong to the roof. The roof pictures of the packs often end in a see-through strip (the last 1% to 9% of the picture: the final
 * course of tiles, then nothing), which, repeated across a roof, would show as a dark seam every tile. Rows count down to the last one that is mostly opaque; a picture that is mostly
 * see-through (under 70% kept) is left alone, and so is one that is opaque to the bottom. `data` is RGBA, `w` pixels wide.
 */
export function opaqueRowCount(data: ArrayLike<number>, w: number, h: number): number {
  const mostlyOpaque = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 200) n++;
    return n * 2 >= w;
  };
  let keep = h;
  while (keep > 1 && !mostlyOpaque(keep - 1)) keep--;
  return keep < h * 0.7 ? h : keep;
}

export interface RoofChoice {
  asset: string;
  /** Metres one repeat covers. */
  tile: number;
  /** The picture's name, for telling the person. */
  name: string;
}

/**
 * The roof a new building gets: a picture of the asset packs that fits its roof look, or null when there is none (then the building is drawn with the look itself).
 * `seed` (its id) spreads the pictures over the buildings; `match` words ("red", "mossy") prefer the pictures that say so.
 */
export function chooseRoof(pools: RoofPools | null | undefined, look: RoofStyle, seed: string, match?: string): RoofChoice | null {
  const a = pickRoofAsset(fittingRoofAssets(pools?.[look] ?? [], look, match), seed);
  return a ? { asset: a.id, tile: roofTileMetres(a), name: a.name ?? a.path.split("/").pop() ?? a.id } : null;
}
