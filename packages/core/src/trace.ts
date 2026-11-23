/**
 * The trace picture: one of the map's reference pictures laid over the map, see-through, so the DM (or Claude) can redraw a map found
 * elsewhere on top of it. It is a layout aid, not part of the map: it is kept with the map (in its features, one per battlemap level) so
 * it stays where it was put, but no export or preview draws it unless asked to.
 *
 * Where it lies: a picture pixel (u, v) (from its top-left corner) is at map point (x, y) + R(rotation) * (u * scale, v * scale), in map
 * px on a world map and in squares on a battlemap. Rotation is in degrees, clockwise on screen (y runs down).
 */

export interface TracePicture {
  /** The reference picture's file name (as in the References panel). */
  ref: string;
  /** The picture's own size in pixels. */
  w: number;
  h: number;
  /** Where its top-left corner is, in map units (map px on a world map, squares on a battlemap). */
  x: number;
  y: number;
  /** Map units per picture pixel. */
  scale: number;
  /** Turned clockwise about its top-left corner, in degrees. */
  rotation: number;
  /** The DM locked it in place: it can't be moved (by them or by Claude) until it is unlocked. */
  locked?: boolean;
}

type Pt = [number, number];
const rad = (deg: number) => (deg * Math.PI) / 180;
/** Rotation kept between -180 and 180. */
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Where picture pixel (u, v) lies on the map. */
export function tracePoint(t: TracePicture, u: number, v: number): Pt {
  const c = Math.cos(rad(t.rotation)), s = Math.sin(rad(t.rotation));
  const a = u * t.scale, b = v * t.scale;
  return [t.x + a * c - b * s, t.y + a * s + b * c];
}

/** Which picture pixel lies at map point (x, y) (it may be outside the picture). */
export function traceToPicture(t: TracePicture, x: number, y: number): Pt {
  const c = Math.cos(rad(t.rotation)), s = Math.sin(rad(t.rotation));
  const dx = x - t.x, dy = y - t.y;
  return [(dx * c + dy * s) / t.scale, (-dx * s + dy * c) / t.scale];
}

/** The picture's four corners on the map: top-left, top-right, bottom-right, bottom-left. */
export function traceCorners(t: TracePicture): Pt[] {
  return [tracePoint(t, 0, 0), tracePoint(t, t.w, 0), tracePoint(t, t.w, t.h), tracePoint(t, 0, t.h)];
}

export function traceCentre(t: TracePicture): Pt {
  return tracePoint(t, t.w / 2, t.h / 2);
}

/** The picture fitted inside a map of mapW x mapH map units, centred, not turned. */
export function fitTrace(p: { ref: string; w: number; h: number }, mapW: number, mapH: number): TracePicture {
  const scale = Math.min(mapW / p.w, mapH / p.h);
  return { ref: p.ref, w: p.w, h: p.h, x: (mapW - p.w * scale) / 2, y: (mapH - p.h * scale) / 2, scale, rotation: 0 };
}

export function moveTrace(t: TracePicture, dx: number, dy: number): TracePicture {
  return { ...t, x: t.x + dx, y: t.y + dy };
}

/** Grown (k > 1) or shrunk about map point (cx, cy), which stays where it is. */
export function scaleTraceAbout(t: TracePicture, k: number, cx: number, cy: number): TracePicture {
  return { ...t, scale: t.scale * k, x: cx + (t.x - cx) * k, y: cy + (t.y - cy) * k };
}

/** Turned by `deg` clockwise about map point (cx, cy), which stays where it is. */
export function rotateTraceAbout(t: TracePicture, deg: number, cx: number, cy: number): TracePicture {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  const dx = t.x - cx, dy = t.y - cy;
  return { ...t, rotation: wrapDeg(t.rotation + deg), x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** A pair of points the DM matched: a point on the picture (picture px) and where it belongs on the map (map units). */
export interface TracePin {
  picture: Pt;
  map: Pt;
}

/**
 * Line the picture up from two pinned points: it is moved, sized and turned (never stretched or mirrored) so that each picture point
 * lands on its map point. Two points far apart give the best fit.
 */
export function traceFromPins(p: { ref: string; w: number; h: number; locked?: boolean }, pins: [TracePin, TracePin]): TracePicture | { error: string } {
  const [a, b] = pins;
  const du = b.picture[0] - a.picture[0], dv = b.picture[1] - a.picture[1];
  const dx = b.map[0] - a.map[0], dy = b.map[1] - a.map[1];
  const dp = Math.hypot(du, dv), dm = Math.hypot(dx, dy);
  if (dp < 4) return { error: "The two points on the picture are too close together: pick two that are far apart." };
  if (dm === 0) return { error: "The two points on the map are the same point: pick two that are far apart." };
  const scale = dm / dp;
  const rotation = wrapDeg(((Math.atan2(dy, dx) - Math.atan2(dv, du)) * 180) / Math.PI);
  const t: TracePicture = { ref: p.ref, w: p.w, h: p.h, x: 0, y: 0, scale, rotation, ...(p.locked && { locked: true }) };
  const [ax, ay] = tracePoint(t, a.picture[0], a.picture[1]);
  return { ...t, x: a.map[0] - ax, y: a.map[1] - ay };
}

/**
 * Matching a picture's own square grid to the battlemap's: the DM clicked two places where the picture's grid lines cross, `squares` apart
 * along a row or a column; `a` and `b` are where those clicks are on the map now. The first goes to the nearest corner of the map's grid,
 * the second the same number of squares along the row or column it lies on, so the picture's squares are the map's squares.
 */
export function gridPinTargets(a: Pt, b: Pt, squares: number): [Pt, Pt] {
  const ta: Pt = [Math.round(a[0]), Math.round(a[1])];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = Math.max(1, Math.round(squares));
  const tb: Pt = Math.abs(dx) >= Math.abs(dy) ? [ta[0] + Math.sign(dx || 1) * n, ta[1]] : [ta[0], ta[1] + Math.sign(dy || 1) * n];
  return [ta, tb];
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * A trace picture from outside (a message or a tool), checked: a sensible name and size, finite numbers, a scale that keeps it between a
 * hundredth and a hundred times the map's size, and a corner not absurdly far from the map. Null when it isn't one.
 */
export function cleanTrace(t: unknown, mapW: number, mapH: number): TracePicture | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  if (typeof o.ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$/.test(o.ref) || o.ref.includes("..")) return null;
  if (![o.w, o.h, o.x, o.y, o.scale, o.rotation].every(finite)) return null;
  const w = o.w as number, h = o.h as number, scale = o.scale as number;
  if (w < 1 || h < 1 || w > 100000 || h > 100000 || scale <= 0) return null;
  const span = Math.max(w, h) * scale, size = Math.max(mapW, mapH);
  if (span < size / 100 || span > size * 100) return null;
  const x = o.x as number, y = o.y as number;
  if (Math.abs(x) > size * 200 || Math.abs(y) > size * 200) return null;
  return { ref: o.ref, w: Math.round(w), h: Math.round(h), x, y, scale, rotation: wrapDeg(o.rotation as number), ...(o.locked === true && { locked: true }) };
}

interface Raster { w: number; h: number; data: Uint8ClampedArray | Uint8Array }

/**
 * Draw the trace picture see-through over a preview. `img` shows the map area starting at `region` (in the full render's pixels, `unitPx`
 * of them per map unit) at `scale` image px per full-render px; `pic` is the decoded picture (it may be smaller than t.w x t.h). Each
 * preview pixel the picture covers takes its colour there (smoothly sampled) at `alpha`.
 */
export function overlayTrace(img: Raster, pic: Raster, t: TracePicture, view: { unitPx: number; region: { x: number; y: number }; scale: number }, alpha = 0.5) {
  const c = Math.cos(rad(t.rotation)), s = Math.sin(rad(t.rotation));
  const kx = pic.w / t.w, ky = pic.h / t.h;
  const d = img.data, p = pic.data, pw = pic.w, ph = pic.h;
  for (let iy = 0; iy < img.h; iy++) {
    const my = (view.region.y + (iy + 0.5) / view.scale) / view.unitPx - t.y;
    for (let ix = 0; ix < img.w; ix++) {
      const mx = (view.region.x + (ix + 0.5) / view.scale) / view.unitPx - t.x;
      const u = ((mx * c + my * s) / t.scale) * kx - 0.5, v = ((-mx * s + my * c) / t.scale) * ky - 0.5;
      if (u < -0.5 || v < -0.5 || u > pw - 0.5 || v > ph - 0.5) continue;
      const u0 = Math.max(0, Math.min(pw - 1, Math.floor(u))), v0 = Math.max(0, Math.min(ph - 1, Math.floor(v)));
      const u1 = Math.min(pw - 1, u0 + 1), v1 = Math.min(ph - 1, v0 + 1);
      const fu = Math.max(0, Math.min(1, u - u0)), fv = Math.max(0, Math.min(1, v - v0));
      const i00 = (v0 * pw + u0) * 4, i10 = (v0 * pw + u1) * 4, i01 = (v1 * pw + u0) * 4, i11 = (v1 * pw + u1) * 4;
      const o = (iy * img.w + ix) * 4;
      const at = (ch: number) => (p[i00 + ch] * (1 - fu) + p[i10 + ch] * fu) * (1 - fv) + (p[i01 + ch] * (1 - fu) + p[i11 + ch] * fu) * fv;
      const a = alpha * (at(3) / 255);
      if (a <= 0) continue;
      d[o] = d[o] * (1 - a) + at(0) * a;
      d[o + 1] = d[o + 1] * (1 - a) + at(1) * a;
      d[o + 2] = d[o + 2] * (1 - a) + at(2) * a;
    }
  }
}

/** For Claude: where the picture lies, in words and numbers (units: "map px" or "squares"). */
export function traceSummary(t: TracePicture, units: string) {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    picture: t.ref, picture_size: [t.w, t.h], locked: !!t.locked,
    top_left: [r(t.x), r(t.y)], scale: `${r(t.scale * 1000) / 1000} ${units} per picture pixel`, rotation_degrees: r(t.rotation),
    corners: traceCorners(t).map(([x, y]) => [r(x), r(y)]), units,
  };
}
