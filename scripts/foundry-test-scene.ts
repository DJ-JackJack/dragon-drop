// Makes a small two-level Foundry v14 test scene (a cellar under a ground floor, with a door, a window, a light on each level and a stair) as a zip,
// to try in a real Foundry: it is how we find out whether Foundry accepts what Dragon Drop writes.
//
//   pnpm exec tsx scripts/foundry-test-scene.ts [output-folder]
//
// The zip holds the two pictures, the scene without stairs, the same scene with a stair region, the same with a stair, a floor with a hole and a ceiling
// (each kept in a separate file so one that Foundry dislikes can't spoil the others), and a README with what to check.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type MapLight, type MapWall, createZip, drawText, foundryScene } from "../packages/core/src/index.ts";
import { encodePng } from "../packages/tools/src/images.ts";

const SQ = 70, W = 15 * SQ, H = 10 * SQ;

/** A picture of a room: a floor colour inside, a darker outside, squares drawn faintly, and the level's name in big letters. */
function picture(floor: [number, number, number], outside: [number, number, number], title: string, sub: string) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = x >= 2 * SQ && x < 13 * SQ && y >= 2 * SQ && y < 8 * SQ;
    const c = inside ? floor : outside;
    const grid = x % SQ === 0 || y % SQ === 0 ? 0.88 : 1;
    const o = (y * W + x) * 4;
    data[o] = c[0] * grid; data[o + 1] = c[1] * grid; data[o + 2] = c[2] * grid; data[o + 3] = 255;
  }
  const img = { w: W, h: H, data };
  drawText(img, title, 3 * SQ, 4 * SQ - 10, [255, 255, 255], 8);
  drawText(img, sub, 3 * SQ, 5 * SQ + 20, [255, 255, 255], 3);
  return encodePng(img);
}

const room = (id: string): MapWall => ({ id, kind: "wall", points: [[2, 2], [13, 2], [13, 8], [2, 8]], closed: true });
const cellarWalls: MapWall[] = [room("cellar-room"), { id: "cellar-cross", kind: "wall", points: [[7, 2], [7, 5]] }];
// (the room's wall is cut around each opening, as the editor does it: a door or window laid over an unbroken wall would leave the wall in place, and
// opening the door would open nothing, as the first real-Foundry test of this scene found)
const groundWalls: MapWall[] = [
  { id: "ground-wall-1", kind: "wall", points: [[6, 2], [2, 2], [2, 5]] }, // north wall (west part), then down the west side to the secret door
  { id: "ground-secret", kind: "secret", points: [[2, 5], [2, 6]] },
  { id: "ground-wall-2", kind: "wall", points: [[2, 6], [2, 8], [13, 8], [13, 5]] }, // the rest of the west side, the south wall, up the east side to the window
  { id: "ground-window", kind: "window", points: [[13, 5], [13, 4]] },
  { id: "ground-wall-3", kind: "wall", points: [[13, 4], [13, 2], [7, 2]] }, // up to the north-east corner and back along the north wall to the door
  { id: "ground-door", kind: "door", points: [[7, 2], [6, 2]] }, // the door in the north wall
];
const cellarLights: MapLight[] = [{ id: "cellar-torch", x: 4, y: 6, radius: 6, bright: 3, colour: "#ff8800" }];
const groundLights: MapLight[] = [{ id: "ground-lamp", x: 9, y: 5, radius: 8, bright: 4 }];

const input = {
  name: "Dragon Drop test: two levels", width: W, height: H, pxPerSquare: SQ, feetPerSquare: 5, gridType: "square" as const,
  levels: [
    { name: "Cellar", bottom: -10, top: 0, image: "maps/dd-test-cellar.png", walls: cellarWalls, lights: cellarLights },
    { name: "Ground floor", bottom: 0, top: 10, image: "maps/dd-test-ground.png", walls: groundWalls, lights: groundLights },
  ],
  stairs: [{ name: "Cellar stairs", between: [0, 1] as [number, number], x: 11, y: 3, w: 1, h: 2 }],
  // a floor on the ground floor with a hole in it (over the east half of the cellar), and a ceiling over the cellar (Define Surface regions)
  surfaces: [
    { name: "Ground floor floor", level: 1, kind: "floor" as const, rects: [{ x: 2, y: 2, w: 11, h: 6 }], holes: [{ x: 8, y: 3, w: 2, h: 1 }] },
    { name: "Cellar ceiling", level: 0, kind: "ceiling" as const, rects: [{ x: 2, y: 2, w: 11, h: 6 }] },
  ],
};
const plain = foundryScene({ ...input, stairs: [], surfaces: [] });
const withStairs = foundryScene({ ...input, surfaces: [] });
const withSurfaces = foundryScene(input);

const readme = `Dragon Drop: Foundry v14 levels test
=====================================

This is a small made-up scene with TWO LEVELS: a Cellar (elevation -10 to 0) under a Ground floor (0 to 10). Each level has its own picture, walls and a
light. The ground floor has a door, a window and a secret door. The point is to find out what Foundry v14 does with it. (Result of the first run, on Foundry 14.367:
it did what was hoped once the scene file said which Foundry build it was written by, which it now does: see docs/FOUNDRY.md.)

1. Put the two pictures in your Foundry data folder, in a folder called maps (File Browser > Upload):
     dd-test-cellar.png   dd-test-ground.png
2. Create an empty Scene (any name), right-click it in the Scenes list > Import Data, and choose
     scene-no-stairs.json
   Then open the scene.

What to look at, and tell me what you see (a screenshot of anything odd, and the red error text from the browser console, F12, if the import fails):
   a. Did it import at all? Any error?
   b. Scene Configuration > Levels: are there two, named Cellar and Ground floor, with the elevations -10..0 and 0..10 and a picture each?
   c. Switch between the levels. Does each show its own picture?
   d. Select the Ground floor and look at the walls: are the room walls, the door (closed), the window and the secret door there, and only on that level?
      Are the Cellar's room wall and its cross wall only on the Cellar?
   e. Lights: is there an orange torch on the Cellar only and a white lamp on the Ground floor only?
   f. Put a token on each level: does light and sight behave per level?

3. Optional, only if (2) worked: make another empty scene and import scene-with-stairs.json instead. It adds a stair region (a rectangle on the east side)
   that I wrote from a guess at how Foundry stores a "Change Level" region. Tell me whether it imported, and what the region looks like in Scene Regions
   (its behaviour, which levels it lists).

Even better, if you have a few minutes: in Foundry make your own tiny two-level scene by hand (two levels, one wall and one light on each, and one stair
using a Region with a Change Level behaviour, and one floor with a Define Surface region), right-click it > Export Data, and send me that JSON file. It
shows me exactly how Foundry stores these things, which the documentation doesn't spell out.
`;

/** The test scene as a zip (what the command line writes), for scripts/foundry-test-kit.ts too. */
export function levelsTestZip(): Uint8Array {
  const enc = new TextEncoder();
  return createZip([
    { name: "maps/dd-test-cellar.png", data: picture([88, 88, 96], [34, 34, 38], "CELLAR", "level 0: elevation -10 to 0") },
    { name: "maps/dd-test-ground.png", data: picture([150, 108, 66], [40, 60, 40], "GROUND FLOOR", "level 1: elevation 0 to 10") },
    { name: "scene-no-stairs.json", data: enc.encode(JSON.stringify(plain, null, 2)) },
    { name: "scene-with-stairs.json", data: enc.encode(JSON.stringify(withStairs, null, 2)) },
    { name: "scene-with-stairs-and-surfaces.json", data: enc.encode(JSON.stringify(withSurfaces, null, 2)) },
    { name: "README.txt", data: enc.encode(readme.replace(/\n/g, "\r\n")) },
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? ".");
  mkdirSync(out, { recursive: true });
  const zip = levelsTestZip();
  const file = path.join(out, "dragon-drop-foundry-levels-test.zip");
  writeFileSync(file, zip);
  console.log(`wrote ${file} (${zip.length} bytes)`);
}
