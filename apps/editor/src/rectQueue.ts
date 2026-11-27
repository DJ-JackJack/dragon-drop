/**
 * Areas waiting to be painted (docs/BRUSH-SPEED.md, stage 1): a brush stroke sends a patch for every dab, each overlapping the last by about two thirds, and
 * painting each as it came painted every pixel of a stroke 3 to 7 times while the painting fell further and further behind. The paint worker now keeps
 * the waiting areas here and paints them once it has read every message waiting for it. Each waiting box remembers about how much of it its patches
 * cover; a new patch joins a box only while the box round both stays close to what they cover, so a straight stroke becomes one box and a long
 * diagonal one a chain of small ones, never one huge box round it.
 */
import type { Rect } from "@mapmaker/core";

/** A box waiting to be painted, and about how many of its pixels its patches cover. */
export interface Waiting { r: Rect; cover: number }

const area = (r: Rect) => r.w * r.h;
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The waiting boxes with `r` added: joined with a box while the box round both is at most `slack` times what they cover, again as long as it grows. */
export function addRect(waiting: Waiting[], r: Rect, slack = 1.3): Waiting[] {
  const out = waiting.slice();
  let cur: Waiting = { r, cover: area(r) };
  for (let joined = true; joined;) {
    joined = false;
    for (let i = 0; i < out.length; i++) {
      const u = union(out[i].r, cur.r), cover = out[i].cover + cur.cover - overlap(out[i].r, cur.r);
      if (area(u) <= cover * slack) { cur = { r: u, cover: Math.min(area(u), cover) }; out.splice(i, 1); joined = true; break; }
    }
  }
  out.push(cur);
  return out;
}
