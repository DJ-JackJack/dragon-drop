/** City roofs from the asset packs first: a building gets a roof texture that fits its roof look, and a roof is drawn only where the packs have none. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { decodeImage, runTool } from "@mapmaker/tools";
import { AssetLibrary } from "../src/assets.ts";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-cityroofs-"));
const lib = path.join(root, "Library");
const cache = path.join(root, "cache");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const png = (rgb: [number, number, number]) => {
  const p = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < 64 * 64; i++) { p.data[i * 4] = rgb[0]; p.data[i * 4 + 1] = rgb[1]; p.data[i * 4 + 2] = rgb[2]; p.data[i * 4 + 3] = 255; }
  return new Uint8Array(PNG.sync.write(p));
};
const put = (rel: string, rgb: [number, number, number]) => { const f = path.join(lib, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, png(rgb)); };

beforeAll(() => {
  // a pack of old-world roofs: two clay tiles, thatch and slate, and no wooden shingle at all
  put("Medieval Roofs/Roofs/Roof_Texture_Tile_Red_A1.png", [200, 40, 40]);
  put("Medieval Roofs/Roofs/Roof_Texture_Tile_Red_A2.png", [190, 50, 40]);
  put("Medieval Roofs/Roofs/Roof_Texture_Hay_01_A1.png", [230, 200, 60]);
  put("Medieval Roofs/Roofs/Roof_Texture_Slate_Black_A1.png", [40, 40, 60]);
  // a roof as an object (a whole roof, not a texture) and a floor: neither is a roof texture
  put("Medieval Roofs/Objects/Rectangular Roof 1.png", [120, 60, 20]);
  put("Medieval Roofs/Floors/Tile_Floor_Red.png", [180, 30, 30]);
  // a pack of another setting, with a shingle roof: not offered for a medieval city
  put("Cyberpunk Rooftops/Roofs/Roof_Texture_Shingle_Neon_A1.png", [255, 0, 255]);
});

let n = 0;
const fresh = async (withLibrary = true) => {
  const dir = path.join(root, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  const hub = new Hub(new ProjectStore(dir), null);
  if (withLibrary) { hub.assets = new AssetLibrary(lib, cache); await hub.assets.scan(); }
  return hub;
};
const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await tool(hub, name, input);
  if (r.isError) throw new Error(`${name}: ${textOf(r)}`);
  return JSON.parse(textOf(r));
};
const city = async (hub: Hub) => ok(hub, "create_city", { name: "Town", width_m: 300, height_m: 200 });
const buildings = (hub: Hub) => hub.session.doc.features!.buildings!;

describe("which roof textures the library offers", () => {
  it("finds the roof textures by look, and leaves out whole-roof objects, floors and packs of another setting", async () => {
    const hub = await fresh();
    const pools = hub.roofPools()!;
    expect(pools.tile.map((a) => a.name)).toEqual(["Roof Texture Tile Red A1", "Roof Texture Tile Red A2"]);
    expect(pools.thatch).toHaveLength(1);
    expect(pools.slate).toHaveLength(1);
    expect(pools.shingle).toHaveLength(0); // (the only shingle roof is in a cyberpunk pack)
    const found = await ok(hub, "find_roof_assets");
    expect(found).toMatchObject({ textures_by_look: { slate: 1, tile: 2, thatch: 1, shingle: 0 }, matching: 4, no_texture_for: ["shingle"] });
    expect(found.roofs[0]).toMatchObject({ look: "slate", pack: "Medieval Roofs" });
    expect(found.roofs[0].id).toMatch(/Roof_Texture_Slate_Black_A1\.png$/);
    expect((await ok(hub, "find_roof_assets", { look: "tile", match: "red A2" })).roofs).toHaveLength(1);
    expect((await ok(hub, "find_roof_assets", { look: "shingle" })).roofs).toEqual([]);
    await hub.close();
  });

  it("says so when there is no library, and the pools follow a rescan", async () => {
    const none = await fresh(false);
    expect(none.roofPools()).toBeNull();
    expect(textOf(await tool(none, "find_roof_assets"))).toMatch(/No asset library is set up/);
    await none.close();
    const hub = await fresh();
    const before = hub.roofPools();
    expect(hub.roofPools()).toBe(before); // (kept)
    put("Medieval Roofs/Roofs/Roof_Texture_Wood_Dark_Shingle_A1.png", [90, 60, 30]);
    await hub.assets!.scan();
    expect(hub.roofPools()).not.toBe(before);
    expect(hub.roofPools()!.shingle).toHaveLength(1);
    await hub.close();
    rmSync(path.join(lib, "Medieval Roofs/Roofs/Roof_Texture_Wood_Dark_Shingle_A1.png"));
  });
});

describe("add_buildings prefers the packs' roofs", () => {
  it("gives each building a picture that fits its look, and draws a roof only where there is none", async () => {
    const hub = await fresh();
    await city(hub);
    const r = await ok(hub, "add_buildings", {
      buildings: [
        { x: 40, y: 40, w: 8, h: 10, roof: "tile" }, { x: 60, y: 40, w: 8, h: 10, roof: "tile" }, { x: 80, y: 40, w: 8, h: 10, roof: "thatch" },
        { x: 100, y: 40, w: 8, h: 10, roof: "shingle" }, { x: 120, y: 40, w: 8, h: 10 },
      ],
    });
    expect(r.roofs).toEqual({ from_asset_packs: 4, drawn: 1, no_asset_for_look: ["shingle"] });
    const [t1, t2, th, sh, def] = buildings(hub);
    expect(t1.asset).toMatch(/Roof_Texture_Tile_Red_A[12]\.png$/);
    expect(t2.asset).toMatch(/Roof_Texture_Tile_Red_A[12]\.png$/);
    expect(t1.tile).toBeGreaterThan(0);
    expect(th.asset).toMatch(/Roof_Texture_Hay_01_A1\.png$/);
    expect(sh.asset).toBeUndefined(); // no shingle roof in the packs (the cyberpunk one is another setting): drawn
    expect(def.asset).toMatch(/Roof_Texture_Slate_Black_A1\.png$/); // (no look given: slate)
    expect(sh.roof).toBe("shingle");
    expect((await ok(hub, "get_map_summary")).roofs_from_asset_packs).toBe(4);
    expect((await ok(hub, "get_map_summary")).roof_textures_available).toEqual({ slate: 1, tile: 2, thatch: 1, shingle: 0 });
    expect((await ok(hub, "list_buildings", { limit: 1 })).buildings[0].roof_picture).toMatch(/Roof_Texture_Tile/);
    await hub.close();
  });

  it("spreads the pictures over a street of buildings, and prefers the ones that say so", async () => {
    const hub = await fresh();
    await city(hub);
    await ok(hub, "add_buildings", { buildings: Array.from({ length: 30 }, (_, i) => ({ x: 20 + i * 8, y: 60, w: 6, h: 8, roof: "tile" })) });
    expect(new Set(buildings(hub).map((b) => b.asset)).size).toBe(2); // both clay tile pictures are used
    await ok(hub, "add_buildings", { roof_match: "A2", buildings: Array.from({ length: 10 }, (_, i) => ({ x: 20 + i * 8, y: 100, w: 6, h: 8, roof: "tile" })) });
    expect(new Set(buildings(hub).slice(30).map((b) => b.asset))).toEqual(new Set([buildings(hub)[30].asset]));
    expect(buildings(hub)[30].asset).toMatch(/A2\.png$/);
    await hub.close();
  });

  it("draws a building in its colour, draws everything when asked, and uses one picture for all when told which", async () => {
    const hub = await fresh();
    await city(hub);
    await ok(hub, "add_buildings", { buildings: [{ x: 40, y: 40, w: 8, h: 10, roof: "tile", colour: "#336699" }] });
    expect(buildings(hub)[0]).toMatchObject({ colour: "#336699" });
    expect(buildings(hub)[0].asset).toBeUndefined(); // (a colour the person gave means that colour, drawn)
    const none = await ok(hub, "add_buildings", { roof_assets: "none", buildings: [{ x: 60, y: 40, w: 8, h: 10, roof: "tile" }, { x: 80, y: 40, w: 8, h: 10, roof: "thatch" }] });
    expect(none.roofs).toEqual({ from_asset_packs: 0, drawn: 2 });
    const slate = (await ok(hub, "find_roof_assets", { look: "slate" })).roofs[0].id as string;
    await ok(hub, "add_buildings", { roof_asset: slate, buildings: [{ x: 100, y: 40, w: 8, h: 10, roof: "tile" }, { x: 120, y: 40, w: 8, h: 10, roof: "thatch" }] });
    expect(buildings(hub).slice(3).map((b) => b.asset)).toEqual([slate, slate]);
    // one building with its own picture, another call's picture unchanged
    const hay = (await ok(hub, "find_roof_assets", { look: "thatch" })).roofs[0].id as string;
    await ok(hub, "add_buildings", { buildings: [{ x: 140, y: 40, w: 8, h: 10, roof: "tile", asset: hay, tile: 3 }] });
    expect(buildings(hub)[5]).toMatchObject({ asset: hay, tile: 3 });
    const e = await tool(hub, "add_buildings", { roof_asset: "nobody:nothing.png", buildings: [{ x: 10, y: 10, w: 6, h: 6 }] });
    expect(e.isError).toBe(true);
    expect(textOf(e)).toMatch(/find_roof_assets/);
    expect(buildings(hub)).toHaveLength(6); // (nothing was added by the refused call)
    await hub.close();
  });

  it("with no library draws every roof and says why", async () => {
    const hub = await fresh(false);
    await city(hub);
    const r = await ok(hub, "add_buildings", { buildings: [{ x: 40, y: 40, w: 8, h: 10, roof: "tile" }] });
    expect(r.roofs).toMatchObject({ from_asset_packs: 0, drawn: 1, note: expect.stringMatching(/No asset library/) });
    expect((await tool(hub, "add_buildings", { roof_asset: "a:b.png", buildings: [{ x: 40, y: 40, w: 8, h: 10 }] })).isError).toBe(true);
    await hub.close();
  });
});

describe("changing roofs that came from the packs", () => {
  it("picks a new picture when the look changes, draws the look when the packs have none, and lets a colour or 'none' take the picture off", async () => {
    const hub = await fresh();
    await city(hub);
    await ok(hub, "add_buildings", { buildings: Array.from({ length: 4 }, (_, i) => ({ x: 30 + i * 20, y: 60, w: 8, h: 10, roof: "tile" })) });
    const ids = buildings(hub).map((b) => b.id);
    await ok(hub, "update_buildings", { ids: [ids[0]], roof: "thatch" });
    expect(buildings(hub)[0]).toMatchObject({ roof: "thatch" });
    expect(buildings(hub)[0].asset).toMatch(/Hay/);
    const sh = await ok(hub, "update_buildings", { ids: [ids[1]], roof: "shingle" }); // (none for shingle)
    expect(buildings(hub)[1].asset).toBeUndefined();
    expect(sh.roofs_with_picture).toBe(0);
    await ok(hub, "update_buildings", { ids: [ids[2]], colour: "#223344" });
    expect(buildings(hub)[2]).toMatchObject({ colour: "#223344" });
    expect(buildings(hub)[2].asset).toBeUndefined();
    await ok(hub, "update_buildings", { ids: [ids[3]], roof_asset: "none" });
    expect(buildings(hub)[3].asset).toBeUndefined();
    // and back: auto gives the ones with no picture one (those with a colour stay in it)
    await ok(hub, "update_buildings", { ids: [ids[3]], roof_asset: "auto" });
    expect(buildings(hub)[3].asset).toMatch(/Tile/);
    await ok(hub, "update_buildings", { ids: [ids[0]], roof_asset: (await ok(hub, "find_roof_assets", { look: "slate" })).roofs[0].id });
    expect(buildings(hub)[0].asset).toMatch(/Slate/);
    expect((await tool(hub, "update_buildings", { ids: [ids[0]], roof_asset: "x:y.png" })).isError).toBe(true);
    await hub.close();
  });
});

describe("drawing a city with roof pictures", () => {
  it("draws each roof from its picture (the previews Claude sees), and a building whose picture is missing from its look", async () => {
    const hub = await fresh();
    await city(hub);
    await ok(hub, "add_buildings", { buildings: [{ x: 60, y: 100, w: 40, h: 30, roof: "tile", flat: true }, { x: 150, y: 100, w: 40, h: 30, roof: "thatch", flat: true }, { x: 240, y: 100, w: 40, h: 30, roof: "slate", flat: true }] });
    const r = await tool(hub, "render_city", { max_size: 600, grid: false });
    const jpg = decodeImage(new Uint8Array(Buffer.from((r.content as { type: string; data?: string }[]).find((c) => c.type === "image")!.data!, "base64")))!;
    const px = (m: number) => { const o = (Math.round(100 * 2) * jpg.w + Math.round(m * 2)) * 4; return [jpg.data[o], jpg.data[o + 1], jpg.data[o + 2]]; };
    const [tr, tg] = px(60), [hr, , hb] = px(150), [sr, , sb] = px(240);
    expect(tr).toBeGreaterThan(tg + 70); // red clay tile
    expect(hr).toBeGreaterThan(hb + 90); // yellow hay
    expect(sb).toBeGreaterThan(sr + 5); // dark blue-grey slate
    // the same city with the library gone: every roof is drawn from its look (the pictures can't be decoded), not an empty hole
    hub.assets = null;
    const again = await tool(hub, "render_city", { max_size: 600, grid: false });
    expect(again.isError).toBeFalsy();
    const jpg2 = decodeImage(new Uint8Array(Buffer.from((again.content as { type: string; data?: string }[]).find((c) => c.type === "image")!.data!, "base64")))!;
    const o2 = (Math.round(100 * 2) * jpg2.w + 150 * 2) * 4;
    expect(jpg2.data[o2]).toBeGreaterThan(jpg2.data[o2 + 2] + 30); // thatch is straw-coloured, still
    await hub.close();
  });
});

describe("a roof picture with a see-through strip at its bottom", () => {
  it("is trimmed to the roof when it is a tile for a roof, and left alone as a floor", async () => {
    // the packs' roof pictures end in a strip with nothing in it (the last 1% to 9%): tiled, it would show as a dark seam every repeat
    const lib2 = path.join(root, "Library2");
    const f = path.join(lib2, "Strip Roofs/Roofs/Roof_Texture_Tile_Strip_A1.png");
    mkdirSync(path.dirname(f), { recursive: true });
    const p = new PNG({ width: 64, height: 64 });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4, solid = y < 58; p.data[i] = solid ? 200 : 0; p.data[i + 1] = solid ? 40 : 0; p.data[i + 2] = solid ? 40 : 0; p.data[i + 3] = solid ? 255 : 0; }
    writeFileSync(f, new Uint8Array(PNG.sync.write(p)));
    const library = new AssetLibrary(lib2, path.join(root, "cache2"));
    await library.scan();
    const id = library.roofTextures()[0].id;
    const alphaOf = (t: { data: Uint8ClampedArray; size: number }, y: number) => t.data[(y * t.size + 100) * 4 + 3];
    const roof = (await library.tile(id, undefined, true))!;
    expect([0, 100, 300, 500, 511].map((y) => alphaOf(roof, y))).toEqual([255, 255, 255, 255, 255]); // (the strip is gone: no row of the tile is empty)
    expect(roof.data[(511 * roof.size + 100) * 4]).toBeGreaterThan(150); // (and its last row is the red roof, not black)
    const floor = (await library.tile(id))!;
    expect(alphaOf(floor, 511)).toBe(0); // (as a floor, nothing is cut)
  });
});
