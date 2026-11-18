/**
 * Keyboard moves for the map views (world maps and battlemaps), kept free of the browser so the rules can be tested:
 *   + or =        zoom in            - or _      zoom out         (about the middle of the view)
 *   0 or Ctrl+0   fit the map to the window
 *   arrow keys    pan the view (Shift: three times as far)
 * These are the keys other map programs use (Azgaar's generator, Dungeon Scrawl and Foundry all zoom from the keyboard, and Wonderdraft
 * fits the map with Ctrl+0). Anything with Alt, or Ctrl/Cmd on a key other than 0, is left alone: those belong to the browser and the app.
 */

export interface ViewTransform {
  /** Screen pixels per map pixel. */
  scale: number;
  /** Where the map's top-left corner sits on screen. */
  ox: number;
  oy: number;
}

export type ViewKeyAction =
  | { kind: "zoom"; factor: number }
  | { kind: "fit" }
  | { kind: "pan"; dx: number; dy: number };

/** How much one key press zooms: a quarter more or less. */
export const KEY_ZOOM_STEP = 1.25;
/** How far an arrow key pans, in screen pixels. */
export const KEY_PAN_STEP = 80;

/** What a key press means for the view, or null if it isn't a view key. */
export function viewKeyAction(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): ViewKeyAction | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "0") return { kind: "fit" }; // 0 and Ctrl+0
  if (mod) return null;
  switch (e.key) {
    case "+": case "=": return { kind: "zoom", factor: KEY_ZOOM_STEP };
    case "-": case "_": return { kind: "zoom", factor: 1 / KEY_ZOOM_STEP };
    case "ArrowLeft": return { kind: "pan", dx: KEY_PAN_STEP * (e.shiftKey ? 3 : 1), dy: 0 };
    case "ArrowRight": return { kind: "pan", dx: -KEY_PAN_STEP * (e.shiftKey ? 3 : 1), dy: 0 };
    case "ArrowUp": return { kind: "pan", dx: 0, dy: KEY_PAN_STEP * (e.shiftKey ? 3 : 1) };
    case "ArrowDown": return { kind: "pan", dx: 0, dy: -KEY_PAN_STEP * (e.shiftKey ? 3 : 1) };
    default: return null;
  }
}

/**
 * Apply a zoom or a pan to a view. Zooming keeps whatever is in the middle of the window where it is; the scale stays within `limits`.
 * (A pan moves the map by `dx`, `dy` screen pixels: the arrow key for "right" moves the view right, so the map moves left.)
 */
export function applyViewKey(v: ViewTransform, a: Exclude<ViewKeyAction, { kind: "fit" }>, size: { w: number; h: number }, limits: { min: number; max: number }): ViewTransform {
  if (a.kind === "pan") return { scale: v.scale, ox: v.ox + a.dx, oy: v.oy + a.dy };
  const scale = Math.min(limits.max, Math.max(limits.min, v.scale * a.factor));
  const cx = size.w / 2, cy = size.h / 2;
  const k = scale / v.scale;
  return { scale, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k };
}
