# Retest 5 (RT8): roofs as tiles with a ceiling each (2026-11-19). STOPPED after T17

Asked for by the person (prompt file `rt8-roof-tiles.md`).

- Foundry **14.367**, world "Dragon Drop Test" (dnd5e 6.0.1), driven by Claude in the Claude desktop app's built-in browser pane as **"CLAUDE GM"**. **Nothing was observed by the person.**
- Each observation is marked:
  - **[screen]**: a screenshot.
  - **[pixel]**: the colour read from the canvas. Method: `canvas.app.renderer.render(canvas.app.stage)`, then `gl.readPixels` at the probe's screen position, from `canvas.clientCoordinatesFromCanvas`.
  - **[API]**: Foundry's client.
  - **[export]**: Foundry's Export Data.
- **Run conditions.** The browser pane was **hidden** (the person was away). I set an emulated **1024×768** viewport. Rendering then ran at 0 fps at first and **about 10 fps** after one screenshot. The viewport was reset to desktop afterwards.
- The scene file was **not edited**. No tokens were placed.

**Files.**
- `make-roof-pngs-3.mjs` (as given) wrote `dd-test-roof-brown.png` (280×280), `dd-test-roof-blue.png` (280×280) and `dd-test-roof-green.png` (350×210), all RGBA. They were copied to `Data/maps/`; `dd-test-ground.png` is still there.
- `RT8-roof-tiles.json`: 4060 bytes, SHA-256 `d395acf7b7067932a996edab24df106f3ce0e7bca1030242d4fd59c7f220f256`, which **matches**.
- **Scene:** created as "RT8 roof tiles" (id `QRuy6VoI1bzRKsVM`). Import renamed it to "Dragon Drop roof tiles test".

## T17 import: **fails the test's purpose**. The tiles lost their Surface occlusion

- *"Data for Scene "Dragon Drop roof tiles test" was successfully imported from JSON."* [API, notification text]
- `roundtrip-diff-RT8-roof-tiles.md`: **1 changed path, 0 dropped** [export]:
  - **`tiles[*].occlusion.modes`: `[2]` became `[]` on all 4 tiles.** `occlusion.alpha: 0` was kept. So every roof tile has **no occlusion mode**, and its mesh reads `occlusionMode: 0`, which `CONST.OCCLUSION_MODES` names **NONE** [API].
  - Tile bounds are now **exactly as intended** (placing by centre works) [API, `Tile#bounds`]:
    - Ground brown 70,70 280×280
    - Ground blue 700,70 280×280
    - Ground green 350,420 350×210
    - Hall brown 70,70 280×280 at elevation 20
  - Tile meshes have `_occludedBySameElevationSurfaces: true` [API].
  - Polygon region: `points` kept `[350,420,700,420,525,630]`; `origin: null` added. Exposure is `true` only on "Ground roof blue (exposure on)". All `topInclusive` stay `false`. Everything else is kept, with the usual defaults added [export].
- **Why `modes` was emptied** (an in-memory check with Foundry's own `Scene.fromImport` on a copy of the file's first tile; nothing was imported or saved) [API]:

  | Tile `occlusion` written | file's `coreVersion` 14.353 | `coreVersion` 14.367 |
  |---|---|---|
  | `{modes: [2], alpha: 0}` (as in RT8) | **`[]`** | `[2]` |
  | `{mode: 2, alpha: 0}` (as in RT7) | `[2]` | `[2]` |
  | `{mode: 2, modes: [2], alpha: 0}` | `[2]` | `[2]` |

  Because the file says 14.353 and Foundry runs 14.367, Foundry migrates the data, and the migration rebuilds `modes` from the old `mode` field. RT7 wrote `mode: 2` and got `modes: [2]`; RT8 wrote only `modes: [2]` and got `[]`.

## T18 to T21: not run (stopped per the rules)

The roofs are not Surface tiles in this import, so the fade tests would not test what they are meant to.

- **One reading before stopping:** Ground floor, **no token**, nothing selected [pixel, screen `rt8-ground-floor-no-token-roofs-uncut.jpg`]. All three roofs are drawn in full and the green one is **not** cut to the triangle (expected with occlusion NONE):

  | Probe | RGB | What it is |
  |---|---|---|
  | B (130,130) | 140,84,56 | brown roof |
  | U (760,130) | 56,93,159 | blue roof |
  | G1 (440,500) | 56,140,75 | green roof |
  | G2 (380,600) | 56,140,75 | green roof |
  | G3 (670,600) | 56,140,75 | green roof |
  | N (525,250) | 140,101,62 | ground picture |

- Not done: T18 (b) to (i), T19, T20 and T21 (sheet settings).

## Files

- `make-roof-pngs-3.mjs`
- `RT8-roof-tiles.json`: as imported
- `roundtrip-RT8-roof-tiles.json`: Foundry's export, redacted (`_stats.lastModifiedBy` replaced with `"REDACTED-USER"`)
- `roundtrip-diff-RT8-roof-tiles.md`
- `screenshots/rt8-ground-floor-no-token-roofs-uncut.jpg`

## My reading (inference, not observation)

To keep a tile's Surface occlusion through the 14.353 → 14.367 migration, Dragon Drop should write **both** `occlusion.mode: 2` and `occlusion.modes: [2]` (or at least `mode: 2`). After that change, RT8 can be rerun as it stands. Nothing in this run says anything new about what makes a roof fade, beyond RT7's finding that the region-shaped cut needs a Surface-mode tile.
