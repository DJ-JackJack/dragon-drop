import { describe, expect, it } from "vitest";
import {
  WIND_NAMES, WIND_TRAVEL, addLandmass, buildClimateNoise, computeDerived, createDoc, generateTerrain, upwindMax, upwindMaxDir,
} from "../src/index.ts";

describe("diagonal winds", () => {
  it("looks upwind along a diagonal, a shorter window per cell", () => {
    const W = 6, src = new Float32Array(W * W);
    src[1 * W + 1] = 9; // a peak at (1, 1)
    const out = upwindMaxDir(src, W, W, 3, 1, 1); // a north-westerly: travels toward the south-east
    expect(out[1 * W + 1]).toBe(9);
    expect(out[2 * W + 2]).toBe(9);
    expect(out[3 * W + 3]).toBe(9); // 3 px at a slant is 2 cells
    expect(out[4 * W + 4]).toBe(0); // beyond reach
    expect(out[1 * W + 2]).toBe(0); // beside the diagonal: untouched
    expect(out[0 * W + 0]).toBe(0); // upwind of the peak
    const sw = upwindMaxDir(src, W, W, 3, 1, -1); // south-westerly: a different line through the peak
    expect(sw[0 * W + 2]).toBe(9);
    expect(sw[2 * W + 2]).toBe(0);
  });

  it("matches the row-wise sweep for west and east winds", () => {
    const W = 9, H = 4, src = new Float32Array(W * H).map((_, i) => ((i * 7919) % 13) / 3);
    expect(Array.from(upwindMaxDir(src, W, H, 3, 1, 0))).toEqual(Array.from(upwindMax(src, W, H, 3, 1)));
    expect(Array.from(upwindMaxDir(src, W, H, 3, -1, 0))).toEqual(Array.from(upwindMax(src, W, H, 3, -1)));
  });

  it("names every direction the way weather does: by where the wind comes from", () => {
    expect(WIND_NAMES).toContain("northwest");
    expect(WIND_TRAVEL.northwest).toEqual([1, 1]); // from the north-west, toward the south-east
    expect(WIND_TRAVEL.west).toEqual([1, 0]);
    expect(WIND_TRAVEL.southeast).toEqual([-1, -1]);
  });

  it("puts the rain shadow of a ridge on the downwind side", () => {
    // (a map this small has a short shadow: the model's reach scales with the map's width, so probe close to the ridge)
    const W = 192;
    const make = (wind: "northwest" | "southeast" | "west" | "none", ridge: "ew" | "ns") => {
      const d = createDoc({ id: "w", name: "W", width: W, height: W, kmPerPx: 4 });
      generateTerrain(d, { template: "ocean", seed: 1 });
      addLandmass(d, { shape: { type: "rect", x: 10, y: 10, w: 172, h: 172 }, heightM: 120, seed: 2 });
      // a ridge 96 km wide (narrower ones count as spires, which air flows around)
      if (ridge === "ew") for (let y = 84; y < 108; y++) for (let x = 30; x < 160; x++) d.height.data[y * W + x] = 2400;
      else for (let y = 30; y < 160; y++) for (let x = 84; x < 108; x++) d.height.data[y * W + x] = 2400;
      d.meta.climate = { latTop: 0.5, latBot: 0.5, moistureNoise: 0, wind, coastMoisture: 0 };
      return computeDerived(d, buildClimateNoise(W, W, 1), 0).moist;
    };
    const at = (m: Uint8Array, x: number, y: number) => m[y * W + x];
    // wind from the north-west: the land south of an east-west ridge is in its shadow, the land north of it is not
    const nw = make("northwest", "ew"), se = make("southeast", "ew"), none = make("none", "ew");
    expect(at(nw, 96, 112)).toBeLessThan(at(nw, 96, 80) - 60);
    expect(at(se, 96, 80)).toBeLessThan(at(se, 96, 112) - 60); // from the south-east: the shadow falls north
    expect(Math.abs(at(none, 96, 80) - at(none, 96, 112))).toBeLessThan(30); // no wind, no shadow
    // a north-south ridge: a north-westerly shades the east side (and a westerly does too), not the west side
    const nwNs = make("northwest", "ns"), westNs = make("west", "ns");
    expect(at(nwNs, 112, 96)).toBeLessThan(at(nwNs, 80, 96) - 60);
    expect(at(westNs, 112, 96)).toBeLessThan(at(westNs, 80, 96) - 60);
  });
});
