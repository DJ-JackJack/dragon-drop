import { describe, expect, it } from "vitest";
import {
  MapSession, addLandmass, addMountainRange, buildNoiseCache, computeDerived, createDoc, decodeFrame, drawRivers,
  encodeFrame, generateTerrain, packDerived, renderPainted, unpackDerived,
} from "../src/index.ts";

function world() {
  const d = createDoc({ id: "p", name: "P", width: 256, height: 256, kmPerPx: 4 });
  generateTerrain(d, { template: "ocean", seed: 1 });
  addLandmass(d, { shape: { type: "circle", x: 128, y: 128, r: 70 }, heightM: 300, seed: 2 });
  addMountainRange(d, { path: [[90, 80], [80, 128], [90, 176]], widthPx: 8, peakM: 3200, seed: 3 });
  d.meta.climate = { latTop: 0.75, latBot: 0.25 };
  return d;
}

describe("painted relief", () => {
  const d = world();
  const noise = buildNoiseCache(256, 256, 1);
  const der = computeDerived(d, noise, 0);

  it("derives climate: colder at the top, coast distances, rivers", () => {
    const top = der.temp[40 * 256 + 128], bottom = der.temp[215 * 256 + 128];
    expect(top).toBeLessThan(bottom);
    expect(der.seaDist[5]).toBeGreaterThan(20);
    expect(der.landDist[128 * 256 + 128]).toBeGreaterThan(20);
    expect(der.rivers.length).toBeGreaterThan(0);
  });

  it("renders a tile exactly like the same area of a full render", () => {
    const full = new Uint8ClampedArray(256 * 256 * 4);
    renderPainted(d, der, noise, null, full);
    const part = new Uint8ClampedArray(256 * 256 * 4);
    const r = { x: 100, y: 110, w: 30, h: 20 };
    renderPainted(d, der, noise, r, part);
    let maxDiff = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(full[(y * 256 + x) * 4 + c] - part[(y * 256 + x) * 4 + c]));
      }
    }
    expect(maxDiff).toBeLessThanOrEqual(1);
    // the same holds on a zoomed-in (regional) map, where coarse landform shading is added
    const zd = { ...d, meta: { ...d.meta, zoom: 4 } };
    const zFull = new Uint8ClampedArray(256 * 256 * 4), zPart = new Uint8ClampedArray(256 * 256 * 4);
    renderPainted(zd, der, noise, null, zFull);
    renderPainted(zd, der, noise, r, zPart);
    let zDiff = 0, changed = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        for (let c = 0; c < 3; c++) {
          const o = (y * 256 + x) * 4 + c;
          zDiff = Math.max(zDiff, Math.abs(zFull[o] - zPart[o]));
          if (zFull[o] !== full[o]) changed++;
        }
      }
    }
    expect(zDiff).toBeLessThanOrEqual(1);
    expect(changed).toBeGreaterThan(100); // zoom really changes the shading
    // land is greenish/brown, sea is blue
    const px = (x: number, y: number) => [full[(y * 256 + x) * 4], full[(y * 256 + x) * 4 + 1], full[(y * 256 + x) * 4 + 2]];
    expect(px(150, 140)[1]).toBeGreaterThan(px(150, 140)[2]);
    expect(px(5, 5)[2]).toBeGreaterThan(px(5, 5)[0]);
    drawRivers({ w: 256, h: 256, data: full }, { x: 0, y: 0, w: 256, h: 256 }, 1, der.rivers);
  });

  it("packs derived layers into a binary frame and back", () => {
    const buf = encodeFrame({ t: "derived", projectId: "p", rect: { x: 0, y: 0, w: 256, h: 256 }, seq: 3, rivers: der.rivers }, packDerived(der));
    const f = decodeFrame(buf);
    const u = unpackDerived(f.bytes, 256, 256, f.header.seq, f.header.rivers ?? []);
    expect(u.temp).toEqual(der.temp);
    expect(u.lakes).toEqual(der.lakes);
    expect(u.rivers.length).toBe(der.rivers.length);
  });

  it("style and climate changes are undoable", () => {
    const s = new MapSession(world());
    s.execute({ op: "set_meta", patch: { style: "relief", climate: { latTop: 0.1, latBot: 0.0 } } }, "claude");
    expect(s.doc.meta.style).toBe("relief");
    s.undo("user");
    expect(s.doc.meta.style).toBeUndefined();
    expect(s.doc.meta.climate).toEqual({ latTop: 0.75, latBot: 0.25 });
  });
});

describe("noise bands", () => {
  it("bands built separately match a full build exactly", async () => {
    const { buildNoiseCache, buildNoiseBand, mergeNoiseBands } = await import("../src/index.ts");
    const W = 90, H = 77, seed = 11;
    const full = buildNoiseCache(W, H, seed);
    const merged = mergeNoiseBands([buildNoiseBand(W, H, seed, 0, 20), buildNoiseBand(W, H, seed, 20, 51), buildNoiseBand(W, H, seed, 51, 77)]);
    for (const k of ["mtn", "hills", "canopy", "clump", "hue", "rock", "fine", "oceanLarge", "oceanSmall", "shelfWarp", "climateT", "climateM", "climateDetail"] as const) {
      expect(Array.from(merged[k]), k).toEqual(Array.from(full[k]));
    }
  });
});

describe("upscale", () => {
  it("doubles the size, keeps the coastline shape, and scales names with it", async () => {
    const { upscaleHeights, bicubicUpsample, scaleFeatures, createDoc, addLandmass } = await import("../src/index.ts");
    const d = createDoc({ id: "u", name: "u", width: 256, height: 200, seed: 3 });
    addLandmass(d, { shape: { type: "circle", x: 128, y: 100, r: 60 }, heightM: 900, seed: 3 });
    const up = upscaleHeights(d.height.data, 256, 200, 0, { seed: 3, erosionPasses: 1 });
    expect([up.W, up.H]).toEqual([512, 400]);
    const land = (a: Float32Array) => a.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    // the added detail (coast wiggle, ridges, erosion) keeps the smooth upsampled land area
    const smoothArea = land(bicubicUpsample(d.height.data, 256, 200, 2)), after = land(up.data);
    expect(Math.abs(after - smoothArea) / smoothArea).toBeLessThan(0.01);
    expect(Math.abs(after - land(d.height.data) * 4) / after).toBeLessThan(0.05);
    // centre stays land, corners stay sea
    expect(up.data[200 * 512 + 256]).toBeGreaterThan(0);
    expect(up.data[0]).toBeLessThan(0);
    const f = scaleFeatures({ places: [{ id: "p", name: "A", type: "town", x: 10, y: 20 }], labels: [{ id: "l", text: "B", kind: "sea", x: 5, y: 6, size: 1.2 }] }, 2);
    expect(f.places[0]).toMatchObject({ x: 20, y: 40 });
    expect(f.labels[0]).toMatchObject({ x: 10, y: 12, size: 1.2 });
  });
});

describe("climate noise", () => {
  it("the cheap climate-only build matches the full build's climate layers", async () => {
    const { buildNoiseCache, buildClimateNoise } = await import("../src/index.ts");
    const full = buildNoiseCache(120, 90, 5), cl = buildClimateNoise(120, 90, 5);
    for (const k of ["climateT", "climateM", "climateDetail"] as const) expect(Array.from(cl[k]), k).toEqual(Array.from(full[k]));
  });
});

describe("climate regions", () => {
  it("override temperature and moisture inside, leave outside alone, add ground snow", async () => {
    const { applyClimateRegions, regionWeight } = await import("../src/index.ts");
    const W = 100, H = 80;
    const temp = new Float32Array(W * H).fill(0.7), moist = new Float32Array(W * H).fill(0.5);
    const region = { id: "r", name: "Frost", polygon: [[20, 20], [60, 20], [60, 60], [20, 60]] as [number, number][], temperature: 0.05, snow: 1, border: "hard" as const };
    const snow = applyClimateRegions([region], temp, moist, W, H, 10);
    expect(temp[40 * W + 40]).toBeCloseTo(0.05, 2);
    expect(temp[10 * W + 80]).toBeCloseTo(0.7, 5);
    expect(moist[40 * W + 40]).toBeCloseTo(0.5, 5); // moisture not set: untouched
    expect(snow[40 * W + 40]).toBe(255);
    expect(snow[10 * W + 80]).toBe(0);
    // a soft border ramps across roughly blendKm
    const soft = regionWeight({ ...region, border: "soft", blendKm: 200 }, W, H, 10)!;
    const at = (x: number, y: number) => soft.data[(y - soft.y0) * soft.w + (x - soft.x0)];
    expect(at(40, 40)).toBeGreaterThan(0.9);
    expect(at(60, 40)).toBeGreaterThan(0.35);
    expect(at(60, 40)).toBeLessThan(0.65);
    expect(at(75, 40)).toBeLessThan(0.1);
  });
});

describe("regional maps", () => {
  it("plans areas, copies names, and round-trips the inherited climate", async () => {
    const { planRegional, regionalFeatures, packBaseClimate, unpackBaseClimate } = await import("../src/index.ts");
    expect(planRegional({ x: 10, y: 10, w: 10, h: 10 }, 1024, 1024)).toHaveProperty("error");
    const plan = planRegional({ x: 100.4, y: 50.2, w: 200.3, h: 100 }, 1024, 1024);
    expect(plan).toMatchObject({ rect: { x: 100, y: 50, w: 201, h: 101 }, factor: 8, width: 1608, height: 808 });
    expect(planRegional({ x: 0, y: 0, w: 1500, h: 1500 }, 2048, 2048)).toHaveProperty("error");
    const f = regionalFeatures(
      { places: [{ id: "a", name: "In", type: "town", x: 110, y: 60 }, { id: "b", name: "Out", type: "town", x: 5, y: 5 }],
        labels: [{ id: "l", text: "Ridge", kind: "range", x: 150, y: 80, path: [[120, 70], [180, 90]] }] },
      { x: 100, y: 50, w: 201, h: 101 }, 8);
    expect(f.places).toHaveLength(1);
    expect(f.places[0]).toMatchObject({ x: 80, y: 80 });
    expect(f.labels[0].path).toEqual([[160, 160], [640, 320]]);
    const b = { w: 3, h: 2, temp: Uint8Array.from([1, 2, 3, 4, 5, 6]), moist: Uint8Array.from([7, 8, 9, 10, 11, 12]), snow: Uint8Array.from([0, 0, 9, 0, 0, 0]),
      lakes: Uint8Array.from([0, 1, 0, 0, 0, 1]), elev: Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) };
    const r = unpackBaseClimate(packBaseClimate(b));
    expect(r).toMatchObject({ w: 3, h: 2 });
    expect(Array.from(r.lakes)).toEqual([0, 1, 0, 0, 0, 1]);
    expect(Array.from(r.temp)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(r.elev).map((v) => +v.toFixed(2))).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  });

  it("has lakes only where the parent has them", async () => {
    const { computeHydrology } = await import("../src/index.ts");
    const W = 64, H = 64;
    const h = new Float32Array(W * H).fill(300);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) h[y * W + x] = 300 + (x - 32) * 2 + (y - 32) * 1;
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) h[y * W + x] = 150; // a deep hollow
    for (let x = 0; x < W; x++) h[x] = -50; // a sea edge so water can drain
    const open = computeHydrology(h, W, H, 0, { riverDensity: 0.5 });
    const masked = computeHydrology(h, W, H, 0, { riverDensity: 0.5, lakeMask: new Uint8Array(W * H) });
    const count = (a: Uint8Array) => a.reduce((n, v) => n + v, 0);
    expect(count(open.lakes)).toBeGreaterThan(0);
    expect(count(masked.lakes)).toBe(0);
  });
});

describe("roads and borders", () => {
  const makeDoc = () => {
    const d = createDoc({ id: "r", name: "r", width: 200, height: 120, kmPerPx: 2, seed: 2 });
    d.height.data.fill(200); // lowland everywhere
    for (let y = 0; y < 120; y++) for (let x = 90; x < 110; x++) d.height.data[y * 200 + x] = y > 40 && y < 80 ? 200 : 2800; // a wall of mountains with a pass at y 41-79
    return d;
  };

  it("routes through the pass instead of over the mountains, and avoids the sea", async () => {
    const { routeWaypoints } = await import("../src/index.ts");
    const d = makeDoc();
    const r = routeWaypoints(d, null, [[20, 20], [180, 20]]);
    if ("error" in r) throw new Error(r.error);
    const crossings = r.points.filter((p) => p[0] > 92 && p[0] < 108);
    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings.every((p) => p[1] > 38 && p[1] < 82)).toBe(true); // goes via the pass
    expect(r.lengthKm).toBeGreaterThan(160 * 2); // longer than the straight line (160 px x 2 km)
    // a sea channel with no land crossing: no route
    for (let y = 0; y < 120; y++) for (let x = 90; x < 110; x++) d.height.data[y * 200 + x] = -400;
    expect(routeWaypoints(d, null, [[20, 20], [180, 20]])).toHaveProperty("error");
  });

  it("prefers existing roads, and clips lines to an area", async () => {
    const { routeWaypoints, clipLine, scaleFeatures } = await import("../src/index.ts");
    const d = makeDoc();
    d.features = { places: [], labels: [], lines: [{ id: "old", kind: "road", points: [[20, 100], [100, 60], [180, 100]] }] };
    const r = routeWaypoints(d, null, [[22, 98], [178, 98]]);
    if ("error" in r) throw new Error(r.error);
    // it follows the old road up through the pass rather than crossing the mountain wall low down
    expect(Math.min(...r.points.filter((p) => p[0] > 92 && p[0] < 108).map((p) => p[1]))).toBeLessThan(90);
    const runs = clipLine({ id: "b", kind: "border", points: [[0, 5], [50, 5], [50, 50], [0, 50]], closed: true }, { x: 10, y: 0, w: 20, h: 100 });
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((l) => l.points.every(([x]) => x >= 10 - 1e-9 && x <= 30 + 1e-9))).toBe(true);
    const whole = clipLine({ id: "c", kind: "border", points: [[15, 10], [25, 10], [25, 20]], closed: true }, { x: 10, y: 0, w: 20, h: 100 });
    expect(whole).toHaveLength(1);
    expect(whole[0].closed).toBe(true);
    expect(scaleFeatures({ places: [], labels: [], lines: [{ id: "l", kind: "trail", points: [[1, 2], [3, 4]] }] }, 2).lines![0].points).toEqual([[2, 4], [6, 8]]);
  });
});

describe("grid", () => {
  it("grid changes undo and redo like other map settings", async () => {
    const { MapSession } = await import("../src/index.ts");
    const sess = new MapSession(createDoc({ id: "g", name: "g", width: 64, height: 64 }));
    sess.execute({ op: "set_meta", patch: { grid: { type: "hex", sizeMi: 6 } }, label: "Hex" }, "user");
    sess.execute({ op: "set_meta", patch: { grid: { type: "square", sizeMi: 10 } }, label: "Square" }, "user");
    expect(sess.doc.meta.grid).toMatchObject({ type: "square", sizeMi: 10 });
    sess.undo("user");
    expect(sess.doc.meta.grid).toMatchObject({ type: "hex", sizeMi: 6 });
    sess.undo("user");
    expect(sess.doc.meta.grid).toBeUndefined();
    sess.redo("user");
    expect(sess.doc.meta.grid).toMatchObject({ type: "hex", sizeMi: 6 });
  });

  it("sizes cells in map px, picks a tidy default and lays hexes edge to edge", async () => {
    const { gridCellPx, niceGridSize, clampGridSize, hexCorners, hexCentre, describeGrid } = await import("../src/index.ts");
    // 6 miles at 3.902 km per px is about 2.47 px
    expect(gridCellPx({ type: "hex", sizeMi: 6 }, 3.902)).toBeCloseTo(6 / 0.621371 / 3.902, 6);
    expect(niceGridSize(4967)).toBe(100);
    expect(niceGridSize(620)).toBe(20);
    expect(clampGridSize(1e6, 100)).toBe(50);
    expect(clampGridSize(0.001, 100)).toBe(0.1);
    expect(describeGrid({ type: "hex", sizeMi: 6 })).toBe("Hex grid, 6 mi");
    expect(describeGrid({ type: "off", sizeMi: 6 })).toBe("Grid off");
    for (const orient of ["pointy", "flat"] as const) {
      // neighbours are exactly `size` apart, and the shared edge's corners coincide
      const size = 10;
      const a = hexCentre(0, 0, size, orient), b = orient === "pointy" ? hexCentre(1, 0, size, orient) : hexCentre(0, 1, size, orient);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(size, 6);
      const ca = hexCorners(a[0], a[1], size, orient), cb = hexCorners(b[0], b[1], size, orient);
      const shared = ca.filter((p) => cb.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6));
      expect(shared).toHaveLength(2);
      // the odd row (or column) sits half a cell over, and its neighbours still touch
      const c = hexCentre(0, 1, size, orient), d = hexCentre(orient === "pointy" ? 0 : 1, orient === "pointy" ? 0 : 0, size, orient);
      expect(Math.hypot(c[0] - d[0], c[1] - d[1])).toBeCloseTo(size, 6);
    }
  });
});

describe("map extras and exports", () => {
  it("picks tidy scale bars and describes extras", async () => {
    const { niceLength, scaleBarFor, hasFurniture, describeFurniture } = await import("../src/index.ts");
    expect(niceLength(0.7)).toBe(0.5);
    expect(niceLength(130)).toBe(100);
    expect(niceLength(240)).toBe(200);
    expect(niceLength(5000)).toBe(5000);
    // a 2048 px map at 3.902 km/px: 16% of the width is about 800 mi, so the bar is 500 mi
    const bar = scaleBarFor(2048, 3.902, "miles");
    expect(bar).toMatchObject({ value: 500, unit: "mi" });
    expect(bar.px).toBeCloseTo(500 / (3.902 * 0.621371), 3);
    expect(scaleBarFor(2048, 3.902, "km")).toMatchObject({ value: 1000, unit: "km" });
    expect(hasFurniture(undefined)).toBe(false);
    expect(hasFurniture({ title: "  " })).toBe(false);
    expect(describeFurniture({ title: "Test World", compass: true })).toBe("Map extras: title, compass");
  });

  it("plans single images and tiles", async () => {
    const { planExport } = await import("../src/index.ts");
    expect(planExport(2048, 2048, 2)).toMatchObject({ width: 4096, height: 4096, tiled: false, tiles: [{ x: 0, y: 0, w: 4096, h: 4096 }] });
    expect(planExport(2048, 2048, 4)).toMatchObject({ width: 8192, tiled: false });
    const big = planExport(2048, 2048, 8);
    expect(big).toMatchObject({ width: 16384, tiled: true, cols: 4, rows: 4 });
    expect(big.tiles).toHaveLength(16);
    expect(big.tiles.reduce((n, t) => n + t.w * t.h, 0)).toBe(16384 * 16384);
    const odd = planExport(1000, 600, 9); // 9000 x 5400: 3 x 2 tiles, the last ones smaller
    expect(odd).toMatchObject({ cols: 3, rows: 2 });
    expect(odd.tiles.at(-1)).toMatchObject({ x: 8192, y: 4096, w: 808, h: 1304 });
  });

  it("writes a valid ZIP (checked by reading it back)", async () => {
    const { createZip, crc32 } = await import("../src/index.ts");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926); // the standard CRC-32 check value
    const a = new Uint8Array(1000).map((_, i) => (i * 7) & 255), b = new TextEncoder().encode("hello tiles");
    const zip = createZip([{ name: "a_r1_c1.png", data: a }, { name: "README.txt", data: b }]);
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(zip.length - 22 + 10, true)).toBe(2);
    let p = dv.getUint32(zip.length - 22 + 16, true); // start of the central directory
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(dv.getUint32(p, true)).toBe(0x02014b50);
      const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nameLen = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
      seen.push(name);
      const lNameLen = dv.getUint16(off + 26, true), dataStart = off + 30 + lNameLen;
      expect(crc32(zip.subarray(dataStart, dataStart + size))).toBe(crc);
      p += 46 + nameLen;
    }
    expect(seen).toEqual(["a_r1_c1.png", "README.txt"]);
  });

  it("map extras undo like other settings", async () => {
    const { MapSession } = await import("../src/index.ts");
    const sess = new MapSession(createDoc({ id: "f", name: "f", width: 64, height: 64 }));
    sess.execute({ op: "set_meta", patch: { furniture: { title: "A", scaleBar: true } } }, "user");
    sess.execute({ op: "set_meta", patch: { furniture: { title: "B", compass: true } } }, "user");
    sess.undo("user");
    expect(sess.doc.meta.furniture).toMatchObject({ title: "A", scaleBar: true });
    sess.undo("user");
    expect(sess.doc.meta.furniture).toBeUndefined();
  });
});

describe("sketch to terrain", () => {
  /** A 200 x 160 drawing: background colour, with the callback painting shapes. */
  const drawing = (bg: [number, number, number], paint: (set: (x: number, y: number, c: [number, number, number]) => void) => void) => {
    const w = 200, h = 160, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
    paint((x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) { const o = (y * w + x) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; } });
    return { w, h, data };
  };

  it("finds the sea colour and turns a filled drawing with a red range into land, sea and mountains", async () => {
    const { detectSeaColour, sketchToHeights } = await import("../src/index.ts");
    const img = drawing([30, 60, 130], (set) => {
      for (let y = 0; y < 160; y++) for (let x = 0; x < 200; x++) if (Math.hypot(x - 100, y - 80) < 50) set(x, y, [90, 150, 70]); // an island
      for (let x = 55; x < 145; x++) for (let t = -1; t <= 1; t++) set(x, 80 + t, [220, 40, 40]); // a red line across it
    });
    const sea = detectSeaColour(img);
    expect(Math.abs(sea[0] - 30) + Math.abs(sea[1] - 60) + Math.abs(sea[2] - 130)).toBeLessThan(10);
    const r = sketchToHeights(img, { W: 256, H: 256, seaLevel: 0 }, { seed: 4, erosionPasses: 0 });
    // the drawing is scaled to 235 x 188 px; the island (radius 50 of 200) becomes radius about 59: about 0.17 of the map
    expect(r.landFraction).toBeGreaterThan(0.13);
    expect(r.landFraction).toBeLessThan(0.21);
    const at = (x: number, y: number) => r.data[y * 256 + x];
    expect(at(128, 128)).toBeGreaterThan(1200); // on the red line: a mountain range
    expect(at(128, 100)).toBeGreaterThan(0); // island away from the line: land
    expect(at(128, 100)).toBeLessThan(at(128, 128)); // ... lower than the range
    expect(at(4, 4)).toBeLessThan(-1000); // far sea: deep
    expect(r.mountainCells).toBeGreaterThan(0);
  });

  it("outline-only drawings: enclosed 'land' fills the island, 'sea' leaves a ring", async () => {
    const { sketchToHeights } = await import("../src/index.ts");
    const ring = drawing([255, 255, 255], (set) => {
      for (let y = 0; y < 160; y++) for (let x = 0; x < 200; x++) { const d = Math.hypot(x - 100, y - 80); if (d > 48 && d < 52) set(x, y, [0, 0, 0]); }
    });
    const common = { W: 256, H: 256, seaLevel: 0 };
    const filled = sketchToHeights(ring, common, { enclosed: "land", mountainColour: null, seed: 2, erosionPasses: 0 });
    const hollow = sketchToHeights(ring, common, { enclosed: "sea", mountainColour: null, seed: 2, erosionPasses: 0 });
    expect(filled.data[128 * 256 + 128]).toBeGreaterThan(50); // the middle is land
    expect(hollow.data[128 * 256 + 128]).toBeLessThan(0); // the middle is water, inside a ring of land
    expect(filled.landFraction).toBeGreaterThan(hollow.landFraction * 3);
  });

  it("'whole' stretches the drawing over the map and 'contain' keeps its proportions", async () => {
    const { sketchRegion } = await import("../src/index.ts");
    expect(sketchRegion(200, 100, 1000, 1000, "whole")).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
    const r = sketchRegion(200, 100, 1000, 1000, "contain", 0.05);
    expect(r.w / r.h).toBeCloseTo(2, 1);
    expect(r.w).toBe(900);
    expect(r.x).toBe(50);
  });
});
