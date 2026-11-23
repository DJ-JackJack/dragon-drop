/** Fewer rivers, or none, on a world map (a playtester's desert continent, 2026-11-23): new maps and detail maps have rivers that follow the rain, and the rain's rivers can be turned off. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-rivers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const tool = (hub: Hub, name: string, input: Record<string, unknown> = {}) => runTool(hub.toolContext("mcp"), name, input);
const textOf = (r: Awaited<ReturnType<typeof tool>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await tool(hub, name, input);
  if (r.isError) throw new Error(`${name}: ${textOf(r)}`);
  return JSON.parse(textOf(r));
};
/** The water report, once it reflects the newest change. */
const riversNow = async (hub: Hub, until: (n: number) => boolean) => {
  let n = -1;
  for (let i = 0; i < 80; i++) {
    n = (await ok(hub, "check_hydrology")).riverCount;
    if (until(n)) return n;
    await new Promise((r) => setTimeout(r, 250));
  }
  return n;
};

describe("rivers that follow the rain, and none at all", () => {
  it("makes new maps and detail maps with rivers that need real rain, and takes the rain's rivers away when asked", async () => {
    const dir = path.join(root, "p1");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    await hub.createProject({ name: "Dry Lands", width: 256, height: 256, kmPerPx: 4 });
    expect(hub.session.doc.meta.climate?.riversFollowRain).toBe(true);
    await ok(hub, "generate_terrain", { template: "continent", seed: 7 });
    const some = await riversNow(hub, (n) => n > 0);
    expect(some).toBeGreaterThan(0);
    // no rivers from the rain: none left (lakes stay)
    await ok(hub, "set_climate", { no_rain_rivers: true });
    expect(await riversNow(hub, (n) => n === 0)).toBe(0);
    // a spring still makes its river
    await ok(hub, "add_river_source", { x: 128, y: 128, size: "major" });
    expect(await riversNow(hub, (n) => n > 0)).toBeGreaterThan(0);
    await ok(hub, "set_climate", { no_rain_rivers: false });
    // a detail map takes rivers that follow the rain, whatever the world map had
    await ok(hub, "set_climate", { rivers_follow_rain: false });
    await ok(hub, "create_regional_map", { name: "Dry Detail", region: { x: 64, y: 64, w: 96, h: 96 } });
    expect(hub.session.doc.meta.parent).toBeTruthy();
    expect(hub.session.doc.meta.climate?.riversFollowRain).toBe(true);
    await hub.close();
  });
});
