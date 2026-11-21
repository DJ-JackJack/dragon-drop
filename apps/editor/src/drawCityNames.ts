/**
 * The names on a city map, drawn with real type (Cinzel) on a 2D canvas: a named street's name along the street (in the stretch of it that is in view, turned to read left to
 * right, only once the street is wide enough on screen to hold it), a named building's name over it (once it is big enough on screen, never over another name), then the
 * city's labels (districts, water, landmarks: the world map's labels in metres, drawn by drawFeatures). Used by the city view, its picture export and the phone page.
 */
import type { Features, MapLabel, MapStreet } from "@mapmaker/core";
import { districtCentre, polygonCentroid } from "@mapmaker/core";
import { type Hit, drawFeatures } from "./drawFeatures.ts";

type Pt = [number, number];

export interface CityNameView {
  /** Screen px per metre, and where the city's corner is. */
  scale: number; ox: number; oy: number;
  /** The city's width in metres (labels are sized for it, as a world map's for its width). */
  widthM: number;
  /** Screen px per metre when the whole city fits: labels grow only slowly beyond it (drawFeatures' textScale). */
  fitScale?: number;
  /** The canvas, in px: names outside it are not drawn. */
  W: number; H: number;
  /** The user's Label size setting. */
  labelScale?: number;
}

const INK = "#17171c", GLOW = "rgba(255, 255, 255, 0.92)", STREET_INK = "#3a3125", STREET_GLOW = "rgba(214, 205, 180, 0.95)";
type Box = { x0: number; y0: number; x1: number; y1: number };
const meets = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Draw the names; returns the labels' hit boxes (streets and buildings are clicked as themselves). */
export function drawCityNames(ctx: CanvasRenderingContext2D, f: Features, v: CityNameView, selected?: ReadonlySet<string> | null): Hit[] {
  const taken: Box[] = [];
  ctx.save();
  for (const s of f.streets ?? []) if (s.name) streetName(ctx, s, v, taken);
  for (const b of f.buildings ?? []) {
    if (!b.name) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of b.points) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (Math.max(x1 - x0, y1 - y0) * v.scale < 18) continue;
    const [cx0, cy0] = polygonCentroid(b.points as Pt[]), cx = v.ox + cx0 * v.scale, cy = v.oy + cy0 * v.scale;
    if (cx < -200 || cy < -20 || cx > v.W + 200 || cy > v.H + 20) continue;
    const px = Math.max(10, Math.min(15, 3 * v.scale));
    ctx.font = `700 ${px}px Cinzel, Georgia, serif`;
    const w = ctx.measureText(b.name).width, box = { x0: cx - w / 2 - 2, y0: cy - px * 0.7, x1: cx + w / 2 + 2, y1: cy + px * 0.7 };
    if (taken.some((t) => meets(t, box))) continue;
    taken.push(box);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, px * 0.3); ctx.strokeStyle = GLOW; ctx.shadowColor = GLOW; ctx.shadowBlur = px * 0.4;
    ctx.strokeText(b.name, cx, cy);
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; ctx.fillStyle = INK; ctx.fillText(b.name, cx, cy);
  }
  ctx.restore();
  // a district's name is a district label at its middle (clicking it picks the district: the label has the district's id)
  const districtNames: MapLabel[] = (f.districts ?? []).filter((d) => d.name).map((d) => { const [x, y] = districtCentre(d.points); return { id: d.id, text: d.name!, kind: "region", x, y }; });
  return drawFeatures(ctx, { places: [], labels: [...districtNames, ...(f.labels ?? [])], lines: [] }, { scale: v.scale, ox: v.ox, oy: v.oy, mapWidth: v.widthM, fitScale: v.fitScale, labelScale: v.labelScale, markers: false }, selected ?? null);
}

/** A street's name along it: in the middle of the part in view, letter by letter along the line, read left to right; skipped when it doesn't fit. */
function streetName(ctx: CanvasRenderingContext2D, s: MapStreet, v: CityNameView, taken: Box[]) {
  const px = Math.min(30, s.width * 0.62 * v.scale);
  if (px < 8 || !s.name) return;
  let pts: Pt[] = s.points.map(([x, y]) => [v.ox + x * v.scale, v.oy + y * v.scale]);
  const cumOf = (p: Pt[]) => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
  let cum = cumOf(pts);
  const L = cum[cum.length - 1];
  if (L < 20) return;
  const at = (d: number): { x: number; y: number; a: number } => {
    let i = 0;
    while (i + 2 < cum.length && cum[i + 1] < d) i++;
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = cum[i + 1] - cum[i] || 1, t = Math.max(0, Math.min(1, (d - cum[i]) / len));
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, a: Math.atan2(by - ay, bx - ax) };
  };
  // the stretch of the street that is in view
  let d0 = Infinity, d1 = -Infinity;
  for (let d = 0; d <= L; d += 10) { const p = at(d); if (p.x >= -10 && p.y >= -10 && p.x <= v.W + 10 && p.y <= v.H + 10) { d0 = Math.min(d0, d); d1 = Math.max(d1, d); } }
  if (d1 < d0) return;
  ctx.font = `600 ${px}px Cinzel, Georgia, serif`;
  const chars = [...s.name], widths = chars.map((c) => ctx.measureText(c).width), sp = px * 0.08;
  const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  if (total > Math.min(L - px, d1 - d0 + 10)) return;
  let mid = Math.max(total / 2 + px * 0.3, Math.min(L - total / 2 - px * 0.3, (d0 + d1) / 2));
  // read left to right: if the street runs leftward here, walk it the other way
  if (Math.cos(at(mid).a) < 0) { pts = [...pts].reverse(); cum = cumOf(pts); mid = L - mid; }
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const placed = chars.map((_, k) => {
    const d = mid - total / 2 + widths.slice(0, k).reduce((a, b) => a + b, 0) + sp * k + widths[k] / 2, p = at(d);
    box.x0 = Math.min(box.x0, p.x - px / 2); box.y0 = Math.min(box.y0, p.y - px / 2); box.x1 = Math.max(box.x1, p.x + px / 2); box.y1 = Math.max(box.y1, p.y + px / 2);
    return p;
  });
  if (taken.some((t) => meets(t, box))) return;
  taken.push(box);
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  for (const pass of [0, 1]) {
    chars.forEach((c, k) => {
      const p = placed[k];
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      if (!pass) { ctx.lineWidth = Math.max(2, px * 0.22); ctx.strokeStyle = STREET_GLOW; ctx.strokeText(c, 0, 0); }
      else { ctx.fillStyle = STREET_INK; ctx.fillText(c, 0, 0); }
      ctx.restore();
    });
  }
}
