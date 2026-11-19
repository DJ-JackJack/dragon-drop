# Foundry VTT export, with levels

Goal (2026-11-18): a battlemap made in Dragon Drop imports into **Foundry v14** with its walls, doors, windows, lights and **levels** intact.
Decisions (the DM): target Foundry v14's native Scene Levels; floors are stacked inside one battlemap with a level switcher; stairs, ladders and holes
are objects placed in the editor that become Change Level regions on export.

## How Foundry v14 stores levels

From Foundry's own v14 API documentation (foundryvtt.com/api/v14, read 2026-11-18). The results of trying it in a real Foundry are further down.

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
walls and lights (in grid squares); walls and lights are tagged with their level's id, lights sit at their level's floor. A battlemap of one level is a scene
with one level (`toFoundryScene` in `battle.ts`); several levels give one Foundry level each (`toFoundryLevelsScene`). Ids are 16 letters and digits made
from the name, so exporting again doesn't change them. **Every scene carries `_stats.coreVersion` (`FOUNDRY_CORE_VERSION`, "14.353"): see the first result below.**

Stairs, floors, ceilings and holes are written as regions whenever the input has them (`stairs` and `surfaces` of `FoundrySceneInput`); the editor has no objects that produce them yet (stage 3).

## Results of the first run in a real Foundry (v14 build 367, 2026-11-18)

Run by Claude Code driving the person's Foundry (a throwaway dnd5e world); the full report, Foundry's own exported JSON and a test that pins the facts are in
[foundry-test-kit/results/v14.367/](foundry-test-kit/results/v14.367/). Nothing was seen by the person's own eye: it is Claude's reading of screenshots and Foundry's own
client API. **A live player client and the visual effect of floors and holes were not looked at.**

**The headline: every scene Dragon Drop wrote lost its levels on import, silently.** A scene file with no `_stats.coreVersion` is treated as old data, and
Foundry's migration replaces the levels with one empty default level ("successfully imported", grey scene, no picture, no walls, no lights). With
`_stats: { coreVersion }` of 14.353 or newer (up to the running build; a newer one is refused as "from a newer version") the same file imports with levels, pictures,
walls, lights and regions exactly as written. We now write it, and a test (`apps/server/test/foundryTested.test.ts`) keeps today's one-level export equal to the file
that was tried, apart from that value.

| # | Question | Answer |
|---|---|---|
| 1 | Scene with only `levels` imports, each level its own picture | **yes**, once the build is stated (above) |
| 2 | `visibility: { levels: [] }`: a level sees only itself | **yes** (Foundry's `Level#isVisible` rule: the viewed level, or one listed in its `visibility.levels`) |
| 3 | Walls and lights tagged to one level work per level | **yes**: sight and light stop at the level boundary |
| 4 | Change Level behaviour | **yes**: `type: "changeLevel"`, `system: { movementActions: [] }` (empty = every kind of movement). Our stair region, with `levels` = both levels, walked onto from the cellar, offered "move to Ground floor?" and Move Up worked |
| 5 | Floors, ceilings, holes (Define Surface) | **yes**, as stored when made by hand: `type: "defineSurface"`, `system: { placement, light, move, sight, sound, occlusion, exposure, culling }` (defaults: placement "bottom", the five blockers true, exposure and culling false). A **floor** is a region on the upper level (`levels: [Up]`, `elevation` its band) with placement `"bottom"`; a **ceiling** is a region on the lower level with placement `"top"`; a **hole** is an extra shape of the floor's region with `hole: true` |
| 6 | Darkness | **per scene**, `environment.darknessLevel`; the old top-level `darkness` is dropped, and nothing of the kind works on a level. We write only `environment.darknessLevel` now |
| 7 | Light `config` | **yes**: `coloration 1`, `luminosity 0.5`, `attenuation 0.5`, `alpha 0.5` are what Foundry gives a hand-made light; `bright` and `dim` are in feet |

The one-level export (picture, 20 x 14 squares at 70 px): the picture lines up with Foundry's grid; all 18 walls lie on the drawn walls; doors start closed and open
when clicked; the window blocks movement but not sight; a secret door blocks sight and is hidden from players (checked through Foundry's own code, not a live player);
both lights are where and what colour they should be.

**Also found:**
- The first two-level test scene laid its door, window and secret door over unbroken room walls, so opening them opened nothing. The editor's real walls are already cut around
  openings; the test scene is fixed to do the same.
- **Universal VTT** into the Universal Battlemap Importer 6.1.1: picture, grid, walls, doors, the secret door (as a wall) and both lights came through; **the window did not**
  (nothing covers it, so tokens walk and see through the gap), the importer makes many zero-length walls of its own, and its lights are very faint (`alpha 0.05`). It made only two
  kinds of wall (full walls and doors), so the format can't carry a see-through wall into it. **Decided:** a window and an invisible wall are now written as plain walls in the
  `.dd2vtt` (a safe, predictable result everywhere), and the export dialog tells Foundry users to use the Foundry scene export, which keeps them.
- Foundry's own Window tool stores a proximity wall (`sight 30, light 30`, thresholds 10 ft); ours (`sight 0, light 0`) lets sight through and stops movement as intended.
- Foundry gives regions drawn by hand `visibility: 4`; we now write that for stairs too.

### Second run: the fix, and our own floors, holes and stair (same day)

Report: [foundry-test-kit/results/v14.367/RESULTS-RETEST.md](foundry-test-kit/results/v14.367/RESULTS-RETEST.md). Again by Claude driving the person's Foundry; the files were
imported exactly as written, with `_stats.coreVersion` "14.353".

- **The fix works.** The one-level export keeps its level, picture, walls, doors, window, secret door and lights; the round trip differs from the first run's variant only in ids
  and `_stats` (Foundry writes back its own build, 14.367).
- **Dim maps work as written:** `environment.darknessLevel: 0.75` shows as Darkness Level 0.75 in Scene Configuration and the scene looks dark except round the lights.
- **The repaired two-level scene behaves:** an opened door now lets sight through, the window lets sight through and stops movement, the secret door blocks both.
- **Our floor, ceiling, hole and stair regions import with everything unchanged** (shapes including the hole flag, levels, behaviour type and settings, `visibility: 4`), the Define
  Surface panels show the values written, the hole is drawn as a gap in the floor, and the stair offers "Move to Ground floor?". **One difference:** a stair's
  `elevation.topInclusive` was written false and stored true (cause not found; nothing depended on it).
- **Not looked at:** whether a floor, hole or ceiling does anything to a token (two drags into the hole did nothing, so it was dropped), and a live player client.

## Still to check in a real Foundry

- What floors, ceilings and holes do in play (movement, sight and light across a hole, and seeing the level below through it): their stored data is right, their effect was not looked at.
- A live player client (secret door icon; what players see on each level).
- Stairs and holes made from objects in the editor, once they exist (stage 3): the test scene's stair and hole imported and the stair worked; the real ones follow the same shape.
- Why a stair's `topInclusive` comes back true when written false.
- A newer Foundry build (14.370 was out): the `coreVersion` rule might change.

**To run tests on a PC that has Foundry:** `pnpm foundry-kit` makes a folder (the handoff for Claude Code, the test scenes, what the Export button writes for an ordinary
battlemap, and the results templates) from [foundry-test-kit/](foundry-test-kit/). Give that folder to Claude Code on that PC; it leaves a results folder with a filled-in
`RESULTS.md`, Foundry's own exported JSON, and a dependency-free test that pins down what Foundry really did.

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
- Stairs, ladders and holes between levels are stage 3 (below).

## Stage 3: stairs, ladders and holes (built 2026-11-19)

- **The model:** `MapConnector` (`features.ts`): a rectangle in squares on the level it starts on, `kind` stairs, ladder or hole, `to` up or down (a hole always leads down). It is stored
  in that level's `features.json` (`connectors`), so undo, checkpoints and copy/paste work as for any feature. "Up" and "down" mean the next level above or below **by elevation**, not an id,
  so renaming or re-elevating levels needs no fixing up.
- **The editor:** the Stairs (`T`), Ladder (`J`) and Hole (`O`) tools drag a rectangle (or click for the usual size), the inspector sets kind, direction, name and size and says which level it
  leads to, and a ▲ or ▼ is drawn on each. The pictures (pale stone steps, a wooden ladder, a dark pit with a stone rim) are painted into the shared wall layer under the walls, so the
  editor, the previews and the exported pictures show the same thing. The level below shows through the empty parts of the level you are on, so the stairs from below show where they land.
- **The Foundry scene:** a stair or ladder is a Change Level region over the two levels it joins (the one stair counts once if it is drawn on both levels). A level with holes gets a floor
  region built from its real floor (rectangles; a square at a time if there would be too many) with the holes cut out of it as extra shapes. A connector that leads to a level that isn't
  there is left out and the export's README says which. `toFoundryLevelsScene` does it (`foundryConnectors` in `battle.ts`).
- **Not done:** a hole is a pit in the picture, so you can't see the level below through it (the exported pictures are opaque); what a hole, floor or stair does to a token beyond the Change Level
  dialog has not been looked at in Foundry; no roof; Claude has no tools for stairs yet (stage 4).

## Plan

1. **(done) Export format.** The v14 level-aware builder, one level from a battlemap, and the test scene.
2. **(done) Levels in the battlemap, with the export of every level.** A battlemap holds several named levels with elevation ranges; each has its own floors, walls, doors, lights and props. The
   editor gets a level switcher, with the level below shown faintly while you draw. Renderer, saving and undo know about levels. A one-floor map is a map
   with one level, so nothing changes for existing maps.
3. **(done, except the roof) Connections.** Stair, ladder and hole objects between levels (see "Stage 3" below). Not done: a foreground picture for a roof (there is no roof object yet).
   (The export already writes one picture per level, everything tagged to its level.)
4. **Claude and the rest.** Tools to add levels and connect them, level-aware versions of the room, wall, door and light tools, instructions, docs, and
   Universal VTT written once per level.
