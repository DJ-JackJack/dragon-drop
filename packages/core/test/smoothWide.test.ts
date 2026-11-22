// The smooth brush with a reach (terrain.ts): softens a straight step tens of pixels wide, which the plain smooth brush and erosion can't,
// keeps the coast where it is, and changes nothing outside its shape.
import { describe, expect, it } from "vitest";
import { createDoc, sculpt, wideBlur } from "../src/index.ts";

const W = 160, H = 80;
/** Land at 200 m left of x = 80 and 500 m right of it: a straight step of 300 m, like the edge of old flat land. */
function stepped() {
  const d = createDoc({ id: "s", name: "S", width: W, height: H, kmPerPx: 2 });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.height.data[y * W + x] = x < 80 ? 200 : 500;
  d.meta.seaLevel = 0;
  return d;
}
/** The steepest drop between neighbours along the middle row (m per px). */
function steepest(d: ReturnType<typeof stepped>): number {
  let m = 0;
  const y = H / 2;
  for (let x = 40; x < 120; x++) m = Math.max(m, Math.abs(d.height.get(x + 1, y) - d.height.get(x, y)));
  return m;
}
const across = { type: "rect" as const, x: 30, y: 10, w: 100, h: 60 };

describe("smoothing with a reach", () => {
  it("spreads a wide step into a slope, where the plain brush leaves it a cliff", () => {
    const plain = stepped();
    sculpt(plain, { mode: "smooth", shape: across, strength: 1, falloff: 0.2 });
    const wide = stepped();
    sculpt(wide, { mode: "smooth", shape: across, strength: 1, falloff: 0.2, reachPx: 30 });
    expect(steepest(plain)).toBeGreaterThan(40);
    expect(steepest(wide)).toBeLessThan(15);
    // the slope runs between the two levels, without new hills or holes
    for (let x = 30; x < 130; x++) {
      const v = wide.height.get(x, H / 2);
      expect(v).toBeGreaterThanOrEqual(199);
      expect(v).toBeLessThanOrEqual(501);
    }
  });

  it("changes nothing outside its shape, and says so in the area it returns", () => {
    const d = stepped();
    const before = Float32Array.from(d.height.data);
    const rect = sculpt(d, { mode: "smooth", shape: { type: "circle", x: 80, y: 40, r: 20 }, strength: 1, reachPx: 40 })!;
    expect(rect.x).toBeGreaterThanOrEqual(58);
    expect(rect.x + rect.w).toBeLessThanOrEqual(102);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      if (!inside) expect(d.height.data[y * W + x]).toBe(before[y * W + x]);
    }
    expect(d.height.get(80, 40)).not.toBe(before[40 * W + 80]);
  });

  it("keeps the coast where it is unless told otherwise", () => {
    const coast = () => {
      const d = createDoc({ id: "c", name: "C", width: W, height: H, kmPerPx: 2 });
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.height.data[y * W + x] = x < 80 ? 60 : -400;
      d.meta.seaLevel = 0;
      return d;
    };
    const kept = coast();
    sculpt(kept, { mode: "smooth", shape: across, strength: 1, reachPx: 40 });
    for (let y = 20; y < 60; y++) for (let x = 40; x < 120; x++) {
      if (x < 80) expect(kept.height.get(x, y)).toBeGreaterThan(0);
      else expect(kept.height.get(x, y)).toBeLessThan(0);
    }
    const moved = coast();
    sculpt(moved, { mode: "smooth", shape: across, strength: 1, reachPx: 40, keepCoast: false });
    expect(moved.height.get(79, 40)).toBeLessThan(0); // (the land's edge went under)
  });

  it("leaves a flat field flat, at the edges too", () => {
    const flat = new Float32Array(30 * 20).fill(123);
    for (const v of wideBlur(flat, 30, 20, 7)) expect(v).toBeCloseTo(123, 3);
  });
});
