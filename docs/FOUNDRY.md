# Foundry VTT export, with levels

Goal (2026-11-18): a battlemap made in Dragon Drop imports into **Foundry v14** with its walls, doors, windows, lights and **levels** intact.
Decisions (the DM): target Foundry v14's native Scene Levels; floors are stacked inside one battlemap with a level switcher; stairs, ladders and holes
are objects placed in the editor that become Change Level regions on export.

## How Foundry v14 stores levels

From Foundry's own v14 API documentation (foundryvtt.com/api/v14, read 2026-11-18). Foundry itself could not be run while writing this, so anything not
in the documentation is marked as a guess.

| Thing | What the documentation says |
|---|---|
| Scene | has `levels` (embedded Level documents) and `initialLevel` (a level id). It has **no background picture** of its own: each level has one. |
| Level | `_id`, `name`, `sort`, `elevation: { bottom, top }`, `background` (a picture, with `src`), `foreground` (a picture drawn above tokens), `fog`, `textures`, `visibility: { levels }` (the other levels it can see). |
| Wall | the usual `c`, `door`, `ds`, `move`, `sight`, `light`, `sound`, `dir`, `threshold`, plus `levels` (a set of level ids). |
| Ambient light | `x`, `y`, `elevation`, `config`, `walls`, `vision`, `hidden`, plus `levels`. |
| Tile | `texture`, `elevation`, `x`, `y`, `width`, `height`, `occlusion`, `restrictions`, plus `levels`. |
| Region | has a **Change Level** behaviour (moves tokens between levels: stairs) and a **Define Surface** behaviour (floors and ceilings that stop light, movement, sight, sound). |

Community guides (foundrymods.com) add: a blank `levels` set means *all* levels; new placeables are tagged to the active level only; a hole has to be cut on
every level below it; a stair is a Change Level region placed in the lower level's band that lists both levels.

## What Dragon Drop writes today

`packages/core/src/foundryScene.ts` builds a v14 scene from a list of levels. Each level has a name, an elevation range in feet, a background picture and its
walls and lights (in grid squares); walls and lights are tagged with their level's id, lights sit at their level's floor. A one-floor battlemap is a scene
with one level (`toFoundryScene` in `battle.ts`). Ids are 16 letters and digits made from the name, so exporting again doesn't change them.

Stair regions are built but **off by default**: the stored shape of a Change Level behaviour isn't in the documentation (`type: "changeLevel"` is what the
Dungeon Alchemist level importer's page calls it, and the fields of its `system` are unknown), and an unknown shape could make Foundry refuse the whole
scene. They are written to a separate file in the test zip.

## Still to check in a real Foundry

1. Does a scene with only `levels` (no top-level `background`) import, and does each level show its own picture?
2. Is `visibility: { levels: [] }` right for "this level sees only itself"?
3. Are walls and lights tagged to one level behaving per level (sight and light stop at the level boundary)?
4. The Change Level behaviour: its `type` and `system` fields; whether the region needs `levels` and `elevation` as written.
5. Define Surface regions for floors and ceilings and for holes: their stored shape.
6. What Foundry does with `darkness` / `environment.darknessLevel` per scene (and whether v14 moved it onto levels).
7. Light `config` fields (`coloration`, `luminosity`, `attenuation`): same meaning in v14?

**To run these tests on a PC that has Foundry:** `pnpm foundry-kit` makes a folder (the handoff for Claude Code, the test scenes, what the Export button writes for an ordinary
battlemap, and the results templates) from [foundry-test-kit/](foundry-test-kit/). Give that folder to Claude Code on that PC; it walks the person through the tests and leaves a
results folder with a filled-in `RESULTS.md`, Foundry's own exported JSON, and a dependency-free test that pins down what Foundry really did.

The fastest way to settle 4 and 5 and most of the rest: build a tiny two-level scene by hand in Foundry (two levels, a wall and a light on each, a Change Level
region, a Define Surface region), Export Data, and read the JSON.

`pnpm exec tsx scripts/foundry-test-scene.ts <folder>` writes `dragon-drop-foundry-levels-test.zip`: two pictures, the scene without stairs, the same with a
stair region, and a README with what to look at.

## Stage 2: levels inside a battlemap (built 2026-11-19; design as decided)

How levels live inside one battlemap, chosen to touch as little of the working editor as possible:

- **A level is a floor document of its own.** A battlemap project holds one or more levels. Level 1 is the battlemap exactly as it is today (`project.json`, `features.json`,
  `map/`), so every existing map is already a one-level map and nothing on disk changes for it. Further levels sit in `levels/<id>/` with the same file layout. Every level has
  the same size and grid (copied when a level is added) and its own floor, walls, doors, lights, props, notes, light zones and light level.
- **`levels.json`** at the project root lists them: `{ v: 1, active, levels: [{ id, name, bottom, top }] }` (elevations in feet; the first entry is level 1). No file means one level,
  "Ground floor", 0 to 10 ft.
- **One level is active.** The editor, Claude's tools, selection and undo all work on the active level, so every existing tool keeps working unchanged. Switching level swaps the
  session the hub works on and sends the editor that level, like opening another map. **Undo is per level** (a level has its own history); a switch does not undo anything.
- **Saving, backups and restore cover every level.** Autosave writes each level that changed; a checkpoint (named or automatic) holds all levels, and restoring it restores all.
- **The editor** has a level bar over the map (the levels from highest to lowest, add above / below, rename and elevations with the pencil, remove with the bin; `Page Up` / `Page Down` switch). The level below shows faintly through any place the level on screen has no floor (the server draws it: `GET /api/projects/<id>/levels/<level>/picture.png`).
- **Exports:** the Foundry scene gets one Foundry level per level (one picture each, walls and lights tagged to it, opening on the level being worked on); the picture, the Universal VTT file and the one-level exports are of the level on screen, named with it (`<map>-<level>.dd2vtt`); the key covers every level.
- **Limits, on purpose:** undo is per level (a level switch undoes nothing). The first level can't be removed (it holds the project's own files; rename it or clear it). At most 12 levels. Restoring a checkpoint puts back every level, including ones removed since (a name clash gets "(restored)"). Removing a level saves a checkpoint first.
- Stairs, ladders and holes between levels are stage 3.

## Plan

1. **(done) Export format.** The v14 level-aware builder, one level from a battlemap, and the test scene.
2. **(done) Levels in the battlemap, with the export of every level.** A battlemap holds several named levels with elevation ranges; each has its own floors, walls, doors, lights and props. The
   editor gets a level switcher, with the level below shown faintly while you draw. Renderer, saving and undo know about levels. A one-floor map is a map
   with one level, so nothing changes for existing maps.
3. **Connections.** Stair, ladder and hole objects between levels; the export adds a foreground picture for a roof, stairs as Change Level regions, holes as openings.
   Needs the reference JSON above. (The export already writes one picture per level, everything tagged to its level.)
4. **Claude and the rest.** Tools to add levels and connect them, level-aware versions of the room, wall, door and light tools, instructions, docs, and
   Universal VTT written once per level.
