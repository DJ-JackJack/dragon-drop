// Which changes of map settings repaint the whole map (seconds of work) and which only redraw: the measurement system is only text.
import { describe, expect, it } from "vitest";
import type { MapMeta } from "@mapmaker/core";
import { repaintNeeded } from "../src/metaDiff.ts";

const meta = { id: "w", name: "World", kind: "world", width: 256, height: 256, kmPerPx: 4, seaLevel: 0, seed: 1, createdAt: "", updatedAt: "", style: "painted" } as MapMeta;

describe("repaintNeeded", () => {
  it("doesn't repaint for the measurement system, the name or the grid", () => {
    expect(repaintNeeded(meta, { ...meta, units: "metric" })).toBe(false);
    expect(repaintNeeded({ ...meta, units: "metric" }, { ...meta, units: null })).toBe(false);
    expect(repaintNeeded(meta, { ...meta, name: "Renamed", grid: { type: "hex", sizeMi: 6, orient: "pointy", opacity: 0.5 } })).toBe(false);
  });
  it("repaints for the style, the sea level or another map", () => {
    expect(repaintNeeded(meta, { ...meta, style: "ink" })).toBe(true);
    expect(repaintNeeded(meta, { ...meta, seaLevel: 10 })).toBe(true);
    expect(repaintNeeded(meta, { ...meta, id: "other" })).toBe(true);
  });
});
