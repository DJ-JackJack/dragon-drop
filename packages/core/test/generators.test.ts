import { describe, expect, it } from "vitest";
import { cleanGenerateRequest, createBattleDoc, createCityDoc, generateDungeon, generateVillage } from "../src/index.ts";

const battle = (w = 40, h = 30) => createBattleDoc({ id: "b", name: "Deep", squaresX: w, squaresY: h });

describe("the dungeon generator", () => {
  it("makes rooms joined by corridors, walls round them, doors in the entrances and torches; the same seed makes the same dungeon", () => {
    const doc = battle();
    const a = generateDungeon(doc, { style: "dungeon", seed: 42 });
    if ("error" in a) throw new Error(a.error);
    expect(a.summary).toMatch(/^a dungeon of \d+ rooms joined by corridors/);
    expect(a.walls.some((w) => w.kind === "wall" && w.closed)).toBe(true);
    expect(a.walls.some((w) => w.kind === "door" || w.kind === "secret")).toBe(true);
    expect(a.lights.length).toBeGreaterThan(0);
    const floored = a.data.filter((v) => v !== 0).length;
    expect(floored / a.data.length).toBeGreaterThan(0.1);
    // a square's margin is left all round (walls need it)
    const sub = doc.meta.battle!.sub, W = 40 * sub;
    for (let x = 0; x < W; x++) expect(a.data[x]).toBe(0);
    // every door spans exactly one square, along a grid line
    for (const d of a.walls.filter((w) => w.kind !== "wall")) {
      const [[x0, y0], [x1, y1]] = d.points;
      expect(Math.abs(x1 - x0) + Math.abs(y1 - y0)).toBe(1);
      expect([x0, y0, x1, y1].every(Number.isInteger)).toBe(true);
    }
    const b = generateDungeon(doc, { style: "dungeon", seed: 42 });
    if ("error" in b) throw new Error(b.error);
    expect(b.data).toEqual(a.data);
    expect(b.walls).toEqual(a.walls);
    const c = generateDungeon(doc, { style: "dungeon", seed: 43 });
    if ("error" in c) throw new Error(c.error);
    expect(c.data).not.toEqual(a.data);
    // no doors and no torches when asked; more rooms when large
    const plain = generateDungeon(doc, { style: "dungeon", seed: 42, doors: false, torches: false });
    if ("error" in plain) throw new Error(plain.error);
    expect(plain.walls.every((w) => w.kind === "wall")).toBe(true);
    expect(plain.lights).toHaveLength(0);
    const rooms = (s: string) => Number(/of (\d+) rooms/.exec(s)?.[1]);
    const small = generateDungeon(battle(60, 60), { style: "dungeon", size: "small", seed: 1 }), large = generateDungeon(battle(60, 60), { style: "dungeon", size: "large", seed: 1 });
    if ("error" in small || "error" in large) throw new Error("no dungeon");
    expect(rooms(large.summary)).toBeGreaterThan(rooms(small.summary));
  });

  it("makes one connected cave with rock walls, and refuses a map that is too small or not a battlemap", () => {
    const doc = battle();
    const g = generateDungeon(doc, { style: "cave", seed: 7 });
    if ("error" in g) throw new Error(g.error);
    expect(g.summary).toMatch(/^a cave of about \d+ squares of floor/);
    expect(g.walls.length).toBeGreaterThan(0);
    expect(g.walls.every((w) => w.look === "rock" && w.closed)).toBe(true);
    expect(g.lights).toHaveLength(0);
    const mats = new Set(g.data);
    expect(mats.has(13)).toBe(true); // rock floor
    expect(generateDungeon(battle(8, 8), { style: "cave" })).toEqual({ error: expect.stringMatching(/at least 10 x 10/) });
    expect(generateDungeon(createCityDoc({ id: "c", name: "C", widthM: 400, heightM: 300 }), { style: "dungeon" })).toEqual({ error: expect.stringMatching(/battlemaps/) });
  });
});

describe("the village generator", () => {
  it("lays a road across the map with lanes and cottages, an inn and a temple near the middle; the same seed, the same village", () => {
    const doc = createCityDoc({ id: "v", name: "Vale", widthM: 900, heightM: 700 });
    const v = generateVillage(doc, { size: "village", seed: 3 });
    if ("error" in v) throw new Error(v.error);
    expect(v.streets[0]).toMatchObject({ kind: "street", width: 6 });
    expect(v.streets.length).toBeGreaterThanOrEqual(2);
    expect(v.buildings.length).toBeGreaterThan(20);
    expect(v.buildings.filter((b) => b.kind === "inn")).toHaveLength(1);
    expect(v.buildings.filter((b) => b.kind === "temple")).toHaveLength(1);
    expect(v.summary).toMatch(/with an inn and a temple near the middle/);
    const again = generateVillage(doc, { size: "village", seed: 3 });
    if ("error" in again) throw new Error(again.error);
    expect(again.buildings).toEqual(v.buildings);
    const hamlet = generateVillage(doc, { size: "hamlet", seed: 3 });
    if ("error" in hamlet) throw new Error(hamlet.error);
    expect(hamlet.buildings.length).toBeLessThan(v.buildings.length);
    expect(generateVillage(createCityDoc({ id: "s", name: "S", widthM: 100, heightM: 100 }))).toEqual({ error: expect.stringMatching(/at least 150 m/) });
  });

  it("checks a request from an editor", () => {
    expect(cleanGenerateRequest({ what: "cave", size: "huge", seed: -5.4, doors: "yes" })).toEqual({ what: "cave", seed: 5 });
    expect(cleanGenerateRequest({ what: "village", size: "large" })).toEqual({ what: "village", size: "large" });
    expect(cleanGenerateRequest({ what: "castle" })).toBeNull();
    expect(cleanGenerateRequest(null)).toBeNull();
  });
});
