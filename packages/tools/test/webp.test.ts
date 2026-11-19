import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LIBWEBP_VERSION, WEBP_WASM_BASE64, WEBP_WASM_BYTES, WEBP_WASM_SHA256 } from "../src/webpWasm.ts";
import { decodeImage, decodeWebp, isWebp, sniffMediaType, webpInfo } from "../src/index.ts";

// The pictures are made by fixtures/webp/make-fixtures.py (Pillow); each .png beside a .webp is what libwebp 1.6.0 reads that file as.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "webp");
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(dir, name)));
const names = readdirSync(dir).filter((f) => f.endsWith(".webp") && f !== "animated.webp").map((f) => f.replace(/\.webp$/, "")).sort();

function same(a: { w: number; h: number; data: Uint8ClampedArray }, b: { w: number; h: number; data: Uint8ClampedArray }) {
  expect([a.w, a.h]).toEqual([b.w, b.h]);
  let differing = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) differing++;
  return differing;
}

describe("the WebP decoder (libwebp as WebAssembly)", () => {
  it("has pictures to test with, of every kind", () => {
    expect(names).toEqual(expect.arrayContaining(["lossless-rgba", "lossless-palette", "lossless-1x1", "lossy-q75-odd", "lossy-q10", "lossy-q100-sharp", "lossy-alpha", "lossy-alpha-lowquality", "lossy-wide"]));
  });

  it.each(names)("%s decodes to exactly the pixels libwebp gives", (name) => {
    const want = decodeImage(bytes(`${name}.png`))!;
    const got = decodeImage(bytes(`${name}.webp`));
    expect(got).not.toBeNull();
    expect(same(got!, want)).toBe(0); // (lossy pictures too: it is the same decoder, so not one value is off by one)
  });

  it("keeps transparency, as straight (not premultiplied) colour", () => {
    const img = decodeImage(bytes("lossless-rgba.webp"))!;
    let clear = 0, partial = 0, solid = 0;
    for (let i = 3; i < img.data.length; i += 4) { const a = img.data[i]; if (a === 0) clear++; else if (a === 255) solid++; else partial++; }
    expect(clear).toBeGreaterThan(100);
    expect(solid).toBeGreaterThan(100);
    expect(partial).toBeGreaterThan(100);
    // a mostly see-through pixel keeps its full colour: premultiplied, no channel could be brighter than the pixel is solid (alpha), and here some are
    const lossy = decodeImage(bytes("lossy-alpha.webp"))!;
    let bright = 0;
    for (let i = 0; i < lossy.data.length; i += 4) { const a = lossy.data[i + 3]; if (a > 20 && a < 100 && Math.max(lossy.data[i], lossy.data[i + 1], lossy.data[i + 2]) > a + 20) bright++; }
    expect(bright).toBeGreaterThan(20);
  });

  it("says the size, transparency and animation from the header alone", () => {
    expect(webpInfo(bytes("lossy-q75-odd.webp"))).toEqual({ w: 97, h: 61, alpha: false, animated: false });
    expect(webpInfo(bytes("lossless-rgba.webp"))).toEqual({ w: 64, h: 48, alpha: true, animated: false });
    expect(webpInfo(bytes("lossy-alpha.webp"))).toEqual({ w: 80, h: 64, alpha: true, animated: false });
    expect(webpInfo(bytes("animated.webp"))).toMatchObject({ w: 32, h: 32, animated: true });
    expect(webpInfo(bytes("lossless-rgba.png"))).toBeNull();
  });

  it("leaves animated pictures, other files and damaged files alone (null, not an error)", () => {
    expect(decodeImage(bytes("animated.webp"))).toBeNull();
    expect(decodeWebp(bytes("lossless-rgba.png"))).toBeNull();
    expect(decodeWebp(new Uint8Array(0))).toBeNull();
    expect(decodeWebp(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull(); // the 12 bytes every WebP starts with, and nothing else
    const whole = bytes("lossy-q75-odd.webp");
    expect(decodeWebp(whole.subarray(0, 20))).toBeNull();
    expect(decodeWebp(whole.subarray(0, Math.floor(whole.length / 2)))).toBeNull(); // cut off half way
    const wrong = new Uint8Array(whole); wrong.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(isWebp(wrong)).toBe(false);
    expect(sniffMediaType(wrong)).toBeNull();
  });

  it("says no to a picture over the size limit before it makes room for it", () => {
    const wide = new Uint8Array(bytes("lossless-palette.webp")); // claim a huge size in the header: 14 bits each, minus one, after the 0x2f signature byte of the lossless chunk
    const at = wide.indexOf(0x2f, 20);
    const bits = (16000 - 1) | ((16000 - 1) << 14);
    wide.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255], at + 1);
    const t0 = performance.now();
    expect(decodeWebp(wide)).toBeNull(); // (256 million pixels: over the limit, or the data is too short for that size: either way, null and quick)
    expect(performance.now() - t0).toBeLessThan(500);
    expect(decodeWebp(bytes("lossy-q75-odd.webp"), 97 * 61 - 1)).toBeNull(); // the caller's own limit
    expect(decodeWebp(bytes("lossy-q75-odd.webp"), 97 * 61)).not.toBeNull();
  });

  it("is not thrown off by damaged files (a fixed set of 1,500 random cuts and flipped bytes)", () => {
    let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let decoded = 0, refused = 0;
    const t0 = performance.now();
    for (const name of names) {
      const orig = bytes(`${name}.webp`);
      for (let k = 0; k < 150; k++) {
        const b = new Uint8Array(orig);
        let input: Uint8Array = b;
        if (k % 3 === 0) for (let n = 0, c = 1 + Math.floor(rnd() * 5); n < c; n++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
        else if (k % 3 === 1) input = b.subarray(0, Math.floor(rnd() * b.length));
        else for (let n = 0; n < 30; n++) b[12 + Math.floor(rnd() * (b.length - 12))] ^= 1 << Math.floor(rnd() * 8);
        const img = decodeWebp(input);
        if (img) { decoded++; expect(img.data.length).toBe(img.w * img.h * 4); } else refused++;
      }
    }
    expect(decoded + refused).toBe(names.length * 150);
    expect(performance.now() - t0).toBeLessThan(20000);
    // and a damaged file leaves nothing behind for the next picture: the good ones still decode exactly
    expect(same(decodeImage(bytes("lossless-rgba.webp"))!, decodeImage(bytes("lossless-rgba.png"))!)).toBe(0);
  });

  it("decodes through decodeImage, and the media type sniffer knows WebP by all twelve bytes", () => {
    expect(sniffMediaType(bytes("lossy-q10.webp"))).toBe("image/webp");
    expect(sniffMediaType(bytes("lossless-rgba.png"))).toBe("image/png");
    expect(decodeImage(bytes("lossy-q10.webp"))).toMatchObject({ w: 80, h: 56 });
  });

  describe("the module itself", () => {
    const wasm = inflateRawSync(Buffer.from(WEBP_WASM_BASE64, "base64"));
    it("is the one that was built (sha256 and size)", () => {
      expect(createHash("sha256").update(wasm).digest("hex")).toBe(WEBP_WASM_SHA256);
      expect(wasm.length).toBe(WEBP_WASM_BYTES);
      expect(LIBWEBP_VERSION).toBe("1.6.0"); // CVE-2023-4863 (the lossless decoder's heap overflow) was fixed in 1.3.2; never go back below that
    });
    it("can't reach anything outside itself: it imports nothing, and exports only memory and its four functions", () => {
      const m = new WebAssembly.Module(wasm);
      expect(WebAssembly.Module.imports(m)).toEqual([]);
      expect(WebAssembly.Module.exports(m).map((e) => e.name).sort()).toEqual(["_initialize", "dd_alloc", "dd_decode", "dd_free", "dd_info", "memory"]);
    });
  });
});
