/**
 * The city picture reader through the server: a town drawn by Dragon Drop's own renderer (every building known), added as a reference picture, laid over a new city, read
 * back by roof colour (on the compute thread), checked, added in one edit, and read again (nothing twice).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type MapBuilding, createCityDoc, polygonCentroid, rectPolygon, renderCity } from "@mapmaker/core";
import { encodePng, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-reader-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await tool(hub, name, input);
  if (r.isError) throw new Error(`${name}: ${textOf(r)}`);
  return JSON.parse(textOf(r));
};

/** A 300 x 200 m town of known buildings in three roof colours on grass, with a grey cobbled square the colour of slate, drawn as a picture (4 px a metre). */
function townPicture() {
  const d = createCityDoc({ id: "src", name: "Src", widthM: 300, heightM: 200 });
  const { w, data } = d.height, cell = d.meta.city!.cellM;
  for (let y = 0; y < d.height.h; y++) for (let x = 0; x < w; x++) if (Math.hypot((x + 0.5) * cell - 150, (y + 0.5) * cell - 100) < 20) data[y * w + x] = 2; // (cobblestone)
  const looks = ["tile", "slate", "thatch"] as const, buildings: MapBuilding[] = [];
  let n = 0;
  for (let x = 25; x < 280; x += 16) for (const y of [40, 160]) buildings.push({ id: `b${n}`, points: rectPolygon(x, y, 9 + (n % 3), 11, (n % 5) * 3), roof: looks[n++ % 3], colour: undefined });
  d.features = { ...d.features!, buildings };
  const r = renderCity(d, { maxSize: 1200, contours: false });
  return { png: encodePng(r.img), buildings, w: r.img.w };
}

describe("the city picture reader", () => {
  it("reads a town's buildings from its picture, shows them, adds them in one edit, and doesn't add them twice", async () => {
    const dir = path.join(root, "a");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    await ok(hub, "create_city", { name: "Read Town", width_m: 300, height_m: 200 });
    const pic = townPicture();
    await hub.addReference(hub.activeId!, "town.png", pic.png);
    await ok(hub, "set_trace_picture", { name: "town.png", x: 0, y: 0, scale: 300 / pic.w, rotation: 0 });
    const centre = (b: MapBuilding) => polygonCentroid(b.points as [number, number][]);
    const roofs = (["tile", "slate", "thatch"] as const).map((look) => { const [x, y] = centre(pic.buildings.find((b) => b.roof === look)!); return { x, y, roof: look }; });
    // a look first: counted and drawn, nothing added
    const before = hub.session.seq;
    const look = await tool(hub, "read_picture_buildings", { roofs, ground: [[10, 100], [150, 100]] });
    if (look.isError) throw new Error(textOf(look));
    const counts = JSON.parse(textOf(look));
    expect(counts.found).toBeGreaterThanOrEqual(pic.buildings.length - 1);
    expect(counts.found).toBeLessThanOrEqual(pic.buildings.length + 1);
    expect((look.content as { type: string }[]).some((c) => c.type === "image")).toBe(true);
    expect(hub.session.seq).toBe(before);
    // then added, in one edit, with the right roof looks
    const added = await ok(hub, "read_picture_buildings", { roofs, ground: [[10, 100], [150, 100]], add: true });
    expect(added.added).toBe(counts.found);
    expect(hub.session.seq).toBe(before + 1);
    const city = hub.session.doc.features!.buildings!;
    const tiled = pic.buildings.filter((b) => b.roof === "tile").map(centre);
    expect(tiled.filter(([x, y]) => city.some((b) => b.roof === "tile" && Math.hypot(centre(b)[0] - x, centre(b)[1] - y) < 2)).length).toBeGreaterThanOrEqual(tiled.length - 1);
    // read again: everything is already there
    const again = JSON.parse(textOf(await tool(hub, "read_picture_buildings", { roofs, ground: [[10, 100], [150, 100]] })));
    expect(again.found).toBe(0);
    expect(again.already_on_the_map).toBeGreaterThanOrEqual(counts.found - 1);
    // without a trace picture it says what to do
    await ok(hub, "clear_trace_picture");
    expect(textOf(await tool(hub, "read_picture_buildings", { roofs }))).toMatch(/Trace over map/);
    await hub.close();
  }, 60000);
});
