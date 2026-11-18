/** Asset packs (Dungeondraft .dungeondraft_pack): ids, categories and how they plug into a battlemap. */

export type AssetCategory = "objects" | "terrain" | "walls" | "paths" | "portals" | "roofs" | "patterns" | "lights" | "other" | "data";

export const ASSET_CATEGORIES: AssetCategory[] = ["objects", "terrain", "walls", "paths", "portals", "roofs", "patterns", "lights", "other"];

export const IMAGE_EXT = /\.(png|webp|jpe?g)$/i;

/** Dungeondraft draws one grid square as 256 px; an object image's size in squares is its pixels / 256. */
export const PROP_PX_PER_SQUARE = 256;

/** Floor material ids at or above this refer to the battlemap's palette (pack textures). */
export const CUSTOM_MATERIAL_BASE = 100;

/** A pack texture used as a floor material. */
export interface PaletteEntry {
  id: number;
  name: string;
  /** "<pack>:<path>" */
  asset: string;
  /** How many grid squares one repeat of the texture covers (default: its pixel size / 256, within 1..16). */
  squares?: number;
}

/** "<pack key>:<path inside the pack>" */
export const assetId = (pack: string, path: string) => `${pack}:${path}`;

export function parseAssetId(id: string): { pack: string; path: string } | null {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) return null;
  return { pack: id.slice(0, i), path: id.slice(i + 1) };
}

export function categoryOf(path: string): AssetCategory {
  const p = path.toLowerCase();
  if (!IMAGE_EXT.test(p)) return "data";
  const m = /^textures\/([^/]+)\//.exec(p);
  if (!m) return "other";
  switch (m[1]) {
    case "objects": return "objects";
    case "terrain": return "terrain";
    case "walls": return "walls";
    case "paths": return "paths";
    case "portals": return "portals";
    case "roofs": return "roofs";
    case "patterns": return "patterns";
    case "lights": return "lights";
    default: return "other";
  }
}

/** A readable name from a file path: "textures/objects/Oak_Table-01.png" -> "Oak Table 01". */
export function assetLabel(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Default repeat size of a terrain texture, in grid squares. */
export function defaultTileSquares(pixelWidth: number | undefined): number {
  if (!pixelWidth) return 4;
  return Math.max(1, Math.min(16, Math.round(pixelWidth / PROP_PX_PER_SQUARE)));
}

/** One image in a pack, as listed to the editor and to Claude. */
export interface AssetItem {
  id: string;
  pack: string;
  packName: string;
  path: string;
  name: string;
  cat: AssetCategory;
  tags?: string[];
  w?: number;
  h?: number;
}
