/** Small pixel helpers shared by the server (textures and sprites) and tests. */

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
