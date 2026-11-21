import { describe, expect, it } from "vitest";
import { MapSession, createDoc, type Command, type ProjectInfo } from "@mapmaker/core";
import jpeg from "jpeg-js";
import { type ToolContext, LOOK_ONLY_TOOLS, TOOLS, runTool, toolJsonSchemas } from "../src/index.ts";

function memoryContext(): ToolContext & { brief: string } {
  const sessions = new Map<string, MapSession>();
  let open: string | null = null;
  const refs = new Map<string, Uint8Array>();
  const red = new Uint8Array(64 * 48 * 4).fill(200);
  refs.set("sketch.jpg", new Uint8Array(jpeg.encode({ width: 64, height: 48, data: Buffer.from(red) }, 90).data));
  const ctx = {
    brief: "# Brief\n",
    session() {
      if (!open) throw new Error("No project is open");
      return sessions.get(open) as MapSession;
    },
    projectId: () => open,
    execute(cmd: Command, label?: string) {
      return ctx.session().execute(cmd, "claude", label);
    },
    undo: () => ctx.session().undo("claude"),
    redo: () => ctx.session().redo("claude"),
    listProjects: (): ProjectInfo[] => [...sessions.values()].map((s) => ({
      id: s.doc.meta.id, name: s.doc.meta.name, width: s.doc.meta.width, height: s.doc.meta.height,
      kmPerPx: s.doc.meta.kmPerPx, updatedAt: s.doc.meta.updatedAt,
    })),
    async openProject(id: string) {
      if (!sessions.has(id)) throw new Error(`no project ${id}`);
      open = id;
    },
    async createProject(o: { name: string; width: number; height: number; kmPerPx: number }) {
      const id = o.name.toLowerCase().replace(/\W+/g, "-");
      sessions.set(id, new MapSession(createDoc({ id, ...o })));
      open = id;
      return ctx.listProjects().find((p) => p.id === id) as ProjectInfo;
    },
    async readBrief() { return ctx.brief; },
    async writeBrief(t: string) { ctx.brief = t; },
    async listRefs() { return [...refs.entries()].map(([name, b]) => ({ name, url: `/refs/${name}`, bytes: b.byteLength })); },
    async readRef(name: string) { return refs.get(name) ?? null; },
  };
  return ctx;
}

describe("tools", () => {
  it("no two tools share a name (the second would never be reached)", () => {
    const seen = new Set<string>(), twice = TOOLS.map((t) => t.name).filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    expect(twice).toEqual([]);
  });

  it("the tools that only look take `map` (another map), and every one of them exists; a tool that changes things refuses it", async () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const n of LOOK_ONLY_TOOLS) expect(names.has(n), `${n} is a tool`).toBe(true);
    const schemas = toolJsonSchemas();
    expect((schemas.find((s) => s.name === "list_places")!.inputSchema.properties as Record<string, unknown>).map).toBeTruthy();
    expect((schemas.find((s) => s.name === "add_place")!.inputSchema.properties as Record<string, unknown>).map).toBeUndefined();
    const ctx = memoryContext();
    await ctx.createProject({ name: "One", width: 64, height: 64, kmPerPx: 2 });
    const r = await runTool(ctx, "add_place", { map: "Other", name: "X", type: "village", x: 5, y: 5 });
    expect(r.isError).toBe(true);
    expect(ctx.session().doc.features?.places ?? []).toHaveLength(0);
    // and with no way to look at other maps here, it says so
    expect((await runTool(ctx, "list_places", { map: "Other" })).isError).toBe(true);
  });

  it("every tool has a JSON schema with type object", () => {
    const schemas = toolJsonSchemas();
    expect(schemas.length).toBe(TOOLS.length);
    for (const s of schemas) {
      expect(s.inputSchema.type).toBe("object");
      expect(s.description.length).toBeGreaterThan(20);
    }
    const shape = JSON.stringify(schemas.find((s) => s.name === "sculpt")?.inputSchema);
    expect(shape).toContain("circle");
  });

  it("builds an island with a mountain range and previews it (the M0 exit scenario)", async () => {
    const ctx = memoryContext();
    let r = await runTool(ctx, "create_map", { name: "Test Isle", width: 256, height: 256, km_per_px: 1, seed: 1 });
    expect(r.isError).toBeFalsy();
    r = await runTool(ctx, "add_landmass", { shape: { type: "circle", x: 128, y: 128, r: 60 }, height_m: 200, seed: 2 });
    expect(r.isError).toBeFalsy();
    r = await runTool(ctx, "add_mountain_range", { path: [[95, 90], [85, 128], [95, 166]], width_px: 8, peak_m: 2400, seed: 3 });
    expect(r.isError).toBeFalsy();
    const q = await runTool(ctx, "query_points", { points: [[128, 128], [88, 128], [5, 5]] });
    const pts = JSON.parse((q.content[0] as { text: string }).text);
    expect(pts[0].is_land).toBe(true);
    expect(pts[1].elevation_m).toBeGreaterThan(pts[0].elevation_m + 500);
    expect(pts[2].is_land).toBe(false);
    const prev = await runTool(ctx, "render_preview", { max_size: 512 });
    const img = prev.content.find((c) => c.type === "image");
    expect(img).toBeTruthy();
    const decoded = jpeg.decode(Buffer.from((img as { data: string }).data, "base64"));
    expect(decoded.width).toBe(512);
  });

  it("refuses to wipe an existing map without replace_existing", async () => {
    const ctx = memoryContext();
    await runTool(ctx, "create_map", { name: "A", width: 128, height: 128, template: "island", seed: 4 });
    const r = await runTool(ctx, "generate_terrain", { template: "archipelago" });
    expect(r.isError).toBe(true);
    const ok = await runTool(ctx, "generate_terrain", { template: "archipelago", replace_existing: true, seed: 5 });
    expect(ok.isError).toBeFalsy();
  });

  it("reports changes by author and undoes", async () => {
    const ctx = memoryContext();
    await runTool(ctx, "create_map", { name: "B", width: 128, height: 128 });
    ctx.session().execute({ op: "sculpt", params: { mode: "raise", shape: { type: "circle", x: 50, y: 50, r: 10 }, amountM: 3500 } }, "user", "Raise stroke");
    const ch = await runTool(ctx, "get_changes_since", { since: 1 });
    expect((ch.content[0] as { text: string }).text).toContain("by user: Raise stroke");
    const u = await runTool(ctx, "undo", {});
    expect((u.content[0] as { text: string }).text).toContain("Raise stroke");
  });

  it("validates input and reports errors instead of throwing", async () => {
    const ctx = memoryContext();
    const r1 = await runTool(ctx, "render_preview", {});
    expect(r1.isError).toBe(true); // no project open
    await runTool(ctx, "create_map", { name: "C", width: 128, height: 128 });
    const r2 = await runTool(ctx, "sculpt", { mode: "explode", shape: { type: "all" } });
    expect(r2.isError).toBe(true);
    expect((r2.content[0] as { text: string }).text).toContain("Invalid input");
  });

  it("appends to the brief and views references with crops", async () => {
    const ctx = memoryContext();
    await runTool(ctx, "update_brief", { mode: "append", text: "## Decision\nNorth is cold." });
    expect(ctx.brief).toContain("North is cold.");
    const v = await runTool(ctx, "view_reference", { name: "sketch.jpg", region: { x: 0, y: 0, w: 32, h: 24 }, max_size: 256 });
    expect(v.isError).toBeFalsy();
    expect(v.content.some((c) => c.type === "image")).toBe(true);
  });
});
