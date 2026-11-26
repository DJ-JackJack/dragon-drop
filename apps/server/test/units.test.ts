// Imperial or metric for Claude: get_map_summary says which units the open map is shown in (Settings' choice, told by the editor, unless the map has its own),
// the ruler answers in them, and a map's own choice is one undo step that changes nothing else.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-units-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("imperial or metric", () => {
  it("tells Claude the map's units: Settings' unless the map chose, and the ruler talks in them", async () => {
    const dir = path.join(root, "maps");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    const call = async (name: string, input: Record<string, unknown>) => {
      const r = await runTool(hub.toolContext("mcp"), name, input);
      const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      return r.isError ? { error: t } : JSON.parse(t);
    };
    await hub.createProject({ name: "Units World", width: 256, height: 256, kmPerPx: 4 });
    const ws = {} as WebSocket;

    expect((await call("get_map_summary", {})).units).toBe("imperial"); // (nobody said otherwise)
    await hub.handleClient(ws, { t: "units_pref", units: "metric" });
    const metric = await call("get_map_summary", {});
    expect(metric.units).toBe("metric");
    expect(metric.units_note).toMatch(/kilometres/);
    expect((await call("measure", { points: [[20, 20], [70, 20]] })).route).toMatch(/^200 km \(124 mi\)/);

    // the map chooses imperial for itself: one undo step, the land and everything else untouched
    const heights = hub.session.doc.height.data.slice();
    hub.session.execute({ op: "set_meta", patch: { units: "imperial" }, label: "Measurements: imperial" }, "user");
    expect((await call("get_map_summary", {})).units).toBe("imperial");
    expect((await call("measure", { points: [[20, 20], [70, 20]] })).route).toMatch(/^124 mi \(200 km\)/);
    expect(hub.session.doc.height.data).toEqual(heights);
    hub.session.undo("user");
    expect(hub.session.doc.meta.units ?? null).toBeNull();
    expect((await call("get_map_summary", {})).units).toBe("metric");
    // back to Settings' choice explicitly (null), and a value that isn't a system is ignored
    hub.session.execute({ op: "set_meta", patch: { units: "metric" } }, "user");
    hub.session.execute({ op: "set_meta", patch: { units: null } }, "user");
    await hub.handleClient(ws, { t: "units_pref", units: "cubits" as never });
    expect((await call("get_map_summary", {})).units).toBe("imperial");
  });

  it("answers in the tabletop's metres on a metric battlemap", async () => {
    const dir = path.join(root, "battle");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    await hub.createBattle({ name: "Units Cellar", squaresX: 20, squaresY: 20 });
    hub.session.execute({ op: "set_meta", patch: { units: "metric" } }, "user");
    const r = await runTool(hub.toolContext("mcp"), "measure", { points: [[0.5, 0.5], [6.5, 0.5]] });
    const j = JSON.parse((r.content as { text: string }[])[0].text);
    expect(j.said).toBe("9 m (6 squares)");
    expect(j.feet).toBe(30); // (the tools keep their own units)
  });
});
