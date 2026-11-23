"use strict";
// What the Windows app opens for a place's link to the DM's own notes (the editor's NoteLink, core links.ts): a web page, an Obsidian or OneNote note, or a
// document, picture or folder on the PC. Checked here again before anything is opened, because a map file can come from someone else: never a program, a
// script, or an address of another kind. A test keeps these lists the same as core's.
const path = require("node:path");

const LINK_SCHEMES = ["http:", "https:", "obsidian:", "onenote:"];
const NOTE_FILE_TYPES = [".md", ".markdown", ".txt", ".pdf", ".doc", ".docx", ".odt", ".rtf", ".html", ".htm", ".epub", ".one", ".xlsx", ".xls", ".ods", ".csv", ".png", ".jpg", ".jpeg", ".webp"];

/** { kind: "url", url } or { kind: "file", file } when the link may be opened, else { why }. */
function checkLink(link) {
  if (typeof link !== "string") return { why: "There is no link." };
  const s = link.trim();
  if (!s || s.length > 2000 || /[\u0000-\u001f]/.test(s)) return { why: "That link can't be opened." };
  if (/^[a-zA-Z]:[\\/]/.test(s) || /^\\\\[^\\]/.test(s)) {
    const file = path.win32.normalize(s);
    const ext = path.win32.extname(file).toLowerCase();
    if (ext && !NOTE_FILE_TYPES.includes(ext)) return { why: `Dragon Drop opens notes and folders, not ${ext} files.` };
    return { kind: "file", file };
  }
  let u;
  try { u = new URL(s); } catch { return { why: "That isn't a web address or a file on this PC." }; }
  if (!LINK_SCHEMES.includes(u.protocol)) return { why: `Dragon Drop doesn't open ${u.protocol} addresses.` };
  return { kind: "url", url: u.href };
}

module.exports = { LINK_SCHEMES, NOTE_FILE_TYPES, checkLink };
