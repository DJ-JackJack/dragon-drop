/** Exporting the map as one PNG, or as tiles in a ZIP when it's too big for one image. */
import { playerView } from "@mapmaker/core";
import { type Features, type MapMeta, MAX_SINGLE_PX, createZip, planExport } from "@mapmaker/core";
import { drawFeatures } from "./drawFeatures.ts";
import { drawFurniture } from "./drawFurniture.ts";
import { drawMapGrid } from "./drawMapGrid.ts";

export interface ExportSource {
  off: HTMLCanvasElement;
  meta: MapMeta;
  features: Features;
  rivers: { path: Path2D; w: number }[];
}

export interface ExportOptions {
  /** Output pixels per map pixel. */
  factor: number;
  rivers: boolean;
  features: boolean;
  grid: boolean;
  furniture: boolean;
  /** A picture for players: GM-only places, labels and roads are left out (secrets.ts). */
  players?: boolean;
  /** The Label size setting: names and markers bigger or smaller, as on screen (1 when absent). */
  labelScale?: number;
}

export const EXPORT_FACTORS = [1, 2, 4, 8];

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Draw the part (x, y, w, h) of the full-size export into ctx. */
function renderRegion(ctx: CanvasRenderingContext2D, src: ExportSource, o: ExportOptions, x: number, y: number, w: number, h: number, fullW: number, fullH: number) {
  const { meta } = src, k = o.factor;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // the whole bitmap, scaled and shifted: every tile samples it the same way, so tiles join without seams
  ctx.drawImage(src.off, -x, -y, fullW, fullH);
  if (o.rivers && meta.style === "relief") { // (the painted and ink styles have their rivers in the picture already)
    ctx.save();
    ctx.setTransform(k, 0, 0, k, -x, -y);
    ctx.strokeStyle = "rgba(70, 88, 116, 0.92)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const ch of src.rivers) { ctx.lineWidth = Math.max(ch.w, 0.6); ctx.stroke(ch.path); }
    ctx.restore();
  }
  const view = { scale: k, ox: -x, oy: -y, mapWidth: meta.width, mapHeight: meta.height, kmPerPx: meta.kmPerPx };
  if (o.grid) drawMapGrid(ctx, meta.grid, view, w, h);
  if (o.features) drawFeatures(ctx, o.players ? playerView(src.features) : src.features, { scale: k, ox: -x, oy: -y, mapWidth: meta.width, labelScale: o.labelScale }, null);
  if (o.furniture) {
    ctx.save();
    ctx.translate(-x, -y);
    drawFurniture(ctx, meta.furniture, { x: 0, y: 0, w: fullW, h: fullH, mapWidthPx: meta.width, kmPerPx: meta.kmPerPx, unit: fullW * 0.0125 });
    ctx.restore();
  }
}

export const canvasBlob = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("The browser couldn't make the image (it may be too large for this computer's memory)."))), "image/png"));

export const safeName = (n: string) => n.replace(/[^\w\- ]+/g, "").trim() || "map";

/** Make the export: one PNG, or a ZIP of PNG tiles when larger than MAX_SINGLE_PX. */
export async function exportMap(src: ExportSource, o: ExportOptions, onProgress: (text: string) => void): Promise<{ blob: Blob; filename: string }> {
  const { meta } = src;
  const plan = planExport(meta.width, meta.height, o.factor);
  const base = safeName(meta.name);
  if (!plan.tiled) {
    onProgress(`Drawing ${plan.width} × ${plan.height} px…`);
    await tick();
    const c = document.createElement("canvas");
    c.width = plan.width; c.height = plan.height;
    renderRegion(c.getContext("2d")!, src, o, 0, 0, plan.width, plan.height, plan.width, plan.height);
    return { blob: await canvasBlob(c), filename: o.factor === 2 ? `${base}.png` : `${base} (${o.factor}x).png` };
  }
  const files: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < plan.tiles.length; i++) {
    const t = plan.tiles[i];
    onProgress(`Tile ${i + 1} of ${plan.tiles.length}…`);
    await tick();
    const c = document.createElement("canvas");
    c.width = t.w; c.height = t.h;
    renderRegion(c.getContext("2d")!, src, o, t.x, t.y, t.w, t.h, plan.width, plan.height);
    const blob = await canvasBlob(c);
    files.push({ name: `${base}_r${t.row + 1}_c${t.col + 1}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    c.width = c.height = 0; // free the tile's memory before the next one
  }
  const readme = [
    `${meta.name}: ${plan.width} x ${plan.height} px in ${plan.cols} x ${plan.rows} tiles of up to 4096 px.`,
    `Files are named ${base}_r<row>_c<column>.png, counting from 1 at the top-left.`,
    `Place them edge to edge, left to right and top to bottom, to rebuild the whole map.`,
    `Scale: ${(meta.kmPerPx / o.factor).toFixed(4)} km (${(meta.kmPerPx / o.factor * 0.621371).toFixed(4)} mi) per pixel.`,
  ].join("\r\n");
  files.push({ name: "README.txt", data: new TextEncoder().encode(readme) });
  onProgress("Packing the tiles into one file…");
  await tick();
  return { blob: new Blob([createZip(files) as BlobPart], { type: "application/zip" }), filename: `${base}_tiles.zip` };
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export { MAX_SINGLE_PX };
