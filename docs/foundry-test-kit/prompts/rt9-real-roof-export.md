# RT9: a real Dragon Drop roof export in Foundry (a prompt for Claude Code on the PC that has Foundry)

*Paste everything from the next heading to the end into the Claude Code session on the PC that has Foundry v14 (the one that ran the earlier tests is best), and let it run. The person also has to put one file where you can read it: **`House-foundry.zip`**, which comes with this prompt (probably in their Downloads folder).*

---

You are helping test Dragon Drop (a map editor) against the person's real Foundry VTT v14. They have asked for this test. Do every step you can yourself, the way you did in the earlier runs (driving Foundry in the browser pane, Foundry's client API, staging files in the Foundry data folder, placing tokens by the canvas drop event, setting elevation and a sight range through the API); ask the person only for what you cannot do. Earlier results are in `foundry-results/` (RESULTS.md, RESULTS-RETEST.md, -2, and `retest/RESULTS-RETEST-3.md` to `-5.md`); read `retest/RESULTS-RETEST-5.md` first (your RT8 rerun), because this test checks that what it found works with a scene **Dragon Drop itself wrote**.

## Why

RT8 showed that a roof drawn as a Foundry **Tile** (Surface occlusion) with a **Define Surface** ceiling region over it is cut away, to the region's shape, while a token **you control** stands under it, and only that roof. Dragon Drop now writes its roofs that way. This test imports **the real export** (not a hand-made file) and checks the same behaviour, and how it looks with real roof pictures.

## Rules

- Write only in `foundry-results/retest/` (create `RESULTS-RETEST-6.md` there) and in the Foundry folders you used before (`Data/maps`, the staging folder for Import Data). Do not touch earlier scenes. Make a NEW scene.
- Redact Foundry user ids in anything you save (`"REDACTED-USER"`). No licence or account data.
- Report only what you observed. Mark each observation **[screen]**, **[pixel]** (a colour read from the canvas, as in RT8), **[API]** (say how you read it) or **[export]**. Put any reading of what it means in a separate short section at the end, marked as your inference.
- Do **not** edit the scene file (not even `_stats`) or the pictures. If something fails, stop and report; do not work around it.
- Do not rely on dragging tokens. Drop them, then set elevation and a sight range of 60 ft through the API, and say so. "Selected" means `canvas.tokens.releaseAll()` then `Token#control()`, as in RT8. Remove test tokens between placements with `TokenDocument#delete`.
- If the browser pane is hidden (0 frames a second), emulate a 1024 x 768 viewport first, as in RT7 and RT8, and say so. Wait 1.5 s after every change before reading anything.

## Step 1: the files

The person gives you **`House-foundry.zip`** (ask them where it is if it is not in their Downloads folder; do not go on without it). Check its SHA-256 is `62e617cb2f5cd1fde5e133a62e125cfb8dbdddecbb28df13225a4667391b61bf` (if it differs, say so and stop). Unzip it into a temporary folder (not into Foundry's folders). It holds five PNG pictures, `house-scene.json` (SHA-256 `4a3c075be9bf44f5280cb0049e0093dae7af40041dd1062b951a9042cf88528d`: check it too) and `README.txt`. Copy the **five PNGs** into `Data/maps` (they are new names; nothing is replaced). Do not edit `house-scene.json`.

Import it with Import Data into a new empty scene named "RT9 real roof export" (it will be renamed "House"), then Export Data to read back what Foundry stored.

What it is (from the file, so you know what to expect): a house, 15 x 10 squares at 70 px = 1050 x 700. Two levels: **Ground floor** (0..10 ft) and **Upper floor** (10..20 ft); the scene opens on the Upper floor. Ground floor has two roofs: **West house roof** (a clay-tile rectangle over the room at x 70..350, y 70..350) and **East lean-to roof** (a thatch triangle with corners (560,70), (840,70), (700,350)). Upper floor has **Tower roof** (slate, a rectangle x 210..560, y 210..490). Each roof is a **Tile** at its level's top elevation (10, 10 and 20) with `occlusion` mode 2 / modes [2] and alpha 0, and a **Define Surface** region (placement top, the level's range) with the roof's shape. The tiles are cropped pictures (347 x 347 for the two ground roofs, 417 x 347 for the tower), placed by their centres: (210.5, 210.5), (700.5, 210.5) and (385.5, 350.5). The roof pictures are see-through outside the roof except for a soft shadow just beyond the eave (down and to the right). There are no walls, lights or stairs.

## Tests

**T29, import.** Imports without error? List every difference between the file and Foundry's export (apart from ids, `_stats` and the usual added defaults). In particular, for each tile: the stored `occlusion` (`modes` must be `[2]`), `x`, `y`, `width`, `height` (are the half pixels, such as 210.5, kept?) and its bounds from `Tile#bounds` (the west roof should cover x 37..384, y 37..384), `elevation` and `levels`; for each region: shapes (the polygon's points), elevation and `levels`; and that no level has a foreground.

**T30, Ground floor.** View the Ground floor. Probe points (scene coordinates): **W_in** (110,110) inside the west roof; **W_shadow** (358,300), just outside its right edge, in the shadow; **E_in** (700,120) inside the triangle; **E_out** (570,300), inside the east tile's picture but outside the triangle; **N** (525,560), plain ground. For each placement say what is read at each probe ("roof": the tile's colour; "floor/ground": what is under it; "shadow": slightly darker than the floor beside it) and what the token looks like. Token centres to aim for are given (a drop at (210,210) was stored in RT8 with its centre at (175,175): aim so the **stored centre** is near the one given, and report the stored position):
- (a) no token;
- (b) a token with centre near (210,210), elevation 0, **not selected**;
- (c) the same token **selected**;
- (d) a token with centre near (700,170), elevation 0, selected (inside the triangle);
- (e) a token with centre near (525,500), elevation 0, selected (inside no region);
- (f) **two** tokens, near (210,210) and (700,170), both selected.

**T31, Upper floor.** View the Upper floor. Probe points: **U_in** (260,260) inside the tower roof; **U_shadow** (568,400) just outside its right edge; **N2** (100,600) plain ground. Placements (token elevation set by the API; Foundry holds a token a token-height below the ceiling, so 15 is what it will store):
- (a) no token;
- (b) a token with centre near (385,350), elevation 15, selected;
- (c) the same token **not selected**;
- (d) a token with centre near (100,600), elevation 15, selected (outside the region).

**T32, Highlight Objects.** With no token, hold the **Highlight Objects** key (a synthetic `keydown` of `AltLeft`, as in RT8) on each level and say what happens to each roof (cut to its region's shape?).

**T33, how it looks.** With real pictures: (1) with no token, do the roofs sit exactly over the rooms (screenshot, zoomed on one roof's corner)? (2) when a roof is cut away, what is left: a soft dark halo from the roof's shadow beyond its edge, or a hard line, or nothing (zoomed screenshot of the west roof cut away, with the token under it, and of the triangle cut away)? Is the edge of the cut sharp or soft? (3) is anything drawn wrongly (a gap, a doubled edge, a roof offset by a pixel or two)?

**T34, a player's view (only if you can).** If you can see Foundry as a non-GM player (a second browser window or session logged in as a player who owns a token), repeat T30 (c) and say what the player sees. If you cannot, say so and do not try anything risky (do not change user permissions or passwords).

## Reply

Save the fuller notes, your redacted export and the screenshots in `foundry-results/retest/` (`RESULTS-RETEST-6.md`). Then give the person a short summary (a table: T29 to T34, and each placement with its probe results) to paste back to the Dragon Drop developer, and tell them which files to send (`RESULTS-RETEST-6.md` and the redacted export). End with a short "My reading" section (inference): does a roof from a real export behave as in RT8, and is there anything to change in how the roofs are written?
