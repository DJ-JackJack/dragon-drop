/** The generators through the hub and Claude's tools: one undo step, the DM asked before something is replaced. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { riskOf, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-gen-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const dir = path.join(root, `p${++n}`); mkdirSync(dir, { recursive: true }); return new Hub(new ProjectStore(dir), null); };
const call = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("generators", () => {
  it("fill a battlemap level with a dungeon as one undo step, replacing its walls and lights, and ask first when there is something to replace", async () => {
    const hub = fresh();
    await call(hub, "create_battlemap", { name: "Crypt", squares_x: 30, squares_y: 24 });
    const ctx = hub.toolContext("mcp");
    expect(await riskOf(ctx, "generate_dungeon", { style: "dungeon" })).toBeNull(); // (an empty level: nothing to lose)
    await call(hub, "add_room", { x: 2, y: 2, w: 5, h: 4 });
    expect(await riskOf(ctx, "generate_dungeon", { style: "cave" })).toBe("Replace this level's floor, walls, doors and lights with a generated cave");
    const before = hub.session.seq;
    const r = await call(hub, "generate_dungeon", { style: "dungeon", seed: 9 });
    expect(r.made).toMatch(/^a dungeon of \d+ rooms/);
    expect(r.seed).toBe(9);
    expect(hub.session.seq).toBe(before + 1);
    expect(hub.session.changes.at(-1)?.label).toBe("Generate a dungeon (seed 9)");
    const f = hub.session.doc.features!;
    expect(f.walls!.some((w) => w.kind === "door" || w.kind === "secret")).toBe(true);
    // (the room drawn first is gone: its walls were replaced)
    expect(f.walls!.some((w) => w.points.some(([x, y]) => x === 2 && y === 2) && !w.closed)).toBe(false);
    hub.session.undo("user");
    expect(hub.session.doc.features!.walls!.length).toBeGreaterThan(0);
    expect(hub.session.doc.features!.lights ?? []).toHaveLength(0);
    // and the same seed makes the same one again
    await call(hub, "generate_dungeon", { style: "dungeon", seed: 9 });
    expect(hub.session.doc.features!.walls!.length).toBe(f.walls!.length);
    await hub.close();
  });

  it("lay out a village on a settlement map, and are refused on the wrong kind of map", async () => {
    const hub = fresh();
    await call(hub, "create_city", { name: "Vale", width_m: 800, height_m: 600 });
    const r = await call(hub, "generate_village", { size: "hamlet", seed: 4 });
    expect(r.made).toMatch(/^a hamlet of \d+ buildings/);
    const f = hub.session.doc.features!;
    expect(f.streets!.length).toBeGreaterThanOrEqual(1);
    expect(f.buildings!.length).toBeGreaterThan(5);
    expect(await riskOf(hub.toolContext("mcp"), "generate_village", {})).toMatch(/^Replace this settlement's \d+ streets and \d+ buildings/);
    const bad = await runTool(hub.toolContext("mcp"), "generate_dungeon", { style: "dungeon" });
    expect(bad.isError).toBe(true);
    await hub.close();
  });
});
