import { describe, expect, it } from "vitest";
import {
  type Derived, type RiverPath, NO_RIVER, RIVER_REACH, buildClimateNoise, buildNoiseCache, computeDerived, computeHydrology, createDoc, derivedChange,
  generateTerrain, paintPrep, rasterRivers, renderPainted, valleyDepth, valleyProfile,
} from "../src/index.ts";

const W = 128;

/** A plateau that falls `dz` metres per pixel to the east, with one river running east along row 64. */
function scene(dz: number, kmPerPx = 0.5) {
  const d = createDoc({ id: "r", name: "R", width: W, height: W, kmPerPx });
  generateTerrain(d, { template: "ocean", seed: 1 });
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) d.height.data[y * W + x] = 600 - x * dz;
  const noise = buildNoiseCache(W, W, 7);
  const der = computeDerived(d, buildClimateNoise(W, W, 1), 1);
  const pts: number[] = [], widths: number[] = [];
  for (let x = 20; x <= 110; x += 0.5) { pts.push(x, 64.5); widths.push(1.2); }
  const river: RiverPath = { pts, widths };
  return { d, noise, der: { ...der, rivers: [river] } as Derived, river };
}

const paint = (s: ReturnType<typeof scene>, rivers = true) => {
  const out = new Uint8ClampedArray(W * W * 4);
  renderPainted(s.d, s.der, s.noise, null, out, undefined, { rivers });
  return out;
};
const lum = (o: Uint8ClampedArray, x: number, y: number) => { const i = (y * W + x) * 4; return 0.3 * o[i] + 0.55 * o[i + 1] + 0.15 * o[i + 2]; };
const px = (o: Uint8ClampedArray, x: number, y: number) => { const i = (y * W + x) * 4; return [o[i], o[i + 1], o[i + 2]]; };

describe("the river raster", () => {
  it("knows where the water is, how big and how steep the river is, and nothing far away", () => {
    const s = scene(8);
    const rr = rasterRivers(s.der.rivers, s.d.height, 0.5, { x: 40, y: 40, w: 40, h: 50 })!;
    expect(rr).not.toBeNull();
    const at = (x: number, y: number) => (y - rr.r.y) * rr.r.w + (x - rr.r.x);
    expect(rr.edge[at(60, 64)]).toBeLessThan(-0.3); // in the water
    expect(rr.edge[at(60, 68)]).toBeGreaterThan(1);
    expect(rr.edge[at(60, 68)]).toBeLessThan(RIVER_REACH);
    expect(rr.edge[at(60, 40)]).toBe(NO_RIVER); // too far from the river for any effect... (this pixel is inside the margin but out of reach)
    expect(rr.size[at(60, 64)]).toBeGreaterThan(0.4);
    expect(rr.size[at(60, 64)]).toBeLessThan(0.7);
    expect(rr.drop[at(60, 64)]).toBeCloseTo(16, 0); // 8 m per px at 0.5 km per px
    expect(rr.along[at(80, 64)]).toBeGreaterThan(rr.along[at(60, 64)] + 15);
    expect(rasterRivers(s.der.rivers, s.d.height, 0.5, { x: 0, y: 100, w: 20, h: 20 })).toBeNull(); // no river within reach
    expect(rasterRivers([], s.d.height, 0.5, { x: 0, y: 0, w: 20, h: 20 })).toBeNull();
  });

  it("gives every pixel the same answer whichever tile it is asked for in", () => {
    const s = scene(2);
    const a = rasterRivers(s.der.rivers, s.d.height, 0.5, { x: 30, y: 50, w: 30, h: 30 })!;
    const b = rasterRivers(s.der.rivers, s.d.height, 0.5, { x: 20, y: 40, w: 90, h: 50 })!;
    let checked = 0;
    for (let y = 50; y < 80; y++) for (let x = 30; x < 60; x++) {
      const i = (y - a.r.y) * a.r.w + (x - a.r.x), j = (y - b.r.y) * b.r.w + (x - b.r.x);
      expect(a.edge[i]).toBeCloseTo(b.edge[j], 5);
      expect(a.drop[i]).toBeCloseTo(b.drop[j], 5);
      checked++;
    }
    expect(checked).toBe(900);
  });

  it("cuts the valley deeper for bigger rivers and in rugged country, and only near the water", () => {
    expect(valleyDepth(0, 0.5, 0.8)).toBeGreaterThan(valleyDepth(0, 0.5, 0.1));
    expect(valleyDepth(0, 0.9, 0.5)).toBeGreaterThan(valleyDepth(0, 0.1, 0.5));
    expect(valleyDepth(40, 0.5, 0.5)).toBe(0);
    expect(valleyDepth(3, 0.5, 0.5)).toBeLessThan(valleyDepth(0, 0.5, 0.5));
    expect(valleyProfile(0, 0.5)).toBe(1);
    expect(valleyProfile(50, 0.5)).toBe(0);
  });
});

describe("rivers painted into the map", () => {
  it("changes the pixels of the water and its banks, and nothing far away", () => {
    const s = scene(2);
    const withR = paint(s), without = paint(s, false);
    let waterDiff = 0, farDiff = 0;
    for (let x = 40; x < 90; x++) waterDiff += Math.abs(lum(withR, x, 64) - lum(without, x, 64));
    for (let x = 40; x < 90; x++) farDiff += Math.abs(lum(withR, x, 10) - lum(without, x, 10)) + Math.abs(lum(withR, x, 120) - lum(without, x, 120));
    expect(waterDiff / 50).toBeGreaterThan(8);
    expect(farDiff).toBe(0);
    // the water is bluer than the ground it crosses
    const [r, , b] = px(withR, 60, 64), [r0, , b0] = px(without, 60, 64);
    expect(b - r).toBeGreaterThan(b0 - r0 + 10);
  });

  it("leaves bare stone (a region's rock setting) stone: the banks don't turn green or damp over it", () => {
    const s = scene(2);
    const stone = { ...s, der: { ...s.der, rock: new Uint8Array(W * W).fill(255) } as Derived };
    const withR = paint(stone), without = paint(stone, false), plain = paint(s), plainWithout = paint(s, false);
    // shading (the valley) scales all three colours alike; green or damp toning changes them unevenly. So measure how unevenly the river changed each pixel's colours.
    const toning = (o: Uint8ClampedArray, ref: Uint8ClampedArray, x: number, y: number) => {
      const a = px(o, x, y), b = px(ref, x, y), r = a.map((v, c) => v / Math.max(1, b[c]));
      return Math.max(...r) - Math.min(...r);
    };
    let onStone = 0, onGround = 0, n = 0;
    for (let x = 40; x < 90; x++) for (const dy of [-5, -4, -3, 3, 4, 5]) { // beside the water, on the banks
      onStone += toning(withR, without, x, 64 + dy);
      onGround += toning(plain, plainWithout, x, 64 + dy);
      n++;
    }
    expect(onGround / n, "ordinary ground is toned by the banks").toBeGreaterThan(0.05);
    expect(onStone / n, "stone is not").toBeLessThan((onGround / n) * 0.4);
    // and the stone itself is dark charcoal either way
    expect(lum(without, 60, 20)).toBeLessThan(75);
  });

  it("is switched off by the rivers option, and by there being no rivers", () => {
    const s = scene(2);
    const off = paint(s, false);
    const none = new Uint8ClampedArray(W * W * 4);
    renderPainted(s.d, { ...s.der, rivers: [] }, s.noise, null, none);
    expect(Array.from(off)).toEqual(Array.from(none));
  });

  it("shows how steeply the river drops: calm water on the flat, flecks of white water where it falls (never blotches: a map session's notes)", () => {
    const flat = paint(scene(0.05)), steep = paint(scene(8));
    let fw = 0, sw = 0, n = 0;
    for (let x = 40; x < 90; x++) { if (lum(flat, x, 64) > 200) fw++; if (lum(steep, x, 64) > 200) sw++; n++; }
    expect(fw).toBe(0);
    expect(sw).toBeGreaterThan(2);
    expect(sw).toBeLessThan(n * 0.6); // (flecks, not the whole river white)
  });

  it("paints rivers lighter than the dark ground they run through, with a shoreline set apart from it, and no white water where a river meets the sea", () => {
    const s = scene(0.05), img = paint(s), bare = paint(s, false);
    // the water is lighter than the ground beside it (so it can be followed in greyscale too) and blue
    let water = 0, ground = 0, n = 0;
    for (let x = 40; x < 90; x++) { water += lum(img, x, 64); ground += lum(bare, x, 64); n++; }
    expect(water / n).toBeGreaterThan(ground / n);
    const o = (64 * W + 60) * 4;
    expect(img[o + 2]).toBeGreaterThan(img[o]);
    // a river that drops into the sea: its heights below the sea count as the sea's, so no fall (and no foam) at the mouth
    const d = createDoc({ id: "m", name: "M", width: 64, height: 64, kmPerPx: 0.5 });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.height.data[y * 64 + x] = x < 40 ? (40 - x) * 0.3 : -800;
    const pts: number[] = [], widths: number[] = [];
    for (let x = 4; x <= 44; x += 0.5) { pts.push(x, 32); widths.push(1.2); }
    const rr = rasterRivers([{ pts, widths }], d.height, 0.5, { x: 30, y: 28, w: 12, h: 8 }, d.meta.seaLevel)!;
    expect(Math.max(...rr.drop)).toBeLessThan(2);
    const steepToSea = rasterRivers([{ pts, widths }], d.height, 0.5, { x: 30, y: 28, w: 12, h: 8 })!;
    expect(Math.max(...steepToSea.drop)).toBeGreaterThan(20); // (without the sea level it looked like a waterfall)
  });

  it("is the same picture whole or in slices from a whole-map prep, tile by tile", () => {
    const s = scene(3);
    const full = paint(s);
    const prep = paintPrep(s.d, s.noise, { x: 0, y: 0, w: W, h: W });
    const sliced = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y += 24) renderPainted(s.d, s.der, s.noise, { x: 0, y, w: W, h: Math.min(24, W - y) }, sliced, prep);
    let diff = 0;
    for (let i = 0; i < full.length; i++) diff = Math.max(diff, Math.abs(full[i] - sliced[i]));
    expect(diff).toBe(0);
  });
});

describe("repainting when only the rivers changed", () => {
  const base = scene(2).der;
  const mk = (rivers: RiverPath[]): Derived => ({ ...base, rivers });
  const line = (x0: number, x1: number, y: number, w = 1): RiverPath => { const pts: number[] = [], widths: number[] = []; for (let x = x0; x <= x1; x += 0.5) { pts.push(x, y); widths.push(w); } return { pts, widths }; };

  it("says nothing changed for the same rivers, even as new objects", () => {
    expect(derivedChange(mk([line(20, 100, 40)]), mk([line(20, 100, 40)]))).toBe("none");
  });
  it("boxes a river that appeared, moved, grew or went", () => {
    const a = mk([line(20, 100, 40)]);
    const added = derivedChange(a, mk([line(20, 100, 40), line(30, 60, 90)]));
    expect(added).not.toBe("none");
    expect(added).not.toBe("all");
    const r = added as { x: number; y: number; w: number; h: number };
    expect(r.y).toBeLessThanOrEqual(90);
    expect(r.y + r.h).toBeGreaterThan(90);
    expect(r.x).toBeLessThanOrEqual(30);
    expect(r.y + r.h).toBeLessThan(120); // the river at y = 40 is untouched, so the box doesn't reach up to it
    expect(r.y).toBeGreaterThan(60);
    expect(derivedChange(a, mk([line(20, 100, 40, 1.6)]))).not.toBe("none"); // bigger
    expect(derivedChange(a, mk([line(20, 100, 44)]))).not.toBe("none"); // moved
    expect(derivedChange(a, mk([]))).not.toBe("none"); // gone
  });
});

describe("how a river runs", () => {
  const S = 256;
  /** Land that slopes south at `slope` metres per pixel into the sea at the bottom. */
  function slope(slopeM: number, shape?: (x: number) => number): Float32Array {
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = y >= 220 ? -20 : 100 + (220 - y) * slopeM + (shape ? shape(x) : 0);
    return h;
  }
  const wander = (r: RiverPath) => {
    const n = r.pts.length / 2, ax = r.pts[0], ay = r.pts[1], bx = r.pts[2 * n - 2], by = r.pts[2 * n - 1], len = Math.hypot(bx - ax, by - ay) || 1;
    let s = 0;
    for (let k = 0; k < n; k++) s += Math.abs(((r.pts[2 * k] - ax) * (by - ay) - (r.pts[2 * k + 1] - ay) * (bx - ax)) / len);
    return s / n;
  };
  const source = (h: Float32Array) => {
    const hy = computeHydrology(h, S, S, 0, { riverDensity: 0.5, inflows: [{ x: 128, y: 40, share: 0.03 }] });
    return hy.rivers.filter((r) => Math.hypot(r.pts[0] - 128, r.pts[1] - 40) < 4).sort((a, b) => b.pts.length - a.pts.length)[0];
  };

  it("runs straighter down a steep slope than across flat ground", () => {
    const steep = source(slope(12)), flat = source(slope(0.6));
    expect(steep).toBeTruthy();
    expect(flat).toBeTruthy();
    expect(wander(flat)).toBeGreaterThan(wander(steep) * 1.6);
  });

  it("meets the river it flows into exactly", () => {
    // a broad valley down the middle, fed from both sides and from its head
    const h = slope(3, (x) => Math.abs(x - 128) * 5);
    const hy = computeHydrology(h, S, S, 0, { riverDensity: 0.5, inflows: [{ x: 50, y: 60, share: 0.02 }, { x: 210, y: 70, share: 0.02 }, { x: 128, y: 30, share: 0.03 }] });
    let joins = 0;
    for (const r of hy.rivers) {
      const ex = r.pts[r.pts.length - 2], ey = r.pts[r.pts.length - 1];
      if (h[Math.floor(ey) * S + Math.floor(ex)] <= 5) continue; // ends in the sea
      let best = Infinity;
      for (const o of hy.rivers) {
        if (o === r) continue;
        for (let k = 0; k < o.pts.length; k += 2) best = Math.min(best, Math.hypot(o.pts[k] - ex, o.pts[k + 1] - ey));
      }
      if (best < 3) { joins++; expect(best).toBeLessThan(0.7); }
    }
    expect(joins).toBeGreaterThan(0);
  });
});
