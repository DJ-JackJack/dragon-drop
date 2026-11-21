/**
 * What is different between two maps of the same kind, in words: a before-and-after pair (a map and its copy), or two versions of a place.
 *
 * The ground is compared cell by cell when the two are the same size (heights on a world map, floor or ground materials on a battlemap or city map). Everything on the
 * map (places, labels, roads, walls and doors, lights, objects, buildings, streets...) is matched by its id, which a copy keeps, so a moved door is "moved", not "removed
 * and added". Pure: the tools and the server call it with two documents.
 */
import type { MapDoc } from "./doc.ts";
import type { Rect } from "./geom.ts";
import { MATERIALS } from "./battle.ts";
import { mapKindOf } from "./mapLinks.ts";

export interface CollectionDiff {
  /** The features key ("walls", "places"...) and what it is called, in words. */
  key: string;
  label: string;
  added: number;
  removed: number;
  moved: number;
  changed: number;
  /** A few of them by name, kind or position, for the words. */
  examples: string[];
}

export interface MapDiff {
  kind: "world" | "battle" | "city";
  sameSize: boolean;
  /** World maps (same size only): cells raised or lowered by more than a metre, the most each way, and land that became sea or sea that became land. */
  heights?: { raised: number; lowered: number; maxRaiseM: number; maxLowerM: number; becameSea: number; becameLand: number; box: Rect | null };
  /** Battlemaps and cities (same size only): ground cells whose floor or ground changed, the commonest changes first. */
  ground?: { changed: number; cellsPerUnit: number; top: { from: string; to: string; cells: number }[]; box: Rect | null };
  /** Map settings that differ (sea level, climate, style, light level...). */
  settings: string[];
  collections: CollectionDiff[];
  /** All of it in plain sentences. */
  words: string[];
}

/** What each features list is called. */
const LABELS: Record<string, string> = {
  places: "places", labels: "labels", walls: "walls, doors and windows", lights: "lights", props: "objects", notes: "notes", zones: "light zones", connectors: "stairs, ladders and holes",
  roofs: "roofs", lines: "roads, trails, borders and reefs", regions: "climate regions", sources: "river sources", buildings: "buildings", streets: "streets", land: "landforms",
  trees: "trees and woods", cityWalls: "city walls", districts: "districts", waterNames: "named rivers and lakes",
};

const materialName = (id: number) => MATERIALS[id]?.name ?? (id >= 100 ? `texture ${id - 99}` : `material ${id}`);

/** A point that stands for where a feature is (to tell "moved" from "changed"). */
function anchor(o: Record<string, unknown>): string {
  const pts = (o.points ?? o.polygon ?? o.outline ?? o.path) as unknown;
  if (Array.isArray(pts)) return JSON.stringify(pts);
  if (typeof o.x === "number" && typeof o.y === "number") return `${o.x},${o.y}`;
  if (typeof o.x1 === "number") return `${o.x1},${o.y1},${o.x2},${o.y2}`;
  return "";
}

/** A short name for a feature, for the examples. */
function nameOf(o: Record<string, unknown>): string {
  const n = (o.name ?? o.text ?? o.label) as string | undefined;
  const k = (o.kind ?? o.type) as string | undefined;
  if (n && k) return `${k} "${n}"`;
  if (n) return `"${n}"`;
  if (k) return String(k);
  return String(o.id ?? "one");
}

function diffCollection(key: string, a: Record<string, unknown>[], b: Record<string, unknown>[]): CollectionDiff | null {
  const am = new Map(a.filter((x) => typeof x.id === "string").map((x) => [x.id as string, x]));
  const bm = new Map(b.filter((x) => typeof x.id === "string").map((x) => [x.id as string, x]));
  const d: CollectionDiff = { key, label: LABELS[key] ?? key, added: 0, removed: 0, moved: 0, changed: 0, examples: [] };
  const ex = (s: string) => { if (d.examples.length < 6) d.examples.push(s); };
  for (const [id, x] of bm) if (!am.has(id)) { d.added++; ex(`added ${nameOf(x)}`); }
  for (const [id, x] of am) if (!bm.has(id)) { d.removed++; ex(`removed ${nameOf(x)}`); }
  for (const [id, x] of am) {
    const y = bm.get(id);
    if (!y || JSON.stringify(x) === JSON.stringify(y)) continue;
    const { ...xr } = x, { ...yr } = y;
    const ax = anchor(xr), ay = anchor(yr);
    if (ax !== ay) {
      // moved, and perhaps changed as well: compare what is left once the position is put aside
      for (const k of ["x", "y", "x1", "y1", "x2", "y2", "points", "polygon", "outline", "path"]) { delete xr[k]; delete yr[k]; }
      d.moved++;
      ex(`moved ${nameOf(y)}`);
      if (JSON.stringify(xr) !== JSON.stringify(yr)) d.changed++;
    } else { d.changed++; ex(`changed ${nameOf(y)}`); }
  }
  return d.added || d.removed || d.moved || d.changed ? d : null;
}

/** Cell coordinates of an area given in the map's own units (world px, squares, metres). */
function cellRect(doc: MapDoc, r: Rect | undefined): Rect {
  const W = doc.height.w, H = doc.height.h;
  if (!r) return { x: 0, y: 0, w: W, h: H };
  const k = doc.meta.battle ? doc.meta.battle.sub || 1 : doc.meta.city ? 1 / doc.meta.city.cellM : 1;
  const x0 = Math.max(0, Math.floor(r.x * k)), y0 = Math.max(0, Math.floor(r.y * k));
  const x1 = Math.min(W, Math.ceil((r.x + r.w) * k)), y1 = Math.min(H, Math.ceil((r.y + r.h) * k));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** What is different from map `a` (before) to map `b` (after). `region` (in a's units) limits the cell-by-cell comparison of the ground. */
export function mapDifferences(a: MapDoc, b: MapDoc, o: { region?: Rect } = {}): MapDiff {
  const kind = mapKindOf(a.meta), kb = mapKindOf(b.meta);
  if (kind !== kb) throw new Error(`These are different kinds of map (a ${kind} map and a ${kb} map): only maps of the same kind can be compared point by point.`);
  const sameSize = a.height.w === b.height.w && a.height.h === b.height.h;
  const out: MapDiff = { kind, sameSize, settings: [], collections: [], words: [] };
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number) => { if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x; if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y; };
  const boxRect = (): Rect | null => (box.x1 < 0 ? null : { x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1 });
  if (sameSize) {
    const W = a.height.w, r = cellRect(a, o.region), ha = a.height.data, hb = b.height.data;
    if (kind === "world") {
      const seaA = a.meta.seaLevel, seaB = b.meta.seaLevel;
      let raised = 0, lowered = 0, maxR = 0, maxL = 0, becameSea = 0, becameLand = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * W + x, d = hb[i] - ha[i];
        if (d > 1) { raised++; maxR = Math.max(maxR, d); grow(x, y); } else if (d < -1) { lowered++; maxL = Math.max(maxL, -d); grow(x, y); }
        const wasSea = ha[i] <= seaA, isSea = hb[i] <= seaB;
        if (!wasSea && isSea) { becameSea++; grow(x, y); } else if (wasSea && !isSea) { becameLand++; grow(x, y); }
      }
      out.heights = { raised, lowered, maxRaiseM: Math.round(maxR), maxLowerM: Math.round(maxL), becameSea, becameLand, box: boxRect() };
    } else {
      const counts = new Map<string, number>();
      let changed = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * W + x;
        if (ha[i] === hb[i]) continue;
        changed++; grow(x, y);
        const k = `${ha[i]}>${hb[i]}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const top = [...counts].sort((p, q) => q[1] - p[1]).slice(0, 5).map(([k, cells]) => { const [f, t] = k.split(">").map(Number); return { from: materialName(f), to: materialName(t), cells }; });
      const cellsPerUnit = kind === "battle" ? (a.meta.battle?.sub || 1) ** 2 : 1;
      out.ground = { changed, cellsPerUnit, top, box: boxRect() };
    }
  }
  // settings
  if (kind === "world" && a.meta.seaLevel !== b.meta.seaLevel) out.settings.push(`sea level ${Math.round(a.meta.seaLevel)} m → ${Math.round(b.meta.seaLevel)} m`);
  if ((a.meta.style ?? "painted") !== (b.meta.style ?? "painted")) out.settings.push(`style ${a.meta.style ?? "painted"} → ${b.meta.style ?? "painted"}`);
  const ca = a.meta.climate ?? {}, cb = b.meta.climate ?? {};
  const climateKeys = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].filter((k) => JSON.stringify((ca as Record<string, unknown>)[k]) !== JSON.stringify((cb as Record<string, unknown>)[k]));
  if (climateKeys.length) out.settings.push(`climate settings (${climateKeys.join(", ")})`);
  if (a.meta.battle && b.meta.battle) {
    const la = a.meta.battle.ambient ?? 1, lb = b.meta.battle.ambient ?? 1;
    if (la !== lb) out.settings.push(`light level ${Math.round(la * 100)}% → ${Math.round(lb * 100)}%`);
  }
  if (a.meta.city && b.meta.city && JSON.stringify(a.meta.city.climate) !== JSON.stringify(b.meta.city.climate)) out.settings.push("the city's climate");
  // everything on the map, by id
  const fa = (a.features ?? {}) as unknown as Record<string, unknown>, fb = (b.features ?? {}) as unknown as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(fa), ...Object.keys(fb)])]) {
    if (key === "trace") continue;
    const xa = fa[key], xb = fb[key];
    if (!Array.isArray(xa) && !Array.isArray(xb)) continue;
    const d = diffCollection(key, (xa ?? []) as Record<string, unknown>[], (xb ?? []) as Record<string, unknown>[]);
    if (d) out.collections.push(d);
  }
  // in words
  const w = out.words;
  if (!sameSize) w.push(`The two maps are different sizes (${a.height.w} x ${a.height.h} and ${b.height.w} x ${b.height.h} cells), so the ground isn't compared point by point.`);
  if (out.heights) {
    const h = out.heights;
    if (!h.raised && !h.lowered && !h.becameSea && !h.becameLand) w.push("The land is the same.");
    else {
      const parts: string[] = [];
      if (h.raised) parts.push(`${plural(h.raised, "map pixel")} raised (up to ${h.maxRaiseM.toLocaleString("en")} m)`);
      if (h.lowered) parts.push(`${plural(h.lowered, "map pixel")} lowered (up to ${h.maxLowerM.toLocaleString("en")} m)`);
      if (h.becameSea) parts.push(`${plural(h.becameSea, "pixel")} of land became sea`);
      if (h.becameLand) parts.push(`${plural(h.becameLand, "pixel")} of sea became land`);
      w.push(`The land: ${parts.join("; ")}${h.box ? `, within x ${h.box.x} to ${h.box.x + h.box.w}, y ${h.box.y} to ${h.box.y + h.box.h}` : ""}.`);
    }
  }
  if (out.ground) {
    const g = out.ground, unit = kind === "battle" ? "square" : "ground cell", n = Math.round(g.changed / g.cellsPerUnit);
    if (!g.changed) w.push(kind === "battle" ? "The floors are the same." : "The ground is the same.");
    else w.push(`${kind === "battle" ? "The floors" : "The ground"}: about ${plural(Math.max(1, n), unit)} changed${g.top.length ? ` (${g.top.map((t) => `${t.from} → ${t.to}: ${Math.max(1, Math.round(t.cells / g.cellsPerUnit))}`).join("; ")})` : ""}.`);
  }
  if (out.settings.length) w.push(`Settings: ${out.settings.join("; ")}.`);
  for (const c of out.collections) {
    const parts: string[] = [];
    if (c.added) parts.push(`${c.added} added`);
    if (c.removed) parts.push(`${c.removed} removed`);
    if (c.moved) parts.push(`${c.moved} moved`);
    if (c.changed) parts.push(`${c.changed} changed`);
    w.push(`${c.label[0].toUpperCase()}${c.label.slice(1)}: ${parts.join(", ")} (${c.examples.join("; ")}${c.added + c.removed + c.moved + c.changed > c.examples.length ? "; ..." : ""}).`);
  }
  const groundChanged = out.heights ? out.heights.raised + out.heights.lowered + out.heights.becameSea + out.heights.becameLand > 0 : !!out.ground?.changed;
  if (!groundChanged && !out.collections.length && !out.settings.length) w.push(sameSize ? "Nothing on the two maps is different." : "Nothing on them is different (the ground wasn't compared).");
  return out;
}
