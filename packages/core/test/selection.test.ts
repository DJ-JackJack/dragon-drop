import { describe, expect, it } from "vitest";
import {
  type Features, LockedEditError, MapSession, NotYourChangeError, cleanSelection, cleanView, createDoc, defaultFeather, describeSelection, emptyFeatures, featuresOutsideLock,
  generateTerrain, selectionMask, selectionReport, selectionShape, shapeContains, signedDistance,
} from "../src/index.ts";

const W = 200;
function flatDoc(h = 100) {
  const d = createDoc({ id: "s", name: "S", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  d.height.data.fill(h);
  return d;
}

describe("a selection from the wire", () => {
  it("keeps good ones, rounds and clamps them into the map, and rejects junk", () => {
    expect(cleanSelection({ kind: "point", x: 10.04, y: 300 }, W, W)).toEqual({ kind: "point", x: 10, y: 200 });
    expect(cleanSelection({ kind: "area", shape: { type: "rect", x: -20, y: 10, w: 60, h: 500 } }, W, W)).toEqual({ kind: "area", shape: { type: "rect", x: 0, y: 10, w: 40, h: 190 } });
    expect(cleanSelection({ kind: "area", shape: { type: "circle", x: 50, y: 50, r: 12.34 } }, W, W)).toEqual({ kind: "area", shape: { type: "circle", x: 50, y: 50, r: 12.3 } });
    expect(cleanSelection({ kind: "feature", featureKind: "place", id: "p-ab12" }, W, W)).toEqual({ kind: "feature", featureKind: "place", id: "p-ab12" });
    const tri = cleanSelection({ kind: "area", shape: { type: "polygon", points: [[0, 0], [100, 0], [50, 90]] } }, W, W);
    expect(tri).toMatchObject({ kind: "area", shape: { type: "polygon" } });
    for (const bad of [null, 5, "x", {}, { kind: "point", x: NaN, y: 1 }, { kind: "point", x: "1", y: 1 }, { kind: "area", shape: { type: "circle", x: 1, y: 1, r: 0 } },
      { kind: "area", shape: { type: "rect", x: 1, y: 1, w: 0, h: 5 } }, { kind: "area", shape: { type: "polygon", points: [[0, 0], [1, 1]] } },
      { kind: "area", shape: { type: "polygon", points: Array.from({ length: 1001 }, (_, i) => [i % 200, 5]) } }, { kind: "area", shape: { type: "all" } },
      { kind: "feature", featureKind: "wall", id: "w1" }, { kind: "feature", featureKind: "place", id: "../etc" }, { kind: "area", shape: { type: "polygon", points: [[0, 0], [1, "a"], [3, 3]] } }]) {
      expect(cleanSelection(bad, W, W)).toBeNull();
    }
    expect(cleanView({ rect: { x: 1.4, y: 2, w: 100, h: 50 }, zoom: 2 })).toEqual({ rect: { x: 1, y: 2, w: 100, h: 50 }, zoom: 2 });
    expect(cleanView({ rect: { x: 1, y: 2, w: 0, h: 50 }, zoom: 2 })).toBeNull();
    expect(cleanView({ rect: { x: 1, y: 2, w: 10, h: 50 }, zoom: -1 })).toBeNull();
  });

  it("a climate region counts as an area, other features do not", () => {
    const f: Features = { ...emptyFeatures(), regions: [{ id: "r1", name: "Dry", polygon: [[10, 10], [60, 10], [60, 60]] }], places: [{ id: "p1", name: "Town", type: "town", x: 5, y: 5 }] };
    expect(selectionShape({ kind: "feature", featureKind: "region", id: "r1" }, f)).toMatchObject({ type: "polygon" });
    expect(selectionShape({ kind: "feature", featureKind: "place", id: "p1" }, f)).toBeNull();
    expect(selectionShape({ kind: "point", x: 1, y: 1 }, f)).toBeNull();
    expect(selectionShape(null, f)).toBeNull();
    expect(describeSelection({ kind: "feature", featureKind: "place", id: "p1" }, f, 4)).toBe('the place "Town"');
    expect(describeSelection({ kind: "area", shape: { type: "rect", x: 1, y: 2, w: 10, h: 20 } }, f, 4)).toContain("10×20 px rectangle");
    expect(describeSelection({ kind: "feature", featureKind: "place", id: "gone" }, f, 4)).toContain("no longer on the map");
    expect(describeSelection(null, f, 4)).toBe("nothing selected");
  });
});

describe("the soft-edged mask", () => {
  const shapes = [
    { type: "rect" as const, x: 40, y: 50, w: 80, h: 60 },
    { type: "circle" as const, x: 100, y: 100, r: 40 },
    { type: "polygon" as const, points: [[30, 30], [150, 40], [170, 120], [90, 170], [40, 110]] as [number, number][] },
  ];
  for (const shape of shapes) {
    it(`${shape.type}: nothing outside, full weight well inside, a ramp across the edge`, () => {
      const feather = 10, m = selectionMask(shape, W, W, feather);
      let outsideWeight = 0, deepMismatch = 0, deep = 0, ramp = 0;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const inR = x >= m.rect.x && x < m.rect.x + m.rect.w && y >= m.rect.y && y < m.rect.y + m.rect.h;
        const w = inR ? m.data[(y - m.rect.y) * m.rect.w + (x - m.rect.x)] : 0;
        const sd = signedDistance(shape, x + 0.5, y + 0.5);
        if (sd < -1) outsideWeight = Math.max(outsideWeight, w);
        if (sd > feather + 2) { deep++; if (w !== 1) deepMismatch++; }
        if (sd > 1 && sd < feather - 2) { if (w > 0 && w < 1) ramp++; }
      }
      expect(outsideWeight).toBe(0);
      expect(deep).toBeGreaterThan(100);
      expect(deepMismatch).toBe(0);
      expect(ramp).toBeGreaterThan(20);
    });
    it(`${shape.type}: with no feather it is a hard 0/1 cut`, () => {
      const m = selectionMask(shape, W, W, 0);
      expect(m.data.every((v) => v === 0 || v === 1)).toBe(true);
      expect(m.data.some((v) => v === 1)).toBe(true);
    });
  }
  it("a polygon's fill agrees with the point-in-polygon rule", () => {
    const shape = shapes[2], m = selectionMask(shape, W, W, 0);
    let bad = 0, n = 0;
    for (let y = 0; y < m.rect.h; y++) for (let x = 0; x < m.rect.w; x++) {
      const sd = signedDistance(shape, m.rect.x + x + 0.5, m.rect.y + y + 0.5);
      if (Math.abs(sd) < 1) continue;
      n++;
      if ((m.data[y * m.rect.w + x] === 1) !== (sd > 0)) bad++;
    }
    expect(n).toBeGreaterThan(1000);
    expect(bad).toBe(0);
  });
  it("is empty for a shape outside the map and sensible at the map's edge", () => {
    expect(selectionMask({ type: "rect", x: 500, y: 500, w: 10, h: 10 }, W, W, 3).data.length).toBe(0);
    const edge = selectionMask({ type: "rect", x: 0, y: 0, w: 50, h: 50 }, W, W, 5);
    expect(edge.rect).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(defaultFeather({ type: "rect", x: 0, y: 0, w: 1000, h: 1000 })).toBe(40);
    expect(defaultFeather({ type: "circle", x: 5, y: 5, r: 3 })).toBe(2);
  });
});

describe("Claude's edits held to a selection", () => {
  const shape = { type: "rect" as const, x: 60, y: 60, w: 80, h: 80 };
  const lockOf = (feather = 8) => ({ shape, featherPx: feather });
  const outside = (x: number, y: number) => !shapeContains({ ...shape, x: shape.x - 0.001, y: shape.y - 0.001, w: shape.w + 0.002, h: shape.h + 0.002 }, x + 0.5, y + 0.5);

  it("clips a landmass bigger than the selection: nothing outside changes, the inside is changed, the edge is soft", () => {
    const doc = flatDoc(-300), s = new MapSession(doc);
    s.editLock = lockOf();
    const before = new Float32Array(doc.height.data);
    const r = s.execute({ op: "add_landmass", params: { shape: { type: "circle", x: 100, y: 100, r: 95 }, heightM: 500, seed: 3 } }, "claude");
    expect(r.rect).toEqual({ x: 60, y: 60, w: 80, h: 80 });
    let changedOutside = 0, changedInside = 0, partial = 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, ch = doc.height.data[i] !== before[i];
      if (ch && outside(x, y)) changedOutside++;
      if (ch && !outside(x, y)) changedInside++;
      if (ch && doc.height.data[i] > before[i] && doc.height.data[i] < 400 && !outside(x, y)) partial++;
    }
    expect(changedOutside).toBe(0);
    expect(changedInside).toBeGreaterThan(3000);
    expect(partial).toBeGreaterThan(50); // the soft edge: some cells are only part-way up
    // the centre is fully raised (the soft edge is only near the border)
    expect(doc.height.data[100 * W + 100]).toBeGreaterThan(100);
    // undo puts everything back exactly
    s.undo("claude");
    expect(Array.from(doc.height.data)).toEqual(Array.from(before));
  });

  it("clips erosion and sculpting too, and leaves a change that is wholly outside as no change", () => {
    const doc = flatDoc(0), s = new MapSession(doc);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) doc.height.data[y * W + x] = 200 + 100 * Math.sin(x / 7) * Math.cos(y / 9);
    s.editLock = lockOf(0);
    const before = new Float32Array(doc.height.data);
    s.execute({ op: "erode", params: { passes: 3 } }, "claude");
    let outsideChanged = 0, insideChanged = 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (doc.height.data[i] !== before[i]) { if (outside(x, y)) outsideChanged++; else insideChanged++; } }
    expect(outsideChanged).toBe(0);
    expect(insideChanged).toBeGreaterThan(0);
    const r = s.execute({ op: "sculpt", params: { shape: { type: "circle", x: 20, y: 20, r: 10 }, mode: "raise", amountM: 300 } }, "claude");
    expect(r.rect).toBeNull();
  });

  // (found 2026-11-22: Claude's undo took back up to 20 of the newest changes, the DM's own outside the lock included)
  it("lets Claude undo and redo only its own changes, and under a lock only those made under it", () => {
    const doc = flatDoc(0), s = new MapSession(doc);
    const raise = (x: number, by: "user" | "claude") => s.execute({ op: "sculpt", params: { shape: { type: "circle", x, y: x, r: 6 }, mode: "raise", amountM: 300 } }, by);
    raise(20, "claude"); // before the lock, outside the area it will hold
    raise(30, "user"); // the DM's own
    expect(() => s.undo("claude")).toThrow(NotYourChangeError);
    expect(doc.height.data[30 * W + 30]).toBeGreaterThan(100); // the DM's change stays
    s.undo("user");
    s.editLock = lockOf();
    expect(() => s.undo("claude")).toThrow(LockedEditError); // made before the lock: it reaches outside the area
    raise(100, "claude");
    expect(s.undo("claude")?.label).toMatch(/Sculpt|raise/i); // its own, under the lock
    expect(s.redo("claude")).not.toBeNull();
    s.undo("user");
    s.editLock = null;
    expect(s.undo("claude")).not.toBeNull(); // no lock: its own changes, whenever made
    raise(40, "user");
    s.undo("user");
    expect(() => s.redo("claude")).toThrow(NotYourChangeError); // nor make the DM's again
  });

  it("does not hold the DM's own edits, nor Claude's once the lock is off", () => {
    const doc = flatDoc(0), s = new MapSession(doc);
    s.editLock = lockOf();
    s.execute({ op: "sculpt", params: { shape: { type: "circle", x: 20, y: 20, r: 10 }, mode: "raise", amountM: 300 } }, "user");
    expect(doc.height.data[20 * W + 20]).toBeGreaterThan(100);
    s.editLock = null;
    s.execute({ op: "sculpt", params: { shape: { type: "circle", x: 170, y: 170, r: 10 }, mode: "raise", amountM: 300 } }, "claude");
    expect(doc.height.data[170 * W + 170]).toBeGreaterThan(100);
  });

  it("refuses what cannot be held to an area, and features outside it; allows features inside", () => {
    const doc = flatDoc(100), s = new MapSession(doc);
    s.editLock = lockOf();
    expect(() => s.execute({ op: "set_sea_level", levelM: 50 }, "claude")).toThrow(LockedEditError);
    expect(() => s.execute({ op: "set_meta", patch: { climate: { latTop: 0.5, latBot: 0.5 } as never } }, "claude")).toThrow(/climate/);
    expect(() => s.execute({ op: "restore", data: new Float32Array(W * W), meta: {}, label: "x" }, "claude")).toThrow(/checkpoint/);
    expect(() => s.execute({ op: "features", patch: { upsertPlaces: [{ id: "p1", name: "Far", type: "town", x: 10, y: 10 }] } }, "claude")).toThrow(/Far.*outside the selection/);
    expect(() => s.execute({ op: "features", patch: { upsertLines: [{ id: "m1", kind: "road", points: [[70, 70], [190, 70]] }] } }, "claude")).toThrow(/road/);
    expect(() => s.execute({ op: "features", patch: { upsertRegions: [{ id: "r1", name: "Spill", polygon: [[70, 70], [190, 70], [100, 100]] }] } }, "claude")).toThrow(/Spill/);
    s.execute({ op: "features", patch: { upsertPlaces: [{ id: "p2", name: "Near", type: "town", x: 100, y: 100 }], upsertSources: [{ id: "s1", placeId: "p2", size: "river" }] } }, "claude");
    expect(doc.features!.places.map((p) => p.name)).toEqual(["Near"]);
    // moving a place that is inside to a place outside is refused; so is removing one that is outside
    expect(() => s.execute({ op: "features", patch: { upsertPlaces: [{ id: "p2", name: "Near", type: "town", x: 10, y: 100 }] } }, "claude")).toThrow(LockedEditError);
    s.editLock = null;
    s.execute({ op: "features", patch: { upsertPlaces: [{ id: "p3", name: "Elsewhere", type: "town", x: 10, y: 10 }] } }, "claude");
    s.editLock = lockOf();
    expect(() => s.execute({ op: "features", patch: { removePlaces: ["p3"] } }, "claude")).toThrow(/Elsewhere/);
    // the user can still do all of it, and nothing was half-applied
    s.execute({ op: "features", patch: { removePlaces: ["p3"] } }, "user");
    expect(doc.features!.places.map((p) => p.name)).toEqual(["Near"]);
    // style and notes are global but harmless: allowed
    s.execute({ op: "set_meta", patch: { style: "relief" } }, "claude");
  });

  it("reports what a patch would touch outside the lock", () => {
    const f: Features = { ...emptyFeatures(), places: [{ id: "p1", name: "Out", type: "town", x: 5, y: 5 }] };
    expect(featuresOutsideLock({ removePlaces: ["p1"] }, f, lockOf())).toEqual(["the place Out"]);
    expect(featuresOutsideLock({ upsertPlaces: [{ id: "p9", name: "In", type: "town", x: 100, y: 100 }] }, f, lockOf())).toEqual([]);
  });
});

describe("what Claude is told about a selection", () => {
  it("measures an area: size, elevation, land share, what lies inside", () => {
    const doc = flatDoc(-100);
    for (let y = 50; y < 150; y++) for (let x = 50; x < 150; x++) doc.height.data[y * W + x] = 300 + x;
    doc.features = { ...emptyFeatures(), places: [{ id: "p1", name: "Inside", type: "town", x: 100, y: 100 }, { id: "p2", name: "Outside", type: "town", x: 10, y: 10 }], regions: [{ id: "r1", name: "Reg", polygon: [[90, 90], [110, 90], [100, 110]] }, { id: "r2", name: "Far", polygon: [[5, 5], [20, 5], [10, 20]] }] };
    const rep = selectionReport(doc, null, { kind: "area", shape: { type: "rect", x: 50, y: 50, w: 100, h: 100 } });
    expect(rep.bounds).toEqual({ x: 50, y: 50, w: 100, h: 100 });
    expect(rep.sizeKm).toEqual({ w: 400, h: 400 });
    expect(rep.sizeMiles).toEqual({ w: 249, h: 249 });
    expect(rep.areaKm2).toBe(100 * 100 * 16);
    expect(rep.landShare).toBe(1);
    expect(rep.elevationM).toEqual({ min: 350, mean: 400, max: 449 });
    expect(rep.inside!.places).toEqual([{ id: "p1", name: "Inside" }]);
    expect(rep.inside!.regions).toEqual([{ id: "r1", name: "Reg" }]);
    expect(rep.climate).toBeUndefined();
  });
  it("describes a point and a feature, and copes with a feature that is gone", () => {
    const doc = flatDoc(250);
    doc.features = { ...emptyFeatures(), places: [{ id: "p1", name: "Town", type: "town", x: 100, y: 100 }] };
    const p = selectionReport(doc, null, { kind: "point", x: 50.5, y: 60.2 });
    expect(p.point).toMatchObject({ x: 50.5, y: 60.2, elevationM: 250, isLand: true });
    const f = selectionReport(doc, null, { kind: "feature", featureKind: "place", id: "p1" });
    expect(f.feature).toMatchObject({ name: "Town" });
    expect(f.shape).toBeUndefined();
    expect(selectionReport(doc, null, { kind: "feature", featureKind: "place", id: "zzz" }).feature).toBeUndefined();
  });
});
