/** cityWorld.ts: a city started from a world-map sample. */
import { describe, expect, it } from "vitest";
import { type WorldSample, cityFromWorld, citySizeForPlace, compass, createCityDoc } from "../src/index.ts";

const base: WorldSample = { x: 0, y: 0, elevM: 120, underwater: false, slope: 0.002, temp: 0.5, moist: 0.4, snow: 0, lake: false };
const city = () => createCityDoc({ id: "c", name: "C", widthM: 800, heightM: 600, cellM: 2 });
const wetShare = (doc: ReturnType<typeof city>, x0: number, y0: number, x1: number, y1: number) => {
  const { w, data } = doc.height, cell = 2;
  let n = 0, t = 0;
  for (let y = Math.floor(y0 / cell); y < y1 / cell; y++) for (let x = Math.floor(x0 / cell); x < x1 / cell; x++) { t++; if (data[y * w + x] === 7 || data[y * w + x] === 8) n++; }
  return n / t;
};

describe("a city from a world map", () => {
  it("takes the climate and height, and stays flat and dry where the world map is", () => {
    const doc = city(), said = cityFromWorld(doc, base, { kmPerPx: 2, seed: 1 });
    expect(doc.meta.city).toMatchObject({ elevation: 120, climate: { temperature: 0.5, moisture: 0.4 } });
    expect(doc.features?.land ?? []).toHaveLength(0);
    expect(wetShare(doc, 0, 0, 800, 600)).toBe(0);
    expect(said.join(" ")).toMatch(/120 m above the sea/);
  });

  it("puts the sea on the coast's side, and a river that runs to it in a valley", () => {
    const doc = city();
    const said = cityFromWorld(doc, { ...base, coast: { dx: 0, dy: 1 }, river: { dx: 0, dy: -1, widthPx: 1.5 } }, { kmPerPx: 2, seed: 3 });
    expect(wetShare(doc, 0, 520, 800, 600)).toBeGreaterThan(0.8); // (the south edge is sea)
    expect(wetShare(doc, 0, 0, 800, 80)).toBeGreaterThan(0); // (the river at the north edge)
    expect(wetShare(doc, 0, 0, 800, 80)).toBeLessThan(0.2);
    expect(doc.features!.land!.map((l) => l.kind).sort()).toEqual(["ridge", "slope"]);
    expect(doc.features!.land!.find((l) => l.kind === "ridge")!.height).toBeLessThan(0);
    expect(said.join(" ")).toMatch(/coast.*south.*river.*toward the south/);
  });

  it("plants woods in wooded country, away from the water, and adds a hill in hilly country", () => {
    const wood = city();
    cityFromWorld(wood, { ...base, moist: 0.75, coast: { dx: 1, dy: 0 } }, { kmPerPx: 2, seed: 5 });
    expect(wood.features!.trees!.length).toBeGreaterThan(0);
    for (const t of wood.features!.trees!) for (const [x] of t.points) expect(x).toBeLessThan(560); // (not on the sea's side)
    const hills = city();
    const said = cityFromWorld(hills, { ...base, slope: 0.09, uphill: { dx: 1, dy: 0 } }, { kmPerPx: 2, seed: 9 });
    expect(hills.features!.land!.some((l) => l.kind === "hill")).toBe(true);
    expect(said.join(" ")).toMatch(/rises about \d+ m toward the east/);
  });

  it("sizes the city by the kind of place, and names directions", () => {
    expect(citySizeForPlace("capital")).toEqual({ widthM: 3000, heightM: 2000 });
    expect(citySizeForPlace("village").widthM).toBeLessThan(citySizeForPlace("town").widthM);
    expect(citySizeForPlace(undefined)).toEqual({ widthM: 1000, heightM: 700 });
    expect([compass(0, -1), compass(1, 0), compass(0, 1), compass(-1, -1)]).toEqual(["north", "east", "south", "north-west"]);
  });
});
