import { describe, expect, it } from "vitest";
import {
  MATERIALS, type WorldSample, addLandmass, addMountainRange, battleFloorFromWorld, buildClimateNoise, computeDerived, createBattleDoc, createDoc, describeSample,
  generateTerrain, sampleWorld,
} from "../src/index.ts";

const id = (name: string) => MATERIALS.find((m) => m.name === name)!.id;
const base: WorldSample = { x: 10, y: 10, elevM: 120, underwater: false, slope: 0.02, temp: 0.5, moist: 0.5, snow: 0, lake: false };

function scene(s: Partial<WorldSample>, seed = 1) {
  const d = createBattleDoc({ id: "b", name: "B", squaresX: 30, squaresY: 20, sub: 4 });
  battleFloorFromWorld(d, { ...base, ...s }, seed);
  return d;
}
function share(d: ReturnType<typeof scene>) {
  const out: Record<string, number> = {};
  for (const v of d.height.data) out[MATERIALS[v]?.name ?? String(v)] = (out[MATERIALS[v]?.name ?? String(v)] ?? 0) + 1 / d.height.data.length;
  return out;
}
/** The material at a position in squares. */
const at = (d: ReturnType<typeof scene>, x: number, y: number) => d.height.get(Math.floor(x * 4), Math.floor(y * 4));

describe("battlemap from a world sample", () => {
  it("open sea is water, deeper far from shore", () => {
    const sea = share(scene({ underwater: true, elevM: -3000 }));
    expect(sea["deep water"]).toBeGreaterThan(0.9);
    const shelf = share(scene({ underwater: true, elevM: -20 }));
    expect(shelf["shallow water"]).toBeGreaterThan(0.6);
    expect(share(scene({ underwater: true, elevM: -3000 }))["grass"]).toBeUndefined();
  });

  it("picks ground from climate and slope", () => {
    expect(share(scene({}))["grass"]).toBeGreaterThan(0.6);
    expect(share(scene({}))["dirt"]).toBeGreaterThan(0.1);
    expect(share(scene({ temp: 0.1 }))["snow"]).toBeGreaterThan(0.7);
    expect(share(scene({ moist: 0.1 }))["sand"]).toBeGreaterThan(0.6);
    expect(share(scene({ moist: 0.3 }))["dirt"]).toBeGreaterThan(0.5);
    const woods = share(scene({ moist: 0.8, slope: 0.01 }));
    expect(woods["forest floor"]).toBeGreaterThan(0.45);
    expect(woods["mud"]).toBeGreaterThan(0.03);
    expect(share(scene({ slope: 0.4 }))["rock"]).toBeGreaterThan(0.5);
    expect(share(scene({ elevM: 3500 }))["rock"]).toBeGreaterThan(0.5);
    // a cold meadow has snow drifts on its grass
    const cold = share(scene({ temp: 0.26 }));
    expect(cold["snow"]).toBeGreaterThan(0.05);
    expect(cold["grass"]).toBeGreaterThan(0.2);
  });

  it("puts a lake in the middle, with a bank", () => {
    const d = scene({ lake: true });
    expect(at(d, 15, 10)).toBe(id("deep water"));
    expect(at(d, 1, 1)).not.toBe(id("shallow water"));
    expect(share(d)["shallow water"]).toBeGreaterThan(0.05);
    expect(share(d)["sand"] ?? share(d)["mud"]).toBeGreaterThan(0.01);
  });

  it("runs a river through the middle along its direction", () => {
    const x = scene({ river: { dx: 1, dy: 0, widthPx: 1.5 } });
    const wet = (m: number) => m === id("shallow water") || m === id("deep water");
    let acrossRow = 0;
    for (let sx = 2; sx < 28; sx += 2) if (wet(at(x, sx, 10)) || wet(at(x, sx, 9)) || wet(at(x, sx, 11)) || wet(at(x, sx, 8)) || wet(at(x, sx, 12))) acrossRow++;
    expect(acrossRow).toBeGreaterThanOrEqual(11); // runs the length of the map, left to right
    expect(wet(at(x, 15, 1))).toBe(false);
    const y = scene({ river: { dx: 0, dy: 1, widthPx: 1.5 } });
    let down = 0;
    for (let sy = 1; sy < 19; sy++) if ([13, 14, 15, 16, 17].some((sx) => wet(at(y, sx, sy)))) down++;
    expect(down).toBeGreaterThanOrEqual(14);
    expect(wet(at(y, 2, 10))).toBe(false);
    // a wide river has a deep core
    expect(share(scene({ river: { dx: 1, dy: 0, widthPx: 3 } }))["deep water"]).toBeGreaterThan(0.01);
  });

  it("puts the sea on the side the coast faces", () => {
    const right = scene({ coast: { dx: 1, dy: 0 } });
    expect(at(right, 29, 10)).toBe(id("deep water"));
    expect(at(right, 1, 10)).not.toBe(id("shallow water"));
    expect(at(right, 1, 10)).not.toBe(id("deep water"));
    const left = scene({ coast: { dx: -1, dy: 0 } });
    expect(at(left, 1, 10)).toBe(id("deep water"));
    expect(at(left, 29, 10)).not.toBe(id("deep water"));
    expect(share(right)["sand"]).toBeGreaterThan(0.02); // a beach
    const top = scene({ coast: { dx: 0, dy: -1 } });
    expect(at(top, 15, 0)).toBe(id("deep water"));
  });

  it("is repeatable for a seed and different for another", () => {
    const a = scene({}, 5), b = scene({}, 5), c = scene({}, 6);
    expect(Array.from(a.height.data)).toEqual(Array.from(b.height.data));
    expect(Array.from(a.height.data)).not.toEqual(Array.from(c.height.data));
  });

  it("describes the place", () => {
    expect(describeSample({ ...base })).toBe("meadow");
    expect(describeSample({ ...base, moist: 0.8, river: { dx: 1, dy: 0, widthPx: 1 } })).toBe("woodland, a river crossing it");
    expect(describeSample({ ...base, underwater: true, elevM: -2000 })).toBe("open sea");
    expect(describeSample({ ...base, temp: 0.1, coast: { dx: 1, dy: 0 } })).toBe("snowy ground, on the coast");
  });
});

describe("sampling a real world map", () => {
  const W = 256;
  const d = createDoc({ id: "w", name: "W", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: 128, y: 128, r: 70 }, heightM: 300, seed: 2 });
  addMountainRange(d, { path: [[90, 80], [80, 128], [90, 176]], widthPx: 8, peakM: 3200, seed: 3 });
  d.meta.climate = { latTop: 0.75, latBot: 0.25 };
  const der = computeDerived(d, buildClimateNoise(W, W, 1), 0);

  it("knows open sea, the coast's direction, and steep ground", () => {
    const sea = sampleWorld(d, der, 5, 5);
    expect(sea.underwater).toBe(true);
    expect(sea.coast).toBeUndefined();
    // walk in from the east edge of the island until just on land
    let x = 255;
    while (x > 0 && d.height.get(x, 128) <= 0) x--;
    const shore = sampleWorld(d, der, x, 128);
    expect(shore.underwater).toBe(false);
    expect(shore.coast!.dx).toBeGreaterThan(0.5); // the sea is to the east
    const mid = sampleWorld(d, der, 128, 128);
    expect(mid.coast).toBeUndefined();
    const range = sampleWorld(d, der, 85, 128);
    expect(range.slope).toBeGreaterThan(sampleWorld(d, der, 150, 128).slope);
    expect(describeSample(range)).toContain("");
  });

  it("finds a river where one flows, with its direction", () => {
    const r = der.rivers.find((p) => p.pts.length > 20)!;
    const k = Math.floor(r.pts.length / 4) * 2;
    const s = sampleWorld(d, der, r.pts[k], r.pts[k + 1]);
    expect(s.river).toBeDefined();
    expect(Math.hypot(s.river!.dx, s.river!.dy)).toBeCloseTo(1, 3);
    expect(s.river!.widthPx).toBeGreaterThan(0);
  });
});
