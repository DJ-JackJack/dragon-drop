/**
 * What was tried in a real Foundry VTT (v14 build 367, 2026-11-18; the results are in docs/foundry-test-kit/results/v14.367/): the scene file Dragon Drop's Export
 * button wrote for the test battlemap, with one key added, imported and worked: picture, grid, walls, doors, window and lights. These tests keep today's export
 * the same as that file, so what was tried stays what is written.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { FOUNDRY_CORE_VERSION, memoryAccess } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";
import { readZipFile, readZipIndex } from "../src/zip.ts";

const results = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/foundry-test-kit/results/v14.367");
const tried = (name: string) => JSON.parse(readFileSync(path.join(results, "raw", name), "utf8"));
const root = mkdtempSync(path.join(tmpdir(), "dd-foundry-tried-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The battlemap of the Foundry test kit (scripts/foundry-test-kit.ts), exported for Foundry as the Export button does it. */
async function kitScene() {
  const hub = new Hub(new ProjectStore(path.join(root, "projects")), null);
  try {
    await hub.createBattle({ name: "VTT test", squaresX: 20, squaresY: 14, pxPerSquare: 70, feetPerSquare: 5 });
    const call = async (name: string, input: Record<string, unknown>) => {
      const r = await runTool(hub.toolContext("mcp"), name, input);
      if (r.isError) throw new Error((r.content[0] as { text: string }).text);
    };
    await call("add_room", {
      x: 3, y: 3, w: 8, h: 6, floor: "flagstone",
      doors: [{ side: "top", offset: 3, kind: "door" }, { side: "right", offset: 2, kind: "window" }, { side: "left", offset: 3, kind: "secret" }, { side: "bottom", offset: 4, kind: "door" }],
    });
    await call("add_room", { x: 13, y: 4, w: 5, h: 5, floor: "wood planks", doors: [{ side: "left", offset: 2, kind: "door" }] });
    await call("add_light", { x: 6, y: 6, radius: 6, colour: "#ff8800" });
    await call("add_light", { x: 15, y: 7, radius: 5 });
    const zip = (await hub.battleExport("foundry")).bytes;
    const ra = memoryAccess(zip);
    const files = new Map<string, Uint8Array>();
    for (const e of await readZipIndex(ra)) files.set(e.path, await readZipFile(ra, e));
    return JSON.parse(new TextDecoder().decode(files.get("vtt-test-scene.json")!));
  } finally {
    await hub.close();
  }
}

describe("the Foundry scene that was tried in Foundry 14.367", () => {
  it("is what the Export button writes today for the test battlemap, apart from the build it says it is from", async () => {
    const ours = await kitScene();
    const theirs = tried("dragon-drop-battlemap-coreversion.json");
    const { _stats: ourStats, ...ourBody } = ours;
    const { _stats: theirStats, ...theirBody } = theirs;
    // the tried file differed from the export of that day in exactly one key: the build (14.367, where we write the lowest that works)
    expect(Object.keys(theirStats)).toEqual(["coreVersion"]);
    expect(ourStats).toEqual({ coreVersion: FOUNDRY_CORE_VERSION });
    expect(ourBody).toEqual(theirBody);
  });

  it("the scene without that key is what Foundry silently emptied: the reason every scene now carries it", () => {
    const asWritten = tried("dragon-drop-battlemap.json"), imported = tried("roundtrip-battlemap.json");
    expect(asWritten._stats).toBeUndefined();
    expect(imported.levels).toHaveLength(1);
    expect(imported.levels[0]._id).toBe("defaultLevel0000"); // (Foundry's own default level, with no picture, instead of ours)
  });

  it("the recorded facts still hold (node --test on the results' own test file)", () => {
    expect(existsSync(path.join(results, "observed.test.mjs"))).toBe(true);
    // (execFileSync throws if the run fails; the reporter is named so the summary reads the same on every Node version)
    const out = execFileSync(process.execPath, ["--test", "--test-reporter=tap", path.join(results, "observed.test.mjs")], { encoding: "utf8" });
    expect(out).toMatch(/^# fail 0$/m);
    expect(out).toMatch(/^# pass [1-9]\d*$/m);
  });
});
