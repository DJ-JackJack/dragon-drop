import { describe, expect, it } from "vitest";
import {
  AMBIENT_PRESETS, type MapWall, ambientName, ambientOf, compositeOver, createBattleDoc, drawBattleLights, floorAtFn, paintFloor, renderBattle, renderWallLayer, toFoundryScene, toUniversalVtt,
} from "../src/index.ts";

const wall = (id: string, kind: MapWall["kind"], points: [number, number][], extra: Partial<MapWall> = {}): MapWall => ({ id, kind, points, ...extra });
const spec = (px = 40, ambient?: number) => ({ squaresX: 12, squaresY: 10, pxPerSquare: px, feetPerSquare: 5, sub: 8, gridType: "square" as const, ...(ambient !== undefined && { ambient }) });
const at = (img: { w: number; data: Uint8ClampedArray }, xSq: number, ySq: number, px = 40) => {
  const o = (Math.floor(ySq * px) * img.w + Math.floor(xSq * px)) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: img.data[o + 3] };
};

describe("the wall layer", () => {
  it("is empty without walls and sized to the map", () => {
    const l = renderWallLayer(spec(), []);
    expect([l.w, l.h]).toEqual([480, 400]);
    expect(l.data.every((v) => v === 0)).toBe(true);
  });

  it("draws a wall as opaque grey stone, with a soft shadow on the floor to its right and below (light from the top left)", () => {
    const l = renderWallLayer(spec(), [wall("w", "wall", [[3, 2], [3, 8]])]);
    const stone = at(l, 3, 5);
    expect(stone.a).toBe(255);
    expect(stone.r).toBeGreaterThan(70);
    expect(stone.r).toBeLessThan(220);
    expect(Math.abs(stone.r - stone.b)).toBeLessThan(40); // grey, not coloured
    expect(at(l, 8, 5).a).toBe(0); // far from the wall: nothing
    const east = at(l, 3.28, 5).a, west = at(l, 2.72, 5).a;
    expect(east).toBeGreaterThan(20); // shadow falls on the lit side's opposite: to the right
    expect(east).toBeGreaterThan(west);
    expect(east).toBeLessThan(200); // a shadow, not a second wall
    // and it darkens the floor underneath when laid over a picture
    const floor = { w: l.w, h: l.h, data: new Uint8ClampedArray(l.w * l.h * 4).fill(200) };
    compositeOver(floor, l);
    expect(floor.data[(Math.floor(5 * 40) * l.w + Math.floor(3.28 * 40)) * 4]).toBeLessThan(190);
    expect(floor.data[(Math.floor(5 * 40) * l.w + Math.floor(8 * 40)) * 4]).toBe(200);
  });

  it("is the same every time", () => {
    const w = [wall("w", "wall", [[1, 1], [6, 1], [6, 6]])];
    expect(Array.from(renderWallLayer(spec(), w).data)).toEqual(Array.from(renderWallLayer(spec(), w).data));
  });

  it("fills a corner where two walls meet, and gives a door frame posts", () => {
    const l = renderWallLayer(spec(), [wall("a", "wall", [[2, 2], [6, 2], [6, 6]])]);
    expect(at(l, 6.05, 1.93).a).toBe(255); // the outer corner of the L is stone, not a notch
    const d = renderWallLayer(spec(), [wall("a", "wall", [[2, 4], [4, 4]]), wall("d", "door", [[4, 4], [5, 4]]), wall("b", "wall", [[5, 4], [8, 4]])]);
    expect(at(d, 4, 4).a).toBe(255); // post at the left side of the doorway
    expect(at(d, 5, 4).a).toBe(255); // and the right
  });

  it("draws a shut door in wood, with a gap of floor around it", () => {
    const l = renderWallLayer(spec(), [wall("a", "wall", [[2, 4], [4, 4]]), wall("d", "door", [[4, 4], [6, 4]]), wall("b", "wall", [[6, 4], [8, 4]])]);
    const wood = at(l, 5, 4);
    expect(wood.a).toBeGreaterThan(200);
    expect(wood.r).toBeGreaterThan(wood.b + 40); // brown
    expect(at(l, 5, 3.5).a).toBeLessThan(120); // the floor beside it is not painted over
  });

  it("swings an open door on its first point toward the side that has floor", () => {
    const door = (open: boolean) => [wall("d", "door", [[4, 4], [6, 4]], open ? { open: true } : {})];
    const south = renderWallLayer(spec(), door(true), { floorAt: (_x, y) => y > 4.2 });
    const north = renderWallLayer(spec(), door(true), { floorAt: (_x, y) => y < 3.8 });
    expect(at(south, 4.03, 5).a).toBeGreaterThan(200); // the leaf stands out from the hinge to the south
    expect(at(south, 4.03, 3).a).toBeLessThan(40);
    expect(at(north, 4.03, 3).a).toBeGreaterThan(200);
    expect(at(south, 5, 4).a).toBeLessThan(120); // the doorway itself is open (at most a soft shadow)
    const shut = renderWallLayer(spec(), door(false));
    expect(at(shut, 5, 4).a).toBeGreaterThan(200);
  });

  it("draws windows with pale blue glass, secret doors as stone with a gold mark, and invisible walls faintly", () => {
    const l = renderWallLayer(spec(), [wall("w", "window", [[2, 2], [5, 2]]), wall("s", "secret", [[2, 5], [5, 5]]), wall("i", "invisible", [[2, 8], [8, 8]])]);
    const glass = at(l, 3.5, 2);
    expect(glass.b).toBeGreaterThan(glass.r + 20);
    const sx = at(l, 3.5, 5);
    expect(sx.r).toBeGreaterThan(sx.b + 30); // the gold mark
    expect(at(l, 2.5, 5).a).toBe(255); // the rest of the secret door looks like wall
    let ink = 0;
    for (let x = 80; x < 320; x++) ink = Math.max(ink, l.data[(8 * 40 * l.w + x) * 4 + 3], l.data[((8 * 40 - 1) * l.w + x) * 4 + 3]);
    expect(ink).toBeGreaterThan(60);
    expect(ink).toBeLessThan(200);
  });

  it("is used by the full render, over the floor and under the lights", () => {
    const d = createBattleDoc({ id: "b", name: "b", squaresX: 12, squaresY: 10, pxPerSquare: 40 });
    paintFloor(d, { shape: { type: "rect", x: 0, y: 0, w: 96, h: 80 }, material: 1 });
    d.features = { places: [], labels: [], walls: [wall("w", "wall", [[3, 2], [3, 8]])], lights: [] };
    const img = renderBattle(d);
    const stone = at(img, 3, 5), floor = at(img, 8, 5);
    expect(stone.r).not.toBe(floor.r);
    expect(floorAtFn(d)(5, 5)).toBe(true);
    expect(floorAtFn(d)(-1, 5)).toBe(false);
  });
});

describe("the light level (ambient)", () => {
  const scene = (ambient?: number) => {
    const d = createBattleDoc({ id: "b", name: "b", squaresX: 12, squaresY: 10, pxPerSquare: 40 });
    paintFloor(d, { shape: { type: "rect", x: 0, y: 0, w: 96, h: 80 }, material: 4 });
    if (ambient !== undefined) d.meta.battle!.ambient = ambient;
    d.features = { places: [], labels: [], walls: [wall("w", "wall", [[8, 0], [8, 10]])], lights: [{ id: "l", x: 3, y: 5, radius: 4, colour: "#ffffff" }] };
    return d;
  };

  it("names, clamps and defaults the level", () => {
    expect(ambientOf({})).toBe(1);
    expect(ambientOf({ ambient: 0.5 })).toBe(0.5);
    expect(ambientOf({ ambient: -3 })).toBe(0.05);
    expect(ambientOf({ ambient: 9 })).toBe(1);
    expect(ambientName(AMBIENT_PRESETS.dim)).toBe("dim");
    expect(ambientName(0.7)).toBeNull();
  });

  it("darkens what no light reaches, and leaves the lit floor bright", () => {
    const bright = renderBattle(scene(), { overlay: true, lights: true });
    const dim = renderBattle(scene(0.3), { overlay: true, lights: true });
    const far = at(dim, 6.5, 8.5), farBright = at(bright, 6.5, 8.5);
    expect(far.r).toBeLessThan(farBright.r * 0.5);
    expect(at(dim, 3.05, 5.05).r).toBeGreaterThan(at(bright, 3.05, 5.05).r * 0.95); // right under the light: as bright as ever
    expect(at(dim, 4, 5).r).toBeGreaterThan(far.r * 1.5); // and the pool of light is plainly brighter than the dark around it
    expect(far.b / far.r).toBeGreaterThan(farBright.b / farBright.r); // a little cooler in the dark
    // behind the wall the light doesn't reach: dark too
    expect(at(dim, 9.5, 5).r).toBeLessThan(farBright.r * 0.5);
  });

  it("with the default level, lights only add a glow (nothing is darkened)", () => {
    const d = scene();
    const nolights = renderBattle(d, { overlay: true, lights: false });
    const withLights = renderBattle(d, { overlay: true, lights: true });
    for (const [x, y] of [[6.5, 8.5], [9.5, 5], [11, 1]]) expect(at(withLights, x, y).r).toBe(at(nolights, x, y).r);
    expect(at(withLights, 3.5, 5).r).toBeGreaterThan(at(nolights, 3.5, 5).r);
  });

  it("a map with no lights at all is just dim", () => {
    const d = scene(0.4);
    d.features!.lights = [];
    const img = { w: 480, h: 400, data: new Uint8ClampedArray(480 * 400 * 4).fill(200) };
    drawBattleLights(img, d.meta.battle!, [], []);
    expect(img.data[0]).toBeLessThan(100);
  });

  it("is never baked into the export picture, but travels with the scene as its darkness level", () => {
    const d = scene(0.3);
    const picture = renderBattle(d, { overlay: true, lights: false });
    const bright = renderBattle(scene(), { overlay: true, lights: false });
    expect(Array.from(picture.data.subarray(0, 4000))).toEqual(Array.from(bright.data.subarray(0, 4000)));
    expect(toFoundryScene(d, "x.png")).toMatchObject({ environment: { darknessLevel: 0.7 } });
    expect("environment" in toFoundryScene(scene(), "x.png")).toBe(false);
    expect(toUniversalVtt(d, "AAAA").environment.ambient_light).toBe("ff4d4d4d");
    expect(toUniversalVtt(scene(), "AAAA").environment.ambient_light).toBe("ffffffff");
  });
});
