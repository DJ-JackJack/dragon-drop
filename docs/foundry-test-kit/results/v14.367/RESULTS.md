# Foundry VTT export tests: results

- Foundry version and build: **Foundry Virtual Tabletop Version 14 Build 367** (stable; `game.version` "14.367"). Read from the server log `<Foundry logs folder>\debug.2026-11-18.log` and confirmed in the running game. The log also says update 14.370 is available; it was not installed.
- Browser: the Claude desktop app's built-in browser pane (Chromium), connected to the local Foundry server at `http://localhost:30000`, signed in as the world's user **"CLAUDE GM"** (Gamemaster role). The Foundry desktop app (Electron 41.3.0, Chromium 146) was also running, signed in as "Gamemaster".
- Dragon Drop kit (from VERSION.txt): "Dragon Drop Foundry test kit / made 2026-11-19T01:07:33.593Z / from commit a5b6256"
- Date: 2026-11-18 (local time, EST)
- Throwaway world and game system: **"Dragon Drop Test"** (`dragon-drop-test`, created by the person on 2026-11-18 for this run), system **dnd5e 6.0.1**. No modules were enabled at the start. The Universal Battlemap Importer was enabled for Test 5 only.
- Redactions made (what, and where): every user id in Foundry's exports was replaced with `"REDACTED-USER"`. That covers `_stats.lastModifiedBy` in every `raw/roundtrip-*.json`, `raw/reference-by-hand.json` and `raw/universal-vtt-import.json`, and also a per-user `ownership` key on each hand-built region (`"ownership": {"default": 0, "REDACTED-USER": 3}`). `tools/redact.mjs` did the replacement; it reads the ids from `work/user-ids.txt`, which is not shipped. No licence file or account data was opened.

### Who did what (please read)

The handoff assumed the person would do every Foundry step. Instead, the person asked Claude to **drive Foundry itself** and do every step it could. So every observation below was made by Claude, not by the person's eye: from screenshots of Foundry in the browser pane, plus read-only checks of Foundry's own client API (`canvas`, documents, `testCollision`, and the source of Foundry functions).

The pane couldn't use the operating system's file dialogs, so two steps were done differently:

- **Import Data:** the scene JSON was copied into `<Foundry data folder>\dd-test-import\`, and the exact bytes (SHA-256 checked against the kit) were attached to the Import Data dialog's file field from there. Foundry's own **Import** button then did the import.
- **Export Data:** the pane drops browser downloads. While Foundry's Export Data ran, the file it handed the browser was also saved through Foundry's own uploader into `Data\dd-test-import\exports\`. Those bytes are Foundry's export unchanged (`JSON.stringify(data, null, 2)`), apart from the user-id redaction.

In the same way, tokens were created by sending Foundry's canvas the drop event a drag from the Actors list produces, and scene views were moved with `canvas.pan`. Pictures were copied straight into `<Foundry data folder>\maps\` instead of going through the File Browser's Upload button.

### Variants (not in the handoff)

Every Dragon Drop scene file lost its levels on import (see Q1). So I also imported a **variant of each file with exactly one key added: `"_stats": {"coreVersion": "14.367"}`** (made by `tools/add-coreversion.mjs`). The variants answer Q1 to Q3 and Test 4 for Dragon Drop's actual level and wall data. They are clearly named `*-coreversion*` in `raw/`.

## The seven open questions

| # | Question | Answer (yes / no / partly / not observed) | Evidence (file and key, or screenshot) | Notes |
|---|---|---|---|---|
| Q1 | A scene with only `levels` (no top-level `background`) imports, and each level shows its own picture | **no** as written; **yes** once `_stats.coreVersion` (14.353 to 14.367) is added | `raw/roundtrip-no-stairs.json` `levels`, `initialLevel`; `raw/roundtrip-no-stairs-coreversion.json` `levels[*].background.src`; `screenshots/test1-as-written-levels-tab-one-default-level.jpg`, `test1-variant-cellar-level.jpg`, `test1-variant-ground-floor-level.jpg` | Import reports success, but the files have no `_stats.coreVersion`, so `ClientDocumentMixin.fromImport` asks the server to migrate them as old data. The migration replaces Dragon Drop's levels with one `defaultLevel0000` (named after the scene, 0 to 20, no picture). With the key added, both levels and their pictures are kept and shown per level. |
| Q2 | `visibility: { levels: [] }` makes a level see only itself | **yes** (variant) | `Level#isVisible` source: *visible if it is the viewed level or listed in the viewed level's `visibility.levels`*. While viewing Ground floor, Cellar reported `isVisible: false`. Hand-built `observed/shapes.json` `levels[1].visibility.levels: ["defaultLevel0000"]` | The UI calls this field "Visible Levels" (*"the set of other Levels which are fully or partially visible from this one"*). Dragon Drop's pictures are opaque RGB, so a see-through floor couldn't be checked visually. |
| Q3 | Walls and lights tagged to one level behave per level (sight and light stop at the level boundary) | **yes** (variant); as written nothing is drawn | Variant: viewing Cellar shows 5 walls and only light `#ff8800`; viewing Ground floor shows 7 walls and only `#ffd68c`. Cellar token line of sight `[490,140, 910,140, 910,560, 140,560, 140,500, 490,350]` (shadow of the Cellar cross wall); Ground floor token at the same spot `[140,140, 910,140, 910,560, 140,560]`. `screenshots/test1-variant-*-token-vision.jpg` | As written, all 12 walls and 2 lights keep `levels` pointing at the dropped level ids, and Foundry draws none of them. **In the levels test scene, the door, window and secret door overlap full room walls**, so opening the door or looking through the window still shows nothing beyond (see Surprises). |
| Q4 | The Change Level behaviour: its `type` and every key under `system`; whether the region needs `levels` and `elevation` as Dragon Drop writes them | **yes**: `type: "changeLevel"`, `system: { movementActions: [] }` (the only key) | `observed/shapes.json` `regions[0].behaviors[0]`; `raw/roundtrip-with-stairs*.json` `regions[0].behaviors[0].system`; `screenshots/test2-variant-change-level-dialog.jpg` | `movementActions` is a set of movement action ids (`walk`, `fly`, `swim`, `burrow`, `crawl`, `climb`, `jump`, `blink`, `fall`; `displace` excluded). Empty means *"all movement actions are allowed"* (Foundry's help text). Dragon Drop's `system: {}` is stored as `{movementActions: []}`. Dragon Drop's region (`levels` = both levels, `elevation` -10 to 10) **works** in the variant: walking onto it on the Cellar opened Foundry's "Change Level" dialog, and "Move Up" put the token on the Ground floor at elevation 0. Foundry adds `elevation.topInclusive` (`false`; `true` after the old-data migration). |
| Q5 | Define Surface regions for floors, ceilings and holes: the stored shape | **yes** (built by hand and exported) | `observed/shapes.json` `regions[1]` (floor with hole), `regions[2]` (ceiling); `screenshots/test3-floor-region-with-hole.jpg`, `test3-define-surface-config.jpg` | `type: "defineSurface"`, `system: {placement, light, move, sight, sound, occlusion, exposure, culling}`. Defaults: `placement: "bottom"`, light/move/sight/sound/occlusion `true`, exposure/culling `false`. `placement` is one of `"bottom"`, `"top"`, `"both"`. A **floor** is a region on the upper level (`levels: [Up]`, `elevation` 10 to 20) with placement `"bottom"`; a **ceiling** is a region on the lower level (`levels: [Down]`, `elevation` 0 to 10) with placement `"top"`. A **hole** is not a separate region or behaviour: it is an extra entry in the floor region's `shapes` with `"hole": true`. |
| Q6 | What Foundry does with `darkness` / `environment.darknessLevel` per scene, and whether v14 moved it onto levels | **per scene, not on levels** | `raw/roundtrip-*.json` `environment.darknessLevel: 0`; Level schema fields have no darkness or environment key; in-memory import tests (Test 4 notes) | Dragon Drop writes neither key, so every scene got Foundry's default `environment.darknessLevel: 0` (bright). `environment.darknessLevel` is kept with or without `coreVersion`. The old top-level `darkness` is converted only when the old-data migration runs; with `coreVersion` 14.367 it is dropped. A `darkness` or `environment` placed on a level is dropped. |
| Q7 | Light `config` fields (`coloration`, `luminosity`, `attenuation`): same meaning as Dragon Drop assumes | **yes** | `raw/roundtrip-battlemap-coreversion.json` `lights[*].config`; `observed/shapes.json` `lightsByLevel.*.config`; Test 4 radii | All kept exactly. `coloration: 1` is "Adaptive Luminance". Dragon Drop's `alpha 0.5`, `coloration 1`, `luminosity 0.5`, `attenuation 0.5` are exactly what Foundry gives a light placed by hand. `bright`/`dim` are in scene units (ft): 15/30 ft became a 210/420 px radius (3/6 squares at 70 px per 5 ft). |

## Test 1: two levels, no stairs

Imported `scene-no-stairs.json` as written into a new scene (`raw/roundtrip-no-stairs.json`). Then the `coreVersion` variant went into a second scene (`raw/roundtrip-no-stairs-coreversion.json`).

| | As written | Variant (`_stats.coreVersion` added) |
|---|---|---|
| a. imported without error? | **yes**: *Data for Scene "Dragon Drop test: two levels" was successfully imported from JSON.* No console errors. (The import also renamed the empty scene to the file's `name`.) | yes, same message |
| b. two levels, Cellar -10 to 0 and Ground floor 0 to 10, each with a picture? | **no**: Levels tab lists one level, "Dragon Drop test: two levels" `[0, 20]`, with no picture (`screenshots/test1-as-written-levels-tab-one-default-level.jpg`) | **yes**: Cellar -10..0 `maps/dd-test-cellar.png`, Ground floor 0..10 `maps/dd-test-ground.png`, `initialLevel` Cellar |
| c. each level shows its own picture? | **no**: grey background only | **yes** (`test1-variant-cellar-level.jpg`, `test1-variant-ground-floor-level.jpg`) |
| d. Ground floor: room walls, closed door (north), window (east), secret door (west), only there; Cellar: room wall and cross wall, only there? | **no**: 0 walls drawn on the only level | **yes**: Ground floor shows 7 walls (4 room, `door 1` closed, window `sight 0/light 0/move 20`, `door 2`); Cellar shows 5 (4 room plus cross wall). **But** the door, window and secret door sit on top of full-length room walls. With the north door opened, the token still couldn't see past it, and it can't see out of the window (`test1-variant-north-door-open-still-blocked.jpg`). |
| e. orange torch on Cellar only, white lamp on Ground floor only? | **no**: 0 lights drawn | **yes**: the only active light source while viewing Cellar is `#ff8800`; on the Ground floor it is `#ffd68c` (a warm white, not pure white) |
| f. a token on each level: light and sight per level? | not possible (one level) | **yes**: see Q3 (line-of-sight polygons per level) |

Diffs: `raw/roundtrip-diff-no-stairs.md` (as written) and `raw/roundtrip-diff-no-stairs-coreversion.md` (variant).
- **Kept:** as written, everything except the levels: grid, size, name, every wall's and light's fields including `levels` (which now point at missing levels). The variant kept everything, including both levels with their ids, `sort`, elevations, pictures, `visibility` and `initialLevel`.
- **Changed:** as written, the level list was replaced by `defaultLevel0000` and `initialLevel` changed to `defaultLevel0000`. The variant changed nothing.
- **Dropped:** nothing at field level. As written, the two levels were dropped as whole items. Walls and lights had no `_id` and got new random ones; level ids were kept in the variant.

## Test 2: stair region

- **As written** (`raw/roundtrip-with-stairs.json`): imported with *"Data for Scene "Dragon Drop test: two levels" was successfully imported from JSON."* and no console errors. Again both levels became one `defaultLevel0000`. The region came through: "Cellar stairs", rectangle 770,210 70×140 on the east side, behaviour "Change level" `type: "changeLevel"`, `system: {movementActions: []}`. Its `levels` still list the two removed level ids, and `elevation` gained `topInclusive: true`. Not tested in play, because the scene has only one level.
- **Variant** (`raw/roundtrip-with-stairs-coreversion.json`): the Region's settings show Placement > Levels "Cellar" and "Ground floor", Elevation Bottom -10, Top 10, Top Inclusive off. Behaviors shows "Change level" (enabled), and its Allowed Movement Actions box is empty (`test2-variant-*.jpg`). **The stair works:** a token on the Cellar walked onto the region and got the dialog *"Do you want to move DD Probe to Ground floor?"* (Movement Action: Walk; buttons Move Up / Don't Move). After **Move Up** it stood on the Ground floor (`level` = Ground floor, elevation 0).
- Diffs: `raw/roundtrip-diff-with-stairs.md`, `raw/roundtrip-diff-with-stairs-coreversion.md`. `regions[*].behaviors[*]`: `type` kept as `"changeLevel"`; `system` went from `{}` to `{"movementActions": []}`, and no other key was added. The region gained `restriction`, `attachment`, `highlightMode`, `displayMeasurements`, `hidden`, `_shapeConstraints`, `ownership`, `elevation.topInclusive`, and per shape `anchorX`, `anchorY`, `gridBased`.

## Test 3: built by hand

Built in the Foundry UI, in a new scene "T3 built by hand" (grid 100):

- **Levels:** "Down" 0 to 10 (the scene's default level renamed, id `defaultLevel0000`) and "Up" 10 to 20, with Up's Visible Levels set to Down.
- **Walls:** a plain wall on Down ("Draw Wall") and a wall drawn with v14's **Window** tool on Up.
- **Lights:** one light on each level ("Draw Light Source").
- **"Stairs":** a rectangle region with levels Up and Down, elevation 0 to 20, and a Change Level behaviour.
- **"Upper floor with hole":** a rectangle on Up with a Define Surface behaviour (defaults), plus a second rectangle drawn with **Create Holes**.
- **"Lower ceiling":** a rectangle on Down with Define Surface, Placement "Top".

Exported to `raw/reference-by-hand.json`; extracted to `observed/shapes.json`.

- Change Level: `"type": "changeLevel"`, `system` keys `["movementActions"]` (stored `[]`).
- Define Surface: `"type": "defineSurface"`, `system` keys `["culling", "exposure", "light", "move", "occlusion", "placement", "sight", "sound"]`.
- Hole: `shapes[1].hole: true` inside the floor region.
- Defaults Foundry gave things made in the UI:
  - A new region gets the viewed level as `levels` and that level's range as `elevation`, with `topInclusive: false` and `visibility: 4` ("Only on Region Layer when unlocked").
  - Walls and lights get the viewed level in `levels`; a light's `elevation` is the level's bottom (0 or 10).
  - A light made by hand has `name: "Ambient Light"`.
  - The Window tool stores `move 20, sight 30, light 30, sound 20, threshold {light: 10, sight: 10, sound: null, attenuation: true}`.

## Test 4: the real one-level export

`vtt-test.png` was placed at `Data/maps/vtt-test.png`, as the README says.

- **As written** (`raw/roundtrip-battlemap.json`): imported with *"Data for Scene "VTT test" was successfully imported from JSON."* and no console errors. **The picture is not shown, and no walls or lights are drawn**: the one level "Ground floor" was replaced by `defaultLevel0000` with no picture (`screenshots/test4-as-written-no-picture.jpg`).
- **Variant** (`raw/roundtrip-battlemap-coreversion.json`):
  - **Picture:** shown, 1400 × 980 placed at 0,0, exactly the scene rectangle.
  - **Grid alignment:** **yes.** The grid is 70 px, so the map is 20 × 14 squares. At 3× zoom, the doorway drawn in the top wall coincides with Foundry's door segment 420..490, and both ends sit on grid lines (`test4-variant-top-door-vs-grid-3x.jpg`).
  - **Walls:** **yes**, all 18 lie on the walls drawn in the picture (`test4-variant-walls-layer.jpg`). Here walls are split around the doors and window, with no overlap.
  - **Doors:** 3, all closed (`ds 0`). The top door **opens** when clicked (`ds 1`): sight then passes and light spills out (`test4-variant-top-door-open.jpg`). I closed it again.
  - **Window** (`move 20, sight 0, light 0`): **yes.** Foundry's `testCollision` across it says sight is not blocked and movement is blocked.
  - **Secret door** (`door 2, sight 20`): blocks sight like a wall. Foundry's `DoorControl#isVisible` returns false for secret doors when the user is not a GM, so players get no door icon. The GM sees an icon. Not checked in a live player client.
  - **Lights:** **yes.** Orange `#ff8800` at (420,420), the centre of square (6,6), dim 30 ft = 420 px = 6 squares, bright 15 ft. Warm white `#ffd68c` at (1050,490), square (15,7), dim 25 ft = 350 px = 5 squares, bright 12.5 ft. Both `walls: true`, so they are clipped by walls.
  - **Darkness:** the scene is **bright**: `environment.darknessLevel` 0, which is Foundry's default because Dragon Drop writes none. Scene Configuration > Basics shows "Darkness Level 0". See Q6.
- Diffs: `raw/roundtrip-diff-battlemap.md`, `raw/roundtrip-diff-battlemap-coreversion.md`.

## Test 5: Universal VTT (optional)

- Importer: **Universal Battlemap Importer 6.1.1** (`dd-import`, compatibility minimum, verified and maximum all "14"). It was already installed. I enabled it in the throwaway world (Settings > **Module Management**; the handoff didn't name the menu) and the world reloaded.
- Settings: imported `battlemap-test/vtt-test.dd2vtt` (SHA-256 matches the kit) with the dialog's defaults. That means Storage Type User Data, Convert to WebP on, Set Custom Grid PPI off, Fidelity at minimum, Object Walls on, Padding 0.25, and the Advanced options unchanged. I filled in only Scene Name "T5 UVTT import" and Upload Path `dd-test-import/uvtt`.
- No notification and no console warning were seen. The result is in `raw/universal-vtt-import.json` and `screenshots/test5-universal-importer-walls-layer.jpg`:
  - The picture became `dd-test-import/uvtt/vtt-test.webp` on one level `defaultLevel0000` "vtt-test" (0 to 20); `initialLevel` is null.
  - Padding 0.25 offset everything by (350, 280); the picture's origin equals the scene origin, and the **grid lines up** (70 px).
  - **Walls:** 37, of which 20 are zero-length (both endpoints equal). The rest lie on the drawn walls.
  - **Doors:** 3, all closed. **Secret door:** a plain wall, as intended.
  - **Window: missing.** Dragon Drop wrote it under `objects_line_of_sight`, and no wall covers that span (x 1120, y 630 to 700). Tokens can walk and see through the gap (`testCollision` for movement: not blocked).
  - **Lights:** both, at the right squares, colours `#ff8800` / `#ffd68c`, dim 30 / 25 ft. But the importer set `alpha: 0.05`, so they are very faint.

## Surprises

1. **Every Dragon Drop scene file loses its levels on import, silently.** The files have no `_stats.coreVersion`, so Foundry runs its old-data migration, which rebuilds the levels from the (absent) top-level background. Walls, lights and regions keep pointing at level ids that no longer exist, and the user sees an empty grey scene. The import notification still says "successfully imported".
2. **The `coreVersion` boundary, tested in memory on 14.367:**
   - `14.352` or lower, `14`, `14.0`, `13.351`, `12.331`: levels replaced.
   - `14.353` to `14.367`: levels kept.
   - Anything newer than the running build (`14.368`, `14.370`, `15.1`): the import is refused with *"Documents from a core version newer than the running version cannot be imported"*.
3. **In `scene-no-stairs.json` / `scene-with-stairs.json`, doors and windows lie on top of full room walls.** For example, the north wall runs 140→910 and the door 420→490 sits on it. So opening a door or a window opens nothing. The real battlemap export does not have this problem; it splits walls around openings.
4. Import Data renames the target scene to the file's `name`, so the test scenes all ended up called "Dragon Drop test: two levels" or "VTT test".
5. Foundry's export file name includes the scene name; "Dragon Drop test: two levels" contains `:`, which Windows can't store in a file name.
6. A region's `elevation.topInclusive` comes out `true` after the old-data migration but `false` otherwise. Regions drawn in the UI get `visibility: 4`; Dragon Drop writes `0` ("Only on Region Layer").
7. Foundry's own Window wall is a *proximity* wall (`sight/light 30` with 10 ft thresholds and `attenuation: true`), not `sight 0 / light 0` as Dragon Drop writes. Both let sight through and block movement.
8. The Universal Battlemap Importer drops the `.dd2vtt` window (`objects_line_of_sight`) entirely, makes 20 zero-length walls, and uses `alpha 0.05` for lights.
9. (UI) Drawing a region while another region is selected adds the new rectangle as a shape of the selected region. I undid one such slip during Test 3.

## Suggested changes to Dragon Drop's export

(Suggestions only. Nothing was changed in Dragon Drop.)

1. **Write `_stats: { coreVersion: "<v14 build>" }` in every Foundry scene file.** It must be at least `14.353` and at most the user's own build, so the safest value is the lowest build Dragon Drop supports, e.g. `"14.353"`. Re-test that value on newer builds, since migrations may change.
2. In the multi-level writer, **split walls around doors, windows and secret doors**, as the single-level export already does, instead of laying them over a full wall.
3. Write Change Level behaviours as `{"type": "changeLevel", "system": {"movementActions": []}}`, which is what Foundry stores. Consider writing `elevation.topInclusive: false` explicitly so the value doesn't depend on whether a migration runs.
4. If Dragon Drop ever writes darkness, write it per scene as `environment: { darknessLevel: n }`. Never use the old top-level `darkness`, and never put it on a level (both are dropped).
5. For floors, ceilings and holes in multi-level maps, use the shapes in `observed/shapes.json`: Define Surface `placement: "bottom"` on the upper level's region for a floor, `"top"` on the lower level's region for a ceiling, and holes as extra `shapes` with `hole: true`.
6. Optional: consider Foundry's own Window values (`sight 30, light 30, threshold {sight 10, light 10, attenuation true}`) if Dragon Drop wants windows to behave like Foundry's Window tool.
7. Universal VTT: the importer ignored the window written in `objects_line_of_sight`. It may need to be written another way (for example as a `line_of_sight` segment or a portal); that wasn't tested.

## Not tested, and why

- **Nothing was looked at by the person.** All observations come from Claude's screenshots and Foundry API checks (see "Who did what").
- **A live player client:** the secret door's player view was checked through Foundry's `DoorControl#isVisible` code and the door type only. Making a player view would have meant activating scenes for every connected user.
- **The as-written stair region in play:** that scene has only one level after the migration. The hand-built Stairs region was also not walked; Dragon Drop's own region was, in the variant.
- **Visual effect of Define Surface floors, ceilings and holes** (occlusion, seeing the level below through a hole): only the stored data was recorded. The test pictures are opaque, so a see-through floor (Q2) couldn't be shown visually either.
- **Foundry's own File Browser Upload** and the OS file dialogs: replaced as described above.

## What was left behind outside this folder

- **`<Foundry data folder>\maps\`:** `dd-test-cellar.png`, `dd-test-ground.png`, `vtt-test.png`.
- **`<Foundry data folder>\dd-test-import\`:** the staged scene files, Foundry's export copies in `exports\`, and the importer's `uvtt\vtt-test.webp`.
- **In the "Dragon Drop Test" world:**
  - 9 scenes: the default scene plus 8 test scenes. Several share the names "Dragon Drop test: two levels" and "VTT test" because the import renames them.
  - The actor "DD Probe".
  - The Universal Battlemap Importer enabled.
  - The game left paused, as it was.
