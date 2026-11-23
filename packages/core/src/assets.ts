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

/**
 * Folder names that say what kind of asset is inside, for packs that aren't laid out as textures/<kind>/ (loose folders, zip files):
 * "Dungeon/Floors/stone.png" is a floor, "Props/barrel.png" an object. The deepest folder that says so wins.
 */
const FOLDER_KINDS = new Map<string, AssetCategory>(Object.entries({
  object: "objects", objects: "objects", prop: "objects", props: "objects", furniture: "objects", item: "objects", items: "objects", decor: "objects", decoration: "objects", decorations: "objects",
  terrain: "terrain", terrains: "terrain", floor: "terrain", floors: "terrain", flooring: "terrain", tile: "terrain", tiles: "terrain", ground: "terrain",
  wall: "walls", walls: "walls",
  path: "paths", paths: "paths", road: "paths", roads: "paths",
  portal: "portals", portals: "portals", door: "portals", doors: "portals", window: "portals", windows: "portals",
  roof: "roofs", roofs: "roofs",
  pattern: "patterns", patterns: "patterns",
  light: "lights", lights: "lights",
} as Record<string, AssetCategory>));

export function categoryOf(path: string): AssetCategory {
  const p = path.toLowerCase();
  if (!IMAGE_EXT.test(p)) return "data";
  const m = /^textures\/([^/]+)\//.exec(p);
  if (m) return FOLDER_KINDS.get(m[1]) ?? "other"; // (pack files made by other map tools keep their textures/<kind>/ layout)
  const folders = p.split("/").slice(0, -1);
  for (let i = folders.length - 1; i >= 0; i--) { const k = FOLDER_KINDS.get(folders[i]); if (k) return k; }
  return "other";
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
