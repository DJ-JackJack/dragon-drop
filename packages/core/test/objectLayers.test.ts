import { describe, expect, it } from "vitest";
import { type Features, applyFeaturesPatch, layerCounts, layeredProps, propPickable, withoutHiddenLayers } from "../src/index.ts";

const f = (): Features => ({
  places: [], labels: [],
  layers: [{ id: "a", name: "Furniture" }, { id: "b", name: "Clutter", locked: true }, { id: "c", name: "After the fire", hidden: true }],
  props: [
    { id: "1", asset: "x", x: 1, y: 1, layerId: "b" },
    { id: "2", asset: "x", x: 1, y: 1 },
    { id: "3", asset: "x", x: 1, y: 1, layerId: "a" },
    { id: "4", asset: "x", x: 1, y: 1, layerId: "c" },
    { id: "5", asset: "x", x: 1, y: 1, layerId: "gone" },
  ],
});

describe("object layers", () => {
  it("draw objects in their layers' order, leave hidden layers out, and keep locked ones from being picked", () => {
    expect(layeredProps(f()).map((p) => p.id)).toEqual(["2", "5", "3", "1"]);
    expect(propPickable(f(), f().props![0])).toBe(false); // (locked)
    expect(propPickable(f(), f().props![2])).toBe(true);
    expect(propPickable(f(), f().props![4])).toBe(true); // (a layer that is gone: the bottom one)
    expect(withoutHiddenLayers(f()).props!.map((p) => p.id)).toEqual(["1", "2", "3", "5"]);
    expect([...layerCounts(f()).entries()].sort()).toEqual([["", 2], ["a", 1], ["b", 1], ["c", 1]]);
    expect(layeredProps({ props: f().props })).toHaveLength(5); // (no layers: as they are)
  });

  it("keep their list through other edits; setLayers replaces the order", () => {
    let g = applyFeaturesPatch(f(), { upsertProps: [{ id: "6", asset: "x", x: 2, y: 2 }] });
    expect(g.layers!.map((l) => l.name)).toEqual(["Furniture", "Clutter", "After the fire"]);
    g = applyFeaturesPatch(g, { setLayers: [g.layers![2], g.layers![0]] });
    expect(g.layers!.map((l) => l.id)).toEqual(["c", "a"]);
    expect(applyFeaturesPatch(g, { setLayers: [] }).layers).toBeUndefined();
  });
});
