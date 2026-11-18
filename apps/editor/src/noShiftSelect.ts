/**
 * Shift and a mouse press extends the browser's text selection from wherever you last clicked, which highlights half the page and takes a
 * Shift-click or Shift-drag away from the map. Stop that for Shift-presses on a map (an ordinary press is left alone, so clicking the map
 * still takes the focus out of a text box), and take the focus out of any text box by hand so the keys work afterwards.
 */
import type { MouseEvent } from "react";

export function noShiftTextSelect(e: MouseEvent) {
  if (!e.shiftKey) return;
  e.preventDefault();
  const a = document.activeElement;
  if (a instanceof HTMLElement) a.blur();
}
