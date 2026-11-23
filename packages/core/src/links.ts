/**
 * A place's (or realm's) link to the DM's own notes: a web page (a wiki, World Anvil, LegendKeeper, a shared document), an Obsidian or OneNote note, or a file
 * or folder on the PC (a Markdown note, a PDF, a Word document). It is opened only when the DM clicks Open, and only what passes `linkProblem`: a map file can come
 * from someone else, so a link to a program, a script or an odd kind of address is refused. The Windows app checks the same again before opening anything.
 */

/** The address kinds that open in the person's own programs. */
export const LINK_SCHEMES = ["http:", "https:", "obsidian:", "onenote:"] as const;

/** File types a note link may open (documents and pictures, never programs or scripts). A folder may be linked too. */
export const NOTE_FILE_TYPES = [".md", ".markdown", ".txt", ".pdf", ".doc", ".docx", ".odt", ".rtf", ".html", ".htm", ".epub", ".one", ".xlsx", ".xls", ".ods", ".csv", ".png", ".jpg", ".jpeg", ".webp"] as const;

/** Is this a Windows or other absolute file path (C:\..., \\server\..., /...)? */
export const isFilePath = (s: string) => /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\[^\\]/.test(s) || s.startsWith("/");

/** Why a link can't be opened, or null when it may be. (A file path without a type is taken to be a folder.) */
export function linkProblem(link: string): string | null {
  const s = link.trim();
  if (!s) return "There is no link.";
  if (s.length > 2000) return "That link is too long.";
  if (/[\u0000-\u001f]/.test(s)) return "That link has characters a link can't have.";
  if (isFilePath(s)) {
    if (s.startsWith("/") && !/^\/[^/]/.test(s)) return "That isn't a file on this PC.";
    const name = s.split(/[\\/]/).pop() ?? "", dot = name.lastIndexOf(".");
    if (dot <= 0) return null; // (a folder)
    const type = name.slice(dot).toLowerCase();
    return (NOTE_FILE_TYPES as readonly string[]).includes(type) ? null : `Dragon Drop opens notes (${NOTE_FILE_TYPES.slice(0, 8).join(", ")} and the like) and folders, not ${type} files.`;
  }
  let u: URL;
  try { u = new URL(s); } catch { return "That isn't a web address or a file on this PC (paste the whole address, starting https://, or choose a file)."; }
  if (!(LINK_SCHEMES as readonly string[]).includes(u.protocol)) return `Dragon Drop opens web pages (https://), Obsidian and OneNote notes and files, not ${u.protocol} addresses.`;
  return null;
}

/** A short name for a link, for its button ("ashford.md", "worldanvil.com"). */
export function linkLabel(link: string): string {
  const s = link.trim();
  if (isFilePath(s)) return s.split(/[\\/]/).filter(Boolean).pop() ?? s;
  try {
    const u = new URL(s);
    if (u.protocol === "obsidian:") return decodeURIComponent(u.searchParams.get("file") ?? "Obsidian note").split("/").pop() ?? "Obsidian note";
    if (u.protocol === "onenote:") return "OneNote page";
    return u.hostname.replace(/^www\./, "") || s;
  } catch { return s; }
}
