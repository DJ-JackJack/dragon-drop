import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { addLandmass, buildNoiseCache, createDoc, generateTerrain, serializeNoise } from "@mapmaker/core";
import { InlineCompute, type NoiseStorage } from "../src/compute.ts";
import { NoiseStore } from "../src/noiseStore.ts";

const root = mkdtempSync(path.join(tmpdir(), "mapmaker-noise-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the texture noise kept on disk", () => {
  it("keeps a map's noise and reads it back exactly", () => {
    const store = new NoiseStore(path.join(root, "a"));
    expect(store.read(96, 64, 5)).toBeNull();
    expect(store.has(96, 64, 5)).toBe(false);
    const c = buildNoiseCache(96, 64, 5);
    store.write(c);
    expect(store.has(96, 64, 5)).toBe(true);
    const back = store.read(96, 64, 5)!;
    expect(back).not.toBeNull();
    expect(Array.from(back.mtn.subarray(0, 100))).toEqual(Array.from(c.mtn.subarray(0, 100)));
    expect(Array.from(back.climateDetail.subarray(0, 100))).toEqual(Array.from(c.climateDetail.subarray(0, 100)));
    expect(store.read(96, 64, 6)).toBeNull(); // another seed is another map
    expect(store.read(64, 96, 5)).toBeNull();
  });

  it("refuses noise that is for another map, and ignores damaged files", () => {
    const store = new NoiseStore(path.join(root, "b"));
    const c = buildNoiseCache(64, 64, 1);
    expect(() => store.writeBytes(64, 64, 2, new Uint8Array(serializeNoise(c)))).toThrow(); // seed 1's noise offered as seed 2's
    expect(() => store.writeBytes(64, 64, 1, new Uint8Array(10))).toThrow();
    store.write(c);
    writeFileSync(store.file(64, 64, 1), Buffer.from("not a noise file"));
    expect(store.read(64, 64, 1)).toBeNull();
    expect(store.size(64, 64, 1)).toBeNull();
  });

  it("keeps only the newest few files", () => {
    const store = new NoiseStore(path.join(root, "c"));
    for (let seed = 1; seed <= 6; seed++) {
      store.write(buildNoiseCache(64, 64, seed));
      const t = new Date(Date.now() - (10 - seed) * 60_000); // seed 6 is the newest
      utimesSync(store.file(64, 64, seed), t, t);
    }
    store.prune();
    const left = readdirSync(path.join(root, "c", "noise")).filter((f) => f.endsWith(".bin"));
    expect(left.length).toBe(4);
    expect(store.has(64, 64, 6)).toBe(true);
    expect(store.has(64, 64, 1)).toBe(false);
    expect(store.has(64, 64, 2)).toBe(false);
  });
});

describe("painting with noise from disk", () => {
  function map() {
    const d = createDoc({ id: "n", name: "N", width: 128, height: 128, kmPerPx: 4 });
    generateTerrain(d, { template: "ocean", seed: 1 });
    addLandmass(d, { shape: { type: "circle", x: 64, y: 64, r: 40 }, heightM: 400, seed: 2 });
    return d;
  }

  it("works the noise out once, then reads it: the picture is identical either way", async () => {
    const real = new NoiseStore(path.join(root, "d"));
    const calls = { reads: 0, writes: 0 };
    const spy: NoiseStorage = {
      read: (W, H, seed) => { calls.reads++; return real.read(W, H, seed); },
      write: (c) => { calls.writes++; real.write(c); },
    };
    const doc = map();
    const first = new InlineCompute(spy);
    const d1 = await first.derive(doc, 1);
    const img1 = await first.paint(doc, d1);
    expect(calls).toEqual({ reads: 1, writes: 1 }); // not on disk yet: built and kept
    // a new process (a new runner) finds it on disk and doesn't build or write it again
    const second = new InlineCompute(spy);
    const img2 = await second.paint(doc, d1);
    expect(calls).toEqual({ reads: 2, writes: 1 });
    expect(Array.from(img2)).toEqual(Array.from(img1));
  });

  it("carries on without a storage, or when the folder can't be written", async () => {
    const doc = map();
    const plain = await new InlineCompute().paint(doc, await new InlineCompute().derive(doc, 1));
    const broken: NoiseStorage = { read: () => null, write: () => { throw new Error("disk full"); } };
    const d = await new InlineCompute(broken).derive(doc, 1);
    const img = await new InlineCompute(broken).paint(doc, d);
    expect(Array.from(img)).toEqual(Array.from(plain));
  });
});
