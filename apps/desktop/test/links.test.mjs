// The Windows app opens a place's link to the DM's notes only when it is a web or note address, or a document or folder (links.cjs); core's list is the same.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LINK_SCHEMES as CORE_SCHEMES, NOTE_FILE_TYPES as CORE_TYPES, linkProblem } from "../../../packages/core/src/links.ts";

const require = createRequire(import.meta.url);
const { LINK_SCHEMES, NOTE_FILE_TYPES, checkLink } = require("../links.cjs");

describe("note links", () => {
  it("open web pages, Obsidian and OneNote notes, documents and folders, and nothing else", () => {
    expect(checkLink("https://www.worldanvil.com/w/my-world/a/ashford")).toMatchObject({ kind: "url" });
    expect(checkLink("obsidian://open?vault=Campaign&file=Places%2FAshford")).toMatchObject({ kind: "url" });
    expect(checkLink("C:\\Users\\dm\\Notes\\Ashford.md")).toEqual({ kind: "file", file: "C:\\Users\\dm\\Notes\\Ashford.md" });
    expect(checkLink("D:\\Campaign\\Places")).toMatchObject({ kind: "file" });
    for (const bad of ["C:\\Windows\\System32\\calc.exe", "C:\\x\\run.bat", "C:\\x\\a.ps1", "C:\\x\\a.lnk", "file:///C:/x/a.md", "javascript:alert(1)", "ms-settings:", "smb://x/y", "", "Ashford.md"]) {
      expect(checkLink(bad).why, bad).toBeTruthy();
      expect(linkProblem(bad), bad).toBeTruthy();
    }
    expect(linkProblem("https://example.com/notes")).toBeNull();
    expect(linkProblem("C:\\Notes\\Ashford.pdf")).toBeNull();
  });

  it("keep the Windows app's lists the same as the editor's", () => {
    expect(LINK_SCHEMES).toEqual([...CORE_SCHEMES]);
    expect(NOTE_FILE_TYPES).toEqual([...CORE_TYPES]);
  });
});
