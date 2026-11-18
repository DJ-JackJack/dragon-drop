import type { MapMeta } from "@mapmaker/core";

/**
 * Does a change of map settings change the painted picture? Names, notes, the grid, the title and scale bar (all drawn
 * on top by the canvas), and a battlemap's light level and grid type don't: repainting the whole map for them would
 * freeze the editor for seconds, so the editor only redraws.
 */
export function repaintNeeded(prev: MapMeta | null, next: MapMeta): boolean {
  if (!prev || prev.id !== next.id) return true;
  return paintKey(prev) !== paintKey(next);
}

function paintKey(m: MapMeta): string {
  const { name: _n, notes: _o, grid: _g, furniture: _f, updatedAt: _u, battle, ...rest } = m;
  const b = battle ? { ...battle, ambient: undefined, ambientTint: undefined, gridType: undefined } : undefined;
  return JSON.stringify({ ...rest, battle: b });
}
