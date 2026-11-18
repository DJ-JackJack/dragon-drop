import { describe, expect, it } from "vitest";
import { memoryAccess } from "@mapmaker/core";
import { readZipFile, readZipHead, readZipIndex, writeZip } from "../src/zip.ts";

const text = (s: string) => new TextEncoder().encode(s);
const sig = (b: Uint8Array, s: number) => { const out: number[] = []; for (let i = 0; i + 4 <= b.length; i++) if ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 === s) out.push(i); return out; };
const CENTRAL = 0x02014b50, END = 0x06054b50;

/** Patch the n-th central directory record of a zip written by writeZip. */
function patchCentral(zip: Uint8Array, n: number, fn: (dv: DataView, at: number) => void): Uint8Array {
  const out = zip.slice();
  const at = sig(out, CENTRAL)[n];
  fn(new DataView(out.buffer), at);
  return out;
}

describe("zip reader", () => {
  const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
  const files = [
    { path: "Floors/cobble.png", data: big },
    { path: "Doors/oak.png", data: text("stored bytes"), store: true },
    { path: "Props/Château ☆.png", data: text("unicode name") },
    { path: "pack.json", data: text('{"name":"X"}') },
  ];

  it("lists and reads stored and deflated files, including unicode names", async () => {
    const ra = memoryAccess(writeZip(files));
    const idx = await readZipIndex(ra);
    expect(idx.map((e) => e.path)).toEqual(files.map((f) => f.path));
    expect(idx.map((e) => e.method)).toEqual([8, 0, 8, 8]);
    for (let i = 0; i < files.length; i++) expect(Array.from(await readZipFile(ra, idx[i]))).toEqual(Array.from(files[i].data));
  });

  it("reads just the start of a file without inflating all of it", async () => {
    const ra = memoryAccess(writeZip(files));
    const idx = await readZipIndex(ra);
    expect(Array.from(await readZipHead(ra, idx[0], 100))).toEqual(Array.from(big.subarray(0, 100)));
    expect(Array.from(await readZipHead(ra, idx[1], 6))).toEqual(Array.from(text("stored")));
    expect((await readZipHead(ra, idx[3], 1000)).length).toBe(files[3].data.length); // shorter than asked
  });

  it("leaves out folders, macOS metadata, unsafe paths, encrypted files and exotic compression; backslashes become slashes", async () => {
    const zip = writeZip([
      { path: "ok/a.png", data: text("a") },
      { path: "folder/", data: new Uint8Array(0) },
      { path: "__MACOSX/ok/._a.png", data: text("x") },
      { path: "ok/._b.png", data: text("x") },
      { path: "../evil.png", data: text("x") },
      { path: "/abs.png", data: text("x") },
      { path: "C:/win.png", data: text("x") },
      { path: "a/../b.png", data: text("x") },
      { path: "back\\slash.png", data: text("s") },
      { path: "locked.png", data: text("x") },
      { path: "weird.png", data: text("x") },
    ]);
    const patched = patchCentral(patchCentral(zip, 9, (dv, at) => dv.setUint16(at + 8, 0x0801, true)), 10, (dv, at) => dv.setUint16(at + 10, 12, true));
    const idx = await readZipIndex(memoryAccess(patched));
    expect(idx.map((e) => e.path)).toEqual(["ok/a.png", "back/slash.png"]);
  });

  it("refuses what isn't a zip file, or is cut off", async () => {
    await expect(readZipIndex(memoryAccess(new Uint8Array(500)))).rejects.toThrow(/zip/i);
    await expect(readZipIndex(memoryAccess(new Uint8Array(5)))).rejects.toThrow(/too small/i);
    const zip = writeZip(files);
    await expect(readZipIndex(memoryAccess(zip.subarray(0, zip.length - 40)))).rejects.toThrow(/zip/i);
  });

  it("reads the zip64 layout used by archives over 4 GB (numbers in a second record)", async () => {
    const zip = writeZip(files.slice(0, 2));
    const end = sig(zip, END)[0];
    const dv0 = new DataView(zip.buffer, zip.byteOffset);
    const cdSize = dv0.getUint32(end + 12, true), cdOffset = dv0.getUint32(end + 16, true);
    const rec = new Uint8Array(56), rv = new DataView(rec.buffer);
    rv.setUint32(0, 0x06064b50, true); rv.setUint32(4, 44, true); rv.setUint16(12, 45, true); rv.setUint16(14, 45, true);
    rv.setUint32(32, 2, true); rv.setUint32(40, cdSize, true); rv.setUint32(48, cdOffset, true); // (entries, index size, index offset)
    const loc = new Uint8Array(20), lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x07064b50, true); lv.setUint32(8, end, true); lv.setUint32(16, 1, true);
    const eocd = zip.slice(end); // the 22 byte end record, with every number marked "see the zip64 record"
    const ev = new DataView(eocd.buffer);
    ev.setUint16(10, 0xffff, true); ev.setUint32(12, 0xffffffff, true); ev.setUint32(16, 0xffffffff, true);
    const out = new Uint8Array(end + 56 + 20 + 22);
    out.set(zip.subarray(0, end), 0); out.set(rec, end); out.set(loc, end + 56); out.set(eocd, end + 76);
    const ra = memoryAccess(out);
    const idx = await readZipIndex(ra);
    expect(idx.map((e) => e.path)).toEqual(["Floors/cobble.png", "Doors/oak.png"]);
    expect(Array.from(await readZipFile(ra, idx[1]))).toEqual(Array.from(files[1].data));
  });

  it("won't inflate a file to more than the size it says it has (a zip bomb)", async () => {
    const zip = writeZip([{ path: "bomb.png", data: new Uint8Array(2_000_000) }]); // two million zeros deflate to about 2 KB
    const lying = patchCentral(zip, 0, (dv, at) => dv.setUint32(at + 24, 100, true));
    const ra = memoryAccess(lying);
    const idx = await readZipIndex(ra);
    expect(idx[0].size).toBe(100);
    await expect(readZipFile(ra, idx[0])).rejects.toThrow();
  });
});
