/** Map extras ("furniture"): title, scale bar, compass rose and frame. Drawn over the map; not part of the terrain. */
import { MI_PER_KM } from "./grid.ts";

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface MapFurniture {
  /** A title shown in a banner (empty or missing: none). */
  title?: string;
  titlePos?: "top" | "bottom";
  scaleBar?: boolean;
  scaleCorner?: Corner;
  /** Scale bar units (default miles). */
  units?: "miles" | "km";
  compass?: boolean;
  compassCorner?: Corner;
  frame?: boolean;
}

export const DEFAULT_FURNITURE: Required<Pick<MapFurniture, "titlePos" | "scaleCorner" | "units" | "compassCorner">> = {
  titlePos: "top", scaleCorner: "bottom-left", units: "miles", compassCorner: "top-right",
};

export function hasFurniture(f: MapFurniture | undefined): boolean {
  return !!f && (!!f.title?.trim() || !!f.scaleBar || !!f.compass || !!f.frame);
}

/** 1, 2 or 5 x a power of ten, no larger than max (for a tidy scale bar). */
export function niceLength(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const m = max / exp;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * exp;
}

/** The scale bar for a map: its length in the chosen unit, and in map pixels. Aims for about 16% of the map's width. */
export function scaleBarFor(mapWidthPx: number, kmPerPx: number, units: "miles" | "km" = "miles") {
  const perPx = units === "miles" ? kmPerPx * MI_PER_KM : kmPerPx; // units per map px
  const value = niceLength(0.16 * mapWidthPx * perPx);
  return { value, unit: units === "miles" ? "mi" : "km", px: value / perPx };
}

export function describeFurniture(f: MapFurniture | undefined): string {
  if (!hasFurniture(f)) return "Map extras off";
  const parts = [f!.title?.trim() && "title", f!.scaleBar && "scale bar", f!.compass && "compass", f!.frame && "frame"].filter(Boolean);
  return `Map extras: ${parts.join(", ")}`;
}
