# Foundry VTT export tests: handoff for Claude Code

You are Claude Code, running on the PC of the person who builds **Dragon Drop** (a Windows map editor). They want to find out what **Foundry VTT v14**
really does with the battlemap exports Dragon Drop writes. Those exports were built from Foundry's documentation only; nobody has tried them in a real
Foundry. Your job is to run the tests below **together with the person**, record exactly what Foundry does, and leave a results folder that the
Dragon Drop developer (another Claude session, reading only your results) can turn into fixes and regression tests.

## Who does what

- **You cannot see or click in Foundry.** The person does every Foundry step. You prepare files, tell them exactly what to click, ask the questions, read the
  files they export from Foundry, compare those with what Dragon Drop wrote, and write the results.
- **One step at a time.** Say what to do, wait for them to report, then go on. Never invent an observation: if they didn't see it, write "not observed".
- If a Foundry menu or label differs from what is written here, ask them what it is called and record the difference. It is useful information.
- Quote error messages exactly (Foundry notifications and the browser console, F12). A screenshot path is fine for anything visual.

## Ground rules

- Use a **throwaway Foundry world** (ask them to create "DD Test World" with any system). Never import into a real campaign world.
- Don't change, commit or push anything in any Dragon Drop folder. Write only inside a new folder called `foundry-results` next to this kit (the folder
  that holds this file).
- No secrets in the results. Foundry's exported JSON can contain user ids and `_stats`; keep the data as Foundry wrote it, but replace any user id or
  `author` value with `"REDACTED-USER"`, and say in `RESULTS.md` that you did. Never read or copy Foundry licence files or anything under the user's account.
- If Foundry v14 isn't what they run, say so, ask whether to stop, and record the exact version either way.

## The kit (this folder)

- `levels-test/dragon-drop-foundry-levels-test.zip`: a made-up two-level scene (Cellar below, Ground floor above) with two pictures, `scene-no-stairs.json`,
  `scene-with-stairs.json` and a README. Unzip it into `foundry-results/work/levels/` (PowerShell: `Expand-Archive`).
- `battlemap-test/`: what Dragon Drop's Export button really writes for an ordinary one-level battlemap: `vtt-test-foundry.zip` (picture, scene, README),
  `vtt-test.dd2vtt` (Universal VTT), `vtt-test.png`, and `WHAT-IS-IN-THE-MAP.md` (exactly what is drawn where).
- `RESULTS-TEMPLATE.md`: copy it to `foundry-results/RESULTS.md` and fill it in.
- `observed.test.example.mjs`: the shape of the test file you write at the end.
- `VERSION.txt`: which Dragon Drop version made the kit.

## Step 0: set up

Ask for and record: the exact Foundry version and build (the setup screen shows "Version 14 Build N"), their browser, the name of the throwaway world, where their Foundry
data folder is (default `%LOCALAPPDATA%\FoundryVTT\Data`). Write `foundry-results/environment.json` with these, today's date and the kit's `VERSION.txt` text.
Make `foundry-results/work/` and `foundry-results/raw/`. Unzip the levels test into `work/levels/`.

## Test 1: the two-level scene without stairs

The questions this answers are the open ones in Dragon Drop's `docs/FOUNDRY.md`: **Q1** a scene with only `levels` (no top-level background) imports and each level
shows its own picture; **Q2** `visibility: { levels: [] }` means "this level sees only itself"; **Q3** walls and lights tagged to one level work per level.

1. Tell them to upload `work/levels/maps/dd-test-cellar.png` and `dd-test-ground.png` into their Foundry data folder under `maps` (Foundry's File Browser > Upload).
2. Create an empty Scene. Right-click it in the Scenes list > **Import Data** > choose `work/levels/scene-no-stairs.json`. Open the scene.
3. Ask and record each of these as yes / no / not observed, with a note:
   a. Did it import without any error? (Copy any error text exactly.)
   b. Scene Configuration > Levels: two levels, "Cellar" (elevation -10 to 0) and "Ground floor" (0 to 10), each with a picture?
   c. Switching between the levels: does each show its own picture?
   d. On the Ground floor: the room walls, a closed door in the north wall, a window on the east wall and a secret door on the west wall, and only on that level? On
      the Cellar: the room wall and one cross wall, and only on that level?
   e. Lights: an orange torch on the Cellar only, a white lamp on the Ground floor only?
   f. With a token on each level, do light and sight behave per level (the other level's walls and lights are ignored)?
4. **Round trip.** Right-click the imported scene > **Export Data**. Ask for the path of the file Foundry saved. Copy it to `foundry-results/raw/roundtrip-no-stairs.json`
   (redact as above), and copy the original `scene-no-stairs.json` to `raw/dragon-drop-no-stairs.json`.
5. Compare the two files yourself and write `raw/roundtrip-diff-no-stairs.md`: which fields Foundry **kept as written**, which it **changed** (old value, new value),
   **dropped**, and **added** (list the added ones, ignoring `_stats` and sort order). Pay special attention to `levels[*]` (every field), `initialLevel`,
   `walls[*].levels`, `lights[*].levels`, `environment` / darkness, and anything Foundry did to the ids.

## Test 2: the stair region

1. New empty Scene > Import Data > `work/levels/scene-with-stairs.json`.
2. Record: did it import? Any error (exact text, also from the F12 console)? Then Scene Regions: is there a region on the east side; what behaviours does it have; which levels does it list?
3. Export Data > `raw/roundtrip-with-stairs.json`, and the original as `raw/dragon-drop-with-stairs.json`. Write `raw/roundtrip-diff-with-stairs.md` the same way.
   Focus on `regions[*].behaviors[*]`: the `type` string and every key under `system`.

## Test 3: a scene built by hand in Foundry (this settles Q4 and Q5)

This is the most valuable test, because the documentation doesn't spell out how Foundry stores these. Ask them to build, in a new scene:

- two levels (call them "Down" and "Up", elevations 0 to 10 and 10 to 20),
- one wall and one light on each level,
- a Region with a **Change Level** behaviour (a stair between the two levels),
- a Region with a **Define Surface** behaviour (a floor or ceiling), and, if Foundry allows it, a second one that is a hole (an opening in a floor).

They don't need pictures or a pretty map. Then Export Data > `raw/reference-by-hand.json`. From it write `observed/shapes.json` containing, exactly as Foundry wrote them:
the level objects, one wall and one light with their `levels` values, and every region with all its behaviours (the `type` string and the whole `system` object). Don't
interpret names: copy the stored strings.

## Test 4: the real one-level export

1. Unzip `battlemap-test/vtt-test-foundry.zip` into `work/battlemap/`. Read `battlemap-test/WHAT-IS-IN-THE-MAP.md` so you know what should be where.
2. Follow the README inside the zip (upload the PNG to `maps`, import the scene). Record: imported? picture shown? Does the picture line up with Foundry's grid (squares match
   the map's squares; ask them to look at a door against the grid)? Are the walls where the map shows them? The door: closed and openable? The window: you can see through it
   but not walk through it? The secret door: appears as plain wall to players (use a player view or the door's hidden state)? Both lights: where, colour, how far they reach?
   Is the scene dark or bright, and is that the setting in the scene configuration (Q6: `darkness` / `environment.darknessLevel`: per scene, or moved onto levels in v14)? Do
   the light settings behave as expected (Q7: `coloration`, `luminosity`, `attenuation`)?
3. Export Data > `raw/roundtrip-battlemap.json`; the scene file from the zip as `raw/dragon-drop-battlemap.json`; `raw/roundtrip-diff-battlemap.md` the same way as above.

## Test 5 (optional): the Universal VTT file

Only if the person wants it and has the **Universal Battlemap Importer** module (it may not support v14 yet: if it doesn't, record exactly that and skip).

1. Enable the module in the throwaway world. In the Scenes tab use the importer's button, choose `battlemap-test/vtt-test.dd2vtt`, keep the default settings.
2. Record the same things as Test 4: walls, the door, the window (does it become a see-through wall?), the secret door (a plain wall?), both lights, whether the grid lines up.
3. Note which importer version they used. If the importer reported any warnings, quote them.

## Finish: write the results

In `foundry-results/`:

1. `RESULTS.md`: the template, filled in. Answer Q1 to Q7 each as **yes / no / partly / not observed**, with the evidence (the file and the key, or the screenshot) and a note. List anything
   unexpected under "Surprises". Under "Suggested changes to Dragon Drop's export" write what you think should change, but **do not implement it**.
2. `observed.test.mjs`: a dependency-free test (`node:test`, run with `node --test observed.test.mjs`) that pins down what Foundry really did, following
   `observed.test.example.mjs`. Rules for it:
   - It reads only the files in `raw/` and `observed/`, next to itself.
   - One `test()` per fact that the data proves (for example "the round trip kept both levels and their elevations", "a Change Level behaviour has type `...` and these `system`
     keys"). Assert what Foundry **actually** did, even where Dragon Drop expected something else; where they differ, add the comment `// Dragon Drop expected: ...`.
   - Facts that only the person could see go in the `observations` object at the top (true / false / null for not observed, plus a note), and a test that checks that object is complete.
   - Run it. It must pass. If a fixture is missing because a test was skipped, the matching test should be `skip`ped with a reason, not deleted.
   - The example ends with a test that fails while any placeholder (`TO FILL IN`, `(fill in)`) is left. Keep that test; it passes once the file is really filled in.
3. Check that `raw/` and `observed/` hold everything the test reads, and that no file contains a user id (search for the redaction marker).
4. Tell the person to zip the `foundry-results` folder (leaving out `work/`) and give it back to the Dragon Drop developer, or paste `RESULTS.md` if they can't send the zip.

Finish by telling them in two or three sentences what the result is: what worked, what didn't, and what you couldn't test.
