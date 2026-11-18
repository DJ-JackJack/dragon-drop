import { describe, expect, it } from "vitest";
import { circlePolygon, createBattleDoc, paintFloor, traceFloorOutlines, wallsAroundFloor } from "../src/index.ts";

const doc = () => createBattleDoc({ id: "b", name: "B", squaresX: 20, squaresY: 14, sub: 8 });
const rect = (d: ReturnType<typeof doc>, x: number, y: number, w: number, h: number, m = 1) => paintFloor(d, { shape: { type: "rect", x: x * 8, y: y * 8, w: w * 8, h: h * 8 }, material: m });
const area = (p: [number, number][]) => Math.abs(p.reduce((n, q, i) => n + (q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1]), 0) / 2);
const near = (p: [number, number], x: number, y: number) => Math.hypot(p[0] - x, p[1] - y) < 0.02;

describe("walls around floor", () => {
  it("traces a rectangle to its four exact corners", () => {
    const d = doc();
    rect(d, 3, 2, 8, 5);
    const loops = traceFloorOutlines(d);
    expect(loops).toHaveLength(1);
    const p = loops[0];
    expect(p).toHaveLength(4);
    for (const [x, y] of [[3, 2], [11, 2], [11, 7], [3, 7]]) expect(p.some((q) => near(q, x, y))).toBe(true);
    expect(area(p)).toBeCloseTo(40, 1);
  });

  it("follows an L shape (six corners) and a room with a pillar (an outline and a hole)", () => {
    const d = doc();
    rect(d, 2, 2, 10, 3);
    rect(d, 2, 2, 3, 9);
    const l = traceFloorOutlines(d);
    expect(l).toHaveLength(1);
    expect(l[0]).toHaveLength(6);
    expect(Math.abs(area(l[0]) - (10 * 3 + 3 * 6))).toBeLessThan(0.2);
    const e = doc();
    rect(e, 2, 2, 12, 9);
    rect(e, 7, 5, 2, 2, 0); // a pillar: void inside the floor
    const loops = traceFloorOutlines(e);
    expect(loops).toHaveLength(2);
    expect(loops.map((p) => Math.round(area(p))).sort((a, b) => a - b)).toEqual([4, 108]);
  });

  it("follows a round cave closely, with few points", () => {
    const d = doc();
    paintFloor(d, { shape: { type: "circle", x: 80, y: 56, r: 40 }, material: 4 }); // radius 5 squares, centre (10, 7)
    const loops = traceFloorOutlines(d);
    expect(loops).toHaveLength(1);
    expect(area(loops[0])).toBeGreaterThan(Math.PI * 25 * 0.96);
    expect(area(loops[0])).toBeLessThan(Math.PI * 25 * 1.04);
    for (const [x, y] of loops[0]) expect(Math.abs(Math.hypot(x - 10, y - 7) - 5)).toBeLessThan(0.25);
    expect(loops[0].length).toBeLessThan(120);
  });

  it("walls the map edge too, separates islands, ignores specks, and honours a region", () => {
    const d = doc();
    rect(d, 0, 0, 20, 14); // the whole map
    expect(traceFloorOutlines(d)[0]).toHaveLength(4); // along the map's edge
    const e = doc();
    rect(e, 2, 2, 4, 4);
    rect(e, 12, 8, 5, 4);
    paintFloor(e, { shape: { type: "circle", x: 60, y: 100, r: 2 }, material: 1 }); // a crumb: under 2 squares around
    expect(traceFloorOutlines(e)).toHaveLength(2);
    expect(traceFloorOutlines(e, { region: { x: 0, y: 0, w: 8, h: 8 } })).toHaveLength(1);
  });

  it("makes closed, auto-flagged walls with fresh ids", () => {
    const d = doc();
    rect(d, 3, 3, 5, 5);
    let n = 0;
    const walls = wallsAroundFloor(d, () => `w${n++}`);
    expect(walls).toEqual([{ id: "w0", kind: "wall", points: expect.any(Array), closed: true, auto: true }]);
  });

  it("makes circle polygons", () => {
    const p = circlePolygon(5, 5, 2);
    expect(p.length).toBeGreaterThanOrEqual(16);
    for (const [x, y] of p) expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(2, 6);
  });
});
