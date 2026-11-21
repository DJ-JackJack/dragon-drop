/**
 * Comparing the open map with another one in the editor (the DM's side of "maps that know about each other"; Claude's is compare_maps). The other map's picture
 * (GET /api/projects/<id>/picture.jpg, drawn in its own style) is laid over the open map where it lies on it (the server works that out: `compare_with` → `compare`,
 * core mapLinks.ts): a copy exactly over its original, a detail map over its area of the world map, a battlemap over its spot of a city. Two ways to look: Fade (the other
 * map see-through over this one) and Swipe (the other map on the left of a line, this one on the right; the slider moves the line). Maps that aren't linked can only be
 * shown side by side (CompareMaps.tsx). Nothing is changed or saved: it is only a view, and it ends when another map is opened.
 *
 * The views call `draw` at the end of their drawing, and set `redraw` so the picture can redraw them when it arrives.
 */
import type { Rect } from "@mapmaker/core";
import { store } from "./store.ts";

export type CompareMode = "fade" | "swipe" | "side";

export interface CompareState {
  /** The other map, while comparing. */
  id: string | null;
  name: string;
  /** Where it lies on the open map, in the open map's units, or null when the two aren't linked (side by side only). */
  rect: Rect | null;
  /** How the two are linked, in words. */
  how: string[];
  mode: CompareMode;
  /** Fade: how solid the other map is; Swipe: where the line is, as a share of the view's width (0 to 1). */
  amount: number;
  /** The open map the comparison was started on (it ends when another is opened). */
  on: string | null;
  /** Waiting for the server's answer. */
  waiting: boolean;
  /** The picture is still being drawn by the server. */
  loading: boolean;
}

interface View { scale: number; ox: number; oy: number }

class CompareController {
  state: CompareState = { id: null, name: "", rect: null, how: [], mode: "fade", amount: 0.5, on: null, waiting: false, loading: false };
  private listeners = new Set<() => void>();
  private img: HTMLImageElement | null = null;
  private imgFor = "";
  /** The mounted view's redraw. */
  redraw: () => void = () => {};

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getState = () => this.state;
  private set(p: Partial<CompareState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
    this.redraw();
  }

  private hooked = false;

  /** Start comparing the open map with another (by id). */
  start(id: string) {
    const on = store.getState().meta?.id ?? null;
    if (!on || id === on) return;
    if (!this.hooked) {
      this.hooked = true;
      store.onCompare((m) => this.placed(m));
      // an error while waiting is the server saying it can't compare them (the error itself is shown by the editor)
      store.subscribe(() => { if (this.state.waiting && store.getState().error) this.stop(); });
    }
    if (store.getState().error) store.dismissError();
    this.set({ id, name: "", rect: null, how: [], on, waiting: true, loading: true, mode: "fade", amount: 0.5 });
    store.send({ t: "compare_with", id });
  }

  /** The server's answer: where the other map lies on this one. */
  placed(m: { id: string; name: string; rect: Rect | null; how: string[] }) {
    if (m.id !== this.state.id) return;
    this.set({ name: m.name, rect: m.rect, how: m.how, waiting: false, mode: m.rect ? this.state.mode : "side" });
    this.load(m.id);
  }

  stop() {
    this.img = null; this.imgFor = "";
    this.set({ id: null, name: "", rect: null, how: [], on: null, waiting: false, loading: false });
  }

  setMode(mode: CompareMode) {
    if (mode !== "side" && !this.state.rect) return;
    this.set({ mode, amount: mode === "swipe" ? 0.5 : this.state.mode === "swipe" ? 0.5 : this.state.amount });
  }
  setAmount(a: number) { this.set({ amount: Math.max(0, Math.min(1, a)) }); }

  /** A map's picture address (a fresh one each time a comparison starts, so a changed map isn't shown as it was). */
  pictureUrl(id: string, max = 2048) { return `/api/projects/${id}/picture.jpg?max=${max}&v=${this.started}`; }
  private started = Date.now();

  private load(id: string) {
    this.started = Date.now();
    const url = this.pictureUrl(id);
    this.imgFor = url;
    const img = new Image();
    img.onload = () => { if (this.imgFor !== url) return; this.img = img; this.set({ loading: false }); };
    img.onerror = () => { if (this.imgFor !== url) return; this.set({ loading: false }); };
    img.src = url;
  }

  /** Draw the other map over the open one in a view (on top of everything the view draws), if a comparison is on for this map. */
  draw(ctx: CanvasRenderingContext2D, mapId: string, v: View, viewW: number, viewH: number) {
    const s = this.state, r = s.rect, img = this.img;
    if (!s.id || s.on !== mapId || !r || !img || s.mode === "side") return;
    const x = v.ox + r.x * v.scale, y = v.oy + r.y * v.scale, w = r.w * v.scale, h = r.h * v.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (s.mode === "fade") {
      ctx.globalAlpha = s.amount;
      ctx.drawImage(img, x, y, w, h);
    } else {
      const cut = Math.round(viewW * s.amount);
      ctx.beginPath(); ctx.rect(0, 0, cut, viewH); ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      ctx.save();
      // the line between them, with which map is on which side
      ctx.fillStyle = "rgba(255, 224, 120, 0.95)";
      ctx.fillRect(cut - 1, 0, 2, viewH);
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textBaseline = "top";
      // (at the foot of the line: the compare bar is at the top)
      const ty = Math.max(8, viewH - 34);
      const tag = (t: string, tx: number, right: boolean) => {
        const tw = ctx.measureText(t).width + 12, left = right ? tx + 6 : tx - 6 - tw;
        ctx.fillStyle = "rgba(15, 18, 28, 0.85)"; ctx.fillRect(left, ty, tw, 20);
        ctx.fillStyle = "#f1ead4"; ctx.fillText(t, left + 6, ty + 4);
      };
      tag(`◀ ${s.name}`, cut, false);
      tag("this map ▶", cut, true);
    }
    // the other map's outline, when it covers only part of this one (a detail map, a battlemap's spot)
    ctx.restore();
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 224, 120, 0.8)";
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}

export const compareCtl = new CompareController();
