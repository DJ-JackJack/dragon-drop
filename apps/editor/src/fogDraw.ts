/**
 * Drawing the player screen's fog (core fog.ts) over a battlemap: black where the players haven't been shown anything, with soft edges. The player screen draws it
 * solid; the DM's own view draws it faintly, so the DM sees what the players don't.
 */
import type { MapReveal } from "@mapmaker/core";

let maskCanvas: HTMLCanvasElement | null = null;

/** Cover what isn't revealed (reveals and hides applied in order), `alpha` dark, its edge softened by `blurPx`. `v`: squares to screen px. */
export function drawFog(ctx: CanvasRenderingContext2D, reveals: MapReveal[] | undefined, v: { scale: number; ox: number; oy: number }, W: number, H: number, alpha: number, blurPx: number) {
  if (!(W >= 1 && H >= 1)) return; // (a window with no size yet)
  const m = (maskCanvas ??= document.createElement("canvas"));
  if (m.width !== Math.ceil(W) || m.height !== Math.ceil(H)) { m.width = Math.ceil(W); m.height = Math.ceil(H); }
  const c = m.getContext("2d")!;
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, m.width, m.height);
  c.fillStyle = "#000";
  c.fillRect(0, 0, m.width, m.height);
  for (const r of reveals ?? []) {
    if (r.points.length < 3) continue;
    c.globalCompositeOperation = r.hide ? "source-over" : "destination-out";
    c.beginPath();
    r.points.forEach(([x, y], i) => (i ? c.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : c.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
    c.closePath();
    c.fill();
  }
  c.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalAlpha = alpha;
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(m, 0, 0, W, H);
  ctx.restore();
}

/** The reveals' outlines (the DM's view while the Reveal tool is in use): gold where something was revealed, red where it was hidden again. */
export function drawRevealOutlines(ctx: CanvasRenderingContext2D, reveals: MapReveal[] | undefined, v: { scale: number; ox: number; oy: number }) {
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  for (const r of reveals ?? []) {
    if (r.points.length < 3) continue;
    ctx.strokeStyle = r.hide ? "rgba(230, 90, 80, 0.9)" : "rgba(255, 224, 120, 0.85)";
    ctx.beginPath();
    r.points.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/** Open the player screen: a window of its own in the Windows app (on a second screen when there is one), else a browser tab. */
type PlayerBridge = { openPlayerScreen?: () => Promise<unknown>; closePlayerScreen?: () => Promise<unknown> };
const playerBridge = () => (window as unknown as { dragonDrop?: PlayerBridge }).dragonDrop;
let playerTab: Window | null = null;

export async function openPlayerScreen(): Promise<void> {
  const dd = playerBridge();
  if (dd?.openPlayerScreen) { await dd.openPlayerScreen(); return; }
  playerTab = window.open("/?player=1", "dragon-drop-players");
}

/** Close the player screen (its window in the Windows app; in a browser, the tab this page opened). */
export async function closePlayerScreen(): Promise<void> {
  const dd = playerBridge();
  if (dd?.closePlayerScreen) { await dd.closePlayerScreen(); return; }
  playerTab?.close();
  playerTab = null;
}
