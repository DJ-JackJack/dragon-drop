/** Reading streets and water back out of a picture of a city drawn by Dragon Drop itself (every street and the river known). */
import { describe, expect, it } from "vitest";
import { type MapStreet, createCityDoc, distToPolyline, readStreets, readWater, renderCity } from "../src/index.ts";

type Pt = [number, number];

/** A 300 x 200 m town at 2 px a metre: a street (7 m) across, a lane (4 m) down, houses beside them, and a river 20 m wide across the bottom. */
function town() {
  const d = createCityDoc({ id: "t", name: "T", widthM: 300, heightM: 200 });
  const { w, h, data } = d.height, cell = d.meta.city!.cellM;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs((y + 0.5) * cell - 170) < 10) data[y * w + x] = 8;
  const streets: MapStreet[] = [
    { id: "s1", points: [[0, 80], [150, 70], [300, 85]], width: 7, kind: "street" },
    { id: "s2", points: [[120, 0], [125, 150]], width: 4, kind: "lane" },
  ];
  const buildings = [[40, 60], [70, 58], [180, 55], [210, 57], [60, 100], [200, 105]].map(([x, y], i) => ({ id: `b${i}`, points: [[x - 5, y - 4], [x + 5, y - 4], [x + 5, y + 4], [x - 5, y + 4]] as Pt[], roof: (i % 2 ? "tile" : "slate") as "tile" | "slate" }));
  d.features = { ...d.features!, streets, buildings };
  const r = renderCity(d, { maxSize: 600, contours: false, trees: false });
  return { d, img: r.img, px: r.px, streets, ground: { w, h, data: Uint8Array.from(data) }, cell };
}

describe("reading streets and water from a picture", () => {
  it("finds the streets as lines along their middles, with their widths", () => {
    const { img, px, streets } = town();
    const area: Pt[] = [[0, 0], [img.w, 0], [img.w, img.h], [0, img.h]];
    const r = readStreets(img, { area, streets: [{ x: 50 * px, y: 78.5 * px }], others: [{ x: 20 * px, y: 30 * px }, { x: 40 * px, y: 60 * px }, { x: 70 * px, y: 58 * px }], minWidth: 1.5 * px, maxWidth: 30 * px, minLength: 10 * px });
    const m = r.streets.map((s) => ({ points: s.points.map(([x, y]) => [x / px, y / px] as Pt), width: s.width / px }));
    const long = m.filter((s) => s.points.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - s.points[i - 1][0], p[1] - s.points[i - 1][1]) : 0), 0) > 40);
    expect(long.length).toBeGreaterThanOrEqual(2);
    expect(long.length).toBeLessThanOrEqual(6);
    // every point of a long line lies on one of the true streets, and the widths are about right
    for (const s of long) {
      const near = streets.map((t) => Math.max(...s.points.map(([x, y]) => distToPolyline(x, y, t.points as Pt[]))));
      const which = near.indexOf(Math.min(...near));
      expect(near[which]).toBeLessThan(3);
      expect(Math.abs(s.width - streets[which].width)).toBeLessThan(2);
    }
    // both streets are found
    for (const t of streets) expect(long.some((s) => Math.max(...s.points.map(([x, y]) => distToPolyline(x, y, t.points as Pt[]))) < 3)).toBe(true);
  });

  it("finds which ground cells are water", () => {
    const { img, px, ground, cell } = town();
    const area: Pt[] = [[0, 0], [img.w, 0], [img.w, img.h], [0, img.h]];
    const r = readWater(img, { area, water: [{ x: 50 * px, y: 170 * px, material: 7 }], others: [{ x: 20 * px, y: 30 * px }], grid: { w: ground.w, h: ground.h, cellM: cell, trace: { ref: "t.png", w: img.w, h: img.h, x: 0, y: 0, scale: 1 / px, rotation: 0 } } });
    expect(r.runs.map((x) => x.material)).toEqual([7]);
    const wet = new Set<number>();
    for (const { runs } of r.runs) for (let i = 0; i < runs.length; i += 2) for (let k = 0; k < runs[i + 1]; k++) wet.add(runs[i] + k);
    let truth = 0, hit = 0;
    for (let i = 0; i < ground.data.length; i++) if (ground.data[i] === 8) { truth++; if (wet.has(i)) hit++; }
    expect(hit / truth).toBeGreaterThan(0.9);
    expect(wet.size).toBeLessThan(truth * 1.1);
    expect(r.cells).toBe(wet.size);
  });
});
