// Gathers what the desktop app needs into apps/desktop/build:
//   build/server/main.mjs + computeWorker.mjs   the map server, bundled into single files (no node_modules needed)
//   build/editor/                               the built editor (run `pnpm build` at the repo root first)
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateNotices } from "./notices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const repo = path.resolve(desktop, "../..");
const out = path.join(desktop, "build");

if (!existsSync(path.join(repo, "apps/editor/dist/index.html"))) {
  console.error('The editor is not built yet. Run "pnpm build" in the repository root first.');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "server"), { recursive: true });

const common = {
  bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning", legalComments: "none",
  external: ["bufferutil", "utf-8-validate"], // optional speed-ups for ws; it works without them
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};
const bundled = new Set(); // every file the server bundles pulled in (the notices list the packages they belong to)
for (const [entry, outfile] of [["apps/server/src/main.ts", "server/main.mjs"], ["apps/server/src/computeWorker.ts", "server/computeWorker.mjs"]]) {
  // (compute.ts starts the worker as ./computeWorker.mjs next to main.mjs)
  const r = await build({ ...common, metafile: true, entryPoints: [path.join(repo, entry)], outfile: path.join(out, outfile) });
  for (const f of Object.keys(r.metafile.inputs)) bundled.add(path.resolve(process.cwd(), f));
}

// the open-source notices (the bundles above drop licence comments, so this file is where the licences travel)
const notices = generateNotices({
  roots: [path.join(repo, "apps/editor"), desktop],
  files: [...bundled],
  skip: (p) => p.name.startsWith("@mapmaker/") || p.name === "dragon-drop" || p.name === "ai-mapmaker",
  header: `Dragon Drop is copyright its authors. It includes the open-source software below, each under its own licence, reproduced as those licences ask.
Electron (with Chromium and Node.js) is licensed in LICENSE.electron.txt and LICENSES.chromium.html in the program's folder.
The Cinzel typeface is licensed under the SIL Open Font License 1.1 (see its entry below).`,
});
for (const n of notices.notes) console.warn("notice:", n);
if (notices.problems.length) { for (const p of notices.problems) console.error("LICENCE PROBLEM:", p); process.exit(1); }
writeFileSync(path.join(out, "THIRD-PARTY-NOTICES.txt"), notices.text);
console.log(`Wrote THIRD-PARTY-NOTICES.txt (${notices.packages.length} packages)`);

cpSync(path.join(repo, "apps/editor/dist"), path.join(out, "editor"), { recursive: true });

// (No sample project is bundled: the maps in this repository are the author's own work and never ship. A new install starts with a generated first map.)
console.log("Prepared apps/desktop/build");
