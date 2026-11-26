// What the AI asks the DM about before doing it (risky.ts), and that runTool waits for the answer.
import { describe, expect, it } from "vitest";
import { MapSession, createDoc } from "@mapmaker/core";
import { type ToolContext, MANY_AT_ONCE, RISKY_TOOLS, RISK_NOTE_TOOLS, TOOLS, riskNote, riskOf, runTool } from "../src/index.ts";

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

  it("says in a few plain words what Allow does, for every risky tool, and which can't be undone (those are never allowed all at once)", () => {
    expect(new Set(RISK_NOTE_TOOLS)).toEqual(RISKY_TOOLS);
    for (const n of RISKY_TOOLS) {
      const { note } = riskNote(n);
      expect(note.length, n).toBeLessThan(160);
      expect(note, n).toMatch(/Undo/);
    }
    expect(riskNote("update_brief").undoable).toBe(false);
    expect(riskNote("save_prefab").undoable).toBe(false);
    expect(riskNote("remove_place")).toEqual({ note: "It is taken off the map. Undo brings it back.", undoable: true });
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

  // (added 2026-11-22: a rename replaces the DM's canon as surely as a removal)
  it("asks before renaming a named place, label or region, and not for other changes to them", async () => {
    const { ctx } = context("allowed");
    await runTool(ctx, "add_place", { name: "Gate Town", type: "town", x: 30, y: 30 });
    await runTool(ctx, "add_label", { text: "The Wolds", kind: "region", x: 30, y: 25 });
    expect(await riskOf(ctx, "update_place", { place: "Gate Town", name: "Harbour" })).toBe('Rename the place "Gate Town" to "Harbour"');
    expect(await riskOf(ctx, "update_place", { place: "Gate Town", name: "Gate Town", x: 31 })).toBeNull();
    expect(await riskOf(ctx, "update_place", { place: "Gate Town", notes: "a gate" })).toBeNull();
    expect(await riskOf(ctx, "update_label", { label: "The Wolds", text: "The Downs" })).toBe('Rename the label "The Wolds" to "The Downs"');
    expect(await riskOf(ctx, "name_water", { name: "Silver", x: 3, y: 3 })).toBeNull(); // (naming new water: no name is lost)
    const no = context("refused");
    await runTool(no.ctx, "add_place", { name: "Gate Town", type: "town", x: 30, y: 30 });
    expect((await runTool(no.ctx, "update_place", { place: "Gate Town", name: "Harbour" })).isError).toBe(true);
    expect(no.ctx.session().doc.features!.places[0].name).toBe("Gate Town");
  });

  it("doesn't do it when another map was opened while the DM decided", async () => {
    const { ctx, session } = context("allowed");
    await runTool(ctx, "add_place", { name: "Gate Town", type: "town", x: 30, y: 30 });
    let open = "w";
    const moving = { ...ctx, projectId: () => open, confirm: async () => { open = "copy-of-w"; return "allowed" as const; } } as ToolContext;
    const r = await runTool(moving, "remove_place", { place: "Gate Town" });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/another map or level was opened/);
    expect(session.doc.features!.places).toHaveLength(1);
  });

  it("lets the AI undo only its own changes", async () => {
    const { ctx, session } = context("allowed");
    await runTool(ctx, "add_place", { name: "Mine", type: "town", x: 30, y: 30 });
    session.execute({ op: "features", patch: { upsertPlaces: [{ id: "p-dm", name: "The DM's", type: "town", x: 25, y: 25 }] } }, "user");
    const r = await runTool(ctx, "undo", { steps: 5 });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/made by the DM/);
    expect(session.doc.features!.places.map((p) => p.name).sort()).toEqual(["Mine", "The DM's"]);
    session.undo("user"); // (the DM takes theirs back)
    const mine = await runTool(ctx, "undo", { steps: 5 });
    expect(mine.isError).toBeFalsy();
    expect(session.doc.features!.places).toHaveLength(0);
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
