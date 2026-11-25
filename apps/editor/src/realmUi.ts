/**
 * The Realm tool on world maps (core realms.ts): its settings (which realm, paint or erase, brush size, land only, keep neighbours) and the stroke being painted.
 * A stroke paints into a copy of the realm grid as the mouse moves (drawn as a wash on top, `draw`), and is sent as one edit when the mouse is let go.
 */
import { useSyncExternalStore } from "react";
import { type MapRealm, type RealmGrid, decodeRealmCells, encodeRealmCells, hexToRgb, paintRealmCells, realmGridOf } from "@mapmaker/core";
import { store } from "./store.ts";

export interface RealmSettings {
  /** The realm being painted (its id). */
  realm: string | null;
  erase: boolean;
  /** Brush radius, map px. */
  radius: number;
  landOnly: boolean;
  /** Paint only land that belongs to nobody yet (round a neighbour, not over it). */
  onlyEmpty: boolean;
  /** Erasing: take land only from the chosen realm (otherwise from every realm under the brush). */
  eraseOnly: boolean;
}

let state: RealmSettings = loadSettings();
const listeners = new Set<() => void>();

function loadSettings(): RealmSettings {
  const base: RealmSettings = { realm: null, erase: false, radius: 30, landOnly: true, onlyEmpty: false, eraseOnly: false };
  try {
    const s = JSON.parse(localStorage.getItem("dd.realm") ?? "{}") as Partial<RealmSettings>;
    return { ...base, ...(typeof s.radius === "number" && { radius: s.radius }), ...(typeof s.landOnly === "boolean" && { landOnly: s.landOnly }), ...(typeof s.onlyEmpty === "boolean" && { onlyEmpty: s.onlyEmpty }) };
  } catch { return base; }
}

interface Stroke { realm: MapRealm | null; grid: RealmGrid; cells: Uint8Array; changed: number; last: { x: number; y: number }; preview: HTMLCanvasElement; rgb: [number, number, number] | null }
let stroke: Stroke | null = null;

export const realmCtl = {
  get state() { return state; },
  set(p: Partial<RealmSettings>) {
    state = { ...state, ...p };
    try { localStorage.setItem("dd.realm", JSON.stringify({ radius: state.radius, landOnly: state.landOnly, onlyEmpty: state.onlyEmpty })); } catch { /* (private window) */ }
    for (const l of listeners) l();
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },

  /** The mouse went down with the Realm tool (map px): starts a stroke, or says why not. */
  down(m: { x: number; y: number }): string | null {
    const meta = store.getState().meta, hf = store.heights;
    if (!meta || !hf) return "The map isn't loaded yet.";
    const f = store.getState().features, realm = (f.realms ?? []).find((r) => r.id === state.realm) ?? null;
    if (!state.erase && !realm) return "Choose a realm in the bar above first, or make a new one with + New realm.";
    const grid = realmGridOf({ meta, features: f }), cells = decodeRealmCells(grid);
    const preview = document.createElement("canvas");
    preview.width = grid.w; preview.height = grid.h;
    stroke = { realm, grid, cells, changed: 0, last: m, preview, rgb: realm ? hexToRgb(realm.colour) : null };
    this.dab(m);
    return null;
  },
  /** The mouse moved during a stroke: paints along the way. */
  move(m: { x: number; y: number }) {
    if (!stroke) return;
    const d = Math.hypot(m.x - stroke.last.x, m.y - stroke.last.y), step = Math.max(1, state.radius / 3), n = Math.ceil(d / step);
    for (let k = 1; k <= n; k++) this.dab({ x: stroke.last.x + ((m.x - stroke.last.x) * k) / n, y: stroke.last.y + ((m.y - stroke.last.y) * k) / n });
    stroke.last = m;
  },
  dab(m: { x: number; y: number }) {
    if (!stroke) return;
    const meta = store.getState().meta!, hf = store.heights!, s = stroke, g = s.grid;
    const before = s.cells.slice();
    s.changed += paintRealmCells(s.cells, g, {
      n: state.erase ? 0 : s.realm!.n, circle: { x: m.x, y: m.y, r: state.radius }, onlyEmpty: state.onlyEmpty && !state.erase, ...(state.erase && state.eraseOnly && s.realm && { only: s.realm.n }),
      ...(state.landOnly && !state.erase && { landOnly: { heights: hf.data, w: hf.w, h: hf.h, seaLevel: meta.seaLevel } }),
    });
    // the preview: painted cells in the realm's colour, erased ones dark
    const c = s.preview.getContext("2d")!;
    const x0 = Math.max(0, Math.floor((m.x - state.radius) / g.scale)), x1 = Math.min(g.w - 1, Math.ceil((m.x + state.radius) / g.scale));
    const y0 = Math.max(0, Math.floor((m.y - state.radius) / g.scale)), y1 = Math.min(g.h - 1, Math.ceil((m.y + state.radius) / g.scale));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = y * g.w + x;
      if (s.cells[k] === before[k]) continue;
      c.fillStyle = s.cells[k] && s.rgb ? `rgba(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]}, 0.55)` : "rgba(10, 10, 14, 0.45)";
      c.fillRect(x, y, 1, 1);
    }
  },
  /** The mouse was let go: the stroke becomes one edit. */
  up() {
    const s = stroke;
    stroke = null;
    if (!s || !s.changed) return;
    const what = state.erase ? (s.realm && state.eraseOnly ? `Erase realm ${s.realm.name}` : "Erase realms") : `Paint realm ${s.realm!.name}`;
    store.send({ t: "cmd", cmd: { op: "features", patch: { setRealmCells: encodeRealmCells(s.grid, s.cells) } }, label: what });
  },
  get painting() { return !!stroke; },
  /** The stroke so far, over the map. */
  draw(ctx: CanvasRenderingContext2D, v: { scale: number; ox: number; oy: number }) {
    if (!stroke) return;
    const g = stroke.grid;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(stroke.preview, v.ox, v.oy, g.w * g.scale * v.scale, g.h * g.scale * v.scale);
    ctx.restore();
  },
};

export function useRealmSettings(): RealmSettings {
  return useSyncExternalStore(realmCtl.subscribe, () => realmCtl.state);
}
