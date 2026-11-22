// Folder and file names made from names with accents and other letters (store.ts slugify): readable, never empty.
import { describe, expect, it } from "vitest";
import { plainLetters, slugify } from "../src/store.ts";

describe("folder names from map names", () => {
  it("drops accents and spells out the letters that have none", () => {
    expect(slugify("Ährenfeld – Kärtchen")).toBe("ahrenfeld-kartchen");
    expect(slugify("Kellergewölbe – Grüße")).toBe("kellergewolbe-grusse");
    expect(slugify("Nørdheim Café")).toBe("nordheim-cafe");
    expect(slugify("Æsir's Hall")).toBe("aesir-s-hall");
    expect(plainLetters("Łódź")).toBe("lodz");
  });
  it("keeps plain names as they were, and never gives an empty name", () => {
    expect(slugify("Test World")).toBe("test-world");
    expect(slugify("Farmhouse after the fire")).toBe("farmhouse-after-the-fire");
    expect(slugify("地図")).toBe("map");
  });
});
