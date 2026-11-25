/**
 * City maps: a city seen from above, made of buildings, streets and ground. Everything is in METRES from the map's top-left corner.
 *
 * It reuses the map document: the heightfield holds the ground material of coarse cells (`cellM` metres each, the same material ids as a battlemap's floor: grass, cobblestone,
 * water...), and the buildings and streets live with the other features. A building is drawn as a roof (battleRoof.ts), which is what a building looks like from above.
 */
import { HeightField, type MapDoc } from "./doc.ts";
import { type LabelKind, type MapBuilding, type MapRoof, type MapStreet, type RoofStyle, ROOF_STYLES, STREET_KINDS, cleanNameSize, emptyFeatures } from "./features.ts";
import { ROOF_BASE, roofColour } from "./battleRoof.ts";
import { parseAssetId } from "./assets.ts";
import { DEFAULT_ROOF_TILE_M } from "./roofAssets.ts";
import { MATERIALS } from "./battle.ts";
// (polygonCentroid, pointInPolygon and distToSegment are core's own, from regions.ts and geom.ts)

type Pt = [number, number];

export interface CitySpec {
  /** The city's size in metres. */
  widthM: number;
  heightM: number;
  /** Metres per ground cell (the ground is painted at this resolution; buildings and streets are not limited by it). */
  cellM: number;
  /** The climate (cityLand.ts): colours the grass, brings snow or dust, and picks the trees. A city made before climates is temperate. */
  climate?: CityClimate;
  /** Metres above the sea of the city's ground before its landforms (shown and used for the climate; 0 when unknown). */
  elevation?: number;
}

/** The same scales as a world map's climate regions: temperature 0 frozen, 0.25 cold, 0.5 temperate, 0.75 warm, 1 hot; moisture 0 desert to 1 rainforest. */
export interface CityClimate {
  temperature: number;
  moisture: number;
}

export function isCity(doc: MapDoc | { meta: { kind: string } }): boolean {
  return doc.meta.kind === "city";
}

/** A terrain map: the kind the climate, rivers and painted style belong to. (Anything that is not a battlemap or a city.) */
export function isWorld(doc: MapDoc | { meta: { kind: string } }): boolean {
  return doc.meta.kind !== "battle" && doc.meta.kind !== "city";
}

export function citySpec(doc: MapDoc): CitySpec {
  const c = doc.meta.city;
  if (!c) throw new Error("This isn't a city map.");
  return c;
}

export const CITY_MIN_M = 50;
export const CITY_MAX_M = 6000;
/** The most ground cells (the ground picture is held and sent whole). */
export const CITY_MAX_CELLS = 4_000_000;
/** The ground material a new city starts with (grass). */
export const CITY_GROUND = 5;

/** A ground cell size that keeps the longest side at 1500 cells or fewer: 1, 2, 4, 8 or 16 metres. */
export function defaultCellM(widthM: number, heightM: number): number {
  const longest = Math.max(widthM, heightM);
  for (const c of [1, 2, 4, 8, 16]) if (longest / c <= 1500) return c;
  return 16;
}

/** The ground grid's size in cells. */
export function cityCells(spec: CitySpec): { w: number; h: number } {
  return { w: Math.max(1, Math.ceil(spec.widthM / spec.cellM)), h: Math.max(1, Math.ceil(spec.heightM / spec.cellM)) };
}

/** An error message when the size is out of range, else null. */
export function citySizeError(widthM: number, heightM: number, cellM: number): string | null {
  if (!(Number.isFinite(widthM) && Number.isFinite(heightM) && Number.isFinite(cellM))) return "The city's size must be numbers.";
  if (widthM < CITY_MIN_M || heightM < CITY_MIN_M) return `A city map needs at least ${CITY_MIN_M} x ${CITY_MIN_M} metres.`;
  if (widthM > CITY_MAX_M || heightM > CITY_MAX_M) return `A city map can be at most ${CITY_MAX_M} metres (${CITY_MAX_M / 1000} km) on a side.`;
  if (!(cellM >= 0.5 && cellM <= 32)) return "A ground cell must be between 0.5 and 32 metres.";
  const { w, h } = cityCells({ widthM, heightM, cellM });
  if (w * h > CITY_MAX_CELLS) return `That would be ${w} x ${h} ground cells (the limit is ${CITY_MAX_CELLS.toLocaleString()} cells): use bigger cells (at least ${Math.ceil(Math.sqrt((widthM * heightM) / CITY_MAX_CELLS) * 10) / 10} m).`;
  return null;
}

export interface CreateCityOptions {
  id: string;
  name: string;
  widthM: number;
  heightM: number;
  cellM?: number;
  seed?: number;
  /** Ground material id the city starts with (default grass). */
  ground?: number;
}

export function createCityDoc(o: CreateCityOptions): MapDoc {
  const spec: CitySpec = { widthM: Math.round(o.widthM * 100) / 100, heightM: Math.round(o.heightM * 100) / 100, cellM: o.cellM ?? defaultCellM(o.widthM, o.heightM) };
  const { w, h } = cityCells(spec);
  const now = new Date().toISOString();
  const hf = new HeightField(w, h);
  hf.data.fill(o.ground ?? CITY_GROUND);
  return {
    meta: { id: o.id, name: o.name, kind: "city", width: w, height: h, kmPerPx: spec.cellM / 1000, seaLevel: 0, seed: o.seed ?? 1, createdAt: now, updatedAt: now, city: spec },
    height: hf,
    features: { ...emptyFeatures(), buildings: [], streets: [] },
  };
}

// ---------------------------------------------------------------- geometry

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The four corners of a rectangle of w x h metres centred on (cx, cy), turned `angleDeg` clockwise on screen (y runs down). */
export function rectPolygon(cx: number, cy: number, w: number, h: number, angleDeg = 0): Pt[] {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), hw = w / 2, hh = h / 2;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as Pt[]).map(([u, v]) => [r2(cx + u * c - v * s), r2(cy + u * s + v * c)] as Pt);
}

/** Area in square metres. */
export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
}

export function pointsBounds(p: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Does the outline cross itself (a bow-tie)? */
export function polygonSelfIntersects(p: Pt[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // (the first and last edges share a corner)
      if (segmentsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- buildings as roofs

const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The colour a building is drawn with: its own, or its roof look's colour in a shade that depends on its id (a little lighter or darker, a little warmer or cooler). */
export function buildingColour(b: MapBuilding): [number, number, number] {
  const own = roofColour(b.colour);
  if (own) return own;
  const base = ROOF_BASE[b.roof ?? "slate"] ?? ROOF_BASE.slate, h = hash32(b.id);
  const light = 0.9 + ((h & 255) / 255) * 0.2, warm = ((((h >> 8) & 255) / 255) - 0.5) * 0.08;
  return [Math.round(Math.min(255, base[0] * light * (1 + warm))), Math.round(Math.min(255, base[1] * light)), Math.round(Math.min(255, base[2] * light * (1 - warm)))];
}

const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * A building as the battlemap roof it is drawn as (outline in metres). With a roof picture (`asset`) the picture is tiled across it, tinted only by a colour the DM gave;
 * `assetOk` says whether that picture can be had (when it can't, the roof falls back to drawing its look, in the building's own shade).
 */
export function buildingToRoof(b: MapBuilding, assetOk = true): MapRoof {
  const picture = !!b.asset && assetOk;
  const colour = picture ? roofColour(b.colour) && b.colour : hex(buildingColour(b));
  return { id: b.id, points: b.points, style: b.roof ?? "slate", ...(colour && { colour }), ...(b.flat && { flat: true }), ...(picture && { asset: b.asset, tile: b.tile ?? DEFAULT_ROOF_TILE_M }) };
}

// ---------------------------------------------------------------- checking what comes from outside

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Points from outside, checked to be numbers inside the city and rounded to the centimetre; an error message (to follow the thing's name) when they aren't. */
export function cleanPoints(raw: unknown, min: number, spec: CitySpec): Pt[] | string {
  if (!Array.isArray(raw) || raw.length < min) return `needs at least ${min} points`;
  if (raw.length > 200) return "has more than 200 points";
  const out: Pt[] = [];
  for (const q of raw) {
    if (!Array.isArray(q) || q.length !== 2 || !finite(q[0]) || !finite(q[1])) return "has a point that isn't two numbers";
    if (q[0] < 0 || q[1] < 0 || q[0] > spec.widthM || q[1] > spec.heightM) return `has a point (${q[0]}, ${q[1]}) outside the map, which is ${spec.widthM} x ${spec.heightM} metres`;
    out.push([r2(q[0]), r2(q[1])]);
  }
  return out;
}

/** A building from outside (a message or a tool), checked and tidied; an error message when it can't be a building of this city. */
export function cleanBuilding(b: unknown, spec: CitySpec): MapBuilding | { error: string } {
  if (!b || typeof b !== "object") return { error: "not a building" };
  const o = b as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_OK.test(o.id)) return { error: "a building needs an id" };
  const points = cleanPoints(o.points, 3, spec);
  if (typeof points === "string") return { error: `building ${o.id} ${points}` };
  // (a crossing outline first: the two lobes of a bow-tie cancel out in the area sum, so it would be reported as tiny)
  if (polygonSelfIntersects(points)) return { error: `building ${o.id}'s outline crosses itself` };
  const area = polygonArea(points);
  if (area < 1) return { error: `building ${o.id} is smaller than a square metre` };
  if (area > (spec.widthM * spec.heightM) / 4) return { error: `building ${o.id} covers more than a quarter of the city` };
  const out: MapBuilding = { id: o.id, points };
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
  const ns = cleanNameSize(o.nameSize);
  if (out.name && ns !== undefined) out.nameSize = ns;
  if (o.gmOnly === true) out.gmOnly = true;
  if (typeof o.roof === "string" && (ROOF_STYLES as readonly string[]).includes(o.roof)) out.roof = o.roof as RoofStyle;
  if (typeof o.colour === "string" && roofColour(o.colour)) out.colour = `#${o.colour.replace("#", "").toLowerCase()}`;
  if (o.flat === true) out.flat = true;
  if (typeof o.asset === "string" && o.asset.length <= 300 && parseAssetId(o.asset)) out.asset = o.asset;
  if (out.asset && finite(o.tile) && o.tile >= 0.25 && o.tile <= 20) out.tile = r2(o.tile);
  if (typeof o.kind === "string") out.kind = o.kind as MapBuilding["kind"];
  if (finite(o.floors) && o.floors >= 1 && o.floors <= 30) out.floors = Math.round(o.floors);
  return out;
}

export function streetWidthFor(kind: string | undefined): number {
  return STREET_KINDS.find((k) => k.id === kind)?.width ?? 6;
}

/** A street from outside, checked and tidied. */
export function cleanStreet(s: unknown, spec: CitySpec): MapStreet | { error: string } {
  if (!s || typeof s !== "object") return { error: "not a street" };
  const o = s as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_OK.test(o.id)) return { error: "a street needs an id" };
  const points = cleanPoints(o.points, 2, spec);
  if (typeof points === "string") return { error: `street ${o.id} ${points}` };
  const kind = typeof o.kind === "string" && STREET_KINDS.some((k) => k.id === o.kind) ? (o.kind as MapStreet["kind"]) : undefined;
  const width = finite(o.width) ? o.width : streetWidthFor(kind);
  if (width < 0.5 || width > 60) return { error: `street ${o.id}'s width must be between 0.5 and 60 metres` };
  const out: MapStreet = { id: o.id, points, width: r2(width) };
  if (kind) out.kind = kind;
  if (o.bridge === "stone" || o.bridge === "wood" || o.bridge === "none") out.bridge = o.bridge;
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
  const ns = cleanNameSize(o.nameSize);
  if (out.name && ns !== undefined) out.nameSize = ns;
  return out;
}

/**
 * The kinds of free name on a city map. They are the world map's labels (`features.labels`, the same drawing) with their place in metres: a district or quarter (big, spaced
 * capitals), a stretch of water (a harbour, a river, a pond) and a landmark or small place (a square, a gate, a garden).
 */
export const CITY_LABEL_KINDS = [
  { id: "district", kind: "region", name: "District" },
  { id: "water", kind: "sea", name: "Water" },
  { id: "landmark", kind: "feature", name: "Landmark" },
] as const satisfies readonly { id: string; kind: LabelKind; name: string }[];
export type CityLabelKind = (typeof CITY_LABEL_KINDS)[number]["id"];
/** A label's kind as a city names it (a world kind with no city name of its own reads as a landmark). */
export const cityLabelKind = (k: LabelKind): CityLabelKind => CITY_LABEL_KINDS.find((x) => x.kind === k)?.id ?? "landmark";

/** A ground material id the city can use (the battlemap materials; pack textures aren't used on city maps), or null. */
export function cityGroundMaterial(id: number): number | null {
  const m = Math.round(id);
  return Number.isFinite(m) && m >= 1 && m < MATERIALS.length ? m : null;
}
