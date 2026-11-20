/**
 * The land, the climate and the trees of a city map (city.ts holds the map itself).
 *
 * The land is shapes (`features.land`: hills, ridges and valleys, plateaus, slopes) added up into a height for every ground cell (`landGrid`). From that come the shading (`landShade`,
 * light from the top left as everywhere in Dragon Drop), the contour lines (`contourLines`) and the height and slope at a point (`landAt`). Shapes rather than a second grid of numbers:
 * they are features, so undo, saving, checkpoints and the editor's sync already work for them, and "the hill" stays one thing the DM or Claude can move or change.
 *
 * The climate (`CitySpec.climate`, the scales of a world map's climate regions) colours the ground (`cityGroundColours`), brings snow (`snowCover`) and picks the trees
 * (`treeCrowns`, `treeColour`). Everything here is pure and the same in the editor and on the server, so both draw the same city.
 */
import type { MapDoc } from "./doc.ts";
import { type CityClimate, type CitySpec, cityCells, cleanPoints, polygonSelfIntersects } from "./city.ts";
import { MATERIALS } from "./battle.ts";
import { type MapLandform, type MapTrees, type TreeSpecies, LANDFORM_KINDS, TREE_GROUPS, TREE_SPECIES } from "./features.ts";
import { distToPolyline, pointInPolygon } from "./geom.ts";

type Pt = [number, number];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth01 = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
/** 1 at the centre, falling smoothly to 0 at t = 1 (and flat at both ends). */
const bump = (t: number) => (t >= 1 ? 0 : t <= 0 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * t));
const r2 = (n: number) => Math.round(n * 100) / 100;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hash3(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Smooth value noise in -1..1. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash3(xi, yi, seed), b = hash3(xi + 1, yi, seed), c = hash3(xi, yi + 1, seed), d = hash3(xi + 1, yi + 1, seed);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

// ---------------------------------------------------------------- the land

/** How far one landform reaches (metres), beyond its points: past where its wandering edge can end (cut off any sooner, it would leave a step in the land). */
function reach(l: MapLandform): number {
  return l.kind === "plateau" ? l.radius * 0.85 : l.kind === "hill" ? l.radius * 1.3 : l.radius * 1.35;
}

/** One landform's height (metres) at a point. Outlines wander a little (by the landform's id), so a hill is not a perfect circle nor a ridge a perfect tube. */
export function landformHeightAt(l: MapLandform, x: number, y: number): number {
  const seed = hashStr(l.id), r = Math.max(1, l.radius), pts = l.points as Pt[];
  const wob = (scale: number) => noise(x / scale, y / scale, seed);
  switch (l.kind) {
    case "hill": {
      const d = Math.hypot(x - pts[0][0], y - pts[0][1]);
      return l.height * bump((d / r) * (1 + 0.2 * wob(r * 0.7)));
    }
    case "ridge": {
      const d = distToPolyline(x, y, pts);
      // the crest rises and falls a little along its length
      return l.height * (0.86 + 0.14 * wob(r * 2.2)) * bump((d / r) * (1 + 0.22 * wob(r * 0.8)));
    }
    case "plateau": {
      if (pts.length < 3) return 0;
      const inside = pointInPolygon(x, y, pts), d = distToPolyline(x, y, [...pts, pts[0]]);
      const s = (inside ? d : -d) + 0.3 * r * wob(r * 1.5);
      return l.height * smooth01(0.5 + s / r);
    }
    case "slope": {
      const [[ax, ay], [bx, by]] = pts, dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) return 0;
      return l.height * smooth01(((x - ax) * dx + (y - ay) * dy) / len2);
    }
  }
  return 0;
}

/** The land's height (metres above the city's own ground level) at a point, from all the landforms. */
export function landHeightAt(land: readonly MapLandform[] | undefined, x: number, y: number): number {
  let h = 0;
  for (const l of land ?? []) h += landformHeightAt(l, x, y);
  return h;
}

export interface LandGrid {
  /** Cells across and down (the ground's own grid). */
  w: number;
  h: number;
  cellM: number;
  /** Metres above the city's ground level, at the middle of each cell. */
  data: Float32Array;
  min: number;
  max: number;
}

const gridCache = new Map<string, LandGrid>();

/** What the land is worked out from: a city map, or the editor's copy of one (its settings and features). */
export type LandSource = { meta: { city?: CitySpec }; features?: { land?: readonly MapLandform[] } };

/** The land's height for every ground cell, or null when the city is flat (no landforms). Cached by what the landforms are, so asking again is free. */
export function landGrid(doc: LandSource | MapDoc): LandGrid | null {
  const land = doc.features?.land, spec = doc.meta.city;
  if (!spec || !land?.length) return null;
  const { w, h } = cityCells(spec);
  const key = `${w}x${h}@${spec.cellM}|${JSON.stringify(land)}`;
  const hit = gridCache.get(key);
  if (hit) return hit;
  const data = new Float32Array(w * h), cell = spec.cellM;
  for (const l of land) {
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (l.kind !== "slope") {
      const pts = l.points as Pt[], m = reach(l);
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [px, py] of pts) { if (px < a) a = px; if (px > c) c = px; if (py < b) b = py; if (py > d) d = py; }
      x0 = Math.max(0, Math.floor((a - m) / cell)); y0 = Math.max(0, Math.floor((b - m) / cell));
      x1 = Math.min(w - 1, Math.ceil((c + m) / cell)); y1 = Math.min(h - 1, Math.ceil((d + m) / cell));
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[y * w + x] += landformHeightAt(l, (x + 0.5) * cell, (y + 0.5) * cell);
  }
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
  const out: LandGrid = { w, h, cellM: cell, data, min, max };
  if (gridCache.size > 6) gridCache.delete(gridCache.keys().next().value!);
  gridCache.set(key, out);
  return out;
}

const gridAt = (g: LandGrid, cx: number, cy: number) => g.data[clamp(cy, 0, g.h - 1) * g.w + clamp(cx, 0, g.w - 1)];

/** The height (metres, smoothly between cells) at a point. */
export function gridHeightAt(g: LandGrid, x: number, y: number): number {
  const u = x / g.cellM - 0.5, v = y / g.cellM - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  return (gridAt(g, x0, y0) * (1 - fx) + gridAt(g, x0 + 1, y0) * fx) * (1 - fy) + (gridAt(g, x0, y0 + 1) * (1 - fx) + gridAt(g, x0 + 1, y0 + 1) * fx) * fy;
}

/** Height above the sea (metres), how steep (percent: metres of rise per 100 m) and which way the ground falls, at a point. */
export function landAt(doc: LandSource | MapDoc, x: number, y: number): { height: number; slope: number; falls: string } {
  const base = doc.meta.city?.elevation ?? 0, g = landGrid(doc);
  if (!g) return { height: r2(base), slope: 0, falls: "flat" };
  const e = Math.max(1, g.cellM);
  const gx = (gridHeightAt(g, x + e, y) - gridHeightAt(g, x - e, y)) / (2 * e), gy = (gridHeightAt(g, x, y + e) - gridHeightAt(g, x, y - e)) / (2 * e);
  const slope = Math.hypot(gx, gy) * 100;
  // the way down is against the gradient; y runs down the map, so north is -y
  const ang = (Math.atan2(gx, -gy) * 180) / Math.PI + 180, dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return { height: r2(base + gridHeightAt(g, x, y)), slope: Math.round(slope * 10) / 10, falls: slope < 0.5 ? "flat" : dirs[Math.round(ang / 45) % 8] };
}

/** Steeper than this (percent) and building is hard: terraces and steps, no carts. */
export const STEEP_PERCENT = 20;

/**
 * A light factor for every cell (1 on flat ground; brighter on slopes facing the top left, darker on those facing away). The slopes of a town are gentle beside a world map's
 * mountains, so they are exaggerated to show. Cached with the grid.
 */
const shadeCache = new WeakMap<LandGrid, Float32Array>();

export function landShade(g: LandGrid): Float32Array {
  const hit = shadeCache.get(g);
  if (hit) return hit;
  const { w, h, cellM } = g, out = new Float32Array(w * h);
  shadeCache.set(g, out);
  const L = [-0.5, -0.5, Math.SQRT1_2], ex = 2.2 / (2 * cellM);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (gridAt(g, x + 1, y) - gridAt(g, x - 1, y)) * ex, gy = (gridAt(g, x, y + 1) - gridAt(g, x, y - 1)) * ex;
      const n = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const lit = (-gx * L[0] - gy * L[1] + L[2]) * n;
      out[y * w + x] = clamp(1 + 1.1 * (lit - L[2]), 0.68, 1.25);
    }
  }
  return out;
}

/** A contour interval (metres) that gives a readable number of lines for this much rise and fall. */
export function contourInterval(min: number, max: number): number {
  const range = max - min;
  return range <= 12 ? 1 : range <= 30 ? 2 : range <= 90 ? 5 : range <= 220 ? 10 : range <= 500 ? 20 : 50;
}

export interface ContourLines {
  interval: number;
  /** Line pieces in metres, four numbers each (x0, y0, x1, y1). */
  minor: Float32Array;
  /** Every fifth line (25 m when the interval is 5), drawn a little stronger. */
  major: Float32Array;
}

const contourCache = new Map<LandGrid, ContourLines>();

/** The contour lines of the land (marching squares over the cells' middles). */
export function contourLines(g: LandGrid): ContourLines {
  const hit = contourCache.get(g);
  if (hit) return hit;
  const { w, h, cellM, data } = g, interval = contourInterval(g.min, g.max);
  const minor: number[] = [], major: number[] = [];
  const lerp = (a: number, b: number, lv: number) => (lv - a) / (b - a || 1e-9);
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const a = data[y * w + x], b = data[y * w + x + 1], c = data[(y + 1) * w + x + 1], d = data[(y + 1) * w + x];
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      if (hi - lo < 1e-4) continue;
      // (each level is lifted a hair, so ground lying exactly at a level, such as the flat top of a slope, gets no line round its edge)
      for (let base = Math.ceil(lo / interval) * interval; base <= hi; base += interval) {
        const lv = base + interval * 1e-3;
        if (lv <= lo || lv >= hi) continue;
        // the cell's corners, in metres: a top-left, b top-right, c bottom-right, d bottom-left
        const X = (x + 0.5) * cellM, Y = (y + 0.5) * cellM;
        const pts: number[] = [];
        if ((a < lv) !== (b < lv)) pts.push(X + lerp(a, b, lv) * cellM, Y);
        if ((b < lv) !== (c < lv)) pts.push(X + cellM, Y + lerp(b, c, lv) * cellM);
        if ((d < lv) !== (c < lv)) pts.push(X + lerp(d, c, lv) * cellM, Y + cellM);
        if ((a < lv) !== (d < lv)) pts.push(X, Y + lerp(a, d, lv) * cellM);
        const into = Math.round(base / interval) % 5 === 0 ? major : minor;
        if (pts.length === 4) into.push(pts[0], pts[1], pts[2], pts[3]);
        else if (pts.length === 8) into.push(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
      }
    }
  }
  const out: ContourLines = { interval, minor: Float32Array.from(minor), major: Float32Array.from(major) };
  if (contourCache.size > 6) contourCache.delete(contourCache.keys().next().value!);
  contourCache.set(g, out);
  return out;
}

// ---------------------------------------------------------------- the climate

export const CITY_CLIMATES = [
  { id: "cold", name: "Cold", temperature: 0.15, moisture: 0.5, hint: "Snow lies much of the year; firs and pines" },
  { id: "temperate", name: "Temperate", temperature: 0.5, moisture: 0.6, hint: "Green grass; oaks, beeches and some pines" },
  { id: "warm-wet", name: "Warm and wet", temperature: 0.68, moisture: 0.85, hint: "Lush green; broad trees and a few palms" },
  { id: "mediterranean", name: "Mediterranean", temperature: 0.7, moisture: 0.32, hint: "Dry summers: golden grass, olives and cypresses" },
  { id: "dry", name: "Dry", temperature: 0.8, moisture: 0.1, hint: "Dust and sand; a few thorny trees" },
  { id: "tropical", name: "Tropical", temperature: 0.92, moisture: 0.9, hint: "Deep green; palms and broad trees" },
] as const;
export type CityClimateId = (typeof CITY_CLIMATES)[number]["id"];

export const DEFAULT_CITY_CLIMATE: CityClimate = { temperature: 0.5, moisture: 0.6 };

export function cityClimate(spec: CitySpec | undefined): CityClimate {
  return spec?.climate ?? DEFAULT_CITY_CLIMATE;
}

/** The preset a climate is (or null when it is the DM's own numbers). */
export function climatePreset(c: CityClimate): CityClimateId | null {
  return CITY_CLIMATES.find((p) => Math.abs(p.temperature - c.temperature) < 0.02 && Math.abs(p.moisture - c.moisture) < 0.02)?.id ?? null;
}

/** How much of the open ground lies under snow (0 to 1): none in a temperate climate, all of it when frozen. */
export function snowCover(c: CityClimate): number {
  return clamp((0.24 - c.temperature) / 0.14, 0, 1);
}

type RGB = [number, number, number];
const mix = (a: readonly number[], b: readonly number[], t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map((v) => Math.round(v)) as RGB;
const SNOW: RGB = [232, 238, 244];

/** The ground materials' colours in this climate (indexed by material id): grass and forest floor greener when wet, golden when dry, sandy in a desert, grey-green and then white when cold. */
export function cityGroundColours(c: CityClimate): RGB[] {
  const out = MATERIALS.map((m) => [...m.colour] as RGB);
  const T = c.temperature, M = c.moisture, snow = snowCover(c);
  const dry = clamp((0.5 - M) / 0.3, 0, 1), desert = clamp((0.16 - M) / 0.1, 0, 1), lush = clamp((M - 0.7) / 0.2, 0, 1) * clamp((T - 0.55) / 0.2, 0, 1), cold = clamp((0.32 - T) / 0.15, 0, 1);
  const vegetation = (base: readonly number[]): RGB => {
    let col = mix(base, [62, 124, 48], lush);
    col = mix(col, [166, 148, 88], dry);
    col = mix(col, [196, 174, 124], desert);
    col = mix(col, [98, 114, 86], cold * 0.6);
    return mix(col, SNOW, snow * 0.85);
  };
  out[5] = vegetation(MATERIALS[5].colour); // grass
  out[15] = mix(vegetation(MATERIALS[15].colour), MATERIALS[15].colour, 0.35); // forest floor (the trees shelter it a little)
  for (const id of [4, 14]) out[id] = mix(mix(out[id], [160, 132, 96], dry * 0.7), SNOW, snow * 0.6); // dirt and mud: dusty when dry
  for (const id of [1, 2, 12, 13]) out[id] = mix(out[id], SNOW, snow * 0.45); // stone: snow in the cracks
  return out;
}

// ---------------------------------------------------------------- trees

export interface TreeCrown {
  x: number;
  y: number;
  /** Metres. */
  r: number;
  species: TreeSpecies;
  /** 0..1, to vary the colour a little from tree to tree. */
  tone: number;
}

/** The share of each kind of tree that grows in a climate (when a group names none). */
export function climateTrees(c: CityClimate): [TreeSpecies, number][] {
  const T = c.temperature, M = c.moisture;
  if (T < 0.3) return [["conifer", 0.85], ["broadleaf", 0.15]];
  if (T < 0.6) return M < 0.25 ? [["broadleaf", 0.5], ["thorn", 0.3], ["conifer", 0.2]] : [["broadleaf", 0.72], ["conifer", 0.28]];
  if (T < 0.85) return M < 0.2 ? [["thorn", 0.8], ["olive", 0.2]] : M < 0.5 ? [["olive", 0.45], ["cypress", 0.25], ["broadleaf", 0.3]] : [["broadleaf", 0.85], ["palm", 0.15]];
  return M < 0.25 ? [["thorn", 0.7], ["palm", 0.3]] : [["palm", 0.45], ["broadleaf", 0.55]];
}

/** What an orchard grows in a climate: olives where it is warm and dry, palms (dates) in the tropics, fruit trees (broadleaf) elsewhere. */
function orchardSpecies(c: CityClimate): TreeSpecies {
  return c.temperature >= 0.6 && c.moisture < 0.5 ? "olive" : c.temperature >= 0.85 ? "palm" : "broadleaf";
}

const DEFAULT_SIZE: Record<MapTrees["kind"], number> = { wood: 7, orchard: 5, scattered: 7, row: 6, tree: 8 };
/** The most crowns one group may have (a bigger wood gets its trees spaced wider). */
export const MAX_CROWNS = 6000;

/** Every tree of a group, where it stands and how big it is, worked out the same way every time (from the group's id). */
export function treeCrowns(t: MapTrees, c: CityClimate): TreeCrown[] {
  const seed = hashStr(t.id), size = t.size ?? DEFAULT_SIZE[t.kind] ?? 6, pts = t.points as Pt[];
  const mixOf = t.species ? [[t.species, 1] as [TreeSpecies, number]] : t.kind === "orchard" ? [[orchardSpecies(c), 1] as [TreeSpecies, number]] : climateTrees(c);
  let n = 0;
  const pick = (): TreeSpecies => {
    let u = hash3(n, 7, seed);
    for (const [s, w] of mixOf) { if (u < w) return s; u -= w; }
    return mixOf[mixOf.length - 1][0];
  };
  const crown = (x: number, y: number, scale: number): TreeCrown => {
    n++;
    const sp = pick();
    const narrow = sp === "cypress" ? 0.55 : sp === "thorn" ? 0.75 : 1;
    return { x: r2(x), y: r2(y), r: r2((size / 2) * scale * narrow), species: sp, tone: hash3(n, 11, seed) };
  };
  if (t.kind === "tree") return pts.length ? [crown(pts[0][0], pts[0][1], 1)] : [];
  if (t.kind === "row") {
    // a tree every so many metres along the whole line, corners and all
    const out: TreeCrown[] = [], cum = [0];
    for (let i = 0; i + 1 < pts.length; i++) cum.push(cum[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    const total = cum[cum.length - 1];
    let step = size * 1.35;
    if (total / step > MAX_CROWNS) step = total / MAX_CROWNS;
    let seg = 0;
    for (let d = 0; d <= total + 1e-6; d += step) {
      const at = clamp(d + (hash3(out.length, 3, seed) - 0.5) * 0.2 * step, 0, total);
      while (seg + 2 < cum.length && cum[seg + 1] < at) seg++;
      const len = cum[seg + 1] - cum[seg], f = len > 0 ? (at - cum[seg]) / len : 0;
      const [ax, ay] = pts[seg], [bx, by] = pts[seg + 1];
      out.push(crown(ax + (bx - ax) * f, ay + (by - ay) * f, 0.9 + 0.2 * hash3(out.length, 5, seed)));
    }
    return out;
  }
  // an area: a grid over the outline, jittered (a wood a lot, an orchard hardly), with every point outside the outline left out
  if (pts.length < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  let step = t.kind === "wood" ? size * 0.78 : t.kind === "orchard" ? size * 1.7 : size * 2.4;
  const jitter = t.kind === "wood" ? 0.45 : t.kind === "orchard" ? 0.06 : 0.5;
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  if (area / (step * step) > MAX_CROWNS * 1.6) step = Math.sqrt(area / (MAX_CROWNS * 1.6));
  // an orchard's rows run along its longest side
  let ang = 0;
  if (t.kind === "orchard") {
    let best = -1;
    for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], l = Math.hypot(bx - ax, by - ay); if (l > best) { best = l; ang = Math.atan2(by - ay, bx - ax); } }
  }
  const ca = Math.cos(ang), sa = Math.sin(ang), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = Math.hypot(x1 - x0, y1 - y0) / 2 + step;
  const out: TreeCrown[] = [];
  for (let v = -half; v <= half && out.length < MAX_CROWNS; v += step) {
    for (let u = -half; u <= half && out.length < MAX_CROWNS; u += step) {
      const gi = Math.round(u / step), gj = Math.round(v / step);
      if (t.kind === "scattered" && hash3(gi, gj, seed ^ 0x5bd1e995) < 0.4) continue;
      const ju = (hash3(gi, gj, seed) - 0.5) * 2 * jitter * step, jv = (hash3(gj, gi, seed + 1) - 0.5) * 2 * jitter * step;
      const x = cx + (u + ju) * ca - (v + jv) * sa, y = cy + (u + ju) * sa + (v + jv) * ca;
      if (x < x0 || x > x1 || y < y0 || y > y1 || !pointInPolygon(x, y, pts)) continue;
      out.push(crown(x, y, t.kind === "orchard" ? 0.95 + 0.1 * hash3(gi, gj, seed + 2) : 0.72 + 0.5 * hash3(gi, gj, seed + 2)));
    }
  }
  return out;
}

/** A tree crown's colour: by its kind, a little lighter or darker from tree to tree, drier in a dry climate, snowy in the cold. */
export function treeColour(species: TreeSpecies, c: CityClimate, tone: number): RGB {
  const base: Record<TreeSpecies, RGB> = { conifer: [44, 72, 50], broadleaf: [72, 110, 50], palm: [86, 128, 60], olive: [116, 126, 94], cypress: [38, 62, 42], thorn: [116, 110, 70] };
  let col = base[species];
  if (species === "broadleaf") col = mix(mix(col, [104, 114, 58], clamp((0.5 - c.moisture) / 0.3, 0, 1)), [56, 108, 42], clamp((c.moisture - 0.7) / 0.2, 0, 1));
  const k = 0.88 + 0.24 * tone;
  col = col.map((v) => clamp(Math.round(v * k), 0, 255)) as RGB;
  return mix(col, SNOW, snowCover(c) * (species === "conifer" || species === "cypress" ? 0.3 : 0.45));
}

// ---------------------------------------------------------------- checking what comes from outside

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const POINTS_NEEDED: Record<MapLandform["kind"], [number, number]> = { hill: [1, 1], ridge: [2, 200], plateau: [3, 200], slope: [2, 2] };

/** A landform from outside (a message or a tool), checked and tidied; an error message when it can't be one. */
export function cleanLandform(raw: unknown, spec: CitySpec): MapLandform | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "not a landform" };
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_OK.test(o.id)) return { error: "a landform needs an id" };
  if (typeof o.kind !== "string" || !(LANDFORM_KINDS as readonly string[]).includes(o.kind)) return { error: `landform ${o.id} needs a kind: ${LANDFORM_KINDS.join(", ")}` };
  const kind = o.kind as MapLandform["kind"], [lo, hi] = POINTS_NEEDED[kind];
  const points = cleanPoints(o.points, lo, spec);
  if (typeof points === "string") return { error: `landform ${o.id} ${points}` };
  if (points.length > hi) return { error: `a ${kind} has ${hi === 1 ? "one point (its top)" : hi === 2 ? "two points (from low to high)" : `at most ${hi} points`}` };
  if (kind === "plateau" && polygonSelfIntersects(points)) return { error: `landform ${o.id}'s outline crosses itself` };
  if (!finite(o.height) || Math.abs(o.height) < 0.1 || Math.abs(o.height) > 1500) return { error: `landform ${o.id}'s height must be between 0.1 and 1500 metres (negative for a valley or a hollow)` };
  const radius = finite(o.radius) ? o.radius : kind === "slope" ? 0 : NaN;
  if (kind !== "slope" && !(radius >= 1 && radius <= 10000)) return { error: `landform ${o.id} needs a radius between 1 and 10000 metres (${kind === "hill" ? "the hill's radius" : kind === "ridge" ? "half its width" : "the width of its soft edge"})` };
  const out: MapLandform = { id: o.id, kind, points, height: r2(o.height), radius: r2(Math.max(0, radius)) };
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
  return out;
}

const TREE_POINTS: Record<MapTrees["kind"], [number, number]> = { tree: [1, 1], row: [2, 200], wood: [3, 200], orchard: [3, 200], scattered: [3, 200] };

/** A group of trees from outside, checked and tidied. */
export function cleanTrees(raw: unknown, spec: CitySpec): MapTrees | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "not a group of trees" };
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_OK.test(o.id)) return { error: "a group of trees needs an id" };
  if (typeof o.kind !== "string" || !(TREE_GROUPS as readonly string[]).includes(o.kind)) return { error: `trees ${o.id} need a kind: ${TREE_GROUPS.join(", ")}` };
  const kind = o.kind as MapTrees["kind"], [lo, hi] = TREE_POINTS[kind];
  const points = cleanPoints(o.points, lo, spec);
  if (typeof points === "string") return { error: `trees ${o.id} ${points}` };
  if (points.length > hi) return { error: `a single tree has one point` };
  if (lo >= 3 && polygonSelfIntersects(points)) return { error: `trees ${o.id}: the outline crosses itself` };
  const out: MapTrees = { id: o.id, kind, points };
  if (finite(o.size)) { if (o.size < 1 || o.size > 40) return { error: `trees ${o.id}: a crown is between 1 and 40 metres across` }; out.size = r2(o.size); }
  if (typeof o.species === "string") { if (!(TREE_SPECIES as readonly string[]).includes(o.species)) return { error: `trees ${o.id}: the kinds of tree are ${TREE_SPECIES.join(", ")}` }; out.species = o.species as TreeSpecies; }
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
  return out;
}

/** A climate from outside, or an error. */
export function cleanClimate(raw: unknown): CityClimate | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "a climate is a temperature and a moisture, each 0 to 1" };
  const o = raw as Record<string, unknown>;
  if (!finite(o.temperature) || !finite(o.moisture) || o.temperature < 0 || o.temperature > 1 || o.moisture < 0 || o.moisture > 1) return { error: "a climate's temperature and moisture are each 0 to 1" };
  return { temperature: Math.round(o.temperature * 1000) / 1000, moisture: Math.round(o.moisture * 1000) / 1000 };
}
