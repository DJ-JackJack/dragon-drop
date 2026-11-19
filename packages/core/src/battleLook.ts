/**
 * How a battlemap's walls look: thick stone with a lit edge, soft shadows and ambient occlusion on the floor beside
 * them, wooden doors (shut, or swung open towards the room), windows with glass, and the small marks for secret
 * doors and invisible walls. One RGBA layer (straight alpha) that is laid over the floors and the objects below the
 * walls; the editor and the server renders both use it, so what you edit is what you export.
 *
 * Light comes from the top left, so shadows fall down and to the right.
 */
import type { BattleSpec } from "./battle.ts";
import { type MapConnector, type MapWall, wallSegments } from "./features.ts";

export interface LookImage {
  w: number;
  h: number;
  /** RGBA, straight (not premultiplied) alpha. */
  data: Uint8ClampedArray;
}

/** Walls are this many squares thick. */
export const WALL_THICKNESS = 0.2;

const STONE: [number, number, number] = [126, 120, 112];
const WOOD: [number, number, number] = [158, 106, 58];
const WOOD_OPEN: [number, number, number] = [178, 130, 78];
const GLASS: [number, number, number] = [160, 206, 230];
const LIGHT_DIR = [-Math.SQRT1_2, -Math.SQRT1_2] as const;

// ---------------------------------------------------------------- small helpers
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The small helpers the other looks (roofs) share. */
export const lookKit = { clamp, smooth, hash2, vnoise, over: (d: Uint8ClampedArray, o: number, r: number, g: number, b: number, a: number) => over(d, o, r, g, b, a) };

/** Composite one straight-alpha pixel over another. */
function over(d: Uint8ClampedArray, o: number, r: number, g: number, b: number, a: number) {
  if (a <= 0) return;
  const da = d[o + 3] / 255, oa = a + da * (1 - a);
  if (oa <= 0) return;
  const k = da * (1 - a);
  d[o] = (r * a + d[o] * k) / oa;
  d[o + 1] = (g * a + d[o + 1] * k) / oa;
  d[o + 2] = (b * a + d[o + 2] * k) / oa;
  d[o + 3] = oa * 255;
}

/** Lay a wall layer over an opaque image of the same size. */
export function compositeOver(dst: { w: number; h: number; data: Uint8ClampedArray }, src: LookImage): void {
  if (dst.w !== src.w || dst.h !== src.h) return;
  const d = dst.data, s = src.data;
  for (let o = 0; o < s.length; o += 4) {
    const a = s[o + 3];
    if (a === 0) continue;
    const t = a / 255, u = 1 - t;
    d[o] = d[o] * u + s[o] * t;
    d[o + 1] = d[o + 1] * u + s[o + 1] * t;
    d[o + 2] = d[o + 2] * u + s[o + 2] * t;
  }
}

/** Separable box blur (zero outside), `passes` times, in place. */
export function boxBlur(a: Float32Array, w: number, h: number, r: number, passes = 2) {
  if (r < 1) return;
  const t = new Float32Array(a.length), n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let x = 0; x <= Math.min(r, w - 1); x++) s += a[o + x];
      for (let x = 0; x < w; x++) {
        t[o + x] = s / n;
        if (x + r + 1 < w) s += a[o + x + r + 1];
        if (x - r >= 0) s -= a[o + x - r];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = 0; y <= Math.min(r, h - 1); y++) s += t[y * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / n;
        if (y + r + 1 < h) s += t[(y + r + 1) * w + x];
        if (y - r >= 0) s -= t[(y - r) * w + x];
      }
    }
  }
}

interface Piece {
  /** Image px. */
  ax: number; ay: number; bx: number; by: number;
  len: number;
  /** Unit vector along the piece, and its perpendicular. */
  ux: number; uy: number;
  wall: MapWall;
}

interface Post { x: number; y: number; square: boolean }

/** Signed "inside" distance of a point to a butt-ended slab along a piece, `half` either side (positive inside). */
function slab(p: { ax: number; ay: number; ux: number; uy: number; len: number }, x: number, y: number, half: number): number {
  const dx = x - p.ax, dy = y - p.ay;
  const s = dx * p.ux + dy * p.uy, c = -dx * p.uy + dy * p.ux;
  return Math.min(s, p.len - s, half - Math.abs(c));
}

export interface WallLayerOptions {
  /** Is there floor under this point (in squares)? Chooses which way an open door swings. */
  floorAt?: (xSquares: number, ySquares: number) => boolean;
  /** Stairs, ladders and holes: painted first, so walls and their shadows lie over them. */
  connectors?: MapConnector[];
}

const STAIR: [number, number, number] = [176, 168, 154];

/**
 * Stairs (steps across the long way, the top of each step lit and its edge shadowed), ladders (two rails and rungs, with a soft shadow) and holes (a stone rim round
 * a pit that is darker towards the middle), painted into a layer of the battlemap. What leads where is the connector's business, not the picture's: a staircase
 * looks the same going up as down.
 */
function paintConnectors(out: LookImage, spec: BattleSpec, list: MapConnector[]) {
  const px = spec.pxPerSquare, d = out.data;
  for (const c of list) {
    const x0 = c.x * px, y0 = c.y * px, x1 = (c.x + c.w) * px, y1 = (c.y + c.h) * px;
    if (!(x1 > x0 && y1 > y0)) continue;
    const horiz = x1 - x0 >= y1 - y0, long = horiz ? x1 - x0 : y1 - y0, wide = horiz ? y1 - y0 : x1 - x0;
    const margin = c.kind === "ladder" ? 0.12 * px + 3 : 2;
    const ix0 = Math.max(0, Math.floor(x0 - margin)), ix1 = Math.min(out.w - 1, Math.ceil(x1 + margin));
    const iy0 = Math.max(0, Math.floor(y0 - margin)), iy1 = Math.min(out.h - 1, Math.ceil(y1 + margin));
    const steps = Math.max(3, Math.round((long / px) * 3));
    const bevel = Math.max(1.2, 0.07 * px);
    // a ladder: how much of this point is rail or rung (0..1)
    const railAt = 0.2 * wide, railHalf = Math.max(1.5, 0.045 * px), rungHalf = Math.max(1, 0.028 * px), pitch = 0.27 * px;
    const ladderCover = (x: number, y: number): [number, number] => {
      const s = (horiz ? x - x0 : y - y0), a = (horiz ? y - y0 : x - x0);
      if (s < -railHalf || s > long + railHalf || a < -railHalf || a > wide + railHalf) return [0, 0];
      const rail = Math.max(clamp(railHalf - Math.abs(a - railAt) + 0.5, 0, 1), clamp(railHalf - Math.abs(a - (wide - railAt)) + 0.5, 0, 1));
      const inside = a >= railAt && a <= wide - railAt && s >= 0 && s <= long;
      const r = inside ? clamp(rungHalf - Math.abs(((s + pitch / 2) % pitch) - pitch / 2) + 0.5, 0, 1) : 0;
      return [rail * (s >= -0.5 && s <= long + 0.5 ? 1 : 0), r];
    };
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        const cx = x + 0.5, cy = y + 0.5, o = (y * out.w + x) * 4;
        const ins = Math.min(cx - x0, x1 - cx, cy - y0, y1 - cy);
        if (c.kind === "stairs") {
          if (ins < -0.5) continue;
          const t = (horiz ? cx - x0 : cy - y0) / long, u = t * steps, f = u - Math.floor(u);
          const edge = f < 0.14 ? 1.2 : f > 0.84 ? 0.7 : 1;
          const side = 0.5 + 0.5 * smooth(0, bevel * 1.6, ins);
          const tex = 0.93 + 0.12 * vnoise(x / (px * 0.09), y / (px * 0.09)) + 0.04 * (hash2(x, y) - 0.5);
          const k = edge * side * tex * (0.96 + 0.06 * (1 - t));
          over(d, o, STAIR[0] * k, STAIR[1] * k, STAIR[2] * k, clamp(ins + 0.5, 0, 1));
        } else if (c.kind === "hole") {
          if (ins < -0.5) continue;
          const rim = Math.max(2, 0.11 * px), cov = clamp(ins + 0.5, 0, 1);
          if (ins < rim) {
            const f = (0.82 + 0.2 * vnoise(x / (px * 0.07), y / (px * 0.07))) * (0.7 + 0.3 * smooth(0, rim, ins));
            over(d, o, STONE[0] * f, STONE[1] * f, STONE[2] * f, cov);
          } else {
            const depth = smooth(rim, rim + 0.4 * px, ins), g = 1 - depth;
            over(d, o, 12 + 40 * g, 11 + 36 * g, 14 + 34 * g, 0.97 * cov);
          }
        } else {
          // a ladder: first a soft shadow (down and to the right), then the rails and rungs
          const [sr, sg] = ladderCover(cx - 0.05 * px, cy - 0.07 * px);
          const sh = Math.max(sr, sg);
          if (sh > 0) over(d, o, 8, 7, 10, 0.32 * sh);
          const [rail, rung] = ladderCover(cx, cy);
          if (rung > 0) over(d, o, WOOD_OPEN[0], WOOD_OPEN[1], WOOD_OPEN[2], rung);
          if (rail > 0) over(d, o, WOOD[0] * 0.82, WOOD[1] * 0.82, WOOD[2] * 0.82, rail);
        }
      }
    }
  }
}

/** The wall layer for a battlemap (image size = squares x pxPerSquare). */
export function renderWallLayer(spec: BattleSpec, walls: MapWall[] | undefined, opts: WallLayerOptions = {}): LookImage {
  const px = spec.pxPerSquare, W = Math.round(spec.squaresX * px), H = Math.round(spec.squaresY * px);
  const out: LookImage = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  if (opts.connectors?.length) paintConnectors(out, spec, opts.connectors);
  if (!walls?.length) return out;

  const T = Math.max(3, WALL_THICKNESS * px), half = T / 2;
  const bevel = Math.max(1.2, 0.04 * px);

  // ---- sort the pieces
  const stone: Piece[] = [], doors: Piece[] = [], windows: Piece[] = [], ghosts: Piece[] = [], secrets: Piece[] = [];
  const ends = new Map<string, { x: number; y: number; n: number; axis: boolean; solid: boolean }>();
  const key = (x: number, y: number) => `${Math.round(x * 20)},${Math.round(y * 20)}`;
  for (const wl of walls) {
    for (const [a, b] of wallSegments(wl)) {
      const ax = a[0] * px, ay = a[1] * px, bx = b[0] * px, by = b[1] * px, len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const p: Piece = { ax, ay, bx, by, len, ux: (bx - ax) / len, uy: (by - ay) / len, wall: wl };
      if (wl.kind === "door") doors.push(p);
      else if (wl.kind === "window") { windows.push(p); stone.push(p); }
      else if (wl.kind === "invisible") ghosts.push(p);
      else { stone.push(p); if (wl.kind === "secret") secrets.push(p); }
      if (wl.kind === "invisible") continue;
      const axis = Math.abs(p.ux) < 1e-3 || Math.abs(p.uy) < 1e-3;
      for (const [x, y] of [[ax, ay], [bx, by]] as const) {
        const k = key(x, y), e = ends.get(k);
        const solid = wl.kind !== "wall" && wl.kind !== "secret";
        if (e) { e.n++; e.axis = e.axis && axis; e.solid = e.solid || solid; } else ends.set(k, { x, y, n: 1, axis, solid });
      }
    }
  }
  // a stone post where pieces meet, and at both ends of every door and window (so the opening has a frame)
  const posts: Post[] = [];
  for (const e of ends.values()) if (e.n >= 2 || e.solid) posts.push({ x: e.x, y: e.y, square: e.axis });

  // ---- soft shadows and ambient occlusion, computed at low resolution
  const S = Math.max(1, Math.round(px / 16)), lw = Math.ceil(W / S), lh = Math.ceil(H / S);
  const cast = new Float32Array(lw * lh), occ = new Float32Array(lw * lh);
  const dxs = 0.085 * px, dys = 0.115 * px;
  const fillSeg = (m: Float32Array, ax: number, ay: number, bx: number, by: number, reach: number, weight: number) => {
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / S)), x1 = Math.min(lw - 1, Math.ceil((Math.max(ax, bx) + reach) / S));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / S)), y1 = Math.min(lh - 1, Math.ceil((Math.max(ay, by) + reach) / S));
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cx = x * S + S / 2, cy = y * S + S / 2;
        const t = clamp(((cx - ax) * vx + (cy - ay) * vy) / l2, 0, 1);
        const d = Math.hypot(cx - (ax + vx * t), cy - (ay + vy * t));
        const v = clamp((reach - d) / S + 0.5, 0, 1) * weight;
        if (v > m[y * lw + x]) m[y * lw + x] = v;
      }
    }
  };
  const casters: [Piece, number][] = [...stone.map((p): [Piece, number] => [p, p.wall.kind === "window" ? 0.7 : 1]), ...doors.map((p): [Piece, number] => [p, 0.55])];
  for (const [p, wt] of casters) {
    fillSeg(cast, p.ax + dxs, p.ay + dys, p.bx + dxs, p.by + dys, half, wt);
    fillSeg(occ, p.ax, p.ay, p.bx, p.by, half, wt);
  }
  for (const q of posts) {
    fillSeg(cast, q.x + dxs, q.y + dys, q.x + dxs, q.y + dys, half, 1);
    fillSeg(occ, q.x, q.y, q.x, q.y, half, 1);
  }
  boxBlur(cast, lw, lh, Math.max(1, Math.round((0.07 * px) / S)));
  boxBlur(occ, lw, lh, Math.max(1, Math.round((0.2 * px) / S)));
  const shade = new Float32Array(lw * lh);
  let any = false;
  for (let i = 0; i < shade.length; i++) {
    const c = Math.min(1, cast[i] * 1.5), o = Math.min(1, occ[i] * 1.7);
    const a = 1 - (1 - 0.52 * c) * (1 - 0.34 * o);
    shade[i] = a;
    if (a > 0.004) any = true;
  }
  if (any) {
    const d = out.data;
    for (let y = 0; y < H; y++) {
      const gy = (y + 0.5) / S - 0.5, y0 = clamp(Math.floor(gy), 0, lh - 1), y1 = Math.min(lh - 1, y0 + 1), fy = clamp(gy - y0, 0, 1);
      for (let x = 0; x < W; x++) {
        const gx = (x + 0.5) / S - 0.5, x0 = clamp(Math.floor(gx), 0, lw - 1), x1 = Math.min(lw - 1, x0 + 1), fx = clamp(gx - x0, 0, 1);
        const a = (shade[y0 * lw + x0] * (1 - fx) + shade[y0 * lw + x1] * fx) * (1 - fy) + (shade[y1 * lw + x0] * (1 - fx) + shade[y1 * lw + x1] * fx) * fy;
        if (a <= 0.004) continue;
        const o = (y * W + x) * 4;
        over(d, o, 8, 7, 10, a);
      }
    }
  }

  // ---- stone, in 64 px tiles so only the places near a wall are visited
  const TILE = 64, tilesX = Math.ceil(W / TILE), tilesY = Math.ceil(H / TILE);
  const tileItems = new Map<number, ({ kind: "seg"; p: Piece } | { kind: "post"; q: Post })[]>();
  const addTo = (x0: number, y0: number, x1: number, y1: number, item: { kind: "seg"; p: Piece } | { kind: "post"; q: Post }) => {
    const m = half + bevel + 3;
    const tx0 = Math.max(0, Math.floor((x0 - m) / TILE)), tx1 = Math.min(tilesX - 1, Math.floor((x1 + m) / TILE));
    const ty0 = Math.max(0, Math.floor((y0 - m) / TILE)), ty1 = Math.min(tilesY - 1, Math.floor((y1 + m) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = ty * tilesX + tx;
      const list = tileItems.get(k);
      if (list) list.push(item); else tileItems.set(k, [item]);
    }
  };
  for (const p of stone) addTo(Math.min(p.ax, p.bx), Math.min(p.ay, p.by), Math.max(p.ax, p.bx), Math.max(p.ay, p.by), { kind: "seg", p });
  for (const q of posts) addTo(q.x, q.y, q.x, q.y, { kind: "post", q });
  const d = out.data;
  for (const [k, items] of tileItems) {
    const tx = k % tilesX, ty = (k - tx) / tilesX;
    const insideAt = (x: number, y: number) => {
      let best = -9;
      for (const it of items) {
        const v = it.kind === "seg" ? slab(it.p, x, y, half)
          : it.q.square ? half - Math.max(Math.abs(x - it.q.x), Math.abs(y - it.q.y)) : half - Math.hypot(x - it.q.x, y - it.q.y);
        if (v > best) best = v;
      }
      return best;
    };
    const g = (x: number, y: number) => clamp(insideAt(x, y), -1, bevel);
    for (let y = ty * TILE; y < Math.min(H, (ty + 1) * TILE); y++) {
      for (let x = tx * TILE; x < Math.min(W, (tx + 1) * TILE); x++) {
        const cx = x + 0.5, cy = y + 0.5, ins = insideAt(cx, cy);
        if (ins < -0.5) continue;
        const cov = clamp(ins + 0.5, 0, 1);
        const gx = g(cx + 1, cy) - g(cx - 1, cy), gy = g(cx, cy + 1) - g(cx, cy - 1);
        // the outward normal is minus the gradient of the inside distance; edges that face the light (top and left) are bright
        const facing = (-gx / 2) * LIGHT_DIR[0] + (-gy / 2) * LIGHT_DIR[1];
        const lit = 1 + 0.62 * facing;
        const rim = smooth(-0.2, 1.4, ins);
        const tex = 0.86 + 0.18 * (0.6 * vnoise(x / (px * 0.11), y / (px * 0.11)) + 0.4 * vnoise(x / (px * 0.034), y / (px * 0.034))) + 0.05 * (hash2(x, y) - 0.5);
        const f = tex * lit * (0.5 + 0.5 * rim);
        over(d, (y * W + x) * 4, STONE[0] * f, STONE[1] * f, STONE[2] * f, cov);
      }
    }
  }

  // ---- windows: glass in the stone
  for (const p of windows) {
    const gh = T * 0.2;
    paintSlab(out, p.ax, p.ay, p.ux, p.uy, p.len, gh, (x, y, s, c, ins) => {
      const hi = smooth(0.1, 0.9, -c / gh) * 0.45 + 0.1 * (vnoise(s / (px * 0.3), 3) - 0.5);
      const edge = 0.55 + 0.45 * smooth(-0.2, 1.3, ins);
      return [(GLASS[0] + (255 - GLASS[0]) * hi) * edge, (GLASS[1] + (255 - GLASS[1]) * hi) * edge, (GLASS[2] + (255 - GLASS[2]) * hi) * edge, 0.95 * clamp(ins + 0.5, 0, 1)];
    });
  }

  // ---- doors
  const thick = Math.max(2.4, 0.13 * px), ht = thick / 2;
  for (const p of doors) {
    const open = !!p.wall.open;
    let ox = p.ax, oy = p.ay, dx = p.ux, dy = p.uy;
    if (open) {
      // swung back on its hinge (the first point), towards the side that has floor
      let nx = -p.uy, ny = p.ux;
      if (opts.floorAt) {
        const mx = (p.ax + p.bx) / 2 / px, my = (p.ay + p.by) / 2 / px, reach = 0.7;
        const pos = opts.floorAt(mx + nx * reach, my + ny * reach), neg = opts.floorAt(mx - nx * reach, my - ny * reach);
        if (!pos && neg) { nx = -nx; ny = -ny; }
      }
      dx = nx; dy = ny;
    }
    const base = open ? WOOD_OPEN : WOOD;
    paintSlab(out, ox, oy, dx, dy, p.len, ht, (x, y, s, c, ins) => {
      const groove = Math.abs(Math.abs(c) - ht * 0.38) < 0.55 ? 0.8 : 1;
      const grain = 0.92 + 0.12 * vnoise(s / (px * 0.5), c / (px * 0.04) + 7);
      // the long edge that faces the light is bright
      const side = Math.abs(c) > ht - 1.6 ? Math.sign(c) : 0;
      const lit = 1 + 0.3 * side * (-dy * LIGHT_DIR[0] + dx * LIGHT_DIR[1]);
      const f = grain * groove * lit * (0.5 + 0.5 * smooth(-0.2, 1.3, ins));
      return [base[0] * f, base[1] * f, base[2] * f, clamp(ins + 0.5, 0, 1)];
    });
    if (!open) {
      // a brass handle and a dark seam where the doors meet
      const hx = p.ax + p.ux * p.len * 0.72, hy = p.ay + p.uy * p.len * 0.72;
      disc(out, hx, hy, Math.max(1.2, 0.03 * px), [214, 178, 92], 1);
    }
  }

  // ---- secret doors (a small gold mark, for the DM) and invisible walls (a faint dashed line)
  for (const p of secrets) {
    const mx = (p.ax + p.bx) / 2, my = (p.ay + p.by) / 2, r = Math.max(1.6, 0.055 * px);
    for (let y = Math.floor(my - r); y <= Math.ceil(my + r); y++) for (let x = Math.floor(mx - r); x <= Math.ceil(mx + r); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dd = Math.abs(x + 0.5 - mx) + Math.abs(y + 0.5 - my);
      if (dd <= r) over(d, (y * W + x) * 4, 232, 192, 92, clamp(r - dd + 0.5, 0, 1));
    }
  }
  for (const p of ghosts) {
    const dash = 0.16 * px, gap = 0.1 * px;
    for (let s = 0; s < p.len; s += dash + gap) {
      const e = Math.min(p.len, s + dash);
      for (let t = s; t <= e; t += 0.6) disc(out, p.ax + p.ux * t, p.ay + p.uy * t, 0.8, [206, 96, 220], 0.55);
    }
  }
  return out;
}

/** Paint a slab (butt ends, `halfWidth` each side of the line a -> a + dir * len) with a per-pixel colour function. */
function paintSlab(
  img: LookImage, ox: number, oy: number, dx: number, dy: number, len: number, halfWidth: number,
  colour: (x: number, y: number, s: number, c: number, inside: number) => [number, number, number, number],
) {
  const ex = ox + dx * len, ey = oy + dy * len, m = halfWidth + 2;
  const x0 = Math.max(0, Math.floor(Math.min(ox, ex) - m)), x1 = Math.min(img.w - 1, Math.ceil(Math.max(ox, ex) + m));
  const y0 = Math.max(0, Math.floor(Math.min(oy, ey) - m)), y1 = Math.min(img.h - 1, Math.ceil(Math.max(oy, ey) + m));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ox, py = y + 0.5 - oy;
      const s = px * dx + py * dy, c = -px * dy + py * dx;
      const ins = Math.min(s, len - s, halfWidth - Math.abs(c));
      if (ins < -0.5) continue;
      const [r, g, b, a] = colour(x, y, s, c, ins);
      over(img.data, (y * img.w + x) * 4, r, g, b, a);
    }
  }
}

function disc(img: LookImage, cx: number, cy: number, r: number, c: [number, number, number], alpha: number) {
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(img.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(img.h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (dd <= r + 0.5) over(img.data, (y * img.w + x) * 4, c[0], c[1], c[2], alpha * clamp(r - dd + 0.5, 0, 1));
  }
}
