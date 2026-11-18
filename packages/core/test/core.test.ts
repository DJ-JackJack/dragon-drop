import { describe, expect, it } from "vitest";
import {
  MapSession, addLandmass, addMountainRange, createDoc, decodeFrame, encodeFrame, generateTerrain, mapStats,
  renderFull, cropScale, drawGrid, sculpt, Simplex2D,
} from "../src/index.ts";

const mk = (w = 128, h = 128) => createDoc({ id: "t", name: "T", width: w, height: h, kmPerPx: 2 });

describe("noise", () => {
  it("is deterministic per seed and bounded", () => {
    const a = new Simplex2D(7), b = new Simplex2D(7), c = new Simplex2D(8);
    let diff = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 1.37, y = i * 0.71;
      expect(a.noise(x, y)).toBe(b.noise(x, y));
      diff += Math.abs(a.noise(x, y) - c.noise(x, y));
      expect(Math.abs(a.fbm(x, y, 20))).toBeLessThanOrEqual(1.01);
      const r = a.ridged(x, y, 20);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1.0001);
    }
    expect(diff).toBeGreaterThan(1);
  });
});

describe("terrain", () => {
  it("generates the requested land fraction, deterministically", () => {
    const d1 = mk(), d2 = mk();
    generateTerrain(d1, { template: "island", seed: 3, landFraction: 0.3 });
    generateTerrain(d2, { template: "island", seed: 3, landFraction: 0.3 });
    expect(Array.from(d1.height.data)).toEqual(Array.from(d2.height.data));
    const s = mapStats(d1);
    expect(s.landFraction).toBeGreaterThan(0.25);
    expect(s.landFraction).toBeLessThan(0.35);
    expect(s.maxM).toBeGreaterThan(100);
    expect(s.minM).toBeLessThan(-1000);
  });

  it("ocean template has no land", () => {
    const d = mk();
    generateTerrain(d, { template: "ocean", seed: 1 });
    expect(mapStats(d).landFraction).toBe(0);
  });

  it("adds a landmass inside a circle with a shelf around it", () => {
    const d = mk();
    generateTerrain(d, { template: "ocean", seed: 1 });
    const rect = addLandmass(d, { shape: { type: "circle", x: 64, y: 64, r: 25 }, heightM: 300, seed: 2 });
    expect(rect).not.toBeNull();
    expect(d.height.get(64, 64)).toBeGreaterThan(0);
    expect(d.height.get(2, 2)).toBeLessThan(-1000);
    // just outside the coast the shelf is shallow compared with open ocean
    expect(d.height.get(64 + 33, 64)).toBeGreaterThan(-1500);
  });

  it("adds a mountain range along a path", () => {
    const d = mk();
    d.height.data.fill(100);
    addMountainRange(d, { path: [[20, 64], [100, 64]], widthPx: 6, peakM: 2000, seed: 5 });
    expect(d.height.get(60, 64)).toBeGreaterThan(800);
    expect(d.height.get(60, 110)).toBeCloseTo(100, 0);
  });

  it("sculpts within the shape only", () => {
    const d = mk();
    d.height.data.fill(0);
    const rect = sculpt(d, { mode: "raise", shape: { type: "circle", x: 30, y: 30, r: 10 }, amountM: 500, falloff: 0.3 });
    expect(rect).toEqual({ x: 19, y: 19, w: 22, h: 22 });
    expect(d.height.get(30, 30)).toBeCloseTo(500, 0);
    expect(d.height.get(80, 80)).toBe(0);
  });

  it("smooth reduces roughness", () => {
    const d = mk(64, 64);
    for (let i = 0; i < d.height.data.length; i++) d.height.data[i] = (i % 2) * 200;
    const variance = () => {
      let m = 0, v = 0;
      const n = d.height.data.length;
      for (const x of d.height.data) m += x / n;
      for (const x of d.height.data) v += (x - m) ** 2 / n;
      return v;
    };
    const before = variance();
    sculpt(d, { mode: "smooth", shape: { type: "all" }, strength: 1 });
    expect(variance()).toBeLessThan(before * 0.1);
  });
});

describe("session", () => {
  it("undoes and redoes edits, tracking authors", () => {
    const s = new MapSession(mk());
    const orig = new Float32Array(s.doc.height.data);
    s.execute({ op: "sculpt", params: { mode: "raise", shape: { type: "circle", x: 40, y: 40, r: 8 }, amountM: 300 } }, "claude");
    const edited = new Float32Array(s.doc.height.data);
    expect(edited).not.toEqual(orig);
    s.undo("user");
    expect(s.doc.height.data).toEqual(orig);
    s.redo("user");
    expect(s.doc.height.data).toEqual(edited);
    expect(s.changes.map((c) => [c.kind, c.author])).toEqual([["edit", "claude"], ["undo", "user"], ["redo", "user"]]);
    expect(s.changesSince(1).length).toBe(2);
  });

  it("groups a brush stroke into one undo step and emits patches", () => {
    const s = new MapSession(mk());
    const orig = new Float32Array(s.doc.height.data);
    const patches: unknown[] = [];
    s.on((e) => { if (e.type === "patch") patches.push(e); });
    s.begin("user", "Raise stroke");
    for (let i = 0; i < 5; i++) {
      s.execute({ op: "sculpt", params: { mode: "raise", shape: { type: "circle", x: 20 + i * 5, y: 30, r: 6 }, amountM: 50 } }, "user");
    }
    s.commit();
    expect(patches.length).toBe(5);
    expect(s.changes.length).toBe(1);
    expect(s.changes[0].label).toBe("Raise stroke");
    s.undo("user");
    expect(s.doc.height.data).toEqual(orig);
  });

  it("undoes sea level changes", () => {
    const s = new MapSession(mk());
    s.execute({ op: "set_sea_level", levelM: 50 }, "claude");
    expect(s.doc.meta.seaLevel).toBe(50);
    s.undo("user");
    expect(s.doc.meta.seaLevel).toBe(0);
  });
});

describe("render", () => {
  it("renders land green-ish and sea blue-ish, with a grid overlay", () => {
    const d = mk();
    generateTerrain(d, { template: "ocean", seed: 1 });
    addLandmass(d, { shape: { type: "circle", x: 64, y: 64, r: 30 }, heightM: 200, seed: 1 });
    const img = renderFull(d);
    const px = (x: number, y: number) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
    const [lr, lg, lb] = px(64, 64);
    const [sr, sg, sb] = px(3, 3);
    expect(lg).toBeGreaterThan(lb);
    expect(sb).toBeGreaterThan(sr);
    const { img: small, scale } = cropScale(img, { x: 0, y: 0, w: 128, h: 128 }, 64);
    expect(small.w).toBe(64);
    expect(drawGrid(small, { x: 0, y: 0, w: 128, h: 128 }, scale)).toBeGreaterThan(0);
    void lr; void sg;
  });
});

describe("protocol", () => {
  it("round-trips binary frames", () => {
    const payload = new Float32Array([1, -2.5, 3e3]);
    const buf = encodeFrame({ t: "patch", projectId: "p", rect: { x: 1, y: 2, w: 3, h: 1 }, seq: 9 }, payload);
    const { header, payload: out } = decodeFrame(buf);
    expect(header.rect).toEqual({ x: 1, y: 2, w: 3, h: 1 });
    expect(Array.from(out)).toEqual([1, -2.5, 3000]);
  });
});
