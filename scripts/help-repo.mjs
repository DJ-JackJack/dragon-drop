// Makes the files of the public help repository (docs/GOING-PRIVATE.md): the guides buyers read, the privacy policy, the licence agreement,
// the security page and the issue forms, and nothing else (no code, ever). Run it again whenever a guide changes, then commit the result
// in the help repository.
//
//   pnpm help-repo <out-folder> --repo https://github.com/<name>/dragon-drop-help --store https://<name>.itch.io/dragon-drop
//
// Links between the copied pages are kept; links to pages that aren't copied become plain text; links into the code repository are moved
// to the help repository (its questions and answers, its issue forms) or to the store page (where the program is downloaded). It stops if a
// link into the code repository is left, because that link would break once the code repository is private.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CODE_REPO = "https://github.com/DJ-JackJack/dragon-drop";

/** The pages copied (source in the code repository, name in the help repository). */
export const PAGES = [
  ["docs/FAQ.md", "FAQ.md"],
  ["docs/SETUP-WINDOWS.md", "SETUP-WINDOWS.md"],
  ["docs/MAP-FILES.md", "MAP-FILES.md"],
  ["docs/FORMATS.md", "FORMATS.md"],
  ["docs/MODELS.md", "MODELS.md"],
  ["docs/PRIVACY.md", "PRIVACY.md"],
  ["docs/EULA.md", "EULA.md"],
  ["SECURITY.md", "SECURITY.md"],
];
const FORMS = ["problem.yml", "question.yml", "config.yml"];

/** The setup guide without the parts for people running Dragon Drop from its code. */
export function buyerSetupGuide(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^# B\. Running from the code/.test(l));
  const resume = lines.findIndex((l) => /^## 5\. /.test(l));
  const dev = lines.findIndex((l) => /^## For development/.test(l));
  let out = lines;
  if (dev >= 0) out = out.slice(0, dev);
  if (start >= 0 && resume > start) out = [...out.slice(0, start), ...out.slice(resume)];
  return out.join("\n").replace(/\n*$/, "\n");
}

/** Rewrites one page's links; returns the text and what was changed or couldn't be. */
export function rewriteLinks(text, { repo, store, copied }) {
  const notes = [];
  let t = text;
  // the code repository's questions and answers and issue forms live in the help repository now
  t = t.split(`${CODE_REPO}/blob/main/docs/FAQ.md`).join(`${repo}/blob/main/FAQ.md`);
  t = t.split(`${CODE_REPO}/blob/main/docs/SETUP-WINDOWS.md`).join(`${repo}/blob/main/SETUP-WINDOWS.md`);
  t = t.split(`${CODE_REPO}/issues/new/choose`).join(`${repo}/issues/new/choose`);
  t = t.split(`${CODE_REPO}/security/advisories/new`).join(`${repo}/security/advisories/new`);
  // the program is downloaded from the store page
  t = t.replace(new RegExp(`${CODE_REPO.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/releases(/latest)?`, "g"), store);
  // links between pages: kept when the page is copied, plain text when it isn't
  t = t.replace(/\[([^\]]+)\]\((?!https?:|mailto:|#)([^)#\s]+)(#[^)\s]*)?\)/g, (all, label, target, hash) => {
    const name = path.posix.basename(target);
    if (copied.has(name)) return `[${label}](${name}${hash ?? ""})`;
    notes.push(`link to ${target} became plain text ("${label}")`);
    return label;
  });
  const left = [...t.matchAll(new RegExp(`${CODE_REPO.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![-\\w])[^\\s)>"']*`, "g"))].map((m) => m[0]);
  return { text: t, notes, left };
}

export function makeHelpRepo({ out, repo, store }) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error("--repo must be the help repository's address, https://github.com/<name>/<repo>");
  if (!/^https:\/\/\S+$/.test(store ?? "")) throw new Error("--store must be the store page's address (https://...)");
  if (repo === CODE_REPO) throw new Error("--repo must be the help repository, not the code repository");
  const copied = new Set(PAGES.map(([, name]) => name));
  const report = [];
  const left = [];
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, ".github", "ISSUE_TEMPLATE"), { recursive: true });
  for (const [src, name] of PAGES) {
    let text = readFileSync(path.join(ROOT, src), "utf8").replace(/\r\n/g, "\n");
    if (name === "SETUP-WINDOWS.md") text = buyerSetupGuide(text);
    if (/^> \*\*Draft/m.test(text)) report.push(`${name}: still marked as a draft`);
    const r = rewriteLinks(text, { repo, store, copied });
    for (const n of r.notes) report.push(`${name}: ${n}`);
    for (const l of r.left) left.push(`${name}: ${l}`);
    writeFileSync(path.join(out, name), r.text);
  }
  for (const f of FORMS) {
    const r = rewriteLinks(readFileSync(path.join(ROOT, ".github", "ISSUE_TEMPLATE", f), "utf8"), { repo, store, copied });
    for (const l of r.left) left.push(`.github/ISSUE_TEMPLATE/${f}: ${l}`);
    writeFileSync(path.join(out, ".github", "ISSUE_TEMPLATE", f), r.text);
  }
  writeFileSync(path.join(out, "README.md"), [
    "# Dragon Drop: help",
    "",
    "Help for [Dragon Drop](" + store + "), a map editor for tabletop RPGs on Windows. This repository holds only these pages; the program",
    "is downloaded from its store page.",
    "",
    "- [Questions and answers](FAQ.md)",
    "- [Setting up Dragon Drop](SETUP-WINDOWS.md)",
    "- [The map files](MAP-FILES.md) and [the file types Dragon Drop reads and writes](FORMATS.md)",
    "- [AI models tried with Dragon Drop](MODELS.md)",
    "- [Privacy policy](PRIVACY.md) and [licence agreement](EULA.md)",
    "- [Reporting a security problem](SECURITY.md)",
    "",
    `To ask a question or report a problem, [open an issue](${repo}/issues/new/choose). Never paste an API key, an access key or a password.`,
    "",
  ].join("\n"));
  if (left.length) throw new Error(`links into the code repository are left (they break once it is private):\n${left.join("\n")}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const out = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (!out) { console.error("usage: pnpm help-repo <out-folder> --repo https://github.com/<name>/dragon-drop-help --store https://<name>.itch.io/dragon-drop"); process.exit(2); }
  try {
    const report = makeHelpRepo({ out: path.resolve(out), repo: opt("--repo"), store: opt("--store") });
    console.log(`Made the help repository's files in ${path.resolve(out)}.`);
    for (const r of report) console.log(`- ${r}`);
    console.log("Read them through, then commit them in the help repository and switch on its private vulnerability reporting.");
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}
