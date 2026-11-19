// What Foundry VTT really did with Dragon Drop's scene exports, pinned down as tests.
//
//   node --test observed.test.mjs        (Node 20 or newer; no packages needed)
//
// Reads only raw/ and observed/ next to this file. Each test asserts what Foundry ACTUALLY did; where that differs from what
// Dragon Drop expected there is a "// Dragon Drop expected: ..." comment. Files named *-coreversion* are variants of Dragon Drop's
// files with exactly one key added ("_stats": {"coreVersion": "14.367"}); see RESULTS.md for why.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => { const f = path.join(here, rel); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const missing = (...pairs) => { const gone = pairs.filter(([, v]) => !v).map(([n]) => n); return gone.length ? `${gone.join(", ")} missing` : false; };

/** Facts about the run. */
export const run = {
  foundryVersion: "14",
  foundryBuild: "367",
  date: "2026-11-18",
  dragonDropKit: "Dragon Drop Foundry test kit / made 2026-11-19T01:07:33.593Z / from commit a5b6256",
  world: "Dragon Drop Test (dnd5e 6.0.1), throwaway",
  observer: "Claude, driving Foundry in the Claude desktop app's built-in browser as user 'CLAUDE GM'. The person asked Claude to do every step; nothing here was seen by the person.",
};

/**
 * What could only be seen on screen (true / false / null for not observed), with a note. "as written" = Dragon Drop's file unchanged;
 * "variant" = the same file with _stats.coreVersion "14.367" added.
 */
export const observations = {
  test1_importedWithoutError: { value: true, note: "As written: notification 'Data for Scene \"Dragon Drop test: two levels\" was successfully imported from JSON.', no console errors. But see the next keys: the levels were replaced." },
  test1_twoLevelsWithElevationsAndPictures: { value: false, note: "As written: Scene Configuration > Levels lists one level 'Dragon Drop test: two levels' [0, 20], no picture (screenshots/test1-as-written-levels-tab-one-default-level.jpg)." },
  test1_eachLevelShowsItsOwnPicture: { value: false, note: "As written: grey background only." },
  test1_groundFloorWallsDoorWindowSecretOnlyThere: { value: false, note: "As written: no walls drawn at all (they are tagged to level ids that no longer exist)." },
  test1_cellarWallsOnlyThere: { value: false, note: "As written: no walls drawn at all." },
  test1_lightsOnTheirOwnLevel: { value: false, note: "As written: no lights drawn at all." },
  test1_tokensSeePerLevel: { value: null, note: "As written: not possible, the scene has a single level after import. See test1_variant_tokensSeePerLevel." },
  test1_variant_twoLevelsWithPictures: { value: true, note: "Variant: Cellar -10..0 and Ground floor 0..10, each showing its own picture (screenshots/test1-variant-cellar-level.jpg, test1-variant-ground-floor-level.jpg)." },
  test1_variant_wallsAndLightsOnlyOnTheirLevel: { value: true, note: "Variant: viewing Cellar shows 5 walls and only the #ff8800 light; viewing Ground floor shows 7 walls and only the #ffd68c light." },
  test1_variant_tokensSeePerLevel: { value: true, note: "Variant: at the same x/y, the Cellar token's line of sight is cut by the Cellar cross wall, the Ground floor token's is not (screenshots/test1-variant-*-token-vision.jpg)." },
  test1_variant_openDoorAndWindowLetSightThrough: { value: false, note: "Variant: door, window and secret door overlap full room walls in Dragon Drop's levels test file, so the opened north door and the window still block sight (screenshots/test1-variant-north-door-open-still-blocked.jpg)." },
  test2_stairsSceneImported: { value: true, note: "As written: 'successfully imported', no console errors; levels replaced as in Test 1, region kept." },
  test2_variant_changeLevelWorks: { value: true, note: "Variant: token walked onto the region on the Cellar, Foundry asked 'Do you want to move DD Probe to Ground floor?', Move Up put it on Ground floor at elevation 0 (screenshots/test2-variant-change-level-dialog.jpg)." },
  test3_holeCouldBeDrawn: { value: true, note: "Region Controls > Create Holes, drawn inside the selected floor region (screenshots/test3-floor-region-with-hole.jpg)." },
  test4_importedWithoutError: { value: true, note: "As written: 'Data for Scene \"VTT test\" was successfully imported from JSON.', no console errors." },
  test4_pictureShown: { value: false, note: "As written: grey grid, no map picture, no walls, no lights (screenshots/test4-as-written-no-picture.jpg)." },
  test4_pictureLinesUpWithGrid: { value: null, note: "As written: no picture is shown, so alignment could not be looked at. See test4_variant_pictureLinesUpWithGrid." },
  test4_doorWindowSecretBehaveAsExpected: { value: null, note: "As written: no walls are drawn, so nothing to try. See the test4_variant_* keys." },
  test4_lightsWhereAndColourExpected: { value: false, note: "As written: no lights drawn." },
  test4_variant_pictureLinesUpWithGrid: { value: true, note: "Variant: at 3x zoom the doorway drawn in the top wall coincides with the door wall 420..490 and its ends sit on grid lines (screenshots/test4-variant-top-door-vs-grid-3x.jpg)." },
  test4_variant_wallsWhereMapShows: { value: true, note: "Variant: all 18 wall lines lie on the walls drawn in the picture (screenshots/test4-variant-walls-layer.jpg)." },
  test4_variant_doorClosedAndOpenable: { value: true, note: "Variant: doors start closed; clicking the top door opened it, light spilled through (screenshots/test4-variant-top-door-open.jpg); closed again." },
  test4_variant_windowSeeThroughNotWalkThrough: { value: true, note: "Variant: Foundry's testCollision across the window: sight not blocked, movement blocked." },
  test4_variant_secretDoorHiddenFromPlayers: { value: null, note: "Not observed in a player client. Foundry's DoorControl#isVisible returns false for door type 2 when the user is not a GM, and the wall blocks sight; the GM sees a door icon." },
  test4_variant_lightsWhereAndColourExpected: { value: true, note: "Variant: orange #ff8800 at square (6,6) reaching 6 squares, warm white #ffd68c at (15,7) reaching 5 squares, clipped by walls." },
  test4_sceneIsBright: { value: true, note: "environment.darknessLevel 0 (Foundry's default; Dragon Drop writes none); Scene Configuration > Basics shows Darkness Level 0." },
  test5_universalImporterAvailableForV14: { value: true, note: "Universal Battlemap Importer 6.1.1 (dd-import), compatibility minimum/verified/maximum 14; enabled in the throwaway world for this test." },
  test5_pictureLinesUpWithGrid: { value: true, note: "Picture origin equals the padded scene origin (350, 280), grid 70 (screenshots/test5-universal-importer-walls-layer.jpg)." },
  test5_windowBecameAWall: { value: false, note: "No wall covers the window span; tokens can walk and see through it." },
  test5_secretDoorIsPlainWall: { value: true, note: "The secret-door span is an ordinary wall (door 0)." },
};

test("every observation is answered (true, false, or null with a note saying why it was not observed)", () => {
  for (const [key, o] of Object.entries(observations)) {
    assert.ok(o && "value" in o && typeof o.note === "string", `${key} is malformed`);
    assert.ok([true, false, null].includes(o.value), `${key}.value must be true, false or null`);
    assert.ok(o.note.length > 0, `${key} needs a note`);
  }
});

// ----- the files -----

const dd = {
  noStairs: load("raw/dragon-drop-no-stairs.json"),
  withStairs: load("raw/dragon-drop-with-stairs.json"),
  battlemap: load("raw/dragon-drop-battlemap.json"),
  noStairsCV: load("raw/dragon-drop-no-stairs-coreversion.json"),
  withStairsCV: load("raw/dragon-drop-with-stairs-coreversion.json"),
  battlemapCV: load("raw/dragon-drop-battlemap-coreversion.json"),
};
const rt = {
  noStairs: load("raw/roundtrip-no-stairs.json"),
  withStairs: load("raw/roundtrip-with-stairs.json"),
  battlemap: load("raw/roundtrip-battlemap.json"),
  noStairsCV: load("raw/roundtrip-no-stairs-coreversion.json"),
  withStairsCV: load("raw/roundtrip-with-stairs-coreversion.json"),
  battlemapCV: load("raw/roundtrip-battlemap-coreversion.json"),
};
const byHand = load("raw/reference-by-hand.json");
const shapes = load("observed/shapes.json");
const uvtt = load("raw/universal-vtt-import.json");

const levelIds = (scene) => new Set(scene.levels.map((l) => l._id));
const stripAdded = (doc, added) => Object.fromEntries(Object.entries(doc).filter(([k]) => !added.includes(k)));

// ----- why the levels disappear -----

test("Dragon Drop's scene files carry no _stats.coreVersion; Foundry's exports carry 14.367", { skip: missing(["dragon-drop-no-stairs", dd.noStairs], ["roundtrip-no-stairs", rt.noStairs]) }, () => {
  for (const f of [dd.noStairs, dd.withStairs, dd.battlemap].filter(Boolean)) assert.equal(f._stats?.coreVersion, undefined);
  assert.equal(rt.noStairs._stats.coreVersion, "14.367");
  assert.equal(rt.noStairs._stats.exportSource.coreVersion, "14.367");
});

for (const [label, ours, theirs, name] of [
  ["two levels, no stairs", "noStairs", "noStairs", "Dragon Drop test: two levels"],
  ["stair region", "withStairs", "withStairs", "Dragon Drop test: two levels"],
  ["real one-level export", "battlemap", "battlemap", "VTT test"],
]) {
  test(`as written (${label}): Foundry replaced Dragon Drop's levels with one default level`, { skip: missing([ours, dd[ours]], [theirs, rt[theirs]]) }, () => {
    // Dragon Drop expected: its levels (ids, names, elevations, pictures) kept as written
    assert.equal(rt[theirs].levels.length, 1);
    const [only] = rt[theirs].levels;
    assert.equal(only._id, "defaultLevel0000");
    assert.equal(only.name, name);
    assert.deepEqual(only.elevation, { bottom: 0, top: 20 });
    assert.equal(only.background.src, null);
    for (const l of dd[ours].levels) assert.ok(!levelIds(rt[theirs]).has(l._id), `${l.name} should be gone`);
  });

  test(`as written (${label}): initialLevel was changed to defaultLevel0000`, { skip: missing([ours, dd[ours]], [theirs, rt[theirs]]) }, () => {
    // Dragon Drop expected: initialLevel kept (it names a level in the file)
    assert.ok(dd[ours].levels.some((l) => l._id === dd[ours].initialLevel));
    assert.equal(rt[theirs].initialLevel, "defaultLevel0000");
  });

  test(`as written (${label}): every wall and light still names a level that no longer exists`, { skip: missing([theirs, rt[theirs]]) }, () => {
    // Dragon Drop expected: each wall and light tagged to a level of the scene
    const ids = levelIds(rt[theirs]);
    for (const doc of [...rt[theirs].walls, ...rt[theirs].lights]) {
      assert.equal(doc.levels.length, 1);
      assert.ok(!ids.has(doc.levels[0]));
    }
  });
}

test("as written: walls and lights kept every field Dragon Drop wrote (Foundry only added _id, animation and defaults)", { skip: missing(["dragon-drop-battlemap", dd.battlemap], ["roundtrip-battlemap", rt.battlemap]) }, () => {
  for (const [ours, theirs] of [[dd.noStairs, rt.noStairs], [dd.battlemap, rt.battlemap]].filter(([a, b]) => a && b)) {
    assert.equal(theirs.walls.length, ours.walls.length);
    ours.walls.forEach((w, i) => assert.deepEqual(stripAdded(theirs.walls[i], ["_id", "animation"]), w));
    assert.equal(theirs.lights.length, ours.lights.length);
    ours.lights.forEach((l, i) => {
      const t = theirs.lights[i];
      for (const k of Object.keys(l).filter((k) => k !== "config")) assert.deepEqual(t[k], l[k], `light ${i} ${k}`);
      for (const k of Object.keys(l.config)) assert.deepEqual(t.config[k], l.config[k], `light ${i} config.${k}`);
    });
  }
});

test("walls and lights get new random _ids (Dragon Drop wrote none)", { skip: missing(["roundtrip-battlemap", rt.battlemap]) }, () => {
  assert.ok(dd.battlemap.walls.every((w) => !("_id" in w)));
  assert.ok(rt.battlemap.walls.every((w) => /^[A-Za-z0-9]{16}$/.test(w._id)));
  assert.ok(rt.battlemap.lights.every((l) => /^[A-Za-z0-9]{16}$/.test(l._id)));
});

// ----- with _stats.coreVersion added (variants) -----

test("variants differ from Dragon Drop's files only by _stats.coreVersion 14.367", { skip: missing(["dragon-drop-*-coreversion", dd.noStairsCV && dd.withStairsCV && dd.battlemapCV]) }, () => {
  for (const [a, b] of [[dd.noStairs, dd.noStairsCV], [dd.withStairs, dd.withStairsCV], [dd.battlemap, dd.battlemapCV]]) {
    const { _stats, ...rest } = b;
    assert.deepEqual(_stats, { coreVersion: "14.367" });
    assert.deepEqual(rest, a);
  }
});

test("variant: the round trip kept both levels and their elevations, pictures, visibility and sort", { skip: missing(["roundtrip-no-stairs-coreversion", rt.noStairsCV]) }, () => {
  assert.equal(rt.noStairsCV.levels.length, 2);
  const byName = Object.fromEntries(rt.noStairsCV.levels.map((l) => [l.name, l]));
  assert.deepEqual(byName["Cellar"].elevation, { bottom: -10, top: 0 });
  assert.deepEqual(byName["Ground floor"].elevation, { bottom: 0, top: 10 });
  assert.equal(byName["Cellar"].background.src, "maps/dd-test-cellar.png");
  assert.equal(byName["Ground floor"].background.src, "maps/dd-test-ground.png");
  assert.deepEqual(byName["Cellar"].visibility, { levels: [] });
  assert.equal(byName["Cellar"].sort, 0);
  assert.equal(byName["Ground floor"].sort, 100000);
});

test("variant: Foundry did not rename the levels' ids, and kept initialLevel", { skip: missing(["roundtrip-no-stairs-coreversion", rt.noStairsCV]) }, () => {
  assert.deepEqual(rt.noStairsCV.levels.map((l) => l._id).sort(), dd.noStairsCV.levels.map((l) => l._id).sort());
  assert.equal(rt.noStairsCV.initialLevel, dd.noStairsCV.initialLevel);
  assert.equal(rt.battlemapCV?.initialLevel, dd.battlemapCV?.initialLevel);
});

test("variant: every wall and light is still tagged to exactly one level that exists", { skip: missing(["roundtrip-no-stairs-coreversion", rt.noStairsCV]) }, () => {
  for (const scene of [rt.noStairsCV, rt.withStairsCV, rt.battlemapCV].filter(Boolean)) {
    const ids = levelIds(scene);
    for (const doc of [...scene.walls, ...scene.lights]) {
      assert.equal(doc.levels.length, 1);
      assert.ok(ids.has(doc.levels[0]));
    }
  }
});

test("variant: Foundry adds level defaults (background color/tint/alphaThreshold, fog, textures) and keeps the picture", { skip: missing(["roundtrip-battlemap-coreversion", rt.battlemapCV]) }, () => {
  const [l] = rt.battlemapCV.levels;
  assert.equal(l.background.src, "maps/vtt-test.png");
  assert.deepEqual(Object.keys(l).sort(), ["_id", "background", "elevation", "flags", "fog", "foreground", "name", "sort", "textures", "visibility"]);
  assert.deepEqual(Object.keys(l.background).sort(), ["alphaThreshold", "color", "src", "tint"]);
});

// ----- stair region -----

test("stair region: behaviour type stays 'changeLevel' and system {} becomes {movementActions: []}", { skip: missing(["roundtrip-with-stairs", rt.withStairs], ["roundtrip-with-stairs-coreversion", rt.withStairsCV]) }, () => {
  for (const scene of [rt.withStairs, rt.withStairsCV]) {
    const [b] = scene.regions[0].behaviors;
    assert.equal(b.type, "changeLevel");
    // Dragon Drop expected: system {} (it wrote no keys)
    assert.deepEqual(b.system, { movementActions: [] });
    assert.equal(b._id, dd.withStairs.regions[0].behaviors[0]._id);
  }
});

test("stair region: levels, elevation and shape kept; topInclusive added (true after the migration, false otherwise)", { skip: missing(["roundtrip-with-stairs", rt.withStairs], ["roundtrip-with-stairs-coreversion", rt.withStairsCV]) }, () => {
  const ours = dd.withStairs.regions[0];
  for (const [scene, topInclusive] of [[rt.withStairs, true], [rt.withStairsCV, false]]) {
    const r = scene.regions[0];
    assert.deepEqual(r.levels, ours.levels);
    assert.deepEqual(r.elevation, { ...ours.elevation, topInclusive });
    const { anchorX, anchorY, gridBased, ...shape } = r.shapes[0];
    assert.deepEqual(shape, ours.shapes[0]);
    assert.deepEqual({ anchorX, anchorY, gridBased }, { anchorX: 0, anchorY: 0, gridBased: false });
  }
  // As written the region's levels point at levels the scene no longer has.
  const ids = levelIds(rt.withStairs);
  assert.ok(rt.withStairs.regions[0].levels.every((id) => !ids.has(id)));
});

// ----- built by hand in Foundry (Test 3) -----

test("the Change Level behaviour has type 'changeLevel' and one system key, movementActions", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  const behaviours = shapes.regions.flatMap((r) => r.behaviors);
  const change = behaviours.find((b) => /level/i.test(b.type));
  assert.ok(change, "no Change Level behaviour in the hand-built scene");
  assert.equal(change.type, "changeLevel");
  assert.deepEqual(Object.keys(change.system).sort(), ["movementActions"]);
  assert.deepEqual(change.system.movementActions, []);
});

test("a Change Level region spanning two levels lists both levels and one elevation range over both", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  const stairs = shapes.regions.find((r) => r.behaviors.some((b) => b.type === "changeLevel"));
  assert.deepEqual([...stairs.levels].sort(), shapes.levels.map((l) => l._id).sort());
  assert.deepEqual(stairs.elevation, { bottom: 0, top: 20, topInclusive: false });
});

test("the Define Surface behaviour has type 'defineSurface' and these system keys and defaults", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  const surfaces = shapes.regions.flatMap((r) => r.behaviors).filter((b) => b.type === "defineSurface");
  assert.equal(surfaces.length, 2);
  for (const s of surfaces) {
    assert.deepEqual(Object.keys(s.system).sort(), ["culling", "exposure", "light", "move", "occlusion", "placement", "sight", "sound"]);
    assert.deepEqual({ ...s.system, placement: undefined }, { placement: undefined, light: true, move: true, sight: true, sound: true, occlusion: true, exposure: false, culling: false });
  }
});

test("a floor is Define Surface placement 'bottom' on the upper level; a ceiling is 'top' on the lower level", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  const level = (name) => shapes.levels.find((l) => l.name === name);
  const floor = shapes.regions.find((r) => r.name === "Upper floor with hole");
  const ceiling = shapes.regions.find((r) => r.name === "Lower ceiling");
  assert.equal(floor.behaviors[0].system.placement, "bottom");
  assert.deepEqual(floor.levels, [level("Up")._id]);
  assert.deepEqual(floor.elevation, { ...level("Up").elevation, topInclusive: false });
  assert.equal(ceiling.behaviors[0].system.placement, "top");
  assert.deepEqual(ceiling.levels, [level("Down")._id]);
  assert.deepEqual(ceiling.elevation, { ...level("Down").elevation, topInclusive: false });
});

test("a hole is an extra shape with hole: true inside the floor region (not a separate region or behaviour)", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  const floor = shapes.regions.find((r) => r.name === "Upper floor with hole");
  assert.deepEqual(floor.shapes.map((s) => [s.type, s.hole]), [["rectangle", false], ["rectangle", true]]);
  assert.equal(floor.behaviors.length, 1);
  assert.equal(shapes.regions.length, 3);
});

test("a level that sees the one below lists it in visibility.levels", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  const down = shapes.levels.find((l) => l.name === "Down");
  const up = shapes.levels.find((l) => l.name === "Up");
  assert.deepEqual(down.visibility, { levels: [] });
  assert.deepEqual(up.visibility, { levels: [down._id] });
  assert.equal(down._id, "defaultLevel0000"); // a new scene's first level always has this id
});

test("walls and lights made in the UI are tagged to the viewed level; a light's elevation is that level's bottom", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  for (const level of shapes.levels) {
    assert.deepEqual(shapes.wallsByLevel[level.name].levels, [level._id]);
    assert.deepEqual(shapes.lightsByLevel[level.name].levels, [level._id]);
    assert.equal(shapes.lightsByLevel[level.name].elevation, level.elevation.bottom);
  }
});

test("Foundry's own Window wall is a proximity wall, not sight 0 / light 0", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  const win = shapes.wallsByLevel["Up"];
  // Dragon Drop writes windows as move 20, sight 0, light 0 with null thresholds
  assert.deepEqual({ move: win.move, sight: win.sight, light: win.light, sound: win.sound }, { move: 20, sight: 30, light: 30, sound: 20 });
  assert.deepEqual(win.threshold, { light: 10, sight: 10, sound: null, attenuation: true });
});

test("regions drawn in the UI default to visibility 4", { skip: missing(["observed/shapes.json", shapes]) }, () => {
  // Dragon Drop writes visibility 0
  assert.ok(shapes.regions.every((r) => r.visibility === 4));
});

// ----- light config (Q7) and darkness (Q6) -----

test("Dragon Drop's light config equals what Foundry gives a light placed by hand (alpha, coloration, luminosity, attenuation)", { skip: missing(["observed/shapes.json", shapes], ["roundtrip-battlemap-coreversion", rt.battlemapCV]) }, () => {
  const pick = ({ alpha, coloration, luminosity, attenuation, angle, shadows }) => ({ alpha, coloration, luminosity, attenuation, angle, shadows });
  const foundryDefault = pick(shapes.lightsByLevel["Down"].config);
  for (const l of rt.battlemapCV.lights) assert.deepEqual(pick(l.config), foundryDefault);
  assert.equal(foundryDefault.coloration, 1); // "Adaptive Luminance"
});

test("darkness is per scene (environment.darknessLevel, default 0); levels have no darkness field", { skip: missing(["roundtrip-battlemap", rt.battlemap]) }, () => {
  for (const f of Object.values(dd).filter(Boolean)) assert.ok(!("darkness" in f) && !("environment" in f));
  for (const scene of Object.values(rt).filter(Boolean)) {
    assert.equal(scene.environment.darknessLevel, 0);
    for (const l of scene.levels) assert.ok(!Object.keys(l).some((k) => /dark|environment/i.test(k)));
  }
});

// ----- Dragon Drop's levels test file (explains test1_variant_openDoorAndWindowLetSightThrough) -----

test("in Dragon Drop's levels test file every door and window lies on top of a full wall of the same level", { skip: missing(["dragon-drop-no-stairs", dd.noStairs]) }, () => {
  // Dragon Drop expected: openings that let sight through (the one-level export splits walls; this file doesn't)
  const onSegment = (o, w) => {
    const [ax, ay, bx, by] = w.c;
    const [cx, cy, dx, dy] = o.c;
    const collinear = (px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax) === 0;
    const within = (px, py) => Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by);
    return collinear(cx, cy) && collinear(dx, dy) && within(cx, cy) && within(dx, dy);
  };
  const openings = dd.noStairs.walls.filter((w) => w.door !== 0 || w.sight === 0);
  assert.equal(openings.length, 3);
  for (const o of openings) {
    const full = dd.noStairs.walls.filter((w) => w !== o && w.door === 0 && w.sight === 20 && w.levels[0] === o.levels[0]);
    assert.ok(full.some((w) => onSegment(o, w)), `opening ${JSON.stringify(o.c)} is not on a full wall`);
  }
});

// ----- Universal Battlemap Importer 6.1.1 (Test 5) -----

test("Universal VTT import: the window written as objects_line_of_sight became no wall at all", { skip: missing(["universal-vtt-import", uvtt]) }, () => {
  // Dragon Drop expected: a wall that stops movement but not sight
  const covers = (y) => uvtt.walls.some((w) => w.c[0] === 1120 && w.c[2] === 1120 && w.c[1] !== w.c[3] && Math.min(w.c[1], w.c[3]) <= y && y <= Math.max(w.c[1], w.c[3]));
  for (const y of [640, 665, 690]) assert.equal(covers(y), false);
});

test("Universal VTT import: 37 walls (20 of zero length), 3 closed doors, no secret door, padding 0.25, lights alpha 0.05", { skip: missing(["universal-vtt-import", uvtt]) }, () => {
  assert.equal(uvtt.walls.length, 37);
  assert.equal(uvtt.walls.filter((w) => w.c[0] === w.c[2] && w.c[1] === w.c[3]).length, 20);
  assert.deepEqual(uvtt.walls.filter((w) => w.door).map((w) => [w.door, w.ds]), [[1, 0], [1, 0], [1, 0]]);
  assert.equal(uvtt.padding, 0.25);
  assert.deepEqual(uvtt.lights.map((l) => [l.config.color, l.config.dim, l.config.alpha]), [["#ff8800", 30, 0.05], ["#ffd68c", 25, 0.05]]);
  assert.equal(uvtt.levels.length, 1);
  assert.equal(uvtt.initialLevel, null);
});

// ----- housekeeping -----

test("no user id is left in raw/ or observed/ (only the REDACTED-USER marker)", () => {
  for (const dir of ["raw", "observed"]) {
    const full = path.join(here, dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full).filter((n) => n.endsWith(".json"))) {
      const scene = JSON.parse(readFileSync(path.join(full, f), "utf8"));
      const walk = (o) => {
        if (!o || typeof o !== "object") return;
        for (const [k, v] of Object.entries(o)) {
          if (/^(author|lastModifiedBy|createdBy|user|userId)$/.test(k)) assert.ok(v === null || v === "REDACTED-USER", `${f}: ${k} = ${v}`);
          if (k === "ownership") for (const key of Object.keys(v)) assert.ok(key === "default" || key === "REDACTED-USER", `${f}: ownership key ${key}`);
          walk(v);
        }
      };
      walk(scene);
    }
  }
});

test("no placeholder is left in this file", () => {
  const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
  for (const needle of ["TO FILL" + " IN", "(fill" + " in)"]) assert.ok(!text.includes(needle), `replace every "${needle}"`);
});
