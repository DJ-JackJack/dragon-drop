import { describe, expect, it } from "vitest";
import { addLandmass, addMountainRange, createDoc, generateTerrain, placeholderFactor, renderInto, renderPlaceholder } from "../src/index.ts";

function world(W: number) {
  const d = createDoc({ id: "p", name: "P", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: W / 2, y: W / 2, r: W * 0.35 }, heightM: 300, seed: 2 });
  addMountainRange(d, { path: [[W * 0.4, W * 0.3], [W * 0.35, W * 0.5], [W * 0.4, W * 0.7]], widthPx: W / 40, peakM: 3000, seed: 3 });
  return d;
}

describe("the quick preview shown while the painted style prepares", () => {
  it("shrinks big maps and leaves small ones alone", () => {
    expect(placeholderFactor(2048)).toBe(4);
    expect(placeholderFactor(1024)).toBe(4);
    expect(placeholderFactor(768)).toBe(2);
    expect(placeholderFactor(256)).toBe(1);
  });

  it("covers every pixel, with land and sea clearly different and hills shaded", () => {
    const d = world(1024), out = new Uint8ClampedArray(1024 * 1024 * 4);
    renderPlaceholder(d, out);
    let opaque = 0;
    for (let i = 3; i < out.length; i += 4) if (out[i] === 255) opaque++;
    expect(opaque).toBe(1024 * 1024);
    const px = (x: number, y: number) => [out[(y * 1024 + x) * 4], out[(y * 1024 + x) * 4 + 1], out[(y * 1024 + x) * 4 + 2]];
    const sea = px(20, 20), land = px(560, 700);
    expect(sea[2]).toBeGreaterThan(sea[0]); // sea is blue
    expect(land[1]).toBeGreaterThan(land[2]); // land is not
    // the mountain range is shaded: brightness varies across its slopes
    const lum = (p: number[]) => p[0] + p[1] + p[2];
    const ridge = Array.from({ length: 40 }, (_, i) => lum(px(380 + i, 512)));
    expect(Math.max(...ridge) - Math.min(...ridge)).toBeGreaterThan(40);
  });

  it("looks like the real relief of the same map, just blockier", () => {
    const d = world(1024);
    const quick = new Uint8ClampedArray(1024 * 1024 * 4), real = new Uint8ClampedArray(1024 * 1024 * 4);
    renderPlaceholder(d, quick);
    renderInto(d, null, real, { hillshade: true });
    let diff = 0, n = 0;
    for (let y = 8; y < 1016; y += 4) for (let x = 8; x < 1016; x += 4) { const i = (y * 1024 + x) * 4; diff += Math.abs(quick[i] - real[i]) + Math.abs(quick[i + 1] - real[i + 1]) + Math.abs(quick[i + 2] - real[i + 2]); n += 3; }
    expect(diff / n).toBeLessThan(18); // average colour error out of 255
  });

  it("is much cheaper than rendering the whole map at full size", () => {
    const d = world(2048);
    const out = new Uint8ClampedArray(2048 * 2048 * 4);
    const a = performance.now(); renderPlaceholder(d, out); const quick = performance.now() - a;
    const b = performance.now(); renderInto(d, null, out, { hillshade: true }); const full = performance.now() - b;
    expect(quick).toBeLessThan(full * 0.5);
  });
});
