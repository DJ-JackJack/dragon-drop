/**
 * The editor's own clipboard for copying places, objects, lights and the like (Ctrl+C, Ctrl+V). It holds copies of features, not text,
 * so it is kept here and not in the system clipboard. A world map's copies and a battlemap's copies are kept apart: pasting a place into a
 * battlemap, or an object onto a world map, does nothing. It survives switching between maps of the same kind, so something can be
 * copied from one battlemap into another.
 */
import { type FeatureClip, MAP_ITEMS_CLIPBOARD_TEXT, pasteChoice } from "@mapmaker/core";

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

/*
 * Ctrl+V on a map pastes either the copied map items or a picture from the system clipboard (it becomes a reference): whichever was
 * copied last (`pasteChoice` in core). So Ctrl+C on map items also writes a line of text to the system clipboard (through the browser's
 * own copy event, which needs no permission), and Ctrl+V lets the browser's paste event happen and decides there. The map views call
 * `itemsCopied` and `armItemsPaste` from their keys; App installs `onCopyEvent` and `onPasteEvent` once on the window.
 */
let copyPending = false;
let pastePending: { kind: ClipKind; run: () => void } | null = null;

const typingIn = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable || !!el.closest?.(".xterm"));
};

/** Ctrl+C just copied map items (the copy event that follows marks the system clipboard). */
export function itemsCopied() {
  copyPending = true;
  setTimeout(() => { copyPending = false; }, 0);
}

/**
 * Ctrl+V on a map: paste the copied items unless the paste event that follows finds a newer picture. If no paste event comes (the
 * browser didn't send one), the items are pasted anyway, a moment later.
 */
export function armItemsPaste(kind: ClipKind, run: () => void) {
  if (!getClip(kind)) return;
  const mine = { kind, run };
  pastePending = mine;
  setTimeout(() => { if (pastePending === mine) { pastePending = null; run(); } }, 0);
}

/*
 * With nothing selected on the page and no text box focused, Chromium only runs Copy and Paste from the keyboard (and so only sends the
 * copy and paste events) when the page cancels "beforecopy" / "beforepaste" first: that is how a page says it handles them itself.
 */
export function onBeforeCopy(e: Event) {
  if (copyPending && !typingIn(e.target)) e.preventDefault();
}
export function onBeforePaste(e: Event) {
  if (!typingIn(e.target)) e.preventDefault();
}

export function onCopyEvent(e: ClipboardEvent) {
  if (!copyPending || typingIn(e.target) || !e.clipboardData) return;
  copyPending = false;
  e.clipboardData.setData("text/plain", MAP_ITEMS_CLIPBOARD_TEXT);
  e.preventDefault();
}

export function onPasteEvent(e: ClipboardEvent, addPictures: (files: File[]) => void) {
  if (typingIn(e.target)) return; // (text boxes and the terminal paste as they always do)
  const pending = pastePending;
  pastePending = null;
  const files = [...(e.clipboardData?.files ?? [])];
  const choice = pasteChoice({ files: files.length, text: e.clipboardData?.getData("text/plain") ?? "", haveItems: !!pending });
  if (choice === "items") { e.preventDefault(); pending!.run(); }
  else if (choice === "pictures") { e.preventDefault(); addPictures(files); }
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
