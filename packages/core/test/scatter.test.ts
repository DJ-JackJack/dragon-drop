/** Strewing objects (core scatter.ts): spacing kept, areas filled, looks varied, variants found by name. */
import { describe, expect, it } from "vitest";
import { SpotIndex, type XY, scatterInArea, scatterInCircle, scatterLook, seededRandom, variantStem } from "../src/scatter.ts";

const minGap = (pts: XY[]) => {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  return m;
};

describe("strewing", () => {
  it("keeps every spot the spacing from the others and from what was there, under the brush", () => {
    const rnd = seededRandom(7), taken = new SpotIndex(1, [[5, 5]]);
    const all: XY[] = [];
    for (let k = 0; k < 20; k++) all.push(...scatterInCircle(5 + k * 0.2, 5, 2, taken, rnd));
    expect(all.length).toBeGreaterThan(8);
    expect(minGap([[5, 5], ...all])).toBeGreaterThanOrEqual(1);
    for (const [x, y] of all) expect(Math.hypot(x - 5, y - 5)).toBeLessThanOrEqual(2 + 0.2 * 19 + 1e-9);
    // a refused spot (void, say) is never used
    const none = scatterInCircle(0, 0, 2, new SpotIndex(0.5), seededRandom(1), 30, (x) => x > 100);
    expect(none).toHaveLength(0);
  });

  it("fills an area about as densely as the spacing allows, inside it, the same for the same seed", () => {
    const square: XY[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const a = scatterInArea(square, 1, new SpotIndex(1), seededRandom(3));
    expect(a.length).toBeGreaterThan(45); // (about 0.6 to 0.8 a square: a dart-thrown fill)
    expect(a.length).toBeLessThan(130);
    expect(minGap(a)).toBeGreaterThanOrEqual(1);
    expect(a.every(([x, y]) => x >= 0 && x <= 10 && y >= 0 && y <= 10)).toBe(true);
    expect(scatterInArea(square, 1, new SpotIndex(1), seededRandom(3))).toEqual(a);
    expect(scatterInArea(square, 1, new SpotIndex(1), seededRandom(3), { max: 5 })).toHaveLength(5);
    // a triangle: nothing outside it
    const tri: XY[] = [[0, 0], [10, 0], [0, 10]];
    expect(scatterInArea(tri, 0.8, new SpotIndex(0.8), seededRandom(2)).every(([x, y]) => x + y <= 10)).toBe(true);
  });

  it("varies size within the range and turns in steps of 15 degrees, or keeps the given look", () => {
    const rnd = seededRandom(11);
    for (let k = 0; k < 50; k++) {
      const l = scatterLook(rnd, { scale: 2, vary: 0.25, turn: true });
      expect(l.scale).toBeGreaterThanOrEqual(1.5);
      expect(l.scale).toBeLessThanOrEqual(2.5);
      expect(l.rotation % 15).toBe(0);
    }
    expect(scatterLook(rnd, { scale: 1, vary: 0, turn: false, rotation: 90, flip: true })).toEqual({ scale: 1, rotation: 90, flip: true });
  });

  it("knows a picture's variants by their names", () => {
    expect(variantStem("Trees/Tree_Oak_A1.png")).toEqual({ dir: "Trees", stem: "tree oak" });
    expect(variantStem("Trees/Tree_Oak_A2.webp")).toEqual({ dir: "Trees", stem: "tree oak" });
    expect(variantStem("Trees/Tree Oak b.png").stem).toBe("tree oak");
    expect(variantStem("rocks/Rock 03.png").stem).toBe("rock");
    expect(variantStem("Barrel (2).png")).toEqual({ dir: "", stem: "barrel" });
    expect(variantStem("Trees/Tree_Pine_A1.png").stem).not.toBe(variantStem("Trees/Tree_Oak_A1.png").stem);
  });
});
