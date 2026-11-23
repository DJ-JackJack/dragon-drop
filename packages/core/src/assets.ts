/**
 * Asset libraries: ids, categories and how assets plug into a battlemap. An asset comes from a "pack", which is any of
 * a folder of images, a .zip file of images, or a pack file made by another map tool (a Godot-style archive; see pck.ts).
 */
import { ASSET_PICTURE_EXT } from "./formats.ts";

export type AssetCategory = "objects" | "terrain" | "walls" | "paths" | "portals" | "roofs" | "patterns" | "lights" | "other" | "data";

export const ASSET_CATEGORIES: AssetCategory[] = ["objects", "terrain", "walls", "paths", "portals", "roofs", "patterns", "lights", "other"];

export const IMAGE_EXT = ASSET_PICTURE_EXT;

/** Objects are drawn at 256 px per grid square, the usual size of tabletop map art: an image's size in squares is its pixels / 256 (a scale of 1). */
export const PROP_PX_PER_SQUARE = 256;

/** Floor material ids at or above this refer to the battlemap's palette (pack textures). */
export const CUSTOM_MATERIAL_BASE = 100;
/** At most this many pack floor textures on one battlemap (the editor's floor picker and Claude's add_floor_texture). */
export const MAX_FLOOR_TEXTURES = 40;

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

// (what kind a picture is, from its path: assetKinds.ts)
export { categoryOf, kindOfName, kindOfPackName, nameWords } from "./assetKinds.ts";

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
