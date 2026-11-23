/** Claude's realm tools on a world map (core realms.ts, tools realmTools.ts). */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { riskOf, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-realm-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const call = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("realm tools", () => {
  it("add realms, paint them inside a border and round a neighbour, list their sizes, and ask before renaming or removing one", async () => {
    const dir = path.join(root, "a"); mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    await hub.createProject({ name: "World", width: 256, height: 256, kmPerPx: 4 });
    // all land
    hub.session.execute({ op: "replace_heights", data: new Float32Array(256 * 256).fill(200) }, "system");
    await call(hub, "add_line", { kind: "border", name: "Old March", points: [[10, 10], [120, 10], [120, 120], [10, 120]], closed: true });
    await call(hub, "add_realm", { name: "Westmarch" });
    await expect(call(hub, "add_realm", { name: "westmarch" })).rejects.toThrow(/already a realm/);
    await call(hub, "add_realm", { name: "Eastfold", colour: "#336699" });
    const a = await call(hub, "paint_realm", { realm: "Westmarch", inside: "Old March" });
    expect(a.km2).toBeGreaterThan(100000);
    // a big circle round the middle, only where nobody is yet
    await call(hub, "paint_realm", { realm: "Eastfold", circle: { x: 128, y: 128, r: 100 }, only_empty: true });
    const list = (await call(hub, "list_realms")).realms as { name: string; km2: number }[];
    expect(list.find((r) => r.name === "Westmarch")!.km2).toBe(a.km2);
    expect(list.find((r) => r.name === "Eastfold")!.km2).toBeGreaterThan(0);
    const ctx = hub.toolContext("mcp");
    expect(await riskOf(ctx, "remove_realm", { realm: "Eastfold" })).toBe('Remove the realm "Eastfold" and its painting');
    expect(await riskOf(ctx, "update_realm", { realm: "Eastfold", name: "Eastmark" })).toBe('Rename the realm "Eastfold" to "Eastmark"');
    expect(await riskOf(ctx, "update_realm", { realm: "Eastfold", colour: "#112233" })).toBeNull();
    await call(hub, "remove_realm", { realm: "Eastfold" });
    expect((await call(hub, "list_realms")).realms).toHaveLength(1);
    // refused on a battlemap
    await call(hub, "create_battlemap", { name: "Cellar", squares_x: 10, squares_y: 10 });
    expect((await runTool(hub.toolContext("mcp"), "list_realms", {})).isError).toBe(true);
    await hub.close();
  });
});
