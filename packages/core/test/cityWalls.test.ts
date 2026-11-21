/** City walls: the towers and gates worked out from a wall and the streets, the stretches between, the checks, and the planner keeping houses off them. */
import { describe, expect, it } from "vitest";
import {
  type MapCityWall, type MapStreet, CitySpace, applyFeaturesPatch, cityProblems, cleanCityWall, createCityDoc, distToWall, emptyFeatures, isWaterAt, planFrontage, renderCity, wallPieces,
} from "../src/index.ts";

const ring: MapCityWall = { id: "w1", points: [[100, 100], [300, 100], [300, 300], [100, 300]], closed: true };
const street: MapStreet = { id: "s1", points: [[0, 200], [400, 200]], width: 7, kind: "street" };
const lane: MapStreet = { id: "s2", points: [[200, 0], [200, 400]], width: 4, kind: "lane" };

describe("city walls", () => {
  it("has a gate wherever a street crosses: a gatehouse for a street, an opening for a lane", () => {
    const p = wallPieces(ring, [street, lane]);
    expect(p.gates).toHaveLength(4);
    expect(p.gates.filter((g) => g.streetId === "s1").every((g) => g.gatehouse)).toBe(true);
    expect(p.gates.filter((g) => g.streetId === "s2").every((g) => !g.gatehouse)).toBe(true);
    // the street's gates are on the left and right sides, where it crosses
    const xs = p.gates.filter((g) => g.streetId === "s1").map((g) => Math.round(g.x)).sort((a, b) => a - b);
    expect(xs).toEqual([100, 300]);
    // a ring with four gates is four stretches of wall, none crossing a street
    expect(p.stretches).toHaveLength(4);
    for (const s of p.stretches) for (const [x, y] of s.points) expect(Math.abs(y - 200) > 3 || Math.abs(x - 200) > 2).toBe(true);
    expect(p.length).toBe(800);
  });

  it("puts towers at the corners and about every 40 m on stone, never in a gate, and a pair at each gatehouse", () => {
    const p = wallPieces(ring, [street]);
    const plain = p.towers.filter((t) => !t.gate), gate = p.towers.filter((t) => t.gate);
    for (const [x, y] of ring.points) expect(plain.some((t) => Math.hypot(t.x - x, t.y - y) < 0.5)).toBe(true);
    expect(plain.length).toBeGreaterThanOrEqual(16);
    expect(plain.length).toBeLessThanOrEqual(22);
    expect(gate).toHaveLength(4);
    for (const g of p.gates) for (const t of plain) expect(Math.hypot(t.x - g.x, t.y - g.y)).toBeGreaterThan(g.width / 2 + t.r);
    expect(plain.every((t) => !t.square)).toBe(true);
  });

  it("follows the kind: a palisade's towers are square, an earth rampart has none, 0 means none", () => {
    expect(wallPieces({ ...ring, kind: "palisade" }, []).towers.every((t) => t.square)).toBe(true);
    expect(wallPieces({ ...ring, kind: "earth" }, [street]).towers).toHaveLength(0); // (and a plain opening: no gatehouse on a rampart)
    expect(wallPieces({ ...ring, kind: "earth" }, [street]).gates.every((g) => !g.gatehouse)).toBe(true);
    expect(wallPieces({ ...ring, towers: 0 }, [street]).towers.filter((t) => !t.gate)).toHaveLength(0);
    expect(wallPieces({ ...ring, kind: "palisade" }, []).thickness).toBe(1.2);
  });

  it("an open wall has towers at its ends and a gate where a street crosses it", () => {
    const w: MapCityWall = { id: "w2", points: [[50, 50], [350, 50]] };
    const p = wallPieces(w, [lane]);
    expect(p.closed).toBe(false);
    expect(p.towers.some((t) => Math.hypot(t.x - 50, t.y - 50) < 0.5)).toBe(true);
    expect(p.towers.some((t) => Math.hypot(t.x - 350, t.y - 50) < 0.5)).toBe(true);
    expect(p.gates).toHaveLength(1);
    expect(p.stretches).toHaveLength(2);
    expect(p.stretches[0].points[p.stretches[0].points.length - 1][0]).toBeLessThan(198);
    expect(p.stretches[1].points[0][0]).toBeGreaterThan(202);
  });

  it("a gate across the ring's starting corner still splits it cleanly", () => {
    const corner: MapStreet = { id: "s3", points: [[60, 140], [140, 60]], width: 7, kind: "street" };
    const p = wallPieces(ring, [corner]);
    expect(p.gates).toHaveLength(1); // (crossing two sides at the corner: one gate)
    expect(p.stretches).toHaveLength(1);
    const s = p.stretches[0].points;
    expect(Math.hypot(s[0][0] - 100, s[0][1] - 100)).toBeGreaterThan(3);
    expect(Math.hypot(s[s.length - 1][0] - 100, s[s.length - 1][1] - 100)).toBeGreaterThan(3);
  });

  it("has a water gate where it crosses a river: an opening from bank to bank, a tower on each bank, none in the water", () => {
    const doc = createCityDoc({ id: "r", name: "R", widthM: 400, heightM: 400 });
    const { w, h, data } = doc.height, cell = doc.meta.city!.cellM;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs((x + 0.5) * cell - 200) < 10) data[y * w + x] = 8; // (a river 20 m wide down the middle)
    const water = { ground: doc.height, cellM: cell };
    const p = wallPieces(ring, [], water);
    const wg = p.gates.filter((g) => g.water);
    expect(wg).toHaveLength(2); // (the river crosses the top and the bottom of the ring)
    for (const g of wg) {
      expect(g.width).toBeGreaterThanOrEqual(19);
      expect(g.width).toBeLessThan(24);
      expect(Math.abs(g.x - 200)).toBeLessThan(1);
      expect(g.streetId).toBeUndefined();
    }
    expect(p.towers.filter((t) => t.gate)).toHaveLength(4);
    expect(p.towers.filter((t) => !t.gate).some((t) => isWaterAt(doc.height, cell, t.x, t.y))).toBe(false);
    for (const s of p.stretches) for (const [x, y] of s.points) expect(isWaterAt(doc.height, cell, x, y)).toBe(false);
    // without the ground there are no water gates; an earth rampart's has no towers
    expect(wallPieces(ring, []).gates).toHaveLength(0);
    expect(wallPieces({ ...ring, kind: "earth" }, [], water).towers).toHaveLength(0);
    // drawn with its portcullis: dark iron across the water
    doc.features = { ...doc.features!, cityWalls: [{ ...ring, towers: 0 }] };
    const r = renderCity(doc, { maxSize: 400 });
    const px = (x: number, y: number) => Array.from(r.img.data.slice((y * r.img.w + x) * 4, (y * r.img.w + x) * 4 + 3));
    expect(Math.max(...px(200, 100))).toBeLessThan(90);
  });

  it("is checked when it comes from outside", () => {
    const spec = { widthM: 400, heightM: 400, cellM: 2 };
    expect(cleanCityWall({ id: "a", points: [[0, 0], [10, 10]] }, spec)).toEqual({ id: "a", points: [[0, 0], [10, 10]] });
    expect("error" in cleanCityWall({ id: "a", points: [[0, 0], [10, 10]], closed: true }, spec)).toBe(true);
    expect("error" in cleanCityWall({ id: "a", points: [[0, 0], [500, 10]] }, spec)).toBe(true);
    expect("error" in cleanCityWall({ id: "a", points: [[0, 0], [10, 10]], kind: "glass" }, spec)).toBe(true);
    expect("error" in cleanCityWall({ id: "a", points: [[0, 0], [10, 10]], towers: 3 }, spec)).toBe(true);
    expect(cleanCityWall({ id: "a", points: [[0, 0], [10, 10]], towers: 0, kind: "earth", name: " The Old Wall " }, spec)).toMatchObject({ towers: 0, kind: "earth", name: "The Old Wall" });
    expect(distToWall(200, 100, ring)).toBe(0);
    expect(distToWall(100, 200, ring)).toBe(0); // (the closing side counts)
    expect(distToWall(100, 200, { ...ring, closed: false })).toBe(100); // (an open wall through the same points has no closing side)
  });

  it("is kept in the features, and the planner and the checker know it", () => {
    let f = applyFeaturesPatch(emptyFeatures(), { upsertCityWalls: [ring], upsertStreets: [street] });
    expect(f.cityWalls).toHaveLength(1);
    f = applyFeaturesPatch(f, { upsertBuildings: [{ id: "b", points: [[10, 10], [20, 10], [20, 20], [10, 20]] }] });
    expect(f.cityWalls).toHaveLength(1); // (an edit that doesn't touch the walls keeps them)
    const doc = createCityDoc({ id: "c", name: "C", widthM: 400, heightM: 400 });
    doc.features = { ...doc.features!, streets: [street], cityWalls: [ring] };
    const space = new CitySpace(doc);
    expect(space.onWall([[99, 150], [101, 150], [101, 152], [99, 152]])).toBe(true);
    expect(space.onWall([[150, 150], [156, 150], [156, 158], [150, 158]])).toBe(false);
    // houses along the street stay off the wall and out of its gates
    const plan = planFrontage(doc, [street], { character: "dense" });
    expect(plan.skipped.wall).toBeGreaterThan(0);
    doc.features = { ...doc.features, buildings: plan.buildings.map((b, i) => ({ id: `b${i}`, points: b.points })) };
    const r = cityProblems(doc);
    expect(r.on_walls.count).toBe(0);
    expect(r.walls).toMatchObject({ count: 1, gates: 2 });
    expect(r.walls.rings_without_gate).toHaveLength(0);
    // a ring no street crosses is a town with no way in
    doc.features = { ...doc.features, streets: [] };
    expect(cityProblems(doc).walls.rings_without_gate).toHaveLength(1);
    // a house on the wall is reported
    doc.features = { ...doc.features, buildings: [{ id: "x", points: [[95, 150], [105, 150], [105, 160], [95, 160]] }] };
    expect(cityProblems(doc).on_walls.count).toBe(1);
  });

  it("is drawn: the wall's stone where it runs, the street showing through its gate", () => {
    const doc = createCityDoc({ id: "c", name: "C", widthM: 400, heightM: 400 });
    doc.features = { ...doc.features!, streets: [street], cityWalls: [{ ...ring, towers: 0 }] };
    const r = renderCity(doc, { maxSize: 400 }); // (1 px a metre)
    const at = (x: number, y: number) => Array.from(r.img.data.slice((y * r.img.w + x) * 4, (y * r.img.w + x) * 4 + 3));
    const grey = (c: number[]) => Math.max(...c) - Math.min(...c) < 30 && c[0] > 140;
    expect(grey(at(200, 100))).toBe(true); // (the top side: stone)
    expect(grey(at(200, 150))).toBe(false); // (inside: grass)
    const gate = at(100, 200); // (the street through the left gate: the street's sandy colour, not stone)
    expect(gate[0] - gate[2]).toBeGreaterThan(20);
  });
});
