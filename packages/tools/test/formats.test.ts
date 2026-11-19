/** docs/FORMATS.md is made from packages/core/src/formats.ts, and what that list says has to be what the program really does. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ASSET_PICTURE_EXTENSIONS, BATTLE_EXPORT_FORMATS, FORMATS_END, FORMATS_READ, FORMATS_START, FORMATS_WRITTEN, IMAGE_EXT, PACK_FILE_NAME, REFERENCE_PICTURE_ACCEPT,
  REFERENCE_PICTURE_EXT, REFERENCE_PICTURE_EXTENSIONS, REFERENCE_PICTURE_TYPES, ZIP_FILE_NAME, formatsMarkdown,
} from "@mapmaker/core";
import { TOOLS, decodeImage, encodeJpeg, encodePng, sniffMediaType } from "../src/index.ts";

const docFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/FORMATS.md");

describe("docs/FORMATS.md", () => {
  it("has exactly the tables the list in the code makes (run `pnpm formats` after changing the list)", () => {
    const text = readFileSync(docFile, "utf8");
    const a = text.indexOf(FORMATS_START.slice(0, 20)), b = text.indexOf(FORMATS_END);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(text.slice(a, b + FORMATS_END.length)).toBe(formatsMarkdown());
  });

  it("describes every format with all its parts, once", () => {
    for (const list of [FORMATS_READ, FORMATS_WRITTEN]) {
      expect(new Set(list.map((f) => f.id)).size).toBe(list.length);
      for (const f of list) for (const part of [f.name, f.files, f.use, f.limits]) expect(part.trim().length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("what the list says about pictures is true", () => {
  const tiny = { w: 4, h: 3, data: new Uint8ClampedArray(4 * 3 * 4).fill(200) };
  const stub = (head: number[]) => new Uint8Array([...head, ...new Array(40).fill(0)]);

  // a real (tiny) WebP: lossless, 1 x 1 (made by the WebP test fixtures)
  const webpPicture = new Uint8Array(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "webp", "lossless-1x1.webp")));

  it("reference pictures: PNG, JPEG and WebP decode, and nothing else the picker could pass in does", () => {
    expect(decodeImage(encodePng(tiny))).toMatchObject({ w: 4, h: 3 });
    expect(decodeImage(encodeJpeg(tiny))).toMatchObject({ w: 4, h: 3 });
    expect(decodeImage(webpPicture)).toMatchObject({ w: 1, h: 1 });
    const sample: Record<string, Uint8Array> = { "image/png": encodePng(tiny), "image/jpeg": encodeJpeg(tiny), "image/webp": webpPicture };
    expect(REFERENCE_PICTURE_TYPES.map((t) => sniffMediaType(sample[t]))).toEqual([...REFERENCE_PICTURE_TYPES]);
    const gif = stub([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(decodeImage(gif)).toBeNull(); // (the formats list says GIF is not accepted as a reference)
    expect(decodeImage(stub([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull(); // a "WebP" that is only its first twelve bytes
  });

  it("the file picker and the reference listing take exactly those, and the page says so", () => {
    for (const e of REFERENCE_PICTURE_EXTENSIONS) { expect(REFERENCE_PICTURE_EXT.test(`a.${e}`)).toBe(true); expect(REFERENCE_PICTURE_ACCEPT).toContain(`.${e}`); }
    for (const bad of ["a.gif", "a.bmp", "a.avif", "a.png.txt"]) expect(REFERENCE_PICTURE_EXT.test(bad)).toBe(false);
    for (const t of REFERENCE_PICTURE_TYPES) expect(REFERENCE_PICTURE_ACCEPT).toContain(t);
    const ref = FORMATS_READ.find((f) => f.id === "reference")!;
    for (const e of REFERENCE_PICTURE_EXTENSIONS) expect(ref.files).toContain(`.${e}`);
    expect(ref.limits).toMatch(/PNG, JPEG and WebP/);
  });

  it("asset pictures: the library lists what the page lists, and all of them are drawn", () => {
    for (const e of ASSET_PICTURE_EXTENSIONS) expect(IMAGE_EXT.test(`dir/a.${e.toUpperCase()}`)).toBe(true);
    for (const bad of ["a.gif", "a.svg", "a.bmp", "a.tga"]) expect(IMAGE_EXT.test(bad)).toBe(false);
    const pics = FORMATS_READ.find((f) => f.id === "asset-pictures")!;
    for (const e of ASSET_PICTURE_EXTENSIONS) expect(pics.files).toContain(`.${e}`);
    expect(pics.limits).toMatch(/PNG, JPEG and WebP are used everywhere/);
    expect(pics.limits).toMatch(/animated WebP is skipped/);
    expect(decodeImage(webpPicture)).not.toBeNull(); // (if WebP stops decoding, the page must say so again)
    expect(decodeImage(new Uint8Array(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "webp", "animated.webp"))))).toBeNull(); // an animated one is skipped, as the page says
  });

  it("zip and pack file names", () => {
    expect(ZIP_FILE_NAME.test("Kit.ZIP")).toBe(true);
    expect(ZIP_FILE_NAME.test("kit.zip.txt")).toBe(false);
    for (const ok of ["a.example_pack", "B.X_PACK", "c.pck", "my pack.pck"]) expect(PACK_FILE_NAME.test(ok)).toBe(true);
    for (const bad of ["a.pack", "b.zip", "c.txt", "pack", "a_pack"]) expect(PACK_FILE_NAME.test(bad)).toBe(false);
  });
});

describe("what the list says about exports is true", () => {
  it("the export tool offers exactly the formats in the list, and the list describes each one", () => {
    const tool = TOOLS.find((t) => t.name === "export_battlemap")!;
    const offered = (tool.schema as unknown as { shape: { format: { options: string[] } } }).shape.format.options;
    expect([...offered].sort()).toEqual([...BATTLE_EXPORT_FORMATS].sort());
    const described = FORMATS_WRITTEN.filter((f) => f.exportFormat).map((f) => f.exportFormat);
    expect([...described].sort()).toEqual([...BATTLE_EXPORT_FORMATS].sort());
  });
});
