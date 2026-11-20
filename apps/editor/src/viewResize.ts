/**
 * What a map view does when its canvas changes size (a panel was shown or hidden, the window was resized). A view that still shows the whole map as it was fitted is fitted again, so the
 * map uses the room; any other view keeps the same point of the map in the middle of the canvas, so nothing jumps sideways.
 */
export interface ViewLike { scale: number; ox: number; oy: number }

export function makeResizeKeeper(getView: () => ViewLike, setView: (v: ViewLike) => void, refit: () => void) {
  let lastFit: ViewLike | null = null;
  let last: { w: number; h: number } | null = null;
  return {
    /** Call right after the view was fitted to the canvas. */
    fitted() { lastFit = { ...getView() }; },
    /** Call from the canvas's ResizeObserver with its new size. */
    resized(w: number, h: number) {
      const prev = last;
      last = { w, h };
      if (!prev || !w || !h || !prev.w || !prev.h || (prev.w === w && prev.h === h)) return;
      const v = getView();
      if (lastFit && v.scale === lastFit.scale && v.ox === lastFit.ox && v.oy === lastFit.oy) refit();
      else setView({ ...v, ox: v.ox + (w - prev.w) / 2, oy: v.oy + (h - prev.h) / 2 });
    },
  };
}
