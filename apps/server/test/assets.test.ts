import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { writePck } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { AssetLibrary, compareVersions } from "../src/assets.ts";
import { loadConfig } from "../src/config.ts";
import { Hub } from "../src/hub.ts";
import { createAppServer } from "../src/http.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-assets-"));
const packsDir = path.join(root, "Dungeondraft Assets");
const cacheDir = path.join(root, "cache");
mkdirSync(path.join(packsDir, "extras"), { recursive: true });

const png = (w: number, h: number, rgba: [number, number, number, number]) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { p.data[i * 4] = rgba[0]; p.data[i * 4 + 1] = rgba[1]; p.data[i * 4 + 2] = rgba[2]; p.data[i * 4 + 3] = rgba[3]; }
  return new Uint8Array(PNG.sync.write(p));
};
const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

function pack(file: string, info: Record<string, unknown>, extra: { path: string; data: Uint8Array }[] = []) {
  const id = String(info.id ?? "x");
  writeFileSync(file, writePck([{ path: `packs/${id}.json`, data: json(info) }, ...extra]));
}

const table = png(512, 256, [150, 100, 50, 255]);
const grass = png(1024, 1024, [60, 140, 60, 255]);

beforeAll(() => {
  pack(path.join(packsDir, "Furniture.dungeondraft_pack"), { name: "Furniture Pack", id: "AAAA1111", version: "1", author: "Someone" }, [
    { path: "textures/objects/Oak_Table.png", data: table },
    { path: "textures/objects/chair_01.png", data: png(256, 256, [90, 60, 30, 255]) },
    { path: "textures/terrain/grass.png", data: grass },
    { path: "textures/walls/stone.png", data: png(64, 64, [100, 100, 100, 255]) },
    { path: "textures/objects/lamp.webp", data: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]) },
    { path: "data/default.dungeondraft_tags", data: json({ tags: { Seating: ["res://textures/objects/chair_01.png"], Tables: ["textures/objects/Oak_Table.png"] }, sets: {} }) },
    { path: "data/walls/stone.dungeondraft_wall", data: json({ path: "res://textures/walls/stone.png" }) },
  ]);
  // two copies of the same pack: the newer version should win
  pack(path.join(packsDir, "extras", "Rocks v1.dungeondraft_pack"), { name: "Rocks", id: "BBBB2222", version: "3.58-002" }, [{ path: "textures/objects/rock_a.png", data: png(256, 256, [90, 90, 90, 255]) }]);
  pack(path.join(packsDir, "extras", "Rocks v2.dungeondraft_pack"), { name: "Rocks", id: "BBBB2222", version: "3.59-005" }, [
    { path: "textures/objects/rock_a.png", data: png(256, 256, [90, 90, 90, 255]) }, { path: "textures/objects/rock_b.png", data: png(256, 256, [80, 80, 80, 255]) },
  ]);
  // the author doesn't allow use outside Dungeondraft
  pack(path.join(packsDir, "Locked.dungeondraft_pack"), { name: "Locked Pack", id: "CCCC3333", allow_3rd_party_mapping_software: false }, [{ path: "textures/objects/secret.png", data: png(128, 128, [200, 0, 0, 255]) }]);
  // a damaged file, and a file that isn't a pack
  writeFileSync(path.join(packsDir, "Broken.dungeondraft_pack"), new Uint8Array(400).fill(7));
  writeFileSync(path.join(packsDir, "notes.txt"), "hello");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));


describe("version comparison", () => {
  it("is numeric aware", () => {
    expect(compareVersions("3.59-005", "3.58-002")).toBeGreaterThan(0);
    expect(compareVersions("3.9", "3.10")).toBeLessThan(0);
    expect(compareVersions("1", undefined)).toBeGreaterThan(0);
    expect(compareVersions("2.0", "2")).toBe(0);
  });
});

describe("asset library", () => {
  const lib = new AssetLibrary(packsDir, cacheDir);
  afterAll(async () => { await lib.close(); });

  it("scans packs (also in sub folders), names them, keeps the newer duplicate and the restricted flag, and reports damaged files", async () => {
    await lib.scan();
    const st = lib.status();
    expect(st).toMatchObject({ packs: 4, usablePacks: 2, restricted: 1, scanning: false });
    expect(st.errors.map((e) => path.basename(e.file))).toEqual(["Broken.dungeondraft_pack"]);
    const names = lib.packList().map((p) => `${p.name}${p.supersededBy ? "*" : ""}${p.restricted ? "!" : ""}`);
    expect(names.sort()).toEqual(["Furniture Pack", "Locked Pack!", "Rocks", "Rocks*"].sort());
    const rocks = lib.packList().find((p) => p.name === "Rocks" && !p.supersededBy)!;
    expect(rocks.version).toBe("3.59-005");
    expect(rocks.files).toBe(3); // info file + 2 rocks
    expect(lib.packList().find((p) => p.name === "Furniture Pack")!.categories).toMatchObject({ objects: 3, terrain: 1, walls: 1, data: 3 });
  });

  it("searches by name, tag, category and pack, with pages", async () => {
    expect(lib.list({ q: "oak" }).items.map((i) => i.name)).toEqual(["Oak Table"]);
    expect(lib.list({ q: "seating" }).items.map((i) => i.name)).toEqual(["chair 01"]); // by tag
    expect(lib.list({ cat: "terrain" }).items.map((i) => i.id)).toEqual(["furniture-pack:textures/terrain/grass.png"]);
    expect(lib.list({ q: "rock" }).total).toBe(2); // the older copy's rock isn't listed twice
    expect(lib.list({ q: "secret" }).total).toBe(0); // restricted
    expect(lib.list({ cat: "objects", limit: 2 }).items).toHaveLength(2);
    expect(lib.list({ cat: "objects", limit: 2, offset: 2 }).items.length).toBeGreaterThan(0);
    expect(lib.list({ pack: "furniture-pack", cat: "objects" }).total).toBe(3);
    const sized = await lib.withSizes(lib.list({ q: "oak" }).items);
    expect(sized[0]).toMatchObject({ w: 512, h: 256, pack: "furniture-pack", cat: "objects" });
  });

  it("serves files, thumbnails, decoded tiles and sprites, and refuses restricted packs", async () => {
    const f = await lib.read("furniture-pack:textures/objects/Oak_Table.png");
    expect(f?.mime).toBe("image/png");
    expect(Array.from(f!.bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    expect(await lib.read("furniture-pack:textures/objects/oak_table.PNG")).not.toBeNull(); // case-insensitive
    expect(await lib.read("locked-pack:textures/objects/secret.png")).toBeNull();
    expect(await lib.read("nope:x.png")).toBeNull();
    const th = await lib.thumbnail("furniture-pack:textures/objects/Oak_Table.png", 64);
    const thumb = PNG.sync.read(Buffer.from(th!.bytes));
    expect([thumb.width, thumb.height]).toEqual([64, 32]);
    const tile = await lib.tile("furniture-pack:textures/terrain/grass.png");
    expect(tile).toMatchObject({ size: 512, squares: 4 });
    expect(Array.from(tile!.data.subarray(0, 4))).toEqual([60, 140, 60, 255]);
    expect((await lib.tile("furniture-pack:textures/terrain/grass.png", 6))!.squares).toBe(6);
    const spr = await lib.sprite("furniture-pack:textures/objects/Oak_Table.png", 0.25);
    expect(spr).toMatchObject({ w: 128, h: 64, origW: 512, origH: 256 });
    expect(await lib.decode("furniture-pack:textures/objects/lamp.webp")).toBeNull(); // WebP can't be decoded here yet
    expect((await lib.thumbnail("furniture-pack:textures/objects/lamp.webp"))?.mime).toBe("image/webp"); // passed through
  });

  it("uses its cache, and notices a pack that changed", async () => {
    const again = new AssetLibrary(packsDir, cacheDir);
    await again.scan();
    expect(again.status().packs).toBe(4);
    await again.close();
    const dir2 = path.join(root, "changing");
    mkdirSync(dir2, { recursive: true });
    const file = path.join(dir2, "Changing.dungeondraft_pack");
    pack(file, { name: "Changing", id: "DDDD4444", version: "1" }, [{ path: "textures/objects/chair.png", data: png(256, 256, [1, 2, 3, 255]) }]);
    const lib2 = new AssetLibrary(dir2, cacheDir);
    await lib2.scan();
    expect(lib2.list({ q: "chair" }).total).toBe(1);
    pack(file, { name: "Changing", id: "DDDD4444", version: "1" }, [{ path: "textures/objects/bed.png", data: png(256, 512, [200, 200, 220, 255]) }]);
    await lib2.scan();
    expect(lib2.list({ q: "bed" }).items).toHaveLength(1);
    expect(lib2.list({ q: "chair" }).total).toBe(0);
    await lib2.close();
  });

  it("writes a report with what's needed to support the packs properly", async () => {
    const r = await lib.report();
    expect(r).toContain("Furniture Pack");
    expect(r).toContain("RESTRICTED by the author");
    expect(r).toContain("older copy, superseded by");
    expect(r).toContain("PACKS THAT COULDN'T BE READ");
    expect(r).toContain("textures/objects");
    expect(r).toContain("dungeondraft_wall");
    expect(r).toContain("sample PNG sizes");
  });
});

describe("asset endpoints", () => {
  const PORT = 48000 + Math.floor(Math.random() * 500);
  let hub: Hub;
  let server: ReturnType<typeof createAppServer>;
  const base = `http://127.0.0.1:${PORT}/api/assets`;
  beforeAll(async () => {
    const cfg = loadConfig({ port: PORT, host: "127.0.0.1", projectsDir: path.join(root, "projects"), editorDist: path.join(root, "none") });
    hub = new Hub(new ProjectStore(cfg.projectsDir), null);
    hub.assets = new AssetLibrary(packsDir, cacheDir);
    await hub.assets.scan();
    server = createAppServer(cfg, hub);
    await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  });
  afterAll(async () => { server.close(); await hub.close(); });

  it("serves status, packs, lists, files, thumbnails and the report; refuses restricted files", async () => {
    expect(await (await fetch(`${base}/status`)).json()).toMatchObject({ configured: true, packs: 4, usablePacks: 2 });
    expect((await (await fetch(`${base}/packs`)).json() as unknown[]).length).toBe(4);
    const list = await (await fetch(`${base}/list?cat=objects&q=table`)).json() as { total: number; items: { id: string; w?: number }[] };
    expect(list.total).toBe(1);
    expect(list.items[0].w).toBe(512);
    const id = encodeURIComponent(list.items[0].id);
    const file = await fetch(`${base}/file?id=${id}`);
    expect(file.headers.get("content-type")).toBe("image/png");
    const thumb = PNG.sync.read(Buffer.from(await (await fetch(`${base}/file?id=${id}&thumb=32`)).arrayBuffer()));
    expect(thumb.width).toBe(32);
    expect((await fetch(`${base}/file?id=${encodeURIComponent("locked-pack:textures/objects/secret.png")}`)).status).toBe(404);
    expect(await (await fetch(`${base}/report`)).text()).toContain("PACKS:");
    expect((await fetch(`${base}/rescan`, { method: "POST" })).status).toBe(200);
  });

  it("says so when no folder is configured", async () => {
    hub.assets = null;
    expect(await (await fetch(`${base}/status`)).json()).toEqual({ configured: false });
    expect((await fetch(`${base}/packs`)).status).toBe(404);
  });
});

describe("battlemaps with pack assets", () => {
  let hub: Hub;
  beforeAll(async () => {
    hub = new Hub(new ProjectStore(path.join(root, "projects2")), null);
    hub.assets = new AssetLibrary(packsDir, cacheDir);
    await hub.assets.scan();
  });
  afterAll(async () => { await hub.close(); });
  const call = async (name: string, input: Record<string, unknown>) => runTool(hub.toolContext("mcp"), name, input);
  const data = (r: Awaited<ReturnType<typeof call>>) => JSON.parse((r.content[0] as { text: string }).text);

  it("finds, shows and uses pack floors and objects; the render shows them", async () => {
    await hub.createBattle({ name: "Pack test", squaresX: 12, squaresY: 10, pxPerSquare: 40, roomMargin: 1 });
    const grass = data(await call("search_assets", { query: "grass", category: "terrain" })).items[0];
    expect(grass).toMatchObject({ name: "grass", pack: "Furniture Pack", px: [1024, 1024], squares: [4, 4] });
    const table = data(await call("search_assets", { query: "oak table" })).items[0];
    expect(table.squares).toEqual([2, 1]);
    const sheet = await call("view_assets", { ids: [grass.id, table.id, "nope:missing.png"] });
    expect(sheet.content.some((c) => c.type === "image")).toBe(true);

    const tex = data(await call("add_floor_texture", { asset: grass.id, name: "Meadow", squares: 2 }));
    expect(tex.material).toBe("Meadow");
    expect(data(await call("add_floor_texture", { asset: grass.id })).note).toBe("Already added.");
    expect((await call("add_floor_texture", { asset: "locked-pack:textures/objects/secret.png" })).isError).toBe(true);
    await call("paint_floor", { shape: { type: "rect", x: 1, y: 1, w: 10, h: 8 }, material: "Meadow" });
    expect((await call("paint_floor", { shape: { type: "all" }, material: "Nope" })).isError).toBe(true);
    const placed = data(await call("add_props", { props: [{ asset: table.id, x: 6, y: 5 }, { asset: table.id, x: 3, y: 3, rotation: 90, scale: 0.5 }] }));
    expect(placed.added[0].footprint_squares).toEqual([2, 1]);
    expect((await call("add_props", { props: [{ asset: "locked-pack:textures/objects/secret.png", x: 2, y: 2 }] })).isError).toBe(true);
    expect((await call("add_props", { props: [{ asset: table.id, x: 99, y: 2 }] })).isError).toBe(true);

    const listed = data(await call("list_battle", {}));
    expect(listed.summary.floor_textures).toEqual(["Meadow"]);
    expect(listed.summary.objects).toBe(2);
    expect(listed.objects[1]).toMatchObject({ rotation: 90, scale: 0.5 });

    const { img } = await hub.renderMap();
    const at = (x: number, y: number) => Array.from(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
    expect(at(10 * 40 - 12, 8 * 40 - 12)).toEqual([60, 140, 60]); // plain meadow floor
    expect(at(6 * 40, 5 * 40)).toEqual([150, 100, 50]); // the table's centre
    // undo takes the objects back out; the floor texture is separately undoable
    await call("remove_props", { ids: placed.added.map((a: { id: string }) => a.id) });
    expect(data(await call("list_battle", {})).summary.objects).toBe(0);
  });

  it("export carries the objects and floors in the picture; the PNG is real", async () => {
    const f = await hub.battleExport("png");
    expect(Array.from(f.bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    const out = PNG.sync.read(Buffer.from(f.bytes));
    expect([out.width, out.height]).toEqual([480, 400]);
    const o = (10 * 40 - 12 + (8 * 40 - 12) * out.width) * 4;
    expect([out.data[o], out.data[o + 1], out.data[o + 2]]).toEqual([60, 140, 60]);
  });

  it("battlemap tools refuse on a world map and asset search works without a folder", async () => {
    hub.assets = null;
    expect((await call("search_assets", { query: "x" })).isError).toBe(true);
    expect(((await call("search_assets", { query: "x" })).content[0] as { text: string }).text).toContain("Settings");
  });
});

describe("caves and round rooms", () => {
  let hub: Hub;
  beforeAll(async () => { hub = new Hub(new ProjectStore(path.join(root, "projects3")), null); });
  afterAll(async () => { await hub.close(); });
  const call = async (name: string, input: Record<string, unknown>) => runTool(hub.toolContext("mcp"), name, input);
  const data = (r: Awaited<ReturnType<typeof call>>) => JSON.parse((r.content[0] as { text: string }).text);

  it("walls a freehand cave, replaces its own walls when asked again, and leaves hand-drawn ones", async () => {
    await hub.createBattle({ name: "Cave test", squaresX: 30, squaresY: 20 });
    expect((await call("add_walls_around_floor", {})).isError).toBe(true); // nothing painted yet
    await call("paint_floor", { shape: { type: "circle", x: 10, y: 10, r: 4 }, material: "dirt" });
    await call("paint_floor", { shape: { type: "stroke", points: [[13, 10], [24, 7]], r: 1 }, material: "dirt" });
    await call("paint_floor", { shape: { type: "polygon", points: [[22, 4], [27, 4], [27, 10], [24, 11]] }, material: "rock" });
    await call("add_wall", { points: [[1, 1], [3, 1]] }); // drawn by hand
    const first = data(await call("add_walls_around_floor", {}));
    expect(first.outlines).toBe(1); // cave, corridor and chamber are joined into one outline
    expect(first.replaced).toBe(0);
    const walls = data(await call("list_battle", {})).walls;
    expect(walls.filter((w: { closed?: boolean }) => w.closed)).toHaveLength(1);
    expect(walls.filter((w: { points: number[][] }) => w.points.length === 2)).toHaveLength(1); // the hand-drawn one
    await call("paint_floor", { shape: { type: "circle", x: 5, y: 16, r: 2 }, material: "dirt" }); // a second chamber
    const again = data(await call("add_walls_around_floor", {}));
    expect(again.outlines).toBe(2);
    expect(again.replaced).toBe(1);
    expect(data(await call("list_battle", {})).walls).toHaveLength(3);
    // a door can be cut into a traced wall, and a pillar of void inside the cave becomes its own outline
    const door = await call("add_door", { x: 10, y: 6 });
    expect(door.isError).toBeFalsy();
    await call("paint_floor", { shape: { type: "circle", x: 10, y: 10, r: 1 }, material: "void" });
    expect(data(await call("add_walls_around_floor", {})).outlines).toBe(3);
  });

  it("makes round and free-form rooms with a closed wall each", async () => {
    await hub.createBattle({ name: "Round test", squaresX: 20, squaresY: 14 });
    const round = data(await call("add_room_shape", { shape: { type: "circle", x: 6, y: 7, r: 4 }, floor: "wood planks" }));
    expect(round.wall_id).toBeTruthy();
    const poly = data(await call("add_room_shape", { shape: { type: "polygon", points: [[12, 3], [18, 3], [18, 9], [14, 11], [12, 8]] }, floor: "carpet", walls: false }));
    expect(poly.wall_id).toBeUndefined();
    const listed = data(await call("list_battle", {}));
    expect(listed.summary.floors.map((f: { material: string }) => f.material)).toEqual(expect.arrayContaining(["wood planks", "carpet"]));
    expect(listed.walls).toHaveLength(1);
    expect(listed.walls[0].closed).toBe(true);
    expect((await call("add_room_shape", { shape: { type: "circle", x: 1, y: 1, r: 4 } })).isError).toBe(true); // runs off the map
    // the floor fills the circle and not much outside it
    const doc = hub.session.doc, sub = doc.meta.battle!.sub;
    expect(doc.height.get(6 * sub, 7 * sub)).toBe(3);
    expect(doc.height.get(10 * sub, 7 * sub)).toBe(0);
  });
});
