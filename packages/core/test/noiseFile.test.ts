import { describe, expect, it } from "vitest";
import {
  NOISE_CACHE_VERSION, buildNoiseCache, deserializeNoise, noiseFileName, noiseFileSize, readNoiseHeader, serializeNoise,
} from "../src/index.ts";

const PLANES = ["mtn", "hills", "canopy", "clump", "hue", "rock", "fine", "oceanLarge", "oceanSmall", "shelfWarp", "climateT", "climateM", "climateDetail"] as const;

/** FNV-1a over every plane of a small build. */
function fingerprint(): string {
  const c = buildNoiseCache(96, 64, 7);
  let h = 0x811c9dc5;
  for (const k of PLANES) {
    const a = c[k] as ArrayBufferView;
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h.toString(16);
}

describe("the texture noise as a file", () => {
  it("goes out and comes back exactly, as views onto the file", () => {
    const c = buildNoiseCache(80, 48, 12345);
    const buf = serializeNoise(c);
    expect(buf.byteLength).toBe(noiseFileSize(80, 48));
    const back = deserializeNoise(buf)!;
    expect(back).not.toBeNull();
    expect([back.W, back.H, back.seed]).toEqual([80, 48, 12345]);
    for (const k of PLANES) {
      expect(back[k].constructor).toBe(c[k].constructor);
      expect(Array.from(back[k])).toEqual(Array.from(c[k]));
    }
    expect(back.mtn.buffer).toBe(buf); // no copy
  });

  it("is only the noise of its own map: name, header and size are checked", () => {
    expect(noiseFileName(2048, 2048, 7)).toBe(`2048x2048-7-v${NOISE_CACHE_VERSION}.bin`);
    const buf = serializeNoise(buildNoiseCache(64, 64, 3));
    expect(readNoiseHeader(new Uint8Array(buf))).toEqual({ W: 64, H: 64, seed: 3 });
    expect(deserializeNoise(buf.slice(0, buf.byteLength - 1))).toBeNull(); // truncated
    expect(deserializeNoise(new Uint8Array(buf.byteLength + 4).buffer)).toBeNull(); // not a noise file
    const old = buf.slice(0);
    new Uint32Array(old, 0, 8)[1] = NOISE_CACHE_VERSION + 1; // written by other code
    expect(deserializeNoise(old)).toBeNull();
    const huge = buf.slice(0);
    new Uint32Array(huge, 0, 8)[2] = 100000;
    expect(deserializeNoise(huge)).toBeNull();
    expect(deserializeNoise(new ArrayBuffer(10))).toBeNull();
  });

  it("copes with data that isn't 4-byte aligned (a slice of a bigger buffer)", () => {
    const c = buildNoiseCache(40, 24, 9);
    const inner = new Uint8Array(serializeNoise(c));
    const padded = new Uint8Array(inner.length + 3);
    padded.set(inner, 3);
    const back = deserializeNoise(padded.subarray(3))!;
    expect(Array.from(back.mtn.subarray(0, 50))).toEqual(Array.from(c.mtn.subarray(0, 50)));
    expect(Array.from(back.climateM.subarray(0, 50))).toEqual(Array.from(c.climateM.subarray(0, 50)));
  });

  it("fingerprints the noise code's output: if this fails, bump NOISE_CACHE_VERSION in noiseFile.ts, then update the hash", () => {
    // Cached noise on disk is only valid for the code that wrote it. Changing noise.ts or noisecache.ts changes this value on purpose.
    expect(fingerprint()).toBe("83600d26");
  });
});
