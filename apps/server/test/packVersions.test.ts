/**
 * Two versions of the same pack side by side (names that differ by their version, the same pack id inside), and grey "colour it yourself" copies of
 * textures: found in the person's own library in the hand test of 2026-11-23.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { MATERIALS, createBattleDoc } from "@mapmaker/core";
import { AssetLibrary } from "../src/assets.ts";
import { colourfulness, dressBattleWithPacks } from "../src/battlePack.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-packver-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (file: string, rgb: [number, number, number], size = 64) => {
  const p = new PNG({ width: size, height: size });
  // (a texture: brighter and darker blotches; a flat colour is no floor texture)
  for (let i = 0; i < size * size; i++) { const d = ((i % size) >> 3 ^ (i / size) >> 3) & 1 ? 14 : -14; p.data.set([rgb[0] + d, rgb[1] + d, rgb[2] + d, 255], i * 4); }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, PNG.sync.write(p));
};
const packJson = (dir: string, version: string) => writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ name: `Tex A v${version}`, id: "TEXA01", version }));

describe("two versions of the same pack", () => {
  it("offers only the newest, still finds the pictures maps took from the older one, and finds them in the newer once the older is gone", async () => {
    const lib = path.join(root, "Library");
    for (const v of ["1.2", "1.3"]) {
      const dir = path.join(lib, `Tex A v${v}`);
      put(path.join(dir, "Floors", "Grass.png"), [60, 140, 50]);
      if (v === "1.3") put(path.join(dir, "Floors", "Moss.png"), [70, 120, 60]);
      packJson(dir, v);
    }
    const a = new AssetLibrary(lib, path.join(root, "cache1"));
    await a.scan();
    expect(a.status()).toMatchObject({ packs: 2, usablePacks: 1 });
    expect(a.packList().map((p) => `${p.key}${p.supersededBy ? ` (superseded by ${p.supersededBy})` : ""}`).sort())
      .toEqual(["tex-a-v1-2 (superseded by Tex A v1.3)", "tex-a-v1-3"]);
    expect(a.list({ cat: "terrain" }).items.map((i) => i.id).sort()).toEqual(["tex-a-v1-3:Floors/Grass.png", "tex-a-v1-3:Floors/Moss.png"]);
    expect(await a.read("tex-a-v1-2:Floors/Grass.png")).not.toBeNull(); // (a map made with the older copy)
    // the older copy deleted: its pictures are found in the newer
    rmSync(path.join(lib, "Tex A v1.2"), { recursive: true, force: true });
    const b = new AssetLibrary(lib, path.join(root, "cache2"));
    await b.scan();
    expect(await b.read("tex-a-v1-2:Floors/Grass.png")).not.toBeNull();
    expect(await b.info("tex-a-v1-2:Floors/Grass.png")).toMatchObject({ pack: "tex-a-v1-3" });
    expect(await b.read("tex-a-v1-2:Floors/Nothing.png")).toBeNull();
    expect(await b.read("other-pack-v2:Floors/Grass.png")).toBeNull();
  });
});

describe("grey, murky and see-through textures", () => {
  it("are never chosen by Dragon Drop for a floor that has a colour of its own, water or any floor", async () => {
    const lib = path.join(root, "Waters");
    put(path.join(lib, "Kit", "Floors", "Water_Still_01.png"), [40, 110, 130]);
    for (const n of ["02", "03", "04", "05", "06", "07"]) put(path.join(lib, "Kit", "Floors", `Water_Still_${n}.png`), [90, 90, 90]);
    // murky swamp water (never for a river or the sea), a white wave overlay (a floor shows a picture's colours, see-through or not: plain white), a blue
    // one (an overlay is never a ground), and one flat blue (no texture at all)
    for (const n of ["A", "B", "C"]) put(path.join(lib, "Kit", "Floors", `Water_Swamp_${n}.png`), [95, 90, 45]);
    for (const n of ["B", "C"]) put(path.join(lib, "Kit", "Floors", `Wave_Overlay_${n}.png`), [60, 200, 230]);
    const flat = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < 64 * 64; i++) flat.data.set([60, 190, 230, 255], i * 4);
    writeFileSync(path.join(lib, "Kit", "Floors", "Water_Flat.png"), PNG.sync.write(flat));
    const ov = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < 64 * 64; i++) ov.data.set([240, 245, 250, i % 9 ? 30 : 255], i * 4);
    writeFileSync(path.join(lib, "Kit", "Floors", "Water_Wave_Overlay.png"), PNG.sync.write(ov));
    // a grass texture that is see-through all over but green: a floor shows it green, so it is used
    const thin = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < 64 * 64; i++) { const d = ((i % 64) >> 3 ^ (i / 64) >> 3) & 1 ? 14 : -14; thin.data.set([70 + d, 130 + d, 50 + d, 110], i * 4); }
    writeFileSync(path.join(lib, "Kit", "Floors", "Grass_Thin.png"), PNG.sync.write(thin));
    put(path.join(lib, "Kit", "Floors", "Rock_Grey.png"), [110, 110, 110]);
    const a = new AssetLibrary(lib, path.join(root, "cache3"));
    await a.scan();
    expect(await colourfulness(a, "kit:Floors/Water_Still_07.png")).toBeLessThan(12);
    expect(await colourfulness(a, "kit:Floors/Water_Still_01.png")).toBeGreaterThan(40);
    const water = MATERIALS.findIndex((m) => m.name === "shallow water"), rock = MATERIALS.findIndex((m) => m.name === "rock"), grass = MATERIALS.findIndex((m) => m.name === "grass");
    for (let seed = 1; seed <= 6; seed++) {
      const doc = createBattleDoc({ id: `w${seed}`, name: "Pond", squaresX: 6, squaresY: 4 });
      doc.meta.seed = seed;
      for (let i = 0; i < doc.height.data.length; i++) doc.height.data[i] = i % 3 === 0 ? water : i % 3 === 1 ? rock : grass;
      await dressBattleWithPacks(doc, a);
      const used = Object.fromEntries((doc.meta.battle!.palette ?? []).map((e) => [e.asset, e.name]));
      expect(Object.keys(used), JSON.stringify(used)).toContain("kit:Floors/Water_Still_01.png");
      expect(Object.keys(used)).toContain("kit:Floors/Rock_Grey.png"); // (stone may well be grey)
      expect(Object.keys(used)).toContain("kit:Floors/Grass_Thin.png");
    }
  });
});
