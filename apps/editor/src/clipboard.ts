/**
 * The editor's own clipboard for copying places, objects, lights and the like (Ctrl+C, Ctrl+V). It holds copies of features, not text,
 * so it is kept here and not in the system clipboard. A world map's copies and a battlemap's copies are kept apart: pasting a place into a
 * battlemap, or an object onto a world map, does nothing. It survives switching between maps of the same kind, so something can be
 * copied from one battlemap into another.
 */
import type { FeatureClip } from "@mapmaker/core";

export type ClipKind = "world" | "battle";

let held: { kind: ClipKind; clip: FeatureClip } | null = null;
let last: { kind: ClipKind; reqDx: number; reqDy: number; usedDx: number; usedDy: number } | null = null;

export function setClip(kind: ClipKind, clip: FeatureClip) {
  held = { kind, clip };
  last = null;
}

/** What was copied, if it is of this kind of map. */
export function getClip(kind: ClipKind): FeatureClip | null {
  return held && held.kind === kind ? held.clip : null;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * If a paste would land exactly where the last one did (the pointer hasn't moved), move it over by `step` each time, so copies never
 * hide each other.
 */
export function unstack(kind: ClipKind, dx: number, dy: number, step: number): { dx: number; dy: number } {
  const again = !!last && last.kind === kind && near(last.reqDx, dx) && near(last.reqDy, dy);
  const used = again ? { dx: last!.usedDx + step, dy: last!.usedDy + step } : { dx, dy };
  last = { kind, reqDx: dx, reqDy: dy, usedDx: used.dx, usedDy: used.dy };
  return used;
}
