/**
 * Prefabs: a piece of a battlemap (a room, a building, a camp) saved by name to be placed again, on this map or another: its floor, walls, doors and windows,
 * objects, lights, shaded areas, stairs, roofs and paths, measured in squares from its own top-left corner. Placing one turns it by quarter turns and mirrors
 * it if asked, gives everything new ids, joins the pack floor textures it uses to the map's own, and is one edit (floor and features together, one undo step).
 * Notes (the map's key) stay with their map: they describe an adventure, not a piece.
 */
import type { MapDoc } from "./doc.ts";
import { type PaletteEntry, CUSTOM_MATERIAL_BASE, MAX_FLOOR_TEXTURES } from "./assets.ts";
import { battleSpec, createBattleDoc, isBattle } from "./battle.ts";
import type { Features, FeaturesPatch, MapProp, MapWall } from "./features.ts";
import { type FeatureClip, pasteFeatures } from "./featureOps.ts";
import type { Rect } from "./geom.ts";

export const PREFAB_FORMAT = 1;
/** The biggest prefab, in squares each way. */
export const PREFAB_MAX_SQUARES = 100;

export interface Prefab {
  format: number;
  name: string;
  /** Its size in whole squares. */
  w: number;
  h: number;
  /** Floor cells per square each way (the map's `sub` it was saved from). */
  sub: number;
  feetPerSquare: number;
  /** The floor, (w*sub) x (h*sub) cells row by row, run-length coded as [material, count, material, count...]. 0 (void) leaves the map's own floor as it is. */
  floor: number[];
  /** The pack floor textures its floor uses (their ids are the ones in `floor`). */
  palette?: PaletteEntry[];
  /** Walls, objects, lights and the rest, in squares from the prefab's top-left corner. */
  features: FeatureClip;
  /** ISO time it was saved. */
  savedAt: string;
  /** The map it was saved from (its name), for the DM's memory. */
  from?: string;
}

/** A prefab as the lists show it (the editor's picker, Claude's list_prefabs). */
export interface PrefabInfo {
  id: string;
  name: string;
  /** Size in squares. */
  w: number;
  h: number;
  /** What it holds, in words. */
  what: string;
  savedAt: string;
  /** The map it was saved from. */
  from?: string;
  /** Whether it has a picture (GET /api/prefabs/<id>.png). */
  picture: boolean;
}

/** A quarter turn, clockwise. */
export type PrefabTurn = 0 | 90 | 180 | 270;

const EPS = 0.02;

/** Run-length code a list of material ids. */
export function encodeFloor(cells: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < cells.length;) {
    const v = Math.round(cells[i]);
    let n = 1;
    while (i + n < cells.length && Math.round(cells[i + n]) === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

/** The prefab's floor cells, (w*sub) x (h*sub), row by row. */
export function prefabFloor(p: Prefab): Uint16Array {
  const out = new Uint16Array(p.w * p.sub * p.h * p.sub);
  let at = 0;
  for (let i = 0; i + 1 < p.floor.length && at < out.length; i += 2) {
    const v = p.floor[i], n = Math.min(p.floor[i + 1], out.length - at);
    if (v) out.fill(v, at, at + n);
    at += n;
  }
  return out;
}

const emptyClip = (): FeatureClip => ({ walls: [], lights: [], props: [], zones: [], connectors: [], roofs: [], paths: [], places: [], labels: [] });

/** Move every point of a clip through `pt`, and objects' turn and mirror through `prop` (shared by saving, which shifts, and turning). */
function mapClip(c: FeatureClip, pt: (x: number, y: number) => [number, number], prop: (p: MapProp) => Pick<MapProp, "rotation" | "flip">, box: (x: number, y: number, w: number, h: number) => { x: number; y: number; w: number; h: number }): FeatureClip {
  const pts = (ps: [number, number][]) => ps.map(([x, y]) => pt(x, y));
  return {
    walls: c.walls.map((w) => ({ ...w, points: pts(w.points) })),
    lights: c.lights.map((l) => { const [x, y] = pt(l.x, l.y); return { ...l, x, y }; }),
    props: c.props.map((p) => {
      const [x, y] = pt(p.x, p.y);
      const { rotation, flip } = prop(p);
      const { rotation: _r, flip: _f, ...rest } = p;
      return { ...rest, x, y, ...(rotation && { rotation }), ...(flip && { flip }) };
    }),
    zones: c.zones.map((z) => ({ ...z, points: pts(z.points) })),
    connectors: c.connectors.map((k) => ({ ...k, ...box(k.x, k.y, k.w, k.h) })),
    roofs: c.roofs.map((r) => ({ ...r, points: pts(r.points) })),
    paths: (c.paths ?? []).map((r) => ({ ...r, points: pts(r.points) })),
    places: [],
    labels: [],
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The part of segment a-b inside the box (Liang-Barsky), with where along a-b it starts and ends (0 and 1: at a and b), or null. */
function clipToBox(a: [number, number], b: [number, number], x0: number, y0: number, x1: number, y1: number): { p: [number, number]; q: [number, number]; t0: number; t1: number } | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as const) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  if (t1 - t0 < 1e-9) return null;
  return { p: [a[0] + dx * t0, a[1] + dy * t0], q: [a[0] + dx * t1, a[1] + dy * t1], t0, t1 };
}

/**
 * What of a wall a prefab of the area `r` keeps: the wall itself when it is wholly inside; a wall or invisible barrier that crosses the edge cut there, its
 * pieces inside kept (the outline traced round a floor runs round all of it, so a room cut out of a bigger floor would otherwise lose every wall); a door,
 * window or secret door only when it is wholly inside.
 */
function wallInside(w: MapWall, r: Rect): MapWall[] {
  const x0 = r.x - EPS, y0 = r.y - EPS, x1 = r.x + r.w + EPS, y1 = r.y + r.h + EPS;
  const ps = w.points;
  if (ps.length && ps.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) return [clone(w)];
  if ((w.kind !== "wall" && w.kind !== "invisible") || ps.length < 2) return [];
  const segs = ps.length - 1 + (w.closed && ps.length > 2 ? 1 : 0);
  const runs: [number, number][][] = [];
  let open = false, fromFirst = false, toLast = false;
  for (let i = 0; i < segs; i++) {
    // (cut at the area's own edge, so the pieces end on its border)
    const c = clipToBox(ps[i], ps[(i + 1) % ps.length], r.x, r.y, r.x + r.w, r.y + r.h);
    if (!c) { open = false; continue; }
    if (open && c.t0 === 0) runs[runs.length - 1].push(c.q);
    else runs.push([c.p, c.q]);
    if (i === 0 && c.t0 === 0) fromFirst = true;
    if (i === segs - 1 && c.t1 === 1) toLast = true;
    open = c.t1 === 1;
  }
  // a closed wall's last piece runs on into its first, through its first point
  if (w.closed && runs.length > 1 && fromFirst && toLast) { const first = runs.shift()!; runs[runs.length - 1].push(...first.slice(1)); }
  const length = (run: [number, number][]) => run.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]) : 0), 0);
  const { closed: _c, ...rest } = w;
  return runs.filter((run) => length(run) > 0.05).map((run, i) => ({ ...clone(rest), id: i ? `${w.id}-${i + 1}` : w.id, points: run.map(([x, y]) => [round3(x), round3(y)] as [number, number]) }));
}

/** Whole squares, inside the map. */
function squareRect(doc: MapDoc, r: Rect): Rect | null {
  const sp = battleSpec(doc);
  const x0 = Math.max(0, Math.floor(r.x + EPS)), y0 = Math.max(0, Math.floor(r.y + EPS));
  const x1 = Math.min(sp.squaresX, Math.ceil(r.x + r.w - EPS)), y1 = Math.min(sp.squaresY, Math.ceil(r.y + r.h - EPS));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Save an area of a battlemap (in squares; widened to whole squares) as a prefab: the floor under it and everything inside it (a wall's part inside, cut at
 * the edge, but a door or window only when it is wholly inside; an object or light whose centre is). Says why not when there is nothing there or it is too big.
 */
export function makePrefab(doc: MapDoc, area: Rect, name: string, savedAt = new Date().toISOString()): Prefab | { error: string } {
  if (!isBattle(doc)) return { error: "Prefabs are saved from battlemaps." };
  const sp = battleSpec(doc), r = squareRect(doc, area);
  if (!r) return { error: "That area is outside the map." };
  if (r.w > PREFAB_MAX_SQUARES || r.h > PREFAB_MAX_SQUARES) return { error: `A prefab can be at most ${PREFAB_MAX_SQUARES} x ${PREFAB_MAX_SQUARES} squares; that area is ${r.w} x ${r.h}.` };
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) return { error: "A prefab needs a name." };
  const s = sp.sub, hf = doc.height, cw = r.w * s, ch = r.h * s;
  const cells = new Float32Array(cw * ch);
  let floored = 0;
  const used = new Set<number>();
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const v = Math.round(hf.data[(r.y * s + y) * hf.w + r.x * s + x]);
    cells[y * cw + x] = v;
    if (v) { floored++; if (v >= CUSTOM_MATERIAL_BASE) used.add(v); }
  }
  const f: Features = doc.features ?? { places: [], labels: [] };
  const inX = (x: number) => x >= r.x - EPS && x <= r.x + r.w + EPS, inY = (y: number) => y >= r.y - EPS && y <= r.y + r.h + EPS;
  const inside = (x: number, y: number) => inX(x) && inY(y);
  const allIn = (ps: [number, number][]) => ps.length > 0 && ps.every(([x, y]) => inside(x, y));
  const picked: FeatureClip = {
    ...emptyClip(),
    walls: (f.walls ?? []).flatMap((w) => wallInside(w, r)).map(({ auto: _a, ...w }) => w),
    lights: clone((f.lights ?? []).filter((l) => inside(l.x, l.y))),
    props: clone((f.props ?? []).filter((p) => inside(p.x, p.y))),
    zones: clone((f.zones ?? []).filter((z) => allIn(z.points))),
    connectors: clone((f.connectors ?? []).filter((k) => inside(k.x, k.y) && inside(k.x + k.w, k.y + k.h))),
    roofs: clone((f.roofs ?? []).filter((z) => allIn(z.points))),
    paths: clone((f.paths ?? []).filter((z) => allIn(z.points))),
  };
  const things = picked.walls.length + picked.lights.length + picked.props.length + picked.zones.length + picked.connectors.length + picked.roofs.length + (picked.paths?.length ?? 0);
  if (!floored && !things) return { error: "There is nothing in that area to save: no floor, walls, objects or lights." };
  const features = mapClip(picked, (x, y) => [round3(x - r.x), round3(y - r.y)], (p) => ({ rotation: p.rotation, flip: p.flip }), (x, y, w, h) => ({ x: round3(x - r.x), y: round3(y - r.y), w, h }));
  const palette = (sp.palette ?? []).filter((e) => used.has(e.id));
  return {
    format: PREFAB_FORMAT, name: clean, w: r.w, h: r.h, sub: s, feetPerSquare: sp.feetPerSquare, floor: encodeFloor(cells),
    ...(palette.length && { palette: clone(palette) }), features, savedAt, from: doc.meta.name,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A point of a w x h box mirrored left to right (first, if asked) and turned clockwise by quarter turns (screen y points down). */
export function turnPoint(x: number, y: number, w: number, h: number, turn: PrefabTurn, mirror: boolean): [number, number] {
  const px = mirror ? w - x : x;
  switch (turn) {
    case 90: return [h - y, px];
    case 180: return [w - px, h - y];
    case 270: return [y, w - px];
    default: return [px, y];
  }
}

/** The prefab turned clockwise by quarter turns and mirrored left to right (mirroring first). */
export function turnPrefab(p: Prefab, turn: PrefabTurn = 0, mirror = false): Prefab {
  const t = (((turn % 360) + 360) % 360) as PrefabTurn;
  if (!t && !mirror) return p;
  const swap = t === 90 || t === 270, W = swap ? p.h : p.w, H = swap ? p.w : p.h;
  const pt = (x: number, y: number) => turnPoint(x, y, p.w, p.h, t, mirror).map(round3) as [number, number];
  const prop = (q: MapProp) => {
    let rot = q.rotation ?? 0, flip = !!q.flip;
    if (mirror) { rot = (360 - rot) % 360; flip = !flip; }
    rot = (rot + t) % 360;
    return { rotation: rot || undefined, flip: flip || undefined };
  };
  const box = (x: number, y: number, w: number, h: number) => {
    const [ax, ay] = pt(x, y), [bx, by] = pt(x + w, y + h);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  };
  // the floor: each cell's centre through the same turn, in cells
  const src = prefabFloor(p), s = p.sub, cw = p.w * s, ch = p.h * s, ow = W * s;
  const out = new Uint16Array(src.length);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const [tx, ty] = turnPoint(x + 0.5, y + 0.5, cw, ch, t, mirror);
    out[Math.floor(ty) * ow + Math.floor(tx)] = src[y * cw + x];
  }
  return { ...p, w: W, h: H, floor: encodeFloor(out), features: mapClip(p.features, pt, prop, box) };
}

/** What a prefab holds, in words ("6 x 4 squares: floor, 10 walls, 2 doors, 5 objects, 1 light"). */
export function describePrefab(p: Prefab): string {
  const c = p.features, parts: string[] = [];
  const n = (k: number, one: string, many = `${one}s`) => { if (k) parts.push(`${k} ${k === 1 ? one : many}`); };
  if (p.floor.some((v, i) => i % 2 === 0 && v !== 0)) parts.push("floor");
  const doors = c.walls.filter((w) => w.kind === "door" || w.kind === "secret").length, windows = c.walls.filter((w) => w.kind === "window").length;
  n(c.walls.length - doors - windows, "wall");
  n(doors, "door");
  n(windows, "window");
  n(c.props.length, "object");
  n(c.lights.length, "light");
  n(c.zones.length, "shaded area");
  n(c.connectors.length, "stair or ladder", "stairs and ladders");
  n(c.roofs.length, "roof");
  n(c.paths?.length ?? 0, "path");
  return `${p.w} x ${p.h} squares${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

export interface PlacedPrefab {
  /** The floor cells that change (map cells) and their new values, row by row: for one `patch_heights` edit with `patch`. */
  rect: Rect;
  data: Float32Array;
  patch: FeaturesPatch;
  /** The map's floor textures with the prefab's added, when it had to add any (else undefined). */
  palette?: PaletteEntry[];
  /** The new things' ids (to select them). */
  ids: string[];
  /** Where its top-left corner went, in squares (moved inside the map when it would have stuck out). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anything that didn't come across as it was. */
  problems: string[];
}

/**
 * Place a prefab with its top-left corner at (x, y) squares (rounded to whole squares, and moved inside the map if it would stick out), turned and mirrored as asked.
 * Its floor covers the map's where it has one (its void leaves the map's floor alone); a map of another floor detail gets the floor resampled.
 */
export function placePrefab(doc: MapDoc, prefab: Prefab, x: number, y: number, o: { turn?: PrefabTurn; mirror?: boolean } = {}): PlacedPrefab | { error: string } {
  if (!isBattle(doc)) return { error: "Prefabs are placed on battlemaps." };
  const sp = battleSpec(doc), p = turnPrefab(prefab, o.turn ?? 0, !!o.mirror);
  if (p.w > sp.squaresX || p.h > sp.squaresY) return { error: `"${p.name}" is ${p.w} x ${p.h} squares, bigger than this ${sp.squaresX} x ${sp.squaresY} battlemap.` };
  const X = Math.min(sp.squaresX - p.w, Math.max(0, Math.round(x))), Y = Math.min(sp.squaresY - p.h, Math.max(0, Math.round(y)));
  const problems: string[] = [];
  if (X !== Math.round(x) || Y !== Math.round(y)) problems.push(`It would have stuck out of the map, so it was moved to (${X}, ${Y}).`);
  if (p.feetPerSquare !== sp.feetPerSquare) problems.push(`It was saved on a map of ${p.feetPerSquare} ft squares; this one has ${sp.feetPerSquare} ft squares, so it is placed square for square.`);
  // the pack floor textures it uses, joined to the map's own
  let palette = [...(sp.palette ?? [])], added = false;
  const ids = new Map<number, number>();
  for (const e of p.palette ?? []) {
    const had = palette.find((q) => q.asset.toLowerCase() === e.asset.toLowerCase());
    if (had) { ids.set(e.id, had.id); continue; }
    if (palette.length >= MAX_FLOOR_TEXTURES) { ids.set(e.id, 1); problems.push(`This battlemap already has ${MAX_FLOOR_TEXTURES} floor textures, so its ${e.name} floor became flagstone.`); continue; }
    let name = e.name, k = 2;
    while (palette.some((q) => q.name.toLowerCase() === name.toLowerCase())) name = `${e.name} ${k++}`;
    const id = Math.max(CUSTOM_MATERIAL_BASE - 1, ...palette.map((q) => q.id)) + 1;
    palette = [...palette, { ...e, id, name }];
    ids.set(e.id, id);
    added = true;
  }
  const material = (v: number) => (v >= CUSTOM_MATERIAL_BASE ? ids.get(v) ?? 1 : v);
  // the floor, resampled to the map's floor detail
  const S = sp.sub, s = p.sub, hf = doc.height, src = prefabFloor(p), sw = p.w * s;
  const rect: Rect = { x: X * S, y: Y * S, w: p.w * S, h: p.h * S };
  const data = new Float32Array(rect.w * rect.h);
  for (let cy = 0; cy < rect.h; cy++) for (let cx = 0; cx < rect.w; cx++) {
    const v = src[Math.min(p.h * s - 1, Math.floor(((cy + 0.5) * s) / S)) * sw + Math.min(sw - 1, Math.floor(((cx + 0.5) * s) / S))];
    data[cy * rect.w + cx] = v ? material(v) : hf.data[(rect.y + cy) * hf.w + rect.x + cx];
  }
  const pasted = pasteFeatures(p.features, X, Y);
  return { rect, data, patch: pasted.patch, ...(added && { palette }), ids: pasted.ids, x: X, y: Y, w: p.w, h: p.h, problems };
}

/**
 * A small battlemap that holds just the prefab (for its picture). With `pad`, it has half a square of empty floor all round (one square more each way), so walls
 * along the prefab's edge show whole: the picture's middle is then the prefab's middle.
 */
export function prefabDoc(p: Prefab, pxPerSquare: number, pad = false): MapDoc {
  const cells = pad ? Math.floor(p.sub / 2) : 0, by = cells / p.sub, extra = pad ? 1 : 0;
  const doc = createBattleDoc({ id: "prefab", name: p.name, squaresX: p.w + extra, squaresY: p.h + extra, sub: p.sub, feetPerSquare: p.feetPerSquare, pxPerSquare });
  const floor = prefabFloor(p), cw = p.w * p.sub, hf = doc.height;
  for (let y = 0; y < p.h * p.sub; y++) for (let x = 0; x < cw; x++) hf.data[(y + cells) * hf.w + x + cells] = floor[y * cw + x];
  if (p.palette?.length) doc.meta.battle = { ...doc.meta.battle!, palette: clone(p.palette) };
  const c = by ? mapClip(p.features, (x, y) => [x + by, y + by], (q) => ({ rotation: q.rotation, flip: q.flip }), (x, y, w, h) => ({ x: x + by, y: y + by, w, h })) : p.features;
  doc.features = { places: [], labels: [], walls: clone(c.walls), lights: clone(c.lights), props: clone(c.props), zones: clone(c.zones), connectors: clone(c.connectors), roofs: clone(c.roofs), paths: clone(c.paths ?? []) };
  return doc;
}

/**
 * A prefab read from its file, with any list it lacks filled in; null when it isn't one we can use (not a prefab, damaged, or saved by a newer Dragon Drop:
 * `newer` says which).
 */
export function readPrefab(v: unknown): Prefab | null {
  const p = v as Prefab;
  if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name.trim()) return null;
  if (!Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w < 1 || p.h < 1 || p.w > PREFAB_MAX_SQUARES || p.h > PREFAB_MAX_SQUARES) return null;
  if (!Number.isInteger(p.sub) || p.sub < 1 || p.sub > 32 || !Array.isArray(p.floor) || !p.floor.every((n) => Number.isInteger(n) && n >= 0)) return null;
  if (typeof p.format === "number" && p.format > PREFAB_FORMAT) return null;
  const f = (p.features ?? {}) as Partial<FeatureClip>, list = <T>(a: T[] | undefined): T[] => (Array.isArray(a) ? a : []);
  return {
    ...p, format: p.format ?? PREFAB_FORMAT, feetPerSquare: typeof p.feetPerSquare === "number" && p.feetPerSquare > 0 ? p.feetPerSquare : 5,
    features: { walls: list(f.walls), lights: list(f.lights), props: list(f.props), zones: list(f.zones), connectors: list(f.connectors), roofs: list(f.roofs), paths: list(f.paths), places: [], labels: [] },
  };
}

/** Was this prefab file saved by a newer Dragon Drop? */
export const newerPrefab = (v: unknown): boolean => !!v && typeof v === "object" && typeof (v as Prefab).format === "number" && (v as Prefab).format > PREFAB_FORMAT;
