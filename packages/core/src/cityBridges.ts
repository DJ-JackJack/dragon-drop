/**
 * Bridges on a city map: wherever a street crosses water (ground painted shallow or deep water), that stretch is a bridge, worked out from the street and the ground each time it
 * is drawn, so moving the street or painting the river moves the bridge with it. A street's `bridge` says what kind: stone (a deck between low walls, on piers with cutwaters),
 * wood (planks between railings, on posts), or none (a ford: the street runs through the water); with none set it is stone for avenues and streets, wood for lanes, alleys
 * and paths. The editor (CityView) and the pictures (cityRender) draw the same spans with the same colours.
 */
import type { CitySpec } from "./city.ts";
import type { MapStreet, StreetKind } from "./features.ts";

type Pt = [number, number];

/** What a street's bridge setting can be (stored as `MapStreet.bridge`; missing means automatic). */
export const BRIDGE_SETTINGS = ["auto", "stone", "wood", "none"] as const;
export type BridgeKind = "stone" | "wood" | "ford";

/** The ground materials that are water (shallow water, deep water). */
export const WATER_MATERIALS: ReadonlySet<number> = new Set([7, 8]);

export const BRIDGE_COLOURS = {
  stoneDeck: [178, 170, 154] as const, stoneWall: [104, 96, 86] as const, stonePier: [126, 118, 106] as const,
  woodDeck: [140, 102, 64] as const, woodRail: [78, 54, 32] as const, woodPlank: [96, 68, 40] as const,
  ford: [96, 150, 178] as const,
};

/** The ground a city is drawn on: its material cells. */
export interface CityGround { w: number; h: number; data: ArrayLike<number> }

export interface BridgeSpan {
  streetId: string;
  kind: BridgeKind;
  /** The deck's middle line, metres, from bank to bank (a little onto each bank). */
  points: Pt[];
  /** Deck width, metres (the street's). */
  width: number;
  /** Metres along the deck. */
  length: number;
  /** Stone: piers standing in the water across the deck (where, and the deck's direction there in radians). */
  piers: { x: number; y: number; angle: number }[];
  /** Wood: posts along both edges. */
  posts: Pt[];
}

/** The kind of bridge a street gets: its own setting, or stone for avenues and streets, wood for lanes, alleys and paths (and by width when it has no kind). */
export function bridgeKindFor(s: Pick<MapStreet, "bridge" | "kind" | "width">): BridgeKind {
  if (s.bridge === "stone" || s.bridge === "wood") return s.bridge;
  if (s.bridge === "none") return "ford";
  const big: readonly StreetKind[] = ["avenue", "street"];
  return s.kind ? (big.includes(s.kind) ? "stone" : "wood") : s.width >= 5 ? "stone" : "wood";
}

export function isWaterAt(ground: CityGround, cellM: number, x: number, y: number): boolean {
  const cx = Math.floor(x / cellM), cy = Math.floor(y / cellM);
  if (cx < 0 || cy < 0 || cx >= ground.w || cy >= ground.h) return false;
  return WATER_MATERIALS.has(Math.round(ground.data[cy * ground.w + cx]));
}

/** The part of a line between two distances along it. */
function subLine(pts: Pt[], cum: number[], d0: number, d1: number): Pt[] {
  const at = (d: number): Pt => {
    let i = 0;
    while (i + 2 < cum.length && cum[i + 1] < d) i++;
    const len = cum[i + 1] - cum[i], f = len > 0 ? (d - cum[i]) / len : 0;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
  };
  const out: Pt[] = [at(d0)];
  for (let i = 1; i + 1 < pts.length; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[i]);
  out.push(at(d1));
  return out;
}

/** A point and the direction (radians) at a distance along a line. */
function pointAlong(pts: Pt[], cum: number[], d: number): { x: number; y: number; angle: number } {
  let i = 0;
  while (i + 2 < cum.length && cum[i + 1] < d) i++;
  const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = cum[i + 1] - cum[i], f = len > 0 ? (d - cum[i]) / len : 0;
  return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, angle: Math.atan2(by - ay, bx - ax) };
}

const cumOf = (pts: Pt[]) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };

/** One street's bridges: each stretch over water, joined across small islands, reaching a little onto each bank. */
export function streetBridges(s: MapStreet, ground: CityGround, cellM: number): BridgeSpan[] {
  const pts = s.points as Pt[];
  if (pts.length < 2) return [];
  const cum = cumOf(pts), total = cum[cum.length - 1];
  if (total <= 0) return [];
  const step = Math.max(0.25, Math.min(0.5, cellM / 3));
  // the stretches over water
  const runs: [number, number][] = [];
  let start = -1;
  for (let d = 0; d <= total + step / 2; d += step) {
    const p = pointAlong(pts, cum, Math.min(d, total)), wet = isWaterAt(ground, cellM, p.x, p.y);
    if (wet && start < 0) start = d;
    if (!wet && start >= 0) { runs.push([start, d]); start = -1; }
  }
  if (start >= 0) runs.push([start, total]);
  if (!runs.length) return [];
  // a bridge doesn't stop for a sandbank: stretches close together are one
  const joined: [number, number][] = [];
  for (const r of runs) {
    const last = joined[joined.length - 1];
    if (last && r[0] - last[1] < Math.max(4, s.width)) last[1] = r[1]; else joined.push([r[0], r[1]]);
  }
  const kind = bridgeKindFor(s), abut = Math.max(1.5, cellM * 0.6);
  const out: BridgeSpan[] = [];
  for (const [w0, w1] of joined) {
    if (w1 - w0 < 1) continue; // (a speck of water at the edge of a cell)
    const d0 = Math.max(0, w0 - abut), d1 = Math.min(total, w1 + abut), length = d1 - d0;
    const span: BridgeSpan = { streetId: s.id, kind, points: subLine(pts, cum, d0, d1).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as Pt), width: s.width, length: Math.round(length * 10) / 10, piers: [], posts: [] };
    if (kind === "stone") {
      const n = Math.floor((w1 - w0) / 11);
      for (let i = 1; i <= n; i++) {
        const p = pointAlong(pts, cum, w0 + ((w1 - w0) * i) / (n + 1));
        if (isWaterAt(ground, cellM, p.x, p.y)) span.piers.push(p);
      }
    } else if (kind === "wood") {
      const n = Math.max(1, Math.round(length / 3.5)), half = s.width / 2;
      for (let i = 0; i <= n; i++) {
        const p = pointAlong(pts, cum, d0 + (length * i) / n), nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
        span.posts.push([p.x + nx * half, p.y + ny * half], [p.x - nx * half, p.y - ny * half]);
      }
    }
    out.push(span);
  }
  return out;
}

/** Distance (metres) from a point to a bridge's middle line, with square ends: beyond either end (across the end of the first or last stretch) it is infinitely far. */
export function deckDistance(x: number, y: number, pts: readonly Pt[]): number {
  const n = pts.length;
  if (n < 2) return Infinity;
  const beyond = (a: Pt, b: Pt, side: number) => { const dx = b[0] - a[0], dy = b[1] - a[1]; return ((x - a[0]) * dx + (y - a[1]) * dy) * side < 0; };
  if (beyond(pts[0], pts[1], 1) || beyond(pts[n - 1], pts[n - 2], 1)) return Infinity;
  let best = Infinity;
  for (let i = 0; i + 1 < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best) best = d;
  }
  return best;
}

/** Every bridge of a city (or of the streets given). */
export function cityBridges(spec: CitySpec, ground: CityGround, streets: readonly MapStreet[]): BridgeSpan[] {
  return streets.flatMap((s) => streetBridges(s, ground, spec.cellM));
}
