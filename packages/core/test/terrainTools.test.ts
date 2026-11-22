// The land tools made after the failed rebuild: hills and rings on new land, ranges that change along their length with spurs, erosion held to an area keeping peaks,
// draining one lake, copying land from another map, putting back an area from an older state, and one undo step for land, things and climate together.
import { describe, expect, it } from "vitest";
import { MapSession, addLandmass, addMountainRange, computeFlow, copyFeaturesFrom, copyHeightsFrom, createDoc, drainLakeAt, erodeTerrainWithin, heightsFromState } from "../src/index.ts";

const W = 192;
const ocean = () => { const d = createDoc({ id: "t", name: "T", width: W, height: W, kmPerPx: 2 }); d.height.data.fill(-200); d.meta.seaLevel = 0; return d; };
const spread = (h: Float32Array, pick: (i: number) => boolean) => { const v: number[] = []; for (let i = 0; i < h.length; i++) if (pick(i)) v.push(h[i]); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };

describe("new land with character", () => {
  it("relief makes the land rise and fall instead of a domed plain", () => {
    const flat = ocean(), hilly = ocean();
    addLandmass(flat, { shape: { type: "circle", x: 96, y: 96, r: 70 }, heightM: 300, seed: 4 });
    addLandmass(hilly, { shape: { type: "circle", x: 96, y: 96, r: 70 }, heightM: 300, relief: 0.7, seed: 4 });
    const inner = (i: number) => Math.hypot((i % W) - 96, Math.floor(i / W) - 96) < 45;
    expect(spread(hilly.height.data, inner)).toBeGreaterThan(spread(flat.height.data, inner) * 1.8);
    expect(Math.max(...hilly.height.data)).toBeGreaterThan(Math.max(...flat.height.data) + 100);
  });

  it("a ring of land round an inner sea", () => {
    const d = ocean();
    addLandmass(d, { shape: { type: "circle", x: 96, y: 96, r: 60 }, heightM: 200, ringPx: 20, coastRoughness: 0.2, seed: 2 });
    const at = (x: number, y: number) => d.height.data[y * W + x];
    expect(at(96, 96)).toBeLessThan(0); // the middle stays sea
    expect(at(96 + 60, 96)).toBeGreaterThan(0); // the ring is land
    expect(at(96, 96 - 60)).toBeGreaterThan(0);
  });
});

describe("mountain ranges that change along their length", () => {
  it("heights per point: high where asked, low where asked; spurs reach out sideways", () => {
    const d = ocean();
    d.height.data.fill(10);
    addMountainRange(d, { path: [[20, 96], [96, 96], [172, 96]], widthPx: 6, heightsM: [300, 3000, 300], roughness: 0, seed: 1 });
    const crest = (x: number) => Math.max(...[-2, -1, 0, 1, 2].map((dy) => d.height.data[(96 + dy) * W + x]));
    expect(crest(96)).toBeGreaterThan(crest(30) * 3);
    const plain = ocean(), spurred = ocean();
    plain.height.data.fill(10); spurred.height.data.fill(10);
    addMountainRange(plain, { path: [[20, 96], [172, 96]], widthPx: 6, peakM: 2000, seed: 3 });
    addMountainRange(spurred, { path: [[20, 96], [172, 96]], widthPx: 6, peakM: 2000, spurs: 1, seed: 3 });
    const raisedFar = (h: Float32Array) => { let n = 0; for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (Math.abs(y - 96) > 18 && h[y * W + x] > 100) n++; return n; };
    expect(raisedFar(spurred.height.data)).toBeGreaterThan(raisedFar(plain.height.data) + 20);
  });
});

describe("erosion held to an area, keeping peaks", () => {
  it("nothing outside the area changes, and land above keep_above_m keeps its height", () => {
    const d = ocean();
    addLandmass(d, { shape: { type: "circle", x: 96, y: 96, r: 80 }, heightM: 300, relief: 0.5, seed: 6 });
    addMountainRange(d, { path: [[40, 96], [150, 96]], widthPx: 8, peakM: 2500, seed: 7 });
    const before = d.height.data.slice(), peak = before.indexOf(Math.max(...before));
    const area = { type: "rect" as const, x: 60, y: 60, w: 70, h: 70 };
    const r = erodeTerrainWithin(d.height.data, W, W, 0, { passes: 3, area, keepAboveM: 2000 });
    expect(r.x).toBeGreaterThanOrEqual(58);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (x < 59 || x > 131 || y < 59 || y > 131) expect(d.height.data[y * W + x]).toBe(before[y * W + x]);
    expect(d.height.data[peak]).toBe(before[peak]);
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (d.height.data[i] !== before[i]) changed++;
    expect(changed).toBeGreaterThan(100);
  });
});

describe("draining one lake", () => {
  // a plateau falling to the sea in the east, with a bowl sunk into it in the west
  const bowl = () => {
    const h = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) h[y * W + x] = x > 170 ? -50 : 300 - x * 0.5 - Math.max(0, 120 - Math.hypot(x - 60, y - 96) * 4);
    return h;
  };
  const lakeDepth = (h: Float32Array) => { const f = computeFlow(h, W, W, 0).filled; return f[96 * W + 60] - h[96 * W + 60]; };

  it("an outlet through its lowest rim, or filled into a shallow bowl", () => {
    const h = bowl();
    expect(lakeDepth(h)).toBeGreaterThan(45);
    const r = drainLakeAt(h, W, W, 0, 60, 96, { mode: "outlet" });
    expect(r.done).toBe("outlet");
    expect(r.cutM).toBeGreaterThan(0);
    expect(lakeDepth(h)).toBeLessThan(1);
    const g = bowl();
    const f = drainLakeAt(g, W, W, 0, 60, 96, { mode: "fill" });
    expect(f.done).toBe("filled");
    expect(lakeDepth(g)).toBeLessThan(26);
    expect(drainLakeAt(bowl(), W, W, 0, 150, 20).done).toBe("none"); // (no hollow there)
  });
});

describe("copying land and things, and putting back an area", () => {
  it("land from a map of the same size, inside an area only, at the same height above the sea", () => {
    const src = ocean(), dst = ocean();
    addLandmass(src, { shape: { type: "circle", x: 96, y: 96, r: 50 }, heightM: 400, seed: 8 });
    src.meta.seaLevel = 100; for (let i = 0; i < src.height.data.length; i++) src.height.data[i] += 100;
    const area = { type: "rect" as const, x: 40, y: 40, w: 60, h: 112 };
    const r = copyHeightsFrom(src, dst, { s: 1, x: 0, y: 0 }, area)!;
    expect(r.changed).toBeGreaterThan(500);
    const s = new MapSession(dst);
    s.execute({ op: "patch_heights", rect: r.rect, data: r.data, label: "copy" }, "claude");
    // inside, well past the soft edge: the source's height above its sea
    expect(dst.height.data[96 * W + 70]).toBeCloseTo(src.height.data[96 * W + 70] - 100, 3);
    // outside the area: unchanged
    expect(dst.height.data[96 * W + 140]).toBe(-200);
    // and back from an older state, for the same area
    const old = new Float32Array(W * W).fill(-200);
    const back = heightsFromState(dst.height.data, old, W, W, area)!;
    s.execute({ op: "patch_heights", rect: back.rect, data: back.data, label: "back" }, "claude");
    expect(dst.height.data[96 * W + 70]).toBeCloseTo(-200, 3);
  });

  it("things moved into the other map's frame, only those inside the area, ids kept", () => {
    const f = { places: [{ id: "p1", name: "Mill", type: "village" as const, x: 10, y: 20 }, { id: "p2", name: "Far", type: "village" as const, x: 180, y: 180 }], labels: [{ id: "l1", text: "Sea", kind: "sea" as const, x: 12, y: 22, path: [[10, 20], [14, 24]] as [number, number][] }] };
    const { patch, counts } = copyFeaturesFrom(f, { s: 2, x: 5, y: 0 }, ["places", "labels"], { type: "rect", x: 0, y: 0, w: 100, h: 100 });
    expect(counts).toEqual({ places: 1, labels: 1 });
    expect(patch.upsertPlaces![0]).toMatchObject({ id: "p1", x: 25, y: 40 });
    expect(patch.upsertLabels![0].path).toEqual([[25, 40], [33, 48]]);
  });

  it("land, things and climate in one undo step", () => {
    const d = ocean(), s = new MapSession(d);
    d.meta.climate = { moistureBias: 0.3 };
    const data = new Float32Array(4).fill(50);
    s.execute({ op: "patch_heights", rect: { x: 0, y: 0, w: 2, h: 2 }, data, features: { upsertPlaces: [{ id: "p", name: "X", type: "village", x: 1, y: 1 }] }, meta: { climate: { moistureBias: 0.9 } }, label: "copy" }, "claude");
    expect(d.meta.climate?.moistureBias).toBe(0.9);
    s.undo("claude");
    expect(d.meta.climate?.moistureBias).toBe(0.3);
    expect(d.features?.places ?? []).toHaveLength(0);
    expect(d.height.data[0]).toBe(-200);
  });
});
