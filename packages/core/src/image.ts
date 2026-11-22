/** Small pixel helpers shared by the server (textures and sprites) and tests. */
import { opaqueRowCount } from "./roofAssets.ts";

/** Area-average resize of straight-alpha RGBA (alpha-weighted so transparent pixels don't tint edges). */
export function boxResize(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy0 = y * yr, sy1 = Math.min(sh, (y + 1) * yr);
    for (let x = 0; x < dw; x++) {
      const sx0 = x * xr, sx1 = Math.min(sw, (x + 1) * xr);
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++) {
        const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0);
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
          const w = wy * (Math.min(xx + 1, sx1) - Math.max(xx, sx0));
          const i = (yy * sw + xx) * 4, al = src[i + 3] * w;
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; wsum += w;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = wsum > 0 ? a / wsum : 0;
    }
  }
  return out;
}

/** How a picture from an asset pack is made ready to draw: a square tile for a floor or roof texture, or an object's picture at a scale. */
export type ShrinkJob = { kind: "tile"; size: number; roof?: boolean } | { kind: "sprite"; ratio: number };
/** A picture made ready: its pixels (straight RGBA), their size, and the size of the picture it was made from. */
export interface ShrunkPicture { data: Uint8ClampedArray; w: number; h: number; origW: number; origH: number }

/**
 * A decoded picture made ready to draw (the asset library's tiles and objects; the server does this on its worker thread, as a big picture takes a while).
 * A tile is resized to `size` square, a roof's see-through strip at the bottom cut off first (`opaqueRowCount`, or every repeat shows a seam); an object is
 * shrunk by `ratio` (never enlarged).
 */
export function shrinkPicture(img: { w: number; h: number; data: Uint8ClampedArray }, job: ShrinkJob): ShrunkPicture {
  if (job.kind === "tile") {
    const rows = job.roof ? opaqueRowCount(img.data, img.w, img.h) : img.h;
    const data = img.w === job.size && rows === job.size ? img.data : boxResize(rows === img.h ? img.data : img.data.subarray(0, img.w * rows * 4), img.w, rows, job.size, job.size);
    return { data, w: job.size, h: job.size, origW: img.w, origH: img.h };
  }
  const r = Math.min(1, job.ratio);
  const w = Math.max(1, Math.round(img.w * r)), h = Math.max(1, Math.round(img.h * r));
  return { data: r < 1 ? boxResize(img.data, img.w, img.h, w, h) : img.data, w, h, origW: img.w, origH: img.h };
}
