import { describe, expect, it } from "vitest";
import { lookAtPicture, pictureKindHint } from "../src/pictureKind.ts";

// made-up pictures: a texture made to repeat, an object on nothing, a painting, and the cases between
function picture(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { w, h, data };
}
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const T = Math.PI * 2;
/** Stone-ish: waves with whole periods across the picture (so it wraps round), and grain. */
const repeating = (w: number, h: number) => picture(w, h, (x, y) => {
  const v = 120 + 40 * Math.sin((T * 3 * x) / w) + 30 * Math.cos((T * 5 * y) / h) + 25 * Math.sin(T * ((2 * x) / w + (4 * y) / h)) + (rnd() - 0.5) * 30;
  return [v, v * 0.9, v * 0.8, 255];
});
/** A painting: light at the top left, dark at the bottom right, with the same grain: it does not run on round the edges. */
const painting = (w: number, h: number) => picture(w, h, (x, y) => {
  const v = 230 - (150 * (x / w + y / h)) / 2 + 20 * Math.sin((T * 3.3 * x) / w) + (rnd() - 0.5) * 30;
  return [v, v, v * 0.9, 255];
});
/** A barrel: a round brown shape, nothing round it. */
const object = (w: number, h: number) => picture(w, h, (x, y) => {
  const r = Math.hypot(x - w / 2, y - h / 2);
  return r < Math.min(w, h) * 0.35 ? [120, 70, 30, 255] : [0, 0, 0, 0];
});

describe("what a picture is, from its pixels", () => {
  it("knows a texture made to repeat for a floor", () => {
    expect(lookAtPicture(repeating(512, 512)).seam).toBeLessThan(1.3);
    expect(pictureKindHint(repeating(512, 512))).toBe("terrain");
    expect(pictureKindHint(repeating(1024, 512))).toBe("terrain"); // (twice as wide is still a texture)
    expect(pictureKindHint(repeating(128, 128))).toBe("terrain");
    expect(pictureKindHint(repeating(100, 100))).toBeNull(); // (smaller than any real floor texture: a plaque, a sign)
    // a floor painted to blend with others: see-through all over, but nowhere empty, and it repeats
    const blend = repeating(512, 512);
    for (let i = 3; i < blend.data.length; i += 4) blend.data[i] = 120 + ((i >> 2) % 7) * 10;
    expect(pictureKindHint(blend)).toBe("terrain");
  });

  it("knows an object by the nothing round it", () => {
    expect(lookAtPicture(object(300, 200)).edgeEmpty).toBe(1);
    expect(pictureKindHint(object(300, 200))).toBe("objects");
    expect(pictureKindHint(object(40, 90))).toBe("objects");
  });

  it("leaves alone what it can't tell: a painting, a whole map, a cut-out, a speck", () => {
    expect(lookAtPicture(painting(512, 512)).seam).toBeGreaterThan(2);
    expect(pictureKindHint(painting(512, 512))).toBeNull();
    expect(pictureKindHint(repeating(1500, 500))).toBeNull(); // three times as wide: a strip or a whole map, not a floor
    // see-through only in the middle: not an object on nothing, not a floor
    const hole = picture(256, 256, (x, y) => (Math.hypot(x - 128, y - 128) < 40 ? [0, 0, 0, 0] : [90, 90, 90, 255]));
    expect(pictureKindHint(hole)).toBeNull();
    expect(pictureKindHint(repeating(8, 8))).toBeNull();
  });

  it("calls one flat colour a floor (a plain ground), and costs the same for any size", () => {
    expect(pictureKindHint(picture(256, 256, () => [80, 140, 60, 255]))).toBe("terrain");
    const t = Date.now();
    pictureKindHint(repeating(2048, 2048));
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
