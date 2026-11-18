/** Square and hex grid overlays (the grid setting lives in the map's meta). */
import { type MapGrid, gridCellPx, hexCorners, hexCentre } from "@mapmaker/core";

export interface GridView {
  /** Screen px per map px. */
  scale: number;
  ox: number;
  oy: number;
  mapWidth: number;
  mapHeight: number;
  kmPerPx: number;
}

/** Below this many screen px per cell the grid is a smear, so it isn't drawn. */
export const MIN_CELL_SCREEN_PX = 5;

/** The cell size on screen, or null when there's no grid. */
export function gridScreenCell(g: MapGrid | undefined, v: GridView): number | null {
  if (!g || g.type === "off") return null;
  return gridCellPx(g, v.kmPerPx) * v.scale;
}

/**
 * Draw the grid over the visible part of the map. Returns false if the cells were too small
 * to draw at this zoom (so the caller can say so).
 */
export function drawMapGrid(ctx: CanvasRenderingContext2D, g: MapGrid | undefined, v: GridView, viewW: number, viewH: number): boolean {
  const cs = gridScreenCell(g, v);
  if (!g || cs === null) return true;
  if (cs < MIN_CELL_SCREEN_PX) return false;
  const size = gridCellPx(g, v.kmPerPx);
  // visible map rectangle
  const x0 = Math.max(0, -v.ox / v.scale), y0 = Math.max(0, -v.oy / v.scale);
  const x1 = Math.min(v.mapWidth, (viewW - v.ox) / v.scale), y1 = Math.min(v.mapHeight, (viewH - v.oy) / v.scale);
  if (x1 <= x0 || y1 <= y0) return true;
  const sx = (x: number) => v.ox + x * v.scale, sy = (y: number) => v.oy + y * v.scale;

  const path = new Path2D();
  if (g.type === "square") {
    for (let k = Math.ceil(x0 / size); k * size <= x1; k++) { path.moveTo(sx(k * size), sy(y0)); path.lineTo(sx(k * size), sy(y1)); }
    for (let k = Math.ceil(y0 / size); k * size <= y1; k++) { path.moveTo(sx(x0), sy(k * size)); path.lineTo(sx(x1), sy(k * size)); }
  } else {
    const orient = g.orient ?? "pointy";
    const colStep = orient === "pointy" ? size : size * (Math.sqrt(3) / 2);
    const rowStep = orient === "pointy" ? size * (Math.sqrt(3) / 2) : size;
    const c0 = Math.floor(x0 / colStep) - 1, c1 = Math.ceil(x1 / colStep) + 1;
    const r0 = Math.floor(y0 / rowStep) - 1, r1 = Math.ceil(y1 / rowStep) + 1;
    if ((c1 - c0) * (r1 - r0) > 60000) return false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const [cx, cy] = hexCentre(c, r, size, orient);
        const pts = hexCorners(cx, cy, size, orient);
        path.moveTo(sx(pts[0][0]), sy(pts[0][1]));
        for (let i = 1; i < 6; i++) path.lineTo(sx(pts[i][0]), sy(pts[i][1]));
        path.closePath();
      }
    }
  }
  const strength = Math.min(1, Math.max(0.1, g.opacity ?? 0.5));
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx(0), sy(0), v.mapWidth * v.scale, v.mapHeight * v.scale);
  ctx.clip();
  ctx.lineJoin = "round";
  const fine = cs < 12; // small cells get thinner lines so the grid doesn't turn into a smear
  ctx.strokeStyle = `rgba(255, 255, 255, ${strength * 0.55})`; // a pale edge keeps the lines readable on dark sea
  ctx.lineWidth = fine ? 1.6 : 2.4;
  ctx.stroke(path);
  ctx.strokeStyle = `rgba(14, 18, 30, ${strength})`;
  ctx.lineWidth = fine ? 0.8 : 1;
  ctx.stroke(path);
  ctx.restore();
  return true;
}
