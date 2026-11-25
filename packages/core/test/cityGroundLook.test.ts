import { describe, expect, it } from "vitest";
import { DEFAULT_GROUND_LOOK, cleanGroundLook, createCityDoc, gradientShade, groundCellColours, groundLooks, groundShades, groundTexel, groundTextures, softLight, type MapDoc } from "@mapmaker/core";

/** A 400 x 200 m town on 2 m cells: grass, with a pond of deep water in the middle of the right half. */
function town(id = "town"): MapDoc {
  const doc = createCityDoc({ id, name: "Town", widthM: 400, heightM: 200, cellM: 2 });
  const { w, h, data } = doc.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 150, y - 50) < 40) data[y * w + x] = 8;
  return doc;
}
const lum = (rgb: Uint8ClampedArray, i: number) => 0.3 * rgb[i * 3] + 0.59 * rgb[i * 3 + 1] + 0.11 * rgb[i * 3 + 2];

describe("a settlement's ground look", () => {
  it("gives every kind a gentle gradient of its own until the map sets one", () => {
    const looks = groundLooks(town().meta.city!);
    expect(looks[5]).toMatchObject({ pattern: "patches", strength: DEFAULT_GROUND_LOOK.grass.strength });
    expect(looks[8]).toMatchObject({ pattern: "edges" });
    const s = groundShades([120, 160, 80]);
    expect(s.light.reduce((a, b) => a + b)).toBeGreaterThan(360);
    expect(s.dark.reduce((a, b) => a + b)).toBeLessThan(360);
  });

  it("varies grass in patches between its dark and light shades, the same each time for one map and differently for another", () => {
    const doc = town(), g = groundCellColours(doc), { w, h } = doc.height;
    const L = groundLooks(doc.meta.city!)[5], lo = 0.3 * L.dark[0] + 0.59 * L.dark[1] + 0.11 * L.dark[2], hi = 0.3 * L.light[0] + 0.59 * L.light[1] + 0.11 * L.light[2];
    let min = Infinity, max = -Infinity;
    for (let y = 0; y < h; y++) for (let x = 0; x < 60; x++) { const v = lum(g.rgb, y * w + x); min = Math.min(min, v); max = Math.max(max, v); }
    expect(max - min).toBeGreaterThan(12);
    expect(min).toBeGreaterThanOrEqual(lo - 1);
    expect(max).toBeLessThanOrEqual(hi + 1);
    expect(groundCellColours(doc).rgb).toEqual(g.rgb);
    expect(groundCellColours(town("another")).rgb).not.toEqual(g.rgb);
  });

  it("makes water pale at its shore and deep in its middle, and a part of the ground the same as that part of the whole", () => {
    const doc = town(), { w, h } = doc.height, g = groundCellColours(doc);
    expect(lum(g.rgb, 50 * w + 112)).toBeGreaterThan(lum(g.rgb, 50 * w + 150) + 10); // (two cells in from the shore, against the middle)
    const part = groundCellColours(doc, { x: 120, y: 30, w: 50, h: 40 });
    for (let y = 0; y < 40; y += 7) for (let x = 0; x < 50; x += 7) for (let k = 0; k < 3; k++) expect(part.rgb[(y * 50 + x) * 3 + k]).toBe(g.rgb[((y + 30) * w + x + 120) * 3 + k]);
    void h;
  });

  it("follows what the map sets: a flat kind is one colour, its own shades are its ends", () => {
    const doc = town(), { w, h } = doc.height;
    doc.meta.city = { ...doc.meta.city!, ground: { grass: "#80a060" }, groundLook: { grass: { pattern: "flat" } } };
    const g = groundCellColours(doc), seen = new Set<string>();
    for (let y = 0; y < h; y++) for (let x = 0; x < 60; x++) seen.add([0, 1, 2].map((k) => g.rgb[(y * w + x) * 3 + k]).join(","));
    expect([...seen]).toEqual(["128,160,96"]);
    doc.meta.city.groundLook = { grass: { light: "#ffffff", dark: "#000000", strength: 1 } };
    const s = groundCellColours(doc);
    let min = 255, max = 0;
    for (let i = 0; i < 60 * h; i++) { min = Math.min(min, s.rgb[i * 3]); max = Math.max(max, s.rgb[i * 3]); }
    expect(max - min).toBeGreaterThan(150);
  });

  it("checks what it is given", () => {
    expect(cleanGroundLook({ Grass: { pattern: "edges", strength: 3, size: 1, tile: 100, light: "AABBCC" } })).toEqual({ grass: { pattern: "edges", strength: 1, size: 2, tile: 60, light: "#aabbcc" } });
    expect(cleanGroundLook({ grass: { pattern: "stripes" } })).toMatchObject({ error: /pattern of grass/ });
    expect(cleanGroundLook({ moss: {} })).toMatchObject({ error: /no ground "moss"/ });
    expect(cleanGroundLook({ grass: { texture: "not an asset id" } })).toMatchObject({ error: /texture of grass/ });
    expect(cleanGroundLook({ grass: { texture: "pack:Floors/Grass.jpg", tile: 4 } })).toEqual({ grass: { texture: "pack:Floors/Grass.jpg", tile: 4 } });
    expect(groundTextures({ widthM: 10, heightM: 10, cellM: 1, groundLook: { grass: { texture: "a:b.png" }, sand: { texture: "a:b.png" }, dirt: {} } })).toEqual(["a:b.png"]);
  });

  it("lays a kind's gradient over its texture by soft light: a cell of the kind's own colour leaves the texture as it is", () => {
    expect(gradientShade([90, 120, 60], [90, 120, 60])).toEqual([128, 128, 128]);
    const tex = [100, 150, 80];
    softLight(tex, [128, 128, 128]).forEach((v, k) => expect(Math.abs(v - tex[k])).toBeLessThanOrEqual(1));
    const lighter = softLight(tex, gradientShade([120, 150, 80], [90, 120, 60])), darker = softLight(tex, gradientShade([60, 80, 40], [90, 120, 60]));
    expect(lighter.every((v, k) => v > tex[k])).toBe(true);
    expect(darker.every((v, k) => v < tex[k])).toBe(true);
  });

  it("draws a texture's own pixels close up and its average colour from far off", () => {
    const size = 4, data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) { const on = (i % size + Math.floor(i / size)) % 2 === 0; data.set(on ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4); }
    const t = { data, size };
    expect(groundTexel(t, 2, 0.1, 0.1, 30)).toEqual([255, 255, 255]); // (a 2 m tile at 30 px a metre: 60 px across)
    expect(groundTexel(t, 2, 0.6, 0.1, 30)).toEqual([0, 0, 0]);
    expect(groundTexel(t, 2, 0.1, 0.1, 14).map(Math.round)).toEqual([191, 191, 191]); // (28 px across: half way to its average)
    expect(groundTexel(t, 2, 0.1, 0.1, 0.5).map(Math.round)).toEqual([128, 128, 128]); // (1 px across: its average)
  });
});
