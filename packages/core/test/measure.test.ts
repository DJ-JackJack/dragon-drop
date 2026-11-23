/** The ruler: a route's length, the ground it crosses on a world map, and the days it takes (core measure.ts). */
import { describe, expect, it } from "vitest";
import type { Derived } from "../src/climate.ts";
import { HeightField, type MapDoc } from "../src/doc.ts";
import { battleRoute, cityRoute, describeRoute, describeTime, surveyRoute, travelEstimates } from "../src/measure.ts";

const W = 200, H = 100;
/** A world map: flat land 300 m up, 2 km a pixel, with what each test adds. */
function world(o: { height?: (x: number, y: number) => number; roads?: [number, number][][] } = {}): MapDoc {
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = o.height ? o.height(x, y) : 300;
  return {
    meta: { id: "w", name: "W", width: W, height: H, kmPerPx: 2, seaLevel: 0 },
    height: new HeightField(W, H, data),
    features: { places: [], labels: [], lines: (o.roads ?? []).map((points, i) => ({ id: `r${i}`, kind: "road", points })) },
  } as unknown as MapDoc;
}
/** The climate: cool to mild and dry (open steppe) unless `forest` says where it is mild and wet (mixed forest). */
function climate(o: { forest?: (x: number) => boolean; rivers?: number[][] } = {}): Derived {
  const temp = new Uint8Array(W * H).fill(Math.round(0.4 * 255)), moist = new Uint8Array(W * H).fill(Math.round(0.3 * 255));
  if (o.forest) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (o.forest(x)) moist[y * W + x] = Math.round(0.75 * 255);
  return {
    W, H, seq: 0, temp, moist, seaDist: new Uint8Array(W * H), landDist: new Uint8Array(W * H).fill(255), lakes: new Uint8Array(W * H), snow: new Uint8Array(W * H),
    rivers: (o.rivers ?? []).map((pts) => ({ pts })),
  } as unknown as Derived;
}
const across: [number, number][] = [[10, 50], [110, 50]]; // 100 px = 200 km = 124.3 mi
const foot = (s: ReturnType<typeof surveyRoute>) => travelEstimates(s).find((t) => t.mode === "foot")!;

describe("the ruler on a world map", () => {
  it("measures open ground and gives a day's walk of 24 miles", () => {
    const s = surveyRoute(world(), climate(), across);
    expect(s.km).toBeCloseTo(200);
    expect(s.miles).toBeCloseTo(124.27, 1);
    expect(s.openKm).toBeCloseTo(200);
    expect(s.roughKm).toBe(0);
    expect(foot(s).days).toBeCloseTo(124.27 / 24, 2);
    expect(foot(s).time).toBe("about 5 days");
    expect(travelEstimates(s, { foot: 31.07 }).find((t) => t.mode === "foot")!.time).toBe("about 4 days"); // (the DM's own pace)
    expect(describeRoute(s)).toMatch(/^124 mi \(200 km\): 124 mi open$/);
  });

  it("counts forest as rough ground that halves the pace, unless a road runs through it", () => {
    const forest = (x: number) => x >= 60;
    const s = surveyRoute(world(), climate({ forest }), across);
    expect(s.rough.forest).toBeCloseTo(100, 0);
    expect(s.openKm).toBeCloseTo(100, 0);
    expect(foot(s).days).toBeCloseTo((62.14 + 62.14 * 2) / 24, 1);
    const road = surveyRoute(world({ roads: [[[55, 50], [115, 50]]] }), climate({ forest }), across);
    expect(road.roadKm).toBeGreaterThan(110);
    expect(road.rough.forest).toBe(0);
    expect(describeRoute(road)).toMatch(/along roads/);
    // very wet flat lowland is marsh, also rough
    const marsh = surveyRoute(world({ height: () => 50 }), climate({ forest: () => true }), across);
    expect(marsh.rough.forest + marsh.rough.marsh).toBeCloseTo(200, 0);
    // without the climate only height and slope count: the forest isn't known
    expect(surveyRoute(world(), null, across)).toMatchObject({ roughKm: 0, climateKnown: false });
  });

  it("finds steep slopes and mountains, and how far the route climbs", () => {
    // a ramp of 300 m a pixel (150 m a km) in the middle, then high ground 2,500 m up
    const s = surveyRoute(world({ height: (x) => (x < 50 ? 100 : x < 58 ? 100 + (x - 50) * 300 : 2500) }), climate(), across);
    expect(s.rough.steep).toBeGreaterThan(10);
    expect(s.rough.mountains).toBeGreaterThan(100);
    expect(s.climbM).toBeGreaterThan(2300);
    expect(s.highestM).toBeCloseTo(2500, 0);
  });

  it("knows water from land: a walker needs a boat for it, a ship can't sail the land", () => {
    const s = surveyRoute(world({ height: (x) => (x < 60 ? 100 : -50) }), climate(), across);
    expect(Math.abs(s.waterKm - 100)).toBeLessThan(2); // (the shore falls between samples)
    expect(foot(s).note).toMatch(/6\d mi of water to cross by boat/);
    const ship = travelEstimates(s).find((t) => t.mode === "ship")!;
    expect(ship.days).toBeCloseTo(62.14 / 72, 1);
    expect(ship.note).toMatch(/over land, which a ship can't sail/);
    expect(ship.time).toMatch(/hours/);
  });

  it("counts each river crossed once, however often", () => {
    const zig = [[40, 0, 40, 100], [80, 0, 80, 40, 20, 60, 90, 99]]; // one straight across, one crossing the route twice
    expect(surveyRoute(world(), climate({ rivers: zig }), across).riversCrossed).toBe(2);
    expect(describeRoute(surveyRoute(world(), climate({ rivers: zig }), across))).toMatch(/crosses 2 rivers/);
  });
});

describe("times and other maps", () => {
  it("says a time in hours under a day, half days up to ten", () => {
    expect(describeTime(0.3, 8)).toBe("about 2½ hours");
    expect(describeTime(0.05, 8)).toBe("about 25 minutes");
    expect(describeTime(1, 8)).toBe("about 1 day");
    expect(describeTime(3.4, 8)).toBe("about 3½ days");
    expect(describeTime(12.4, 8)).toBe("about 12 days");
  });

  it("measures battlemaps in feet and squares, and settlements in metres and minutes on foot", () => {
    expect(battleRoute([[0, 0], [3, 4]], 5)).toEqual({ feet: 25, squares: 5 });
    const c = cityRoute([[0, 0], [300, 400]]);
    expect(c.metres).toBe(500);
    expect(c.walkMinutes).toBeCloseTo(6);
  });
});
