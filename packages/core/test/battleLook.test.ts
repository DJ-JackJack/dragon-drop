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

describe("what walls are built of", () => {
  // (a long horizontal wall, looked at on its line, a little inside its top edge, and off it)
  const line = [[1, 5], [11, 5]] as [number, number][];
  const mean = (l: { w: number; data: Uint8ClampedArray }, y: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = 2 * 40; x < 10 * 40; x++) { const o = (y * l.w + x) * 4; r += l.data[o]; g += l.data[o + 1]; b += l.data[o + 2]; n++; }
    return [r / n, g / n, b / n];
  };

  it("is stone without a look, exactly as walls always were", () => {
    const a = renderWallLayer(spec(), [wall("w", "wall", line)]);
    const b = renderWallLayer(spec(), [wall("w", "wall", line, { look: "stone" })]);
    expect(Buffer.from(b.data).equals(Buffer.from(a.data))).toBe(true);
  });

  it("draws each look in its own colours: brick red, wood brown, plaster pale, cave rock dark", () => {
    const col = (look: MapWall["look"]) => mean(renderWallLayer(spec(), [wall("w", "wall", line, { look })]), 198); // (a row inside the wall, off its middle)
    const stone = col("stone"), brick = col("brick"), wood = col("wood"), plaster = col("plaster"), rock = col("rock");
    expect(brick[0] - brick[2]).toBeGreaterThan(stone[0] - stone[2] + 30);
    expect(wood[0] - wood[2]).toBeGreaterThan(30);
    expect(plaster[0] + plaster[1] + plaster[2]).toBeGreaterThan(stone[0] + stone[1] + stone[2] + 120);
    expect(rock[0] + rock[1] + rock[2]).toBeLessThan(stone[0] + stone[1] + stone[2]);
  });

  it("lays a pack picture along the wall when it has one, and its look until the picture is there", () => {
    // a strip: blue top half, yellow bottom half; it lies along the wall, so the wall's top is blue and its bottom yellow
    const strip = { w: 400, h: 40, data: new Uint8ClampedArray(400 * 40 * 4) };
    for (let y = 0; y < 40; y++) for (let x = 0; x < 400; x++) strip.data.set(y < 20 ? [40, 60, 220, 255] : [230, 210, 40, 255], (y * 400 + x) * 4);
    const w = wall("w", "wall", line, { look: "brick", asset: "pack:walls/strip.png" });
    const l = renderWallLayer(spec(), [w], { pictureFor: (a) => (a === "pack:walls/strip.png" ? strip : null) });
    const top = mean(l, 200 - 2), bottom = mean(l, 200 + 2);
    expect(top[2]).toBeGreaterThan(top[0] + 60); // blue
    expect(bottom[0]).toBeGreaterThan(bottom[2] + 60); // yellow
    // not loaded yet: brick
    const waiting = mean(renderWallLayer(spec(), [w], { pictureFor: () => null }), 198);
    expect(waiting[0] - waiting[2]).toBeGreaterThan(40);
    // a square texture is tiled along the wall: a red-and-green checker shows both colours along it
    const sq = { w: 64, h: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) sq.data.set(x < 32 ? [220, 40, 40, 255] : [40, 200, 40, 255], (y * 64 + x) * 4);
    const t = renderWallLayer(spec(), [wall("t", "wall", line, { asset: "sq" })], { pictureFor: () => sq });
    const row = 200, reds: number[] = [], greens: number[] = [];
    for (let x = 2 * 40; x < 6 * 40; x++) { const o = (row * t.w + x) * 4; (t.data[o] > t.data[o + 1] ? reds : greens).push(x); }
    expect(reds.length).toBeGreaterThan(40);
    expect(greens.length).toBeGreaterThan(40);
  });
});

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

describe("stairs, ladders and holes in the wall layer", () => {
  const conn = (id: string, kind: "stairs" | "ladder" | "hole", x: number, y: number, w: number, h: number) => ({ id, kind, x, y, w, h, to: "down" as const });
  const layer = (c: ReturnType<typeof conn>[], walls: MapWall[] = []) => renderWallLayer(spec(), walls, { connectors: c });

  it("paints each one inside its rectangle and nothing outside it, with no walls needed", () => {
    const l = layer([conn("s", "stairs", 2, 2, 1, 3), conn("h", "hole", 5, 2, 2, 2), conn("l", "ladder", 8, 2, 1, 3)]);
    expect(at(l, 2.5, 3).a).toBe(255); // the middle of the stairs
    expect(at(l, 1.5, 3).a).toBe(0);
    expect(at(l, 3.5, 3).a).toBe(0);
    expect(at(l, 6, 3).a).toBeGreaterThan(240); // the pit
    expect(at(l, 4.5, 3).a).toBe(0);
    expect(at(l, 7.2, 3).a).toBe(0);
    expect(at(l, 8.2, 3.5).a).toBeGreaterThan(0); // (a rail)
  });

  it("looks like what it is: pale stone steps, a dark pit with a stone rim, a wooden ladder", () => {
    const l = layer([conn("s", "stairs", 2, 2, 1, 3), conn("h", "hole", 5, 2, 2, 2), conn("l", "ladder", 8, 2, 1, 3)]);
    const stairs = at(l, 2.5, 3.5), pit = at(l, 6, 3), rim = at(l, 5.02, 3), rail = at(l, 8.2, 3.5);
    expect(stairs.r).toBeGreaterThan(120);
    expect(Math.abs(stairs.r - stairs.b)).toBeLessThan(40); // pale grey stone
    expect(pit.r).toBeLessThan(45); // dark
    expect(rim.r).toBeGreaterThan(pit.r + 30); // lighter stone round it
    expect(rail.r).toBeGreaterThan(rail.b + 20); // brown wood
  });

  it("puts steps across the long way: the stripes change along the stairs and hardly across them", () => {
    const l = layer([conn("s", "stairs", 2, 2, 1, 4)]);
    const along = new Set<number>(), across = new Set<number>();
    for (let i = 0; i < 40 * 4; i += 2) along.add(Math.round(at(l, 2.5, 2 + i / 40).r / 12));
    for (let i = 4; i < 36; i += 2) across.add(Math.round(at(l, 2 + i / 40, 4).r / 12));
    expect(along.size).toBeGreaterThan(across.size);
  });

  it("is painted under the walls, and a wall's shadow no longer wipes it out", () => {
    const walls = [wall("w", "wall", [[1, 2], [1, 8]])];
    const l = layer([conn("s", "stairs", 1.1, 3, 1, 3)], walls);
    expect(at(l, 1.2, 4).a).toBe(255); // right beside the wall, in its shadow: still opaque
    const solo = layer([conn("s", "stairs", 1.1, 3, 1, 3)]);
    expect(at(l, 1.2, 4).r).toBeLessThan(at(solo, 1.2, 4).r); // darker: the shadow lies over it
  });

  it("goes into the finished picture of a battlemap (the export draws them too)", () => {
    const d = createBattleDoc({ name: "t", squaresX: 10, squaresY: 8, pxPerSquare: 40, feetPerSquare: 5, room: 0 } as never);
    paintFloor(d, { shape: { type: "rect", x: 0, y: 0, w: 80, h: 64 }, material: 4 });
    const bare = renderBattle(d, { overlay: true, lights: false });
    d.features = { ...d.features!, connectors: [conn("h", "hole", 4, 3, 2, 2)] };
    const withHole = renderBattle(d, { overlay: true, lights: false });
    expect(at(withHole, 5, 4).r).toBeLessThan(at(bare, 5, 4).r - 30);
    expect(at(withHole, 1, 1)).toEqual(at(bare, 1, 1));
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
