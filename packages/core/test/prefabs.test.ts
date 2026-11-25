import { describe, expect, it } from "vitest";
import {
  CUSTOM_MATERIAL_BASE, MapSession, type Prefab, createBattleDoc, describePrefab, encodeFloor, makePrefab, placePrefab, prefabDoc, prefabFloor, readPrefab, turnPoint, turnPrefab,
} from "../src/index.ts";

/** A 12 x 10 battlemap with a 4 x 3 room at (2, 2): floor 1 (flagstone) but one carpet square (11) in its top-left, a door, a chair turned 30°, a light. */
function world() {
  const d = createBattleDoc({ id: "b", name: "Keep", squaresX: 12, squaresY: 10 });
  const s = d.meta.battle!.sub, hf = d.height;
  for (let y = 2 * s; y < 5 * s; y++) for (let x = 2 * s; x < 6 * s; x++) hf.data[y * hf.w + x] = 1;
  for (let y = 2 * s; y < 3 * s; y++) for (let x = 2 * s; x < 3 * s; x++) hf.data[y * hf.w + x] = 11;
  d.features = {
    places: [], labels: [],
    walls: [
      { id: "w1", kind: "wall", points: [[2, 2], [6, 2], [6, 5], [2, 5], [2, 2]] },
      { id: "w2", kind: "door", points: [[3, 5], [4, 5]] },
      { id: "w3", kind: "wall", points: [[8, 1], [11, 1]] }, // (outside the room)
    ],
    props: [{ id: "o1", asset: "pack:chair.png", x: 5.5, y: 2.5, rotation: 30 }],
    lights: [{ id: "g1", x: 3, y: 3, radius: 4 }],
  };
  return d;
}

describe("prefabs", () => {
  it("saves the floor and what lies inside the area, measured from its corner", () => {
    const p = makePrefab(world(), { x: 2, y: 2, w: 4, h: 3 }, "  Guard   post ") as Prefab;
    expect(p.name).toBe("Guard post");
    expect([p.w, p.h]).toEqual([4, 3]);
    expect(p.features.walls.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(p.features.walls[0].points[0]).toEqual([0, 0]);
    expect(p.features.props[0]).toMatchObject({ x: 3.5, y: 0.5, rotation: 30 });
    expect(p.features.lights[0]).toMatchObject({ x: 1, y: 1 });
    const floor = prefabFloor(p);
    expect(floor[0]).toBe(11);
    expect(floor[floor.length - 1]).toBe(1);
    expect(describePrefab(p)).toBe("4 x 3 squares: floor, 1 wall, 1 door, 1 object, 1 light");
    expect(makePrefab(world(), { x: 8, y: 6, w: 3, h: 3 }, "Empty")).toEqual({ error: expect.stringMatching(/nothing in that area/) });
    expect(makePrefab(world(), { x: 0, y: 0, w: 4, h: 4 }, " ")).toEqual({ error: expect.stringMatching(/needs a name/) });
  });

  it("keeps the walls of a room cut out of a bigger floor: walls across the edge are cut there, doors kept only whole (the 0.1.13 playtest)", () => {
    const d = world();
    // the outline traced round all the floor (one closed wall, as Walls around the floor makes it), running past the area on the right and below
    d.features!.walls = [
      { id: "out", kind: "wall", closed: true, auto: true, points: [[2, 2], [10, 2], [10, 8], [2, 8]] },
      { id: "d1", kind: "door", points: [[3, 2], [4, 2]] },
      { id: "d2", kind: "door", points: [[5.5, 2], [6.5, 2]] }, // (across the area's edge: left out, not cut)
      { id: "inner", kind: "wall", points: [[4, 4], [8, 4]] }, // (an open wall crossing the edge)
    ];
    const p = makePrefab(d, { x: 2, y: 2, w: 4, h: 4 }, "Corner room") as Prefab;
    const byId = new Map(p.features.walls.map((w) => [w.id, w]));
    // the outline's part inside: from the area's right edge along the top, down the left side, along the bottom... the bottom (y 8) is outside, so it stops at the left edge's end
    expect(byId.get("out")).toMatchObject({ kind: "wall", points: [[0, 4], [0, 0], [4, 0]] });
    expect(byId.get("out")!.closed).toBeUndefined();
    expect(byId.get("out")!.auto).toBeUndefined();
    expect(byId.get("d1")!.points).toEqual([[1, 0], [2, 0]]);
    expect(byId.has("d2")).toBe(false);
    expect(byId.get("inner")!.points).toEqual([[2, 2], [4, 2]]);
    expect(describePrefab(p)).toMatch(/2 walls, 1 door/);
    // a wall that leaves the area and comes back is two pieces with ids of their own
    d.features!.walls = [{ id: "zig", kind: "wall", points: [[2.5, 3], [8, 3], [8, 5], [3, 5]] }];
    const z = makePrefab(d, { x: 2, y: 2, w: 4, h: 4 }, "Zig") as Prefab;
    expect(z.features.walls.map((w) => [w.id, w.points])).toEqual([["zig", [[0.5, 1], [4, 1]]], ["zig-2", [[4, 3], [1, 3]]]]);
    // a closed wall wholly inside stays closed
    d.features!.walls = [{ id: "ring", kind: "wall", closed: true, points: [[3, 3], [5, 3], [5, 5], [3, 5]] }];
    expect((makePrefab(d, { x: 2, y: 2, w: 4, h: 4 }, "Ring") as Prefab).features.walls[0]).toMatchObject({ closed: true, points: [[1, 1], [3, 1], [3, 3], [1, 3]] });
  });

  it("turns and mirrors: a corner goes where it should, objects turn with it", () => {
    expect(turnPoint(0, 0, 4, 3, 90, false)).toEqual([3, 0]); // top-left to top-right
    expect(turnPoint(4, 0, 4, 3, 90, false)).toEqual([3, 4]);
    expect(turnPoint(0, 0, 4, 3, 0, true)).toEqual([4, 0]);
    const p = makePrefab(world(), { x: 2, y: 2, w: 4, h: 3 }, "Post") as Prefab;
    const t = turnPrefab(p, 90);
    expect([t.w, t.h]).toEqual([3, 4]);
    // the carpet square (top-left) is now top-right
    const f = prefabFloor(t), s = t.sub, cw = t.w * s;
    expect(f[0]).toBe(1);
    expect(f[cw - 1]).toBe(11);
    expect(t.features.props[0]).toMatchObject({ x: 2.5, y: 3.5, rotation: 120 });
    const m = turnPrefab(p, 0, true);
    expect(m.features.props[0]).toMatchObject({ x: 0.5, rotation: 330, flip: true });
    expect(prefabFloor(m)[p.w * s - 1]).toBe(11);
    // four quarter turns bring it back
    const back = turnPrefab(turnPrefab(turnPrefab(t, 90), 90), 90);
    expect(back.floor).toEqual(p.floor);
    expect(back.features.walls[0].points).toEqual(p.features.walls[0].points);
  });

  it("places one as a single edit with new ids, covering the floor only where it has floor", () => {
    const p = makePrefab(world(), { x: 2, y: 2, w: 4, h: 3 }, "Post") as Prefab;
    const target = createBattleDoc({ id: "t", name: "Camp", squaresX: 20, squaresY: 20 });
    const hf = target.height, s = target.meta.battle!.sub;
    hf.data.fill(5); // grass everywhere
    // (a hole of void in the prefab's floor would leave the grass)
    const r = placePrefab(target, p, 10, 10, { turn: 180 });
    if ("error" in r) throw new Error(r.error);
    expect([r.x, r.y, r.w, r.h]).toEqual([10, 10, 4, 3]);
    expect(r.patch.upsertWalls).toHaveLength(2);
    expect(r.patch.upsertWalls!.every((w) => w.id !== "w1" && w.id !== "w2")).toBe(true);
    const session = new MapSession(target);
    session.execute({ op: "patch_heights", rect: r.rect, data: r.data, features: r.patch, label: "Place prefab Post" }, "user");
    // the carpet square, turned half round, is now at the bottom-right square of the placed room
    expect(hf.data[(12 * s + 1) * hf.w + 13 * s + 1]).toBe(11);
    expect(hf.data[(10 * s + 1) * hf.w + 10 * s + 1]).toBe(1);
    expect(hf.data[(9 * s) * hf.w + 9 * s]).toBe(5);
    expect(target.features!.walls).toHaveLength(2);
    session.undo("user");
    expect(target.features!.walls ?? []).toHaveLength(0);
    expect(hf.data[(12 * s + 1) * hf.w + 13 * s + 1]).toBe(5);
    // stuck out of the map: moved inside, and said so
    const edge = placePrefab(target, p, 19, 19);
    if ("error" in edge) throw new Error(edge.error);
    expect([edge.x, edge.y]).toEqual([16, 17]);
    expect(edge.problems[0]).toMatch(/moved/);
    expect(placePrefab(createBattleDoc({ id: "s", name: "Tiny", squaresX: 3, squaresY: 3 }), p, 0, 0)).toEqual({ error: expect.stringMatching(/bigger than/) });
  });

  it("brings its pack floor textures along, joining the map's own", () => {
    const d = world();
    d.meta.battle = { ...d.meta.battle!, palette: [{ id: CUSTOM_MATERIAL_BASE, name: "Oak boards", asset: "pack:oak.png" }] };
    const s = d.meta.battle.sub, hf = d.height;
    for (let x = 3 * s; x < 4 * s; x++) hf.data[(3 * s) * hf.w + x] = CUSTOM_MATERIAL_BASE;
    const p = makePrefab(d, { x: 2, y: 2, w: 4, h: 3 }, "Post") as Prefab;
    expect(p.palette).toHaveLength(1);
    const target = createBattleDoc({ id: "t", name: "Other", squaresX: 12, squaresY: 12 });
    target.meta.battle = { ...target.meta.battle!, palette: [{ id: CUSTOM_MATERIAL_BASE, name: "Slate", asset: "pack:slate.png" }] };
    const r = placePrefab(target, p, 0, 0);
    if ("error" in r) throw new Error(r.error);
    expect(r.palette!.map((e) => e.asset)).toEqual(["pack:slate.png", "pack:oak.png"]);
    const oak = r.palette![1].id;
    expect(oak).toBe(CUSTOM_MATERIAL_BASE + 1);
    expect([...r.data].includes(oak)).toBe(true);
    expect([...r.data].includes(CUSTOM_MATERIAL_BASE)).toBe(false); // (not the map's slate)
    // a map that has it already uses its own
    const again = placePrefab({ ...target, meta: { ...target.meta, battle: { ...target.meta.battle!, palette: r.palette } } }, p, 0, 0);
    if ("error" in again) throw new Error(again.error);
    expect(again.palette).toBeUndefined();
  });

  it("resamples the floor for a map of another floor detail, and reads its file back", () => {
    const p = makePrefab(world(), { x: 2, y: 2, w: 4, h: 3 }, "Post") as Prefab;
    const coarse = createBattleDoc({ id: "c", name: "Coarse", squaresX: 10, squaresY: 10, sub: 4 });
    const r = placePrefab(coarse, p, 0, 0);
    if ("error" in r) throw new Error(r.error);
    expect(r.rect).toEqual({ x: 0, y: 0, w: 16, h: 12 });
    expect(r.data[0]).toBe(11);
    expect(r.data[r.data.length - 1]).toBe(1);
    const back = readPrefab(JSON.parse(JSON.stringify(p)));
    expect(back?.floor).toEqual(p.floor);
    expect(readPrefab({ ...p, format: 99 })).toBeNull();
    expect(readPrefab({ name: "x" })).toBeNull();
    expect(readPrefab({ ...p, features: { walls: [] } })?.features.props).toEqual([]);
    expect(encodeFloor([0, 0, 0, 3, 3])).toEqual([0, 3, 3, 2]);
    const doc = prefabDoc(p, 16);
    expect(doc.meta.battle!.squaresX).toBe(4);
    expect(doc.features!.walls).toHaveLength(2);
    // padded for its picture: half a square all round
    const padded = prefabDoc(p, 16, true);
    expect([padded.meta.battle!.squaresX, padded.meta.battle!.squaresY]).toEqual([5, 4]);
    expect(padded.features!.walls![0].points[0]).toEqual([0.5, 0.5]);
    expect(padded.height.data[4 * padded.height.w + 4]).toBe(11);
    expect(padded.height.data[0]).toBe(0);
  });
});
