// A library whose names say nothing ("Pack 3/asset_0001.png"): its pictures are looked at after the scan, by their pixels, once.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pictureKindHint } from "@mapmaker/core";
import { decodeImage } from "@mapmaker/tools";
import { PNG } from "pngjs";
import { AssetLibrary } from "../src/assets.ts";

const root = mkdtempSync(path.join(tmpdir(), "mapmaker-kinds-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set(px(x, y), (y * w + x) * 4);
  return PNG.sync.write(p);
}
const T = Math.PI * 2;
const repeating = png(256, 256, (x, y) => { const v = 120 + 40 * Math.sin((T * 3 * x) / 256) + 30 * Math.cos((T * 5 * y) / 256); return [v, v * 0.9, v * 0.8, 255]; });
const object = png(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 70 ? [120, 70, 30, 255] : [0, 0, 0, 0]));
const painting = png(256, 256, (x, y) => { const v = 230 - (150 * (x + y)) / 512; return [v, v, v * 0.9, 255]; });

describe("pictures whose names say nothing", () => {
  it("are told apart by their pixels after the scan, and looked at only once", async () => {
    const lib = path.join(root, "Assets"), cache = path.join(root, "cache");
    mkdirSync(path.join(lib, "Pack 3", "Floors"), { recursive: true });
    writeFileSync(path.join(lib, "Pack 3", "asset_0001.png"), repeating);
    writeFileSync(path.join(lib, "Pack 3", "asset_0002.png"), object);
    writeFileSync(path.join(lib, "Pack 3", "asset_0003.png"), painting);
    writeFileSync(path.join(lib, "Pack 3", "Floors", "named.png"), painting); // (its folder says it: never looked at)
    mkdirSync(path.join(lib, "Floor Textures"), { recursive: true });
    writeFileSync(path.join(lib, "Floor Textures", "a1.png"), painting); // (the pack's own name says it: never looked at)
    let looks = 0;
    const open = () => {
      const a = new AssetLibrary(lib, cache);
      a.pictures = {
        decode: async (b) => decodeImage(b), thumbnail: async () => null, shrink: async () => null,
        kind: async (b) => { looks++; const img = decodeImage(b); return img ? pictureKindHint(img) : null; },
      };
      return a;
    };
    const names = (a: AssetLibrary, cat: string) => a.list({ cat }).items.filter((i) => i.packName === "Pack 3").map((i) => i.path).sort();

    const a = open();
    await a.scan();
    await a.looked;
    expect(looks).toBe(3);
    expect(names(a, "terrain")).toEqual(["Floors/named.png", "asset_0001.png"]);
    expect(names(a, "objects")).toEqual(["asset_0002.png"]);
    expect(names(a, "other")).toEqual(["asset_0003.png"]); // a painting: the pixels don't say
    expect(a.packList().find((p) => p.name === "Pack 3")?.categories).toMatchObject({ terrain: 2, objects: 1, other: 1 });
    expect(a.list({ cat: "terrain", q: "a1" }).items.map((i) => i.packName)).toEqual(["Floor Textures"]);
    expect(a.status().looking).toBeUndefined(); // (done)
    expect((await a.info(a.list({ cat: "objects" }).items[0].id))?.cat).toBe("objects");

    // the next start remembers what was found: nothing is looked at again
    const b = open();
    await b.scan();
    await b.looked;
    expect(looks).toBe(3);
    expect(names(b, "terrain")).toEqual(["Floors/named.png", "asset_0001.png"]);
    expect(names(b, "objects")).toEqual(["asset_0002.png"]);

    // a picture replaced by another (a different size of file) is looked at again
    writeFileSync(path.join(lib, "Pack 3", "asset_0003.png"), object);
    const c = open();
    await c.scan();
    await c.looked;
    expect(looks).toBe(4);
    expect(names(c, "objects")).toEqual(["asset_0002.png", "asset_0003.png"]);
  });
});
