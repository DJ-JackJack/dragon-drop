/**
 * Every kind of file Dragon Drop reads and writes: the one list. docs/FORMATS.md is made from it (`pnpm formats`), a test fails if the page and this list
 * disagree, and the places that really accept or write these files (the chat's file picker, the asset library, the export routes, the export tool) take their
 * lists from here, so what the page says is what the program does. When a format is added or dropped, change it here and run `pnpm formats`.
 *
 * Keep the wording honest: say what does NOT work (a picture that shows in the editor but is left out of exports), and say when an export has not
 * yet been tried in the real program.
 */

/** Pictures Claude and the map tools can use as references (shown to Claude, sketch import, comparing with the map): the ones the server can decode. */
export const REFERENCE_PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const REFERENCE_PICTURE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
/** For an <input type="file" accept="...">. */
export const REFERENCE_PICTURE_ACCEPT = [...REFERENCE_PICTURE_EXTENSIONS.map((e) => `.${e}`), ...REFERENCE_PICTURE_TYPES].join(",");
export const REFERENCE_PICTURE_EXT = new RegExp(`\\.(${REFERENCE_PICTURE_EXTENSIONS.join("|")})$`, "i");

/** Pictures the asset library lists and draws (still WebP too; an animated WebP can't be drawn and counts as missing). */
export const ASSET_PICTURE_EXTENSIONS = ["png", "webp", "jpg", "jpeg"] as const;
export const ASSET_PICTURE_EXT = new RegExp(`\\.(${ASSET_PICTURE_EXTENSIONS.join("|")})$`, "i");
/** A pack file made by another map tool (a Godot archive): a name ending in "_pack", or ".pck". It is then checked by its first bytes. */
export const PACK_FILE_NAME = /\.pck$|\.[a-z0-9]+_pack$/i;
export const ZIP_FILE_NAME = /\.zip$/i;

/** What a battlemap can be exported as (the Export button, the export_battlemap tool and the download routes). */
export const BATTLE_EXPORT_FORMATS = ["png", "uvtt", "foundry", "key"] as const;
export type BattleExportFormat = (typeof BATTLE_EXPORT_FORMATS)[number];

export interface FormatInfo {
  id: string;
  /** What it is called. */
  name: string;
  /** The files, as a person sees them. */
  files: string;
  /** What it is used for. */
  use: string;
  /** What does not work, and anything that has not been tried yet. */
  limits: string;
  /** For writes that are a battlemap export: its name in BATTLE_EXPORT_FORMATS. */
  exportFormat?: BattleExportFormat;
}

export const FORMATS_READ: FormatInfo[] = [
  {
    id: "map", name: "Dragon Drop maps", files: "a map folder: `project.json`, `features.json`, `brief.md`, `chat.json`, the gzipped height file",
    use: "Opening and keeping your maps (world maps, regional maps and battlemaps).",
    limits: "Maps from older versions are upgraded when opened (a copy is kept first). A map from a newer Dragon Drop is refused and left untouched. Maps made in other programs can't be opened. See [MAP-FILES.md](MAP-FILES.md).",
  },
  {
    id: "reference", name: "Reference pictures", files: ".png, .jpg, .jpeg, .webp",
    use: "Pictures you attach in the chat, shown to Claude, turned into terrain (sketch import) or compared with the map.",
    limits: "PNG, JPEG and WebP (a still picture: an animated WebP is not read). Other pictures (GIF and the like) are not accepted here, and the chat says so.",
  },
  {
    id: "asset-pictures", name: "Asset pictures", files: ".png, .jpg, .jpeg, .webp (loose in folders)",
    use: "Objects and floor textures for battlemaps, from folders of pictures. A folder called Floors, Props, Doors and so on says what is inside.",
    limits: "PNG, JPEG and WebP are used everywhere: in the editor, in previews and in exports. An animated WebP is skipped (only still pictures are drawn), and a picture over 40 million pixels is too big to draw. GIF, BMP, SVG and others are not listed.",
  },
  {
    id: "asset-zip", name: "Zip files of pictures", files: ".zip",
    use: "The same as a folder of pictures, read without unpacking.",
    limits: "Stored and deflated entries, including very large (zip64) archives. Password-protected zip files are skipped. The pictures inside follow the rules for asset pictures.",
  },
  {
    id: "asset-pack", name: "Asset pack files from other map tools", files: "a name ending in _pack, or .pck (Godot archives)",
    use: "The same as a folder of pictures, read in place.",
    limits: "Recognised by their first bytes, whatever they are called. A pack whose author says it may not be used in other programs is listed but never used. Encrypted packs can't be read. The pictures inside follow the rules for asset pictures.",
  },
];

export const FORMATS_WRITTEN: FormatInfo[] = [
  {
    id: "map", name: "Dragon Drop maps", files: "a map folder in your maps folder",
    use: "Saving your maps (on every change, with automatic backups). The files are plain JSON and Markdown, and the heights are gzipped 32-bit floats, so other programs can read them.",
    limits: "See [MAP-FILES.md](MAP-FILES.md).",
  },
  {
    id: "png", name: "PNG picture", files: ".png", exportFormat: "png",
    use: "A world map or a battlemap as a picture (the Export button; for a battlemap also `export_battlemap`).",
    limits: "A battlemap picture keeps its walls and doors; lights and room notes are left out. For a battlemap with several levels it is the picture of the level being worked on.",
  },
  {
    id: "tiles", name: "Zip of PNG tiles", files: ".zip",
    use: "A world map too big for one picture, cut into PNG tiles.",
    limits: "Chosen automatically by the Export dialog for very large sizes.",
  },
  {
    id: "uvtt", name: "Universal VTT", files: ".dd2vtt", exportFormat: "uvtt",
    use: "A battlemap for virtual tabletops: the picture, walls, doors and lights in one file.",
    limits: "Tried with the Universal Battlemap Importer in Foundry v14: picture, grid, walls, doors and lights come through, but the importer's lights are very faint; not tried in other programs. A battlemap with several levels gives one file for the level being worked on (the format has no levels). The format has no see-through wall, no invisible wall and no secret door: a window, an invisible wall and a secret door are all written as plain walls (a window written any other way was ignored by the importer, leaving a gap tokens could walk through). Foundry's own scene export keeps windows and invisible walls.",
  },
  {
    id: "foundry", name: "Foundry VTT scene", files: "-foundry.zip (a picture for each level, a see-through roof picture for a level with roofs, a scene file and instructions)", exportFormat: "foundry",
    use: "A battlemap as a Foundry VTT v14 scene: each level of the battlemap becomes a Foundry level with its own picture, walls, doors and lights.",
    limits: "Tried in Foundry v14 (build 367): a one-level battlemap imports with its picture, grid, walls, doors, window, lights and light level, and a two-level scene works per level, including a stair between them. Not tried: a live player view, and a newer Foundry build. Stairs and ladders you place become Change Level regions and holes become gaps in the level's floor region; what a hole does to a token has not been looked at in Foundry.",
  },
  {
    id: "key", name: "Room key", files: ".md", exportFormat: "key",
    use: "The battlemap's numbered room notes (of every level) as a Markdown list, for the DM.",
    limits: "Notes are never drawn into the pictures or the tabletop files.",
  },
  {
    id: "previews", name: "Preview pictures", files: ".jpg",
    use: "What Claude sees when it looks at the map, and what the phone page shows.",
    limits: "Made for looking at, not for printing: use the PNG export for that.",
  },
];

const cell = (s: string) => s.replace(/\|/g, "\\|");
const table = (rows: FormatInfo[]) =>
  ["| Format | Files | Used for | Limits |", "|---|---|---|---|", ...rows.map((r) => `| **${cell(r.name)}** | ${cell(r.files)} | ${cell(r.use)} | ${cell(r.limits)} |`)].join("\n");

export const FORMATS_START = "<!-- formats:start (made by `pnpm formats` from packages/core/src/formats.ts; edit that file, not this part) -->";
export const FORMATS_END = "<!-- formats:end -->";

/** The two tables, as they stand in docs/FORMATS.md between the markers. */
export function formatsMarkdown(): string {
  return [FORMATS_START, "", "### What Dragon Drop reads", "", table(FORMATS_READ), "", "### What Dragon Drop writes", "", table(FORMATS_WRITTEN), "", FORMATS_END].join("\n");
}
