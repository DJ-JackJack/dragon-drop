/**
 * The hand-drawn ink style for world maps (`MapMeta.style` "ink"): parchment land and paler sea, an ink coastline with ripple lines along it out to sea, lakes
 * with an inked shore, rivers in ink, and small drawn symbols where the land calls for them: peaks on the mountains, rounded hills, trees in the woods.
 * Everything is worked out from the terrain and the climate, so it follows every edit; nothing is placed by hand. The symbols (`inkSymbols`) are the same
 * wherever the map is drawn (a tile in the editor, a preview, an export), because each comes from its own cell of a grid with its own seed.
 */
import type { MapDoc } from "./doc.ts";
import type { Derived } from "./climate.ts";
import type { Rect } from "./geom.ts";

export type InkSymbolKind = "mountain" | "hill" | "tree";
export interface InkSymbol { kind: InkSymbolKind; x: number; y: number; s: number; v: number }

const PARCHMENT: RGB = [236, 224, 196];
const SEA: RGB = [214, 219, 205];
const LAKE: RGB = [206, 214, 206];
const INK: RGB = [58, 46, 36];
const RIVER_INK: RGB = [62, 78, 98];
const SHADE: RGB = [196, 180, 148];
const TREE: RGB = [178, 186, 140];
type RGB = [number, number, number];

/** A number 0..1 from a cell and a seed (the same every time). */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How far apart the symbols are (map px): about 120 across the map's longer side. */
export const inkStep = (W: number, H: number) => Math.max(5, Math.round(Math.max(W, H) / 120));

/** The symbols for this map, back to front (by y): one at most in each cell of a grid, chosen by height, steepness and climate. */
export function inkSymbols(doc: MapDoc, d: Derived): InkSymbol[] {
  const hf = doc.height, W = hf.w, H = hf.h, h = hf.data, sea = doc.meta.seaLevel, seed = doc.meta.seed ?? 1;
  const step = inkStep(W, H), out: InkSymbol[] = [];
  const at = (x: number, y: number) => h[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  // metres a map px: steepness is a climb per km, whatever the map's scale
  const kmPx = Math.max(0.01, doc.meta.kmPerPx || 1);
  for (let gy = 0; gy * step < H; gy++) for (let gx = 0; gx * step < W; gx++) {
    const r1 = hash(gx, gy, seed), r2 = hash(gx + 7919, gy, seed), r3 = hash(gx, gy + 7919, seed);
    const x = Math.min(W - 1, Math.floor((gx + 0.15 + 0.7 * r1) * step)), y = Math.min(H - 1, Math.floor((gy + 0.15 + 0.7 * r2) * step));
    const i = y * W + x, e = h[i] - sea;
    if (e <= 0 || d.lakes[i] || d.landDist[i] < 2) continue;
    const reach = Math.max(1, Math.round(step / 3));
    const slope = (Math.abs(at(x + reach, y) - at(x - reach, y)) + Math.abs(at(x, y + reach) - at(x, y - reach))) / (2 * reach * kmPx); // m per km
    if (e > 1500 || (e > 900 && slope > 120)) out.push({ kind: "mountain", x, y, s: step * (1.15 + 0.45 * Math.min(1, (e - 900) / 2600)), v: r3 });
    else if ((e > 420 || slope > 60) && r3 < 0.7) out.push({ kind: "hill", x, y, s: step * 0.95, v: r3 });
    else {
      // trees grow in woods: clumps (a value noise a few symbols across) that are bigger and more where it is wetter
      const t = d.temp[i] / 255, m = d.moist[i] / 255, woods = stainAt(x, y, seed + 31, step * 5);
      if (m > 0.42 && t > 0.12 && t < 0.9 && e < 1100 && woods > 1.05 - 0.75 * m && r3 < 0.9) out.push({ kind: "tree", x, y, s: step * 0.62, v: r3 });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** How far a symbol reaches from its spot (for redrawing around a changed area). */
export const inkMargin = (W: number, H: number) => Math.ceil(inkStep(W, H) * 1.4);

/** Draw a rectangle of the map in the ink style into `out` (the whole map's RGBA, indexed by map position). */
export function renderInk(doc: MapDoc, d: Derived, rect: Rect, out: Uint8ClampedArray, symbols: InkSymbol[], opts: { rivers?: boolean } = {}) {
  const hf = doc.height, W = hf.w, H = hf.h, h = hf.data, sea = doc.meta.seaLevel, seed = doc.meta.seed ?? 1;
  const x1 = rect.x + rect.w, y1 = rect.y + rect.h;
  const land = (i: number) => h[i] > sea && !d.lakes[i];
  for (let y = rect.y; y < y1; y++) for (let x = rect.x; x < x1; x++) {
    const i = y * W + x, o = i * 4;
    let c: RGB;
    if (d.lakes[i]) c = LAKE;
    else if (h[i] <= sea) c = SEA;
    else c = PARCHMENT;
    // stains and the light of the land: a soft wash, and a very light hillshade so the ground isn't flat
    const stain = (stainAt(x, y, seed) - 0.5) * 14;
    let shade = 0;
    if (h[i] > sea && x > 0 && y > 0 && x < W - 1 && y < H - 1) shade = Math.max(-10, Math.min(10, (h[i - W - 1] - h[i + W + 1]) * 0.012));
    let r = c[0] + stain + shade, g = c[1] + stain + shade, b = c[2] + stain * 0.8 + shade;
    // the coast: an ink line where the height crosses the sea, smooth (its distance from the slope of the ground); ripples out to sea
    let ink = 0;
    const nearCoast = !d.lakes[i] && (h[i] > sea ? d.landDist[i] <= 2 : d.seaDist[i] <= 2);
    if (nearCoast && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
      const gx = (h[i + 1] - h[i - 1]) / 2, gy = (h[i + W] - h[i - W]) / 2, g = Math.hypot(gx, gy);
      if (g > 1e-3) ink = Math.max(0, Math.min(1, 1.05 - Math.abs((h[i] - sea) / g))) * 0.95;
      else if (land(i) && d.landDist[i] <= 1) ink = 0.92;
    }
    if (ink) { /* (the coast) */ }
    else if (!d.lakes[i] && h[i] <= sea) {
      const sd = d.seaDist[i];
      ink = sd === 3 ? 0.42 : sd === 6 ? 0.28 : sd === 10 ? 0.16 : 0;
    } else if (d.lakes[i] && x > 0 && y > 0 && x < W - 1 && y < H - 1 && (land(i - 1) || land(i + 1) || land(i - W) || land(i + W))) ink = 0.85;
    if (ink) { r += (INK[0] - r) * ink; g += (INK[1] - g) * ink; b += (INK[2] - b) * ink; }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  if (opts.rivers !== false) {
    for (const rv of d.rivers) {
      const p = rv.pts;
      for (let k = 2; k < p.length; k += 2) {
        const ax = p[k - 2], ay = p[k - 1], bx = p[k], by = p[k + 1];
        if (Math.max(ax, bx) < rect.x - 3 || Math.min(ax, bx) > x1 + 3 || Math.max(ay, by) < rect.y - 3 || Math.min(ay, by) > y1 + 3) continue;
        const wdt = Math.max(0.9, Math.min(4, (rv.widths[(k >> 1) - 1] ?? 1) * 0.75));
        strokeSegment(out, W, rect, ax, ay, bx, by, wdt, RIVER_INK, 0.9);
      }
    }
  }
  const m = inkMargin(W, H);
  for (const s of symbols) {
    if (s.x < rect.x - m || s.x > x1 + m || s.y < rect.y - m || s.y > y1 + m) continue;
    if (s.kind === "mountain") drawMountain(out, W, rect, s);
    else if (s.kind === "hill") drawHill(out, W, rect, s);
    else drawTree(out, W, rect, s);
  }
}

/** A soft value noise 0..1, `S` px across (the parchment's stains, the woods). */
function stainAt(x: number, y: number, seed: number, S = 40): number {
  const gx = Math.floor(x / S), gy = Math.floor(y / S), fx = x / S - gx, fy = y / S - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(gx, gy, seed + 5), b = hash(gx + 1, gy, seed + 5), c = hash(gx, gy + 1, seed + 5), dd = hash(gx + 1, gy + 1, seed + 5);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + dd) * sx * sy;
}

// ------------------------------------------------------------------ drawing into the picture, inside `rect` only
function blend(out: Uint8ClampedArray, W: number, x: number, y: number, c: RGB, a: number) {
  const o = (y * W + x) * 4;
  out[o] += (c[0] - out[o]) * a; out[o + 1] += (c[1] - out[o + 1]) * a; out[o + 2] += (c[2] - out[o + 2]) * a;
}

function strokeSegment(out: Uint8ClampedArray, W: number, rect: Rect, ax: number, ay: number, bx: number, by: number, width: number, c: RGB, alpha: number) {
  const hw = width / 2 + 0.6;
  const x0 = Math.max(rect.x, Math.floor(Math.min(ax, bx) - hw)), x1 = Math.min(rect.x + rect.w - 1, Math.ceil(Math.max(ax, bx) + hw));
  const y0 = Math.max(rect.y, Math.floor(Math.min(ay, by) - hw)), y1 = Math.min(rect.y + rect.h - 1, Math.ceil(Math.max(ay, by) + hw));
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    const cov = Math.max(0, Math.min(1, width / 2 + 0.5 - d));
    if (cov > 0) blend(out, W, x, y, c, cov * alpha);
  }
}

/** A filled triangle, its edges softened by sampling each pixel four times. */
function fillTriangle(out: Uint8ClampedArray, W: number, rect: Rect, a: [number, number], b: [number, number], c: [number, number], col: RGB, alpha: number) {
  const x0 = Math.max(rect.x, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(rect.x + rect.w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(rect.y, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(rect.y + rect.h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const side = (p: [number, number], q: [number, number], x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const area = side(a, b, c[0], c[1]);
  if (!area) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let n = 0;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const px = x + ox, py = y + oy;
      const w0 = side(b, c, px, py) / area, w1 = side(c, a, px, py) / area, w2 = side(a, b, px, py) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) n++;
    }
    if (n) blend(out, W, x, y, col, (n / 4) * alpha);
  }
}

function fillDisc(out: Uint8ClampedArray, W: number, rect: Rect, cx: number, cy: number, r: number, col: RGB, alpha: number) {
  const x0 = Math.max(rect.x, Math.floor(cx - r - 1)), x1 = Math.min(rect.x + rect.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(rect.y, Math.floor(cy - r - 1)), y1 = Math.min(rect.y + rect.h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cov = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
    if (cov > 0) blend(out, W, x, y, col, cov * alpha);
  }
}

function strokeArc(out: Uint8ClampedArray, W: number, rect: Rect, cx: number, cy: number, rx: number, ry: number, from: number, to: number, width: number, col: RGB, alpha: number) {
  const n = Math.max(6, Math.ceil((Math.max(rx, ry) * Math.abs(to - from)) / 2));
  let px = cx + Math.cos(from) * rx, py = cy + Math.sin(from) * ry;
  for (let k = 1; k <= n; k++) {
    const a = from + ((to - from) * k) / n, qx = cx + Math.cos(a) * rx, qy = cy + Math.sin(a) * ry;
    strokeSegment(out, W, rect, px, py, qx, qy, width, col, alpha);
    px = qx; py = qy;
  }
}

/** A peak: a light face on the left, a shaded one on the right with a line or two of hatching, inked slopes, open at the foot. */
function drawMountain(out: Uint8ClampedArray, W: number, rect: Rect, m: InkSymbol) {
  const s = m.s, lean = (m.v - 0.5) * 0.25 * s;
  const top: [number, number] = [m.x + lean, m.y - 0.7 * s], left: [number, number] = [m.x - 0.62 * s, m.y + 0.32 * s], right: [number, number] = [m.x + 0.62 * s, m.y + 0.32 * s];
  const foot: [number, number] = [m.x + lean * 0.4 + 0.08 * s, m.y + 0.32 * s];
  fillTriangle(out, W, rect, top, left, foot, PARCHMENT, 1);
  fillTriangle(out, W, rect, top, foot, right, SHADE, 1);
  const w = Math.max(0.9, s * 0.07);
  // hatching on the shaded face, along the right slope
  for (const k of [0.35, 0.6]) {
    const ax = top[0] + (right[0] - top[0]) * k - 0.12 * s, ay = top[1] + (right[1] - top[1]) * k + 0.05 * s;
    strokeSegment(out, W, rect, ax, ay, ax + 0.14 * s, ay + 0.18 * s, w * 0.6, INK, 0.55);
  }
  strokeSegment(out, W, rect, left[0], left[1], top[0], top[1], w, INK, 0.95);
  strokeSegment(out, W, rect, top[0], top[1], right[0], right[1], w, INK, 0.95);
}

/** A hill: a rounded hump, inked, shaded a little on the right. */
function drawHill(out: Uint8ClampedArray, W: number, rect: Rect, hl: InkSymbol) {
  const s = hl.s, rx = 0.55 * s, ry = 0.36 * s, cx = hl.x, cy = hl.y + 0.2 * s;
  // (the hump filled so a hill in front covers the one behind)
  for (let k = 0; k < 6; k++) {
    const a0 = Math.PI + (Math.PI * k) / 6, a1 = Math.PI + (Math.PI * (k + 1)) / 6;
    fillTriangle(out, W, rect, [cx, cy], [cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry], [cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry], k >= 4 ? SHADE : PARCHMENT, 1);
  }
  const w = Math.max(0.8, s * 0.07);
  strokeArc(out, W, rect, cx, cy, rx, ry, Math.PI, 2 * Math.PI, w, INK, 0.9);
  strokeArc(out, W, rect, cx + 0.12 * s, cy + 0.02 * s, rx * 0.55, ry * 0.5, Math.PI * 1.55, Math.PI * 1.95, w * 0.6, INK, 0.5);
}

/** A tree: a round crown with an inked edge on a short trunk. */
function drawTree(out: Uint8ClampedArray, W: number, rect: Rect, t: InkSymbol) {
  const s = t.s, r = 0.42 * s, cx = t.x, cy = t.y - 0.15 * s, w = Math.max(0.7, s * 0.09);
  strokeSegment(out, W, rect, cx, cy + r * 0.6, cx, cy + r + 0.32 * s, w, INK, 0.85);
  fillDisc(out, W, rect, cx, cy, r, TREE, 1);
  strokeArc(out, W, rect, cx, cy, r, r, 0, 2 * Math.PI, w, INK, 0.85);
  // a little shade on the crown's lower right
  strokeArc(out, W, rect, cx + 0.06 * s, cy + 0.06 * s, r * 0.6, r * 0.6, 0.1 * Math.PI, 0.6 * Math.PI, w * 0.7, INK, 0.4);
}
