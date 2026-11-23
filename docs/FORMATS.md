# Files Dragon Drop reads and writes

This is the list of file types the program works with, so you know what to expect before you try. It is made from one list in the code
(`packages/core/src/formats.ts`), and a test fails if the two disagree, so it stays true. Where something does not work, or has not been tried in
the real program yet, the table says so.

<!-- formats:start (made by `pnpm formats` from packages/core/src/formats.ts; edit that file, not this part) -->

### What Dragon Drop reads

| Format | Files | Used for | Limits |
|---|---|---|---|
| **Dragon Drop maps** | a map folder: `project.json`, `features.json`, `brief.md`, `chat.json`, the gzipped height file | Opening and keeping your maps (world maps, regional maps and battlemaps). | Maps from older versions are upgraded when opened (a copy is kept first). A map from a newer Dragon Drop is refused and left untouched, and so is a city map by a Dragon Drop from before city maps (they are saved in file format 2; every other map stays in format 1). Maps made in other programs can't be opened. See [MAP-FILES.md](MAP-FILES.md). |
| **Reference pictures** | .png, .jpg, .jpeg, .webp | Pictures you add in the References panel (Add picture, or a picture dropped or pasted anywhere in the window) or attach in the chat: shown to Claude, turned into terrain (sketch import) or compared with the map. | PNG, JPEG and WebP (a still picture: an animated WebP is not read), up to 30 MB each. Other kinds (GIF, an iPhone's HEIC photos, AVIF, BMP, TIFF, SVG, PDF) are refused with a note saying how to save them as one that works. What a file is comes from its contents, not its name. |
| **Asset pictures** | .png, .jpg, .jpeg, .webp (loose in folders) | Objects and floor textures for battlemaps, from folders of pictures. The words in folder and file names say what each picture is (Floor Textures, Furniture & Props, WoodenDoors, oak_table.png...). | PNG, JPEG and WebP are used everywhere: in the editor, in previews and in exports. An animated WebP is skipped (only still pictures are drawn), and a picture over 40 million pixels is too big to draw. GIF, BMP, SVG and others are not listed. |
| **Zip files of pictures** | .zip | The same as a folder of pictures, read without unpacking. | Stored and deflated entries, including very large (zip64) archives. Password-protected zip files are skipped. The pictures inside follow the rules for asset pictures. |
| **Asset pack files from other map tools** | a name ending in _pack, or .pck (Godot archives) | The same as a folder of pictures, read in place. | Recognised by their first bytes, whatever they are called. A pack whose author says it may not be used in other programs is listed but never used. Encrypted packs can't be read. The pictures inside follow the rules for asset pictures. |

### What Dragon Drop writes

| Format | Files | Used for | Limits |
|---|---|---|---|
| **Dragon Drop maps** | a map folder in your maps folder | Saving your maps (on every change, with automatic backups). The files are plain JSON and Markdown, and the heights are gzipped 32-bit floats, so other programs can read them. | See [MAP-FILES.md](MAP-FILES.md). |
| **PNG picture** | .png | A world map or a battlemap as a picture (the Export button; for a battlemap also `export_battlemap`). | A battlemap picture keeps its walls and doors; lights and room notes are left out. For a battlemap with several levels it is the picture of the level being worked on. |
| **Zip of PNG tiles** | .zip | A world map too big for one picture, cut into PNG tiles. | Chosen automatically by the Export dialog for very large sizes. |
| **Universal VTT** | .dd2vtt | A battlemap for virtual tabletops: the picture, walls, doors and lights in one file. | Tried with the Universal Battlemap Importer in Foundry v14: picture, grid, walls, doors and lights come through, but the importer's lights are very faint; not tried in other programs. A battlemap with several levels gives one file for the level being worked on (the format has no levels). The format has no see-through wall, no invisible wall and no secret door: a window, an invisible wall and a secret door are all written as plain walls (a window written any other way was ignored by the importer, leaving a gap tokens could walk through). Foundry's own scene export keeps windows and invisible walls. |
| **Foundry VTT scene** | -foundry.zip (a picture for each level, a see-through picture of each roof, a scene file and instructions) | A battlemap as a Foundry VTT v14 scene: each level of the battlemap becomes a Foundry level with its own picture, walls, doors and lights. | Tried in Foundry v14 (build 367): a one-level battlemap imports with its picture, grid, walls, doors, window, lights and light level, and a two-level scene works per level, including a stair between them. Not tried: a live player view, and a newer Foundry build. Stairs and ladders you place become Change Level regions and holes become gaps in the level's floor region; what a hole does to a token has not been looked at in Foundry. Each roof becomes a tile with a ceiling region over its outline: in Foundry 14.367's GM view it is cut away while a token you control stands under it and stays for every other roof (a hand-made scene of the same kind was tried; an exported one and a player's view have not been). |
| **Room key** | .md | The battlemap's numbered room notes (of every level) as a Markdown list, for the DM. | Notes are never drawn into the pictures or the tabletop files. |
| **Preview pictures** | .jpg | What Claude sees when it looks at the map, and what the phone page shows. | Made for looking at, not for printing: use the PNG export for that. |

<!-- formats:end -->

## Not supported (yet)

- Opening maps made in other programs.
- Animated WebP pictures (only still pictures are read), and pictures other than PNG, JPEG and WebP, as references or as assets (GIF, BMP, SVG, TIFF and AVIF are not listed).
- Exporting a world map as SVG or PDF.
- 3D models, audio and video.

## Good to know

- Your assets are read where they are and are never copied or changed.
- The Settings button **Copy report** describes what is inside your asset library (names and sizes, no pictures), which helps when something is not recognised.
- If a file you expected to work does not show up, check the **Limits** column first, then tell us what it was.
