import { describe, expect, it } from "vitest";
import { type MapRoof, paintRoofsInto, rectPolygon, roofTurn } from "../src/index.ts";

const deg = (d: number) => (d * Math.PI) / 180;

describe("how far a roof is turned", () => {
  it("is nothing for a roof along the axes, whichever way its long side runs", () => {
    expect(roofTurn(rectPolygon(50, 50, 20, 10, 0))).toBe(0);
    expect(roofTurn(rectPolygon(50, 50, 10, 20, 0))).toBe(0);
    expect(roofTurn(rectPolygon(50, 50, 20, 10, 90))).toBe(0);
    expect(roofTurn(rectPolygon(50, 50, 20, 10, 0.2))).toBe(0); // (within half a degree)
    expect(roofTurn([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(0);
  });

  it("follows the longest side, folded to within 45 degrees", () => {
    for (const [w, h, a, want] of [[20, 10, 30, 30], [10, 20, 30, 30], [20, 10, 60, -30], [20, 10, -20, -20], [20, 10, 120, 30], [20, 10, 45, 45], [20, 10, -45, 45]] as const) {
      expect(roofTurn(rectPolygon(50, 50, w, h, a)), `${w}x${h} turned ${a}`).toBeCloseTo(deg(want), 2);
    }
    expect(roofTurn([[0, 0], [0, 0]])).toBe(0);
  });
});

describe("a turned roof is drawn along its own ridge", () => {
  const px = 10;
  const paint = (roof: MapRoof, tile?: { data: Uint8ClampedArray; size: number }) => {
    const img = { w: 600, h: 600, data: new Uint8ClampedArray(600 * 600 * 4) };
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 128; img.data[i + 3] = 255; }
    paintRoofsInto(img, 0, 0, 600, 600, px, [roof], { shadow: false, ...(tile && { tileFor: () => tile }) });
    return img;
  };
  const at = (img: { w: number; data: Uint8ClampedArray }, x: number, y: number, k = 0) => img.data[(Math.round(y) * img.w + Math.round(x)) * 4 + k];
  const grey = (img: { w: number; data: Uint8ClampedArray }, x: number, y: number) => (at(img, x, y, 0) + at(img, x, y, 1) + at(img, x, y, 2)) / 3;

  it("is lit on the slope that faces the top left and dark on the other, whatever way the roof is turned", () => {
    for (const a of [0, 30, 60, -25]) {
      const roof: MapRoof = { id: "r", style: "slate", colour: "#808080", points: rectPolygon(30, 30, 24, 10, a) };
      const img = paint(roof);
      // the ridge runs along the roof's long side (24 m, turned `a` degrees); across it, toward the bottom right, is the dark slope
      const ux = Math.cos(deg(a)), uy = Math.sin(deg(a));
      let vx = -uy, vy = ux;
      if (vx + vy < 0) { vx = -vx; vy = -vy; }
      // (averaged along the ridge: the roof has a fine grain of its own)
      const mean = (side: number) => { let sum = 0, n = 0; for (let along = -90; along <= 90; along += 6) { sum += grey(img, 300 + side * vx * 25 + along * ux, 300 + side * vy * 25 + along * uy); n++; } return sum / n; };
      const lit = mean(-1), dark = mean(1);
      expect(lit, `turned ${a}: lit ${lit} dark ${dark}`).toBeGreaterThan(dark + 8);
    }
  });

  it("puts a picture's rows along the ridge: constant along it, changing across it", () => {
    // a picture of two horizontal bands (red above, blue below), one repeat every 4 metres
    const size = 8, data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(y < size / 2 ? [220, 30, 30, 255] : [30, 30, 220, 255], (y * size + x) * 4);
    const roof: MapRoof = { id: "r", style: "slate", asset: "p:roof.png", tile: 4, flat: true, points: rectPolygon(30, 30, 24, 10, 30) };
    const img = paint(roof, { data, size });
    const t = roofTurn(roof.points), ux = Math.cos(t), uy = Math.sin(t), vx = -Math.sin(t), vy = Math.cos(t), period = 4 * px;
    // an offset across the ridge that lands a quarter of the way into a repeat (in the red band), and one that lands three quarters in (the blue band)
    const frac = ((300 * vx + 300 * vy) / period) % 1;
    const dRed = (0.25 - frac) * period, dBlue = (0.75 - frac) * period;
    for (const along of [-100, -60, 0, 60, 100]) {
      const red = (x: number, y: number) => at(img, x, y, 0) > at(img, x, y, 2) + 40;
      expect(red(300 + dRed * vx + along * ux, 300 + dRed * vy + along * uy), `red band at ${along}`).toBe(true);
      expect(at(img, 300 + dBlue * vx + along * ux, 300 + dBlue * vy + along * uy, 2), `blue band at ${along}`).toBeGreaterThan(at(img, 300 + dBlue * vx + along * ux, 300 + dBlue * vy + along * uy, 0) + 40);
    }
  });

  it("leaves a roof along the axes exactly as it was: the picture's rows run left to right", () => {
    const size = 8, data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(y < size / 2 ? [220, 30, 30, 255] : [30, 30, 220, 255], (y * size + x) * 4);
    const img = paint({ id: "r", style: "slate", asset: "p:roof.png", tile: 4, flat: true, points: rectPolygon(30, 30, 24, 10, 0) }, { data, size });
    // along a row (same y) it is the same band all the way; down a column the bands alternate every 20 px
    const red = (x: number, y: number) => at(img, x, y, 0) > at(img, x, y, 2) + 40, blue = (x: number, y: number) => at(img, x, y, 2) > at(img, x, y, 0) + 40;
    for (const x of [200, 250, 300, 350, 400]) { expect(red(x, 285), `row at x ${x}`).toBe(true); expect(blue(x, 305), `next row at x ${x}`).toBe(true); }
  });
});
