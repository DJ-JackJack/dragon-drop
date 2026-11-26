// Claude's paint_biome (biome brushes): paints a ground over the climate's choice on a world map, which the server works out with the derived layers and
// get_selection then reports; erase takes it off again; settlements and battlemaps refuse it.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-groundpaint-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("painting ground by hand (paint_biome)", () => {
  it("paints a desert into a wet land, which the selection then reports, and erases it again", async () => {
    const dir = path.join(root, "maps");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    const call = async (name: string, input: Record<string, unknown>) => {
      const r = await runTool(hub.toolContext("mcp"), name, input);
      const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      return { error: !!r.isError, text: t, json: r.isError ? null : (() => { try { return JSON.parse(t); } catch { return null; } })() };
    };
    await hub.createProject({ name: "Wet World", width: 256, height: 256, kmPerPx: 4 });
    expect((await call("add_landmass", { shape: { type: "circle", x: 128, y: 128, r: 100 }, seed: 2 })).error).toBe(false);
    expect((await call("add_climate_region", { name: "Wet", shape: { type: "rect", x: 20, y: 20, w: 216, h: 216 }, temperature: 0.5, moisture: 0.85 })).error).toBe(false);

    const bad = await call("paint_biome", { circle: { x: 128, y: 128, r: 30 } });
    expect(bad.error).toBe(true); // (no ground named)
    const done = await call("paint_biome", { ground: "desert", circle: { x: 128, y: 128, r: 30 } });
    expect(done.error).toBe(false);
    expect(done.json.painted_km2_on_map).toBeGreaterThan(1000);
    expect(hub.session.doc.features?.groundCells).toBeDefined();

    expect((await call("select_area", { shape: { type: "circle", x: 128, y: 128, r: 15 } })).error).toBe(false);
    const sel = await call("get_selection", {});
    const biomes = (sel.json.biomes ?? []) as { name: string; share: number }[];
    expect(biomes[0]).toMatchObject({ name: "desert" });

    expect((await call("paint_biome", { erase: true, circle: { x: 128, y: 128, r: 40 } })).error).toBe(false);
    expect(hub.session.doc.features?.groundCells).toBeUndefined(); // (nothing left painted: the painting is cleared)
    const after = await call("get_selection", {});
    expect(((after.json.biomes ?? []) as { name: string }[])[0]?.name).not.toBe("desert");
    // and one step undoes it
    await call("undo", {});
    expect(hub.session.doc.features?.groundCells).toBeDefined();

    await hub.createCity?.({ name: "Town", widthM: 400, heightM: 300 } as never).catch(() => {});
    if (hub.session.doc.meta.kind === "city") expect((await call("paint_biome", { ground: "desert", circle: { x: 10, y: 10, r: 5 } })).error).toBe(true);
    await hub.close();
  });
});
