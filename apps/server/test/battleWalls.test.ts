/** What battlemap walls are built of: a built-in look, or a picture from the asset packs, through Claude's tools and into the pictures the server draws. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { insertDoor, renderBattle, roomWalls } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { AssetLibrary } from "../src/assets.ts";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-walls-"));
const lib = path.join(root, "Library");
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeAll(() => {
  // a long wall strip, bright blue: easy to find in a picture
  const p = new PNG({ width: 640, height: 64 });
  for (let i = 0; i < 640 * 64; i++) p.data.set([30, 60, 230, 255], i * 4);
  mkdirSync(path.join(lib, "Castle Kit", "Walls"), { recursive: true });
  writeFileSync(path.join(lib, "Castle Kit", "Walls", "Blue_Stone_Wall.png"), PNG.sync.write(p));
  // a door picture, green, four times as wide as it is deep
  const d = new PNG({ width: 256, height: 64 });
  for (let i = 0; i < 256 * 64; i++) d.data.set([40, 200, 60, 255], i * 4);
  mkdirSync(path.join(lib, "Castle Kit", "Doors"), { recursive: true });
  writeFileSync(path.join(lib, "Castle Kit", "Doors", "Oak_Door.png"), PNG.sync.write(d));
  // a road strip, orange
  const r = new PNG({ width: 512, height: 128 });
  for (let i = 0; i < 512 * 128; i++) r.data.set([230, 140, 30, 255], i * 4);
  mkdirSync(path.join(lib, "Castle Kit", "Roads"), { recursive: true });
  writeFileSync(path.join(lib, "Castle Kit", "Roads", "Dirt_Road.png"), PNG.sync.write(r));
  // a light picture (a soft white glow) and a repeating pattern
  const g = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const v = Math.max(0, 255 - Math.hypot(x - 32, y - 32) * 8); g.data.set([v, v, v, 255], (y * 64 + x) * 4); }
  mkdirSync(path.join(lib, "Castle Kit", "Lights"), { recursive: true });
  writeFileSync(path.join(lib, "Castle Kit", "Lights", "Soft_Glow.png"), PNG.sync.write(g));
  const t = new PNG({ width: 128, height: 128 });
  for (let i = 0; i < 128 * 128; i++) t.data.set([180, 160, 120, 255], i * 4);
  mkdirSync(path.join(lib, "Castle Kit", "Patterns"), { recursive: true });
  writeFileSync(path.join(lib, "Castle Kit", "Patterns", "Herringbone.png"), PNG.sync.write(t));
});

let n = 0;
const fresh = async (withLibrary = true) => {
  const dir = path.join(root, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  const hub = new Hub(new ProjectStore(dir), null);
  if (withLibrary) { hub.assets = new AssetLibrary(lib, path.join(root, "cache")); await hub.assets.scan(); }
  await runTool(hub.toolContext("mcp"), "create_battlemap", { name: "Keep", squares_x: 12, squares_y: 10 });
  return hub;
};
const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await tool(hub, name, input);
  if (r.isError) throw new Error(`${name}: ${textOf(r)}`);
  return JSON.parse(textOf(r));
};
const walls = (hub: Hub) => hub.session.doc.features!.walls ?? [];

describe("what walls are built of", () => {
  it("keeps a wall's look when a room is built and when a door is cut into it", () => {
    const style = { look: "brick" as const };
    const room = roomWalls("r", 1, 1, 4, 3, [{ side: "top", offset: 1, kind: "window" }], style);
    expect(room.every((w) => w.look === "brick")).toBe(true);
    let id = 0;
    const cut = insertDoor([{ id: "w", kind: "wall", points: [[0, 5], [8, 5]], look: "wood", asset: "kit:Walls/x.png", tile: 2 }], 4, 5, 1, "door", () => `n${id++}`)!;
    expect(cut.add.map((w) => [w.kind, w.look, w.asset, w.tile])).toEqual([["wall", "wood", "kit:Walls/x.png", 2], ["wall", "wood", "kit:Walls/x.png", 2], ["door", "wood", "kit:Walls/x.png", 2]]);
    // a plain wall stays plain: no look written into it
    expect(roomWalls("p", 1, 1, 2, 2, []).every((w) => !("look" in w) && !("asset" in w))).toBe(true);
  });

  it("lets Claude build walls of a look or a pack picture, and change them", async () => {
    const hub = await fresh();
    await ok(hub, "add_room", { x: 1, y: 1, w: 4, h: 3, wall_look: "plaster" });
    expect(walls(hub).every((w) => w.look === "plaster")).toBe(true);
    const found = await ok(hub, "search_assets", { query: "wall", category: "walls" });
    const asset = found.items[0].id;
    expect(asset).toBeTruthy();
    await ok(hub, "add_wall", { points: [[7, 1], [7, 8]], wall_asset: asset });
    expect(walls(hub).find((w) => w.points[0][0] === 7)?.asset).toBe(asset);
    // a picture that isn't in the library is refused, with what to do
    const bad = await tool(hub, "add_wall", { points: [[8, 1], [8, 8]], wall_asset: "nope:Walls/none.png" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/search_assets/);
    // every wall at once, then by id; and a picture taken off again
    const all = await ok(hub, "set_wall_look", { wall_look: "rock" });
    expect(all.walls).toBe(walls(hub).length);
    expect(walls(hub).every((w) => w.look === "rock")).toBe(true);
    const one = walls(hub).find((w) => w.asset)!;
    await ok(hub, "set_wall_look", { ids: [one.id], wall_asset: null });
    expect(walls(hub).find((w) => w.id === one.id)).not.toHaveProperty("asset");
    const listed = await ok(hub, "list_battle");
    expect(listed.walls.some((w: { look?: string }) => w.look === "rock")).toBe(true);
    // without a library, a picture can't be given
    const bare = await fresh(false);
    const none = await tool(bare, "add_room", { x: 1, y: 1, w: 3, h: 3, wall_asset: asset });
    expect(none.isError).toBe(true);
    expect(textOf(none)).toMatch(/wall_look/);
  });

  it("lets Claude give doors and windows a picture from the packs, and take it off again", async () => {
    const hub = await fresh();
    const door = (await ok(hub, "search_assets", { query: "door", category: "portals" })).items[0].id;
    await ok(hub, "add_room", { x: 1, y: 1, w: 4, h: 3, doors: [{ side: "top", offset: 1, picture: door }, { side: "left", offset: 1, kind: "secret", picture: door }] });
    expect(walls(hub).find((w) => w.kind === "door")?.portal).toBe(door);
    expect(walls(hub).find((w) => w.kind === "secret")).not.toHaveProperty("portal"); // (a secret door looks like the wall)
    const added = await ok(hub, "add_door", { x: 5, y: 2.5, kind: "window", picture: door });
    expect(walls(hub).find((w) => w.id === added.door.id)?.portal).toBe(door);
    await ok(hub, "update_wall", { id: added.door.id, picture: null });
    expect(walls(hub).find((w) => w.id === added.door.id)).not.toHaveProperty("portal");
    expect((await ok(hub, "list_battle")).walls.some((w: { picture?: string }) => w.picture === door)).toBe(true);
    const bad = await tool(hub, "add_door", { x: 3, y: 4, picture: "nope:Doors/none.png" });
    expect(bad.isError).toBe(true);
    // the picture reaches the server's pictures too
    expect(Object.keys((await hub.battleAssets(hub.session.doc)).opts.wallPictures ?? {})).toEqual([door]);
  });

  it("lets Claude lay roads, tracks and streams, of a look or a pack picture, and change and remove them", async () => {
    const hub = await fresh();
    const paths = () => hub.session.doc.features!.paths ?? [];
    const stream = await ok(hub, "add_path", { points: [[0, 5], [6, 5], [11, 2]], look: "water", width: 2 });
    expect(paths()[0]).toMatchObject({ look: "water", width: 2 });
    const road = (await ok(hub, "search_assets", { query: "road", category: "paths" })).items[0].id;
    const r = await ok(hub, "add_path", { points: [[2, 0], [2, 9]], asset: road });
    expect(paths().find((p) => p.id === r.path.id)?.asset).toBe(road);
    expect((await ok(hub, "list_paths")).paths).toHaveLength(2);
    await ok(hub, "update_path", { id: r.path.id, asset: null, look: "cobble", width: 1.5 });
    expect(paths().find((p) => p.id === r.path.id)).toMatchObject({ look: "cobble", width: 1.5 });
    expect(paths().find((p) => p.id === r.path.id)).not.toHaveProperty("asset");
    const off = await tool(hub, "add_path", { points: [[0, 0], [40, 0]] });
    expect(off.isError).toBe(true); // off the map
    // the picture reaches the server's pictures, and the stream is drawn under the walls
    await ok(hub, "update_path", { id: stream.path.id, asset: road });
    expect(Object.keys((await hub.battleAssets(hub.session.doc)).opts.wallPictures ?? {})).toEqual([road]);
    await ok(hub, "remove_paths", { ids: [stream.path.id, r.path.id] });
    expect(paths()).toHaveLength(0);
  });

  it("lets Claude shape a light with a pack picture, and floor with a pattern", async () => {
    const hub = await fresh();
    const glow = (await ok(hub, "search_assets", { query: "glow", category: "lights" })).items[0].id;
    const added = await ok(hub, "add_light", { x: 5, y: 5, radius: 4, glow });
    expect(hub.session.doc.features!.lights![0].glow).toBe(glow);
    expect((await ok(hub, "list_battle")).lights[0].glow).toBe(glow);
    expect(Object.keys((await hub.battleAssets(hub.session.doc)).opts.wallPictures ?? {})).toEqual([glow]);
    await ok(hub, "update_light", { id: added.light.id, glow: null, radius: 6 });
    expect(hub.session.doc.features!.lights![0]).toMatchObject({ radius: 6 });
    expect(hub.session.doc.features!.lights![0]).not.toHaveProperty("glow");
    expect((await tool(hub, "update_light", { id: "nope" })).isError).toBe(true);
    const pattern = (await ok(hub, "search_assets", { query: "herring", category: "patterns" })).items[0].id;
    const tex = await ok(hub, "add_floor_texture", { asset: pattern });
    await ok(hub, "paint_floor", { shape: { type: "rect", x: 1, y: 1, w: 3, h: 3 }, material: tex.material });
  });

  it("draws a wall's pack picture in the server's pictures (previews and exports)", async () => {
    const hub = await fresh();
    const found = await ok(hub, "search_assets", { query: "wall", category: "walls" });
    const asset = found.items[0].id;
    await ok(hub, "add_wall", { points: [[1, 5], [11, 5]], wall_asset: asset });
    const doc = hub.session.doc;
    const { opts, missing } = await hub.battleAssets(doc);
    expect(missing).toBe(0);
    expect(Object.keys(opts.wallPictures ?? {})).toEqual([asset]);
    const pics = opts.wallPictures!;
    const img = renderBattle(doc, { lights: false, wallPictures: (a) => pics[a] ?? null });
    const px = doc.meta.battle!.pxPerSquare, o = (Math.round(5 * px) * img.w + Math.round(6 * px)) * 4;
    expect(img.data[o + 2]).toBeGreaterThan(img.data[o] + 80); // blue, from the picture
  });
});
