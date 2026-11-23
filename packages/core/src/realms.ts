/**
 * Realms: the political layer of a world map. Kingdoms, provinces and other territories the DM names, each a colour, painted onto the map with a brush
 * (the Realm tool) rather than drawn as outlines, so neighbours share their border exactly and a realm can stop at the coast by itself.
 *
 * The painting is a grid over the map (`features.realmCells`, a few map px a cell, at most about 512 cells a side), each cell holding the number of the
 * realm it belongs to (`MapRealm.n`, 1..255; 0 is nobody's), run-length coded row by row. Names are the DM's canon: only names the DM gave.
 */
import type { MapDoc } from "./doc.ts";
import type { MapRealm, RealmGrid } from "./features.ts";

export type { MapRealm, RealmGrid };

/** Colours for new realms, in the order they are offered (muted, like an atlas). */
export const REALM_COLOURS = ["#c0504d", "#4f81bd", "#9bbb59", "#8064a2", "#f79646", "#4bacc6", "#c9a227", "#a05a8c", "#5f8f6e", "#b5654a", "#6b7fb3", "#8a8a4a"];

/** The most cells a side the grid has (a 2048-px map: 4 px a cell). */
export const REALM_GRID_MAX = 512;

/** A new, empty grid for a map of this size. */
export function emptyRealmGrid(mapW: number, mapH: number): RealmGrid {
  const scale = Math.max(1, Math.ceil(Math.max(mapW, mapH) / REALM_GRID_MAX));
  const w = Math.ceil(mapW / scale), h = Math.ceil(mapH / scale);
  return { w, h, scale, cells: [0, w * h] };
}

/** The grid's cells (realm numbers), w x h, row by row. */
export function decodeRealmCells(g: RealmGrid): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  let at = 0;
  for (let i = 0; i + 1 < g.cells.length && at < out.length; i += 2) {
    const v = g.cells[i], n = Math.min(g.cells[i + 1], out.length - at);
    if (v) out.fill(v, at, at + n);
    at += n;
  }
  return out;
}

/** The grid with these cells. */
export function encodeRealmCells(g: Pick<RealmGrid, "w" | "h" | "scale">, cells: Uint8Array): RealmGrid {
  const out: number[] = [];
  for (let i = 0; i < cells.length;) {
    const v = cells[i];
    let n = 1;
    while (i + n < cells.length && cells[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return { w: g.w, h: g.h, scale: g.scale, cells: out };
}

/** The grid for this map: its own, or an empty one when it has none (or one made for another size). */
export function realmGridOf(doc: Pick<MapDoc, "meta" | "features">): RealmGrid {
  const g = doc.features?.realmCells, e = emptyRealmGrid(doc.meta.width, doc.meta.height);
  return g && g.w === e.w && g.h === e.h && g.scale === e.scale ? g : e;
}

export interface RealmPaint {
  /** The realm's number, or 0 to clear (erase). */
  n: number;
  /** A round brush: centre and radius, map px. Or an outline (map px). */
  circle?: { x: number; y: number; r: number };
  polygon?: [number, number][];
  /** Only land: cells whose middle is below the sea stay as they are. */
  landOnly?: { heights: ArrayLike<number>; w: number; h: number; seaLevel: number };
  /** Paint only cells that belong to nobody (or, erasing, only this realm's: `only`). */
  onlyEmpty?: boolean;
  only?: number;
}

/** Paint into the cells (in place); returns how many changed. */
export function paintRealmCells(cells: Uint8Array, g: Pick<RealmGrid, "w" | "h" | "scale">, p: RealmPaint): number {
  const { w, h, scale } = g;
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  let inside: (x: number, y: number) => boolean;
  if (p.circle) {
    const { x, y, r } = p.circle;
    x0 = Math.floor((x - r) / scale); x1 = Math.ceil((x + r) / scale); y0 = Math.floor((y - r) / scale); y1 = Math.ceil((y + r) / scale);
    inside = (px, py) => (px - x) ** 2 + (py - y) ** 2 <= r * r;
  } else if (p.polygon && p.polygon.length >= 3) {
    const poly = p.polygon;
    x0 = Math.floor(Math.min(...poly.map((q) => q[0])) / scale); x1 = Math.ceil(Math.max(...poly.map((q) => q[0])) / scale);
    y0 = Math.floor(Math.min(...poly.map((q) => q[1])) / scale); y1 = Math.ceil(Math.max(...poly.map((q) => q[1])) / scale);
    inside = (px, py) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
  } else return 0;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(h - 1, y1);
  const land = p.landOnly;
  let changed = 0;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const px = (cx + 0.5) * scale, py = (cy + 0.5) * scale;
    if (!inside(px, py)) continue;
    const k = cy * w + cx, was = cells[k];
    if (was === p.n) continue;
    if (p.onlyEmpty && p.n && was) continue;
    if (p.only !== undefined && was !== p.only) continue;
    if (land && p.n) {
      const hx = Math.min(land.w - 1, Math.floor(px)), hy = Math.min(land.h - 1, Math.floor(py));
      if (land.heights[hy * land.w + hx] <= land.seaLevel) continue;
    }
    cells[k] = p.n;
    changed++;
  }
  return changed;
}

/** Each realm's size: cells, and square kilometres (map px are kmPerPx a side). */
export function realmAreas(g: RealmGrid, kmPerPx: number): Map<number, { cells: number; km2: number }> {
  const out = new Map<number, { cells: number; km2: number }>();
  const cellKm2 = (g.scale * kmPerPx) ** 2;
  for (let i = 0; i + 1 < g.cells.length; i += 2) {
    const v = g.cells[i];
    if (!v) continue;
    const a = out.get(v) ?? { cells: 0, km2: 0 };
    a.cells += g.cells[i + 1];
    a.km2 = a.cells * cellKm2;
    out.set(v, a);
  }
  return out;
}

/** The next free realm number (1..255), or null when every one is used. */
export function nextRealmNumber(realms: readonly MapRealm[] | undefined): number | null {
  const used = new Set((realms ?? []).map((r) => r.n));
  for (let n = 1; n <= 255; n++) if (!used.has(n)) return n;
  return null;
}

/** Where a realm's name goes: the cell of it furthest from its edge (map px), and how wide the realm is there (map px); null when it has no cells. */
export function realmNameSpot(cells: Uint8Array, g: Pick<RealmGrid, "w" | "h" | "scale">, n: number): { x: number; y: number; reach: number } | null {
  const { w, h } = g, N = w * h;
  // a distance transform (city blocks, two passes) of the realm's cells to the nearest cell that isn't the realm's
  const d = new Uint16Array(N);
  let any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (cells[k] !== n) { d[k] = 0; continue; }
    any = true;
    const up = y > 0 ? d[k - w] : 0, left = x > 0 ? d[k - 1] : 0;
    d[k] = Math.min(up, left) + 1;
  }
  if (!any) return null;
  let best = -1, bd = 0;
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const k = y * w + x;
    if (!d[k]) continue;
    const down = y < h - 1 ? d[k + w] : 0, right = x < w - 1 ? d[k + 1] : 0;
    d[k] = Math.min(d[k], down + 1, right + 1);
    if (d[k] > bd) { bd = d[k]; best = k; }
  }
  const bx = best % w, by = (best - bx) / w;
  return { x: (bx + 0.5) * g.scale, y: (by + 0.5) * g.scale, reach: bd * g.scale };
}

/** Is the colour a "#rrggbb"? */
export const isRealmColour = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
