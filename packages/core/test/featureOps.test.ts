import { describe, expect, it } from "vitest";
import {
  type Features, applyFeaturesPatch, boxSelect, clipBounds, connectorTo, copyFeatures, deleteFeatures, describeFeaturesPatch, emptyFeatures, featureKindOf, featuresBounds,
  moveFeatures, pasteFeatures, selectionFromIds, selectionIds, toggleInSelection,
} from "../src/index.ts";

/** A battlemap's features: a room outline, a door piece, two lights, two objects, a note and a light zone. */
function battle(): Features {
  return {
    ...emptyFeatures(),
    walls: [
      { id: "w1", kind: "wall", points: [[2, 2], [10, 2], [10, 8], [2, 8]], closed: true, auto: true },
      { id: "w2", kind: "door", points: [[5, 2], [6, 2]] },
    ],
    lights: [{ id: "g1", x: 4, y: 4, radius: 6, colour: "#ff8800" }, { id: "g2", x: 9, y: 7, radius: 4 }],
    props: [{ id: "o1", asset: "pack:table", x: 5, y: 5, rotation: 90 }, { id: "o2", asset: "pack:barrel", x: 12, y: 3 }],
    notes: [{ id: "n1", x: 3, y: 3, n: 1, title: "Cellar" }],
    zones: [{ id: "z1", points: [[2, 2], [6, 2], [6, 6], [2, 6]], ambient: 0.4 }],
  };
}

/** A world map's features: two places, a plain label and a label that follows a line. */
function world(): Features {
  return {
    places: [{ id: "p1", name: "Harbour", type: "port", x: 100, y: 100, notes: "busy" }, { id: "p2", name: "Keep", type: "castle", x: 140, y: 120 }],
    labels: [
      { id: "l1", text: "Sea", kind: "sea", x: 50, y: 60 },
      { id: "l2", text: "Range", kind: "range", x: 200, y: 200, path: [[180, 190], [220, 210]] },
    ],
  };
}

describe("selections", () => {
  it("are one id, a group of two or more, or nothing, never both", () => {
    expect(selectionFromIds([])).toEqual({ selected: null, multi: [] });
    expect(selectionFromIds(["a"])).toEqual({ selected: "a", multi: [] });
    expect(selectionFromIds(["a", "b", "a"])).toEqual({ selected: null, multi: ["a", "b"] });
    expect(selectionIds({ selected: "a", multi: [] })).toEqual(["a"]);
    expect(selectionIds({ selected: null, multi: ["a", "b"] })).toEqual(["a", "b"]);
    expect(selectionIds({ selected: null, multi: [] })).toEqual([]);
  });

  it("Shift-click adds to the selection and takes out what is already in it", () => {
    let s = selectionFromIds(["a"]);
    s = toggleInSelection(s, "b");
    expect(s).toEqual({ selected: null, multi: ["a", "b"] });
    s = toggleInSelection(s, "c");
    expect(selectionIds(s)).toEqual(["a", "b", "c"]);
    s = toggleInSelection(s, "b");
    expect(selectionIds(s)).toEqual(["a", "c"]);
    s = toggleInSelection(s, "a");
    expect(s).toEqual({ selected: "c", multi: [] }); // (down to one: it is a single selection again)
    expect(toggleInSelection(s, "c")).toEqual({ selected: null, multi: [] });
    expect(toggleInSelection({ selected: null, multi: [] }, "z")).toEqual({ selected: "z", multi: [] });
  });
});

describe("what a feature is, and where", () => {
  it("looks the kind up by id", () => {
    const f = battle();
    expect(["w1", "g1", "o1", "n1", "z1", "nope"].map((id) => featureKindOf(f, id))).toEqual(["wall", "light", "prop", "note", "zone", null]);
    const w = world();
    expect(["p1", "l2"].map((id) => featureKindOf(w, id))).toEqual(["place", "label"]);
  });

  it("measures the corners of a group (outlines and paths count, a light's reach does not)", () => {
    const f = battle();
    expect(featuresBounds(f, ["w1"])).toEqual({ x0: 2, y0: 2, x1: 10, y1: 8 });
    expect(featuresBounds(f, ["g1", "o2"])).toEqual({ x0: 4, y0: 3, x1: 12, y1: 4 });
    expect(featuresBounds(world(), ["l2", "p1"])).toEqual({ x0: 100, y0: 100, x1: 220, y1: 210 });
    expect(featuresBounds(f, ["nope"])).toBeNull();
    expect(featuresBounds(f, [])).toBeNull();
  });
});

describe("selecting with a box", () => {
  it("takes lights, objects and notes whose centre is inside, and walls and zones only when they lie wholly inside", () => {
    const f = battle();
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 7, y1: 7 }, ["prop", "light", "note", "wall", "zone"]).sort()).toEqual(["g1", "n1", "o1", "w2", "z1"]);
    // the room outline is only taken when the box covers all of it
    expect(boxSelect(f, { x0: 1, y0: 1, x1: 11, y1: 9 }, ["wall"]).sort()).toEqual(["w1", "w2"]);
    expect(boxSelect(f, { x0: 1, y0: 1, x1: 9, y1: 9 }, ["wall"])).toEqual(["w2"]);
  });

  it("takes a box drawn backwards the same as one drawn forwards, and only the kinds asked for", () => {
    const f = battle();
    expect(boxSelect(f, { x0: 7, y0: 7, x1: 0, y1: 0 }, ["light"])).toEqual(["g1"]);
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 20, y1: 20 }, ["light"]).sort()).toEqual(["g1", "g2"]);
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 20, y1: 20 }, [])).toEqual([]);
  });

  it("works on a world map: places and labels (a label on a line when its whole line is inside)", () => {
    const w = world();
    expect(boxSelect(w, { x0: 90, y0: 90, x1: 150, y1: 130 }, ["place", "label"]).sort()).toEqual(["p1", "p2"]);
    expect(boxSelect(w, { x0: 170, y0: 180, x1: 230, y1: 220 }, ["label"])).toEqual(["l2"]);
    expect(boxSelect(w, { x0: 170, y0: 180, x1: 200, y1: 220 }, ["label"])).toEqual([]);
  });
});

describe("moving a group", () => {
  it("moves everything by the same amount in one patch, whatever its kind", () => {
    const f = battle();
    const { patch, dx, dy } = moveFeatures(f, ["w2", "g1", "o1", "n1", "z1"], 1, 0.5);
    expect([dx, dy]).toEqual([1, 0.5]);
    const g = applyFeaturesPatch(f, patch);
    expect(g.walls!.find((w) => w.id === "w2")!.points).toEqual([[6, 2.5], [7, 2.5]]);
    expect(g.lights!.find((l) => l.id === "g1")).toMatchObject({ x: 5, y: 4.5, colour: "#ff8800" });
    expect(g.props!.find((p) => p.id === "o1")).toMatchObject({ x: 6, y: 5.5, rotation: 90 });
    expect(g.notes![0]).toMatchObject({ x: 4, y: 3.5, n: 1, title: "Cellar" });
    expect(g.zones![0].points[0]).toEqual([3, 2.5]);
    // what was not listed stayed put
    expect(g.lights!.find((l) => l.id === "g2")).toMatchObject({ x: 9, y: 7 });
    expect(g.props!.find((p) => p.id === "o2")).toMatchObject({ x: 12, y: 3 });
  });

  it("moves a label with its line, and a place", () => {
    const w = world();
    const g = applyFeaturesPatch(w, moveFeatures(w, ["l2", "p1"], 10, -5).patch);
    expect(g.labels.find((l) => l.id === "l2")).toMatchObject({ x: 210, y: 195, path: [[190, 185], [230, 205]] });
    expect(g.places.find((p) => p.id === "p1")).toMatchObject({ x: 110, y: 95, name: "Harbour", notes: "busy" });
  });

  it("makes a wall that is moved by hand a hand-made wall (an automatic one would be rebuilt where it was)", () => {
    const f = battle();
    expect(f.walls![0].auto).toBe(true);
    const moved = moveFeatures(f, ["w1"], 1, 0).patch.upsertWalls![0];
    expect("auto" in moved).toBe(false);
    expect(moved.closed).toBe(true);
  });

  it("holds the whole group inside the map: it stops at the edge instead of squashing against it", () => {
    const f = battle();
    // the two objects span x 5..12: moving right by 5 would take the right one past 14, so the group only goes 2
    const r = moveFeatures(f, ["o1", "o2"], 5, 0, { w: 14, h: 10 });
    expect([r.dx, r.dy]).toEqual([2, 0]);
    expect(applyFeaturesPatch(f, r.patch).props!.map((p) => p.x)).toEqual([7, 14]);
    const l = moveFeatures(f, ["o1", "o2"], -50, -50, { w: 14, h: 10 });
    expect([l.dx, l.dy]).toEqual([-5, -3]);
  });

  it("does nothing when there is nothing to move or nowhere to go", () => {
    const f = battle();
    expect(moveFeatures(f, [], 1, 1).patch).toEqual({});
    expect(moveFeatures(f, ["nope"], 1, 1).patch).toEqual({});
    expect(moveFeatures(f, ["o2"], 1, 0, { w: 12, h: 10 }).patch).toEqual({}); // (already at the right edge: x is 12 in a map 12 wide)
    expect(applyFeaturesPatch(f, moveFeatures(f, ["o2"], 1, 0, { w: 13, h: 10 }).patch).props!.find((p) => p.id === "o2")!.x).toBe(13); // (one more square fits)
  });
});

describe("regions and roads in a group", () => {
  const withShapes = (): Features => ({
    ...world(),
    regions: [{ id: "r1", name: "Frost", polygon: [[10, 10], [30, 10], [30, 30]], temperature: 0.1 }],
    lines: [{ id: "r2", kind: "road", name: "King's Road", points: [[0, 0], [50, 40]] }],
  });

  it("are known by kind, measured, moved and deleted with the rest", () => {
    const f = withShapes();
    expect(featureKindOf(f, "r1")).toBe("region");
    expect(featureKindOf(f, "r2")).toBe("line");
    expect(featuresBounds(f, ["r1", "r2"])).toEqual({ x0: 0, y0: 0, x1: 50, y1: 40 });
    const g = applyFeaturesPatch(f, moveFeatures(f, ["r1", "r2", "p1"], 5, -3).patch);
    expect(g.regions![0]).toMatchObject({ name: "Frost", temperature: 0.1, polygon: [[15, 7], [35, 7], [35, 27]] });
    expect(g.lines![0]).toMatchObject({ kind: "road", name: "King's Road", points: [[5, -3], [55, 37]] });
    expect(g.places.find((p) => p.id === "p1")).toMatchObject({ x: 105, y: 97 });
    const h = applyFeaturesPatch(f, deleteFeatures(f, ["r1", "r2"]));
    expect(h.regions).toEqual([]);
    expect(h.lines).toEqual([]);
  });

  it("are not copied, and a box doesn't take them", () => {
    const f = withShapes();
    expect(copyFeatures(f, ["r1", "r2"])).toBeNull();
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 500, y1: 500 }, ["place", "label"]).sort()).toEqual(["l1", "l2", "p1", "p2"]);
  });
});

describe("deleting a group", () => {
  it("removes each id from the list for its kind, in one patch", () => {
    const f = battle();
    const g = applyFeaturesPatch(f, deleteFeatures(f, ["w2", "g2", "o1", "n1", "z1", "nope"]));
    expect(g.walls!.map((w) => w.id)).toEqual(["w1"]);
    expect(g.lights!.map((l) => l.id)).toEqual(["g1"]);
    expect(g.props!.map((p) => p.id)).toEqual(["o2"]);
    expect(g.notes).toEqual([]);
    expect(g.zones).toEqual([]);
    const w = world();
    const h = applyFeaturesPatch(w, deleteFeatures(w, ["p2", "l1"]));
    expect(h.places.map((p) => p.id)).toEqual(["p1"]);
    expect(h.labels.map((l) => l.id)).toEqual(["l2"]);
  });
});

describe("copy and paste", () => {
  it("copies what can be copied, as a snapshot that later edits don't change, and leaves room notes out", () => {
    const f = battle();
    const clip = copyFeatures(f, ["o1", "g1", "w2", "z1", "n1"])!;
    expect(clip.props.map((p) => p.id)).toEqual(["o1"]);
    expect(clip.lights.map((l) => l.id)).toEqual(["g1"]);
    expect(clip.walls.map((w) => w.id)).toEqual(["w2"]);
    expect(clip.zones).toHaveLength(1);
    expect(JSON.stringify(clip)).not.toContain("Cellar"); // (notes are numbered: never copied)
    f.props![0].x = 99;
    expect(clip.props[0].x).toBe(5);
    expect(copyFeatures(f, ["n1", "nope"])).toBeNull();
    expect(copyFeatures(f, [])).toBeNull();
  });

  it("pastes new things with new ids, moved by the offset, and says which ones to select", () => {
    const f = battle();
    const clip = copyFeatures(f, ["o1", "g1", "w1"])!;
    const r = pasteFeatures(clip, 1, 1);
    const g = applyFeaturesPatch(f, r.patch);
    expect(r.ids).toHaveLength(3);
    expect(new Set([...r.ids, "o1", "g1", "w1"]).size).toBe(6); // (no id is reused)
    expect(g.props).toHaveLength(3);
    expect(g.props!.find((p) => p.id === r.ids[2] || p.id === r.ids.find((i) => i.startsWith("o")))).toMatchObject({ asset: "pack:table", x: 6, y: 6, rotation: 90 });
    expect(g.lights).toHaveLength(3);
    // the original is untouched
    expect(g.props!.find((p) => p.id === "o1")).toMatchObject({ x: 5, y: 5 });
    // a copied automatic wall is a hand-made wall
    const wall = g.walls!.find((w) => w.id !== "w1" && w.id !== "w2")!;
    expect("auto" in wall).toBe(false);
    expect(wall.points[0]).toEqual([3, 3]);
  });

  it("pastes the same clip more than once, each time with its own ids", () => {
    const f = battle();
    const clip = copyFeatures(f, ["o1"])!;
    const a = pasteFeatures(clip, 1, 0), b = pasteFeatures(clip, 2, 0);
    expect(a.ids[0]).not.toBe(b.ids[0]);
    expect(applyFeaturesPatch(applyFeaturesPatch(f, a.patch), b.patch).props).toHaveLength(4);
  });

  it("keeps a pasted group inside the map", () => {
    const f = battle();
    const clip = copyFeatures(f, ["o1", "o2"])!; // x 5..12
    const r = pasteFeatures(clip, 10, 0, { bounds: { w: 14, h: 10 } });
    expect(r.dx).toBe(2);
    expect(applyFeaturesPatch(f, r.patch).props!.filter((p) => !["o1", "o2"].includes(p.id)).map((p) => p.x).sort((a, b) => a - b)).toEqual([7, 14]);
    expect(clipBounds(clip)).toEqual({ x0: 5, y0: 3, x1: 12, y1: 5 });
  });

  it("copies places as new places named \"<name> (copy)\" (the person renames them), and labels with their lines", () => {
    const w = world();
    const clip = copyFeatures(w, ["p1", "l2"])!;
    const r = pasteFeatures(clip, 10, 10);
    const g = applyFeaturesPatch(w, r.patch);
    expect(g.places).toHaveLength(3);
    const copy = g.places.find((p) => p.name === "Harbour (copy)")!;
    expect(copy).toMatchObject({ type: "port", x: 110, y: 110, notes: "busy" });
    expect(copy.id).not.toBe("p1");
    const label = g.labels.find((l) => l.id !== "l1" && l.id !== "l2")!;
    expect(label).toMatchObject({ text: "Range", x: 210, y: 210, path: [[190, 200], [230, 220]] });
    const custom = pasteFeatures(clip, 0, 0, { placeName: (n) => `${n} 2` });
    expect(custom.patch.upsertPlaces![0].name).toBe("Harbour 2");
  });
});

describe("stairs, ladders and holes in a group", () => {
  const withConnectors = (): Features => ({
    ...battle(),
    connectors: [
      { id: "c1", kind: "stairs", name: "Cellar stairs", x: 3, y: 3, w: 1, h: 2, to: "down" },
      { id: "c2", kind: "hole", x: 7, y: 4, w: 2, h: 2, to: "down" },
    ],
  });

  it("are stored by the feature patch (added, replaced, removed) and named in the history", () => {
    const f = applyFeaturesPatch(battle(), { upsertConnectors: [{ id: "c1", kind: "ladder", x: 1, y: 1, w: 1, h: 1, to: "up" }] });
    expect(f.connectors).toHaveLength(1);
    const g = applyFeaturesPatch(f, { upsertConnectors: [{ id: "c1", kind: "ladder", x: 5, y: 5, w: 1, h: 1, to: "up" }] });
    expect(g.connectors).toEqual([{ id: "c1", kind: "ladder", x: 5, y: 5, w: 1, h: 1, to: "up" }]);
    expect(applyFeaturesPatch(g, { removeConnectors: ["c1"] }).connectors).toEqual([]);
    expect(describeFeaturesPatch({ upsertConnectors: [{ id: "c", kind: "hole", x: 0, y: 0, w: 1, h: 1, to: "down" }] })).toBe("Edit hole");
    expect(describeFeaturesPatch({ upsertConnectors: [{ id: "c", kind: "stairs", name: "Cellar stairs", x: 0, y: 0, w: 1, h: 2, to: "up" }] })).toBe("Edit Cellar stairs");
  });

  it("a hole always leads down, whatever it says", () => {
    expect(connectorTo({ kind: "hole", to: "up" })).toBe("down");
    expect(connectorTo({ kind: "stairs", to: "up" })).toBe("up");
    expect(connectorTo({ kind: "ladder", to: "down" })).toBe("down");
  });

  it("are known by kind, measured by their rectangle, and taken by a box only when wholly inside it", () => {
    const f = withConnectors();
    expect(featureKindOf(f, "c1")).toBe("connector");
    expect(featuresBounds(f, ["c1", "c2"])).toEqual({ x0: 3, y0: 3, x1: 9, y1: 6 });
    expect(boxSelect(f, { x0: 2, y0: 2, x1: 5, y1: 6 }, ["connector"])).toEqual(["c1"]);
    expect(boxSelect(f, { x0: 2, y0: 2, x1: 8, y1: 6 }, ["connector"])).toEqual(["c1"]); // (the hole sticks out to x 9)
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 20, y1: 20 }, ["connector"]).sort()).toEqual(["c1", "c2"]);
    expect(boxSelect(f, { x0: 0, y0: 0, x1: 20, y1: 20 }, ["light"])).not.toContain("c1");
  });

  it("move, are deleted and are copied and pasted with the rest, each pasted one a new connector with its own id", () => {
    const f = withConnectors();
    const moved = moveFeatures(f, ["c1", "c2"], 2, 1);
    expect(moved.patch.upsertConnectors).toEqual([
      { id: "c1", kind: "stairs", name: "Cellar stairs", x: 5, y: 4, w: 1, h: 2, to: "down" },
      { id: "c2", kind: "hole", x: 9, y: 5, w: 2, h: 2, to: "down" },
    ]);
    expect(deleteFeatures(f, ["c2", "g1"])).toEqual({ removeConnectors: ["c2"], removeLights: ["g1"] });
    const clip = copyFeatures(f, ["c1"])!;
    expect(clip.connectors).toHaveLength(1);
    expect(clipBounds(clip)).toEqual({ x0: 3, y0: 3, x1: 4, y1: 5 });
    const pasted = pasteFeatures(clip, 4, 0);
    expect(pasted.patch.upsertConnectors).toHaveLength(1);
    expect(pasted.patch.upsertConnectors![0]).toMatchObject({ kind: "stairs", name: "Cellar stairs", x: 7, y: 3, w: 1, h: 2, to: "down" });
    expect(pasted.patch.upsertConnectors![0].id).not.toBe("c1");
    expect(pasted.ids).toEqual([pasted.patch.upsertConnectors![0].id]);
  });
});
