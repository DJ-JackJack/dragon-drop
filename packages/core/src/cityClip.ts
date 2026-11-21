/**
 * Copying and pasting on a city map (Ctrl+C, Ctrl+V, Ctrl+D): buildings, streets, walls, trees, landforms and labels, moved as one group with new ids. A pasted building,
 * street or wall loses its name (a row of houses copied from beside the Green Dragon is not the Green Dragon again); a label is a name by itself, so it keeps its text,
 * as labels do on the other maps (featureOps.ts).
 */
import type { CitySpec } from "./city.ts";
import { type Features, type FeaturesPatch, type MapBuilding, type MapCityWall, type MapLabel, type MapLandform, type MapStreet, type MapTrees, newFeatureId } from "./features.ts";

type Pt = [number, number];

export interface CityClip {
  buildings: MapBuilding[];
  streets: MapStreet[];
  walls: MapCityWall[];
  trees: MapTrees[];
  land: MapLandform[];
  labels: MapLabel[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A copy of the listed things of a city, or null if none of them is there. */
export function copyCity(f: Features, ids: readonly string[]): CityClip | null {
  const want = new Set(ids), pick = <T extends { id: string }>(a: readonly T[] | undefined) => clone((a ?? []).filter((x) => want.has(x.id)));
  const c: CityClip = { buildings: pick(f.buildings), streets: pick(f.streets), walls: pick(f.cityWalls), trees: pick(f.trees), land: pick(f.land), labels: pick(f.labels) };
  return c.buildings.length + c.streets.length + c.walls.length + c.trees.length + c.land.length + c.labels.length ? c : null;
}

/** The box round everything in a clip (metres; a hill counts by its top, a label by its middle). */
export function cityClipBounds(c: CityClip): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Pt[] = [...c.buildings, ...c.streets, ...c.walls, ...c.trees, ...c.land].flatMap((x) => x.points as Pt[]).concat(c.labels.map((l) => [l.x, l.y] as Pt));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The clip moved by (dx, dy) metres (held inside the city when its size is given), with new ids: the patch that adds it, and the ids to select. */
export function pasteCity(c: CityClip, dx: number, dy: number, spec?: Pick<CitySpec, "widthM" | "heightM">): { patch: FeaturesPatch; ids: string[]; dx: number; dy: number } {
  if (spec) {
    const b = cityClipBounds(c);
    dx = Math.max(-b.x0, Math.min(spec.widthM - b.x1, dx));
    dy = Math.max(-b.y0, Math.min(spec.heightM - b.y1, dy));
  }
  const ids: string[] = [];
  const fresh = (prefix: Parameters<typeof newFeatureId>[0]) => { const id = newFeatureId(prefix); ids.push(id); return id; };
  const sh = (pts: readonly (readonly number[])[]) => pts.map(([x, y]) => [r2(x + dx), r2(y + dy)] as Pt);
  const unnamed = <T extends { name?: string }>(x: T): T => { const { name: _n, ...rest } = x; return rest as T; };
  const patch: FeaturesPatch = {};
  if (c.buildings.length) patch.upsertBuildings = c.buildings.map((b) => ({ ...unnamed(b), id: fresh("b"), points: sh(b.points) }));
  if (c.streets.length) patch.upsertStreets = c.streets.map((s) => ({ ...unnamed(s), id: fresh("t"), points: sh(s.points) }));
  if (c.walls.length) patch.upsertCityWalls = c.walls.map((w) => ({ ...unnamed(w), id: fresh("w"), points: sh(w.points) }));
  if (c.trees.length) patch.upsertTrees = c.trees.map((t) => ({ ...t, id: fresh("v"), points: sh(t.points) }));
  if (c.land.length) patch.upsertLand = c.land.map((l) => ({ ...l, id: fresh("h"), points: sh(l.points) }));
  if (c.labels.length) patch.upsertLabels = c.labels.map((l) => ({ ...l, id: fresh("l"), x: r2(l.x + dx), y: r2(l.y + dy), ...(l.path && { path: sh(l.path) }) }));
  return { patch, ids, dx, dy };
}
