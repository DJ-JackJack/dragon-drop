import { describe, expect, it } from "vitest";
import {
  LIGHT_PRESETS, type MapNote, applyFeaturesPatch, applyLightPreset, battleKey, createBattleDoc, describeFeaturesPatch, lightPresetName, nextNoteNumber, paintFloor, readingOrderNumbers,
  renderBattle, sortedNotes,
} from "../src/index.ts";

const note = (id: string, n: number, x: number, y: number, title = `Room ${n}`, text?: string): MapNote => ({ id, n, x, y, title, ...(text && { text }) });
const at = (img: { w: number; data: Uint8ClampedArray }, xSq: number, ySq: number, px = 40) => {
  const o = (Math.floor(ySq * px) * img.w + Math.floor(xSq * px)) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};
const scene = () => {
  const d = createBattleDoc({ id: "b", name: "Cellar", squaresX: 16, squaresY: 10, pxPerSquare: 40 });
  paintFloor(d, { shape: { type: "rect", x: 0, y: 0, w: 128, h: 80 }, material: 4 });
  d.features = { places: [], labels: [], walls: [], lights: [] };
  return d;
};

describe("battlemap notes", () => {
  it("numbers the next note and keeps the key in order", () => {
    expect(nextNoteNumber(undefined)).toBe(1);
    expect(nextNoteNumber([note("a", 4, 1, 1)])).toBe(5);
    expect(sortedNotes([note("b", 2, 5, 5), note("a", 1, 9, 9), note("c", 2, 1, 5)]).map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("renumbers in reading order: rows from the top, left to right", () => {
    const order = readingOrderNumbers([note("far", 1, 20, 12), note("topright", 2, 18, 2), note("topleft", 3, 3, 1), note("mid", 4, 8, 7)]);
    expect(order).toEqual({ topleft: 1, topright: 2, mid: 3, far: 4 });
  });

  it("applies and describes note patches, and undoes them like other features", () => {
    const f = applyFeaturesPatch({ places: [], labels: [] }, { upsertNotes: [note("a", 1, 2, 2), note("b", 2, 4, 4)] });
    expect(f.notes).toHaveLength(2);
    const g = applyFeaturesPatch(f, { upsertNotes: [{ ...note("a", 1, 2, 2), title: "Hall" }], removeNotes: ["b"] });
    expect(g.notes).toEqual([{ ...note("a", 1, 2, 2), title: "Hall" }]);
    expect(describeFeaturesPatch({ upsertNotes: [note("a", 7, 1, 1)] })).toBe("Edit note 7");
    expect(describeFeaturesPatch({ upsertZones: [{ id: "z", name: "Inn", points: [[0, 0], [1, 0], [1, 1]], ambient: 0.4 }] })).toBe("Edit light zone Inn");
  });

  it("draws numbered markers in previews only, never in the export picture", () => {
    const d = scene();
    d.features!.notes = [note("a", 12, 8, 5)];
    const plain = renderBattle(d, { overlay: true, lights: false });
    const preview = renderBattle(d, { overlay: true, lights: false, notes: true });
    expect(Array.from(plain.data)).toEqual(Array.from(renderBattle(scene(), { overlay: true, lights: false }).data)); // notes don't touch it
    const dark = at(preview, 8.1, 5.1), ring = at(preview, 8 + 0.46, 5);
    expect(dark[0]).toBeLessThan(80); // the dark disc behind the number
    expect(ring[0]).toBeGreaterThan(at(plain, 8.46, 5)[0] - 1); // (the gold ring sits at the edge)
    let changed = 0;
    for (let i = 0; i < plain.data.length; i += 4) if (plain.data[i] !== preview.data[i]) changed++;
    expect(changed).toBeGreaterThan(300);
    expect(changed).toBeLessThan(5000); // a small marker, not the whole map
  });

  it("writes the key as Markdown, in number order", () => {
    const d = scene();
    d.features!.notes = [note("b", 2, 10, 4, "Armoury", "Racks of rusted spears.\nOne is trapped."), note("a", 1, 3, 3.25, "Entrance")];
    expect(battleKey(d)).toBe("# Cellar: key\n\n1. **Entrance** (3, 3.3)\n\n2. **Armoury** (10, 4)\n\n   Racks of rusted spears.\n   One is trapped.\n");
    expect(battleKey(scene())).toContain("No notes yet");
  });
});

describe("light presets and zones", () => {
  it("applies a time-of-day preset (level and tint) and recognises it again", () => {
    const d = scene();
    const night = applyLightPreset(d.meta.battle!, "night");
    expect(night.ambient).toBe(LIGHT_PRESETS.night.ambient);
    expect(night.ambientTint).toBe("#5b73c9");
    expect(lightPresetName(night)).toBe("night");
    expect(lightPresetName(applyLightPreset(night, "dim"))).toBe("dim");
    const bright = applyLightPreset(night, "bright");
    expect("ambient" in bright).toBe(false);
    expect("ambientTint" in bright).toBe(false);
    expect(lightPresetName(bright)).toBe("bright");
    expect(lightPresetName({ ambient: 0.4 })).toBeNull();
    expect(lightPresetName({ ambient: 0.25, ambientTint: "#5B73C9" })).toBe("night"); // the colour's case doesn't matter
  });

  it("colours the dark: night is bluer than dark at the same level", () => {
    const dark = scene(), night = scene();
    dark.meta.battle = applyLightPreset(dark.meta.battle!, "dark");
    night.meta.battle = applyLightPreset(night.meta.battle!, "night");
    const a = at(renderBattle(dark, { overlay: true, lights: true }), 8, 5), b = at(renderBattle(night, { overlay: true, lights: true }), 8, 5);
    expect(b[2] / b[0]).toBeGreaterThan((a[2] / a[0]) * 1.15);
    const dawn = scene();
    dawn.meta.battle = applyLightPreset(dawn.meta.battle!, "dawn");
    const warm = at(renderBattle(dawn, { overlay: true, lights: true }), 8, 5), flat = at(renderBattle(scene(), { overlay: true, lights: true }), 8, 5);
    expect(warm[0] / warm[2]).toBeGreaterThan(flat[0] / flat[2]); // pinker than the plain floor
  });

  it("dims a zone against a bright map (and the reverse), with a soft edge and no fade at the map's border", () => {
    const d = scene();
    d.features!.zones = [{ id: "z", name: "Inn", points: [[2, 2], [8, 2], [8, 8], [2, 8]], ambient: 0.3 }];
    const base = renderBattle(scene(), { overlay: true, lights: false });
    const img = renderBattle(d, { overlay: true, lights: true });
    expect(at(img, 5, 5)[0]).toBeLessThan(at(base, 5, 5)[0] * 0.5); // inside: dim
    expect(at(img, 12, 5)[0]).toBe(at(base, 12, 5)[0]); // outside: untouched (the map is bright)
    expect(at(img, 15.7, 9.7)[0]).toBe(at(base, 15.7, 9.7)[0]); // the corner of the map: not darkened by the blur
    const edge = at(img, 8.05, 5)[0] / at(base, 8.05, 5)[0], inside = at(img, 7, 5)[0] / at(base, 7, 5)[0], outside = at(img, 9.5, 5)[0] / at(base, 9.5, 5)[0];
    expect(edge).toBeGreaterThan(inside + 0.05); // a soft edge: partway between
    expect(edge).toBeLessThan(outside);
    // a bright zone inside a dark map
    const dk = scene();
    dk.meta.battle!.ambient = 0.25;
    dk.features!.zones = [{ id: "z", points: [[2, 2], [8, 2], [8, 8], [2, 8]], ambient: 1 }];
    const dimmed = renderBattle(dk, { overlay: true, lights: true });
    expect(at(dimmed, 5, 5)[0]).toBeGreaterThan(at(dimmed, 12, 5)[0] * 2.5);
  });

  it("a light still brightens a dim zone", () => {
    const d = scene();
    d.features!.zones = [{ id: "z", points: [[2, 2], [8, 2], [8, 8], [2, 8]], ambient: 0.3 }];
    d.features!.lights = [{ id: "l", x: 5, y: 5, radius: 3, colour: "#ffffff" }];
    const img = renderBattle(d, { overlay: true, lights: true });
    expect(at(img, 5.1, 5.1)[0]).toBeGreaterThan(at(img, 2.6, 2.6)[0] * 2);
  });
});
