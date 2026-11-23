/**
 * Object layers on a battlemap level: named groups of objects the DM makes ("Furniture", "Clutter", "After the fire"), listed bottom to top in
 * `features.layers`. An object belongs to one by `MapProp.layerId` (none: the bottom, unnamed "Objects" layer). The order decides which is drawn over which
 * (within objects under the walls, and within those over them); a hidden layer is drawn nowhere (not in the editor, an export or the player screen) and a locked
 * one can't be clicked or dragged. Layers change no object; removing one leaves its objects in the bottom layer.
 */
import type { Features, MapLayer, MapProp } from "./features.ts";

export type { MapLayer };

/** The objects in drawing order (bottom layer first; within a layer, in the order they were placed), without those of hidden layers. */
export function layeredProps(f: Pick<Features, "props" | "layers"> | undefined): MapProp[] {
  const props = f?.props ?? [], layers = f?.layers ?? [];
  if (!layers.length) return props;
  const rank = new Map(layers.map((l, i) => [l.id, i]));
  const hidden = new Set(layers.filter((l) => l.hidden).map((l) => l.id));
  return props
    .map((p, i) => ({ p, i, r: p.layerId !== undefined && rank.has(p.layerId) ? rank.get(p.layerId)! : -1 }))
    .filter((x) => !(x.p.layerId && hidden.has(x.p.layerId)))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

/** Can this object be clicked and moved (its layer is neither hidden nor locked)? */
export function propPickable(f: Pick<Features, "layers"> | undefined, p: MapProp): boolean {
  if (!p.layerId) return true;
  const l = f?.layers?.find((x) => x.id === p.layerId);
  return !l || (!l.hidden && !l.locked);
}

/** How many objects each layer holds ("" for the bottom one). */
export function layerCounts(f: Pick<Features, "props" | "layers"> | undefined): Map<string, number> {
  const known = new Set((f?.layers ?? []).map((l) => l.id)), out = new Map<string, number>();
  for (const p of f?.props ?? []) {
    const k = p.layerId && known.has(p.layerId) ? p.layerId : "";
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** The features without hidden layers' objects (what every picture, export and the player screen shows). */
export function withoutHiddenLayers<T extends Pick<Features, "props" | "layers">>(f: T): T {
  if (!f.layers?.some((l) => l.hidden)) return f;
  const hidden = new Set(f.layers.filter((l) => l.hidden).map((l) => l.id));
  return { ...f, props: (f.props ?? []).filter((p) => !(p.layerId && hidden.has(p.layerId))) };
}
