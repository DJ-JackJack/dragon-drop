import { describe, expect, it } from "vitest";
import {
  type RoofAsset, buildingToRoof, chooseRoof, cleanBuilding, createCityDoc, fittingRoofAssets, groupRoofAssets, matchRoofAssets, pickRoofAsset, rectPolygon, renderCity, roofLookOfAsset,
  opaqueRowCount, roofTileMetres,
} from "../src/index.ts";

/** Paths as they really are in the packs of a big library (FA roof patterns, TC roof tiles, a cyberpunk pack, roof parts under objects...). */
const item = (pack: string, packName: string, p: string, cat: string, w?: number): RoofAsset => ({ id: `${pack}:${p}`, pack, packName, path: p, name: p.split("/").pop()!.replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " "), cat, w });
const FA = (n: string) => item("fa", "FA_Roof_Patterns_A_v3.0", `textures/patterns/normal/Roof_Pattern/${n}.webp`, "patterns", 1024);
const LIB: RoofAsset[] = [
  FA("Roof_Texture_Tile_Purple_A1"), FA("Roof_Texture_Tile_Colorable_A1"), FA("Roof_Texture_Tile_Snowy_A1"), FA("Roof_Texture_Tile_Black_A1"), FA("Roof_Texture_Tile_Red_A1"),
  FA("Roof_Texture_Tile_Red_A2"), FA("Roof_Texture_Tile_Terracotta_Mossy_B1"),
  FA("Roof_Texture_Hay_01_A1"), FA("Roof_Texture_Hay_02_A1"), FA("Roof_Texture_Slate_Black_A1"), FA("Roof_Texture_Slate_Mossy_A2"),
  FA("Roof_Texture_Wood_Ashen_Shingle_A1"), FA("Roof_Texture_Wood_Dark_Shingle_A2"),
  item("tc", "TC Artificial Assets V1.54", "textures/patterns/normal/TC_Roof Tiles 01_2x2.webp", "patterns"),
  item("gf", "GF Cyberpunk City Streets", "textures/roofs/grey mossy/tiles.png", "roofs"), // (another setting)
  item("tc", "TC Artificial Assets V1.54", "textures/objects/TC Artificial Assets/TC Building Structures/Rectangular Roof 1.png", "objects"), // (a whole roof, an object: not a texture)
  item("fa", "FA_Textures_A_v3.58", "textures/patterns/normal/Wall_Pattern/Wall_Texture_Stone_A1.webp", "patterns"), // (not a roof)
  item("fa", "FA_Textures_A_v3.58", "textures/terrain/Floors/Tile_Floor_Red.webp", "terrain"), // (a tile floor, not a roof)
  item("fo", "FA_Objects_A_v3.52", "textures/objects/Structures/Roofs/Chimneys/Chimney_Stone_Slate_A_1x1.webp", "roofs"), // (a roof part, in a folder called Roofs)
  item("fo", "FA_Objects_A_v3.52", "textures/objects/Structures/Roofs/Linings/Roof_Lining_Wood_Ashen_Edge_Ending.webp", "roofs"),
  item("fb", "FA_Textures_A_v3.58", "textures/patterns/normal/Roof_Pattern/Roof_Texture_Tile_Red_A1.webp", "patterns", 1024), // (the same texture, in another pack)
  item("tcm", "TCM Modern Assets Megapack", "textures/patterns/normal/Rooftop_Tile_Gravel.webp", "patterns"), // (modern)
];
const at = (name: string) => LIB.find((a) => a.name === name)!;
const named = (a: RoofAsset[]) => a.map((x) => (x.name ?? "").replace("Roof Texture ", ""));

describe("which pictures are roof textures, and which look each is", () => {
  it("knows the looks from what the packs call them", () => {
    expect(roofLookOfAsset(at("Roof Texture Tile Black A1"))).toBe("tile");
    expect(roofLookOfAsset(at("Roof Texture Tile Terracotta Mossy B1"))).toBe("tile");
    expect(roofLookOfAsset(at("Roof Texture Hay 01 A1"))).toBe("thatch");
    expect(roofLookOfAsset(at("Roof Texture Slate Black A1"))).toBe("slate");
    expect(roofLookOfAsset(at("Roof Texture Wood Ashen Shingle A1"))).toBe("shingle");
    expect(roofLookOfAsset(at("TC Roof Tiles 01 2x2"))).toBe("tile");
  });

  it("leaves out whole-roof objects, roof parts, things that aren't roofs, and roofs of another setting", () => {
    const no = (name: string) => expect(roofLookOfAsset(at(name)), name).toBeNull();
    no("tiles"); // cyberpunk
    no("Rectangular Roof 1"); // an object
    no("Wall Texture Stone A1");
    no("Tile Floor Red");
    no("Chimney Stone Slate A 1x1"); // under objects, though in a folder called Roofs
    no("Roof Lining Wood Ashen Edge Ending");
    no("Rooftop Tile Gravel"); // modern
    // (a pack the person made themselves, or any other name, is judged by the picture's own name)
    expect(roofLookOfAsset({ path: "my/Roofs/thatch_a.png", packName: "Dragon Drop Assets", cat: "roofs" })).toBe("thatch");
    expect(roofLookOfAsset({ path: "my/Roofs/blob.png", cat: "roofs" })).toBeNull(); // (a roof that says nothing of its look)
  });

  it("sorts a library into one pool for each look, in a fixed order, one of each name", () => {
    const pools = groupRoofAssets([...LIB].reverse());
    expect(named(pools.tile)).toEqual(["Tile Black A1", "Tile Colorable A1", "Tile Purple A1", "Tile Red A1", "Tile Red A2", "Tile Snowy A1", "Tile Terracotta Mossy B1", "TC Roof Tiles 01 2x2"]);
    expect(pools.tile.find((a) => a.name?.endsWith("Red A1"))!.pack).toBe("fa"); // (the copy in another pack is left out)
    expect(pools.thatch).toHaveLength(2);
    expect(pools.slate).toHaveLength(2);
    expect(pools.shingle).toHaveLength(2);
    expect(groupRoofAssets([])).toEqual({ slate: [], tile: [], thatch: [], shingle: [] });
  });
});

describe("choosing a roof for a building", () => {
  const pools = groupRoofAssets(LIB);

  it("prefers the pictures that fit wanted words, and falls back to the whole pool when none does", () => {
    expect(named(matchRoofAssets(pools.tile, "red"))).toEqual(["Tile Red A1", "Tile Red A2"]);
    expect(named(matchRoofAssets(pools.tile, "red A2"))).toEqual(["Tile Red A2"]);
    expect(named(matchRoofAssets(pools.tile, "mossy terracotta"))).toEqual(["Tile Terracotta Mossy B1"]);
    expect(matchRoofAssets(pools.tile, "magenta")).toEqual(pools.tile);
    expect(matchRoofAssets(pools.tile)).toEqual(pools.tile);
  });

  it("leaves out the unusual pictures unless they are asked for: snow, uncoloured 'colorable' ones, glazed colours on tiles", () => {
    expect(named(fittingRoofAssets(pools.tile, "tile"))).toEqual(["Tile Black A1", "Tile Red A1", "Tile Red A2", "Tile Terracotta Mossy B1", "TC Roof Tiles 01 2x2"]);
    expect(named(fittingRoofAssets(pools.tile, "tile", "purple"))).toEqual(["Tile Purple A1"]); // (asked for)
    expect(named(fittingRoofAssets(pools.tile, "tile", "snowy"))).toEqual(["Tile Snowy A1"]);
    // and if every picture of a look is unusual, they are all there is
    const only = groupRoofAssets([FA("Roof_Texture_Tile_Snowy_A1")]);
    expect(named(fittingRoofAssets(only.tile, "tile"))).toEqual(["Tile Snowy A1"]);
    for (let i = 0; i < 80; i++) expect(chooseRoof(pools, "tile", `b-${i}`)!.name).not.toMatch(/Purple|Colorable|Snowy/);
    expect(chooseRoof(pools, "tile", "b-1", "purple")!.name).toMatch(/Purple/);
  });

  it("gives a building the same picture every time, and spreads the pictures over many buildings", () => {
    expect(pickRoofAsset(pools.tile, "b-1")).toBe(pickRoofAsset(pools.tile, "b-1"));
    expect(pickRoofAsset([], "b-1")).toBeNull();
    const seen = new Set(Array.from({ length: 80 }, (_, i) => chooseRoof(pools, "tile", `b-${i}`)!.asset));
    expect(seen.size).toBe(5); // every usual tile picture is used
  });

  it("says how many metres one repeat covers: the name's squares, else the picture's width, else four squares", () => {
    expect(roofTileMetres({ path: "x/TC_Roof Tiles 01_2x2.webp" })).toBeCloseTo(3.05, 2);
    expect(roofTileMetres({ path: "x/Roof_Texture_Tile_A1.webp", w: 1024 })).toBeCloseTo(6.1, 1);
    expect(roofTileMetres({ path: "x/roof.png", w: 256 })).toBeCloseTo(1.52, 1);
    expect(roofTileMetres({ path: "x/roof.png" })).toBeCloseTo(6.1, 1);
    expect(roofTileMetres({ path: "x/roof.png", w: 100000 })).toBeCloseTo(24.38, 1); // (at most 16 squares)
  });

  it("chooses a roof picture for a look, or nothing when there is no appropriate one", () => {
    const c = chooseRoof(pools, "thatch", "b-7")!;
    expect(c.asset).toMatch(/^fa:textures\/patterns\/normal\/Roof_Pattern\/Roof_Texture_Hay_0[12]_A1\.webp$/);
    expect(c.tile).toBeCloseTo(6.1, 1);
    expect(c.name).toMatch(/Hay/);
    expect(chooseRoof(pools, "tile", "x", "red")!.asset).toMatch(/Tile_Red/);
    expect(chooseRoof({ ...pools, shingle: [] }, "shingle", "b-7")).toBeNull(); // (no appropriate picture: the look is drawn instead)
    expect(chooseRoof(null, "slate", "b-7")).toBeNull();
    expect(chooseRoof(undefined, "slate", "b-7")).toBeNull();
  });
});

describe("a building with a roof picture", () => {
  const spec = { widthM: 300, heightM: 200, cellM: 2 };
  const pts = rectPolygon(100, 100, 30, 20, 0);

  it("keeps its picture and repeat size when it comes from outside, and drops what isn't one", () => {
    expect(cleanBuilding({ id: "b1", points: pts, asset: "fa:textures/x/roof.webp", tile: 3.456 }, spec)).toMatchObject({ asset: "fa:textures/x/roof.webp", tile: 3.46 });
    expect(cleanBuilding({ id: "b1", points: pts, asset: "not an asset id" }, spec)).toEqual({ id: "b1", points: pts });
    expect(cleanBuilding({ id: "b1", points: pts, asset: "fa:r.webp", tile: 99 }, spec)).toEqual({ id: "b1", points: pts, asset: "fa:r.webp" });
    expect(cleanBuilding({ id: "b1", points: pts, tile: 3 }, spec)).toEqual({ id: "b1", points: pts }); // (a repeat size means nothing without a picture)
  });

  it("is drawn as a picture-tiled roof, tinted only by a colour the person gave, and falls back to its look when the picture can't be had", () => {
    const b = { id: "b1", points: pts, roof: "thatch" as const, asset: "fa:r.webp", tile: 4 };
    expect(buildingToRoof(b)).toEqual({ id: "b1", points: pts, style: "thatch", asset: "fa:r.webp", tile: 4 });
    expect(buildingToRoof({ ...b, colour: "#aa3322" })).toMatchObject({ asset: "fa:r.webp", colour: "#aa3322" });
    const fallback = buildingToRoof(b, false);
    expect(fallback.asset).toBeUndefined();
    expect(fallback.colour).toMatch(/^#[0-9a-f]{6}$/); // (its own shade of the look)
    expect(buildingToRoof({ ...b, tile: undefined }).tile).toBe(6);
  });

  it("is drawn with the picture where the picture is, and with its look where it isn't", () => {
    const d = createCityDoc({ id: "c", name: "C", widthM: 300, heightM: 200 });
    const blue = { data: new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 2 || i % 4 === 3 ? 255 : 20)), size: 8 };
    d.features!.buildings = [
      { id: "pic", points: rectPolygon(60, 100, 30, 20, 0), roof: "thatch", asset: "p:blue.png", flat: true },
      { id: "missing", points: rectPolygon(150, 100, 30, 20, 0), roof: "thatch", asset: "p:gone.png", flat: true },
      { id: "drawn", points: rectPolygon(240, 100, 30, 20, 0), roof: "thatch", flat: true },
    ];
    const r = renderCity(d, { maxSize: 600, tileFor: (a) => (a === "p:blue.png" ? blue : null) });
    const at2 = (m: number, k: number) => r.img.data[(Math.round(100 * r.px) * r.img.w + Math.round(m * r.px)) * 4 + k];
    expect(at2(60, 2)).toBeGreaterThan(at2(60, 0) + 100); // the picture: blue
    expect(at2(150, 0)).toBeGreaterThan(at2(150, 2) + 30); // gone: thatch, straw-coloured, not blue
    expect(at2(240, 0)).toBeGreaterThan(at2(240, 2) + 30); // drawn: thatch
    const noTiles = renderCity(d, { maxSize: 600 }); // (nothing to tile with at all: every building is drawn from its look)
    const o = (Math.round(100 * noTiles.px) * noTiles.img.w + Math.round(60 * noTiles.px)) * 4;
    expect(noTiles.img.data[o]).toBeGreaterThan(noTiles.img.data[o + 2] + 30);
  });
});

describe("the see-through strip at the bottom of a roof picture", () => {
  const pic = (w: number, h: number, solidRows: number, edge = 0) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = y < solidRows ? 255 : y === solidRows ? edge : 0;
    return d;
  };
  it("counts the rows that belong to the roof", () => {
    expect(opaqueRowCount(pic(32, 100, 94), 32, 100)).toBe(94);
    expect(opaqueRowCount(pic(32, 100, 100), 32, 100)).toBe(100); // (nothing to cut)
    expect(opaqueRowCount(pic(32, 100, 91, 120), 32, 100)).toBe(91); // (a faint edge row is not the roof)
  });
  it("leaves a picture that is mostly see-through alone, and counts a row as the roof's only when half of it is solid", () => {
    expect(opaqueRowCount(pic(32, 100, 40), 32, 100)).toBe(100);
    const half = pic(32, 10, 10);
    for (let x = 0; x < 16; x++) half[(9 * 32 + x) * 4 + 3] = 0; // (the last row is solid for exactly half its width)
    expect(opaqueRowCount(half, 32, 10)).toBe(10);
    for (let x = 0; x < 17; x++) half[(9 * 32 + x) * 4 + 3] = 0;
    expect(opaqueRowCount(half, 32, 10)).toBe(9);
  });
});
