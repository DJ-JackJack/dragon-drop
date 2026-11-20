# Your map files

Every map is a plain folder on your PC. Nothing is stored in an account or in the cloud, and nothing in it is locked to Dragon Drop: you can copy it, back it up, or open its files in other tools. Maps live in the maps folder you chose at first start (by default `Documents\Dragon Drop\projects`), one folder per map:

```
projects\<map-name>\
  project.json              the map's settings: name, size, scale, sea level, climate, style, grid, title and scale bar, `formatVersion`
  features.json             places, labels, roads, borders, climate regions, reefs, river sources (battlemaps: walls, doors, lights, notes)
  brief.md                  your notes about the map, shared with Claude
  chat.json                 the chat history with Claude
  refs\                     your reference pictures (the References panel)
  exports\                  files you exported for a tabletop program
  map\
    height.f32.gz           the terrain: one 32-bit float per pixel (metres; a battlemap stores floor material numbers instead), row by row,
                            little-endian, gzip-compressed
    base-climate.bin.gz     regional maps only: the climate carried over from the parent map
    checkpoints\            restore points: the ones you save and the automatic ones (below)
    previews\               small pictures made for the chat
  backups\                  copies of the files from before a map was brought up to a newer file format (below),
                            and removed-pictures\, where a picture you remove from References goes
  levels.json               battlemaps with more than one level: the levels, their names and elevations (a map with one level has no such file)
  levels\<id>\              each further level of a battlemap: the same files as above (features.json, map\ and so on). The first level is the map's own files
```

`project.json` and `features.json` are plain JSON. A battlemap can have several levels (a cellar, a ground floor, an attic). The first level is the map exactly as a one-level battlemap is kept, so a map that never gets a second level is stored just as before. Checkpoints hold every level. To read the terrain elsewhere, unzip `height.f32.gz` and read it as a flat array of little-endian `float32` values, `width × height` of them (both are in `project.json`).

## How your maps are kept safe

- **Saves are automatic**, a moment after every change, and each file is written to a temporary file and then renamed into place, so a crash in the middle never leaves a half-written file.
- **Automatic backups.** While you edit, Dragon Drop saves the map as a checkpoint named **Auto 2026-11-18 14:05** (your PC's clock) at the first save after you start and then at most every 15 minutes. The newest six are kept and older ones are deleted; checkpoints you save yourself are never deleted. They show in the **Checkpoints** list in the left panel: **Restore** puts the map back as it was (you can undo that). They are kept per map, inside its `map\checkpoints` folder, so deleting a map's `map` folder deletes them too. To change the interval or the count, set `MAPMAKER_AUTO_BACKUP_MINUTES` (0 turns them off) and `MAPMAKER_AUTO_BACKUP_KEEP`.
- **The file format has a version** (`formatVersion` in `project.json`; a map from before the version existed counts as 1).
  - A map from an **older** version is copied into `backups\before-format-<version>-<time>` first, then brought up to date, and you are told.
  - A map from a **newer** version (someone sent you one, or you went back to an older Dragon Drop) is **not opened**: you get a message to update the program, and the files are left exactly as they were. An older program saving it could silently throw away what it doesn't understand.
- **A places-and-labels file that can't be read** (cut off by a crash, damaged by a sync tool) is never overwritten with an empty one. It is renamed to `features.unreadable-<time>.json`, the newest checkpoint's copy is used instead if there is one, and you are told.

## Backing up or moving a map

Close Dragon Drop and copy the map's whole folder (or the whole `projects` folder). Put it in another maps folder to use it there. The only thing that isn't in the folder is the app's own settings (API key, which maps folder to use), which live in `%APPDATA%\Dragon Drop`.

If you use OneDrive or another sync tool on the maps folder, let it finish syncing before you open the same maps on another PC, and don't edit one map on two PCs at the same time.

The other file types Dragon Drop reads (pictures, asset libraries) and writes (PNG, Universal VTT, Foundry scenes) are listed in [FORMATS.md](FORMATS.md).
