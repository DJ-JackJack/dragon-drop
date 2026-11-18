import { describe, expect, it } from "vitest";
import { computeFlow, computeHydrology, createDoc, distanceTo, gaussianBlur, generateTerrain, MapSession, removeSmall, removeSpires, upwindMax } from "../src/index.ts";

describe("fields", () => {
  it("computes exact distances", () => {
    const W = 9, H = 5, m = new Uint8Array(W * H);
    m[2 * W + 4] = 1;
    const d = distanceTo(m, W, H);
    expect(d[2 * W + 4]).toBe(0);
    expect(d[2 * W + 7]).toBeCloseTo(3, 5);
    expect(d[0]).toBeCloseTo(Math.hypot(4, 2), 5);
  });
  it("blurs while preserving the mean, and takes upwind maxima", () => {
    const W = 32, H = 32, a = new Float32Array(W * H);
    a[16 * W + 16] = 1000;
    const b = gaussianBlur(a, W, H, 2);
    const sum = b.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1000, 0);
    expect(b[16 * W + 16]).toBeLessThan(100);
    const row = new Float32Array([1, 5, 2, 0, 0, 0, 0]);
    expect(Array.from(upwindMax(row, 7, 1, 2, 1))).toEqual([1, 5, 5, 5, 2, 0, 0]);
  });
  it("removes small components", () => {
    const W = 10, H = 10, m = new Uint8Array(W * H);
    m[11] = 1; // single cell
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) m[y * W + x] = 1;
    const out = removeSmall(m, W, H, 4);
    expect(out[11]).toBe(0);
    expect(out[5 * W + 5]).toBe(1);
  });
});

describe("hydrology", () => {
  it("routes all land to the sea and grows rivers that only flow downhill", () => {
    const d = createDoc({ id: "h", name: "H", width: 256, height: 256, kmPerPx: 2 });
    generateTerrain(d.height ? d : d, { template: "island", seed: 9, landFraction: 0.4, mountains: 0.7 });
    const { w: W, h: H, data } = d.height;
    const f = computeFlow(data, W, H, 0);
    // every land cell eventually reaches the sea (no sinks)
    let stuck = 0;
    for (let i = 0; i < W * H; i++) {
      if (data[i] <= 0) continue;
      let c = i, steps = 0;
      while (c >= 0 && data[c] > 0 && steps < W * H) { c = f.receiver[c]; steps++; }
      if (c >= 0 && data[c] > 0) stuck++;
    }
    expect(stuck).toBe(0);
    const hy = computeHydrology(data, W, H, 0, { riverDensity: 0.6 });
    expect(hy.rivers.length).toBeGreaterThan(3);
    const r = hy.rivers.sort((a, b) => b.pts.length - a.pts.length)[0];
    expect(r.widths[r.widths.length - 1]).toBeGreaterThanOrEqual(r.widths[0]);
  });

  it("erosion is undoable and lowers mountains without drowning land", () => {
    const d = createDoc({ id: "e", name: "E", width: 192, height: 192, kmPerPx: 2 });
    generateTerrain(d, { template: "island", seed: 4, landFraction: 0.4, mountains: 0.9 });
    const s = new MapSession(d);
    const before = new Float32Array(d.height.data);
    const land0 = before.filter((v) => v > 0).length;
    s.execute({ op: "erode", params: { strength: 0.8, passes: 3 } }, "claude");
    const after = d.height.data;
    expect(after.filter((v) => v > 0).length).toBe(land0);
    let lowered = 0;
    for (let i = 0; i < after.length; i++) if (after[i] < before[i] - 1) lowered++;
    expect(lowered).toBeGreaterThan(100);
    s.undo("user");
    expect(d.height.data).toEqual(before);
  });
});

describe("removeSpires (rain-shadow barriers)", () => {
  it("removes a lone spire but keeps a long ridge in any direction", () => {
    const W = 64, H = 64;
    const f = new Float32Array(W * H).fill(0.1);
    // a 3-px spire at (16, 16) and a 2-px-wide diagonal ridge from (30, 30) to (60, 60)
    for (let y = 15; y <= 17; y++) for (let x = 15; x <= 17; x++) f[y * W + x] = 2.5;
    for (let t = 30; t <= 60; t++) { f[t * W + t] = 0.8; f[t * W + t + 1] = 0.8; }
    const out = removeSpires(f, W, H, 4);
    expect(out[16 * W + 16]).toBeCloseTo(0.1, 5);
    expect(out[45 * W + 45]).toBeCloseTo(0.8, 5);
    expect(out[50 * W + 10]).toBeCloseTo(0.1, 5);
  });
});
