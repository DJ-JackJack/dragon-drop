/**
 * What the DM has selected on the map, and what that means for Claude.
 *
 * A selection is a point, an area (rectangle, circle, or a polygon drawn freehand or corner by corner) or one feature (a place, label, line, climate region, river source, or
 * a named river or lake).
 * The editor sends it to the server; Claude reads it with `get_selection`, and an area (or a climate region) can also *lock* Claude's edits:
 * while the lock is on, terrain changes Claude makes are clipped to the area (with a soft edge inside it, nothing outside changes) and
 * feature edits outside it are refused. All of that lives here as pure functions so the editor, server and tests share one meaning.
 */
import type { Derived } from "./climate.ts";
import type { MapDoc } from "./doc.ts";
import type { FeaturesPatch, Features, RiverSource } from "./features.ts";
import { BIOMES, GROUNDS, biomeWeights, dominantBiome, emptyBiomeWeights } from "./biomeLook.ts";
import { applyPaintedGround } from "./groundPaint.ts";
import { resolveWaterNames, riverNet, seaNear } from "./waterNames.ts";
import { smoothstep } from "./noise.ts";
import { desertWeight, jungleWeight } from "./painted.ts";
import { MI_PER_KM } from "./grid.ts";
import { type Point, type Rect, type Shape, clipRect, pointInPolygon, shapeBounds, signedDistance } from "./geom.ts";

/** "water": a named river or lake (its `WaterName` id). */
export type SelectedFeatureKind = "place" | "label" | "line" | "region" | "source" | "water";
export type SelectableShape = Extract<Shape, { type: "rect" | "circle" | "polygon" }>;

export type Selection =
  | { kind: "point"; x: number; y: number }
  | { kind: "area"; shape: SelectableShape }
  | { kind: "feature"; featureKind: SelectedFeatureKind; id: string };

/** What the DM is looking at in the editor. */
export interface ViewInfo {
  rect: Rect;
  /** Screen pixels per map pixel. */
  zoom: number;
}

/** Claude's terrain edits are clipped to this shape (see MapSession.editLock). */
export interface EditLock {
  shape: SelectableShape;
  /** Width of the soft edge inside the shape, map px. */
  featherPx: number;
}

const FEATURE_KINDS: SelectedFeatureKind[] = ["place", "label", "line", "region", "source", "water"];
const MAX_POLYGON_POINTS = 1000;
const ID_RE = /^[\w.-]{1,64}$/;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Make a selection from whatever arrived over the wire: sensible numbers inside the map, or null if it isn't one. */
export function cleanSelection(raw: unknown, W: number, H: number): Selection | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cx = (v: unknown) => { const n = num(v); return n === null ? null : round1(Math.min(W, Math.max(0, n))); };
  const cy = (v: unknown) => { const n = num(v); return n === null ? null : round1(Math.min(H, Math.max(0, n))); };
  if (o.kind === "point") {
    const x = cx(o.x), y = cy(o.y);
    return x === null || y === null ? null : { kind: "point", x, y };
  }
  if (o.kind === "feature") {
    if (!FEATURE_KINDS.includes(o.featureKind as SelectedFeatureKind) || typeof o.id !== "string" || !ID_RE.test(o.id)) return null;
    return { kind: "feature", featureKind: o.featureKind as SelectedFeatureKind, id: o.id };
  }
  if (o.kind === "area" && o.shape && typeof o.shape === "object") {
    const s = o.shape as Record<string, unknown>;
    if (s.type === "rect") {
      const rx = num(s.x), ry = num(s.y), w = num(s.w), h = num(s.h);
      if (rx === null || ry === null || w === null || h === null) return null;
      // clamp both corners (not the origin and then the size), so a rectangle hanging over the edge is cut off there
      const x = cx(rx), y = cy(ry), x1 = cx(rx + w), y1 = cy(ry + h);
      if (x === null || y === null || x1 === null || y1 === null || x1 - x < 1 || y1 - y < 1) return null;
      return { kind: "area", shape: { type: "rect", x, y, w: round1(x1 - x), h: round1(y1 - y) } };
    }
    if (s.type === "circle") {
      const x = cx(s.x), y = cy(s.y), r = num(s.r);
      if (x === null || y === null || r === null || r < 1) return null;
      return { kind: "area", shape: { type: "circle", x, y, r: round1(Math.min(r, Math.max(W, H))) } };
    }
    if (s.type === "polygon" && Array.isArray(s.points) && s.points.length >= 3 && s.points.length <= MAX_POLYGON_POINTS) {
      const pts: Point[] = [];
      for (const p of s.points) {
        if (!Array.isArray(p)) return null;
        const x = cx(p[0]), y = cy(p[1]);
        if (x === null || y === null) return null;
        pts.push([x, y]);
      }
      return { kind: "area", shape: { type: "polygon", points: pts } };
    }
  }
  return null;
}

/** The view the editor reports (kept sane: finite numbers, a real rectangle). */
export function cleanView(raw: unknown): ViewInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { rect?: Record<string, unknown>; zoom?: unknown };
  const r = o.rect;
  const x = num(r?.x), y = num(r?.y), w = num(r?.w), h = num(r?.h), zoom = num(o.zoom);
  if (x === null || y === null || w === null || h === null || zoom === null || w <= 0 || h <= 0 || zoom <= 0) return null;
  return { rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, zoom: Math.round(zoom * 1000) / 1000 };
}

/** Is the selected feature still on the map? */
export function selectionFeatureExists(sel: Extract<Selection, { kind: "feature" }>, f: Features | undefined): boolean {
  switch (sel.featureKind) {
    case "place": return !!f?.places.some((p) => p.id === sel.id);
    case "label": return !!f?.labels.some((l) => l.id === sel.id);
    case "line": return !!f?.lines?.some((l) => l.id === sel.id);
    case "region": return !!f?.regions?.some((r) => r.id === sel.id);
    case "source": return !!f?.sources?.some((x) => x.id === sel.id);
    case "water": return !!f?.waterNames?.some((x) => x.id === sel.id);
  }
}

/** The area a selection covers, if it covers one: an area, or a climate region's outline. */
export function selectionShape(sel: Selection | null, f?: Features): SelectableShape | null {
  if (!sel) return null;
  if (sel.kind === "area") return sel.shape;
  if (sel.kind === "feature" && sel.featureKind === "region") {
    const r = f?.regions?.find((x) => x.id === sel.id);
    return r && r.polygon.length >= 3 ? { type: "polygon", points: r.polygon.map(([x, y]) => [x, y] as Point) } : null;
  }
  return null;
}

/** A soft edge in proportion to the area: about a fifth of its half-size, between 2 and 40 map px. */
export function defaultFeather(shape: SelectableShape): number {
  const b = shapeBounds(shape, 1e6, 1e6);
  return Math.round(Math.min(40, Math.max(2, Math.min(b.w, b.h) * 0.1)));
}

/** True when a point is inside the shape (or within `tol` px outside it). */
export function shapeContains(shape: Shape, x: number, y: number, tol = 0): boolean {
  return signedDistance(shape, x, y) >= -tol;
}

/** How much of a change at each pixel is kept: 0 outside the shape, ramping to 1 across the soft edge inside it. */
export interface SelectionMask {
  rect: Rect;
  /** rect.w * rect.h weights, row by row. */
  data: Float32Array;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function selectionMask(shape: SelectableShape, W: number, H: number, featherPx: number): SelectionMask {
  const rect = clipRect(shapeBounds(shape, W, H), W, H) ?? { x: 0, y: 0, w: 0, h: 0 };
  const data = new Float32Array(rect.w * rect.h);
  if (!data.length) return { rect, data };
  const f = Math.max(0, featherPx);
  if (shape.type !== "polygon") {
    for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
      const sd = signedDistance(shape, rect.x + x + 0.5, rect.y + y + 0.5);
      data[y * rect.w + x] = sd <= 0 ? 0 : f <= 0 ? 1 : smooth(Math.min(1, sd / f));
    }
    return { rect, data };
  }
  // polygons: fill each row between the edges' crossings, then measure how far in each pixel is with a two-pass chamfer
  const pts = shape.points, n = pts.length, w = rect.w, h = rect.h;
  const inside = new Uint8Array(w * h);
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const yc = rect.y + y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - rect.x - 0.5)), x1 = Math.min(w - 1, Math.ceil(xs[k + 1] - rect.x - 0.5) - 1);
      for (let x = x0; x <= x1; x++) inside[y * w + x] = 1;
    }
  }
  if (f <= 0) {
    for (let i = 0; i < inside.length; i++) data[i] = inside[i];
    return { rect, data };
  }
  const BIG = f + 4, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? BIG : 0;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, (x > 0 ? d[i - 1] : 0) + 1, (y > 0 ? d[i - w] : 0) + 1, (x > 0 && y > 0 ? d[i - w - 1] : 0) + D, (x < w - 1 && y > 0 ? d[i - w + 1] : 0) + D);
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, (x < w - 1 ? d[i + 1] : 0) + 1, (y < h - 1 ? d[i + w] : 0) + 1, (x < w - 1 && y < h - 1 ? d[i + w + 1] : 0) + D, (x > 0 && y < h - 1 ? d[i + w - 1] : 0) + D);
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) data[i] = d[i] === 0 ? 0 : smooth(Math.min(1, Math.max(0, d[i] - 0.5) / f));
  return { rect, data };
}

// ------------------------------------------------------------------------------------------------- the lock on feature edits

interface Spot { what: string; points: Point[] }

function spotsOfPatch(patch: FeaturesPatch, f: Features): Spot[] {
  const spots: Spot[] = [];
  const placeAt = new Map(f.places.map((p) => [p.id, p]));
  for (const p of patch.upsertPlaces ?? []) { placeAt.set(p.id, p); spots.push({ what: `the place ${p.name}`, points: [[p.x, p.y]] }); }
  for (const id of patch.removePlaces ?? []) { const p = f.places.find((x) => x.id === id); if (p) spots.push({ what: `the place ${p.name}`, points: [[p.x, p.y]] }); }
  for (const l of patch.upsertLabels ?? []) spots.push({ what: `the label ${l.text}`, points: [[l.x, l.y]] });
  for (const id of patch.removeLabels ?? []) { const l = f.labels.find((x) => x.id === id); if (l) spots.push({ what: `the label ${l.text}`, points: [[l.x, l.y]] }); }
  for (const l of patch.upsertLines ?? []) spots.push({ what: `the ${l.kind}${l.name ? ` ${l.name}` : ""}`, points: l.points });
  for (const id of patch.removeLines ?? []) { const l = (f.lines ?? []).find((x) => x.id === id); if (l) spots.push({ what: `the ${l.kind}${l.name ? ` ${l.name}` : ""}`, points: l.points }); }
  for (const r of patch.upsertRegions ?? []) spots.push({ what: `the climate region ${r.name}`, points: r.polygon });
  for (const id of patch.removeRegions ?? []) { const r = (f.regions ?? []).find((x) => x.id === id); if (r) spots.push({ what: `the climate region ${r.name}`, points: r.polygon }); }
  const sourceSpot = (s: RiverSource): Spot | null => {
    const at = s.placeId ? placeAt.get(s.placeId) : s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y } : undefined;
    return at ? { what: `the river source${s.name ? ` ${s.name}` : ""}`, points: [[at.x, at.y]] } : null;
  };
  for (const s of patch.upsertSources ?? []) { const sp = sourceSpot(s); if (sp) spots.push(sp); }
  for (const id of patch.removeSources ?? []) { const s = (f.sources ?? []).find((x) => x.id === id); const sp = s && sourceSpot(s); if (sp) spots.push(sp); }
  for (const w of patch.upsertWaterNames ?? []) spots.push({ what: `the name of the ${w.kind} ${w.name}`, points: [[w.x, w.y]] });
  for (const id of patch.removeWaterNames ?? []) { const w = (f.waterNames ?? []).find((x) => x.id === id); if (w) spots.push({ what: `the name of the ${w.kind} ${w.name}`, points: [[w.x, w.y]] }); }
  return spots;
}

/** What a features command would touch outside the lock (empty when it all lies inside). */
export function featuresOutsideLock(patch: FeaturesPatch, f: Features, lock: EditLock): string[] {
  const out: string[] = [];
  for (const sp of spotsOfPatch(patch, f)) if (sp.points.some(([x, y]) => !shapeContains(lock.shape, x, y, 0.5))) out.push(sp.what);
  return out;
}

/** A good window for a preview of a selection: the area with a margin, or a small window round a point or feature. Null if there is nothing to show. */
export function selectionFocusRect(doc: MapDoc, sel: Selection | null): Rect | null {
  if (!sel) return null;
  const { width: W, height: H } = doc.meta, f = doc.features;
  const around = (x: number, y: number, size: number) => clipRect({ x: x - size / 2, y: y - size / 2, w: size, h: size }, W, H);
  const padded = (b: Rect) => {
    const m = Math.max(24, Math.round(Math.max(b.w, b.h) * 0.15));
    return clipRect({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, W, H);
  };
  if (sel.kind === "point") return around(sel.x, sel.y, 200);
  if (sel.kind === "area") return padded(shapeBounds(sel.shape, W, H));
  const key = sel.featureKind;
  if (key === "place") { const p = f?.places.find((x) => x.id === sel.id); return p ? around(p.x, p.y, 200) : null; }
  if (key === "label") { const l = f?.labels.find((x) => x.id === sel.id); return l ? around(l.x, l.y, 200) : null; }
  if (key === "water") { const w = f?.waterNames?.find((x) => x.id === sel.id); return w ? around(w.x, w.y, 200) : null; }
  if (key === "source") {
    const s = f?.sources?.find((x) => x.id === sel.id);
    const at = s?.placeId ? f?.places.find((p) => p.id === s.placeId) : s && s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y } : undefined;
    return at ? around(at.x, at.y, 200) : null;
  }
  const pts = key === "line" ? f?.lines?.find((x) => x.id === sel.id)?.points : f?.regions?.find((x) => x.id === sel.id)?.polygon;
  if (!pts?.length) return null;
  const b = shapeBounds({ type: "polygon", points: pts }, W, H);
  return padded({ x: b.x, y: b.y, w: Math.max(b.w, 16), h: Math.max(b.h, 16) });
}

// ------------------------------------------------------------------------------------------------- what Claude is told

export interface SelectionReport {
  kind: Selection["kind"];
  description: string;
  shape?: SelectableShape;
  bounds?: Rect;
  /** Size of the bounds in real units. */
  sizeKm?: { w: number; h: number };
  sizeMiles?: { w: number; h: number };
  areaKm2?: number;
  point?: { x: number; y: number; elevationM: number; isLand: boolean; temperature?: number; moisture?: number; onRiver?: boolean; inLake?: boolean };
  elevationM?: { min: number; mean: number; max: number };
  landShare?: number;
  /** 0..1 means over the area. */
  climate?: { temperature: number; moisture: number; /** The ground the climate makes: the most common of `biomes`. */ biome: string };
  /** Each kind of ground (tundra, boreal, temperate, warm, alpine, savanna, steppe, marsh, beach, mangrove, reeds, glacier, moor, chaparral, badlands, saltflat, jungle, desert) and the share of the land it covers (5% or more), biggest first. */
  biomes?: { name: string; share: number }[];
  rivers?: { count: number; lengthKm: number };
  lakes?: { cells: number; areaKm2: number };
  inside?: { places: { id: string; name: string }[]; labels: { id: string; text: string }[]; lines: { id: string; kind: string; name?: string }[]; regions: { id: string; name: string }[]; sources: { id: string; name?: string; size: string }[] };
  feature?: unknown;
}

const r0 = (n: number) => Math.round(n);

/** A readable one-liner for a selection (for chips, hints and the terminal message). */
export function describeSelection(sel: Selection | null, f: Features | undefined, kmPerPx: number): string {
  if (!sel) return "nothing selected";
  const km = (px: number) => `${r0(px * kmPerPx).toLocaleString("en-US")} km (${r0(px * kmPerPx * MI_PER_KM).toLocaleString("en-US")} mi)`;
  if (sel.kind === "point") return `the point (${r0(sel.x)}, ${r0(sel.y)})`;
  if (sel.kind === "area") {
    const s = sel.shape;
    if (s.type === "circle") return `a circle of radius ${r0(s.r)} px (${km(s.r)}) centred at (${r0(s.x)}, ${r0(s.y)})`;
    if (s.type === "rect") {
      const n = (v: number) => r0(v).toLocaleString("en-US");
      return `a ${r0(s.w)}×${r0(s.h)} px rectangle (${n(s.w * kmPerPx)} × ${n(s.h * kmPerPx)} km, ${n(s.w * kmPerPx * MI_PER_KM)} × ${n(s.h * kmPerPx * MI_PER_KM)} mi) at (${r0(s.x)}, ${r0(s.y)})`;
    }
    const b = shapeBounds(s, 1e6, 1e6);
    return `a polygon of ${s.points.length} points, about ${r0(b.w)}×${r0(b.h)} px, at (${r0(b.x)}, ${r0(b.y)})`;
  }
  const name = (() => {
    if (sel.featureKind === "place") return f?.places.find((p) => p.id === sel.id)?.name;
    if (sel.featureKind === "label") return f?.labels.find((l) => l.id === sel.id)?.text;
    if (sel.featureKind === "line") { const l = f?.lines?.find((x) => x.id === sel.id); return l ? l.name ?? l.kind : undefined; }
    if (sel.featureKind === "region") return f?.regions?.find((r) => r.id === sel.id)?.name;
    if (sel.featureKind === "water") return f?.waterNames?.find((w) => w.id === sel.id)?.name;
    const s = f?.sources?.find((x) => x.id === sel.id);
    return s ? s.name ?? (s.placeId ? f?.places.find((p) => p.id === s.placeId)?.name : undefined) ?? "a river source" : undefined;
  })();
  const word = sel.featureKind === "source" ? "river source" : sel.featureKind === "region" ? "climate region"
    : sel.featureKind === "water" ? f?.waterNames?.find((w) => w.id === sel.id)?.kind ?? "river or lake" : sel.featureKind;
  return `the ${word}${name ? ` "${name}"` : ` (${sel.id}, no longer on the map)`}`;
}

/** A named river or lake with what the water is now: whether it was found, its length and where it ends, or its size. */
function waterFacts(doc: MapDoc, derived: Derived | null, id: string): unknown {
  const w = doc.features?.waterNames?.find((x) => x.id === id);
  if (!w || !derived?.hydro) return w;
  const hf = doc.height;
  const [facts] = resolveWaterNames([w], riverNet(derived.rivers), derived.hydro.shapes, { mapWidth: doc.meta.width, kmPerPx: doc.meta.kmPerPx, isSea: seaNear(hf.data, hf.w, hf.h, doc.meta.seaLevel) }).named;
  const { head: _h, lake: _l, ...rest } = facts;
  return { ...w, ...rest };
}

/** The facts about a selection that Claude can't see in a picture: numbers and what lies inside. */
export function selectionReport(doc: MapDoc, derived: Derived | null, sel: Selection): SelectionReport {
  const { width: W, height: H, kmPerPx } = doc.meta;
  const hf = doc.height, f = doc.features;
  const rep: SelectionReport = { kind: sel.kind, description: describeSelection(sel, f, kmPerPx) };
  const mi = (v: number) => Math.round(v * MI_PER_KM);

  if (sel.kind === "point") {
    const e = Math.round(hf.sample(sel.x, sel.y));
    const c = Math.min(H - 1, Math.floor(sel.y)) * W + Math.min(W - 1, Math.floor(sel.x));
    const p: NonNullable<SelectionReport["point"]> = { x: sel.x, y: sel.y, elevationM: e, isLand: e > doc.meta.seaLevel };
    if (derived) {
      p.temperature = Math.round((derived.temp[c] / 255) * 100) / 100;
      p.moisture = Math.round((derived.moist[c] / 255) * 100) / 100;
      p.inLake = !!derived.lakes[c];
      p.onRiver = derived.rivers.some((rv) => { for (let k = 0; k < rv.pts.length; k += 2) if (Math.abs(rv.pts[k] - sel.x) < 3 && Math.abs(rv.pts[k + 1] - sel.y) < 3) return true; return false; });
    }
    rep.point = p;
    return rep;
  }

  if (sel.kind === "feature") {
    const key = sel.featureKind;
    rep.feature = key === "place" ? f?.places.find((x) => x.id === sel.id)
      : key === "label" ? f?.labels.find((x) => x.id === sel.id)
      : key === "line" ? f?.lines?.find((x) => x.id === sel.id)
      : key === "region" ? f?.regions?.find((x) => x.id === sel.id)
      : key === "water" ? waterFacts(doc, derived, sel.id)
      : f?.sources?.find((x) => x.id === sel.id);
  }

  const shape = selectionShape(sel, f);
  if (!shape) return rep;
  rep.shape = shape;
  const bounds = clipRect(shapeBounds(shape, W, H), W, H);
  if (!bounds) return rep;
  rep.bounds = bounds;
  rep.sizeKm = { w: r0(bounds.w * kmPerPx), h: r0(bounds.h * kmPerPx) };
  rep.sizeMiles = { w: mi(bounds.w * kmPerPx), h: mi(bounds.h * kmPerPx) };

  const mask = selectionMask(shape, W, H, 0);
  let cells = 0, land = 0, sum = 0, lo = Infinity, hi = -Infinity, t = 0, m = 0, lakeCells = 0;
  const bw = emptyBiomeWeights(), bsum: Record<string, number> = { jungle: 0, desert: 0 };
  const kinds = [...BIOMES, ...GROUNDS.filter((g) => g !== "stony")]; // (stony is the desert's version on rugged ground, not a place of its own)
  for (const b of kinds) bsum[b] = 0;
  for (let y = 0; y < mask.rect.h; y++) for (let x = 0; x < mask.rect.w; x++) {
    if (!mask.data[y * mask.rect.w + x]) continue;
    const c = (mask.rect.y + y) * W + mask.rect.x + x, e = hf.data[c];
    cells++; sum += e; if (e < lo) lo = e; if (e > hi) hi = e; if (e > doc.meta.seaLevel) land++;
    if (derived) {
      t += derived.temp[c]; m += derived.moist[c]; if (derived.lakes[c]) lakeCells++;
      if (e > doc.meta.seaLevel) {
        const tt = derived.temp[c] / 255, mm = derived.moist[c] / 255, ee = Math.max(0, (e - doc.meta.seaLevel) / 4000);
        let jw = jungleWeight(tt, mm), dw = desertWeight(tt, mm);
        biomeWeights(tt, mm, ee, smoothstep(0.1, 0.4, ee), bw, 0, { ld: derived.landDist[c] || 255, shore: 99 });
        // (ground painted by hand counts as what is there)
        if (derived.ground && derived.groundW && derived.groundW[c]) { const jd = [jw, dw]; applyPaintedGround(derived.ground[c], derived.groundW[c] / 255, bw, jd); jw = jd[0]; dw = jd[1]; }
        const open = (1 - jw) * (1 - dw);
        for (const b of kinds) bsum[b] += bw[b] * open;
        bsum.jungle += jw; bsum.desert += dw * (1 - jw);
      }
    }
  }
  if (cells) {
    rep.areaKm2 = r0(cells * kmPerPx * kmPerPx);
    rep.elevationM = { min: r0(lo), mean: r0(sum / cells), max: r0(hi) };
    rep.landShare = Math.round((land / cells) * 100) / 100;
    if (derived) {
      const tm = t / cells / 255, mm = m / cells / 255, em = Math.max(0, (sum / cells - doc.meta.seaLevel) / 4000);
      const shares = Object.entries(bsum).map(([name, v]) => ({ name, share: land ? Math.round((v / land) * 100) / 100 : 0 })).filter((b) => b.share >= 0.05).sort((a, b) => b.share - a.share);
      if (shares.length) rep.biomes = shares;
      rep.climate = { temperature: Math.round(tm * 100) / 100, moisture: Math.round(mm * 100) / 100, biome: shares[0]?.name ?? dominantBiome(biomeWeights(tm, mm, em, smoothstep(0.1, 0.4, em))) };
      rep.lakes = { cells: lakeCells, areaKm2: r0(lakeCells * kmPerPx * kmPerPx) };
    }
  }
  if (derived) {
    let count = 0, len = 0;
    for (const rv of derived.rivers) {
      let touched = false;
      for (let k = 0; k + 3 < rv.pts.length; k += 2) {
        const mx = (rv.pts[k] + rv.pts[k + 2]) / 2, my = (rv.pts[k + 1] + rv.pts[k + 3]) / 2;
        if (shapeContains(shape, mx, my)) { touched = true; len += Math.hypot(rv.pts[k + 2] - rv.pts[k], rv.pts[k + 3] - rv.pts[k + 1]) * kmPerPx; }
      }
      if (touched) count++;
    }
    rep.rivers = { count, lengthKm: r0(len) };
  }

  const inside = (x: number, y: number) => shapeContains(shape, x, y);
  const placeAt = new Map((f?.places ?? []).map((p) => [p.id, p]));
  rep.inside = {
    places: (f?.places ?? []).filter((p) => inside(p.x, p.y)).slice(0, 40).map((p) => ({ id: p.id, name: p.name })),
    labels: (f?.labels ?? []).filter((l) => inside(l.x, l.y)).slice(0, 40).map((l) => ({ id: l.id, text: l.text })),
    lines: (f?.lines ?? []).filter((l) => l.points.some(([x, y]) => inside(x, y))).slice(0, 40).map((l) => ({ id: l.id, kind: l.kind, ...(l.name && { name: l.name }) })),
    // a region is "in" the area when one of its corners is, or the area's middle is inside the region
    regions: (f?.regions ?? []).filter((r) => r.polygon.some(([x, y]) => inside(x, y)) || pointInPolygon(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, r.polygon))
      .slice(0, 40).map((r) => ({ id: r.id, name: r.name })),
    sources: (f?.sources ?? []).filter((s) => { const at = s.placeId ? placeAt.get(s.placeId) : s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y } : undefined; return !!at && inside(at.x, at.y); })
      .slice(0, 40).map((s) => ({ id: s.id, ...(s.name && { name: s.name }), size: s.size })),
  };
  return rep;
}
