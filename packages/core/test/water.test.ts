import { describe, expect, it } from "vitest";
import {
  type Features, applyFeaturesPatch, computeFlow, computeHydrology, emptyFeatures, resolveRiverSources, runoffOf, summariseHydrology,
} from "../src/index.ts";

const W = 256, H = 256, SEA_Y = 200;

/** A land that slopes to the sea in the south, with two valleys (x = 64 and x = 192) that collect the rain. */
function valleys(): Float32Array {
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    h[y * W + x] = y >= SEA_Y ? -20 : 300 + (SEA_Y - y) * 3 + Math.min(Math.abs(x - 64), Math.abs(x - 192)) * 6;
  }
  return h;
}

/** A plain slope with no valleys. */
function plain(): Float32Array {
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) h[y * W + x] = y >= SEA_Y ? -20 : 300 + (SEA_Y - y) * 3;
  return h;
}

const lengthOf = (r: { pts: number[] }) => { let l = 0; for (let k = 0; k + 3 < r.pts.length; k += 2) l += Math.hypot(r.pts[k + 2] - r.pts[k], r.pts[k + 3] - r.pts[k + 1]); return l; };
const xOf = (r: { pts: number[] }) => r.pts[0];

describe("how much water the land sheds", () => {
  it("is little in a desert and a lot in a jungle, and hot ground loses more than cool", () => {
    expect(runoffOf(0.9, 0.03)).toBeLessThan(0.1);
    expect(runoffOf(0.9, 0.95)).toBeGreaterThan(1.2);
    expect(runoffOf(0.4, 0.6)).toBeGreaterThan(runoffOf(0.9, 0.6));
    expect(runoffOf(0.5, 0.5)).toBeGreaterThan(0.4);
    expect(runoffOf(0.5, 0.5)).toBeLessThan(0.9);
    for (const t of [0, 0.5, 1]) for (const m of [0, 0.5, 1]) expect(runoffOf(t, m)).toBeGreaterThan(0);
  });
});

describe("rivers sized by runoff", () => {
  it("without runoff the rivers are exactly what they were (every cell counts the same)", () => {
    const h = valleys();
    const a = computeHydrology(h, W, H, 0, { riverDensity: 0.5 });
    const ones = new Float32Array(W * H).fill(1);
    const b = computeHydrology(h, W, H, 0, { riverDensity: 0.5, runoff: ones });
    expect(b.rivers.length).toBe(a.rivers.length);
    expect(b.rivers.map((r) => r.pts)).toEqual(a.rivers.map((r) => r.pts));
    expect(computeFlow(h, W, H, 0).runoffTotal).toBe(computeFlow(h, W, H, 0).landCells);
  });

  it("makes the same catchment a long, big river where it rains and only a thin, late one where it doesn't", () => {
    const h = valleys();
    const runoff = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (h[y * W + x] > 0) runoff[y * W + x] = runoffOf(0.8, x < 128 ? 0.04 : 0.9); // the west is desert, the east jungle
    const hy = computeHydrology(h, W, H, 0, { riverDensity: 0.5, runoff });
    const west = hy.rivers.filter((r) => xOf(r) < 128), east = hy.rivers.filter((r) => xOf(r) >= 128);
    expect(east.length).toBeGreaterThan(0);
    const westLen = west.reduce((s, r) => s + lengthOf(r), 0), eastLen = east.reduce((s, r) => s + lengthOf(r), 0);
    expect(westLen).toBeLessThan(eastLen * 0.8); // the dry valley's river only appears far downstream
    const widest = (rs: typeof east) => Math.max(0, ...rs.flatMap((r) => r.widths));
    expect(widest(west)).toBeLessThan(widest(east));
    // every river still runs to the sea
    const s = summariseHydrology({ h, W, H, sea: 0, kmPerPx: 4, hy, moist: runoff.map((v) => (v > 0 ? 0.5 : 0)) });
    expect(s.ends.elsewhere).toBe(0);
  });
});

describe("a river leaves every lake", () => {
  /** Land sloping south with a deep hollow in the middle: the hollow fills to its southern rim and spills there. */
  function withLake(): Float32Array {
    const h = plain();
    for (let y = 0; y < SEA_Y; y++) for (let x = 0; x < W; x++) h[y * W + x] -= 220 * Math.exp(-((x - 128) ** 2 + (y - 100) ** 2) / (2 * 14 * 14));
    return h;
  }

  it("draws the river that flows out of the lake, down to the sea", () => {
    const h = withLake();
    const hy = computeHydrology(h, W, H, 0, { riverDensity: 0.7, lakeMinDepthM: 15 });
    let lakeCells = 0, cy = 0;
    for (let i = 0; i < W * H; i++) if (hy.lakes[i]) { lakeCells++; cy += (i / W) | 0; }
    expect(lakeCells).toBeGreaterThan(20);
    cy /= lakeCells;
    // a river starts just south of the lake and reaches the sea
    const out = hy.rivers.filter((r) => Math.abs(xOf(r) - 128) < 30 && r.pts[1] > cy - 2 && r.pts[1] < cy + 40);
    expect(out.length).toBeGreaterThan(0);
    const longest = out.reduce((a, b) => (lengthOf(a) > lengthOf(b) ? a : b));
    expect(longest.pts[longest.pts.length - 1]).toBeGreaterThan(SEA_Y - 6);
    // the account of the water says so, too
    const s = summariseHydrology({ h, W, H, sea: 0, kmPerPx: 4, hy, moist: new Float32Array(W * H).fill(0.6) });
    expect(s.lakes.length).toBe(1);
    expect(s.lakes[0].outflow).toBe("river");
    expect(s.lakes[0].areaKm2).toBeGreaterThan(300);
  });
});

describe("river sources", () => {
  const src = { x: 128, y: 60 };

  it("feed a river from a point on bare land, and it runs to the sea", () => {
    const h = plain();
    const without = computeHydrology(h, W, H, 0, { riverDensity: 0.5 });
    const hy = computeHydrology(h, W, H, 0, { riverDensity: 0.5, inflows: [{ ...src, share: 0.03 }] });
    const mine = hy.rivers.filter((r) => Math.hypot(r.pts[0] - src.x, r.pts[1] - src.y) < 4);
    expect(mine.length).toBe(1);
    expect(without.rivers.filter((r) => Math.hypot(r.pts[0] - src.x, r.pts[1] - src.y) < 4).length).toBe(0);
    const river = mine[0];
    expect(river.pts[river.pts.length - 1]).toBeGreaterThan(SEA_Y - 6);
    expect(Math.min(...river.widths)).toBeGreaterThan(1); // big from the first mile
    const s = summariseHydrology({ h, W, H, sea: 0, kmPerPx: 4, hy, moist: new Float32Array(W * H).fill(0.6), inflows: [{ ...src, share: 0.03 }] });
    expect(s.sources).toHaveLength(1);
    expect(s.sources[0].drawn).toBe(true);
    expect(s.sources[0].reaches).toBe("sea");
    expect(s.sources[0].lengthKm).toBeGreaterThan(400); // 140 px at 4 km
  });

  it("make bigger rivers the bigger they are", () => {
    const h = plain();
    const width = (share: number) => {
      const hy = computeHydrology(h, W, H, 0, { riverDensity: 0.5, inflows: [{ ...src, share }] });
      const r = hy.rivers.find((x) => Math.hypot(x.pts[0] - src.x, x.pts[1] - src.y) < 4)!;
      return Math.max(...r.widths);
    };
    expect(width(0.08)).toBeGreaterThan(width(0.03));
    expect(width(0.03)).toBeGreaterThan(width(0.008));
  });

  it("are ignored in the sea, and counted as not drawn", () => {
    const h = plain();
    const hy = computeHydrology(h, W, H, 0, { riverDensity: 0.5, inflows: [{ x: 128, y: 230, share: 0.03 }] });
    const s = summariseHydrology({ h, W, H, sea: 0, kmPerPx: 4, hy, moist: new Float32Array(W * H).fill(0.6), inflows: [{ x: 128, y: 230, share: 0.03 }] });
    expect(s.sources[0].drawn).toBe(false);
  });

  it("follow their place, and go when the place goes", () => {
    const f: Features = { ...emptyFeatures(), places: [{ id: "p1", name: "Test Falls", type: "landmark", x: 50, y: 40 }], sources: [{ id: "s1", placeId: "p1", size: "major" }, { id: "s2", x: 10, y: 20, size: "stream" }] };
    expect(resolveRiverSources(f)).toEqual([{ x: 50, y: 40, share: 0.03 }, { x: 10, y: 20, share: 0.002 }]);
    const moved = applyFeaturesPatch(f, { upsertPlaces: [{ ...f.places[0], x: 90, y: 91 }] });
    expect(resolveRiverSources(moved)[0]).toEqual({ x: 90, y: 91, share: 0.03 });
    const removed = applyFeaturesPatch(f, { removePlaces: ["p1"] });
    expect(removed.sources!.map((s) => s.id)).toEqual(["s2"]);
    expect(resolveRiverSources(removed)).toEqual([{ x: 10, y: 20, share: 0.002 }]);
    expect(resolveRiverSources(undefined)).toEqual([]);
    const gone = applyFeaturesPatch(f, { removeSources: ["s1", "s2"] });
    expect(resolveRiverSources(gone)).toEqual([]);
  });
});

describe("the account of the water", () => {
  it("counts rivers, where they end, and how much runs through very dry land", () => {
    const h = valleys();
    const hy = computeHydrology(h, W, H, 0, { riverDensity: 0.6 });
    const wet = summariseHydrology({ h, W, H, sea: 0, kmPerPx: 4, hy, moist: new Float32Array(W * H).fill(0.7) });
    const dry = summariseHydrology({ h, W, H, sea: 0, kmPerPx: 4, hy, moist: new Float32Array(W * H).fill(0.05) });
    expect(wet.riverCount).toBe(hy.rivers.length);
    expect(wet.riverCount).toBeGreaterThan(1);
    expect(wet.riverLengthKm).toBeGreaterThan(500);
    expect(wet.ends.sea + wet.ends.river).toBe(wet.riverCount);
    expect(wet.dryShare).toBe(0);
    expect(dry.dryShare).toBe(1);
    expect(wet.bowlShare).toBeLessThan(0.05);
    expect(wet.lakes).toEqual([]);
    expect(wet.sources).toEqual([]);
  });
});
