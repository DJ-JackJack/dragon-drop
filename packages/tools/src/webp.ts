/**
 * WebP decoding: libwebp (the reference decoder) compiled to WebAssembly, built by tools/webp-wasm/build.sh and carried in webpWasm.ts, so there is no file to find,
 * no native build and nothing to install. It reads lossy, lossless and transparent pictures.
 *
 * The module has no imports at all: it can't reach the disk, the network or anything of ours. Each picture is decoded in a fresh instance of it that is thrown away
 * afterwards, so a damaged file can't leave anything behind for the next one, and the memory a big picture needed goes back when the picture is done.
 * Animated WebP files are not decoded (null): only still pictures are used as maps and objects.
 */
import { inflateRawSync } from "node:zlib";
import type { RGBAImage } from "@mapmaker/core";
import { WEBP_WASM_BASE64 } from "./webpWasm.ts";

/** WebP can't be bigger than 16383 x 16383. */
const MAX_SIDE = 16383;
/** The most pixels one picture may have unless the caller says otherwise: the asset library's own limit (40 million pixels is 160 MB of RGBA). */
export const WEBP_MAX_PIXELS = 40_000_000;

interface Exports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  dd_alloc: (n: number) => number;
  dd_free: (p: number) => void;
  dd_info: (data: number, size: number, out: number) => number;
  dd_decode: (data: number, size: number, out: number, outSize: number, stride: number) => number;
}

let compiled: WebAssembly.Module | undefined;
function wasmModule(): WebAssembly.Module {
  return (compiled ??= new WebAssembly.Module(inflateRawSync(Buffer.from(WEBP_WASM_BASE64, "base64"))));
}

/** Is this the start of a WebP file ("RIFF" size "WEBP")? */
export function isWebp(b: Uint8Array): boolean {
  return b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}

export interface WebpInfo { w: number; h: number; alpha: boolean; animated: boolean }

/** Runs `use` with a fresh instance of the decoder and the file copied into it. */
function withFile<T>(bytes: Uint8Array, use: (x: Exports, data: number) => T): T | null {
  if (!isWebp(bytes)) return null;
  const x = new WebAssembly.Instance(wasmModule(), {}).exports as unknown as Exports;
  x._initialize?.();
  const data = x.dd_alloc(bytes.length);
  if (!data) return null;
  new Uint8Array(x.memory.buffer, data, bytes.length).set(bytes); // (read memory.buffer afresh each time: growing memory replaces it)
  return use(x, data);
}

function readInfo(x: Exports, data: number, size: number): WebpInfo | null {
  const out = x.dd_alloc(16);
  if (!out) return null;
  if (!x.dd_info(data, size, out)) return null;
  const v = new Int32Array(x.memory.buffer, out, 4);
  const info = { w: v[0], h: v[1], alpha: v[2] !== 0, animated: v[3] !== 0 };
  x.dd_free(out);
  return info;
}

/** The size (and whether it is see-through or animated) from the header alone, or null if this isn't a WebP file we can read. */
export function webpInfo(bytes: Uint8Array): WebpInfo | null {
  try {
    return withFile(bytes, (x, data) => readInfo(x, data, bytes.length));
  } catch {
    return null;
  }
}

/** Decode a still WebP picture to straight (not premultiplied) RGBA. Null for anything else, for a damaged file, for an animated one, or for one with more than `maxPixels` pixels. */
export function decodeWebp(bytes: Uint8Array, maxPixels = WEBP_MAX_PIXELS): RGBAImage | null {
  try {
    return withFile(bytes, (x, data) => {
      const info = readInfo(x, data, bytes.length);
      if (!info || info.animated) return null;
      const { w, h } = info;
      if (!(w > 0 && h > 0 && w <= MAX_SIDE && h <= MAX_SIDE) || w * h > maxPixels) return null;
      const size = w * h * 4;
      const out = x.dd_alloc(size);
      if (!out) return null; // (it asked for more memory than the module may have)
      if (!x.dd_decode(data, bytes.length, out, size, w * 4)) return null;
      const pixels = new Uint8ClampedArray(size);
      pixels.set(new Uint8Array(x.memory.buffer, out, size));
      return { w, h, data: pixels };
    });
  } catch {
    return null; // (a trap inside the module: the file was damaged in a way the decoder could not take)
  }
}
