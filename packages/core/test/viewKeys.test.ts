import { describe, expect, it } from "vitest";
import { KEY_PAN_STEP, KEY_ZOOM_STEP, applyViewKey, viewKeyAction } from "../src/index.ts";

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) =>
  viewKeyAction({ key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift });

describe("keys that move the view", () => {
  it("zooms with + and = (in) and - and _ (out)", () => {
    expect(key("+")).toEqual({ kind: "zoom", factor: KEY_ZOOM_STEP });
    expect(key("=")).toEqual({ kind: "zoom", factor: KEY_ZOOM_STEP });
    expect(key("-")).toEqual({ kind: "zoom", factor: 1 / KEY_ZOOM_STEP });
    expect(key("_")).toEqual({ kind: "zoom", factor: 1 / KEY_ZOOM_STEP });
  });

  it("fits the map with 0 and Ctrl+0 (or Cmd+0)", () => {
    expect(key("0")).toEqual({ kind: "fit" });
    expect(key("0", { ctrl: true })).toEqual({ kind: "fit" });
    expect(key("0", { meta: true })).toEqual({ kind: "fit" });
  });

  it("pans with the arrow keys, three times as far with Shift", () => {
    expect(key("ArrowRight")).toEqual({ kind: "pan", dx: -KEY_PAN_STEP, dy: 0 }); // (the view goes right, so the map goes left)
    expect(key("ArrowLeft")).toEqual({ kind: "pan", dx: KEY_PAN_STEP, dy: 0 });
    expect(key("ArrowDown")).toEqual({ kind: "pan", dx: 0, dy: -KEY_PAN_STEP });
    expect(key("ArrowUp", { shift: true })).toEqual({ kind: "pan", dx: 0, dy: 3 * KEY_PAN_STEP });
  });

  it("leaves everything else alone, and any key held with Alt (or Ctrl/Cmd, other than 0)", () => {
    for (const k of ["a", "[", "]", "g", "Enter", "Escape", " ", "1", "Tab"]) expect(key(k)).toBeNull();
    expect(key("+", { alt: true })).toBeNull();
    expect(key("0", { alt: true })).toBeNull();
    expect(key("=", { ctrl: true })).toBeNull(); // (Ctrl and + is the browser's own zoom)
    expect(key("-", { meta: true })).toBeNull();
    expect(key("ArrowLeft", { ctrl: true })).toBeNull();
  });
});

describe("applying them", () => {
  const size = { w: 800, h: 600 };
  const limits = { min: 0.05, max: 80 };

  it("zooms about the middle of the window: the map point there stays put", () => {
    const v = { scale: 2, ox: 100, oy: -50 };
    const mapAtCentre = { x: (400 - v.ox) / v.scale, y: (300 - v.oy) / v.scale };
    for (const factor of [KEY_ZOOM_STEP, 1 / KEY_ZOOM_STEP, KEY_ZOOM_STEP ** 3]) {
      const z = applyViewKey(v, { kind: "zoom", factor }, size, limits);
      expect(z.scale).toBeCloseTo(2 * factor, 9);
      expect((400 - z.ox) / z.scale).toBeCloseTo(mapAtCentre.x, 9);
      expect((300 - z.oy) / z.scale).toBeCloseTo(mapAtCentre.y, 9);
    }
  });

  it("stops at the limits, and still keeps the middle in place when it does", () => {
    const out = applyViewKey({ scale: 79, ox: 0, oy: 0 }, { kind: "zoom", factor: KEY_ZOOM_STEP }, size, limits);
    expect(out.scale).toBe(80);
    const mapAtCentre = (400 - 0) / 79;
    expect((400 - out.ox) / out.scale).toBeCloseTo(mapAtCentre, 9);
    expect(applyViewKey({ scale: 0.05, ox: 0, oy: 0 }, { kind: "zoom", factor: 1 / KEY_ZOOM_STEP }, size, limits).scale).toBe(0.05);
  });

  it("moves the map by the pan, without changing the scale", () => {
    expect(applyViewKey({ scale: 3, ox: 10, oy: 20 }, { kind: "pan", dx: -80, dy: 0 }, size, limits)).toEqual({ scale: 3, ox: -70, oy: 20 });
  });
});
