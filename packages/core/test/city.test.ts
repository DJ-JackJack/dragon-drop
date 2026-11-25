import { describe, expect, it } from "vitest";
import {
  CITY_FORMAT, CURRENT_FORMAT, MATERIALS, applyFeaturesPatch, buildingColour, buildingToRoof, cityCells, cityGroundMaterial, citySizeError, citySpec, cleanBuilding, cleanStreet, createCityDoc,
  defaultCellM, describeFeaturesPatch, formatFor, isCity, isWorld, polygonArea, polygonSelfIntersects, rectPolygon, renderCity, streetWidthFor, STREET_SURFACE,
} from "../src/index.ts";

const spec = { widthM: 600, heightM: 400, cellM: 2 };
const city = () => createCityDoc({ id: "town", name: "Town", widthM: 600, heightM: 400 });

describe("making a city", () => {
  it("is a city, not a world map or a battlemap, with a ground of grass", () => {
    const d = city();
    expect(d.meta.kind).toBe("city");
    expect(isCity(d)).toBe(true);
    expect(isWorld(d)).toBe(false);
    expect(citySpec(d)).toEqual({ widthM: 600, heightM: 400, cellM: 1 });
    expect(cityCells(citySpec(d))).toEqual({ w: 600, h: 400 });
    expect(d.height.w).toBe(600);
    expect(d.height.data.every((v) => v === 5)).toBe(true);
    expect(MATERIALS[5].name).toBe("grass");
    expect(d.meta.kmPerPx).toBeCloseTo(0.001);
    expect(d.features?.buildings).toEqual([]);
  });

  it("picks a ground cell size that keeps the grid small", () => {
    expect(defaultCellM(600, 400)).toBe(1);
    expect(defaultCellM(2000, 1400)).toBe(2);
    expect(defaultCellM(6000, 6000)).toBe(4);
    expect(cityCells({ widthM: 2000, heightM: 1400, cellM: 2 })).toEqual({ w: 1000, h: 700 });
  });

  it("refuses sizes that are too small, too big or not numbers", () => {
    expect(citySizeError(600, 400, 1)).toBeNull();
    expect(citySizeError(20, 400, 1)).toMatch(/at least 50/);
    expect(citySizeError(7000, 400, 4)).toMatch(/at most 6000/);
    expect(citySizeError(600, 400, 0.1)).toMatch(/between 0.5 and 32/);
    expect(citySizeError(6000, 6000, 0.5)).toMatch(/ground cells/);
    expect(citySizeError(Number.NaN, 400, 1)).toMatch(/numbers/);
  });

  it("is only an older program's problem: city maps are format 3 (2 before land, trees and climate), everything else stays 1", () => {
    expect(CITY_FORMAT).toBe(3);
    expect(formatFor("city", CURRENT_FORMAT)).toBe(3);
    expect(formatFor("world", CURRENT_FORMAT)).toBe(CURRENT_FORMAT);
    expect(formatFor("battle", 1)).toBe(1);
    expect(formatFor(undefined, 1)).toBe(1);
    expect(formatFor("city", 5)).toBe(5); // (a program whose ordinary format is newer than that writes cities in it too)
    expect(cityGroundMaterial(7)).toBe(7);
    expect(cityGroundMaterial(0)).toBeNull(); // (a city has no void)
    expect(cityGroundMaterial(99)).toBeNull();
  });
});

describe("outlines", () => {
  it("a rectangle turned a quarter swaps its sides about its centre", () => {
    const a = rectPolygon(100, 50, 20, 10, 0), b = rectPolygon(100, 50, 20, 10, 90);
    expect(polygonArea(a)).toBeCloseTo(200);
    expect(polygonArea(b)).toBeCloseTo(200);
    expect(a[0]).toEqual([90, 45]);
    expect(b[0]).toEqual([105, 40]); // (the top-left corner goes to the top-right)
  });

  it("finds a bow-tie", () => {
    expect(polygonSelfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(false);
    expect(polygonSelfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true);
    expect(polygonSelfIntersects([[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]])).toBe(false); // (a notch is fine)
  });
});

describe("checking buildings and streets that come from outside", () => {
  const ok = { id: "b1", points: rectPolygon(100, 100, 10, 8, 20) };

  it("keeps a good building, tidies it and takes what it understands", () => {
    const b = cleanBuilding({ ...ok, name: "  The Fox ", roof: "tile", colour: "AA3322", kind: "tavern", floors: 2.4, junk: 1 }, spec);
    expect(b).toEqual({ id: "b1", points: ok.points, name: "The Fox", roof: "tile", colour: "#aa3322", kind: "tavern", floors: 2 });
    expect(cleanBuilding({ ...ok, roof: "gold", colour: "red", floors: 99 }, spec)).toEqual({ id: "b1", points: ok.points });
  });

  it("refuses what can't be a building of this city, saying why", () => {
    const err = (b: unknown) => (cleanBuilding(b, spec) as { error: string }).error;
    expect(err(null)).toMatch(/not a building/);
    expect(err({ points: ok.points })).toMatch(/needs an id/);
    expect(err({ id: "../x", points: ok.points })).toMatch(/needs an id/);
    expect(err({ id: "b", points: [[0, 0], [1, 1]] })).toMatch(/at least 3 points/);
    expect(err({ id: "b", points: [[0, 0], [1, 1], [Number.NaN, 2]] })).toMatch(/isn't two numbers/);
    expect(err({ id: "b", points: [[0, 0], [700, 0], [700, 10]] })).toMatch(/outside the map, which is 600 x 400/);
    expect(err({ id: "b", points: [[10, 10], [10.5, 10], [10.5, 10.5]] })).toMatch(/smaller than a square metre/);
    expect(err({ id: "b", points: [[0, 0], [600, 0], [600, 300], [0, 300]] })).toMatch(/quarter of the city/);
    expect(err({ id: "b", points: [[10, 10], [60, 60], [60, 10], [10, 60]] })).toMatch(/crosses itself/);
    expect(err({ id: "b", points: new Array(300).fill([5, 5]) })).toMatch(/more than 200/);
  });

  it("streets get the width of their kind, unless one is given", () => {
    expect(streetWidthFor("lane")).toBe(4);
    expect(streetWidthFor(undefined)).toBe(6);
    expect(cleanStreet({ id: "s", points: [[0, 0], [50, 0]], kind: "avenue" }, spec)).toEqual({ id: "s", points: [[0, 0], [50, 0]], width: 12, kind: "avenue" });
    expect(cleanStreet({ id: "s", points: [[0, 0], [50, 0]], width: 3.456, name: "High St" }, spec)).toMatchObject({ width: 3.46, name: "High St" });
    expect((cleanStreet({ id: "s", points: [[0, 0]] }, spec) as { error: string }).error).toMatch(/at least 2 points/);
    expect((cleanStreet({ id: "s", points: [[0, 0], [5, 5]], width: 90 }, spec) as { error: string }).error).toMatch(/between 0.5 and 60/);
  });
});

describe("buildings and streets in the features", () => {
  it("are added, replaced, removed and described", () => {
    const b1 = { id: "b1", points: rectPolygon(50, 50, 8, 8) }, b2 = { id: "b2", points: rectPolygon(80, 50, 8, 8), name: "Mill" };
    let f = applyFeaturesPatch({ places: [], labels: [] }, { upsertBuildings: [b1, b2], upsertStreets: [{ id: "s1", points: [[0, 0], [10, 0]], width: 6 }] });
    expect(f.buildings?.map((b) => b.id)).toEqual(["b1", "b2"]);
    f = applyFeaturesPatch(f, { upsertBuildings: [{ ...b1, roof: "thatch" }], removeBuildings: ["b2"] });
    expect(f.buildings).toEqual([{ ...b1, roof: "thatch" }]);
    expect(f.streets).toHaveLength(1); // (untouched by a patch that doesn't mention streets)
    f = applyFeaturesPatch(f, { removeStreets: ["s1"] });
    expect(f.streets).toEqual([]);
    expect(describeFeaturesPatch({ upsertBuildings: [b1, b2] })).toBe("Edit 2 buildings");
    expect(describeFeaturesPatch({ upsertBuildings: [b2] })).toBe("Edit Mill");
    expect(describeFeaturesPatch({ removeBuildings: ["a", "b", "c"] })).toBe("Edit remove 3 building(s)");
    expect(describeFeaturesPatch({ upsertStreets: [{ id: "s", points: [[0, 0], [1, 1]], width: 4, kind: "lane" }] })).toBe("Edit lane");
  });
});

describe("how a building looks", () => {
  it("has a colour of its look, a little different for each building, and the same each time", () => {
    const a = { id: "a1", points: rectPolygon(10, 10, 5, 5), roof: "tile" as const }, b = { ...a, id: "a2" };
    expect(buildingColour(a)).toEqual(buildingColour(a));
    expect(buildingColour(a)).not.toEqual(buildingColour(b));
    const [r, g] = buildingColour(a);
    expect(r).toBeGreaterThan(g); // (clay is red)
    expect(buildingColour({ ...a, colour: "#102030" })).toEqual([16, 32, 48]);
    expect(buildingToRoof(a)).toMatchObject({ id: "a1", style: "tile" });
    expect(buildingToRoof({ ...a, flat: true }).flat).toBe(true);
  });
});

describe("drawing a city", () => {
  const grassColour = MATERIALS[5].colour;
  const near = (px: Uint8ClampedArray, o: number, c: number[], tol = 14) => [0, 1, 2].every((k) => Math.abs(px[o + k] - c[k]) <= tol);

  it("draws the ground, a street over it and a building over that, where they are", () => {
    const d = city();
    d.height.data.fill(5);
    for (let y = 0; y < 400; y++) for (let x = 300; x < 600; x++) d.height.data[y * 600 + x] = 8; // deep water on the right half
    d.features!.streets = [{ id: "s1", points: [[0, 100], [300, 100]], width: 10 }];
    d.features!.buildings = [{ id: "b1", points: rectPolygon(150, 250, 40, 20), roof: "tile", colour: "#aa3322" }];
    d.meta.city = { ...d.meta.city!, groundLook: { grass: { pattern: "flat" }, "deep water": { pattern: "flat" } } }; // (one colour each, so a spot's colour says which ground is there)
    const { img, px, region } = renderCity(d, { maxSize: 600 });
    expect(px).toBeCloseTo(1);
    expect(region).toEqual({ x: 0, y: 0, w: 600, h: 400 });
    expect([img.w, img.h]).toEqual([600, 400]);
    const at = (x: number, y: number) => (y * img.w + x) * 4;
    expect(near(img.data, at(50, 300), grassColour, 12)).toBe(true); // grass
    expect(near(img.data, at(450, 300), MATERIALS[8].colour, 14)).toBe(true); // water
    expect(near(img.data, at(100, 100), STREET_SURFACE, 4)).toBe(true); // the middle of the street
    expect(near(img.data, at(100, 120), grassColour, 14)).toBe(true); // beside it
    const [r, g, b] = [img.data[at(150, 250)], img.data[at(150, 250) + 1], img.data[at(150, 250) + 2]];
    expect(r).toBeGreaterThan(g + 40); // the roof, red
    expect(b).toBeLessThan(r);
    expect(img.data[at(150, 250) + 3]).toBe(255);
  });

  it("draws a part of the city at its own scale, and skips the buildings it doesn't show", () => {
    const d = city();
    d.features!.buildings = [
      { id: "in", points: rectPolygon(110, 110, 20, 20), colour: "#ff0000", flat: true },
      { id: "out", points: rectPolygon(500, 300, 20, 20), colour: "#ff0000", flat: true },
    ];
    const r = renderCity(d, { region: { x: 100, y: 100, w: 50, h: 50 }, maxSize: 200 });
    expect(r.px).toBeCloseTo(4);
    expect([r.img.w, r.img.h]).toEqual([200, 200]);
    expect(r.region).toEqual({ x: 100, y: 100, w: 50, h: 50 });
    const o = (40 * 200 + 40) * 4; // metre (110, 110)
    expect(r.img.data[o]).toBeGreaterThan(200);
    expect(r.img.data[o + 1]).toBeLessThan(80);
    const none = renderCity(d, { buildings: false, maxSize: 600 });
    expect(none.img.data[(110 * 600 + 110) * 4 + 1]).toBeGreaterThan(80); // grass again
  });

  it("draws a few thousand buildings in a moment", () => {
    const d = city();
    d.features!.buildings = Array.from({ length: 3000 }, (_, i) => ({ id: `b${i}`, points: rectPolygon(10 + (i % 60) * 9.5, 10 + Math.floor(i / 60) * 7.5, 6, 5, (i * 37) % 90), roof: (["slate", "tile", "thatch"] as const)[i % 3] }));
    const t = Date.now();
    renderCity(d, { maxSize: 1200 });
    expect(Date.now() - t).toBeLessThan(8000);
  });
});
