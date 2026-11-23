/** Battlemaps Dragon Drop makes (Battlemap here, from a world map or a settlement) dressed with fitting pictures from the asset packs. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { CUSTOM_MATERIAL_BASE, MATERIALS } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { AssetLibrary } from "../src/assets.ts";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-dress-"));
const lib = path.join(root, "Library");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (rel: string, w: number, h: number, rgb: [number, number, number]) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) p.data.set([...rgb, 255], i * 4);
  mkdirSync(path.dirname(path.join(lib, rel)), { recursive: true });
  writeFileSync(path.join(lib, rel), PNG.sync.write(p));
};
beforeAll(() => {
  for (const n of ["Grass_A", "Grass_B", "Dirt_A", "Sand_A", "Snow_A", "Rock_A", "Forest_Floor_A", "Cobblestone_A", "Wood_Floor_A", "Flagstone_A", "Shallow_Water_A", "Deep_Water_A"]) put(`Kit/Floors/${n}.png`, 256, 256, [100, 140, 80]);
  put("Kit/Walls/Stone_Wall_A.png", 640, 64, [120, 120, 130]);
  put("Kit/Doors/Oak_Door.png", 256, 64, [140, 90, 50]);
});

let n = 0;
const fresh = async (withLibrary = true) => {
  const dir = path.join(root, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  const hub = new Hub(new ProjectStore(dir), null);
  if (withLibrary) { hub.assets = new AssetLibrary(lib, path.join(root, `cache${n}`)); await hub.assets.scan(); }
  return hub;
};
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};
const floorsUsed = (hub: Hub) => { const s = new Set<number>(); for (const v of hub.session.doc.height.data) s.add(v | 0); return s; };

describe("battlemaps made with pictures from the packs", () => {
  it("gives a battlemap from a world map pack floors where they fit, and keeps the built-in ones when asked", async () => {
    const hub = await fresh();
    await hub.createProject({ name: "World", width: 256, height: 256, kmPerPx: 4 });
    await ok(hub, "generate_terrain", { template: "continent", seed: 3 });
    const made = await ok(hub, "create_battlemap_here", { name: "Glade", x: 128, y: 128 });
    expect(made.pack_pictures?.length).toBeGreaterThan(0);
    const palette = hub.session.doc.meta.battle!.palette ?? [];
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.every((e) => e.asset.startsWith("kit:"))).toBe(true);
    // every floor in use is a pack texture now, or a built-in one the packs had nothing for
    for (const m of floorsUsed(hub)) if (m > 0 && m < CUSTOM_MATERIAL_BASE) expect(["lava", "carpet", "marble", "mud"]).toContain(MATERIALS[m].name);
    // the same spot without pack pictures: built-in floors only
    await ok(hub, "open_project", { id: "world" });
    await ok(hub, "create_battlemap_here", { name: "Glade plain", x: 128, y: 128, pack_pictures: false });
    expect(hub.session.doc.meta.battle!.palette ?? []).toHaveLength(0);
    await hub.close();
  });

  it("gives a battlemap from a settlement pack floors, walls and doors", async () => {
    const hub = await fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 200, height_m: 160 });
    await ok(hub, "add_streets", { streets: [{ points: [[10, 80], [190, 80]], width: 8 }] });
    await ok(hub, "add_buildings", { buildings: [{ x: 60, y: 60, w: 14, h: 10 }, { x: 100, y: 96, w: 14, h: 10 }] });
    const made = await ok(hub, "create_battlemap_from_city", { x: 80, y: 80, squares_x: 30, squares_y: 20 });
    expect(made.created.packPictures.join(" ")).toMatch(/walls: Stone Wall A/);
    const walls = hub.session.doc.features!.walls ?? [];
    expect(walls.filter((w) => w.kind === "wall").every((w) => w.asset === "kit:Walls/Stone_Wall_A.png")).toBe(true);
    expect(walls.filter((w) => w.kind === "door").every((w) => w.portal === "kit:Doors/Oak_Door.png")).toBe(true);
    expect((hub.session.doc.meta.battle!.palette ?? []).length).toBeGreaterThan(0);
    await hub.close();
  });

  it("makes them as before without an asset library", async () => {
    const hub = await fresh(false);
    await ok(hub, "create_city", { name: "Bare", width_m: 200, height_m: 160 });
    await ok(hub, "add_buildings", { buildings: [{ x: 60, y: 60, w: 14, h: 10 }] });
    const made = await ok(hub, "create_battlemap_from_city", { x: 80, y: 80 });
    expect(made.created.packPictures).toBeUndefined();
    expect((hub.session.doc.features!.walls ?? []).some((w) => w.asset)).toBe(false);
    await hub.close();
  });
});
