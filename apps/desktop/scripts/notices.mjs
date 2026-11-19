// Builds THIRD-PARTY-NOTICES.txt: every open-source package that ships inside Dragon Drop, with its licence text, as the licences ask.
//
// What ships comes from three places:
//   - the server bundle: esbuild's metafile says exactly which packages were bundled into it;
//   - the editor: the packages the editor lists under "dependencies" and what those need (the editor's own bundler is not asked);
//   - the desktop app: what apps/desktop lists under "dependencies" (the updater, the terminal module) and what those need.
// Electron itself (with Chromium and Node) ships LICENSE.electron.txt and LICENSES.chromium.html beside the program; electron-builder adds them.
//
// The build stops if a package has no licence we have reviewed (a copyleft or unknown licence must be looked at by a person before it ships).
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

/** Licences that ask only for the notice to be kept (permissive). A package under one of these needs no review. */
export const PERMISSIVE = new Set([
  "MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unlicense", "CC0-1.0", "OFL-1.1", "BlueOak-1.0.0", "Zlib", "Python-2.0", "CC-BY-4.0",
]);
/** Packages with some other licence that a person has read and accepted: name -> why. */
export const REVIEWED = {};

const LICENSE_FILE = /^(licen[sc]e|licen[sc]es|copying|unlicense|notice)([-._].*)?$/i;

/** The directory of package `name` as seen from `fromDir` (pnpm and npm layouts: look in node_modules here, then in every parent). */
export function findPackageDir(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const cand = path.join(dir, "node_modules", name);
    if (existsSync(path.join(cand, "package.json"))) return realpathSync(cand);
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The package that owns a file inside node_modules (the last node_modules/<name> or node_modules/@scope/<name> in its path), as a directory. */
export function packageDirOfFile(file) {
  const parts = file.split(/[\\/]/);
  const i = parts.lastIndexOf("node_modules");
  if (i < 0 || i + 1 >= parts.length) return null;
  const n = parts[i + 1].startsWith("@") ? 2 : 1;
  return parts.slice(0, i + 1 + n).join(path.sep) || null;
}

export function readPackage(dir) {
  const j = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  let license = j.license;
  if (license && typeof license === "object") license = license.type;
  if (!license && Array.isArray(j.licenses)) license = j.licenses.map((l) => (typeof l === "string" ? l : l.type)).join(" OR ");
  const repo = typeof j.repository === "string" ? j.repository : j.repository?.url;
  return {
    dir, name: j.name, version: j.version, license: license ? String(license) : "", source: j.homepage || repo || "",
    deps: [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.optionalDependencies ?? {})],
  };
}

/** Is a licence expression ("MIT", "(MIT OR Apache-2.0)", "BSD-3-Clause AND MIT") covered by the permissive list? */
export function isPermissive(expr) {
  const e = expr.replace(/[()]/g, " ").trim();
  if (!e) return false;
  const ids = (s) => s.split(/\s+(?:AND|and)\s+/).map((x) => x.trim()).filter(Boolean);
  // an OR of alternatives needs one acceptable alternative; an AND needs all of its terms
  return e.split(/\s+(?:OR|or)\s+/).some((alt) => ids(alt).every((id) => PERMISSIVE.has(id.replace(/\+$/, ""))));
}

/** The text of every licence-looking file in a package directory. */
export function licenseTexts(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!LICENSE_FILE.test(f)) continue;
    const p = path.join(dir, f);
    try { const t = readFileSync(p, "utf8").trim(); if (t) out.push({ file: f, text: t }); } catch { /* a folder or unreadable: skip */ }
  }
  return out;
}

/** Everything `roots` (package directories) need at run time: their dependencies, and theirs, and so on. Returns packages by directory. */
export function collectProd(roots, skip = () => false) {
  const found = new Map();
  const visit = (dir, isRoot) => {
    const real = realpathSync(dir);
    if (found.has(real)) return;
    const pkg = readPackage(real);
    if (!isRoot && !skip(pkg)) found.set(real, pkg);
    else found.set(real, null);
    for (const d of pkg.deps) {
      const dd = findPackageDir(real, d);
      if (dd) visit(dd, false); // (a missing optional dependency, such as another platform's binary, is simply not there)
    }
  };
  for (const r of roots) visit(r, true);
  return [...found.values()].filter(Boolean);
}

/**
 * `roots`: package directories whose dependencies ship. `files`: files (paths) of node_modules packages that were bundled (from esbuild's metafile).
 * `skip(pkg)`: packages that are not third-party (the project's own).
 * `vendored`: software that ships inside the program but is not an npm package (compiled code kept in the repository, such as the WebP decoder):
 * { name, version, license, source, texts: [licence text, ...] }. It is checked and listed like a package.
 * Returns { text, packages, problems, notes }.
 */
export function generateNotices({ roots = [], files = [], skip = () => false, header = "", vendored = [] }) {
  const byDir = new Map();
  for (const p of collectProd(roots, skip)) byDir.set(p.dir, p);
  for (const f of files) {
    const d = packageDirOfFile(f);
    if (!d || !existsSync(path.join(d, "package.json"))) continue;
    const real = realpathSync(d);
    if (byDir.has(real)) continue;
    const pkg = readPackage(real);
    if (!skip(pkg)) byDir.set(real, pkg);
  }
  // one entry per name@version (the same package can sit in two places)
  const unique = new Map();
  for (const p of byDir.values()) unique.set(`${p.name}@${p.version}`, p);
  for (const v of vendored) unique.set(`${v.name}@${v.version}`, { ...v, deps: [] });
  const packages = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const problems = [], notes = [];
  const blocks = packages.map((p) => {
    const texts = p.texts ? p.texts.map((text) => ({ file: "(kept with the source)", text: text.trim() })).filter((x) => x.text) : licenseTexts(p.dir);
    if (!p.license) problems.push(`${p.name}@${p.version} declares no licence`);
    else if (!isPermissive(p.license) && !REVIEWED[p.name]) problems.push(`${p.name}@${p.version} is under "${p.license}", which has not been reviewed (add it to REVIEWED in notices.mjs once a person has accepted it)`);
    if (!texts.length) notes.push(`${p.name}@${p.version} ships no licence file (it declares ${p.license || "nothing"})`);
    const head = ["=".repeat(78), `${p.name} ${p.version}`, `Licence: ${p.license || "(not declared)"}`, ...(p.source ? [`Source: ${p.source}`] : []), "-".repeat(78)].join("\n");
    const body = texts.length ? texts.map((t) => t.text) : [`(This package ships no licence file; it declares ${p.license || "no licence"}. See the source above.)`];
    return `${head}\n\n${body.join("\n\n")}`;
  });
  const text = `${header.trim()}\n\n${packages.length} packages\n\n${blocks.join("\n\n\n")}\n`;
  return { text, packages, problems, notes };
}
