/** A city's land, climate and trees, through Claude's tools and the hub: shaped, read back, drawn, undone, saved and kept off other kinds of map. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { citySpec, landGrid, renderCity } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-cityland-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const fresh = () => {
  const dir = path.join(root, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  return { dir, hub: new Hub(new ProjectStore(dir), null) };
};
const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await tool(hub, name, input);
  if (r.isError) throw new Error(`${name}: ${textOf(r)}`);
  return JSON.parse(textOf(r));
};

describe("a city's land", () => {
  it("is shaped with hills, valleys and slopes in one edit, read back with land_at, changed, undone and removed", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Hill Town", width_m: 600, height_m: 400 });
    const flat = await ok(hub, "list_land");
    expect(flat.land).toMatch(/flat/);
    const r = await ok(hub, "shape_land", { landforms: [
      { kind: "hill", x: 400, y: 120, height: 25, radius: 120, name: "Castle Hill" },
      { kind: "valley", points: [[0, 320], [300, 300], [600, 330]], height: 8, radius: 40 },
      { kind: "slope", points: [[300, 400], [300, 0]], height: 20 },
      { kind: "hill", x: 900, y: 50, height: 10, radius: 30 }, // (outside the city: skipped and said why)
    ] });
    expect(r.added).toHaveLength(3);
    expect(r.skipped[0]).toMatch(/outside the map/);
    expect(r.added.map((a: { kind: string }) => a.kind)).toEqual(["hill", "valley", "slope"]);
    expect(r.land.height_range_m[1]).toBeGreaterThan(30); // (the hill on top of the slope)
    const seqAfter = hub.session.seq;
    // the top of the hill is high and gentle (only the slope under it tilts it); its side is steeper and falls away from the top
    const at = await ok(hub, "land_at", { points: [[400, 120], [470, 120], [300, 318]] });
    expect(at.points[0].height).toBeGreaterThan(35);
    expect(at.points[0].slope).toBeLessThan(9);
    expect(at.points[1].slope).toBeGreaterThan(at.points[0].slope + 8);
    expect(at.points[1].falls).toMatch(/east/);
    expect(at.points[2].height).toBeLessThan(at.points[0].height - 25); // (down in the valley)
    // change the hill's height; the land summary goes with the city summary
    const hill = (await ok(hub, "list_land")).landforms.find((l: { name?: string }) => l.name === "Castle Hill");
    await ok(hub, "update_land", { changes: [{ id: hill.id, height: 40 }] });
    expect((await ok(hub, "land_at", { points: [[400, 120]] })).points[0].height).toBeGreaterThan(50);
    const summary = await ok(hub, "get_map_summary");
    expect(summary.land.landforms).toBe(3);
    // undo takes the change back; remove takes a landform away
    hub.session.undo("user");
    expect((await ok(hub, "land_at", { points: [[400, 120]] })).points[0].height).toBeLessThan(50);
    expect(hub.session.seq).toBeGreaterThan(seqAfter);
    await ok(hub, "remove_land", { ids: [hill.id] });
    expect((await ok(hub, "list_land")).landforms).toHaveLength(2);
    await hub.close();
  });

  it("is drawn: shading and contour lines in the picture, and the picture with no land is unchanged", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Shade", width_m: 400, height_m: 300 });
    const before = renderCity(hub.session.doc, { maxSize: 400 }).img.data;
    await ok(hub, "shape_land", { landforms: [{ kind: "hill", x: 200, y: 150, height: 30, radius: 100 }] });
    const doc = hub.session.doc, g = landGrid(doc)!;
    expect(g.max).toBeGreaterThan(29);
    const after = renderCity(doc, { maxSize: 400 }).img;
    // the lit side (top left of the hill) is brighter than the far side (bottom right)
    const lum = (x: number, y: number) => { const o = (y * after.w + x) * 4; return after.data[o] + after.data[o + 1] + after.data[o + 2]; };
    expect(lum(150, 100)).toBeGreaterThan(lum(250, 200) + 30);
    // far from the hill nothing changed
    const far = (5 * after.w + 5) * 4;
    expect([...after.data.slice(far, far + 3)]).toEqual([...before.slice(far, far + 3)]);
    await hub.close();
  });
});

describe("a city's climate and trees", () => {
  it("sets the climate (one undo step), which changes the grass, the snow and the kinds of tree", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Cold Town", width_m: 300, height_m: 200 });
    const green = renderCity(hub.session.doc, { maxSize: 300 }).img.data.slice(0, 3);
    const r = await ok(hub, "set_city_climate", { preset: "cold", elevation: 420 });
    expect(r.land.climate.preset).toBe("cold");
    expect(r.land.climate.snow).toBeTruthy();
    expect(r.land.climate.trees_grow).toMatch(/^conifer/);
    expect(citySpec(hub.session.doc)).toMatchObject({ widthM: 300, heightM: 200, elevation: 420, climate: { temperature: 0.15 } });
    const snowy = renderCity(hub.session.doc, { maxSize: 300 }).img.data.slice(0, 3);
    expect(snowy[2]).toBeGreaterThan(green[2] + 40); // (whiter: the blue rises most)
    hub.session.undo("user");
    expect(citySpec(hub.session.doc).climate).toBeUndefined();
    expect(citySpec(hub.session.doc)).toMatchObject({ widthM: 300, heightM: 200 });
    // the size of a city can't be changed by a settings change (its ground would no longer fit)
    hub.session.execute({ op: "set_meta", patch: { city: { widthM: 50, heightM: 50, cellM: 9, climate: { temperature: 0.9, moisture: 0.9 } } } }, "user");
    expect(citySpec(hub.session.doc)).toMatchObject({ widthM: 300, heightM: 200, climate: { temperature: 0.9 } });
    expect((await tool(hub, "set_city_climate", { temperature: 2 })).isError).toBe(true);
    await hub.close();
  });

  it("adds woods, rows and single trees, lists and removes them, and draws them", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Green", width_m: 300, height_m: 200 });
    const r = await ok(hub, "add_trees", { groups: [
      { kind: "wood", points: [[20, 20], [120, 20], [120, 90], [20, 90]] },
      { kind: "row", points: [[150, 150], [280, 150]] },
      { kind: "tree", points: [[200, 60]], size: 10, species: "palm" },
      { kind: "wood", points: [[10, 10], [20, 10]] }, // (two points: not an area)
    ] });
    expect(r.added).toHaveLength(3);
    expect(r.skipped[0]).toMatch(/at least 3 points/);
    expect((await ok(hub, "list_trees", { region: { x: 0, y: 0, w: 150, h: 100 } })).total).toBe(1);
    const img = renderCity(hub.session.doc, { maxSize: 300 }).img;
    const g = (x: number, y: number) => img.data[(y * img.w + x) * 4 + 1];
    // the wood is darker than the open grass, on average (one pixel may fall on a lit crown or a gap; the trees stand where their random ids put them)
    const mean = (x0: number, y0: number, x1: number, y1: number) => { let t = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t += g(x, y); n++; } return t / n; };
    expect(mean(30, 30, 110, 80)).toBeLessThan(mean(150, 10, 290, 40) - 10);
    const all = await ok(hub, "list_trees");
    await ok(hub, "remove_trees", { ids: [all.groups[0].id] });
    expect((await ok(hub, "list_trees")).total).toBe(2);
    await hub.close();
  });

  it("is saved with the city and comes back (format 3)", async () => {
    const { hub, dir } = fresh();
    await ok(hub, "create_city", { name: "Kept", width_m: 300, height_m: 200 });
    await ok(hub, "shape_land", { landforms: [{ kind: "hill", x: 150, y: 100, height: 12, radius: 60 }] });
    await ok(hub, "add_trees", { groups: [{ kind: "tree", points: [[40, 40]] }] });
    await ok(hub, "set_city_climate", { preset: "mediterranean" });
    await hub.flush();
    await hub.close();
    const back = await new ProjectStore(dir).load("kept");
    expect(back.meta.formatVersion).toBe(3);
    expect(back.features?.land).toHaveLength(1);
    expect(back.features?.trees).toHaveLength(1);
    expect(back.meta.city?.climate).toEqual({ temperature: 0.7, moisture: 0.32 });
  });

  it("keeps the land tools off world maps", async () => {
    const { hub } = fresh();
    await hub.ensureProject();
    const r = await tool(hub, "shape_land", { landforms: [{ kind: "hill", x: 10, y: 10, height: 5, radius: 5 }] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/city/i);
    await hub.close();
  });
});

describe("bridges", () => {
  it("are made where Claude's streets cross water, listed, changed to wood or a ford, and counted in the summary", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Bridge Town", width_m: 300, height_m: 200 });
    await ok(hub, "paint_ground", { shape: { type: "rect", x: 0, y: 90, w: 300, h: 20 }, material: "deep water" });
    const r = await ok(hub, "add_streets", { streets: [{ points: [[100, 10], [100, 190]], kind: "street" }, { points: [[10, 30], [290, 30]], kind: "lane" }] });
    expect(r.bridges).toHaveLength(1);
    expect(r.bridges[0]).toMatchObject({ kind: "stone bridge" });
    expect(r.bridges[0].length_m).toBeGreaterThanOrEqual(20);
    const id = r.ids[0];
    const u = await ok(hub, "update_streets", { changes: [{ id, bridge: "wood" }] });
    expect(u.bridges[0].kind).toBe("wood bridge");
    expect((await ok(hub, "list_streets")).streets.find((s: { id: string }) => s.id === id)).toMatchObject({ bridge_setting: "wood", bridges: [{ kind: "wood bridge" }] });
    await ok(hub, "update_streets", { changes: [{ id, bridge: "none" }] });
    expect((await ok(hub, "list_streets")).streets[0].bridges[0].kind).toMatch(/ford/);
    await ok(hub, "update_streets", { changes: [{ id, bridge: "auto" }] });
    expect((await ok(hub, "list_streets")).streets[0].bridge_setting).toBeUndefined();
    expect((await ok(hub, "get_map_summary")).bridges).toBe(1);
    await hub.close();
  });
});

describe("planning tools", () => {
  it("route a main road across a river, line it with buildings in one edit, and check the result", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Plan Town", width_m: 600, height_m: 400 });
    await ok(hub, "paint_ground", { shape: { type: "rect", x: 290, y: 0, w: 30, h: 400 }, material: "deep water" });
    await ok(hub, "shape_land", { landforms: [{ kind: "hill", x: 150, y: 90, height: 30, radius: 80 }] });
    const road = await ok(hub, "route_street", { points: [[10, 200], [590, 210]], kind: "street", max_grade_percent: 8 });
    expect(road.length_m).toBeGreaterThan(560);
    expect(road.bridges[0].kind).toBe("stone bridge");
    const seq = hub.session.seq;
    const lined = await ok(hub, "line_streets", { streets: [road.id], character: "town" });
    expect(lined.added).toBeGreaterThan(30);
    expect(lined.skipped_spots.water).toBeGreaterThan(0);
    expect(hub.session.seq).toBe(seq + 1); // (one edit)
    const check = await ok(hub, "check_city");
    expect([check.in_water.count, check.on_streets.count, check.overlapping.count]).toEqual([0, 0, 0]);
    expect(check.verdict ?? check.advice.join(" ")).toBeTruthy();
    hub.session.undo("user");
    expect((await ok(hub, "get_map_summary")).buildings).toBe(0);
    expect((await tool(hub, "line_streets", { streets: ["nope"] })).isError).toBe(true);
    await hub.close();
  });
});
