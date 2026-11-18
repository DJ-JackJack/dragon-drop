/**
 * Pixel size of an image from its first bytes, without decoding it: the asset browser needs a size for every picture it lists, and
 * a few KB from each file is all that takes. PNG, WebP, GIF, BMP and JPEG are recognised (JPEG keeps its size after the first
 * few segments, so give it up to about 64 KB).
 */

export interface PixelSize { w: number; h: number }

/** Width and height of a PNG from its first bytes, or null. */
export function pngSize(b: Uint8Array): PixelSize | null {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

const ok = (w: number, h: number): PixelSize | null => (w > 0 && h > 0 ? { w, h } : null);

/** How many bytes of a file to hand to `imageSize` (enough for every format it knows). */
export const IMAGE_HEAD_BYTES = 65536;

export function imageSize(b: Uint8Array): PixelSize | null {
  const png = pngSize(b);
  if (png) return png;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // GIF: "GIF8", then the screen width and height as 16 bit little-endian numbers
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return ok(dv.getUint16(6, true), dv.getUint16(8, true));
  // BMP: "BM"; the header size says how the size is stored (a negative height just means the rows run top down)
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return dv.getUint32(14, true) === 12 ? ok(dv.getUint16(18, true), dv.getUint16(20, true)) : ok(Math.abs(dv.getInt32(18, true)), Math.abs(dv.getInt32(22, true)));
  }
  // WebP: "RIFF" <size> "WEBP", then a chunk that is lossy ("VP8 "), lossless ("VP8L") or extended ("VP8X")
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return ok(dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff);
    if (kind === "VP8L" && b[20] === 0x2f) { const bits = dv.getUint32(21, true); return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
    if (kind === "VP8X") return ok((b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1);
    return null;
  }
  // JPEG: walk the segments until a "start of frame" one, which holds the size
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m === 0xff) { p++; continue; } // padding
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; } // markers with no length
      const len = dv.getUint16(p + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(dv.getUint16(p + 7), dv.getUint16(p + 5));
      if (len < 2) return null;
      p += 2 + len;
    }
  }
  return null;
}
