/**
 * The numbered notes of a battlemap (its "key"): drawn as small numbered markers in previews, and written out as a
 * Markdown list. They are the DM's own, so they never go into the exported picture.
 */
import { drawText, textWidth } from "./font.ts";
import type { MapDoc } from "./doc.ts";
import type { BattleSpec } from "./battle.ts";
import type { MapNote } from "./features.ts";

interface Img { w: number; h: number; data: Uint8ClampedArray }

/** The next free number for a new note. */
export function nextNoteNumber(notes: MapNote[] | undefined): number {
  return (notes ?? []).reduce((m, n) => Math.max(m, n.n), 0) + 1;
}

/** Notes in the order of the key (by number, then by position). */
export function sortedNotes(notes: MapNote[] | undefined): MapNote[] {
  return [...(notes ?? [])].sort((a, b) => a.n - b.n || a.y - b.y || a.x - b.x);
}

/** New numbers in reading order across the map (top to bottom in bands of 4 squares, left to right in a band). */
export function readingOrderNumbers(notes: MapNote[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  [...(notes ?? [])].sort((a, b) => Math.round(a.y / 4) - Math.round(b.y / 4) || a.x - b.x || a.y - b.y).forEach((n, i) => (out[n.id] = i + 1));
  return out;
}

/** Marker size in image px for a note number. */
export function noteBadge(px: number, n: number): { r: number; scale: number } {
  const scale = Math.max(1, Math.round(px / 32));
  const w = textWidth(String(n), scale), h = 7 * scale;
  return { r: Math.max(0.2 * px, Math.hypot(w, h) / 2 + 3), scale };
}

export function drawBattleNotes(img: Img, spec: BattleSpec, notes: MapNote[] | undefined): void {
  const px = spec.pxPerSquare;
  for (const note of sortedNotes(notes)) {
    const cx = note.x * px, cy = note.y * px, label = String(note.n), { r, scale } = noteBadge(px, note.n);
    const x0 = Math.max(0, Math.floor(cx - r - 2)), x1 = Math.min(img.w - 1, Math.ceil(cx + r + 2));
    const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(img.h - 1, Math.ceil(cy + r + 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r + 0.5) continue;
        const o = (y * img.w + x) * 4, edge = Math.min(1, r + 0.5 - d);
        const ring = d > r - Math.max(1.5, px * 0.04);
        const [cr, cg, cb] = ring ? [214, 178, 80] : [26, 23, 30], a = (ring ? 1 : 0.9) * edge;
        img.data[o] = img.data[o] * (1 - a) + cr * a;
        img.data[o + 1] = img.data[o + 1] * (1 - a) + cg * a;
        img.data[o + 2] = img.data[o + 2] * (1 - a) + cb * a;
      }
    }
    drawText(img as never, label, cx - textWidth(label, scale) / 2, cy - (7 * scale) / 2, [255, 236, 176], scale);
  }
}

/** The key as Markdown: "1. **Title**: text". */
export function battleKey(doc: MapDoc): string {
  const notes = sortedNotes(doc.features?.notes);
  const lines = [`# ${doc.meta.name}: key`, ""];
  if (!notes.length) lines.push("*No notes yet.*");
  for (const n of notes) {
    const where = `(${Math.round(n.x * 10) / 10}, ${Math.round(n.y * 10) / 10})`;
    lines.push(`${n.n}. **${n.title.trim() || "Untitled"}** ${where}${n.text?.trim() ? `\n\n   ${n.text.trim().replace(/\r?\n/g, "\n   ")}` : ""}`, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
