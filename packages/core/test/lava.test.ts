import { describe, expect, it } from "vitest";
import { buildClimateNoise, buildNoiseCache, computeDerived, createDoc, lavaFlows, rasterLava, renderPainted } from "../src/index.ts";

const W = 256;

/** A cone of land (m) in the sea, steepness set by its height, and a plane of volcanic ground over its upper part. */
function cone(heightM: number, volcanicR = 70) {
  const h = new Float32Array(W * W), v = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot(x - 128, y - 128);
    h[y * W + x] = r < 100 ? heightM * (1 - r / 100) + 20 * Math.sin(x * 0.3) * Math.cos(y * 0.27) - 30 : -400;
    v[y * W + x] = r < volcanicR ? 255 : 0;
  }
  return { h, v };
}

describe("lava flows", () => {
  it("none without volcanic ground", () => {
    const { h } = cone(2000);
    expect(lavaFlows(h, W, W, 0, new Uint8Array(W * W), 4)).toEqual([]);
  });

  it("start on the high volcanic ground, run downhill and stay on the volcanic ground", () => {
    const { h, v } = cone(2400);
    const flows = lavaFlows(h, W, W, 0, v, 4);
    expect(flows.length).toBeGreaterThan(3);
    const at = (x: number, y: number) => h[Math.min(W - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)))];
    for (const f of flows) {
      const n = f.pts.length / 2;
      expect(n).toBeGreaterThan(4);
      const hs = at(f.pts[0], f.pts[1]), he = at(f.pts[f.pts.length - 2], f.pts[f.pts.length - 1]);
      expect(he, "the end is lower than the start").toBeLessThan(hs);
      expect(f.widths.length).toBe(n);
      for (const w of f.widths) expect(w).toBeGreaterThan(0.3);
      // the vent is on the upper part of the cone, and nothing runs off the volcanic ground by more than a pixel or two
      expect(Math.hypot(f.pts[0] - 128, f.pts[1] - 128)).toBeLessThan(70);
      for (let k = 0; k < n - 2; k++) expect(v[Math.floor(f.pts[2 * k + 1]) * W + Math.floor(f.pts[2 * k])], "on volcanic ground").toBeGreaterThan(0);
    }
  });

  it("are the same every time, and some glow while most are cooled", () => {
    const { h, v } = cone(2400);
    const a = lavaFlows(h, W, W, 0, v, 4), b = lavaFlows(h, W, W, 0, v, 4);
    expect(b).toEqual(a);
    const fresh = a.filter((f) => f.heat > 0.5).length;
    expect(fresh).toBeGreaterThan(0);
    expect(fresh).toBeLessThan(a.length);
  });

  it("run much further down a steep mountain than across gentle ground (lava is thick and stalls on the flats)", () => {
    const len = (flows: ReturnType<typeof lavaFlows>) => flows.reduce((s, f) => s + f.pts.length / 2, 0) / Math.max(1, flows.length);
    const steep = cone(3000), gentle = cone(500);
    expect(len(lavaFlows(steep.h, W, W, 0, steep.v, 4))).toBeGreaterThan(len(lavaFlows(gentle.h, W, W, 0, gentle.v, 4)) * 1.3);
  });

  it("give every pixel of a tile the same distance whichever tile is asked for", () => {
    const { h, v } = cone(2400);
    const doc = createDoc({ id: "l", name: "L", width: W, height: W, kmPerPx: 4 });
    doc.height.data.set(h);
    const flows = lavaFlows(h, W, W, 0, v, 4);
    const whole = rasterLava(flows, doc.height, { x: 0, y: 0, w: W, h: W })!, part = rasterLava(flows, doc.height, { x: 90, y: 100, w: 50, h: 40 })!;
    expect(whole).not.toBeNull();
    let inside = 0;
    for (let y = 100; y < 140; y++) for (let x = 90; x < 140; x++) {
      const a = whole.edge[y * W + x], b = part.edge[(y - part.r.y) * part.r.w + x - part.r.x];
      expect(b).toBeCloseTo(a, 5);
      if (a < 0) inside++;
    }
    expect(inside, "some of the tile is lava").toBeGreaterThan(0);
  });
});

describe("lava in the painted map", () => {
  const noise = buildNoiseCache(W, W, 7);
  function world() {
    const { h } = cone(2400);
    const d = createDoc({ id: "p", name: "P", width: W, height: W, kmPerPx: 4 });
    d.height.data.set(h);
    d.meta.climate = { latTop: 0.5, latBot: 0.5, moistureNoise: 0.2, wind: "northwest" };
    d.features = { places: [], labels: [], regions: [{ id: "r", name: "R", polygon: [[40, 40], [216, 40], [216, 216], [40, 216]], volcanic: 1, border: "hard" }] };
    return { d, der: computeDerived(d, buildClimateNoise(W, W, 1), 1) };
  }

  it("a glowing flow is bright orange along its middle and a cooled one is darker than the ash beside it", () => {
    const { d, der } = world();
    const flows = lavaFlows(d.height.data, W, W, 0, der.volcanic!, 4);
    const out = new Uint8ClampedArray(W * W * 4);
    renderPainted(d, der, noise, null, out, undefined, { rivers: false });
    const px = (x: number, y: number) => { const o = (Math.floor(y) * W + Math.floor(x)) * 4; return [out[o], out[o + 1], out[o + 2]]; };
    const lum = (p: number[]) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
    let hotOrange = 0, hotN = 0, coolDark = 0, coolN = 0;
    for (const f of flows) {
      const n = f.pts.length / 2;
      for (let k = Math.floor(n * 0.2); k < Math.floor(n * 0.8); k += 2) {
        const x = f.pts[2 * k], y = f.pts[2 * k + 1], c = px(x, y);
        if (f.heat > 0.5) { hotN++; if (c[0] > 170 && c[0] > c[2] * 2.5) hotOrange++; }
        else {
          coolN++;
          const side = px(x + 9, y), side2 = px(x - 9, y); // (ash a few pixels away, off the flow)
          if (lum(c) < (lum(side) + lum(side2)) / 2) coolDark++;
        }
      }
    }
    expect(hotN).toBeGreaterThan(5);
    expect(hotOrange / hotN).toBeGreaterThan(0.5);
    expect(coolN).toBeGreaterThan(5);
    expect(coolDark / coolN).toBeGreaterThan(0.5);
  });

  it("paints a tile exactly as the same part of the whole map", () => {
    const { d, der } = world();
    const whole = new Uint8ClampedArray(W * W * 4), tile = new Uint8ClampedArray(W * W * 4);
    renderPainted(d, der, noise, null, whole, undefined, { rivers: false });
    renderPainted(d, der, noise, { x: 70, y: 60, w: 60, h: 50 }, tile, undefined, { rivers: false });
    for (let y = 60; y < 110; y++) for (let x = 70; x < 130; x++) for (let c = 0; c < 3; c++) expect(tile[(y * W + x) * 4 + c]).toBe(whole[(y * W + x) * 4 + c]);
  });
});
