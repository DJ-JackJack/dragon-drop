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

### Third run: stairs, a ladder and a floor with holes made by the editor's own writer (2026-11-19)

Report: [foundry-test-kit/results/v14.367/RESULTS-RETEST-2.md](foundry-test-kit/results/v14.367/RESULTS-RETEST-2.md). A two-level scene built from real floors and connectors by `toFoundryLevelsScene`
(the same function the Export button uses), imported as written.

- **Imported and kept, exactly three regions** (the stair drawn on both levels as a landing was dropped, as designed): "Cellar stairs" and the ladder (Change Level over both levels) and
  "Ground floor floor" (Define Surface, two rectangles of the real floor, two holes). Shapes including the hole flags, levels, behaviours and settings are identical to the file.
- **The holes are holes in Foundry's own geometry** (`RegionDocument#testPoint`): points in the floor are true; points in either hole, and in the open corner with no floor, are false. A hole
  on the seam between two floor rectangles becomes a notch in the merged outline, still correct. The Region layer draws the holes and the corner as gaps.
- **Stairs and ladder work in play:** a token walking onto either gets "Do you want to move … to Ground floor?" and Move Up puts it on the Ground floor at elevation 0, standing in the stair's region
  there too (so it is a region on both levels).
- **Still `topInclusive`:** written false, stored true on the two Change Level regions (the single-level floor keeps false). Harmless so far.
- **Not learned:** what a hole does to a token. Tokens placed in a hole and beside it both stayed at elevation 0, nothing fell; and no token on the Ground floor could be dragged in that browser
  pane (also true of the first run), so a move into or out of a hole was never tried, and it is not shown that the floor region is what blocks movement. Looking at this needs a person at the table.

## Still to check in a real Foundry

- What floors, ceilings and holes do in play (movement, sight and light across a hole, and seeing the level below through it): their stored data and geometry are right (third run), their effect on a token was not seen. A person at the table should try walking a token over a hole.
- A live player client (secret door icon; what players see on each level).
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

## Stage 4: Claude's tools and the rest (built 2026-11-19)

- **Tools** (`packages/tools/src/levelTools.ts`, battlemaps only): `list_levels`, `add_level` (above or below; switches to it), `set_active_level` (by id or name; the DM's editor follows),
  `update_level` (name, bottom and top in feet), `add_connector` (stairs, ladder or hole as a rectangle in whole squares), `update_connector`, `remove_connectors` and `list_connectors`;
  `list_battle` now includes the active level's connectors. There is deliberately **no tool to remove a level**: that is the DM's, in the editor (it saves a checkpoint first). Every other battlemap tool
  works on the active level, so Claude switches before it builds; the instructions say so, and to add a level only when the DM asks for a building with floors, a cellar or the like.
  The hub side is `ToolContext.levels` (`Hub.toolContext`).
- **Per-level picture and Universal VTT file:** `export_battlemap` takes `level` (id or name) for `png` and `uvtt`; the file is named with the level. The Export dialog has a level picker for
  those two when the map has several levels (`GET /api/projects/<id>/export/<format>?level=<id>`); the Foundry scene always holds every level and the key covers every level.
- **Not done:** a roof (foreground picture); a Universal VTT file with every level (the format has no levels: one file per level is what the picker is for).

## Roofs (built 2026-11-19, a first version)

- **The model:** `MapRoof` (`features.ts`): a polygon in squares on the level it covers, a look (`slate`, `tile`, `thatch`, `shingle`) or an asset-pack picture tiled across it (`asset`, `tile` squares per
  repeat), an optional `colour` and `flat`. Any level can have roofs. They are stored with the level's features, so undo, checkpoints, copy/paste and box-select work as for the others.
- **The look:** `renderRoofLayer` (`battleRoof.ts`): one see-through layer, a pitched roof having a lit slope, a shadowed slope and a ridge along the longer way, a darker eave and a soft shadow beyond it.
  Asset pictures are loaded for the render worker with the floor textures (`Hub.battleAssets`).
- **Never in the ordinary picture:** roofs are left out of the level's picture, the `.png` and `.dd2vtt` exports, and previews unless asked (`render_battlemap` `roofs: true`; the editor's Roofs switch: faint, solid or hidden).
- **The Foundry scene:** a level with roofs gets a second PNG, `<map>-<n>-<level>-roof.png` (an RGBA picture, transparent outside the roofs), written as that level's `foreground`.
- **What Foundry does with a foreground (test RT6, 14.367; [report](foundry-test-kit/results/v14.367/RESULTS-RETEST-3.md)):**
  - It imports as written; Foundry adds only `tint` and `alphaThreshold` to each foreground, and the level sheet offers only **Texture** and **Tint** for it: no fade or occlusion setting.
  - A viewer sees **only the foreground of the level being viewed** (a level sees others only if listed in its `visibility.levels`, which we leave empty). The level's background is drawn at the level's **bottom**
    elevation and its foreground at its **top**.
  - It is drawn **above the tokens**, tokens under it are hidden, and **it does not fade by itself**: in seven placements (same level, a lower level, elevations 0 and 5, inside and outside the picture, selected and not)
    nothing faded, though both pictures have occlusion mode SURFACE.
  - Foundry's own hint for the Define Surface behaviour says what does fade it: when a controlled or detected token is **below a surface** (a Define Surface region with Occlusion on), Surface-mode tiles
    and the background and foreground textures **at or above that surface** fade. So a roof that fades needs a Define Surface region over it (top surface at or below the foreground's elevation, i.e. the level's top).
  - **What RT6 left open** (a scene with such a region over a foreground; one foreground against several roofs) was asked in RT7.
- **Test RT7 (14.367; [report](foundry-test-kit/results/v14.367/RESULTS-RETEST-4.md)).** Run with the browser pane hidden at first (0 frames a second; fixed with an emulated viewport), so every
  placement was read from a live canvas at about 30 fps.
  - **A foreground with a ceiling region over each roof (regions at the level's top, tokens below them at 0 and 5 ft, inside and outside, selected or not): nothing fades**, neither the whole picture nor the roof
    over the token. Foundry marks the level foreground `_occludedBySameElevationSurfaces: false` (tiles and backgrounds `true`), which fits: a ceiling at the foreground's own elevation does not touch it. Whether a
    ceiling *below* the foreground would is untried. A token at exactly 10 ft could not be set on the Ground floor (the update returned `undefined`).
  - **Tiles:** Foundry stores a tile's `occlusion.mode: 2` as `occlusion.modes: [2]` (a list; write `modes`). **A tile's `x`/`y` is the position of its picture's anchor, and the anchor defaults to the centre (0.5, 0.5)**:
    RT7's tiles were written as if `x`/`y` were the top-left corner (a mistake in our test file), so they sat half off the scene. For a tile that covers (left, top, w, h), write `x = left + w/2`, `y = top + h/2`.
  - **A ceiling region at a tile's own elevation hides a Surface-mode tile inside the region's shape, and it did so with no token on the scene at all** (the part of the blue tile over the region was gone, the part outside
    it stayed, cut exactly along the region's edge; the mesh values stayed `alpha 1, occluded false`, so this shows only on screen). Foundry's hint says a token below the surface triggers the fade, so either a ceiling hides
    such a tile whatever happens, or the GM's own viewpoint (no token) counts as "below" it. What decides it (a token below, above or outside the region; controlled or not) was not tried, because the tiles were off position. RT8 asks.
  - **A polygon region** is kept as written (Foundry drops its `rotation: 0`), `testPoint` is right at all six points tried (inside and outside a triangle), and it is drawn as a triangle. So a roof of any outline can have
    its own ceiling.
  - Define Surface also has `exposure` ("Reveal Elevated Surface": partly reveal the visible area of an elevated surface to observers below and outside of it; "useful for roofs") and `culling`; neither was tried.

## Plan

1. **(done) Export format.** The v14 level-aware builder, one level from a battlemap, and the test scene.
2. **(done) Levels in the battlemap, with the export of every level.** A battlemap holds several named levels with elevation ranges; each has its own floors, walls, doors, lights and props. The
   editor gets a level switcher, with the level below shown faintly while you draw. Renderer, saving and undo know about levels. A one-floor map is a map
   with one level, so nothing changes for existing maps.
3. **(done, except the roof) Connections.** Stair, ladder and hole objects between levels (see "Stage 3" below). Not done: a foreground picture for a roof (there is no roof object yet).
   (The export already writes one picture per level, everything tagged to its level.)
4. **Claude and the rest.** Tools to add levels and connect them, level-aware versions of the room, wall, door and light tools, instructions, docs, and
   Universal VTT written once per level.
