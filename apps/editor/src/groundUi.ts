/**
 * The Ground tool on world maps (biome brushes; core groundPaint.ts): its settings (which ground, paint or erase, brush size, land only) and the stroke being
 * painted. As with the Realm tool, a stroke paints into a copy of the painting as the mouse moves (drawn as a wash on top, `draw`), and is sent as one edit
 * when the mouse is let go; the map is painted again once the server has worked the new painting out.
 */
import { useSyncExternalStore } from "react";
import { GROUND_INFO, type RealmGrid, decodeRealmCells, encodeRealmCells, groundCode, groundGridOf, paintRealmCells } from "@mapmaker/core";
import { store } from "./store.ts";

export interface GroundSettings {
  /** The ground to paint (an id from PAINTABLE_GROUNDS). */
  ground: string | null;
  erase: boolean;
  /** Brush radius, map px. */
  radius: number;
  landOnly: boolean;
}

let state: GroundSettings = loadSettings();
const listeners = new Set<() => void>();

function loadSettings(): GroundSettings {
  const base: GroundSettings = { ground: null, erase: false, radius: 30, landOnly: true };
  try {
    const s = JSON.parse(localStorage.getItem("dd.ground") ?? "{}") as Partial<GroundSettings>;
    return {
      ...base, ...(typeof s.radius === "number" && { radius: s.radius }), ...(typeof s.landOnly === "boolean" && { landOnly: s.landOnly }),
      ...(typeof s.ground === "string" && groundCode(s.ground) && { ground: s.ground }),
    };
  } catch { return base; }
}

/** A ground's name and its swatch colour (the Ground legend's). */
export const groundInfo = (id: string | null) => GROUND_INFO.find((g) => g.id === id) ?? null;

interface Stroke { grid: RealmGrid; cells: Uint8Array; changed: number; last: { x: number; y: number }; preview: HTMLCanvasElement; rgb: [number, number, number] | null; label: string }
let stroke: Stroke | null = null;

export const groundCtl = {
  get state() { return state; },
  set(p: Partial<GroundSettings>) {
    state = { ...state, ...p };
    try { localStorage.setItem("dd.ground", JSON.stringify({ radius: state.radius, landOnly: state.landOnly, ground: state.ground })); } catch { /* (private window) */ }
    for (const l of listeners) l();
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },

  /** The mouse went down with the Ground tool (map px): starts a stroke, or says why not. */
  down(m: { x: number; y: number }): string | null {
    const meta = store.getState().meta, hf = store.heights;
    if (!meta || !hf) return "The map isn't loaded yet.";
    const info = groundInfo(state.ground);
    if (!state.erase && !info) return "Choose a kind of ground in the bar above first.";
    const grid = groundGridOf({ meta, features: store.getState().features }), cells = decodeRealmCells(grid);
    const preview = document.createElement("canvas");
    preview.width = grid.w; preview.height = grid.h;
    stroke = { grid, cells, changed: 0, last: m, preview, rgb: state.erase ? null : (info!.swatch as [number, number, number]), label: state.erase ? "Erase painted ground" : `Paint ground: ${info!.name}` };
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
      n: state.erase ? 0 : groundCode(state.ground ?? ""), circle: { x: m.x, y: m.y, r: state.radius },
      ...(state.landOnly && !state.erase && { landOnly: { heights: hf.data, w: hf.w, h: hf.h, seaLevel: meta.seaLevel } }),
    });
    // the preview: painted cells in the ground's colour, erased ones dark
    const c = s.preview.getContext("2d")!;
    const x0 = Math.max(0, Math.floor((m.x - state.radius) / g.scale)), x1 = Math.min(g.w - 1, Math.ceil((m.x + state.radius) / g.scale));
    const y0 = Math.max(0, Math.floor((m.y - state.radius) / g.scale)), y1 = Math.min(g.h - 1, Math.ceil((m.y + state.radius) / g.scale));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = y * g.w + x;
      if (s.cells[k] === before[k]) continue;
      c.clearRect(x, y, 1, 1);
      c.fillStyle = s.cells[k] && s.rgb ? `rgba(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]}, 0.7)` : "rgba(10, 10, 14, 0.4)";
      c.fillRect(x, y, 1, 1);
    }
  },
  /** The mouse was let go: the stroke becomes one edit (the painting cleared when nothing is left painted). */
  up() {
    const s = stroke;
    stroke = null;
    if (!s || !s.changed) return;
    const any = s.cells.some((v) => v);
    store.send({ t: "cmd", cmd: { op: "features", patch: { setGroundCells: any ? encodeRealmCells(s.grid, s.cells) : null } }, label: s.label });
  },
  /** Take every painted ground off the map (one edit). */
  clearAll() {
    store.send({ t: "cmd", cmd: { op: "features", patch: { setGroundCells: null } }, label: "Clear painted ground" });
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

export function useGroundSettings(): GroundSettings {
  return useSyncExternalStore(groundCtl.subscribe, () => groundCtl.state);
}
