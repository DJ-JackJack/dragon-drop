// compare_maps' default area: the pictures of two linked maps show the same place.
import { describe, expect, it } from "vitest";
import type { LinkedMap } from "@mapmaker/core";
import { overlapOn } from "../src/mapTools.ts";

const world: LinkedMap = { id: "w", name: "World", kind: "world", width: 2048, height: 2048, kmPerPx: 4 };
const detail: LinkedMap = { id: "r", name: "Detail", kind: "world", width: 2048, height: 2048, kmPerPx: 0.25, parent: { id: "w", name: "World", rect: { x: 1655, y: 1795, w: 128, h: 128 }, factor: 16 } };
const copy: LinkedMap = { ...world, id: "w2", name: "World after", copiedFrom: { id: "w", name: "World", at: "2026-11-21T00:00:00Z" } };
const scene: LinkedMap = {
  id: "b", name: "Scene", width: 60, height: 40, kmPerPx: 0.001, kind: "battle",
  battle: { squaresX: 30, squaresY: 20, pxPerSquare: 70, feetPerSquare: 5, sub: 2, gridType: "square" }, origin: { id: "w", name: "World", x: 2040, y: 300 },
};
const maps = new Map([world, detail, copy, scene].map((m) => [m.id, m]));
const size = (m: LinkedMap) => (m.kind === "battle" ? { w: m.battle!.squaresX, h: m.battle!.squaresY } : { w: m.width, h: m.height });
const on = (a: LinkedMap, b: LinkedMap) => overlapOn(a, b, size(a), size(b), maps);

describe("compare_maps' area when none is given", () => {
  it("a world map (or a copy of it) with its detail map: the detail map's area", () => {
    expect(on(world, detail)).toEqual({ x: 1655, y: 1795, w: 128, h: 128 });
    expect(on(copy, detail)).toEqual({ x: 1655, y: 1795, w: 128, h: 128 });
  });
  it("the detail map with its world map, and a copy with its original: the whole of the first", () => {
    expect(on(detail, world)).toEqual({ x: 0, y: 0, w: 2048, h: 2048 });
    expect(on(copy, world)).toEqual({ x: 0, y: 0, w: 2048, h: 2048 });
  });
  it("a battlemap's spot on a world map is widened to a sixteenth of the map, inside it", () => {
    const r = on(world, scene);
    expect(r.w).toBe(128);
    expect(r.h).toBe(128);
    expect(r.x).toBe(2048 - 128); // the spot is near the right edge: the box stays on the map
    expect(r.y + r.h / 2).toBeCloseTo(300, 6);
  });
});
