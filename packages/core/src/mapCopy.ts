/**
 * Copying from another map into the open one (world maps): the land of an area (or all of it), resampled through the link between the two maps (mapLinks.ts: a copy or a
 * same-size map lies one over the other, a detail map over its area of its world map), the things on it (places, labels, roads, climate regions, river sources, river and
 * lake names), and the climate settings. And putting back the land of an area from a checkpoint (an older state of the same map). Both give new heights for one box,
 * blended in across a soft edge, for one `patch_heights` edit; nothing outside the area changes.
 */
import type { MapDoc } from "./doc.ts";
import type { Features, FeaturesPatch } from "./features.ts";
import { type Point, type Rect, type Shape, clipRect, expandRect, shapeBounds, shapeSize, signedDistance } from "./geom.ts";
import type { Affine } from "./mapLinks.ts";
import { smoothstep } from "./noise.ts";

/** The kinds of thing that can be copied from another map. */
export const COPYABLE = ["terrain", "climate", "regions", "places", "labels", "lines", "sources", "water_names"] as const;
export type Copyable = (typeof COPYABLE)[number];

/** How much of a change is kept at each cell of a box: 1 inside the area (past its soft edge), 0 outside; everywhere when there is no area. */
function areaWeight(area: Shape | undefined, W: number, H: number): { rect: Rect; w: (x: number, y: number) => number } | null {
  if (!area) return { rect: { x: 0, y: 0, w: W, h: H }, w: () => 1 };
  const rect = clipRect(expandRect(shapeBounds(area, W, H), 1), W, H);
  if (!rect) return null;
  const feather = Math.max(2, Math.min(40, shapeSize(area, W, H) * 0.1));
  return { rect, w: (x, y) => smoothstep(0, feather, signedDistance(area, x + 0.5, y + 0.5)) };
}

function bilinear(h: Float32Array, W: number, H: number, x: number, y: number): number {
  const fx = Math.max(0, Math.min(W - 1, x)), fy = Math.max(0, Math.min(H - 1, y));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const a = h[y0 * W + x0] + (h[y0 * W + x1] - h[y0 * W + x0]) * tx, b = h[y1 * W + x0] + (h[y1 * W + x1] - h[y1 * W + x0]) * tx;
  return a + (b - a) * ty;
}

/**
 * New heights for the open map `dst` from map `src`, in an area of `dst` (its px) or everywhere: `toSrc` turns dst px into src px. Heights keep their height above the sea
 * (a map with another sea level gets the same land). Cells that fall outside `src` are left as they are. Null when nothing would change.
 */
export function copyHeightsFrom(src: MapDoc, dst: MapDoc, toSrc: Affine, area?: Shape): { rect: Rect; data: Float32Array; changed: number } | null {
  const W = dst.height.w, H = dst.height.h, sw = src.height.w, sh = src.height.h;
  const aw = areaWeight(area, W, H);
  if (!aw) return null;
  const { rect } = aw, out = new Float32Array(rect.w * rect.h), hd = dst.height.data, hs = src.height.data, lift = dst.meta.seaLevel - src.meta.seaLevel;
  let changed = 0;
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    const X = rect.x + x, Y = rect.y + y, cur = hd[Y * W + X];
    const sx = toSrc.s * (X + 0.5) + toSrc.x - 0.5, sy = toSrc.s * (Y + 0.5) + toSrc.y - 0.5;
    const w = sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5 ? 0 : aw.w(X, Y);
    const v = w <= 0 ? cur : cur + (bilinear(hs, sw, sh, sx, sy) + lift - cur) * w;
    out[y * rect.w + x] = v;
    if (Math.abs(v - cur) > 0.01) changed++;
  }
  return changed ? { rect, data: out, changed } : null;
}

/** New heights for an area from an older state of the same map (a checkpoint's heights, the same size): what was there, blended in. Null when nothing would change. */
export function heightsFromState(cur: Float32Array, old: Float32Array, W: number, H: number, area?: Shape): { rect: Rect; data: Float32Array; changed: number } | null {
  if (old.length !== cur.length) throw new Error("That checkpoint is of another size of map.");
  const aw = areaWeight(area, W, H);
  if (!aw) return null;
  const { rect } = aw, out = new Float32Array(rect.w * rect.h);
  let changed = 0;
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    const i = (rect.y + y) * W + rect.x + x, w = aw.w(rect.x + x, rect.y + y), v = cur[i] + (old[i] - cur[i]) * w;
    out[y * rect.w + x] = v;
    if (Math.abs(v - cur[i]) > 0.01) changed++;
  }
  return changed ? { rect, data: out, changed } : null;
}

/**
 * The things on map `src` (the kinds asked for) as a patch for map `dst`: positions turned into dst px (`toDst`), only those inside `area` (dst px) when one is given.
 * They keep their ids, so copying again replaces them instead of adding them twice.
 */
export function copyFeaturesFrom(src: Features | undefined, toDst: { s: number; x: number; y: number }, kinds: readonly Copyable[], area?: Shape): { patch: FeaturesPatch; counts: Record<string, number> } {
  const f = src ?? { places: [], labels: [] };
  const pt = ([x, y]: readonly [number, number]): Point => [Math.round((toDst.s * x + toDst.x) * 10) / 10, Math.round((toDst.s * y + toDst.y) * 10) / 10];
  const inside = (pts: readonly (readonly [number, number])[]) => !area || pts.some(([x, y]) => signedDistance(area, x, y) >= 0);
  const patch: FeaturesPatch = {}, counts: Record<string, number> = {};
  const want = (k: Copyable) => kinds.includes(k);
  if (want("places")) {
    const ps = f.places.map((p) => { const [x, y] = pt([p.x, p.y]); return { ...p, x, y }; }).filter((p) => inside([[p.x, p.y]]));
    if (ps.length) { patch.upsertPlaces = ps; counts.places = ps.length; }
  }
  if (want("labels")) {
    const ls = f.labels.map((l) => { const [x, y] = pt([l.x, l.y]); return { ...l, x, y, ...(l.path && { path: l.path.map(pt) }) }; }).filter((l) => inside([[l.x, l.y]]));
    if (ls.length) { patch.upsertLabels = ls; counts.labels = ls.length; }
  }
  if (want("lines")) {
    const ls = (f.lines ?? []).map((l) => ({ ...l, points: l.points.map(pt) })).filter((l) => inside(l.points));
    if (ls.length) { patch.upsertLines = ls; counts.lines = ls.length; }
  }
  if (want("regions")) {
    const rs = (f.regions ?? []).map((r) => ({ ...r, polygon: r.polygon.map(pt) })).filter((r) => inside(r.polygon));
    if (rs.length) { patch.upsertRegions = rs; counts.regions = rs.length; }
  }
  if (want("sources")) {
    const placeIds = new Set((patch.upsertPlaces ?? []).map((p) => p.id));
    const ss = (f.sources ?? []).filter((s) => (s.placeId ? placeIds.has(s.placeId) : s.x !== undefined && s.y !== undefined))
      .map((s) => (s.placeId ? s : { ...s, ...(() => { const [x, y] = pt([s.x!, s.y!]); return { x, y }; })(), ...(s.course && { course: s.course.map(pt) }) }))
      .filter((s) => s.placeId || inside([[s.x!, s.y!]]));
    if (ss.length) { patch.upsertSources = ss; counts.sources = ss.length; }
  }
  if (want("water_names")) {
    const ws = (f.waterNames ?? []).map((w) => { const [x, y] = pt([w.x, w.y]); return { ...w, x, y }; }).filter((w) => inside([[w.x, w.y]]));
    if (ws.length) { patch.upsertWaterNames = ws; counts.water_names = ws.length; }
  }
  return { patch, counts };
}
