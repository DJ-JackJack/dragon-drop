/** Dragon Drop's own Starter Pack: a few free floor textures and objects, read as one more asset pack with or without the person's asset folder. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { CUSTOM_MATERIAL_BASE, defaultTileSquares } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { AssetLibrary } from "../src/assets.ts";
import { STARTER_PACK_DIR } from "../src/config.ts";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-starter-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const floors = readdirSync(path.join(STARTER_PACK_DIR, "Floors")).filter((f) => /\.jpe?g$/i.test(f)).sort();
const objects = readdirSync(path.join(STARTER_PACK_DIR, "Objects")).filter((f) => /\.png$/i.test(f)).sort();

describe("the Starter Pack", () => {
  it("holds floors and objects, each listed with its source and licence in CREDITS.txt", () => {
    expect(floors.length).toBeGreaterThanOrEqual(8);
    expect(objects.length).toBeGreaterThanOrEqual(8); // (the 0.1.13 playtest: with none, scattering, tints and object layers couldn't be tried)
    expect(readdirSync(STARTER_PACK_DIR).sort()).toEqual(["CREDITS.txt", "Floors", "Objects", "pack.json"]);
    const credits = readFileSync(path.join(STARTER_PACK_DIR, "CREDITS.txt"), "utf8");
    expect(credits).toMatch(/CC0 1\.0/);
    for (const f of floors) expect(credits).toMatch(new RegExp(`Floors/${f.replace(".", "\\.")}\\s.*https://polyhaven\\.com/a/\\w+`));
    // (and nothing is credited that isn't there)
    const listed = [...credits.matchAll(/^\s+Floors\/(.+?\.jpg)/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(floors);
    // the objects are Dragon Drop's own, drawn by a script in the repository
    for (const f of objects) expect(credits).toMatch(new RegExp(`Objects/${f.replace(".", "\\.")}\\s+Dragon Drop \\(drawn by tools/starter-objects/draw_objects\\.py\\)`));
    expect([...credits.matchAll(/^\s+Objects\/(.+?\.png)/gm)].map((m) => m[1]).sort()).toEqual(objects);
  });

  it("is read without an asset folder: floors that decode, repeat at 2 or 4 squares, and keep their ids", async () => {
    const lib = new AssetLibrary(null, path.join(root, "cache1"), STARTER_PACK_DIR);
    await lib.scan();
    const st = lib.status();
    expect(st).toMatchObject({ dir: null, ownFolder: false, starter: true, packs: 1, usablePacks: 1, errors: [] });
    const items = lib.list({ cat: "terrain", limit: 100 }).items;
    expect(items.map((i) => `${i.path.split("/").pop()}`).sort()).toEqual(floors);
    expect(items.every((i) => i.pack === "dragon-drop-starter-pack" && i.packName === "Dragon Drop Starter Pack")).toBe(true);
    expect(lib.list({}).total).toBe(floors.length + objects.length); // (CREDITS.txt and pack.json aren't pictures)
    // the objects are read as objects, see-through round their edges
    const things = lib.list({ cat: "objects", limit: 100 }).items;
    expect(things.map((i) => `${i.path.split("/").pop()}`).sort()).toEqual(objects);
    for (const it of things) {
      const img = await lib.decode(it.id);
      expect(img, it.name).not.toBeNull();
      expect(img!.data[3], it.name).toBe(0); // (the top-left corner is clear)
    }
    for (const it of items) {
      const img = await lib.decode(it.id);
      expect(img, it.name).not.toBeNull();
      expect(img!.w).toBe(img!.h);
      expect([2, 4]).toContain(defaultTileSquares(img!.w));
    }
    expect(lib.list({ q: "cobble" }).items.map((i) => i.id)).toEqual(["dragon-drop-starter-pack:Floors/Cobblestones.jpg"]);
  });

  it("sits beside the person's packs, first, so its ids stay the same whatever their folder holds", async () => {
    const lib = path.join(root, "Library");
    const p = new PNG({ width: 64, height: 64 });
    p.data.fill(180);
    // (a pack of their own that happens to have the same name)
    mkdirSync(path.join(lib, "Dragon Drop Starter Pack", "Floors"), { recursive: true });
    writeFileSync(path.join(lib, "Dragon Drop Starter Pack", "Floors", "Grass.png"), PNG.sync.write(p));
    mkdirSync(path.join(lib, "Kit", "Floors"), { recursive: true });
    writeFileSync(path.join(lib, "Kit", "Floors", "Moss.png"), PNG.sync.write(p));
    const a = new AssetLibrary(lib, path.join(root, "cache2"), STARTER_PACK_DIR);
    await a.scan();
    expect(a.status()).toMatchObject({ ownFolder: true, starter: true, usablePacks: 3 });
    const keys = a.packList().map((k) => `${k.key}${k.builtIn ? " (built in)" : ""}`).sort();
    expect(keys).toEqual(["dragon-drop-starter-pack (built in)", "dragon-drop-starter-pack-2", "kit"]);
    expect(await a.info("dragon-drop-starter-pack:Floors/Grass.jpg")).toMatchObject({ cat: "terrain" });
    // and without it (MAPMAKER_STARTER_DIR empty): the person's packs only
    const b = new AssetLibrary(lib, path.join(root, "cache3"));
    await b.scan();
    expect(b.status()).toMatchObject({ starter: false, usablePacks: 2 });
  });

  it("dresses a battlemap made from a world map with its floors when there is nothing else", async () => {
    const dir = path.join(root, "maps");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    hub.assets = new AssetLibrary(null, path.join(root, "cache4"), STARTER_PACK_DIR);
    await hub.assets.scan();
    const ok = async (name: string, input: Record<string, unknown>) => {
      const r = await runTool(hub.toolContext("mcp"), name, input);
      const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (r.isError) throw new Error(`${name}: ${t}`);
      return JSON.parse(t);
    };
    await hub.createProject({ name: "World", width: 256, height: 256, kmPerPx: 4 });
    await ok("generate_terrain", { template: "continent", seed: 3 });
    await ok("create_battlemap_here", { name: "Glade", x: 128, y: 128 });
    const palette = hub.session.doc.meta.battle!.palette ?? [];
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.every((e) => e.asset.startsWith("dragon-drop-starter-pack:Floors/") && e.id >= CUSTOM_MATERIAL_BASE)).toBe(true);
    await hub.close();
  });
});
