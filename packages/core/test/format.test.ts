import { describe, expect, it } from "vitest";
import { CURRENT_FORMAT, type MapMigration, NewerFormatError, createDoc, formatOf, migrateMap } from "../src/index.ts";

const doc = () => createDoc({ id: "t", name: "Test", width: 64, height: 64, kmPerPx: 1 });

describe("map format version", () => {
  it("reads a missing, wrong or silly version as 1, the format every map had before there was a version", () => {
    expect(formatOf(undefined)).toBe(1);
    expect(formatOf({})).toBe(1);
    expect(formatOf({ formatVersion: 1 })).toBe(1);
    expect(formatOf({ formatVersion: 4 })).toBe(4);
    for (const bad of ["2", 0, -3, 1.5, NaN, null, {}]) expect(formatOf({ formatVersion: bad })).toBe(1);
  });

  it("is at least 1", () => {
    expect(CURRENT_FORMAT).toBeGreaterThanOrEqual(1);
  });

  it("brings a map up one step at a time, in order, and marks it with the version it ends on", () => {
    const seen: string[] = [];
    const steps: Record<number, MapMigration> = {
      1: (d) => { seen.push("1->2"); d.meta.notes = "two"; },
      2: (d) => { seen.push(`2->3 (saw ${d.meta.notes})`); },
    };
    const d = doc();
    expect(migrateMap(d, 1, 3, steps)).toBe(2);
    expect(seen).toEqual(["1->2", "2->3 (saw two)"]);
    expect(d.meta.formatVersion).toBe(3);
  });

  it("runs nothing for a map that is already current", () => {
    const d = doc();
    expect(migrateMap(d, 2, 2, {})).toBe(0);
    expect(d.meta.formatVersion).toBe(2);
  });

  it("refuses to skip a step it doesn't have", () => {
    expect(() => migrateMap(doc(), 1, 3, { 1: () => {} })).toThrow(/format 2 to 3/);
  });

  it("tells the person to update the program, and says the map was left alone", () => {
    const e = new NewerFormatError(5, 2, "Old World");
    expect(e.message).toContain('"Old World"');
    expect(e.message).toContain("format 5");
    expect(e.message).toContain("up to 2");
    expect(e.message).toMatch(/Update Dragon Drop/);
    expect(e.message).toMatch(/left exactly as it is/);
    expect(e).toMatchObject({ found: 5, known: 2 });
  });
});
