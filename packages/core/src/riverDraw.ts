/**
 * Rivers drawn by hand: the Rivers tool's drag, and Claude's `draw_river`.
 *
 * Rivers stay worked out from the land and the rain, so a drawn course is not a line laid on the map. It becomes a channel cut into the land along the line, plus a river
 * source at its upper end, and the water then follows the drawing when the rivers are worked out again:
 * - the channel's bed always falls going downstream, and it lies below the ground on both sides of the line (a line drawn across a slope is cut into the hill, or the
 *   water would spill down the slope);
 * - a line drawn from the mouth up (starting at the sea, or climbing to its end) is turned round: water runs from the high end; a line with both ends at the sea is
 *   refused (a river can't begin at the coast: its water would run into the sea beside it, not along the line);
 * - it stops where the line reaches the sea or leaves the map; a line that ends on land lets the river carry on downhill from there (or fill a hollow into a lake);
 * - land is only ever lowered, never below the sea.
 */
import type { Rect } from "./geom.ts";
import type { RiverSize } from "./features.ts";

/** How wide (half the channel, map px) and deep (m below the lowest ground beside it) each size of river cuts. */
export const CHANNEL_SIZE: Record<RiverSize, { halfPx: number; depthM: number }> = {
  stream: { halfPx: 1.6, depthM: 3 },
  river: { halfPx: 2.2, depthM: 6 },
  major: { halfPx: 3, depthM: 10 },
  great: { halfPx: 4, depthM: 15 },
};

export interface RiverChannel {
  /** The box that changed and its new heights (rect.w * rect.h, row by row). */
  rect: Rect;
  data: Float32Array;
  /** Where the river begins (its source goes here), map px. */
  start: [number, number];
  /** The course as cut, downstream, map px (every few px). */
  course: [number, number][];
  /** How it ends: in the sea, on land (the river carries on downhill from there), or at the map's edge. */
  end: "sea" | "land" | "edge";
  /** The line was turned round (it was drawn from the mouth up). */
  reversed: boolean;
  lengthKm: number;
  /** The deepest cut (m) and how many map pixels were lowered. */
  deepestM: number;
  lowered: number;
}

/** The bed falls at least this much (m) every half pixel, so the water never stands still in the channel. */
const FALL = 0.002;
const STEP = 0.5;
/** An end of the line this close to the sea (map px) is at the coast: the mouth, never the source. */
const SEA_REACH = 4;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Cut the channel for a river drawn along `line` (map px, from source to mouth, or the other way round: see the top of this file). Nothing is changed in `h`. */
export function riverChannel(h: Float32Array, W: number, H: number, sea: number, line: readonly (readonly [number, number])[], o: { size: RiverSize; kmPerPx: number }): RiverChannel | { error: string } {
  let pts = line.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => [x, y] as [number, number]);
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
  if (pts.length < 2) return { error: "Draw the river as a line: from where it starts to where it ends." };
  pts = chaikin(chaikin(pts));
  const samples = densify(pts, STEP);
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x: number, y: number) => h[Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)))];
  const wet = (p: [number, number]) => inMap(p[0], p[1]) && at(p[0], p[1]) <= sea;
  // which way the water runs: from the end that isn't at the sea, or from the higher end. A river can't begin at the coast (its water would run straight into the sea
  // beside it, whatever the channel), so a line with both ends at the sea is refused.
  const nearSea = (p: [number, number]) => {
    for (let y = Math.floor(p[1] - SEA_REACH); y <= Math.floor(p[1] + SEA_REACH); y++) for (let x = Math.floor(p[0] - SEA_REACH); x <= Math.floor(p[0] + SEA_REACH); x++) {
      if (inMap(x, y) && h[y * W + x] <= sea && Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]) <= SEA_REACH) return true;
    }
    return false;
  };
  const a = samples[0], b = samples[samples.length - 1], aSea = nearSea(a), bSea = nearSea(b);
  let reversed = false;
  if (aSea && bSea) return { error: "Both ends of the line are at the sea. Start the river inland, where its water comes from, and draw it down to the sea (or a lake)." };
  if (aSea) reversed = true;
  else if (!bSea && inMap(a[0], a[1]) && inMap(b[0], b[1]) && at(b[0], b[1]) > at(a[0], a[1]) + 1) reversed = true;
  if (reversed) samples.reverse();
  // the course: from the first point on the map down to the sea, the edge, or the end of the line
  let i0 = 0;
  while (i0 < samples.length && !inMap(samples[i0][0], samples[i0][1])) i0++;
  if (i0 >= samples.length) return { error: "The line is outside the map." };
  if (wet(samples[i0])) return { error: "Start the river on land: both ends of the line are in the sea." };
  const course: [number, number][] = [];
  let end: RiverChannel["end"] = "land";
  for (let k = i0; k < samples.length; k++) {
    const p = samples[k];
    if (!inMap(p[0], p[1])) { end = "edge"; break; }
    if (wet(p)) { end = "sea"; break; }
    course.push(p);
  }
  const n = course.length;
  if (n * STEP < 3) return { error: "That river is too short: draw it at least a few map pixels long." };
  const { halfPx, depthM } = CHANNEL_SIZE[o.size] ?? CHANNEL_SIZE.river;
  const half = halfPx, reach = Math.ceil(half + 1);
  // the bed: below the lowest ground round each point of the line (so a line across a slope can't spill sideways), always falling, never below the sea
  const bed = new Float32Array(n);
  const taper = end === "land" ? Math.min(n / 3, 20 / STEP) : 0; // (a river that ends on land fades out, so it carries on downhill instead of ending in a pit)
  for (let k = 0; k < n; k++) {
    const [cx, cy] = course[k];
    let low = Infinity;
    for (let y = Math.floor(cy - reach); y <= Math.floor(cy + reach); y++) for (let x = Math.floor(cx - reach); x <= Math.floor(cx + reach); x++) {
      if (!inMap(x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > half + 1) continue;
      const v = h[y * W + x];
      if (v > sea && v < low) low = v;
    }
    if (!Number.isFinite(low)) low = at(cx, cy);
    const depth = taper > 0 ? depthM * Math.min(1, (n - 1 - k) / taper) : depthM;
    let b2 = low - depth;
    if (k > 0) b2 = Math.min(b2, bed[k - 1] - FALL);
    bed[k] = Math.max(sea + 0.5, b2);
  }
  // the box it changes
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of course) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const rx = Math.max(0, Math.floor(x0 - half - 1)), ry = Math.max(0, Math.floor(y0 - half - 1));
  const rect: Rect = { x: rx, y: ry, w: Math.min(W, Math.ceil(x1 + half + 2)) - rx, h: Math.min(H, Math.ceil(y1 + half + 2)) - ry };
  const data = new Float32Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) data.set(h.subarray((rect.y + y) * W + rect.x, (rect.y + y) * W + rect.x + rect.w), y * rect.w);
  // cut: a U across the channel, from the bed in the middle up to the ground at its edge
  for (let k = 0; k < n; k++) {
    const [cx, cy] = course[k], b0 = bed[k];
    for (let y = Math.max(rect.y, Math.floor(cy - half)); y <= Math.min(rect.y + rect.h - 1, Math.floor(cy + half)); y++) {
      for (let x = Math.max(rect.x, Math.floor(cx - half)); x <= Math.min(rect.x + rect.w - 1, Math.floor(cx + half)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= half) continue;
        const g = h[y * W + x];
        if (g <= sea) continue;
        const target = b0 + (g - b0) * smooth(d / half), j = (y - rect.y) * rect.w + (x - rect.x);
        if (target < data[j]) data[j] = Math.max(target, Math.min(data[j], sea + 0.5));
      }
    }
  }
  let deepest = 0, lowered = 0;
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    const j = y * rect.w + x, g = h[(rect.y + y) * W + rect.x + x];
    if (data[j] < g - 0.01) { lowered++; deepest = Math.max(deepest, g - data[j]); }
  }
  let len = 0;
  for (let k = 1; k < n; k++) len += Math.hypot(course[k][0] - course[k - 1][0], course[k][1] - course[k - 1][1]);
  const every = Math.max(1, Math.round(2 / STEP));
  const thin = course.filter((_, k) => k % every === 0 || k === n - 1).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
  return { rect, data, start: thin[0], course: thin, end, reversed, lengthKm: Math.round(len * o.kmPerPx * 10) / 10, deepestM: Math.round(deepest), lowered };
}

/** One round of corner cutting: a hand-drawn line loses its jitter, its two ends stay where they are. */
function chaikin(p: [number, number][]): [number, number][] {
  if (p.length < 3) return p;
  const out: [number, number][] = [p[0]];
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(p[p.length - 1]);
  return out;
}

/** Points every `step` px along a line. */
function densify(p: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [p[0]];
  let carry = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1], l = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= l) { out.push([ax + ((bx - ax) * t) / l, ay + ((by - ay) * t) / l]); t += step; }
    carry = l - (t - step);
  }
  const last = p[p.length - 1], q = out[out.length - 1];
  if (Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-6) out.push(last);
  return out;
}
