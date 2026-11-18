import { describe, expect, it } from "vitest";
import {
  CUSTOM_MATERIAL_BASE, MapSession, assetId, assetLabel, categoryOf, createBattleDoc, defaultTileSquares, drawBattleProps, memoryAccess, paintFloor,
  parseAssetId, pngSize, readPck, readPckFile, renderBattle, renderBattleFloor, writePck, type SpriteData, type TileData,
} from "../src/index.ts";

const text = (s: string) => new TextEncoder().encode(s);

describe("pack reader", () => {
  it("round trips a pack, including unicode names and file contents", async () => {
    const files = [
      { path: "packs/abc12345.json", data: text('{"name":"Test","id":"abc12345"}') },
      { path: "textures/objects/Chêne table.png", data: new Uint8Array([1, 2, 3, 4, 5]) },
      { path: "data/default.dungeondraft_tags", data: text("{}") },
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

describe("asset helpers", () => {
  it("categories, ids, labels, sizes", () => {
    expect(categoryOf("textures/objects/a/b.png")).toBe("objects");
    expect(categoryOf("textures/terrain/grass.PNG")).toBe("terrain");
    expect(categoryOf("textures/walls/w.webp")).toBe("walls");
    expect(categoryOf("textures/mystery/x.png")).toBe("other");
    expect(categoryOf("data/default.dungeondraft_tags")).toBe("data");
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
