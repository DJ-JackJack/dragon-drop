import { describe, expect, it } from "vitest";
import {
  type TracePicture, applyFeaturesPatch, cleanTrace, describeFeaturesPatch, emptyFeatures, fitTrace, gridPinTargets, moveTrace, overlayTrace, rotateTraceAbout, scaleTraceAbout,
  traceCentre, traceCorners, traceFromPins, tracePoint, traceSummary, traceToPicture,
} from "../src/index.ts";

const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));
const pic: TracePicture = { ref: "old map.png", w: 400, h: 300, x: 10, y: 20, scale: 0.5, rotation: 30 };

describe("where the trace picture lies", () => {
  it("maps picture pixels to the map and back", () => {
    close(tracePoint({ ...pic, rotation: 0 }, 0, 0), [10, 20]);
    close(tracePoint({ ...pic, rotation: 0 }, 400, 300), [210, 170]);
    close(tracePoint({ ...pic, rotation: 90 }, 100, 0), [10, 70]); // (turned a quarter clockwise: along the picture's top edge is down the map)
    for (const [u, v] of [[0, 0], [123, 45], [400, 300], [-20, 500]]) close(traceToPicture(pic, ...tracePoint(pic, u, v)), [u, v]);
    expect(traceCorners(pic)).toHaveLength(4);
    close(traceCorners(pic)[0], [10, 20]);
  });

  it("fits inside the map, centred", () => {
    const t = fitTrace({ ref: "a.png", w: 2000, h: 1000 }, 1024, 1024);
    expect(t.scale).toBeCloseTo(1024 / 2000);
    close([t.x, t.y], [0, (1024 - 512) / 2]);
    close(traceCentre(t), [512, 512]);
    const tall = fitTrace({ ref: "a.png", w: 100, h: 400 }, 30, 20); // a battlemap 30 x 20 squares
    expect(tall.scale).toBeCloseTo(20 / 400);
    close(traceCentre(tall), [15, 10]);
  });

  it("moves, sizes and turns about a point that stays put", () => {
    close([moveTrace(pic, 5, -3).x, moveTrace(pic, 5, -3).y], [15, 17]);
    const c = traceCentre(pic);
    close(traceCentre(scaleTraceAbout(pic, 1.5, c[0], c[1])), c);
    expect(scaleTraceAbout(pic, 1.5, c[0], c[1]).scale).toBeCloseTo(0.75);
    const turned = rotateTraceAbout(pic, 45, c[0], c[1]);
    close(traceCentre(turned), c);
    expect(turned.rotation).toBeCloseTo(75);
    expect(rotateTraceAbout(pic, 170, c[0], c[1]).rotation).toBeCloseTo(-160); // (kept between -180 and 180)
  });
});

describe("lining it up", () => {
  it("two pins move, size and turn it so both points land where they belong", () => {
    const target: TracePicture = { ref: "p.png", w: 800, h: 600, x: 120, y: -40, scale: 1.7, rotation: -12 };
    const a: [number, number] = [50, 60], b: [number, number] = [700, 500];
    const r = traceFromPins({ ref: "p.png", w: 800, h: 600 }, [{ picture: a, map: tracePoint(target, ...a) }, { picture: b, map: tracePoint(target, ...b) }]);
    if ("error" in r) throw new Error(r.error);
    close([r.x, r.y, r.scale, r.rotation], [target.x, target.y, target.scale, target.rotation], 1e-6);
    expect(r.w).toBe(800);
  });

  it("refuses two pins on top of each other", () => {
    expect(traceFromPins(pic, [{ picture: [10, 10], map: [0, 0] }, { picture: [11, 10], map: [50, 50] }])).toHaveProperty("error");
    expect(traceFromPins(pic, [{ picture: [10, 10], map: [5, 5] }, { picture: [300, 200], map: [5, 5] }])).toHaveProperty("error");
  });

  it("matching a grid: the first crossing goes to the nearest corner, the second the given squares along its row or column", () => {
    expect(gridPinTargets([3.4, 7.6], [8.1, 7.9], 5)).toEqual([[3, 8], [8, 8]]);
    expect(gridPinTargets([3.4, 7.6], [3.2, 2.5], 5)).toEqual([[3, 8], [3, 3]]); // (up a column)
    expect(gridPinTargets([3.4, 7.6], [-1, 7.6], 4.4)).toEqual([[3, 8], [-1, 8]]);
  });

  it("a picture with 70 px squares, turned 2 degrees, lands on the map's squares", () => {
    // the DM's picture: grid crossings every 70 px from (35, 35); as first laid over the map it is a little off, turned and too big
    const shown: TracePicture = { ref: "dungeon.png", w: 1400, h: 1050, x: 0.4, y: -0.3, scale: 1 / 60, rotation: 2 };
    const pa: [number, number] = [35 + 70, 35 + 70], pb: [number, number] = [35 + 70 * 8, 35 + 70];
    const [ta, tb] = gridPinTargets(tracePoint(shown, ...pa), tracePoint(shown, ...pb), 7);
    const r = traceFromPins(shown, [{ picture: pa, map: ta }, { picture: pb, map: tb }]);
    if ("error" in r) throw new Error(r.error);
    expect(r.scale).toBeCloseTo(1 / 70);
    expect(r.rotation).toBeCloseTo(0);
    // every crossing of the picture's grid is now on a corner of the map's grid
    for (const [i, j] of [[0, 0], [5, 3], [19, 14]]) {
      const [x, y] = tracePoint(r, 35 + 70 * i, 35 + 70 * j);
      expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-6);
      expect(Math.abs(y - Math.round(y))).toBeLessThan(1e-6);
    }
  });
});

describe("cleanTrace: a trace picture from outside, checked", () => {
  it("keeps a good one and refuses nonsense", () => {
    expect(cleanTrace(pic, 1024, 1024)).toEqual(pic);
    expect(cleanTrace({ ...pic, locked: true }, 1024, 1024)?.locked).toBe(true);
    expect(cleanTrace({ ...pic, rotation: 370 }, 1024, 1024)?.rotation).toBeCloseTo(10);
    for (const bad of [null, 3, { ...pic, ref: "../x.png" }, { ...pic, ref: "" }, { ...pic, scale: 0 }, { ...pic, x: Number.NaN }, { ...pic, w: 0 },
      { ...pic, scale: 1e-6 }, { ...pic, scale: 1e6 }, { ...pic, x: 1e9 }]) expect(cleanTrace(bad, 1024, 1024)).toBeNull();
  });

  it("says where it is, for Claude", () => {
    const s = traceSummary(pic, "map px");
    expect(s.picture).toBe("old map.png");
    expect(s.corners).toHaveLength(4);
    expect(s.top_left).toEqual([10, 20]);
    expect(s.units).toBe("map px");
  });
});

describe("the trace picture in a map's features", () => {
  it("is set, kept by other edits, and taken away", () => {
    const set = applyFeaturesPatch(emptyFeatures(), { setTrace: pic });
    expect(set.trace).toEqual(pic);
    expect(applyFeaturesPatch(set, { upsertPlaces: [{ id: "p1", name: "A", type: "town", x: 1, y: 2 }] }).trace).toEqual(pic);
    expect(applyFeaturesPatch(set, { setTrace: null }).trace).toBeUndefined();
    expect(describeFeaturesPatch({ setTrace: pic })).toMatch(/trace picture old map\.png/);
    expect(describeFeaturesPatch({ setTrace: null })).toMatch(/remove the trace picture/);
  });
});

describe("overlayTrace: the picture drawn over a preview", () => {
  it("covers exactly where the picture lies, half see-through", () => {
    // a 20 x 20 preview of a 100 x 100 world map (5 map px per preview px); a red picture over map px 20..60 x 40..80
    const img = { w: 20, h: 20, data: new Uint8ClampedArray(20 * 20 * 4).fill(0) };
    const red = { w: 4, h: 4, data: new Uint8ClampedArray(4 * 4 * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0)) };
    overlayTrace(img, red, { ref: "r.png", w: 4, h: 4, x: 20, y: 40, scale: 10, rotation: 0 }, { unitPx: 1, region: { x: 0, y: 0 }, scale: 0.2 }, 0.5);
    const at = (ix: number, iy: number) => img.data[(iy * 20 + ix) * 4];
    expect(at(6, 10)).toBeCloseTo(127.5, -1); // inside (map 32, 52)
    expect(at(2, 10)).toBe(0); // left of it
    expect(at(6, 3)).toBe(0); // above it
    expect(at(13, 17)).toBe(0); // below and right of it
  });
});
