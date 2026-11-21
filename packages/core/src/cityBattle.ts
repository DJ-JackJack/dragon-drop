/**
 * A battlemap from a box of a city map (stage 5 of docs/CITY-MAPS.md): the ground as the city has it (the same materials: grass, water, cobbles...), the streets as
 * cobbles or dirt with their bridges as planks or flagstones, every building as walls round its outline with a door on the side nearest a street, a floor by what it is
 * (flagstones in a temple, hall, tower or gatehouse, dirt in a barn, planks elsewhere) and its roof (the same look or roof picture: the roofs fade in Foundry as tokens go in),
 * and the city walls with their towers (a thick wall as walls along both its faces and across its ends, with its top as flagstones or, on a rampart, dirt; a palisade as one
 * wall; towers walled round with a stone or plank floor; the gates are the gaps). Trees, names and labels are left to the DM.
 * Battle squares are `feetPerSquare` feet; the box is in metres from the city's corner.
 */
import type { MapDoc } from "./doc.ts";
import type { Rect } from "./geom.ts";
import { type BuildingKind, type MapBuilding, type MapRoof, type MapWall, newFeatureId } from "./features.ts";
import { battleSpec, insertDoor } from "./battle.ts";
import { buildingToRoof, citySpec } from "./city.ts";
import { bridgeKindFor, deckDistance, streetBridges } from "./cityBridges.ts";
import { cityWallPieces } from "./cityWalls.ts";
import { distToSegment, pointInPolygon } from "./geom.ts";

type Pt = [number, number];

export const METRES_PER_FOOT = 0.3048;

/** How many squares a box of the city makes at `feetPerSquare` feet a square. */
export function cityBattleSquares(rect: Pick<Rect, "w" | "h">, feetPerSquare = 5): { squaresX: number; squaresY: number; metresPerSquare: number } {
  const m = feetPerSquare * METRES_PER_FOOT;
  return { squaresX: Math.max(4, Math.round(rect.w / m)), squaresY: Math.max(4, Math.round(rect.h / m)), metresPerSquare: m };
}

/** A building's floor by what it is. */
function floorFor(kind: BuildingKind | undefined): number {
  return kind === "temple" || kind === "hall" || kind === "tower" || kind === "gatehouse" || kind === "arena" ? 1 : kind === "barn" ? 4 : 3;
}

/** The part of segment a-b inside the box [0, W] x [0, H] (Liang-Barsky), or null. */
function clipSegment(a: Pt, b: Pt, W: number, H: number): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0]], [dx, W - a[0]], [-dy, a[1]], [dy, H - a[1]]] as const) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  if (t1 - t0 < 1e-6) return null;
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Fill a new, empty battlemap (`battle`, made at the size `cityBattleSquares` gives) with the part `rect` of `city`. Returns what was put in it, counted and in words.
 */
export function battleFromCity(city: MapDoc, rect: Rect, battle: MapDoc): { buildings: number; doors: number; streets: number; walls: number; description: string } {
  const spec = citySpec(city), b = battleSpec(battle), m = (b.feetPerSquare * METRES_PER_FOOT);
  const W = b.squaresX, H = b.squaresY, sub = b.sub, f = city.features ?? { places: [], labels: [] };
  const toSq = ([x, y]: readonly number[]): Pt => [r3((x - rect.x) / m), r3((y - rect.y) / m)];
  const inBox = ([x, y]: Pt) => x >= 0 && y >= 0 && x <= W && y <= H;
  const { w: FW, h: FH, data } = battle.height, ground = city.height;
  // the ground, cell by cell, as the city has it
  for (let cy = 0; cy < FH; cy++) for (let cx = 0; cx < FW; cx++) {
    const mx = rect.x + ((cx + 0.5) / sub) * m, my = rect.y + ((cy + 0.5) / sub) * m;
    const gx = Math.max(0, Math.min(ground.w - 1, Math.floor(mx / spec.cellM))), gy = Math.max(0, Math.min(ground.h - 1, Math.floor(my / spec.cellM)));
    data[cy * FW + cx] = Math.round(ground.data[gy * ground.w + gx]) || 5;
  }
  /** Set every cell whose middle (metres) passes `inside` within the box (x0..x1, y0..y1 metres). */
  const paint = (x0: number, y0: number, x1: number, y1: number, inside: (mx: number, my: number) => boolean, material: number) => {
    const c0 = Math.max(0, Math.floor(((x0 - rect.x) / m) * sub)), c1 = Math.min(FW - 1, Math.ceil(((x1 - rect.x) / m) * sub));
    const r0 = Math.max(0, Math.floor(((y0 - rect.y) / m) * sub)), r1 = Math.min(FH - 1, Math.ceil(((y1 - rect.y) / m) * sub));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const mx = rect.x + ((cx + 0.5) / sub) * m, my = rect.y + ((cy + 0.5) / sub) * m;
      if (inside(mx, my)) data[cy * FW + cx] = material;
    }
  };
  const near = (pts: readonly (readonly number[])[], pad: number) => {
    let a = Infinity, c = Infinity, e = -Infinity, g = -Infinity;
    for (const [x, y] of pts) { if (x < a) a = x; if (y < c) c = y; if (x > e) e = x; if (y > g) g = y; }
    return { x0: a - pad, y0: c - pad, x1: e + pad, y1: g + pad, meets: e + pad >= rect.x && a - pad <= rect.x + rect.w && g + pad >= rect.y && c - pad <= rect.y + rect.h };
  };
  // the streets: cobbles for avenues and streets, dirt for lanes, alleys and paths; their bridges as flagstones or planks
  const streets = (f.streets ?? []).filter((s) => near(s.points, s.width).meets);
  for (const s of streets) {
    const half = s.width / 2, bb = near(s.points, half), mat = (s.kind ? s.kind === "avenue" || s.kind === "street" : s.width >= 5) ? 2 : 4;
    paint(bb.x0, bb.y0, bb.x1, bb.y1, (mx, my) => { for (let i = 0; i + 1 < s.points.length; i++) if (distToSegment(mx, my, s.points[i][0], s.points[i][1], s.points[i + 1][0], s.points[i + 1][1]) <= half) return true; return false; }, mat);
    for (const span of streetBridges(s, ground, spec.cellM)) {
      if (span.kind === "ford") continue;
      const sb = near(span.points, half);
      paint(sb.x0, sb.y0, sb.x1, sb.y1, (mx, my) => deckDistance(mx, my, span.points) <= half, bridgeKindFor(s) === "stone" ? 1 : 3);
    }
  }
  // the buildings: a floor, walls round the outline (cut at the box's edge), a door toward the nearest street, and the roof
  const walls: MapWall[] = [], roofs: MapRoof[] = [];
  let buildings = 0, doors = 0;
  const sides = (pts: Pt[]) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as [Pt, Pt]);
  for (const bl of (f.buildings ?? []) as MapBuilding[]) {
    const bb = near(bl.points, 0);
    if (!bb.meets) continue;
    const sq = bl.points.map(toSq);
    if (!sides(sq).some(([a, c]) => clipSegment(a, c, W, H))) continue; // (only a corner of its box touches)
    buildings++;
    paint(bb.x0, bb.y0, bb.x1, bb.y1, (mx, my) => pointInPolygon(mx, my, bl.points as Pt[]), floorFor(bl.kind));
    if (sq.every(inBox)) {
      let own: MapWall[] = [{ id: newFeatureId("w"), kind: "wall", points: sq, closed: true }];
      // the door: on the side whose middle is nearest a street, if it is long enough and there is a street within 25 m
      let best: { at: Pt; d: number } | null = null;
      for (const [a, c] of sides(bl.points as Pt[])) {
        if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 1.6) continue;
        const mid: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        for (const s of streets) for (let i = 0; i + 1 < s.points.length; i++) {
          const d = distToSegment(mid[0], mid[1], s.points[i][0], s.points[i][1], s.points[i + 1][0], s.points[i + 1][1]) - s.width / 2;
          if (d < 25 && (!best || d < best.d)) best = { at: mid, d };
        }
      }
      if (best) {
        const r = insertDoor(own, (best.at[0] - rect.x) / m, (best.at[1] - rect.y) / m, Math.min(1, 1.2 / m), "door", () => newFeatureId("w"));
        if (r) { own = [...own.filter((x) => !r.remove.includes(x.id)), ...r.add]; doors++; }
      }
      walls.push(...own);
      const roof = buildingToRoof(bl, true);
      roofs.push({ ...roof, id: newFeatureId("f"), points: sq, ...(roof.tile && { tile: r3(roof.tile / m) }) });
    } else {
      for (const [a, c] of sides(sq)) { const cut = clipSegment(a, c, W, H); if (cut) walls.push({ id: newFeatureId("w"), kind: "wall", points: cut.map(([x, y]) => [r3(x), r3(y)] as Pt) }); }
    }
  }
  // the city walls and their towers (the gates are gaps already)
  let cityWalls = 0;
  const addLine = (pts: Pt[], closed: boolean) => {
    let any = false;
    const n = pts.length, k = closed ? n : n - 1;
    for (let i = 0; i < k; i++) { const cut = clipSegment(pts[i], pts[(i + 1) % n], W, H); if (cut) { walls.push({ id: newFeatureId("w"), kind: "wall", points: cut.map(([x, y]) => [r3(x), r3(y)] as Pt) }); any = true; } }
    return any;
  };
  /** A line moved sideways by `d` metres (each corner along the mean of its sides' normals, kept from spiking at sharp corners). */
  const offset = (pts: Pt[], closed: boolean, d: number): Pt[] => pts.map((p, i) => {
    const n = pts.length, prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const nrm = (a: Pt, c: Pt): Pt => { const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [-(c[1] - a[1]) / l, (c[0] - a[0]) / l]; };
    const n1 = i > 0 || closed ? nrm(prev, p) : nrm(p, next), n2 = i < n - 1 || closed ? nrm(p, next) : n1;
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const k = Math.min(3, 1 / Math.max(0.33, mx * n1[0] + my * n1[1]));
    return [p[0] + mx * d * k, p[1] + my * d * k];
  });
  for (const wp of cityWallPieces(f.cityWalls, f.streets)) {
    let any = false;
    const half = wp.thickness / 2, thick = wp.kind !== "palisade" && wp.thickness >= 1.5, top = wp.kind === "earth" ? 4 : 1;
    for (const s of wp.stretches) {
      if (!thick) { any = addLine(s.points.map(toSq), s.closed) || any; continue; }
      // both faces, the ends closed across, and the top painted
      const left = offset(s.points, s.closed, half), right = offset(s.points, s.closed, -half);
      any = addLine(left.map(toSq), s.closed) || any;
      any = addLine(right.map(toSq), s.closed) || any;
      if (!s.closed) { addLine([left[0], right[0]].map(toSq), false); addLine([left[left.length - 1], right[right.length - 1]].map(toSq), false); }
      const bb = near(s.points, half);
      const n = s.points.length, k = s.closed ? n : n - 1;
      paint(bb.x0, bb.y0, bb.x1, bb.y1, (mx, my) => { for (let i = 0; i < k; i++) { const a = s.points[i], c = s.points[(i + 1) % n]; if (distToSegment(mx, my, a[0], a[1], c[0], c[1]) <= half) return true; } return false; }, top);
    }
    for (const t of wp.towers) {
      const corners: Pt[] = t.square
        ? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [t.x + t.r * (u * Math.cos(t.angle) - v * Math.sin(t.angle)), t.y + t.r * (u * Math.sin(t.angle) + v * Math.cos(t.angle))] as Pt)
        : Array.from({ length: 8 }, (_, i) => [t.x + t.r * Math.cos((i * Math.PI) / 4), t.y + t.r * Math.sin((i * Math.PI) / 4)] as Pt);
      const sq = corners.map(toSq);
      if (!sq.every(inBox)) continue;
      const bb = near(corners, 0);
      paint(bb.x0, bb.y0, bb.x1, bb.y1, (mx, my) => pointInPolygon(mx, my, corners), wp.kind === "palisade" ? 3 : 1);
      walls.push({ id: newFeatureId("w"), kind: "wall", points: sq, closed: true });
      any = true;
    }
    if (any) cityWalls++;
  }
  battle.features = { ...battle.features!, walls: [...(battle.features?.walls ?? []), ...walls], roofs: [...(battle.features?.roofs ?? []), ...roofs] };
  const parts = [`${buildings} building${buildings === 1 ? "" : "s"} (walls, ${doors} door${doors === 1 ? "" : "s"} toward the streets, roofs)`, `${streets.length} street${streets.length === 1 ? "" : "s"}`];
  if (cityWalls) parts.push(`${cityWalls} city wall${cityWalls === 1 ? "" : "s"}`);
  return { buildings, doors, streets: streets.length, walls: cityWalls, description: `${Math.round(rect.w)} x ${Math.round(rect.h)} m of ${city.meta.name} at (${Math.round(rect.x)}, ${Math.round(rect.y)}) m: ${parts.join(", ")}` };
}
