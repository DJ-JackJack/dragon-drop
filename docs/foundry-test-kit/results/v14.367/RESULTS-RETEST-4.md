# Retest 4 (RT7): can a roof fade when a token goes under it? (2026-11-19)

Asked for by the person (prompt file `rt7-roof-fade.md`).

- Foundry **14.367**, world "Dragon Drop Test" (dnd5e 6.0.1), driven by Claude in the Claude desktop app's built-in browser pane as **"CLAUDE GM"** (a GM). **Nothing was observed by the person.**
- Each observation is marked:
  - **[screen]**: a screenshot.
  - **[API]**: Foundry's client: `canvas.primary.levelTextures` and `canvas.tiles.placeables[].mesh` (alpha, worldAlpha, occluded, occlusionMode, `_occlusionState`, `_occludedBySameElevationSurfaces`), document data, `RegionDocument#testPoint`, the schemas, and Foundry's own localisation strings.
  - **[export]**: Foundry's Export Data.
- **Run conditions (read this).** The person was away and the browser pane was **hidden**. At first the page rendered **0 frames per second**. After I set an emulated 1024×768 viewport it rendered **about 30 fps**, and the canvas and screenshots worked. Every T13 and T14 observation was made in that state (the viewport was reset afterwards).
- **Method.**
  - The scene was imported with Import Data (file attached from the staging folder, SHA-256 checked in the page), and the export was captured through Foundry's uploader.
  - Tokens were **placed by the canvas drop event** only.
  - **Set through the API (test tokens only):** `sight.range` 60 ft on every test token, and `elevation` 5 for T13 (d).
  - **Deleted through the API:** test tokens were removed between placements with `TokenDocument#delete`, not the Delete key.
- The scene file was **not edited**.

**Files.**
- `make-roof-pngs-2.mjs` (as given) wrote three 1050×700 RGBA PNGs:
  - `dd-test-roof-ground.png` and `dd-test-roof-attic.png` are **byte-identical** to the ones already in `Data/maps`, so those were left as they were.
  - `dd-test-roof-both.png` (9869 bytes) was copied to `Data/maps`. Pixel checks: (300,350) is brown 150,90,60,255; (700,350) is blue 60,100,170,255; (80,80) is transparent.
- `dd-test-cellar.png` and `dd-test-ground.png` are still there.
- `RT7-roof-fade.json`: 4241 bytes, SHA-256 `7289cb2842f73a7da89f1f0b7aeec24371befa7d0138ea844fdb1a64647b9df0`, which **matches**.
- **Scene:** created as "RT7 roof fade" (id `NtCeSNj2XZEmWRDZ`). Import renamed it to "Dragon Drop roof fade test".

## T12 import: pass (two fields restructured)

- *"Data for Scene "Dragon Drop roof fade test" was successfully imported from JSON."* [screen]
- `roundtrip-diff-RT7-roof-fade.md`: **0 changed, 2 dropped**, the rest added defaults [export]:
  - **Tiles: `occlusion.mode: 2` was dropped and stored as `occlusion.modes: [2]`** (a list). `occlusion.alpha: 0` was kept.
  - Tiles kept `_id`, `texture.src`, `x 0`, `y 0`, `width 1050`, `height 700`, `elevation 20`, `levels [Attic]`, `restrictions {light: false, weather: false}`, `hidden`, `locked` and `flags`.
  - Tiles gained `texture.anchorX 0.5`, `texture.anchorY 0.5`, `texture.fit "fill"`, `texture.scaleX/scaleY 1`, `texture.tint "#ffffff"`, `texture.alphaThreshold 0.75`, `rotation 0`, `alpha 1`, `sort 0` and `video {loop: true, autoplay: true, volume: 0}`.
  - **Polygon shape: `points` kept exactly `[210,210,700,210,455,490]`. Its `rotation: 0` was dropped**, and `origin: null` was added. Rectangle shapes gained `anchorX`, `anchorY` and `gridBased` as before.
  - All 5 regions kept `topInclusive: false` (all single-level). Levels, foregrounds and behaviours are unchanged. `_stats.coreVersion` written back: 14.367.
- **Important for tiles [API, screen]: in v14 a tile's `x`/`y` is the position of its texture anchor, and the default anchor is 0.5/0.5, so `x`/`y` is the tile's centre.**
  - Both tiles' `bounds` are `x −525, y −350, 1050×700`. Their mesh sits at (0,0) with anchor (0.5,0.5).
  - So the brown roof (image x 140..525) falls entirely off the scene, and only the top-left of the blue roof is on it (scene 0..385 × 0..210) (`rt7-t14-attic-no-token-tiles-off-position.jpg`).
  - A full-scene tile would need `x: 525, y: 350` (with the default anchor). That wasn't tested.

## T13 Part A, Ground floor (one foreground, two ceiling regions): no fade

Viewing the Ground floor, the foreground mesh `Level.1.foreground` (`maps/dd-test-roof-both.png`) is at elevation 10 with occlusionMode 2 (SURFACE). Both roofs are drawn fully opaque over the tokens (`rt7-t13-ground-floor-no-token.jpg`).

In every placement, with the token both **selected and not selected** (1.5 s after each change), the foreground mesh read `visible true`, `alpha 1`, `worldAlpha 1`, `occluded false`, `occlusionState {fade 0, radial 0, vision 0, surface 1}` [API]. The screenshots show both roofs unchanged [screen].

| Case | Token (as stored) | Inside region | Result |
|---|---|---|---|
| (a) | elevation 0 at (280,280) | Ground roof west | no fade; the brown roof covers the token (`rt7-t13a-*.jpg`) |
| (b) | elevation 0 at (630,280) | Ground roof east | no fade; the blue roof covers the token (`rt7-t13b-*.jpg`) |
| (c) | elevation 0 at (70,70) | none | no change (`rt7-t13c-*.jpg`) |
| (d) | elevation 5 (set via API) at (280,280) | Ground roof west | no fade (`rt7-t13d-*.jpg`) |
| (e) | elevation 10 | n/a | **could not be placed**: `TokenDocument#update({elevation: 10})` returned `undefined` with no error and no notification, and the token stayed at 5. `Level#clampElevation(10)` returns 10, so the level's clamp isn't the cause. Not pursued further. |

**So the fade question for one foreground picture over several buildings can't be answered from this run.** The foreground never faded, either as a whole or in part. The level foreground has `_occludedBySameElevationSurfaces: false`; backgrounds have `true` [API].

## T14 Part B, Attic (two tiles, two ceiling regions): could not run as designed

- The tiles are not where the file intended (see T12): brown is off-scene and blue only covers scene 0..385 × 0..210, so placements (a) to (e) could not test "a token under its own tile". Per the rules, I didn't move or edit the tiles.
- **One check without changing anything:** a token at (210,140) (centre 245,175), Attic, elevation 10, inside "Attic roof west", underneath the visible blue part [API, screen]:
  - Both tile meshes read `visible true`, `alpha 1`, `occluded false`, `occlusionState {fade 0, radial 0, vision 0, surface 1}`, with the token selected and not selected.
  - **But the blue tile is not drawn inside the "Attic roof west" region's area at all**, with or without a token. The visible blue is cut exactly at the region's corner (scene 140,140) (`rt7-t14-attic-no-token-tiles-off-position.jpg`, `rt7-t14-probe-zoom-tile-cut-at-region.png`).
  - Both tile meshes have `_occludedBySameElevationSurfaces: true`, and each tile's elevation 20 equals the region's top surface (placement "top", elevation 10..20).
  - **Read: a Define Surface ceiling hides a Surface-mode tile at the same elevation, per pixel and shaped like the region, all the time.** It is not a fade triggered by a token. The token at (210,140) was drawn uncovered.
- Not tested: tokens (a) to (e) as specified, tile transparency hiding anything, and tiles at an elevation different from the surface.

## T15 Part C, Cellar triangle: pass

- Stored polygon points unchanged [export].
- `RegionDocument#testPoint({x, y, elevation: -5})` [API]:
  - **true** at (455,300) and (300,260)
  - **false** at (230,480), (150,150), (680,480) and (455,500)

  This is as expected, and `polygonTree.testPoint` gives the same values. Foundry's polygon is `[210,210, 700,210, 455,490]`.
- Region layer: drawn as a triangle with its point at the bottom (`rt7-t15-cellar-triangle-region.jpg`) [screen].

## T16 settings that could decide fading [API, from Foundry's schema and localisation]

- **Define Surface behaviour:**
  - `placement` (bottom/top/both)
  - `occlusion` (default true)
  - **`exposure`, "Reveal Elevated Surface"** (default false): *"Partially reveal the visible area of this elevated surface to observers below and outside of it … useful for roofs, balconies, or other overhead platforms."*
  - **`culling`, "Cull Tokens"** (default false): *"Hide uncontrolled Tokens outside the currently viewed Level in the GM view or when Token Vision is disabled …"*

  Neither `exposure` nor `culling` was tried on.
- **Tile:** `occlusion.modes` (a set: None "Always Visible", Fade "Entire Tile", Surface, Radial "Surrounding Token", Vision "Token Field of Vision"), `occlusion.alpha` (default 0), and `restrictions.light/weather`.
- **Level foreground:** only `src`, `tint`, `alphaThreshold`; no occlusion option.

## Cleanup and files

- All test tokens were deleted (0 left), and the viewport emulation was reset. Earlier scenes were not touched.
- Files in this folder:
  - `make-roof-pngs-2.mjs`
  - `RT7-roof-fade.json`: as imported
  - `roundtrip-RT7-roof-fade.json`: Foundry's export, redacted (`_stats.lastModifiedBy` replaced with `"REDACTED-USER"`)
  - `roundtrip-diff-RT7-roof-fade.md`
  - `screenshots/rt7-*`: 10 files
