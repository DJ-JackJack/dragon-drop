/** Climate-region outlines on the editor canvas (an editing aid; not part of exports). */
import { type ClimateRegion, pointInPolygon, polygonCentroid } from "@mapmaker/core";

const LINE = "rgba(196, 128, 255, 0.95)";
const FILL = "rgba(196, 128, 255, 0.12)";

/** A short description of what a region does, for its outline caption and the list. */
export function regionSummary(r: ClimateRegion): string {
  const parts: string[] = [];
  if (r.temperature !== undefined) parts.push(["frozen", "cold", "temperate", "warm", "hot"][Math.min(4, Math.round(r.temperature * 4))]);
  if (r.moisture !== undefined) parts.push(["arid", "dry", "normal moisture", "wet", "lush"][Math.min(4, Math.round(r.moisture * 4))]);
  if (r.snow) parts.push("snow");
  if (r.rock) parts.push("dark stone");
  if (r.volcanic) parts.push("volcanic");
  return parts.join(", ") || "no change yet";
}

export function drawRegions(
  ctx: CanvasRenderingContext2D, regions: ClimateRegion[] | undefined, v: { scale: number; ox: number; oy: number }, selectedId: string | null,
) {
  for (const r of regions ?? []) {
    if (r.polygon.length < 3) continue;
    const sel = r.id === selectedId;
    ctx.save();
    ctx.beginPath();
    r.polygon.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
    ctx.closePath();
    if (sel) { ctx.fillStyle = FILL; ctx.fill(); }
    ctx.setLineDash((r.border ?? "soft") === "soft" ? [7, 5] : []);
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.strokeStyle = LINE;
    ctx.stroke();
    const [cx, cy] = polygonCentroid(r.polygon);
    const x = v.ox + cx * v.scale, y = v.oy + cy * v.scale;
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(20, 16, 30, 0.85)";
    ctx.fillStyle = "#ead9ff";
    ctx.strokeText(r.name, x, y);
    ctx.fillText(r.name, x, y);
    ctx.font = "11px system-ui, sans-serif";
    ctx.strokeText(regionSummary(r), x, y + 14);
    ctx.fillText(regionSummary(r), x, y + 14);
    ctx.restore();
  }
}

/** The topmost region containing the map point. */
export function regionAt(regions: ClimateRegion[] | undefined, mx: number, my: number): ClimateRegion | null {
  const rs = regions ?? [];
  for (let i = rs.length - 1; i >= 0; i--) if (rs[i].polygon.length > 2 && pointInPolygon(mx, my, rs[i].polygon)) return rs[i];
  return null;
}
