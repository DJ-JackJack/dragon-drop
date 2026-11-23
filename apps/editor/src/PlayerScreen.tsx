/**
 * The player screen (in-person play): a window for a TV or a second monitor that shows the battlemap open in the editor as the players see it: the server's
 * picture of the level on screen (lights and darkness on; GM-only things, notes and secret-door marks left out: Hub.playerPicture), the grid, and, with the fog on,
 * black wherever the DM hasn't revealed anything yet (core fog.ts). It shows the part of the map the DM sent (`player_view`) or all of it. Nothing here edits the
 * map. Double-click: full screen; G: the grid.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Features } from "@mapmaker/core";
import { store } from "./store.ts";
import { drawMapGrid } from "./drawMapGrid.ts";
import { drawFog } from "./fogDraw.ts";

/** What the picture is made from (not the reveals: revealing needs no new picture). */
function pictureSignature(f: Features, battle: unknown, level: string | undefined): string {
  const { reveals: _r, ...rest } = f;
  return `${level ?? ""}:${JSON.stringify(battle)}:${JSON.stringify(rest)}`;
}

export function PlayerScreen() {
  const s = useSyncExternalStore(store.subscribe, store.getState);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [floorVer, setFloorVer] = useState(0);
  const [grid, setGrid] = useState(true);
  const [idle, setIdle] = useState(false);
  useEffect(() => { document.title = "Dragon Drop: player screen"; store.connect(); }, []);
  useEffect(() => store.onPatch(() => setFloorVer((n) => n + 1)), []);
  const spec = s.meta?.kind === "battle" ? s.meta.battle ?? null : null;
  const sig = spec ? pictureSignature(s.features, spec, s.levels?.active) : "";
  // the picture: asked for again a moment after what it shows changed
  useEffect(() => {
    if (!spec) { setImg(null); return; }
    let gone = false;
    const t = window.setTimeout(() => {
      const next = new Image();
      next.src = `/api/player.jpg?v=${Date.now()}`;
      next.decode().then(() => { if (!gone) setImg(next); }).catch(() => { /* (the map changed meanwhile: the next change asks again) */ });
    }, 700);
    return () => { gone = true; window.clearTimeout(t); };
  }, [sig, floorVer, s.meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // keys and the mouse: G the grid, a double-click full screen; the pointer hides when still
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "g") setGrid((g) => !g); if (e.key === "F11") { e.preventDefault(); void toggleFull(); } };
    let t = 0;
    const move = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), 2500); };
    window.addEventListener("keydown", key);
    window.addEventListener("pointermove", move);
    move();
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("pointermove", move); window.clearTimeout(t); };
  }, []);
  // drawing
  useEffect(() => {
    const draw = () => {
      const cv = canvasRef.current, wrap = wrapRef.current;
      if (!cv || !wrap) return;
      const dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
      if (W < 1 || H < 1) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      if (!spec || !img || !s.meta) return;
      const r = s.playerRect ?? { x: 0, y: 0, w: spec.squaresX, h: spec.squaresY };
      const scale = Math.min(W / r.w, H / r.h), ox = (W - r.w * scale) / 2 - r.x * scale, oy = (H - r.h * scale) / 2 - r.y * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, ox, oy, spec.squaresX * scale, spec.squaresY * scale);
      if (grid && spec.gridType !== "none") {
        drawMapGrid(ctx, { type: spec.gridType, sizeMi: spec.feetPerSquare / 5280, orient: "pointy", opacity: 0.35 },
          { scale: scale / spec.sub, ox, oy, mapWidth: s.meta.width, mapHeight: s.meta.height, kmPerPx: s.meta.kmPerPx }, W, H);
      }
      if (spec.fog) drawFog(ctx, s.features.reveals, { scale, ox, oy }, W, H, 1, Math.max(2, scale * 0.15));
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  });
  return (
    <div ref={wrapRef} className={`player-screen${idle ? " idle" : ""}`} onDoubleClick={() => void toggleFull()} data-testid="player-screen">
      <canvas ref={canvasRef} data-testid="player-canvas" />
      {!spec && <div className="player-wait">{s.connected ? "Waiting for the DM to open a battlemap…" : "Connecting…"}</div>}
    </div>
  );
}

async function toggleFull() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* (a browser may refuse) */ }
}
