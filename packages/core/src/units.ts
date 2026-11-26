/**
 * Imperial or metric: how lengths are shown and typed in (the person, 2026-11-26: "a global measurement system control in settings and then individual
 * toggles per map"). Only what is shown changes: every map keeps its own units inside (world maps map px and km, heights metres, settlements metres,
 * battlemaps squares and feet), so switching never changes a map. The choice is Settings' (per computer) unless a map has its own (`MapMeta.units`).
 *
 * Imperial: miles, feet. Metric: kilometres, metres. Battlemaps use the tabletop's own metric: a 5 ft square is 1.5 m (feet x 0.3), so 30 ft is 9 m.
 */
import { MI_PER_KM } from "./grid.ts";
import { niceLength } from "./furniture.ts";

export type Units = "imperial" | "metric";
export const UNITS: readonly Units[] = ["imperial", "metric"];
export const DEFAULT_UNITS: Units = "imperial";
export const FT_PER_M = 3.28084;
/** The tabletop's metric: a 5 ft square is 1.5 m. */
export const TABLE_M_PER_FT = 0.3;

export const cleanUnits = (v: unknown): Units | undefined => (v === "imperial" || v === "metric" ? v : undefined);
/** The units a map is shown in: its own choice, else Settings'. */
export const unitsFor = (meta: { units?: Units | null } | null | undefined, global: Units): Units => cleanUnits(meta?.units) ?? global;
export const UNITS_NAME: Record<Units, string> = { imperial: "Imperial (miles, feet)", metric: "Metric (kilometres, metres)" };

/** A number to read: one decimal under 10 (two under 1), whole above. */
export function tidy(n: number): string {
  const a = Math.abs(n);
  const r = a < 1 ? Math.round(n * 100) / 100 : a < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return r.toLocaleString("en-US");
}
const whole = (n: number) => Math.round(n).toLocaleString("en-US");

// ---- distances on a world map (km inside): miles or km
export const distUnit = (u: Units) => (u === "metric" ? "km" : "mi");
export const distWord = (u: Units) => (u === "metric" ? "km" : "miles");
export const fromKm = (km: number, u: Units) => (u === "metric" ? km : km * MI_PER_KM);
export const toKm = (v: number, u: Units) => (u === "metric" ? v : v / MI_PER_KM);
/** "124 mi" / "200 km". */
export const fmtDist = (km: number, u: Units) => `${tidy(fromKm(km, u))} ${distUnit(u)}`;
/** "124 mi (200 km)" / "200 km (124 mi)": the chosen first, the other after it. */
export const fmtDistBoth = (km: number, u: Units) => `${fmtDist(km, u)} (${fmtDist(km, u === "metric" ? "imperial" : "metric")})`;
/** An area: "1,200 sq mi" / "3,100 km²". */
export const fmtArea = (km2: number, u: Units) => (u === "metric" ? `${whole(km2)} km²` : `${whole(km2 * MI_PER_KM * MI_PER_KM)} sq mi`);
/** A day's travel: miles a day inside. */
export const paceFromMi = (miPerDay: number, u: Units) => (u === "metric" ? miPerDay / MI_PER_KM : miPerDay);
export const paceToMi = (v: number, u: Units) => (u === "metric" ? v * MI_PER_KM : v);

// ---- heights and short lengths (metres inside): feet or metres
export const lenUnit = (u: Units) => (u === "metric" ? "m" : "ft");
export const lenWord = (u: Units) => (u === "metric" ? "metres" : "feet");
export const fromM = (m: number, u: Units) => (u === "metric" ? m : m * FT_PER_M);
export const toM = (v: number, u: Units) => (u === "metric" ? v : v / FT_PER_M);
/** A height: "1,200 m" / "3,937 ft" (whole). */
export const fmtHeight = (m: number, u: Units) => `${whole(fromM(m, u))} ${lenUnit(u)}`;
/** A length on a settlement: metres or feet, kilometres or miles once it is long. */
export function fmtLen(m: number, u: Units): string {
  if (u === "metric") return Math.abs(m) >= 1000 ? `${tidy(m / 1000)} km` : `${tidy(m)} m`;
  const ft = m * FT_PER_M;
  return Math.abs(ft) >= 5280 ? `${tidy(ft / 5280)} mi` : `${tidy(ft)} ft`;
}
/** "120 m (394 ft)" / "394 ft (120 m)". */
export const fmtLenBoth = (m: number, u: Units) => `${fmtLen(m, u)} (${fmtLen(m, u === "metric" ? "imperial" : "metric")})`;
/** A scale bar for a settlement at most `maxM` metres long: a round length in the chosen units (500 ft, 1 mi; 200 m, 1 km), in metres and as a label. */
export function scaleLength(maxM: number, u: Units): { metres: number; label: string } {
  if (u === "metric") {
    const m = niceLength(maxM);
    return { metres: m, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
  }
  const ft = maxM * FT_PER_M;
  if (ft >= 5280) { const mi = niceLength(ft / 5280); return { metres: (mi * 5280) / FT_PER_M, label: `${mi} mi` }; }
  const f = niceLength(ft);
  return { metres: f / FT_PER_M, label: `${f} ft` };
}
/** An area on a settlement: "120 m²" / "1,292 sq ft". */
export const fmtLenArea = (m2: number, u: Units) => (u === "metric" ? `${whole(m2)} m²` : `${whole(m2 * FT_PER_M * FT_PER_M)} sq ft`);

// ---- battlemaps (feet inside): feet, or the tabletop's metres (1.5 m a 5 ft square)
export const tableUnit = (u: Units) => (u === "metric" ? "m" : "ft");
export const fromFt = (ft: number, u: Units) => (u === "metric" ? ft * TABLE_M_PER_FT : ft);
export const toFt = (v: number, u: Units) => (u === "metric" ? v / TABLE_M_PER_FT : v);
/** "35 ft" / "10.5 m". */
export const fmtTable = (ft: number, u: Units) => `${tidy(fromFt(ft, u))} ${tableUnit(u)}`;
