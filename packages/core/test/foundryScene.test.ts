import { describe, expect, it } from "vitest";
import { FOUNDRY_CORE_VERSION, type FoundryLevelInput, type MapLight, type MapWall, foundryId, foundryScene } from "../src/index.ts";

const wall = (id: string, kind: MapWall["kind"], pts: [number, number][], extra: Partial<MapWall> = {}): MapWall => ({ id, kind, points: pts, ...extra });
const light = (id: string, x: number, y: number, extra: Partial<MapLight> = {}): MapLight => ({ id, x, y, radius: 6, ...extra });

function twoLevels(): FoundryLevelInput[] {
  return [
    { name: "Cellar", bottom: -10, top: 0, image: "maps/cellar.png", walls: [wall("w1", "wall", [[1, 1], [9, 1], [9, 6], [1, 6]], { closed: true })], lights: [light("l1", 5, 3, { colour: "#ff8800" })] },
    { name: "Ground floor", bottom: 0, top: 10, image: "maps/ground.png", foreground: "maps/roof.png", walls: [wall("w2", "door", [[4, 1], [5, 1]], { locked: true }), wall("w3", "window", [[9, 2], [9, 3]])], lights: [light("l2", 3, 3)] },
  ];
}
const input = (extra = {}) => ({ name: "Test house", width: 700, height: 490, pxPerSquare: 70, feetPerSquare: 5, gridType: "square" as const, levels: twoLevels(), ...extra });

describe("Foundry document ids", () => {
  it("are 16 letters and digits, the same every time and different for different seeds", () => {
    const a = foundryId("level:0:Cellar");
    expect(a).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(foundryId("level:0:Cellar")).toBe(a);
    const many = new Set(Array.from({ length: 500 }, (_, i) => foundryId(`wall:${i}`)));
    expect(many.size).toBe(500);
  });
});

describe("a Foundry v14 scene with levels", () => {
  it("says which Foundry build it is from: without it Foundry drops the levels (tried in a real Foundry, 14.367)", () => {
    const s = foundryScene(input());
    expect(s._stats).toEqual({ coreVersion: FOUNDRY_CORE_VERSION });
    // at least 14.353 (older runs the migration that replaces the levels) and not newer than the build it was tried on (a newer one is refused as "from the future")
    const [major, build] = FOUNDRY_CORE_VERSION.split(".").map(Number);
    expect(major).toBe(14);
    expect(build).toBeGreaterThanOrEqual(353);
    expect(build).toBeLessThanOrEqual(367);
  });

  it("has the levels in order, each with its elevation range and picture, and starts on the first", () => {
    const s = foundryScene(input());
    expect("background" in s).toBe(false); // (a v14 scene has no picture of its own: its levels do)
    expect(s.levels.map((l) => l.name)).toEqual(["Cellar", "Ground floor"]);
    expect(s.levels.map((l) => l.elevation)).toEqual([{ bottom: -10, top: 0 }, { bottom: 0, top: 10 }]);
    expect(s.levels.map((l) => l.background.src)).toEqual(["maps/cellar.png", "maps/ground.png"]);
    expect(s.levels.map((l) => l.foreground.src)).toEqual([null, "maps/roof.png"]);
    expect(s.levels[0].sort).toBeLessThan(s.levels[1].sort);
    expect(new Set(s.levels.map((l) => l._id)).size).toBe(2);
    for (const l of s.levels) expect(l._id).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(s.initialLevel).toBe(s.levels[0]._id);
    expect(s).toMatchObject({ width: 700, height: 490, grid: { type: 1, size: 70, distance: 5, units: "ft" } });
  });

  it("tags every wall and light with its own level, puts a light at the floor of its level, and scales squares to pixels", () => {
    const s = foundryScene(input());
    const [cellar, ground] = s.levels.map((l) => l._id);
    const walls = s.walls as { c: number[]; levels: string[]; door: number; ds: number; sight: number; light: number }[];
    expect(walls).toHaveLength(4 + 1 + 1); // a closed room is four pieces
    expect(walls.filter((w) => w.levels[0] === cellar)).toHaveLength(4);
    expect(walls.filter((w) => w.levels[0] === ground)).toHaveLength(2);
    for (const w of walls) expect(w.levels).toHaveLength(1);
    expect(walls[0].c).toEqual([70, 70, 630, 70]);
    expect(walls.find((w) => w.door === 1)).toMatchObject({ c: [280, 70, 350, 70], ds: 2, levels: [ground] }); // (a locked door)
    expect(walls.find((w) => w.c[0] === 630 && w.c[1] === 140)).toMatchObject({ sight: 0, light: 0 }); // (a window lets sight and light through)
    const lights = s.lights as { x: number; y: number; elevation: number; levels: string[]; config: { dim: number; bright: number; color: string } }[];
    expect(lights).toHaveLength(2);
    expect(lights[0]).toMatchObject({ x: 350, y: 210, elevation: -10, levels: [cellar], config: { dim: 30, bright: 15, color: "#ff8800" } });
    expect(lights[1]).toMatchObject({ elevation: 0, levels: [ground] });
  });

  it("is the same every time it is made, and survives a trip through JSON", () => {
    const a = foundryScene(input()), b = foundryScene(input());
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("darkens the scene when the map is dim (and not when it is bright)", () => {
    expect(foundryScene(input({ ambient: 0.25 }))).toMatchObject({ environment: { darknessLevel: 0.75 } });
    expect("environment" in foundryScene(input())).toBe(false);
    expect("darkness" in foundryScene(input({ ambient: 0.25 }))).toBe(false); // (Foundry v14 drops the old top-level key)
  });

  it("refuses a level whose bottom is not below its top, and a scene with no levels", () => {
    expect(() => foundryScene(input({ levels: [{ ...twoLevels()[0], bottom: 5, top: 5 }] }))).toThrow(/below its top/);
    expect(() => foundryScene(input({ levels: [] }))).toThrow(/at least one level/);
  });

  it("leaves the stairs out unless asked, and then writes one Change Level region tagged with both levels", () => {
    const stairs = [{ name: "Cellar stairs", between: [0, 1] as [number, number], x: 7, y: 2, w: 1, h: 2 }];
    expect(foundryScene(input({ stairs })).regions).toEqual([]);
    const s = foundryScene(input({ stairs }), { stairs: true });
    expect(s.regions).toHaveLength(1);
    const r = s.regions[0] as { levels: string[]; shapes: { x: number; y: number; width: number; height: number }[]; elevation: { bottom: number; top: number }; behaviors: { type: string }[] };
    expect(r.levels).toEqual(s.levels.map((l) => l._id));
    expect(r.shapes[0]).toMatchObject({ x: 490, y: 140, width: 70, height: 140 });
    expect(r.elevation).toEqual({ bottom: -10, top: 10, topInclusive: false });
    expect(r.behaviors.map((b) => b.type)).toEqual(["changeLevel"]);
    // the shape Foundry itself stores for a stair: no kinds of movement listed (all allowed), the top of the range not inclusive
    expect(r.behaviors[0]).toMatchObject({ system: { movementActions: [] }, disabled: false });
  });
});
