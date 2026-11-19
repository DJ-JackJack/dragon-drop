/** Stairs, ladders and holes of a battlemap's levels as a Foundry scene's regions. */
import { describe, expect, it } from "vitest";
import {
  type MapConnector, type MapDoc, createBattleDoc, floorRects, foundryConnectorProblems, paintFloor, toFoundryLevelsScene,
} from "../src/index.ts";

const level = (name: string, bottom: number, top: number, connectors: MapConnector[] = [], floor = true): { doc: MapDoc; name: string; bottom: number; top: number; image: string } => {
  const doc = createBattleDoc({ name: "House", squaresX: 12, squaresY: 8, pxPerSquare: 70, feetPerSquare: 5, room: 0 } as never);
  if (floor) paintFloor(doc, { shape: { type: "rect", x: 16, y: 16, w: 64, h: 32 }, material: 4 }); // squares 2..10 by 2..6 (8 cells a square)
  doc.features = { ...doc.features!, connectors };
  return { doc, name, bottom, top, image: `maps/${name}.png` };
};
const c = (id: string, kind: MapConnector["kind"], x: number, y: number, w: number, h: number, to: "up" | "down", name?: string): MapConnector => ({ id, kind, x, y, w, h, to, ...(name && { name }) });
type Region = { name: string; levels: string[]; elevation: { bottom: number; top: number }; shapes: { x: number; y: number; width: number; height: number; hole: boolean }[]; behaviors: { type: string; system: Record<string, unknown> }[] };

describe("the floor as rectangles", () => {
  it("is one rectangle for a plain room, in squares", () => {
    expect(floorRects(level("A", 0, 10).doc)).toEqual([{ x: 2, y: 2, w: 8, h: 4 }]);
  });

  it("is none for an empty floor, and merges an L-shaped floor into two rectangles", () => {
    expect(floorRects(level("A", 0, 10, [], false).doc)).toEqual([]);
    const l = level("A", 0, 10, [], false);
    paintFloor(l.doc, { shape: { type: "rect", x: 16, y: 16, w: 64, h: 16 }, material: 4 });
    paintFloor(l.doc, { shape: { type: "rect", x: 16, y: 32, w: 24, h: 16 }, material: 4 });
    expect(floorRects(l.doc)).toEqual([{ x: 2, y: 2, w: 8, h: 2 }, { x: 2, y: 4, w: 3, h: 2 }]);
  });

  it("reads a floor with too many pieces a square at a time instead of a cell at a time", () => {
    const l = level("A", 0, 10, [], false);
    for (let i = 0; i < 40; i++) paintFloor(l.doc, { shape: { type: "rect", x: 8 + (i % 2) * 8, y: 8 + i * 1, w: 8, h: 1 }, material: 4 }); // a ragged staircase of strips
    expect(floorRects(l.doc, 5).length).toBeLessThanOrEqual(floorRects(l.doc, 100000).length);
  });
});

describe("a Foundry scene from levels with stairs, ladders and holes", () => {
  it("makes a Change Level region over both levels for a stair, and one for a ladder", () => {
    const s = toFoundryLevelsScene([
      level("Cellar", -10, 0, [c("s", "stairs", 3, 3, 1, 2, "up", "Cellar stairs"), c("l", "ladder", 8, 3, 1, 1, "up")]),
      level("Ground floor", 0, 10),
    ]);
    const regions = s.regions as Region[];
    expect(regions).toHaveLength(2);
    const [cellar, ground] = s.levels.map((l) => l._id);
    expect(regions[0]).toMatchObject({ name: "Cellar stairs", levels: [cellar, ground], elevation: { bottom: -10, top: 10 } });
    expect(regions[0].shapes).toEqual([{ type: "rectangle", x: 210, y: 210, width: 70, height: 140, rotation: 0, hole: false }]);
    expect(regions[0].behaviors[0]).toMatchObject({ type: "changeLevel", system: { movementActions: [] } });
    expect(regions[1].name).toBe("Ladder from Cellar to Ground floor");
  });

  it("finds the level above or below by elevation, whatever order the levels are given in", () => {
    // (the Foundry export puts the level being worked on first)
    const s = toFoundryLevelsScene([
      level("Ground floor", 0, 10, [c("d", "stairs", 3, 3, 1, 2, "down"), c("u", "stairs", 7, 3, 1, 2, "up")]),
      level("Cellar", -10, 0),
      level("Attic", 10, 20),
    ]);
    const [ground, cellar, attic] = s.levels.map((l) => l._id);
    const regions = s.regions as Region[];
    expect(regions.map((r) => r.levels)).toEqual([[ground, cellar], [ground, attic]]);
    expect(regions.map((r) => r.elevation)).toEqual([expect.objectContaining({ bottom: -10, top: 10 }), expect.objectContaining({ bottom: 0, top: 20 })]);
  });

  it("counts a stair drawn on both levels (the way up and the landing) once", () => {
    const s = toFoundryLevelsScene([
      level("Cellar", -10, 0, [c("up", "stairs", 3, 3, 1, 2, "up")]),
      level("Ground floor", 0, 10, [c("down", "stairs", 3, 3, 1, 2, "down")]),
    ]);
    expect(s.regions).toHaveLength(1);
    // ...but two different stairs between the same levels are two
    const t = toFoundryLevelsScene([
      level("Cellar", -10, 0, [c("a", "stairs", 3, 3, 1, 2, "up"), c("b", "stairs", 8, 3, 1, 2, "up")]),
      level("Ground floor", 0, 10),
    ]);
    expect(t.regions).toHaveLength(2);
  });

  it("gives a level with a hole a floor region (its floor as rectangles) with the hole cut out, and a level without holes none", () => {
    const s = toFoundryLevelsScene([
      level("Cellar", -10, 0),
      level("Ground floor", 0, 10, [c("h", "hole", 5, 3, 2, 1, "down")]),
    ]);
    const regions = s.regions as Region[];
    expect(regions).toHaveLength(1);
    const [, ground] = s.levels.map((l) => l._id);
    expect(regions[0]).toMatchObject({ name: "Ground floor floor", levels: [ground], elevation: { bottom: 0, top: 10 } });
    expect(regions[0].shapes).toEqual([
      { type: "rectangle", x: 140, y: 140, width: 560, height: 280, rotation: 0, hole: false },
      { type: "rectangle", x: 350, y: 210, width: 140, height: 70, rotation: 0, hole: true },
    ]);
    expect(regions[0].behaviors[0]).toMatchObject({ type: "defineSurface", system: { placement: "bottom" } });
  });

  it("skips what leads nowhere (a stair up from the top level, a hole in the bottom level) and says so", () => {
    const levels = [
      level("Cellar", -10, 0, [c("h", "hole", 5, 3, 2, 1, "down", "Pit")]),
      level("Ground floor", 0, 10, [c("s", "stairs", 3, 3, 1, 2, "up")]),
    ];
    expect(toFoundryLevelsScene(levels).regions).toEqual([]);
    expect(foundryConnectorProblems(levels)).toEqual(["Pit on Cellar leads down, but there is no level below it.", "Stairs on Ground floor leads up, but there is no level above it."]);
  });

  it("a battlemap of one level, or with none of these, has no regions at all", () => {
    expect(toFoundryLevelsScene([level("Ground floor", 0, 10)]).regions).toEqual([]);
  });
});
