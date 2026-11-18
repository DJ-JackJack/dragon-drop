/**
 * A quick preview for while the painted style is still preparing (its texture noise and climate take a few seconds):
 * the plain relief of a copy shrunk by 2 or 4, blown up blocky into the full-size image. About 16x cheaper than rendering
 * the whole map at full size, which used to freeze the editor for about a second at start-up, only to be painted over.
 */
import { HeightField, type MapDoc } from "./doc.ts";
import { renderInto } from "./render.ts";

/** Shrink factor for a map this wide. */
export function placeholderFactor(width: number): number {
  return width >= 1024 ? 4 : width >= 512 ? 2 : 1;
}

/** Fill `out` (RGBA, full size) with the preview. */
export function renderPlaceholder(doc: MapDoc, out: Uint8ClampedArray): void {
  const { w: W, h: H, data } = doc.height;
  const f = placeholderFactor(W);
  if (f === 1) {
    renderInto(doc, null, out, { hillshade: true });
    return;
  }
  const w = Math.ceil(W / f), h = Math.ceil(H / f);
  const small = new HeightField(w, h);
  for (let y = 0; y < h; y++) {
    const row = Math.min(H - 1, y * f) * W;
    for (let x = 0; x < w; x++) small.data[y * w + x] = data[row + Math.min(W - 1, x * f)];
  }
  const tiny = new Uint8ClampedArray(w * h * 4);
  // one small cell covers f x f of the real ones: keep the shading in proportion
  renderInto({ meta: { ...doc.meta, width: w, height: h, kmPerPx: doc.meta.kmPerPx * f }, height: small }, null, tiny, { hillshade: true });
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / f) | 0) * w;
    for (let x = 0; x < W; x++) {
      const si = (sy + Math.min(w - 1, (x / f) | 0)) * 4, di = (y * W + x) * 4;
      out[di] = tiny[si]; out[di + 1] = tiny[si + 1]; out[di + 2] = tiny[si + 2]; out[di + 3] = 255;
    }
  }
}
