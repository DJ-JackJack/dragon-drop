/** cityLand.ts: the land's heights from shapes, the shading and contour lines, the climate's colours and the trees. */
import { describe, expect, it } from "vitest";
import {
  CITY_CLIMATES, MATERIALS, MAX_CROWNS, applyFeaturesPatch, cityGroundColours, cleanClimate, cleanLandform, cleanTrees, climatePreset, climateTrees, contourInterval, contourLines,
  createCityDoc, landAt, landGrid, landHeightAt, landShade, landformHeightAt, snowCover, treeColour, treeCrowns, type MapLandform, type MapTrees,
} from "../src/index.ts";

const spec = { widthM: 600, heightM: 400, cellM: 2 };
const land = (o: Record<string, unknown>) => { const c = cleanLandform(o, spec); if ("error" in c) throw new Error(c.error); return c; };
const trees = (o: Record<string, unknown>) => { const c = cleanTrees(o, spec); if ("error" in c) throw new Error(c.error); return c; };

describe("the land", () => {
  it("adds up hills, ridges, valleys, plateaus and slopes into heights that fall smoothly to nothing", () => {
    const hill = land({ id: "a", kind: "hill", points: [[300, 200]], height: 20, radius: 100 });
    expect(landformHeightAt(hill, 300, 200)).toBeCloseTo(20, 1);
    expect(landformHeightAt(hill, 300, 340)).toBe(0); // (beyond its reach)
    const valley = land({ id: "v", kind: "ridge", points: [[0, 100], [600, 100]], height: -8, radius: 30 });
    expect(landformHeightAt(valley, 300, 100)).toBeLessThan(-6);
    const plateau = land({ id: "p", kind: "plateau", points: [[100, 300], [200, 300], [200, 380], [100, 380]], height: 10, radius: 20 });
    expect(landformHeightAt(plateau, 150, 340)).toBeCloseTo(10, 0);
    expect(landformHeightAt(plateau, 150, 280)).toBeLessThan(2);
    const slope = land({ id: "s", kind: "slope", points: [[0, 400], [0, 0]], height: 30 });
    expect(landformHeightAt(slope, 50, 400)).toBe(0);
    expect(landformHeightAt(slope, 50, 0)).toBe(30);
    expect(landHeightAt([hill, slope], 300, 200)).toBeGreaterThan(landHeightAt([hill], 300, 200) + 10);
  });

  it("has no step anywhere: neighbouring cells never differ by more than the steepest landform allows", () => {
    const doc = createCityDoc({ id: "c", name: "C", widthM: 600, heightM: 400, cellM: 2 });
    const ls: MapLandform[] = [
      land({ id: "a", kind: "hill", points: [[300, 200]], height: 30, radius: 80 }),
      land({ id: "b", kind: "plateau", points: [[60, 60], [200, 60], [200, 150], [60, 150]], height: 15, radius: 25 }),
      land({ id: "r", kind: "ridge", points: [[0, 330], [600, 300]], height: -10, radius: 40 }),
    ];
    doc.features = applyFeaturesPatch(doc.features!, { upsertLand: ls });
    const g = landGrid(doc)!;
    let worst = 0;
    for (let y = 0; y < g.h; y++) for (let x = 1; x < g.w; x++) worst = Math.max(worst, Math.abs(g.data[y * g.w + x] - g.data[y * g.w + x - 1]));
    expect(worst).toBeLessThan(2.5); // (2 m cells: a 125% slope would be a cliff)
    expect(landGrid(doc)).toBe(g); // (cached)
    expect(landShade(g)).toBe(landShade(g));
    const c = contourLines(g);
    expect(c.interval).toBe(contourInterval(g.min, g.max));
    expect(c.minor.length + c.major.length).toBeGreaterThan(40);
    const top = landAt(doc, 300, 200), side = landAt(doc, 340, 200);
    expect(top.height).toBeGreaterThan(28);
    expect(side.slope).toBeGreaterThan(top.slope);
    expect(side.falls).toBe("east");
  });

  it("puts no line round ground that lies exactly at a contour level (the flat top of a slope)", () => {
    const doc = createCityDoc({ id: "c", name: "C", widthM: 200, heightM: 200, cellM: 2 });
    doc.features = applyFeaturesPatch(doc.features!, { upsertLand: [land({ id: "s", kind: "slope", points: [[0, 200], [0, 100]], height: 10 })] });
    const c = contourLines(landGrid(doc)!);
    // every line lies across the slope (between y 100 and 200), none along the edge of the flat top
    for (const segs of [c.minor, c.major]) for (let i = 1; i < segs.length; i += 2) expect(segs[i]).toBeGreaterThan(101);
  });

  it("checks what comes from outside", () => {
    expect(cleanLandform({ id: "x", kind: "hill", points: [[1, 1], [2, 2]], height: 5, radius: 5 }, spec)).toMatchObject({ error: /one point/ });
    expect(cleanLandform({ id: "x", kind: "hill", points: [[1, 1]], height: 5 }, spec)).toMatchObject({ error: /radius/ });
    expect(cleanLandform({ id: "x", kind: "volcano", points: [[1, 1]], height: 5, radius: 5 }, spec)).toMatchObject({ error: /kind/ });
    expect(cleanLandform({ id: "x", kind: "slope", points: [[1, 1], [2, 2]], height: 0 }, spec)).toMatchObject({ error: /height/ });
    expect(cleanLandform({ id: "x", kind: "plateau", points: [[0, 0], [10, 10], [10, 0], [0, 10]], height: 5, radius: 5 }, spec)).toMatchObject({ error: /crosses itself/ });
    expect(cleanTrees({ id: "t", kind: "tree", points: [[1, 1]], species: "baobab" }, spec)).toMatchObject({ error: /kinds of tree/ });
    expect(cleanClimate({ temperature: 0.5, moisture: 1.5 })).toMatchObject({ error: expect.any(String) });
  });
});

describe("the climate", () => {
  it("has presets that read back as themselves, and own numbers as none", () => {
    for (const p of CITY_CLIMATES) expect(climatePreset({ temperature: p.temperature, moisture: p.moisture })).toBe(p.id);
    expect(climatePreset({ temperature: 0.4, moisture: 0.05 })).toBeNull();
  });

  it("colours the grass: green when temperate, golden when dry, white under snow; water is never changed", () => {
    const at = (id: string) => { const p = CITY_CLIMATES.find((c) => c.id === id)!; return cityGroundColours(p); };
    const grass = (cs: number[][]) => cs[5];
    expect(grass(at("temperate"))).toEqual([...MATERIALS[5].colour]);
    const dry = grass(at("dry")), med = grass(at("mediterranean")), cold = grass(at("cold"));
    expect(dry[0]).toBeGreaterThan(dry[1] * 0.85); // (straw, sand: red close to green)
    expect(med[0]).toBeGreaterThan(MATERIALS[5].colour[0] + 40);
    expect(cold[2]).toBeGreaterThan(150); // (snow)
    expect(at("cold")[8]).toEqual([...MATERIALS[8].colour]);
    expect(snowCover({ temperature: 0.5, moisture: 0.5 })).toBe(0);
    expect(snowCover({ temperature: 0.05, moisture: 0.5 })).toBe(1);
  });
});

describe("trees", () => {
  const temperate = { temperature: 0.5, moisture: 0.6 };
  it("are the same every time, inside their outline, and as many as the area asks (never past the cap)", () => {
    const wood = trees({ id: "w1", kind: "wood", points: [[100, 100], [200, 100], [200, 180], [100, 180]] });
    const a = treeCrowns(wood, temperate), b = treeCrowns(wood, temperate);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
    expect(a.every((c) => c.x >= 100 && c.x <= 200 && c.y >= 100 && c.y <= 180)).toBe(true);
    const huge: MapTrees = { id: "big", kind: "wood", points: [[0, 0], [6000, 0], [6000, 6000], [0, 6000]] };
    expect(treeCrowns(huge, temperate).length).toBeLessThanOrEqual(MAX_CROWNS);
    const row = treeCrowns(trees({ id: "r", kind: "row", points: [[0, 50], [100, 50], [100, 150]] }), temperate);
    expect(row.length).toBeGreaterThan(20);
    expect(row.every((c) => Math.abs(c.y - 50) < 1 || Math.abs(c.x - 100) < 1)).toBe(true);
    expect(treeCrowns(trees({ id: "one", kind: "tree", points: [[5, 5]], size: 10 }), temperate)).toEqual([expect.objectContaining({ x: 5, y: 5, r: 5 })]);
  });

  it("follow the climate (firs in the cold, olives in an orchard by the Mediterranean, palms when asked) and are snowy in the cold", () => {
    const area = [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][];
    expect(climateTrees({ temperature: 0.15, moisture: 0.5 })[0][0]).toBe("conifer");
    const orchard = treeCrowns({ id: "o", kind: "orchard", points: area }, { temperature: 0.7, moisture: 0.32 });
    expect(new Set(orchard.map((c) => c.species))).toEqual(new Set(["olive"]));
    expect(new Set(treeCrowns({ id: "p", kind: "wood", points: area, species: "palm" }, temperate).map((c) => c.species))).toEqual(new Set(["palm"]));
    const warm = treeColour("conifer", temperate, 0.5), cold = treeColour("conifer", { temperature: 0.05, moisture: 0.5 }, 0.5);
    expect(cold[2]).toBeGreaterThan(warm[2] + 30);
  });
});
