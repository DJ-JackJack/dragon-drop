// Maps that know about each other (mapLinks.ts) and what is different between two maps (mapDiff.ts).
import { describe, expect, it } from "vitest";
import { type LinkedMap, type MapDoc, createBattleDoc, createDoc, distanceAcross, mapDifferences, mapRectOn, mapTransform, pointOnMap } from "../src/index.ts";

const world: LinkedMap = { id: "w", name: "World", kind: "world", width: 2048, height: 2048, kmPerPx: 4 };
const detail: LinkedMap = { id: "r", name: "Detail", kind: "world", width: 400, height: 320, kmPerPx: 0.5, parent: { id: "w", name: "World", rect: { x: 100, y: 200, w: 50, h: 40 }, factor: 8 } };
const city: LinkedMap = { id: "c", name: "Town", width: 100, height: 80, kmPerPx: 0.01, kind: "city", city: { widthM: 1000, heightM: 800, cellM: 10 }, origin: { id: "w", name: "World", x: 700, y: 700 } };
const scene: LinkedMap = {
  id: "b", name: "Scene", width: 60, height: 40, kmPerPx: 0.001, kind: "battle",
  battle: { squaresX: 30, squaresY: 20, pxPerSquare: 70, feetPerSquare: 5, sub: 2, gridType: "square" }, origin: { id: "c", name: "Town", x: 300, y: 400, unit: "m" },
};
const copy: LinkedMap = { ...world, id: "w2", name: "World after", copiedFrom: { id: "w", name: "World", at: "2026-11-21T00:00:00Z" } };
const maps = new Map([world, detail, city, scene, copy].map((m) => [m.id, m]));

describe("where a point of one map lies on another", () => {
  it("a detail map's area on its world map, and back", () => {
    expect(pointOnMap(detail, world, 0, 0, maps)).toMatchObject({ x: 100, y: 200, inside: true });
    expect(pointOnMap(detail, world, 400, 320, maps)).toMatchObject({ x: 150, y: 240 });
    expect(pointOnMap(world, detail, 125, 220, maps)).toMatchObject({ x: 200, y: 160, inside: true });
    expect(pointOnMap(world, detail, 10, 10, maps)?.inside).toBe(false);
    expect(mapRectOn(detail, world, maps)?.rect).toEqual({ x: 100, y: 200, w: 50, h: 40 });
  });

  it("a battlemap made in a city made on a world map: through both links", () => {
    const onCity = pointOnMap(scene, city, 15, 10, maps)!; // the scene's middle is its spot in the town
    expect(onCity.x).toBeCloseTo(300, 6);
    expect(onCity.y).toBeCloseTo(400, 6);
    const onWorld = pointOnMap(scene, world, 15, 10, maps)!;
    expect(onWorld.x).toBeCloseTo(700 + (300 - 500) / 4000, 6);
    expect(onWorld.y).toBeCloseTo(700, 6);
    expect(onWorld.how).toHaveLength(2);
    // a square is 5 ft: the scene is 30 squares (45.72 m) across in the town
    expect(mapRectOn(scene, city, maps)!.rect.w).toBeCloseTo(30 * 1.524, 6);
  });

  it("distances across maps, in metres", () => {
    // the detail map's top right corner is 50 world px (200 km) east of the world point at its top left
    expect(distanceAcross(world, [100, 200], detail, [400, 0], maps)).toBeCloseTo(200_000, 3);
    // across the scene: 10 squares of 5 ft
    expect(distanceAcross(scene, [0, 0], scene, [10, 0], maps)).toBeCloseTo(15.24, 6);
    expect(distanceAcross(city, [500, 400], scene, [15, 10], maps)).toBeCloseTo(200, 6);
  });

  it("a copy lies exactly over its original; maps made apart are linked only when they are the same kind and size", () => {
    expect(mapTransform(copy, world, maps)).toMatchObject({ f: { s: 1, x: 0, y: 0 }, sameFrame: true });
    const twin: LinkedMap = { ...world, id: "t", name: "Twin" };
    expect(mapTransform(twin, world, new Map([...maps, ["t", twin]]))?.how[0]).toMatch(/same size/);
    const other: LinkedMap = { ...world, id: "o", name: "Other", width: 1024 };
    expect(mapTransform(other, world, new Map([...maps, ["o", other]]))).toBeNull();
  });
});

describe("what is different between two maps", () => {
  const twin = (a: MapDoc): MapDoc => ({ ...a, meta: { ...a.meta }, height: Object.assign(Object.create(Object.getPrototypeOf(a.height)), a.height, { data: a.height.data.slice() }), features: structuredClone(a.features) });

  it("a world map and its changed copy: land raised and drowned, places added, moved and removed", () => {
    const a = createDoc({ id: "a", name: "A", width: 64, height: 64, kmPerPx: 2 });
    a.height.data.fill(100);
    for (let x = 0; x < 64; x++) a.height.data[63 * 64 + x] = -50;
    a.features = { places: [{ id: "p1", name: "Mill", type: "village", x: 10, y: 10 }, { id: "p2", name: "Ford", type: "other", x: 20, y: 20 }], labels: [{ id: "l1", text: "Old Wood", kind: "region", x: 30, y: 30 }] };
    const b = twin(a);
    for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) b.height.data[y * 64 + x] = 400;
    b.height.data[40 * 64 + 40] = -10;
    b.features!.places[0] = { ...b.features!.places[0], x: 12 };
    b.features!.places.push({ id: "p3", name: "Ashfield", type: "ruin", x: 40, y: 41 });
    b.features!.labels = [];
    const d = mapDifferences(a, b);
    expect(d.heights).toMatchObject({ raised: 9, lowered: 1, maxRaiseM: 300, becameSea: 1, becameLand: 0 });
    const places = d.collections.find((c) => c.key === "places")!;
    expect(places).toMatchObject({ added: 1, moved: 1, removed: 0 });
    expect(d.collections.find((c) => c.key === "labels")).toMatchObject({ removed: 1 });
    expect(d.words.join(" ")).toMatch(/9 map pixels raised/);
    expect(d.words.join(" ")).toMatch(/added ruin "Ashfield"/);
    expect(mapDifferences(a, twin(a)).words).toEqual(["The land is the same.", "Nothing on the two maps is different."]);
  });

  it("a farmhouse before and after a fire: floors burnt, a wall gone, a door added", () => {
    const a = createBattleDoc({ id: "f", name: "Farmhouse", squaresX: 10, squaresY: 8, pxPerSquare: 70, feetPerSquare: 5, seed: 1 });
    a.height.data.fill(3); // wood planks
    a.features = { places: [], labels: [], walls: [{ id: "w1", kind: "wall", x1: 0, y1: 0, x2: 10, y2: 0 }, { id: "w2", kind: "wall", x1: 0, y1: 0, x2: 0, y2: 8 }] } as unknown as MapDoc["features"];
    const b = twin(a);
    const sub = a.meta.battle!.sub;
    for (let i = 0; i < 4 * sub * sub; i++) b.height.data[i] = 4; // dirt
    (b.features as unknown as { walls: unknown[] }).walls = [{ id: "w1", kind: "wall", x1: 0, y1: 0, x2: 10, y2: 0 }, { id: "d1", kind: "door", x1: 4, y1: 8, x2: 5, y2: 8 }];
    const d = mapDifferences(a, b);
    expect(d.ground!.changed).toBe(4 * sub * sub);
    expect(d.ground!.top[0]).toMatchObject({ from: "wood planks", to: "dirt" });
    expect(d.collections.find((c) => c.key === "walls")).toMatchObject({ added: 1, removed: 1 });
    expect(d.words.join(" ")).toMatch(/about 4 squares changed/);
  });

  it("refuses two kinds of map", () => {
    const a = createDoc({ id: "a", name: "A", width: 32, height: 32, kmPerPx: 2 });
    const b = createBattleDoc({ id: "b", name: "B", squaresX: 4, squaresY: 4, pxPerSquare: 70, feetPerSquare: 5, seed: 1 });
    expect(() => mapDifferences(a, b)).toThrow(/different kinds/);
  });
});
