/**
 * Rivers and lakes as named, selectable things (water model stage 3). The rivers are still worked out from the land and the rain, never drawn, so a name is pinned to a
 * spot (`WaterName`, in `features.waterNames`, map px) and belongs to whichever river runs past that spot, or the lake that holds it, each time the water is worked out:
 * reshape the land and the name follows its river.
 *
 * The rivers are traced in pieces (from each head down to the first river already traced), so which river a stretch belongs to is worked out here (`riverNet`): where
 * one piece ends on another, the bigger of the two keeps its name below the junction (`riverOwner`), and a river's course runs from its head down to where it ends in the
 * sea, a lake or a bigger river (`riverCourse`). `waterAt` finds the river or lake at a point (the River tool), and `resolveWaterNames` gives each name its water and the
 * label it is drawn with (a river's name along its course, a lake's in its middle).
 */
import type { MapLabel, WaterName } from "./features.ts";
import type { RiverPath } from "./hydrology.ts";
import type { LakeShape, RiverEnd } from "./hydroSummary.ts";
import { pointInPolygon } from "./geom.ts";

export type WaterHit = { kind: "river"; river: number; at: number; x: number; y: number; dist: number } | { kind: "lake"; lake: number; x: number; y: number };

/** The lake at a point, else the river piece closest to it within `tol` map px (`at` is the index of its nearest point). */
export function waterAt(rivers: readonly RiverPath[], lakes: readonly LakeShape[], x: number, y: number, tol: number): WaterHit | null {
  for (let i = 0; i < lakes.length; i++) if (pointInPolygon(x, y, lakes[i].outline)) return { kind: "lake", lake: i, x: lakes[i].x, y: lakes[i].y };
  let best: Extract<WaterHit, { kind: "river" }> | null = null;
  rivers.forEach((r, ri) => {
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3];
      if (Math.min(ax, bx) - tol > x || Math.max(ax, bx) + tol < x || Math.min(ay, by) - tol > y || Math.max(ay, by) + tol < y) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), cx = ax + t * dx, cy = ay + t * dy, d = Math.hypot(cx - x, cy - y);
      if (d <= tol && (!best || d < best.dist)) best = { kind: "river", river: ri, at: t < 0.5 ? k / 2 : k / 2 + 1, x: cx, y: cy, dist: d };
    }
  });
  return best;
}

export interface RiverNet {
  rivers: readonly RiverPath[];
  /** Where each traced piece ends on another one (that piece and its point), or null. */
  joins: ({ river: number; at: number } | null)[];
  /** Per piece: the points where a bigger river comes in and carries on down it, [point index, incoming piece], in order. */
  takeovers: [number, number][][];
}

/** How close (map px) a piece's end must be to another piece to have joined it. */
const JOIN_REACH = 1.6;

/** Work out how the traced pieces join up (see the top of this file). */
export function riverNet(rivers: readonly RiverPath[]): RiverNet {
  // a coarse grid of every point, to find quickly where each piece's end meets another piece
  const CELL = 4, grid = new Map<number, number[]>();
  const key = (gx: number, gy: number) => gx * 100003 + gy;
  rivers.forEach((r, ri) => {
    for (let k = 0; k < r.pts.length; k += 2) {
      const kk = key(Math.floor(r.pts[k] / CELL), Math.floor(r.pts[k + 1] / CELL));
      let a = grid.get(kk);
      if (!a) grid.set(kk, (a = []));
      a.push(ri, k / 2);
    }
  });
  const joins = rivers.map((r, ri) => {
    const n = r.pts.length / 2;
    // (a piece that reached the sea, a lake or the map's edge joined nothing, even when it ends beside another river)
    if (n < 2 || (r.end && r.end !== "join")) return null;
    const ex = r.pts[n * 2 - 2], ey = r.pts[n * 2 - 1], gx = Math.floor(ex / CELL), gy = Math.floor(ey / CELL);
    let best: { river: number; at: number } | null = null, bd = JOIN_REACH;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = grid.get(key(gx + dx, gy + dy));
      if (a) for (let i = 0; i < a.length; i += 2) {
        if (a[i] === ri || a[i + 1] === rivers[a[i]].pts.length / 2 - 1) continue; // (not its own points, nor another piece's very end: two pieces can't end on each other)
        const o = rivers[a[i]].pts, k = a[i + 1], d = Math.hypot(o[k * 2] - ex, o[k * 2 + 1] - ey);
        if (d < bd) { bd = d; best = { river: a[i], at: k }; }
      }
    }
    return best;
  });
  // at each junction, the incoming piece carries on (keeps its name) if it is bigger than the river it meets, measured just above the junction
  const takeovers: [number, number][][] = rivers.map(() => []);
  joins.forEach((j, ri) => {
    if (!j) return;
    const a = rivers[ri].widths, b = rivers[j.river].widths;
    if (a[Math.max(0, a.length - 2)] > b[Math.max(0, j.at - 1)]) takeovers[j.river].push([j.at, ri]);
  });
  for (const t of takeovers) t.sort((x, y) => x[0] - y[0]);
  return { rivers, joins, takeovers };
}

/** Which river a point of a piece belongs to: the first piece of that river (its head). */
export function riverOwner(net: RiverNet, piece: number, at: number): number {
  for (let guard = 0; guard < 256; guard++) {
    let inc = -1;
    for (const [j, a] of net.takeovers[piece] ?? []) { if (j <= at) inc = a; else break; }
    if (inc < 0) return piece;
    piece = inc;
    at = net.rivers[inc].pts.length / 2 - 1;
  }
  return piece;
}

export interface RiverCourse {
  /** The pieces it runs through, downstream, with the points of each it covers. */
  parts: { river: number; from: number; to: number }[];
  /** The course as one line (flat x, y pairs, map px) from its head to where it ends. */
  pts: number[];
  /** Map px along it. */
  length: number;
  /** How it ends: in a lake, by joining a bigger river (`joins`: that river's head piece), or "open" (the sea or the map's edge: the caller tells which). */
  end: "lake" | "river" | "open";
  joins?: number;
}

/** A river (by its head piece, see `riverOwner`) from its head down to where it ends. */
export function riverCourse(net: RiverNet, head: number, lakes: readonly LakeShape[] = []): RiverCourse {
  const parts: RiverCourse["parts"] = [], pts: number[] = [];
  let r = head, f = 0, end: RiverCourse["end"] = "open", joins: number | undefined;
  const seen = new Set<number>();
  while (!seen.has(r)) {
    seen.add(r);
    const p = net.rivers[r].pts, n = p.length / 2;
    // a bigger river coming in further down this piece takes over from there
    const t = (net.takeovers[r] ?? []).find(([j]) => j > f);
    const to = t ? t[0] : n - 1;
    parts.push({ river: r, from: f, to });
    for (let k = f; k <= to; k++) {
      if (pts.length >= 2 && pts[pts.length - 2] === p[k * 2] && pts[pts.length - 1] === p[k * 2 + 1]) continue;
      pts.push(p[k * 2], p[k * 2 + 1]);
    }
    if (t) { end = "river"; joins = riverOwner(net, t[1], net.rivers[t[1]].pts.length / 2 - 1); break; }
    const j = net.joins[r];
    if (!j) break;
    // it ends on another piece: it carries on down that one if it is the bigger river there
    if ((net.takeovers[j.river] ?? []).some(([at, a]) => at === j.at && a === r)) { r = j.river; f = j.at; continue; }
    end = "river";
    joins = riverOwner(net, j.river, j.at);
    break;
  }
  let length = 0;
  for (let k = 2; k < pts.length; k += 2) length += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
  if (end === "open" && pts.length >= 2) {
    const ex = pts[pts.length - 2], ey = pts[pts.length - 1];
    if (lakes.some((l) => pointInPolygon(ex, ey, l.outline) || Math.hypot(l.x - ex, l.y - ey) < 2)) end = "lake";
  }
  return { parts, pts, length, end, ...(joins !== undefined && { joins }) };
}

/** Every river (by its head piece) with its course, longest first. */
export function riverList(net: RiverNet, lakes: readonly LakeShape[] = []): { head: number; course: RiverCourse }[] {
  const out: { head: number; course: RiverCourse }[] = [];
  net.rivers.forEach((r, i) => { if (r.pts.length >= 4 && riverOwner(net, i, 0) === i) out.push({ head: i, course: riverCourse(net, i, lakes) }); });
  return out.sort((a, b) => b.course.length - a.course.length);
}

export interface NamedWater {
  id: string;
  kind: WaterName["kind"];
  name: string;
  /** Whether its river or lake was found at its spot (a river can move away when the land is reshaped). */
  found: boolean;
  /** Rivers: its head piece (`riverOwner`), its length in km from its head to where it ends, how it ends, and the name of the river it joins, if that one is named. */
  head?: number;
  lengthKm?: number;
  end?: RiverEnd;
  joins?: string;
  /** Lakes: which one (an index into the lakes), its size, and whether a river leaves it. */
  lake?: number;
  areaKm2?: number;
  outflow?: LakeShape["outflow"];
}

export interface WaterView {
  /** Labels to draw the names with: a river's along its course round the named spot, a lake's in its middle. Each has its name's id. */
  labels: MapLabel[];
  named: NamedWater[];
}

/** How far (map px) a named spot may be from its river and still name it. */
export const WATER_NAME_REACH = 6;

/**
 * Each name's river or lake, as things are now, and its label. `isSea(x, y)` tells a river that ends in the sea from one that ends at the map's edge;
 * `mapWidth` sizes the stretch of river a name follows (labels are sized for a 1024-px map, as everywhere).
 */
export function resolveWaterNames(names: readonly WaterName[] | undefined, net: RiverNet, lakes: readonly LakeShape[], o: { mapWidth: number; kmPerPx: number; isSea?: (x: number, y: number) => boolean }): WaterView {
  const labels: MapLabel[] = [], named: NamedWater[] = [], k = o.mapWidth / 1024;
  const joinsHead = new Map<string, number>();
  for (const n of names ?? []) {
    if (n.kind === "lake") {
      const i = lakes.findIndex((l) => pointInPolygon(n.x, n.y, l.outline)), l = lakes[i];
      named.push({ id: n.id, kind: "lake", name: n.name, found: !!l, ...(l && { lake: i, areaKm2: l.areaKm2, outflow: l.outflow }) });
      if (l) labels.push({ id: n.id, text: n.name, kind: "feature", x: l.x, y: l.y, ...(l.areaKm2 >= 2000 && { size: 1.25 }) }); // (a great lake's name a little bigger)
      continue;
    }
    // a river: the one passing nearest the named spot (lakes don't count here: a river's name is never a lake's)
    const hit = waterAt(net.rivers, [], n.x, n.y, WATER_NAME_REACH);
    if (!hit || hit.kind !== "river") { named.push({ id: n.id, kind: "river", name: n.name, found: false }); continue; }
    const head = riverOwner(net, hit.river, hit.at), course = riverCourse(net, head, lakes);
    const ex = course.pts[course.pts.length - 2], ey = course.pts[course.pts.length - 1];
    const end: RiverEnd = course.end === "river" ? "river" : course.end === "lake" ? "lake" : o.isSea?.(ex, ey) ? "sea" : "elsewhere";
    named.push({ id: n.id, kind: "river", name: n.name, found: true, head, lengthKm: Math.round(course.length * o.kmPerPx), end });
    if (course.joins !== undefined) joinsHead.set(n.id, course.joins);
    // the label: the stretch of the course round the named spot, long enough for the name (about 7 px a letter at the feature size, on a 1024-px map)
    const half = (n.name.length * 4.2 + 14) * k;
    const pts = course.pts, at = nearestIndex(pts, hit.x, hit.y);
    let a = at, b = at, la = 0, lb = 0;
    while (a > 0 && la < half) { la += Math.hypot(pts[a * 2] - pts[a * 2 - 2], pts[a * 2 + 1] - pts[a * 2 - 1]); a--; }
    while (b < pts.length / 2 - 1 && lb < half) { lb += Math.hypot(pts[b * 2 + 2] - pts[b * 2], pts[b * 2 + 3] - pts[b * 2 + 1]); b++; }
    const raw: [number, number][] = [];
    for (let i = a; i <= b; i++) raw.push([pts[i * 2], pts[i * 2 + 1]]);
    // a gentle curve through the river's bends (the letters can't follow every small wiggle), every other point kept
    const path = smoothLine(raw, Math.max(3, Math.round(6 * k))).filter((_, i, all) => i % 2 === 0 || i === all.length - 1).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
    if (path.length >= 2 && path[path.length - 1][0] < path[0][0]) path.reverse(); // (read left to right, whichever way the water flows)
    if (path.length >= 2) labels.push({ id: n.id, text: n.name, kind: "feature", x: hit.x, y: hit.y, path });
  }
  // the river each one flows into, by name, when that one is named too
  for (const w of named) {
    const j = joinsHead.get(w.id);
    const into = j === undefined ? undefined : named.find((x) => x.kind === "river" && x.head === j);
    if (into) w.joins = into.name;
  }
  return { labels, named };
}

/** The name (and its entry) of the river or lake at a point, if it has one: what the River tool shows. */
export function namedWaterAt(named: readonly NamedWater[], net: RiverNet, hit: WaterHit | null): NamedWater | null {
  if (!hit) return null;
  if (hit.kind === "lake") return named.find((w) => w.kind === "lake" && w.found && w.lake === hit.lake) ?? null;
  const head = riverOwner(net, hit.river, hit.at);
  return named.find((w) => w.kind === "river" && w.found && w.head === head) ?? null;
}

/** For `resolveWaterNames`: is there sea within 2 px of a point (a river's last point is on the coast or the first sea cell). */
export function seaNear(h: Float32Array, W: number, H: number, sea: number): (x: number, y: number) => boolean {
  return (x, y) => {
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = cx + dx, Y = cy + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H && h[Y * W + X] <= sea) return true;
    }
    return false;
  };
}

/** A line smoothed by a moving average over `r` points either side (twice), its ends kept where they were. */
function smoothLine(pts: [number, number][], r: number): [number, number][] {
  let cur = pts;
  for (let pass = 0; pass < 2; pass++) {
    cur = cur.map((p, i) => {
      if (i === 0 || i === cur.length - 1) return p;
      const lo = Math.max(0, i - r), hi = Math.min(cur.length - 1, i + r);
      let sx = 0, sy = 0;
      for (let j = lo; j <= hi; j++) { sx += cur[j][0]; sy += cur[j][1]; }
      return [sx / (hi - lo + 1), sy / (hi - lo + 1)] as [number, number];
    });
  }
  return cur;
}

function nearestIndex(pts: readonly number[], x: number, y: number): number {
  let best = 0, bd = Infinity;
  for (let k = 0; k < pts.length; k += 2) { const d = Math.hypot(pts[k] - x, pts[k + 1] - y); if (d < bd) { bd = d; best = k / 2; } }
  return best;
}
