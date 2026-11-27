// Stage 1 of docs/BRUSH-SPEED.md in core: where two paintings of the ground differ and that part cut out (a Ground stroke sends only it), the paint engine
// taking it, and a mouse move's dabs as one command that changes the land exactly as the dabs one by one did, in one undo step.
import { describe, expect, it } from "vitest";
import {
  MapSession, PaintEngine, createDoc, cropGroundPlanes, decodeRealmCells, encodeRealmCells, generateTerrain, groundCode, groundGridOf, groundPaintPlanes,
  groundPlanesBox, paintRealmCells, type Derived,
} from "../src/index.ts";

const W = 256;
const world = () => {
  const d = createDoc({ id: "s", name: "S", width: W, height: W, kmPerPx: 4 });
  generateTerrain(d, { template: "continent", seed: 3 } as never);
  return d;
};

describe("a Ground stroke's part of the planes", () => {
  it("finds where two paintings differ, cuts that part out, and the paint engine takes it", () => {
    const doc = world();
    const g = groundGridOf(doc), cells = decodeRealmCells(g);
    paintRealmCells(cells, g, { n: groundCode("desert"), circle: { x: 80, y: 90, r: 20 } });
    doc.features = { places: [], labels: [], groundCells: encodeRealmCells(g, cells) };
    const before = groundPaintPlanes(doc)!;
    paintRealmCells(cells, g, { n: groundCode("moor"), circle: { x: 180, y: 160, r: 15 } });
    doc.features = { places: [], labels: [], groundCells: encodeRealmCells(g, cells) };
    const after = groundPaintPlanes(doc)!;

    expect(groundPlanesBox(before, before, W, W)).toBeNull();
    const box = groundPlanesBox(before, after, W, W)!;
    // only round the moor (with the painting's soft, wandering edge), not the desert painted before
    expect(box.x).toBeGreaterThan(140);
    expect(box.x + box.w).toBeLessThan(220);
    expect(box.y).toBeGreaterThan(120);
    // nothing painted before: the box is round everything
    const all = groundPlanesBox(null, after, W, W)!;
    expect(all.x).toBeLessThan(80);

    // the editor's engine holds the planes from before; the box brings it up to date
    const d = { W, H: W, seq: 1, ground: before.code.slice(), groundW: before.weight.slice() } as unknown as Derived;
    const eng = new PaintEngine(W, W, doc.height.data);
    eng.setDerived(d);
    expect(eng.setGroundRect(box, cropGroundPlanes(after, W, box))).toBe(true);
    expect(Array.from(eng.derived!.ground!)).toEqual(Array.from(after.code));
    expect(Array.from(eng.derived!.groundW!)).toEqual(Array.from(after.weight));
    // and an engine with no painted ground yet makes room for it
    const eng2 = new PaintEngine(W, W, doc.height.data);
    eng2.setDerived({ W, H: W, seq: 1 } as unknown as Derived);
    expect(eng2.setGroundRect(all, cropGroundPlanes(after, W, all))).toBe(true);
    expect(Array.from(eng2.derived!.groundW!)).toEqual(Array.from(after.weight));
  });
});

describe("a mouse move's dabs as one command", () => {
  it("changes the land as the dabs one by one did, in one undo step", () => {
    const dabs = Array.from({ length: 6 }, (_, i) => ({ mode: "raise" as const, shape: { type: "circle" as const, x: 60 + i * 9, y: 120, r: 30 }, amountM: 60, strength: 0.5, falloff: 0.6 }));
    const a = world(), b = world();
    const sa = new MapSession(a), sb = new MapSession(b);
    for (const p of dabs) sa.execute({ op: "sculpt", params: p }, "user");
    const r = sb.execute({ op: "sculpt_dabs", dabs }, "user");
    expect(Array.from(b.height.data)).toEqual(Array.from(a.height.data));
    expect(r.rect).not.toBeNull();
    expect(r.label).toMatch(/Raise terrain \(6 dabs\)/);
    const orig = world();
    sb.undo("user");
    expect(Array.from(b.height.data)).toEqual(Array.from(orig.height.data));
  });
});
