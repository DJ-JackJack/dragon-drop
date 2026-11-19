# Retest 5 (RT8 rerun, fixed file): roofs as tiles with a ceiling each. What makes one fade? (2026-11-19)

Requested by the person (prompt file `rt8-roof-tiles.md`, rerun version). The first RT8 run stopped at T17 because the tiles came in with `modes: []`. Its notes are in `RESULTS-RETEST-5-run1.md`, and its files carry the `-run1` suffix.

- **Setup:**
  - Foundry **14.367**, world "Dragon Drop Test" (dnd5e 6.0.1).
  - I (Claude) drove Foundry myself in the Claude desktop app's built-in browser pane, logged in as **"CLAUDE GM"** (a GM). **The person observed nothing.**
  - Everything was seen from the **GM view**. No player view was tested.
- **Each observation is marked:**
  - **[screen]**: a screenshot.
  - **[pixel]**: a colour read from the canvas. Method: render the stage, convert the scene point to screen coordinates with `canvas.clientCoordinatesFromCanvas`, then call `gl.readPixels` on the WebGL drawing buffer.
  - **[API]**: Foundry's client (document data, `Tile#bounds`, `Token#regions`, `game.keybindings`, `game.keyboard.downKeys`, the sheets' form fields).
  - **[export]**: Foundry's Export Data.
- **Run conditions:**
  - The browser pane was **hidden**, so before anything else I emulated a **1024 × 768 viewport** (as in RT7). The canvas then rendered and screenshots worked. The emulation was cleared at the end.
  - I waited **1.5 s after every change** before reading anything.
- **Tokens:**
  - **Created** only by a canvas `drop` event at the stated position.
  - **Set through the API** on every test token: `sight.range` 60 and `elevation`.
  - **Selected and released:** `canvas.tokens.releaseAll()` first, then `Token#control()` for "selected".
  - **Deleted** between placements with `TokenDocument#delete`.
  - A drop at (210,210) is stored as `x 140, y 140` (the token's top-left corner), so the token covers 140..210, and its centre (175,175) is the token probe **T**. The same applies to the other drop points (stored values are in the tables).
- **The scene file was not edited.** Opening the T21 sheets changed nothing: the scene's `_stats.modifiedTime` stayed at 1795120569995, and the region and tile data were identical before and after [API].

## Files and the pictures

- `make-roof-pngs-3.mjs` (as given) wrote the three PNGs. All three are **byte-identical** to the ones already in `Data/maps`, so I left those alone. `dd-test-ground.png` is still there.
- `RT8-roof-tiles.json`: 4096 bytes, no trailing newline. SHA-256 `7e1ea37b08b3ea74bfa27f148ec95197cf93cae7ec3ebe9bd667195b39d424a0` **matches**, both on disk and when re-hashed in the page before import. It was staged in `Data/dd-test-import/retest/rt8b/`.
- **New scene:** created empty as "RT8 roof tiles 2" (id `BvNCksDvTw2IcAx4`). Import renamed it to "Dragon Drop roof tiles test". The first RT8 scene and all earlier scenes were left alone.

**Reference colours** (needed to read the probe tables):
- **Picture colours:** brown 150,90,60; blue 60,100,170; green 60,150,80.
- **The ground picture**, read from `dd-test-ground.png` in the page:
  - **B, U, G2, G3** fall on its dark green margin, **40,60,40**.
  - **G1, N and the token centre (175,175)** fall on its orange floor, **150,108,66**. The floor is the rectangle 140..910 × 140..560.
- The canvas draws everything slightly darker than the picture files:
  - about 7 % darker with **no token controlled**;
  - about 3 % darker **through a controlled token's vision**.

| Seen on the canvas as | No token controlled | A token controlled |
|---|---|---|
| brown roof | 140,84,56 | 146,88,59 |
| blue roof | 56,93,159 | 59,98,166 |
| green roof | 56,140,75 | 59,146,78 |
| ground, dark margin (B, U, G2, G3) | 37,56,37 (read in T18 i) | 39,59,39 |
| ground, floor (G1, N) | 140,101,62 | 146,105,64 |
| token (its centre) | n/a | 219..246 in each channel (light grey art) |

## T17 import: pass, and the tiles are now Surface tiles

- *"Data for Scene "Dragon Drop roof tiles test" was successfully imported from JSON."* [screen]
- **All four tiles store `occlusion.modes: [2]`** and `occlusion.alpha: 0` [API right after import; export]. Each tile mesh reports `occlusionMode 2` [API].
- `roundtrip-diff-RT8-roof-tiles.md` [export]:
  - **0 changed, 1 dropped**: `tiles[*].occlusion.mode` (2 on all four). Foundry keeps only `modes`.
  - Everything else was kept as written, plus the usual added defaults:
    - tiles: `texture.anchorX/anchorY 0.5`, `fit "fill"`, `scaleX/scaleY 1`, `tint`, `alphaThreshold 0.75`, `rotation 0`, `alpha 1`, `video {...}`;
    - rectangle shapes: `anchorX/anchorY 0`, `gridBased false`;
    - the polygon: `origin: null`.
  - `_stats.coreVersion` was written back as 14.367.
- **Tile bounds, exactly the intended rectangles** [API `Tile#bounds`]:

  | Tile | Bounds (x, y, width × height) |
  |---|---|
  | Ground floor brown | 70, 70, 280 × 280 |
  | Ground floor blue | 700, 70, 280 × 280 |
  | Ground floor green | 350, 420, 350 × 210 |
  | Tall hall brown | 70, 70, 280 × 280 |

  The stored `x`/`y` are the centres 210/210, 840/210 and 525/525, with anchor 0.5/0.5.
- **Polygon region:** points stored exactly as `[350,420,700,420,525,630]` [export]. All four regions kept `topInclusive: false`.
- The export (14029 bytes) is saved redacted as `roundtrip-RT8-roof-tiles.json` (one `_stats.lastModifiedBy` replaced with `"REDACTED-USER"`).

## T18 Ground floor (viewing Ground floor)

Probe points (scene coordinates):

| Probe | Point | What is there |
|---|---|---|
| B | (130,130) | brown tile |
| U | (760,130) | blue tile |
| G1 | (440,500) | green tile, inside the triangle |
| G2 | (380,600) | green tile, outside the triangle |
| G3 | (670,600) | green tile, outside the triangle |
| N | (525,250) | plain ground |
| T | the token's centre | the token |

In the table, "roof" means the roof colour was read, "ground" means the ground picture was read, and "token" means the token art was read. The colour values are those in the reference table above.

| Case | Token as stored [API] | In region [API] | B | U | G1 | G2 | G3 | N | T (token centre) |
|---|---|---|---|---|---|---|---|---|---|
| (a) no token | none | none | roof | roof | roof | roof | roof | ground | n/a |
| (b) not selected | 140,140 elev 0 | Ground roof brown | roof | roof | roof | roof | roof | ground | **roof** (140,84,56): token hidden |
| (c) selected | 140,140 elev 0 | Ground roof brown | **ground** | roof | roof | roof | roof | ground | token |
| (d) selected | 770,140 elev 0 | Ground roof blue (exposure on) | roof | **ground** | roof | roof | roof | ground | token |
| (e) selected | 490,490 elev 0 | Ground roof green (triangle) | roof | roof | **ground** | roof | roof | ground | token |
| (f) selected | 490,210 elev 0 | none | roof | roof | roof | roof | roof | ground | token |
| (g) selected | 140,140, **asked 9, stored 5** | Ground roof brown | **ground** | roof | roof | roof | roof | ground | token |
| (h) two, both selected | 140,140 and 770,140, elev 0 | brown; blue | **ground** | **ground** | roof | roof | roof | ground | both tokens |
| (i) Highlight Objects held, no token | none | none | **ground** | **ground** | **ground** | roof | roof | ground | n/a |

What the screenshots show for each case [screen] (and [pixel] where stated):

- **(a)** `rt8b-t18a-ground-no-token.jpg`.
  - All three roofs are drawn over their full rectangles.
  - The green rectangle is drawn in full, not cut to the triangle.
  - **Blue (exposure on) looks the same as brown (exposure off).** There is no visible difference.
- **(b)** `rt8b-t18b-brown-token-not-selected.jpg`.
  - No token is visible.
  - The brown roof is drawn in full over the token's position.
- **(c)** `rt8b-t18c-brown-token-selected.jpg`.
  - The **whole brown square** is gone, and the ground picture shows through it.
  - The token is drawn.
  - Blue and green are unchanged.
- **(d)** `rt8b-t18d-blue-token-selected.jpg`. Only the blue square is gone.
- **(e)** `rt8b-t18e-triangle-token-selected.jpg`.
  - The green roof is cut **to the triangle only**.
  - The two corners of the green rectangle outside the triangle stay drawn (G2 and G3 still read roof).
- **(f)** `rt8b-t18f-outside-token-selected.jpg`. Every roof is drawn, and the token stands on plain ground.
- **(g)** Foundry stored a different elevation.
  - `TokenDocument#update({elevation: 9})` returned the document, with no error and no notification, but the token's stored elevation is **5** [API].
  - The result is otherwise the same as (c) (`rt8b-t18g-brown-asked9-stored5-selected.jpg`).
- **(h)** `rt8b-t18h-two-tokens-selected.jpg`.
  - Both the brown and the blue squares are gone, and both tokens are drawn.
  - Green is unchanged.
  - **Each token removed its own roof.** Neither token removed the other's roof or the green one.
- **(i)** The Highlight Objects keybinding.
  - The keybinding is **"Highlight Objects"** (`core.highlight`), bound to **AltLeft** and **AltRight** with no modifiers [API `game.keybindings.get`].
  - **I can't hold a physical key with this tool.** Instead, I dispatched a synthetic `keydown` (code `AltLeft`) on `window`, and Foundry registered it as held (`game.keyboard.downKeys` = `["AltLeft"]`) [API].
  - While it was held, with no token on the scene:
    - the **brown and blue roofs were gone**;
    - **green was cut to the triangle** (`rt8b-t18i-alt-held-no-token.jpg`).
  - After a synthetic `keyup`, all three roofs were back in full [pixel]:

    | Probe | Read | Means |
    |---|---|---|
    | B | 140,84,56 | brown roof |
    | U | 56,93,159 | blue roof |
    | G1 | 56,140,75 | green roof |

## T19 Tall hall (viewing Tall hall; probe B (130,130))

- On this level the canvas has one tile: brown, elevation 20, bounds 70,70 280 × 280, mesh occlusionMode 2 [API].
- Its region "Hall roof brown" spans elevation 10..20.

| Case | Token as stored [API] | In region [API] | B | T (token centre) |
|---|---|---|---|---|
| (a) no token | none | none | **roof** (140,84,56) | n/a |
| (b) selected | 140,140 elev 15 | Hall roof brown | **ground** (39,59,39) | token (240,236,232) |
| (c) selected | 140,140, **asked 25, stored 15** | Hall roof brown | **ground** (39,59,39) | token |
| (d) selected | 490,210 elev 15 (dropped at 525,250) | none | **roof** (146,88,59) | token (219,207,194) |
| extra: (b) not selected | 140,140 elev 15 | Hall roof brown | **roof** (140,84,56) | **roof** (140,84,56): token hidden |

- **(a)** The brown roof is drawn in full (`rt8b-t19a-hall-no-token.jpg`) [screen].
- **(b)** The brown square is gone and the token is drawn (`rt8b-t19b-hall-elev15-selected.jpg`) [screen].
- **(c) could not be placed as specified.**
  - `TokenDocument#update({elevation: 25})` returned the document, with no error and no notification, but the stored elevation is **15** [API].
  - So "a token above the ceiling" was **not tested**.
  - The result is the same as (b) (`rt8b-t19c-hall-asked25-stored15-selected.jpg`).
- **(d)** The roof is drawn, and the token stands outside it (`rt8b-t19d-hall-elev15-outside-selected.jpg`).
- **Extra** (not in the prompt): the (b) token, not selected. No token is visible, and the roof is drawn over it (`rt8b-t19x-hall-elev15-not-selected.jpg`).

## T20: when a roof stays drawn over a token, the token is hidden under it

- There were two placements where a roof stayed drawn over a token's position: T18 (b) and the T19 extra case, both with the token **not selected**.
- In both:
  - the canvas at the token's centre read **exactly the roof colour**, 140,84,56 [pixel];
  - no part of the token was visible [screen].
- So the roof is drawn **over** the token, fully opaque. The token is neither drawn over the roof nor visible through it.
- Whenever the token's own roof was cut, the token was drawn.

## T21: the settings (read only; nothing changed, nothing tested)

**Region sheet "Ground roof brown"** (`rt8b-t21-region-sheet.jpg`) [API: the sheet's form fields]. Tabs: Appearance, Shapes, Placement, Behaviors.

| Field | Value | Options |
|---|---|---|
| Visibility | "Only on Region Layer when unlocked" (4) | Only on Region Layer (0); Always for Gamemaster (1); Always for Observers (3); Always for Anyone (2) |
| Highlight Mode | True Shapes | Covered Grid Spaces |
| Display Measurements | off | |
| Shape | rectangle 70,70, 280 × 280; anchor 0/0; rotation 0; Is Grid-Based off | |
| Levels | [Ground floor] | |
| Elevation | 0..10, top inclusive off | |
| Attached Token | none | |
| Is Restricted (shape constrained by walls) | off | |
| Restricted By | Movement-blocking Walls | |
| Priority Threshold | 0 | |

**Define Surface behaviour sheet** (`rt8b-t21-define-surface-sheet.jpg`) [API: the sheet's form fields].

| Field | Value | Options or hint |
|---|---|---|
| Disabled | off | |
| Placement | Top | Bottom, Top, Bottom and Top |
| Restricts Light and Darkness | on | |
| Restricts Movement | on | |
| Restricts Sight | on | |
| Restricts Sound | on | |
| **Occlusion** | **on** | Its hint is the text the prompt quotes (controlled or detected token below the surface; Surface tiles at or above it fade; hovering the region or Highlight Objects also triggers it) |
| **Reveal Elevated Surface** (exposure) | off | Hint: partially reveals the elevated surface to observers below and outside it, depending on the viewing angle; meant for roofs and balconies |
| **Cull Tokens** (culling) | off | Hint: hides uncontrolled tokens outside the viewed level in the GM view or with token vision off |

**Tile sheet, Ground floor brown** (`rt8b-t21-tile-sheet.jpg`) [API: the sheet's form fields]. Tabs: Position, Appearance, Overhead.

- **Position:**
  - Levels [Ground floor]
  - x 210, y 210, width 280, height 280
  - rotation 0, elevation 10, sort 0
- **Appearance:**
  - the image
  - scale 1/1, anchor 0.5/0.5
  - opacity 1, tint #ffffff
  - video options
- **Overhead** (the tab says these apply when the tile is overhead in the foreground):

  | Field | Value |
  |---|---|
  | **Occlusion Modes** | a multi-select set to **[Surface]**; options Fade (Entire Tile) 1, Surface 2, Radial (Surrounding Token) 4, Vision (Token Field of Vision) 8 |
  | **Occlusion Alpha** | **0** |
  | Restricts Light | off |
  | Restricts Weather | off |
  | Alpha Threshold | 0.75 (hint: pixels below it don't trigger hover fading) |

No setting was changed or tried. The prompt says to ask the person first and to use a copy of the scene.

## Correction to RT7 (`RESULTS-RETEST-4.md`, T14)

- **What RT7 reported:** a ceiling region hides a Surface tile at its own elevation all the time, with no token.
- **This run does not show that.** With no token, every roof was drawn in full on both levels (T18 a, T19 a) [pixel, screen].
- **Why RT7 may have looked that way:** the RT7 "cut" edge was at scene (140,140). That point is also where this ground picture's orange floor begins (the floor is 140..910 × 140..560) [pixel, from the PNG]. So that RT7 observation is **unconfirmed**.
- I did not reopen the RT7 scene to check.

## Cleanup and files

- **Cleanup:**
  - All test tokens were deleted (0 left).
  - The synthetic Alt key was released (`downKeys` empty).
  - The sheets were closed and the viewport emulation was cleared.
  - Earlier scenes, including the first RT8 scene, were not touched.
  - Helper functions I added to the page (`window.__dd*`) stay in memory until the page is reloaded. They store nothing.
- **Files in `foundry-results/retest/` from this run:**
  - `RESULTS-RETEST-5.md` (this file)
  - `RT8-roof-tiles.json`: as imported
  - `roundtrip-RT8-roof-tiles.json`: Foundry's export, redacted
  - `roundtrip-diff-RT8-roof-tiles.md`
  - `make-roof-pngs-3.mjs`
  - `screenshots/rt8b-*`: 17 files
- **From run 1:** `RESULTS-RETEST-5-run1.md`, `RT8-roof-tiles-run1.json`, `roundtrip-RT8-roof-tiles-run1.json`, `roundtrip-diff-RT8-roof-tiles-run1.md` and `screenshots/rt8-ground-floor-no-token-roofs-uncut.jpg`.

## My reading (inference, not observation)

- **When a roof is cut:** a Surface-mode tile at a Define Surface ceiling is cut only while a **controlled** token is **inside that region**:
  - inside the shape;
  - at an elevation within the region's bottom..top: Ground floor 0 and 5, Tall hall 15.
- **The cut takes the region's shape**, not the tile's rectangle.
- **These don't cut it:**
  - the viewed level alone;
  - an uncontrolled token, even one standing under the roof;
  - a token outside the region.
- **Highlight Objects** cuts every Surface roof at once.
- **Each roof can be cut on its own** if it has its own region. One token cuts only its own roof, and two tokens cut two roofs.
- **Exposure** made no visible difference in the GM view here.
- **Not tested:**
  - a token above the ceiling: Foundry snapped the elevation to just below the ceiling (asked 9 → 5 under a ceiling at 10; asked 25 → 15 under a ceiling at 20), which looks like the surface's movement restriction stopping the token 5 ft (its height) below it;
  - what a player (non-GM) sees.
