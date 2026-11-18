import { describe, expect, it } from "vitest";
import {
  BIOMES, GROUNDS, GROUND_INFO, addLandmass, lakeShoreDistance, biomeWeights, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, dominantBiome, emptyBiomeWeights, generateTerrain, renderPainted,
} from "../src/index.ts";

describe("which biome the climate makes", () => {
  const at = (t: number, m: number, e = 0.1, rugged = 0.3) => dominantBiome(biomeWeights(t, m, e, rugged));
  it("goes from tundra through conifer, mixed and warm forest as it gets warmer in a wet climate", () => {
    expect(at(0.08, 0.95)).toBe("tundra");
    expect(at(0.3, 0.95)).toBe("boreal");
    expect(at(0.52, 0.95)).toBe("temperate");
    expect(at(0.7, 0.95)).toBe("warm");
  });
  it("gives dry land steppe, or savanna when it is warm, and marsh to low flat wet ground", () => {
    expect(at(0.4, 0.35)).toBe("steppe");
    expect(at(0.72, 0.35)).toBe("savanna");
    expect(at(0.45, 0.95, 0.01, 0)).toBe("marsh");
    expect(at(0.45, 0.95, 0.15, 0.6)).not.toBe("marsh"); // not on high or rugged ground
    expect(at(0.05, 0.95, 0.01, 0)).toBe("tundra"); // frozen ground is not marsh
  });
  it("thins the forest out into alpine meadow above the treeline, and not below it", () => {
    expect(biomeWeights(0.5, 0.95, 0.1, 0.3).alpine).toBe(0);
    expect(at(0.5, 0.95, 0.12, 0.3)).toBe("temperate");
    expect(at(0.5, 0.95, 0.34, 0.8)).toBe("alpine");
    expect(biomeWeights(0.5, 0.95, 0.34, 0.8).temperate).toBe(0);
    expect(at(0.1, 0.95, 0.34, 0.8)).toBe("tundra"); // (the cold land above it is tundra already)
  });
  it("makes wetland beside a big river on low flat ground, and not on high ground or in a dry climate", () => {
    expect(biomeWeights(0.5, 0.9, 0.05, 0.1, emptyBiomeWeights(), 0).marsh).toBeLessThan(0.05); // (a little too high for ordinary marsh)
    expect(biomeWeights(0.5, 0.9, 0.05, 0.1, emptyBiomeWeights(), 1).marsh).toBeGreaterThan(0.5); // (but fine in a river's floodplain)
    expect(biomeWeights(0.5, 0.9, 0.2, 0.7, emptyBiomeWeights(), 1).marsh).toBeLessThan(0.05);
    expect(biomeWeights(0.5, 0.3, 0.04, 0.1, emptyBiomeWeights(), 1).marsh).toBe(0);
  });
  it("blends one biome into the next: the temperature bands add up to one wherever it is wet, with every weight between 0 and 1", () => {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const w = biomeWeights(t, 1, 0.2, 0.5);
      expect(w.tundra + w.boreal + w.temperate + w.warm + w.alpine).toBeCloseTo(1, 5);
      for (const b of BIOMES) { expect(w[b]).toBeGreaterThanOrEqual(0); expect(w[b]).toBeLessThanOrEqual(1.0001); }
    }
    // no weight jumps: nudging the temperature a little never changes any weight much
    let prev = emptyBiomeWeights();
    for (let t = 0; t <= 1; t += 0.005) {
      const w = { ...biomeWeights(t, 0.8, 0.05, 0.1) };
      if (t > 0) for (const b of BIOMES) expect(Math.abs(w[b] - prev[b])).toBeLessThan(0.08);
      prev = w;
    }
  });
});

describe("ground on top of the biomes", () => {
  const w = (t: number, m: number, e: number, rugged: number, nearWater = 0, ld = 255, shore = 99) => biomeWeights(t, m, e, rugged, emptyBiomeWeights(), nearWater, { ld, shore });
  it("puts beaches on low gentle coast only, mangrove on warm wet coast (further in along a river), and reeds along a lake's shore", () => {
    expect(w(0.5, 0.9, 0.01, 0.1, 0, 1).beach).toBeGreaterThan(0.8);
    expect(w(0.5, 0.9, 0.01, 0.1, 0, 12).beach).toBe(0); // inland
    expect(w(0.5, 0.9, 0.2, 0.7, 0, 1).beach).toBe(0); // a cliff coast
    expect(w(0.72, 0.95, 0.01, 0.1, 0, 2).mangrove).toBeGreaterThan(0.6);
    expect(w(0.3, 0.95, 0.01, 0.1, 0, 2).mangrove).toBe(0); // too cold
    expect(w(0.72, 0.95, 0.01, 0.1, 0, 14).mangrove).toBe(0);
    expect(w(0.72, 0.95, 0.01, 0.1, 1, 14).mangrove).toBeGreaterThan(0.1); // up a river from the sea
    expect(w(0.5, 0.9, 0.05, 0.1, 0, 255, 1).reeds).toBeGreaterThan(0.8);
    expect(w(0.5, 0.9, 0.05, 0.1, 0, 255, 8).reeds).toBe(0);
    expect(w(0.5, 0.9, 0.04, 0.1, 0, 255, 2).marsh).toBeGreaterThan(0.5); // low ground round a lake is wetland
  });
  it("makes glacier on the highest coldest snowy ground, and heather moor on cool wet uplands", () => {
    expect(w(0.03, 0.8, 0.4, 0.9).glacier).toBeGreaterThan(0.9);
    expect(w(0.03, 0.8, 0.05, 0.1).glacier).toBe(0); // low ground is not glacier
    expect(w(0.5, 0.8, 0.4, 0.9).glacier).toBe(0); // nor warm ground
    expect(w(0.3, 0.9, 0.1, 0.3).moor).toBeGreaterThan(0.8);
    expect(w(0.3, 0.9, 0.02, 0.1).moor).toBe(0);
    expect(w(0.3, 0.9, 0.3, 0.9).moor).toBe(0);
  });
  it("makes scrub where it is warm and not quite dry, badlands where dry ground is rugged, salt flats on very dry low flats", () => {
    expect(w(0.65, 0.45, 0.1, 0.3).chaparral).toBeGreaterThan(0.8);
    expect(w(0.65, 0.95, 0.1, 0.3).chaparral).toBe(0);
    expect(w(0.65, 0.2, 0.2, 0.8).badlands).toBeGreaterThan(0.6);
    expect(w(0.65, 0.2, 0.05, 0.05).badlands).toBeLessThan(0.1);
    expect(w(0.65, 0.04, 0.02, 0.05).saltflat).toBeGreaterThan(0.8);
    expect(w(0.65, 0.04, 0.3, 0.9).saltflat).toBe(0);
    expect(w(0.65, 0.04, 0.3, 0.9).stony).toBeGreaterThan(0.9); // rugged desert is stony
    expect(w(0.65, 0.04, 0.02, 0.05).stony).toBe(0);
  });
  it("makes rainforest on a cool wet coast, cloud forest on warm wet mountainsides, bamboo in warm lowland woods, autumn colour in the cooler woods", () => {
    expect(w(0.42, 0.97, 0.05, 0.2, 0, 10).rainforest).toBeGreaterThan(0.9);
    expect(w(0.42, 0.97, 0.05, 0.2, 0, 80).rainforest).toBe(0); // far from the coast
    expect(w(0.42, 0.97, 0.3, 0.8, 0, 10).rainforest).toBe(0); // above the treeline
    expect(w(0.7, 0.97, 0.05, 0.2, 0, 10).rainforest).toBe(0); // too warm
    expect(w(0.68, 0.95, 0.17, 0.4).cloud).toBeGreaterThan(0.9);
    expect(w(0.68, 0.95, 0.03, 0.1).cloud).toBe(0); // lowland is not cloud forest
    expect(w(0.6, 0.8, 0.05, 0.2).bamboo).toBeGreaterThan(0.7);
    expect(w(0.6, 0.3, 0.05, 0.2).bamboo).toBe(0);
    expect(w(0.45, 0.8, 0.08, 0.2).autumn).toBeGreaterThan(0.9);
    expect(w(0.7, 0.8, 0.08, 0.2).autumn).toBe(0); // warm woods keep their leaves
  });
  it("keeps every weight between 0 and 1, whatever the climate", () => {
    for (let t = 0; t <= 1; t += 0.1) for (let m = 0; m <= 1; m += 0.1) for (const e of [0, 0.03, 0.1, 0.3, 0.6]) for (const nw of [0, 1]) for (const ld of [1, 4, 255]) {
      const x = w(t, m, e, Math.min(1, e * 2), nw, ld, ld === 4 ? 2 : 99);
      for (const g of [...BIOMES, ...GROUNDS]) { expect(x[g]).toBeGreaterThanOrEqual(0); expect(x[g]).toBeLessThanOrEqual(1.0001); }
    }
  });
});

describe("the distance to a lake's shore", () => {
  const W = 80, H = 60;
  const lakes = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - 40, y - 30) <= 6) lakes[y * W + x] = 1;
  it("is the distance outwards from the lake, and null where no lake is near", () => {
    const s = lakeShoreDistance(lakes, W, H, { x: 30, y: 20, w: 20, h: 20 }, 8)!;
    const at = (x: number, y: number) => s.dist[(y - s.r.y) * s.r.w + (x - s.r.x)];
    expect(at(40, 30)).toBe(0);
    expect(at(48, 30)).toBeGreaterThan(1.5);
    expect(at(48, 30)).toBeLessThan(3);
    expect(at(40, 38)).toBeCloseTo(2, 0);
    expect(lakeShoreDistance(lakes, W, H, { x: 0, y: 0, w: 10, h: 10 }, 8)).toBeNull();
    expect(lakeShoreDistance(new Uint8Array(W * H), W, H, { x: 0, y: 0, w: W, h: H }, 8)).toBeNull();
  });
  it("gives a pixel the same value whichever tile it is asked for in", () => {
    const a = lakeShoreDistance(lakes, W, H, { x: 36, y: 22, w: 14, h: 14 }, 8)!, b = lakeShoreDistance(lakes, W, H, { x: 20, y: 10, w: 50, h: 40 }, 8)!;
    for (let y = 22; y < 36; y++) for (let x = 36; x < 50; x++) {
      const va = Math.min(8, a.dist[(y - a.r.y) * a.r.w + (x - a.r.x)]), vb = Math.min(8, b.dist[(y - b.r.y) * b.r.w + (x - b.r.x)]);
      expect(va).toBeCloseTo(vb, 5);
    }
  });
});

describe("what the ground looks like", () => {
  const W = 256;
  const noise = buildNoiseCache(W, W, 7);
  const paint = (temperature: number, moisture: number) => {
    const d = createDoc({ id: "b", name: "B", width: W, height: W, kmPerPx: 4 });
    generateTerrain(d, { template: "ocean", seed: 1 });
    addLandmass(d, { shape: { type: "circle", x: 128, y: 128, r: 110 }, heightM: 600, seed: 2 });
    d.meta.climate = { latTop: 0.5, latBot: 0.5, moistureNoise: 0.2, wind: "northwest" };
    d.features = { places: [], labels: [], regions: [{ id: "r", name: "R", polygon: [[60, 60], [196, 60], [196, 196], [60, 196]], temperature, moisture, border: "hard" }] };
    const der = computeDerived(d, buildClimateNoise(W, W, 1), 1), out = new Uint8ClampedArray(W * W * 4);
    renderPainted(d, der, noise, null, out, undefined, { rivers: false });
    const m = [0, 0, 0]; let n = 0;
    for (let y = 90; y < 170; y += 2) for (let x = 90; x < 170; x += 2) { const o = (y * W + x) * 4; for (let c = 0; c < 3; c++) m[c] += out[o + c]; n++; }
    return m.map((v) => v / n);
  };
  const apart = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

  it("looks different for each climate, not one green", () => {
    const looks: Record<string, number[]> = {
      tundra: paint(0.08, 0.9), boreal: paint(0.3, 0.9), temperate: paint(0.52, 0.9), warm: paint(0.7, 0.9), savanna: paint(0.72, 0.35), steppe: paint(0.4, 0.35),
    };
    const names = Object.keys(looks);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      expect(apart(looks[names[i]], looks[names[j]]), `${names[i]} vs ${names[j]}`).toBeGreaterThan(14);
    }
    // the shapes of the look: conifer is the darkest and bluest of the forests, savanna is golden and steppe a cooler, greener straw, tundra is pale
    const lum = (p: number[]) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
    expect(lum(looks.boreal)).toBeLessThan(lum(looks.temperate));
    expect(looks.savanna[0]).toBeGreaterThan(looks.savanna[2] * 1.6);
    expect(looks.steppe[0]).toBeGreaterThan(looks.steppe[2] * 1.2);
    expect(looks.savanna[0] / looks.savanna[2]).toBeGreaterThan(looks.steppe[0] / looks.steppe[2]); // savanna is the warmer of the two
    expect(looks.steppe[1] / looks.steppe[0]).toBeGreaterThan(looks.savanna[1] / looks.savanna[0]); // steppe is the greener
    expect(lum(looks.tundra)).toBeGreaterThan(lum(looks.boreal));
  });
});

describe("the ground legend", () => {
  it("names every kind of ground the painter and get_selection know, once each, with a colour and a place", () => {
    const ids = GROUND_INFO.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...BIOMES, ...GROUNDS, "jungle", "desert", "stone", "volcanic"]) expect(ids, id).toContain(id);
    for (const g of GROUND_INFO) {
      expect(g.name.length).toBeGreaterThan(2);
      expect(g.where.length).toBeGreaterThan(5);
      expect(g.recipe.length, g.id).toBeGreaterThan(10); // Claude reads this through list_grounds
      for (const c of g.swatch) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(255); }
    }
  });
});
