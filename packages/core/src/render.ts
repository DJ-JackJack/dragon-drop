/**
 * CPU relief renderer shared by the editor (browser) and the server (previews / exports).
 * M0 look: hypsometric land palette + multi-directional hillshade + depth-tinted sea with a
 * pale shelf and a dark coast edge. The full "Painted Relief" pipeline arrives in M1.
 */
import type { MapDoc } from "./doc.ts";
import type { Rect } from "./geom.ts";
import { clipRect } from "./geom.ts";
import { drawText, textWidth } from "./font.ts";

export interface RenderOptions {
  hillshade?: boolean;
  /** Vertical exaggeration for shading; default scales with map resolution. */
  exaggeration?: number;
}

// Land palette: elevation above sea level (m) -> RGB
const LAND: [number, number, number, number][] = [
  [0, 112, 146, 70],
  [150, 96, 132, 56],
  [500, 128, 146, 72],
  [900, 176, 164, 110],
  [1500, 168, 136, 100],
  [2300, 150, 136, 124],
  [2900, 196, 194, 194],
  [3300, 244, 244, 246],
];
// Sea palette: depth below sea level (m) -> RGB
const SEA: [number, number, number, number][] = [
  [0, 156, 186, 204],
  [60, 120, 156, 190],
  [300, 92, 120, 166],
  [1500, 70, 86, 136],
  [5000, 56, 66, 112],
];

function ramp(stops: [number, number, number, number][], v: number, out: number[]) {
  if (v <= stops[0][0]) {
    out[0] = stops[0][1]; out[1] = stops[0][2]; out[2] = stops[0][3];
    return;
  }
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * t;
      out[1] = a[2] + (b[2] - a[2]) * t;
      out[2] = a[3] + (b[3] - a[3]) * t;
      return;
    }
  }
  const l = stops[stops.length - 1];
  out[0] = l[1]; out[1] = l[2]; out[2] = l[3];
}

function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function defaultExaggeration(kmPerPx: number): number {
  // Shade as if a pixel were ~40 m wide horizontally: readable relief at any map scale.
  return Math.max(1, (kmPerPx * 1000) / 40);
}

/**
 * Render `rect` of the map into `out` (RGBA, row stride = outW*4) at the same pixel positions,
 * i.e. `out` is a full-map-sized buffer. Use this for incremental redraws.
 */
export function renderInto(doc: MapDoc, rect: Rect | null, out: Uint8ClampedArray, opts: RenderOptions = {}): void {
  const { w: W, h: H, data } = doc.height;
  const r = clipRect(rect ?? { x: 0, y: 0, w: W, h: H }, W, H);
  if (!r) return;
  const sea = doc.meta.seaLevel;
  const cell = doc.meta.kmPerPx * 1000;
  const ex = opts.exaggeration ?? defaultExaggeration(doc.meta.kmPerPx);
  const shadeOn = opts.hillshade !== false;
  const c = [0, 0, 0];
  // light directions (unit vectors): NW main + two fills; z up
  const L = [
    [-0.5, -0.5, 0.7071, 0.65],
    [-0.62, 0.2, 0.76, 0.2],
    [0.15, -0.66, 0.74, 0.15],
  ];
  let flat = 0;
  for (const l of L) flat += l[2] * l[3];

  for (let y = r.y; y < r.y + r.h; y++) {
    const ym = y > 0 ? y - 1 : y, yp = y < H - 1 ? y + 1 : y;
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      const e = data[i] - sea;
      const xm = x > 0 ? x - 1 : x, xp = x < W - 1 ? x + 1 : x;
      let shade = 1;
      if (shadeOn) {
        const dzdx = ((data[y * W + xp] - data[y * W + xm]) / ((xp - xm) * cell)) * ex;
        const dzdy = ((data[yp * W + x] - data[ym * W + x]) / ((yp - ym) * cell)) * ex;
        const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        const nx = -dzdx * inv, ny = -dzdy * inv, nz = inv;
        let s = 0;
        for (const l of L) s += Math.max(0, nx * l[0] + ny * l[1] + nz * l[2]) * l[3];
        shade = 1 + 1.15 * (s - flat);
        shade = shade < 0.45 ? 0.45 : shade > 1.35 ? 1.35 : shade;
      }
      let R: number, G: number, B: number;
      if (e > 0) {
        ramp(LAND, e, c);
        const grain = 0.97 + 0.06 * hash(x, y);
        R = c[0] * shade * grain; G = c[1] * shade * grain; B = c[2] * shade * grain;
        // dark coast edge
        if (data[ym * W + x] - sea <= 0 || data[yp * W + x] - sea <= 0 || data[y * W + xm] - sea <= 0 || data[y * W + xp] - sea <= 0) {
          R *= 0.72; G *= 0.72; B *= 0.72;
        }
      } else {
        ramp(SEA, -e, c);
        const s2 = 1 + (shade - 1) * 0.08; // only a hint of seabed relief
        R = c[0] * s2; G = c[1] * s2; B = c[2] * s2;
      }
      const o = i * 4;
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = 255;
    }
  }
}

export interface RGBAImage {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** Lakes on a plain relief picture of a whole map (one pixel a map px, as `renderFull` makes it): `lakes` is the worked-out lake mask (`Derived.lakes`). Keeps a little of the shading under the water. */
export function paintLakes(img: RGBAImage, lakes: Uint8Array | undefined): RGBAImage {
  if (!lakes || lakes.length !== img.w * img.h) return img;
  const d = img.data;
  for (let i = 0; i < lakes.length; i++) {
    if (!lakes[i]) continue;
    const o = i * 4, lum = (d[o] + d[o + 1] + d[o + 2]) / 3, k = 0.85 + 0.15 * Math.min(1.3, lum / 150);
    d[o] = Math.min(255, 96 * k); d[o + 1] = Math.min(255, 140 * k); d[o + 2] = Math.min(255, 186 * k);
  }
  return img;
}

/** A whole world map in plain relief whatever its style, with its lakes (`Derived.lakes`): the picture for judging the shape of the land and its water. */
export function reliefPicture(doc: MapDoc, lakes?: Uint8Array): RGBAImage {
  return paintLakes(renderFull({ ...doc, meta: { ...doc.meta, style: "relief" } }), lakes);
}

export function renderFull(doc: MapDoc, opts: RenderOptions = {}): RGBAImage {
  const { w, h } = doc.height;
  const data = new Uint8ClampedArray(w * h * 4);
  renderInto(doc, null, data, opts);
  return { w, h, data };
}

/** Crop + area-average downscale so the longest side is at most maxPx. */
export function cropScale(img: RGBAImage, region: Rect, maxPx: number): { img: RGBAImage; scale: number } {
  const r = clipRect(region, img.w, img.h) ?? { x: 0, y: 0, w: img.w, h: img.h };
  const longest = Math.max(r.w, r.h);
  // Downscale big areas to fit; upscale small ones by a whole factor (max 4x) so crops stay legible.
  const s = longest > maxPx ? maxPx / longest : Math.min(4, Math.max(1, Math.floor(maxPx / longest)));
  const ow = Math.max(1, Math.round(r.w * s));
  const oh = Math.max(1, Math.round(r.h * s));
  const out = new Uint8ClampedArray(ow * oh * 4);
  const inv = 1 / s;
  for (let oy = 0; oy < oh; oy++) {
    const sy0 = r.y + oy * inv, sy1 = r.y + (oy + 1) * inv;
    for (let ox = 0; ox < ow; ox++) {
      const sx0 = r.x + ox * inv, sx1 = r.x + (ox + 1) * inv;
      let R = 0, G = 0, B = 0, n = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          const o = (Math.min(y, img.h - 1) * img.w + Math.min(x, img.w - 1)) * 4;
          R += img.data[o]; G += img.data[o + 1]; B += img.data[o + 2]; n++;
        }
      }
      const o = (oy * ow + ox) * 4;
      out[o] = R / n; out[o + 1] = G / n; out[o + 2] = B / n; out[o + 3] = 255;
    }
  }
  return { img: { w: ow, h: oh, data: out }, scale: s };
}

function niceStep(span: number, targetLines: number): number {
  const raw = span / targetLines;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/**
 * Draw a coordinate grid in MAP pixel units onto a (possibly cropped/scaled) preview image,
 * so positions Claude reads off the image match the coordinates the tools expect.
 */
export function drawGrid(img: RGBAImage, region: Rect, scale: number, step?: number): number {
  const st = step ?? niceStep(Math.max(region.w, region.h), 8);
  const put = (x: number, y: number, a: number, rgb = [255, 255, 255]) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const o = (y * img.w + x) * 4;
    img.data[o] = img.data[o] * (1 - a) + rgb[0] * a;
    img.data[o + 1] = img.data[o + 1] * (1 - a) + rgb[1] * a;
    img.data[o + 2] = img.data[o + 2] * (1 - a) + rgb[2] * a;
  };
  const x0 = Math.ceil(region.x / st) * st;
  for (let gx = x0; gx < region.x + region.w; gx += st) {
    const px = Math.round((gx - region.x) * scale);
    for (let y = 0; y < img.h; y++) put(px, y, 0.35);
    const label = String(gx);
    drawLabel(img, label, Math.min(Math.max(px + 3, 1), img.w - textWidth(label) - 2), 3);
  }
  const y0 = Math.ceil(region.y / st) * st;
  for (let gy = y0; gy < region.y + region.h; gy += st) {
    const py = Math.round((gy - region.y) * scale);
    for (let x = 0; x < img.w; x++) put(x, py, 0.35);
    if (gy !== y0 || py > 12) drawLabel(img, String(gy), 3, Math.min(Math.max(py + 3, 12), img.h - 9));
  }
  return st;
}

export function drawLabel(img: RGBAImage, text: string, x: number, y: number, scale = 1, dark = false) {
  // halo then text, for legibility on any background
  const halo = dark ? [250, 250, 250] : [20, 20, 24];
  const ink = dark ? [20, 20, 24] : [255, 255, 255];
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) {
    drawText(img, text, x + dx, y + dy, halo, scale);
  }
  drawText(img, text, x, y, ink, scale);
}

/** Draw a small labelled marker (e.g. a city) at map coordinates. */
export function drawMarker(img: RGBAImage, region: Rect, scale: number, mx: number, my: number, label?: string) {
  const cx = Math.round((mx - region.x) * scale), cy = Math.round((my - region.y) * scale);
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy);
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= img.w || y >= img.h || d > 4.2) continue;
      const o = (y * img.w + x) * 4;
      const col = d > 2.6 ? 255 : 25;
      img.data[o] = col; img.data[o + 1] = col; img.data[o + 2] = col;
    }
  }
  if (label) drawLabel(img, label, cx + 7, cy - 3);
}
