/**
 * How a battlemap's roofs look: slate, clay tile, thatch or wooden shingles (or a picture from an asset pack, tiled), on a pitched roof (two slopes, the one facing the
 * light brighter, with a ridge along the longer way) or a flat one, with a darker eave round the edge and a soft shadow beyond it. One RGBA layer (straight alpha,
 * transparent outside the roofs): the editor lays it over the map (faintly, while you work), and the Foundry export draws each roof on its own, cropped to its outline (`renderRoofPicture`), as a Foundry tile.
 *
 * Light comes from the top left, as everywhere on a battlemap, so the slope that faces up or left is the bright one and shadows fall down and to the right.
 */
import type { BattleSpec } from "./battle.ts";
import { type LookImage, lookKit } from "./battleLook.ts";
import { type MapRoof, type RoofStyle } from "./features.ts";

const { clamp, smooth, hash2, vnoise, over } = lookKit;

/** What each look is called, for pickers. */
export const ROOF_STYLE_NAMES: Record<RoofStyle, string> = { slate: "Slate", tile: "Clay tile", thatch: "Thatch", shingle: "Wood shingles" };

/** The colour each look starts from. */
export const ROOF_BASE: Record<RoofStyle, [number, number, number]> = { slate: [98, 106, 120], tile: [172, 88, 60], thatch: [164, 134, 74], shingle: [120, 86, 56] };

/** A decoded picture to tile across a roof (RGBA, `size` x `size`). */
export interface RoofTile {
  data: Uint8ClampedArray;
  size: number;
}
export type RoofTileSource = (asset: string) => RoofTile | null | undefined;

/** "#rrggbb" to numbers, or null. */
export function roofColour(hex: string | undefined): [number, number, number] | null {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** How light or dark one element of the roofing is at this pixel (1 = the base colour): slates, tiles, thatch or shingles, in rows. */
function pattern(style: RoofStyle, x: number, y: number, px: number): number {
  switch (style) {
    case "slate": {
      const rh = Math.max(3, 0.2 * px), sw = Math.max(4, 0.34 * px), row = Math.floor(y / rh), fy = y / rh - row;
      const ox = (x + (row & 1 ? sw / 2 : 0)) / sw, col = Math.floor(ox), fx = ox - col;
      let m = 0.86 + 0.26 * hash2(col * 7 + 3, row * 13 + 1);
      if (fy > 0.86) m *= 0.6; else if (fy < 0.1) m *= 1.12;
      if (fx < 0.05 || fx > 0.95) m *= 0.72;
      return m;
    }
    case "tile": {
      const rh = Math.max(4, 0.26 * px), tw = Math.max(4, 0.3 * px), row = Math.floor(y / rh), fy = y / rh - row;
      const ox = (x + (row & 1 ? tw / 2 : 0)) / tw, col = Math.floor(ox), fx = ox - col;
      let m = (0.9 + 0.2 * hash2(col * 5 + 1, row * 11 + 7)) * (0.82 + 0.18 * Math.sin(fx * Math.PI));
      if (fy > 0.8 + 0.06 * Math.cos(fx * Math.PI * 2)) m *= 0.58; else if (fy < 0.12) m *= 1.14;
      return m;
    }
    case "thatch": {
      const band = (y / (0.4 * px)) % 1;
      let m = 0.72 + 0.55 * vnoise(x / (px * 0.022), y / (px * 0.16)) + 0.12 * (hash2(Math.floor(x), Math.floor(y)) - 0.5);
      if (band < 0.07) m *= 0.68;
      return m;
    }
    default: { // wooden shingles
      const rh = Math.max(3, 0.19 * px), row = Math.floor(y / rh), fy = y / rh - row, sw = Math.max(3, 0.2 * px);
      const ox = (x + hash2(row, 99) * sw) / sw, col = Math.floor(ox), fx = ox - col;
      let m = 0.8 + 0.4 * hash2(col * 3 + 5, row * 17 + 2);
      if (fy > 0.88) m *= 0.55; else if (fy < 0.1) m *= 1.1;
      if (fx < 0.06) m *= 0.6;
      return m;
    }
  }
}

/** Is the point inside the polygon, and how far is it from the nearest edge (px)? Signed: positive inside. */
function signedDistance(P: [number, number][], x: number, y: number): number {
  let inside = false, best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1);
    const d = Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
    if (d < best) best = d;
  }
  return inside ? best : -best;
}

/**
 * How far a roof is turned from the axes, in radians: the angle of its longest side folded into (-45 deg, 45 deg], or 0 when that side runs along an axis (within half a degree).
 * A roof turned any other way keeps its ridge along that side: its slopes, rows and picture are worked out in a frame turned by this much (see `paintRoof`). A roof along the axes
 * is drawn exactly as it always was.
 */
export function roofTurn(points: [number, number][]): number {
  let best = 0, ang = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % n], l = Math.hypot(x1 - x0, y1 - y0);
    if (l > best + 1e-9) { best = l; ang = Math.atan2(y1 - y0, x1 - x0); }
  }
  if (best === 0) return 0;
  const q = Math.PI / 2;
  let t = ang - Math.round(ang / q) * q;
  if (t <= -Math.PI / 4 + 1e-9) t += q; // (-45 deg and 45 deg are the same turn: take 45)
  return Math.abs(t) < (0.5 * Math.PI) / 180 ? 0 : t;
}

/** A roof's outline in pixels, and its box (outline plus the eave's shadow) cut to the picture: the pixels `paintRoof` may touch. */
function roofGeometry(roof: MapRoof, px: number, W: number, H: number, shadow = true) {
  const P = roof.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => [x * px, y * px] as [number, number]);
  if (P.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of P) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const reach = 0.34 * px, sx = 0.07 * px, sy = 0.1 * px; // the soft shadow beyond the eave, thrown down and to the right
  const m = shadow ? Math.ceil(reach + Math.max(sx, sy) + 2) : 2; // (without the shadow, only the soft edge of the roof itself is beyond its outline)
  const box = { x0: Math.max(0, Math.floor(minX - m)), x1: Math.min(W - 1, Math.ceil(maxX + m)), y0: Math.max(0, Math.floor(minY - m)), y1: Math.min(H - 1, Math.ceil(maxY + m)) };
  return { P, minX, minY, maxX, maxY, reach, sx, sy, box };
}

/**
 * Where a roof's own picture is in the level's picture, in pixels (null for a roof with fewer than three corners, or one wholly outside the picture). It is for the Foundry
 * export, which differs from the picture the editor shows in two ways, both learned in a real Foundry (RT9): the roof has **no shadow** (a shadow outside the roof's outline would
 * stay behind as a dark halo when the roof fades away) and the picture's **width and height are even**, so that its centre, which is where Foundry places a tile, is a whole pixel
 * (Foundry rounds a tile's position to whole pixels: a half pixel put every roof half a pixel off and left a thin line of roof after it faded).
 */
export interface RoofPictureRect { x: number; y: number; w: number; h: number }
export function roofPictureRect(spec: BattleSpec, roof: MapRoof): RoofPictureRect | null {
  const px = spec.pxPerSquare, W = Math.round(spec.squaresX * px), H = Math.round(spec.squaresY * px);
  const g = roofGeometry(roof, px, W, H, false);
  if (!g || g.box.x1 < g.box.x0 || g.box.y1 < g.box.y0) return null;
  let w = g.box.x1 - g.box.x0 + 1, h = g.box.y1 - g.box.y0 + 1;
  if (w % 2) w++; // (one more transparent column or row: past the edge of the level's picture if the roof reaches it)
  if (h % 2) h++;
  return { x: g.box.x0, y: g.box.y0, w, h };
}

/**
 * Paints one roof into `out`, which holds the part of the level's picture that starts at (ox, oy) (the whole picture when both are 0). Every pixel is worked out
 * at its place in the whole picture, so a roof painted into its own small picture is exactly its part of the whole layer.
 */
function paintRoof(out: LookImage, ox: number, oy: number, W: number, H: number, px: number, roof: MapRoof, tileFor: RoofTileSource | undefined, shadow = true) {
  const g = roofGeometry(roof, px, W, H, shadow);
  if (!g) return;
  const { P, minX, minY, maxX, maxY, reach, sx, sy } = g;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, hw = Math.max(1, (maxX - minX) / 2), hh = Math.max(1, (maxY - minY) / 2);
  // a roof turned off the axes works in a frame turned to match (u along its longest side, v across); one along the axes uses the plain frame, exactly as before
  const turn = roofTurn(roof.points), turned = turn !== 0;
  const ux = Math.cos(turn), uy = Math.sin(turn), vx = -uy, vy = ux;
  let cu = 0, cv = 0, hu = 1, hv = 1;
  if (turned) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of P) { const u = x * ux + y * uy, v = x * vx + y * vy; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    cu = (u0 + u1) / 2; cv = (v0 + v1) / 2; hu = Math.max(1, (u1 - u0) / 2); hv = Math.max(1, (v1 - v0) / 2);
  }
  const horizontal = turned ? hu >= hv : hw >= hh; // the ridge runs the longer way
  const own = roofColour(roof.colour), base = own ?? ROOF_BASE[roof.style] ?? ROOF_BASE.slate;
  const tex = roof.asset ? tileFor?.(roof.asset) ?? null : null;
  const period = Math.max(0.25, roof.tile ?? 2) * px;
  const x0 = Math.max(g.box.x0, ox), x1 = Math.min(g.box.x1, ox + out.w - 1);
  const y0 = Math.max(g.box.y0, oy), y1 = Math.min(g.box.y1, oy + out.h - 1);
  const d = out.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const X = x + 0.5, Y = y + 0.5, o = ((y - oy) * out.w + (x - ox)) * 4;
      const ins = signedDistance(P, X, Y);
      if (ins < -0.5) {
        if (!shadow) continue;
        // beyond the eave: only the shadow
        const sd = signedDistance(P, X - sx, Y - sy);
        const a = sd >= 0 ? 0.36 : sd > -reach ? 0.36 * (1 + sd / reach) ** 2 : 0;
        if (a > 0.005) over(d, o, 8, 7, 10, a);
        continue;
      }
      let r: number, g2: number, b: number;
      const tx = turned ? X * ux + Y * uy : X, ty = turned ? X * vx + Y * vy : Y; // (the point in the roof's own frame: the picture and the rows follow the ridge)
      if (tex) {
        const u = (((tx / period) % 1) + 1) % 1, v = (((ty / period) % 1) + 1) % 1;
        const i = (Math.min(tex.size - 1, Math.floor(v * tex.size)) * tex.size + Math.min(tex.size - 1, Math.floor(u * tex.size))) * 4;
        r = tex.data[i]; g2 = tex.data[i + 1]; b = tex.data[i + 2];
        if (own) { r = (r * own[0]) / 200; g2 = (g2 * own[1]) / 200; b = (b * own[2]) / 200; } // (a colour tints a picture: 200 keeps a mid-grey as the colour)
      } else {
        const k = pattern(roof.style, tx, ty, px);
        r = base[0] * k; g2 = base[1] * k; b = base[2] * k;
      }
      let shade = 1;
      if (!roof.flat) {
        const s = clamp(turned ? (horizontal ? (ty - cv) / hv : (tx - cu) / hu) : horizontal ? (Y - cy) / hh : (X - cx) / hw, -1, 1); // -1 on the slope that faces the light, +1 on the other
        shade *= 1 - 0.2 * s;
        shade *= 1 + 0.24 * (1 - smooth(0, 0.05, Math.abs(s))); // the ridge catches the light
        const cap = smooth(0.05, 0.065, Math.abs(s)) * (1 - smooth(0.065, 0.09, Math.abs(s)));
        shade *= 1 - 0.16 * cap; // and has a shadowed line along it
      }
      shade *= (0.7 + 0.3 * smooth(0, 0.14 * px, ins)) * (0.97 + 0.06 * vnoise(X / (px * 0.08), Y / (px * 0.08)));
      over(d, o, clamp(r * shade, 0, 255), clamp(g2 * shade, 0, 255), clamp(b * shade, 0, 255), clamp(ins + 0.5, 0, 1));
    }
  }
}

/**
 * One roof as a picture of its own for a Foundry tile: its outline and eave but no shadow, cropped to `roofPictureRect` (RGBA, straight alpha, transparent outside the roof). Its
 * pixels are exactly that roof's part of `renderRoofLayer(spec, [roof], { shadow: false })`. Null for a roof with no picture (see `roofPictureRect`).
 */
export function renderRoofPicture(spec: BattleSpec, roof: MapRoof, opts: { tileFor?: RoofTileSource } = {}): (RoofPictureRect & { data: Uint8ClampedArray }) | null {
  const rect = roofPictureRect(spec, roof);
  if (!rect) return null;
  const px = spec.pxPerSquare, W = Math.round(spec.squaresX * px), H = Math.round(spec.squaresY * px);
  const out: LookImage = { w: rect.w, h: rect.h, data: new Uint8ClampedArray(rect.w * rect.h * 4) };
  paintRoof(out, rect.x, rect.y, W, H, px, roof, opts.tileFor, false);
  return { ...rect, data: out.data };
}

/**
 * Roofs painted into `out`, which holds the part of a picture that starts at (ox, oy) whole-picture pixels; `px` pixels per unit (outlines are in units from the picture's top-left
 * corner), W x H the whole picture. City maps use it to draw their buildings (units are metres) at any scale.
 */
export function paintRoofsInto(out: LookImage, ox: number, oy: number, W: number, H: number, px: number, roofs: MapRoof[], opts: { tileFor?: RoofTileSource; shadow?: boolean } = {}) {
  for (const r of roofs) paintRoof(out, ox, oy, W, H, px, r, opts.tileFor, opts.shadow !== false);
}

/** The roofs of a battlemap as one layer the size of its picture (squares x pxPerSquare); transparent where there is no roof. */
export function renderRoofLayer(spec: BattleSpec, roofs: MapRoof[] | undefined, opts: { tileFor?: RoofTileSource; shadow?: boolean } = {}): LookImage {
  const px = spec.pxPerSquare, W = Math.round(spec.squaresX * px), H = Math.round(spec.squaresY * px);
  const out: LookImage = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  for (const r of roofs ?? []) paintRoof(out, 0, 0, W, H, px, r, opts.tileFor, opts.shadow !== false);
  return out;
}
