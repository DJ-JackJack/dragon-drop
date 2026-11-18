import { describe, expect, it } from "vitest";
import { MapSession, createDoc, sculpt } from "../src/index.ts";

describe("features", () => {
  it("adds, edits and removes places and labels with undo", () => {
    const s = new MapSession(createDoc({ id: "f", name: "F", width: 64, height: 64 }));
    s.execute({ op: "features", patch: { upsertPlaces: [{ id: "p1", name: "Test City", type: "capital", x: 10, y: 20 }] } }, "user");
    s.execute({ op: "features", patch: { upsertLabels: [{ id: "l1", text: "Inner Sea", kind: "sea", x: 32, y: 32 }] } }, "claude");
    s.execute({ op: "features", patch: { upsertPlaces: [{ id: "p1", name: "Test City", type: "capital", x: 12, y: 22, notes: "moved" }] } }, "user");
    expect(s.doc.features!.places[0]).toMatchObject({ x: 12, notes: "moved" });
    s.undo("user");
    expect(s.doc.features!.places[0]).toMatchObject({ x: 10 });
    s.execute({ op: "features", patch: { removeLabels: ["l1"] } }, "user");
    expect(s.doc.features!.labels).toHaveLength(0);
    s.undo("user");
    expect(s.doc.features!.labels[0].text).toBe("Inner Sea");
  });

  it("land and water brushes move the coastline", () => {
    const d = createDoc({ id: "c", name: "C", width: 64, height: 64, fill: -300 });
    sculpt(d, { mode: "land", shape: { type: "circle", x: 32, y: 32, r: 10 }, falloff: 0.3 });
    expect(d.height.get(32, 32)).toBeGreaterThan(0);
    expect(d.height.get(5, 5)).toBe(-300);
    sculpt(d, { mode: "water", shape: { type: "circle", x: 32, y: 32, r: 4 }, falloff: 0.3 });
    expect(d.height.get(32, 32)).toBeLessThan(0);
  });
});

describe("label paths", () => {
  it("midpoint, simplify, move and scale", async () => {
    const { pathMidpoint, simplifyPath, moveLabel, scaleFeatures } = await import("../src/index.ts");
    expect(pathMidpoint([[0, 0], [10, 0], [10, 10]])).toEqual([10, 0]);
    const wiggly: [number, number][] = Array.from({ length: 50 }, (_, i) => [i, (i % 2) * 0.2]);
    expect(simplifyPath(wiggly, 0.5)).toEqual([[0, 0], [49, 0.2]]);
    const l = { id: "l", text: "A", kind: "range" as const, x: 5, y: 5, path: [[0, 0], [10, 10]] as [number, number][] };
    expect(moveLabel(l, 2, 3)).toMatchObject({ x: 7, y: 8, path: [[2, 3], [12, 13]] });
    expect(scaleFeatures({ places: [], labels: [l] }, 2).labels[0].path).toEqual([[0, 0], [20, 20]]);
  });
});
