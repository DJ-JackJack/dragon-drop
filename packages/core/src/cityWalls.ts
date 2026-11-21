/**
 * City walls on a city map (`features.cityWalls`): a line through points in metres, or a ring (`closed`), of one kind: a stone wall, a wooden palisade or an earth rampart.
 * Like the bridges, what stands on it is worked out from the wall and the streets each time it is drawn (`wallPieces`), so moving a street moves its gate:
 *   - wherever a street crosses the wall there is a GATE: an opening as wide as the street needs, with a gatehouse (a tower each side) where an avenue or street passes a
 *     stone wall or a palisade, and a plain opening for a lane, an alley, a path, or any street through an earth rampart;
 *   - TOWERS stand at the corners, at the ends of an open wall, and between them about every `towers` metres (round on stone, square on wood; none on an earth rampart
 *     unless asked), never in a gate's opening;
 *   - the wall itself is the STRETCHES between the gates.
 * The editor (CityView) and the pictures (cityRender) draw the same pieces with the same colours (`WALL_COLOURS`).
 */
import type { MapCityWall, MapStreet, CityWallKind } from "./features.ts";
import type { CitySpec } from "./city.ts";

type Pt = [number, number];

export const WALL_KINDS: readonly { id: CityWallKind; name: string; thickness: number; towers: number; hint: string }[] = [
  { id: "stone", name: "Stone wall", thickness: 3, towers: 40, hint: "a stone curtain wall with round towers, and gatehouses where the main streets pass" },
  { id: "palisade", name: "Wooden palisade", thickness: 1.2, towers: 30, hint: "a fence of logs with square wooden towers: a village, a camp, a frontier town" },
  { id: "earth", name: "Earth rampart", thickness: 7, towers: 0, hint: "a bank of earth with a ditch outside it: an old hill fort or a quick defence" },
];

export const WALL_COLOURS = {
  stoneTop: [192, 186, 172] as const, stoneWalk: [168, 161, 148] as const, stoneEdge: [88, 82, 74] as const, stoneTower: [182, 176, 162] as const, stoneRoof: [120, 112, 104] as const,
  woodTop: [134, 98, 60] as const, woodEdge: [66, 46, 28] as const, woodTower: [118, 84, 50] as const,
  earthBank: [126, 138, 88] as const, earthCrest: [156, 164, 110] as const, earthEdge: [84, 92, 60] as const, ditch: [68, 86, 72] as const,
};

export interface WallTower {
  x: number; y: number;
  /** Radius (round) or half the side (square), metres. */
  r: number;
  square: boolean;
  /** The wall's direction there, radians (a square tower is turned with it). */
  angle: number;
  /** One of a gatehouse's pair. */
  gate?: boolean;
}

export interface WallGate {
  x: number; y: number;
  /** The wall's direction there, radians. */
  angle: number;
  /** The opening, metres along the wall. */
  width: number;
  streetId: string;
  /** A gatehouse (a tower each side) rather than a plain opening. */
  gatehouse: boolean;
  /** Metres along the wall from its first point. */
  at: number;
}

export interface WallPieces {
  wallId: string;
  kind: CityWallKind;
  thickness: number;
  /** The wall between the gates (a ring with no gate is one closed stretch). */
  stretches: { points: Pt[]; closed: boolean }[];
  towers: WallTower[];
  gates: WallGate[];
  /** Metres all round (a ring includes its closing side). */
  length: number;
  closed: boolean;
  /** For a ring: its outline (to tell the outside, where an earth rampart's ditch is, from the inside). */
  ring: Pt[] | null;
}

/** A wall's kind, thickness and tower spacing, with the kind's defaults filled in. */
export function wallSettings(w: Pick<MapCityWall, "kind" | "thickness" | "towers">): { kind: CityWallKind; thickness: number; towers: number } {
  const k = WALL_KINDS.find((x) => x.id === w.kind) ?? WALL_KINDS[0];
  return { kind: k.id, thickness: w.thickness ?? k.thickness, towers: w.towers ?? k.towers };
}

/** A tower's size on a wall of this kind and thickness. */
export function towerSize(kind: CityWallKind, thickness: number): { r: number; square: boolean } {
  return kind === "palisade" ? { r: Math.max(1.8, thickness * 1.6), square: true } : { r: Math.max(3, thickness * 1.25), square: kind === "earth" };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const cumOf = (pts: Pt[]) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };

function pointAlong(pts: Pt[], cum: number[], d: number): { x: number; y: number; angle: number } {
  let i = 0;
  while (i + 2 < cum.length && cum[i + 1] < d) i++;
  const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = cum[i + 1] - cum[i], f = len > 0 ? (d - cum[i]) / len : 0;
  return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, angle: Math.atan2(by - ay, bx - ax) };
}

function subLine(pts: Pt[], cum: number[], d0: number, d1: number): Pt[] {
  const a = pointAlong(pts, cum, d0), b = pointAlong(pts, cum, d1);
  const out: Pt[] = [[a.x, a.y]];
  for (let i = 1; i + 1 < pts.length; i++) if (cum[i] > d0 + 1e-6 && cum[i] < d1 - 1e-6) out.push(pts[i]);
  out.push([b.x, b.y]);
  return out.map(([x, y]) => [r2(x), r2(y)] as Pt);
}

/** Where two segments cross: the fraction along each, or null. */
function crossing(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number } | null {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** The streets that get a gatehouse rather than a plain opening (by kind, or by width when a street has none). */
const isMainStreet = (s: MapStreet) => (s.kind ? s.kind === "avenue" || s.kind === "street" : s.width >= 5);

/** What stands on a wall: its stretches, towers and gates (see the top of this file). */
export function wallPieces(w: MapCityWall, streets: readonly MapStreet[]): WallPieces {
  const { kind, thickness, towers: every } = wallSettings(w);
  const closed = !!w.closed && w.points.length >= 3;
  const line: Pt[] = closed ? [...(w.points as Pt[]), w.points[0] as Pt] : (w.points as Pt[]);
  const out: WallPieces = { wallId: w.id, kind, thickness, stretches: [], towers: [], gates: [], length: 0, closed, ring: closed ? (w.points as Pt[]) : null };
  if (line.length < 2) return out;
  const cum = cumOf(line), total = cum[cum.length - 1];
  out.length = Math.round(total * 10) / 10;
  if (total < 0.5) return out;

  // the gates: wherever a street crosses the wall
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of line) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  type Raw = { at: number; open: number; streetId: string; gatehouse: boolean };
  const raw: Raw[] = [];
  for (const s of streets) {
    const sp = s.points as Pt[];
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (const [x, y] of sp) { if (x < a0) a0 = x; if (x > a1) a1 = x; if (y < b0) b0 = y; if (y > b1) b1 = y; }
    if (a1 < x0 || a0 > x1 || b1 < y0 || b0 > y1) continue;
    for (let j = 0; j + 1 < sp.length; j++) {
      for (let i = 0; i + 1 < line.length; i++) {
        const c = crossing(line[i], line[i + 1], sp[j], sp[j + 1]);
        if (!c) continue;
        const wx = line[i + 1][0] - line[i][0], wy = line[i + 1][1] - line[i][1], sx = sp[j + 1][0] - sp[j][0], sy = sp[j + 1][1] - sp[j][1];
        const sin = Math.abs(wx * sy - wy * sx) / ((Math.hypot(wx, wy) * Math.hypot(sx, sy)) || 1);
        // (a street crossing at a slant needs a wider opening, up to three times its width)
        const open = Math.min(3 * (s.width + 1), (s.width + 1) / Math.max(0.33, sin));
        raw.push({ at: cum[i] + c.t * (cum[i + 1] - cum[i]), open, streetId: s.id, gatehouse: kind !== "earth" && isMainStreet(s) });
      }
    }
  }
  raw.sort((a, b) => a.at - b.at);
  // gates whose openings meet are one (a street meeting the wall at a corner crosses two sides)
  const gates: Raw[] = [];
  for (const g of raw) {
    const last = gates[gates.length - 1];
    if (last && g.at - g.open / 2 <= last.at + last.open / 2) {
      const lo = Math.min(last.at - last.open / 2, g.at - g.open / 2), hi = Math.max(last.at + last.open / 2, g.at + g.open / 2);
      last.at = (lo + hi) / 2; last.open = hi - lo; last.gatehouse ||= g.gatehouse;
    } else gates.push({ ...g });
  }
  if (closed && gates.length > 1) {
    // (round the ring: the last gate may run into the first)
    const first = gates[0], last = gates[gates.length - 1];
    if (last.at + last.open / 2 >= first.at - first.open / 2 + total) {
      const lo = last.at - last.open / 2, hi = first.at + first.open / 2 + total;
      first.at = ((lo + hi) / 2) % total; first.open = hi - lo; first.gatehouse ||= last.gatehouse;
      gates.pop();
    }
  }
  const gate = { r: kind === "palisade" ? Math.max(1.8, thickness * 1.5) : Math.max(2.8, thickness * 1.1) };
  for (const g of gates) {
    const p = pointAlong(line, cum, ((g.at % total) + total) % total);
    out.gates.push({ x: r2(p.x), y: r2(p.y), angle: p.angle, width: r2(g.open), streetId: g.streetId, gatehouse: g.gatehouse, at: r2(g.at) });
    if (g.gatehouse) {
      for (const side of [-1, 1]) {
        const d = g.at + side * (g.open / 2 + gate.r), q = pointAlong(line, cum, closed ? ((d % total) + total) % total : Math.max(0, Math.min(total, d)));
        out.towers.push({ x: r2(q.x), y: r2(q.y), r: r2(gate.r), square: true, angle: q.angle, gate: true });
      }
    }
  }

  // the stretches between the gates
  if (!gates.length) out.stretches.push({ points: (closed ? w.points : line).map(([x, y]) => [r2(x), r2(y)] as Pt), closed });
  else if (!closed) {
    let from = 0;
    for (const g of gates) {
      const to = g.at - g.open / 2;
      if (to - from >= 0.3) out.stretches.push({ points: subLine(line, cum, Math.max(0, from), to), closed: false });
      from = g.at + g.open / 2;
    }
    if (total - from >= 0.3) out.stretches.push({ points: subLine(line, cum, from, total), closed: false });
  } else {
    // a ring: from each gate's far side round to the next gate's near side
    // (d0 is inside the ring's length; a stretch past its end carries on from its start)
    const ringSub = (d0: number, d1: number): Pt[] => d1 <= total ? subLine(line, cum, d0, d1) : [...subLine(line, cum, d0, total), ...subLine(line, cum, 0, d1 - total).slice(1)];
    for (let k = 0; k < gates.length; k++) {
      const g = gates[k], next = gates[(k + 1) % gates.length];
      const from = g.at + g.open / 2;
      let to = next.at - next.open / 2;
      while (to <= from) to += total;
      if (to - from >= 0.3) {
        const d0 = ((from % total) + total) % total;
        out.stretches.push({ points: ringSub(d0, d0 + (to - from)), closed: false });
      }
    }
  }

  // the towers: at the corners and ends, then evenly between them, never in a gate
  if (every > 0) {
    const t = towerSize(kind, thickness), at: number[] = [];
    const n = line.length;
    const turn = (i: number) => {
      const a = closed ? line[(i - 1 + (n - 1)) % (n - 1)] : line[i - 1], b = line[i], c = closed ? line[(i + 1) % (n - 1)] : line[i + 1];
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d;
    };
    if (closed) { for (let i = 0; i < n - 1; i++) if (turn(i) > (20 * Math.PI) / 180) at.push(cum[i]); }
    else { at.push(0); for (let i = 1; i < n - 1; i++) if (turn(i) > (20 * Math.PI) / 180) at.push(cum[i]); at.push(total); }
    const anchors = [...at];
    if (!anchors.length) { const k = Math.max(3, Math.round(total / every)); for (let j = 0; j < k; j++) at.push((total * j) / k); }
    else {
      const spans = closed ? anchors.map((a, k) => [a, k + 1 < anchors.length ? anchors[k + 1] : anchors[0] + total]) : anchors.slice(0, -1).map((a, k) => [a, anchors[k + 1]]);
      for (const [a, b] of spans) { const k = Math.round((b - a) / every); for (let j = 1; j < k; j++) at.push(a + ((b - a) * j) / k); }
    }
    const inGate = (d: number) => gates.some((g) => {
      const reach = g.open / 2 + t.r + 0.5 + (g.gatehouse ? gate.r * 2 : 0);
      const dd = Math.abs(d - g.at), wrap = closed ? Math.min(dd, total - dd) : dd;
      return wrap < reach;
    });
    const placed: number[] = [];
    for (const d0 of at.sort((a, b) => a - b)) {
      const d = closed ? ((d0 % total) + total) % total : d0;
      if (inGate(d)) continue;
      if (placed.some((q) => { const dd = Math.abs(q - d); return (closed ? Math.min(dd, total - dd) : dd) < t.r * 2.4; })) continue;
      placed.push(d);
      const p = pointAlong(line, cum, Math.min(d, total));
      out.towers.push({ x: r2(p.x), y: r2(p.y), r: r2(t.r), square: t.square, angle: p.angle });
    }
  }
  return out;
}

/** Every wall's pieces. */
export function cityWallPieces(walls: readonly MapCityWall[] | undefined, streets: readonly MapStreet[] | undefined): WallPieces[] {
  return (walls ?? []).map((w) => wallPieces(w, streets ?? []));
}

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A wall from outside (a message or a tool), checked and tidied; an error message when it can't be a wall of this city. */
export function cleanCityWall(raw: unknown, spec: CitySpec): MapCityWall | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "not a wall" };
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_OK.test(o.id)) return { error: "a wall needs an id" };
  if (!Array.isArray(o.points) || o.points.length < 2) return { error: `wall ${o.id} needs at least 2 points` };
  if (o.points.length > 400) return { error: `wall ${o.id} has more than 400 points` };
  const points: Pt[] = [];
  for (const q of o.points) {
    if (!Array.isArray(q) || q.length !== 2 || !finite(q[0]) || !finite(q[1])) return { error: `wall ${o.id} has a point that isn't two numbers` };
    if (q[0] < 0 || q[1] < 0 || q[0] > spec.widthM || q[1] > spec.heightM) return { error: `wall ${o.id} has a point (${q[0]}, ${q[1]}) outside the map, which is ${spec.widthM} x ${spec.heightM} metres` };
    points.push([r2(q[0]), r2(q[1])]);
  }
  const out: MapCityWall = { id: o.id, points };
  if (o.closed === true) {
    if (points.length < 3) return { error: `wall ${o.id} needs at least 3 points to be a ring` };
    out.closed = true;
  }
  if (typeof o.kind === "string") {
    if (!WALL_KINDS.some((k) => k.id === o.kind)) return { error: `wall ${o.id}'s kind must be one of ${WALL_KINDS.map((k) => k.id).join(", ")}` };
    out.kind = o.kind as CityWallKind;
  }
  if (o.thickness !== undefined) {
    if (!finite(o.thickness) || o.thickness < 0.3 || o.thickness > 30) return { error: `wall ${o.id}'s thickness must be between 0.3 and 30 metres` };
    out.thickness = r2(o.thickness);
  }
  if (o.towers !== undefined) {
    if (!finite(o.towers) || o.towers < 0 || (o.towers > 0 && o.towers < 8) || o.towers > 500) return { error: `wall ${o.id}'s towers must be 0 (none) or 8 to 500 metres apart` };
    out.towers = Math.round(o.towers);
  }
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
  return out;
}

/** Distance from a point to a wall's middle line (a ring includes its closing side). */
export function distToWall(x: number, y: number, w: Pick<MapCityWall, "points" | "closed">): number {
  const pts = w.points, n = pts.length, sides = w.closed && n >= 3 ? n : n - 1;
  let best = Infinity;
  for (let i = 0; i < sides; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best) best = d;
  }
  return best;
}
