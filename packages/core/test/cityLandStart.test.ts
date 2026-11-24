import { describe, expect, it } from "vitest";
import { LAND_STARTS, type CitySpec, cleanLandform, landHeightAt, startLand } from "../src/index.ts";

const spec: CitySpec = { widthM: 600, heightM: 400, cellM: 2 };

describe("a start for a settlement's land", () => {
  it("makes landforms that pass the same checks as anyone else's, with ids of their own", () => {
    for (const s of LAND_STARTS) for (const seed of [1, 42, 9001]) for (const size of [spec, { widthM: 60, heightM: 50, cellM: 1 }, { widthM: 6000, heightM: 3000, cellM: 8 }]) {
      const land = startLand(size, s.id, seed);
      if (s.id === "flat") { expect(land).toEqual([]); continue; }
      expect(land.length).toBeGreaterThan(0);
      expect(new Set(land.map((l) => l.id)).size).toBe(land.length);
      for (const l of land) {
        const clean = cleanLandform(l, size as CitySpec);
        expect(clean, `${s.id} ${seed} ${l.id}: ${JSON.stringify(clean)}`).toEqual(l);
      }
    }
  });

  it("gives the same land for the same seed, and other land for another", () => {
    expect(startLand(spec, "rolling", 7)).toEqual(startLand(spec, "rolling", 7));
    expect(startLand(spec, "rolling", 7)).not.toEqual(startLand(spec, "rolling", 8));
  });

  it("puts a hilltop's top near the middle and a valley's floor below its sides", () => {
    const top = startLand(spec, "hilltop", 3);
    const mid = landHeightAt(top, 300, 200), corner = Math.max(landHeightAt(top, 5, 5), landHeightAt(top, 595, 395), landHeightAt(top, 5, 395), landHeightAt(top, 595, 5));
    expect(mid).toBeGreaterThan(corner + 10);
    const vale = startLand(spec, "valley", 3);
    const floor = vale.find((l) => l.kind === "ridge")!;
    const [fx, fy] = floor.points[2];
    // across the valley from a point on its floor (it runs along the longer side, so across is up and down)
    expect(landHeightAt(vale, fx, fy)).toBeLessThan(Math.max(landHeightAt(vale, fx, Math.max(0, fy - 150)), landHeightAt(vale, fx, Math.min(400, fy + 150))) - 3);
  });
});
