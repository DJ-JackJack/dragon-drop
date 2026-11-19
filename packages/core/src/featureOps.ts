/**
 * Working on several features at once: select by box, move (and nudge), delete, copy and paste. Pure functions over `Features`, so the
 * editor's views only decide what was clicked or pressed and these decide what changes. Each one returns a `FeaturesPatch`, which the
 * editor sends as a single command: one undo step for the whole group.
 *
 * What a group can hold: on a battlemap walls, lights, objects, room notes, light zones and stairs, ladders and holes; on a world map places and labels.
 * Regions and roads/borders (world maps) can be moved and deleted as part of a group too, but not copied or selected by a box.
 * Positions are in whatever unit the map uses (squares on a battlemap, map px on a world map); the caller says which with `bounds`.
 */
import {
  type ClimateRegion, type Features, type FeaturesPatch, type MapAmbientZone, type MapConnector, type MapLabel, type MapLight, type MapLine, type MapNote, type MapProp, type MapWall, type Place,
  moveLabel, newFeatureId,
} from "./features.ts";

export type FeatureKind = "wall" | "light" | "prop" | "note" | "zone" | "connector" | "place" | "label" | "region" | "line";

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** The id lists the views keep for "what is selected": a single id, or two or more in `multi` (never both). */
export interface SelectionState { selected: string | null; multi: string[] }

/** One id, or none, or a group: the form the views store. */
export function selectionFromIds(ids: string[]): SelectionState {
  const unique = [...new Set(ids)];
  return unique.length >= 2 ? { selected: null, multi: unique } : { selected: unique[0] ?? null, multi: [] };
}

/** Every id that is selected. */
export function selectionIds(s: SelectionState): string[] {
  return s.multi.length ? s.multi : s.selected ? [s.selected] : [];
}

/** Shift-click: add `id` to the selection, or take it out if it is already there. */
export function toggleInSelection(s: SelectionState, id: string): SelectionState {
  const ids = selectionIds(s);
  return selectionFromIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
}

/** What kind of feature `id` is in `f`, or null if there is no such feature. */
export function featureKindOf(f: Features, id: string): FeatureKind | null {
  if (f.walls?.some((x) => x.id === id)) return "wall";
  if (f.lights?.some((x) => x.id === id)) return "light";
  if (f.props?.some((x) => x.id === id)) return "prop";
  if (f.notes?.some((x) => x.id === id)) return "note";
  if (f.zones?.some((x) => x.id === id)) return "zone";
  if (f.connectors?.some((x) => x.id === id)) return "connector";
  if (f.places.some((x) => x.id === id)) return "place";
  if (f.labels.some((x) => x.id === id)) return "label";
  if (f.regions?.some((x) => x.id === id)) return "region";
  if (f.lines?.some((x) => x.id === id)) return "line";
  return null;
}

/** The corners of everything the ids name (anchor points and outlines; a light's reach and an object's picture size don't count). */
export function featuresBounds(f: Features, ids: string[]): Box | null {
  let b: Box | null = null;
  const add = (x: number, y: number) => {
    b = b ? { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
  };
  for (const id of ids) {
    const kind = featureKindOf(f, id);
    if (kind === "wall") for (const [x, y] of f.walls!.find((w) => w.id === id)!.points) add(x, y);
    else if (kind === "zone") for (const [x, y] of f.zones!.find((z) => z.id === id)!.points) add(x, y);
    else if (kind === "connector") { const c = f.connectors!.find((x) => x.id === id)!; add(c.x, c.y); add(c.x + c.w, c.y + c.h); }
    else if (kind === "region") for (const [x, y] of f.regions!.find((r) => r.id === id)!.polygon) add(x, y);
    else if (kind === "line") for (const [x, y] of f.lines!.find((l) => l.id === id)!.points) add(x, y);
    else if (kind === "label") {
      const l = f.labels.find((x) => x.id === id)!;
      if (l.path?.length) for (const [x, y] of l.path) add(x, y);
      else add(l.x, l.y);
    } else if (kind) {
      const p = (f.lights?.find((x) => x.id === id) ?? f.props?.find((x) => x.id === id) ?? f.notes?.find((x) => x.id === id) ?? f.places.find((x) => x.id === id))!;
      add(p.x, p.y);
    }
  }
  return b;
}

/**
 * Limit a move so the group's corners stay inside [0, w] x [0, h]: the whole group stops at the edge together instead of squashing
 * against it. (A group already outside is pulled back in; one bigger than the map is left alone.)
 */
function clampShift(box: Box, dx: number, dy: number, bounds: { w: number; h: number }): { dx: number; dy: number } {
  const one = (d: number, lo: number, hi: number, size: number) => {
    const min = -lo, max = size - hi;
    return min > max ? d : Math.min(Math.max(d, min), max);
  };
  return { dx: one(dx, box.x0, box.x1, bounds.w), dy: one(dy, box.y0, box.y1, bounds.h) };
}

/** A moved copy of a feature (a wall that is moved by hand stops being "built automatically", or the next rebuild would undo the move). */
function shifted(f: Features, id: string, dx: number, dy: number): { kind: FeatureKind; item: unknown } | null {
  const kind = featureKindOf(f, id);
  if (!kind) return null;
  const sh = (pts: [number, number][]) => pts.map(([x, y]) => [x + dx, y + dy] as [number, number]);
  switch (kind) {
    case "wall": { const { auto: _auto, ...w } = f.walls!.find((x) => x.id === id)!; return { kind, item: { ...w, points: sh(w.points) } satisfies MapWall }; }
    case "zone": { const z = f.zones!.find((x) => x.id === id)!; return { kind, item: { ...z, points: sh(z.points) } satisfies MapAmbientZone }; }
    case "light": { const l = f.lights!.find((x) => x.id === id)!; return { kind, item: { ...l, x: l.x + dx, y: l.y + dy } satisfies MapLight }; }
    case "connector": { const c = f.connectors!.find((x) => x.id === id)!; return { kind, item: { ...c, x: c.x + dx, y: c.y + dy } satisfies MapConnector }; }
    case "prop": { const p = f.props!.find((x) => x.id === id)!; return { kind, item: { ...p, x: p.x + dx, y: p.y + dy } satisfies MapProp }; }
    case "note": { const n = f.notes!.find((x) => x.id === id)!; return { kind, item: { ...n, x: n.x + dx, y: n.y + dy } satisfies MapNote }; }
    case "place": { const p = f.places.find((x) => x.id === id)!; return { kind, item: { ...p, x: p.x + dx, y: p.y + dy } satisfies Place }; }
    case "label": return { kind, item: moveLabel(f.labels.find((x) => x.id === id)!, dx, dy) };
    case "region": { const r = f.regions!.find((x) => x.id === id)!; return { kind, item: { ...r, polygon: sh(r.polygon) } satisfies ClimateRegion }; }
    case "line": { const l = f.lines!.find((x) => x.id === id)!; return { kind, item: { ...l, points: sh(l.points) } satisfies MapLine }; }
  }
}

/** Fold moved items into a patch. */
function intoPatch(patch: FeaturesPatch, kind: FeatureKind, item: unknown) {
  switch (kind) {
    case "wall": (patch.upsertWalls ??= []).push(item as MapWall); break;
    case "zone": (patch.upsertZones ??= []).push(item as MapAmbientZone); break;
    case "light": (patch.upsertLights ??= []).push(item as MapLight); break;
    case "connector": (patch.upsertConnectors ??= []).push(item as MapConnector); break;
    case "prop": (patch.upsertProps ??= []).push(item as MapProp); break;
    case "note": (patch.upsertNotes ??= []).push(item as MapNote); break;
    case "place": (patch.upsertPlaces ??= []).push(item as Place); break;
    case "label": (patch.upsertLabels ??= []).push(item as MapLabel); break;
    case "region": (patch.upsertRegions ??= []).push(item as ClimateRegion); break;
    case "line": (patch.upsertLines ??= []).push(item as MapLine); break;
  }
}

/**
 * Move the listed features by (dx, dy) as a group. With `bounds` the group is held inside the map as a whole: it stops at the edge
 * instead of squashing against it. Returns the amount it really moved too (0, 0 means nothing to do).
 */
export function moveFeatures(f: Features, ids: string[], dx: number, dy: number, bounds?: { w: number; h: number }): { patch: FeaturesPatch; dx: number; dy: number } {
  const box = featuresBounds(f, ids);
  if (!box) return { patch: {}, dx: 0, dy: 0 };
  if (bounds) ({ dx, dy } = clampShift(box, dx, dy, bounds));
  if (!dx && !dy) return { patch: {}, dx: 0, dy: 0 };
  const patch: FeaturesPatch = {};
  for (const id of ids) {
    const s = shifted(f, id, dx, dy);
    if (s) intoPatch(patch, s.kind, s.item);
  }
  return { patch, dx, dy };
}

/** The patch that deletes the listed features. */
export function deleteFeatures(f: Features, ids: string[]): FeaturesPatch {
  const patch: FeaturesPatch = {};
  for (const id of ids) {
    switch (featureKindOf(f, id)) {
      case "wall": (patch.removeWalls ??= []).push(id); break;
      case "light": (patch.removeLights ??= []).push(id); break;
      case "prop": (patch.removeProps ??= []).push(id); break;
      case "note": (patch.removeNotes ??= []).push(id); break;
      case "zone": (patch.removeZones ??= []).push(id); break;
      case "connector": (patch.removeConnectors ??= []).push(id); break;
      case "place": (patch.removePlaces ??= []).push(id); break;
      case "label": (patch.removeLabels ??= []).push(id); break;
      case "region": (patch.removeRegions ??= []).push(id); break;
      case "line": (patch.removeLines ??= []).push(id); break;
    }
  }
  return patch;
}

/**
 * What a box drawn on the map selects: lights, objects, notes, places and labels whose anchor point is inside it, and walls, light
 * zones, stairs, ladders and holes that lie entirely inside it (so a box over part of a room doesn't grab the room's outline). `kinds` limits it to what the view has.
 */
export function boxSelect(f: Features, box: Box, kinds: FeatureKind[]): string[] {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  const at = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const all = (pts: [number, number][]) => pts.length > 0 && pts.every(([x, y]) => at(x, y));
  const want = new Set(kinds);
  const out: string[] = [];
  if (want.has("prop")) for (const p of f.props ?? []) if (at(p.x, p.y)) out.push(p.id);
  if (want.has("light")) for (const l of f.lights ?? []) if (at(l.x, l.y)) out.push(l.id);
  if (want.has("note")) for (const n of f.notes ?? []) if (at(n.x, n.y)) out.push(n.id);
  if (want.has("wall")) for (const w of f.walls ?? []) if (all(w.points)) out.push(w.id);
  if (want.has("zone")) for (const z of f.zones ?? []) if (all(z.points)) out.push(z.id);
  if (want.has("connector")) for (const c of f.connectors ?? []) if (all([[c.x, c.y], [c.x + c.w, c.y + c.h]])) out.push(c.id);
  if (want.has("place")) for (const p of f.places) if (at(p.x, p.y)) out.push(p.id);
  if (want.has("label")) for (const l of f.labels) if (l.path?.length ? all(l.path) : at(l.x, l.y)) out.push(l.id);
  return out;
}

// ---------------------------------------------------------------- copy and paste

/** Copies of features, kept apart from the map they came from (and from the next paste's ids). Room notes are not copied: they are numbered. */
export interface FeatureClip {
  walls: MapWall[];
  lights: MapLight[];
  props: MapProp[];
  zones: MapAmbientZone[];
  connectors: MapConnector[];
  places: Place[];
  labels: MapLabel[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A copy of the listed features, or null if none of them can be copied. */
export function copyFeatures(f: Features, ids: string[]): FeatureClip | null {
  const set = new Set(ids);
  const clip: FeatureClip = {
    walls: clone((f.walls ?? []).filter((x) => set.has(x.id))),
    lights: clone((f.lights ?? []).filter((x) => set.has(x.id))),
    props: clone((f.props ?? []).filter((x) => set.has(x.id))),
    zones: clone((f.zones ?? []).filter((x) => set.has(x.id))),
    connectors: clone((f.connectors ?? []).filter((x) => set.has(x.id))),
    places: clone(f.places.filter((x) => set.has(x.id))),
    labels: clone(f.labels.filter((x) => set.has(x.id))),
  };
  const n = clip.walls.length + clip.lights.length + clip.props.length + clip.zones.length + clip.connectors.length + clip.places.length + clip.labels.length;
  return n ? clip : null;
}

/** The corners of a clip (the same measure as `featuresBounds`). */
export function clipBounds(c: FeatureClip): Box {
  const scratch: Features = { places: c.places, labels: c.labels, walls: c.walls, lights: c.lights, props: c.props, zones: c.zones, connectors: c.connectors };
  const ids = [...c.walls, ...c.lights, ...c.props, ...c.zones, ...c.connectors, ...c.places, ...c.labels].map((x) => x.id);
  return featuresBounds(scratch, ids)!;
}

export interface PasteOptions {
  /** Keep the pasted group inside [0, w] x [0, h]. */
  bounds?: { w: number; h: number };
  /** Names of pasted places (default "<name> (copy)": the person renames it; nothing is invented). */
  placeName?: (name: string) => string;
}

/**
 * Paste a clip moved by (dx, dy): new ids for everything, and the pasted things are the ones to select afterwards (`ids`). Walls come
 * in as hand-made walls (never "built automatically"). With `bounds` the group is held inside the map.
 */
export function pasteFeatures(c: FeatureClip, dx: number, dy: number, opts: PasteOptions = {}): { patch: FeaturesPatch; ids: string[]; dx: number; dy: number } {
  const b = clipBounds(c);
  if (opts.bounds) ({ dx, dy } = clampShift(b, dx, dy, opts.bounds));
  const sh = (pts: [number, number][]) => pts.map(([x, y]) => [x + dx, y + dy] as [number, number]);
  const placeName = opts.placeName ?? ((n: string) => `${n} (copy)`);
  const ids: string[] = [];
  const fresh = (prefix: Parameters<typeof newFeatureId>[0]) => { const id = newFeatureId(prefix); ids.push(id); return id; };
  const patch: FeaturesPatch = {};
  if (c.walls.length) patch.upsertWalls = c.walls.map(({ auto: _auto, ...w }) => ({ ...w, id: fresh("w"), points: sh(w.points) }));
  if (c.lights.length) patch.upsertLights = c.lights.map((l) => ({ ...l, id: fresh("g"), x: l.x + dx, y: l.y + dy }));
  if (c.props.length) patch.upsertProps = c.props.map((p) => ({ ...p, id: fresh("o"), x: p.x + dx, y: p.y + dy }));
  if (c.zones.length) patch.upsertZones = c.zones.map((z) => ({ ...z, id: fresh("z"), points: sh(z.points) }));
  if (c.connectors.length) patch.upsertConnectors = c.connectors.map((k) => ({ ...k, id: fresh("c"), x: k.x + dx, y: k.y + dy }));
  if (c.places.length) patch.upsertPlaces = c.places.map((p) => ({ ...p, id: fresh("p"), name: placeName(p.name), x: p.x + dx, y: p.y + dy }));
  if (c.labels.length) patch.upsertLabels = c.labels.map((l) => ({ ...moveLabel(l, dx, dy), id: fresh("l") }));
  return { patch, ids, dx, dy };
}
