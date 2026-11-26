/**
 * The editor's side of named rivers and lakes (core waterNames.ts): what the River tool finds under the pointer, the words that describe it, and the names drawn as labels.
 * The rivers are the latest climate frame's; the lakes' shores and the names' rivers come from the server's `water` message, worked out from the same frame.
 */
import { type Features, type LakeShape, MI_PER_KM, type NamedWater, type RiverNet, type RiverPath, type Units, distUnit, fmtArea, fromKm, namedWaterAt, riverCourse, riverNet, riverOwner, seaNear, waterAt } from "@mapmaker/core";
import type { AppState } from "./store.ts";

let cache: { rivers: RiverPath[]; net: RiverNet } | null = null;
/** How the rivers join up (kept while the rivers are the same). */
export function netFor(rivers: RiverPath[]): RiverNet {
  if (cache?.rivers !== rivers) cache = { rivers, net: riverNet(rivers) };
  return cache.net;
}

/** A river or lake under the pointer, with what is known about it. */
export interface WaterPick {
  kind: "river" | "lake";
  /** On the river (the nearest point of it), or where the lake was clicked: where a new name is pinned. */
  x: number;
  y: number;
  named: NamedWater | null;
  /** Rivers: its whole course (flat x, y pairs, map px), length, how it ends, and the river it joins if that one is named. */
  course?: number[];
  lengthKm?: number;
  end?: "sea" | "lake" | "river" | "edge";
  joins?: string;
  /** Lakes: the shore, size and what leaves it. */
  outline?: [number, number][];
  areaKm2?: number;
  outflow?: LakeShape["outflow"];
}

/** What the River tool finds at a point (map px), within `tol` map px of a river. */
export function pickWater(rivers: RiverPath[], water: NonNullable<AppState["water"]>, kmPerPx: number, x: number, y: number, tol: number, heights?: { data: Float32Array; w: number; h: number; sea: number }): WaterPick | null {
  const hit = waterAt(rivers, water.lakes, x, y, tol);
  if (!hit) return null;
  const net = netFor(rivers), named = namedWaterAt(water.named, net, hit);
  if (hit.kind === "lake") {
    const l = water.lakes[hit.lake];
    return { kind: "lake", x, y, named, outline: l.outline, areaKm2: l.areaKm2, outflow: l.outflow };
  }
  const c = riverCourse(net, riverOwner(net, hit.river, hit.at), water.lakes);
  const ex = c.pts[c.pts.length - 2], ey = c.pts[c.pts.length - 1];
  const end = c.end === "open" ? (heights && seaNear(heights.data, heights.w, heights.h, heights.sea)(ex, ey) ? "sea" : "edge") : c.end;
  const joins = c.joins === undefined ? undefined : water.named.find((w) => w.kind === "river" && w.found && w.head === c.joins)?.name;
  return { kind: "river", x: hit.x, y: hit.y, named, course: c.pts, lengthKm: Math.round(c.length * kmPerPx), end, ...(joins && { joins }) };
}

/** The course of a named river, or the shore of a named lake (to highlight what is selected). */
export function namedShape(rivers: RiverPath[], water: NonNullable<AppState["water"]>, id: string): { course?: number[]; outline?: [number, number][] } | null {
  const w = water.named.find((x) => x.id === id);
  if (!w?.found) return null;
  if (w.kind === "lake") return w.lake !== undefined && water.lakes[w.lake] ? { outline: water.lakes[w.lake].outline } : null;
  if (w.head === undefined || !rivers[w.head]) return null;
  return { course: riverCourse(netFor(rivers), w.head, water.lakes).pts };
}

const other = (u: Units): Units => (u === "metric" ? "imperial" : "metric");
const far = (km: number, u: Units) => `${Math.round(fromKm(km, u)).toLocaleString()} ${distUnit(u)}`;

/** One line about a river or lake: how long and where it goes, or how big and what leaves it. */
export function describeWater(p: { kind: "river" | "lake"; lengthKm?: number; end?: string; joins?: string; areaKm2?: number; outflow?: string }, u: Units = "imperial"): string {
  if (p.kind === "lake") {
    const a = p.areaKm2 ?? 0;
    const out = p.outflow === "river" ? "a river flows out of it" : p.outflow === "stream" ? "a stream drains it" : "nothing flows out of it";
    return `About ${fmtArea(a, u)} (${fmtArea(a, other(u))}); ${out}.`;
  }
  const where = p.end === "sea" ? "flows into the sea" : p.end === "lake" ? "ends in a lake" : p.end === "river" ? (p.joins ? `joins the ${p.joins}` : "joins a bigger river") : "runs off the edge of the map";
  return `About ${far(p.lengthKm ?? 0, u)} (${far(p.lengthKm ?? 0, other(u))}) long; ${where}.`;
}

/** The map's features with the river and lake names added as labels (for drawing: they aren't features of their own). */
export function withWaterLabels(f: Features, water: AppState["water"]): Features {
  return water?.labels.length ? { ...f, labels: [...f.labels, ...water.labels] } : f;
}
