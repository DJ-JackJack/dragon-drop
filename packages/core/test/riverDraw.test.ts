// Rivers drawn by hand (riverDraw.ts): a channel cut along the line, and the water then really runs along it when the rivers are worked out again.
import { describe, expect, it } from "vitest";
import { MapSession, RIVER_SIZE_SHARE, buildClimateNoise, carveValleys, computeDerived, computeHydrology, courseRivers, createDoc, generateTerrain, riverChannel, riverCourse, riverHeadAt, riverNet } from "../src/index.ts";

const W = 256, SEA = 0;
/** Land falling east, 1 m every map px, with the sea beyond x = 220. */
function eastSlope(): Float32Array {
  const h = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) h[y * W + x] = x >= 220 ? -20 : 260 - x + Math.sin(y / 7) * 0.6;
  return h;
}
const apply = (h: Float32Array, c: { rect: { x: number; y: number; w: number; h: number }; data: Float32Array }) => {
  const out = h.slice();
  for (let y = 0; y < c.rect.h; y++) out.set(c.data.subarray(y * c.rect.w, (y + 1) * c.rect.w), (c.rect.y + y) * W + c.rect.x);
  return out;
};
/** How much of a drawn stretch has a traced river within `tol` px. */
function followed(rivers: { pts: number[] }[], stretch: [number, number][], tol: number): number {
  let hit = 0;
  for (const [x, y] of stretch) if (rivers.some((r) => { for (let k = 0; k < r.pts.length; k += 2) if (Math.hypot(r.pts[k] - x, r.pts[k + 1] - y) <= tol) return true; return false; })) hit++;
  return hit / stretch.length;
}

describe("a river drawn by hand", () => {
  // south across the slope (where the water would rather run east), then east to the sea
  const line: [number, number][] = [[40, 30], [40, 120], [44, 200], [120, 204], [240, 206]];

  it("cuts a channel the water follows, even across a slope, and starts the river at the line's first point", () => {
    const h = eastSlope();
    const c = riverChannel(h, W, W, SEA, line, { size: "river", kmPerPx: 2 });
    if ("error" in c) throw new Error(c.error);
    expect(c.end).toBe("sea");
    expect(c.reversed).toBe(false);
    expect(c.start[0]).toBeCloseTo(40, 0);
    expect(c.start[1]).toBeCloseTo(30, 0);
    expect(c.lowered).toBeGreaterThan(100);
    const cut = apply(h, c);
    // land only lowered, never below the sea
    let raised = 0, drowned = 0;
    for (let i = 0; i < h.length; i++) { if (cut[i] > h[i] + 1e-4) raised++; if (h[i] > SEA && cut[i] < SEA + 0.49) drowned++; }
    expect(raised).toBe(0);
    expect(drowned).toBe(0);
    // the water: without the channel the source's river runs straight east; with it, it follows the drawing
    const inflows = [{ x: c.start[0], y: c.start[1], share: RIVER_SIZE_SHARE.river }];
    const across: [number, number][] = Array.from({ length: 15 }, (_, k) => [40 + (k * 4) / 15, 45 + k * 10]);
    const before = computeHydrology(h, W, W, SEA, { inflows, seed: 1 }).rivers;
    const after = computeHydrology(cut, W, W, SEA, { inflows, seed: 1 }).rivers;
    expect(followed(before, across, 3)).toBeLessThan(0.3);
    expect(followed(after, across, 3)).toBeGreaterThan(0.9);
    // and on along the second stretch to the sea
    const toSea: [number, number][] = Array.from({ length: 10 }, (_, k) => [60 + k * 15, 204 + k * 0.2]);
    expect(followed(after, toSea, 3)).toBeGreaterThan(0.8);
  });

  it("is turned round when drawn from the mouth up, and refuses a line with both ends in the sea", () => {
    const h = eastSlope();
    const c = riverChannel(h, W, W, SEA, [...line].reverse(), { size: "stream", kmPerPx: 2 });
    if ("error" in c) throw new Error(c.error);
    expect(c.reversed).toBe(true);
    expect(c.start[0]).toBeCloseTo(40, 0);
    expect(c.end).toBe("sea");
    const both = riverChannel(h, W, W, SEA, [[230, 10], [240, 200]], { size: "river", kmPerPx: 2 });
    expect("error" in both).toBe(true);
    // a line that starts on the coast and runs inland is the mouth first: turned round
    const fromCoast = riverChannel(h, W, W, SEA, [[217, 100], [60, 100]], { size: "river", kmPerPx: 2 });
    if ("error" in fromCoast) throw new Error(fromCoast.error);
    expect(fromCoast.reversed).toBe(true);
    expect(fromCoast.start[0]).toBeCloseTo(60, 0);
    // both ends on the coast: a river can't begin at the sea, so it is refused (with a reason)
    const coastToCoast = riverChannel(h, W, W, SEA, [[217, 40], [150, 90], [217, 160]], { size: "river", kmPerPx: 2 });
    expect(coastToCoast).toMatchObject({ error: expect.stringMatching(/inland/) });
    expect("error" in riverChannel(h, W, W, SEA, [[40, 30]], { size: "river", kmPerPx: 2 })).toBe(true);
  });

  it("a bigger river cuts wider and deeper", () => {
    const h = eastSlope();
    const s = riverChannel(h, W, W, SEA, line, { size: "stream", kmPerPx: 2 }), g = riverChannel(h, W, W, SEA, line, { size: "great", kmPerPx: 2 });
    if ("error" in s || "error" in g) throw new Error("no channel");
    expect(g.lowered).toBeGreaterThan(s.lowered);
    expect(g.deepestM).toBeGreaterThan(s.deepestM);
  });

  it("as one undo step with its source (patch_heights)", () => {
    const d = createDoc({ id: "r", name: "R", width: W, height: W, kmPerPx: 2 });
    d.height.data.set(eastSlope());
    d.meta.seaLevel = SEA;
    const s = new MapSession(d), before = d.height.data.slice();
    const c = riverChannel(d.height.data, W, W, SEA, line, { size: "river", kmPerPx: 2 });
    if ("error" in c) throw new Error(c.error);
    s.execute({ op: "patch_heights", rect: c.rect, data: c.data, features: { upsertSources: [{ id: "s-1", x: c.start[0], y: c.start[1], size: "river" }] }, label: "Draw a river" }, "user");
    expect(d.features?.sources?.length).toBe(1);
    expect(d.height.data.some((v, i) => v !== before[i])).toBe(true);
    s.undo("user");
    expect(d.features?.sources?.length ?? 0).toBe(0);
    expect(d.height.data.every((v, i) => v === before[i])).toBe(true);
  });
});

describe("carving part of the map", () => {
  const d = createDoc({ id: "c", name: "C", width: W, height: W, kmPerPx: 2 });
  generateTerrain(d, { template: "island", seed: 5, landFraction: 0.45, mountains: 0.8 });
  const sea = d.meta.seaLevel, h = d.height.data;
  const der = computeDerived(d, buildClimateNoise(W, W, d.meta.seed), 0);

  it("inside an area: nothing outside changes, and the box that changed lies within it", () => {
    const whole = carveValleys(h, W, W, sea, der.rivers, { kmPerPx: 2, deltas: false });
    const shape = { type: "rect" as const, x: 64, y: 64, w: 128, h: 128 };
    const part = carveValleys(h, W, W, sea, der.rivers, { kmPerPx: 2, deltas: false, within: { shape, featherPx: 8 } });
    expect(part.lowered).toBeGreaterThan(0);
    expect(part.lowered).toBeLessThan(whole.lowered);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (x >= 64 && x < 192 && y >= 64 && y < 192) continue;
      expect(part.heights[y * W + x]).toBe(h[y * W + x]);
    }
    expect(part.rect).not.toBeNull();
    expect(part.rect!.x).toBeGreaterThanOrEqual(64);
    expect(part.rect!.x + part.rect!.w).toBeLessThanOrEqual(192);
  });

  it("one river: only along its course", () => {
    const net = riverNet(der.rivers);
    const big = [...der.rivers.keys()].sort((a, b) => der.rivers[b].pts.length - der.rivers[a].pts.length)[0];
    const r = der.rivers[big], mid = Math.floor(r.pts.length / 4) * 2;
    const head = riverHeadAt(net, r.pts[mid], r.pts[mid + 1], 2);
    expect(head).not.toBeNull();
    const one = courseRivers(net, riverCourse(net, head!));
    expect(one.length).toBeGreaterThan(0);
    const res = carveValleys(h, W, W, sea, one, { kmPerPx: 2, deltas: false });
    const all = carveValleys(h, W, W, sea, der.rivers, { kmPerPx: 2, deltas: false });
    expect(res.lowered).toBeGreaterThan(0);
    expect(res.lowered).toBeLessThan(all.lowered);
  });
});
