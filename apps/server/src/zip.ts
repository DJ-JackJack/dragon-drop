/**
 * A small reader for .zip files, so a downloaded asset pack can be used as it is (never unpacked to disk): the index is read from the
 * end of the file, and each picture is fetched by offset and inflated when it is asked for. Stored and deflated files are supported
 * (that is everything the common tools write), including zip64 for archives over 4 GB. Encrypted entries, other compression methods
 * and unsafe paths are left out of the index.
 */
import { deflateRawSync, constants, inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import type { RandomAccess } from "@mapmaker/core";

const inflate = promisify(inflateRaw) as (buf: Uint8Array, opts: { finishFlush?: number; maxOutputLength?: number }) => Promise<Buffer>;

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  path: string;
  /** Where the entry's local header starts. */
  offset: number;
  /** Size once inflated, and as stored. */
  size: number;
  csize: number;
  /** 0 = stored, 8 = deflated. */
  method: number;
}

const MAX_ENTRIES = 2_000_000;
const MAX_INDEX_BYTES = 256_000_000;
/** The biggest single file read out of an archive (a picture of 40 megapixels is about 160 MB as RGBA, far under this as a file). */
export const MAX_ZIP_FILE_BYTES = 512_000_000;

const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, p: number) => u32(b, p + 4) * 4294967296 + u32(b, p);

/** A path that stays inside the archive and isn't metadata some tools add (macOS resource forks). */
function cleanPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p || p.endsWith("/") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((s) => s === ".." || s === "." || s === "")) return null;
  if (parts[0] === "__MACOSX" || parts.some((s) => s.startsWith("._"))) return null;
  return p;
}

export async function readZipIndex(ra: RandomAccess): Promise<ZipEntry[]> {
  if (ra.size < 22) throw new Error("This file is too small to be a zip file.");
  const tailLen = Math.min(ra.size, 22 + 65535);
  const tail = await ra.read(ra.size - tailLen, tailLen);
  let e = -1;
  for (let p = tail.length - 22; p >= 0; p--) if (u32(tail, p) === 0x06054b50) { e = p; break; }
  if (e < 0) throw new Error("This isn't a zip file, or it is damaged or incomplete (no end-of-file record).");
  let total = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOffset = u32(tail, e + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // zip64: the real numbers are in a second record, found through a locator just before the end record
    if (e < 20 || u32(tail, e - 20) !== 0x07064b50) throw new Error("This zip file's index is damaged (zip64 locator missing).");
    const at = u64(tail, e - 20 + 8);
    const rec = await ra.read(at, 56);
    if (rec.length < 56 || u32(rec, 0) !== 0x06064b50) throw new Error("This zip file's index is damaged (zip64 record missing).");
    total = u64(rec, 32); cdSize = u64(rec, 40); cdOffset = u64(rec, 48);
  }
  if (total > MAX_ENTRIES) throw new Error("This zip file claims an impossible number of files.");
  if (cdSize > MAX_INDEX_BYTES || cdOffset + cdSize > ra.size) throw new Error("This zip file's index is damaged or incomplete.");
  const cd = await ra.read(cdOffset, cdSize);
  const dec = new TextDecoder("utf-8");
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < total && p + 46 <= cd.length; i++) {
    if (u32(cd, p) !== 0x02014b50) break; // (the rest is not an index: keep what was read)
    const flags = u16(cd, p + 8), method = u16(cd, p + 10);
    let csize = u32(cd, p + 20), size = u32(cd, p + 24), offset = u32(cd, p + 42);
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    const nameAt = p + 46;
    if (nameAt + nameLen + extraLen > cd.length) break;
    if (size === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
      for (let x = nameAt + nameLen, end = x + extraLen; x + 4 <= end;) {
        const id = u16(cd, x), len = u16(cd, x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
          if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; }
          if (offset === 0xffffffff) offset = u64(cd, q);
        }
        x += 4 + len;
      }
    }
    p = nameAt + nameLen + extraLen + commentLen;
    const clean = cleanPath(dec.decode(cd.subarray(nameAt, nameAt + nameLen)));
    if (!clean || (flags & 1) !== 0 || (method !== 0 && method !== 8)) continue; // folders, encrypted files, exotic compression
    if (offset + 30 > ra.size || size > MAX_ZIP_FILE_BYTES) continue;
    out.push({ path: clean, offset, size, csize, method });
  }
  return out;
}

/** Where an entry's bytes start (after its local header). */
async function dataStart(ra: RandomAccess, e: ZipEntry): Promise<number> {
  const h = await ra.read(e.offset, 30);
  if (h.length < 30 || u32(h, 0) !== 0x04034b50) throw new Error(`The zip file is damaged near "${e.path}".`);
  return e.offset + 30 + u16(h, 26) + u16(h, 28);
}

/** The whole file, inflated. */
export async function readZipFile(ra: RandomAccess, e: ZipEntry): Promise<Uint8Array> {
  if (e.size > MAX_ZIP_FILE_BYTES) throw new Error(`"${e.path}" is too big to use.`);
  const start = await dataStart(ra, e);
  if (e.method === 0) return ra.read(start, e.size);
  const packed = await ra.read(start, e.csize);
  // (the size the file says it has is the limit: a file that inflates to more is not what it claims to be)
  const raw = await inflate(packed, { maxOutputLength: Math.max(1, e.size) + 1024 });
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/** The first `n` bytes of the file (enough for an image's size) without inflating all of it. */
export async function readZipHead(ra: RandomAccess, e: ZipEntry, n: number): Promise<Uint8Array> {
  const start = await dataStart(ra, e);
  if (e.method === 0) return ra.read(start, Math.min(n, e.size));
  const packed = await ra.read(start, Math.min(e.csize, n + 4096));
  const raw = await inflate(packed, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: Math.max(n * 64, 4_000_000) }); // (a cut-off stream is fine: that is the point)
  return new Uint8Array(raw.buffer, raw.byteOffset, Math.min(n, raw.byteLength));
}

// ----------------------------------------------------------------------------- writing (for tests and sample packs)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Write a plain zip file (each entry deflated unless `store` is set). */
export function writeZip(files: { path: string; data: Uint8Array; store?: boolean }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  const push = (b: Uint8Array) => { chunks.push(b); at += b.length; };
  for (const f of files) {
    const name = enc.encode(f.path);
    const packed = f.store ? f.data : new Uint8Array(deflateRawSync(f.data));
    const method = f.store ? 0 : 8, crc = crc32(f.data), offset = at;
    const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, method, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, packed.length, true); dv.setUint32(22, f.data.length, true); dv.setUint16(26, name.length, true);
    lh.set(name, 30);
    push(lh); push(packed);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
  }
  const cdStart = at;
  for (const c of central) push(c);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, at - cdStart, true); ev.setUint32(16, cdStart, true);
  push(end);
  const out = new Uint8Array(at);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
