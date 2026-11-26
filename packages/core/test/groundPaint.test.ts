// Ground painted by hand (biome brushes, groundPaint.ts): codes that never change, the painting per pixel with a soft broken edge, the weights it puts over
// the climate's, how it travels (packed, compared) and that the painter shows it.
import { describe, expect, it } from "vitest";
import {
  GROUND_INFO, PAINTABLE_GROUNDS, addLandmass, applyPaintedGround, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, decodeRealmCells, derivedChange,
  emptyBiomeWeights, encodeRealmCells, generateTerrain, groundCode, groundGridOf, groundOfCode, groundPaintPlanes, packDerived, paintRealmCells, renderPainted, unpackDerived,
} from "../src/index.ts";

const W = 256;
function world() {
  const d = createDoc({ id: "g", name: "G", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: 128, y: 128, r: 110 }, heightM: 200, seed: 2 });
  // a wet, mild land: mixed forest everywhere, unless painted
  d.meta.climate = { latTop: 0.5, latBot: 0.5, moistureNoise: 0.1, wind: "none" };
  d.features = { places: [], labels: [], regions: [{ id: "r", name: "R", polygon: [[10, 10], [246, 10], [246, 246], [10, 246]], temperature: 0.5, moisture: 0.8, border: "hard" }] };
  return d;
}
/** The map with `ground` painted in a square (map px). */
function painted(ground: string, x0 = 90, y0 = 90, x1 = 166, y1 = 166) {
  const d = world(), g = groundGridOf(d), cells = decodeRealmCells(g);
  paintRealmCells(cells, g, { n: groundCode(ground), polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  d.features = { ...d.features!, groundCells: encodeRealmCells(g, cells) };
  return d;
}

describe("ground painted by hand", () => {
  it("gives every paintable ground a code of its own that never changes, and only grounds the legend has", () => {
    const codes = PAINTABLE_GROUNDS.map((g) => g.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Math.min(...codes)).toBe(1);
    // (saved maps hold these codes: a few pinned, so a reordering fails here)
    expect([groundCode("tundra"), groundCode("boreal"), groundCode("desert"), groundCode("mangrove")]).toEqual([1, 2, 10, 21]);
    for (const g of PAINTABLE_GROUNDS) expect(GROUND_INFO.some((x) => x.id === g.id), g.id).toBe(true);
    expect(groundCode("beach")).toBe(0); // (follows the coast by itself)
    expect(groundOfCode(0)).toBeUndefined();
    expect(groundOfCode(99)).toBeUndefined();
  });

  it("works the painting out per pixel: the ground inside, nothing far off, a soft edge that wanders", () => {
    expect(groundPaintPlanes(world())).toBeNull();
    const p = groundPaintPlanes(painted("desert"))!;
    const at = (x: number, y: number) => ({ code: p.code[y * W + x], w: p.weight[y * W + x] });
    expect(at(128, 128)).toEqual({ code: groundCode("desert"), w: 255 });
    expect(at(30, 30)).toEqual({ code: 0, w: 0 });
    // across the edge it fades
    let soft = 0;
    for (let x = 70; x < 110; x++) { const w = p.weight[128 * W + x]; if (w > 0 && w < 255) soft++; }
    expect(soft).toBeGreaterThan(0);
    // on a big map (4 px a cell) the boundary wanders instead of following the cells' staircase
    const big = createDoc({ id: "b", name: "B", width: 2048, height: 2048, kmPerPx: 1 }), g = groundGridOf(big), cells = decodeRealmCells(g);
    paintRealmCells(cells, g, { n: groundCode("moor"), polygon: [[800, 800], [1200, 800], [1200, 1200], [800, 1200]] });
    big.features = { places: [], labels: [], groundCells: encodeRealmCells(g, cells) };
    const bp = groundPaintPlanes(big)!;
    const row = (y: number) => { for (let x = 760; x < 1000; x++) if (bp.weight[y * 2048 + x] > 128) return x; return -1; };
    const starts = [850, 900, 950, 1000, 1050, 1100, 1150].map(row);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(1);
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(12);
    let soft4 = 0;
    for (let x = 760; x < 860; x++) { const w = bp.weight[1000 * 2048 + x]; if (w > 0 && w < 255) soft4++; }
    expect(soft4).toBeGreaterThan(2);
  });

  it("puts the painted ground over the climate's: an ordinary one replaces it, a patchy one grows over it, desert sets the desert's weight", () => {
    const bw = emptyBiomeWeights(), jd = [0, 0];
    bw.temperate = 1;
    applyPaintedGround(groundCode("boreal"), 1, bw, jd);
    expect(bw.temperate).toBe(0);
    expect(bw.boreal).toBe(1);
    const half = emptyBiomeWeights(), jd2 = [0.2, 0];
    half.temperate = 1;
    applyPaintedGround(groundCode("desert"), 0.5, half, jd2);
    expect(half.temperate).toBeCloseTo(0.5);
    expect(jd2[1]).toBeCloseTo(0.5);
    expect(jd2[0]).toBeCloseTo(0.1);
    const patchy = emptyBiomeWeights(), jd3 = [0, 0];
    patchy.temperate = 1;
    applyPaintedGround(groundCode("autumn"), 1, patchy, jd3);
    expect(patchy.temperate).toBe(1); // (autumn colour grows in patches in the woods)
    expect(patchy.autumn).toBe(1);
  });

  it("travels with the other derived layers, and a changed painting is a change only where it changed", () => {
    const a = computeDerived(painted("desert"), buildClimateNoise(W, W, 1), 1);
    expect(a.ground).toBeDefined();
    const back = unpackDerived(packDerived(a), W, W, 1, a.rivers);
    expect(Array.from(back.ground!.subarray(128 * W, 128 * W + W))).toEqual(Array.from(a.ground!.subarray(128 * W, 128 * W + W)));
    expect(Array.from(back.groundW!.subarray(128 * W, 128 * W + W))).toEqual(Array.from(a.groundW!.subarray(128 * W, 128 * W + W)));
    const b = computeDerived(painted("desert", 90, 90, 130, 130), buildClimateNoise(W, W, 1), 2);
    const ch = derivedChange(a, b);
    expect(ch).not.toBe("none");
    expect(ch).not.toBe("all");
    const none = computeDerived(world(), buildClimateNoise(W, W, 1), 3);
    expect(none.ground).toBeUndefined();
  });

  it("is painted on the map: a desert painted into a wet forest is sand-coloured there, and the forest round it stays green", () => {
    const noise = buildNoiseCache(W, W, 7);
    const paint = (d: ReturnType<typeof world>) => { const der = computeDerived(d, buildClimateNoise(W, W, 1), 1), out = new Uint8ClampedArray(W * W * 4); renderPainted(d, der, noise, null, out, undefined, { rivers: false }); return out; };
    const img = paint(painted("desert")), plain = paint(world());
    const avg = (o: Uint8ClampedArray, x0: number, y0: number) => { const s = [0, 0, 0]; for (let y = y0; y < y0 + 20; y++) for (let x = x0; x < x0 + 20; x++) for (let c = 0; c < 3; c++) s[c] += o[(y * W + x) * 4 + c]; return s.map((v) => v / 400); };
    const inside = avg(img, 118, 118), before = avg(plain, 118, 118), outside = avg(img, 40, 120);
    expect(inside[0]).toBeGreaterThan(inside[1] * 1.05); // (sand: red over green)
    expect(inside[0] + inside[1] + inside[2]).toBeGreaterThan(before[0] + before[1] + before[2] + 60); // (much lighter than the forest was)
    expect(outside[1]).toBeGreaterThan(outside[0]); // (the forest round it is still green)
  });
});
