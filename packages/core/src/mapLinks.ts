/**
 * Maps that know about each other: where a point of one map lies on another, and how far apart two points on different maps are.
 *
 * Every map is measured in its own units: map px on a world map, squares on a battlemap, metres on a city map (the same units the editor and the tools use).
 * Maps are linked by what they were made from:
 * - a detail (regional) map covers an area of its world map (`meta.parent`: the area in the parent's px and how many times finer it is);
 * - a battlemap or city made from a spot (`meta.origin`: the spot, its middle, in the parent's units: world px, or metres of a city);
 * - a copy (`meta.copiedFrom`) lies exactly over its original.
 * Two maps are linked when they share an ancestor through those links; then each one's units can be turned into the other's (`mapTransform`). Maps of the same kind
 * and the same size that aren't linked (made apart) are taken to lie one over the other, since that is how a before-and-after pair is made by hand.
 */
import type { MapMeta } from "./doc.ts";
import type { Rect } from "./geom.ts";

/** What this needs of a map: its meta (the project.json of a map, or a doc's meta). */
export type LinkedMap = Pick<MapMeta, "id" | "name" | "width" | "height" | "kmPerPx" | "kind" | "parent" | "origin" | "battle" | "city" | "copiedFrom">;

/** out = s * in + (x, y), the same scale each way (maps are never turned against each other). */
export interface Affine { s: number; x: number; y: number }

export type MapKind = "world" | "battle" | "city";

export const mapKindOf = (m: LinkedMap): MapKind => (m.kind === "battle" || m.battle ? "battle" : m.kind === "city" || m.city ? "city" : "world");

/** The map's size in its own units. */
export function mapSize(m: LinkedMap): { w: number; h: number } {
  if (m.city) return { w: m.city.widthM, h: m.city.heightM };
  if (m.battle) return { w: m.battle.squaresX, h: m.battle.squaresY };
  return { w: m.width, h: m.height };
}

/** How many metres one of the map's units is. */
export function unitMetres(m: LinkedMap): number {
  if (m.city) return 1;
  if (m.battle) return (m.battle.feetPerSquare || 5) * 0.3048;
  return Math.max(1e-6, m.kmPerPx) * 1000;
}

/** The units the tools and the editor use, in words. */
export function unitName(m: LinkedMap): string {
  return m.city ? "metres" : m.battle ? "squares" : "map px";
}

const ID: Affine = { s: 1, x: 0, y: 0 };
const apply = (f: Affine, x: number, y: number): [number, number] => [f.s * x + f.x, f.s * y + f.y];
/** g after f. */
const then = (f: Affine, g: Affine): Affine => ({ s: g.s * f.s, x: g.s * f.x + g.x, y: g.s * f.y + g.y });
const invert = (f: Affine): Affine => ({ s: 1 / f.s, x: -f.x / f.s, y: -f.y / f.s });

/** The map this one was made from and how its units turn into that one's, or null for a map made on its own (or whose parent isn't known). */
export function toParent(m: LinkedMap, maps: ReadonlyMap<string, LinkedMap>): { id: string; f: Affine; how: string } | null {
  if (m.parent) {
    const p = maps.get(m.parent.id);
    if (!p) return null;
    const r = m.parent.rect;
    return { id: p.id, f: { s: 1 / m.parent.factor, x: r.x, y: r.y }, how: `${m.name} is a ${m.parent.factor}x detail map of an area of ${p.name}` };
  }
  if (m.origin) {
    const p = maps.get(m.origin.id);
    if (!p) return null;
    const s = unitMetres(m) / unitMetres(p), { w, h } = mapSize(m);
    const what = mapKindOf(m) === "city" ? "city map" : "battlemap";
    return { id: p.id, f: { s, x: m.origin.x - (w / 2) * s, y: m.origin.y - (h / 2) * s }, how: `${m.name} is a ${what} made at (${m.origin.x}, ${m.origin.y}) of ${p.name}` };
  }
  if (m.copiedFrom) {
    const p = maps.get(m.copiedFrom.id);
    if (!p) return null;
    return { id: p.id, f: ID, how: `${m.name} is a copy of ${p.name}` };
  }
  return null;
}

/** A map and its ancestors, each with how this map's units turn into theirs. */
function chain(m: LinkedMap, maps: ReadonlyMap<string, LinkedMap>): { id: string; f: Affine; how: string[] }[] {
  const out = [{ id: m.id, f: ID, how: [] as string[] }];
  const seen = new Set([m.id]);
  let cur = m, f = ID, how: string[] = [];
  for (let guard = 0; guard < 16; guard++) {
    const up = toParent(cur, maps);
    if (!up || seen.has(up.id)) break;
    f = then(f, up.f);
    how = [...how, up.how];
    out.push({ id: up.id, f, how });
    seen.add(up.id);
    cur = maps.get(up.id)!;
  }
  return out;
}

/**
 * How map `a`'s units turn into map `b`'s, and why (the links in words), or null when the two aren't linked. Unlinked maps of the same kind and size are taken to lie
 * one over the other (`how` says so).
 */
export function mapTransform(a: LinkedMap, b: LinkedMap, maps: ReadonlyMap<string, LinkedMap>): { f: Affine; how: string[]; sameFrame: boolean } | null {
  if (a.id === b.id) return { f: ID, how: [], sameFrame: true };
  const ca = chain(a, maps), cb = chain(b, maps);
  for (const x of ca) {
    const y = cb.find((c) => c.id === x.id);
    if (!y) continue;
    const f = then(x.f, invert(y.f));
    const how = [...x.how, ...y.how];
    return { f, how, sameFrame: Math.abs(f.s - 1) < 1e-9 && Math.abs(f.x) < 1e-6 && Math.abs(f.y) < 1e-6 };
  }
  const sa = mapSize(a), sb = mapSize(b);
  if (mapKindOf(a) === mapKindOf(b) && sa.w === sb.w && sa.h === sb.h) return { f: ID, how: [`${a.name} and ${b.name} are the same size, so they are taken to lie one over the other`], sameFrame: true };
  return null;
}

/** A point of map `a` (its units) on map `b` (its units), with whether it falls inside `b`. Null when the maps aren't linked. */
export function pointOnMap(a: LinkedMap, b: LinkedMap, x: number, y: number, maps: ReadonlyMap<string, LinkedMap>): { x: number; y: number; inside: boolean; how: string[] } | null {
  const t = mapTransform(a, b, maps);
  if (!t) return null;
  const [bx, by] = apply(t.f, x, y), s = mapSize(b);
  return { x: bx, y: by, inside: bx >= 0 && by >= 0 && bx <= s.w && by <= s.h, how: t.how };
}

/** Straight-line distance (metres) between a point on map `a` and a point on map `b`. Null when the maps aren't linked. */
export function distanceAcross(a: LinkedMap, pa: [number, number], b: LinkedMap, pb: [number, number], maps: ReadonlyMap<string, LinkedMap>): number | null {
  const t = mapTransform(b, a, maps);
  if (!t) return null;
  const [x, y] = apply(t.f, pb[0], pb[1]);
  return Math.hypot(x - pa[0], y - pa[1]) * unitMetres(a);
}

/** Where all of map `other` lies on map `on`, in `on`'s units (for drawing one over the other). Null when they aren't linked. */
export function mapRectOn(other: LinkedMap, on: LinkedMap, maps: ReadonlyMap<string, LinkedMap>): { rect: Rect; how: string[]; sameFrame: boolean } | null {
  const t = mapTransform(other, on, maps);
  if (!t) return null;
  const s = mapSize(other);
  return { rect: { x: t.f.x, y: t.f.y, w: s.w * t.f.s, h: s.h * t.f.s }, how: t.how, sameFrame: t.sameFrame };
}

/** An area of map `a` (its units) as an area of map `b`. Null when they aren't linked. */
export function rectOnMap(a: LinkedMap, b: LinkedMap, r: Rect, maps: ReadonlyMap<string, LinkedMap>): Rect | null {
  const t = mapTransform(a, b, maps);
  if (!t) return null;
  const [x, y] = apply(t.f, r.x, r.y);
  return { x, y, w: r.w * t.f.s, h: r.h * t.f.s };
}
