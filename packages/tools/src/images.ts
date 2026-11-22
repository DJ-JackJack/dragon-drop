/** Image encode/decode helpers (pure JS, works on Windows without native builds). */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { type RGBAImage, cropScale, imageSize, picturePixelsProblem } from "@mapmaker/core";
import { decodeWebp, isWebp } from "./webp.ts";

/** Encode as JPEG, lowering quality until it fits under maxBytes (MCP clients cap tool results ~1 MB). */
export function encodeJpeg(img: RGBAImage, quality = 85, maxBytes = 800_000): Uint8Array {
  let q = quality;
  for (;;) {
    const out = jpeg.encode({ width: img.w, height: img.h, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) }, q).data;
    if (out.byteLength <= maxBytes || q <= 40) return new Uint8Array(out);
    q -= 10;
  }
}

/** Encode as PNG (lossless: for exports). */
export function encodePng(img: RGBAImage): Uint8Array {
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return new Uint8Array(PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 6 }));
}

/** PNG with an alpha channel (encodePng writes RGB: it has no transparency). For pictures that are partly see-through, such as a roof laid over a battlemap. */
export function encodePngRgba(img: RGBAImage): Uint8Array {
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return new Uint8Array(PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true, deflateLevel: 6 }));
}

export function sniffMediaType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (isWebp(bytes)) return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return null;
}

/**
 * Decode PNG, JPEG or (still) WebP to RGBA. Returns null for formats we can't decode here (GIF, animated WebP, damaged WebP files). Throws, with a message
 * for the person, for a picture that says it has more than PICTURE_MAX_PIXELS: that is checked before anything is decoded (a small file can claim a huge picture).
 */
export function decodeImage(bytes: Uint8Array): RGBAImage | null {
  const t = sniffMediaType(bytes);
  if (t && t !== "image/gif") {
    const big = picturePixelsProblem("The picture", imageSize(bytes));
    if (big) throw new Error(big);
  }
  if (t === "image/png") {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
  }
  if (t === "image/jpeg") {
    const j = jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { w: j.width, h: j.height, data: new Uint8ClampedArray(j.data.buffer, j.data.byteOffset, j.data.byteLength) };
  }
  if (t === "image/webp") return decodeWebp(bytes);
  return null;
}

/** A reference picture made ready to show the model: its size, and a JPEG of it (or of a part) no bigger than asked. */
export interface PreparedReference { jpeg: Uint8Array; width: number; height: number; outW: number; outH: number; scale: number }

/** Crop (in source pixels) and scale a reference image so the long edge is <= maxPx. */
export function prepareReference(bytes: Uint8Array, maxPx: number, region?: { x: number; y: number; w: number; h: number }): PreparedReference | null {
  const img = decodeImage(bytes);
  if (!img) return null;
  const r = region ?? { x: 0, y: 0, w: img.w, h: img.h };
  const { img: out, scale } = cropScale(img, r, maxPx);
  return { jpeg: encodeJpeg(out, 85), width: img.w, height: img.h, outW: out.w, outH: out.h, scale };
}

/**
 * Reading pictures, which takes a while for a big one (pure JavaScript decoders): the server does it on a worker thread so the map, the editor and the
 * other tools aren't held up meanwhile (`ToolContext.pictures`); without one (tests, scripts) it is done here.
 */
export interface PictureWork {
  decode(bytes: Uint8Array): Promise<RGBAImage | null>;
  reference(bytes: Uint8Array, maxPx: number, region?: { x: number; y: number; w: number; h: number }): Promise<PreparedReference | null>;
}
export const inlinePictures: PictureWork = {
  decode: async (bytes) => decodeImage(bytes),
  reference: async (bytes, maxPx, region) => prepareReference(bytes, maxPx, region),
};

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
