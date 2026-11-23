/**
 * The ruler (K on world maps and settlements, M on battlemaps): click points along a route; double-click or Enter finishes it, Backspace takes back the last
 * point, Esc clears it. One controller for the three map views, each in its own units (world px, squares, metres). On a world map the server surveys the
 * route (core measure.ts: the ground, roads, water and rivers along it) and the tool bar gives the time it takes; how you travel and your paces are
 * remembered on this computer.
 */
import { useSyncExternalStore } from "react";
import { MI_PER_KM, type RouteSurvey, TRAVEL_MODES, type TravelModeId, routeLength } from "@mapmaker/core";
import { store } from "./store.ts";

type Pt = [number, number];
interface View { scale: number; ox: number; oy: number }

export interface MeasureState {
  points: Pt[];
  /** Where the pointer is while the route is being clicked (the leg to it counts in the length shown). */
  hover: Pt | null;
  done: boolean;
  /** World maps: the route surveyed by the server (null until it answers, or on other maps). */
  survey: RouteSurvey | null;
  mode: TravelModeId;
  /** The DM's own paces, miles a day (missing: the usual). */
  paces: Partial<Record<TravelModeId, number>>;
}

const PREFS = "dd.measure";
function loadPrefs(): Pick<MeasureState, "mode" | "paces"> {
  try {
    const j = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as { mode?: string; paces?: Record<string, number> };
    const mode = TRAVEL_MODES.some((m) => m.id === j.mode) ? (j.mode as TravelModeId) : "foot";
    const paces: Partial<Record<TravelModeId, number>> = {};
    for (const m of TRAVEL_MODES) { const v = j.paces?.[m.id]; if (typeof v === "number" && v > 0 && v < 1000) paces[m.id] = v; }
    return { mode, paces };
  } catch { return { mode: "foot", paces: {} }; }
}

class MeasureController {
  state: MeasureState = { points: [], hover: null, done: false, survey: null, ...loadPrefs() };
  private listeners = new Set<() => void>();
  private last: { t: number; x: number; y: number } | null = null;
  private asked = 0;
  private world = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    store.onMeasured((m) => { if (m.id === this.asked) this.set({ survey: m.survey }); });
  }

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<MeasureState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  /** Which kind of map the ruler is on: on a world map each route is surveyed by the server. */
  setWorld(on: boolean) {
    if (on === this.world) return;
    this.world = on;
    this.changed();
  }

  /** A click at map point m (screen point s, to tell a double-click). A click after a finished route starts a new one. */
  down(m: { x: number; y: number }, s: { x: number; y: number }) {
    const now = performance.now(), lc = this.last;
    const dbl = !!lc && now - lc.t < 400 && Math.hypot(s.x - lc.x, s.y - lc.y) < 8;
    this.last = { t: now, x: s.x, y: s.y };
    if (dbl && !this.state.done) { this.finish(); return; } // (its first click already added the point)
    if (this.state.done) this.set({ points: [[m.x, m.y]], done: false, survey: null, hover: null });
    else this.set({ points: [...this.state.points, [m.x, m.y]] });
    this.changed();
  }
  move(m: { x: number; y: number }) {
    if (!this.state.done && this.state.points.length) this.set({ hover: [m.x, m.y] });
  }
  leave() { if (this.state.hover) this.set({ hover: null }); }
  finish() {
    if (this.state.points.length >= 2) this.set({ done: true, hover: null });
    else this.clear();
  }
  back() {
    const pts = this.state.points.slice(0, -1);
    this.set({ points: pts, done: false, survey: pts.length >= 2 ? this.state.survey : null });
    this.changed();
  }
  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.asked++;
    this.set({ points: [], hover: null, done: false, survey: null });
  }
  /** Enter, Backspace and Esc while a route is shown: true when the ruler took the key. */
  key(e: KeyboardEvent): boolean {
    if (!this.state.points.length) return false;
    if (e.key === "Enter") this.finish();
    else if (e.key === "Escape") this.clear();
    else if (e.key === "Backspace" || e.key === "Delete") this.back();
    else return false;
    return true;
  }

  setMode(mode: TravelModeId) { this.set({ mode }); this.savePrefs(); }
  setPace(mode: TravelModeId, milesPerDay: number | null) {
    const paces = { ...this.state.paces };
    if (milesPerDay && milesPerDay > 0 && milesPerDay < 1000) paces[mode] = milesPerDay; else delete paces[mode];
    this.set({ paces });
    this.savePrefs();
  }
  private savePrefs() {
    try { localStorage.setItem(PREFS, JSON.stringify({ mode: this.state.mode, paces: this.state.paces })); } catch { /* not kept: fine */ }
  }

  /** Ask the server to survey a world-map route, a moment after the points stop changing. */
  private changed() {
    if (this.timer) clearTimeout(this.timer);
    const pts = this.state.points;
    if (!this.world || pts.length < 2) { if (this.state.survey) this.set({ survey: null }); return; }
    this.timer = setTimeout(() => {
      this.timer = null;
      const id = ++this.asked;
      store.send({ t: "measure", id, points: this.state.points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as Pt) });
    }, 150);
  }

  /** The route as drawn now: the clicked points, and the leg to the pointer while it is being clicked. */
  shown(): Pt[] {
    const s = this.state;
    return s.hover && !s.done ? [...s.points, s.hover] : s.points;
  }

  /** The route on the map: a dashed gold line with its points, and its length (in the map's words, from `label`) beside its end. */
  draw(ctx: CanvasRenderingContext2D, v: View, label: (units: number) => string) {
    const pts = this.shown();
    if (!pts.length) return;
    const sx = (p: Pt) => v.ox + p[0] * v.scale, sy = (p: Pt) => v.oy + p[1] * v.scale;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(sx(p), sy(p)) : ctx.moveTo(sx(p), sy(p))));
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(12, 10, 6, 0.6)";
    ctx.stroke();
    ctx.setLineDash([9, 6]);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "#ffd75e";
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of this.state.points) {
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd75e";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#17130a";
      ctx.stroke();
    }
    if (pts.length >= 2) {
      const end = pts[pts.length - 1], text = label(routeLength(pts));
      ctx.font = "600 13px system-ui, sans-serif";
      const w = ctx.measureText(text).width + 14, x = sx(end) + 12, y = sy(end) - 30;
      ctx.fillStyle = "rgba(14, 12, 8, 0.88)";
      ctx.strokeStyle = "rgba(255, 215, 94, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 22, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffe9a6";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + 7, y + 11.5);
    }
    ctx.restore();
  }
}

export const measureCtl = new MeasureController();
export function useMeasure(): MeasureState {
  return useSyncExternalStore(measureCtl.subscribe, () => measureCtl.state);
}

const tidy = (n: number) => (n < 10 ? Math.round(n * 10) / 10 : Math.round(n)).toLocaleString();
/** A world-map length: "124 mi (200 km)". */
export const worldLength = (km: number) => `${tidy(km * MI_PER_KM)} mi (${tidy(km)} km)`;
/** A battlemap length: "35 ft (7 squares)". */
export const battleLength = (squares: number, feetPerSquare: number) => `${tidy(squares * feetPerSquare)} ft (${tidy(squares)} square${Math.abs(squares - 1) < 0.05 ? "" : "s"})`;
/** A settlement length: "120 m (394 ft)". */
export const cityLength = (metres: number) => `${tidy(metres)} m (${tidy(metres * 3.28084)} ft)`;

/** What to do with the ruler, before there is a route. */
export const MEASURE_HINT = "Click points along a route to measure it. Double-click or press Enter to finish; Backspace takes back the last point, Esc clears. A click after that starts a new route.";
