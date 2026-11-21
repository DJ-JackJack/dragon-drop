/** cityPlan.ts: buildings along streets, streets that follow the land, and the check of a city. */
import { describe, expect, it } from "vitest";
import { type MapBuilding, type MapStreet, applyFeaturesPatch, cleanLandform, cityProblems, createCityDoc, landAt, planFrontage, pointInPolygon, routeStreet, distToSegment } from "../src/index.ts";

type Pt = [number, number];
const town = (w = 600, h = 400) => createCityDoc({ id: "t", name: "T", widthM: w, heightM: h, cellM: 1 });
const curve: MapStreet = { id: "s1", points: [[20, 200], [200, 170], [380, 210], [580, 190]], width: 7, kind: "street" };

describe("buildings along streets", () => {
  it("face the street from both sides, stay off it and off each other, and vary in size", () => {
    const doc = town();
    doc.features = applyFeaturesPatch(doc.features!, { upsertStreets: [curve] });
    const p = planFrontage(doc, [curve], { character: "town" });
    expect(p.buildings.length).toBeGreaterThan(40);
    expect(p.byStreet.s1).toBe(p.buildings.length);
    const centre = (b: { points: Pt[] }) => [b.points.reduce((s, q) => s + q[0], 0) / 4, b.points.reduce((s, q) => s + q[1], 0) / 4];
    const dist = (x: number, y: number) => Math.min(...curve.points.slice(1).map((q, i) => distToSegment(x, y, curve.points[i][0], curve.points[i][1], q[0], q[1])));
    // every corner is off the street, and every building near it (on one side or the other)
    for (const b of p.buildings) for (const [x, y] of b.points) expect(dist(x, y)).toBeGreaterThanOrEqual(3.5 - 1e-6);
    const above = p.buildings.filter((b) => { const [x, y] = centre(b); return y < 200 - (x > 200 ? 0 : 0) && dist(x, y) < 30 && y < (x < 200 ? 200 - (30 * x) / 200 : 170 + ((x - 200) * 40) / 180); });
    expect(above.length).toBeGreaterThan(5);
    expect(p.buildings.length - above.length).toBeGreaterThan(5);
    const widths = new Set(p.buildings.map((b) => Math.round(Math.hypot(b.points[1][0] - b.points[0][0], b.points[1][1] - b.points[0][1]))));
    expect(widths.size).toBeGreaterThan(3);
    // the same call again gives the same town; another seed another
    expect(planFrontage(doc, [curve], { character: "town" }).buildings).toEqual(p.buildings);
    expect(planFrontage(doc, [curve], { character: "town", seed: 7 }).buildings).not.toEqual(p.buildings);
    // nothing overlaps: the check finds no building on another, on the street or in water
    doc.features = applyFeaturesPatch(doc.features!, { upsertBuildings: p.buildings.map((b, i): MapBuilding => ({ id: `b${i}`, points: b.points, roof: b.roof, kind: b.kind })) });
    const r = cityProblems(doc);
    expect([r.overlapping.count, r.on_streets.count, r.in_water.count]).toEqual([0, 0, 0]);
    expect(r.regularity.looks_stamped).toBe(false);
  });

  it("fill a dense centre more than a village lane, and leave water, steep ground and woods empty", () => {
    const doc = town();
    const { w, data } = doc.height;
    for (let y = 150; y < 260; y++) for (let x = 250; x < 330; x++) data[y * w + x] = 8; // (a pond across the street)
    doc.features = applyFeaturesPatch(doc.features!, {
      upsertStreets: [curve], upsertTrees: [{ id: "w", kind: "wood", points: [[400, 120], [500, 120], [500, 260], [400, 260]] }],
      upsertLand: [cleanLandform({ id: "h", kind: "hill", points: [[100, 120]], height: 40, radius: 70 }, doc.meta.city!) as never],
    });
    const dense = planFrontage(doc, [curve], { character: "dense" }), village = planFrontage(doc, [curve], { character: "village" });
    expect(dense.buildings.length).toBeGreaterThan(village.buildings.length * 2);
    expect(dense.skipped.water + village.skipped.water).toBeGreaterThan(0);
    expect(dense.skipped.wood).toBeGreaterThan(0);
    for (const b of dense.buildings) {
      const [x, y] = [b.points.reduce((s, q) => s + q[0], 0) / 4, b.points.reduce((s, q) => s + q[1], 0) / 4];
      expect(x >= 250 && x < 330 && y >= 150 && y < 260).toBe(false); // (not in the pond)
      expect(pointInPolygon(x, y, [[400, 120], [500, 120], [500, 260], [400, 260]])).toBe(false); // (not in the wood)
      expect(landAt(doc, x, y).slope).toBeLessThanOrEqual(20.5);
    }
  });
});

describe("streets that follow the land", () => {
  it("go round a building in the way and round a hill rather than over it", () => {
    const doc = town();
    doc.features = applyFeaturesPatch(doc.features!, {
      upsertBuildings: [{ id: "big", points: [[280, 150], [320, 150], [320, 250], [280, 250]] }],
    });
    const r = routeStreet(doc, [[100, 200], [500, 200]]);
    if ("error" in r) throw new Error(r.error);
    for (const [x, y] of r.points) expect(x > 281 && x < 319 && y > 151 && y < 249).toBe(false);
    expect(r.length).toBeGreaterThan(400);
    // a hill in the way: the flat way round costs less than the climb
    const hilly = town();
    hilly.features = applyFeaturesPatch(hilly.features!, { upsertLand: [cleanLandform({ id: "h", kind: "hill", points: [[300, 200]], height: 40, radius: 90 }, hilly.meta.city!) as never] });
    const round = routeStreet(hilly, [[100, 200], [500, 200]], { maxGrade: 6 });
    if ("error" in round) throw new Error(round.error);
    expect(round.maxGrade).toBeLessThan(12);
    expect(Math.max(...round.points.map(([x, y]) => (x > 250 && x < 350 ? Math.abs(y - 200) : 0)))).toBeGreaterThan(40);
  });

  it("cross water on a bridge where allowed, and say there is no way when it isn't", () => {
    const doc = town();
    const { w, data } = doc.height;
    for (let y = 0; y < 400; y++) for (let x = 280; x < 320; x++) data[y * w + x] = 8; // (a river from top to bottom)
    const r = routeStreet(doc, [[100, 200], [500, 200]]);
    if ("error" in r) throw new Error(r.error);
    expect(r.crossesWater).toBe(true);
    expect(r.length).toBeLessThan(440); // (straight across, not wandering)
    const no = routeStreet(doc, [[100, 200], [500, 200]], { bridges: false });
    expect("error" in no && no.error).toMatch(/no way/i);
  });
});

describe("checking a city", () => {
  it("finds buildings in water, overlapping, and a grid of stamps", () => {
    const doc = town();
    const { w, data } = doc.height;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) data[y * w + x] = 8;
    const stamps: MapBuilding[] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) stamps.push({ id: `g${i}-${j}`, points: [[200 + i * 12, 200 + j * 12], [206 + i * 12, 200 + j * 12], [206 + i * 12, 208 + j * 12], [200 + i * 12, 208 + j * 12]] });
    doc.features = applyFeaturesPatch(doc.features!, {
      upsertBuildings: [...stamps, { id: "wet", points: [[10, 10], [20, 10], [20, 20], [10, 20]] }, { id: "a", points: [[400, 50], [420, 50], [420, 70], [400, 70]] }, { id: "b", points: [[410, 60], [430, 60], [430, 80], [410, 80]] }],
      upsertStreets: [{ id: "dead", points: [[300, 100], [350, 100]], width: 7, kind: "street" }],
    });
    const r = cityProblems(doc);
    expect(r.in_water.examples.map((e) => e.id)).toEqual(["wet"]);
    expect(r.overlapping.count).toBe(1);
    expect(r.dead_end_main_streets.count).toBe(2);
    expect(r.regularity.looks_stamped).toBe(true);
  });
});
