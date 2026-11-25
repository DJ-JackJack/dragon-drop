/**
 * How close a settlement is to the picture it is redrawn from (its trace picture): a yardstick, so a redraw is judged by measuring and not by eye.
 * What each thing looks like in this picture is learnt from where the map has it: the picture's colours under the map's buildings (grouped into a few
 * roof colours), under its streets, under open ground of each kind, under its water and its trees. Every pixel of the picture is then classed by the
 * nearest of those colours (the drawing's dark ink left out), and the picture's roofs, streets and water are compared with the map's in squares of the
 * map (250 m unless asked): how much of the picture's roof area the buildings cover, how much of the buildings lies on a roof, how many separate roofs
 * against how many buildings, the same for streets and water; the streets' widths against the picture's; the tree groups that stand on roofs.
 * `compareHeatMap` draws a measure square by square over the picture. Pure: the hub runs it on the compute thread.
 */
import type { MapDoc } from "./doc.ts";
import { MATERIALS } from "./battle.ts";
import { citySpec } from "./city.ts";
import { cityClimate, treeCrowns } from "./cityLand.ts";
import { rgbToLab } from "./cityReader.ts";
import { tracePoint, traceToPicture } from "./trace.ts";

type Pt = [number, number];
type RGB = [number, number, number];
type Img = { w: number; h: number; data: Uint8Array | Uint8ClampedArray };

export interface CompareOptions {
  /** Only this part of the map, a polygon in metres (default: all of the map the picture covers). */
  area?: Pt[];
  /** The squares the comparison is told in, metres (default 250). */
  square?: number;
}
/** Picture pixels (at the comparison's own resolution) of a thing in the picture, on the map, and in both. */
export interface CompareCounts { picture: number; map: number; both: number }
export interface CompareSquare {
  /** Its corner and size, metres, and how many samples of it were measured (in the picture and the area asked for). */
  x: number; y: number; size: number; samples: number;
  roofs: CompareCounts;
  streets: CompareCounts;
  water: CompareCounts;
  /** Separate roofs in the picture (touching ones parted by one erosion, at least 20 m²) and buildings on the map (by their middle). */
  roofCount: { picture: number; map: number };
}
export interface CompareClass { name: string; kind: "roof" | "street" | "ground" | "water" | "trees"; rgb: RGB; learntFrom: number }
export interface CompareResult {
  /** What each thing was found to look like in the picture, and how many places (buildings, or pixels) it was learnt from. */
  classes: CompareClass[];
  /** Metres a sample: the picture is looked at in steps of this size. */
  metresPerSample: number;
  totals: {
    roofs: CompareCounts; streets: CompareCounts; water: CompareCounts; roofCount: { picture: number; map: number };
    /** The map's street width against the picture's (median and quartiles of the ratio, sampled every 20 m along the map's streets). */
    streetWidth: { samples: number; median: number; p25: number; p75: number } | null;
    /** Tree groups (of about 100 m² or more) standing mostly on what the picture shows as roofs. */
    treesOnRoofs: { groups: number; onRoofs: number; ids: string[] };
  };
  squares: CompareSquare[];
}

const counts = (): CompareCounts => ({ picture: 0, map: 0, both: 0 });
const WATER = new Set([7, 8]);
const INK_L = 22;

/** The affine map from a picture pixel (u, v) to metres, and back to the comparison's sample grid. */
function grid(doc: MapDoc, img: Img) {
  const t = doc.features?.trace;
  if (!t) throw new Error("There is no trace picture over this map to compare with: lay one over it first (References: Trace over map).");
  const s = Math.max(1, Math.ceil(Math.sqrt((img.w * img.h) / 2.5e6))), W = Math.floor(img.w / s), H = Math.floor(img.h / s);
  const o = tracePoint(t, 0, 0), ex = tracePoint(t, 1, 0), ey = tracePoint(t, 0, 1);
  const du = [ex[0] - o[0], ex[1] - o[1]], dv = [ey[0] - o[0], ey[1] - o[1]];
  /** Metres at the middle of sample (i, j). */
  const metres = (i: number, j: number): Pt => { const u = (i + 0.5) * s, v = (j + 0.5) * s; return [o[0] + du[0] * u + dv[0] * v, o[1] + du[1] * u + dv[1] * v]; };
  /** A point in metres in sample coordinates (a sample's middle is at i + 0.5). */
  const sample = (x: number, y: number): Pt => { const [u, v] = traceToPicture(t, x, y); return [u / s, v / s]; };
  return { t, s, W, H, metres, sample, mps: t.scale * s };
}

/** Fill a polygon (sample coordinates) into a mask: every sample whose middle is inside gets `value`. */
function fill(mask: Uint8Array | Int32Array, W: number, H: number, pts: Pt[], value: number) {
  let y0 = H, y1 = 0;
  for (const [, y] of pts) { y0 = Math.min(y0, Math.floor(y)); y1 = Math.max(y1, Math.ceil(y)); }
  const xs: number[] = [];
  for (let j = Math.max(0, y0); j <= Math.min(H - 1, y1); j++) {
    const Y = j + 0.5;
    xs.length = 0;
    for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const [xa, ya] = pts[a], [xb, yb] = pts[b]; if ((ya > Y) !== (yb > Y)) xs.push(xa + ((Y - ya) * (xb - xa)) / (yb - ya)); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil(xs[k] - 0.5)); i <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); i++) mask[j * W + i] = value;
  }
}

/** A disc or a thick line (sample coordinates) into a mask. */
function stroke(mask: Uint8Array, W: number, H: number, a: Pt, b: Pt, r: number, value = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
  for (let j = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)); j <= Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + r)); j++) {
    for (let i = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)); i <= Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + r)); i++) {
      const px = i + 0.5, py = j + 0.5, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
      if (Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy) <= r) mask[j * W + i] = value;
    }
  }
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
const medianLab = (labs: number[][]) => [0, 1, 2].map((k) => median(labs.map((l) => l[k])));
const dist = (a: readonly number[], b: readonly number[]) => 0.5 * (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Lab back to sRGB (for telling a class's colour). */
function labToRgb([L, a, b]: readonly number[]): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * inv(fx), Y = inv(fy), Z = 1.08883 * inv(fz);
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  return lin.map((v) => Math.round(255 * Math.max(0, Math.min(1, v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v)))) as RGB;
}

/** A few colours that stand for many (k-means, started from points far apart). */
function kMeans(points: number[][], k: number): { centres: number[][]; of: number[] } {
  const centres: number[][] = [points[0]];
  while (centres.length < k) {
    let best = 0, far = -1;
    points.forEach((p, i) => { const d = Math.min(...centres.map((c) => dist(p, c))); if (d > far) { far = d; best = i; } });
    centres.push(points[best]);
  }
  const of = new Array(points.length).fill(0);
  for (let it = 0; it < 12; it++) {
    points.forEach((p, i) => { let b = 0, bd = Infinity; centres.forEach((c, n) => { const d = dist(p, c); if (d < bd) { bd = d; b = n; } }); of[i] = b; });
    for (let n = 0; n < k; n++) { const mine = points.filter((_, i) => of[i] === n); if (mine.length) centres[n] = medianLab(mine); }
  }
  return { centres, of };
}

/** Compare a settlement with its trace picture (see the file's comment). */
export function compareToTrace(doc: MapDoc, img: Img, o: CompareOptions = {}): CompareResult {
  const spec = citySpec(doc), f = doc.features!, g = grid(doc, img), { W, H, s, mps } = g, N = W * H, cellM = spec.cellM, hf = doc.height;
  const square = Math.max(20, o.square ?? 250), nx = Math.ceil(spec.widthM / square), ny = Math.ceil(spec.heightM / square);
  // which samples count: on the map, and in the area asked for
  const valid = new Uint8Array(N), sq = new Int32Array(N).fill(-1), material = new Uint8Array(N);
  const inArea = new Uint8Array(N).fill(o.area?.length ? 0 : 1);
  if (o.area?.length) fill(inArea, W, H, o.area.map(([x, y]) => g.sample(x, y)), 1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, [x, y] = g.metres(i, j);
    if (x < 0 || y < 0 || x >= spec.widthM || y >= spec.heightM || !inArea[k]) continue;
    valid[k] = 1;
    sq[k] = Math.floor(y / square) * nx + Math.floor(x / square);
    material[k] = Math.round(hf.data[Math.min(hf.h - 1, Math.floor(y / cellM)) * hf.w + Math.min(hf.w - 1, Math.floor(x / cellM))]);
  }
  // the map's things on the samples
  const buildings = f.buildings ?? [], bIdx = new Int32Array(N);
  buildings.forEach((b, n) => fill(bIdx, W, H, b.points.map(([x, y]) => g.sample(x, y)), n + 1));
  const streetM = new Uint8Array(N);
  for (const st of f.streets ?? []) {
    const p = st.points.map(([x, y]) => g.sample(x, y)), r = st.width / 2 / mps;
    for (let k = 0; k + 1 < p.length; k++) stroke(streetM, W, H, p[k], p[k + 1], r);
  }
  const treeM = new Int32Array(N), climate = cityClimate(spec), trees = f.trees ?? [];
  trees.forEach((tg, n) => { for (const c of treeCrowns(tg, climate)) fillDisc(treeM, W, H, g.sample(c.x, c.y), c.r / mps, n + 1); });
  // the picture's colour at each sample (the average of a few pixels round it), as a 32-step colour cube index
  const cube = new Uint16Array(N), lut = new Float32Array(32768 * 3);
  for (let r = 0; r < 32; r++) for (let gg = 0; gg < 32; gg++) for (let b = 0; b < 32; b++) { const l = rgbToLab([r * 8 + 4, gg * 8 + 4, b * 8 + 4]); lut.set(l, ((r << 10) | (gg << 5) | b) * 3); }
  const st = s >= 3 ? Math.floor(s / 3) : 1, r0 = s === 1 ? -1 : 0, r1 = s === 1 ? 1 : s - 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!valid[k]) continue;
    let R = 0, G = 0, B = 0, n = 0;
    for (let dy = r0; dy <= r1; dy += st) for (let dx = r0; dx <= r1; dx += st) {
      const x = Math.min(img.w - 1, Math.max(0, i * s + dx)), y = Math.min(img.h - 1, Math.max(0, j * s + dy)), p = (y * img.w + x) * 4;
      R += img.data[p]; G += img.data[p + 1]; B += img.data[p + 2]; n++;
    }
    cube[k] = (((R / n) >> 3) << 10) | (((G / n) >> 3) << 5) | ((B / n) >> 3);
  }
  const lab = (k: number) => { const c = cube[k] * 3; return [lut[c], lut[c + 1], lut[c + 2]]; };
  // what each thing looks like here: learnt from where the map has it
  const classes: CompareClass[] = [], labs: number[][] = [];
  const perBuilding = new Map<number, number[][]>();
  for (let k = 0; k < N; k++) {
    if (!valid[k] || !bIdx[k]) continue;
    const l = lab(k);
    if (l[0] < INK_L) continue;
    const list = perBuilding.get(bIdx[k]) ?? [];
    if (list.length < 400) list.push(l);
    perBuilding.set(bIdx[k], list);
  }
  const roofPts: number[][] = [], roofLooks: string[] = [];
  for (const [n, list] of perBuilding) if (list.length >= 4) { roofPts.push(medianLab(list)); roofLooks.push(buildings[n - 1].roof ?? "slate"); }
  if (roofPts.length) {
    const k = Math.max(1, Math.min(6, Math.round(Math.sqrt(roofPts.length / 8))));
    const km = kMeans(roofPts, Math.min(k, roofPts.length));
    km.centres.forEach((c, n) => {
      const mine = roofLooks.filter((_, i) => km.of[i] === n);
      if (!mine.length) return;
      const look = [...mine.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0][0];
      classes.push({ name: `roof (${look})`, kind: "roof", rgb: labToRgb(c), learntFrom: mine.length });
      labs.push(c);
    });
  }
  const learn = (name: string, kind: CompareClass["kind"], pick: (k: number) => boolean) => {
    const got: number[][] = [];
    let seen = 0;
    for (let k = 0; k < N; k++) {
      if (!valid[k] || !pick(k)) continue;
      const l = lab(k);
      if (l[0] < INK_L) continue;
      seen++;
      if (got.length < 30000 || seen % 7 === 0) got.push(l);
    }
    if (got.length < 30) return;
    const c = medianLab(got);
    classes.push({ name, kind, rgb: labToRgb(c), learntFrom: seen });
    labs.push(c);
  };
  learn("street", "street", (k) => !!streetM[k] && !bIdx[k] && !treeM[k]);
  learn("trees", "trees", (k) => !!treeM[k] && !bIdx[k] && !streetM[k]);
  const kinds = [...new Set(Array.from(material).filter((m, k) => valid[k] && m > 0))];
  for (const m of kinds) {
    const name = MATERIALS[m]?.name ?? `ground ${m}`;
    learn(WATER.has(m) ? `water (${name})` : `ground (${name})`, WATER.has(m) ? "water" : "ground", (k) => material[k] === m && !bIdx[k] && !streetM[k] && !treeM[k]);
  }
  // every sample classed by the nearest of those colours (worked out once per colour in the cube), except that a close call goes to what the map has
  // there: a colour nearly as close (within 30%) to the map's own thing as to the nearest class is the map's thing (the edge of a picture's sea can be
  // nearly a roof's colour; this keeps such samples from counting as roofs the map lacks, while a clear difference still counts)
  const nc = labs.length, cls = new Int8Array(32768).fill(-1), dists = new Float32Array(32768 * Math.max(1, nc));
  for (let e = 0; e < 32768; e++) {
    const l = [lut[e * 3], lut[e * 3 + 1], lut[e * 3 + 2]];
    if (l[0] < INK_L || !nc) continue;
    let b = 0, bd = Infinity;
    labs.forEach((c, n) => { const d = dist(l, c); dists[e * nc + n] = d; if (d < bd) { bd = d; b = n; } });
    cls[e] = b;
  }
  const ofKind = (kind: CompareClass["kind"], name?: string) => classes.map((c, n) => (c.kind === kind && (!name || c.name === name) ? n : -1)).filter((n) => n >= 0);
  const roofCls = ofKind("roof"), streetCls = ofKind("street"), treeCls = ofKind("trees"), groundCls = new Map<number, number[]>();
  for (const m of kinds) groundCls.set(m, ofKind(WATER.has(m) ? "water" : "ground", WATER.has(m) ? `water (${MATERIALS[m]?.name})` : `ground (${MATERIALS[m]?.name})`));
  const sampleCls = new Int8Array(N).fill(-1);
  for (let k = 0; k < N; k++) {
    if (!valid[k]) continue;
    const e = cube[k], best = cls[e];
    if (best < 0) continue;
    const mine = bIdx[k] ? roofCls : streetM[k] ? streetCls : treeM[k] ? treeCls : groundCls.get(material[k]) ?? [];
    let pick = best;
    if (mine.length && !mine.includes(best)) {
      let m = -1, md = Infinity;
      for (const n of mine) { const d = dists[e * nc + n]; if (d < md) { md = d; m = n; } }
      if (m >= 0 && md <= 1.3 * dists[e * nc + best]) pick = m;
    }
    sampleCls[k] = pick;
  }
  const kindOf = (k: number) => { const c = sampleCls[k]; return c < 0 ? null : classes[c].kind; };
  // the squares
  const squares: (CompareSquare | null)[] = new Array(nx * ny).fill(null);
  const at = (n: number) => (squares[n] ??= { x: (n % nx) * square, y: Math.floor(n / nx) * square, size: square, samples: 0, roofs: counts(), streets: counts(), water: counts(), roofCount: { picture: 0, map: 0 } });
  const picRoof = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (!valid[k]) continue;
    const q = at(sq[k]), kind = kindOf(k);
    q.samples++;
    const pr = kind === "roof", mr = bIdx[k] > 0, ps = kind === "street", ms = !!streetM[k], pw = kind === "water", mw = WATER.has(material[k]);
    if (pr) { picRoof[k] = 1; q.roofs.picture++; }
    if (mr) q.roofs.map++;
    if (pr && mr) q.roofs.both++;
    if (ps) q.streets.picture++;
    if (ms) q.streets.map++;
    if (ps && ms) q.streets.both++;
    if (pw) q.water.picture++;
    if (mw) q.water.map++;
    if (pw && mw) q.water.both++;
  }
  // separate roofs in the picture, counted pixel by pixel (at the samples' size, houses a couple of metres apart would run together): one-pixel gaps
  // closed first (a roof's ridge and tile lines are darker than it and would split it), then one erosion parts touching roofs; at least 20 m²
  {
    const PW = img.w, PH = img.h, PN = PW * PH, t = g.t, pmps = t.scale;
    const roof = new Uint8Array(PN);
    for (let v = 0; v < PH; v++) for (let u = 0; u < PW; u++) {
      const i = Math.min(W - 1, Math.floor(u / s)), j = Math.min(H - 1, Math.floor(v / s)), k = j * W + i;
      if (!valid[k]) continue;
      const p = (v * PW + u) * 4, c = cls[((img.data[p] >> 3) << 10) | ((img.data[p + 1] >> 3) << 5) | (img.data[p + 2] >> 3)];
      // (a roof pixel in a sample the close-call rule gave to something else, the edge of a sea say, isn't one)
      if (c >= 0 && classes[c].kind === "roof" && kindOf(k) === "roof") roof[v * PW + u] = 1;
    }
    const grown = new Uint8Array(PN);
    for (let v = 1; v < PH - 1; v++) for (let u = 1; u < PW - 1; u++) { const k = v * PW + u; if (roof[k] || roof[k - 1] || roof[k + 1] || roof[k - PW] || roof[k + PW]) grown[k] = 1; }
    const closed = roof; // (reused: the roof mask isn't needed any more)
    closed.fill(0);
    for (let v = 1; v < PH - 1; v++) for (let u = 1; u < PW - 1; u++) { const k = v * PW + u; if (grown[k] && grown[k - 1] && grown[k + 1] && grown[k - PW] && grown[k + PW]) closed[k] = 1; }
    const er = grown; // (reused)
    er.fill(0);
    for (let v = 1; v < PH - 1; v++) for (let u = 1; u < PW - 1; u++) { const k = v * PW + u; if (closed[k] && closed[k - 1] && closed[k + 1] && closed[k - PW] && closed[k + PW]) er[k] = 1; }
    const stack: number[] = [], min = Math.max(4, 20 / (pmps * pmps));
    for (let k0 = 0; k0 < PN; k0++) {
      if (er[k0] !== 1) continue;
      let n = 0, su = 0, sv = 0;
      stack.push(k0); er[k0] = 2;
      while (stack.length) {
        const k = stack.pop()!; n++; su += k % PW; sv += (k / PW) | 0;
        for (const q of [k - 1, k + 1, k - PW, k + PW]) if (q >= 0 && q < PN && er[q] === 1) { er[q] = 2; stack.push(q); }
      }
      if (n < min) continue;
      const i = Math.min(W - 1, Math.floor(su / n / s)), j = Math.min(H - 1, Math.floor(sv / n / s)), c = j * W + i;
      if (sq[c] >= 0) at(sq[c]).roofCount.picture++;
    }
  }
  for (const b of buildings) {
    const cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length, cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length, [i, j] = g.sample(cx, cy);
    const k = Math.floor(j) * W + Math.floor(i);
    if (i >= 0 && j >= 0 && i < W && j < H && valid[k]) at(sq[k]).roofCount.map++;
  }
  // street widths: along the map's streets every 20 m, the picture's street across the line, against the street's own width
  const ratios: number[] = [];
  const isPicStreet = (i: number, j: number) => { const ii = Math.round(i - 0.5), jj = Math.round(j - 0.5); if (ii < 0 || jj < 0 || ii >= W || jj >= H) return false; const k = jj * W + ii; return valid[k] === 1 && kindOf(k) === "street"; };
  for (const stt of f.streets ?? []) {
    const p = stt.points.map(([x, y]) => g.sample(x, y));
    for (let k = 0; k + 1 < p.length; k++) {
      const [ax, ay] = p[k], [bx, by] = p[k + 1], L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-6) continue;
      const tx = (bx - ax) / L, ty = (by - ay) / L, nxv = -ty, nyv = tx, step = 20 / mps, reach = Math.ceil(60 / mps);
      for (let d = step / 2; d < L; d += step) {
        const x = ax + tx * d, y = ay + ty * d;
        let c0 = NaN;
        for (let q = 0; q <= 3; q++) { if (isPicStreet(x + nxv * q, y + nyv * q)) { c0 = q; break; } if (isPicStreet(x - nxv * q, y - nyv * q)) { c0 = -q; break; } }
        if (Number.isNaN(c0)) continue;
        let a = c0, b = c0;
        while (a > c0 - reach && isPicStreet(x + nxv * (a - 1), y + nyv * (a - 1))) a--;
        while (b < c0 + reach && isPicStreet(x + nxv * (b + 1), y + nyv * (b + 1))) b++;
        ratios.push(stt.width / Math.max(mps, (b - a + 1) * mps));
      }
    }
  }
  ratios.sort((a, b) => a - b);
  const q = (p: number) => Math.round(ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * p))] * 100) / 100;
  // tree groups standing on roofs
  const treeArea = new Int32Array(trees.length + 1), treeOnRoof = new Int32Array(trees.length + 1);
  for (let k = 0; k < N; k++) if (valid[k] && treeM[k]) { treeArea[treeM[k]]++; if (picRoof[k]) treeOnRoof[treeM[k]]++; }
  // (only groups big enough to tell, about 100 m² or more: a single garden tree beside a house is mostly roof at this scale)
  const bigEnough = Math.max(4, 100 / (mps * mps));
  const onRoofIds = trees.filter((_, n) => treeArea[n + 1] >= bigEnough && treeOnRoof[n + 1] / treeArea[n + 1] > 0.5).map((tg) => tg.id);
  const list = squares.filter((x): x is CompareSquare => !!x);
  const sum = (pick: (q: CompareSquare) => CompareCounts) => list.reduce((a, x) => { const c = pick(x); return { picture: a.picture + c.picture, map: a.map + c.map, both: a.both + c.both }; }, counts());
  return {
    classes,
    metresPerSample: Math.round(mps * 100) / 100,
    totals: {
      roofs: sum((x) => x.roofs), streets: sum((x) => x.streets), water: sum((x) => x.water),
      roofCount: list.reduce((a, x) => ({ picture: a.picture + x.roofCount.picture, map: a.map + x.roofCount.map }), { picture: 0, map: 0 }),
      streetWidth: ratios.length ? { samples: ratios.length, median: q(0.5), p25: q(0.25), p75: q(0.75) } : null,
      treesOnRoofs: { groups: trees.filter((_, n) => treeArea[n + 1] >= bigEnough).length, onRoofs: onRoofIds.length, ids: onRoofIds },
    },
    squares: list,
  };
}

/** A filled disc (sample coordinates) into an index mask. */
function fillDisc(mask: Int32Array, W: number, H: number, c: Pt, r: number, value: number) {
  const rr = Math.max(0.5, r);
  for (let j = Math.max(0, Math.floor(c[1] - rr)); j <= Math.min(H - 1, Math.ceil(c[1] + rr)); j++)
    for (let i = Math.max(0, Math.floor(c[0] - rr)); i <= Math.min(W - 1, Math.ceil(c[0] + rr)); i++)
      if (Math.hypot(i + 0.5 - c[0], j + 0.5 - c[1]) <= rr) mask[j * W + i] = value;
}

/** How well a square does on a measure (0 to 1), or null when it has too little of that thing to say. */
export function squareScore(q: CompareSquare, metric: "roofs" | "streets" | "water"): number | null {
  const c = q[metric], least = metric === "streets" ? 200 : 400;
  if (c.picture < least && c.map < least) return null;
  // (a square the map has mostly as water, with no buildings, isn't judged on roofs: a picture's sea can darken toward its edge to nearly a roof's colour)
  if (metric === "roofs" && c.map === 0 && q.water.map > q.samples * 0.6) return null;
  // (covered and on the right thing both count: the lower of the two)
  return Math.min(c.picture ? c.both / c.picture : 0, c.map ? c.both / c.map : 0);
}

/** The picture (greyed, at most `maxSize` px a side) with each square tinted from red (far off) to green (close) on a measure, and the squares' edges. */
export function compareHeatMap(doc: MapDoc, img: Img, res: CompareResult, metric: "roofs" | "streets" | "water" = "roofs", maxSize = 1200): { w: number; h: number; data: Uint8ClampedArray } {
  const t = doc.features!.trace!, spec = citySpec(doc), k = Math.min(1, maxSize / Math.max(img.w, img.h)), w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const size = res.squares[0]?.size ?? 250, nx = Math.ceil(spec.widthM / size), by = new Map(res.squares.map((q) => [Math.floor(q.y / size) * nx + Math.floor(q.x / size), q]));
  const data = new Uint8ClampedArray(w * h * 4), idx = new Int32Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = Math.min(img.w - 1, Math.floor(x / k)), v = Math.min(img.h - 1, Math.floor(y / k)), s = (v * img.w + u) * 4, o = (y * w + x) * 4;
    const grey = (img.data[s] + img.data[s + 1] + img.data[s + 2]) / 3, [mx, my] = tracePoint(t, u + 0.5, v + 0.5);
    const n = mx >= 0 && my >= 0 && mx < spec.widthM && my < spec.heightM ? Math.floor(my / size) * nx + Math.floor(mx / size) : -1;
    idx[y * w + x] = n;
    const q = n >= 0 ? by.get(n) : undefined, sc = q ? squareScore(q, metric) : null;
    if (sc === null) { data[o] = data[o + 1] = data[o + 2] = grey * 0.55; }
    else { data[o] = grey * 0.45 + 150 * (1 - sc); data[o + 1] = grey * 0.45 + 150 * sc; data[o + 2] = grey * 0.45 + 20; }
    data[o + 3] = 255;
  }
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const i = y * w + x;
    if (idx[i] !== idx[i - 1] || idx[i] !== idx[i - w]) { const o = i * 4; data[o] = data[o + 1] = data[o + 2] = 25; }
  }
  return { w, h, data };
}
