/** A name's own size (nameSize), set through Claude's tools on a world map and a settlement, and kept when other things about it change. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-namesize-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const fresh = () => {
  const dir = path.join(root, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  return new Hub(new ProjectStore(dir), null);
};
const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await tool(hub, name, input);
  if (r.isError) throw new Error(`${name}: ${textOf(r)}`);
  return JSON.parse(textOf(r));
};

describe("a name's own size", () => {
  it("on a world map: a place's and a realm's, set, kept through other changes, and back to usual", async () => {
    const hub = fresh();
    await ok(hub, "create_map", { name: "Sizes", width: 128, height: 128, km_per_px: 2, seed: 3 });
    const place = () => hub.session.doc.features!.places.find((p) => p.name === "Harbour")!;
    await ok(hub, "add_place", { name: "Harbour", type: "town", x: 40, y: 40, name_size: 1.6 });
    expect(place().nameSize).toBe(1.6);
    await ok(hub, "update_place", { place: "Harbour", notes: "busy" });
    expect(place().nameSize).toBe(1.6);
    await ok(hub, "update_place", { place: "Harbour", name_size: 1 });
    expect(place()).not.toHaveProperty("nameSize");
    expect((await tool(hub, "update_place", { place: "Harbour", name_size: 7 })).isError).toBe(true); // (out of range)

    await ok(hub, "add_realm", { name: "The March" });
    await ok(hub, "update_realm", { realm: "The March", name_size: 0.7 });
    expect(hub.session.doc.features!.realms!.find((r) => r.name === "The March")!.nameSize).toBe(0.7);
  });

  it("on a settlement: a street's, a building's and a district's, kept through other changes", async () => {
    const hub = fresh();
    await ok(hub, "create_city", { name: "Size Town", width_m: 400, height_m: 300 });
    const f = () => hub.session.doc.features!;
    const st = await ok(hub, "add_streets", { streets: [{ points: [[20, 150], [380, 150]], kind: "street", name: "High Street" }, { points: [[200, 20], [200, 280]], kind: "lane" }] });
    const [high, lane] = st.ids as string[];
    await ok(hub, "update_streets", { changes: [{ id: high, name_size: 1.5 }, { id: lane, name_size: 2 }] });
    expect(f().streets!.find((s) => s.id === high)!.nameSize).toBe(1.5);
    expect(f().streets!.find((s) => s.id === lane)).not.toHaveProperty("nameSize"); // (no name, nothing to size)
    await ok(hub, "update_streets", { changes: [{ id: high, width: 12 }] });
    expect(f().streets!.find((s) => s.id === high)).toMatchObject({ width: 12, nameSize: 1.5 });

    const b = await ok(hub, "add_buildings", { buildings: [{ points: [[50, 50], [80, 50], [80, 80], [50, 80]], name: "Guildhall" }], roof_assets: "none" });
    await ok(hub, "update_buildings", { ids: b.ids, name_size: 2.2 });
    expect(f().buildings!.find((x) => x.id === b.ids[0])!.nameSize).toBe(2.2);
    await ok(hub, "update_buildings", { ids: b.ids, roof: "tile" });
    expect(f().buildings!.find((x) => x.id === b.ids[0])!.nameSize).toBe(2.2);

    const d = await ok(hub, "add_city_districts", { districts: [{ points: [[0, 0], [200, 0], [200, 150], [0, 150]], name: "Old Ward" }] });
    const did = d.added[0].id;
    await ok(hub, "update_city_districts", { changes: [{ id: did, name_size: 1.3 }] });
    await ok(hub, "update_city_districts", { changes: [{ id: did, colour: "#aa3344" }] });
    expect(f().districts!.find((x) => x.id === did)).toMatchObject({ colour: "#aa3344", nameSize: 1.3 });
  });
});
