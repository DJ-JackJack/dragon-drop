import { describe, expect, it } from "vitest";
import {
  MATERIALS, MapSession, battleImageSize, battleSizeError, insertDoor, createBattleDoc, drawBattleOverlay, materialByName, paintFloor, renderBattle, renderBattleFloor,
  roomWalls, toFoundryScene, toUniversalVtt, wallSegments,
} from "../src/index.ts";

const room = () => createBattleDoc({ id: "b", name: "Cellar", squaresX: 20, squaresY: 15, roomMargin: 2 });

describe("battlemap document", () => {
  it("is sized in squares at sub-cell resolution", () => {
    const d = createBattleDoc({ id: "b", name: "B", squaresX: 20, squaresY: 15 });
    expect(d.meta.kind).toBe("battle");
    expect(d.height.w).toBe(160);
    expect(d.height.h).toBe(120);
    expect(d.height.data.every((v) => v === 0)).toBe(true);
    expect(battleImageSize(d.meta.battle!)).toEqual({ w: 1400, h: 1050 });
  });

  it("starts with a floored, walled room when asked", () => {
    const d = room();
    expect(d.height.get(2 * 8 + 1, 2 * 8 + 1)).toBe(1);
    expect(d.height.get(0, 0)).toBe(0);
    expect(d.features!.walls).toHaveLength(1);
    expect(wallSegments(d.features!.walls![0])).toHaveLength(4);
  });

  it("paints floor by shape, in floor cells, with undo", () => {
    const s = new MapSession(room());
    const grass = materialByName("grass")!.id;
    s.execute({ op: "paint_floor", params: { shape: { type: "circle", x: 40, y: 30, r: 8 }, material: grass } }, "user");
    expect(s.doc.height.get(40, 30)).toBe(grass);
    expect(s.doc.height.get(60, 40)).toBe(1);
    s.undo("user");
    expect(s.doc.height.get(40, 30)).toBe(1);
    s.redo("user");
    expect(s.doc.height.get(40, 30)).toBe(grass);
  });

  it("looks materials up by name or first word", () => {
    expect(materialByName("Wood")?.name).toBe("wood planks");
    expect(materialByName("deep water")?.id).toBe(8);
    expect(materialByName("nothing")).toBeUndefined();
    expect(MATERIALS.every((m, i) => m.id === i)).toBe(true);
  });

  it("clamps the material and ignores shapes off the map", () => {
    const d = room();
    expect(paintFloor(d, { shape: { type: "circle", x: -50, y: -50, r: 3 }, material: 5 })).toBeNull();
    paintFloor(d, { shape: { type: "all" }, material: 99 });
    expect(d.height.get(3, 3)).toBe(MATERIALS.length - 1);
  });
});

describe("room walls", () => {
  it("cuts a gap for each door and keeps the edge length", () => {
    const walls = roomWalls("r", 2, 2, 10, 8, [
      { side: "top", offset: 3 },
      { side: "right", offset: 2, width: 2, kind: "secret" },
      { side: "bottom", offset: 1, kind: "window" },
      { side: "left", offset: 0 },
    ]);
    const len = (w: { points: [number, number][] }) => Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1]);
    const total = walls.reduce((n, w) => n + len(w), 0);
    expect(total).toBeCloseTo(2 * (10 + 8));
    expect(walls.filter((w) => w.kind === "door")).toHaveLength(2);
    expect(walls.filter((w) => w.kind === "secret")).toHaveLength(1);
    const top = walls.find((w) => w.kind === "door" && w.points[0][1] === 2 && w.points[1][1] === 2)!;
    expect(top.points[0][0]).toBe(5);
    expect(top.points[1][0]).toBe(6);
    // the bottom window is 1 square from the LEFT end (the room's x=2) even though the edge runs right to left
    const win = walls.find((w) => w.kind === "window")!;
    expect(Math.min(win.points[0][0], win.points[1][0])).toBe(3);
  });
});

describe("rendering", () => {
  it("tiles seamlessly and differs by material", () => {
    const d = createBattleDoc({ id: "b", name: "B", squaresX: 8, squaresY: 8 });
    const tex = (m: number) => {
      paintFloor(d, { shape: { type: "all" }, material: m });
      const out = new Uint8ClampedArray(560 * 560 * 4);
      renderBattleFloor(d, out);
      return out;
    };
    const seen = new Set<string>();
    for (const m of MATERIALS) {
      const img = tex(m.id);
      expect(img[3]).toBe(255);
      seen.add(`${img[0]},${img[1]},${img[2]},${img[4000]},${img[8000]}`);
    }
    expect(seen.size).toBe(MATERIALS.length);
    // texture repeat: floor image is periodic in x and y by 256 texture px (= 256 image px at 70 px squares)
    const grass = tex(5);
    const px = (x: number, y: number) => grass[(y * 560 + x) * 4 + 1];
    expect(px(10, 10)).toBe(px(10 + 256, 10));
    expect(px(10, 10)).toBe(px(10, 10 + 256));
  });

  it("blends material edges softly", () => {
    const d = createBattleDoc({ id: "b", name: "B", squaresX: 8, squaresY: 4 });
    paintFloor(d, { shape: { type: "all" }, material: 3 });
    paintFloor(d, { shape: { type: "rect", x: 32, y: 0, w: 32, h: 32 }, material: 8 });
    const out = new Uint8ClampedArray(560 * 280 * 4);
    renderBattleFloor(d, out);
    const row = 100;
    const blue = (x: number) => out[(row * 560 + x) * 4 + 2] - out[(row * 560 + x) * 4];
    expect(blue(100)).toBeLessThan(0);
    expect(blue(460)).toBeGreaterThan(0);
    // somewhere between them there are intermediate values
    const mid = [270, 275, 280, 285, 290].map(blue);
    expect(Math.max(...mid)).toBeGreaterThan(Math.min(...mid));
  });

  it("draws walls, doors and lights on top", () => {
    const d = room();
    d.features!.walls!.push({ id: "d1", kind: "door", points: [[6, 2], [7, 2]] });
    d.features!.lights!.push({ id: "g1", x: 10, y: 7.5, radius: 5, colour: "#ff0000" });
    const plain = renderBattle(d, { overlay: false });
    const full = renderBattle(d);
    expect(full.w).toBe(1400);
    // wall line at y = 2 squares = 140 px is drawn darker than the bare floor
    const at = (img: typeof plain, x: number, y: number) => img.data[(y * img.w + x) * 4];
    expect(at(full, 300, 140)).toBeLessThan(at(plain, 300, 140));
    // door colour (brownish) at the door: more red than blue
    const o = (140 * 1400 + 455) * 4;
    expect(full.data[o]).toBeGreaterThan(full.data[o + 2]);
    // the red light tints the floor near it
    const li = (525 * 1400 + 740) * 4 + 0, lj = (525 * 1400 + 740) * 4 + 2;
    expect(full.data[li] - full.data[lj]).toBeGreaterThan(plain.data[li] - plain.data[lj]);
    const img = { w: 10, h: 10, data: new Uint8ClampedArray(400) };
    drawBattleOverlay(img, { ...d.meta.battle!, pxPerSquare: 2 }, undefined);
    expect(img.data.every((v) => v === 0)).toBe(true);
  });
});

describe("exports", () => {
  const sample = () => {
    const d = room();
    d.features!.walls!.push(
      { id: "d1", kind: "door", points: [[6, 2], [7, 2]] },
      { id: "d2", kind: "door", points: [[2, 6], [2, 7]], open: true },
      { id: "s1", kind: "secret", points: [[10, 13], [11, 13]], locked: true },
      { id: "win", kind: "window", points: [[18, 5], [18, 6]] },
      { id: "inv", kind: "invisible", points: [[9, 4], [9, 9]] },
    );
    d.features!.lights!.push({ id: "g1", x: 10, y: 7.5, radius: 6, bright: 3, colour: "#ff8800", intensity: 0.8 });
    return d;
  };

  it("Universal VTT: sizes, sight lines, portals and lights", () => {
    const u = toUniversalVtt(sample(), "AAAA");
    expect(u.resolution).toEqual({ map_origin: { x: 0, y: 0 }, map_size: { x: 20, y: 15 }, pixels_per_grid: 70 });
    // the room's outline, then the secret door (wall until it is revealed), the window and the invisible wall: the format has no see-through wall, so they are plain walls
    expect(u.line_of_sight).toHaveLength(4);
    expect(u.line_of_sight[0]).toHaveLength(5); // closed outline repeats the first point
    expect(u.line_of_sight[0][0]).toEqual(u.line_of_sight[0][4]);
    expect(u.line_of_sight[1]).toEqual([{ x: 10, y: 13 }, { x: 11, y: 13 }]);
    expect(u.line_of_sight[2]).toEqual([{ x: 18, y: 5 }, { x: 18, y: 6 }]);
    expect(u.line_of_sight[3]).toEqual([{ x: 9, y: 4 }, { x: 9, y: 9 }]);
    expect(u.objects_line_of_sight).toEqual([]); // (the Universal Battlemap Importer ignores that list, which left a gap tokens could walk through)
    expect(u.portals).toHaveLength(2); // doors only: a VTT turns every portal into a door that opens (a window written here imports as a door)
    expect(u.portals.some((p) => p.position.x === 18 || p.position.x === 10.5)).toBe(false);
    const d1 = u.portals.find((p) => p.position.x === 6.5)!;
    expect(d1.closed).toBe(true);
    expect(d1.rotation).toBe(0);
    const d2 = u.portals.find((p) => p.position.y === 6.5)!;
    expect(d2.closed).toBe(false);
    expect(d2.rotation).toBeCloseTo(Math.PI / 2, 3);
    expect(u.lights[0]).toMatchObject({ position: { x: 10, y: 7.5 }, range: 6, intensity: 0.8, color: "ffff8800", shadows: true });
    expect(u.image).toBe("AAAA");
    expect(() => JSON.parse(JSON.stringify(u))).not.toThrow();
  });

  it("Foundry scene: pixels, grid, walls, doors and lights", () => {
    const f = toFoundryScene(sample(), "maps/cellar.png");
    expect(f.width).toBe(1400);
    expect(f.height).toBe(1050);
    expect(f.grid).toMatchObject({ type: 1, size: 70, distance: 5, units: "ft" });
    // (Foundry v14: the picture belongs to the scene's level, and the walls and lights are tagged to that level)
    expect("background" in f).toBe(false);
    expect(f.levels).toHaveLength(1);
    expect(f.levels[0].background.src).toBe("maps/cellar.png");
    expect(f.initialLevel).toBe(f.levels[0]._id);
    for (const x of [...f.walls, ...f.lights] as { levels: string[] }[]) expect(x.levels).toEqual([f.levels[0]._id]);
    // 4 outline segments + 2 doors + 1 secret + 1 window + 1 invisible
    expect(f.walls).toHaveLength(9);
    const w = f.walls as { c: number[]; door: number; ds: number; move: number; sight: number }[];
    expect(w[0]).toMatchObject({ c: [140, 140, 1260, 140], door: 0, move: 20, sight: 20 });
    expect(w.filter((x) => x.door === 1)).toHaveLength(2);
    expect(w.find((x) => x.c[0] === 140 && x.c[1] === 420 && x.door === 1)!.ds).toBe(1);
    expect(w.find((x) => x.door === 2)!.ds).toBe(2);
    const win = w.find((x) => x.c[0] === 1260 && x.c[1] === 350)!;
    expect(win).toMatchObject({ move: 20, sight: 0 });
    const inv = w.find((x) => x.c[0] === 630)!;
    expect(inv).toMatchObject({ move: 20, sight: 0 });
    expect(f.lights[0]).toMatchObject({ x: 700, y: 525, config: { dim: 30, bright: 15, color: "#ff8800" } });
  });
});

describe("doors in walls", () => {
  const ids = () => { let n = 0; return () => `n${n++}`; };

  it("cuts a gap in the nearest wall and keeps the rest", () => {
    const d = room(); // outer walls: x 2..18, y 2..13
    const res = insertDoor(d.features!.walls!, 8.4, 2.2, 1, "door", ids())!;
    expect(res.remove).toEqual(["w-room"]);
    expect(res.door.points).toEqual([[7.9, 2], [8.9, 2]].map(([x, y]) => [expect.closeTo(x, 5), y]));
    // 3 untouched sides + the two halves of the cut side + the door
    expect(res.add).toHaveLength(6);
    expect(res.add.filter((w) => w.kind === "wall")).toHaveLength(5);
    const len = (w: { points: [number, number][] }) => Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1]);
    expect(res.add.reduce((n, w) => n + len(w), 0)).toBeCloseTo(2 * (16 + 11)); // perimeter unchanged
  });

  it("snaps a door at a corner so it fits, and refuses when no wall is near", () => {
    const d = room();
    const res = insertDoor(d.features!.walls!, 2, 2, 2, "secret", ids())!;
    expect(res.door.kind).toBe("secret");
    expect(Math.min(res.door.points[0][0], res.door.points[1][0])).toBeGreaterThanOrEqual(2);
    expect(Math.min(res.door.points[0][1], res.door.points[1][1])).toBeGreaterThanOrEqual(2);
    expect(insertDoor(d.features!.walls!, 10, 8, 1, "door", ids())).toBeNull();
  });

  it("works through the session, with undo", () => {
    const s = new MapSession(room());
    const res = insertDoor(s.doc.features!.walls!, 10, 13, 1, "door", ids())!;
    s.execute({ op: "features", patch: { removeWalls: res.remove, upsertWalls: res.add } }, "user");
    expect(s.doc.features!.walls!.some((w) => w.kind === "door")).toBe(true);
    s.undo("user");
    expect(s.doc.features!.walls!.map((w) => w.id)).toEqual(["w-room"]);
  });
});

describe("size limits", () => {
  it("accepts normal sizes and explains refusals", () => {
    expect(battleSizeError(30, 20, 70)).toBeNull();
    expect(battleSizeError(2, 20, 70)).toContain("at least");
    expect(battleSizeError(200, 20, 70)).toContain("150");
    expect(battleSizeError(100, 100, 70)).toContain("megapixel");
    expect(battleSizeError(100, 100, 70)).toContain("50 px per square");
  });
});
