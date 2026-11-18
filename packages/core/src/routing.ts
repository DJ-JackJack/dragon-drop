/**
 * Terrain-aware route finding for roads and trails: A* over a coarse grid. Flat ground is
 * cheap, steep ground expensive, sea and lakes are blocked, river crossings cost extra, and
 * existing roads are preferred so new roads join the network.
 */
import type { Derived } from "./climate.ts";
import type { MapDoc } from "./doc.ts";
import type { MapLine } from "./features.ts";
import { simplifyPath } from "./features.ts";

export interface RouteOptions {
  /** Prefer existing roads and trails (default true). */
  followExisting?: boolean;
  /** Trails tolerate steeper ground than roads (default false). */
  steepOk?: boolean;
}

export interface RouteResult {
  points: [number, number][];
  lengthKm: number;
}

/** Chaikin corner-cutting; endpoints are kept. */
export function chaikin(pts: [number, number][], iterations = 2): [number, number][] {
  let p = pts;
  for (let it = 0; it < iterations && p.length > 2; it++) {
    const out: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export function lineLengthKm(points: [number, number][], kmPerPx: number, closed = false): number {
  let px = 0;
  for (let i = 1; i < points.length; i++) px += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed && points.length > 2) px += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  return px * kmPerPx;
}

/** Mark grid cells along a polyline. */
function markLine(mask: Uint8Array, gw: number, gh: number, cell: number, pts: ArrayLike<number>, stride: number) {
  for (let s = 0; s + 2 * stride - 1 < pts.length; s += stride) {
    const ax = pts[s] / cell, ay = pts[s + 1] / cell, bx = pts[s + stride] / cell, by = pts[s + stride + 1] / cell;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(ax + ((bx - ax) * k) / n), y = Math.floor(ay + ((by - ay) * k) / n);
      if (x >= 0 && y >= 0 && x < gw && y < gh) mask[y * gw + x] = 1;
    }
  }
}

/** One leg of a route between two map-px points. */
function routeLeg(doc: MapDoc, d: Derived | null, existing: MapLine[], from: [number, number], to: [number, number], o: RouteOptions): RouteResult | { error: string } {
  const { w: W, h: H, data } = doc.height;
  const sea = doc.meta.seaLevel, km = doc.meta.kmPerPx;
  const cell = Math.max(1, Math.ceil(Math.max(W, H) / 600));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), N = gw * gh;
  const elev = new Float32Array(N);
  const block = new Uint8Array(N);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let sum = 0, n = 0, lake = 0;
      for (let y = cy * cell; y < Math.min(H, (cy + 1) * cell); y++) {
        for (let x = cx * cell; x < Math.min(W, (cx + 1) * cell); x++) { sum += data[y * W + x]; n++; if (d?.lakes[y * W + x]) lake++; }
      }
      const i = cy * gw + cx;
      elev[i] = sum / n;
      if (elev[i] <= sea || lake * 2 > n) block[i] = 1;
    }
  }
  const river = new Uint8Array(N), road = new Uint8Array(N);
  for (const rv of d?.rivers ?? []) markLine(river, gw, gh, cell, rv.pts, 2);
  if (o.followExisting !== false) {
    for (const l of existing) {
      if (l.kind === "border" || l.kind === "reef") continue;
      const flat: number[] = [];
      for (const [x, y] of l.points) flat.push(x, y);
      markLine(road, gw, gh, cell, flat, 2);
    }
  }
  const cellOf = (p: [number, number]) => Math.min(gh - 1, Math.max(0, Math.floor(p[1] / cell))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(p[0] / cell)));
  /** The nearest passable cell (within a few cells) for an endpoint that falls on water. */
  const snap = (p: [number, number]) => {
    const c0 = cellOf(p);
    if (!block[c0]) return c0;
    const cx = c0 % gw, cy = (c0 / gw) | 0;
    let best = -1, bd = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= gw || y >= gh || block[y * gw + x]) continue;
      const dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = y * gw + x; }
    }
    return best;
  };
  const s = snap(from), t = snap(to);
  if (s < 0 || t < 0) return { error: "A route point is in the sea or a lake, with no land nearby." };

  const cellKm = cell * km;
  const hasRoads = road.some((v) => v === 1);
  const hScale = hasRoads && o.followExisting !== false ? 0.3 : 1;
  const gradeRef = o.steepOk ? 0.12 : 0.06;
  const g = new Float32Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  // binary min-heap on f
  let hf = new Float64Array(1024), hi = new Int32Array(1024), hn = 0;
  const push = (f: number, i: number) => {
    if (hn === hf.length) { const nf = new Float64Array(hn * 2), ni = new Int32Array(hn * 2); nf.set(hf); ni.set(hi); hf = nf; hi = ni; }
    let k = hn++;
    while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; hf[k] = hf[p]; hi[k] = hi[p]; k = p; }
    hf[k] = f; hi[k] = i;
  };
  const pop = () => {
    const top = hi[0], f = hf[--hn], i = hi[hn];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= hn) break;
      if (c + 1 < hn && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= f) break;
      hf[k] = hf[c]; hi[k] = hi[c]; k = c;
    }
    hf[k] = f; hi[k] = i;
    return top;
  };
  const tx = t % gw, ty = (t / gw) | 0;
  const heur = (i: number) => Math.hypot((i % gw) - tx, ((i / gw) | 0) - ty) * cellKm * hScale;
  g[s] = 0;
  push(heur(s), s);
  let found = false;
  while (hn > 0) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === t) { found = true; break; }
    const cx = i % gw, cy = (i / gw) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        const j = y * gw + x;
        if (block[j] || done[j]) continue;
        if (dx && dy && (block[cy * gw + x] || block[y * gw + cx])) continue; // no cutting corners across water
        const stepKm = (dx && dy ? Math.SQRT2 : 1) * cellKm;
        const grade = Math.abs(elev[j] - elev[i]) / (stepKm * 1000);
        let c = stepKm * (1 + (grade / gradeRef) * (grade / gradeRef));
        if (road[j] && road[i]) c *= 0.3;
        if (river[j] && !river[i]) c += 4 * cellKm;
        const ng = g[i] + c;
        if (ng < g[j]) { g[j] = ng; parent[j] = i; push(ng + heur(j), j); }
      }
    }
  }
  if (!found) return { error: "No land route between those points: water is in the way. Use add_line to draw a sea route by hand." };
  const cells: number[] = [];
  for (let i = t; i >= 0; i = parent[i]) cells.push(i);
  cells.reverse();
  let pts: [number, number][] = cells.map((i) => [((i % gw) + 0.5) * cell, (((i / gw) | 0) + 0.5) * cell]);
  pts[0] = [from[0], from[1]];
  pts[pts.length - 1] = [to[0], to[1]];
  pts = chaikin(simplifyPath(pts, 0.6 * cell), 2);
  return { points: pts, lengthKm: lineLengthKm(pts, km) };
}

/** A route through two or more waypoints (map px). Derived layers add lakes and rivers when given. */
export function routeWaypoints(doc: MapDoc, d: Derived | null, waypoints: [number, number][], o: RouteOptions = {}): RouteResult | { error: string } {
  if (waypoints.length < 2) return { error: "A route needs at least a start and an end." };
  const existing = doc.features?.lines ?? [];
  let points: [number, number][] = [];
  for (let k = 1; k < waypoints.length; k++) {
    const leg = routeLeg(doc, d, existing, waypoints[k - 1], waypoints[k], o);
    if ("error" in leg) return leg;
    points = points.concat(k === 1 ? leg.points : leg.points.slice(1));
  }
  return { points, lengthKm: lineLengthKm(points, doc.meta.kmPerPx) };
}
