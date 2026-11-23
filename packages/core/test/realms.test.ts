import { describe, expect, it } from "vitest";
import {
  type Features, applyFeaturesPatch, decodeRealmCells, emptyRealmGrid, encodeRealmCells, nextRealmNumber, paintRealmCells, playerView, realmAreas, realmGridOf, realmNameSpot,
} from "../src/index.ts";

describe("realms", () => {
  it("paint into a grid of cells: a circle, an outline, land only, round a neighbour, and erasing one realm only", () => {
    const g = emptyRealmGrid(2048, 1024);
    expect([g.w, g.h, g.scale]).toEqual([512, 256, 4]);
    const cells = decodeRealmCells(g);
    expect(paintRealmCells(cells, g, { n: 1, polygon: [[0, 0], [1024, 0], [1024, 1024], [0, 1024]] })).toBe(256 * 256);
    // the second realm, round the first: only the empty half
    const n2 = paintRealmCells(cells, g, { n: 2, circle: { x: 1024, y: 512, r: 300 }, onlyEmpty: true });
    expect(n2).toBeGreaterThan(0);
    expect(cells[128 * 512 + 250]).toBe(1); // (west of the middle: still the first's)
    expect(cells[128 * 512 + 260]).toBe(2);
    // land only: a sea in the east half of a 2048 x 1024 height map
    const heights = new Float32Array(2048 * 1024).map((_, i) => ((i % 2048) < 1536 ? 100 : -100));
    paintRealmCells(cells, g, { n: 3, polygon: [[1400, 0], [2048, 0], [2048, 1024], [1400, 1024]], landOnly: { heights, w: 2048, h: 1024, seaLevel: 0 } });
    expect(cells[10 * 512 + 360]).toBe(3);
    expect(cells[10 * 512 + 400]).toBe(0);
    // erasing realm 2 leaves realm 3 alone
    paintRealmCells(cells, g, { n: 0, polygon: [[0, 0], [2048, 0], [2048, 1024], [0, 1024]], only: 2 });
    expect(cells.includes(2)).toBe(false);
    expect(cells.includes(3)).toBe(true);
    const back = encodeRealmCells(g, cells);
    expect(decodeRealmCells(back)).toEqual(cells);
    const areas = realmAreas(back, 2);
    expect(areas.get(1)!.km2).toBe(256 * 256 * 64);
    const spot = realmNameSpot(cells, g, 1)!;
    expect(spot.x).toBeGreaterThan(400); expect(spot.x).toBeLessThan(640);
    expect(nextRealmNumber([{ id: "a", n: 1, name: "A", colour: "#000000" }, { id: "b", n: 3, name: "B", colour: "#000000" }])).toBe(2);
  });

  it("keep their painting through other edits, and leave GM-only realms out for players", () => {
    const g = emptyRealmGrid(256, 256), cells = decodeRealmCells(g);
    paintRealmCells(cells, g, { n: 1, circle: { x: 128, y: 128, r: 60 } });
    let f: Features = { places: [], labels: [] };
    f = applyFeaturesPatch(f, { upsertRealms: [{ id: "r1", n: 1, name: "North", colour: "#c0504d", gmOnly: true }], setRealmCells: encodeRealmCells(g, cells) });
    // (a later edit that doesn't touch the painting keeps it: it was dropped before 2026-11-23's fix)
    f = applyFeaturesPatch(f, { upsertRealms: [{ id: "r2", n: 2, name: "South", colour: "#4f81bd" }] });
    f = applyFeaturesPatch(f, { upsertPlaces: [{ id: "p1", name: "Town", type: "town", x: 1, y: 1 }] });
    expect(f.realmCells).toBeDefined();
    expect(decodeRealmCells(realmGridOf({ meta: { width: 256, height: 256 } as never, features: f })).filter((v) => v === 1).length).toBeGreaterThan(100);
    expect(applyFeaturesPatch(f, { setRealmCells: null }).realmCells).toBeUndefined();
    expect(playerView(f).realms!.map((r) => r.name)).toEqual(["South"]);
  });
});
