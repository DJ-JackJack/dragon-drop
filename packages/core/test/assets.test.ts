import { describe, expect, it } from "vitest";
import {
  CUSTOM_MATERIAL_BASE, MapSession, assetId, assetLabel, categoryOf, kindOfName, kindOfPackName, nameWords, createBattleDoc, defaultTileSquares, drawBattleProps, memoryAccess, paintFloor,
  PCK_MAGIC, imageSize, isPckSignature, parseAssetId, pngSize, readPck, readPckFile, renderBattle, renderBattleFloor, writePck, type SpriteData, type TileData,
} from "../src/index.ts";

const text = (s: string) => new TextEncoder().encode(s);

describe("pack reader", () => {
  it("round trips a pack, including unicode names and file contents", async () => {
    const files = [
      { path: "packs/abc12345.json", data: text('{"name":"Test","id":"abc12345"}') },
      { path: "textures/objects/Chêne table.png", data: new Uint8Array([1, 2, 3, 4, 5]) },
      { path: "data/default.example_tags", data: text("{}") },
    ];
    const bytes = writePck(files);
    const ra = memoryAccess(bytes);
    const info = await readPck(ra);
    expect(info.formatVersion).toBe(1);
    expect(info.engine).toBe("3.5.0");
    expect(info.entries.map((e) => e.path)).toEqual(files.map((f) => f.path));
    for (let i = 0; i < files.length; i++) expect(Array.from(await readPckFile(ra, info.entries[i]))).toEqual(Array.from(files[i].data));
  });

  it("reads a big index (more than one read chunk) without mixing entries up", async () => {
    const files = Array.from({ length: 30000 }, (_, i) => ({ path: `textures/objects/item_${i}_${"x".repeat(i % 17)}.png`, data: new Uint8Array([i & 255]) }));
    const ra = memoryAccess(writePck(files));
    const info = await readPck(ra);
    expect(info.entries).toHaveLength(30000);
    expect(info.entries[12345].path).toBe(files[12345].path);
    expect((await readPckFile(ra, info.entries[29999]))[0]).toBe(29999 & 255);
  });

  it("rejects other files, and skips files that a truncated download lost", async () => {
    await expect(readPck(memoryAccess(new Uint8Array(500)))).rejects.toThrow(/GDPC/);
    await expect(readPck(memoryAccess(new Uint8Array(10)))).rejects.toThrow(/too small/);
    const bytes = writePck([{ path: "a.png", data: new Uint8Array(100) }, { path: "b.png", data: new Uint8Array(100) }]);
    const cut = bytes.subarray(0, bytes.length - 50); // the second file is incomplete
    const info = await readPck(memoryAccess(cut));
    expect(info.entries.map((e) => e.path)).toEqual(["a.png"]);
  });

  it("reads the Godot 4 layout (version 2: flags, a file base and per-file flags)", async () => {
    const enc = new TextEncoder();
    const name = enc.encode("res://textures/objects/rock.png");
    const pad = (4 - (name.length % 4)) % 4;
    const header = 4 + 4 + 12 + 4 + 8 + 64 + 4;
    const entry = 4 + name.length + pad + 8 + 8 + 16 + 4;
    const base = 16;
    const payload = new Uint8Array([9, 8, 7]);
    const out = new Uint8Array(header + entry + base + payload.length);
    const dv = new DataView(out.buffer);
    let p = 0;
    const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
    const u64 = (v: number) => { dv.setUint32(p, v, true); dv.setUint32(p + 4, 0, true); p += 8; };
    u32(0x43504447); u32(2); u32(4); u32(2); u32(0); u32(0); u64(header + entry); for (let i = 0; i < 16; i++) u32(0);
    u32(1); u32(name.length + pad); out.set(name, p); p += name.length + pad;
    u64(0); u64(payload.length); p += 16; u32(0); // offset is relative to the file base
    out.set(payload, header + entry);
    const info = await readPck(memoryAccess(out));
    expect(info.formatVersion).toBe(2);
    expect(info.entries[0].path).toBe("textures/objects/rock.png");
    expect(Array.from(await readPckFile(memoryAccess(out), info.entries[0]))).toEqual([9, 8, 7]);
  });
});

describe("asset kinds from folder names (loose folders and zip files)", () => {
  it("reads the kind from the deepest folder that names one, and falls back to 'other'", () => {
    expect(categoryOf("Dungeon/Floors/stone.png")).toBe("terrain");
    expect(categoryOf("Props/Furniture/chair.webp")).toBe("objects");
    expect(categoryOf("Walls/Dungeon/Floors/odd.png")).toBe("terrain"); // the deepest wins
    expect(categoryOf("Doors/oak.jpg")).toBe("portals");
    expect(categoryOf("Windows/small.png")).toBe("portals");
    expect(categoryOf("Roofs/thatch.png")).toBe("roofs");
    expect(categoryOf("Lights/torch.png")).toBe("lights");
    expect(categoryOf("tiles/cobble.png")).toBe("terrain");
    expect(categoryOf("barrel.png")).toBe("objects"); // (the file name's words, when no folder says)
    expect(categoryOf("Stuff/barrel.png")).toBe("objects");
    expect(categoryOf("Stuff/asset_0001.png")).toBe("other"); // nothing says what it is
    expect(categoryOf("Floors/readme.txt")).toBe("data"); // not a picture
    expect(categoryOf("textures/objects/a.png")).toBe("objects"); // the pack-file layout still works
    expect(categoryOf("textures/floors/a.png")).toBe("terrain");
  });
});

// No asset packs ship with Dragon Drop: each buyer brings a library laid out their own way. These are made-up libraries in the common layouts.
describe("asset kinds in any library", () => {
  const kinds = (paths: string[]) => Object.fromEntries(paths.map((p) => [p, categoryOf(p)]));

  it("reads the words in folder names, not only names that are exactly a kind", () => {
    expect(kinds([
      "Battlemap Assets/Floor Textures/Rough Stone 01.png",
      "Battlemap Assets/Stone_Floors/slab-a.jpg",
      "Battlemap Assets/Furniture & Props/Tavern/stool.png",
      "Battlemap Assets/WoodenDoors/door_oak_open.png",
      "Battlemap Assets/Doors and Windows/arched.png",
      "Battlemap Assets/Roof Tiles/red.png",
      "Battlemap Assets/Wall Sections/stone_corner.png",
      "Battlemap Assets/Roads & Paths/dirt_curve.png",
      "Battlemap Assets/Light Sources/glow_warm.png",
      "Battlemap Assets/Trees/oak_03.png",
      "Battlemap Assets/Bushes/b1.png",
      "Battlemap Assets/Seamless/grass_01.jpg",
      "Battlemap Assets/Tilesets/Marble/m2.webp",
    ])).toEqual({
      "Battlemap Assets/Floor Textures/Rough Stone 01.png": "terrain",
      "Battlemap Assets/Stone_Floors/slab-a.jpg": "terrain",
      "Battlemap Assets/Furniture & Props/Tavern/stool.png": "objects", // (Tavern says nothing: the folder above does)
      "Battlemap Assets/WoodenDoors/door_oak_open.png": "portals",
      "Battlemap Assets/Doors and Windows/arched.png": "portals",
      "Battlemap Assets/Roof Tiles/red.png": "roofs", // (roof outweighs tiles)
      "Battlemap Assets/Wall Sections/stone_corner.png": "walls",
      "Battlemap Assets/Roads & Paths/dirt_curve.png": "paths",
      "Battlemap Assets/Light Sources/glow_warm.png": "lights",
      "Battlemap Assets/Trees/oak_03.png": "objects",
      "Battlemap Assets/Bushes/b1.png": "objects",
      "Battlemap Assets/Seamless/grass_01.jpg": "terrain",
      "Battlemap Assets/Tilesets/Marble/m2.webp": "terrain",
    });
  });

  it("reads the file name when no folder says, and a Textures folder means floors when nothing else does", () => {
    expect(kinds([
      "My Pack/WoodFloor_Planks_02.png",
      "My Pack/table_round_large.png",
      "My Pack/portcullis.png",
      "My Pack/Textures/rough_01.jpg",
      "My Pack/Textures/Wall Textures/brick.jpg",
      "My Pack/misc/x77.png",
    ])).toEqual({
      "My Pack/WoodFloor_Planks_02.png": "terrain",
      "My Pack/table_round_large.png": "objects",
      "My Pack/portcullis.png": "portals",
      "My Pack/Textures/rough_01.jpg": "terrain",
      "My Pack/Textures/Wall Textures/brick.jpg": "walls",
      "My Pack/misc/x77.png": "other",
    });
  });

  it("follows a pack file's own layout, with or without its packs/<id>/ folder, before any words", () => {
    expect(kinds([
      "packs/AB12CD34/textures/objects/terrain/moss_patch.png", // a placeable decal in a folder called terrain: still an object
      "packs/AB12CD34/textures/objects/walls/shelf_wall.png",
      "packs/AB12CD34/textures/terrain/stone_floor_terrain/s1.png",
      "packs/AB12CD34/textures/tilesets/simple/Wood_Floor_Tilesets/oak.webp",
      "packs/AB12CD34/textures/materials/lava_tile.png",
      "packs/AB12CD34/textures/portals/doors/d.png",
      "textures/objects/Doors/door_prop.png",
    ])).toEqual({
      "packs/AB12CD34/textures/objects/terrain/moss_patch.png": "objects",
      "packs/AB12CD34/textures/objects/walls/shelf_wall.png": "objects",
      "packs/AB12CD34/textures/terrain/stone_floor_terrain/s1.png": "terrain",
      "packs/AB12CD34/textures/tilesets/simple/Wood_Floor_Tilesets/oak.webp": "terrain",
      "packs/AB12CD34/textures/materials/lava_tile.png": "terrain",
      "packs/AB12CD34/textures/portals/doors/d.png": "portals",
      "textures/objects/Doors/door_prop.png": "objects",
    });
  });

  it("never offers a pack's own thumbnails, its cover picture, or a Mac's hidden copies", () => {
    expect(kinds([
      "packs/AB12CD34/thumbnails/00128efa0baaa5e10d27aed396ee92a1.png",
      "packs/AB12CD34/preview.png",
      "Forest Pack/Thumbnails/oak.png",
      "__MACOSX/Forest Pack/._oak.png",
      "Forest Pack/Trees/._oak.png",
      "Forest Pack/Trees/oak.png",
    ])).toEqual({
      "packs/AB12CD34/thumbnails/00128efa0baaa5e10d27aed396ee92a1.png": "data",
      "packs/AB12CD34/preview.png": "data",
      "Forest Pack/Thumbnails/oak.png": "data",
      "__MACOSX/Forest Pack/._oak.png": "data",
      "Forest Pack/Trees/._oak.png": "data",
      "Forest Pack/Trees/oak.png": "objects",
    });
  });

  it("splits names into words the ways people write them", () => {
    expect(nameWords("StoneFloor_Tiles-02")).toEqual(["Stone", "Floor", "Tiles"]);
    expect(nameWords("HTMLDoors and windows")).toEqual(["HTML", "Doors", "and", "windows"]);
    expect(kindOfName("Shelves")).toBe("objects");
    expect(kindOfName("Wall Decorations")).toBeUndefined(); // a tie: the folder above decides
    expect(kindOfName("textures")).toBeUndefined(); // a hint, not enough alone
    expect(kindOfName("constructor")).toBeUndefined();
    // a pack's own name, for pictures whose paths say nothing
    expect(kindOfPackName("Floor Textures")).toBe("terrain");
    expect(kindOfPackName("Dungeon Doors.zip")).toBe("portals");
    expect(kindOfPackName("Textures")).toBe("terrain");
    expect(kindOfPackName("Pack 3")).toBeUndefined();
  });
});

describe("image sizes from the first bytes", () => {
  const u16 = (n: number) => [n & 255, n >> 8];
  const u16be = (n: number) => [n >> 8, n & 255];
  const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const pad = (a: number[], n: number) => [...a, ...new Array(Math.max(0, n - a.length)).fill(0)];

  it("knows PNG, GIF, BMP, WebP (lossy, lossless and extended) and JPEG", () => {
    expect(imageSize(bytes(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0], 33)))).toEqual({ w: 640, h: 480 });
    expect(imageSize(bytes(ascii("GIF89a"), u16(3), u16(5), [0, 0]))).toEqual({ w: 3, h: 5 });
    expect(imageSize(bytes(pad([0x42, 0x4d], 14), u32(40), u32(7), u32(0xfffffff7 >>> 0), pad([], 20)))).toEqual({ w: 7, h: 9 }); // a negative height: rows run top down
    expect(imageSize(bytes(ascii("RIFF"), u32(100), ascii("WEBP"), ascii("VP8 "), u32(50), [0, 0, 0], [0x9d, 0x01, 0x2a], u16(300), u16(200), pad([], 4)))).toEqual({ w: 300, h: 200 });
    expect(imageSize(bytes(ascii("RIFF"), u32(100), ascii("WEBP"), ascii("VP8L"), u32(50), [0x2f], u32(511 | (255 << 14)), pad([], 8)))).toEqual({ w: 512, h: 256 });
    expect(imageSize(bytes(ascii("RIFF"), u32(100), ascii("WEBP"), ascii("VP8X"), u32(10), u32(0), [0x7f, 0x03, 0x00], [0xff, 0x01, 0x00], pad([], 4)))).toEqual({ w: 896, h: 512 });
    // JPEG: a JFIF segment first, then the frame header (height before width)
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0], u16be(16), ascii("JFIF"), [0, 1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0], u16be(17), [8], u16be(480), u16be(640), pad([], 12)))).toEqual({ w: 640, h: 480 });
  });

  it("answers null for things that are not pictures, truncated files and zero sizes", () => {
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(new Uint8Array(100))).toBeNull();
    expect(imageSize(bytes(ascii("hello world, this is text"), pad([], 20)))).toBeNull();
    expect(imageSize(bytes(ascii("RIFF"), u32(0), ascii("WEBP")))).toBeNull(); // a stub
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]))).toBeNull(); // no frame header in what was given
    expect(imageSize(bytes(ascii("GIF89a"), u16(0), u16(5), [0, 0]))).toBeNull();
  });

  it("recognises a pack file by its first bytes", () => {
    expect(isPckSignature(bytes(u32(PCK_MAGIC)))).toBe(true);
    expect(isPckSignature(bytes(ascii("GDPC"), [1, 0, 0, 0]))).toBe(true);
    expect(isPckSignature(bytes(ascii("PK"), [3, 4]))).toBe(false);
    expect(isPckSignature(new Uint8Array(2))).toBe(false);
  });
});

describe("asset helpers", () => {
  it("categories, ids, labels, sizes", () => {
    expect(categoryOf("textures/objects/a/b.png")).toBe("objects");
    expect(categoryOf("textures/terrain/grass.PNG")).toBe("terrain");
    expect(categoryOf("textures/walls/w.webp")).toBe("walls");
    expect(categoryOf("textures/mystery/x.png")).toBe("other");
    expect(categoryOf("textures/constructor/x.png")).toBe("other"); // (a folder name is never looked up as an object property)
    expect(categoryOf("data/default.example_tags")).toBe("data");
    expect(parseAssetId(assetId("fa-objects", "textures/objects/a:b.png"))).toEqual({ pack: "fa-objects", path: "textures/objects/a:b.png" });
    expect(parseAssetId("nopack")).toBeNull();
    expect(assetLabel("textures/objects/Oak_Table-01.png")).toBe("Oak Table 01");
    expect(defaultTileSquares(1024)).toBe(4);
    expect(defaultTileSquares(8192)).toBe(16);
    expect(defaultTileSquares(undefined)).toBe(4);
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(png.buffer).setUint32(16, 640); new DataView(png.buffer).setUint32(20, 480);
    expect(pngSize(png)).toEqual({ w: 640, h: 480 });
    expect(pngSize(new Uint8Array(40))).toBeNull();
  });
});

const solid = (r: number, g: number, b: number, a = 255, w = 4, h = 4): SpriteData => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a; }
  return { w, h, data };
};

describe("pack textures as floors", () => {
  const withPalette = () => {
    const d = createBattleDoc({ id: "b", name: "B", squaresX: 8, squaresY: 8, pxPerSquare: 40 });
    d.meta.battle!.palette = [{ id: CUSTOM_MATERIAL_BASE, name: "Mossy flags", asset: "p:textures/terrain/moss.png", squares: 2 }];
    return d;
  };

  it("paints a palette material and ignores ids that aren't in the palette", () => {
    const d = withPalette();
    const s = new MapSession(d);
    s.execute({ op: "paint_floor", params: { shape: { type: "rect", x: 0, y: 0, w: 32, h: 32 }, material: CUSTOM_MATERIAL_BASE } }, "user");
    expect(d.height.get(5, 5)).toBe(CUSTOM_MATERIAL_BASE);
    paintFloor(d, { shape: { type: "all" }, material: CUSTOM_MATERIAL_BASE + 7 }); // not in the palette: clamped to a builtin
    expect(d.height.get(5, 5)).toBeLessThan(CUSTOM_MATERIAL_BASE);
    s.undo("user");
  });

  it("draws the texture tile where it's painted, repeating every `squares`", () => {
    const d = withPalette();
    paintFloor(d, { shape: { type: "all" }, material: CUSTOM_MATERIAL_BASE });
    // a 2x2 tile: red | green over blue | white, covering 2 squares (80 px)
    const tile: TileData = { size: 2, squares: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) };
    const out = new Uint8ClampedArray(320 * 320 * 4);
    renderBattleFloor(d, out, undefined, (id) => (id === CUSTOM_MATERIAL_BASE ? tile : null));
    const at = (x: number, y: number) => Array.from(out.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3));
    expect(at(10, 10)).toEqual([255, 0, 0]);
    expect(at(50, 10)).toEqual([0, 255, 0]);
    expect(at(10, 50)).toEqual([0, 0, 255]);
    expect(at(90, 10)).toEqual([255, 0, 0]); // repeats after 80 px
    // while the texture isn't loaded yet the floor is a flat grey, not an error
    const grey = new Uint8ClampedArray(320 * 320 * 4);
    renderBattleFloor(d, grey, undefined, () => null);
    expect(grey[0]).toBeGreaterThan(80);
  });
});

describe("props", () => {
  it("are features with undo", () => {
    const s = new MapSession(createBattleDoc({ id: "b", name: "B", squaresX: 10, squaresY: 10 }));
    s.execute({ op: "features", patch: { upsertProps: [{ id: "o1", asset: "p:textures/objects/table.png", x: 3, y: 4 }] } }, "user");
    expect(s.doc.features!.props).toHaveLength(1);
    s.execute({ op: "features", patch: { upsertProps: [{ id: "o1", asset: "p:textures/objects/table.png", x: 5, y: 4, rotation: 90 }] } }, "user");
    expect(s.doc.features!.props![0]).toMatchObject({ x: 5, rotation: 90 });
    s.undo("user");
    expect(s.doc.features!.props![0].x).toBe(3);
    s.execute({ op: "features", patch: { removeProps: ["o1"] } }, "user");
    expect(s.doc.features!.props).toHaveLength(0);
  });

  it("draw at 256 px per square times scale, with rotation, mirroring and layers", () => {
    const d = createBattleDoc({ id: "b", name: "B", squaresX: 10, squaresY: 10, pxPerSquare: 50 });
    const img = { w: 500, h: 500, data: new Uint8ClampedArray(500 * 500 * 4) };
    // a 512 x 256 px image is 2 x 1 squares = 100 x 50 px at 50 px per square, red on the left half, blue on the right
    const spr = solid(255, 0, 0, 255, 8, 4);
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) { const o = (y * 8 + x) * 4; spr.data[o] = 0; spr.data[o + 2] = 255; }
    (spr as SpriteData & { origW: number; origH: number }).origW = 512;
    (spr as SpriteData & { origW: number; origH: number }).origH = 256;
    const props = [{ id: "o", asset: "a:x.png", x: 5, y: 5 }];
    drawBattleProps(img, d.meta.battle!, props, () => spr, "above");
    const px = (x: number, y: number) => Array.from(img.data.subarray((y * 500 + x) * 4, (y * 500 + x) * 4 + 3));
    expect(px(230, 250)).toEqual([255, 0, 0]); // left half, inside 200..300 wide
    expect(px(270, 250)).toEqual([0, 0, 255]);
    expect(px(190, 250)).toEqual([0, 0, 0]); // outside
    expect(px(250, 290)).toEqual([0, 0, 0]); // outside (only 50 px tall: 225..275)
    // a "below" prop isn't drawn on the "above" pass, and mirroring swaps the halves
    const img2 = { w: 500, h: 500, data: new Uint8ClampedArray(500 * 500 * 4) };
    drawBattleProps(img2, d.meta.battle!, [{ ...props[0], flip: true, layer: "below" as const }], () => spr, "above");
    expect(img2.data.every((v) => v === 0)).toBe(true);
    drawBattleProps(img2, d.meta.battle!, [{ ...props[0], flip: true, layer: "below" as const }], () => spr, "below");
    expect(Array.from(img2.data.subarray((250 * 500 + 230) * 4, (250 * 500 + 230) * 4 + 3))).toEqual([0, 0, 255]);
    // rotating a quarter turn makes it 1 square wide and 2 tall
    const img3 = { w: 500, h: 500, data: new Uint8ClampedArray(500 * 500 * 4) };
    drawBattleProps(img3, d.meta.battle!, [{ ...props[0], rotation: 90 }], () => spr, "above");
    expect(Array.from(img3.data.subarray((280 * 500 + 250) * 4, (280 * 500 + 250) * 4 + 3))).not.toEqual([0, 0, 0]);
    expect(Array.from(img3.data.subarray((250 * 500 + 290) * 4, (250 * 500 + 290) * 4 + 3))).toEqual([0, 0, 0]);
  });

  it("sit under walls when 'below' and over them when 'above' in the full render", () => {
    const d = createBattleDoc({ id: "b", name: "B", squaresX: 10, squaresY: 10, pxPerSquare: 50, roomMargin: 2 });
    d.features!.props = [
      { id: "o1", asset: "a:red.png", x: 2, y: 5, layer: "below", scale: 0.4 },
      { id: "o2", asset: "a:red.png", x: 8, y: 5, layer: "above", scale: 0.4 },
    ];
    const red = solid(255, 0, 0, 255, 16, 16);
    (red as SpriteData & { origW: number; origH: number }).origW = 256;
    (red as SpriteData & { origW: number; origH: number }).origH = 256;
    const img = renderBattle(d, { sprites: () => red });
    const at = (x: number, y: number) => Array.from(img.data.subarray((y * 500 + x) * 4, (y * 500 + x) * 4 + 3));
    // both are centred on a wall line; the wall (grey stone) is on top of the "below" one only
    expect(at(100, 250)[1]).toBeGreaterThan(60); // x = 2 squares: the left wall covers the centre (the red prop has no green)
    expect(at(400, 250)).toEqual([255, 0, 0]); // x = 8 squares: the prop covers the right wall
  });
});

describe("boxResize", () => {
  it("averages colours, keeps transparency honest and doesn't tint edges", async () => {
    const { boxResize } = await import("../src/index.ts");
    // 2x2: opaque red, opaque blue / transparent (with green RGB), opaque white
    const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255, 255, 255]);
    const one = boxResize(src, 2, 2, 1, 1);
    expect(one[3]).toBe(191); // 3 of 4 pixels opaque
    expect(one[1]).toBe(85); // the transparent pixel's green didn't contribute: (0 + 0 + 255) / 3
    expect(one[0]).toBe(170);
    expect(Array.from(boxResize(src, 2, 2, 2, 2)).filter((_, i) => i % 4 === 3)).toEqual([255, 255, 0, 255]); // same size: alpha unchanged
  });
});
