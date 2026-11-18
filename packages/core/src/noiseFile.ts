/**
 * The texture noise of a map as one file, so it can be kept on disk and handed to the editor instead of being worked out again at every launch
 * (about 10 s of CPU on a 2048 map). It depends only on the map's size and seed.
 *
 * Layout: a 32-byte header (eight little-endian u32: magic, version, width, height, seed, then three zeros), the two float32 planes
 * (mtn, hills), then the eleven int8 planes in a fixed order. Everything is the same size per plane, so the file size is known from the map size.
 *
 * If the noise code in noise.ts / noisecache.ts ever changes what it produces, bump NOISE_CACHE_VERSION: files written by older code are then
 * ignored. (A test fingerprints the output so that forgetting is caught.)
 */
import type { NoiseCache } from "./noisecache.ts";

export const NOISE_CACHE_VERSION = 1;

const MAGIC = 0x5a4e4444; // "DDNZ" little-endian
const HEADER = 32;
const FLOATS = ["mtn", "hills"] as const;
const INTS = ["canopy", "clump", "hue", "rock", "fine", "oceanLarge", "oceanSmall", "shelfWarp", "climateT", "climateM", "climateDetail"] as const;
const MAX_SIDE = 8192;

export function noiseFileSize(W: number, H: number): number {
  return HEADER + W * H * (FLOATS.length * 4 + INTS.length);
}

export function noiseFileName(W: number, H: number, seed: number): string {
  return `${W}x${H}-${seed >>> 0}-v${NOISE_CACHE_VERSION}.bin`;
}

export function serializeNoise(c: NoiseCache): ArrayBuffer {
  const { W, H } = c, N = W * H;
  const buf = new ArrayBuffer(noiseFileSize(W, H));
  new Uint32Array(buf, 0, 8).set([MAGIC, NOISE_CACHE_VERSION, W, H, c.seed >>> 0, 0, 0, 0]);
  let off = HEADER;
  for (const name of FLOATS) { new Float32Array(buf, off, N).set(c[name]); off += N * 4; }
  for (const name of INTS) { new Int8Array(buf, off, N).set(c[name]); off += N; }
  return buf;
}

export interface NoiseFileHeader {
  W: number;
  H: number;
  seed: number;
}

/** The map a file is for, or null if it isn't a current noise file of exactly the right size. Reads only the header and the length. */
export function readNoiseHeader(bytes: Uint8Array): NoiseFileHeader | null {
  if (bytes.byteLength < HEADER) return null;
  const h = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  if (h.getUint32(0, true) !== MAGIC || h.getUint32(4, true) !== NOISE_CACHE_VERSION) return null;
  const W = h.getUint32(8, true), H = h.getUint32(12, true), seed = h.getUint32(16, true);
  if (W < 1 || H < 1 || W > MAX_SIDE || H > MAX_SIDE) return null;
  if (bytes.byteLength !== noiseFileSize(W, H)) return null;
  return { W, H, seed };
}

/** The noise in a file, as views onto it (no copy when the data is 4-byte aligned, as it is for a buffer made by serializeNoise or a fresh fetch). */
export function deserializeNoise(input: ArrayBuffer | Uint8Array): NoiseCache | null {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const head = readNoiseHeader(bytes);
  if (!head) return null;
  if (bytes.byteOffset % 4 !== 0) bytes = bytes.slice(); // float32 views need 4-byte alignment
  const { W, H, seed } = head, N = W * H;
  const base = bytes.buffer as ArrayBuffer;
  let off = bytes.byteOffset + HEADER;
  const out = { W, H, seed } as NoiseCache;
  for (const name of FLOATS) { (out as unknown as Record<string, unknown>)[name] = new Float32Array(base, off, N); off += N * 4; }
  for (const name of INTS) { (out as unknown as Record<string, unknown>)[name] = new Int8Array(base, off, N); off += N; }
  return out;
}
