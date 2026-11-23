/** The person's notes on asset pictures: starred ones, the ones used last, and words that make a picture findable (theirs or Claude's), kept across starts. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { runTool } from "@mapmaker/tools";
import { AssetLibrary } from "../src/assets.ts";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-notes-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const lib = path.join(root, "Library"), cache = path.join(root, "cache");
const png = () => { const p = new PNG({ width: 64, height: 64 }); p.data.fill(200); return PNG.sync.write(p); };
mkdirSync(path.join(lib, "Pack 7", "Props"), { recursive: true });
for (const n of ["asset_0001", "asset_0002", "asset_0003"]) writeFileSync(path.join(lib, "Pack 7", "Props", `${n}.png`), png());

describe("starred pictures, recent ones and words", () => {
  it("lists the starred and the recent, finds a picture by words given to it, and keeps all of it", async () => {
    const a = new AssetLibrary(lib, cache);
    await a.scan();
    const ids = a.list({ cat: "objects" }).items.map((i) => i.id);
    expect(ids).toHaveLength(3);
    await a.setFavourite(ids[1], true);
    expect(a.list({ only: "favourites" }).items.map((i) => i.id)).toEqual([ids[1]]);
    expect(a.list({ cat: "objects" }).items.find((i) => i.id === ids[1])?.favourite).toBe(true);
    await a.markUsed(ids[0]);
    await a.markUsed(ids[2]);
    await a.markUsed(ids[0]);
    expect(a.list({ only: "recent" }).items.map((i) => i.id)).toEqual([ids[0], ids[2]]); // (newest first, each once)
    // a nameless picture found by the words given to it
    expect(a.list({ q: "tavern table" }).total).toBe(0);
    expect(await a.addTags([{ id: ids[2], tags: ["Round Table", "tavern", "oak"] }])).toBe(1);
    expect(a.list({ q: "tavern table" }).items.map((i) => i.id)).toEqual([ids[2]]);
    expect((await a.info(ids[2]))?.tags).toEqual(["round table", "tavern", "oak"]);
    await a.removeTags(ids[2], ["oak"]);
    expect((await a.info(ids[2]))?.tags).toEqual(["round table", "tavern"]);
    // the next start remembers it all
    const b = new AssetLibrary(lib, cache);
    await b.scan();
    expect(b.list({ only: "favourites" }).items.map((i) => i.id)).toEqual([ids[1]]);
    expect(b.list({ only: "recent" }).items.map((i) => i.id)).toEqual([ids[0], ids[2]]);
    expect(b.list({ q: "tavern" }).items.map((i) => i.id)).toEqual([ids[2]]);
  });

  it("lets Claude give pictures words and search the DM's starred ones", async () => {
    const dir = path.join(root, "p1");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    hub.assets = new AssetLibrary(lib, path.join(root, "cache2"));
    await hub.assets.scan();
    const ctx = hub.toolContext("mcp");
    const call = async (name: string, input: Record<string, unknown>) => {
      const r = await runTool(ctx, name, input);
      const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (r.isError) throw new Error(t);
      return JSON.parse(t);
    };
    const all = await call("search_assets", { category: "objects" });
    const id = all.items[0].id;
    expect(await call("tag_assets", { tags: [{ id, tags: ["iron brazier", "fire"] }, { id: "nope:x.png", tags: ["x"] }] })).toMatchObject({ tagged: 1, not_found: ["nope:x.png"] });
    expect((await call("search_assets", { query: "brazier" })).items.map((i: { id: string }) => i.id)).toEqual([id]);
    await hub.assets.setFavourite(id, true);
    const fav = await call("search_assets", { only: "favourites" });
    expect(fav.items).toEqual([expect.objectContaining({ id, favourite: true })]);
    await hub.close();
  });
});
