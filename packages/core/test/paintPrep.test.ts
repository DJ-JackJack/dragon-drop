import { describe, expect, it } from "vitest";
import {
  addLandmass, addMountainRange, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, generateTerrain, paintPrep, renderPainted,
} from "../src/index.ts";

function world(W: number, zoom?: number) {
  const d = createDoc({ id: "p", name: "P", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: W / 2, y: W / 2, r: W * 0.38 }, heightM: 300, seed: 2 });
  addMountainRange(d, { path: [[W * 0.35, W * 0.3], [W * 0.3, W * 0.5], [W * 0.38, W * 0.7]], widthPx: W / 40, peakM: 3200, seed: 3 });
  d.meta.climate = { latTop: 0.7, latBot: 0.3, wind: "northwest" };
  if (zoom) d.meta.zoom = zoom;
  return d;
}

describe("painting from a prepared set of blurred fields", () => {
  for (const zoom of [undefined, 4]) {
    it(`a slice painted from a whole-map prep is exactly the same pixels as the one-shot full render${zoom ? " (zoomed map)" : ""}`, () => {
      const W = 256, d = world(W, zoom);
      const noise = buildNoiseCache(W, W, 7), der = computeDerived(d, buildClimateNoise(W, W, 1), 1);
      const full = new Uint8ClampedArray(W * W * 4);
      renderPainted(d, der, noise, null, full);
      const prep = paintPrep(d, noise, { x: 0, y: 0, w: W, h: W });
      const sliced = new Uint8ClampedArray(W * W * 4);
      for (let y = 0; y < W; y += 40) renderPainted(d, der, noise, { x: 0, y, w: W, h: Math.min(40, W - y) }, sliced, prep);
      let diff = 0;
      for (let i = 0; i < full.length; i++) diff = Math.max(diff, Math.abs(full[i] - sliced[i]));
      expect(diff).toBe(0);
      // and an odd-shaped rect inside it
      const part = new Uint8ClampedArray(W * W * 4);
      const r = { x: 37, y: 91, w: 53, h: 29 };
      renderPainted(d, der, noise, r, part, prep);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) for (let c = 0; c < 4; c++) expect(part[(y * W + x) * 4 + c]).toBe(full[(y * W + x) * 4 + c]);
    });
  }

  it("ignores a prep that does not cover the rect, and builds its own", () => {
    const W = 128, d = world(W);
    const noise = buildNoiseCache(W, W, 7), der = computeDerived(d, buildClimateNoise(W, W, 1), 1);
    const smallPrep = paintPrep(d, noise, { x: 0, y: 0, w: 40, h: 40 });
    const a = new Uint8ClampedArray(W * W * 4), b = new Uint8ClampedArray(W * W * 4);
    const r = { x: 60, y: 60, w: 30, h: 30 };
    renderPainted(d, der, noise, r, a, smallPrep);
    renderPainted(d, der, noise, r, b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("makes a full repaint in slices cheaper than building each slice's own blurs", () => {
    const W = 1024, d = world(W);
    const noise = buildNoiseCache(W, W, 7), der = computeDerived(d, buildClimateNoise(W, W, 1), 1);
    const out = new Uint8ClampedArray(W * W * 4);
    const band = 128;
    const time = (fn: () => void) => { const t = performance.now(); fn(); return performance.now() - t; };
    const perSlice = () => time(() => { for (let y = 0; y < W; y += band) renderPainted(d, der, noise, { x: 0, y, w: W, h: band }, out); });
    const once = () => time(() => {
      const prep = paintPrep(d, noise, { x: 0, y: 0, w: W, h: W });
      for (let y = 0; y < W; y += band) renderPainted(d, der, noise, { x: 0, y, w: W, h: band }, out, prep);
    });
    perSlice(); once(); // warm up
    // best of five each, alternating, so a busy machine (the whole suite runs in parallel) can't decide it. The point is that working the blurs out once is
    // not slower than doing them per slice; painting the pixels has grown to most of the time, so the saving is modest and a small margin keeps timer noise out.
    let a = Infinity, b = Infinity;
    for (let i = 0; i < 5; i++) { a = Math.min(a, perSlice()); b = Math.min(b, once()); }
    // On GitHub's shared two-core machines the times wander more (2026-11-24: 13% the wrong way on a docs-only push whose code had passed twice), so there
    // it only guards against working the blurs out once becoming clearly slower; on a PC the small margin holds.
    const onCi = !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI;
    expect(b).toBeLessThan(a * (onCi ? 1.3 : 1.08));
  }, 120000);
});
