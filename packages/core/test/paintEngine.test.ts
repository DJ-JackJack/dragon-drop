import { describe, expect, it } from "vitest";
import {
  type Derived, type PaintView, PaintEngine, addLandmass, addMountainRange, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, generateTerrain,
  renderInto, renderPainted, renderPlaceholder,
} from "../src/index.ts";

const W = 192;

function world(zoom?: number) {
  const d = createDoc({ id: "e", name: "E", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: W / 2, y: W / 2, r: W * 0.38 }, heightM: 300, seed: 2 });
  addMountainRange(d, { path: [[W * 0.35, W * 0.3], [W * 0.3, W * 0.5], [W * 0.38, W * 0.7]], widthPx: 8, peakM: 3200, seed: 3 });
  d.meta.climate = { latTop: 0.7, latBot: 0.3, wind: "northwest" };
  if (zoom) d.meta.zoom = zoom;
  return d;
}
const noise = buildNoiseCache(W, W, 7);
const climate = buildClimateNoise(W, W, 1);
const viewOf = (meta: ReturnType<typeof world>["meta"], mode: PaintView["mode"] = "painted", hillshade = true): PaintView => ({ mode, meta, hillshade });

function assemble(parts: Iterable<{ rect: { x: number; y: number; w: number; h: number }; data: Uint8ClampedArray }>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * W * 4);
  for (const p of parts) for (let y = 0; y < p.rect.h; y++) out.set(p.data.subarray(y * p.rect.w * 4, (y + 1) * p.rect.w * 4), ((p.rect.y + y) * W + p.rect.x) * 4);
  return out;
}
const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

describe("the paint engine", () => {
  for (const zoom of [undefined, 4]) {
    it(`a whole-map repaint in slices is exactly the one-shot painted render${zoom ? " (zoomed map)" : ""}`, () => {
      const doc = world(zoom);
      const der = computeDerived(doc, climate, 1);
      const e = new PaintEngine(W, W, doc.height.data.slice());
      e.setNoise(noise);
      expect(e.setDerived(der)).toBe("all");
      const full = new Uint8ClampedArray(W * W * 4);
      renderPainted(doc, der, noise, null, full);
      expect(maxDiff(assemble(e.slices(viewOf(doc.meta), 50)), full)).toBe(0);
    });
  }

  it("shows a quick relief preview until the noise and climate layers are there, then switches to the painted style", () => {
    const doc = world();
    const e = new PaintEngine(W, W, doc.height.data.slice());
    const preview = new Uint8ClampedArray(W * W * 4);
    renderPlaceholder(doc, preview);
    expect(e.paintedReady()).toBe(false);
    expect(maxDiff(assemble(e.slices(viewOf(doc.meta), 64)), preview)).toBe(0);
    e.setNoise(noise);
    expect(e.paintedReady()).toBe(false); // noise alone isn't enough
    expect(maxDiff(assemble(e.slices(viewOf(doc.meta), 64)), preview)).toBe(0);
    e.setDerived(computeDerived(doc, climate, 1));
    expect(e.paintedReady()).toBe(true);
    expect(maxDiff(assemble(e.slices(viewOf(doc.meta), 64)), preview)).toBeGreaterThan(20);
  });

  it("paints a tile like the same area of the full render, in the painted and the relief style", () => {
    const doc = world();
    const der = computeDerived(doc, climate, 1);
    const e = new PaintEngine(W, W, doc.height.data.slice());
    e.setNoise(noise); e.setDerived(der);
    const r = { x: 40, y: 70, w: 50, h: 33 };
    const full = new Uint8ClampedArray(W * W * 4);
    renderPainted(doc, der, noise, null, full);
    const t = e.tile(r, viewOf(doc.meta))!;
    expect(t.rect).toEqual(r);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) for (let c = 0; c < 3; c++) {
      expect(Math.abs(t.data[(y * r.w + x) * 4 + c] - full[((r.y + y) * W + r.x + x) * 4 + c])).toBeLessThanOrEqual(1);
    }
    const relief = new Uint8ClampedArray(W * W * 4);
    renderInto(doc, r, relief, { hillshade: false });
    const tr = e.tile(r, viewOf(doc.meta, "relief", false))!;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) expect(tr.data[(y * r.w + x) * 4 + 1]).toBe(relief[((r.y + y) * W + r.x + x) * 4 + 1]);
    expect(e.tile({ x: -50, y: -50, w: 10, h: 10 }, viewOf(doc.meta))).toBeNull();
    expect(e.tile({ x: W - 5, y: W - 5, w: 50, h: 50 }, viewOf(doc.meta))!.rect).toEqual({ x: W - 5, y: W - 5, w: 5, h: 5 });
  });

  it("relief slices equal the plain relief render, with or without shading", () => {
    const doc = world();
    const e = new PaintEngine(W, W, doc.height.data.slice());
    for (const hillshade of [true, false]) {
      const full = new Uint8ClampedArray(W * W * 4);
      renderInto(doc, null, full, { hillshade });
      expect(maxDiff(assemble(e.slices(viewOf(doc.meta, "relief", hillshade), 70)), full)).toBe(0);
    }
  });

  it("follows height patches: a tile painted after a patch shows the new land", () => {
    const doc = world();
    const der = computeDerived(doc, climate, 1);
    const e = new PaintEngine(W, W, doc.height.data.slice());
    e.setNoise(noise); e.setDerived(der);
    const r = { x: 20, y: 20, w: 30, h: 30 };
    const before = e.tile(r, viewOf(doc.meta))!;
    const raised = new Float32Array(r.w * r.h).fill(2500);
    e.patch(r, raised);
    const after = e.tile(r, viewOf(doc.meta))!;
    expect(maxDiff(before.data, after.data)).toBeGreaterThan(30);
    // and it matches an engine that had that land from the start
    const doc2 = world();
    doc2.height.pasteRect(r, raised);
    const e2 = new PaintEngine(W, W, doc2.height.data.slice());
    e2.setNoise(noise); e2.setDerived(der);
    expect(maxDiff(e2.tile(r, viewOf(doc2.meta))!.data, after.data)).toBe(0);
  });

  it("says what new climate layers change: everything the first time, then only the box around the difference, or nothing", () => {
    const doc = world();
    const der = computeDerived(doc, climate, 1);
    const e = new PaintEngine(W, W, doc.height.data.slice());
    expect(e.setDerived(der)).toBe("all");
    const same: Derived = { ...der, seq: 2 };
    expect(e.setDerived(same)).toBe("none");
    const moved: Derived = { ...der, seq: 3, snow: der.snow.slice() };
    moved.snow[100 * W + 50] = 200;
    expect(e.setDerived(moved)).toEqual({ x: 50, y: 100, w: 1, h: 1 });
    expect(() => e.setDerived({ ...der, W: 64, H: 64 })).toThrow();
    expect(() => e.setNoise(buildNoiseCache(64, 64, 1))).toThrow();
  });
});
