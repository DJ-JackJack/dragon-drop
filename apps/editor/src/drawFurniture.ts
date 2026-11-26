/** Title banner, scale bar, compass rose and frame, drawn over a map (editor view and exports). */
import { type Corner, type MapFurniture, type Units, DEFAULT_FURNITURE, hasFurniture, scaleBarFor } from "@mapmaker/core";

const INK = "#17171c";
const PAPER = "rgba(247, 240, 221, 0.86)";
const FONT = "Cinzel, Georgia, serif";

export interface FurnitureTarget {
  /** The map's rectangle in canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Map width in map px, and km per map px (for the scale bar). */
  mapWidthPx: number;
  kmPerPx: number;
  /** Size unit in canvas px: everything scales with it. A good value is about 1.25% of the map's width on the canvas. */
  unit: number;
  /** The map's measurement system: the scale bar's units unless the map extras chose (km when metric). */
  units?: Units;
}

function cornerXY(t: FurnitureTarget, corner: Corner, w: number, h: number, margin: number): [number, number] {
  const left = corner.endsWith("left"), top = corner.startsWith("top");
  return [left ? t.x + margin : t.x + t.w - margin - w, top ? t.y + margin : t.y + t.h - margin - h];
}

function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number) {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, u * 0.12);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, u * 0.5);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFrame(ctx: CanvasRenderingContext2D, t: FurnitureTarget) {
  const u = t.unit;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, u * 0.28);
  ctx.strokeRect(t.x + u * 0.5, t.y + u * 0.5, t.w - u, t.h - u);
  ctx.lineWidth = Math.max(0.7, u * 0.1);
  ctx.strokeRect(t.x + u * 1.0, t.y + u * 1.0, t.w - u * 2, t.h - u * 2);
  ctx.restore();
}

function drawTitle(ctx: CanvasRenderingContext2D, t: FurnitureTarget, text: string, pos: "top" | "bottom") {
  const u = t.unit;
  ctx.save();
  ctx.font = `700 ${u * 2.5}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const w = Math.min(t.w - u * 6, tw + u * 4), h = u * 4.4;
  const x = t.x + (t.w - w) / 2, y = pos === "top" ? t.y + u * 2.2 : t.y + t.h - u * 2.2 - h;
  plate(ctx, x, y, w, h, u);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.7, u * 0.08);
  ctx.strokeRect(x + u * 0.28, y + u * 0.28, w - u * 0.56, h - u * 0.56);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + u * 0.1, w - u * 2);
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, t: FurnitureTarget, corner: Corner, units: "miles" | "km") {
  const u = t.unit;
  const bar = scaleBarFor(t.mapWidthPx, t.kmPerPx, units);
  const barW = bar.px * (t.w / t.mapWidthPx);
  ctx.save();
  ctx.font = `600 ${u * 1.15}px ${FONT}`;
  const lastLabelHalf = ctx.measureText(`${bar.value} ${bar.unit}`).width / 2; // the end label is centred on the bar's end
  ctx.restore();
  const pw = barW + u * 1.7 + Math.max(u * 1.7, lastLabelHalf + u * 0.8), ph = u * 4;
  const [px, py] = cornerXY(t, corner, pw, ph, u * 2.2);
  plate(ctx, px, py, pw, ph, u);
  const bx = px + u * 1.7, by = py + u * 2.1, bh = u * 0.8;
  ctx.save();
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    ctx.fillStyle = i % 2 ? "#fff" : INK;
    ctx.fillRect(bx + (barW * i) / segs, by, barW / segs, bh);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, u * 0.1);
  ctx.strokeRect(bx, by, barW, bh);
  ctx.fillStyle = INK;
  ctx.font = `600 ${u * 1.15}px ${FONT}`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  const labels: [number, string][] = [[0, "0"], [barW / 2, String(bar.value / 2)], [barW, `${bar.value} ${bar.unit}`]];
  for (const [dx, text] of labels) ctx.fillText(text, bx + dx, by - u * 0.2);
  ctx.restore();
}

/** An eight-point compass rose with an N above its top point. */
function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(0.7, r * 0.025);
  ctx.stroke();
  const point = (angle: number, len: number, half: number) => {
    // a kite: tip at `len`, shoulders at +-45 degrees, each half shaded differently for a faceted look
    const ax = Math.sin(angle), ay = -Math.cos(angle);
    const tip: [number, number] = [cx + ax * len, cy + ay * len];
    const l: [number, number] = [cx + Math.sin(angle - Math.PI / 4) * half, cy - Math.cos(angle - Math.PI / 4) * half];
    const rt: [number, number] = [cx + Math.sin(angle + Math.PI / 4) * half, cy - Math.cos(angle + Math.PI / 4) * half];
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.moveTo(...tip); ctx.lineTo(...l); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(...tip); ctx.lineTo(...rt); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
    ctx.lineWidth = Math.max(0.6, r * 0.02);
    ctx.beginPath(); ctx.moveTo(...l); ctx.lineTo(...tip); ctx.lineTo(...rt); ctx.closePath(); ctx.stroke();
  };
  for (let k = 0; k < 4; k++) point((Math.PI / 4) + (k * Math.PI) / 2, r * 0.64, r * 0.14);
  for (let k = 0; k < 4; k++) point((k * Math.PI) / 2, r * 0.98, r * 0.2);
  ctx.fillStyle = INK;
  ctx.font = `700 ${r * 0.44}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", cx, cy - r * 1.12);
  ctx.restore();
}

export function drawFurniture(ctx: CanvasRenderingContext2D, f: MapFurniture | undefined, t: FurnitureTarget) {
  if (!f || !hasFurniture(f)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.x, t.y, t.w, t.h);
  ctx.clip();
  if (f.frame) drawFrame(ctx, t);
  if (f.title?.trim()) drawTitle(ctx, t, f.title.trim(), f.titlePos ?? DEFAULT_FURNITURE.titlePos);
  if (f.scaleBar) drawScaleBar(ctx, t, f.scaleCorner ?? DEFAULT_FURNITURE.scaleCorner, f.units ?? (t.units === "metric" ? "km" : DEFAULT_FURNITURE.units));
  if (f.compass) {
    const r = t.unit * 4.6;
    const [x, y] = cornerXY(t, f.compassCorner ?? DEFAULT_FURNITURE.compassCorner, r * 2.4, r * 2.7, t.unit * 2.2);
    drawCompass(ctx, x + r * 1.2, y + r * 1.5, r);
  }
  ctx.restore();
}

/** A sensible size unit for the editor view: about 1.25% of the map's width on screen, kept readable. */
export function viewUnit(mapWidthOnScreen: number): number {
  return Math.min(26, Math.max(7, mapWidthOnScreen * 0.0125));
}
