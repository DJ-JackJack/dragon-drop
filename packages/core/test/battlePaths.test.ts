import { describe, expect, it } from "vitest";
import {
  type Features, type MapPath, applyFeaturesPatch, drawBattleLights, boxSelect, copyFeatures, createBattleDoc, deleteFeatures, featureKindOf, moveFeatures, pasteFeatures, renderBattle, renderPathLayer,
  laidAlong, smoothPath,
} from "../src/index.ts";

const spec = { squaresX: 12, squaresY: 8, pxPerSquare: 40, feetPerSquare: 5, sub: 8, gridType: "square" as const };
const at = (l: { w: number; data: Uint8ClampedArray }, xSq: number, ySq: number) => { const o = (Math.floor(ySq * 40) * l.w + Math.floor(xSq * 40)) * 4; return [...l.data.slice(o, o + 4)]; };
const path = (extra: Partial<MapPath> = {}): MapPath => ({ id: "k1", points: [[1, 4], [6, 4], [11, 2]], ...extra });

describe("battlemap paths", () => {
  it("rounds a path's corners and keeps its ends", () => {
    const s = smoothPath([[0, 0], [4, 0], [4, 4]]);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([4, 4]);
    expect(s.length).toBeGreaterThan(3);
    expect(s.some(([x, y]) => x > 3 && x < 4 && y > 0 && y < 1)).toBe(true); // (the corner is cut)
    expect(smoothPath([[0, 0], [5, 5]])).toEqual([[0, 0], [5, 5]]);
  });

  it("draws each look along the path, soft at its edges and nothing off it", () => {
    const col = (look: MapPath["look"]) => at(renderPathLayer(spec, [path({ look })]), 3, 4);
    const dirt = col(undefined), gravel = col("gravel"), water = col("water");
    expect(dirt[3]).toBeGreaterThan(200);
    expect(dirt[0]).toBeGreaterThan(dirt[2] + 30); // brown
    expect(Math.abs(gravel[0] - gravel[2])).toBeLessThan(dirt[0] - dirt[2]); // greyer than dirt
    expect(water[2]).toBeGreaterThan(water[0] + 30); // blue
    expect(at(renderPathLayer(spec, [path()]), 3, 6.5)[3]).toBe(0); // two and a half squares off it: nothing
    // wider paths reach further
    expect(at(renderPathLayer(spec, [path({ width: 3 })]), 3, 5.2)[3]).toBeGreaterThan(100);
    expect(at(renderPathLayer(spec, [path({ width: 1 })]), 3, 5.2)[3]).toBe(0);
  });

  it("lays a pack picture along the path, and lies under the walls in the picture of the map", () => {
    const strip = { w: 400, h: 100, data: new Uint8ClampedArray(400 * 100 * 4) };
    for (let i = 0; i < 400 * 100; i++) strip.data.set([200, 40, 200, 255], i * 4);
    const l = renderPathLayer(spec, [path({ asset: "kit:Paths/road.png", width: 2 })], { pictureFor: () => strip });
    const c = at(l, 3, 4);
    expect(c[0]).toBeGreaterThan(c[1] + 80); // magenta, from the picture
    const doc = createBattleDoc({ id: "road", name: "Road", squaresX: 12, squaresY: 8, pxPerSquare: 40 });
    doc.features = { ...(doc.features as Features), paths: [path({ look: "water", width: 2 })], walls: [{ id: "w", kind: "wall", points: [[3, 2], [3, 6]] }] };
    const img = renderBattle(doc, { lights: false });
    const onPath = at(img, 5, 4), onWall = at(img, 3, 4);
    expect(onPath[2]).toBeGreaterThan(onPath[0] + 20); // the stream on the floor
    expect(Math.abs(onWall[0] - onWall[2])).toBeLessThan(40); // the stone wall over it
  });

  it("lays a road picture with see-through edges along the path whatever its shape, keeping its dark edges, and tiles an opaque texture", () => {
    // (like a pack's "Road 1": 502 x 290, nothing above and below, a dark ragged edge, a pale middle)
    const road = { w: 500, h: 290, data: new Uint8ClampedArray(500 * 290 * 4) };
    for (let y = 0; y < 290; y++) for (let x = 0; x < 500; x++) {
      const t = y / 290;
      road.data.set(t < 0.15 || t > 0.85 ? [0, 0, 0, 0] : t < 0.25 || t > 0.75 ? [40, 30, 20, 255] : [230, 220, 190, 255], (y * 500 + x) * 4);
    }
    expect(laidAlong(road)).toBe(true);
    const opaque = { w: 500, h: 290, data: new Uint8ClampedArray(500 * 290 * 4).fill(255) };
    expect(laidAlong(opaque)).toBe(false);
    expect(laidAlong({ w: 1000, h: 100, data: new Uint8ClampedArray(1000 * 100 * 4).fill(255) })).toBe(true);
    // a 2-square road along y = 4 (straight there): pale in the middle, its dark edge kept about 0.6 squares out, nothing beyond the picture's edge
    const l = renderPathLayer(spec, [path({ asset: "kit:Paths/Road 1.png", width: 2, points: [[1, 4], [10, 4]] })], { pictureFor: () => road });
    const mid = at(l, 5, 4), edge = at(l, 5, 4.6), off = at(l, 5, 4.85);
    expect(mid[0]).toBeGreaterThan(200);
    expect(edge[3]).toBeGreaterThan(200);
    expect(edge[0]).toBeLessThan(80);
    expect(off[3]).toBeLessThan(60);
  });

  it("is selected, moved, copied and deleted with the rest", () => {
    const f: Features = { places: [], labels: [], paths: [path()] };
    expect(featureKindOf(f, "k1")).toBe("path");
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 12, y1: 8 }, ["path"])).toEqual(["k1"]);
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 6, y1: 8 }, ["path"])).toEqual([]); // only wholly inside
    const moved = applyFeaturesPatch(f, moveFeatures(f, ["k1"], 0.5, 1, { w: 12, h: 8 }).patch);
    expect(moved.paths![0].points[0]).toEqual([1.5, 5]);
    const clip = copyFeatures(f, ["k1"])!;
    const pasted = pasteFeatures(clip, 0, 1);
    expect(pasted.patch.upsertPaths![0].id).not.toBe("k1");
    expect(applyFeaturesPatch(f, deleteFeatures(f, ["k1"])).paths).toEqual([]);
  });
});

describe("a light's shape from a picture", () => {
  it("lights where the picture is bright and leaves dark where it is dark, in the light's colour", () => {
    // a glow picture: bright on its left half only
    const glow = { w: 64, h: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) glow.data.set(x < 32 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 64 + x) * 4);
    const base = () => ({ w: 480, h: 320, data: new Uint8ClampedArray(480 * 320 * 4).fill(60) });
    const light = { id: "g", x: 6, y: 4, radius: 3, colour: "#ff0000", glow: "kit:Lights/half.png" };
    const lit = base();
    drawBattleLights(lit, spec, [light], undefined, undefined, () => glow);
    const left = at(lit, 5, 4), right = at(lit, 7, 4);
    expect(left[0]).toBeGreaterThan(left[1] + 40); // red light on the bright half
    expect(right[0]).toBe(60); // nothing on the dark half
    // without the picture (or before it loads): the round fall-off, on both sides
    const round = base();
    drawBattleLights(round, spec, [light], undefined, undefined, () => null);
    expect(at(round, 7, 4)[0]).toBeGreaterThan(80);
  });
});
