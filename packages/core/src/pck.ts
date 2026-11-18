/**
 * Reader for Godot "PCK" archives, the pack format that map tools built on the Godot engine use for their asset packs.
 * It is recognised by its first four bytes ("GDPC"), not by the file's name, so a pack works whatever it is called.
 * Only the index is read up front (a 4 GB pack has an index of a few MB); files are fetched by offset on demand.
 *
 * Layout (Godot 3.x, "format version 1", from core/io/file_access_pack.cpp):
 *   u32 magic "GDPC", u32 version, u32 major, u32 minor, u32 patch, 16 x u32 reserved, u32 file count, then per file:
 *   u32 path length (padded to 4), path bytes (UTF-8, "res://..."), u64 offset, u64 size, 16 bytes md5.
 * Godot 4 uses version 2 (adds pack flags, a file base, and a u32 flags per file) and 3 (index at an offset).
 */

export interface RandomAccess {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface PckEntry {
  /** Path inside the pack without "res://", e.g. "textures/objects/table.png". */
  path: string;
  /** Absolute offset of the file's bytes in the pack file. */
  offset: number;
  size: number;
  encrypted?: boolean;
}

export interface PckInfo {
  formatVersion: number;
  engine: string;
  entries: PckEntry[];
}

export const PCK_MAGIC = 0x43504447; // "GDPC" little endian

/** Whether these first bytes are a pack file's signature. */
export function isPckSignature(head: Uint8Array): boolean {
  return head.length >= 4 && (head[0] | (head[1] << 8) | (head[2] << 16) | (head[3] << 24)) >>> 0 === PCK_MAGIC;
}

/** Sequential reader that fetches the index in large chunks. */
class Cursor {
  private buf: Uint8Array = new Uint8Array(0);
  private bufStart = 0;
  pos: number;
  constructor(private ra: RandomAccess, start: number, private chunk = 1 << 20) {
    this.pos = start;
  }

  async take(n: number): Promise<Uint8Array> {
    if (n < 0 || this.pos + n > this.ra.size) throw new Error("The pack file ends unexpectedly (it may be damaged or incomplete).");
    const end = this.pos + n;
    if (this.pos < this.bufStart || end > this.bufStart + this.buf.length) {
      const want = Math.min(this.ra.size - this.pos, Math.max(this.chunk, n));
      this.buf = await this.ra.read(this.pos, want);
      this.bufStart = this.pos;
      if (this.buf.length < n) throw new Error("The pack file ended unexpectedly while reading its index.");
    }
    const out = this.buf.subarray(this.pos - this.bufStart, end - this.bufStart);
    this.pos = end;
    return out;
  }

  async u32(): Promise<number> {
    const b = await this.take(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }

  async u64(): Promise<number> {
    const lo = await this.u32();
    const hi = await this.u32();
    return hi * 4294967296 + lo; // exact up to 2^53, far beyond any pack
  }
}

const MAX_FILES = 5_000_000;

export async function readPck(ra: RandomAccess): Promise<PckInfo> {
  if (ra.size < 100) throw new Error("This file is too small to be an asset pack.");
  const c = new Cursor(ra, 0);
  if ((await c.u32()) !== PCK_MAGIC) throw new Error("This isn't a pack file Dragon Drop can read (it doesn't start with GDPC).");
  const formatVersion = await c.u32();
  const major = await c.u32();
  const minor = await c.u32();
  const patch = await c.u32();
  if (formatVersion > 3) throw new Error(`Pack format version ${formatVersion} isn't supported.`);
  let base = 0;
  let dirOffset = 0;
  if (formatVersion >= 2) {
    await c.u32(); // pack flags
    base = await c.u64();
    if (formatVersion >= 3) dirOffset = await c.u64();
  }
  for (let i = 0; i < 16; i++) await c.u32(); // reserved
  if (formatVersion >= 3) c.pos = base + dirOffset;
  const count = await c.u32();
  if (count > MAX_FILES) throw new Error("The pack claims an impossible number of files.");
  const dec = new TextDecoder("utf-8");
  const entries: PckEntry[] = [];
  for (let i = 0; i < count; i++) {
    const len = await c.u32();
    if (len > 4096) throw new Error("A file name in the pack is impossibly long (the pack may be damaged).");
    const nameBytes = await c.take(len);
    let end = nameBytes.length;
    while (end > 0 && nameBytes[end - 1] === 0) end--;
    let path = dec.decode(nameBytes.subarray(0, end));
    if (path.startsWith("res://")) path = path.slice(6);
    const offset = (await c.u64()) + base;
    const size = await c.u64();
    await c.take(16); // md5
    let encrypted = false;
    if (formatVersion >= 2) encrypted = ((await c.u32()) & 1) === 1;
    if (offset + size > ra.size) continue; // truncated download: skip files that aren't all there
    entries.push({ path, offset, size, ...(encrypted && { encrypted: true }) });
  }
  return { formatVersion, engine: `${major}.${minor}.${patch}`, entries };
}

export function readPckFile(ra: RandomAccess, e: PckEntry): Promise<Uint8Array> {
  if (e.encrypted) throw new Error("This file is encrypted.");
  return ra.read(e.offset, e.size);
}

/** An in-memory pack file as RandomAccess (tests). */
export function memoryAccess(bytes: Uint8Array): RandomAccess {
  return { size: bytes.length, read: async (o, n) => bytes.subarray(o, Math.min(bytes.length, o + n)) };
}

/** Write a version-1 PCK (what Godot 3 produces). Used by tests and for building sample packs. */
export function writePck(files: { path: string; data: Uint8Array }[], opts: { align?: number } = {}): Uint8Array {
  const align = opts.align ?? 16;
  const enc = new TextEncoder();
  const names = files.map((f) => enc.encode(f.path.startsWith("res://") ? f.path : `res://${f.path}`));
  const pad = (n: number, a: number) => (a - (n % a)) % a;
  let indexSize = 4 + 4 + 12 + 64 + 4;
  for (const n of names) indexSize += 4 + n.length + pad(n.length, 4) + 8 + 8 + 16;
  let dataStart = indexSize + pad(indexSize, align);
  const offsets: number[] = [];
  let cursor = dataStart;
  for (const f of files) {
    offsets.push(cursor);
    cursor += f.data.length + pad(f.data.length, align);
  }
  const out = new Uint8Array(cursor);
  const dv = new DataView(out.buffer);
  let p = 0;
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  const u64 = (v: number) => { dv.setUint32(p, v % 4294967296, true); dv.setUint32(p + 4, Math.floor(v / 4294967296), true); p += 8; };
  u32(PCK_MAGIC); u32(1); u32(3); u32(5); u32(0);
  for (let i = 0; i < 16; i++) u32(0);
  u32(files.length);
  files.forEach((f, i) => {
    const n = names[i], padding = pad(n.length, 4);
    u32(n.length + padding);
    out.set(n, p); p += n.length + padding;
    u64(offsets[i]); u64(f.data.length);
    p += 16;
  });
  files.forEach((f, i) => out.set(f.data, offsets[i]));
  return out;
}
