/** A city's land, climate and trees, through Claude's tools and the hub: shaped, read back, drawn, undone, saved and kept off other kinds of map. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { citySpec, landGrid, renderCity } from "@mapmaker/core";
import { encodeJpeg, runTool } from "@mapmaker/tools";
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
    // (the mean of a small patch: the ground's texture noise is seeded from the map's random id, and a single pixel could land on a dark speck; found 2026-11-23)
    const lum = (x: number, y: number) => {
      let t = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const o = ((y + dy) * after.w + x + dx) * 4; t += after.data[o] + after.data[o + 1] + after.data[o + 2]; }
      return t / 81;
    };
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

describe("a city started from a world map", () => {
  it("takes the spot's climate, height, coast and the way back; refuses the sea; names itself after a place clicked", async () => {
    const { hub } = fresh();
    await hub.createProject({ name: "World", width: 256, height: 256, kmPerPx: 2 });
    hub.session.execute({ op: "generate_terrain", params: { template: "archipelago", seed: 7, landFraction: 0.35, mountains: 0.4 } }, "system");
    const w = hub.session.doc, sea = w.meta.seaLevel;
    // a land pixel beside the sea, and a sea pixel
    let coast: [number, number] | null = null, water: [number, number] | null = null;
    for (let y = 2; y < 254 && !coast; y++) for (let x = 2; x < 254; x++) {
      const land = w.height.get(x, y) > sea + 20;
      if (!water && w.height.get(x, y) < sea - 50) water = [x, y];
      if (land && (w.height.get(x + 1, y) <= sea || w.height.get(x - 1, y) <= sea || w.height.get(x, y + 1) <= sea || w.height.get(x, y - 1) <= sea)) { coast = [x, y]; break; }
    }
    expect(coast && water).toBeTruthy();
    const atSea = await tool(hub, "create_city_here", { x: water![0], y: water![1] });
    expect(atSea.isError).toBe(true);
    expect(textOf(atSea)).toMatch(/sea/);
    await ok(hub, "add_place", { name: "Test Port", type: "port", x: coast![0], y: coast![1] });
    const r = await ok(hub, "create_city_here", { place: "Test Port" });
    expect(r.created.name).toBe("Test Port");
    expect(r.created.from_world.join(" ")).toMatch(/coast/);
    const city = hub.session.doc, sp = citySpec(city);
    expect([sp.widthM, sp.heightM]).toEqual([1000, 700]);
    expect(sp.climate?.temperature).toBeGreaterThan(0);
    expect(city.meta.origin).toMatchObject({ id: "world", name: "World", x: coast![0], y: coast![1] });
    let wet = 0;
    for (const v of city.height.data) if (v === 7 || v === 8) wet++;
    expect(wet).toBeGreaterThan(city.height.data.length * 0.1); // (the sea along one side)
    // from a city map it is refused: it needs a world map
    expect(textOf(await tool(hub, "create_city_here", { x: 10, y: 10 }))).toMatch(/world map/i);
    await hub.close();
  });
});

describe("city walls through Claude's tools", () => {
  it("adds a ring with towers, gets gates where the streets cross, changes, lists, checks, draws, undoes and removes it", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Wall Town", width_m: 400, height_m: 300 });
    const road = await ok(hub, "add_streets", { streets: [{ points: [[0, 150], [400, 150]], kind: "street" }] });
    const added = await ok(hub, "add_city_walls", { walls: [{ points: [[100, 60], [300, 60], [300, 240], [100, 240]], closed: true }] });
    expect(added.walls[0]).toMatchObject({ kind: "stone", ring: true, length_m: 760 });
    expect(added.walls[0].towers).toBeGreaterThan(10);
    expect(added.walls[0].gates).toHaveLength(2);
    expect(added.walls[0].gates.every((g: { street: string; gatehouse?: boolean }) => g.street === road.ids[0] && g.gatehouse)).toBe(true);
    const id = added.walls[0].id;
    // an earth rampart has no towers and plain openings
    const changed = await ok(hub, "update_city_walls", { changes: [{ id, kind: "earth", name: "The Old Dyke" }] });
    expect(changed.walls[0]).toMatchObject({ kind: "earth", name: "The Old Dyke", towers: 0 });
    expect(changed.walls[0].gates.some((g: { gatehouse?: boolean }) => g.gatehouse)).toBe(false);
    expect((await ok(hub, "list_city_walls")).total).toBe(1);
    expect((await ok(hub, "get_map_summary")).walls[0]).toMatchObject({ id, gates: 2 });
    // a second ring no street crosses: the check says so
    await ok(hub, "add_city_walls", { walls: [{ points: [[20, 20], [60, 20], [60, 60]], closed: true, kind: "palisade" }] });
    const check = await ok(hub, "check_city");
    expect(check.walls.rings_without_gate).toHaveLength(1);
    expect(check.advice.join(" ")).toMatch(/no gate/);
    // drawn for Claude
    const look = await tool(hub, "render_city", {});
    expect(look.isError).toBeFalsy();
    // undo and remove
    hub.session.undo("user");
    expect((await ok(hub, "list_city_walls")).total).toBe(1);
    await ok(hub, "remove_city_walls", { ids: [id] });
    expect((await ok(hub, "list_city_walls")).total).toBe(0);
    // bad input is refused with a reason
    expect(textOf(await tool(hub, "add_city_walls", { walls: [{ points: [[0, 0], [900, 0]] }] }))).toMatch(/outside the map/);
    await hub.close();
  });
});

describe("names on a city through Claude's tools", () => {
  it("writes labels in metres, names streets, lists and changes them, shows them in previews and removes them", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Name Town", width_m: 300, height_m: 200 });
    const road = await ok(hub, "add_streets", { streets: [{ points: [[0, 100], [300, 100]], kind: "street" }] });
    await ok(hub, "update_streets", { changes: [{ id: road.ids[0], name: "Long Road" }] });
    const added = await ok(hub, "add_city_labels", { labels: [{ text: "Old Town", x: 100, y: 50 }, { text: "The Mere", x: 200, y: 160, kind: "water", size: 1.5 }, { text: "Lost", x: 900, y: 10 }] });
    expect(added.added.map((l: { text: string; kind: string }) => `${l.text}:${l.kind}`)).toEqual(["Old Town:district", "The Mere:water"]);
    expect(added.skipped[0]).toMatch(/outside the map/);
    const doc = hub.session.doc;
    expect(doc.features!.labels.find((l) => l.text === "The Mere")).toMatchObject({ kind: "sea", x: 200, y: 160, size: 1.5 });
    const list = await ok(hub, "list_city_labels");
    expect(list.labels).toHaveLength(2);
    expect(list.named_streets).toEqual([{ id: road.ids[0], name: "Long Road" }]);
    const id = added.added[0].id;
    expect((await ok(hub, "update_city_labels", { changes: [{ id, kind: "landmark", angle: 20 }] })).changed[0]).toMatchObject({ kind: "landmark", angle: 20 });
    // the preview writes the names (and can leave them out)
    const named = await tool(hub, "render_city", { grid: false }), bare = await tool(hub, "render_city", { grid: false, names: false });
    const img = (r: typeof named) => (r.content as { type: string; data?: string }[]).find((c) => c.type === "image")!.data;
    expect(img(named)).not.toBe(img(bare));
    // the world map's label tools are refused on a city, and these are refused elsewhere
    expect(textOf(await tool(hub, "add_label", { text: "X", x: 1, y: 1, kind: "region" }))).toMatch(/city map/i);
    await ok(hub, "remove_city_labels", { ids: [id] });
    expect((await ok(hub, "list_city_labels")).labels).toHaveLength(1);
    await hub.close();
  });
});

describe("a city's picture", () => {
  it("is drawn fresh after an edit (on the compute thread)", async () => {
    const { hub } = fresh();
    const info = await ok(hub, "create_city", { name: "Picture Town", width_m: 200, height_m: 150 });
    const jpeg = () => hub.mapPicture(info.created.id, 512, (img) => encodeJpeg(img, 88, 16_000_000));
    const before = await jpeg();
    expect(before).toBeTruthy();
    await ok(hub, "add_buildings", { buildings: [{ x: 100, y: 75, w: 30, h: 20 }] });
    const after = await jpeg();
    expect(Buffer.from(after!).equals(Buffer.from(before!))).toBe(false);
    await hub.close();
  });
});

describe("a battlemap from a part of a city", () => {
  it("carries the ground, streets, buildings (walls, a door, roofs) and walls over, remembers the city, and refuses a box too big", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Scene Town", width_m: 400, height_m: 300 });
    const road = await ok(hub, "add_streets", { streets: [{ points: [[0, 150], [400, 150]], kind: "street" }] });
    await ok(hub, "add_buildings", { buildings: [{ x: 60, y: 140, w: 10, h: 8, roof: "thatch", kind: "tavern" }, { x: 60, y: 165, w: 12, h: 8, kind: "temple" }, { x: 99, y: 175, w: 10, h: 8 }] });
    await ok(hub, "add_city_walls", { walls: [{ points: [[90, 100], [90, 200]] }] });
    expect(textOf(await tool(hub, "create_battlemap_from_city", { x: 0, y: 0, w: 300, h: 300 }))).toMatch(/make the box smaller/);
    const made = await ok(hub, "create_battlemap_from_city", { x: 40, y: 125, w: 60, h: 60, name: "Tavern Brawl" });
    expect(made.created.description).toMatch(/3 buildings/);
    const doc = hub.session.doc;
    expect(doc.meta.kind).toBe("battle");
    expect(doc.meta.battle).toMatchObject({ squaresX: 39, squaresY: 39, feetPerSquare: 5 });
    expect(doc.meta.origin).toMatchObject({ name: "Scene Town", unit: "m", x: 70, y: 155 });
    const f = doc.features!;
    expect(f.roofs).toHaveLength(2); // (the two buildings wholly inside the box; the one cut by its edge gets walls only)
    expect(f.roofs!.find((r) => r.style === "thatch")).toBeTruthy();
    expect(f.walls!.filter((w) => w.kind === "door").length).toBeGreaterThanOrEqual(2);
    expect(f.walls!.filter((w) => w.kind === "wall").length).toBeGreaterThan(6);
    // the floor: cobbles on the street, planks in the tavern, flagstones in the temple, grass elsewhere
    const b = doc.meta.battle!, m = 5 * 0.3048, at = (x: number, y: number) => doc.height.data[Math.floor(((y - 125) / m) * b.sub) * doc.height.w + Math.floor(((x - 40) / m) * b.sub)];
    expect(at(80, 150)).toBe(2);
    expect(at(60, 140)).toBe(3);
    expect(at(60, 165)).toBe(1);
    expect(at(50, 180)).toBe(5);
    void road;
    await hub.close();
  });
});

describe("districts on a city through Claude's tools", () => {
  it("outlines a district with a name and colour, counts what is in it, changes, shows and removes it", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Ward Town", width_m: 300, height_m: 200 });
    await ok(hub, "add_buildings", { buildings: [{ x: 50, y: 50, w: 10, h: 8 }, { x: 70, y: 60, w: 10, h: 8 }, { x: 250, y: 150, w: 10, h: 8 }] });
    const bare = await tool(hub, "render_city", { grid: false });
    const added = await ok(hub, "add_city_districts", { districts: [{ points: [[20, 20], [120, 20], [120, 100], [20, 100]], name: "The Old Ward" }] });
    expect(added.added[0]).toMatchObject({ name: "The Old Ward", buildings: 2, hectares: 0.8 });
    const id = added.added[0].id;
    const changed = await ok(hub, "update_city_districts", { changes: [{ id, colour: "#336699" }] });
    expect(changed.changed[0]).toMatchObject({ colour: "#336699", name: "The Old Ward" });
    const shown = await tool(hub, "render_city", { grid: false });
    const img = (r: typeof shown) => (r.content as { type: string; data?: string }[]).find((c) => c.type === "image")!.data;
    expect(img(shown)).not.toBe(img(bare));
    expect((await ok(hub, "list_city_districts")).districts).toHaveLength(1);
    await ok(hub, "remove_city_districts", { ids: [id] });
    expect((await ok(hub, "list_city_districts")).total).toBe(0);
    await hub.close();
  });
});

describe("a battlemap from a spot of a city, as on the world map", () => {
  it("makes 30 x 20 squares round the spot, held inside the city, or the size asked for", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Spot Town", width_m: 300, height_m: 200 });
    await ok(hub, "create_battlemap_from_city", { x: 150, y: 100 });
    expect(hub.session.doc.meta.battle).toMatchObject({ squaresX: 30, squaresY: 20 });
    expect(hub.session.doc.meta.origin).toMatchObject({ x: 150, y: 100, unit: "m" });
    await ok(hub, "open_project", { id: "spot-town" });
    await ok(hub, "create_battlemap_from_city", { x: 5, y: 5, squares_x: 24, squares_y: 16, name: "Corner" });
    expect(hub.session.doc.meta.battle).toMatchObject({ squaresX: 24, squaresY: 16 });
    expect(hub.session.doc.meta.origin!.x).toBeCloseTo((24 * 1.524) / 2, 0); // (moved in so the box stays inside the city)
    await hub.close();
  });
});
