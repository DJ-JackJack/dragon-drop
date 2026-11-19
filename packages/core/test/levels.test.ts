import { describe, expect, it } from "vitest";
import { DEFAULT_LEVEL_HEIGHT_FT, MAX_LEVELS, cleanLevels, defaultLevels, levelBelow, levelsByHeight, newLevelId, newLevelName, nextLevelElevation } from "../src/index.ts";

describe("battlemap levels", () => {
  it("a map with no list has one level, Ground floor, 0 to 10 ft", () => {
    expect(defaultLevels()).toEqual({ v: 1, active: "level-1", levels: [{ id: "level-1", name: "Ground floor", bottom: 0, top: 10 }] });
  });

  it("reads a good list as it is, and keeps the active level when it exists", () => {
    const raw = { v: 1, active: "cellar", levels: [{ id: "level-1", name: "Hall", bottom: 0, top: 12 }, { id: "cellar", name: "Cellar", bottom: -10, top: 0 }] };
    expect(cleanLevels(raw)).toEqual(raw);
  });

  it("makes a damaged list safe: bad ids, repeated ids, odd numbers and names, an active level that isn't there", () => {
    const got = cleanLevels({
      active: "nope",
      levels: [
        { id: "level-1", name: "  A\u0000B  ", bottom: "x", top: 5 },
        { id: "level-1", name: "again" }, // repeated id
        { id: "../evil", name: "bad id" },
        { id: "up", name: "", bottom: 10, top: 4 }, // top below bottom
        null, 7,
      ],
    })!;
    expect(got.levels.map((l) => l.id)).toEqual(["level-1", "up"]);
    expect(got.levels[0]).toEqual({ id: "level-1", name: "A B", bottom: 0, top: 5 });
    expect(got.levels[1]).toEqual({ id: "up", name: "Level 2", bottom: 10, top: 10 + DEFAULT_LEVEL_HEIGHT_FT });
    expect(got.active).toBe("level-1");
  });

  it("says null when nothing usable is in it", () => {
    for (const raw of [null, 5, [], {}, { levels: [] }, { levels: [{ id: "A B" }] }, "x"]) expect(cleanLevels(raw)).toBeNull();
  });

  it("keeps at most MAX_LEVELS", () => {
    const levels = Array.from({ length: 40 }, (_, i) => ({ id: `l-${i}`, name: `L${i}`, bottom: i * 10, top: i * 10 + 10 }));
    expect(cleanLevels({ levels })!.levels).toHaveLength(MAX_LEVELS);
  });

  it("names and places a new level above the top or below the bottom, with an id and a name nobody has", () => {
    const one = defaultLevels().levels;
    expect(nextLevelElevation(one, "above")).toEqual({ bottom: 10, top: 20 });
    expect(nextLevelElevation(one, "below")).toEqual({ bottom: -10, top: 0 });
    expect(newLevelId(["level-1"])).toBe("level-2");
    expect(newLevelId(["level-1", "level-3"])).toBe("level-4"); // (starts counting at the number of levels plus one, and skips any that exists)
    expect(newLevelId(["level-2", "level-1"])).toBe("level-3");
    expect(newLevelName(one, "below")).toBe("Cellar");
    expect(newLevelName([...one, { id: "level-2", name: "Cellar", bottom: -10, top: 0 }], "below")).toBe("Cellar 2");
    expect(newLevelName(one, "above")).toBe("Upper floor");
  });

  it("orders by height and finds the level below", () => {
    const levels = [{ id: "b", name: "B", bottom: 10, top: 20 }, { id: "a", name: "A", bottom: 0, top: 10 }, { id: "c", name: "C", bottom: -10, top: 0 }];
    expect(levelsByHeight(levels).map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(levelBelow(levels, "b")!.id).toBe("a");
    expect(levelBelow(levels, "c")).toBeNull();
    expect(levelBelow(levels, "zzz")).toBeNull();
  });
});
