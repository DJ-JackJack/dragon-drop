/**
 * Planning a city like a town that grew (Claude's planning tools, and anything else that places things for the DM):
 *
 *   - `planFrontage`: buildings along streets, facing them and following their curves, varied in width, depth, set-back, gaps and roofs by a "character" (a dense centre,
 *     a town street, a village lane, farms), skipping water, steep ground, other streets, buildings and woods. The straight rows came from placing every building by its
 *     numbers; this places them the way a street fills up.
 *   - `routeStreet`: a street from point to point that follows the land: it climbs gently (winding up a steep hill), goes round buildings, and crosses water where it is
 *     narrow (or not at all), found by searching a grid over the city.
 *   - `cityProblems`: what is wrong in a city (buildings in water, on streets, overlapping or on steep ground, main streets that end nowhere, very long bridges) and whether
 *     it reads as a grid of stamps (one size, one angle).
 *
 * Pure and deterministic (seeded from ids), like the rest of core.
 */
import type { MapDoc } from "./doc.ts";
import { type CitySpec, citySpec } from "./city.ts";
import { STEEP_PERCENT, type LandGrid, gridHeightAt, landGrid } from "./cityLand.ts";
import { isWaterAt, streetBridges } from "./cityBridges.ts";
import { type WallPieces, cityWallPieces } from "./cityWalls.ts";
import type { BuildingKind, MapBuilding, MapStreet, MapTrees, RoofStyle } from "./features.ts";
import { distToSegment, pointInPolygon } from "./geom.ts";

type Pt = [number, number];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r2 = (n: number) => Math.round(n * 100) / 100;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** A seeded random number source (0..1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (r: () => number, [a, b]: readonly [number, number]) => a + (b - a) * r();
function pick<K extends string>(r: () => number, weights: Partial<Record<K, number>>): K {
  const e = Object.entries(weights).filter(([, w]) => (w as number) > 0) as [K, number][];
  const total = e.reduce((s, [, w]) => s + w, 0);
  let u = r() * total;
  for (const [k, w] of e) { if (u < w) return k; u -= w; }
  return e[e.length - 1][0];
}

// ---------------------------------------------------------------- lines

const cumOf = (pts: readonly Pt[]) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };
/** The point and direction (a unit vector) at a distance along a line. */
function along(pts: readonly Pt[], cum: number[], d: number): { x: number; y: number; tx: number; ty: number } {
  let i = 0;
  while (i + 2 < cum.length && cum[i + 1] < d) i++;
  const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = cum[i + 1] - cum[i] || 1e-9, f = clamp((d - cum[i]) / len, 0, 1);
  return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, tx: (bx - ax) / len, ty: (by - ay) / len };
}

// ---------------------------------------------------------------- what is already there

/** Convex polygons overlap? (Separating axes. A concave outline is tested as if it were its outline's corners' hull: a little cautious, never too lenient.) */
function overlaps(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length], nx = y0 - y1, ny = x1 - x0;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const [x, y] of a) { const p = x * nx + y * ny; if (p < amin) amin = p; if (p > amax) amax = p; }
      for (const [x, y] of b) { const p = x * nx + y * ny; if (p < bmin) bmin = p; if (p > bmax) bmax = p; }
      if (amax <= bmin || bmax <= amin) return false;
    }
  }
  return true;
}
/** A polygon pulled in a little toward its middle (so buildings that only touch don't count as overlapping). */
function shrink(p: readonly Pt[], by: number): Pt[] {
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  return p.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; const k = Math.max(0, d - by) / d; return [cx + (x - cx) * k, cy + (y - cy) * k] as Pt; });
}
function bounds(p: readonly Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
/** Points along a polygon's edges (every metre and a half) and its middle: what is tested against streets, water and slope. */
function probes(p: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push([p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]);
  return out;
}

type Seg = { ax: number; ay: number; bx: number; by: number; half: number; street: string };

/** The city's streets, buildings, water, land and woods, indexed in 16 m cells for quick "is this spot free?" questions. */
export class CitySpace {
  readonly spec: CitySpec;
  private readonly C = 16;
  private readonly cw: number;
  private readonly segs: Seg[][] = [];
  private readonly polys: Pt[][][] = [];
  private readonly land: LandGrid | null;
  private readonly woods: MapTrees[];
  /** The walls' stretches (with how far either side of the line they reach) and towers, by cell. */
  private readonly wallSegs: { ax: number; ay: number; bx: number; by: number; half: number }[][] = [];
  private readonly towers: { x: number; y: number; r: number }[][] = [];
  /** What stands on each wall (its towers and gates). */
  readonly walls: WallPieces[];
  constructor(private readonly doc: MapDoc) {
    this.spec = citySpec(doc);
    this.cw = Math.ceil(this.spec.widthM / this.C) + 1;
    this.land = landGrid(doc);
    this.woods = (doc.features?.trees ?? []).filter((t) => t.kind === "wood" || t.kind === "orchard");
    for (const s of doc.features?.streets ?? []) this.addStreet(s);
    for (const b of doc.features?.buildings ?? []) this.addBuilding(b.points as Pt[]);
    this.walls = cityWallPieces(doc.features?.cityWalls, doc.features?.streets, { ground: doc.height, cellM: this.spec.cellM });
    for (const w of this.walls) {
      const half = w.thickness / 2 + (w.kind === "earth" ? w.thickness * 0.7 : 0); // (an earth rampart's ditch is no place for a house either)
      for (const s of w.stretches) {
        const n = s.points.length, sides = s.closed ? n : n - 1;
        for (let i = 0; i < sides; i++) {
          const [ax, ay] = s.points[i], [bx, by] = s.points[(i + 1) % n], seg = { ax, ay, bx, by, half };
          for (const c of this.cells(Math.min(ax, bx) - half - 2, Math.min(ay, by) - half - 2, Math.max(ax, bx) + half + 2, Math.max(ay, by) + half + 2)) (this.wallSegs[c] ??= []).push(seg);
        }
      }
      for (const t of w.towers) { const r = t.r * 1.42; for (const c of this.cells(t.x - r - 2, t.y - r - 2, t.x + r + 2, t.y + r + 2)) (this.towers[c] ??= []).push({ x: t.x, y: t.y, r }); }
    }
  }
  private cells(x0: number, y0: number, x1: number, y1: number): number[] {
    const out: number[] = [], C = this.C;
    for (let cy = Math.max(0, Math.floor(y0 / C)); cy <= Math.floor(y1 / C); cy++) for (let cx = Math.max(0, Math.floor(x0 / C)); cx <= Math.min(this.cw - 1, Math.floor(x1 / C)); cx++) out.push(cy * this.cw + cx);
    return out;
  }
  addStreet(s: MapStreet) {
    const half = s.width / 2;
    for (let i = 0; i + 1 < s.points.length; i++) {
      const [ax, ay] = s.points[i], [bx, by] = s.points[i + 1], seg = { ax, ay, bx, by, half, street: s.id };
      for (const c of this.cells(Math.min(ax, bx) - half - 2, Math.min(ay, by) - half - 2, Math.max(ax, bx) + half + 2, Math.max(ay, by) + half + 2)) (this.segs[c] ??= []).push(seg);
    }
  }
  addBuilding(p: Pt[]) {
    const b = bounds(p);
    for (const c of this.cells(b.x0, b.y0, b.x1, b.y1)) (this.polys[c] ??= []).push(p);
  }
  inside(p: readonly Pt[]): boolean {
    return p.every(([x, y]) => x >= 0 && y >= 0 && x <= this.spec.widthM && y <= this.spec.heightM);
  }
  /** Does any point of the shape lie on a street (closer to its middle line than half its width and `margin`)? */
  onStreet(p: readonly Pt[], margin = 0.1): boolean {
    for (const [x, y] of probes(p)) {
      for (const s of this.segs[Math.floor(y / this.C) * this.cw + Math.floor(x / this.C)] ?? []) if (distToSegment(x, y, s.ax, s.ay, s.bx, s.by) < s.half + margin) return true;
    }
    return false;
  }
  /** Does the shape overlap a building already there? Touching is fine, and so is an overlap of less than `slack` metres or so (the checker's and the reader's
   *  allowance for rounding); the planner passes 0, so what it places never overlaps at all and the checker can't find a corner poking in. */
  onBuilding(p: readonly Pt[], slack = 0.12): boolean {
    const b = bounds(p), mine = slack > 0 ? shrink(p, slack) : p, seen = new Set<Pt[]>();
    for (const c of this.cells(b.x0, b.y0, b.x1, b.y1)) for (const q of this.polys[c] ?? []) {
      if (seen.has(q)) continue;
      seen.add(q);
      const qb = bounds(q);
      if (qb.x1 <= b.x0 || qb.x0 >= b.x1 || qb.y1 <= b.y0 || qb.y0 >= b.y1) continue;
      if (overlaps(mine, q)) return true;
    }
    return false;
  }
  /** Does any point of the shape lie on a city wall, its ditch or a tower (closer than `margin` metres)? */
  onWall(p: readonly Pt[], margin = 0.3): boolean {
    if (!this.walls.length) return false;
    for (const [x, y] of probes(p)) {
      const c = Math.floor(y / this.C) * this.cw + Math.floor(x / this.C);
      for (const s of this.wallSegs[c] ?? []) if (distToSegment(x, y, s.ax, s.ay, s.bx, s.by) < s.half + margin) return true;
      for (const t of this.towers[c] ?? []) if (Math.hypot(x - t.x, y - t.y) < t.r + margin) return true;
    }
    return false;
  }
  onWater(p: readonly Pt[]): boolean {
    return probes(p).some(([x, y]) => isWaterAt(this.doc.height, this.spec.cellM, x, y));
  }
  inWood(p: readonly Pt[]): boolean {
    const [cx, cy] = probes(p).pop()!;
    return this.woods.some((t) => pointInPolygon(cx, cy, t.points as Pt[]));
  }
  /** Percent slope at a point (0 on a flat city). */
  slope(x: number, y: number): number {
    const g = this.land;
    if (!g) return 0;
    const e = Math.max(1, g.cellM);
    return Math.hypot(gridHeightAt(g, x + e, y) - gridHeightAt(g, x - e, y), gridHeightAt(g, x, y + e) - gridHeightAt(g, x, y - e)) / (2 * e) * 100;
  }
  height(x: number, y: number): number {
    return this.land ? gridHeightAt(this.land, x, y) : 0;
  }
  water(x: number, y: number): boolean {
    return isWaterAt(this.doc.height, this.spec.cellM, x, y);
  }
}

// ---------------------------------------------------------------- buildings along streets

type Range = readonly [number, number];
export interface StreetCharacter { width: Range; depth: Range; gap: Range; setback: Range; skip: number; jitter: number; roofs: Partial<Record<RoofStyle, number>>; kinds: Partial<Record<BuildingKind, number>>; backRow: boolean }

/** How a street fills up, from a crowded town centre to farms. */
export const STREET_CHARACTERS: Record<"dense" | "town" | "village" | "farm", StreetCharacter & { hint: string }> = {
  dense: { hint: "terraced houses wall to wall, narrow and deep, shops among them, a second row behind", width: [5, 8], depth: [8, 13], gap: [0, 0.3], setback: [0.2, 0.8], skip: 0.03, jitter: 1.5, roofs: { tile: 0.45, slate: 0.4, shingle: 0.15 }, kinds: { house: 0.72, shop: 0.22, tavern: 0.04, inn: 0.02 }, backRow: true },
  town: { hint: "houses side by side with small gaps and yards, a few shops", width: [6, 10], depth: [7, 11], gap: [0.8, 4], setback: [0.5, 2.5], skip: 0.06, jitter: 3, roofs: { tile: 0.4, slate: 0.35, shingle: 0.25 }, kinds: { house: 0.86, shop: 0.11, inn: 0.03 }, backRow: false },
  village: { hint: "cottages with gardens between them, set back from the lane", width: [6, 10], depth: [6, 9], gap: [4, 14], setback: [2, 7], skip: 0.15, jitter: 6, roofs: { thatch: 0.5, shingle: 0.3, tile: 0.2 }, kinds: { house: 0.88, barn: 0.12 }, backRow: false },
  farm: { hint: "farmhouses and barns far apart, well back from the road", width: [10, 18], depth: [8, 14], gap: [15, 45], setback: [6, 20], skip: 0.2, jitter: 8, roofs: { thatch: 0.6, shingle: 0.4 }, kinds: { barn: 0.55, house: 0.45 }, backRow: false },
};
export type StreetCharacterId = keyof typeof STREET_CHARACTERS;

export interface FrontageOptions {
  character?: StreetCharacterId;
  /** Which sides of each street, walking from its first point to its last. */
  sides?: "both" | "left" | "right";
  /** A second row behind the first (the default for a dense centre). */
  backRow?: boolean;
  width?: Range; depth?: Range; gap?: Range; setback?: Range;
  roofs?: Partial<Record<RoofStyle, number>>;
  kinds?: Partial<Record<BuildingKind, number>>;
  /** Only this stretch of each street (metres from its first point). */
  from?: number; to?: number;
  /** Steeper than this (percent) is left empty. */
  maxSlope?: number;
  /** Leave woods and orchards empty (default yes). */
  keepWoods?: boolean;
  seed?: number;
  /** The most buildings in all. */
  limit?: number;
}

export interface PlannedBuilding { points: Pt[]; kind: BuildingKind; roof: RoofStyle; street: string }
export type SkipReason = "water" | "steep" | "street" | "wall" | "building" | "edge" | "wood";

/** Buildings along the given streets, as a street fills up (see STREET_CHARACTERS); what couldn't be placed is counted by why. */
export function planFrontage(doc: MapDoc, streets: readonly MapStreet[], o: FrontageOptions = {}): { buildings: PlannedBuilding[]; byStreet: Record<string, number>; skipped: Record<SkipReason, number> } {
  const base = STREET_CHARACTERS[o.character ?? "town"];
  const ch: StreetCharacter = { ...base, ...(o.width && { width: o.width }), ...(o.depth && { depth: o.depth }), ...(o.gap && { gap: o.gap }), ...(o.setback && { setback: o.setback }), ...(o.roofs && { roofs: o.roofs }), ...(o.kinds && { kinds: o.kinds }), ...(o.backRow !== undefined && { backRow: o.backRow }) };
  const space = new CitySpace(doc), maxSlope = o.maxSlope ?? STEEP_PERCENT, limit = o.limit ?? 1500;
  const out: PlannedBuilding[] = [], byStreet: Record<string, number> = {}, skipped: Record<SkipReason, number> = { water: 0, steep: 0, street: 0, wall: 0, building: 0, edge: 0, wood: 0 };
  const why = (p: Pt[]): SkipReason | null => {
    if (!space.inside(p)) return "edge";
    if (space.onWater(p)) return "water";
    const c = p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length], [0, 0]);
    if (space.slope(c[0], c[1]) > maxSlope) return "steep";
    if (space.onStreet(p)) return "street";
    if (space.onWall(p)) return "wall";
    if (space.onBuilding(p, 0)) return "building";
    if (o.keepWoods !== false && space.inWood(p)) return "wood";
    return null;
  };
  const sides: number[] = o.sides === "left" ? [1] : o.sides === "right" ? [-1] : [1, -1];
  for (const s of streets) {
    const pts = s.points as Pt[];
    if (pts.length < 2) continue;
    const cum = cumOf(pts), total = cum[cum.length - 1], half = s.width / 2;
    for (const side of sides) {
      const r = rng(hashStr(`${s.id}|${side}|${o.seed ?? 0}`));
      const end = Math.min(total, o.to ?? total);
      let d = Math.max(0, o.from ?? 0) + between(r, [0, 3]), tries = 0;
      while (d < end && out.length < limit) {
        const w = between(r, ch.width), dep = between(r, ch.depth), sb = between(r, ch.setback);
        if (d + w > end) break;
        if (r() < ch.skip) { d += w + between(r, ch.gap); continue; } // (an empty plot, a yard, a garden)
        const m = along(pts, cum, d + w / 2), a = Math.atan2(m.ty, m.tx) + ((r() - 0.5) * 2 * ch.jitter * Math.PI) / 180;
        const tx = Math.cos(a), ty = Math.sin(a), nx = side * ty, ny = -side * tx; // (the side's normal: +1 is the left as you walk the street)
        const fx = m.x + nx * (half + sb), fy = m.y + ny * (half + sb);
        const poly: Pt[] = [[fx - tx * w / 2, fy - ty * w / 2], [fx + tx * w / 2, fy + ty * w / 2], [fx + tx * w / 2 + nx * dep, fy + ty * w / 2 + ny * dep], [fx - tx * w / 2 + nx * dep, fy - ty * w / 2 + ny * dep]];
        const bad = why(poly);
        if (bad) { skipped[bad]++; d += 1.5; tries++; if (tries > 400) break; continue; }
        const placed = poly.map(([x, y]) => [r2(x), r2(y)] as Pt);
        space.addBuilding(placed);
        out.push({ points: placed, kind: pick(r, ch.kinds), roof: pick(r, ch.roofs), street: s.id });
        byStreet[s.id] = (byStreet[s.id] ?? 0) + 1;
        // a second row behind, across a yard, a little shallower (a dense centre's back houses and workshops)
        if (ch.backRow && out.length < limit) {
          const yard = between(r, [2, 5]), dep2 = dep * between(r, [0.6, 0.9]), off = half + sb + dep + yard;
          const bx = m.x + nx * off, by = m.y + ny * off, w2 = w * between(r, [0.7, 1]);
          const back: Pt[] = [[bx - tx * w2 / 2, by - ty * w2 / 2], [bx + tx * w2 / 2, by + ty * w2 / 2], [bx + tx * w2 / 2 + nx * dep2, by + ty * w2 / 2 + ny * dep2], [bx - tx * w2 / 2 + nx * dep2, by - ty * w2 / 2 + ny * dep2]];
          if (!why(back)) {
            const bp = back.map(([x, y]) => [r2(x), r2(y)] as Pt);
            space.addBuilding(bp);
            out.push({ points: bp, kind: pick(r, { house: 0.6, shop: 0.1, warehouse: 0.3 } as Partial<Record<BuildingKind, number>>), roof: pick(r, ch.roofs), street: s.id });
            byStreet[s.id]++;
          }
        }
        d += w + between(r, ch.gap);
        tries = 0;
      }
    }
  }
  return { buildings: out, byStreet, skipped };
}

// ---------------------------------------------------------------- a street that follows the land

export interface StreetRouteOptions {
  /** The steepest the street should climb, percent (default 8: a loaded cart's limit). Steeper stretches cost a lot more, so it winds instead. */
  maxGrade?: number;
  /** May it cross water (on a bridge, where the water is narrow)? Default yes. */
  bridges?: boolean;
}

export interface StreetRoute { points: Pt[]; length: number; maxGrade: number; crossesWater: boolean }

/** Min-heap of node indices by score. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= key) break; ids[i] = ids[p]; keys[i] = keys[p]; i = p; }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys, top = ids[0], lastId = ids.pop()!, lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < ids.length && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < ids.length && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m]; i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

/** Fewer points on a line, none further than `tol` from where it was (Douglas-Peucker). */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) { const d = distToSegment(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]); if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A line's inside points each moved to the average of their neighbours (`k` either side); the ends stay. Takes the grid's stair-steps out of a searched path. */
function relax(pts: Pt[], k: number): Pt[] {
  if (pts.length <= 2) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const a = Math.max(0, i - k), b = Math.min(pts.length - 1, i + k);
    let x = 0, y = 0;
    for (let j = a; j <= b; j++) { x += pts[j][0]; y += pts[j][1]; }
    return [x / (b - a + 1), y / (b - a + 1)] as Pt;
  });
}
/** Corners rounded (Chaikin's cutting), the ends kept. */
function rounded(pts: Pt[], passes: number): Pt[] {
  let out = pts;
  for (let n = 0; n < passes && out.length > 2; n++) {
    const next: Pt[] = [out[0]];
    for (let i = 0; i + 1 < out.length; i++) {
      const [ax, ay] = out[i], [bx, by] = out[i + 1];
      if (i > 0) next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      if (i + 2 < out.length) next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * A street from the first point to the last, through the others in order, that follows the land: searched over a grid of the city (2 m or the ground's cells, coarser on a
 * big city), each step costing its length, much more when it climbs past `maxGrade`, a lot to cross water (so it crosses where the water is narrow), and impossible through a
 * building or off the map.
 */
export function routeStreet(doc: MapDoc, waypoints: readonly Pt[], o: StreetRouteOptions = {}): StreetRoute | { error: string } {
  const space = new CitySpace(doc), spec = space.spec;
  if (waypoints.length < 2) return { error: "A street needs a start and an end." };
  const g = Math.max(spec.cellM, 3, Math.max(spec.widthM, spec.heightM) / 450);
  const nx = Math.ceil(spec.widthM / g), ny = Math.ceil(spec.heightM / g), N = nx * ny;
  const cx = (i: number) => (i % nx + 0.5) * g, cy = (i: number) => (Math.floor(i / nx) + 0.5) * g;
  const blocked = new Uint8Array(N), wet = new Uint8Array(N), h = new Float32Array(N);
  // (the last row and column of the grid may reach past the map's edge: they are read from just inside it, or the edge would be a dry way round the water)
  for (let i = 0; i < N; i++) { const x = Math.min(cx(i), spec.widthM - 0.01), y = Math.min(cy(i), spec.heightM - 0.01); wet[i] = space.water(x, y) ? 1 : 0; h[i] = space.height(x, y); }
  for (const b of doc.features?.buildings ?? []) {
    const bb = bounds(b.points as Pt[]);
    for (let y = Math.max(0, Math.floor(bb.y0 / g)); y <= Math.min(ny - 1, Math.floor(bb.y1 / g)); y++) for (let x = Math.max(0, Math.floor(bb.x0 / g)); x <= Math.min(nx - 1, Math.floor(bb.x1 / g)); x++) {
      if (pointInPolygon((x + 0.5) * g, (y + 0.5) * g, b.points as Pt[])) blocked[y * nx + x] = 1;
    }
  }
  const bridges = o.bridges !== false, mg = Math.max(1, o.maxGrade ?? 8) / 100;
  if (!bridges) for (let i = 0; i < N; i++) if (wet[i]) blocked[i] = 1;
  const nodeAt = ([x, y]: Pt): number => {
    const ix = clamp(Math.floor(x / g), 0, nx - 1), iy = clamp(Math.floor(y / g), 0, ny - 1);
    // the nearest open node (a point on a building or, without bridges, in the water moves to the nearest place it can start)
    for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x2 = ix + dx, y2 = iy + dy;
      if (x2 >= 0 && y2 >= 0 && x2 < nx && y2 < ny && !blocked[y2 * nx + x2]) return y2 * nx + x2;
    }
    return -1;
  };
  // The search keeps the way it is heading (one of 8 directions) and charges for turning: without that it climbs a slope it shouldn't in a zigzag a few metres wide,
  // which no road could take, and which becomes a straight line up the slope once smoothed. Sharp turns (a hairpin) are dear but allowed, so a steep climb winds.
  const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const TURN = [0, 0.3 * g, 2 * g, 6 * g, Infinity]; // (by how many eighths of a turn the direction changes)
  const S = N * 8, cost = new Float64Array(S), from = new Int32Array(S);
  const leg = (s: number, t: number): number[] | null => {
    cost.fill(Infinity); from.fill(-1);
    const heap = new Heap(), tx = cx(t), ty = cy(t);
    for (let d = 0; d < 8; d++) { cost[s * 8 + d] = 0; heap.push(s * 8 + d, 0); }
    let reached = -1;
    while (heap.size) {
      const st = heap.pop(), a = (st / 8) | 0, da = st % 8;
      if (a === t) { reached = st; break; }
      const ax = a % nx, ay = (a / nx) | 0, ca = cost[st];
      for (let d = 0; d < 8; d++) {
        const turn = Math.min((d - da + 8) % 8, (da - d + 8) % 8);
        if (turn === 4) continue;
        const [dx, dy] = DIRS[d], bx = ax + dx, by = ay + dy;
        if (bx < 0 || by < 0 || bx >= nx || by >= ny) continue;
        const b = by * nx + bx;
        if (blocked[b]) continue;
        // a diagonal step must not cut a building's corner either
        if (dx && dy && (blocked[ay * nx + bx] || blocked[by * nx + ax])) continue;
        const L = (dx && dy ? Math.SQRT2 : 1) * g, grade = Math.abs(h[b] - h[a]) / L;
        let c = L * (1 + (grade <= mg ? 0.6 * (grade / mg) ** 2 : 0.6 + 30 * (grade - mg) / mg)) + TURN[turn];
        if (wet[b]) c = c * 6 + (wet[a] ? 0 : 40); // (a bridge costs a lot, and every new crossing more)
        const nb = b * 8 + d, nc = ca + c;
        if (nc < cost[nb]) { cost[nb] = nc; from[nb] = st; heap.push(nb, nc + Math.hypot(cx(b) - tx, cy(b) - ty)); }
      }
    }
    if (reached < 0) return null;
    const path: number[] = [];
    for (let v = reached; v !== -1; v = from[v]) path.push((v / 8) | 0);
    return path.reverse().filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
  };
  let pts: Pt[] = [];
  for (let k = 0; k + 1 < waypoints.length; k++) {
    const s = nodeAt(waypoints[k]), t = nodeAt(waypoints[k + 1]);
    if (s < 0 || t < 0) return { error: `Point ${k + (s < 0 ? 1 : 2)} is in the middle of buildings${bridges ? "" : " or water"}, with nowhere near to start from.` };
    const path = leg(s, t);
    if (!path) return { error: `There is no way from point ${k + 1} to point ${k + 2}${bridges ? "" : " without crossing water (allow bridges)"}: buildings or the map's edge are in the way.` };
    const legPts = path.map((i) => [cx(i), cy(i)] as Pt);
    legPts[0] = [...waypoints[k]] as Pt;
    legPts[legPts.length - 1] = [...waypoints[k + 1]] as Pt;
    pts = pts.length ? [...pts, ...legPts.slice(1)] : legPts;
  }
  // what a line comes to: its length, its steepest climb (percent, over any 15 m of it: what a cart feels; the tip of a hairpin bend crosses the slope for a moment and
  // doesn't count) and whether it crosses water
  const measure = (line: Pt[]) => {
    const hs: number[] = [];
    let length = 0, crossesWater = false;
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i], [bx, by] = line[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L));
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
        hs.push(space.height(x, y));
        if (space.water(x, y)) crossesWater = true;
      }
      length += L;
    }
    hs.push(space.height(line[line.length - 1][0], line[line.length - 1][1]));
    // (hs is one sample a metre or so: the climb over 15 samples)
    const per = hs.length > 1 ? length / (hs.length - 1) : 1, span = Math.max(1, Math.round(15 / per));
    let maxGrade = 0;
    for (let i = 0; i + span < hs.length; i++) maxGrade = Math.max(maxGrade, (Math.abs(hs[i + span] - hs[i]) / (span * per)) * 100);
    if (hs.length <= span && length > 0) maxGrade = (Math.abs(hs[hs.length - 1] - hs[0]) / length) * 100;
    return { length, maxGrade, crossesWater };
  };
  // smoothed: the grid's stair-steps relaxed out, fewer points, corners rounded; less so where smoothing would cut a winding climb's corners and make it steeper
  const raw = measure(pts), limit = Math.max(mg * 100 * 1.2, raw.maxGrade * 1.05);
  let best: Pt[] = pts, tol = g * 0.8, relaxK = 1;
  for (let attempt = 0; attempt < 6; attempt++) {
    let line = simplify(relax(relax(pts, relaxK), relaxK), tol);
    while (line.length > 90) line = simplify(line, (tol *= 1.4));
    line = rounded(line, attempt < 2 ? 2 : 1).map(([x, y]) => [r2(clamp(x, 0, spec.widthM)), r2(clamp(y, 0, spec.heightM))] as Pt);
    best = line;
    if (measure(line).maxGrade <= limit) break;
    tol /= 2; relaxK = 0;
  }
  if (best.length > 200) best = simplify(best, g * 0.3);
  const m = measure(best);
  return { points: best, length: Math.round(m.length), maxGrade: Math.round(m.maxGrade * 10) / 10, crossesWater: m.crossesWater };
}

// ---------------------------------------------------------------- what is wrong

export interface CityProblem { id: string; at: [number, number] }
export interface CityReport {
  buildings: number;
  streets: number;
  in_water: { count: number; examples: CityProblem[] };
  on_streets: { count: number; examples: CityProblem[] };
  on_walls: { count: number; examples: CityProblem[] };
  overlapping: { count: number; examples: CityProblem[] };
  on_steep_ground: { count: number; examples: CityProblem[] };
  dead_end_main_streets: { count: number; examples: CityProblem[] };
  long_bridges: { count: number; examples: (CityProblem & { length_m: number })[] };
  fords_on_main_streets: { count: number; examples: CityProblem[] };
  /** The city walls: how many, their gates and towers, and rings no street passes through (a town with no way in). */
  walls: { count: number; gates: number; towers: number; rings_without_gate: CityProblem[] };
  /** The share of buildings at the most common angle and size: high for both reads as a grid of stamps. */
  regularity: { same_angle_percent: number; same_size_percent: number; looks_stamped: boolean };
}

/** What is wrong in a city, counted, with a few examples of each (ids and where). */
export function cityProblems(doc: MapDoc): CityReport {
  const space = new CitySpace(doc), f = doc.features ?? { places: [], labels: [] };
  const buildings = (f.buildings ?? []) as MapBuilding[], streets = (f.streets ?? []) as MapStreet[];
  const bucket = () => ({ count: 0, examples: [] as CityProblem[] });
  const report: CityReport = {
    buildings: buildings.length, streets: streets.length, in_water: bucket(), on_streets: bucket(), on_walls: bucket(), overlapping: bucket(), on_steep_ground: bucket(),
    walls: { count: space.walls.length, gates: space.walls.reduce((n, w) => n + w.gates.length, 0), towers: space.walls.reduce((n, w) => n + w.towers.length, 0), rings_without_gate: space.walls.filter((w) => w.closed && !w.gates.length).map((w) => ({ id: w.wallId, at: [Math.round(w.ring![0][0]), Math.round(w.ring![0][1])] as [number, number] })) },
    dead_end_main_streets: bucket(), long_bridges: { count: 0, examples: [] }, fords_on_main_streets: bucket(), regularity: { same_angle_percent: 0, same_size_percent: 0, looks_stamped: false },
  };
  const note = (b: { count: number; examples: CityProblem[] }, id: string, at: [number, number]) => { b.count++; if (b.examples.length < 8) b.examples.push({ id, at: [Math.round(at[0]), Math.round(at[1])] }); };
  // buildings: water, streets, steep ground, and each other (each pair once: a building is tested against those added before it)
  const seen = new CitySpace({ ...doc, features: { ...f, buildings: [] } });
  const angles = new Map<number, number>(), sizes = new Map<string, number>();
  for (const b of buildings) {
    const p = b.points as Pt[], c: [number, number] = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    if (space.onWater(shrink(p, 0.3))) note(report.in_water, b.id, c);
    if (seen.onStreet(shrink(p, 0.3), -0.2)) note(report.on_streets, b.id, c);
    if (space.onWall(shrink(p, 0.3), -0.2)) note(report.on_walls, b.id, c);
    if (seen.onBuilding(p)) note(report.overlapping, b.id, c);
    if (space.slope(c[0], c[1]) > STEEP_PERCENT) note(report.on_steep_ground, b.id, c);
    seen.addBuilding(p);
    // its angle (its longest side, folded into 0-89 degrees) and its size, to the half metre
    let best = 0, ang = 0;
    for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], l = Math.hypot(x1 - x0, y1 - y0); if (l > best) { best = l; ang = Math.atan2(y1 - y0, x1 - x0); } }
    const deg = Math.round((((ang * 180) / Math.PI) % 90) + 90) % 90;
    angles.set(deg, (angles.get(deg) ?? 0) + 1);
    const bb = bounds(p), key = `${Math.round((bb.x1 - bb.x0) * 2)}x${Math.round((bb.y1 - bb.y0) * 2)}`;
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  if (buildings.length) {
    report.regularity.same_angle_percent = Math.round((Math.max(...angles.values()) / buildings.length) * 100);
    report.regularity.same_size_percent = Math.round((Math.max(...sizes.values()) / buildings.length) * 100);
    report.regularity.looks_stamped = buildings.length >= 30 && report.regularity.same_angle_percent >= 60 && report.regularity.same_size_percent >= 40;
  }
  // main streets that end nowhere (not at another street, not at the map's edge)
  const main = new Set(["avenue", "street"]);
  for (const s of streets) {
    if (!s.kind || !main.has(s.kind)) continue;
    for (const end of [s.points[0], s.points[s.points.length - 1]] as Pt[]) {
      const atEdge = end[0] < 15 || end[1] < 15 || end[0] > space.spec.widthM - 15 || end[1] > space.spec.heightM - 15; // (leaving the map)
      const joined = streets.some((o) => o.id !== s.id && o.points.some((_, i) => i + 1 < o.points.length && distToSegment(end[0], end[1], o.points[i][0], o.points[i][1], o.points[i + 1][0], o.points[i + 1][1]) <= o.width / 2 + 3));
      if (!atEdge && !joined) note(report.dead_end_main_streets, s.id, end);
    }
  }
  // bridges: very long ones, and main streets that ford
  for (const s of streets) {
    for (const b of streetBridges(s, doc.height, space.spec.cellM)) {
      const mid = b.points[Math.floor(b.points.length / 2)];
      if (b.kind === "ford" && s.kind && main.has(s.kind)) note(report.fords_on_main_streets, s.id, mid);
      if (b.kind !== "ford" && b.length > 60) { report.long_bridges.count++; if (report.long_bridges.examples.length < 8) report.long_bridges.examples.push({ id: s.id, at: [Math.round(mid[0]), Math.round(mid[1])], length_m: Math.round(b.length) }); }
    }
  }
  return report;
}
