import { describe, expect, it } from "vitest";
import { PROP_SHADOW, type SpriteData, drawBattleProps } from "../src/index.ts";

/** A white square picture, 256 px (one square at scale 1). */
const sprite: SpriteData = { w: 256, h: 256, data: new Uint8ClampedArray(256 * 256 * 4).fill(255) };
const spec = { squaresX: 6, squaresY: 6, pxPerSquare: 40, feetPerSquare: 5, sub: 8, gridType: "square" as const };
const grey = () => ({ w: 240, h: 240, data: new Uint8ClampedArray(240 * 240 * 4).map((_, i) => (i % 4 === 3 ? 255 : 128)) });
const at = (img: { w: number; data: Uint8ClampedArray }, x: number, y: number) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));

describe("an object's shadow and tint", () => {
  it("a shadow darkens the floor just below and right of the object, and nowhere above or left of it", () => {
    const plain = grey(), shaded = grey();
    drawBattleProps(plain, spec, [{ id: "o", asset: "a", x: 3, y: 3 }], () => sprite, "above");
    drawBattleProps(shaded, spec, [{ id: "o", asset: "a", x: 3, y: 3, shadow: true }], () => sprite, "above");
    // the object covers 100..140 px; its shadow falls a few px further down and right
    const below = Math.round(140 + PROP_SHADOW.dy * 40 / 2), right = Math.round(140 + PROP_SHADOW.dx * 40 / 2);
    expect(at(shaded, 120, below)[0]).toBeLessThan(at(plain, 120, below)[0] - 10);
    expect(at(shaded, right, 120)[0]).toBeLessThan(at(plain, right, 120)[0] - 5);
    expect(at(shaded, 120, 95)).toEqual(at(plain, 120, 95));
    expect(at(shaded, 120, 120)).toEqual([255, 255, 255]); // (the object itself is unchanged)
  });

  it("a tint multiplies the picture's colours, part of the way with a strength", () => {
    const full = grey(), half = grey();
    drawBattleProps(full, spec, [{ id: "o", asset: "a", x: 3, y: 3, tint: "#ff8000" }], () => sprite, "above");
    drawBattleProps(half, spec, [{ id: "o", asset: "a", x: 3, y: 3, tint: "#ff8000", tintStrength: 0.5 }], () => sprite, "above");
    expect(at(full, 120, 120)).toEqual([255, 128, 0]);
    const [r, g, b] = at(half, 120, 120);
    expect(r).toBe(255); expect(g).toBeGreaterThan(185); expect(g).toBeLessThan(195); expect(b).toBeGreaterThan(120); expect(b).toBeLessThan(135);
  });
});
