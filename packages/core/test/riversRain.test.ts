// Fewer rivers, or none (found by a playtester, 2026-11-23: a desert continent made into a map of its own was filled with rivers, and nothing took them away).
import { describe, expect, it } from "vitest";
import { computeHydrology } from "../src/hydrology.ts";

// an island: a rough dome falling to the sea on every side, so water runs off in many gullies
const W = 192, H = 192, SEA = 0;
const island = (() => {
  const h = new Float32Array(W * H);
  let s = 3;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const bumps = Array.from({ length: 40 }, () => [rnd() * W, rnd() * H, 6 + rnd() * 14, (rnd() - 0.5) * 120] as const);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 900 - 1100 * (Math.hypot(x - W / 2, y - H / 2) / (W / 2));
    for (const [bx, by, br, bh] of bumps) v += bh * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * br * br));
    h[y * W + x] = v;
  }
  return h;
})();
const uniform = (v: number) => new Float32Array(W * H).fill(v);
const riverLength = (hy: ReturnType<typeof computeHydrology>) => hy.rivers.reduce((n, r) => n + r.pts.length / 2, 0);

describe("how many rivers the rain makes", () => {
  it("counts rivers against the map's own water by default, so a desert of its own fills with them (as before)", () => {
    const dry = riverLength(computeHydrology(island, W, H, SEA, { runoff: uniform(0.08) }));
    const wet = riverLength(computeHydrology(island, W, H, SEA, { runoff: uniform(0.7) }));
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeGreaterThan(wet * 0.8); // (the same rivers: only the share counts)
  });

  it("with rivers following the rain, a dry map has far fewer, and a rainy one keeps its own", () => {
    const wetBefore = riverLength(computeHydrology(island, W, H, SEA, { runoff: uniform(0.7) }));
    const wet = riverLength(computeHydrology(island, W, H, SEA, { runoff: uniform(0.7), followRain: true }));
    const dry = riverLength(computeHydrology(island, W, H, SEA, { runoff: uniform(0.08), followRain: true }));
    expect(wet).toBe(wetBefore);
    expect(dry).toBeLessThan(wet * 0.4);
  });

  it("makes no rivers from the rain when asked, and still lets a river source's river flow", () => {
    const none = computeHydrology(island, W, H, SEA, { runoff: uniform(0.7), noRainRivers: true });
    expect(none.rivers).toHaveLength(0);
    const spring = computeHydrology(island, W, H, SEA, { runoff: uniform(0.7), noRainRivers: true, inflows: [{ x: W / 2, y: H / 2, share: 0.03 }] });
    expect(spring.rivers.length).toBeGreaterThan(0);
    // its river starts at the spring: every river point lies downhill of it, nothing comes from elsewhere
    const [first] = spring.rivers;
    expect(Math.hypot(first.pts[0] - W / 2, first.pts[1] - H / 2)).toBeLessThan(6);
  });
});
