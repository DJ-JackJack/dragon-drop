/**
 * "Painted Relief" renderer - the TypeScript port of the prototype's render_textured.py.
 *
 * Why it doesn't look like plastic: shading comes from LOCAL relief, there's erosion-style
 * detail down to ~1 px, vegetation is speckled and clumped, snow is broken, and the coast
 * gets a thin dark edge. Large-scale climate (temperature/moisture) comes from Derived.
 *
 * renderPainted() draws any sub-rectangle (with an internal margin for its blurs), so the
 * editor can redraw just what a brush stroke touched.
 */
import { type ClimateParams, type Derived, STYLE_E, WIND_TRAVEL, climateOf, latAt } from "./climate.ts";
import type { MapDoc } from "./doc.ts";
import { gaussianBlur } from "./fields.ts";
import { bicubicUpsample } from "./upscale.ts";
import { type Rect, clipRect, expandRect } from "./geom.ts";
import type { RiverPath } from "./hydrology.ts";
import { type NoiseCache, styleScale } from "./noisecache.ts";
import { smoothstep } from "./noise.ts";
import type { RGBAImage } from "./render.ts";
import { type BiomePixel, type Site, biomeWeights, emptyBiomeWeights, lakeShoreDistance, paintBiomes, paintGlacier } from "./biomeLook.ts";
import { applyPaintedGround } from "./groundPaint.ts";
import { type RiverPixel, RIVER_REACH, paintRiverPixel, rasterRivers, shoreTone, valleyDepth, valleyProfile } from "./riverPaint.ts";
import { LAVA_REACH, lavaOf, rasterLava } from "./lava.ts";

// temperature (rows: cold -> hot) x moisture (cols: dry -> wet)
const PAL: number[][][] = [
  [[186, 180, 160], [150, 150, 120], [96, 110, 86], [62, 84, 66]],
  [[182, 170, 120], [140, 146, 88], [88, 112, 62], [58, 86, 50]],
  [[200, 184, 126], [142, 152, 72], [92, 124, 48], [56, 98, 36]],
  [[232, 214, 158], [200, 186, 110], [128, 146, 56], [64, 108, 32]],
];

/**
 * How much of a cell's look is jungle (hot and very wet) or desert (hot and dry), 0..1. Natural gradients stay below
 * both unless the map really is tropical or arid; climate regions reach them on purpose.
 */
export const jungleWeight = (t: number, m: number) => smoothstep(0.8, 0.93, t) * smoothstep(0.72, 0.9, m);
export const desertWeight = (t: number, m: number) => (1 - smoothstep(0.03, 0.16, m)) * smoothstep(0.55, 0.8, t);

function palette(t: number, m: number, out: number[]) {
  const ti = Math.min(2.999, Math.max(0, t * 3)), mi = Math.min(2.999, Math.max(0, m * 3));
  const t0 = Math.floor(ti), m0 = Math.floor(mi), ft = ti - t0, fm = mi - m0;
  for (let c = 0; c < 3; c++) {
    const a = PAL[t0][m0][c] * (1 - fm) + PAL[t0][m0 + 1][c] * fm;
    const b = PAL[t0 + 1][m0][c] * (1 - fm) + PAL[t0 + 1][m0 + 1][c] * fm;
    out[c] = a * (1 - ft) + b * ft;
  }
}

function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const L1 = norm3(-1, -1, 1.0), L2 = norm3(-0.4, -1, 1.6);
const SHADE_REF = 0.7 * L1[2] + 0.3 * L2[2];
function norm3(x: number, y: number, z: number) {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

/**
 * Local relief of the terrain averaged into F x F cells (the scale its parent map shades at),
 * upsampled smoothly back onto the tile T. Cells align to the whole map, so tiles agree.
 */
function coarseRelief(data: Float32Array, W: number, H: number, sea: number, T: Rect, F: number, k: number): Float32Array {
  const sigma = 28 * k;
  const pad = Math.ceil(3 * sigma) + 4;
  const cw = Math.ceil(W / F), ch = Math.ceil(H / F);
  // low-res cells covering the tile (+2 for the bicubic), and a wider window for the blur
  const tx0 = Math.max(0, Math.floor(T.x / F) - 2), ty0 = Math.max(0, Math.floor(T.y / F) - 2);
  const tx1 = Math.min(cw, Math.floor((T.x + T.w - 1) / F) + 3), ty1 = Math.min(ch, Math.floor((T.y + T.h - 1) / F) + 3);
  const lx0 = Math.max(0, tx0 - pad), ly0 = Math.max(0, ty0 - pad), lx1 = Math.min(cw, tx1 + pad), ly1 = Math.min(ch, ty1 + pad);
  const lw = lx1 - lx0, lh = ly1 - ly0;
  const low = new Float32Array(lw * lh);
  for (let cy = 0; cy < lh; cy++) {
    const y0 = (ly0 + cy) * F, y1 = Math.min(H, y0 + F);
    for (let cx = 0; cx < lw; cx++) {
      const x0 = (lx0 + cx) * F, x1 = Math.min(W, x0 + F);
      let sum = 0;
      for (let y = y0; y < y1; y++) { const row = y * W; for (let x = x0; x < x1; x++) sum += data[row + x]; }
      low[cy * lw + cx] = (sum / ((y1 - y0) * (x1 - x0)) - sea) / STYLE_E;
    }
  }
  const blurred = gaussianBlur(low, lw, lh, sigma);
  // crop to the cells the tile needs, then upsample
  const w = tx1 - tx0, h = ty1 - ty0;
  const local = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (ty0 - ly0 + y) * lw + tx0 - lx0 + x;
    local[y * w + x] = low[i] - 0.78 * blurred[i];
  }
  const up = bicubicUpsample(local, w, h, F);
  const out = new Float32Array(T.w * T.h);
  const ox = T.x - tx0 * F, oy = T.y - ty0 * F, uw = w * F;
  for (let y = 0; y < T.h; y++) out.set(up.subarray((oy + y) * uw + ox, (oy + y) * uw + ox + T.w), y * T.w);
  return out;
}

/**
 * The blurred and normalised height fields that painting a tile needs (detailed height, ruggedness, local relief, and the parent's relief on zoomed
 * maps). Building them is about half the cost of a paint, and tiles need a margin around them for the blurs, so a full repaint builds them once for
 * the whole map and paints its slices from that (see the `prep` argument of renderPainted).
 */
export interface PaintPrep {
  /** The area these fields cover (a tile with its margin, or the whole map). */
  T: Rect;
  hd: Float32Array;
  rug: Float32Array;
  small: Float32Array;
  local: Float32Array;
  coarse: Float32Array | null;
}

export function paintPrep(doc: MapDoc, n: NoiseCache, T: Rect): PaintPrep {
  const { w: W, h: H, data } = doc.height;
  const k = styleScale(W);
  const tw = T.w, th = T.h;
  const sea = doc.meta.seaLevel;
  const F = Math.max(1, Math.round(doc.meta.zoom ?? 1));
  const tex = 1 / Math.pow(F, 0.6); // texture relief shrinks as the map zooms in
  // detailed height (normalised) for the tile
  const hd = new Float32Array(tw * th);
  const rug = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const gi = (T.y + y) * W + T.x + x, i = y * tw + x;
      const hs = (data[gi] - sea) / STYLE_E;
      if (hs > 0) {
        const rg = smoothstep(0.1, 0.4, hs);
        rug[i] = rg;
        hd[i] = hs + (n.mtn[gi] * 0.13 * rg + n.hills[gi] * 0.02 * (1 - rg)) * tex;
      } else hd[i] = hs;
    }
  }
  // Zoomed-in (regional) maps: landforms span many pixels, so pixel-scale shading alone goes
  // flat. Add the relief of the terrain at the parent's scale (cells of F px), like the
  // parent map shades it.
  const coarse = F > 1 ? coarseRelief(data, W, H, sea, T, F, k) : null;
  const small = gaussianBlur(hd, tw, th, Math.max(0.6, 2.5 * k));
  const large = gaussianBlur(hd, tw, th, 28 * k);
  const local = new Float32Array(tw * th);
  for (let i = 0; i < local.length; i++) local[i] = hd[i] - 0.78 * large[i];

  return { T, hd, rug, small, local, coarse };
}

const covers = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

export interface PaintOptions {
  /** Paint the rivers into the map (default true). */
  rivers?: boolean;
}

/** Draw `rect` (or the whole map) into a full-map-sized RGBA buffer. */
export function renderPainted(doc: MapDoc, d: Derived, n: NoiseCache, rect: Rect | null, out: Uint8ClampedArray, prep?: PaintPrep, opts: PaintOptions = {}): void {
  const { w: W, h: H, data } = doc.height;
  const r = clipRect(rect ?? { x: 0, y: 0, w: W, h: H }, W, H);
  if (!r) return;
  const c: ClimateParams = climateOf(doc);
  const k = styleScale(W);
  const margin = Math.ceil(3 * 28 * k) + 3;
  // a prep for the whole map (built once by a full repaint) is reused; otherwise this tile builds its own, with a margin for the blurs
  const P = prep && covers(prep.T, r) ? prep : paintPrep(doc, n, clipRect(expandRect(r, margin), W, H)!);
  const T = P.T;
  const tw = T.w, th = T.h;
  const { hd, rug, coarse, small, local } = P;
  const sea = doc.meta.seaLevel;
  const F = Math.max(1, Math.round(doc.meta.zoom ?? 1));
  const tex = 1 / Math.pow(F, 0.6); // texture relief shrinks as the map zooms in

  const Z = 70 * k, SL = 60 * k;
  const snowN = c.snowlineM / STYLE_E;
  const col = [0, 0, 0];
  const deep = [60, 72, 116], mid = [92, 118, 160], shallow = [152, 180, 200];
  // Desert dunes run across the prevailing wind (no wind: a fixed slant); about 10 px apart on a 2048-px map.
  const [wx, wy] = c.wind === "none" ? [1, 0.5] : WIND_TRAVEL[c.wind];
  const wl = Math.hypot(wx, wy), dux = wx / wl, duy = wy / wl, duneLen = Math.max(5, 10 * k);
  // rivers: how far each pixel is from the water, how big and how steep the river there is (painted into the map, and cut into its shading)
  const RR = opts.rivers === false || !d.rivers?.length ? null : rasterRivers(d.rivers, doc.height, doc.meta.kmPerPx, r, sea);
  const rrW = RR ? RR.r.w : 0;
  // lava flows on volcanic ground (worked out like rivers, from the heights and the volcanic plane; the same for every tile)
  const LV = d.volcanic ? rasterLava(lavaOf(d, doc.height, sea, d.volcanic, doc.meta.kmPerPx), doc.height, r) : null;
  const lvW = LV ? LV.r.w : 0;
  const rp: RiverPixel = { re: 0, size: 0, drop: 0, e: 0, t: 0, m: 0, jw: 0, dw: 0, veg: 0, rw: 0, sw: 0, f: 1, fine: 0, crown: 0, ld: 255, along: 0, stone: 0, painted: 0 };
  const rcol = [0, 0, 0];
  // the ground of the land that is neither jungle nor desert (tundra, conifer, mixed and warm forest, savanna, steppe, marsh)
  const bw = emptyBiomeWeights(), bcol = [0, 0, 0];
  const bp: BiomePixel = { t: 0, m: 0, cn: 0, cl: 0, hu: 0, rk: 0, fine: 0, hills: 0, e: 0, rg: 0, x: 0, y: 0, dux, duy, len: duneLen };
  const site: Site = { ld: 255, shore: 99 };
  const SHORE_REACH = 8;
  const LS = d.lakes ? lakeShoreDistance(d.lakes, W, H, r, SHORE_REACH) : null; // how far each pixel is from a lake
  const lsW = LS ? LS.r.w : 0;
  const gcol = [0, 0, 0], scol = [0, 0, 0], JD = [0, 0];

  for (let y = r.y; y < r.y + r.h; y++) {
    const ty = y - T.y;
    const lat = latAt(c, y, H);
    const sl = snowN - lat * lat * c.snowLat;
    for (let x = r.x; x < r.x + r.w; x++) {
      const tx = x - T.x;
      const i = ty * tw + tx, gi = y * W + x;
      const o = gi * 4;
      const xm = tx > 0 ? i - 1 : i, xp = tx < tw - 1 ? i + 1 : i;
      const ym = ty > 0 ? i - tw : i, yp = ty < th - 1 ? i + tw : i;
      let R: number, G: number, B: number;

      if (data[gi] - sea > 0) {
        const e = hd[i] > 0 ? hd[i] : 0;
        const rg = rug[i];
        // the nearest river's water edge (RR covers this tile with 2 px round it, so the neighbours exist unless this is the map's edge)
        const ri = RR ? (y - RR.r.y) * rrW + (x - RR.r.x) : -1;
        const re = RR ? RR.edge[ri] : 1e3;
        const nearRiver = re < RIVER_REACH;
        const t = d.temp[gi] / 255, m = d.moist[gi] / 255;
        palette(t, m, col);
        R = col[0]; G = col[1]; B = col[2];
        // vegetation: forest clumps (conifer blue-green when cold, broadleaf when warm), canopy speckle, hue drift
        const veg = smoothstep(0.35, 0.8, m) * (1 - rg * 0.8);
        const clump = smoothstep(-0.05, 0.25, n.clump[gi] / 127) * veg * 0.45;
        R = R * (1 - clump) + (38 + 10 * t) * clump;
        G = G * (1 - clump) + (60 + 24 * t) * clump;
        B = B * (1 - clump) + (50 - 22 * t) * clump;
        const can = 1 + (n.canopy[gi] / 127) * (0.09 + 0.12 * veg);
        const hu = n.hue[gi] / 127;
        R *= can * (1 + hu * 0.06); G *= can; B *= can * (1 - hu * 0.06);
        // open ground (little vegetation to give it texture) gets a grain of its own: tufts and patches of drier and greener grass
        const grain = 1 + (n.fine[gi] / 127) * 0.08 * (1 - veg) + (n.clump[gi] / 127) * 0.07 * (1 - veg);
        R *= grain; G *= grain * (1 + hu * 0.02 * (1 - veg)); B *= grain;
        // The ground of each climate: tundra, conifer, mixed and warm forest, savanna, steppe and marsh (jungle and desert paint themselves below)
        let jw = jungleWeight(t, m), dw = desertWeight(t, m);
        // low flat ground beside a big river is wetland (the river's floodplain)
        const wet = nearRiver && RR ? (1 - smoothstep(0, 4 + 10 * RR.size[ri], re > 0 ? re : 0)) * (0.35 + 0.65 * RR.size[ri]) : 0;
        site.ld = d.landDist[gi] || 255; // (0 means "was sea when derived": treated as far inland)
        if (LS) { const sd = LS.dist[(y - LS.r.y) * lsW + (x - LS.r.x)]; site.shore = sd > SHORE_REACH ? 99 : sd; } else site.shore = 99;
        biomeWeights(t, m, e, rg, bw, wet, site);
        // ground painted by hand over the climate's choice (groundPaint.ts)
        if (d.ground && d.groundW && d.groundW[gi]) { JD[0] = jw; JD[1] = dw; applyPaintedGround(d.ground[gi], d.groundW[gi] / 255, bw, JD); jw = JD[0]; dw = JD[1]; }
        bp.t = t; bp.m = m; bp.cn = n.canopy[gi] / 127; bp.cl = n.clump[gi] / 127; bp.hu = hu; bp.rk = n.rock[gi] / 127; bp.fine = n.fine[gi] / 127; bp.hills = n.hills[gi]; bp.e = e; bp.rg = rg; bp.x = x; bp.y = y;
        bcol[0] = R; bcol[1] = G; bcol[2] = B;
        const open = (1 - jw) * (1 - dw);
        paintBiomes(bcol, bw, bp, open, 1 - jw);
        R = bcol[0]; G = bcol[1]; B = bcol[2];
        const forest = bw.boreal + bw.temperate + bw.warm;
        // Biomes with a look of their own (hot and very wet = jungle, hot and dry = desert) instead of tinted grass.
        // Natural gradients stay below both thresholds; regions and equatorial climates reach them.
        if (jw > 0.004) {
          // dense canopy: bumpy lit crowns in groves with dark gaps, and over that stands of different age and kind
          // (dark blue-green old growth, lighter yellow-green regrowth, now and then an open clearing), a few hundred km down to tens
          const cn = n.canopy[gi] / 127, cl = n.clump[gi] / 127;
          const crown = smoothstep(-0.55, 0.65, cn * 0.7 + cl * 0.55);
          const gap = smoothstep(-0.2, -0.9, cn * 0.6 + cl * 0.4);
          const stand = hu * 0.9 + (n.rock[gi] / 127) * 0.55 + n.hills[gi] * 0.5;
          const young = smoothstep(0.06, 0.5, stand), old = smoothstep(-0.06, -0.5, stand), open = smoothstep(0.5, 0.72, stand + cn * 0.4);
          let jr = 28 + 36 * crown, jg = 66 + 52 * crown, jb = 36 + 16 * crown;
          jr = jr * (1 - 0.38 * old) + 30 * young; jg = jg * (1 - 0.34 * old) + 40 * young; jb = jb * (1 - 0.2 * old) + 2 * young;
          jr = jr * (1 - 0.55 * open) + 152 * 0.55 * open; jg = jg * (1 - 0.55 * open) + 174 * 0.55 * open; jb = jb * (1 - 0.55 * open) + 78 * 0.55 * open;
          jr *= 1 - 0.35 * gap; jg *= 1 - 0.3 * gap; jb *= 1 - 0.25 * gap;
          const a = jw * 0.94;
          R = R * (1 - a) + jr * a; G = G * (1 - a) + jg * a; B = B * (1 - a) + jb * a;
        }
        if (dw > 0.004) {
          // sand: pale, ochre and rust patches; dune fields with crests across the wind (gentle windward slope, steep dark lee); fine ripples
          const cl = n.clump[gi] / 127, rk = n.rock[gi] / 127, fn = n.fine[gi] / 127;
          const s1 = 0.5 + 0.5 * hu, s2 = 0.5 + 0.5 * rk;
          let sr = 234 - 40 * s1 - 14 * s2, sg = 204 - 58 * s1 - 18 * s2, sb = 148 - 64 * s1 - 16 * s2;
          const field = smoothstep(-0.5, 0.1, hu * 0.8 + cl * 0.5);
          const ph = (x * dux + y * duy) / duneLen + cl * 0.4 + rk * 0.2 + hu * 1.0;
          const fr = ph - Math.floor(ph);
          const dune = ((fr < 0.7 ? fr / 0.7 : (1 - fr) / 0.3) - 0.5) * field, lee = fr >= 0.7 ? field : 0;
          const lit = 1 + dune * 0.62 - lee * 0.22, rip = 1 + fn * 0.05;
          sr *= lit * rip; sg *= lit * rip * (1 + dune * 0.06); sb *= lit * rip * (1 - dune * 0.1);
          // scrub: sparse dark olive tufts on the flats between the dunes
          const tuft = smoothstep(0.5, 0.9, n.canopy[gi] / 127 + cl * 0.3) * (1 - field) * 0.45;
          sr = sr * (1 - tuft) + 98 * tuft; sg = sg * (1 - tuft) + 88 * tuft; sb = sb * (1 - tuft) + 54 * tuft;
          const a = dw * 0.95;
          R = R * (1 - a) + sr * a; G = G * (1 - a) + sg * a; B = B * (1 - a) + sb * a;
        }
        // rugged desert is stony, not sandy: bare gravel pavement over the dunes
        if (dw > 0.004 && bw.stony > 0.01) {
          const sa = dw * bw.stony * 0.75, sp = 1 + (n.fine[gi] / 127) * 0.1;
          R = R * (1 - sa) + 142 * sp * sa; G = G * (1 - sa) + 120 * sp * sa; B = B * (1 - sa) + 94 * sp * sa;
        }
        // rock on high / steep ground
        const cgx = coarse ? (coarse[xp] - coarse[xm]) * 0.5 * F : 0, cgy = coarse ? (coarse[yp] - coarse[ym]) * 0.5 * F : 0;
        const sx = ((hd[xp] - hd[xm]) * 0.5 + cgx) * SL, sy = ((hd[yp] - hd[ym]) * 0.5 + cgy) * SL;
        const slope = Math.hypot(sx, sy);
        // (sand buries most of it; the jungle canopy covers the rock of gentle low ground, but not steep faces or high ridges, so ranges keep their rock and snow)
        const canopyCover = 0.6 * Math.max(jw, 0.85 * forest * (1 - jw) * (1 - dw)) * (1 - smoothstep(0.2, 0.46, e));
        const rw = Math.min(1, smoothstep(0.14, 0.36, e) * 0.75 * (1 - canopyCover) + smoothstep(0.5, 1.8, slope) * 0.6) * rg * smoothstep(0.03, 0.12, e) * (1 - 0.88 * dw);
        const rn = n.rock[gi] / 127;
        R = R * (1 - rw) + (194 * (0.5 + 0.5 * rn) + 142 * (0.5 - 0.5 * rn)) * rw;
        G = G * (1 - rw) + (160 * (0.5 + 0.5 * rn) + 116 * (0.5 - 0.5 * rn)) * rw;
        B = B * (1 - rw) + (120 * (0.5 + 0.5 * rn) + 88 * (0.5 - 0.5 * rn)) * rw;
        // bare dark stone inside regions that have it (rocky outcroppings): charcoal rock with the same grain as the mountains
        const rk = d.rock ? d.rock[gi] / 255 : 0;
        if (rk > 0) {
          const g = rk * (0.86 + 0.14 * smoothstep(-0.9, 0.2, rn + (n.fine[gi] / 127) * 0.3));
          R = R * (1 - g) + (50 + 36 * (0.5 + 0.5 * rn)) * g;
          G = G * (1 - g) + (47 + 33 * (0.5 + 0.5 * rn)) * g;
          B = B * (1 - g) + (52 + 34 * (0.5 + 0.5 * rn)) * g;
        }
        // volcanic ground inside regions that have it: black ash plains, basalt, cinder brown (black sand on its coasts); fresh lava glows after the shading below
        const vk = d.volcanic ? d.volcanic[gi] / 255 : 0;
        if (vk > 0) {
          const ash = smoothstep(-0.4, 0.6, hu * 0.8 + (n.clump[gi] / 127) * 0.5), cin = smoothstep(0.35, 0.8, rn * 0.7 + (n.fine[gi] / 127) * 0.4), flow = smoothstep(0.2, 0.6, hu * 0.7 + rn * 0.5);
          // pale ash plains with cinder-brown patches; fresh lava fields are near-black basalt
          let vr = 52 + 58 * ash, vg = 50 + 56 * ash, vb = 54 + 56 * ash;
          vr += (104 - vr) * cin * 0.55; vg += (66 - vg) * cin * 0.55; vb += (50 - vb) * cin * 0.55;
          vr += (24 - vr) * flow * 0.85; vg += (22 - vg) * flow * 0.85; vb += (26 - vb) * flow * 0.85;
          const g = vk * 0.93;
          R = R * (1 - g) + vr * g; G = G * (1 - g) + vg * g; B = B * (1 - g) + vb * g;
        }
        // broken snow on high ridges
        const ridge = hd[i] - small[i];
        // (zoomed maps: put back the texture relief the snow test expects, so peaks keep their snow)
        let sw = smoothstep(0, 0.035, e + n.mtn[gi] * 0.13 * rg * (1 - tex) - sl + ridge * 7 + n.mtn[gi] * 0.07) * rg;
        sw *= 0.88 * smoothstep(0, 0.5, n.fine[gi] / 127 + 0.35);
        // ground snow inside frozen climate regions, broken by terrain texture
        const gs = d.snow ? d.snow[gi] / 255 : 0;
        if (gs > 0) sw = Math.max(sw, gs * smoothstep(0, 0.45, n.fine[gi] / 127 + ridge * 20 + 0.75));
        R = R * (1 - sw) + 236 * sw; G = G * (1 - sw) + 237 * sw; B = B * (1 - sw) + 240 * sw;
        // glacier: blue-white ice with crevasses over the highest, coldest ground
        if (bw.glacier * open > 0.01) {
          gcol[0] = R; gcol[1] = G; gcol[2] = B;
          paintGlacier(gcol, bw.glacier * open, bp);
          R = gcol[0]; G = gcol[1]; B = gcol[2];
        }
        // shading from local relief + valley occlusion
        let lgx = (local[xp] - local[xm]) * 0.5, lgy = (local[yp] - local[ym]) * 0.5;
        if (nearRiver && RR) {
          // the river has cut a valley: shade as if the ground dipped towards it (a V in steep country, a shallow dip on the flats)
          const il = x > RR.r.x ? ri - 1 : ri, ir = x < RR.r.x + rrW - 1 ? ri + 1 : ri, iu = y > RR.r.y ? ri - rrW : ri, id = y < RR.r.y + RR.r.h - 1 ? ri + rrW : ri;
          lgx -= (valleyDepth(RR.edge[ir], RR.size[ir], rg) - valleyDepth(RR.edge[il], RR.size[il], rg)) * 0.5;
          lgy -= (valleyDepth(RR.edge[id], RR.size[id], rg) - valleyDepth(RR.edge[iu], RR.size[iu], rg)) * 0.5;
        }
        const gx = (lgx + cgx) * Z, gy = (lgy + cgy) * Z;
        const nz = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const nx = -gx * nz, ny = -gy * nz;
        const shade = 0.7 * (nx * L1[0] + ny * L1[1] + nz * L1[2]) + 0.3 * (nx * L2[0] + ny * L2[1] + nz * L2[2]);
        let f = Math.min(1.38, Math.max(0.42, 1 + 1.25 * (shade - SHADE_REF)));
        f *= 1 - Math.min(0.35, Math.max(0, -ridge) * 9);
        if (nearRiver && RR) f *= 1 - 0.2 * valleyProfile(re, RR.size[ri]) * rg; // the floor of a mountain valley is dim
        R *= f; G *= f; B *= f;
        const ss = Math.min(1, Math.max(0, (1 - f) * 1.4)) * sw;
        R = R * (1 - ss) + 136 * ss; G = G * (1 - ss) + 146 * ss; B = B * (1 - ss) + 166 * ss;
        // lakes
        if (d.lakes[gi]) {
          const edge = (x > 0 && !d.lakes[gi - 1]) || (x < W - 1 && !d.lakes[gi + 1]) || (y > 0 && !d.lakes[gi - W]) || (y < H - 1 && !d.lakes[gi + W]);
          if (edge) { R = 74; G = 92; B = 118; } else { R = 110; G = 140; B = 176; }
        } else if (site.shore <= 1.5) {
          // the lake's shoreline on the land side: calm ground set apart from the ground and the water (shoreTone), as along the rivers
          shoreTone([R, G, B], { sw, dw, jw, rw }, scol);
          const k = site.shore <= 0.75 ? 0.6 : 0.35;
          R += (scol[0] * f - R) * k; G += (scol[1] * f - G) * k; B += (scol[2] * f - B) * k;
        }
        // the river itself (not over a lake): water and banks that take their light and colour from the ground
        if (nearRiver && RR && !d.lakes[gi]) {
          rp.re = re; rp.size = RR.size[ri]; rp.drop = RR.drop[ri]; rp.e = e; rp.t = t; rp.m = m;
          rp.jw = jw; rp.dw = dw; rp.veg = veg; rp.rw = rw; rp.sw = sw; rp.f = f;
          rp.fine = n.fine[gi] / 127; rp.crown = (n.canopy[gi] / 127) * 0.8 + (n.clump[gi] / 127) * 0.4; rp.ld = d.landDist[gi]; rp.along = RR.along[ri]; rp.painted = d.ground && d.groundW && d.ground[gi] ? d.groundW[gi] / 255 : 0; rp.stone = Math.max(rk, d.volcanic ? d.volcanic[gi] / 255 : 0);
          rcol[0] = R; rcol[1] = G; rcol[2] = B;
          paintRiverPixel(rcol, rp);
          R = rcol[0]; G = rcol[1]; B = rcol[2];
        }
        // lava flows: fresh ones glow (a scorched, reddish edge, a dark crust broken over an orange body, a bright core), old ones are black basalt with ropy
        // streaks and a few dull red cracks. They are self-lit, so the shading doesn't dim the fresh ones, and they bury any river they run into.
        if (LV) {
          const li = (y - LV.r.y) * lvW + (x - LV.r.x), le = LV.edge[li];
          if (le < LAVA_REACH) {
            const hot = LV.heat[li], hwid = Math.max(0.5, LV.hw[li]);
            const lcl = n.clump[gi] / 127, lfn = n.fine[gi] / 127;
            const cover = 1 - smoothstep(-0.25, 0.55, le);
            const mid = Math.min(1, Math.max(0, -le / hwid)); // 0 at the edge .. 1 along the middle
            const outside = (1 - smoothstep(0, LAVA_REACH, Math.max(0, le))) * (1 - cover);
            if (hot > 0.5) {
              R = R * (1 - outside * 0.5) + 150 * outside * 0.5; G = G * (1 - outside * 0.5) + 52 * outside * 0.5; B = B * (1 - outside * 0.5) + 26 * outside * 0.5;
              const crust = smoothstep(0.05, 0.55, lfn * 0.6 + lcl * 0.6 + 0.3 - mid * 0.35), core = smoothstep(0.6, 1.0, mid + lcl * 0.25 - lfn * 0.15), rim = 1 - smoothstep(0, 0.35, mid);
              let lr = 236, lg = 98, lb = 28;
              lr += (96 - lr) * rim * 0.8; lg += (30 - lg) * rim * 0.8; lb += (22 - lb) * rim * 0.8;
              const ck = crust * 0.8 * (1 - core * 0.7);
              lr += (62 - lr) * ck; lg += (22 - lg) * ck; lb += (20 - lb) * ck;
              lr += (255 - lr) * core * 0.9; lg += (206 - lg) * core * 0.9; lb += (88 - lb) * core * 0.9;
              R = R * (1 - cover) + lr * cover; G = G * (1 - cover) + lg * cover; B = B * (1 - cover) + lb * cover;
            } else {
              R = R * (1 - outside * 0.4) + 34 * outside * 0.4; G = G * (1 - outside * 0.4) + 32 * outside * 0.4; B = B * (1 - outside * 0.4) + 36 * outside * 0.4;
              const streak = 0.5 + 0.5 * Math.sin(LV.along[li] * 1.6 + lcl * 3), crack = (1 - smoothstep(0, 0.09, Math.abs(lcl * 0.7 + lfn * 0.5))) * mid;
              let lr = 30 + 20 * streak, lg = 28 + 18 * streak, lb = 33 + 17 * streak;
              lr += (110 - lr) * crack * 0.3; lg += (38 - lg) * crack * 0.3; lb += (22 - lb) * crack * 0.3;
              const sh = 0.75 + 0.25 * f;
              R = R * (1 - cover) + lr * sh * cover; G = G * (1 - cover) + lg * sh * cover; B = B * (1 - cover) + lb * sh * cover;
            }
          }
        }
        // thin dark coast edge (landDist 0 means "was sea when derived" - skip while stale)
        const ld = d.landDist[gi];
        if (ld === 1) { R *= 0.78; G *= 0.78; B *= 0.78; }
      } else {
        const sd = d.seaDist[gi];
        const shelf = Math.exp(-(sd + (n.shelfWarp[gi] / 127) * 6 * k) / (26 * k));
        const sh = Math.min(1, Math.max(0, shelf));
        R = deep[0] * (1 - sh) + mid[0] * sh; G = deep[1] * (1 - sh) + mid[1] * sh; B = deep[2] * (1 - sh) + mid[2] * sh;
        const rim = Math.exp(-sd / Math.max(1, 5 * k)) * 0.5;
        R = R * (1 - rim) + shallow[0] * rim; G = G * (1 - rim) + shallow[1] * rim; B = B * (1 - rim) + shallow[2] * rim;
        const v = 1 + (n.oceanLarge[gi] / 127) * 0.05 + (n.oceanSmall[gi] / 127) * 0.015;
        R *= v; G *= v; B *= v;
      }
      const g = 1 + (hash(x, y) - 0.5) * 0.036;
      out[o] = R * g; out[o + 1] = G * g; out[o + 2] = B * g; out[o + 3] = 255;
    }
  }
}

/** Anti-aliased river lines onto a (possibly cropped and scaled) raster image. */
export function drawRivers(img: RGBAImage, region: Rect, scale: number, rivers: RiverPath[], rgb = [70, 88, 116], alpha = 0.9) {
  const cov = new Float32Array(img.w * img.h);
  for (const rv of rivers) {
    const p = rv.pts;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const ax = (p[s] - region.x) * scale, ay = (p[s + 1] - region.y) * scale;
      const bx = (p[s + 2] - region.x) * scale, by = (p[s + 3] - region.y) * scale;
      const w = Math.max(0.7, rv.widths[s / 2] * scale);
      const hw = w / 2;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1)), x1 = Math.min(img.w - 1, Math.ceil(Math.max(ax, bx) + hw + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1)), y1 = Math.min(img.h - 1, Math.ceil(Math.max(ay, by) + hw + 1));
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-6;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          let t = ((px - ax) * dx + (py - ay) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
          const cv = Math.min(1, Math.max(0, hw + 0.5 - d)) * Math.min(1, w);
          const i = y * img.w + x;
          if (cv > cov[i]) cov[i] = cv;
        }
      }
    }
  }
  for (let i = 0; i < cov.length; i++) {
    const a = cov[i] * alpha;
    if (a <= 0) continue;
    const o = i * 4;
    img.data[o] = img.data[o] * (1 - a) + rgb[0] * a;
    img.data[o + 1] = img.data[o + 1] * (1 - a) + rgb[1] * a;
    img.data[o + 2] = img.data[o + 2] * (1 - a) + rgb[2] * a;
  }
}
