import { describe, expect, it } from "vitest";
import { addLandmass, addMountainRange, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, desertWeight, generateTerrain, jungleWeight, renderPainted } from "../src/index.ts";

const W = 256;
const world = (wind: "northwest" | "none" = "northwest") => {
  const d = createDoc({ id: "b", name: "B", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: 128, y: 128, r: 110 }, heightM: 200, seed: 2 });
  d.meta.climate = { latTop: 0.5, latBot: 0.5, moistureNoise: 0.2, wind };
  return d;
};
const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const noise = buildNoiseCache(W, W, 7);
function paint(doc: ReturnType<typeof world>, temperature: number, moisture: number | undefined) {
  if (moisture !== undefined) {
    doc.features = { places: [], labels: [], regions: [{ id: "r", name: "R", polygon: box(60, 60, 196, 196), temperature, moisture, border: "hard" }] };
  }
  const der = computeDerived(doc, buildClimateNoise(W, W, 1), 1), out = new Uint8ClampedArray(W * W * 4);
  renderPainted(doc, der, noise, null, out, undefined, { rivers: false }); // (these tests are about the ground, not the rivers across it)
  return out;
}
const px = (img: Uint8ClampedArray, x: number, y: number) => { const o = (y * W + x) * 4; return [img[o], img[o + 1], img[o + 2]]; };
const lum = (p: number[]) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

describe("jungle and desert look", () => {
  it("paints a hot, very wet region as dark, deep green jungle, well apart from ordinary grass", () => {
    const jungle = paint(world(), 0.95, 0.95), grass = paint(world(), 0.4, 0.35); // (steppe: the smooth, open grass)
    const at = (img: Uint8ClampedArray) => { const v: number[][] = []; for (let y = 90; y < 170; y += 2) for (let x = 90; x < 170; x += 2) v.push(px(img, x, y)); return v; };
    const j = at(jungle), g = at(grass);
    const jm = mean(j.map(lum)), gm = mean(g.map(lum));
    expect(jm).toBeLessThan(gm * 0.78); // clearly darker
    const jc = [0, 1, 2].map((c) => mean(j.map((p) => p[c])));
    expect(jc[1]).toBeGreaterThan(jc[0] * 1.6); // green dominates red: no yellow-olive left in it
    expect(jc[1]).toBeGreaterThan(jc[2] * 1.8);
    // dense canopy: more fine texture than the smoother grass
    expect(sd(j.map(lum))).toBeGreaterThan(sd(g.map(lum)) * 1.1);
  });

  it("varies the canopy in darker and lighter stands, not one uniform green", () => {
    const jungle = paint(world(), 0.95, 0.95), grass = paint(world(), 0.6, 0.5);
    // average the brightness over 10-px blocks so the fine crowns drop out and only the patches are left
    const blocks = (img: Uint8ClampedArray) => {
      const out: number[] = [];
      for (let by = 70; by < 190; by += 10) for (let bx = 70; bx < 190; bx += 10) {
        let s = 0;
        for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) s += lum(px(img, bx + x, by + y));
        out.push(s / 100);
      }
      return out;
    };
    const jb = blocks(jungle), gb = blocks(grass);
    const spread = Math.max(...jb) / Math.min(...jb);
    expect(spread).toBeGreaterThan(1.2); // the lightest stand is well above the darkest
    expect(sd(jb) / mean(jb)).toBeGreaterThan(0.04);
    // and the lighter stands are still green (trees, not bare ground): green stays the strongest channel in every block
    for (let y = 70; y < 190; y += 10) for (let x = 70; x < 190; x += 10) {
      const p = px(jungle, x + 5, y + 5);
      expect(p[1]).toBeGreaterThan(p[0]);
      expect(p[1]).toBeGreaterThan(p[2]);
    }
    expect(mean(jb)).toBeLessThan(mean(gb)); // still darker than ordinary grass overall
  });

  it("lets high ridges keep their rock and snow inside the jungle, while gentle low ground is forested", () => {
    const doc = world();
    addMountainRange(doc, { path: [[100, 80], [90, 128], [100, 176]], widthPx: 8, peakM: 3200, seed: 3 });
    const jungle = paint(doc, 0.95, 0.95);
    let high = 0, rocky = 0, low = 0, green = 0;
    for (let y = 62; y < 194; y++) for (let x = 62; x < 194; x++) {
      const h = doc.height.data[y * W + x], p = px(jungle, x, y);
      if (h > 1900) { high++; if (p[1] <= p[0] * 1.04) rocky++; } // rock is warm grey-brown (red at least as strong as green), snow is white; forest has green well above red
      else if (h > 20 && h < 260) { low++; if (p[1] > p[0] * 1.4) green++; }
    }
    expect(high).toBeGreaterThan(30);
    expect(rocky / high).toBeGreaterThan(0.75); // the crest reads as rock or snow, not as forest
    expect(green / low).toBeGreaterThan(0.8); // and the lowland is still green
  });

  it("paints a hot, dry region as sand with dune ridges that run across the wind", () => {
    const desert = paint(world(), 0.95, 0.04), grass = paint(world(), 0.5, 0.9); // (warm and half-dry would be scrub now: grass needs a wet climate)
    const sand: number[][] = [];
    for (let y = 90; y < 170; y += 2) for (let x = 90; x < 170; x += 2) sand.push(px(desert, x, y));
    const c = [0, 1, 2].map((i) => mean(sand.map((p) => p[i])));
    expect(c[0]).toBeGreaterThan(c[2] * 1.5); // warm: red well above blue
    expect(c[0]).toBeGreaterThan(c[1]); // and not green
    // brightness swings along the wind (northwest wind blows toward +x +y) but stays steadier along the crests (+x -y)
    const line = (dx: number, dy: number, x0: number, y0: number) => Array.from({ length: 60 }, (_, i) => lum(px(desert, x0 + i * dx, y0 + i * dy)));
    const across: number[] = [], along: number[] = [];
    for (let s = 0; s < 8; s++) {
      across.push(sd(line(1, 1, 80 + s * 6, 60 + s * 3)));
      along.push(sd(line(1, -1, 80 + s * 6, 150 + s * 3)));
    }
    expect(mean(across)).toBeGreaterThan(mean(along) * 1.15);
    // it is not just tinted grass: the same land as grass is green where this is sand
    const gp = px(grass, 128, 128);
    expect(gp[1]).toBeGreaterThan(gp[0]);
  });

  it("leaves natural climates alone, and reaches jungle only where the map really is tropical", () => {
    const share = (doc: ReturnType<typeof world>, f: (t: number, m: number) => number) => {
      const der = computeDerived(doc, buildClimateNoise(W, W, 1), 1);
      let n = 0, hit = 0;
      for (let i = 0; i < W * W; i++) {
        if (doc.height.data[i] <= doc.meta.seaLevel) continue;
        n++;
        if (f(der.temp[i] / 255, der.moist[i] / 255) > 0.05) hit++;
      }
      return hit / n;
    };
    const temperate = world();
    expect(share(temperate, jungleWeight)).toBe(0);
    expect(share(temperate, desertWeight)).toBe(0);
    // the default world gradient (cool north to warm south) has neither, even in the warm south
    const dflt = world();
    dflt.meta.climate = { wind: "northwest" };
    expect(share(dflt, jungleWeight)).toBe(0);
    expect(share(dflt, desertWeight)).toBeLessThan(0.02);
    // on the equator, wet land is jungle by itself
    const tropics = world();
    tropics.meta.climate = { latTop: 0.04, latBot: 0.04, moistureBias: 0.9, moistureNoise: 0.1 };
    expect(share(tropics, jungleWeight)).toBeGreaterThan(0.3);
  });

  it("still renders a tile exactly like the same area of a full render", () => {
    const d = world();
    d.features = { places: [], labels: [], regions: [{ id: "r", name: "R", polygon: box(60, 60, 196, 196), temperature: 0.95, moisture: 0.04, border: "hard" }] };
    const der = computeDerived(d, buildClimateNoise(W, W, 1), 1);
    const full = new Uint8ClampedArray(W * W * 4), part = new Uint8ClampedArray(W * W * 4);
    renderPainted(d, der, noise, null, full);
    const r = { x: 100, y: 100, w: 40, h: 30 };
    renderPainted(d, der, noise, r, part);
    let diff = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) for (let c = 0; c < 3; c++) diff = Math.max(diff, Math.abs(full[(y * W + x) * 4 + c] - part[(y * W + x) * 4 + c]));
    expect(diff).toBeLessThanOrEqual(1);
  });
});
