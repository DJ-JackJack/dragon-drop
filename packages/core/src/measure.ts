/**
 * Measuring a route: the ruler in the editor and Claude's `measure`. On a world map a route is surveyed along its length (open ground, rough ground that
 * halves the pace, roads, water, rivers crossed, how far it climbs) and turned into days of travel on foot, riding, by wagon or by ship. Battlemaps measure
 * in feet and squares, settlements in metres. Pure maths over the map's own data, so the editor (through the server) and Claude agree.
 */
import type { Derived } from "./climate.ts";
import type { MapDoc } from "./doc.ts";
import type { MapLine } from "./features.ts";
import { biomeWeights, emptyBiomeWeights } from "./biomeLook.ts";
import { smoothstep } from "./noise.ts";
import { desertWeight, jungleWeight } from "./painted.ts";
import { MI_PER_KM } from "./grid.ts";

export type Pt = [number, number];

export type TravelModeId = "foot" | "horse" | "wagon" | "ship";
export interface TravelMode {
  id: TravelModeId;
  name: string;
  /** A day's travel on open ground or a road, in miles (land: about eight hours on the move; a ship sails day and night). */
  milesPerDay: number;
  /** How much of the pace is left on rough ground (forest, jungle, marsh, mountains, ice, steep slopes). */
  rough: number;
  /** Hours in its travelling day (for times under a day). */
  hours: number;
  water: boolean;
}

/** The ways to travel the ruler and Claude reckon with. The paces are the usual tabletop ones; the DM can change them in the ruler. */
export const TRAVEL_MODES: TravelMode[] = [
  { id: "foot", name: "On foot", milesPerDay: 24, rough: 0.5, hours: 8, water: false },
  { id: "horse", name: "Riding", milesPerDay: 30, rough: 0.5, hours: 8, water: false },
  { id: "wagon", name: "Wagon or cart", milesPerDay: 18, rough: 1 / 3, hours: 8, water: false },
  { id: "ship", name: "Sailing ship", milesPerDay: 72, rough: 1, hours: 24, water: true },
];
export const travelMode = (id: string): TravelMode => TRAVEL_MODES.find((m) => m.id === id) ?? TRAVEL_MODES[0];

/** A route's length in map units. */
export function routeLength(points: Pt[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return n;
}

/** What a world-map route crosses, in km (all of them add up to `km`). */
export interface RouteSurvey {
  km: number;
  miles: number;
  /** Each leg's length (between clicked points), km. */
  legsKm: number[];
  /** Open land off roads, rough land off roads, along roads and trails, and over water (sea or lake). */
  openKm: number;
  roughKm: number;
  roadKm: number;
  waterKm: number;
  /** What makes the rough ground rough, km each (a stretch can count under one only: the first that applies, in this order). */
  rough: { mountains: number; steep: number; ice: number; jungle: number; marsh: number; forest: number };
  /** Metres climbed and descended along the way, and the highest and lowest ground passed. */
  climbM: number;
  descentM: number;
  highestM: number;
  lowestM: number;
  /** Rivers crossed (each river once), and whether the climate was known (without it, forest and marsh can't be told apart from open ground). */
  riversCrossed: number;
  climateKnown: boolean;
}

/** Steeper than this (metres of height per km) is rough going. */
const STEEP_M_PER_KM = 90;
/** Higher than this above the sea is mountain going. */
const MOUNTAIN_M = 2200;

/**
 * Survey a route over a world map (points in map px). `derived` gives the climate (forest, jungle, marsh, ice) and the lakes and rivers; without it only
 * height, slope, water below the sea and roads count. Roads and trails (`features.lines`) make any ground open going.
 */
export function surveyRoute(doc: MapDoc, derived: Derived | null, points: Pt[]): RouteSurvey {
  const hf = doc.height, W = hf.w, H = hf.h, sea = doc.meta.seaLevel, kmPerPx = doc.meta.kmPerPx || 1;
  const roads = (doc.features?.lines ?? []).filter((l) => l.kind === "road" || l.kind === "trail");
  const nearRoad = roadTest(roads, Math.max(1.2, 0.8 / kmPerPx));
  const s: RouteSurvey = {
    km: 0, miles: 0, legsKm: [], openKm: 0, roughKm: 0, roadKm: 0, waterKm: 0,
    rough: { mountains: 0, steep: 0, ice: 0, jungle: 0, marsh: 0, forest: 0 },
    climbM: 0, descentM: 0, highestM: -Infinity, lowestM: Infinity, riversCrossed: 0, climateKnown: !!derived,
  };
  const bw = emptyBiomeWeights();
  const STEP = 0.5; // px between samples
  let prevE: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    s.legsKm.push(len * kmPerPx);
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const segKm = (len / n) * kmPerPx;
      const cx = Math.min(W - 1, Math.max(0, Math.floor(x))), cy = Math.min(H - 1, Math.max(0, Math.floor(y))), c = cy * W + cx;
      const e = hf.sample(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y)));
      if (prevE !== null) { const d = e - prevE; if (d > 0) s.climbM += d; else s.descentM -= d; }
      prevE = e;
      if (e > s.highestM) s.highestM = e;
      if (e < s.lowestM) s.lowestM = e;
      if (e <= sea || (derived && derived.lakes[c])) { s.waterKm += segKm; continue; }
      if (nearRoad(x, y)) { s.roadKm += segKm; continue; }
      const why = roughness(hf, derived, bw, x, y, c, e, sea, kmPerPx);
      if (why) { s.roughKm += segKm; s.rough[why] += segKm; } else s.openKm += segKm;
    }
  }
  // (a long route climbs and falls over every hill: these are along the line itself, sampled every half pixel)
  s.km = s.legsKm.reduce((a, b) => a + b, 0);
  s.miles = s.km * MI_PER_KM;
  if (!Number.isFinite(s.highestM)) { s.highestM = 0; s.lowestM = 0; }
  if (derived) s.riversCrossed = riversCrossed(derived.rivers, points);
  return s;
}

type RoughKind = keyof RouteSurvey["rough"];

function roughness(hf: MapDoc["height"], derived: Derived | null, bw: ReturnType<typeof emptyBiomeWeights>, x: number, y: number, c: number, e: number, sea: number, kmPerPx: number): RoughKind | null {
  const above = e - sea;
  if (above > MOUNTAIN_M) return "mountains";
  const W = hf.w, H = hf.h, cl = (v: number, hi: number) => Math.min(hi, Math.max(0, v));
  const gx = (hf.sample(cl(x + 1, W - 1), cl(y, H - 1)) - hf.sample(cl(x - 1, W - 1), cl(y, H - 1))) / 2;
  const gy = (hf.sample(cl(x, W - 1), cl(y + 1, H - 1)) - hf.sample(cl(x, W - 1), cl(y - 1, H - 1))) / 2;
  if (Math.hypot(gx, gy) / kmPerPx > STEEP_M_PER_KM) return "steep";
  if (!derived) return null;
  if (derived.snow[c] > 150) return "ice";
  const t = derived.temp[c] / 255, m = derived.moist[c] / 255, ee = Math.max(0, above / 4000);
  const jw = jungleWeight(t, m), dw = desertWeight(t, m);
  if (jw > 0.5) return "jungle";
  biomeWeights(t, m, ee, smoothstep(0.1, 0.4, ee), bw, 0, { ld: derived.landDist[c] || 255, shore: 99 });
  const open = (1 - jw) * (1 - dw);
  if (bw.marsh * open > 0.45) return "marsh";
  if ((bw.boreal + bw.temperate + bw.warm) * open > 0.5) return "forest";
  return null;
}

/** A test for "on a road or trail" (within `reach` px of one). */
function roadTest(roads: MapLine[], reach: number): (x: number, y: number) => boolean {
  if (!roads.length) return () => false;
  const segs: number[] = [];
  for (const r of roads) for (let i = 1; i < r.points.length; i++) segs.push(r.points[i - 1][0], r.points[i - 1][1], r.points[i][0], r.points[i][1]);
  const r2 = reach * reach;
  return (x, y) => {
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
      if (x < Math.min(ax, bx) - reach || x > Math.max(ax, bx) + reach || y < Math.min(ay, by) - reach || y > Math.max(ay, by) + reach) continue;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      const px = ax + dx * t - x, py = ay + dy * t - y;
      if (px * px + py * py <= r2) return true;
    }
    return false;
  };
}

/** How many different rivers the route crosses (a river crossed twice counts once). */
function riversCrossed(rivers: Derived["rivers"], points: Pt[]): number {
  let n = 0;
  for (const rv of rivers) {
    const p = rv.pts;
    let hit = false;
    for (let i = 1; i < points.length && !hit; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      for (let k = 2; k < p.length && !hit; k += 2) if (segmentsCross(ax, ay, bx, by, p[k - 2], p[k - 1], p[k], p[k + 1])) hit = true;
    }
    if (hit) n++;
  }
  return n;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** How long a route takes one way of travelling: days (a day is that way's travelling day), and what it can't do. */
export interface TravelEstimate {
  mode: TravelModeId;
  name: string;
  days: number;
  /** In words: "about 3½ days", "about 5 hours". */
  time: string;
  /** What the time leaves out ("and 12 mi of water to cross by boat"), when anything. */
  note?: string;
}

/** The time a route takes each way of travelling, at the given paces (miles a day; missing ones take the usual pace). */
export function travelEstimates(s: RouteSurvey, paces: Partial<Record<TravelModeId, number>> = {}, modes: TravelMode[] = TRAVEL_MODES): TravelEstimate[] {
  const mi = (km: number) => km * MI_PER_KM;
  return modes.map((m) => {
    const pace = Math.max(0.1, paces[m.id] ?? m.milesPerDay);
    let days: number, note: string | undefined;
    if (m.water) {
      days = mi(s.waterKm) / pace;
      const land = s.openKm + s.roughKm + s.roadKm;
      if (land > Math.max(1, s.km * 0.05)) note = `and ${roundMi(mi(land))} over land, which a ship can't sail`;
    } else {
      days = (mi(s.openKm + s.roadKm) + mi(s.roughKm) / m.rough) / pace;
      if (s.waterKm > 0.5) note = `and ${roundMi(mi(s.waterKm))} of water to cross by boat`;
    }
    return { mode: m.id, name: m.name, days, time: describeTime(days, m.hours), ...(note && { note }) };
  });
}

const roundMi = (n: number) => `${n < 10 ? Math.round(n * 10) / 10 : Math.round(n).toLocaleString()} mi`;

/** "about 5 hours", "about 1 day", "about 3½ days", "about 12 days". */
export function describeTime(days: number, hoursPerDay: number): string {
  if (!(days > 0)) return "no time";
  if (days < 0.9) {
    const h = days * hoursPerDay;
    if (h < 1) return `about ${Math.max(5, Math.round((h * 60) / 5) * 5)} minutes`;
    const hr = Math.round(h * 2) / 2;
    return `about ${fmtHalf(hr)} hour${hr === 1 ? "" : "s"}`;
  }
  const d = days < 10 ? Math.round(days * 2) / 2 : Math.round(days);
  return `about ${fmtHalf(d)} day${d === 1 ? "" : "s"}`;
}
const fmtHalf = (n: number) => (n % 1 ? `${Math.floor(n) || ""}½` : String(n));

/** One line about a route, for the ruler and Claude ("123 mi (198 km): 80 mi open, 30 mi forest, 13 mi along roads; crosses 2 rivers; climbs 640 m"). */
export function describeRoute(s: RouteSurvey): string {
  const parts: string[] = [];
  const mi = (km: number) => roundMi(km * MI_PER_KM);
  if (s.openKm > 0.05) parts.push(`${mi(s.openKm)} open`);
  const r = s.rough;
  for (const [k, word] of [["forest", "forest"], ["jungle", "jungle"], ["marsh", "marsh"], ["mountains", "mountains"], ["steep", "steep slopes"], ["ice", "ice and snow"]] as [RoughKind, string][]) {
    if (r[k] > 0.05) parts.push(`${mi(r[k])} ${word}`);
  }
  if (s.roadKm > 0.05) parts.push(`${mi(s.roadKm)} along roads`);
  if (s.waterKm > 0.05) parts.push(`${mi(s.waterKm)} over water`);
  const extra: string[] = [];
  if (s.riversCrossed) extra.push(`crosses ${s.riversCrossed} river${s.riversCrossed === 1 ? "" : "s"}`);
  if (s.climbM >= 50) extra.push(`climbs ${Math.round(s.climbM).toLocaleString()} m`);
  const km = s.km < 10 ? Math.round(s.km * 10) / 10 : Math.round(s.km);
  return `${roundMi(s.miles)} (${km.toLocaleString()} km)${parts.length ? `: ${parts.join(", ")}` : ""}${extra.length ? `; ${extra.join("; ")}` : ""}`;
}

/** A battlemap route: its length in feet and in squares (along the line, a square being `feetPerSquare`). */
export function battleRoute(points: Pt[], feetPerSquare: number): { feet: number; squares: number } {
  const sq = routeLength(points);
  return { feet: sq * feetPerSquare, squares: sq };
}

/** A settlement route: metres, feet and the minutes it takes to walk (about 5 km an hour). */
export function cityRoute(points: Pt[]): { metres: number; feet: number; walkMinutes: number } {
  const m = routeLength(points);
  return { metres: m, feet: m * 3.28084, walkMinutes: (m / 5000) * 60 };
}
