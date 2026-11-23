/**
 * A battlemap Dragon Drop makes (Battlemap here, from a world map or a settlement) dressed with pictures from the person's asset packs: each built-in
 * floor it uses becomes a fitting floor texture of the packs (grass for grass, cobbles for cobblestone...), its walls a wall picture, its doors and
 * windows door and window pictures. Pack pictures first, the built-in look where the packs have nothing that fits; the person's starred pictures
 * are preferred. The same map and packs always give the same choice (the map's seed picks among the fitting ones).
 */
import { type AssetItem, CUSTOM_MATERIAL_BASE, MATERIALS, MAX_FLOOR_TEXTURES, type MapDoc, type MapWall, battleSpec, defaultTileSquares } from "@mapmaker/core";
import type { AssetLibrary } from "./assets.ts";

/** Words that find a built-in floor's pack counterpart, best first. */
const FLOOR_WORDS: Record<string, string[]> = {
  flagstone: ["flagstone", "stone floor", "stone tile", "flag"],
  cobblestone: ["cobblestone", "cobble"],
  "wood planks": ["wood floor", "plank", "wooden floor", "flooring"],
  dirt: ["dirt", "earth", "soil"],
  grass: ["grass"],
  sand: ["sand"],
  "shallow water": ["shallow water", "water"],
  "deep water": ["deep water", "water"],
  snow: ["snow"],
  lava: ["lava"],
  carpet: ["carpet"],
  marble: ["marble"],
  rock: ["rock", "stone"],
  mud: ["mud"],
  "forest floor": ["forest floor", "forest", "leaves"],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A fitting picture of the packs for these words (the first word that finds any wins), a starred one if any fits, else a steady pick by `salt`. */
function pick(lib: AssetLibrary, cat: string, words: string[], salt: string): AssetItem | null {
  for (const w of words) {
    const found = lib.list({ cat, q: w, limit: 200 }).items;
    if (!found.length) continue;
    const starred = found.filter((i) => i.favourite);
    const pool = starred.length ? starred : found;
    return pool[hash(`${salt}|${w}`) % pool.length];
  }
  return null;
}

/** Dress the battlemap with pack pictures (in place); returns what was used, in words ("grass: Grass 01", "walls: Stone Wall A"), empty when nothing fitted. */
export async function dressBattleWithPacks(doc: MapDoc, lib: AssetLibrary): Promise<string[]> {
  const spec = battleSpec(doc), seed = String(doc.meta.seed ?? 0), notes: string[] = [];
  // the floors: each built-in one in use, the most used first (there is room for MAX_FLOOR_TEXTURES)
  const data = doc.height.data, count = new Map<number, number>();
  for (let i = 0; i < data.length; i++) { const m = data[i] | 0; if (m > 0 && m < CUSTOM_MATERIAL_BASE) count.set(m, (count.get(m) ?? 0) + 1); }
  const palette = [...(spec.palette ?? [])];
  const remap = new Map<number, number>();
  for (const [m] of [...count].sort((a, b) => b[1] - a[1])) {
    if (palette.length >= MAX_FLOOR_TEXTURES) break;
    const mat = MATERIALS[m];
    if (!mat) continue;
    const it = pick(lib, "terrain", FLOOR_WORDS[mat.name] ?? [mat.name], `${seed}|${mat.name}`);
    if (!it) continue;
    const had = palette.find((e) => e.asset === it.id);
    const info = had ? null : await lib.info(it.id);
    let name = it.name, n = 2;
    while (!had && palette.some((e) => e.name.toLowerCase() === name.toLowerCase())) name = `${it.name} ${n++}`;
    const id = had?.id ?? Math.max(CUSTOM_MATERIAL_BASE - 1, ...palette.map((e) => e.id)) + 1;
    if (!had) palette.push({ id, name, asset: it.id, squares: defaultTileSquares(info?.w) });
    remap.set(m, id);
    notes.push(`${mat.name}: ${it.name}`);
  }
  if (remap.size) {
    for (let i = 0; i < data.length; i++) { const to = remap.get(data[i] | 0); if (to !== undefined) data[i] = to; }
    doc.meta.battle = { ...spec, palette };
  }
  // walls, doors and windows that have no look or picture of their own
  const walls = doc.features?.walls ?? [];
  const plain = (w: MapWall) => (w.kind === "wall" || w.kind === "secret") && !w.look && !w.asset;
  if (walls.some(plain)) {
    const it = pick(lib, "walls", ["stone wall", "stone", "brick", "wall"], `${seed}|wall`);
    if (it) { for (const w of walls) if (plain(w)) w.asset = it.id; notes.push(`walls: ${it.name}`); }
  }
  for (const [kind, words] of [["door", ["door"]], ["window", ["window"]]] as [MapWall["kind"], string[]][]) {
    if (!walls.some((w) => w.kind === kind && !w.portal)) continue;
    const it = pick(lib, "portals", words, `${seed}|${kind}`);
    if (it) { for (const w of walls) if (w.kind === kind && !w.portal) w.portal = it.id; notes.push(`${kind}s: ${it.name}`); }
  }
  return notes;
}
