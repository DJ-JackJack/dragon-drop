# Re-test of Dragon Drop's fixed Foundry export (Foundry 14.367, 2026-11-18)

Requested by the Dragon Drop developer session (relaying the person's request); the person confirmed in the Foundry session before anything was touched. The report below
is that session's own, kept as it was written except that local folder names are removed. The round-trip exports and screenshots it mentions stay on the person's PC (they
are not copied here); `foundryTested.test.ts` and `observed.test.mjs` keep the facts that matter.

- Foundry **14.367** (stable), world "Dragon Drop Test" (dnd5e 6.0.1), the same throwaway world as the first run.
- Driven by Claude in the Claude desktop app's built-in browser pane, signed in as "CLAUDE GM". **Nothing was observed by the person.** Each observation is marked:
  **[screen]** seen in a screenshot of Foundry; **[API]** read from Foundry's client (documents, `canvas`, a token's line-of-sight polygon, `testCollision`, a config form's
  field values); **[export]** read from Foundry's own Export Data file.
- Same method as before: files staged in a folder inside the Foundry data folder and attached to the Import Data dialog (SHA-256 checked in the page), imported with Foundry's
  **Import** button; Export Data's file captured through Foundry's own uploader; tokens created by sending the canvas the drop event a drag from the Actors list produces; doors
  opened by clicking their door control.
- Pictures in `Data/maps/` were checked before starting. `_stats` was **not** added or edited: every file was imported exactly as written.

## Files

| File | Bytes | SHA-256 | Note |
|---|---|---|---|
| `A-one-level.json` | 4725 | `21759c3f…f68233` | the one-level export, as the Export button writes it |
| `D-two-levels-stairs-floor-hole-ceiling.json` | 5964 | `ecadeb9e…16fc49` | the two-level test scene with its stair, a floor with a hole and a ceiling |
| `C-dim.json` | 4762 | `446277b3…024c50` | A with only `environment: {darknessLevel: 0.75}` added |

## Results

| Test | Result | What was seen | Round trip (Foundry's export vs the file) |
|---|---|---|---|
| RT1 (A) | **pass** | Imported: "successfully imported". The level is kept: Ground floor 0..10 with `maps/vtt-test.png` [API, export]. Picture shown, 1400x980 at the scene origin with grid 70 [API, screen]; the top door's drawn gap lines up with the door wall and the grid. 18 walls drawn on the drawn walls. 4 door walls all closed (3 doors and the secret door). The top door opens on click: sight and movement then pass and light spills out; closed again. Window: sight passes, movement blocked [API]. Secret door: sight and movement blocked [API]. Lights: `#ff8800` at (420,420) reaching 420 px (6 squares); `#ffd68c` at (1050,490) reaching 350 px (5 squares) [API]. | Compared with `raw/roundtrip-battlemap-coreversion.json` (the first run's variant): **no key differs** apart from ids and `_stats`. Foundry writes back `_stats.coreVersion: "14.367"`, not 14.353. Against file A: nothing changed or dropped; only Foundry's usual defaults and wall/light ids added. The scene was renamed to the file's name by Import Data, as before. |
| RT2 (C) | **pass** | Scene Configuration > Basics shows **Darkness Level 0.75** (slider and number box) [screen, API]. The picture itself looks darkened: corners and edges of both rooms are darker, brighter around the two lights, viewed as GM with no token selected [screen]. `canvas` darkness 0.75 [API]. | `environment.darknessLevel: 0.75` in the export and no top-level `darkness` key [export]. Against RT1's export the only difference is `environment.darknessLevel` 0 vs 0.75. |
| RT3 (D, levels and walls) | **pass** | Both levels kept: Cellar -10..0 `dd-test-cellar.png`, Ground floor 0..10 `dd-test-ground.png`, `initialLevel` Cellar [API, export]. Each shows its own picture [screen]. Viewing Cellar: 5 walls and only the `#ff8800` light; viewing Ground floor: 10 walls, now cut around the openings, and only the `#ffd68c` light [API, screen]. A token on the Ground floor at (455,245): **north door closed:** sight does not pass, movement blocked; **north door opened** (clicked): **sight now passes** (the line-of-sight polygon goes out through 420..490 at y 140), movement not blocked; **window** (east wall, y 280..350): sight passes, movement blocked; **secret door** (west wall, y 350..420): sight and movement blocked [API, screen]. | Levels, walls (15) and lights (2) kept as written; only defaults and new wall/light ids added. |
| RT3 (D, regions) | **partial**: everything works, one stored value differs | 3 regions [API, export]. **"Cellar stairs":** levels Cellar and Ground floor, elevation -10..10, **Top Inclusive ticked**; Change Level with Allowed Movement Actions empty. **"Ground floor floor":** Ground floor, 0..10, Top Inclusive off; Shapes tab lists two rectangles, the second marked as a hole; Define Surface placement Bottom with Restricts Light and Darkness, Movement, Sight, Sound and Occlusion ticked, exposure and culling false. **"Cellar ceiling":** Cellar, -10..0, Top Inclusive off; Define Surface placement Top, the same five true, exposure and culling false [screen, API form values]. On the Region layer the hole is drawn as an unhatched gap in the floor at 560..700 x 210..280 [screen]. **Stair:** a token on the Cellar walked onto it and got "Do you want to move DD Probe to Ground floor?"; "Move Up" put it on the Ground floor at elevation 0 [API, screen]. | All region and behaviour ids kept. Shapes (including `hole`), `levels`, behaviour `type`, `name` and `system` are identical to the file. `visibility: 4` kept. **One difference: "Cellar stairs" `elevation.topInclusive` was written `false` and stored `true`.** The other two regions kept `false`. Foundry added its usual region defaults (`restriction`, `attachment`, `highlightMode`, `displayMeasurements`, `hidden`, `_shapeConstraints`, `ownership`, and per shape `anchorX`, `anchorY`, `gridBased`). |

## Notes

- **`topInclusive` on the stair.** Written `false`, stored `true`, shown ticked in the UI. In the first run, a stair region without `topInclusive` was also stored `true` when
  the file had no `_stats.coreVersion`, but `false` when the file said `14.367`; this file says `14.353` while Foundry runs 14.367. Not investigated further (`_stats` was not to
  be edited), so the cause is not confirmed. Nothing visible depended on it: the stair worked.
- **Floor and hole effect:** skipped. Two attempts to drag the Ground floor token two squares east into the hole did not move it (no dialog, no notification), so the check
  wasn't simple and was not pursued.
- **Not checked:** a live player client (the secret door icon hidden from players, darkness as a player sees it).
- **Left behind in the throwaway world:** scenes RT1, RT2 and RT3 (Import Data renamed them to "VTT test", "VTT test" and "Dragon Drop test: two levels"). The test tokens were
  deleted and the doors left closed. Earlier scenes were not changed. User ids in the exports were replaced with `"REDACTED-USER"`.
