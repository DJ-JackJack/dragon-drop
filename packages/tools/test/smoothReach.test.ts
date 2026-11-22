// Claude's sculpt tool with reach_px: softens a wide step; reach_px is refused on any mode but smooth.
import { describe, expect, it } from "vitest";
import { MapSession, createDoc } from "@mapmaker/core";
import { type ToolContext, runTool } from "../src/index.ts";

function context() {
  const doc = createDoc({ id: "w", name: "W", width: 120, height: 60, kmPerPx: 2 });
  for (let y = 0; y < 60; y++) for (let x = 0; x < 120; x++) doc.height.data[y * 120 + x] = x < 60 ? 200 : 500;
  doc.meta.seaLevel = 0;
  const session = new MapSession(doc);
  const ctx = {
    session: () => session, projectId: () => "w",
    execute: (cmd: never, label?: string) => session.execute(cmd, "claude", label),
    undo: () => session.undo("claude"), redo: () => session.redo("claude"),
  } as unknown as ToolContext;
  return { ctx, session };
}

describe("sculpt smooth with reach_px", () => {
  it("softens a wide step, as one undo step", async () => {
    const { ctx, session } = context();
    const r = await runTool(ctx, "sculpt", { mode: "smooth", shape: { type: "rect", x: 20, y: 5, w: 80, h: 50 }, strength: 1, reach_px: 30 });
    expect(r.isError).toBeFalsy();
    const h = session.doc.height;
    expect(Math.abs(h.get(60, 30) - h.get(59, 30))).toBeLessThan(15);
    session.undo("claude");
    expect(h.get(60, 30) - h.get(59, 30)).toBe(300);
  });

  it("refuses reach_px on another mode", async () => {
    const { ctx } = context();
    const r = await runTool(ctx, "sculpt", { mode: "raise", shape: { type: "circle", x: 60, y: 30, r: 10 }, amount_m: 50, reach_px: 30 });
    expect(r.isError).toBe(true);
  });
});
