/**
 * Double a project's map resolution with new coast and mountain detail.
 *   pnpm upscale <project-id>          upscale the live map (stop the app first)
 *   pnpm upscale <project-id> --seed   write the result as the committed starting map instead
 * The previous heightmap is kept as map/before-upscale-<W>px.f32.gz.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { HeightField, scaleFeatures, upscaleHeights } from "@mapmaker/core";
import { loadConfig } from "./config.ts";
import { ProjectStore } from "./store.ts";

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--"));
  const toSeed = args.includes("--seed");
  if (!id) {
    console.log("Usage: pnpm upscale <project-id> [--seed]");
    process.exit(1);
  }
  const cfg = loadConfig();
  try {
    const r = await fetch(`http://127.0.0.1:${cfg.port}/api/health`, { signal: AbortSignal.timeout(800) });
    if (r.ok) {
      console.error("Dragon Drop is running. Stop it first (Ctrl+C in its window), then run this again.");
      process.exit(1);
    }
  } catch { /* not running: good */ }

  const store = new ProjectStore(cfg.projectsDir);
  if (!(await store.exists(id))) throw new Error(`No project "${id}" in ${cfg.projectsDir}`);
  const doc = await store.load(id);
  const { w: W, h: H } = doc.height;
  if (W * 2 > 4096) throw new Error(`${id} is already ${W}x${H}; 4096 is the largest supported size.`);
  const dir = path.join(cfg.projectsDir, id);
  const live = path.join(dir, "map", "height.f32.gz"), seed = path.join(dir, "seed", "height.f32.gz");
  const current = existsSync(live) ? live : existsSync(seed) ? seed : null;
  if (current) {
    await mkdir(path.join(dir, "map"), { recursive: true });
    await copyFile(current, path.join(dir, "map", `before-upscale-${W}px.f32.gz`));
  }

  console.log(`Upscaling ${doc.meta.name} from ${W}x${H} to ${W * 2}x${H * 2}...`);
  const t0 = Date.now();
  const up = upscaleHeights(doc.height.data, W, H, doc.meta.seaLevel, { seed: doc.meta.seed });
  doc.height = new HeightField(up.W, up.H, up.data);
  doc.meta = { ...doc.meta, width: up.W, height: up.H, kmPerPx: doc.meta.kmPerPx / 2, updatedAt: new Date().toISOString() };
  doc.features = scaleFeatures(doc.features ?? { places: [], labels: [] }, 2);

  if (toSeed) {
    await writeFile(path.join(dir, "project.json"), JSON.stringify(doc.meta, null, 2));
    await writeFile(path.join(dir, "features.json"), JSON.stringify(doc.features, null, 1));
    await mkdir(path.join(dir, "seed"), { recursive: true });
    // committed starting maps are rounded to 0.25 m: about half the size in git, no visible change
    const q = new Float32Array(doc.height.data.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(doc.height.data[i] * 4) / 4;
    await writeFile(seed, gzipSync(Buffer.from(q.buffer), { level: 9 }));
  } else {
    await store.save(doc);
  }
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${up.W}x${up.H}, ${doc.meta.kmPerPx.toFixed(3)} km per px.`);
  console.log("Places and labels were moved to the new coordinates. Older checkpoints can't be restored onto the new size.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
