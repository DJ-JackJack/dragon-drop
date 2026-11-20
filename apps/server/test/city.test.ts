/** City maps: made through the hub, built with Claude's tools, saved in their own file format, and kept apart from world maps and battlemaps. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type ServerMsg, MATERIALS, citySpec, formatOf, isCity } from "@mapmaker/core";
import { decodeImage, encodeJpeg, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-city-"));
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

describe("making and saving a city", () => {
  it("create_city makes a city map, opens it, and writes it in format 2 while other maps stay in format 1", async () => {
    const { hub, dir } = fresh();
    const made = await ok(hub, "create_city", { name: "Test Town", width_m: 800, height_m: 500 });
    expect(made.created).toMatchObject({ id: "test-town", kind: "city" });
    expect(isCity(hub.session.doc)).toBe(true);
    expect(citySpec(hub.session.doc)).toEqual({ widthM: 800, heightM: 500, cellM: 1 });
    expect(made.summary).toMatchObject({ kind: "city map", size_metres: [800, 500], buildings: 0, streets: 0 });
    await hub.flush();
    const meta = JSON.parse(readFileSync(path.join(dir, "test-town", "project.json"), "utf8")) as { formatVersion: number; kind: string };
    expect(meta).toMatchObject({ kind: "city", formatVersion: 2 });
    expect(formatOf(meta)).toBeGreaterThan(1); // (a Dragon Drop from before city maps refuses any map in a newer format than its own: it will refuse this)
    await hub.createProject({ name: "World", width: 64, height: 64, kmPerPx: 2 });
    await hub.flush();
    expect(JSON.parse(readFileSync(path.join(dir, "world", "project.json"), "utf8")).formatVersion).toBe(1); // (unchanged: no reason to lock it away from older versions)
    await hub.createBattle({ name: "Room", squaresX: 10, squaresY: 8 });
    await hub.flush();
    expect(JSON.parse(readFileSync(path.join(dir, "room", "project.json"), "utf8")).formatVersion).toBe(1);
    await hub.close();
  });

  it("reopens with its buildings, streets and ground, and lists as a city", async () => {
    const { hub, dir } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    await ok(hub, "paint_ground", { shape: { type: "rect", x: 200, y: 0, w: 100, h: 200 }, material: "deep water" });
    await ok(hub, "add_streets", { streets: [{ points: [[10, 100], [190, 100]], kind: "street", name: "High Street" }] });
    await ok(hub, "add_buildings", { buildings: [{ x: 50, y: 80, w: 8, h: 10, roof: "tile" }, { x: 50, y: 120, w: 8, h: 10, roof: "thatch", kind: "house" }] });
    await hub.flush();
    await hub.close();
    const again = new Hub(new ProjectStore(dir), null);
    await again.openProject("town");
    const d = again.session.doc;
    expect(d.features?.buildings).toHaveLength(2);
    expect(d.features?.streets?.[0]).toMatchObject({ name: "High Street", width: 7, kind: "street" });
    expect(d.height.data[100 * 300 + 250]).toBe(MATERIALS.find((m) => m.name === "deep water")!.id);
    expect(d.height.data[100 * 300 + 50]).toBe(5);
    expect((await new ProjectStore(dir).list()).find((p) => p.id === "town")?.kind).toBe("city");
    await again.close();
  });

  it("refuses sizes it can't hold, with a reason", async () => {
    const { hub } = fresh();
    expect(textOf(await tool(hub, "create_city", { name: "Huge", width_m: 9000, height_m: 400 }))).toMatch(/Invalid input|at most 6000/);
    await expect(hub.createCity({ name: "Tiny", widthM: 10, heightM: 400 })).rejects.toThrow(/at least 50/);
    await expect(hub.createCity({ name: "Dense", widthM: 6000, heightM: 6000, cellM: 0.5 })).rejects.toThrow(/ground cells/);
    await hub.close();
  });
});

describe("the file format of a city", () => {
  it("is refused by a program that doesn't know city maps, and opens fine for this one", async () => {
    const { hub, dir } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    await hub.flush();
    await hub.close();
    // the rule an older program applies, written out: it refuses any map whose format is newer than its own (1)
    const file = path.join(dir, "town", "project.json");
    const meta = JSON.parse(readFileSync(file, "utf8"));
    expect(formatOf(meta)).toBeGreaterThan(1);
    // this program opens it (kind city, format 2)
    expect((await new ProjectStore(dir).load("town")).meta).toMatchObject({ kind: "city", formatVersion: 2 });
    // a city file with no format stamp at all (edited by hand) still counts as a city: format 2, and is stamped when saved
    delete meta.formatVersion;
    writeFileSync(file, JSON.stringify(meta));
    const store = new ProjectStore(dir);
    const back = await store.load("town");
    expect(back.meta.formatVersion).toBe(2);
    await store.save(back);
    expect(JSON.parse(readFileSync(file, "utf8")).formatVersion).toBe(2);
    // a city saved by a program whose own format is newer is refused by this one
    writeFileSync(file, JSON.stringify({ ...meta, formatVersion: 9 }));
    await expect(new ProjectStore(dir).load("town")).rejects.toThrow(/newer|update/i);
    // and a program whose ordinary format is 3 writes a city in 3 too
    writeFileSync(file, JSON.stringify({ ...meta, formatVersion: 3 }));
    const v3 = new ProjectStore(dir, { format: 3, migrations: {} });
    const c3 = await v3.load("town");
    await v3.save(c3);
    expect(JSON.parse(readFileSync(file, "utf8")).formatVersion).toBe(3);
  });

  it("gives the phone page a picture of the city", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    await ok(hub, "add_buildings", { buildings: [{ x: 100, y: 100, w: 30, h: 20, colour: "#cc2222" }] });
    const jpg = await hub.renderJpeg("town", 600, (img) => encodeJpeg(img));
    const img = decodeImage(jpg!)!;
    expect([img.w, img.h]).toEqual([600, 400]);
    await hub.close();
  });
});

describe("building a city with Claude's tools", () => {
  it("adds buildings in one batch (one undo step), skips bad ones and says why, and lists them", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    const seq0 = hub.session.seq;
    const r = await ok(hub, "add_buildings", {
      buildings: [
        { x: 40, y: 40, w: 6, h: 8, angle: 15, roof: "slate", kind: "house" },
        { x: 60, y: 40, w: 12, h: 15, roof: "tile", kind: "tavern", name: "The Fox" },
        { points: [[100, 100], [120, 100], [120, 110], [110, 110], [110, 120], [100, 120]], roof: "thatch" }, // (an L)
        { x: 500, y: 40, w: 6, h: 8 }, // off the map
        { x: 70, y: 70 }, // no size
      ],
    });
    expect(r).toMatchObject({ added: 3, skipped: 2 });
    expect(r.errors.join(" ")).toMatch(/outside the map/);
    expect(r.errors.join(" ")).toMatch(/give x, y, w and h/);
    expect(hub.session.seq).toBe(seq0 + 1); // one edit
    expect(hub.session.doc.features!.buildings).toHaveLength(3);
    hub.session.undo("user");
    expect(hub.session.doc.features!.buildings).toHaveLength(0);
    hub.session.redo("user");
    const list = await ok(hub, "list_buildings", { kind: "tavern" });
    expect(list).toMatchObject({ matching: 1 });
    expect(list.buildings[0]).toMatchObject({ name: "The Fox", kind: "tavern", roof: "tile", size: [12, 15] });
    expect((await ok(hub, "list_buildings", { region: { x: 0, y: 0, w: 80, h: 80 } })).matching).toBe(2);
    expect((await ok(hub, "list_buildings", { limit: 1 })).buildings).toHaveLength(1);
    await hub.close();
  });

  it("changes and removes buildings by id or by region, and adds streets", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    await ok(hub, "add_buildings", { buildings: Array.from({ length: 6 }, (_, i) => ({ x: 20 + i * 30, y: 50, w: 8, h: 8 })) });
    const ids = hub.session.doc.features!.buildings!.map((b) => b.id);
    expect(await ok(hub, "update_buildings", { ids: ids.slice(0, 3), roof: "tile", colour: "#aa3322", kind: "shop" })).toMatchObject({ changed: 3 });
    const b0 = hub.session.doc.features!.buildings![0];
    expect(b0).toMatchObject({ roof: "tile", colour: "#aa3322", kind: "shop" });
    await ok(hub, "update_buildings", { ids: [ids[0]], colour: "", name: "Shop One" });
    expect(hub.session.doc.features!.buildings![0]).toMatchObject({ name: "Shop One" });
    expect(hub.session.doc.features!.buildings![0].colour).toBeUndefined();
    expect(textOf(await tool(hub, "update_buildings", { ids: ids.slice(0, 2), name: "Both" }))).toMatch(/one building at a time/);
    expect(await ok(hub, "remove_buildings", { region: { x: 0, y: 0, w: 100, h: 100 } })).toMatchObject({ removed: 3 }); // (centres at x = 20, 50, 80)
    expect(await ok(hub, "remove_buildings", { ids: [ids[5], "nope"] })).toMatchObject({ removed: 1 });
    expect(hub.session.doc.features!.buildings).toHaveLength(2);
    expect((await tool(hub, "remove_buildings", {})).isError).toBe(true);
    const s = await ok(hub, "add_streets", { streets: [{ points: [[0, 100], [300, 100]], kind: "avenue" }, { points: [[150, 0], [150, 200]], width: 3 }, { points: [[0, 0]] }] }).catch((e) => e);
    expect(String(s)).toMatch(/Invalid input/); // (a street with one point is refused whole, by the tool's own schema)
    const s2 = await ok(hub, "add_streets", { streets: [{ points: [[0, 100], [300, 100]], kind: "avenue" }, { points: [[150, 0], [150, 200]], width: 3 }] });
    expect(s2.added).toBe(2);
    expect((await ok(hub, "list_streets")).streets.map((x: { width: number }) => x.width)).toEqual([12, 3]);
    expect(await ok(hub, "remove_streets", { ids: [s2.ids[0]] })).toMatchObject({ removed: 1 });
    await hub.close();
  });

  it("paints the ground in metres, refusing a material it doesn't have", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 }); // 1 m cells
    await ok(hub, "paint_ground", { shape: { type: "circle", x: 100, y: 100, r: 20 }, material: "cobblestone" });
    const cobble = MATERIALS.find((m) => m.name === "cobblestone")!.id;
    expect(hub.session.doc.height.data[100 * 300 + 100]).toBe(cobble);
    expect(hub.session.doc.height.data[100 * 300 + 140]).toBe(5);
    expect(textOf(await tool(hub, "paint_ground", { shape: { type: "all" }, material: "void" }))).toMatch(/Unknown ground/);
    expect(textOf(await tool(hub, "paint_ground", { shape: { type: "all" }, material: "lava!" }))).toMatch(/Unknown ground/);
    await hub.close();
  });

  it("renders the city as a picture, with a grid, and with the trace picture when asked", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    await ok(hub, "add_buildings", { buildings: [{ x: 100, y: 100, w: 30, h: 20, roof: "tile", colour: "#cc2222" }] });
    const r = await tool(hub, "render_city", { max_size: 600 });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/City 300 x 200 m, whole city; image 600x400, grid every .* m \(numbers are metres\)\. 1 buildings/);
    const img = (r.content as { type: string; data?: string }[]).find((c) => c.type === "image")!;
    const jpg = decodeImage(new Uint8Array(Buffer.from(img.data!, "base64")))!;
    expect([jpg.w, jpg.h]).toEqual([600, 400]);
    const at = (x: number, y: number) => (y * jpg.w + x) * 4; // (2 px per metre)
    expect(jpg.data[at(200, 200)]).toBeGreaterThan(jpg.data[at(200, 200) + 1] + 40); // the red roof
    const part = await tool(hub, "render_city", { region: { x: 90, y: 90, w: 20, h: 20 }, max_size: 400, grid: false });
    expect(textOf(part)).toMatch(/region x90 y90 20x20 m; image 400x400\./);
    expect(textOf(await tool(hub, "render_city", { trace: true, max_size: 300 }))).toMatch(/no trace picture to draw/);
    await hub.close();
  });
});

describe("a city is its own kind of map", () => {
  it("keeps world-map and battlemap tools off a city, and city tools off the others, with a message that says what to use", async () => {
    const { hub } = fresh();
    await hub.createProject({ name: "World", width: 64, height: 64, kmPerPx: 2 });
    for (const name of ["add_buildings", "render_city", "paint_ground", "list_streets"]) expect(textOf(await tool(hub, name, name === "paint_ground" ? { shape: { type: "all" }, material: "grass" } : {}))).toMatch(/is for city maps.*world map/);
    await hub.createBattle({ name: "Room", squaresX: 10, squaresY: 8 });
    expect(textOf(await tool(hub, "add_streets", { streets: [{ points: [[0, 0], [5, 5]] }] }))).toMatch(/is for city maps.*a battlemap/);
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    for (const [name, input] of [["render_preview", {}], ["add_landmass", { shape: { type: "all" } }], ["render_battlemap", {}], ["add_room", { x: 1, y: 1, w: 3, h: 3 }], ["add_place", { name: "X", type: "town", x: 1, y: 1 }], ["generate_terrain", {}]] as [string, Record<string, unknown>][]) {
      const r = await tool(hub, name, input);
      expect(r.isError, name).toBe(true);
      expect(textOf(r), name).toMatch(/isn't available on a city map/);
    }
    // what is not tied to one kind still works
    expect((await tool(hub, "get_map_summary")).isError).toBeFalsy();
    expect((await tool(hub, "list_references")).isError).toBeFalsy();
    expect(textOf(await tool(hub, "get_trace_picture"))).toMatch(/no trace picture/);
    await hub.close();
  });

  it("has no selection or lock, no climate work, and the other kinds of 'make a map from this' refuse it", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    hub.setSelection({ kind: "point", x: 5, y: 5 }, true);
    expect((hub as unknown as { selection: unknown }).selection).toBeNull();
    await expect(hub.createRegional({ name: "Detail", rect: { x: 0, y: 0, w: 20, h: 20 } })).rejects.toThrow(/Only a world map/);
    await expect(hub.createBattleFromWorld({ name: "Here", x: 10, y: 10 })).rejects.toThrow(/Open a world map first/);
    await hub.close();
  });

  it("sends the editor the city's meta, features and ground when it connects", async () => {
    const { hub } = fresh();
    await ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
    await ok(hub, "add_buildings", { buildings: [{ x: 50, y: 50, w: 8, h: 8 }] });
    const sent: (string | Buffer)[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (d: string | Buffer) => sent.push(d), on() {}, close() {} } as never;
    await hub.addClient(ws, {});
    const project = sent.map((m) => (typeof m === "string" ? (JSON.parse(m) as ServerMsg) : null)).find((m) => m?.t === "project") as Extract<ServerMsg, { t: "project" }>;
    expect(project.meta.kind).toBe("city");
    expect(project.meta.city).toEqual({ widthM: 300, heightM: 200, cellM: 1 });
    expect(project.features.buildings).toHaveLength(1);
    expect(sent.some((m) => typeof m !== "string")).toBe(true); // (the ground, as a binary frame)
    await hub.close();
  });
});
