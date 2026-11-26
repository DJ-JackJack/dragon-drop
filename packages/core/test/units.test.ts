// Imperial or metric (units.ts): only what is shown changes, so every conversion goes there and back; the words for each kind of map; the ruler's text.
import { describe, expect, it } from "vitest";
import {
  FT_PER_M, MI_PER_KM, cleanUnits, fmtArea, fmtDist, fmtDistBoth, fmtHeight, fmtLen, fmtLenBoth, fmtTable, fromFt, fromKm, fromM, paceFromMi, paceToMi,
  scaleLength, tidy, toFt, toKm, toM, unitsFor,
} from "../src/index.ts";
import { describeRoute, travelEstimates } from "../src/measure.ts";

describe("imperial or metric", () => {
  it("takes the map's own choice over Settings', and anything else as not chosen", () => {
    expect(unitsFor({ units: "metric" }, "imperial")).toBe("metric");
    expect(unitsFor({ units: null }, "metric")).toBe("metric");
    expect(unitsFor({}, "imperial")).toBe("imperial");
    expect(unitsFor(null, "metric")).toBe("metric");
    expect(unitsFor({ units: "furlongs" as never }, "imperial")).toBe("imperial");
    expect(cleanUnits("metric")).toBe("metric");
    expect(cleanUnits("Metric")).toBeUndefined();
  });

  it("converts there and back without drift, for every kind of length", () => {
    for (const u of ["imperial", "metric"] as const) {
      for (const v of [0, 0.3, 1, 5, 24, 1500, 6000]) {
        expect(toKm(fromKm(v, u), u)).toBeCloseTo(v, 9);
        expect(toM(fromM(v, u), u)).toBeCloseTo(v, 9);
        expect(toFt(fromFt(v, u), u)).toBeCloseTo(v, 9);
        expect(paceToMi(paceFromMi(v, u), u)).toBeCloseTo(v, 9);
      }
    }
    expect(fromKm(100, "imperial")).toBeCloseTo(100 * MI_PER_KM, 9);
    expect(fromM(100, "imperial")).toBeCloseTo(100 * FT_PER_M, 9);
  });

  it("says world distances in miles or km, with the other after it", () => {
    expect(fmtDist(200, "imperial")).toBe("124 mi");
    expect(fmtDist(200, "metric")).toBe("200 km");
    expect(fmtDistBoth(200, "imperial")).toBe("124 mi (200 km)");
    expect(fmtDistBoth(200, "metric")).toBe("200 km (124 mi)");
    expect(fmtDist(3.2, "metric")).toBe("3.2 km");
    expect(fmtArea(100, "metric")).toBe("100 km²");
    expect(fmtArea(100, "imperial")).toBe("39 sq mi");
  });

  it("says heights and settlement lengths in feet or metres, long ones in miles or km", () => {
    expect(fmtHeight(1200, "metric")).toBe("1,200 m");
    expect(fmtHeight(1200, "imperial")).toBe("3,937 ft");
    expect(fmtLen(120, "metric")).toBe("120 m");
    expect(fmtLen(120, "imperial")).toBe("394 ft");
    expect(fmtLen(2500, "metric")).toBe("2.5 km");
    expect(fmtLen(2500, "imperial")).toBe("1.6 mi");
    expect(fmtLenBoth(120, "metric")).toBe("120 m (394 ft)");
    expect(fmtLenBoth(120, "imperial")).toBe("394 ft (120 m)");
  });

  it("uses the tabletop's metric on battlemaps: a 5 ft square is 1.5 m", () => {
    expect(fmtTable(5, "metric")).toBe("1.5 m");
    expect(fmtTable(30, "metric")).toBe("9 m");
    expect(fmtTable(35, "imperial")).toBe("35 ft");
    expect(toFt(1.5, "metric")).toBeCloseTo(5, 9);
  });

  it("makes a settlement's scale bar a round length in the chosen units", () => {
    expect(scaleLength(90, "metric")).toEqual({ metres: 50, label: "50 m" });
    const ft = scaleLength(90, "imperial"); // 90 m is 295 ft: a 200 ft bar
    expect(ft.label).toBe("200 ft");
    expect(ft.metres).toBeCloseTo(200 / FT_PER_M, 6);
    expect(scaleLength(4000, "imperial").label).toBe("2 mi");
    expect(scaleLength(4000, "metric").label).toBe("2 km");
  });

  it("rounds for reading", () => {
    expect(tidy(0.456)).toBe("0.46");
    expect(tidy(4.56)).toBe("4.6");
    expect(tidy(1234.5)).toBe("1,235");
  });

  it("writes the ruler's route and travel notes in the chosen units", () => {
    const s = { km: 200, miles: 200 * MI_PER_KM, legsKm: [200], openKm: 150, roughKm: 0, roadKm: 0, waterKm: 50, rough: { forest: 0, jungle: 0, marsh: 0, mountains: 0, steep: 0, ice: 0 },
      riversCrossed: 0, climbM: 800, descentM: 0, highestM: 900, climateKnown: true } as unknown as Parameters<typeof describeRoute>[0];
    expect(describeRoute(s)).toMatch(/^124 mi \(200 km\): 93 mi open, 31 mi over water; climbs 2,625 ft$/);
    expect(describeRoute(s, "metric")).toMatch(/^200 km \(124 mi\): 150 km open, 50 km over water; climbs 800 m$/);
    const foot = (u: "imperial" | "metric") => travelEstimates(s, {}, undefined, u).find((t) => t.mode === "foot")!.note;
    expect(foot("imperial")).toBe("and 31 mi of water to cross by boat");
    expect(foot("metric")).toBe("and 50 km of water to cross by boat");
  });
});
