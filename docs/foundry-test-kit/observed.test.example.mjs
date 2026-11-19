// The shape of the test Claude Code writes at the end of the Foundry run (as observed.test.mjs, next to raw/ and observed/).
// It pins down what Foundry VTT really did with Dragon Drop's scenes, so the facts become a regression test for the developer.
//
//   node --test observed.test.mjs        (Node 20 or newer; no packages needed)
//
// This example FAILS its last test until every placeholder (TO FILL IN, (fill in)) has been replaced: that is on purpose, so a half-written file can't pass.
//
// Rules: read only files in raw/ and observed/; assert what Foundry ACTUALLY did (even if Dragon Drop expected something else: add a
// "// Dragon Drop expected: ..." comment); put what only a person could see in `observations`; skip (with a reason), never delete, a test whose fixture is missing.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => { const f = path.join(here, rel); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };

/** Facts about the run. */
export const run = {
  foundryVersion: "(fill in)",
  foundryBuild: "(fill in)",
  date: "(fill in)",
  dragonDropKit: "(from VERSION.txt)",
};

/**
 * What the person saw, true / false / null (not observed), with a note. Keys are the questions from the handoff.
 */
export const observations = {
  test1_importedWithoutError: { value: null, note: "TO FILL IN" },
  test1_twoLevelsWithElevationsAndPictures: { value: null, note: "TO FILL IN" },
  test1_eachLevelShowsItsOwnPicture: { value: null, note: "TO FILL IN" },
  test1_groundFloorWallsDoorWindowSecretOnlyThere: { value: null, note: "TO FILL IN" },
  test1_cellarWallsOnlyThere: { value: null, note: "TO FILL IN" },
  test1_lightsOnTheirOwnLevel: { value: null, note: "TO FILL IN" },
  test1_tokensSeePerLevel: { value: null, note: "TO FILL IN" },
  test2_stairsSceneImported: { value: null, note: "TO FILL IN" },
  test4_pictureLinesUpWithGrid: { value: null, note: "TO FILL IN" },
  test4_doorWindowSecretBehaveAsExpected: { value: null, note: "TO FILL IN" },
  test4_lightsWhereAndColourExpected: { value: null, note: "TO FILL IN" },
  test5_universalImporterAvailableForV14: { value: null, note: "TO FILL IN" },
};

test("every observation is answered (true, false, or null with a note saying why it was not observed)", () => {
  for (const [key, o] of Object.entries(observations)) {
    assert.ok(o && "value" in o && typeof o.note === "string", `${key} is malformed`);
    if (o.value === null) assert.ok(o.note.length > 0, `${key} was not observed: say why in its note`);
  }
});

// ----- facts the data proves (examples: replace with what the real files show) -----

const ours = load("raw/dragon-drop-no-stairs.json");
const theirs = load("raw/roundtrip-no-stairs.json");

test("the round trip kept both levels and their elevations", { skip: !theirs && "raw/roundtrip-no-stairs.json is missing" }, () => {
  assert.equal(theirs.levels.length, 2);
  const byName = Object.fromEntries(theirs.levels.map((l) => [l.name, l]));
  assert.deepEqual(byName["Cellar"].elevation, { bottom: -10, top: 0 });
  assert.deepEqual(byName["Ground floor"].elevation, { bottom: 0, top: 10 });
});

test("every wall and light is still tagged to exactly one level that exists", { skip: !theirs && "raw/roundtrip-no-stairs.json is missing" }, () => {
  const ids = new Set(theirs.levels.map((l) => l._id));
  for (const doc of [...theirs.walls, ...theirs.lights]) {
    const tagged = [...(doc.levels ?? [])];
    assert.equal(tagged.length, 1);
    assert.ok(ids.has(tagged[0]));
  }
});

test("Foundry did not rename the levels' ids", { skip: (!ours || !theirs) && "a round-trip pair is missing" }, () => {
  // Dragon Drop expected: ids are kept as written (they are made from the name, so a re-export doesn't change them)
  assert.deepEqual(theirs.levels.map((l) => l._id).sort(), ours.levels.map((l) => l._id).sort());
});

const shapes = load("observed/shapes.json");

test("the Change Level behaviour has the type and system keys Foundry stores", { skip: !shapes && "observed/shapes.json is missing" }, () => {
  const behaviours = shapes.regions.flatMap((r) => r.behaviors);
  const change = behaviours.find((b) => /level/i.test(b.type));
  assert.ok(change, "no Change Level behaviour in the hand-built scene");
  // Replace these with the REAL values from the file: assert.equal(change.type, "...");  assert.deepEqual(Object.keys(change.system).sort(), [...]);
});

test("no placeholder is left in this file", () => {
  const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
  for (const needle of ["TO FILL" + " IN", "(fill" + " in)"]) assert.ok(!text.includes(needle), `replace every "${needle}"`);
});
