<!-- The report below is the Foundry session's own, kept as written except that local folder names are removed. The round-trip export and the screenshots it mentions stay on the person's PC. -->
# Retest 2: editor stairs, ladder and floor holes (2026-11-19)

Requested by the Dragon Drop developer session (relaying the person's request); the person confirmed in this session before anything was touched.

- Foundry **14.367**, world "Dragon Drop Test" (dnd5e 6.0.1). Driven by Claude in the Claude desktop app's built-in browser pane, signed in as **"CLAUDE GM"**. **Nothing was observed by the person.**
- Each observation is marked:
  - **[screen]**: a screenshot of Foundry.
  - **[API]**: Foundry's client: documents, `RegionDocument#testPoint`, `Token#checkCollision`, dialog text.
  - **[export]**: Foundry's own Export Data file.
- Same method as before:
  - The file was staged in `<Foundry data folder>\dd-test-import\retest\`, attached to Import Data (SHA-256 checked in the page), and imported with Foundry's Import button.
  - Export Data's file was captured through Foundry's uploader.
  - Tokens were created by sending the canvas the drop event a drag from the Actors list produces, and moved by mouse drag on the canvas.
- `Data/maps/dd-test-cellar.png` and `dd-test-ground.png` were checked first and are still present. The file was **not edited** (not even `_stats`).

**File:** `RT5-editor-connectors.json`, 4132 bytes, SHA-256 `15b5cbc27cb775baf623624ad8a88e5f706fc110f10928325e927dd562cd49ba`, which **matches** the developer's value. No BOM and no trailing newline.

**Scene:** created as "RT5 editor connectors" (id `0O8kyQ3O3uYT9JWf`). Import Data renamed it to the file's name, "Dragon Drop editor connectors", as it did in the earlier runs.

## Results

| Test | Result | What was seen |
|---|---|---|
| T5 import and read-back | **partial**: imported and kept, except `topInclusive` on the two Change Level regions | Notification *"Data for Scene "Dragon Drop editor connectors" was successfully imported from JSON."* [screen]. Levels Cellar -10..0 and Ground floor 0..10 with their pictures, `initialLevel` Cellar, 8 walls (4 per level), 0 lights [API, export]. **Exactly 3 regions** [API, export]:<br>- "Cellar stairs" (Change Level, both levels, -10..10, rect 770,210 70×140)<br>- "Ladder from Cellar to Ground floor" (Change Level, both levels, -10..10, rect 210,420 70×70)<br>- "Ground floor floor" (Define Surface placement bottom; light/move/sight/sound/occlusion true; exposure/culling false; Ground floor only; 0..10; rect 140,140 770×280, rect 140,420 560×140, holes 560,210 140×70 and 280,350 70×70)<br>All region and behaviour `_id`s, shapes (incl. both `hole: true`), `levels`, behaviour `type`, `name` and `system`, and `visibility: 4` are identical to the file. No fourth region. |
| `topInclusive` (written `false` on all three) | stored **`true`** on "Cellar stairs" and "Ladder from Cellar to Ground floor"; **`false`** on "Ground floor floor" [API, export] | The same pattern as retest 1: the two-level Change Level regions come back `true`, the single-level floor keeps `false`. Cause not tested (instructions: don't edit `_stats`). |
| Other round-trip differences | none apart from Foundry's usual defaults | `roundtrip-diff-RT5-editor-connectors.md`: 1 changed path (the `topInclusive` above), 0 dropped. Added are only defaults: scene `environment`/fog/etc.; level `background.color/tint/alphaThreshold`, `fog`, `textures`; wall `_id`, `animation`; region `restriction`, `attachment`, `highlightMode`, `displayMeasurements`, `hidden`, `_shapeConstraints`, `ownership`; shape `anchorX`, `anchorY`, `gridBased`. Foundry writes back `_stats.coreVersion: "14.367"`. |
| T6 is the hole a hole? | **pass** | Call: **`RegionDocument#testPoint({x, y, elevation: 5})`** on "Ground floor floor"; the method checks elevation then `this.polygonTree.testPoint(point)` [API]. Results:<br>- (385,175) first rectangle: **true**<br>- (595,245) first hole: **false**<br>- (315,385) second hole: **false**<br>- (280,490) second rectangle: **true**<br>- (805,490) open corner: **false**<br>That is the expected true, false, false, true, false. `polygonTree.testPoint` alone gives the same five values.<br>Foundry's merged geometry: one outline `910,140 910,420 350,420 350,350 280,350 280,420 700,420 700,560 140,560 140,140`. The second hole sits on the seam between the two rectangles, so it becomes a notch in the outline; the south-east corner is outside it. The first hole is a separate inner polygon with `isHole: true` [API].<br>Region layer on the Ground floor: the floor is hatched, both holes and the south-east corner are unhatched gaps (`screenshots/rt5-region-layer-ground-floor-holes-and-corner.jpg`) [screen]. |
| T7 stairs | **pass** | Token on the Cellar (700,280) dragged one square east onto the stairs: dialog *"Do you want to move DD Probe to Ground floor?"* (Movement Action Walk; Move Up / Don't Move) [screen, API] (`rt5-stairs-change-level-dialog.jpg`). **Move Up** put it on the Ground floor at elevation 0, at (770,280), in regions "Cellar stairs" and "Ground floor floor" [API]. |
| T7 ladder | **pass** | A new token on the Cellar (280,420) dragged one square west onto the ladder: the same dialog [screen, API] (`rt5-ladder-change-level-dialog.jpg`). **Move Up** put it on the Ground floor at elevation 0, at (210,420), in regions "Ground floor floor" and the ladder [API]. |
| T7 stairs' place on the Ground floor | **partial**: region confirmed there; walking onto it not possible in my pane | After Move Up, the Ground floor token stands inside "Cellar stairs" (`Token#regions`) [API], so the Change Level region is present on the Ground floor. To get a dialog it must walk off and back on. **No token on the Ground floor could be moved in my pane**: two mouse drags and one arrow key. The arrow key panned the view; the drags left the token in place, with no notification and no console message. `Token#checkCollision` west returned false, so no wall blocks it [API]. Drags on the Cellar worked every time. The same happened in retest 1 (RT3 Ground floor). Cause not identified; it may be my input method. |
| Optional: token in a hole vs beside | **partial** (placement only, no movement) | Dropped two new tokens on the Ground floor [API, screen `rt5-ground-floor-tokens-in-hole-and-beside.jpg`]:<br>- **In the first hole** (560,210): level Ground floor, elevation 0, `regions: []`, floor `testPoint` at its centre **false**.<br>- **Beside it** (420,210): level Ground floor, elevation 0, `regions: ["Ground floor floor"]`, `testPoint` **true**.<br>Neither fell or changed elevation, and no dialog appeared. A move into or out of the hole could not be tested: the token in the hole also could not be dragged, even though it is outside the floor region, so the floor region is not shown to be what blocks movement. |

## Cleanup and files

- All test tokens (5 in total) were deleted; the scene has no tokens. Earlier scenes were not touched.
- Files in this folder:
  - `RT5-editor-connectors.json`: as imported.
  - `roundtrip-RT5-editor-connectors.json`: Foundry's export, redacted (`_stats.lastModifiedBy` replaced with `"REDACTED-USER"`).
  - `roundtrip-diff-RT5-editor-connectors.md`: field-by-field diff.
  - `screenshots/rt5-*.jpg`: 4 screenshots.
