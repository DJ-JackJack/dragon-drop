/**
 * The player screen's fog (in-person play): with `BattleSpec.fog` on, the player screen shows only what the DM has revealed on that level. A reveal is a polygon in
 * squares (`features.reveals`), applied in order: a reveal uncovers it, a `hide` covers it again. A click reveals what can be seen from a spot (walls and closed doors
 * block it, so inside a room that is the room), a drag an area. They are edits like any other: Undo takes one back, and they are saved with the level.
 */
import type { MapReveal, MapWall } from "./features.ts";
import { blockingSegments, visibilityFrom, visibilityPolygon } from "./lighting.ts";

type Pt = [number, number];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** What can be seen from (x, y) within `max` squares: the walls, closed doors and secret doors block the view; windows and open doors don't. */
export function revealFrom(walls: MapWall[] | undefined, x: number, y: number, max: number): Pt[] {
  const v = visibilityFrom(x, y, max, blockingSegments(walls));
  const pts = visibilityPolygon(v);
  // (points closer than a hundredth of a square to the last are dropped)
  const out: Pt[] = [];
  for (const [px, py] of pts) {
    const q: Pt = [r3(px), r3(py)], last = out[out.length - 1];
    if (!last || Math.abs(last[0] - q[0]) > 0.01 || Math.abs(last[1] - q[1]) > 0.01) out.push(q);
  }
  return out;
}

/** A rectangle's corners (squares). */
export const rectPoints = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** Is any of the map revealed (anything the players see with the fog on)? */
export const anyRevealed = (reveals: MapReveal[] | undefined) => !!reveals?.some((r) => !r.hide && r.points.length >= 3);

/** Is the point revealed (the reveals and hides applied in order)? */
export function isRevealed(reveals: MapReveal[] | undefined, x: number, y: number): boolean {
  let shown = false;
  for (const r of reveals ?? []) if (r.points.length >= 3 && inPolygon(r.points, x, y)) shown = !r.hide;
  return shown;
}

function inPolygon(p: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
