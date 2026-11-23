/** A floor texture from the asset packs, made one of this battlemap's floor materials (its palette): used by the floor picker and the Assets tab. */
import { type AssetItem, CUSTOM_MATERIAL_BASE, MAX_FLOOR_TEXTURES, type MapMeta, defaultTileSquares } from "@mapmaker/core";
import { store } from "./store.ts";

/**
 * The material id of this texture on the map, adding it to the map's floor textures first if it isn't there yet (one undoable step).
 * Says why not instead when it can't be added.
 */
export function floorTextureFor(meta: MapMeta | null, it: AssetItem): { id: number } | { problem: string } {
  const spec = meta?.battle;
  if (!spec) return { problem: "Open a battlemap first." };
  const palette = spec.palette ?? [];
  const had = palette.find((e) => e.asset.toLowerCase() === it.id.toLowerCase());
  if (had) return { id: had.id };
  if (palette.length >= MAX_FLOOR_TEXTURES) return { problem: `This battlemap already has ${MAX_FLOOR_TEXTURES} floor textures. Right-click one in the floor picker to remove it (it must not be used by any floor).` };
  let name = it.name, n = 2;
  while (palette.some((e) => e.name.toLowerCase() === name.toLowerCase())) name = `${it.name} ${n++}`;
  const entry = { id: Math.max(CUSTOM_MATERIAL_BASE - 1, ...palette.map((e) => e.id)) + 1, name, asset: it.id, squares: defaultTileSquares(it.w) };
  store.send({ t: "cmd", cmd: { op: "set_meta", patch: { battle: { ...spec, palette: [...palette, entry] } }, label: `Add floor texture ${name}` } });
  return { id: entry.id };
}
