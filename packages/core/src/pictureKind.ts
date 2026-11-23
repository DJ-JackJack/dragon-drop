/**
 * What an asset picture is, from its pixels, for the pictures whose names say nothing (assetKinds.ts reads the names first): an empty border makes an
 * object (a barrel, a tree: drawn on nothing), and a picture whose left edge runs on into its right and its top into its bottom is a floor texture (made
 * to repeat). Anything else (a whole map, a painting) is left as it is. Worked out on a small copy, so it costs the same for any size.
 */
import { boxResize } from "./image.ts";
import type { RGBAImage } from "./render.ts";

/** The side the picture is shrunk to before it is measured. */
const LOOK_SIZE = 64;

export interface PictureLook {
  /** The share of the border's pixels that are mostly see-through (alpha under 128). */
  edgeClear: number;
  /** The share of all pixels that are at all see-through (alpha under 250). */
  clear: number;
  /** The share of the border's pixels that are empty (alpha under 16): nothing at all is drawn there. */
  edgeEmpty: number;
  /** The share of all pixels that are empty (alpha under 16). */
  empty: number;
  /** The share of all pixels that are solid (alpha 240 or more). */
  solid: number;
  /** How much the picture jumps where it would wrap round (right edge to left, bottom to top), against how much it changes from one pixel to the next inside: about 1 for a picture made to repeat. */
  seam: number;
  /** Width over height of the picture itself. */
  aspect: number;
}

/** Measures a picture (see PictureLook). */
export function lookAtPicture(img: RGBAImage): PictureLook {
  const k = Math.min(1, LOOK_SIZE / Math.max(img.w, img.h));
  const w = Math.max(2, Math.round(img.w * k)), h = Math.max(2, Math.round(img.h * k));
  const d = k < 1 || w !== img.w || h !== img.h ? boxResize(img.data, img.w, img.h, w, h) : img.data;
  const a = (x: number, y: number) => d[(y * w + x) * 4 + 3];
  // (brightness times how solid the pixel is: a see-through texture repeats in its see-through parts too)
  const lum = (x: number, y: number) => { const o = (y * w + x) * 4; return ((0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) * d[o + 3]) / 255; };
  let border = 0, borderClear = 0, borderEmpty = 0, clear = 0, empty = 0, solid = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const al = a(x, y);
    if (al < 250) clear++;
    if (al < 16) empty++;
    if (al >= 240) solid++;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { border++; if (al < 128) borderClear++; if (al < 16) borderEmpty++; }
  }
  // the jump across the wrap, against the ordinary step between neighbours (both directions; a small floor keeps a flat picture from dividing by nothing)
  let inside = 0, nIn = 0, wrap = 0, nWrap = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) { inside += Math.abs(lum(x + 1, y) - lum(x, y)); nIn++; }
    wrap += Math.abs(lum(0, y) - lum(w - 1, y)); nWrap++;
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h - 1; y++) { inside += Math.abs(lum(x, y + 1) - lum(x, y)); nIn++; }
    wrap += Math.abs(lum(x, 0) - lum(x, h - 1)); nWrap++;
  }
  const seam = (wrap / nWrap + 2) / (inside / nIn + 2);
  const n = w * h;
  return { edgeClear: borderClear / border, clear: clear / n, edgeEmpty: borderEmpty / border, empty: empty / n, solid: solid / n, seam, aspect: img.w / img.h };
}

/**
 * "objects" for a picture drawn on nothing (its border mostly empty), "terrain" for one made to repeat (it runs on round its edges, nothing in it is
 * empty, and it is about square), null when the pixels don't say. Floor textures in pack files are often see-through all over (they are painted in
 * layers that blend), so being see-through says nothing by itself: an empty border does. (Measured 2026-11-23 on a real library of 400,000 pictures:
 * the border of a floor texture is never empty, an object's is 64 to 100% empty, and a floor's wrap-round jump is 0.74 to 1.23 times its ordinary step.)
 */
export function pictureKindHint(img: RGBAImage): "terrain" | "objects" | null {
  if (img.w < 16 || img.h < 16) return null; // (an icon or a speck: nothing to go on)
  const l = lookAtPicture(img);
  if (l.edgeEmpty >= 0.5) return "objects";
  const squareish = l.aspect >= 0.5 && l.aspect <= 2;
  return squareish && Math.min(img.w, img.h) >= 128 && l.empty <= 0.05 && l.seam <= 1.6 ? "terrain" : null;
}
