/** What a map view does when its canvas changes size (viewResize.ts). */
import { describe, expect, it } from "vitest";
import { type ViewLike, makeResizeKeeper } from "../src/viewResize.ts";

/** A view of a 1000 x 500 map fitted like the map views do (95% of the room, centred). */
function setup() {
  let size = { w: 0, h: 0 };
  let view: ViewLike = { scale: 1, ox: 0, oy: 0 };
  const fit = () => {
    const scale = Math.min(size.w / 1000, size.h / 500) * 0.95;
    view = { scale, ox: (size.w - 1000 * scale) / 2, oy: (size.h - 500 * scale) / 2 };
    keeper.fitted();
  };
  const keeper = makeResizeKeeper(() => view, (v) => { view = v; }, fit);
  const resize = (w: number, h: number) => { size = { w, h }; keeper.resized(w, h); };
  return { fit, resize, view: () => view, setView: (v: ViewLike) => { view = v; }, setSize: (w: number, h: number) => { size = { w, h }; } };
}

describe("a map view when its canvas changes size", () => {
  it("fits the map again when it was fitted while the canvas had no size (it sat at 0%)", () => {
    const t = setup();
    t.resize(0, 0); // (hidden)
    t.fit();
    expect(t.view().scale).toBe(0);
    t.resize(800, 600);
    expect(t.view().scale).toBeCloseTo(0.76);
    // the same when the first size the canvas reports is already its real one
    const u = setup();
    u.fit();
    u.resize(800, 600);
    expect(u.view().scale).toBeCloseTo(0.76);
  });

  it("fits a fitted view again, and keeps the middle of a view the person moved", () => {
    const t = setup();
    t.setSize(800, 600);
    t.fit();
    t.resize(800, 600);
    t.resize(1000, 600);
    expect(t.view().scale).toBeCloseTo(0.95);
    t.setView({ scale: 2, ox: 10, oy: 20 });
    t.resize(1200, 600);
    expect(t.view()).toEqual({ scale: 2, ox: 110, oy: 20 });
  });

  it("leaves a view alone while the canvas is hidden", () => {
    const t = setup();
    t.setSize(800, 600);
    t.fit();
    t.resize(800, 600);
    const before = t.view();
    t.resize(0, 0);
    expect(t.view()).toEqual(before);
  });
});
