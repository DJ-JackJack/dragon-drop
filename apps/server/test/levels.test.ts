/** Battlemap levels: each level is a floor document of its own under one battlemap (see docs/FOUNDRY.md, "Stage 2 design"). */
import { existsSync } from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type MapDoc, memoryAccess } from "@mapmaker/core";
import { decodeImage, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";
import { readZipFile, readZipIndex } from "../src/zip.ts";

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

describe("stairs, ladders and holes in a saved map", () => {
  it("are kept per level when the map is saved, reopened and restored from a checkpoint", async () => {
    const { hub, dir } = fresh();
    await tower(hub);
    hub.session.execute({ op: "features", patch: { upsertConnectors: [{ id: "s1", kind: "stairs", x: 2, y: 2, w: 1, h: 2, to: "up" }] } }, "user");
    await hub.addLevel("above");
    hub.session.execute({ op: "features", patch: { upsertConnectors: [{ id: "h1", kind: "hole", x: 3, y: 3, w: 1, h: 1, to: "down" }] } }, "user");
    await hub.saveCheckpoint("with connectors");
    hub.session.execute({ op: "features", patch: { removeConnectors: ["h1"] } }, "user");
    await hub.flush();
    await hub.close();
    const again = await reopen(dir, "tower");
    expect(again.session.doc.features?.connectors).toEqual([]); // (the upper level, where the hole was removed)
    await again.setActiveLevel("level-1");
    expect(again.session.doc.features?.connectors).toEqual([{ id: "s1", kind: "stairs", x: 2, y: 2, w: 1, h: 2, to: "up" }]);
    await again.restoreCheckpoint("with connectors", "user");
    await again.setActiveLevel("level-2");
    expect(again.session.doc.features?.connectors).toEqual([{ id: "h1", kind: "hole", x: 3, y: 3, w: 1, h: 1, to: "down" }]);
    await again.close();
  });
});

describe("exporting a battlemap with levels", () => {
  /** The files of an exported zip, by name. */
  const unzip = async (bytes: Uint8Array) => {
    const ra = memoryAccess(bytes);
    const out = new Map<string, Uint8Array>();
    for (const e of await readZipIndex(ra)) out.set(e.path, await readZipFile(ra, e));
    return out;
  };
  const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const twoLevels = async (hub: Hub) => {
    await tower(hub);
    await hub.addLevel("above");
    await call(hub, "add_room", { x: 2, y: 2, w: 3, h: 3, doors: [{ side: "top", offset: 1, kind: "door" }] });
    await call(hub, "add_light", { x: 3, y: 3, radius: 4 });
  };

  it("a Foundry scene has a level for each floor, with its own picture, walls and lights, and opens on the level being worked on", async () => {
    const { hub } = fresh();
    await twoLevels(hub);
    const f = await hub.battleExport("foundry");
    expect(f.name).toBe("tower-foundry.zip");
    const files = await unzip(f.bytes);
    expect([...files.keys()].sort()).toEqual(["README.txt", "tower-1-ground-floor.png", "tower-2-upper-floor.png", "tower-scene.json"]);
    expect(isPng(files.get("tower-1-ground-floor.png")!)).toBe(true);
    expect(isPng(files.get("tower-2-upper-floor.png")!)).toBe(true);
    const scene = JSON.parse(new TextDecoder().decode(files.get("tower-scene.json")!));
    expect(scene.levels.map((l: { name: string }) => l.name)).toEqual(["Upper floor", "Ground floor"]); // (the active level first: the scene opens on it)
    expect(scene.initialLevel).toBe(scene.levels[0]._id);
    const byName = Object.fromEntries(scene.levels.map((l: { name: string; _id: string; background: { src: string }; elevation: object }) => [l.name, l]));
    expect(byName["Upper floor"].elevation).toEqual({ bottom: 10, top: 20 });
    expect(byName["Upper floor"].background.src).toBe("maps/tower-2-upper-floor.png");
    expect(byName["Ground floor"].background.src).toBe("maps/tower-1-ground-floor.png");
    // every wall and light belongs to exactly its own level
    const up = byName["Upper floor"]._id, ground = byName["Ground floor"]._id;
    const count = (list: { levels: string[] }[], id: string) => list.filter((w) => w.levels.length === 1 && w.levels[0] === id).length;
    expect(count(scene.walls, up)).toBeGreaterThan(0);
    expect(count(scene.walls, ground)).toBeGreaterThan(0);
    expect(count(scene.walls, up) + count(scene.walls, ground)).toBe(scene.walls.length);
    expect(count(scene.lights, up)).toBe(1);
    expect(count(scene.lights, ground)).toBe(0);
    expect(new TextDecoder().decode(files.get("README.txt")!)).toMatch(/2 Levels \(Ground floor, Upper floor\)/);
    await hub.close();
  });

  it("stairs and holes placed on the levels become regions in the Foundry scene, and the README says so", async () => {
    const { hub } = fresh();
    await tower(hub);
    await hub.addLevel("above");
    await call(hub, "add_room", { x: 1, y: 1, w: 6, h: 5 });
    // a hole in the upper floor, and (on the ground floor) a stair up to it
    hub.session.execute({ op: "features", patch: { upsertConnectors: [{ id: "h1", kind: "hole", x: 3, y: 3, w: 2, h: 1, to: "down" }] } }, "user");
    await hub.setActiveLevel("level-1");
    hub.session.execute({ op: "features", patch: { upsertConnectors: [{ id: "s1", kind: "stairs", name: "Tower stairs", x: 2, y: 2, w: 1, h: 2, to: "up" }] } }, "user");
    const files = await unzip((await hub.battleExport("foundry")).bytes);
    const scene = JSON.parse(new TextDecoder().decode(files.get("tower-scene.json")!));
    const names = scene.regions.map((r: { name: string }) => r.name);
    expect(names).toEqual(["Tower stairs", "Upper floor floor"]);
    const [stairs, floor] = scene.regions as { levels: string[]; shapes: { hole: boolean }[]; behaviors: { type: string }[] }[];
    expect(stairs.levels).toHaveLength(2);
    expect(stairs.behaviors[0].type).toBe("changeLevel");
    expect(floor.behaviors[0].type).toBe("defineSurface");
    expect(floor.shapes.filter((x) => x.hole)).toHaveLength(1);
    const readme = new TextDecoder().decode(files.get("README.txt")!);
    expect(readme).toMatch(/Change Level/);
    expect(readme).not.toMatch(/Not exported/);
    // a stair that leads nowhere is left out, and the README says which
    hub.session.execute({ op: "features", patch: { upsertConnectors: [{ id: "s2", kind: "ladder", name: "Ladder to the roof", x: 5, y: 2, w: 1, h: 1, to: "down" }] } }, "user");
    await hub.setActiveLevel("level-2");
    hub.session.execute({ op: "features", patch: { upsertConnectors: [{ id: "s3", kind: "ladder", name: "Ladder to the roof", x: 5, y: 2, w: 1, h: 1, to: "up" }] } }, "user");
    const again = await unzip((await hub.battleExport("foundry")).bytes);
    expect(new TextDecoder().decode(again.get("README.txt")!)).toMatch(/Not exported: Ladder to the roof on Upper floor leads up, but there is no level above it\./);
    await hub.close();
  });

  it("roofs become tiles: a see-through picture for each roof next to the level's own, a ceiling region over it, and the ordinary pictures never show them", async () => {
    const { hub } = fresh();
    await tower(hub); // a room at squares 1..7 x 1..6, 70 px a square
    await hub.addLevel("above");
    hub.session.execute({ op: "features", patch: { upsertRoofs: [{ id: "f1", style: "slate", points: [[1, 1], [7, 1], [7, 6], [1, 6]] }] } }, "user");
    const files = await unzip((await hub.battleExport("foundry")).bytes);
    expect([...files.keys()].sort()).toEqual(["README.txt", "tower-1-ground-floor.png", "tower-2-upper-floor-roof-1.png", "tower-2-upper-floor.png", "tower-scene.json"]);
    const scene = JSON.parse(new TextDecoder().decode(files.get("tower-scene.json")!));
    // a foreground never fades, so no level has one
    expect(scene.levels.map((l: { foreground: { src: string | null } }) => l.foreground.src)).toEqual([null, null]);
    const upper = scene.levels.find((l: { name: string }) => l.name === "Upper floor");
    expect(scene.tiles).toHaveLength(1);
    const [tile] = scene.tiles;
    expect(tile).toMatchObject({ texture: { src: "maps/tower-2-upper-floor-roof-1.png" }, elevation: upper.elevation.top, levels: [upper._id], occlusion: { mode: 2, modes: [2], alpha: 0 } });
    // the roof's picture is cropped to the roof (its outline, eave and shadow), not the size of the map, and the tile is placed by its centre
    const roof = decodeImage(files.get("tower-2-upper-floor-roof-1.png")!)!;
    expect([tile.width, tile.height]).toEqual([roof.w, roof.h]);
    expect(roof.w).toBeLessThan(10 * 70);
    expect([tile.x, tile.y]).toEqual([Math.round((tile.x - roof.w / 2 + roof.w / 2) * 100) / 100, Math.round((tile.y - roof.h / 2 + roof.h / 2) * 100) / 100]);
    const alpha = (x: number, y: number) => roof.data[(y * roof.w + x) * 4 + 3];
    expect(alpha(Math.floor(roof.w / 2), Math.floor(roof.h / 2))).toBe(255); // (opaque on the roof)
    expect(alpha(0, 0)).toBe(0); // (transparent beside it)
    expect(tile.x - roof.w / 2).toBeLessThan(70); // (its picture starts left of the roof's own edge: the eave and the shadow)
    // a ceiling over the roof's outline (a rectangle here), on the same level, up to the level's top
    expect(scene.regions).toHaveLength(1);
    expect(scene.regions[0]).toMatchObject({
      name: "Roof 1 on Upper floor", levels: [upper._id], elevation: { bottom: upper.elevation.bottom, top: upper.elevation.top },
      shapes: [{ type: "rectangle", x: 70, y: 70, width: 420, height: 350 }],
      behaviors: [{ type: "defineSurface", system: { placement: "top", occlusion: true } }],
    });
    expect(new TextDecoder().decode(files.get("README.txt")!)).toMatch(/Tile at the top of its level.*a token YOU CONTROL/s);
    // the level's own picture and the single-file exports have no roof in them
    expect((await hub.battleExport("png")).bytes.length).toBeGreaterThan(1000);
    const pic = decodeImage(files.get("tower-2-upper-floor.png")!)!;
    expect(pic.data[(Math.floor(3.5 * 70) * pic.w + Math.floor(4 * 70)) * 4 + 3]).toBe(255); // (an opaque picture, of floor and void: not the roof)
    await hub.close();
  });

  it("one level: its roof is tower-roof-1.png, and an outline that is not a rectangle gets a polygon ceiling", async () => {
    const { hub } = fresh();
    await tower(hub);
    hub.session.execute({ op: "features", patch: { upsertRoofs: [{ id: "f1", style: "tile", points: [[1, 1], [7, 1], [7, 6], [1, 6]] }, { id: "f2", name: "Lean-to", style: "thatch", points: [[8, 1], [10, 1], [9, 4]] }] } }, "user");
    const files = await unzip((await hub.battleExport("foundry")).bytes);
    expect([...files.keys()].sort()).toEqual(["README.txt", "tower-roof-1.png", "tower-roof-2.png", "tower-scene.json", "tower.png"]);
    const scene = JSON.parse(new TextDecoder().decode(files.get("tower-scene.json")!));
    expect(scene.levels[0].foreground.src).toBeNull();
    expect(scene.tiles.map((x: { texture: { src: string } }) => x.texture.src)).toEqual(["maps/tower-roof-1.png", "maps/tower-roof-2.png"]);
    expect(scene.regions.map((r: { name: string; shapes: { type: string }[] }) => [r.name, r.shapes.map((s) => s.type)])).toEqual([["Roof 1 on Ground floor", ["rectangle"]], ["Lean-to on Ground floor", ["polygon"]]]);
    expect(scene.regions[1].shapes[0].points).toEqual([560, 70, 700, 70, 630, 280]);
    await hub.close();
  });

  it("a one-level map still exports exactly as before: one picture named after the map, the level 'Ground floor' from 0 to 10 feet", async () => {
    const { hub } = fresh();
    await tower(hub);
    const files = await unzip((await hub.battleExport("foundry")).bytes);
    expect([...files.keys()].sort()).toEqual(["README.txt", "tower-scene.json", "tower.png"]);
    const scene = JSON.parse(new TextDecoder().decode(files.get("tower-scene.json")!));
    expect(scene.levels).toHaveLength(1);
    expect(scene.levels[0]).toMatchObject({ name: "Ground floor", elevation: { bottom: 0, top: 10 }, background: { src: "maps/tower.png" } });
    await hub.close();
  });

  it("a renamed level with its own elevations is what a one-level scene uses", async () => {
    const { hub } = fresh();
    await tower(hub);
    await hub.updateLevel("level-1", { name: "Cellar", bottom: -10, top: 0 });
    const scene = JSON.parse(new TextDecoder().decode((await unzip((await hub.battleExport("foundry")).bytes)).get("tower-scene.json")!));
    expect(scene.levels[0]).toMatchObject({ name: "Cellar", elevation: { bottom: -10, top: 0 } });
    await hub.close();
  });

  it("the picture and the Universal VTT file are of the level being worked on, named with it; the key covers every level", async () => {
    const { hub } = fresh();
    await twoLevels(hub);
    expect((await hub.battleExport("png")).name).toBe("tower-upper-floor.png");
    const uvtt = await hub.battleExport("uvtt");
    expect(uvtt.name).toBe("tower-upper-floor.dd2vtt");
    expect(JSON.parse(new TextDecoder().decode(uvtt.bytes)).lights).toHaveLength(1); // the upper floor's light, not the ground floor's none
    await hub.setActiveLevel("level-1");
    expect((await hub.battleExport("png")).name).toBe("tower-ground-floor.png");
    expect(JSON.parse(new TextDecoder().decode((await hub.battleExport("uvtt")).bytes)).lights).toHaveLength(0);
    const key = new TextDecoder().decode((await hub.battleExport("key")).bytes);
    expect(key).toContain("Tower, Ground floor");
    expect(key).toContain("Tower, Upper floor");
    await hub.close();
  });

  it("any level can be pictured (for the editor's faint level below); an unknown level or project can't", async () => {
    const { hub } = fresh();
    await twoLevels(hub);
    expect(isPng((await hub.levelPicture("tower", "level-1"))!)).toBe(true);
    expect(isPng((await hub.levelPicture("tower", "level-2"))!)).toBe(true);
    expect(await hub.levelPicture("tower", "level-9")).toBeNull();
    expect(await hub.levelPicture("other", "level-1")).toBeNull();
    await hub.close();
  });
});

describe("Claude's tools for levels, stairs, ladders and holes", () => {
  type Out = { text: string; isError: boolean };
  const tool = async (hub: Hub, name: string, input: Record<string, unknown> = {}): Promise<Out> => {
    const r = await runTool(hub.toolContext("mcp"), name, input);
    return { text: (r.content[0] as { text: string }).text, isError: !!r.isError };
  };
  const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
    const r = await tool(hub, name, input);
    if (r.isError) throw new Error(`${name}: ${r.text}`);
    return JSON.parse(r.text);
  };

  it("lists the levels (one, until another is added), adds one and works on it, switches by name, and renames or re-elevates", async () => {
    const { hub } = fresh();
    await tower(hub);
    const one = await ok(hub, "list_levels");
    expect(one.levels).toHaveLength(1);
    expect(one.levels[0]).toMatchObject({ id: "level-1", name: "Ground floor", bottom: 0, top: 10, counts: { doors: 0 } });
    expect(one.levels[0].counts.walls).toBeGreaterThan(0);
    expect(one.levels[0].counts.floored_squares).toBeGreaterThan(0);
    const up = await ok(hub, "add_level", { where: "above" });
    expect(up.level).toEqual({ id: "level-2", name: "Upper floor", bottom: 10, top: 20 });
    expect(hub.levelsInfo()!.active).toBe("level-2"); // (the DM's editor follows)
    await ok(hub, "add_room", { x: 1, y: 1, w: 4, h: 3 }); // works on the new level
    const two = await ok(hub, "list_levels");
    expect(two.levels.map((l: { name: string }) => l.name)).toEqual(["Ground floor", "Upper floor"]);
    expect(two.active).toBe("level-2");
    expect(two.levels[1].counts.walls).toBeGreaterThan(0);
    await ok(hub, "set_active_level", { level: "ground floor" }); // by name, any case
    expect(hub.levelsInfo()!.active).toBe("level-1");
    await ok(hub, "set_active_level", { level: "level-2" }); // by id
    expect(hub.levelsInfo()!.active).toBe("level-2");
    const renamed = await ok(hub, "update_level", { level: "Upper floor", name: "Attic", bottom_ft: 10, top_ft: 18 });
    expect(renamed.level).toEqual({ id: "level-2", name: "Attic", bottom: 10, top: 18 });
    await hub.close();
  });

  it("explains itself when a level is missing, a name is ambiguous or a height is wrong", async () => {
    const { hub } = fresh();
    await tower(hub);
    await ok(hub, "add_level", { where: "above", name: "Attic" });
    const missing = await tool(hub, "set_active_level", { level: "Dungeon" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/There is no level "Dungeon"\. The levels are: Ground floor \(level-1\), Attic \(level-2\)/);
    expect((await tool(hub, "update_level", { level: "Attic", bottom_ft: 30 })).text).toMatch(/top must be higher than its bottom/);
    expect((await tool(hub, "update_level", { level: "Attic", name: "ground FLOOR" })).text).toMatch(/already a level called/);
    await hub.close();
  });

  it("adds, lists, changes and removes stairs, ladders and holes on the active level, with the DM's undo", async () => {
    const { hub } = fresh();
    await tower(hub);
    await ok(hub, "add_level", { where: "above" });
    await ok(hub, "set_active_level", { level: "Ground floor" });
    const added = await ok(hub, "add_connector", { kind: "stairs", x: 2, y: 2, w: 1, h: 3, name: "Tower stairs" });
    expect(added.connector).toMatchObject({ kind: "stairs", x: 2, y: 2, w: 1, h: 3, leads: "up", name: "Tower stairs" });
    expect(added.note).toBeUndefined(); // there is a level above
    const hole = await ok(hub, "add_connector", { kind: "hole", x: 6, y: 3, w: 1, h: 1, leads: "up" });
    expect(hole.connector.leads).toBe("down"); // a hole always leads down
    expect(hole.note).toMatch(/no level below it yet/);
    const list = await ok(hub, "list_connectors");
    expect(list.connectors.map((c: { kind: string }) => c.kind)).toEqual(["stairs", "hole"]);
    expect((await ok(hub, "list_battle")).connectors).toHaveLength(2);
    expect((await ok(hub, "list_battle")).summary.connectors).toBe(2);
    const changed = await ok(hub, "update_connector", { id: added.connector.id, w: 2, name: "" });
    expect(changed.connector).toMatchObject({ w: 2, kind: "stairs" });
    expect(changed.connector.name).toBeUndefined();
    const removed = await ok(hub, "remove_connectors", { ids: [hole.connector.id, "nope"] });
    expect(removed).toMatchObject({ removed: [hole.connector.id], not_found: ["nope"] });
    expect((await ok(hub, "list_connectors")).connectors).toHaveLength(1);
    // they are ordinary changes: one undo takes the last away
    hub.session.undo("user");
    expect((await ok(hub, "list_connectors")).connectors).toHaveLength(2);
    // another level has its own
    await ok(hub, "set_active_level", { level: "Upper floor" });
    expect((await ok(hub, "list_connectors")).connectors).toEqual([]);
    await hub.close();
  });

  it("refuses a stair that doesn't fit the map, and an id from another level", async () => {
    const { hub } = fresh();
    await tower(hub); // 10 x 8 squares
    expect((await tool(hub, "add_connector", { kind: "stairs", x: 9, y: 2, w: 2, h: 1 })).text).toMatch(/doesn't fit: the map is 10 x 8 squares/);
    const c = await ok(hub, "add_connector", { kind: "ladder", x: 1, y: 1, w: 1, h: 1 });
    expect(c.note).toMatch(/no level above it yet/);
    await ok(hub, "add_level", { where: "above" });
    expect((await tool(hub, "update_connector", { id: c.connector.id, x: 1 })).isError).toBe(true); // (it is on the ground floor, not this level)
    await hub.close();
  });

  it("exports the picture and the Universal VTT file of the level asked for, named with it", async () => {
    const { hub } = fresh();
    await tower(hub);
    await ok(hub, "add_level", { where: "above" }); // (working on the upper floor)
    expect((await ok(hub, "export_battlemap", { format: "png" })).file).toBe("tower-upper-floor.png");
    expect((await ok(hub, "export_battlemap", { format: "uvtt", level: "Ground floor" })).file).toBe("tower-ground-floor.dd2vtt");
    expect((await tool(hub, "export_battlemap", { format: "png", level: "Cellar" })).isError).toBe(true);
    await hub.close();
  });

  it("are for battlemaps only: a world map refuses them", async () => {
    const { hub } = fresh();
    await hub.createProject({ name: "World", width: 256, height: 256, kmPerPx: 1 });
    for (const name of ["list_levels", "add_level", "add_connector"]) expect((await tool(hub, name, { where: "above", kind: "hole", x: 1, y: 1, w: 1, h: 1 })).isError, name).toBe(true);
    await hub.close();
  });
});

describe("Claude's tools for roofs", () => {
  type Out = { text: string; isError: boolean };
  const tool = async (hub: Hub, name: string, input: Record<string, unknown> = {}): Promise<Out> => {
    const r = await runTool(hub.toolContext("mcp"), name, input);
    return { text: (r.content[0] as { text: string }).text, isError: !!r.isError };
  };
  const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
    const r = await tool(hub, name, input);
    if (r.isError) throw new Error(`${name}: ${r.text}`);
    return JSON.parse(r.text);
  };

  it("adds a roof as a rectangle or an outline, lists it, changes it, removes it, with the DM's undo", async () => {
    const { hub } = fresh();
    await tower(hub); // 10 x 8 squares
    const a = await ok(hub, "add_roof", { rect: { x: 1, y: 1, w: 6, h: 5 }, style: "tile", name: "Tower roof" });
    expect(a.roof).toMatchObject({ style: "tile", name: "Tower roof", points: [[1, 1], [7, 1], [7, 6], [1, 6]] });
    const b = await ok(hub, "add_roof", { points: [[1, 6], [4, 6], [2, 8]], colour: "#4A7A8C", flat: true });
    expect(b.roof).toMatchObject({ style: "slate", colour: "#4a7a8c", flat: true });
    expect((await ok(hub, "list_roofs")).roofs).toHaveLength(2);
    expect((await ok(hub, "list_battle")).roofs).toHaveLength(2);
    expect((await ok(hub, "list_battle")).summary.roofs).toBe(2);
    const changed = await ok(hub, "update_roof", { id: a.roof.id, style: "thatch", flat: true, colour: "#aa8844", name: "" });
    expect(changed.roof).toMatchObject({ style: "thatch", flat: true, colour: "#aa8844" });
    expect(changed.roof.name).toBeUndefined();
    const back = await ok(hub, "update_roof", { id: a.roof.id, flat: false, colour: "" });
    expect(back.roof.flat).toBeUndefined();
    expect(back.roof.colour).toBeUndefined();
    const removed = await ok(hub, "remove_roofs", { ids: [b.roof.id, "nope"] });
    expect(removed).toMatchObject({ removed: [b.roof.id], not_found: ["nope"] });
    hub.session.undo("user");
    expect((await ok(hub, "list_roofs")).roofs).toHaveLength(2);
    await hub.close();
  });

  it("refuses a roof outside the map, with both or neither of rect and points, or with a picture that isn't in the library", async () => {
    const { hub } = fresh();
    await tower(hub);
    expect((await tool(hub, "add_roof", { rect: { x: 8, y: 1, w: 5, h: 2 } })).text).toMatch(/outside the map, which is 10 x 8 squares/);
    expect((await tool(hub, "add_roof", {})).text).toMatch(/either rect or points/);
    expect((await tool(hub, "add_roof", { rect: { x: 1, y: 1, w: 2, h: 2 }, points: [[0, 0], [1, 0], [1, 1]] })).text).toMatch(/either rect or points/);
    expect((await tool(hub, "add_roof", { rect: { x: 1, y: 1, w: 2, h: 2 }, asset: "pack:roof.png" })).isError).toBe(true); // (no library in this test)
    expect((await tool(hub, "add_roof", { rect: { x: 1, y: 1, w: 2, h: 2 }, colour: "red" })).isError).toBe(true);
    await hub.close();
  });

  it("a roof belongs to the level it was added on, and render_battlemap leaves roofs out unless asked", async () => {
    const { hub } = fresh();
    await tower(hub);
    await ok(hub, "add_roof", { rect: { x: 1, y: 1, w: 6, h: 5 }, style: "tile" });
    await ok(hub, "add_level", { where: "above" });
    expect((await ok(hub, "list_roofs")).roofs).toEqual([]);
    expect((await ok(hub, "list_levels")).levels[0].counts).toBeDefined();
    await ok(hub, "set_active_level", { level: "Ground floor" });
    const imageData = async (roofs: boolean) => {
      const r = await runTool(hub.toolContext("mcp"), "render_battlemap", { roofs, grid: false, max_size: 560 });
      const img = r.content.find((c) => c.type === "image") as { data: string };
      return img.data;
    };
    const without = await imageData(false), withRoofs = await imageData(true);
    expect(without).not.toBe(withRoofs);
    await hub.close();
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
