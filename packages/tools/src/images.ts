/** Image encode/decode helpers (pure JS, works on Windows without native builds). */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { type RGBAImage, cropScale } from "@mapmaker/core";

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
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return null;
}

/** Decode PNG or JPEG to RGBA. Returns null for formats we can't decode here (webp/gif). */
export function decodeImage(bytes: Uint8Array): RGBAImage | null {
  const t = sniffMediaType(bytes);
  if (t === "image/png") {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
  }
  if (t === "image/jpeg") {
    const j = jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { w: j.width, h: j.height, data: new Uint8ClampedArray(j.data.buffer, j.data.byteOffset, j.data.byteLength) };
  }
  return null;
}

/** Crop (in source pixels) and scale a reference image so the long edge is <= maxPx. */
export function prepareReference(bytes: Uint8Array, maxPx: number, region?: { x: number; y: number; w: number; h: number }) {
  const img = decodeImage(bytes);
  if (!img) return null;
  const r = region ?? { x: 0, y: 0, w: img.w, h: img.h };
  const { img: out, scale } = cropScale(img, r, maxPx);
  return { jpeg: encodeJpeg(out, 85), width: img.w, height: img.h, outW: out.w, outH: out.h, scale };
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
