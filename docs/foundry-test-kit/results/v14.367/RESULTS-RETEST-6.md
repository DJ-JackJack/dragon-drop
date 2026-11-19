# Retest 6 (RT9): a real Dragon Drop roof export in Foundry (2026-11-19)

The person asked for this run with the prompt file `rt9-real-roof-export.md`. It checks the RT8 findings (`RESULTS-RETEST-5.md`) against a scene that Dragon Drop wrote itself.

- **Setup:**
  - Foundry **14.367**, world "Dragon Drop Test" (dnd5e 6.0.1).
  - I (Claude) drove Foundry myself in the Claude desktop app's built-in browser pane, logged in as **"CLAUDE GM"** (a GM). **The person observed nothing.**
  - Everything was seen in the **GM view**. T34 (a player's view) was not done.
- **Each observation is marked:**
  - **[screen]**: a screenshot or a zoomed part of one.
  - **[pixel]**: a colour read from the canvas, the same way as in RT8 (render the stage, then `gl.readPixels` at the probe's screen position).
  - **[API]**: Foundry's client (document data, `Tile#bounds`, `Token#regions`, `canvas.mousePosition`, `game.keyboard.downKeys`, the token's `tooltip`).
  - **[export]**: Foundry's Export Data.
- **Run conditions:**
  - The browser pane was **hidden**, so I emulated a **1024 × 768 viewport** first. The page then rendered about 20 frames a second. The emulation was cleared at the end.
  - I waited **1.5 s after every change** before reading anything.
- **Tokens:**
  - **Created** only by a canvas `drop` event.
  - **Set through the API** on every test token: `sight.range` 60 and `elevation`.
  - **"Selected"** means `canvas.tokens.releaseAll()` and then `Token#control()`.
  - **Deleted** between placements with `TokenDocument#delete`.
  - Foundry snaps a dropped token to the grid, so I dropped each token at the given centre and report what Foundry stored. A drop point that falls halfway between two cells went to the upper/left cell.
- **The mouse matters** (see T32): Foundry cuts a roof while its last mouse position is over the roof's region. For the T30 to T32 probes, the last pointer events were clicks on the level navigation at the top left, which map to points outside every region. From T33 on, I moved the mouse onto empty ground before every reading and recorded `canvas.mousePosition` each time.
- **Nothing was edited:** not the scene file, and not the pictures.

## Files

- **`House-foundry.zip`** (in Downloads, 480854 bytes): SHA-256 `62e617cb…391b61bf` **matches**. I unzipped it into a temporary folder.
- **`house-scene.json`**: 10781 bytes, pretty-printed. SHA-256 `4a3c075b…cf88528d` **matches**, both on disk and when re-hashed in the page before import. It was staged in `Data/dd-test-import/retest/rt9/`.
- **The five PNGs** were copied to `Data/maps`. They were new names, so nothing was replaced, and each copy is byte-identical:

  | File | Size |
  |---|---|
  | `house-1-ground-floor.png` | 1050×700 |
  | `house-1-ground-floor-roof-1.png` | 347×347 RGBA |
  | `house-1-ground-floor-roof-2.png` | 347×347 RGBA |
  | `house-2-upper-floor.png` | 1050×700 |
  | `house-2-upper-floor-roof-1.png` | 417×347 RGBA |

- **New scene:** created empty as "RT9 real roof export" (id `ROEjXKUCf2c3420S`). Import renamed it to "House". No earlier scene was touched.
- **The file has 12 walls, which the prompt did not expect.** The prompt said "no walls, lights or stairs". The file has **12 walls**:
  - a closed square of 4 walls around each roofed room: the west room 70..350, the east room 560..840 × 70..350, and the tower 210..560 × 210..490;
  - no doors (`door: 0`), each on its own level.

  There are no lights or stairs. The zip's README also mentions "walls, doors and lights". **The walls matter for the probes:** a selected token sees only inside its own room, so probes outside that room read black or dimmed.
- **Picture colours at the probes** [read from the PNGs in the page]:

  | Probe | Point | Floor picture | Roof picture |
  |---|---|---|---|
  | W_in | (110,110) | 146,142,133 | west roof, clay, 208,106,72 |
  | W_shadow | (358,300) | 14,13,16 | west roof shadow, 7,7,10 at alpha 73 |
  | W_beside (my extra reference) | (395,300) | 22,22,26 | none |
  | E_in | (700,120) | 124,120,113 | east roof, thatch, 167,137,76 |
  | E_out | (570,300) | 57,55,54 | east roof, fully transparent |
  | N | (525,560) | 22,22,26 | none |
  | U_in | (260,260) | 123,119,112 | tower roof, slate, 114,124,140 |
  | U_shadow | (568,400) | 14,13,16 | tower roof shadow, 7,7,10 at alpha 73 |
  | U_beside (my extra reference) | (610,400) | 22,22,26 | none |
  | N2 | (100,600) | 22,22,26 | none |

  The canvas draws everything about 7 % darker in the GM view with no token selected, and the colours shift again through a selected token's vision.
- **Shadows in the roof pictures:**
  - The west and tower roofs have their opaque part from column 33 to column 312 (west) or 382 (tower). Then comes one transparent column, then a shadow (alpha 92 fading to 0 over about 25 px) to the right and below. There is also a faint fringe (alpha up to about 49) on the left (I measured the left side only).
  - The thatch triangle has a dark fringe on **both** diagonal edges:
    - on the left, alpha 22..74 over about 12 px;
    - on the right, alpha 92 fading over about 25 px.

## T29 import: pass, but the half pixels are rounded

- *"Data for Scene "House" was successfully imported from JSON."* [screen]
- `roundtrip-diff-RT9-house.md` [export]: **2 changed, 1 dropped.** Everything else was kept as written, plus the usual added defaults (as in RT8).
  - **Changed: tile `x`/`y` were rounded to whole pixels.**

    | Tile | x | y |
    |---|---|---|
    | west | 210.5 → **211** | 210.5 → **211** |
    | east | 700.5 → **701** | 210.5 → **211** |
    | tower | 385.5 → **386** | 350.5 → **351** |

  - **Dropped:** `tiles[*].occlusion.mode` (2 on all three). As in RT8, Foundry keeps only `modes`.
- **Each tile** [API right after import; export]:
  - `occlusion.modes: [2]`, `occlusion.alpha: 0`, and mesh `occlusionMode 2`.
  - `width`/`height` kept: 347×347, 347×347 and 417×347.
  - `elevation` kept: 10, 10 and 20. `levels` kept: west and east on Ground floor, tower on Upper floor.
- **`Tile#bounds`** [API] is **half a pixel right and down** of what the file intended:

  | Tile | Bounds | Intended |
  |---|---|---|
  | West | **37.5..384.5 × 37.5..384.5** | 37..384 |
  | East | **527.5..874.5 × 37.5..384.5** | 527..874 × 37..384 |
  | Tower | **177.5..594.5 × 177.5..524.5** | 177..594 × 177..524 |

- **Regions** [export]: all three kept their shapes, elevation (`topInclusive: false`) and `levels`:
  - west rectangle 70,70, 280×280 (0..10);
  - east polygon points kept exactly `[560,70,840,70,700,350]` (0..10);
  - tower rectangle 210,210, 350×280 (10..20).
- **Levels** [export]:
  - Upper floor 10..20 and Ground floor 0..10, with their backgrounds kept.
  - **Neither level has a foreground** (`foreground.src: null`).
  - `initialLevel` is Upper floor, and the scene opened there.
- **Walls** [export]: all 12 kept unchanged; Foundry added ids.
- `_stats.coreVersion` was written back as 14.367.
- The export (17051 bytes) is saved redacted as `roundtrip-RT9-house.json` (one user id replaced with `"REDACTED-USER"`).

## T30 Ground floor (viewing Ground floor)

Probe readings [pixel]. "roof" is the roof's colour; "floor" is the floor picture. "Dim" means darker than normal because the point is outside the selected token's sight; "black" means 0,0,0. **T** is the token's centre.

| Case | Token as stored [API] | Region [API] | W_in | W_shadow | E_in | E_out | N | T |
|---|---|---|---|---|---|---|---|---|
| (a) no token | none | none | **roof** 195,100,67 | shadow 11,10,13 | **roof** 156,129,71 | floor 52,50,49 | ground 18,18,21 | n/a |
| (b) not selected | drop (210,210) → x,y 140,140, centre (175,175), elev 0 | West house roof | **roof** | shadow 11,10,13 | roof | floor | ground | **roof** 167,86,59: token hidden |
| (c) selected | same | West house roof | **floor** 142,138,130 | black | black | black | black | token 239,239,238 |
| (d) selected | drop (700,170) → 630,140, centre (665,175), elev 0 | East lean-to roof | roof, dim 98,50,34 | black | **floor** 108,105,98 | floor 55,53,52 | black | token |
| (e) selected | drop (525,500) → 490,490, centre (525,525), elev 0 | none | roof, dim 98,50,34 | 12,11,14 | **roof**, dim 79,64,36 | dim 26,25,25 | 240,143,39: the token's orange frame (N lies on the token's bottom edge) | token |
| (f) two, both selected | 140,140 and 630,140, elev 0 | West; East | **floor** 142,138,130 | dim 6,5,7 | **floor** 108,105,98 | floor 55,53,52 | dim 9,9,10 | both tokens |

What the screenshots show [screen] (`rt9-t30*-*.jpg`):

- **(a)** Both roofs are drawn: the clay square over the west room and the thatch triangle over the east room.
- **(b)** No token is visible.
- **(c)** Only the west room is visible, with its whole roof gone and the token drawn. The rest of the scene is black: outside the token's sight, behind the room's walls.
- **(d)** The thatch triangle is gone, showing the east room's stone floor, and the token is drawn. The west roof shows dimmed.
- **(e)** The token stands in the open, with both roofs drawn (dim).
- **(f)** Both rooms are visible with both roofs gone, and both tokens are drawn.

**Each token removed only its own roof** [pixel, screen].

## T31 Upper floor (viewing Upper floor)

| Case | Token as stored [API] | Region [API] | U_in | U_shadow | N2 | T |
|---|---|---|---|---|---|---|
| (a) no token | none | none | **roof** 106,116,131 | shadow 11,11,14 | ground 21,21,24 | n/a |
| (b) selected | drop (385,350) → x,y 350,280, centre (385,315), **elev asked 15, stored 15** | Tower roof | **floor** 120,116,109 | black | black | token 244,244,243 |
| (c) not selected | same | Tower roof | **roof** 106,116,131 | 11,11,14 | 21,21,24 | **roof** 103,111,125: token hidden |
| (d) selected | drop (100,600) → 70,560, centre (105,595), elev 15 | none | roof, dim 53,58,66 | black | 94,94,97: N2 lies on the token itself | token 178,178,180 |

What the screenshots show [screen] (`rt9-t31*-*.jpg`):

- **(a)** The slate roof is drawn over the tower room.
- **(b)** The tower room is visible with the roof gone and the token drawn. The rest is black.
- **(c)** The roof is drawn and the token is hidden, **but the token's elevation label "+5 ft" is drawn on top of the roof**. Repeated at 2× (`rt9-t31x-hidden-token-elevation-label-2x.png`):
  - The token's `tooltip` reads text "+5 ft", `visible true` [API].
  - The canvas at the token's centre reads the roof colour [pixel].
- **(d)** The roof is drawn (dim) and the token stands outside it.

## T32 Highlight Objects (no token)

- **How the key was held:** a synthetic `keydown` of `AltLeft` on `window`, as in RT8. Foundry registered it as held (`game.keyboard.downKeys` `["AltLeft"]`) [API]. After the matching `keyup`, every roof came back to its "before" colour [pixel].
- **Upper floor:** the **tower roof is cut** (U_in 106,116,131 → floor 115,111,105). U_shadow stays 11,11,14 (`rt9-t32-upper-alt-held.jpg`).
- **Ground floor:**
  - The **west roof is cut over its whole square** (W_in → floor 135,132,124).
  - The **thatch is cut to the triangle** (E_in → floor 104,100,94).
  - W_shadow and E_out are unchanged (`rt9-t32-ground-alt-held.jpg`).
  - In the zoomed screenshot, the triangle's two dark fringes stay outside the cut (`rt9-t32-ground-alt-held-triangle-zoom.png`).
- **Extra, not asked: hovering also cuts.** At 3× zoom, with no token and no key held:
  - With `canvas.mousePosition` at (233,314), inside the west region, the west roof was **cut**. The canvas at (200,300) read floor 135,132,123 (`rt9-t32x-mouse-over-west-region-roof-cut-3x.jpg`).
  - After I moved the mouse to (435,482), outside every region, it was **drawn** again, reading roof 144,74,50 (`rt9-t32x-mouse-moved-off-roof-drawn-3x.jpg`) [API, pixel, screen].
  - This is the "hovering over the Region" case from Foundry's Occlusion hint.

## T33 how it looks with real pictures (at 3× zoom, Foundry's maximum)

Before every reading, the mouse was on empty ground and its position recorded. The rows of pixels below were read at whole scene pixels, and at half pixels near the edges.

**(1) With no token, do the roofs sit exactly over the rooms?** Nearly, but half a pixel right and down.

- **West roof, top-left corner** (`rt9-t33-west-corner-tl-no-token-3x.png`):
  - The floor picture's grey wall strip (scene x 63..70) stays visible outside the roof.
  - The roof begins at **70.5**, not 70: (70.0, 100) reads a blend (85,76,70), and from 71 it reads roof [pixel].
- **West roof, bottom-right corner** (`rt9-t33-west-corner-br-no-token-3x.png`):
  - The roof reaches **350.5**, so (350, 340) reads 80,46,34, a blend of the roof's last half pixel.
  - Then comes the transparent column, then the shadow over the floor (x 352..376 darker than the floor picture alone) [pixel].
- **Thatch, right edge at y = 210** (`rt9-t33-triangle-right-edge-no-token-3x.png`): thatch up to 770, then the dark fringe over the floor [pixel, screen].

**(2) When a roof is cut, what is left?**

- **Inside the region, the cut is clean and sharp.**
  - West roof cut by Alt: the floor shows up to 349 on row y = 340 and column x = 300.
  - Thatch cut: the floor shows up to 769 on row y = 210.
  - The step to the next colour is a single pixel at 3× [pixel].
- **A thin roof-coloured line remains along the right and bottom edges**, half a scene pixel wide:

  | Edge | Point | Reads | Before the cut | With a token selected |
  |---|---|---|---|---|
  | West roof, right | (350, 340) | 80,46,34 | the same | 40,23,17 |
  | West roof, bottom | (300, 350) | 71,46,35 | the same | 36,23,18 |
  | Thatch, right edge | (770, 210) | 102,85,53 | the same | 106,89,55 |

  The thatch line is visible in the zooms as a **thin golden diagonal line**: `rt9-t33-triangle-right-edge-alt-cut-3x.png` and `…-token-selected-3x.png`.
- **The left and top edges leave no such line.** After the cut, (70,100) reads floor 84,81,75 and (630,210) reads floor 95,93,87 [pixel].
- **The roof's shadow and fringe stay, because they lie outside the region and are never cut.**
  - Every reading beyond the edge is **identical** with the roof drawn and with it cut: x 351..382 on row y = 340, and x 771..800 on row y = 210 [pixel].
  - So around a cut roof there is a **soft dark halo** (the shadow, and on the triangle the fringe on both sides).
  - The halo is darkest right at the region's edge and stops there, so the edge of the cut reads as a **hard step from dark to clear floor**, not a soft fade (`rt9-t33-west-corner-br-alt-cut-3x.png`, `rt9-t33-triangle-right-edge-alt-cut-3x.png`).
- **With a token selected under the west roof**, everything beyond the room's wall is outside the token's sight and dark (6..11), so the halo cannot be seen there (`rt9-t33-west-corner-br-token-selected-3x.png`). The thin line at x = 350 still reads 40,23,17.

**(3) Is anything drawn wrongly?**

- **The roofs are offset by half a pixel.** Every roof sits **half a pixel right and down** of where the file put it (T29 rounding).
  - On the left and top edges this leaves a half-pixel blend between the room's wall and the roof.
  - On the right and bottom edges it leaves the thin line after a cut.
- I saw **no gap wider than that, and no doubled edge** [screen, pixel].

## T34 a player's view: not done

- **The account exists:** the world has a player account "CLAUDE PLAYER" (role Player, not logged in) [API].
- **It can't see a token:** it **owns and observes no actor**, so it could not control or see a test token.
- **What it would take**, which goes beyond the prompt's rules:
  - **changing permissions:** giving that user ownership of an actor;
  - **affecting other sessions:** activating or pulling to the House scene, which affects everyone logged in;
  - **logging in as that user** in a separate browser session. I don't know its password and must not enter one.
- So I did not try it.

## Cleanup and files

- **Cleanup:**
  - All test tokens were deleted (0 left).
  - The synthetic Alt key was released (`downKeys` empty).
  - The viewport emulation was cleared, and no sheet was left open.
  - The House scene's `_stats.modifiedTime` still equals its creation time (1795123755120) [API]. Earlier scenes were not touched.
  - Helper functions in the page (`window.__dd*`) stay in memory until it is reloaded. They store nothing.
- **Files in `foundry-results/retest/` from this run:**
  - `RESULTS-RETEST-6.md` (this file)
  - `RT9-house-scene.json`: the file as imported, byte-identical to the one in the zip
  - `RT9-README.txt`: the zip's README
  - `roundtrip-RT9-house.json`: Foundry's export, redacted
  - `roundtrip-diff-RT9-house.md`
  - `screenshots/rt9-*`: 24 files, normal views and 2×/3× zooms

## My reading (inference, not observation)

**The real export behaves as RT8 predicted:**
- Each roof tile is cut to its own region's shape only while a **selected** token is inside it.
- An unselected token stays hidden under the roof.
- A token outside the region cuts nothing.
- Highlight Objects (or hovering the mouse over the region, as GM) cuts all roofs, or that one roof.

**Three things in the export could be changed:**
1. **Write tile positions that survive Foundry's whole-pixel rounding.** The cropped pictures are an odd size (347 px), so their centres fall on half pixels, and Foundry rounds `x`/`y`. That shifts every roof half a pixel and leaves a thin roof-coloured line on the right and bottom edges after a cut. Two ways to avoid it:
   - use even-sized crops (for example 348 px), so the centre is a whole number;
   - or write `texture.anchorX`/`anchorY` 0 with `x`/`y` at the whole-number top-left. I did not test this.
2. **Decide where the eave shadow should live.** It sits in the roof picture but outside the region, so it never fades. It stays as a dark halo, with a hard edge, around a roof that has been cut away.
   - If the shadow should vanish with the roof, it has to lie inside the region, or be left out of the roof picture.
   - If it should stay, the floor picture could carry it instead.
3. **Resolve the walls mismatch.** The export contains walls (12, all solid) although the prompt and the README describe it differently. With those walls, a selected token sees only its own room. That is probably intended, but worth confirming.

**Not a Dragon Drop issue:** the hidden token's "+5 ft" elevation label shows through the roof.
