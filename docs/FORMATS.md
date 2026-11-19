# Files Dragon Drop reads and writes

This is the list of file types the program works with, so you know what to expect before you try. It is made from one list in the code
(`packages/core/src/formats.ts`), and a test fails if the two disagree, so it stays true. Where something does not work, or has not been tried in
the real program yet, the table says so.

<!-- formats:start (made by `pnpm formats` from packages/core/src/formats.ts; edit that file, not this part) -->

### What Dragon Drop reads

| Format | Files | Used for | Limits |
|---|---|---|---|
| **Dragon Drop maps** | a map folder: `project.json`, `features.json`, `brief.md`, `chat.json`, the gzipped height file | Opening and keeping your maps (world maps, regional maps and battlemaps). | Maps from older versions are upgraded when opened (a copy is kept first). A map from a newer Dragon Drop is refused and left untouched. Maps made in other programs can't be opened. See [MAP-FILES.md](MAP-FILES.md). |
| **Reference pictures** | .png, .jpg, .jpeg | Pictures you attach in the chat, shown to Claude, turned into terrain (sketch import) or compared with the map. | PNG and JPEG only. Other pictures (WebP, GIF and the like) are not accepted here, and the chat says so. |
| **Asset pictures** | .png, .jpg, .jpeg, .webp (loose in folders) | Objects and floor textures for battlemaps, from folders of pictures. A folder called Floors, Props, Doors and so on says what is inside. | PNG and JPEG are used everywhere. WebP shows in the editor but is left out of exports and previews for now. GIF, BMP, SVG and others are not listed. |
| **Zip files of pictures** | .zip | The same as a folder of pictures, read without unpacking. | Stored and deflated entries, including very large (zip64) archives. Password-protected zip files are skipped. The pictures inside follow the rules for asset pictures. |
| **Asset pack files from other map tools** | a name ending in _pack, or .pck (Godot archives) | The same as a folder of pictures, read in place. | Recognised by their first bytes, whatever they are called. A pack whose author says it may not be used in other programs is listed but never used. Encrypted packs can't be read. The pictures inside follow the rules for asset pictures. |

### What Dragon Drop writes

| Format | Files | Used for | Limits |
|---|---|---|---|
| **Dragon Drop maps** | a map folder in your maps folder | Saving your maps (on every change, with automatic backups). The files are plain JSON and Markdown, and the heights are gzipped 32-bit floats, so other programs can read them. | See [MAP-FILES.md](MAP-FILES.md). |
| **PNG picture** | .png | A world map or a battlemap as a picture (the Export button; for a battlemap also `export_battlemap`). | A battlemap picture keeps its walls and doors; lights and room notes are left out. For a battlemap with several levels it is the picture of the level being worked on. |
| **Zip of PNG tiles** | .zip | A world map too big for one picture, cut into PNG tiles. | Chosen automatically by the Export dialog for very large sizes. |
| **Universal VTT** | .dd2vtt | A battlemap for virtual tabletops: the picture, walls, doors, windows and lights in one file. | Not yet tried in the real programs. A battlemap with several levels gives one file for the level being worked on (the format has no levels). The format has no window or secret door: a window is written as a line that stops movement but not sight, and a secret door as plain wall. |
| **Foundry VTT scene** | -foundry.zip (a picture for each level, a scene file and instructions) | A battlemap as a Foundry VTT v14 scene: each level of the battlemap becomes a Foundry level with its own picture, walls, doors and lights. | Built from Foundry's published documentation and not yet tried in Foundry itself. No stairs, ladders or holes between levels are made yet: add them in Foundry. |
| **Room key** | .md | The battlemap's numbered room notes (of every level) as a Markdown list, for the DM. | Notes are never drawn into the pictures or the tabletop files. |
| **Preview pictures** | .jpg | What Claude sees when it looks at the map, and what the phone page shows. | Made for looking at, not for printing: use the PNG export for that. |

<!-- formats:end -->

## Not supported (yet)

- Opening maps made in other programs.
- Pictures other than PNG and JPEG as references, and pictures other than PNG, JPEG and WebP as assets (GIF, BMP, SVG, TIFF and AVIF are not listed).
- Exporting a world map as SVG or PDF.
- 3D models, audio and video.

## Good to know

- Your assets are read where they are and are never copied or changed.
- The Settings button **Copy report** describes what is inside your asset library (names and sizes, no pictures), which helps when something is not recognised.
- If a file you expected to work does not show up, check the **Limits** column first, then tell us what it was.
