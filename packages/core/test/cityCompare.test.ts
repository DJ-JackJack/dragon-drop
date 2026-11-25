import { describe, expect, it } from "vitest";
import { type MapBuilding, type MapDoc, compareHeatMap, compareToTrace, createCityDoc, fitTrace, squareScore } from "@mapmaker/core";

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/**
 * A 500 x 300 m town and a picture of it at a metre a pixel: green ground, a grey street 10 m wide along y = 150, and two rows of red roofs (12 x 10 m,
 * 6 m apart, with a dark ridge down each) above and below it. The map has the street (but 6 m wide) and only some of the houses.
 */
function scene() {
  const W = 500, H = 300, data = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, c: number[]) => { const o = (y * W + x) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, [110, 160, 90]);
  for (let y = 145; y < 155; y++) for (let x = 0; x < W; x++) put(x, y, [200, 196, 180]);
  const roofs: Pt[][] = [];
  for (let x = 20; x + 12 <= 480; x += 18) for (const y of [120, 170]) {
    roofs.push(rect(x, y, 12, 10));
    for (let yy = y; yy < y + 10; yy++) for (let xx = x; xx < x + 12; xx++) put(xx, yy, xx === x + 6 ? [70, 30, 25] : [180, 70, 55]);
  }
  const doc: MapDoc = createCityDoc({ id: "cmp", name: "Compare", widthM: W, heightM: H, cellM: 2 });
  const buildings: MapBuilding[] = roofs.filter((_, i) => i % 3 !== 0).map((p, i) => ({ id: `b-${i}`, points: p, roof: "tile" }));
  doc.features = { ...doc.features!, buildings, streets: [{ id: "t-1", points: [[0, 150], [500, 150]], width: 6 }], trace: fitTrace({ ref: "pic.png", w: W, h: H }, W, H) };
  return { doc, img: { w: W, h: H, data }, roofs, buildings };
}

describe("a settlement against its trace picture", () => {
  it("learns what things look like from where the map has them, and measures roofs, streets and their widths", () => {
    const { doc, img, roofs, buildings } = scene();
    const r = compareToTrace(doc, img);
    expect(r.metresPerSample).toBe(1);
    expect(r.classes.map((c) => c.kind).sort()).toEqual(["ground", "roof", "street"]);
    // the map has two thirds of the houses, all on roofs
    const T = r.totals, covered = T.roofs.both / T.roofs.picture, onRoofs = T.roofs.both / T.roofs.map;
    expect(covered).toBeGreaterThan(0.6);
    expect(covered).toBeLessThan(0.72);
    expect(onRoofs).toBeGreaterThan(0.95);
    // every roof counted once (its ridge doesn't split it), against the map's buildings
    expect(T.roofCount.picture).toBe(roofs.length);
    expect(T.roofCount.map).toBe(buildings.length);
    // the street: 6 m on the map where the picture's is 10 m
    expect(T.streetWidth!.median).toBeCloseTo(0.6, 1);
    expect(T.streets.both / T.streets.map).toBeGreaterThan(0.95);
    expect(T.streets.both / T.streets.picture).toBeLessThan(0.7);
  });

  it("finds a tree group standing on roofs, keeps to an area, and tells squares apart", () => {
    const { doc, img } = scene();
    doc.features!.trees = [{ id: "v-roof", kind: "wood", points: rect(20, 120, 30, 10) }, { id: "v-field", kind: "wood", points: rect(300, 30, 40, 40) }];
    const r = compareToTrace(doc, img, { square: 100 });
    expect(r.totals.treesOnRoofs.ids).toEqual(["v-roof"]);
    expect(r.squares).toHaveLength(15);
    // the left half alone
    const left = compareToTrace(doc, img, { area: rect(0, 0, 250, 300) });
    expect(left.totals.roofs.picture).toBeLessThan(r.totals.roofs.picture * 0.6);
    // a square with no roofs says nothing about roofs; one with them gets a score
    const empty = r.squares.find((q) => q.y === 0)!, busy = r.squares.find((q) => q.y === 100 && q.x === 100)!;
    expect(squareScore(empty, "roofs")).toBeNull();
    expect(squareScore(busy, "roofs")).toBeGreaterThan(0.5);
    const heat = compareHeatMap(doc, img, r, "roofs", 250);
    expect([heat.w, heat.h]).toEqual([250, 150]);
  });

  it("asks for a trace picture first", () => {
    const { doc, img } = scene();
    delete doc.features!.trace;
    expect(() => compareToTrace(doc, img)).toThrow(/trace picture/);
  });
});
