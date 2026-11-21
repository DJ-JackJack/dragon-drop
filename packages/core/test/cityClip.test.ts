/** Copy and paste on a city map: everything moves together with new ids, held inside the city; buildings, streets and walls lose their names, labels keep their text. */
import { describe, expect, it } from "vitest";
import { type Features, applyFeaturesPatch, cityClipBounds, copyCity, emptyFeatures, pasteCity } from "../src/index.ts";

const f: Features = {
  ...emptyFeatures(),
  buildings: [{ id: "b1", name: "The Green Dragon", points: [[10, 10], [20, 10], [20, 18], [10, 18]], roof: "thatch", kind: "tavern" }, { id: "b2", points: [[30, 10], [36, 10], [36, 18], [30, 18]] }],
  streets: [{ id: "s1", name: "Mill Lane", points: [[0, 25], [50, 25]], width: 4, kind: "lane" }],
  cityWalls: [{ id: "w1", points: [[5, 5], [45, 5]], kind: "palisade", name: "The Stockade" }],
  trees: [{ id: "t1", kind: "tree", points: [[40, 20]] }],
  land: [{ id: "h1", kind: "hill", points: [[25, 30]], height: 10, radius: 30 }],
  labels: [{ id: "l1", text: "Old Town", kind: "region", x: 25, y: 15 }],
};

describe("city copy and paste", () => {
  it("copies what is selected and nothing else", () => {
    expect(copyCity(f, ["nothing"])).toBeNull();
    const c = copyCity(f, ["b1", "s1", "l1"])!;
    expect([c.buildings.length, c.streets.length, c.labels.length, c.walls.length, c.trees.length, c.land.length]).toEqual([1, 1, 1, 0, 0, 0]);
    expect(cityClipBounds(c)).toEqual({ x0: 0, y0: 10, x1: 50, y1: 25 });
    c.buildings[0].points[0][0] = 999; // (a copy: changing it leaves the map alone)
    expect(f.buildings![0].points[0][0]).toBe(10);
  });

  it("pastes moved, with new ids, the names of buildings, streets and walls left off and the labels' kept", () => {
    const c = copyCity(f, ["b1", "b2", "s1", "w1", "t1", "h1", "l1"])!;
    const r = pasteCity(c, 100, 50);
    expect(r.ids).toHaveLength(7);
    expect(r.ids.some((id) => ["b1", "b2", "s1", "w1", "t1", "h1", "l1"].includes(id))).toBe(false);
    const g = applyFeaturesPatch(f, r.patch);
    expect(g.buildings).toHaveLength(4);
    const pasted = g.buildings!.find((b) => b.id === r.ids[0])!;
    expect(pasted).toMatchObject({ roof: "thatch", kind: "tavern", points: [[110, 60], [120, 60], [120, 68], [110, 68]] });
    expect(pasted.name).toBeUndefined();
    expect(g.streets!.find((s) => r.ids.includes(s.id))!.name).toBeUndefined();
    expect(g.cityWalls!.find((w) => r.ids.includes(w.id))!.name).toBeUndefined();
    expect(g.labels.find((l) => r.ids.includes(l.id))).toMatchObject({ text: "Old Town", x: 125, y: 65 });
    expect(g.land!.find((l) => r.ids.includes(l.id))!.points).toEqual([[125, 80]]);
  });

  it("keeps the pasted group inside the city", () => {
    const c = copyCity(f, ["b1", "b2"])!;
    const r = pasteCity(c, 500, -100, { widthM: 200, heightM: 100 });
    expect([r.dx, r.dy]).toEqual([200 - 36, -10]);
  });
});
