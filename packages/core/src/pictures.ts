/**
 * Adding reference pictures (the References panel's Add picture button, a picture dropped or pasted anywhere in the editor, the chat's
 * attachments): what a file is from its first bytes, whether Dragon Drop can use it, and what to tell the person when it can't. The
 * editor checks before it sends a picture and the server checks again before it keeps one, with these same rules.
 */
import { oneLine } from "./assist.ts";

/** What a file is, from its first bytes. Only png, jpeg and webp can be used as references (see REFERENCE_PICTURE_TYPES). */
export type PictureKind = "png" | "jpeg" | "webp" | "webp-animated" | "gif" | "bmp" | "tiff" | "heic" | "avif" | "svg" | "pdf";
/** The kinds a reference picture can be. */
export type ReferenceKind = "png" | "jpeg" | "webp";
export const REFERENCE_KIND_TYPE: Record<ReferenceKind, "image/png" | "image/jpeg" | "image/webp"> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
/** How many bytes of a file `pictureKind` needs. */
export const PICTURE_HEAD_BYTES = 64;
/** The largest reference picture Dragon Drop keeps (the same as the chat's attachments). */
export const REFERENCE_PICTURE_MAX_BYTES = 30 * 1024 * 1024;

export function isReferenceKind(k: PictureKind | null): k is ReferenceKind {
  return k === "png" || k === "jpeg" || k === "webp";
}

export function pictureKind(b: Uint8Array): PictureKind | null {
  const bytes = (i: number, ...s: number[]) => s.every((c, j) => b[i + j] === c);
  const text = (i: number, s: string) => [...s].every((c, j) => b[i + j] === c.charCodeAt(0));
  if (bytes(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (bytes(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (text(0, "RIFF") && text(8, "WEBP")) return text(12, "VP8X") && (b[20] & 0x02) !== 0 ? "webp-animated" : "webp"; // (an extended WebP says in its flags whether it is animated)
  if (text(0, "GIF8")) return "gif";
  if (text(0, "BM") && b.length >= 26) return "bmp";
  if (bytes(0, 0x49, 0x49, 0x2a, 0x00) || bytes(0, 0x4d, 0x4d, 0x00, 0x2a)) return "tiff";
  if (text(4, "ftyp")) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "avif" || brand === "avis") return "avif";
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
  }
  if (text(0, "%PDF")) return "pdf";
  const start = new TextDecoder().decode(b.subarray(0, PICTURE_HEAD_BYTES)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (start.startsWith("<svg") || (start.startsWith("<?xml") && start.includes("svg"))) return "svg";
  return null;
}

const SAVE_AS = "Save it as PNG or JPEG first (most picture programs can: Save as, or Export)";

/** Null when the picture can be used; otherwise one or two sentences for the person, naming the file and saying what to do. */
export function referencePictureProblem(name: string, kind: PictureKind | null, bytes: number): string | null {
  const n = `"${oneLine(name || "The picture", 60)}"`;
  if (bytes === 0) return `${n} is empty.`;
  if (bytes > REFERENCE_PICTURE_MAX_BYTES) return `${n} is ${(bytes / 1048576).toFixed(0)} MB, and a picture can be at most ${REFERENCE_PICTURE_MAX_BYTES / 1048576} MB. Save a smaller copy, as JPEG, first.`;
  switch (kind) {
    case "png": case "jpeg": case "webp": return null;
    case "webp-animated": return `${n} is an animated WebP. Only still pictures can be used: save one frame of it as PNG or JPEG.`;
    case "heic": return `${n} is an iPhone photo (HEIC), which Dragon Drop can't read. ${SAVE_AS}. On an iPhone, Settings > Camera > Formats > Most Compatible takes JPEG photos.`;
    case "avif": return `${n} is an AVIF picture, which Dragon Drop can't read. ${SAVE_AS}.`;
    case "gif": return `${n} is a GIF, which Dragon Drop can't read. ${SAVE_AS}.`;
    case "bmp": return `${n} is a BMP picture, which Dragon Drop can't read. ${SAVE_AS}.`;
    case "tiff": return `${n} is a TIFF picture, which Dragon Drop can't read. ${SAVE_AS}.`;
    case "svg": return `${n} is a drawing (SVG), not a picture. Export it as PNG first.`;
    case "pdf": return `${n} is a PDF. Export the page as PNG, or take a screenshot of it.`;
    default: return `${n} isn't a picture Dragon Drop can use: only PNG, JPEG and WebP pictures can be added.`;
  }
}

/**
 * What Ctrl+V on a map pastes: a picture from the system clipboard (it becomes a reference) or the map items copied with Ctrl+C.
 * Copying map items also puts MAP_ITEMS_CLIPBOARD_TEXT on the system clipboard, so whichever was copied last wins: a picture copied
 * after the map items replaces that text, and copying map items again replaces the picture.
 */
export const MAP_ITEMS_CLIPBOARD_TEXT = "Dragon Drop map items (paste them onto a map with Ctrl+V)";
export function pasteChoice(o: { files: number; text: string; haveItems: boolean }): "items" | "pictures" | "nothing" {
  if (o.haveItems && o.text === MAP_ITEMS_CLIPBOARD_TEXT) return "items";
  if (o.files > 0) return "pictures";
  return o.haveItems ? "items" : "nothing";
}
