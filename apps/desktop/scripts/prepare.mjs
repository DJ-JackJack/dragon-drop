// Gathers what the desktop app needs into apps/desktop/build:
//   build/server/main.mjs + computeWorker.mjs   the map server, bundled into single files (no node_modules needed)
//   build/editor/                               the built editor (run `pnpm build` at the repo root first)
//   build/starter/                              the Starter Pack (apps/server/starter)
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const libwebpVersion = /LIBWEBP_VERSION = "([^"]+)"/.exec(readFileSync(path.join(repo, "packages/tools/src/webpWasm.ts"), "utf8"))?.[1] ?? "";
if (!libwebpVersion) { console.error("packages/tools/src/webpWasm.ts has no LIBWEBP_VERSION: run tools/webp-wasm/build.sh"); process.exit(1); }

// the open-source notices (the bundles above drop licence comments, so this file is where the licences travel)
const notices = generateNotices({
  roots: [path.join(repo, "apps/editor"), desktop],
  files: [...bundled],
  // the WebP decoder is libwebp built to WebAssembly (tools/webp-wasm/build.sh), kept in the repository as a TypeScript file the server bundle contains
  vendored: [{
    name: "libwebp (WebP decoder, as WebAssembly)", version: libwebpVersion, license: "BSD-3-Clause AND MIT AND BSD-2-Clause AND CC0-1.0", source: "https://developers.google.com/speed/webp",
    texts: [readFileSync(path.join(repo, "tools/webp-wasm/LICENSE-libwebp.txt"), "utf8"), readFileSync(path.join(repo, "tools/webp-wasm/LICENSE-wasm-runtime.txt"), "utf8")],
  }],
  skip: (p) => p.name.startsWith("@mapmaker/") || p.name === "dragon-drop" || p.name === "ai-mapmaker",
  header: `Dragon Drop is copyright its authors. It includes the open-source software below, each under its own licence, reproduced as those licences ask.
Electron (with Chromium and Node.js) is licensed in LICENSE.electron.txt and LICENSES.chromium.html in the program's folder.
The Cinzel typeface is licensed under the SIL Open Font License 1.1 (see its entry below).
The Starter Pack's floor textures are photographs from Poly Haven (https://polyhaven.com), released under CC0 1.0, and its objects were drawn for Dragon Drop and are CC0 1.0 too; starter\\Dragon Drop Starter Pack\\CREDITS.txt lists them.`,
});
for (const n of notices.notes) console.warn("notice:", n);
if (notices.problems.length) { for (const p of notices.problems) console.error("LICENCE PROBLEM:", p); process.exit(1); }
writeFileSync(path.join(out, "THIRD-PARTY-NOTICES.txt"), notices.text);
console.log(`Wrote THIRD-PARTY-NOTICES.txt (${notices.packages.length} packages)`);

cpSync(path.join(repo, "apps/editor/dist"), path.join(out, "editor"), { recursive: true });
// Dragon Drop's own Starter Pack: a few floor textures (CC0, from Poly Haven), so there is something to paint with before any packs are added
cpSync(path.join(repo, "apps/server/starter"), path.join(out, "starter"), { recursive: true });

// (No sample project is bundled: the maps in this repository are the author's own work and never ship. A new install starts with a generated first map.)
console.log("Prepared apps/desktop/build");
