import { describe, expect, it } from "vitest";
import { HeightField, type MapDoc, buildClimateNoise, computeDerived, inkStep, inkSymbols, renderInk } from "../src/index.ts";

/** An island: a round mountain in a sea, 256 px, 2 km a px. */
function island(): MapDoc {
  const W = 256, H = 256, h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - 128, y - 128);
    h[y * W + x] = 2600 * Math.max(0, 1 - d / 80) ** 1.3 - 200;
  }
  const now = new Date().toISOString();
  return { meta: { id: "i", name: "Isle", kind: "world", width: W, height: H, kmPerPx: 2, seaLevel: 0, seed: 5, createdAt: now, updatedAt: now, style: "ink" }, height: new HeightField(W, H, h) };
}

describe("the ink style", () => {
  it("puts peaks on the heights, nothing at sea, the same every time", () => {
    const doc = island(), d = computeDerived(doc, buildClimateNoise(256, 256, 5), 0);
    const a = inkSymbols(doc, d), b = inkSymbols(doc, d);
    expect(a).toEqual(b);
    const peaks = a.filter((s) => s.kind === "mountain");
    expect(peaks.length).toBeGreaterThan(3);
    expect(peaks.every((s) => Math.hypot(s.x - 128, s.y - 128) < 55)).toBe(true);
    expect(a.every((s) => doc.height.data[s.y * 256 + s.x] > 0)).toBe(true);
    // back to front
    for (let k = 1; k < a.length; k++) expect(a[k].y).toBeGreaterThanOrEqual(a[k - 1].y);
    expect(inkStep(1024, 512)).toBe(9);
  });

  it("paints parchment land, paler sea and an inked coast, the same tile by tile as all at once", () => {
    const doc = island(), d = computeDerived(doc, buildClimateNoise(256, 256, 5), 0), sy = inkSymbols(doc, d);
    const whole = new Uint8ClampedArray(256 * 256 * 4);
    renderInk(doc, d, { x: 0, y: 0, w: 256, h: 256 }, whole, sy);
    const px = (img: Uint8ClampedArray, x: number, y: number) => Array.from(img.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3));
    const sea = px(whole, 5, 5);
    expect(sea[2]).toBeGreaterThan(190); // (pale sea)
    // the coast, about 77 px out from the middle, is dark ink somewhere along a line across it
    const across = Array.from({ length: 12 }, (_, k) => px(whole, 128 + 70 + k, 128)).map(([r, g, b]) => r + g + b);
    expect(Math.min(...across)).toBeLessThan(500); // (parchment is about 650)
    // (most of the land is parchment, between the symbols)
    const reds = Array.from({ length: 200 }, (_, k) => px(whole, 128 + Math.round(Math.cos(k / 31.8) * 62), 128 + Math.round(Math.sin(k / 31.8) * 62))[0]).sort((p, q) => p - q);
    expect(reds[100]).toBeGreaterThan(120); // (ink is about 60)
    // four tiles give the same picture
    const tiled = new Uint8ClampedArray(256 * 256 * 4);
    for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128]]) renderInk(doc, d, { x, y, w: 128, h: 128 }, tiled, sy);
    expect(tiled).toEqual(whole);
  });
});
