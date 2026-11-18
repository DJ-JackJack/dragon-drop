import { describe, expect, it } from "vitest";
import {
  type ClimateRegion, type Derived, addLandmass, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, derivedChange, generateTerrain, packDerived,
  regionVolcanic, renderPainted, unpackDerived,
} from "../src/index.ts";

const W = 200;
const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 36 }, (_, i) => [cx + r * Math.cos((i / 36) * 2 * Math.PI), cy + r * Math.sin((i / 36) * 2 * Math.PI)]);
const region = (extra: Partial<ClimateRegion>): ClimateRegion => ({ id: "v", name: "V", polygon: circle(100, 100, 50), border: "hard", ...extra });

describe("the volcanic ground layer", () => {
  it("is there only when a region has it, full inside a hard border and zero outside", () => {
    expect(regionVolcanic([region({ rock: 1 })], W, W, 4)).toBeUndefined();
    expect(regionVolcanic(undefined, W, W, 4)).toBeUndefined();
    const v = regionVolcanic([region({ volcanic: 1 })], W, W, 4)!;
    expect(v[100 * W + 100]).toBe(255);
    expect(v[10 * W + 10]).toBe(0);
    const half = regionVolcanic([region({ volcanic: 0.5 })], W, W, 4)!;
    expect(half[100 * W + 100]).toBe(128);
    const soft = regionVolcanic([region({ volcanic: 1, border: "soft", blendKm: 80 })], W, W, 4)!;
    expect(soft[100 * W + 100]).toBe(255);
    expect(soft[100 * W + 152]).toBeGreaterThan(0); // the soft border reaches a little outside
    expect(soft[100 * W + 152]).toBeLessThan(255);
  });
  it("rides the wire with or without the stone layer, and old frames without it still read", () => {
    const n = 12, base = { temp: new Uint8Array(n).fill(1), moist: new Uint8Array(n).fill(2), seaDist: new Uint8Array(n).fill(3), landDist: new Uint8Array(n).fill(4), lakes: new Uint8Array(n).fill(5), snow: new Uint8Array(n).fill(6) };
    const plain = unpackDerived(packDerived(base), 4, 3, 1, []);
    expect(plain.rock).toBeUndefined();
    expect(plain.volcanic).toBeUndefined();
    const stoneOnly = unpackDerived(packDerived({ ...base, rock: new Uint8Array(n).fill(7) }), 4, 3, 1, []);
    expect(Array.from(stoneOnly.rock!)).toEqual(new Array(n).fill(7));
    expect(stoneOnly.volcanic).toBeUndefined();
    const volcOnly = unpackDerived(packDerived({ ...base, volcanic: new Uint8Array(n).fill(9) }), 4, 3, 1, []);
    expect(Array.from(volcOnly.volcanic!)).toEqual(new Array(n).fill(9));
    expect(Array.from(volcOnly.rock!)).toEqual(new Array(n).fill(0)); // (a zero stone plane keeps the positions fixed)
    const both = unpackDerived(packDerived({ ...base, rock: new Uint8Array(n).fill(7), volcanic: new Uint8Array(n).fill(9) }), 4, 3, 1, []);
    expect(both.rock![0]).toBe(7);
    expect(both.volcanic![0]).toBe(9);
    expect(both.temp[0]).toBe(1);
    expect(both.snow[0]).toBe(6);
  });
  it("counts a change to it as a change to repaint", () => {
    const n = 64 * 48, mk = (): Derived => ({ W: 64, H: 48, seq: 1, rivers: [], temp: new Uint8Array(n), moist: new Uint8Array(n), seaDist: new Uint8Array(n), landDist: new Uint8Array(n), lakes: new Uint8Array(n), snow: new Uint8Array(n) });
    const a = mk(), b = mk();
    expect(derivedChange(a, b)).toBe("none");
    b.volcanic = new Uint8Array(n); b.volcanic[10 * 64 + 20] = 200;
    expect(derivedChange(a, b)).toEqual({ x: 20, y: 10, w: 1, h: 1 });
    expect(derivedChange(b, mk())).toEqual({ x: 20, y: 10, w: 1, h: 1 });
  });
});

describe("what volcanic ground looks like", () => {
  const noise = buildNoiseCache(W, W, 7);
  const paint = (volcanic: number | undefined) => {
    const d = createDoc({ id: "v", name: "V", width: W, height: W, kmPerPx: 4 });
    generateTerrain(d, { template: "ocean", seed: 1 });
    addLandmass(d, { shape: { type: "circle", x: 100, y: 100, r: 90 }, heightM: 300, seed: 2 });
    d.meta.climate = { latTop: 0.5, latBot: 0.5, moistureNoise: 0.2, wind: "northwest" };
    d.features = { places: [], labels: [], regions: volcanic === undefined ? [] : [region({ volcanic })] };
    const der = computeDerived(d, buildClimateNoise(W, W, 1), 1), out = new Uint8ClampedArray(W * W * 4);
    renderPainted(d, der, noise, null, out, undefined, { rivers: false });
    return out;
  };
  const px = (o: Uint8ClampedArray, x: number, y: number) => { const i = (y * W + x) * 4; return [o[i], o[i + 1], o[i + 2]]; };
  it("is black ash and basalt inside the region, with glowing lava cracks, and leaves the land outside as it was", () => {
    const withV = paint(1), without = paint(undefined);
    let lum = 0, base = 0, n = 0, glow = 0, outsideDiff = 0;
    for (let y = 70; y < 130; y += 2) for (let x = 70; x < 130; x += 2) {
      const a = px(withV, x, y), b = px(without, x, y);
      lum += 0.3 * a[0] + 0.59 * a[1] + 0.11 * a[2]; base += 0.3 * b[0] + 0.59 * b[1] + 0.11 * b[2]; n++;
    }
    for (let y = 60; y < 140; y++) for (let x = 60; x < 140; x++) { const a = px(withV, x, y); if (a[0] > 150 && a[1] < 130 && a[2] < 70 && a[0] > a[1] * 1.6) glow++; } // orange glow
    for (let y = 20; y < 40; y++) for (let x = 20; x < 180; x++) { const a = px(withV, x, y), b = px(without, x, y); outsideDiff += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }
    expect(lum / n).toBeLessThan(80); // dark
    expect(lum / n).toBeLessThan((base / n) * 0.92); // and darker than the forest it replaced
    expect(glow).toBeGreaterThan(3); // a few glowing cracks
    expect(outsideDiff).toBe(0);
  });
});
