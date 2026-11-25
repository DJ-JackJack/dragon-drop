import { describe, expect, it } from "vitest";
import { NAME_SIZE_MAX, NAME_SIZE_MIN, cleanBuilding, cleanDistrict, cleanNameSize, cleanStreet, withNameSize } from "@mapmaker/core";

const spec = { widthM: 500, heightM: 400, cellM: 2 };
const square: [number, number][] = [[10, 10], [30, 10], [30, 30], [10, 30]];

describe("a name's own size", () => {
  it("is a number in range, rounded, and left out when it is the usual 1 or not a number", () => {
    expect(cleanNameSize(1.5)).toBe(1.5);
    expect(cleanNameSize(1.234)).toBe(1.23);
    expect(cleanNameSize(9)).toBe(NAME_SIZE_MAX);
    expect(cleanNameSize(0.01)).toBe(NAME_SIZE_MIN);
    expect(cleanNameSize(1)).toBeUndefined();
    expect(cleanNameSize("2")).toBeUndefined();
    expect(cleanNameSize(Number.NaN)).toBeUndefined();
    expect(withNameSize<{ id: string; nameSize?: number }>({ id: "p", nameSize: 2 }, 1)).toEqual({ id: "p" });
    expect(withNameSize<{ id: string; nameSize?: number }>({ id: "p" }, 1.8)).toEqual({ id: "p", nameSize: 1.8 });
  });

  it("is kept by the settlement's cleaners, but only on something with a name", () => {
    expect(cleanBuilding({ id: "b-1", points: square, name: "The Mint", nameSize: 2 }, spec)).toMatchObject({ name: "The Mint", nameSize: 2 });
    expect(cleanBuilding({ id: "b-1", points: square, nameSize: 2 }, spec)).not.toHaveProperty("nameSize");
    expect(cleanStreet({ id: "t-1", points: [[0, 0], [100, 0]], width: 8, name: "High Street", nameSize: 0.6 }, spec)).toMatchObject({ nameSize: 0.6 });
    expect(cleanStreet({ id: "t-1", points: [[0, 0], [100, 0]], width: 8, nameSize: 0.6 }, spec)).not.toHaveProperty("nameSize");
    expect(cleanDistrict({ id: "r-1", points: square, name: "Old Town", nameSize: 1.4 }, spec)).toMatchObject({ nameSize: 1.4 });
    expect(cleanDistrict({ id: "r-1", points: square, name: "Old Town", nameSize: 1 }, spec)).not.toHaveProperty("nameSize");
  });

  it("a building's name stays GM only through the cleaner", () => {
    expect(cleanBuilding({ id: "b-1", points: square, name: "Safe house", gmOnly: true }, spec)).toMatchObject({ gmOnly: true });
  });
});
