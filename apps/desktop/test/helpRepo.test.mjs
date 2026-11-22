// The public help repository's files (scripts/help-repo.mjs, docs/GOING-PRIVATE.md): only buyer pages, and no link left into the code
// repository, which will be private.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_REPO, PAGES, buyerSetupGuide, makeHelpRepo, rewriteLinks } from "../../../scripts/help-repo.mjs";

const REPO = "https://github.com/example/dragon-drop-help";
const STORE = "https://example.itch.io/dragon-drop";

function allFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? allFiles(path.join(dir, d.name), base) : [path.relative(base, path.join(dir, d.name))]));
}

describe("the help repository", () => {
  it("holds the buyer pages and issue forms, and no link into the code repository", () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), "dd-help-")), "help");
    makeHelpRepo({ out, repo: REPO, store: STORE });
    const files = allFiles(out).map((f) => f.replace(/\\/g, "/")).sort();
    expect(files).toEqual([".github/ISSUE_TEMPLATE/config.yml", ".github/ISSUE_TEMPLATE/problem.yml", ".github/ISSUE_TEMPLATE/question.yml", "README.md", ...PAGES.map(([, n]) => n)].sort());
    for (const f of files) {
      const text = readFileSync(path.join(out, f), "utf8");
      expect(text.includes(`${CODE_REPO}/`) || text.includes(`${CODE_REPO}.git`) || new RegExp(`${CODE_REPO}(?![-\\w])`).test(text), f).toBe(false);
    }
    expect(readFileSync(path.join(out, ".github/ISSUE_TEMPLATE/config.yml"), "utf8")).toContain(`${REPO}/blob/main/FAQ.md`);
    expect(readFileSync(path.join(out, "FAQ.md"), "utf8")).toContain(`${REPO}/issues/new/choose`);
    const guide = readFileSync(path.join(out, "SETUP-WINDOWS.md"), "utf8");
    expect(guide).toContain("## 0. Install the app");
    expect(guide).not.toContain("Running from the code");
    expect(guide).not.toContain("## For development");
  });

  it("keeps links between copied pages and makes the others plain text", () => {
    const r = rewriteLinks("See [formats](FORMATS.md#top), [the plan](PLAN.md) and [releases](" + CODE_REPO + "/releases/latest).", { repo: REPO, store: STORE, copied: new Set(["FORMATS.md"]) });
    expect(r.text).toBe(`See [formats](FORMATS.md#top), the plan and [releases](${STORE}).`);
    expect(r.notes).toEqual(['link to PLAN.md became plain text ("the plan")']);
    expect(rewriteLinks(`clone ${CODE_REPO}.git`, { repo: REPO, store: STORE, copied: new Set() }).left).toEqual([`${CODE_REPO}.git`]);
  });

  it("refuses the code repository as the help repository", () => {
    expect(() => makeHelpRepo({ out: path.join(os.tmpdir(), "dd-help-never"), repo: CODE_REPO, store: STORE })).toThrow(/help repository/);
  });

  it("leaves out the setup guide's parts for running from the code", () => {
    const g = buyerSetupGuide("# Setup\n## 0. Install\nA\n# B. Running from the code\n## 1. Tools\nB\n## 5. Using the editor\nC\n## For development\nD\n");
    expect(g).toBe("# Setup\n## 0. Install\nA\n## 5. Using the editor\nC\n");
  });
});
