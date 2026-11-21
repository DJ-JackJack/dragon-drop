/**
 * "Show me this": the Objects list asks the open map view to bring a box (in the map's own units: squares on a battlemap, metres on a city) into view. The view moves to
 * centre it, zooming out only as far as it must to fit it and in no further than a close look.
 */
export interface FocusBox { x0: number; y0: number; x1: number; y1: number }

let listener: ((b: FocusBox) => void) | null = null;

export const focusBus = {
  /** The view that answers (one at a time: the map on screen). */
  listen(cb: (b: FocusBox) => void) {
    listener = cb;
    return () => { if (listener === cb) listener = null; };
  },
  show(b: FocusBox) { listener?.(b); },
};

/**
 * The view that shows a box: centred, at the current zoom if the box fits in the middle 60% of the window, else zoomed out until it does; and zoomed in to `closeScale` at
 * most when the box is tiny (a light, a tree), unless the view is already closer.
 */
export function viewForBox(v: { scale: number; ox: number; oy: number }, b: FocusBox, W: number, H: number, closeScale: number, minScale: number): { scale: number; ox: number; oy: number } {
  const bw = Math.max(1e-6, b.x1 - b.x0), bh = Math.max(1e-6, b.y1 - b.y0);
  const fits = Math.min((W * 0.6) / bw, (H * 0.6) / bh);
  let scale = v.scale;
  if (scale > fits) scale = Math.max(minScale, fits);
  else if (scale < Math.min(closeScale, fits)) scale = Math.min(closeScale, fits);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { scale, ox: W / 2 - cx * scale, oy: H / 2 - cy * scale };
}
