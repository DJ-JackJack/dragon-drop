# Foundry VTT export tests: results

- Foundry version and build:
- Browser:
- Dragon Drop kit (from VERSION.txt):
- Date:
- Throwaway world and game system:
- Redactions made (what, and where):

## The seven open questions

| # | Question | Answer (yes / no / partly / not observed) | Evidence (file and key, or screenshot) | Notes |
|---|---|---|---|---|
| Q1 | A scene with only `levels` (no top-level `background`) imports, and each level shows its own picture | | | |
| Q2 | `visibility: { levels: [] }` makes a level see only itself | | | |
| Q3 | Walls and lights tagged to one level behave per level (sight and light stop at the level boundary) | | | |
| Q4 | The Change Level behaviour: its `type` and every key under `system`; whether the region needs `levels` and `elevation` as Dragon Drop writes them | | | |
| Q5 | Define Surface regions for floors, ceilings and holes: the stored shape | | | |
| Q6 | What Foundry does with `darkness` / `environment.darknessLevel` per scene, and whether v14 moved it onto levels | | | |
| Q7 | Light `config` fields (`coloration`, `luminosity`, `attenuation`): same meaning as Dragon Drop assumes | | | |

## Test 1: two levels, no stairs

(a to f from the handoff, each as yes / no / not observed, with notes. Then a pointer to `raw/roundtrip-diff-no-stairs.md` and a three-line summary of what Foundry kept, changed and dropped.)

## Test 2: stair region

(imported? exact error text; what the region looks like; pointer to the diff.)

## Test 3: built by hand

(what was built; pointer to `observed/shapes.json`; the exact `type` strings and `system` keys for Change Level and Define Surface.)

## Test 4: the real one-level export

(imported? picture, grid alignment, walls, door, window, secret door, lights, darkness; pointer to the diff.)

## Test 5: Universal VTT (optional)

(importer and version, or "module not available for v14"; the same checks as Test 4.)

## Surprises

## Suggested changes to Dragon Drop's export

(Suggestions only. Don't implement them.)

## Not tested, and why
