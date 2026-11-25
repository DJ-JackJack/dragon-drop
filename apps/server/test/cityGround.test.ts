/** A settlement's ground in its trace picture's colours (cityGround.ts, Hub.cityGroundFromPicture, set_ground_colours), set by hand, reset, undone and drawn. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { citySpec, renderCity } from "@mapmaker/core";
import { encodePng, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-cityground-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fresh = () => { const dir = path.join(root, `p${Date.now()}${Math.random()}`.replace(".", "")); mkdirSync(dir, { recursive: true }); return new Hub(new ProjectStore(dir), null); };
const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => { const r = await tool(hub, name, input); if (r.isError) throw new Error(`${name}: ${textOf(r)}`); return JSON.parse(textOf(r)); };
const near = (hex: string, rgb: number[], tol = 6) => [1, 3, 5].every((k, i) => Math.abs(parseInt(hex.slice(k, k + 2), 16) - rgb[i]) <= tol);

describe("a settlement's ground in its picture's colours", () => {
  it("takes each painted kind's colour from the trace picture, as one edit that Undo takes back", async () => {
    const hub = fresh();
    await ok(hub, "create_city", { name: "First", width_m: 300, height_m: 200 });
    // a picture: pale green on the left, dark parchment on the right
    const w = 400, h = 200, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, c = x < w / 2 ? [180, 208, 160] : [140, 110, 70]; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; }
    await hub.addReference(hub.activeId!, "found.png", encodePng({ w, h, data }));
    await ok(hub, "create_city", { name: "Redraw", width_m: 400, height_m: 300, picture: "found.png" });
    expect(citySpec(hub.session.doc).heightM).toBe(200);
    await ok(hub, "paint_ground", { shape: { type: "polygon", points: [[200, 0], [400, 0], [400, 200], [200, 200]] }, material: "sand" });
    await ok(hub, "add_buildings", { buildings: [{ points: [[40, 40], [80, 40], [80, 80], [40, 80]] }], roof_assets: "none" });

    const r = await ok(hub, "set_ground_colours", { from_picture: true });
    expect(Object.keys(r.coloured_from_picture).sort()).toEqual(["grass", "sand"]);
    const g = citySpec(hub.session.doc).ground!;
    expect(near(g.grass, [180, 208, 160])).toBe(true);
    expect(near(g.sand, [140, 110, 70])).toBe(true);
    // the picture of the map is drawn in them (the ground shaded a little, so roughly)
    const pic = renderCity(hub.session.doc, { maxSize: 200 }).img, at = (x: number, y: number) => { const o = (y * pic.w + x) * 4; return [pic.data[o], pic.data[o + 1], pic.data[o + 2]]; };
    expect(near(g.grass, at(10, 90), 25)).toBe(true);
    expect(near(g.sand, at(190, 90), 25)).toBe(true);
    // one step back
    expect(textOf(await tool(hub, "undo"))).toMatch(/Undo: Ground colours from the picture/);
    expect(citySpec(hub.session.doc).ground).toBeUndefined();
  });

  it("sets and resets them by hand, and refuses what isn't a ground or a colour", async () => {
    const hub = fresh();
    await ok(hub, "create_city", { name: "Hand", width_m: 300, height_m: 200 });
    await ok(hub, "set_ground_colours", { colours: { Grass: "#a0c090", sand: "#c0a070" } });
    expect(citySpec(hub.session.doc).ground).toEqual({ grass: "#a0c090", sand: "#c0a070" });
    await ok(hub, "set_ground_colours", { reset: ["sand"] });
    expect(citySpec(hub.session.doc).ground).toEqual({ grass: "#a0c090" });
    expect((await tool(hub, "set_ground_colours", { colours: { moss: "#00ff00" } })).isError).toBe(true);
    expect((await tool(hub, "set_ground_colours", { colours: { grass: "green" } })).isError).toBe(true);
    // with no trace picture laid over the map, it says how to start
    expect(textOf(await tool(hub, "set_ground_colours", { from_picture: true }))).toMatch(/Lay the picture over the city first/);
    await ok(hub, "set_ground_colours", { reset: "all" });
    expect(citySpec(hub.session.doc).ground).toBeUndefined();
  });
});
