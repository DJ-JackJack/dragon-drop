/**
 * Labels and place markers drawn with real type (Cinzel) on a 2D canvas.
 * Used by the editor view and the PNG export.
 */
import {
  type Features, LABEL_SIZE, type LineKind, type MapLabel, type MapLine, type NamePos, PLACE_SIZE, type Place, type PlaceType, PLACE_KINDS, chaikin, drawPlaceIcon, placeKind, labelText,
} from "@mapmaker/core";
import { drawRealms, realmNameLabels } from "./drawRealms.ts";

export interface Hit {
  kind: "label" | "place" | "region" | "line";
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Lines: the polyline in screen px (hit-tested by distance, not by box). */
  pts?: [number, number][];
}

type Box = { x0: number; y0: number; x1: number; y1: number };

export interface FeatureView {
  /** Screen px per map px. */
  scale: number;
  ox: number;
  oy: number;
  /** Map width (sizes are defined for a 1024-px-wide map). */
  mapWidth: number;
  /** Screen px per map px when the whole map fits the window. With it, names and markers grow only slowly as you zoom in (and stop growing) instead of in step with the map. */
  fitScale?: number;
  /** The user's own multiplier for names and markers (the Label size setting); 1 when absent. */
  labelScale?: number;
  /** The Layers switches: false hides the labels and place names, or the place markers (and they can't be clicked while hidden). */
  labels?: boolean;
  markers?: boolean;
  /** Draw GM-only places, labels and roads faintly (the editor; exports for players leave them out instead). */
  faintGmOnly?: boolean;
  /** The Layers switch for the realms (drawRealms.ts): false leaves their wash, borders and names out. */
  realms?: boolean;
}

/** The scale names and markers are sized by: the map's own scale when zooming out (they shrink with it), but only a little bigger than at "fit" when zoomed in, never more than 1.8 times. */
export function textScale(v: FeatureView): number {
  const k = v.labelScale ?? 1;
  if (!v.fitScale) return v.scale * k;
  const z = v.scale / v.fitScale;
  return v.fitScale * (z <= 1 ? z : Math.min(1 + 0.35 * Math.log2(z), 1.8)) * k;
}

/**
 * Canvas text doesn't trigger web-font loading reliably, so ask for both Cinzel weights
 * explicitly; resolves once they're ready (or immediately if fonts can't load).
 */
let fontsPromise: Promise<void> | null = null;
export function loadLabelFonts(): Promise<void> {
  fontsPromise ??= Promise.all([document.fonts?.load("700 16px Cinzel"), document.fonts?.load("600 16px Cinzel")])
    .then(() => {}, () => {});
  return fontsPromise;
}

const INK = "#17171c";
const GLOW = "rgba(255, 255, 255, 0.92)";

function spacingEm(l: MapLabel) {
  return l.kind === "sea" || l.kind === "region" ? 0.32 : l.kind === "range" ? 0.22 : 0.06;
}

export function labelPx(l: MapLabel, v: FeatureView) {
  return LABEL_SIZE[l.kind] * (l.size ?? 1) * (v.mapWidth / 1024) * textScale(v);
}

function labelFont(l: MapLabel, px: number) {
  return `${l.kind === "feature" || l.kind === "island" ? 600 : 700} ${px}px Cinzel, Georgia, serif`;
}

/** Glow pass then ink pass for each glyph, placed by `at(i)` -> [x, y, rotation]. */
function drawGlyphs(ctx: CanvasRenderingContext2D, chars: string[], px: number, at: (i: number) => [number, number, number]) {
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const pass of [0, 1]) {
    ctx.shadowColor = pass === 0 ? GLOW : "transparent";
    ctx.shadowBlur = pass === 0 ? Math.max(2, px * 0.4) : 0;
    ctx.fillStyle = pass === 0 ? GLOW : INK;
    if (pass === 0) {
      ctx.strokeStyle = GLOW;
      ctx.lineWidth = Math.max(1, px * 0.14);
      ctx.lineJoin = "round";
    }
    chars.forEach((ch, k) => {
      const [x, y, rot] = at(k);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      if (pass === 0) ctx.strokeText(ch, 0, 0);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  }
  ctx.shadowColor = "transparent";
}

/** Draw one label along an optional arc, rotated; returns its screen bounding box. */
function drawLabel(ctx: CanvasRenderingContext2D, l: MapLabel, v: FeatureView, selected: boolean): Hit | null {
  if (l.path && l.path.length > 1) return drawPathLabel(ctx, l, v, selected);
  const px = labelPx(l, v);
  if (px < 3.5) return null;
  const chars = [...labelText(l)];
  ctx.font = labelFont(l, px);
  const sp = spacingEm(l) * px;
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * (widths.length - 1);
  const cx = v.ox + l.x * v.scale, cy = v.oy + l.y * v.scale;
  const ang = ((l.angle ?? 0) * Math.PI) / 180;
  const bend = (l.curve ?? 0) * 1.6; // total arc angle, radians
  const R = Math.abs(bend) > 1e-3 ? total / Math.abs(bend) : 0;
  const mids: number[] = [];
  let s = -total / 2;
  for (const w of widths) { mids.push(s + w / 2); s += w + sp; }
  const place = (m: number): [number, number, number] => {
    if (!R) return [m, 0, 0];
    const phi = m / R;
    const dy = R * (1 - Math.cos(phi));
    return bend > 0 ? [R * Math.sin(phi), dy, phi] : [R * Math.sin(phi), -dy, -phi];
  };
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  drawGlyphs(ctx, chars, px, (k) => place(mids[k]));
  ctx.restore();

  const half = total / 2 + px * 0.2, hh = px * 0.7 + Math.abs(R ? R * (1 - Math.cos(bend / 2)) : 0);
  const c = Math.cos(ang), sn = Math.sin(ang);
  const xs = [-half, half, half, -half].map((x, i) => cx + x * c - [-hh, -hh, hh, hh][i] * sn);
  const ys = [-half, half, half, -half].map((x, i) => cy + x * sn + [-hh, -hh, hh, hh][i] * c);
  const hit: Hit = { kind: "label", id: l.id, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  if (selected) outline(ctx, hit);
  return hit;
}

/** Chaikin corner-cutting: smooth a hand-drawn or sparse polyline. */
function smoothLine(pts: [number, number][], iterations = 2): [number, number][] {
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

/** Text laid along the label's path, centred, reading left to right. */
function drawPathLabel(ctx: CanvasRenderingContext2D, l: MapLabel, v: FeatureView, selected: boolean): Hit | null {
  const px = labelPx(l, v);
  if (px < 3.5) return null;
  let pts = l.path!.map(([x, y]) => [v.ox + x * v.scale, v.oy + y * v.scale] as [number, number]);
  if (pts[pts.length - 1][0] < pts[0][0]) pts = pts.reverse();
  pts = smoothLine(pts);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  if (L < 1) return null;
  /** Point and direction at arc length s (straight on past either end). */
  const at = (s: number): [number, number, number] => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / seg;
    return [ax + (bx - ax) * t, ay + (by - ay) * t, Math.atan2(by - ay, bx - ax)];
  };

  const chars = [...labelText(l)];
  ctx.font = labelFont(l, px);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const sumW = widths.reduce((a, b) => a + b, 0);
  let gap = spacingEm(l) * px;
  if (l.spread && chars.length > 1) gap = Math.max(gap, (L * 0.92 - sumW) / (chars.length - 1));
  const total = sumW + gap * (chars.length - 1);
  const mids: number[] = [];
  let s = (L - total) / 2;
  for (const w of widths) { mids.push(s + w / 2); s += w + gap; }
  const placed = mids.map(at);
  ctx.save();
  drawGlyphs(ctx, chars, px, (k) => placed[k]);
  ctx.restore();

  const pad = px * 0.75;
  const hit: Hit = {
    kind: "label", id: l.id,
    x0: Math.min(...placed.map((p) => p[0])) - pad, y0: Math.min(...placed.map((p) => p[1])) - pad,
    x1: Math.max(...placed.map((p) => p[0])) + pad, y1: Math.max(...placed.map((p) => p[1])) + pad,
  };
  if (selected) {
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(111, 143, 216, 0.85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    outline(ctx, hit);
  }
  return hit;
}

/** A place's marker at (x, y), reaching about `r`: a small picture for most kinds, a plain symbol for the original nine. (Also used by the type picker.) */
export function drawPlaceMarker(ctx: CanvasRenderingContext2D, type: PlaceType, x: number, y: number, r: number) {
  if (drawPlaceIcon(ctx, type, x, y, r)) return;
  marker(ctx, type, x, y, r);
}

function marker(ctx: CanvasRenderingContext2D, type: PlaceType, x: number, y: number, r: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, r * 0.35);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = INK;
  const circle = (rr: number) => { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); };
  switch (type) {
    case "capital":
      circle(r * 1.25); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = Math.max(1, r * 0.3); ctx.strokeStyle = INK; ctx.stroke();
      circle(r * 0.62); ctx.fillStyle = INK; ctx.fill();
      break;
    case "city": circle(r); ctx.fill(); ctx.stroke(); break;
    case "town": circle(r * 0.75); ctx.fill(); ctx.stroke(); break;
    case "village": circle(r * 0.5); ctx.fill(); ctx.lineWidth = Math.max(1, r * 0.25); ctx.stroke(); break;
    case "fort": ctx.beginPath(); ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6); ctx.fill(); ctx.stroke(); break;
    case "port": circle(r * 0.85); ctx.fillStyle = "#2d4f7c"; ctx.fill(); ctx.stroke(); break;
    case "ruin":
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.2, r * 0.4);
      ctx.beginPath(); ctx.moveTo(x - r * 0.7, y - r * 0.7); ctx.lineTo(x + r * 0.7, y + r * 0.7);
      ctx.moveTo(x + r * 0.7, y - r * 0.7); ctx.lineTo(x - r * 0.7, y + r * 0.7); ctx.stroke();
      break;
    case "landmark":
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.7); ctx.lineTo(x - r * 0.9, y + r * 0.7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    default: circle(r * 0.55); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Bigger places choose their name position first. */
const RANK = Object.fromEntries(PLACE_KINDS.map((k) => [k.id, k.rank])) as Record<PlaceType, number>;

type Slot = "right" | "left" | "above" | "below" | "upper-right" | "lower-right" | "upper-left" | "lower-left";
const AUTO_ORDER: Slot[] = ["right", "left", "above", "below", "upper-right", "lower-right", "upper-left", "lower-left"];

function overlapArea(a: Box, b: Box) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

interface PlaceLayout { p: Place; x: number; y: number; px: number; r: number; markerBox: Box }

function layoutPlace(p: Place, v: FeatureView): PlaceLayout {
  const px = Math.max(9, PLACE_SIZE[p.type] * (v.mapWidth / 1024) * textScale(v));
  // (the pictures are drawn a little bigger than the plain symbols, and never smaller than about 11 px across, so they stay readable)
  const pic = placeKind(p.type).picture;
  const r = pic ? Math.max(6, px * 0.5) : Math.max(3, px * 0.34);
  const x = v.ox + p.x * v.scale, y = v.oy + p.y * v.scale;
  return { p, x, y, px, r, markerBox: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } };
}

/** Where the name's text box goes for a slot: [anchor x, anchor y, align, box]. */
function slotBox(L: PlaceLayout, slot: Slot, w: number): { tx: number; ty: number; align: CanvasTextAlign; box: Box } {
  const { x, y, px, r } = L;
  const gap = L.p.hideMarker ? r * 1.1 : r * 1.6;
  const h = px * 0.62;
  const dy = r * 0.4 + px * 0.45;
  let tx = x + gap, ty = y, align: CanvasTextAlign = "left";
  switch (slot) {
    case "left": tx = x - gap; align = "right"; break;
    case "above": tx = x; ty = y - r - px * 0.6; align = "center"; break;
    case "below": tx = x; ty = y + r + px * 0.6; align = "center"; break;
    case "upper-right": ty = y - dy; break;
    case "lower-right": ty = y + dy; break;
    case "upper-left": tx = x - gap; ty = y - dy; align = "right"; break;
    case "lower-left": tx = x - gap; ty = y + dy; align = "right"; break;
  }
  const x0 = align === "left" ? tx : align === "right" ? tx - w : tx - w / 2;
  return { tx, ty, align, box: { x0, y0: ty - h, x1: x0 + w, y1: ty + h } };
}

function drawPlaceName(ctx: CanvasRenderingContext2D, L: PlaceLayout, occupied: Box[]): Box {
  const { p, px } = L;
  ctx.save();
  ctx.font = `${p.type === "capital" || p.type === "city" ? 700 : 600} ${px}px Cinzel, Georgia, serif`;
  const w = ctx.measureText(p.name).width;
  const pos: NamePos = p.namePos ?? "auto";
  const slots: Slot[] = pos === "auto" ? AUTO_ORDER : [pos];
  let best = slotBox(L, slots[0], w), bestCost = Infinity;
  for (const s of slots) {
    const c = slotBox(L, s, w);
    let cost = 0;
    for (const o of occupied) if (o !== L.markerBox) cost += overlapArea(c.box, o);
    if (cost < bestCost) { best = c; bestCost = cost; }
    if (cost === 0) break;
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = best.align;
  ctx.shadowColor = GLOW;
  ctx.shadowBlur = Math.max(2, px * 0.4);
  ctx.strokeStyle = GLOW;
  ctx.lineWidth = Math.max(1, px * 0.16);
  ctx.lineJoin = "round";
  ctx.strokeText(p.name, best.tx, best.ty);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = INK;
  ctx.fillText(p.name, best.tx, best.ty);
  ctx.restore();
  return best.box;
}

function outline(ctx: CanvasRenderingContext2D, h: Box) {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(111, 143, 216, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(h.x0 - 3, h.y0 - 3, h.x1 - h.x0 + 6, h.y1 - h.y0 + 6);
  ctx.restore();
}

const LINE_INK: Record<LineKind, string> = { road: "#6b3f1d", trail: "#7a5a2e", border: "#8a2a58", reef: "#2d3a43" };

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A repeatable pseudo-random number in 0..1 for (seed, i). */
function hash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ Math.imul(i + 1, 374761393), 668265263);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Razor rocks along a path: small dark spikes at ragged spacing and distance from the line, with a fleck of foam at the foot of some. */
function drawReefRocks(ctx: CanvasRenderingContext2D, pts: [number, number][], unit: number, seed: number) {
  const spacing = unit * 1.7;
  let travelled = 0, next = 0, n = 0;
  ctx.save();
  ctx.setLineDash([]);
  for (let s = 1; s < pts.length; s++) {
    const [ax, ay] = pts[s - 1], [bx, by] = pts[s], len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    while (next < travelled + len) {
      const along = next - travelled, k = n++;
      const across = (hash01(seed, k * 5 + 1) - 0.5) * unit * 5.4;
      const cx = ax + ux * along - uy * across, cy = ay + uy * along + ux * across;
      const size = unit * (1.2 + hash01(seed, k * 5 + 2) * 1.5), ang = hash01(seed, k * 5 + 3) * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const P = (x: number, y: number): [number, number] => [cx + x * c - y * sn, cy + x * sn + y * c];
      if (hash01(seed, k * 5 + 4) > 0.45) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.3, size * 1.1, size * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      }
      const [x1, y1] = P(0, -size * 1.7), [x2, y2] = P(-size * 0.62, size * 0.5), [x3, y3] = P(size * 0.62, size * 0.5);
      ctx.fillStyle = LINE_INK.reef;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(125, 150, 162, 0.85)";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x3, y3); ctx.lineTo(P(0, size * 0.1)[0], P(0, size * 0.1)[1]); ctx.closePath(); ctx.fill();
      next += spacing * (0.55 + hash01(seed, k * 5) * 0.9);
    }
    travelled += len;
  }
  ctx.restore();
}

/** Roads (cased, solid), trails (dotted), borders (dash-dot) and reefs (razor rocks) under the labels. */
function drawLine(ctx: CanvasRenderingContext2D, l: MapLine, v: FeatureView, selected: boolean): Hit | null {
  if (l.points.length < 2) return null;
  let pts = l.points.map(([x, y]) => [v.ox + x * v.scale, v.oy + y * v.scale] as [number, number]);
  if (l.closed && pts.length > 2) pts = [...pts, pts[0]];
  // hand-placed corners get softened; routed roads are already smooth
  if (l.kind !== "border" && l.kind !== "reef" && pts.length < 40) pts = chaikin(pts, 2);
  const unit = Math.min(3.2, Math.max(0.9, (v.mapWidth / 1024) * Math.sqrt(v.scale) * 1.1));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (l.kind === "road") {
    ctx.strokeStyle = "rgba(255, 250, 235, 0.75)"; ctx.lineWidth = unit * 2.6; ctx.stroke();
    ctx.strokeStyle = LINE_INK.road; ctx.lineWidth = unit * 1.2; ctx.stroke();
  } else if (l.kind === "trail") {
    ctx.strokeStyle = "rgba(255, 250, 235, 0.6)"; ctx.lineWidth = unit * 1.9; ctx.stroke();
    ctx.setLineDash([unit * 2.2, unit * 2.2]); ctx.strokeStyle = LINE_INK.trail; ctx.lineWidth = unit * 1.1; ctx.stroke();
  } else if (l.kind === "reef") {
    // a pale shoal along the line, then razor rocks and foam scattered over it
    ctx.strokeStyle = "rgba(165, 222, 212, 0.26)"; ctx.lineWidth = unit * 9.5; ctx.stroke();
    ctx.strokeStyle = "rgba(210, 244, 236, 0.4)"; ctx.lineWidth = unit * 4.6; ctx.stroke();
    drawReefRocks(ctx, pts, unit, strHash(l.id));
  } else {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)"; ctx.lineWidth = unit * 2.4; ctx.stroke();
    ctx.setLineDash([unit * 5, unit * 2.2, unit * 1.2, unit * 2.2]); ctx.strokeStyle = LINE_INK.border; ctx.lineWidth = unit * 1.3; ctx.stroke();
  }
  if (selected) {
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(111, 143, 216, 0.9)";
    ctx.lineWidth = unit * 3.6;
    ctx.globalCompositeOperation = "destination-over";
    ctx.stroke();
  }
  ctx.restore();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { kind: "line", id: l.id, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), pts };
}

/**
 * Draw all labels, then place markers, then place names (each name takes the first side of
 * its marker that's free of labels, markers and names already placed; bigger places first).
 * Returns hit boxes, places last so they win clicks.
 */
export function drawFeatures(ctx: CanvasRenderingContext2D, f: Features | null, v: FeatureView, selected?: string | ReadonlySet<string> | null): Hit[] {
  if (!f) return [];
  const isSelected = (id: string) => (typeof selected === "string" ? id === selected : !!selected && selected.has(id));
  const hits: Hit[] = [];
  const occupied: Box[] = [];
  const faint = (gm: boolean | undefined, draw: () => void) => {
    if (!(gm && v.faintGmOnly)) { draw(); return; }
    ctx.save(); ctx.globalAlpha *= 0.45; draw(); ctx.restore();
  };
  // the realms under everything else, and their names with the labels
  const realmNames = v.realms !== false && f.realmCells ? (drawRealms(ctx, f, v), realmNameLabels(f, v.mapWidth)) : [];
  for (const l of f.lines ?? []) {
    faint(l.gmOnly, () => { const h = drawLine(ctx, l, v, isSelected(l.id)); if (h) hits.push(h); });
  }
  const showLabels = v.labels !== false, showMarkers = v.markers !== false;
  if (showLabels) {
    for (const l of realmNames) faint(l.gmOnly, () => { const h = drawLabel(ctx, l, v, false); if (h) occupied.push(h); }); // (not clickable: the realm is chosen in the Realm tool)
    for (const l of f.labels) {
      faint(l.gmOnly, () => { const h = drawLabel(ctx, l, v, isSelected(l.id)); if (h) { hits.push(h); occupied.push(h); } });
    }
  }
  if (!showLabels && !showMarkers) return hits;
  const layouts = f.places.map((p) => layoutPlace(p, v));
  for (const L of layouts) {
    if (!L.p.hideMarker && showMarkers) { faint(L.p.gmOnly, () => drawPlaceMarker(ctx, L.p.type, L.x, L.y, L.r)); occupied.push(L.markerBox); }
  }
  const nameBox = new Map<string, Box>();
  for (const L of [...layouts].sort((a, b) => RANK[a.p.type] - RANK[b.p.type])) {
    if (L.p.hideName || !showLabels) continue;
    let b!: Box;
    faint(L.p.gmOnly, () => { b = drawPlaceName(ctx, L, occupied); });
    occupied.push(b);
    nameBox.set(L.p.id, b);
  }
  for (const L of layouts) {
    const m = L.markerBox, n = nameBox.get(L.p.id);
    const hit: Hit = { kind: "place", id: L.p.id, x0: Math.min(m.x0, n?.x0 ?? m.x0), y0: Math.min(m.y0, n?.y0 ?? m.y0), x1: Math.max(m.x1, n?.x1 ?? m.x1), y1: Math.max(m.y1, n?.y1 ?? m.y1) };
    if (isSelected(L.p.id)) outline(ctx, hit);
    hits.push(hit);
  }
  return hits;
}

function distToPolyline(pts: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

export function hitTest(hits: Hit[], x: number, y: number): Hit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (h.pts) { if (distToPolyline(h.pts, x, y) <= 6) return h; continue; }
    if (x >= h.x0 - 3 && x <= h.x1 + 3 && y >= h.y0 - 3 && y <= h.y1 + 3) return h;
  }
  return null;
}
