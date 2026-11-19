// Makes the Foundry test kit: a folder to give to Claude Code on a PC that has Foundry VTT v14, with the handoff, the test scenes, what Dragon Drop's Export button writes
// for an ordinary battlemap, and the templates for the results. See docs/foundry-test-kit/HANDOFF.md.
//
//   pnpm foundry-kit [output-folder]      (default: ./foundry-test-kit)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hub } from "../apps/server/src/hub.ts";
import { ProjectStore } from "../apps/server/src/store.ts";
import { runTool } from "../packages/tools/src/index.ts";
import { levelsTestZip } from "./foundry-test-scene.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "foundry-test-kit");
mkdirSync(path.join(out, "levels-test"), { recursive: true });
mkdirSync(path.join(out, "battlemap-test"), { recursive: true });

// the handoff and the templates
for (const f of ["HANDOFF.md", "RESULTS-TEMPLATE.md", "observed.test.example.mjs"]) copyFileSync(path.join(root, "docs", "foundry-test-kit", f), path.join(out, f));

// the two-level test scene
writeFileSync(path.join(out, "levels-test", "dragon-drop-foundry-levels-test.zip"), levelsTestZip());

// an ordinary one-level battlemap, exported the way the Export button does it
const tmp = mkdtempSync(path.join(tmpdir(), "dd-kit-"));
const hub = new Hub(new ProjectStore(path.join(tmp, "projects")), null);
try {
  await hub.createBattle({ name: "VTT test", squaresX: 20, squaresY: 14, pxPerSquare: 70, feetPerSquare: 5 });
  const call = async (name: string, input: Record<string, unknown>) => {
    const r = await runTool(hub.toolContext("mcp"), name, input);
    if (r.isError) throw new Error(`${name}: ${(r.content[0] as { text: string }).text}`);
  };
  // room A (the big one): a door on the top wall, a window on the right wall, a secret door on the left wall and a door on the bottom wall
  await call("add_room", {
    x: 3, y: 3, w: 8, h: 6, floor: "flagstone",
    doors: [{ side: "top", offset: 3, kind: "door" }, { side: "right", offset: 2, kind: "window" }, { side: "left", offset: 3, kind: "secret" }, { side: "bottom", offset: 4, kind: "door" }],
  });
  // room B (the small one): a door on the left wall
  await call("add_room", { x: 13, y: 4, w: 5, h: 5, floor: "wood planks", doors: [{ side: "left", offset: 2, kind: "door" }] });
  await call("add_light", { x: 6, y: 6, radius: 6, colour: "#ff8800" });
  await call("add_light", { x: 15, y: 7, radius: 5 });
  for (const format of ["png", "uvtt", "foundry", "key"] as const) {
    const f = await hub.battleExport(format);
    writeFileSync(path.join(out, "battlemap-test", f.name), f.bytes); // (the project is called "VTT test", so the files are vtt-test.png, vtt-test.dd2vtt, vtt-test-foundry.zip, vtt-test-key.md)
  }
} finally {
  await hub.close();
  rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(path.join(out, "battlemap-test", "WHAT-IS-IN-THE-MAP.md"), `# What is in the test battlemap

A 20 x 14 square map, 70 pixels per square, 5 ft per square, square grid. Coordinates are grid squares from the top-left corner.

**Room A** (the big one): floor flagstone, inside x 3 to 11 and y 3 to 9, walled all round.
- a **door** in the top wall, x 6 to 7
- a **window** in the right wall, y 5 to 6
- a **secret door** in the left wall, y 6 to 7
- a **door** in the bottom wall, x 7 to 8
- an orange **light** at (6, 6), dim radius 6 squares

**Room B** (the small one): floor wood planks, inside x 13 to 18 and y 4 to 9, walled all round.
- a **door** in the left wall, y 6 to 7
- a white **light** at (15, 7), dim radius 5 squares

Everything else is void (empty, no floor). There are no stairs and only one level.

What the exports should contain: the picture (walls and doors are drawn, lights and room notes are not), walls and doors for the tabletop, and the two lights. A window should
stop movement but not sight; a secret door should look like plain wall.
`);

let version = "unknown";
try { version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
writeFileSync(path.join(out, "VERSION.txt"), `Dragon Drop Foundry test kit\nmade ${new Date().toISOString()}\nfrom commit ${version}\n`);
console.log(`wrote the kit to ${out}`);
