/** Roofs on a battlemap: the model, the drawing, and what becomes Foundry tiles with a ceiling each. */
import { describe, expect, it } from "vitest";
import {
  type MapRoof, applyFeaturesPatch, createBattleDoc, deleteFeatures, describeFeaturesPatch, emptyFeatures, featureKindOf, moveFeatures, boxSelect, copyFeatures, pasteFeatures,
  paintFloor, renderBattle, renderBattleRoofPictures, battleRoofRects, renderRoofLayer, renderRoofPicture, roofColour, roofPictureRect, toFoundryLevelsScene,
} from "../src/index.ts";

const spec = { squaresX: 12, squaresY: 10, pxPerSquare: 40, feetPerSquare: 5, sub: 8, gridType: "square" as const };
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const roof = (id: string, extra: Partial<MapRoof> = {}): MapRoof => ({ id, style: "slate", points: rect(2, 2, 8, 6), ...extra });
const at = (img: { w: number; data: Uint8ClampedArray }, xSq: number, ySq: number, px = 40) => {
  const o = (Math.floor(ySq * px) * img.w + Math.floor(xSq * px)) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: img.data[o + 3] };
};

describe("roofs as features", () => {
  const f = () => ({ ...emptyFeatures(), roofs: [roof("f1"), roof("f2", { points: rect(9, 1, 11, 4), style: "tile" })] });

  it("are stored by the feature patch and named in the history", () => {
    const g = applyFeaturesPatch(emptyFeatures(), { upsertRoofs: [roof("f1")] });
    expect(g.roofs).toHaveLength(1);
    expect(applyFeaturesPatch(g, { upsertRoofs: [roof("f1", { style: "thatch" })] }).roofs![0].style).toBe("thatch");
    expect(applyFeaturesPatch(g, { removeRoofs: ["f1"] }).roofs).toEqual([]);
    expect(describeFeaturesPatch({ upsertRoofs: [roof("f1")] })).toBe("Edit roof");
    expect(describeFeaturesPatch({ upsertRoofs: [roof("f1", { name: "Tavern roof" })] })).toBe("Edit Tavern roof");
    expect(describeFeaturesPatch({ upsertRoofs: [roof("a"), roof("b")] })).toBe("Edit 2 roofs");
  });

  it("move, are taken by a box only when wholly inside it, delete, copy and paste like any other feature", () => {
    const x = f();
    expect(featureKindOf(x, "f1")).toBe("roof");
    expect(moveFeatures(x, ["f1"], 1, 2).patch.upsertRoofs![0].points).toEqual(rect(3, 4, 9, 8));
    expect(boxSelect(x, { x0: 0, y0: 0, x1: 9, y1: 7 }, ["roof"])).toEqual(["f1"]);
    expect(boxSelect(x, { x0: 0, y0: 0, x1: 12, y1: 10 }, ["roof"]).sort()).toEqual(["f1", "f2"]);
    expect(deleteFeatures(x, ["f2"])).toEqual({ removeRoofs: ["f2"] });
    const clip = copyFeatures(x, ["f1"])!;
    const pasted = pasteFeatures(clip, 1, 1);
    expect(pasted.patch.upsertRoofs![0]).toMatchObject({ style: "slate", points: rect(3, 3, 9, 7) });
    expect(pasted.patch.upsertRoofs![0].id).not.toBe("f1");
  });

  it("reads a colour as #rrggbb, with or without the hash", () => {
    expect(roofColour("#4a7a8c")).toEqual([74, 122, 140]);
    expect(roofColour("4a7a8c")).toEqual([74, 122, 140]);
    expect(roofColour("blue")).toBeNull();
    expect(roofColour(undefined)).toBeNull();
  });
});

describe("the roof layer", () => {
  it("is see-through everywhere but the roofs, and sized to the map", () => {
    const l = renderRoofLayer(spec, []);
    expect([l.w, l.h]).toEqual([480, 400]);
    expect(l.data.every((v) => v === 0)).toBe(true);
    const r = renderRoofLayer(spec, [roof("f1")]);
    expect(at(r, 5, 4).a).toBe(255); // inside
    expect(at(r, 0.5, 0.5).a).toBe(0); // far outside
  });

  it("throws a soft shadow beyond the eave, to the right and below (light from the top left), but not above or to the left", () => {
    const r = renderRoofLayer(spec, [roof("f1")]);
    const right = at(r, 8.15, 4).a, below = at(r, 5, 6.15).a, left = at(r, 1.85, 4).a, above = at(r, 5, 1.85).a;
    expect(right).toBeGreaterThan(20);
    expect(below).toBeGreaterThan(20);
    expect(right).toBeGreaterThan(left);
    expect(below).toBeGreaterThan(above);
    expect(at(r, 8.15, 4).r).toBeLessThan(40); // (dark)
  });

  it("each look has its own colour: blue-grey slate, red clay, golden thatch, brown shingles", () => {
    const mean = (style: MapRoof["style"]) => {
      const l = renderRoofLayer(spec, [roof("f", { style, flat: true })]);
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 3 * 40; y < 5 * 40; y += 3) for (let x = 3 * 40; x < 7 * 40; x += 3) { const o = (y * l.w + x) * 4; r += l.data[o]; g += l.data[o + 1]; b += l.data[o + 2]; n++; }
      return [r / n, g / n, b / n];
    };
    const [sr, , sb] = mean("slate"), [tr, tg, tb] = mean("tile"), [hr, hg, hb] = mean("thatch"), [wr, wg, wb] = mean("shingle");
    expect(sb).toBeGreaterThan(sr);
    expect(tr).toBeGreaterThan(tg + 40);
    expect(tr).toBeGreaterThan(tb + 40);
    expect(hr).toBeGreaterThan(hb + 40);
    expect(hg).toBeGreaterThan(wg + 15); // thatch is paler than the wood
    expect(wr).toBeGreaterThan(wb + 20);
  });

  it("a pitched roof has a bright slope facing the light, a dark one away from it and a bright ridge; a flat one has none of that", () => {
    const pitched = renderRoofLayer(spec, [roof("f", { points: rect(2, 2, 10, 6) })]); // runs the long way across: the ridge is the middle row, y = 4
    const lit = at(pitched, 6, 2.6).r, shadow = at(pitched, 6, 5.4).r;
    expect(lit).toBeGreaterThan(shadow);
    const flat = renderRoofLayer(spec, [roof("f", { points: rect(2, 2, 10, 6), flat: true })]);
    const avg = (img: typeof flat, y: number) => { let s = 0; for (let x = 4 * 40; x < 9 * 40; x += 2) s += img.data[(Math.floor(y * 40) * img.w + x) * 4]; return s / (5 * 20); };
    expect(avg(pitched, 2.6) / avg(pitched, 5.4)).toBeGreaterThan(1.25); // clearly lit and shadowed
    expect(avg(flat, 2.6) / avg(flat, 5.4)).toBeLessThan(1.15);
  });

  it("a colour replaces the style's own", () => {
    const l = renderRoofLayer(spec, [roof("f", { colour: "#2060d0", flat: true })]);
    const p = at(l, 5, 4);
    expect(p.b).toBeGreaterThan(p.r + 60);
  });

  it("tiles a picture from an asset pack across the roof, one repeat every `tile` squares, and tints it with a colour", () => {
    // a 2 x 2 picture: red, green / blue, white
    const pic = { data: new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 255, 0, 0, 200, 255, 200, 200, 200, 255]), size: 2 };
    const l = renderRoofLayer(spec, [roof("f", { asset: "pack:roof.png", tile: 2, flat: true, points: rect(0, 0, 8, 8) })], { tileFor: (a) => (a === "pack:roof.png" ? pic : null) });
    const near = (p: { r: number; g: number; b: number }, want: [number, number, number]) => expect(Math.abs(p.r - want[0]) + Math.abs(p.g - want[1]) + Math.abs(p.b - want[2])).toBeLessThan(40); // (a little shading and grain lies over it)
    near(at(l, 0.5, 0.5), [200, 0, 0]); // the first quarter of the repeat
    near(at(l, 1.5, 0.5), [0, 200, 0]);
    near(at(l, 0.5, 1.5), [0, 0, 200]);
    near(at(l, 2.5, 0.5), [200, 0, 0]); // and it repeats after two squares
    // a picture that can't be had falls back to the style's own look
    const missing = renderRoofLayer(spec, [roof("f", { asset: "pack:gone.png", flat: true, points: rect(0, 0, 8, 8) })]);
    expect(at(missing, 0.5, 0.5).a).toBe(255);
  });
});

describe("roofs in a render and in a Foundry scene", () => {
  const doc = () => {
    const d = createBattleDoc({ name: "House", squaresX: 12, squaresY: 10, pxPerSquare: 40, feetPerSquare: 5, room: 0 } as never);
    paintFloor(d, { shape: { type: "rect", x: 16, y: 16, w: 64, h: 32 }, material: 4 });
    d.features = { ...d.features!, roofs: [roof("f1")] };
    return d;
  };

  it("an ordinary render never draws them (they would hide the rooms); a preview can, at an opacity", () => {
    const d = doc();
    const plain = renderBattle(d, { overlay: true, lights: false });
    const bare = (() => { const e = doc(); e.features = { ...e.features!, roofs: [] }; return renderBattle(e, { overlay: true, lights: false }); })();
    expect(at(plain, 5, 4)).toEqual(at(bare, 5, 4));
    const faint = renderBattle(d, { overlay: true, lights: false, roofs: 0.5 }), solid = renderBattle(d, { overlay: true, lights: false, roofs: 1 });
    const floor = at(bare, 5, 4), a = at(faint, 5, 4), b = at(solid, 5, 4);
    expect(Math.abs(a.r - floor.r) + Math.abs(a.g - floor.g)).toBeGreaterThan(5);
    expect(Math.abs(b.r - floor.r) + Math.abs(b.g - floor.g)).toBeGreaterThan(Math.abs(a.r - floor.r) + Math.abs(a.g - floor.g));
  });

  it("a roof's own picture is exactly that roof's part of the whole layer, and covers the roof with its eave and shadow", () => {
    const sp = { ...spec };
    const r = roof("f1", { style: "tile", points: [[2, 2], [8, 2], [8, 6], [5, 7.5], [2, 6]] });
    const whole = renderRoofLayer(sp, [r]);
    const own = renderRoofPicture(sp, r)!;
    expect(own).not.toBeNull();
    expect(own.w * own.h * 4).toBe(own.data.length);
    // the same pixels as the whole layer, where the picture is; and nothing of the roof outside it
    let differing = 0, outside = 0;
    for (let y = 0; y < whole.h; y++) for (let x = 0; x < whole.w; x++) {
      const o = (y * whole.w + x) * 4, inside = x >= own.x && x < own.x + own.w && y >= own.y && y < own.y + own.h;
      if (inside) { const q = ((y - own.y) * own.w + (x - own.x)) * 4; for (let c = 0; c < 4; c++) if (whole.data[o + c] !== own.data[q + c]) differing++; }
      else if (whole.data[o + 3] > 0) outside++;
    }
    expect(differing).toBe(0);
    expect(outside).toBe(0); // (the shadow's reach is inside the picture)
    expect(own.w).toBeLessThan(whole.w); // (a roof's picture is smaller than the map's)
    expect(roofPictureRect(sp, r)).toEqual({ x: own.x, y: own.y, w: own.w, h: own.h });
  });

  it("a roof with fewer than three corners, or wholly off the map, has no picture", () => {
    expect(roofPictureRect(spec, roof("a", { points: [[1, 1], [2, 2]] }))).toBeNull();
    expect(renderRoofPicture(spec, roof("a", { points: [[1, 1], [2, 2]] }))).toBeNull();
    expect(roofPictureRect(spec, roof("b", { points: rect(40, 40, 44, 44) }))).toBeNull();
  });

  it("battleRoofRects and renderBattleRoofPictures agree: the pictures one after the other, none for a roof with no rectangle", () => {
    const d = doc();
    d.features = { ...d.features!, roofs: [roof("f1"), roof("bad", { points: [[1, 1], [2, 2]] }), roof("f2", { points: rect(9, 1, 11, 4), style: "tile" })] };
    const rects = battleRoofRects(d);
    expect(rects.map((r) => r !== null)).toEqual([true, false, true]);
    const bytes = renderBattleRoofPictures(d);
    expect(bytes.length).toBe(rects.reduce((n, r) => n + (r ? r.w * r.h * 4 : 0), 0));
    d.features = { ...d.features!, roofs: [] };
    expect(battleRoofRects(d)).toEqual([]);
    expect(renderBattleRoofPictures(d).length).toBe(0);
  });

  it("a level's roofs become a tile each, with a ceiling region over its outline, and a level without roofs gets none", () => {
    const withRoof = doc(), without = doc();
    without.features = { ...without.features!, roofs: [] };
    withRoof.features = { ...withRoof.features!, roofs: [roof("f1", { name: "Tavern roof" }), roof("f2", { points: [[9, 1], [11, 1], [10, 4]], style: "thatch" })] };
    const rects = battleRoofRects(withRoof);
    const s = toFoundryLevelsScene([
      { doc: without, name: "Cellar", bottom: -10, top: 0, image: "maps/cellar.png" },
      { doc: withRoof, name: "Ground floor", bottom: 0, top: 10, image: "maps/ground.png", roofImages: ["maps/ground-roof-1.png", "maps/ground-roof-2.png"] },
    ]);
    const ground = s.levels[1]._id;
    expect(s.levels.map((l) => l.foreground.src)).toEqual([null, null]); // (a foreground never fades: roofs are tiles)
    expect(s.tiles).toHaveLength(2);
    const [a, b] = s.tiles as { texture: { src: string }; x: number; y: number; width: number; height: number; elevation: number; levels: string[]; occlusion: { mode: number; modes: number[]; alpha: number } }[];
    expect(a.texture.src).toBe("maps/ground-roof-1.png");
    // placed by the picture's CENTRE (a tile's x and y are its anchor, which is the centre), at the level's top, in front of nothing else
    expect([a.x, a.y, a.width, a.height]).toEqual([rects[0]!.x + rects[0]!.w / 2, rects[0]!.y + rects[0]!.h / 2, rects[0]!.w, rects[0]!.h]);
    expect(b.texture.src).toBe("maps/ground-roof-2.png");
    expect(a.elevation).toBe(10);
    expect(a.levels).toEqual([ground]);
    // Surface occlusion, written both ways (Foundry's migration of a 14.353 file rebuilds `modes` from `mode`), and fully gone when it fades
    expect(a.occlusion).toEqual({ mode: 2, modes: [2], alpha: 0 });
    // a ceiling over each outline: a rectangle for the rectangle roof, a polygon for the triangle
    const regions = s.regions as { name: string; levels: string[]; elevation: { bottom: number; top: number }; shapes: { type: string; x?: number; points?: number[] }[]; behaviors: { type: string; system: { placement: string; occlusion: boolean } }[] }[];
    expect(regions.map((r) => r.name)).toEqual(["Tavern roof on Ground floor", "Roof 2 on Ground floor"]);
    expect(regions[0].shapes).toMatchObject([{ type: "rectangle", x: 80, y: 80, width: 240, height: 160 }]);
    expect(regions[1].shapes).toMatchObject([{ type: "polygon", points: [360, 40, 440, 40, 400, 160] }]);
    for (const r of regions) {
      expect(r.levels).toEqual([ground]);
      expect(r.elevation).toMatchObject({ bottom: 0, top: 10 });
      expect(r.behaviors).toHaveLength(1);
      expect(r.behaviors[0]).toMatchObject({ type: "defineSurface", system: { placement: "top", occlusion: true } });
    }
  });

  it("a roof without a picture name gets no tile and no ceiling", () => {
    const d = doc();
    const s = toFoundryLevelsScene([{ doc: d, name: "Ground floor", bottom: 0, top: 10, image: "maps/ground.png" }]);
    expect(s.tiles).toEqual([]);
    expect(s.regions).toEqual([]);
  });
});
