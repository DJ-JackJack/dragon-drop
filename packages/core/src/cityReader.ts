/**
 * The city picture reader (city stage 2): buildings read out of a picture of a city, by roof colour. The DM (or Claude) gives an area of the picture to read, one sample of
 * each kind of roof and, ideally, one of the ground between them; every patch of picture the colour of a roof sample (and not nearer the ground's colour) becomes a building:
 * a rotated rectangle when it is one, else its outline. Learned from `spikes/city-reader/`: red and grey roofs read well from colour; roofs nearly the colour of the ground
 * need the ground sample; frames, lettering and the sea are kept out by the area and by sizes worked out from the picture's scale. The colours always come from the samples.
 *
 * The same colour matching reads STREETS (`readStreets`: the street-coloured patches thinned down to their middle lines, each a line with the width the patch has round it)
 * and WATER (`readWater`: which of the city's ground cells the picture shows as water, and how deep by which sample matched).
 *
 * Works in the picture's own pixels; the caller turns the outlines into map units (trace.ts `tracePoint`). Pure, so it runs on the server's compute thread.
 */
import type { RoofStyle } from "./features.ts";
import { pointInPolygon } from "./geom.ts";
import { type TracePicture, tracePoint, traceToPicture } from "./trace.ts";

type Pt = [number, number];
type RGB = [number, number, number];
export interface ReaderPicture { w: number; h: number; data: ArrayLike<number> }

export interface ReaderOptions {
  /** The part of the picture to read: a polygon in picture pixels. */
  area: Pt[];
  /** Where a roof of each kind is (picture pixels), and the roof look its buildings get. */
  roofs: { x: number; y: number; look: RoofStyle }[];
  /** Where the ground between the roofs is (optional, but it tells roofs from ground of a similar colour). */
  ground?: { x: number; y: number }[];
  /** 0 strict .. 1 loose (default 0.5). */
  tolerance?: number;
  /** Smallest and largest building, in square picture pixels. */
  minArea: number;
  maxArea: number;
}

export interface ReadBuilding {
  /** Corners in picture pixels. */
  points: Pt[];
  look: RoofStyle;
  /** Which roof sample found it. */
  sample: number;
  /** How well a rectangle fits it (1: exactly); outlines are used below 0.72. */
  fit: number;
}

export interface ReadResult {
  buildings: ReadBuilding[];
  /** What was found but left out, and why. */
  skipped: { small: number; large: number };
  /** The colours the samples gave (for the editor's swatches). */
  colours: { roofs: RGB[]; ground: RGB[] };
}

// ---------------------------------------------------------------- colour

function srgbToLinear(c: number) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
/** CIE Lab of an sRGB colour (distances in it roughly match how different colours look). */
export function rgbToLab([r, g, b]: RGB): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The colour around a point: the median of a small square (so a tile's stripe or a ridge line doesn't decide it), and how much it varies there (mean Lab distance). */
export function sampleColour(img: ReaderPicture, x: number, y: number, r = 3): { rgb: RGB; spread: number } {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const px = Math.round(x) + dx, py = Math.round(y) + dy;
    if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
    const o = (py * img.w + px) * 4;
    rs.push(img.data[o]); gs.push(img.data[o + 1]); bs.push(img.data[o + 2]);
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] ?? 0;
  const rgb: RGB = [med(rs), med(gs), med(bs)], lab = rgbToLab(rgb);
  let spread = 0;
  for (let i = 0; i < rs.length; i++) spread += dist(rgbToLab([rs[i], gs[i], bs[i]]), lab);
  return { rgb, spread: rs.length ? spread / rs.length : 0 };
}

/** The roof look a colour most likely is (a starting guess the DM can change): red and orange clay tile, golden straw thatch, brown wooden shingle, grey or blue slate. */
export function guessRoofLook([r, g, b]: RGB): RoofStyle {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
  if (s < 0.18) return "slate";
  if (b > r && b > g * 0.9) return "slate";
  if (r > g * 1.55 && r > b * 1.5) return "tile";
  if (r > b * 1.6 && g > b * 1.3 && mx > 135) return "thatch";
  return "shingle";
}

// ---------------------------------------------------------------- shapes

/** A blob's outline (its outer boundary, traced round the pixel edges), as corners. */
function traceOutline(mask: Uint8Array, bw: number, bh: number): Pt[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < bw && y < bh && mask[y * bw + x] === 1;
  // start at the top-left pixel's top-left corner, walking the boundary with the inside on the right
  let sx = -1, sy = -1;
  for (let i = 0; i < bw * bh && sx < 0; i++) if (mask[i] === 1) { sx = i % bw; sy = (i / bw) | 0; }
  if (sx < 0) return [];
  const pts: Pt[] = [];
  let x = sx, y = sy, dir = 0; // 0 east, 1 south, 2 west, 3 north (moving along the corners' grid)
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  for (let steps = 0; steps < 4 * bw * bh + 8; steps++) {
    pts.push([x, y]);
    // (walking the corners between pixels with the inside on the right: the cell right of the edge is set, the cell left of it isn't; left turns first, so it hugs the shape)
    const cellRight = (d: number) => at(x + (d === 0 ? 0 : d === 1 ? -1 : d === 2 ? -1 : 0), y + (d === 0 ? 0 : d === 1 ? 0 : d === 2 ? -1 : -1));
    const cellLeft = (d: number) => at(x + (d === 0 ? 0 : d === 1 ? 0 : d === 2 ? -1 : -1), y + (d === 0 ? -1 : d === 1 ? 0 : d === 2 ? 0 : -1));
    // turn so that the inside stays on the right
    for (let k = 0; k < 4; k++) {
      const d = (dir + 3 + k) % 4; // left first, then straight, right, back
      if (cellRight(d) && !cellLeft(d)) { dir = d; break; }
    }
    x += DX[dir]; y += DY[dir];
    if (x === sx && y === sy) break;
  }
  return pts;
}

/** Fewer corners, none further than `tol` from the line (Douglas-Peucker on a closed outline). */
function simplifyClosed(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 4) return pts;
  // split at the point furthest from the first, simplify both halves
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const dp = (a: Pt[]): Pt[] => {
    if (a.length <= 2) return a;
    const [ax, ay] = a[0], [bx, by] = a[a.length - 1], L = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, bi = 0;
    for (let i = 1; i < a.length - 1; i++) { const d = Math.abs((by - ay) * a[i][0] - (bx - ax) * a[i][1] + bx * ay - by * ax) / L; if (d > best) { best = d; bi = i; } }
    if (best <= tol) return [a[0], a[a.length - 1]];
    return [...dp(a.slice(0, bi + 1)).slice(0, -1), ...dp(a.slice(bi))];
  };
  const one = dp(pts.slice(0, far + 1)), two = dp([...pts.slice(far), pts[0]]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

// ---------------------------------------------------------------- reading

/** Every pixel of the area matched to the samples: `cls` (over the area's bounding box) is the 1-based sample whose colour it is, 0 for none (or nearer a sample of what it isn't). */
interface Classified { cls: Uint8Array; ax0: number; ay0: number; bw: number; bh: number; pos: { rgb: RGB; spread: number }[]; neg: { rgb: RGB; spread: number }[] }

function classify(img: ReaderPicture, area: Pt[], positives: { x: number; y: number }[], negatives: { x: number; y: number }[], tolerance: number | undefined): Classified {
  const W = img.w, H = img.h;
  const pos = positives.map((s) => sampleColour(img, s.x, s.y)), neg = negatives.map((g) => sampleColour(img, g.x, g.y));
  const posLab = pos.map((s) => rgbToLab(s.rgb)), negLab = neg.map((g) => rgbToLab(g.rgb));
  const tol = Math.max(0, Math.min(1, tolerance ?? 0.5));
  const limit = pos.map((s) => 8 + tol * 26 + Math.min(14, s.spread * 1.4));
  // which sample (1-based) every colour belongs to, worked out once for each of 32 x 32 x 32 colours
  const lut = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const lab = rgbToLab([r * 8 + 4, g * 8 + 4, b * 8 + 4]);
    let best = -1, bd = Infinity;
    posLab.forEach((s, i) => { const d = dist(lab, s); if (d < limit[i] && d < bd) { bd = d; best = i; } });
    if (best < 0) continue;
    // (nearer a sample of what it isn't: not it)
    if (negLab.some((gl) => dist(lab, gl) < bd * 0.92)) continue;
    lut[(r << 10) | (g << 5) | b] = best + 1;
  }
  // the area, as a mask over its bounding box
  let ax0 = W, ay0 = H, ax1 = 0, ay1 = 0;
  for (const [x, y] of area) { ax0 = Math.min(ax0, Math.floor(x)); ay0 = Math.min(ay0, Math.floor(y)); ax1 = Math.max(ax1, Math.ceil(x)); ay1 = Math.max(ay1, Math.ceil(y)); }
  ax0 = Math.max(0, ax0); ay0 = Math.max(0, ay0); ax1 = Math.min(W - 1, ax1); ay1 = Math.min(H - 1, ay1);
  const bw = Math.max(0, ax1 - ax0 + 1), bh = Math.max(0, ay1 - ay0 + 1);
  const cls = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    // (the area's crossings on this row, so each pixel isn't tested against the polygon)
    const py = ay0 + y + 0.5, xs: number[] = [];
    for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
      const [xi, yi] = area[i], [xj, yj] = area[j];
      if ((yi > py) !== (yj > py)) xs.push(xi + ((py - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(ax0, Math.ceil(xs[k] - 0.5)); x <= Math.min(ax1, Math.floor(xs[k + 1] - 0.5)); x++) {
        const p = ((ay0 + y) * W + x) * 4;
        cls[y * bw + (x - ax0)] = lut[((img.data[p] >> 3) << 10) | ((img.data[p + 1] >> 3) << 5) | (img.data[p + 2] >> 3)];
      }
    }
  }
  return { cls, ax0, ay0, bw, bh, pos, neg };
}

/** Read the buildings out of a picture (see the top of this file). */
export function readBuildings(img: ReaderPicture, o: ReaderOptions): ReadResult {
  const { cls, ax0, ay0, bw, bh, pos: roofs, neg: ground } = classify(img, o.area, o.roofs, o.ground ?? [], o.tolerance);
  if (bw <= 0 || bh <= 0) return { buildings: [], skipped: { small: 0, large: 0 }, colours: { roofs: roofs.map((s) => s.rgb), ground: ground.map((g) => g.rgb) } };
  // patches of one class (4-connected), holes filled, a rotated rectangle by their principal axes, or their outline
  const seen = new Uint8Array(bw * bh), out: ReadBuilding[] = [], skipped = { small: 0, large: 0 };
  const stack: number[] = [];
  for (let s = 0; s < bw * bh; s++) {
    if (!cls[s] || seen[s]) continue;
    const k = cls[s], px: number[] = [];
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      px.push(p);
      const x = p % bw, y = (p / bw) | 0;
      if (x > 0 && !seen[p - 1] && cls[p - 1] === k) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < bw - 1 && !seen[p + 1] && cls[p + 1] === k) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - bw] && cls[p - bw] === k) { seen[p - bw] = 1; stack.push(p - bw); }
      if (y < bh - 1 && !seen[p + bw] && cls[p + bw] === k) { seen[p + bw] = 1; stack.push(p + bw); }
    }
    if (px.length < o.minArea * 0.6) { skipped.small++; continue; }
    if (px.length > o.maxArea) { skipped.large++; continue; }
    let x0 = bw, y0 = bh, x1 = 0, y1 = 0;
    for (const p of px) { const x = p % bw, y = (p / bw) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    // holes filled (a ridge line, a chimney): flood the outside of the patch's box; whatever isn't outside is inside
    const mw = x1 - x0 + 3, mh = y1 - y0 + 3, mask = new Uint8Array(mw * mh);
    for (const p of px) mask[(((p / bw) | 0) - y0 + 1) * mw + (p % bw) - x0 + 1] = 2;
    const outside = [0];
    mask[0] = 3;
    while (outside.length) {
      const p = outside.pop()!, x = p % mw, y = (p / mw) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < mw - 1 ? p + 1 : -1, y > 0 ? p - mw : -1, y < mh - 1 ? p + mw : -1]) if (q >= 0 && mask[q] === 0) { mask[q] = 3; outside.push(q); }
    }
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < mw * mh; i++) { if (mask[i] === 3) { mask[i] = 0; continue; } mask[i] = 1; n++; sx += i % mw; sy += (i / mw) | 0; }
    if (n < o.minArea) { skipped.small++; continue; }
    const cx = sx / n, cy = sy / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < mw * mh; i++) if (mask[i]) { const dx = (i % mw) - cx, dy = ((i / mw) | 0) - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ca = Math.cos(ang), sa = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let i = 0; i < mw * mh; i++) if (mask[i]) {
      const dx = (i % mw) - cx, dy = ((i / mw) | 0) - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    // (the box is round pixel centres: half a pixel more each way covers the pixels themselves)
    u0 -= 0.5; u1 += 0.5; v0 -= 0.5; v1 += 0.5;
    const fit = n / ((u1 - u0) * (v1 - v0));
    const ox = ax0 + x0 - 1, oy = ay0 + y0 - 1; // (mask cell (0, 0) is picture pixel (ox, oy))
    let points: Pt[];
    if (fit >= 0.72) {
      points = ([[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as Pt[]).map(([u, v]) => [ox + cx + 0.5 + u * ca - v * sa, oy + cy + 0.5 + u * sa + v * ca] as Pt);
    } else {
      const outline = simplifyClosed(traceOutline(mask, mw, mh), 1.2);
      if (outline.length < 3 || outline.length > 40) continue;
      points = outline.map(([x, y]) => [ox + x, oy + y] as Pt);
    }
    out.push({ points: points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt), look: o.roofs[k - 1].look, sample: k - 1, fit: Math.round(fit * 100) / 100 });
  }
  return { buildings: out, skipped, colours: { roofs: roofs.map((s) => s.rgb), ground: ground.map((g) => g.rgb) } };
}

// ---------------------------------------------------------------- streets

export interface StreetReadOptions {
  area: Pt[];
  /** Where a street is (one or more: a paved street, a dirt lane), picture pixels. */
  streets: { x: number; y: number }[];
  /** Where things that are not streets are (roofs, gardens, squares, water), picture pixels. */
  others?: { x: number; y: number }[];
  tolerance?: number;
  /** The narrowest and widest street, picture pixels across. */
  minWidth: number;
  maxWidth: number;
  /** The shortest street to keep, picture pixels. */
  minLength: number;
}

export interface ReadStreet {
  /** Its middle line, picture pixels. */
  points: Pt[];
  /** How wide it is, picture pixels. */
  width: number;
}

const N8X = [1, 1, 0, -1, -1, -1, 0, 1], N8Y = [0, 1, 1, 1, 0, -1, -1, -1];

/** A mask grown (or shrunk) by one pixel all round (3 x 3). */
function grow(m: Uint8Array, w: number, h: number, shrink: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let any = false, all = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy, v = X < 0 || Y < 0 || X >= w || Y >= h ? m[y * w + x] : m[Y * w + X];
      if (v) any = true; else all = false;
    }
    out[y * w + x] = (shrink ? all : any) ? 1 : 0;
  }
  return out;
}

/** How far every set pixel is from the nearest unset one (pixels; chamfer 3-4, close to straight-line distance). */
function distanceInside(m: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? 1e9 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4); }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4); }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

/** Thin a mask to lines one pixel wide that keep its shape (Zhang and Suen). */
function thin(src: Uint8Array, w: number, h: number): Uint8Array {
  const m = src.slice(), at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  let live: number[] = [];
  for (let i = 0; i < w * h; i++) if (m[i]) live.push(i);
  for (let changed = true; changed;) {
    changed = false;
    for (const step of [0, 1]) {
      const gone: number[] = [];
      for (const i of live) {
        if (!m[i]) continue;
        const x = i % w, y = (i / w) | 0;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let a = 0;
        for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        gone.push(i);
      }
      for (const i of gone) m[i] = 0;
      if (gone.length) changed = true;
    }
    live = live.filter((i) => m[i]);
  }
  return m;
}

/** Fewer points on an open line, none further than `tol` from it (Douglas-Peucker). */
function simplifyOpen(a: Pt[], tol: number): Pt[] {
  if (a.length <= 2) return a;
  const [ax, ay] = a[0], [bx, by] = a[a.length - 1], L = Math.hypot(bx - ax, by - ay) || 1;
  let best = -1, bi = 0;
  for (let i = 1; i < a.length - 1; i++) { const d = Math.abs((by - ay) * a[i][0] - (bx - ax) * a[i][1] + bx * ay - by * ax) / L; if (d > best) { best = d; bi = i; } }
  if (best <= tol) return [a[0], a[a.length - 1]];
  return [...simplifyOpen(a.slice(0, bi + 1), tol).slice(0, -1), ...simplifyOpen(a.slice(bi), tol)];
}

const lineLength = (p: Pt[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/**
 * Read the streets out of a picture: the street-coloured patches (small gaps closed, specks dropped), thinned to their middle lines, traced into lines between the places
 * where streets meet or end, short spurs (the thinning's whiskers) pruned, lines through a mere bend joined, and each line's width taken from the patch round it.
 */
export function readStreets(img: ReaderPicture, o: StreetReadOptions): { streets: ReadStreet[]; colours: { streets: RGB[]; others: RGB[] } } {
  const { cls, ax0, ay0, bw, bh, pos, neg } = classify(img, o.area, o.streets, o.others ?? [], o.tolerance);
  const colours = { streets: pos.map((s) => s.rgb), others: neg.map((s) => s.rgb) };
  if (bw < 3 || bh < 3) return { streets: [], colours };
  let m: Uint8Array = new Uint8Array(bw * bh);
  for (let i = 0; i < m.length; i++) m[i] = cls[i] ? 1 : 0;
  // close gaps of a pixel (a cart, a lamp post, a line of the drawing), then drop specks
  m = grow(grow(m, bw, bh, false), bw, bh, true);
  m = grow(grow(m, bw, bh, true), bw, bh, false);
  const dt = distanceInside(m, bw, bh), sk = thin(m, bw, bh);
  // the skeleton as a graph: pixels with other than two neighbours are nodes (touching node pixels are one node), the rest lie on the lines between them
  const nb = (i: number) => { const x = i % bw, y = (i / bw) | 0, out: number[] = []; for (let k = 0; k < 8; k++) { const X = x + N8X[k], Y = y + N8Y[k]; if (X >= 0 && Y >= 0 && X < bw && Y < bh && sk[Y * bw + X]) out.push(Y * bw + X); } return out; };
  const node = new Int32Array(bw * bh).fill(-1);
  let nodes = 0;
  for (let i = 0; i < bw * bh; i++) {
    if (!sk[i] || node[i] >= 0 || nb(i).length === 2) continue;
    const id = nodes++, st = [i];
    node[i] = id;
    while (st.length) { const p = st.pop()!; for (const q of nb(p)) if (node[q] < 0 && nb(q).length !== 2) { node[q] = id; st.push(q); } }
  }
  type Path = { px: number[]; a: number; b: number };
  const paths: Path[] = [], used = new Uint8Array(bw * bh), pairs = new Set<string>();
  const walk = (start: number, first: number, a: number): Path => {
    const px = [start, first];
    let prev = start, cur = first;
    while (node[cur] < 0) {
      used[cur] = 1;
      const next = nb(cur).find((q) => q !== prev && !(node[q] < 0 && used[q]) && q !== start);
      if (next === undefined) break;
      px.push(next); prev = cur; cur = next;
    }
    return { px, a, b: node[cur] };
  };
  for (let i = 0; i < bw * bh; i++) {
    if (node[i] < 0) continue;
    for (const q of nb(i)) {
      if (node[q] === node[i]) continue;
      if (node[q] >= 0) { const key = `${Math.min(i, q)}-${Math.max(i, q)}`; if (!pairs.has(key)) { pairs.add(key); paths.push({ px: [i, q], a: node[i], b: node[q] }); } continue; }
      if (used[q]) continue;
      paths.push(walk(i, q, node[i]));
    }
  }
  for (let i = 0; i < bw * bh; i++) if (sk[i] && node[i] < 0 && !used[i]) { const n = nb(i); if (n.length) { used[i] = 1; const p = walk(i, n[0], -1); p.px.push(i); paths.push(p); } } // (a loop with no ends)
  const widthOf = (px: number[]) => { const ds = px.map((i) => dt[i]).sort((a, b) => a - b); return Math.max(1, 2 * ds[ds.length >> 1] - 1); };
  // prune the whiskers: a short line from a dead end to a meeting place
  let live = paths.map((p) => ({ ...p, w: widthOf(p.px), len: p.px.length }));
  for (let round = 0; round < 3; round++) {
    const deg = new Map<number, number>();
    for (const p of live) for (const n of [p.a, p.b]) if (n >= 0) deg.set(n, (deg.get(n) ?? 0) + 1);
    const before = live.length;
    live = live.filter((p) => {
      const da = p.a >= 0 ? deg.get(p.a)! : 1, db = p.b >= 0 ? deg.get(p.b)! : 1;
      return !((da === 1 && db >= 3) || (db === 1 && da >= 3)) || p.len > p.w * 1.6;
    });
    if (live.length === before) break;
  }
  // join lines that meet at a mere bend (a node with just two of them)
  for (let joined = true; joined;) {
    joined = false;
    const at = new Map<number, number[]>();
    live.forEach((p, k) => { for (const n of [p.a, p.b]) if (n >= 0) at.set(n, [...(at.get(n) ?? []), k]); });
    for (const [n, ks] of at) {
      if (ks.length !== 2 || ks[0] === ks[1]) continue;
      const [p, q] = [live[ks[0]], live[ks[1]]];
      const pf = p.b === n ? p.px : [...p.px].reverse(), qf = q.a === n ? q.px : [...q.px].reverse();
      const merged = { px: [...pf, ...qf], a: p.b === n ? p.a : p.b, b: q.a === n ? q.b : q.a, w: 0, len: 0 };
      merged.w = widthOf(merged.px); merged.len = merged.px.length;
      live = live.filter((_, k) => k !== ks[0] && k !== ks[1]).concat(merged);
      joined = true;
      break;
    }
  }
  const streets: ReadStreet[] = [];
  for (const p of live) {
    const pts: Pt[] = p.px.map((i) => [ax0 + (i % bw) + 0.5, ay0 + ((i / bw) | 0) + 0.5]);
    const len = lineLength(pts);
    if (p.w < o.minWidth || p.w > o.maxWidth || len < Math.max(o.minLength, p.w * 1.5)) continue;
    streets.push({ points: simplifyOpen(pts, Math.max(0.8, p.w * 0.25)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt), width: Math.round(p.w * 10) / 10 });
  }
  return { streets, colours };
}

// ---------------------------------------------------------------- water

export interface WaterReadOptions {
  area: Pt[];
  /** Where water is (picture pixels) and what it becomes: 7 shallow water, 8 deep water. */
  water: { x: number; y: number; material: number }[];
  /** Where things that are not water are (the shore, roofs, streets), picture pixels. */
  others?: { x: number; y: number }[];
  tolerance?: number;
  /** The city's ground cells and how the picture lies over them. */
  grid: { w: number; h: number; cellM: number; trace: TracePicture };
}

/**
 * Which of the city's ground cells the picture shows as water: each cell looked at in five places (its middle and four round it), water when most of them match a water
 * sample (specks dropped first), and the material of the sample most of them matched. As runs along the rows: [first cell, how many] in turn, by material.
 */
export function readWater(img: ReaderPicture, o: WaterReadOptions): { runs: { material: number; runs: number[] }[]; cells: number; colours: { water: RGB[]; others: RGB[] } } {
  const { cls, ax0, ay0, bw, bh, pos, neg } = classify(img, o.area, o.water, o.others ?? [], o.tolerance);
  const colours = { water: pos.map((s) => s.rgb), others: neg.map((s) => s.rgb) };
  if (bw < 3 || bh < 3) return { runs: [], cells: 0, colours };
  // (specks of water colour in the land, and of land in the water, are dropped)
  let m: Uint8Array = new Uint8Array(bw * bh);
  for (let i = 0; i < m.length; i++) m[i] = cls[i] ? 1 : 0;
  m = grow(grow(m, bw, bh, true), bw, bh, false);
  m = grow(grow(m, bw, bh, false), bw, bh, true);
  const { w: GW, h: GH, cellM, trace } = o.grid, q = cellM / 4;
  const byMat = new Map<number, number[]>();
  let cells = 0;
  // only the cells whose middle falls inside the area's box
  const corners = [[ax0, ay0], [ax0 + bw, ay0], [ax0, ay0 + bh], [ax0 + bw, ay0 + bh]].map(([u, v]) => tracePoint(trace, u, v));
  const gx0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) / cellM) - 1), gx1 = Math.min(GW - 1, Math.ceil(Math.max(...corners.map((c) => c[0])) / cellM) + 1);
  const gy0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) / cellM) - 1), gy1 = Math.min(GH - 1, Math.ceil(Math.max(...corners.map((c) => c[1])) / cellM) + 1);
  for (let gy = gy0; gy <= gy1; gy++) {
    let runStart = -1, runMat = 0;
    const close = (end: number) => { if (runStart >= 0) { const r = byMat.get(runMat) ?? []; r.push(gy * GW + runStart, end - runStart); byMat.set(runMat, r); runStart = -1; } };
    for (let gx = gx0; gx <= gx1; gx++) {
      const cx = (gx + 0.5) * cellM, cy = (gy + 0.5) * cellM;
      let votes = 0;
      const mats: number[] = [];
      for (const [dx, dy] of [[0, 0], [-q, -q], [q, -q], [-q, q], [q, q]]) {
        const [u, v] = traceToPicture(trace, cx + dx, cy + dy), x = Math.floor(u) - ax0, y = Math.floor(v) - ay0;
        if (x < 0 || y < 0 || x >= bw || y >= bh || !m[y * bw + x]) continue;
        votes++;
        // (the sample the pixel or, after the clean-up, a neighbour matched)
        let k = cls[y * bw + x];
        for (let r = 1; !k && r <= 2; r++) for (let j = 0; j < 8 && !k; j++) { const X = x + N8X[j] * r, Y = y + N8Y[j] * r; if (X >= 0 && Y >= 0 && X < bw && Y < bh) k = cls[Y * bw + X]; }
        mats.push(o.water[(k || 1) - 1].material);
      }
      if (votes >= 3) {
        const mat = mats.sort((a, b) => mats.filter((x) => x === b).length - mats.filter((x) => x === a).length)[0];
        if (runStart >= 0 && mat !== runMat) close(gx);
        if (runStart < 0) { runStart = gx; runMat = mat; }
        cells++;
      } else close(gx);
    }
    close(gx1 + 1);
  }
  return { runs: [...byMat].map(([material, runs]) => ({ material, runs })), cells, colours };
}

/** Is a point inside the area (picture pixels)? (for callers checking a sample) */
export function inReaderArea(area: Pt[], x: number, y: number): boolean {
  return pointInPolygon(x, y, area);
}
