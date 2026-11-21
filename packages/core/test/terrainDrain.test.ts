/** terrainDrain.ts: new land drained so its water runs to the sea, keeping as many lakes as asked. */
import { describe, expect, it } from "vitest";
import { type LakeAmount, computeHydrology, createDoc, drainTerrain, generateTerrain } from "../src/index.ts";

/** A mountainous continent (the case that came out a fifth lake), and its lakes counted. */
function continent(lakes: LakeAmount) {
  const doc = createDoc({ id: "t", name: "t", width: 512, height: 512 });
  generateTerrain(doc, { template: "continent", seed: 11, landFraction: 0.4, mountains: 0.7, lakes });
  const { w: W, h: H, data } = doc.height, sea = doc.meta.seaLevel, hy = computeHydrology(data, W, H, sea);
  let land = 0, lake = 0;
  for (let i = 0; i < W * H; i++) { if (data[i] > sea) land++; if (hy.lakes[i]) lake++; }
  return { doc, share: lake / land };
}

describe("draining new land", () => {
  it("keeps every hollow with many, a few small lakes with few, and none with none", () => {
    const many = continent("many"), few = continent("few"), some = continent("some"), none = continent("none");
    expect(many.share).toBeGreaterThan(0.1); // (the generator's hollows, as maps were before)
    expect(few.share).toBeLessThan(0.025);
    expect(some.share).toBeGreaterThan(few.share);
    expect(some.share).toBeLessThan(0.06);
    expect(none.share).toBe(0);
  });

  it("only lowers the land to cut outlets and only raises it to fill hollows, never touches the sea, and is the same every time", () => {
    const doc = createDoc({ id: "t", name: "t", width: 384, height: 384 });
    generateTerrain(doc, { template: "island", seed: 5, landFraction: 0.45, mountains: 0.8, lakes: "many" });
    const before = Float32Array.from(doc.height.data), sea = doc.meta.seaLevel;
    const r = drainTerrain(doc.height.data, 384, 384, sea, "none");
    expect(r.before).toBeGreaterThan(5);
    expect(r.after).toBe(0);
    expect(r.breached + r.filled).toBeGreaterThan(0);
    let moved = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] <= sea) expect(doc.height.data[i]).toBe(before[i]);
      if (doc.height.data[i] !== before[i]) moved++;
    }
    expect(moved).toBeLessThan(before.length * 0.25); // (outlets and filled hollows, not the whole map)
    const again = Float32Array.from(before);
    drainTerrain(again, 384, 384, sea, "none");
    expect(again).toEqual(doc.height.data);
  });
});
