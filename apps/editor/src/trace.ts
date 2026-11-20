/**
 * The trace picture in the editor, shared by the world map and the battlemap views: drawing it over the ground and under the map's own
 * marks, the DM's view settings (how see-through, shown or hidden: kept on this computer, never sent), and lining it up: dragging it,
 * pinning two points, and on a battlemap matching the picture's grid to the map's squares. Where it lies is the map's own (core
 * trace.ts, `features.trace`): every change is one undoable edit, sent when the DM lets go.
 *
 * The views call `draw` from their own drawing, and `down` / `move` / `up` from their pointer handlers; `down` says whether the
 * trace took the click (only while one of its modes is on).
 */
import {
  type MapMeta, type RefInfo, type TracePicture, fitTrace, gridPinTargets, moveTrace, rotateTraceAbout, scaleTraceAbout, traceCentre, traceFromPins,
  tracePoint, traceToPicture,
} from "@mapmaker/core";
import { ask, notice } from "./dialogs.tsx";
import { store } from "./store.ts";

export type TraceMode = "move" | "pin" | "grid";
type Pt = [number, number];
/** The views' own view: screen px per map unit, and where map (0, 0) is on screen. */
interface View { scale: number; ox: number; oy: number }

export interface TraceState {
  shown: boolean;
  /** How solid the picture is drawn, 0.1 to 1. */
  opacity: number;
  mode: TraceMode | null;
  /** Points clicked so far while pinning or matching the grid (picture points are kept in the picture's own pixels). */
  picks: { picture?: Pt; map?: Pt }[];
}

const OPACITY_KEY = "dd.traceOpacity";
function loadOpacity(): number {
  try { const n = Number(localStorage.getItem(OPACITY_KEY)); return n >= 0.1 && n <= 1 ? n : 0.5; } catch { return 0.5; }
}

/** The map's size in its own units: map px on a world map, squares on a battlemap. */
export function mapUnitsOf(meta: MapMeta): { w: number; h: number } {
  return meta.battle ? { w: meta.battle.squaresX, h: meta.battle.squaresY } : { w: meta.width, h: meta.height };
}

const refUrl = (mapId: string, name: string) => `/api/projects/${mapId}/refs/${encodeURIComponent(name)}`;

/** What to do next, for the trace bar. */
export function traceStep(s: TraceState): string {
  const n = s.picks.length;
  if (s.mode === "move") return "Drag the picture to move it. Size and Turn change it about its middle. Pin 2 points lines it up exactly.";
  if (s.mode === "pin") {
    return ["Click a point you can recognise on the picture: a cape, a river mouth, a tower, the corner of a room.",
      "Now click where that point belongs on the map.",
      "Click a second point on the picture, far from the first.",
      "And click where that one belongs on the map."][n] ?? "";
  }
  if (s.mode === "grid") return n === 0 ? "Click a corner where the picture's grid lines cross." : "Click another crossing along the same row or column, a few squares away.";
  return "";
}

class TraceController {
  state: TraceState = { shown: true, opacity: loadOpacity(), mode: null, picks: [] };
  private listeners = new Set<() => void>();
  /** Where the picture is while it is being dragged (sent when the DM lets go). */
  private live: TracePicture | null = null;
  /** The saved picture a drag started from: once the map's own copy changes, the dropped position has arrived and `live` goes. */
  private liveBase: TracePicture | null = null;
  private dragFrom: { at: Pt; base: TracePicture } | null = null;
  private images = new Map<string, HTMLImageElement>();
  /** The mounted view's redraw (set by the view). */
  redraw: () => void = () => {};

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getState = () => this.state;
  private set(p: Partial<TraceState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  setOpacity(o: number) {
    const opacity = Math.max(0.1, Math.min(1, o));
    try { localStorage.setItem(OPACITY_KEY, String(opacity)); } catch { /* private window */ }
    this.set({ opacity });
  }
  toggleShown() { this.set({ shown: !this.state.shown, mode: null, picks: [] }); }
  setMode(mode: TraceMode | null) { this.live = null; this.dragFrom = null; this.set({ mode: this.state.mode === mode ? null : mode, picks: [], shown: true }); }
  reset() { this.live = null; this.dragFrom = null; if (this.state.mode || this.state.picks.length) this.set({ mode: null, picks: [] }); }

  private send(t: TracePicture | null, label: string) {
    store.send({ t: "cmd", cmd: { op: "features", patch: { setTrace: t } }, label });
  }

  /** Lay a reference picture over the map, fitted inside it. */
  async start(meta: MapMeta, r: RefInfo) {
    let w = r.w, h = r.h;
    if (!w || !h) {
      const img = await this.load(refUrl(meta.id, r.name));
      w = img?.naturalWidth; h = img?.naturalHeight;
    }
    if (!w || !h) { void notice(`"${r.name}" can't be shown as a picture.`); return; }
    const u = mapUnitsOf(meta);
    this.reset();
    this.set({ shown: true });
    this.send(fitTrace({ ref: r.name, w, h }, u.w, u.h), `Trace picture ${r.name}`);
  }
  stop(t: TracePicture) { this.reset(); this.send(null, `Stop tracing ${t.ref}`); }
  fit(t: TracePicture, meta: MapMeta) { const u = mapUnitsOf(meta); this.send({ ...fitTrace(t, u.w, u.h), ...(t.locked && { locked: true }) }, "Fit the trace picture to the map"); }
  setLocked(t: TracePicture, locked: boolean) {
    if (locked) this.reset();
    const { locked: _, ...rest } = t;
    this.send(locked ? { ...rest, locked: true } : rest, locked ? "Lock the trace picture" : "Unlock the trace picture");
  }
  /** Size (k times) or turn (deg clockwise) about the picture's middle. */
  resize(t: TracePicture, k: number) { const [cx, cy] = traceCentre(t); this.send(scaleTraceAbout(t, k, cx, cy), k > 1 ? "Enlarge the trace picture" : "Shrink the trace picture"); }
  turn(t: TracePicture, deg: number) { const [cx, cy] = traceCentre(t); this.send(rotateTraceAbout(t, deg, cx, cy), "Turn the trace picture"); }

  private load(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** The picture, once loaded (null while it loads; the view is redrawn when it arrives). */
  private image(url: string): HTMLImageElement | null {
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => this.redraw();
      img.src = url;
      this.images.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** Is the picture there to draw? (False while it loads, or when its file has gone.) */
  loaded(mapId: string, t: TracePicture): boolean { return !!this.image(refUrl(mapId, t.ref)); }

  /** Draw the trace picture (and the points picked so far) in a view. */
  draw(ctx: CanvasRenderingContext2D, saved: TracePicture | undefined, mapId: string, v: View) {
    if (this.live && !this.dragFrom && saved !== this.liveBase) this.live = null;
    const t = this.live ?? saved;
    if (!t || !this.state.shown) return;
    const img = this.image(refUrl(mapId, t.ref));
    const s = this.state, step = s.picks.length;
    // while pinning, the picture is nearly solid when a point on it is wanted and faint when the map is
    const alpha = s.mode === "pin" ? (step % 2 === 0 ? Math.max(0.85, s.opacity) : Math.min(0.25, s.opacity)) : s.mode === "grid" ? Math.max(0.85, s.opacity) : s.opacity;
    ctx.save();
    ctx.translate(v.ox + t.x * v.scale, v.oy + t.y * v.scale);
    ctx.rotate((t.rotation * Math.PI) / 180);
    const W = t.w * t.scale * v.scale, H = t.h * t.scale * v.scale;
    if (img) {
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (s.mode === "move" || !img) {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255, 224, 120, 0.9)";
      ctx.strokeRect(0, 0, W, H);
    }
    ctx.restore();
    // the points clicked so far: 1 and 2 on the picture (where they are now) and on the map
    const dot = (p: Pt, label: string, onMap: boolean) => {
      const x = v.ox + p[0] * v.scale, y = v.oy + p[1] * v.scale;
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = onMap ? "rgba(120, 200, 255, 0.95)" : "rgba(255, 210, 90, 0.95)"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#111"; ctx.stroke();
      ctx.fillStyle = "#111"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x, y + 0.5);
      ctx.restore();
    };
    s.picks.forEach((k, i) => {
      const n = s.mode === "pin" ? String(Math.floor(i / 2) + 1) : String(i + 1);
      if (k.picture) dot(tracePoint(t, k.picture[0], k.picture[1]), n, false);
      if (k.map) dot(k.map, n, true);
    });
  }

  /** A left click on the map at map point m: true when the trace takes it. */
  down(t: TracePicture | undefined, m: { x: number; y: number }): boolean {
    const s = this.state;
    if (!t || !s.shown || !s.mode || t.locked) return false;
    const at: Pt = [m.x, m.y];
    if (s.mode === "move") { this.dragFrom = { at, base: t }; this.live = t; this.liveBase = t; return true; }
    const picks = [...s.picks];
    if (s.mode === "pin") {
      picks.push(picks.length % 2 === 0 ? { picture: traceToPicture(t, m.x, m.y) } : { map: at });
      if (picks.length < 4) { this.set({ picks }); return true; }
      this.set({ picks: [], mode: null });
      const r = traceFromPins(t, [{ picture: picks[0].picture!, map: picks[1].map! }, { picture: picks[2].picture!, map: picks[3].map! }]);
      if ("error" in r) void notice(r.error);
      else this.send(r, "Line up the trace picture (2 points)");
      return true;
    }
    // matching the grid: two crossings of the picture's grid, then how many squares apart they are
    picks.push({ picture: traceToPicture(t, m.x, m.y) });
    if (picks.length < 2) { this.set({ picks }); return true; }
    this.set({ picks });
    const pa = picks[0].picture!, pb = picks[1].picture!;
    const a = tracePoint(t, pa[0], pa[1]), b = tracePoint(t, pb[0], pb[1]);
    // (no guess in the box: until the picture is lined up, its squares and the map's differ, and only the DM can count the picture's)
    void ask("How many of the picture's squares are there between the two crossings you clicked? Count along the row or column.", "", "Match the grid").then((answer) => {
      this.set({ picks: [], mode: null });
      const n = Math.round(Number(answer));
      if (!answer || !(n >= 1 && n <= 500)) return;
      const [ta, tb] = gridPinTargets(a, b, n);
      const r = traceFromPins(t, [{ picture: pa, map: ta }, { picture: pb, map: tb }]);
      if ("error" in r) { void notice(r.error); return; }
      this.send(r, `Match the trace picture's grid (${n} squares)`);
    });
    return true;
  }

  /** The pointer moved while the trace has it. */
  move(m: { x: number; y: number }) {
    const d = this.dragFrom;
    if (!d) return;
    this.live = moveTrace(d.base, m.x - d.at[0], m.y - d.at[1]);
    this.redraw();
  }

  /** The DM let go. */
  up() {
    const live = this.live, base = this.dragFrom?.base;
    this.dragFrom = null;
    if (live && base && (live.x !== base.x || live.y !== base.y)) {
      this.send(live, "Move the trace picture"); // (`live` stays drawn until the map's copy changes, so the picture doesn't jump back for a moment)
      setTimeout(() => { if (this.live === live) { this.live = null; this.redraw(); } }, 3000);
    } else this.live = null;
    this.redraw();
  }
}

export const traceCtl = new TraceController();
