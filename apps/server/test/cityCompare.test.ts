/** The yardstick through Claude's tool: a settlement made from a picture, measured against it on the compute thread (cityCompare.ts, Hub.compareCityTrace). */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { encodePng, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-citycompare-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => { const r = await tool(hub, name, input); if (r.isError) throw new Error(`${name}: ${textOf(r)}`); return r; };

describe("compare_to_trace", () => {
  it("measures a settlement against the picture it is redrawn from, with the squares furthest off and a tinted picture", async () => {
    const dir = path.join(root, "p1");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    await ok(hub, "create_city", { name: "First", width_m: 300, height_m: 200 });
    // a picture: green ground, a grey street, a row of red roofs
    const w = 400, h = 200, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, street = y >= 95 && y < 105, roof = y >= 70 && y < 85 && x % 30 < 18;
      const c = roof ? [180, 70, 55] : street ? [200, 196, 180] : [110, 160, 90];
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    await hub.addReference(hub.activeId!, "town.png", encodePng({ w, h, data }));
    // (no trace picture over this map yet: it says how to start)
    expect(textOf(await tool(hub, "compare_to_trace"))).toMatch(/Lay the picture over the city first/);
    await ok(hub, "create_city", { name: "Redraw", width_m: 400, height_m: 200, picture: "town.png" });
    await ok(hub, "add_streets", { streets: [{ points: [[0, 100], [400, 100]], width: 10, kind: "street" }] });
    // half the roofs
    const roofs = Array.from({ length: 7 }, (_, i) => ({ points: [[i * 60, 70], [i * 60 + 18, 70], [i * 60 + 18, 85], [i * 60, 85]], roof: "tile" }));
    await ok(hub, "add_buildings", { buildings: roofs, roof_assets: "none" });
    const r = await ok(hub, "compare_to_trace", { square_m: 100 });
    const out = JSON.parse(textOf(r));
    expect(out.roofs.map_on_it_pct).toBeGreaterThan(90);
    expect(out.roofs.picture_covered_pct).toBeGreaterThan(40);
    expect(out.roofs.picture_covered_pct).toBeLessThan(60);
    expect(out.roofs.separate_roofs_in_picture).toBe(14);
    expect(out.roofs.buildings_on_map).toBe(7);
    expect(out.streets.width_map_over_picture.median).toBeCloseTo(1, 1);
    expect(out.furthest_off_squares.length).toBeGreaterThan(0);
    expect((r.content as { type: string }[]).some((c) => c.type === "image")).toBe(true);
    await hub.close();
  });
});
