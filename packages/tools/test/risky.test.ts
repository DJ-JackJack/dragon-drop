// What the AI asks the DM about before doing it (risky.ts), and that runTool waits for the answer.
import { describe, expect, it } from "vitest";
import { MapSession, createDoc } from "@mapmaker/core";
import { type ToolContext, MANY_AT_ONCE, RISKY_TOOLS, TOOLS, riskOf, runTool } from "../src/index.ts";

function context(answer: "allowed" | "refused" | "timeout" | "nobody" | null) {
  const doc = createDoc({ id: "w", name: "W", width: 64, height: 64, kmPerPx: 2 });
  doc.height.data.fill(-100);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) doc.height.data[y * 64 + x] = 200;
  const session = new MapSession(doc);
  const asked: string[] = [];
  let brief = "# Brief\n" + "Established facts. ".repeat(30);
  const ctx = {
    session: () => session, projectId: () => "w",
    execute: (cmd: never, label?: string) => session.execute(cmd, "claude", label),
    undo: () => session.undo("claude"), redo: () => session.redo("claude"),
    listProjects: () => [], openProject: async () => {}, createProject: async () => { throw new Error("no"); },
    readBrief: async () => brief, writeBrief: async (t: string) => { brief = t; },
    listRefs: async () => [], readRef: async () => null,
    ...(answer && { confirm: async (o: { text: string }) => { asked.push(o.text); return answer; } }),
  } as unknown as ToolContext;
  return { ctx, session, asked, brief: () => brief };
}

describe("what asks the DM first", () => {
  it("names only real tools", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const n of RISKY_TOOLS) expect(names.has(n), n).toBe(true);
  });

  it("says what would happen in plain words, and lets ordinary calls through", async () => {
    const { ctx } = context("allowed");
    await runTool(ctx, "add_place", { name: "Gate Town", type: "town", x: 30, y: 30 });
    const id = ctx.session().doc.features!.places[0].id;
    expect(await riskOf(ctx, "remove_place", { place: "gate town" })).toBe('Remove the place "Gate Town"');
    expect(await riskOf(ctx, "remove_place", { place: id })).toBe('Remove the place "Gate Town"');
    expect(await riskOf(ctx, "remove_place", { place: "Nowhere" })).toBeNull(); // (the tool itself says it isn't there)
    expect(await riskOf(ctx, "generate_terrain", { template: "island", replace_existing: true })).toMatch(/^Replace all the land on this map/);
    expect(await riskOf(ctx, "update_brief", { mode: "replace", text: "x" })).toMatch(/^Rewrite the whole brief/);
    expect(await riskOf(ctx, "update_brief", { mode: "append", text: "x" })).toBeNull();
    expect(await riskOf(ctx, "carve_valleys", { preview: true })).toBeNull();
    expect(await riskOf(ctx, "carve_valleys", {})).toBe("Carve valleys along every river on the map");
    expect(await riskOf(ctx, "copy_from_map", { map: "Old", what: ["places"] })).toBeNull();
    expect(await riskOf(ctx, "copy_from_map", { map: "Old", what: ["terrain"] })).toBe('Copy the land of "Old" over this map');
    expect(await riskOf(ctx, "remove_walls", { ids: ["a", "b"] })).toBeNull();
    expect(await riskOf(ctx, "remove_walls", { ids: Array.from({ length: MANY_AT_ONCE }, (_, k) => `w${k}`) })).toBe(`Remove ${MANY_AT_ONCE} walls, doors and windows at once`);
    expect(await riskOf(ctx, "add_place", { name: "X", type: "town", x: 1, y: 1 })).toBeNull();
  });

  it("does nothing when the DM says no, and goes ahead when they say yes", async () => {
    const no = context("refused");
    await runTool(no.ctx, "add_place", { name: "Gate Town", type: "town", x: 30, y: 30 });
    const r = await runTool(no.ctx, "remove_place", { place: "Gate Town" });
    expect(r.isError).toBe(true);
    expect(no.asked).toEqual(['Remove the place "Gate Town"']);
    expect(no.ctx.session().doc.features!.places).toHaveLength(1);
    const kept = no.brief();
    expect((await runTool(no.ctx, "update_brief", { mode: "replace", text: "Nothing." })).isError).toBe(true);
    expect(no.brief()).toBe(kept);

    const yes = context("allowed");
    await runTool(yes.ctx, "add_place", { name: "Gate Town", type: "town", x: 30, y: 30 });
    expect((await runTool(yes.ctx, "remove_place", { place: "Gate Town" })).isError).toBeFalsy();
    expect(yes.ctx.session().doc.features!.places).toHaveLength(0);
  });

  it("asks nothing where nobody can be asked (a context without confirm)", async () => {
    const free = context(null);
    await runTool(free.ctx, "add_place", { name: "Gate Town", type: "town", x: 30, y: 30 });
    expect((await runTool(free.ctx, "remove_place", { place: "Gate Town" })).isError).toBeFalsy();
  });
});
