import { describe, expect, it } from "vitest";
import {
  addLandmass, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, generateTerrain, packDerived, regionRock, renderPainted, unpackDerived,
} from "../src/index.ts";

const W = 192;
const world = () => {
  const d = createDoc({ id: "w", name: "W", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: 96, y: 96, r: 80 }, heightM: 220, seed: 2 });
  d.meta.climate = { latTop: 0.5, latBot: 0.5, moistureNoise: 0.2 };
  return d;
};
const circle = (x: number, y: number, r: number): [number, number][] => Array.from({ length: 32 }, (_, i) => [x + r * Math.cos((i / 32) * 2 * Math.PI), y + r * Math.sin((i / 32) * 2 * Math.PI)]);

describe("bare dark stone", () => {
  it("makes a stone layer from regions that ask for it, softly edged, and none when none do", () => {
    expect(regionRock(undefined, W, W, 4)).toBeUndefined();
    expect(regionRock([{ id: "a", name: "a", polygon: circle(96, 96, 30), temperature: 0.2 }], W, W, 4)).toBeUndefined();
    const rock = regionRock([{ id: "r", name: "Stone", polygon: circle(96, 96, 30), rock: 1, border: "soft", blendKm: 40 }], W, W, 4)!;
    expect(rock[96 * W + 96]).toBeGreaterThan(240); // the middle: all stone
    expect(rock[96 * W + 140]).toBe(0); // well outside
    const edge = rock[96 * W + 124]; // near the rim: partway
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(rock[96 * W + 96]);
    const half = regionRock([{ id: "r", name: "Stone", polygon: circle(96, 96, 30), rock: 0.5 }], W, W, 4)!;
    expect(half[96 * W + 96]).toBeLessThan(135);
  });

  it("travels with the derived layers over the wire", () => {
    const d = world();
    d.features = { places: [], labels: [], regions: [{ id: "r", name: "Stone", polygon: circle(96, 96, 30), rock: 1 }] };
    const der = computeDerived(d, buildClimateNoise(W, W, 1), 1);
    expect(der.rock).toBeDefined();
    const packed = packDerived(der);
    expect(packed.length).toBe(W * W * 7);
    const back = unpackDerived(packed, W, W, 1, []);
    expect(Array.from(back.rock!.subarray(96 * W + 90, 96 * W + 100))).toEqual(Array.from(der.rock!.subarray(96 * W + 90, 96 * W + 100)));
    // without a stone region nothing extra is sent, and an old six-layer frame still reads
    const plain = world();
    const d0 = computeDerived(plain, buildClimateNoise(W, W, 1), 1);
    expect(d0.rock).toBeUndefined();
    expect(packDerived(d0).length).toBe(W * W * 6);
    expect(unpackDerived(packDerived(d0), W, W, 1, []).rock).toBeUndefined();
  });

  it("paints the land inside such a region dark grey stone, and leaves the land outside as it was", () => {
    const stone = world(), plain = world();
    stone.features = { places: [], labels: [], regions: [{ id: "r", name: "Stone", polygon: circle(96, 96, 40), rock: 1, border: "hard" }] };
    const noise = buildNoiseCache(W, W, 7);
    const paint = (doc: typeof stone) => {
      const der = computeDerived(doc, buildClimateNoise(W, W, 1), 1), out = new Uint8ClampedArray(W * W * 4);
      renderPainted(doc, der, noise, null, out, undefined, { rivers: false }); // (these tests are about the ground, not the rivers across it)
      return out;
    };
    const a = paint(stone), b = paint(plain);
    const px = (img: Uint8ClampedArray, x: number, y: number) => { const o = (y * W + x) * 4; return [img[o], img[o + 1], img[o + 2]]; };
    const inside = px(a, 96, 96), insideBefore = px(b, 96, 96), outside = px(a, 20, 96), outsideBefore = px(b, 20, 96);
    expect(Math.max(...inside)).toBeLessThan(135); // dark
    expect(Math.abs(inside[0] - inside[2])).toBeLessThan(30); // grey, not green
    expect(inside[1]).toBeLessThan(insideBefore[1] - 10); // the green is gone
    expect(outside).toEqual(outsideBefore);
    // averaged over the region the green is gone: stone is grey (green minus the mean of red and blue is near zero)
    let ga = 0, gb = 0, n = 0;
    for (let y = 80; y < 112; y++) for (let x = 80; x < 112; x++) { const p = px(a, x, y), q = px(b, x, y); ga += p[1] - (p[0] + p[2]) / 2; gb += q[1] - (q[0] + q[2]) / 2; n++; }
    expect(ga / n).toBeLessThan(4);
    expect(gb / n).toBeGreaterThan(ga / n + 4);
  });
});
