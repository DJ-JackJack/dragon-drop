import { describe, expect, it } from "vitest";
import {
  MAP_ITEMS_CLIPBOARD_TEXT, REFERENCE_KIND_TYPE, REFERENCE_PICTURE_MAX_BYTES, REFERENCE_PICTURE_TYPES, isReferenceKind, pasteChoice, pictureAskMessage, pictureKind,
  referencePictureProblem,
} from "../src/index.ts";

const head = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
  while (out.length < 64) out.push(0);
  return new Uint8Array(out);
};
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];

describe("pictureKind: what a file is, from its first bytes", () => {
  it("knows the three kinds a reference can be", () => {
    expect(pictureKind(head([0x89], "PNG\r\n", [0x1a, 0x0a]))).toBe("png");
    expect(pictureKind(head([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(pictureKind(head("RIFF", le32(100), "WEBPVP8L"))).toBe("webp");
    expect(pictureKind(head("RIFF", le32(100), "WEBPVP8X", le32(10), [0x10]))).toBe("webp"); // extended, with alpha only
    expect(Object.values(REFERENCE_KIND_TYPE).sort()).toEqual([...REFERENCE_PICTURE_TYPES].sort());
  });

  it("tells an animated WebP from a still one", () => {
    expect(pictureKind(head("RIFF", le32(100), "WEBPVP8X", le32(10), [0x02]))).toBe("webp-animated");
    expect(isReferenceKind("webp-animated")).toBe(false);
  });

  it("names the kinds people try that can't be used", () => {
    expect(pictureKind(head("GIF89a"))).toBe("gif");
    expect(pictureKind(head("BM", le32(1000), [0, 0, 0, 0], le32(54), le32(40)))).toBe("bmp");
    expect(pictureKind(head([0x49, 0x49, 0x2a, 0x00]))).toBe("tiff");
    expect(pictureKind(head([0x4d, 0x4d, 0x00, 0x2a]))).toBe("tiff");
    expect(pictureKind(head([0, 0, 0, 0x18], "ftypheic"))).toBe("heic");
    expect(pictureKind(head([0, 0, 0, 0x18], "ftypmif1"))).toBe("heic");
    expect(pictureKind(head([0, 0, 0, 0x1c], "ftypavif"))).toBe("avif");
    expect(pictureKind(head("%PDF-1.7"))).toBe("pdf");
    expect(pictureKind(head([0xef, 0xbb, 0xbf], "  <svg xmlns=\"http://www.w3.org/2000/svg\">"))).toBe("svg"); // (after a UTF-8 byte-order mark)
    expect(pictureKind(head("<?xml version=\"1.0\"?><svg"))).toBe("svg");
    expect(pictureKind(head("hello, this is a text file"))).toBeNull();
    expect(pictureKind(new Uint8Array(0))).toBeNull();
    expect(pictureKind(head([0, 0, 0, 0x18], "ftypmp42"))).toBeNull(); // a video
  });
});

describe("referencePictureProblem: the note for a picture that can't be used", () => {
  it("lets PNG, JPEG and still WebP through", () => {
    for (const k of ["png", "jpeg", "webp"] as const) expect(referencePictureProblem("a", k, 1000)).toBeNull();
  });

  it("says what each other kind is and what to do, naming the file", () => {
    const heic = referencePictureProblem("IMG_0042.HEIC", "heic", 2e6)!;
    expect(heic).toMatch(/"IMG_0042\.HEIC" is an iPhone photo/);
    expect(heic).toMatch(/Most Compatible/);
    expect(referencePictureProblem("a.gif", "gif", 10)).toMatch(/Save it as PNG or JPEG/);
    expect(referencePictureProblem("a.svg", "svg", 10)).toMatch(/Export it as PNG/);
    expect(referencePictureProblem("a.pdf", "pdf", 10)).toMatch(/screenshot/);
    expect(referencePictureProblem("anim.webp", "webp-animated", 10)).toMatch(/one frame/);
    expect(referencePictureProblem("notes.txt", null, 10)).toMatch(/only PNG, JPEG and WebP/);
  });

  it("refuses empty and too big pictures, whatever they are", () => {
    expect(referencePictureProblem("a.png", "png", 0)).toMatch(/is empty/);
    expect(referencePictureProblem("a.png", "png", REFERENCE_PICTURE_MAX_BYTES)).toBeNull();
    expect(referencePictureProblem("a.png", "png", REFERENCE_PICTURE_MAX_BYTES + 1)).toMatch(/at most 30 MB/);
  });

  it("keeps a strange name on one short line", () => {
    const m = referencePictureProblem(`evil\nname ${"x".repeat(200)}.gif`, "gif", 10)!;
    expect(m).not.toMatch(/\n/);
    expect(m.length).toBeLessThan(260);
  });
});

describe("pasteChoice: Ctrl+V pastes whichever was copied last", () => {
  it("pastes the map items while the clipboard still holds their line of text", () => {
    expect(pasteChoice({ files: 0, text: MAP_ITEMS_CLIPBOARD_TEXT, haveItems: true })).toBe("items");
  });
  it("pastes a picture copied after the map items", () => {
    expect(pasteChoice({ files: 1, text: "", haveItems: true })).toBe("pictures");
    expect(pasteChoice({ files: 2, text: "", haveItems: false })).toBe("pictures");
  });
  it("pastes the items when something else (text) was copied since, and nothing when there is nothing", () => {
    expect(pasteChoice({ files: 0, text: "some words", haveItems: true })).toBe("items");
    expect(pasteChoice({ files: 0, text: "some words", haveItems: false })).toBe("nothing");
    expect(pasteChoice({ files: 0, text: MAP_ITEMS_CLIPBOARD_TEXT, haveItems: false })).toBe("nothing"); // (copied on the other kind of map)
  });
});

describe("pictureAskMessage", () => {
  it("is one line that names the picture and asks Claude to look at it first", () => {
    const m = pictureAskMessage({ name: "Old map.jpg", text: "What is this?\nTrace it." });
    expect(m).toMatch(/^\[Picture\] /);
    expect(m).toContain('"Old map.jpg"');
    expect(m).toContain("view_reference");
    expect(m).toContain("What is this? Trace it.");
    expect(m).not.toMatch(/[\u0000-\u001f]/);
  });
});
