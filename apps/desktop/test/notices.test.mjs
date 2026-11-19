import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectProd, generateNotices, isPermissive, packageDirOfFile } from "../scripts/notices.mjs";

/** A tiny node_modules tree: name -> { version, license, deps, licenseText } */
function tree(spec, root = mkdtempSync(path.join(os.tmpdir(), "notices-"))) {
  for (const [name, p] of Object.entries(spec)) {
    const dir = path.join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: p.version ?? "1.0.0", license: p.license, dependencies: Object.fromEntries((p.deps ?? []).map((d) => [d, "*"])), repository: p.repo }));
    if (p.licenseText) writeFileSync(path.join(dir, p.file ?? "LICENSE"), p.licenseText);
  }
  return root;
}
const app = (root, deps) => { writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", version: "0.0.0", dependencies: Object.fromEntries(deps.map((d) => [d, "*"])) })); return root; };

describe("licence expressions", () => {
  it("accepts permissive licences and ORs with one, rejects copyleft and unknown", () => {
    for (const ok of ["MIT", "ISC", "Apache-2.0", "(MIT OR Apache-2.0)", "BSD-3-Clause AND MIT", "(GPL-3.0 OR MIT)", "OFL-1.1", "Unlicense"]) expect(isPermissive(ok), ok).toBe(true);
    for (const bad of ["GPL-3.0", "AGPL-3.0-only", "LGPL-2.1", "SSPL-1.0", "(GPL-3.0 AND MIT)", "", "SEE LICENSE IN LICENSE.md"]) expect(isPermissive(bad), bad).toBe(false);
  });
});

describe("which package a file belongs to", () => {
  it("finds the package in npm and pnpm layouts, scoped or not", () => {
    const s = path.sep;
    expect(packageDirOfFile(["", "r", "node_modules", "zod", "lib", "index.js"].join(s))).toBe(["", "r", "node_modules", "zod"].join(s));
    expect(packageDirOfFile(["", "r", "node_modules", ".pnpm", "ws@8.0.0", "node_modules", "ws", "lib", "a.js"].join(s))).toBe(["", "r", "node_modules", ".pnpm", "ws@8.0.0", "node_modules", "ws"].join(s));
    expect(packageDirOfFile(["", "r", "node_modules", "@a", "b", "dist", "x.js"].join(s))).toBe(["", "r", "node_modules", "@a", "b"].join(s));
    expect(packageDirOfFile(["", "r", "src", "x.ts"].join(s))).toBeNull();
  });
});

describe("the notices", () => {
  it("lists a package's dependencies too, with their licence texts, and skips the project's own packages", () => {
    const root = tree({
      a: { license: "MIT", licenseText: "MIT License\n\nCopyright (c) A authors", deps: ["b", "@own/core"] },
      b: { license: "ISC", licenseText: "ISC License Copyright B", file: "LICENSE.md" },
      "@own/core": { license: "UNLICENSED", deps: ["c"] },
      c: { license: "Apache-2.0", licenseText: "Apache License 2.0 ... C", repo: "https://example.com/c" },
    });
    const r = generateNotices({ roots: [app(root, ["a"])], skip: (p) => p.name.startsWith("@own/"), header: "HEADER" });
    expect(r.problems).toEqual([]);
    expect(r.packages.map((p) => p.name)).toEqual(["a", "b", "c"]); // (the project's own package is not listed, but what it needs is)
    expect(r.text).toContain("HEADER");
    for (const t of ["Copyright (c) A authors", "ISC License Copyright B", "Apache License 2.0 ... C", "https://example.com/c"]) expect(r.text).toContain(t);
    expect(r.text).not.toContain("@own/core");
  });

  it("includes packages the bundler pulled in even when nothing lists them as a dependency", () => {
    const root = tree({ lonely: { license: "MIT", licenseText: "Lonely licence text" } });
    const file = path.join(root, "node_modules", "lonely", "dist", "index.js");
    const r = generateNotices({ roots: [], files: [file, path.join(root, "src", "mine.ts")] });
    expect(r.packages.map((p) => p.name)).toEqual(["lonely"]);
    expect(r.text).toContain("Lonely licence text");
  });

  it("stops the build for a copyleft, unknown or missing licence, and only notes a missing licence file", () => {
    const root = tree({ g: { license: "GPL-3.0", licenseText: "GPL" }, n: {}, m: { license: "MIT" } });
    const r = generateNotices({ roots: [app(root, ["g", "n", "m"])] });
    expect(r.problems.some((p) => p.includes("g@1.0.0") && p.includes("GPL-3.0"))).toBe(true);
    expect(r.problems.some((p) => p.includes("n@1.0.0") && p.includes("no licence"))).toBe(true);
    expect(r.problems.some((p) => p.includes("m@"))).toBe(false); // (MIT without a file is only a note)
    expect(r.notes.some((n) => n.includes("m@1.0.0"))).toBe(true);
    expect(r.text).toContain("ships no licence file");
  });

  it("follows links (pnpm puts packages behind symlinks) and does not loop on circular dependencies", () => {
    const store = tree({ x: { license: "MIT", licenseText: "X licence", deps: ["y"] }, y: { license: "MIT", licenseText: "Y licence", deps: ["x"] } }, mkdtempSync(path.join(os.tmpdir(), "store-")));
    const root = mkdtempSync(path.join(os.tmpdir(), "linked-"));
    mkdirSync(path.join(root, "node_modules"), { recursive: true });
    symlinkSync(path.join(store, "node_modules", "x"), path.join(root, "node_modules", "x"), "dir");
    const found = collectProd([app(root, ["x"])]);
    expect(found.map((p) => p.name).sort()).toEqual(["x", "y"]);
  });
});

describe("software that is not an npm package (vendored)", () => {
  it("is listed with its licence texts, and is checked like a package", () => {
    const root = app(tree({}), []);
    const ok = generateNotices({ roots: [root], vendored: [{ name: "libwebp", version: "1.6.0", license: "BSD-3-Clause", source: "https://example.org/webp", texts: ["Copyright (c) Example. Redistribution and use..."] }] });
    expect(ok.problems).toEqual([]);
    expect(ok.packages.map((p) => `${p.name}@${p.version}`)).toEqual(["libwebp@1.6.0"]);
    expect(ok.text).toContain("libwebp 1.6.0");
    expect(ok.text).toContain("Licence: BSD-3-Clause");
    expect(ok.text).toContain("Redistribution and use...");
    const bad = generateNotices({ roots: [root], vendored: [{ name: "thing", version: "1", license: "GPL-3.0", texts: ["..."] }] });
    expect(bad.problems.join("\n")).toMatch(/thing@1 is under "GPL-3.0"/);
  });
});
