/** Battlemap levels: each level is a floor document of its own under one battlemap (see docs/FOUNDRY.md, "Stage 2 design"). */
import { existsSync } from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type MapDoc } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-levels-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const fresh = () => {
  const dir = path.join(root, `p${++n}`);
  const store = new ProjectStore(dir);
  return { dir, store, hub: new Hub(store, null) };
};
const reopen = async (dir: string, id: string) => {
  const hub = new Hub(new ProjectStore(dir), null);
  await hub.openProject(id);
  return hub;
};
const call = async (hub: Hub, name: string, input: Record<string, unknown>) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  if (r.isError) throw new Error((r.content[0] as { text: string }).text);
};
/** How many floor cells a level has. */
const floor = (doc: MapDoc) => doc.height.data.filter((v) => v > 0).length;
const tower = async (hub: Hub) => {
  await hub.createBattle({ name: "Tower", squaresX: 10, squaresY: 8 });
  await call(hub, "add_room", { x: 1, y: 1, w: 6, h: 5 });
};

describe("a battlemap with levels", () => {
  it("a one-level map is exactly what it always was: no level list on disk, the default level", async () => {
    const { hub, dir } = fresh();
    await tower(hub);
    expect(hub.levelsInfo()).toEqual({ v: 1, active: "level-1", levels: [{ id: "level-1", name: "Ground floor", bottom: 0, top: 10 }] });
    await hub.flush();
    expect(existsSync(path.join(dir, "tower", "levels.json"))).toBe(false);
    expect(existsSync(path.join(dir, "tower", "levels"))).toBe(false);
    await hub.close();
  });

  it("adds an empty level above (or below), works on it, and keeps the other level as it was", async () => {
    const { hub } = fresh();
    await tower(hub);
    const lv1 = floor(hub.session.doc);
    expect(lv1).toBeGreaterThan(0);
    const up = await hub.addLevel("above");
    expect(up).toEqual({ id: "level-2", name: "Upper floor", bottom: 10, top: 20 });
    expect(hub.levelsInfo()!.active).toBe("level-2");
    expect(floor(hub.session.doc)).toBe(0); // starts empty
    expect(hub.session.doc.meta.battle).toMatchObject({ squaresX: 10, squaresY: 8, pxPerSquare: 70 }); // same size and grid
    await call(hub, "add_room", { x: 2, y: 2, w: 3, h: 3 });
    const lv2 = floor(hub.session.doc);
    expect(lv2).toBeGreaterThan(0);
    const down = await hub.addLevel("below", "Crypt");
    expect(down).toEqual({ id: "level-3", name: "Crypt", bottom: -10, top: 0 });
    await hub.setActiveLevel("level-1");
    expect(floor(hub.session.doc)).toBe(lv1);
    await hub.setActiveLevel("level-2");
    expect(floor(hub.session.doc)).toBe(lv2);
    await hub.close();
  });

  it("undo is per level: undoing on one level leaves the other alone", async () => {
    const { hub } = fresh();
    await tower(hub);
    const lv1 = floor(hub.session.doc);
    await hub.addLevel("above");
    await call(hub, "add_room", { x: 2, y: 2, w: 3, h: 3 });
    expect(hub.session.canUndo).toBe(true);
    while (hub.session.canUndo) hub.session.undo("user");
    expect(floor(hub.session.doc)).toBe(0);
    await hub.setActiveLevel("level-1");
    expect(floor(hub.session.doc)).toBe(lv1);
    expect(hub.session.canUndo).toBe(true); // level 1's own history
    await hub.close();
  });

  it("saves every level and the list, and a new start brings them all back, with the level that was being worked on", async () => {
    const { hub, dir } = fresh();
    await tower(hub);
    const lv1 = floor(hub.session.doc);
    await hub.addLevel("above", "Attic");
    await call(hub, "add_room", { x: 2, y: 2, w: 3, h: 3 });
    const lv2 = floor(hub.session.doc);
    await hub.flush();
    for (const f of ["levels.json", "levels/level-2/project.json", "levels/level-2/features.json", "levels/level-2/map/height.f32.gz"]) expect(existsSync(path.join(dir, "tower", f)), f).toBe(true);
    await hub.close();

    const again = await reopen(dir, "tower");
    expect(again.levelsInfo()).toEqual({ v: 1, active: "level-2", levels: [{ id: "level-1", name: "Ground floor", bottom: 0, top: 10 }, { id: "level-2", name: "Attic", bottom: 10, top: 20 }] });
    expect(floor(again.session.doc)).toBe(lv2);
    await again.setActiveLevel("level-1");
    expect(floor(again.session.doc)).toBe(lv1);
    await again.close();
  });

  it("a change on one level saves only that level's files", async () => {
    const { hub, dir } = fresh();
    await tower(hub);
    await hub.addLevel("above");
    await hub.flush();
    const first = path.join(dir, "tower", "map", "height.f32.gz");
    const before = readFileSync(first);
    await call(hub, "add_room", { x: 2, y: 2, w: 3, h: 3 }); // on level 2
    await hub.flush();
    expect(readFileSync(first).equals(before)).toBe(true);
    expect(readFileSync(path.join(dir, "tower", "levels", "level-2", "map", "height.f32.gz")).length).toBeGreaterThan(0);
    await hub.close();
  });

  it("renames a level and changes its elevations, and refuses what makes no sense", async () => {
    const { hub } = fresh();
    await tower(hub);
    await hub.addLevel("above");
    expect(await hub.updateLevel("level-2", { name: "  Attic  ", bottom: 12, top: 22 })).toEqual({ id: "level-2", name: "Attic", bottom: 12, top: 22 });
    await expect(hub.updateLevel("level-2", { name: " " })).rejects.toThrow(/needs a name/);
    await expect(hub.updateLevel("level-2", { top: 5 })).rejects.toThrow(/higher than its bottom/);
    await expect(hub.updateLevel("level-2", { bottom: NaN })).rejects.toThrow(/number of feet/);
    await expect(hub.updateLevel("level-2", { name: "ground FLOOR" })).rejects.toThrow(/already a level called/);
    await expect(hub.updateLevel("level-9", { name: "x" })).rejects.toThrow(/No level/);
    await hub.close();
  });

  it("a checkpoint holds every level, and restoring puts each back, whichever level is being worked on", async () => {
    const { hub } = fresh();
    await tower(hub);
    const lv1 = floor(hub.session.doc);
    await hub.addLevel("above");
    await call(hub, "add_room", { x: 2, y: 2, w: 3, h: 3 });
    const lv2 = floor(hub.session.doc);
    await hub.saveCheckpoint("both");
    await call(hub, "add_room", { x: 5, y: 4, w: 4, h: 3 }); // more on level 2
    await hub.setActiveLevel("level-1");
    await call(hub, "add_room", { x: 7, y: 1, w: 2, h: 2 }); // more on level 1
    expect(floor(hub.session.doc)).not.toBe(lv1);
    await hub.restoreCheckpoint("both", "user");
    expect(floor(hub.session.doc)).toBe(lv1);
    await hub.setActiveLevel("level-2");
    expect(floor(hub.session.doc)).toBe(lv2);
    await hub.close();
  });

  it("removing a level saves a checkpoint first, deletes its files, and restoring that checkpoint brings the level back", async () => {
    const { hub, dir, store } = fresh();
    await tower(hub);
    await hub.addLevel("above", "Attic");
    await call(hub, "add_room", { x: 2, y: 2, w: 3, h: 3 });
    const lv2 = floor(hub.session.doc);
    await hub.flush();
    await expect(hub.removeLevel("level-1")).rejects.toThrow(/first level/);
    await hub.removeLevel("level-2");
    expect(hub.levelsInfo()!.levels.map((l) => l.id)).toEqual(["level-1"]);
    expect(hub.levelsInfo()!.active).toBe("level-1"); // it was being worked on: back to the first
    expect(existsSync(path.join(dir, "tower", "levels", "level-2"))).toBe(false);
    expect((await store.listCheckpoints("tower")).map((c) => c.name)).toContain("Before removing Attic");
    await hub.restoreCheckpoint("Before removing Attic", "user");
    expect(hub.levelsInfo()!.levels.map((l) => `${l.id}:${l.name}:${l.bottom}-${l.top}`)).toEqual(["level-1:Ground floor:0-10", "level-2:Attic:10-20"]);
    await hub.setActiveLevel("level-2");
    expect(floor(hub.session.doc)).toBe(lv2);
    await hub.close();
  });

  it("only battlemaps have levels, and at most MAX_LEVELS", async () => {
    const { hub } = fresh();
    await hub.createProject({ name: "World", width: 256, height: 256, kmPerPx: 2 });
    await expect(hub.addLevel("above")).rejects.toThrow(/Only battlemaps/);
    expect(hub.levelsInfo()).toBeNull();
    await hub.close();
    const b = fresh();
    await tower(b.hub);
    for (let i = 1; i < 12; i++) await b.hub.addLevel("above");
    await expect(b.hub.addLevel("above")).rejects.toThrow(/at most 12/);
    await b.hub.close();
  });
});

describe("the store's level files", () => {
  it("a levels file that can't be read is set aside, not overwritten; the map opens with its first level", async () => {
    const { hub, dir, store } = fresh();
    await tower(hub);
    await hub.addLevel("above");
    await hub.flush();
    await hub.close();
    writeFileSync(path.join(dir, "tower", "levels.json"), "{ not json");
    const levels = await store.readLevels("tower");
    expect(levels.levels).toHaveLength(1);
    expect(store.takeNotices("tower")[0]).toMatch(/list of levels couldn't be read/);
    expect(readdirSync(path.join(dir, "tower")).some((f) => f.startsWith("levels.unreadable-"))).toBe(true);
    expect(existsSync(path.join(dir, "tower", "levels", "level-2", "project.json"))).toBe(true); // the other level's files are untouched
  });

  it("level folders are only ever levels/<safe id>/", async () => {
    const { store } = fresh();
    const file = { v: 1 as const, active: "a", levels: [{ id: "a", name: "A", bottom: 0, top: 10 }, { id: "b", name: "B", bottom: 10, top: 20 }] };
    expect(store.levelDir("x", file, "a")).toBe(path.join(store.root, "x"));
    expect(store.levelDir("x", file, "b")).toBe(path.join(store.root, "x", "levels", "b"));
    expect(() => store.levelDir("x", file, "../evil")).toThrow(/No level/);
    mkdirSync(store.root, { recursive: true });
  });
});
