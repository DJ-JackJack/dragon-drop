// Areas waiting to be painted (rectQueue.ts): a stroke's overlapping patches join into few boxes, far ones stay apart, and a long diagonal stroke is
// never one huge box round it.
import { describe, expect, it } from "vitest";
import type { Rect } from "@mapmaker/core";
import { type Waiting, addRect } from "../src/rectQueue.ts";

const area = (ws: Waiting[]) => ws.reduce((n, { r }) => n + r.w * r.h, 0);
const dab = (x: number, y: number, r: number): Rect => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });

describe("waiting areas", () => {
  it("joins a straight stroke's overlapping dabs into one box, painted once", () => {
    let w: Waiting[] = [];
    for (let i = 0; i < 16; i++) w = addRect(w, dab(100 + i * 18, 200, 60)); // radius 60, dabs 0.3 r apart
    expect(w).toHaveLength(1);
    expect(w[0].r).toEqual({ x: 40, y: 140, w: 15 * 18 + 120, h: 120 });
    // the dabs one by one painted 16 squares of 120 x 120; the joined box is less than a third of that
    expect(area(w)).toBeLessThan(16 * 120 * 120 / 3);
  });

  it("keeps far-apart areas apart", () => {
    const w = addRect(addRect([], dab(100, 100, 20)), dab(900, 900, 20));
    expect(w).toHaveLength(2);
  });

  it("doesn't wrap a long diagonal stroke in one huge box", () => {
    let w: Waiting[] = [];
    for (let i = 0; i < 60; i++) w = addRect(w, dab(100 + i * 15, 100 + i * 15, 25));
    expect(w.length).toBeGreaterThan(3);
    const one = (60 * 15 + 50) ** 2; // the box round the whole stroke
    expect(area(w)).toBeLessThan(one / 4);
    // every dab is still covered
    for (let i = 0; i < 60; i++) {
      const d = dab(100 + i * 15, 100 + i * 15, 25);
      expect(w.some(({ r }) => r.x <= d.x && r.y <= d.y && r.x + r.w >= d.x + d.w && r.y + r.h >= d.y + d.h)).toBe(true);
    }
  });
});
