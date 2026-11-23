/**
 * A battlemap Dragon Drop makes (Battlemap here, from a world map or a settlement) dressed with pictures from the person's asset packs: each built-in
 * floor it uses becomes a fitting floor texture of the packs (grass for grass, cobbles for cobblestone...), its walls a wall picture, its doors and
 * windows door and window pictures. Pack pictures first, the built-in look where the packs have nothing that fits; the person's starred pictures
 * are preferred. The same map and packs always give the same choice (the map's seed picks among the fitting ones).
 */
import { type AssetItem, CUSTOM_MATERIAL_BASE, MATERIALS, MAX_FLOOR_TEXTURES, type MapDoc, type MapWall, battleSpec, defaultTileSquares } from "@mapmaker/core";
import { decodeImage } from "@mapmaker/tools";
import type { AssetLibrary } from "./assets.ts";

/**
 * Floors that have a colour of their own: a grey picture is never chosen for them. Packs often hold a grey copy of a texture meant to be coloured in
 * another program ("Water Still A 07" beside the blue "A 01"), which on a battlemap is just grey.
 */
const COLOURED = new Set(["grass", "dirt", "sand", "shallow water", "deep water", "lava", "mud", "forest floor", "carpet", "wood planks"]);
/** Water, which must also look like water: blue or blue-green, not a murky brown swamp (open sea and rivers alike). */
const WATER = new Set(["shallow water", "deep water"]);
/** Names of pictures made to lie over a ground, not to be one: a floor painted with one is a flat colour. */
const OVERLAY = /\b(overlay|overlays|mask|masks|decal|decals|shadow|shadows|highlight|highlights|blend)\b/i;
/** Names of the pieces that end a wall or stand at a corner, not a wall to repeat along its length. */
const PIECE = /\b(end|ends|corner|corners|cap|caps|post|posts|pillar|pillars|column|columns|joint|joints)\b/i;
/** Below this mean colourfulness (the brightest channel minus the darkest, 0..255) a picture counts as grey. */
const GREY_BELOW = 12;

/**
 * A floor picture's colour as a battlemap floor shows it, from its small thumbnail: how colourful (0..255) and its mean red, green and blue. A floor is
 * painted from a picture's colours alone, its see-through parts too (many packs' ground textures are partly see-through, made to blend in another program),
 * so every pixel counts, whatever its alpha.
 */
export async function pictureColour(lib: AssetLibrary, id: string): Promise<{ chroma: number; r: number; g: number; b: number; spread: number } | null> {
  const t = await lib.thumbnail(id, 48).catch(() => null);
  const img = t && decodeImage(t.bytes);
  if (!img) return null;
  let sum = 0, r = 0, g = 0, b = 0, l2 = 0;
  const n = img.data.length / 4;
  for (let i = 0; i < img.data.length; i += 4) {
    const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
    sum += Math.max(R, G, B) - Math.min(R, G, B);
    r += R; g += G; b += B;
    const l = (R + G + B) / 3;
    l2 += l * l;
  }
  if (!n) return null;
  const mean = (r + g + b) / 3 / n;
  // spread: how much the brightness varies (a texture varies; one flat colour, like an overlay's colours without its see-through waves, doesn't)
  return { chroma: sum / n, r: r / n, g: g / n, b: b / n, spread: Math.sqrt(Math.max(0, l2 / n - mean * mean)) };
}

/** How colourful a picture is (see pictureColour). */
export async function colourfulness(lib: AssetLibrary, id: string): Promise<number | null> {
  return (await pictureColour(lib, id))?.chroma ?? null;
}

/** Whether a floor texture suits a built-in floor when Dragon Drop chooses one by itself: not near black, not grey when the floor has a colour, water bluish. */
async function suitsFloor(lib: AssetLibrary, it: AssetItem, material: string): Promise<boolean> {
  if (OVERLAY.test(it.name)) return false;
  const c = await pictureColour(lib, it.id);
  if (!c) return true; // (can't be looked at: the words chose it)
  if ((c.r + c.g + c.b) / 3 < 25 || c.spread < 3) return false;
  if (COLOURED.has(material) && c.chroma < GREY_BELOW) return false;
  if (WATER.has(material) && !(c.b >= c.r + 10)) return false;
  return true;
}

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

/**
 * A fitting picture of the packs for these words (the first word that finds any wins), a starred one if any fits, else a steady pick by `salt`;
 * with `suits`, one that doesn't suit is passed over (up to 24 are looked at, from the steady pick on).
 */
async function pick(lib: AssetLibrary, cat: string, words: string[], salt: string, suits?: (it: AssetItem) => Promise<boolean>): Promise<AssetItem | null> {
  for (const w of words) {
    const listed = lib.list({ cat, q: w, limit: 200 }).items;
    // (a pack's pieces that end a wall or stand at its corners ("Stone Wall end" beside "Stone Wall") can't be laid along a whole wall)
    const whole = listed.filter((i) => !PIECE.test(i.name));
    const found = whole.length ? whole : listed;
    if (!found.length) continue;
    const starred = found.filter((i) => i.favourite);
    for (const pool of starred.length ? [starred, found] : [found]) {
      const start = hash(`${salt}|${w}`) % pool.length;
      for (let k = 0; k < Math.min(pool.length, suits ? 24 : 1); k++) {
        const it = pool[(start + k) % pool.length];
        if (!suits || await suits(it)) return it;
      }
    }
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
    const it = await pick(lib, "terrain", FLOOR_WORDS[mat.name] ?? [mat.name], `${seed}|${mat.name}`, (it) => suitsFloor(lib, it, mat.name));
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
    const it = await pick(lib, "walls", ["stone wall", "stone", "brick", "wall"], `${seed}|wall`);
    if (it) { for (const w of walls) if (plain(w)) w.asset = it.id; notes.push(`walls: ${it.name}`); }
  }
  for (const [kind, words] of [["door", ["door"]], ["window", ["window"]]] as [MapWall["kind"], string[]][]) {
    if (!walls.some((w) => w.kind === kind && !w.portal)) continue;
    const it = await pick(lib, "portals", words, `${seed}|${kind}`);
    if (it) { for (const w of walls) if (w.kind === kind && !w.portal) w.portal = it.id; notes.push(`${kind}s: ${it.name}`); }
  }
  return notes;
}
