/**
 * What kind of asset a picture is (a floor texture, an object, a wall, a door...), from its path alone, for any library: a pack file's own layout
 * (`textures/<kind>/`, also under `packs/<id>/`), else the words in its folders' names (the deepest that says so wins), else the words in its file name.
 * No asset packs ship with Dragon Drop: every buyer brings their own, laid out their own way, so this reads words ("Floor Textures", "Stone_Floors",
 * "Furniture & Props", "WoodFloor01.png"), not exact folder names. A pack's own files that aren't assets (its thumbnails, its cover picture, the hidden
 * "._" copies a Mac puts in a zip) count as data, never offered.
 */
import type { AssetCategory } from "./assets.ts";
import { ASSET_PICTURE_EXT as IMAGE_EXT } from "./formats.ts";

/** A pack file's own `textures/<kind>/` folders. */
const LAYOUT_KINDS = new Map<string, AssetCategory>(Object.entries({
  objects: "objects", terrain: "terrain", tilesets: "terrain", materials: "terrain", walls: "walls", paths: "paths", portals: "portals",
  patterns: "patterns", lights: "lights", roofs: "roofs",
} as Record<string, AssetCategory>));

/** A folder whose whole name is one of these is that kind (as before words were read). */
const FOLDER_KINDS = new Map<string, AssetCategory>(Object.entries({
  object: "objects", objects: "objects", prop: "objects", props: "objects", furniture: "objects", item: "objects", items: "objects", decor: "objects", decoration: "objects", decorations: "objects",
  terrain: "terrain", terrains: "terrain", floor: "terrain", floors: "terrain", flooring: "terrain", tile: "terrain", tiles: "terrain", ground: "terrain", tileset: "terrain", tilesets: "terrain",
  wall: "walls", walls: "walls",
  path: "paths", paths: "paths", road: "paths", roads: "paths",
  portal: "portals", portals: "portals", door: "portals", doors: "portals", window: "portals", windows: "portals",
  roof: "roofs", roofs: "roofs",
  pattern: "patterns", patterns: "patterns",
  light: "lights", lights: "lights",
} as Record<string, AssetCategory>));

type Kind = Exclude<AssetCategory, "other" | "data">;

/**
 * Words that say what a picture is, by how surely: a kind's own name (3), a thing typical of it (2), a hint (1). A name decides when its best kind has
 * at least 2 and more than any other ("Roof Tiles" is a roof: 3 against tiles' 1; "Wall Decorations" ties, so a folder above it decides).
 */
const WORDS: Record<Kind, [number, string][]> = {
  objects: [
    [3, "object prop furniture furnishing item decor decoration clutter scatter"],
    [2, "table chair bench stool bed barrel crate chest box sack bag shelf bookshelf bookcase cabinet wardrobe desk throne statue altar fountain cart wagon boat ship " +
      "tree bush shrub plant flower mushroom fungus rock boulder stump log debris rubble bone skull skeleton corpse weapon armour armor rug banner candle brazier campfire " +
      "fireplace pillar column tent vegetation foliage flora tombstone gravestone grave coffin sarcophagus pot vase bottle book scroll coin treasure anvil forge cauldron"],
  ],
  terrain: [
    [3, "terrain floor flooring ground tileset"],
    [2, "grass dirt mud sand gravel snow ice cobble cobblestone flagstone parquet carpet marble pavement paving soil earth moss lava swamp seamless tileable material"],
    [1, "texture tile"],
  ],
  walls: [[3, "wall walling fence palisade"], [2, "hedge"], [1, "cliff"]],
  paths: [[3, "path road trail track"], [1, "river stream"]],
  portals: [[3, "portal door doorway gate window portcullis archway"], [1, "arch"]],
  roofs: [[3, "roof roofing rooftop shingle thatch"]],
  lights: [[3, "light lighting glow"]],
  patterns: [[3, "pattern"]],
};

const WEIGHT = new Map<string, [Kind, number]>();
for (const [kind, groups] of Object.entries(WORDS) as [Kind, [number, string][]][]) for (const [w, list] of groups) for (const word of list.split(" ")) if (!WEIGHT.has(word)) WEIGHT.set(word, [kind, w]);

/** A word as the lists have it: "Tilesets" is tileset, "Bushes" bush, "Shelves" shelf, "Furnishings" furnishing. */
function known(word: string): [Kind, number] | undefined {
  const w = word.toLowerCase();
  for (const v of [w, w.replace(/ies$/, "y"), w.replace(/ves$/, "f"), w.replace(/es$/, ""), w.replace(/s$/, "")]) { const k = WEIGHT.get(v); if (k) return k; }
  return undefined;
}

/** The words in a folder or file name: "StoneFloor_Tiles-02" is stone, floor, tiles. */
export function nameWords(name: string): string[] {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z]+/).filter((w) => w.length > 1);
}

/** The kind a name's words point to, or undefined when they don't (no kind word, or a tie). */
export function kindOfName(name: string): Kind | undefined {
  const score = new Map<Kind, number>();
  for (const w of new Set(nameWords(name).map((x) => x.toLowerCase()))) { const k = known(w); if (k) score.set(k[0], (score.get(k[0]) ?? 0) + k[1]); }
  let best: Kind | undefined, top = 0, second = 0;
  for (const [k, s] of score) { if (s > top) { second = top; top = s; best = k; } else if (s > second) second = s; }
  return best && top >= 2 && top > second ? best : undefined;
}

/** A pack's own files that aren't assets: its thumbnails and cover picture, and a Mac's hidden copies in a zip. */
const NOT_ASSETS = /(^|\/)(thumbnails|thumbs|__macosx)\/|(^|\/)\._[^/]*$|^(packs\/[^/]+\/)?preview\.(png|jpe?g|webp)$/i;

// (a folder's verdict is the same for every picture in it: worked out once per folder; the memo is emptied if a huge library outgrows it)
const folderMemo = new Map<string, AssetCategory | null>();

function folderKind(dir: string): AssetCategory | null {
  const had = folderMemo.get(dir);
  if (had !== undefined) return had;
  let found: AssetCategory | null = null;
  const layout = /^(?:packs\/[^/]+\/)?textures\/([^/]+)(?:\/|$)/i.exec(dir);
  const layoutKind = layout ? LAYOUT_KINDS.get(layout[1].toLowerCase()) : undefined;
  if (layoutKind) found = layoutKind; // (a pack file's layout says it outright: everything under textures/objects/ is an object, even in a folder called "terrain")
  else {
    const folders = dir.split("/").filter(Boolean);
    for (let i = folders.length - 1; i >= 0 && !found; i--) found = FOLDER_KINDS.get(folders[i].toLowerCase()) ?? kindOfName(folders[i]) ?? null;
  }
  if (folderMemo.size > 50_000) folderMemo.clear();
  folderMemo.set(dir, found);
  return found;
}

/**
 * What a pack's own name says its pictures are, for the ones whose paths say nothing: a folder called "Floor Textures" or "Dungeon Doors.zip" with
 * nameless pictures straight inside. Undefined when it says nothing.
 */
export function kindOfPackName(name: string): Kind | undefined {
  const base = name.replace(/\.(zip|pck)$/i, "");
  return kindOfName(base) ?? (nameWords(base).some((w) => /^(textures?|tiles?)$/i.test(w)) ? "terrain" : undefined);
}

export function categoryOf(path: string): AssetCategory {
  if (!IMAGE_EXT.test(path) || NOT_ASSETS.test(path)) return "data";
  const slash = path.lastIndexOf("/");
  const fromFolders = slash > 0 ? folderKind(path.slice(0, slash)) : null;
  if (fromFolders) return fromFolders;
  const file = path.slice(slash + 1).replace(/\.[^.]+$/, "");
  const fromFile = kindOfName(file);
  if (fromFile) return fromFile;
  // last, a hint: a "Textures" or "Tiles" folder (not a pack file's textures/ root) or file name, with nothing else said, holds floor textures
  const names = (slash > 0 ? path.slice(0, slash).replace(/^(?:packs\/[^/]+\/)?textures(?:\/|$)/i, "").split("/") : []).concat(file);
  return names.some((n) => nameWords(n).some((w) => /^(textures?|tiles?)$/i.test(w))) ? "terrain" : "other";
}
