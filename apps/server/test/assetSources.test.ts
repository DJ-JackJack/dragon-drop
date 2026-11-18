/** The asset library takes any mix of folders of pictures, zip files and pack files made by other map tools. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { writePck } from "@mapmaker/core";
import { encodeJpeg } from "@mapmaker/tools";
import { AssetLibrary } from "../src/assets.ts";
import { writeZip } from "../src/zip.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-sources-"));
const dir = path.join(root, "My Assets");
const cacheDir = path.join(root, "cache");

const png = (w: number, h: number, rgb: [number, number, number]) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { p.data[i * 4] = rgb[0]; p.data[i * 4 + 1] = rgb[1]; p.data[i * 4 + 2] = rgb[2]; p.data[i * 4 + 3] = 255; }
  return new Uint8Array(PNG.sync.write(p));
};
const jpg = (w: number, h: number, rgb: [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return encodeJpeg({ w, h, data });
};
/** The start of an extended WebP file: enough to say how big it is (it can't be drawn here). */
const webpStub = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 32, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0], 0);
  b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0], 24);
  return b;
};
const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const write = (rel: string, data: Uint8Array | string) => { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, data); };

const cobble = png(512, 512, [110, 110, 120]);
const oak = png(64, 128, [120, 80, 40]);
const barrel = jpg(320, 160, [150, 90, 40]);

beforeAll(() => {
  // a folder of loose pictures in no particular layout (the folder names say what is inside)
  write("Tokens and Props/Floors/flagstone.png", png(256, 256, [120, 120, 130]));
  write("Tokens and Props/Props/Barrel.jpg", barrel);
  write("Tokens and Props/Props/Chair.png", png(128, 128, [90, 60, 30]));
  write("Tokens and Props/lamp.webp", webpStub(300, 200));
  write("Tokens and Props/notes.txt", "not a picture");
  write("Tokens and Props/.hidden/secret.png", png(32, 32, [1, 1, 1]));
  // a downloaded zip: deflated and stored files, with the junk some zip tools add
  write("Dungeon Kit.zip", writeZip([
    { path: "pack.json", data: json({ name: "Dungeon Kit", version: "2", author: "Zed" }) },
    { path: "Floors/cobble.png", data: cobble },
    { path: "Doors/oak.png", data: oak, store: true },
    { path: "__MACOSX/Floors/._cobble.png", data: new Uint8Array(10) },
    { path: "../evil.png", data: png(8, 8, [255, 0, 0]) },
  ]));
  // a zip whose author asks that it isn't used in other programs, one with no pictures, and one that isn't a zip at all
  write("more/Locked Kit.zip", writeZip([{ path: "pack.json", data: json({ name: "Locked Kit", allow_3rd_party_mapping_software: false }) }, { path: "Props/x.png", data: png(16, 16, [9, 9, 9]) }]));
  write("Empty.zip", writeZip([{ path: "notes.txt", data: new Uint8Array(4) }]));
  write("Fake.zip", new Uint8Array(300).fill(3));
  // pack files from other map tools: found by a name ending in _pack, or .pck, and checked by their first bytes
  write("Odd.other_pack", writePck([{ path: "textures/objects/Lantern.png", data: png(128, 128, [250, 200, 80]) }]));
  write("renamed.pck", writePck([{ path: "textures/terrain/Moss.png", data: png(512, 512, [40, 120, 40]) }]));
  write("Bad.x_pack", new Uint8Array(400).fill(7));
  // a picture lying in the library folder itself
  write("plain.png", png(64, 64, [200, 200, 200]));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("asset sources of every kind", () => {
  const lib = new AssetLibrary(dir, cacheDir);
  afterAll(async () => { await lib.close(); });

  it("finds folders, zip files and pack files, names them, and reports the ones it can't read", async () => {
    await lib.scan();
    const st = lib.status();
    expect(st).toMatchObject({ packs: 6, usablePacks: 5, restricted: 1, scanning: false });
    expect(st.errors.map((e) => path.basename(e.file)).sort()).toEqual(["Bad.x_pack", "Empty.zip", "Fake.zip"]);
    expect(st.errors.find((e) => e.file.endsWith("Empty.zip"))!.message).toMatch(/no PNG, JPEG or WebP/);
    const byName = Object.fromEntries(lib.packList().map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(["Dungeon Kit", "Locked Kit", "My Assets", "Odd", "Tokens and Props", "renamed"].sort());
    expect(byName["Tokens and Props"]).toMatchObject({ kind: "folder", files: 4, categories: { terrain: 1, objects: 2, other: 1 } }); // hidden folders and non-pictures are left out
    expect(byName["Dungeon Kit"]).toMatchObject({ kind: "zip", version: "2", author: "Zed", files: 3, categories: { data: 1, terrain: 1, portals: 1 } }); // the junk and the unsafe path are left out
    expect(byName["Odd"].kind).toBe("pck");
    expect(byName["renamed"].kind).toBe("pck");
    expect(byName["My Assets"]).toMatchObject({ kind: "folder", files: 1 }); // only the picture lying in the folder itself
    expect(byName["Locked Kit"].restricted).toBe(true);
  });

  it("works out kinds from folder names and lists every source together", () => {
    expect(lib.list({ cat: "terrain" }).items.map((i) => i.id)).toEqual(["dungeon-kit:Floors/cobble.png", "tokens-and-props:Floors/flagstone.png", "renamed:textures/terrain/Moss.png"]);
    expect(lib.list({ cat: "objects" }).items.map((i) => i.name)).toEqual(["Barrel", "Chair", "Lantern"]);
    expect(lib.list({ cat: "portals" }).items.map((i) => i.name)).toEqual(["oak"]);
    expect(lib.list({ q: "lamp" }).items[0]).toMatchObject({ cat: "other", pack: "tokens-and-props" });
    expect(lib.list({ pack: "my-assets" }).total).toBe(1);
    expect(lib.list({ q: "secret" }).total).toBe(0); // a hidden folder
    expect(lib.list({ q: "evil" }).total).toBe(0); // a path that leaves the zip
    expect(lib.list({ q: "kit zed" }).total).toBe(0); // (author isn't searched; the pack's name is)
    expect(lib.list({ q: "dungeon kit" }).total).toBe(2);
    expect(lib.list({ q: "x" , pack: "locked-kit" }).total).toBe(0); // restricted: listed in the pack list, not in searches
  });

  it("gets the pixel size of PNG, JPEG and WebP files, from folders and from deflated or stored zip entries", async () => {
    const sized = await lib.withSizes([...lib.list({ q: "" , limit: 100 }).items]);
    const size = (id: string) => { const i = sized.find((x) => x.id === id)!; return [i.w, i.h]; };
    expect(size("tokens-and-props:Props/Barrel.jpg")).toEqual([320, 160]);
    expect(size("tokens-and-props:Props/Chair.png")).toEqual([128, 128]);
    expect(size("tokens-and-props:lamp.webp")).toEqual([300, 200]);
    expect(size("dungeon-kit:Floors/cobble.png")).toEqual([512, 512]); // deflated
    expect(size("dungeon-kit:Doors/oak.png")).toEqual([64, 128]); // stored
    expect(size("odd:textures/objects/Lantern.png")).toEqual([128, 128]);
  });

  it("serves the real bytes from every kind of pack, and nothing from restricted ones", async () => {
    expect(Array.from((await lib.read("dungeon-kit:Floors/cobble.png"))!.bytes)).toEqual(Array.from(cobble));
    expect(Array.from((await lib.read("dungeon-kit:Doors/OAK.png"))!.bytes)).toEqual(Array.from(oak)); // (any case)
    const f = await lib.read("tokens-and-props:Props/Barrel.jpg");
    expect(f!.mime).toBe("image/jpeg");
    expect(Array.from(f!.bytes)).toEqual(Array.from(barrel));
    expect((await lib.read("odd:textures/objects/Lantern.png"))!.mime).toBe("image/png");
    expect(await lib.read("locked-kit:Props/x.png")).toBeNull();
    expect(await lib.read("dungeon-kit:__MACOSX/Floors/._cobble.png")).toBeNull();
    expect(await lib.read("dungeon-kit:../evil.png")).toBeNull();
  });

  it("makes thumbnails, floor tiles and object sprites from folders, zip files and pack files", async () => {
    const th = PNG.sync.read(Buffer.from((await lib.thumbnail("dungeon-kit:Floors/cobble.png", 64))!.bytes));
    expect([th.width, th.height]).toEqual([64, 64]);
    const jt = await lib.thumbnail("tokens-and-props:Props/Barrel.jpg", 80);
    expect(jt!.mime).toBe("image/png");
    expect(jt!.orig).toEqual({ w: 320, h: 160 });
    expect([PNG.sync.read(Buffer.from(jt!.bytes)).width, PNG.sync.read(Buffer.from(jt!.bytes)).height]).toEqual([80, 40]);
    expect((await lib.thumbnail("tokens-and-props:lamp.webp"))!.mime).toBe("image/webp"); // passed on for the browser to draw
    expect(await lib.tile("dungeon-kit:Floors/cobble.png")).toMatchObject({ size: 512, squares: 2 });
    expect(await lib.tile("renamed:textures/terrain/Moss.png")).toMatchObject({ size: 512, squares: 2 });
    expect(await lib.sprite("tokens-and-props:Props/Barrel.jpg", 0.5)).toMatchObject({ w: 160, h: 80, origW: 320, origH: 160 });
    expect(await lib.decode("tokens-and-props:lamp.webp")).toBeNull(); // WebP is shown in the editor but can't be drawn into renders yet
  });

  it("notices pictures that are added later", async () => {
    write("Tokens and Props/Props/Table.png", png(512, 256, [150, 100, 50]));
    write("Fresh Pack/Floors/grass.png", png(256, 256, [50, 160, 50]));
    await lib.scan();
    expect(lib.list({ q: "table" }).total).toBe(1);
    expect(lib.list({ q: "grass" }).items[0]).toMatchObject({ pack: "fresh-pack", cat: "terrain" });
    expect(lib.status().packs).toBe(7);
  });

  it("writes a report that names each kind of pack", async () => {
    const r = await lib.report();
    expect(r).toContain('kinds of pack: {"');
    expect(r).toMatch(/- Dungeon Kit {2}\(zip: Dungeon Kit\.zip/);
    expect(r).toMatch(/- Odd {2}\(pck: Odd\.other_pack/);
    expect(r).toContain("PACKS THAT COULDN'T BE READ");
  });
});
