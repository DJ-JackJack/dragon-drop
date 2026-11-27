// The brush size control (BrushSize.tsx): a log-scale slider that gives small sizes as much travel as large ones, sizes held to their range and step,
// and the arrow keys' steps.
import { describe, expect, it } from "vitest";
import { nudge, sliderPos, sliderValue, snap } from "../src/BrushSize.tsx";

describe("brush size", () => {
  it("gives small sizes as much of the slider as large ones", () => {
    // 1..300 px: 1 to 10 takes as much travel as 30 to 300
    expect(sliderPos(10, 1, 300) - sliderPos(1, 1, 300)).toBe(sliderPos(300, 1, 300) - sliderPos(30, 1, 300));
    expect(sliderPos(1, 1, 300)).toBe(0);
    expect(sliderPos(300, 1, 300)).toBe(1000);
    // every whole size from 1 to 20 px can be reached with the slider (it was 2.5 px a pixel of slider on the Ground brush)
    const reached = new Set<number>();
    for (let p = 0; p <= 1000; p++) reached.add(sliderValue(p, 1, 300, 1));
    for (let v = 1; v <= 20; v++) expect(reached.has(v)).toBe(true);
  });

  it("goes there and back on the slider", () => {
    for (const v of [1, 2, 7, 30, 64, 150, 300]) expect(sliderValue(sliderPos(v, 1, 300), 1, 300, 1)).toBe(v);
    for (const v of [0.25, 0.5, 1.75, 4, 10]) expect(sliderValue(sliderPos(v, 0.25, 10), 0.25, 10, 0.25)).toBe(v);
  });

  it("holds sizes to their range and step, and steps one at a time or by a tenth", () => {
    expect(snap(0, 1, 300, 1)).toBe(1);
    expect(snap(999, 1, 300, 1)).toBe(300);
    expect(snap(2.6, 0.25, 10, 0.25)).toBe(2.5);
    expect(nudge(30, 1, 1, 300, 1)).toBe(31);
    expect(nudge(30, -1, 1, 300, 1)).toBe(29);
    expect(nudge(200, 1, 1, 300, 1, true)).toBe(220);
    expect(nudge(1, -1, 1, 300, 1)).toBe(1);
  });
});
