/**
 * The city picture reader (city stage 2): buildings read out of a picture of a city, by roof colour. The DM (or Claude) gives an area of the picture to read, one sample of
 * each kind of roof and, ideally, one of the ground between them; every patch of picture the colour of a roof sample (and not nearer the ground's colour) becomes a building:
 * a rotated rectangle when it is one, else its outline. Learned from `spikes/city-reader/`: red and grey roofs read well from colour; roofs nearly the colour of the ground
 * need the ground sample; frames, lettering and the sea are kept out by the area and by sizes worked out from the picture's scale. The colours always come from the samples.
 *
 * Works in the picture's own pixels; the caller turns the outlines into map units (trace.ts `tracePoint`). Pure, so it runs on the server's compute thread.
 */
import type { RoofStyle } from "./features.ts";
import { pointInPolygon } from "./geom.ts";

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

/** Read the buildings out of a picture (see the top of this file). */
export function readBuildings(img: ReaderPicture, o: ReaderOptions): ReadResult {
  const W = img.w, H = img.h;
  const roofs = o.roofs.map((s) => sampleColour(img, s.x, s.y)), ground = (o.ground ?? []).map((g) => sampleColour(img, g.x, g.y));
  const roofLab = roofs.map((s) => rgbToLab(s.rgb)), groundLab = ground.map((g) => rgbToLab(g.rgb));
  const tol = Math.max(0, Math.min(1, o.tolerance ?? 0.5));
  const limit = roofs.map((s) => 8 + tol * 26 + Math.min(14, s.spread * 1.4));
  // which roof sample (1-based) every colour belongs to, worked out once for each of 32 x 32 x 32 colours
  const lut = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const lab = rgbToLab([r * 8 + 4, g * 8 + 4, b * 8 + 4]);
    let best = -1, bd = Infinity;
    roofLab.forEach((s, i) => { const d = dist(lab, s); if (d < limit[i] && d < bd) { bd = d; best = i; } });
    if (best < 0) continue;
    // (nearer a ground sample than to the roof: ground)
    if (groundLab.some((gl) => dist(lab, gl) < bd * 0.92)) continue;
    lut[(r << 10) | (g << 5) | b] = best + 1;
  }
  // the area, as a mask over its bounding box
  let ax0 = W, ay0 = H, ax1 = 0, ay1 = 0;
  for (const [x, y] of o.area) { ax0 = Math.min(ax0, Math.floor(x)); ay0 = Math.min(ay0, Math.floor(y)); ax1 = Math.max(ax1, Math.ceil(x)); ay1 = Math.max(ay1, Math.ceil(y)); }
  ax0 = Math.max(0, ax0); ay0 = Math.max(0, ay0); ax1 = Math.min(W - 1, ax1); ay1 = Math.min(H - 1, ay1);
  const bw = ax1 - ax0 + 1, bh = ay1 - ay0 + 1;
  if (bw <= 0 || bh <= 0) return { buildings: [], skipped: { small: 0, large: 0 }, colours: { roofs: roofs.map((s) => s.rgb), ground: ground.map((g) => g.rgb) } };
  const cls = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    // (the area's crossings on this row, so each pixel isn't tested against the polygon)
    const py = ay0 + y + 0.5, xs: number[] = [];
    for (let i = 0, j = o.area.length - 1; i < o.area.length; j = i++) {
      const [xi, yi] = o.area[i], [xj, yj] = o.area[j];
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

/** Is a point inside the area (picture pixels)? (for callers checking a sample) */
export function inReaderArea(area: Pt[], x: number, y: number): boolean {
  return pointInPolygon(x, y, area);
}
