/**
 * How a battlemap's paths look (roads, tracks, streams): one RGBA layer (straight alpha) laid over the floors and under the objects and walls, so the
 * editor, previews and exports agree. A path is rounded at its corners, soft at its edges, and made of a look (dirt, gravel, cobblestones, a stream) or a
 * picture from the asset packs: a strip (long, or with see-through edges: laidAlong) runs along the path, its height across it; a floor texture is tiled.
 */
import type { BattleSpec } from "./battle.ts";
import { type WallPictureSource, laidAlong, lookKit } from "./battleLook.ts";
import type { MapPath, PathLook } from "./features.ts";

const { clamp, smooth, hash2, vnoise, over } = lookKit;

/** The colour each look starts from. */
export const PATH_BASE: Record<PathLook, [number, number, number]> = { dirt: [136, 108, 74], gravel: [150, 146, 136], cobble: [132, 126, 118], water: [64, 112, 140] };

/** The corners of a line rounded off (two rounds of cutting each corner a quarter of the way in), its ends kept. */
export function smoothPath(points: [number, number][], rounds = 2): [number, number][] {
  let pts = points;
  for (let r = 0; r < rounds && pts.length >= 3; r++) {
    const out: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      if (i > 0) out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      if (i < pts.length - 2) out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** The path layer for a battlemap (image size = squares x pxPerSquare). */
export function renderPathLayer(spec: BattleSpec, paths: MapPath[] | undefined, opts: { pictureFor?: WallPictureSource } = {}): { w: number; h: number; data: Uint8ClampedArray } {
  const px = spec.pxPerSquare, W = Math.round(spec.squaresX * px), H = Math.round(spec.squaresY * px);
  const out = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  for (const path of paths ?? []) paintPath(out, path, px, opts.pictureFor);
  return out;
}

function paintPath(out: { w: number; h: number; data: Uint8ClampedArray }, path: MapPath, px: number, pictureFor?: WallPictureSource) {
  const pts = smoothPath(path.points).map(([x, y]) => [x * px, y * px] as [number, number]);
  if (pts.length < 2) return;
  const half = Math.max(1.5, ((path.width ?? 1) * px) / 2);
  // each piece, where it starts along the whole path
  const segs: { ax: number; ay: number; ux: number; uy: number; len: number; at: number }[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    segs.push({ ax, ay, ux: (bx - ax) / len, uy: (by - ay) / len, len, at: total });
    total += len;
  }
  if (!segs.length) return;
  // the nearest piece for each pixel near the path: how far along the path, and how far across it
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - half - 2)), x1 = Math.min(out.w - 1, Math.ceil(Math.max(...xs) + half + 2));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - half - 2)), y1 = Math.min(out.h - 1, Math.ceil(Math.max(...ys) + half + 2));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw <= 0 || bh <= 0) return;
  const best = new Float32Array(bw * bh).fill(Infinity), along = new Float32Array(bw * bh), across = new Float32Array(bw * bh);
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si], first = si === 0, last = si === segs.length - 1;
    const ex = s.ax + s.ux * s.len, ey = s.ay + s.uy * s.len;
    const sx0 = Math.max(x0, Math.floor(Math.min(s.ax, ex) - half - 2)), sx1 = Math.min(x1, Math.ceil(Math.max(s.ax, ex) + half + 2));
    const sy0 = Math.max(y0, Math.floor(Math.min(s.ay, ey) - half - 2)), sy1 = Math.min(y1, Math.ceil(Math.max(s.ay, ey) + half + 2));
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const dx = x + 0.5 - s.ax, dy = y + 0.5 - s.ay;
        const t = dx * s.ux + dy * s.uy, c = -dx * s.uy + dy * s.ux;
        const tc = clamp(t, 0, s.len), d = Math.hypot(dx - s.ux * tc, dy - s.uy * tc);
        const k = (y - y0) * bw + (x - x0);
        if (d < best[k]) {
          // past either end the pattern carries straight on into the rounded end; at a bend between pieces, across is the distance from the bend
          const beyond = (first && t < 0) || (last && t > s.len);
          best[k] = d;
          along[k] = s.at + (beyond ? t : tc);
          across[k] = beyond || Math.abs(t - tc) < 1e-6 ? c : Math.sign(c || 1) * d;
        }
      }
    }
  }
  const pic = path.asset && pictureFor ? pictureFor(path.asset) : null;
  const look: PathLook = path.look ?? "dirt";
  const edge = Math.max(1.5, half * 0.35);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = (y - y0) * bw + (x - x0), d = best[k];
      if (!(d < half + 1)) continue;
      const s = along[k], c = across[k];
      const fade = 1 - smooth(half - edge, half + 0.5, d);
      if (fade <= 0) continue;
      let r: number, g: number, b: number, a: number;
      if (pic) {
        let u: number, v: number;
        const strip = laidAlong(pic);
        if (strip) { u = s / ((2 * half * pic.w) / pic.h); v = (c + half) / (2 * half); } else { u = s / px; v = (c + half) / px; }
        const sx = clamp(Math.floor((u - Math.floor(u)) * pic.w), 0, pic.w - 1), sy = clamp(Math.floor((v - Math.floor(v)) * pic.h), 0, pic.h - 1);
        const o = (sy * pic.w + sx) * 4;
        r = pic.data[o]; g = pic.data[o + 1]; b = pic.data[o + 2];
        // (a strip has its own soft edges; a tiled texture gets the path's)
        a = (pic.data[o + 3] / 255) * (strip ? clamp((half + 0.5 - d) / 1.5, 0, 1) : fade);
      } else {
        [r, g, b] = lookColour(look, x, y, s, c, half, px);
        a = fade * (look === "water" ? 0.92 : 0.95);
      }
      over(out.data, (y * out.w + x) * 4, r, g, b, a);
    }
  }
}

/** The colour of a built-in path look at a pixel (`s` along the path, `c` across it, in pixels). */
function lookColour(look: PathLook, x: number, y: number, s: number, c: number, half: number, px: number): [number, number, number] {
  const [r, g, b] = PATH_BASE[look];
  let f: number;
  switch (look) {
    case "dirt": {
      // mottled earth, two worn ruts a little darker
      const rut = Math.max(0, 1 - Math.abs(Math.abs(c) - half * 0.45) / (half * 0.12));
      f = 0.88 + 0.2 * vnoise(x / (px * 0.18), y / (px * 0.18)) + 0.06 * (hash2(x, y) - 0.5) - 0.12 * rut;
      break;
    }
    case "gravel":
      f = 0.82 + 0.1 * vnoise(x / (px * 0.25), y / (px * 0.25)) + 0.28 * (hash2(Math.floor(x / Math.max(1, px * 0.03)), Math.floor(y / Math.max(1, px * 0.03))) - 0.5);
      break;
    case "cobble": {
      // rows of rounded stones across the path, each row offset, dark joints between
      const sz = Math.max(3, px * 0.22), row = Math.floor(s / sz), u = (c + half + (row & 1 ? sz / 2 : 0)) / sz, col = Math.floor(u);
      const fu = u - col, fv = s / sz - row;
      const round = Math.min(fu, 1 - fu, fv, 1 - fv) * sz;
      f = round < Math.max(0.7, px * 0.015) ? 0.55 : 0.86 + 0.2 * hash2(col * 13 + 7, row) + 0.08 * smooth(0, sz * 0.3, round);
      break;
    }
    case "water": {
      // deeper in the middle, ripples running along it, a paler bank at the edges
      const depth = 1 - Math.abs(c) / half;
      const ripple = 0.06 * Math.sin(s / (px * 0.12) + 3 * vnoise(x / (px * 0.3), y / (px * 0.3)));
      f = 1.15 - 0.3 * depth + ripple;
      if (Math.abs(c) > half * 0.8) return [r * 1.35 * f, g * 1.2 * f, b * 1.0 * f];
      break;
    }
  }
  return [r * f, g * f, b * f];
}
