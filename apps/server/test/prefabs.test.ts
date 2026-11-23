/** Prefabs on the server (./prefabs.ts, Hub.savePrefab / placePrefab) and Claude's tools for them. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { riskOf, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { PrefabExists } from "../src/prefabs.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-prefab-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const dir = path.join(root, `p${++n}`); mkdirSync(dir, { recursive: true }); return { hub: new Hub(new ProjectStore(dir), null), dir }; };
const call = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("prefabs", () => {
  it("are saved beside the maps with a picture, placed on another battlemap as one undo step, renamed and put aside", async () => {
    const { hub, dir } = fresh();
    await call(hub, "create_battlemap", { name: "Barracks", squares_x: 16, squares_y: 12 });
    await call(hub, "add_room", { x: 2, y: 2, w: 5, h: 4, doors: [{ side: "bottom", offset: 2 }] });
    await call(hub, "add_light", { x: 4, y: 4, radius: 4 });
    expect((await call(hub, "list_prefabs")).note).toMatch(/None saved yet/);
    const saved = await call(hub, "save_prefab", { name: "Guard post", x: 2, y: 2, w: 5, h: 4 });
    expect(saved).toMatchObject({ saved: "Guard post", id: "guard-post", squares: "5 x 4" });
    expect(saved.holds).toMatch(/floor, \d+ walls?, 1 door, 1 light/);
    expect(existsSync(path.join(dir, "Prefabs", "guard-post.json"))).toBe(true);
    expect(hub.prefabs.picture("guard-post")).not.toBeNull();
    // (the Prefabs folder is never listed as a map)
    expect((await hub.store.list()).map((p) => p.name)).toEqual(["Barracks"]);
    // the same name again: kept unless replaced
    await expect(call(hub, "save_prefab", { name: "guard post", x: 0, y: 0, w: 8, h: 8 })).rejects.toThrow(/already a prefab called "Guard post"/);
    await expect(hub.savePrefab({ name: "Guard post", rect: { x: 0, y: 0, w: 8, h: 8 } })).rejects.toBeInstanceOf(PrefabExists);
    expect(await riskOf(hub.toolContext("mcp"), "save_prefab", { name: "guard post", replace: true, x: 0, y: 0, w: 8, h: 8 })).toMatch(/^Replace the saved prefab "Guard post"/);
    expect(await riskOf(hub.toolContext("mcp"), "save_prefab", { name: "Barn", replace: true, x: 0, y: 0, w: 8, h: 8 })).toBeNull();

    // another battlemap: place it turned a quarter
    await call(hub, "create_battlemap", { name: "Pass", squares_x: 20, squares_y: 20 });
    const before = hub.session.seq;
    const placed = await call(hub, "place_prefab", { prefab: "Guard Post", x: 10, y: 3, turn: 90 });
    expect(placed).toMatchObject({ placed: "Guard post", at: { x: 10, y: 3 }, squares: "4 x 5" });
    expect(hub.session.seq).toBe(before + 1);
    const f = hub.session.doc.features!;
    expect(f.lights).toHaveLength(1);
    expect(f.walls!.some((w) => w.kind === "door")).toBe(true);
    expect(f.walls!.every((w) => w.points.every(([x, y]) => x >= 10 - 1e-6 && x <= 14 + 1e-6 && y >= 3 - 1e-6 && y <= 8 + 1e-6))).toBe(true);
    expect(hub.session.changes.at(-1)?.label).toBe("Place prefab Guard post, turned 90°");
    hub.session.undo("user");
    expect(hub.session.doc.features!.lights ?? []).toHaveLength(0);
    await expect(call(hub, "place_prefab", { prefab: "Barn", x: 0, y: 0 })).rejects.toThrow(/no prefab "Barn". There are: "Guard post"/);

    // the DM renames it, then puts it aside: nothing is erased
    await hub.prefabs.rename("guard-post", "Watch post");
    expect((await call(hub, "list_prefabs")).prefabs.map((p: { name: string }) => p.name)).toEqual(["Watch post"]);
    await hub.prefabs.remove("guard-post");
    expect((await hub.prefabs.list()).prefabs).toHaveLength(0);
    expect(readdirSync(path.join(dir, "Prefabs", "Removed")).sort()).toEqual(["guard-post.json", "guard-post.png"]);
    await hub.close();
  });

  it("are refused on world maps and say which files can't be read", async () => {
    const { hub, dir } = fresh();
    await hub.createProject({ name: "World", width: 128, height: 128, kmPerPx: 4 });
    const r = await runTool(hub.toolContext("mcp"), "place_prefab", { prefab: "x", x: 0, y: 0 });
    expect(r.isError).toBe(true);
    mkdirSync(path.join(dir, "Prefabs"), { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(dir, "Prefabs", "broken.json"), "{ not json");
    writeFileSync(path.join(dir, "Prefabs", "future.json"), JSON.stringify({ format: 9, name: "From the future", w: 2, h: 2, sub: 8, floor: [], features: { walls: [] } }));
    expect((await hub.prefabs.list()).skipped.sort()).toEqual(["broken.json", "future.json (saved by a newer Dragon Drop)"]);
    await hub.close();
  });
});
