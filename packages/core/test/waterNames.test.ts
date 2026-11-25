import { describe, expect, it } from "vitest";
import {
  type LakeShape, type RiverPath, buildClimateNoise, carveValleys, computeDerived, computeHydrology, createDoc, generateTerrain, namedWaterAt, resolveWaterNames, riverCourse,
  riverList, riverNet, riverOwner, seaNear, waterAt,
} from "../src/index.ts";

/** A river piece through points (every point given), with a width at each. */
const piece = (pts: [number, number][], width: (k: number) => number): RiverPath => ({ pts: pts.flat(), widths: pts.map((_, k) => width(k)) });
const line = (x0: number, y0: number, x1: number, y1: number, n: number): [number, number][] => Array.from({ length: n + 1 }, (_, k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);

describe("which river is which (water model stage 3)", () => {
  // A: a big river running east along y = 50; B: a small one from the north ending on A at x = 50.
  // T: traced first, a small river running east along y = 150; M: a bigger one from the north ending on T at x = 50, so below that the bigger one keeps its name.
  const A = piece(line(0, 50, 100, 50, 20), (k) => 1 + k / 20);
  const B = piece(line(50, 0, 50, 50, 10), () => 0.5);
  const T = piece(line(0, 150, 100, 150, 20), (k) => (k < 10 ? 0.5 : 2));
  const M = piece(line(50, 100, 50, 150, 10), () => 1.6);
  const rivers = [A, B, T, M];
  const net = riverNet(rivers);

  it("finds where each piece ends on another, and which one carries on", () => {
    expect(net.joins[0]).toBeNull();
    expect(net.joins[1]).toEqual({ river: 0, at: 10 });
    expect(net.joins[3]).toEqual({ river: 2, at: 10 });
    expect(net.takeovers[0]).toEqual([]); // B is smaller than A: A keeps its name
    expect(net.takeovers[2]).toEqual([[10, 3]]); // M is bigger than T above the junction: M carries on
    expect(riverOwner(net, 0, 15)).toBe(0);
    expect(riverOwner(net, 2, 5)).toBe(2); // T above the junction is T
    expect(riverOwner(net, 2, 15)).toBe(3); // below it, M
  });

  it("follows a river from its head to where it ends", () => {
    const b = riverCourse(net, 1);
    expect(b.end).toBe("river");
    expect(b.joins).toBe(0);
    expect(b.length).toBeCloseTo(50, 5);
    const m = riverCourse(net, 3);
    expect(m.parts).toEqual([{ river: 3, from: 0, to: 10 }, { river: 2, from: 10, to: 20 }]);
    expect(m.end).toBe("open");
    expect(m.length).toBeCloseTo(100, 5);
    const t = riverCourse(net, 2);
    expect(t).toMatchObject({ end: "river", joins: 3 });
    expect(t.length).toBeCloseTo(50, 5);
    // every river once, longest first (A and M are 100 px, B and T 50)
    expect(riverList(net).map((r) => r.head).sort()).toEqual([0, 1, 2, 3]);
    expect(riverList(net)[0].course.length).toBeCloseTo(100, 5);
  });

  it("gives each name its river or lake and a label along it", () => {
    const lake: LakeShape = { x: 200, y: 50, areaKm2: 3000, outflow: "river", outline: [[190, 40], [210, 40], [210, 60], [190, 60]] };
    const names = [
      { id: "w-a", kind: "river" as const, name: "Alder", x: 30, y: 51 },
      { id: "w-b", kind: "river" as const, name: "Brook", x: 50, y: 20 },
      { id: "w-m", kind: "river" as const, name: "Mere", x: 80, y: 150 }, // on T's piece, below the junction: that is M's stretch
      { id: "w-l", kind: "lake" as const, name: "Still Water", x: 205, y: 45 },
      { id: "w-x", kind: "river" as const, name: "Lost", x: 150, y: 250 },
    ];
    const v = resolveWaterNames(names, net, [lake], { mapWidth: 1024, kmPerPx: 2, isSea: (x) => x >= 100 });
    const by = Object.fromEntries(v.named.map((n) => [n.id, n]));
    expect(by["w-a"]).toMatchObject({ found: true, head: 0, lengthKm: 200, end: "sea" });
    expect(by["w-b"]).toMatchObject({ found: true, head: 1, end: "river", joins: "Alder" });
    expect(by["w-m"]).toMatchObject({ found: true, head: 3, lengthKm: 200 });
    expect(by["w-l"]).toMatchObject({ found: true, lake: 0, areaKm2: 3000, outflow: "river" });
    expect(by["w-x"]).toMatchObject({ found: false });
    // labels: along the river round the named spot, or in the lake's middle (a great lake's a little bigger)
    const la = v.labels.find((l) => l.id === "w-a")!;
    expect(la.path!.length).toBeGreaterThan(2);
    expect(la.path!.every(([, y]) => y === 50)).toBe(true);
    expect(v.labels.find((l) => l.id === "w-l")).toMatchObject({ x: 200, y: 50, size: 1.25 });
    expect(v.labels.some((l) => l.id === "w-x")).toBe(false);
    // what the River tool finds under the pointer
    expect(namedWaterAt(v.named, net, waterAt(rivers, [lake], 70, 151, 3))?.name).toBe("Mere");
    expect(namedWaterAt(v.named, net, waterAt(rivers, [lake], 20, 149, 3))).toBeNull(); // T above the junction has no name
    expect(namedWaterAt(v.named, net, waterAt(rivers, [lake], 200, 50, 3))?.name).toBe("Still Water");
    expect(waterAt(rivers, [lake], 150, 250, 3)).toBeNull();
  });

  it("draws a name at its own size: a bigger name, and a longer stretch of river to hold it", () => {
    const lake: LakeShape = { x: 200, y: 50, areaKm2: 3000, outflow: "river", outline: [[190, 40], [210, 40], [210, 60], [190, 60]] };
    const plain = resolveWaterNames([{ id: "w-a", kind: "river", name: "Alder", x: 30, y: 51 }], net, [lake], { mapWidth: 1024, kmPerPx: 2 });
    const big = resolveWaterNames([
      { id: "w-a", kind: "river", name: "Alder", x: 30, y: 51, nameSize: 2 },
      { id: "w-l", kind: "lake", name: "Still Water", x: 205, y: 45, nameSize: 2 },
    ], net, [lake], { mapWidth: 1024, kmPerPx: 2 });
    const len = (p: [number, number][]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
    const a0 = plain.labels.find((l) => l.id === "w-a")!, a = big.labels.find((l) => l.id === "w-a")!;
    expect(a0.size).toBeUndefined();
    expect(a.size).toBe(2);
    expect(len(a.path!)).toBeGreaterThan(len(a0.path!));
    expect(big.labels.find((l) => l.id === "w-l")!.size).toBe(2.5); // (a great lake's 1.25, times its own 2)
  });

  it("keeps a name on its river on a generated map, and tells the sea from the edge", () => {
    const d = createDoc({ id: "n", name: "N", width: 256, height: 256, kmPerPx: 3 });
    generateTerrain(d, { template: "island", seed: 21, landFraction: 0.45, mountains: 0.7 });
    const der = computeDerived(d, buildClimateNoise(256, 256, d.meta.seed), 0);
    const n = riverNet(der.rivers), longest = riverList(n, der.hydro!.shapes)[0];
    expect(longest.course.length).toBeGreaterThan(20);
    const p = longest.course.pts, mid = Math.floor(p.length / 4) * 2;
    const v = resolveWaterNames([{ id: "w-1", kind: "river", name: "Test River", x: p[mid] + 1, y: p[mid + 1] }], n, der.hydro!.shapes, { mapWidth: 256, kmPerPx: 3, isSea: seaNear(d.height.data, 256, 256, d.meta.seaLevel) });
    expect(v.named[0]).toMatchObject({ found: true, head: longest.head });
    expect(["sea", "lake", "river"]).toContain(v.named[0].end);
    expect(v.labels[0].path!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("carving valleys (water model stage 2)", () => {
  const d = createDoc({ id: "c", name: "C", width: 256, height: 256, kmPerPx: 2 });
  generateTerrain(d, { template: "island", seed: 5, landFraction: 0.45, mountains: 0.8 });
  const sea = d.meta.seaLevel, h = d.height.data;
  const der = computeDerived(d, buildClimateNoise(256, 256, d.meta.seed), 0);

  it("lowers the land along the rivers and never raises it or cuts it below the sea", () => {
    const r = carveValleys(h, 256, 256, sea, der.rivers, { kmPerPx: 2, strength: 0.6, deltas: false });
    expect(r.lowered).toBeGreaterThan(200);
    expect(r.deepestM).toBeGreaterThan(5);
    expect(r.deltaCells).toBe(0);
    let raised = 0, drowned = 0;
    for (let i = 0; i < h.length; i++) {
      if (r.heights[i] > h[i] + 1e-3) raised++;
      if (h[i] > sea && r.heights[i] < sea + 0.49) drowned++;
    }
    expect(raised).toBe(0);
    expect(drowned).toBe(0);
    // along the biggest river the land is lower than it was, and the map itself is untouched
    const big = [...der.rivers].sort((a, b) => b.pts.length - a.pts.length)[0];
    let lower = 0, n = 0;
    for (let k = 0; k < big.pts.length; k += 2) {
      const c = Math.floor(big.pts[k + 1]) * 256 + Math.floor(big.pts[k]);
      if (h[c] <= sea) continue;
      n++;
      if (r.heights[c] < h[c] - 0.5) lower++;
    }
    expect(lower / n).toBeGreaterThan(0.6);
    expect(d.height.data).toBe(h);
    // more strength cuts deeper
    expect(carveValleys(h, 256, 256, sea, der.rivers, { kmPerPx: 2, strength: 1, deltas: false }).deepestM).toBeGreaterThan(r.deepestM);
  });

  it("builds a delta where a big river meets a shallow sea over flat ground", () => {
    const W = 128, hs = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) hs[y * W + x] = y < 90 ? 20 + (90 - y) * 0.5 : -8;
    const river = piece(line(64, 5, 64, 91, 86), (k) => 0.6 + k / 50);
    const r = carveValleys(hs, W, W, 0, [river], { kmPerPx: 1, strength: 0.5 });
    expect(r.deltaCells).toBeGreaterThan(10);
    // the new land is low, just above the sea, and spreads out from the mouth
    let newLand = 0, wide = 0;
    for (let y = 90; y < W; y++) for (let x = 0; x < W; x++) if (r.heights[y * W + x] > 0) { newLand++; expect(r.heights[y * W + x]).toBeLessThan(4); if (Math.abs(x - 64) > 3) wide++; }
    expect(newLand).toBe(r.deltaCells);
    expect(wide).toBeGreaterThan(0);
    // and none without deltas, or when the sea is deep
    expect(carveValleys(hs, W, W, 0, [river], { kmPerPx: 1, deltas: false }).deltaCells).toBe(0);
    const deep = hs.map((v) => (v < 0 ? -200 : v));
    expect(carveValleys(deep, W, W, 0, [river], { kmPerPx: 1 }).deltaCells).toBe(0);
  });
});

describe("lowland rivers (water model stage 4)", () => {
  // a broad, very gentle plain falling south to the sea, with a great river fed in at the top
  const W = 256, h = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) h[y * W + x] = y >= 220 ? -20 : 40 + (220 - y) * 0.15 + Math.sin(x / 9) * 0.4;
  const opts = { riverDensity: 0.5, seed: 3, inflows: [{ x: 128, y: 10, share: 0.3 }] };

  it("changes nothing unless asked", () => {
    const a = computeHydrology(h, W, W, 0, opts), b = computeHydrology(h, W, W, 0, { ...opts, lowland: false });
    expect(JSON.stringify(b.rivers)).toBe(JSON.stringify(a.rivers));
    expect(a.oxbows).toBeUndefined();
  });

  it("swings big rivers in wide loops with oxbow lakes, and widens them at the sea", () => {
    const plain = computeHydrology(h, W, W, 0, opts), low = computeHydrology(h, W, W, 0, { ...opts, lowland: true });
    expect(low.oxbows).toBeDefined();
    let ox = 0;
    for (let i = 0; i < W * W; i++) if (low.oxbows![i]) { ox++; expect(h[i]).toBeGreaterThan(0); }
    expect(ox).toBeGreaterThan(0);
    const big = (rs: RiverPath[]) => [...rs].sort((a, b) => Math.max(...b.widths) - Math.max(...a.widths))[0];
    // the loops: the big river strays further from a straight line
    const wander = (r: RiverPath) => { const xs = r.pts.filter((_, k) => k % 2 === 0); return Math.max(...xs) - Math.min(...xs); };
    expect(wander(big(low.rivers))).toBeGreaterThan(wander(big(plain.rivers)));
    // the estuary: its last stretch is wider than before it
    const r = big(low.rivers), n = r.widths.length;
    expect(r.widths[n - 1]).toBeGreaterThan(r.widths[Math.floor(n * 0.7)] * 1.5);
  });
});
