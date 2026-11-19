<!-- The report below is the Foundry session's own, kept as written except that local folder names are removed. The round-trip export and the screenshots it mentions stay on the person's PC. -->
# Retest 3 (RT6): how Foundry v14 treats a level's foreground picture (2026-11-19)

Asked for by the person (the prompt file `rt6-roof-foreground.md`, relayed from the Dragon Drop developer session).

- Foundry **14.367**, world "Dragon Drop Test" (dnd5e 6.0.1). Driven by Claude in the Claude desktop app's built-in browser pane, signed in as **"CLAUDE GM"** (a GM). **Nothing was observed by the person.**
- Each observation is marked:
  - **[screen]**: a screenshot.
  - **[API]**: Foundry's client: `canvas.primary.levelTextures` meshes, `CONST.OCCLUSION_MODES`, the Level schema, Foundry's own localisation strings.
  - **[export]**: Foundry's Export Data.
- Method as before:
  - The file was staged in `Data/dd-test-import/retest/`, attached to Import Data (SHA-256 checked in the page), and imported with Foundry's Import button.
  - The export was captured through Foundry's uploader.
  - Tokens were placed by sending the canvas the drop event a drag from the Actors list produces; none were dragged.
- **Changed through the API (test tokens only):**
  - `elevation`: 5 in (b) and -5 in (f).
  - `sight.range`: 60 ft on every test token, so a selected token can see; the actor's default is 0, which leaves a selected view black because the scene has no lights.
- The scene file was **not edited**.

**Files.**
- `make-roof-pngs.mjs` (as given) wrote `dd-test-roof-ground.png` and `dd-test-roof-attic.png`, each 7127 bytes, 1050×700 RGBA, transparent except:
  - brown (150,90,60) at x 140..525, y 140..560
  - blue (60,100,170) at x 525..910, y 140..560

  Both were checked by decoding them, then copied to `Data/maps/`. `dd-test-cellar.png` and `dd-test-ground.png` were confirmed still there.
- `RT6-roof-foreground.json`: 999 bytes, SHA-256 `1741b49b6ea2ddd14ae41907f69bcb55caa87870ba1bda5adf5542b0b689f359`, which **matches**.
- **Scene:** created as "RT6 roof foreground" (id `abHB7ceiyPBZ7KlD`). Import Data renamed it to "Dragon Drop roof test".

## T8 import: pass

- *"Data for Scene "Dragon Drop roof test" was successfully imported from JSON."* [screen]
- Levels Cellar -10..0 (no foreground), Ground floor 0..10 (foreground `maps/dd-test-roof-ground.png`) and Attic 10..20 (foreground `maps/dd-test-roof-attic.png`). Ids, `sort`, backgrounds, `visibility` and `initialLevel` are all kept [API, export].
- `roundtrip-diff-RT6-roof-foreground.md`: **0 changed, 0 dropped.** Added defaults only:
  - per level `background.color "#999999"`, `background.tint "#ffffff"`, `background.alphaThreshold 0.75`, `fog.src null`, `textures.*`
  - **per foreground only `tint: "#ffffff"` and `alphaThreshold: 0.75`**, and no occlusion field
  - scene `environment`/fog/etc.
- `_stats.coreVersion` written back: "14.367" [export].
- Foundry's Level schema has exactly three foreground fields: `src`, `tint`, `alphaThreshold` [API].

## T9 what a GM sees with no token selected: one level at a time

How Foundry draws it [API]: `canvas.primary.levelTextures` holds two `PrimarySpriteMesh`es **for the viewed level only**, named `Level.<n>.background` and `Level.<n>.foreground`.

| Viewing | Drawn [screen] | Meshes [API] |
|---|---|---|
| Cellar | Cellar picture only; no brown, no blue (`rt6-t9-cellar-view.jpg`) | background elevation -10, visible; foreground elevation 0, `visible: false` (no texture) |
| Ground floor | ground picture, **brown over the west half** (covers "GROUND"); **no blue** (`rt6-t9-ground-floor-view.jpg`) | background elevation 0; foreground `dd-test-roof-ground.png` elevation **10**, visible, alpha 1 |
| Attic | Attic picture (same ground image), **blue over the east half**; **no brown** (`rt6-t9-attic-view.jpg`) | background elevation 10; foreground `dd-test-roof-attic.png` elevation **20**, visible, alpha 1 |

- **Elevations:** each level's background mesh sits at the level's **bottom** and its foreground mesh at the level's **top** [API].
- **Occlusion settings:** both meshes have `occlusionMode: 2`, which `CONST.OCCLUSION_MODES` names **SURFACE** (`{NONE: 0, FADE: 1, SURFACE: 2, RADIAL: 4, VISION: 8}`). `unoccludedAlpha: 1`, `occludedAlpha: 0`; `_occludedBySameElevationSurfaces` is `true` for backgrounds and `false` for foregrounds [API].
- **Other levels:** a viewer sees **no** other level's foreground (nor background), because `visibility.levels` is `[]` here [screen, API].

## T10 occlusion: no foreground faded in any placement

For each placement I read the viewed level's foreground mesh twice: with the token **not selected** and with it **selected** (`Token#control`), each after a 1.2 s wait. In every case and both states the mesh read `visible: true` (or `false` on the Cellar, which has no foreground), `alpha: 1`, `occluded: false`, `occlusionMode: 2`. Its `_occlusionState` read `{fade: 0, radial: 0, vision: 0, surface: 1}` in every placement where I read it [API].

| Case | Token (as stored) | Viewed level | Seen [screen] |
|---|---|---|---|
| (a) | Ground floor, elevation 0, top-left (280,280) | Ground floor | Brown drawn **over** the token (token hidden, only its selection frame shows); no fade, selected or not (`rt6-t10a-*.jpg`) |
| (b) | Ground floor, elevation 5 (set via API), same spot | Ground floor | Same: brown still covers the token ("+5 ft" label shows); no fade (`rt6-t10b-*.jpg`) |
| (c) | Ground floor, elevation 0, (630,280), in the blue area | Ground floor | Token fully visible: blue (the Attic's foreground) is not drawn on this view; brown unchanged (`rt6-t10c-*.jpg`) |
| (d) | Attic, elevation 10, (630,280), under blue | Attic | Blue drawn **over** the token (only its frame shows); no fade (`rt6-t10d-*.jpg`) |
| (e) | Attic, elevation 10, (280,280), in the brown area | Attic | Token fully visible: brown is not drawn on the Attic view (`rt6-t10e-*.jpg`) |
| (f) | Cellar, elevation -5 (set via API), (280,280) | Cellar | Token visible; no foreground drawn on the Cellar view (`rt6-t10f-*.jpg`) |
| (g) | Ground floor, elevation 0, (70,70), outside both | Ground floor | Token visible; brown unchanged (`rt6-t10g-*.jpg`) |

**Why nothing fades.** Foundry's own UI text for the Define Surface behaviour, its Occlusion hint, says what triggers SURFACE fading [API: localisation key `BEHAVIOR.TYPES.defineSurface.FIELDS.occlusion.hint`]:

> "When a controlled or detected Token is below a surface, Tiles using the "Surface" occlusion mode fade if they are at or above that surface, as do background and foreground textures. For surfaces at the top of a three-dimensional Region, fading only applies if the Token is also at or above the Region's bottom elevation. Hovering over the Region or pressing the "Highlight Objects" keybinding also triggers this effect."

So the fade is triggered by a **Define Surface region** (with Occlusion on), not by the foreground picture or by the token's elevation alone. This scene has no regions, and no fade happened. **I did not test a scene with a Define Surface region over the roof.** That would be the next test, and it would need a scene file with such a region.

## T11 is it a simple setting? No

Scene Configuration > Levels > Ground floor (the Level sheet) has fieldsets Background, Foreground, Fog of War and Positioning. **Foreground** offers only **Texture** (`foreground.src`) and **Tint** (`foreground.tint`, default `#ffffff`). There is no occlusion, fade or alpha option, and the stored `alphaThreshold` (0.75) isn't shown for the foreground (`rt6-t11-ground-floor-level-foreground-options.jpg`) [screen, API]. Positioning (anchor 0.5/0.5, offset 0/0, scale 1/1, fit Fill, rotation 0) applies to the level's textures.

## Cleanup and files

- All test tokens were deleted (0 left). The Level sheet was closed without saving. Earlier scenes were not touched.
- Files in this folder:
  - `make-roof-pngs.mjs`
  - `RT6-roof-foreground.json`: as imported
  - `roundtrip-RT6-roof-foreground.json`: Foundry's export, redacted (`_stats.lastModifiedBy` replaced with `"REDACTED-USER"`)
  - `roundtrip-diff-RT6-roof-foreground.md`
  - `screenshots/rt6-*.jpg`: 12 screenshots
