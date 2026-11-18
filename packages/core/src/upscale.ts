/**
 * Double a heightmap's resolution with new detail: smooth bicubic upsampling, fractal
 * wiggle on low coasts (cliffs stay crisp), ridged detail on high ground, then erosion so
 * the new detail drains like real terrain. Shapes stay the same; edges get sharper.
 */
import { distanceTo } from "./fields.ts";
import { erodeTerrain } from "./hydrology.ts";
import { Simplex2D, subSeed } from "./noise.ts";

export interface UpscaleOptions {
  /** Whole-number factor (default 2). */
  factor?: number;
  seed?: number;
  /** Peak coastline wiggle in metres of height noise near the shore (default 45). */
  coastDetailM?: number;
  /** Erosion passes after adding detail (default 3; 0 to skip). */
  erosionPasses?: number;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Catmull-Rom weights for offset t in [0,1) over taps -1..2. */
function cubicWeights(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
}

/** Bicubic (Catmull-Rom) resample by a whole factor, pixel centres aligned, edges clamped. */
export function bicubicUpsample(src: Float32Array, W: number, H: number, f: number): Float32Array {
  const W2 = W * f, H2 = H * f;
  const taps = (n: number, size: number) => {
    const s = (n + 0.5) / f - 0.5, i0 = Math.floor(s);
    const w = cubicWeights(s - i0);
    const idx = [i0 - 1, i0, i0 + 1, i0 + 2].map((i) => Math.min(size - 1, Math.max(0, i)));
    return { idx, w };
  };
  const tmp = new Float32Array(W2 * H);
  const cols = Array.from({ length: W2 }, (_, x) => taps(x, W));
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W2; x++) {
      const { idx, w } = cols[x];
      tmp[y * W2 + x] = src[row + idx[0]] * w[0] + src[row + idx[1]] * w[1] + src[row + idx[2]] * w[2] + src[row + idx[3]] * w[3];
    }
  }
  const out = new Float32Array(W2 * H2);
  for (let y = 0; y < H2; y++) {
    const { idx, w } = taps(y, H);
    const r0 = idx[0] * W2, r1 = idx[1] * W2, r2 = idx[2] * W2, r3 = idx[3] * W2;
    for (let x = 0; x < W2; x++) out[y * W2 + x] = tmp[r0 + x] * w[0] + tmp[r1 + x] * w[1] + tmp[r2 + x] * w[2] + tmp[r3 + x] * w[3];
  }
  return out;
}

/** 4-connected components of a mask: label per cell (0 = not in mask) and size per label. */
function components(mask: Uint8Array, W: number, H: number) {
  const label = new Int32Array(W * H);
  const sizes: number[] = [0];
  const stack = new Int32Array(W * H);
  let next = 1;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    let top = 0, size = 0;
    stack[top++] = s;
    label[s] = next;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < W - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && mask[i - W] && !label[i - W]) { label[i - W] = next; stack[top++] = i - W; }
      if (y < H - 1 && mask[i + W] && !label[i + W]) { label[i + W] = next; stack[top++] = i + W; }
    }
    sizes.push(size);
    next++;
  }
  return { label, sizes };
}

/**
 * Remove specks the detail created: tiny new islets (no overlap with the original land)
 * and tiny new sea pockets inland (no overlap with the original sea).
 */
function removeNewSpecks(h: Float32Array, W: number, H: number, sea: number, land0: Uint8Array, maxSize: number) {
  for (const wantLand of [true, false]) {
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = (h[i] > sea) === wantLand ? 1 : 0;
    const { label, sizes } = components(m, W, H);
    const touchesOriginal = new Uint8Array(sizes.length);
    for (let i = 0; i < m.length; i++) if (label[i] && land0[i] === (wantLand ? 1 : 0)) touchesOriginal[label[i]] = 1;
    for (let i = 0; i < m.length; i++) {
      const l = label[i];
      if (l && sizes[l] <= maxSize && !touchesOriginal[l]) h[i] = wantLand ? Math.min(h[i], sea - 3) : Math.max(h[i], sea + 3);
    }
  }
}

export function upscaleHeights(src: Float32Array, W: number, H: number, seaLevel: number, o: UpscaleOptions = {}) {
  const f = Math.max(1, Math.round(o.factor ?? 2));
  const W2 = W * f, H2 = H * f, N = W2 * H2;
  const seed = o.seed ?? 1;
  const out = bicubicUpsample(src, W, H, f);
  const k = W2 / 2048; // feature sizes are tuned for a 2048-px-wide map

  const land0 = new Uint8Array(N), sea0 = new Uint8Array(N);
  for (let i = 0; i < N; i++) { land0[i] = out[i] > seaLevel ? 1 : 0; sea0[i] = 1 - land0[i]; }
  const toLand = distanceTo(land0, W2, H2); // for sea cells: px to the nearest land
  const toSea = distanceTo(sea0, W2, H2); // for land cells: px to the nearest sea

  const coastN = new Simplex2D(subSeed(seed, 501)), ridN = new Simplex2D(subSeed(seed, 502)), hillN = new Simplex2D(subSeed(seed, 503));
  const coastAmp = o.coastDetailM ?? 45;
  const band = Math.max(3, 4 * k); // px either side of the coast that may move
  const S = (n: number) => Math.max(3, n * k); // noise feature size, never below a few px

  // coast wiggle: noise in a band either side of the shore
  const bandIdx: number[] = [], bandW: number[] = [], bandN: number[] = [];
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      const i = y * W2 + x;
      const dc = out[i] > seaLevel ? toSea[i] : toLand[i];
      const w = smooth(band, 0, dc);
      if (w <= 0) continue;
      bandIdx.push(i); bandW.push(w); bandN.push(coastAmp * coastN.fbm(x, y, S(10), 3));
    }
  }
  // gentle land-side slopes let noise push shores inland more often than out; find the offset
  // that keeps the band's land area unchanged (bisection on a monotonic count)
  let landBefore = 0;
  for (const i of bandIdx) if (out[i] > seaLevel) landBefore++;
  const landWith = (c: number) => {
    let n = 0;
    for (let j = 0; j < bandIdx.length; j++) if (out[bandIdx[j]] + bandW[j] * (bandN[j] + c) > seaLevel) n++;
    return n;
  };
  let lo = -coastAmp, hi = coastAmp;
  for (let it = 0; it < 16; it++) {
    const mid = (lo + hi) / 2;
    if (landWith(mid) < landBefore) lo = mid; else hi = mid;
  }
  const offset = (lo + hi) / 2;
  for (let j = 0; j < bandIdx.length; j++) out[bandIdx[j]] += bandW[j] * (bandN[j] + offset);

  // relief detail: ridged on high ground, gentle on lowlands
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      const i = y * W2 + x;
      const e = out[i] - seaLevel;
      if (e <= 0) continue;
      const rug = smooth(150, 1500, e);
      // keep the lowland ripple from dipping a coastal cell under the sea
      const lowland = Math.min(8, Math.max(0, e - 1)) * hillN.fbm(x, y, S(6), 3);
      out[i] += rug * Math.min(260, 0.07 * e) * (ridN.ridged(x, y, S(14), 4) - 0.5) * 2 + (1 - rug) * lowland;
    }
  }
  removeNewSpecks(out, W2, H2, seaLevel, land0, Math.max(6, Math.round(40 * k * k)));
  const passes = o.erosionPasses ?? 3;
  if (passes > 0) erodeTerrain(out, W2, H2, seaLevel, { passes, strength: 0.35 });
  return { data: out, W: W2, H: H2 };
}
