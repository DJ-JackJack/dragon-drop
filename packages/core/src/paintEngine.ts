/**
 * Everything a paint worker needs to keep a picture of the map up to date, with no worker or browser APIs in it (so it can be tested).
 *
 * The engine holds its own copy of the heights, the climate layers and the texture noise. The editor's main thread only sends it changes
 * (a brush patch, new climate layers, a request) and draws the pixels it gets back: painting, which can take over a second for the whole map,
 * never touches the main thread.
 *
 *  - tile(rect): the pixels of a small area (a brush stroke, or what a climate update changed), at once.
 *  - slices(): a whole-map repaint as bands of rows. The blurred fields are worked out once for the whole map and every band is painted from
 *    them, which makes the result exactly the one-shot render (and a lot cheaper than blurring each band with its own margin).
 *  - Until the painted style is ready (its noise and climate layers), slices() gives a quick blocky relief preview.
 */
import type { Derived } from "./climate.ts";
import { type DerivedChange, derivedChange } from "./derivedDiff.ts";
import { HeightField, type MapDoc, type MapMeta } from "./doc.ts";
import { type Rect, clipRect } from "./geom.ts";
import type { NoiseCache } from "./noisecache.ts";
import { paintPrep, renderPainted } from "./painted.ts";
import { renderPlaceholder } from "./placeholder.ts";
import { renderInto } from "./render.ts";
import { type InkSymbol, inkMargin, inkSymbols, renderInk } from "./inkStyle.ts";

export interface PaintView {
  /** The style the user chose. "painted" falls back to a preview until the noise and climate layers are here. */
  mode: "painted" | "relief" | "ink";
  meta: MapMeta;
  /** Relief style only. */
  hillshade: boolean;
  /** Painted style: paint the rivers into the map (default true; the Rivers layer switch). */
  rivers?: boolean;
}

/** The RGBA pixels of a rectangle of the map (rect.w * rect.h * 4 bytes, rows packed). */
export interface Pixels {
  rect: Rect;
  data: Uint8ClampedArray;
}

/** A changed area bigger than this (map px) is repainted as a whole-map pass, so one big synchronous tile can't hold up other requests. */
export const TILE_AREA_LIMIT = 250_000;

export class PaintEngine {
  readonly heights: HeightField;
  noise: NoiseCache | null = null;
  derived: Derived | null = null;
  /** Full-size RGBA the painters write into (they index it by map position); rows are copied out of it. */
  private scratch: Uint8ClampedArray;
  /** The ink style's symbols, worked out again when the land or the climate changes. */
  private ink: InkSymbol[] | null = null;

  constructor(readonly W: number, readonly H: number, heights: Float32Array) {
    this.heights = new HeightField(W, H, heights);
    this.scratch = new Uint8ClampedArray(W * H * 4);
  }

  setNoise(n: NoiseCache) {
    if (n.W !== this.W || n.H !== this.H) throw new Error("That noise is for another map size.");
    this.noise = n;
  }

  /** Take new climate layers; says which part of the picture they change ("all" the first time, "none" if nothing a pixel shows changed). */
  setDerived(d: Derived): DerivedChange {
    if (d.W !== this.W || d.H !== this.H) throw new Error("Those climate layers are for another map size.");
    const prev = this.derived;
    this.derived = d;
    this.ink = null;
    return prev ? derivedChange(prev, d) : "all";
  }

  patch(rect: Rect, data: Float32Array) {
    this.heights.pasteRect(rect, data);
    this.ink = null;
  }

  /** Is the painted style possible yet? */
  paintedReady(): boolean {
    return !!this.noise && !!this.derived;
  }

  private doc(view: PaintView): MapDoc {
    return { meta: view.meta, height: this.heights };
  }

  private take(rect: Rect): Pixels {
    const { W } = this, s = this.scratch, out = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      const from = ((rect.y + y) * W + rect.x) * 4;
      out.set(s.subarray(from, from + rect.w * 4), y * rect.w * 4);
    }
    return { rect, data: out };
  }

  /** Draw a rect of the map in the current style (the plain relief while the painted style isn't ready). */
  private draw(rect: Rect, view: PaintView, prep?: ReturnType<typeof paintPrep>) {
    const doc = this.doc(view);
    if (view.mode === "ink" && this.derived) renderInk(doc, this.derived, rect, this.scratch, (this.ink ??= inkSymbols(doc, this.derived)), { rivers: view.rivers !== false });
    else if (view.mode === "painted" && this.noise && this.derived) renderPainted(doc, this.derived, this.noise, rect, this.scratch, prep, { rivers: view.rivers !== false });
    else renderInto(doc, rect, this.scratch, { hillshade: view.mode === "relief" ? view.hillshade : true });
  }

  /** The pixels of one area. */
  tile(rect: Rect, view: PaintView): Pixels | null {
    // (in the ink style a symbol reaches past its spot: an area is drawn again with a margin, so a changed symbol leaves nothing behind)
    const m = view.mode === "ink" ? inkMargin(this.W, this.H) : 0;
    const r = clipRect({ x: rect.x - m, y: rect.y - m, w: rect.w + 2 * m, h: rect.h + 2 * m }, this.W, this.H);
    if (!r) return null;
    this.draw(r, view);
    return this.take(r);
  }

  /** A whole-map repaint, band by band. Work is done as the bands are asked for, so the caller can stop (or interleave other work). */
  *slices(view: PaintView, band = 128): Generator<Pixels> {
    const { W, H } = this;
    const bands = function* () { for (let y = 0; y < H; y += band) yield { x: 0, y, w: W, h: Math.min(band, H - y) }; };
    if ((view.mode === "painted" && !this.paintedReady()) || (view.mode === "ink" && !this.derived)) {
      renderPlaceholder(this.doc(view), this.scratch);
      for (const r of bands()) yield this.take(r);
      return;
    }
    const prep = view.mode === "painted" ? paintPrep(this.doc(view), this.noise!, { x: 0, y: 0, w: W, h: H }) : undefined;
    for (const r of bands()) {
      this.draw(r, view, prep);
      yield this.take(r);
    }
  }
}
