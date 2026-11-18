import { describe, expect, it } from "vitest";
import { HeightField, compassOf, createDoc, findStraits } from "../src/index.ts";

/** A ring of islands (discs) around the middle, with gaps between them, and a couple of inner islands and a speck. */
function ringMap() {
  const W = 400, d = createDoc({ id: "r", name: "R", width: W, height: W, kmPerPx: 5 });
  d.height.data.fill(-500);
  const disc = (cx: number, cy: number, r: number) => { for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) <= r) d.height.data[y * W + x] = 100; };
  for (let k = 0; k < 6; k++) { const a = (k / 6) * 2 * Math.PI; disc(200 + 150 * Math.sin(a), 200 - 150 * Math.cos(a), 36); } // six ring islands, 150 px from the middle
  disc(200, 200, 30); disc(235, 215, 18); // the middle
  disc(20, 20, 2); // a speck
  return d;
}

describe("finding the straits", () => {
  it("names compass directions with north at the top", () => {
    expect(compassOf(0, -10)).toBe("north");
    expect(compassOf(10, 0)).toBe("east");
    expect(compassOf(-7, 7)).toBe("south-west");
  });

  it("finds the ring islands and the gap between each neighbouring pair", () => {
    const d = ringMap();
    const r = findStraits(d.height, 0, d.meta.kmPerPx, { centre: [200, 200] });
    expect(r.islands).toHaveLength(6); // not the middle islands, not the speck
    expect(r.islands.map((i) => i.compass)).toEqual(["north", "north-east", "south-east", "south", "south-west", "north-west"]);
    expect(r.straits).toHaveLength(6);
    // neighbours at 60 degrees on a 150 px circle are 150 px apart centre to centre, so the gap is 150 - 72 = 78 px
    for (const s of r.straits) {
      expect(s.widthPx).toBeGreaterThan(72);
      expect(s.widthPx).toBeLessThan(84);
      expect(Math.abs(s.widthKm - s.widthPx * 5)).toBeLessThanOrEqual(3);
      expect(Math.hypot(s.mid[0] - 200, s.mid[1] - 200)).toBeGreaterThan(110); // out on the ring, not in the middle
    }
    expect(r.straits.map((s) => s.compass)).toEqual(["north-east", "east", "south-east", "south-west", "west", "north-west"]);
    expect(new Set(r.straits.map((s) => s.between[0])).size).toBe(6);
  });

  it("without a given centre it uses the middle of the land, and finds the same ring", () => {
    const d = ringMap();
    const r = findStraits(d.height, 0, 5);
    expect(r.islands).toHaveLength(6);
    expect(Math.abs(r.centre[0] - 200)).toBeLessThan(15);
  });

  it("returns nothing for a map without a ring", () => {
    const d = createDoc({ id: "r", name: "R", width: 128, height: 128, kmPerPx: 5 });
    d.height.data.fill(-500);
    for (let y = 30; y < 90; y++) for (let x = 30; x < 90; x++) d.height.data[y * 128 + x] = 50;
    expect(findStraits(d.height, 0, 5).straits).toEqual([]);
    expect(findStraits(new HeightField(64, 64), 0, 5).islands).toEqual([]);
  });

  it("finds the straits of an irregular ring of eight islands of different sizes and distances", () => {
    const W = 800, d = createDoc({ id: "i", name: "I", width: W, height: W, kmPerPx: 4 });
    d.height.data.fill(-500);
    const blob = (cx: number, cy: number, rx: number, ry: number, rot: number) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const u = ((x - cx) * c + (y - cy) * s) / rx, v = (-(x - cx) * s + (y - cy) * c) / ry; if (u * u + v * v <= 1) d.height.data[y * W + x] = 80; }
    };
    // eight islands round (400, 400): the angle, the distance from the middle and the shape all differ
    const spec = [[0, 280, 70, 40], [45, 300, 55, 55], [90, 270, 60, 35], [135, 310, 75, 45], [180, 290, 50, 50], [225, 280, 65, 38], [270, 300, 58, 58], [315, 285, 72, 42]];
    spec.forEach(([deg, dist, rx, ry], k) => { const a = (deg * Math.PI) / 180; blob(400 + dist * Math.sin(a), 400 - dist * Math.cos(a), rx, ry, a + k * 0.3); });
    blob(400, 400, 40, 30, 0.4); // an island in the middle: not part of the ring
    const r = findStraits(d.height, 0, 4, { centre: [400, 400] });
    expect(r.islands).toHaveLength(8);
    expect(r.straits).toHaveLength(8);
    const widths = r.straits.map((s) => s.widthPx).sort((a, b) => a - b);
    expect(widths[0]).toBeGreaterThan(5);
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0] * 1.15); // the gaps are not all the same
    for (const s of r.straits) expect(Math.hypot(s.mid[0] - 400, s.mid[1] - 400)).toBeGreaterThan(180); // out on the ring
  });
});


import { findOuterCoasts } from "../src/index.ts";

/** Points every 2 px along every piece (the pieces themselves are simplified to a few corners). */
function dense(ps: { points: [number, number][] }[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of ps) for (let i = 1; i < p.points.length; i++) {
    const [ax, ay] = p.points[i - 1], [bx, by] = p.points[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
    for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

describe("finding the outer coasts", () => {
  it("lines the shores that face the open ocean, not the ones that face the inner sea", () => {
    const d = ringMap();
    const pieces = findOuterCoasts(d.height, 0, 5, { centre: [200, 200], offsetPx: 0 });
    expect(pieces.length).toBeGreaterThanOrEqual(6); // at least one run for each ring island
    for (const p of pieces) {
      for (const [x, y] of p.points) {
        // every point is on the outside of its island's ring: farther from the middle than the island's middle is, or beside the gaps
        expect(Math.hypot(x - 200, y - 200)).toBeGreaterThan(120);
      }
    }
    // the inner shores (toward the middle) carry no reef: no point sits closer to the middle than the ring island's inner edge
    const innermost = Math.min(...pieces.flatMap((p) => p.points.map(([x, y]) => Math.hypot(x - 200, y - 200))));
    expect(innermost).toBeGreaterThan(110); // island centres at 150 px, radius 36: the inner shore is at 114
  });

  it("leaves cleared areas bare and keeps the reef a little out to sea", () => {
    const d = ringMap();
    const all = findOuterCoasts(d.height, 0, 5, { centre: [200, 200], offsetPx: 0 });
    const clear = findOuterCoasts(d.height, 0, 5, { centre: [200, 200], offsetPx: 0, clear: [{ circle: [200, 50, 60] }] }); // around the northern island
    const inside = (ps: typeof all) => dense(ps).filter(([x, y]) => Math.hypot(x - 200, y - 50) <= 60).length;
    expect(inside(all)).toBeGreaterThan(10);
    expect(inside(clear)).toBe(0);
    const out = findOuterCoasts(d.height, 0, 5, { centre: [200, 200], offsetPx: 4 });
    const meanR = (ps: typeof all) => { const r = ps.flatMap((p) => p.points).map(([x, y]) => Math.hypot(x - 200, y - 200)); return r.reduce((a, b) => a + b, 0) / r.length; };
    expect(meanR(out)).toBeGreaterThan(meanR(all) + 2); // farther out
  });

  it("finds nothing without a ring, and leaves a cleared polygon bare", () => {
    const empty = createDoc({ id: "r", name: "R", width: 128, height: 128, kmPerPx: 5 });
    empty.height.data.fill(-500);
    expect(findOuterCoasts(empty.height, 0, 5)).toEqual([]);
    const d = ringMap();
    // a polygon round the northern island's whole coast (the island is a disc of radius 36 at (200, 50))
    const poly: [number, number][] = [[150, 0], [250, 0], [250, 100], [150, 100]];
    const all = findOuterCoasts(d.height, 0, 5, { centre: [200, 200] });
    const kept = findOuterCoasts(d.height, 0, 5, { centre: [200, 200], clear: [{ polygon: poly }] });
    const total = (ps: typeof all) => ps.reduce((a, p) => a + p.lengthPx, 0);
    expect(total(all)).toBeGreaterThan(800); // the outer shores of six islands
    expect(total(kept)).toBeLessThan(total(all) - 80); // the northern island's outer coast is gone
    const inPoly = (x: number, y: number) => x > 150 && x < 250 && y > 0 && y < 100;
    expect(dense(kept).filter(([x, y]) => inPoly(x, y)).length).toBeLessThan(4); // (the line sits a little out to sea: allow its end)
  });
});
