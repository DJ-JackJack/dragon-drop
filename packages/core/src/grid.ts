/**
 * Grid overlay settings and geometry: a square or hex grid with a cell size in miles.
 * "Size" means the side of a square, or the distance across the flats of a hex (the
 * centre-to-centre distance between neighbouring hexes, the usual "6-mile hex").
 */
export type GridType = "off" | "square" | "hex";
export type HexOrient = "pointy" | "flat";

export interface MapGrid {
  type: GridType;
  /** Cell size in miles. */
  sizeMi: number;
  /** Hex grids: "pointy" (a point on top) or "flat" (a flat edge on top). Default pointy. */
  orient?: HexOrient;
  /** Line strength 0.1 to 1 (default 0.5). */
  opacity?: number;
}

export const MI_PER_KM = 0.621371;

/** Cell size in map pixels. */
export function gridCellPx(g: MapGrid, kmPerPx: number): number {
  return g.sizeMi / MI_PER_KM / kmPerPx;
}

/** A tidy default cell size (1, 2 or 5 x a power of ten, in miles) giving roughly 40 cells across the map. */
export function niceGridSize(mapWidthMi: number): number {
  const raw = Math.max(0.1, mapWidthMi / 40);
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / exp;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * exp;
}

/** Keep a size within sensible bounds for the map: at least 0.1 mi and at most half the map's width. */
export function clampGridSize(sizeMi: number, mapWidthMi: number): number {
  if (!Number.isFinite(sizeMi)) return niceGridSize(mapWidthMi);
  return Math.min(mapWidthMi / 2, Math.max(0.1, +sizeMi.toFixed(3)));
}

/** "Hex grid, 6 mi" (or in km on a metric map: "Hex grid, 9.66 km"). */
export function describeGrid(g: MapGrid | undefined, metric = false): string {
  if (!g || g.type === "off") return "Grid off";
  return `${g.type === "hex" ? "Hex" : "Square"} grid, ${metric ? `${+(g.sizeMi / MI_PER_KM).toFixed(2)} km` : `${+g.sizeMi.toFixed(2)} mi`}`;
}

/** The corners of one hex (map px), given its centre and the distance across the flats. */
export function hexCorners(cx: number, cy: number, sizePx: number, orient: HexOrient = "pointy"): [number, number][] {
  const R = sizePx / Math.sqrt(3);
  const start = orient === "pointy" ? 30 : 0;
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((start + 60 * k) * Math.PI) / 180;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)] as [number, number];
  });
}

/** Centre of hex column c, row r (map px), rows or columns alternately offset by half a cell. */
export function hexCentre(c: number, r: number, sizePx: number, orient: HexOrient = "pointy"): [number, number] {
  if (orient === "pointy") return [c * sizePx + (r & 1 ? sizePx / 2 : 0), r * sizePx * (Math.sqrt(3) / 2)];
  return [c * sizePx * (Math.sqrt(3) / 2), r * sizePx + (c & 1 ? sizePx / 2 : 0)];
}
