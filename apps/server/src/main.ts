import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { anthropicModelCall } from "./agent.ts";
import { scriptedModel } from "./fakeModel.ts";
import { AssetLibrary } from "./assets.ts";
import { apiKeyConfigured, editorBuilt, loadConfig } from "./config.ts";
import { createAppServer } from "./http.ts";
import { WorkerCompute } from "./compute.ts";
import { Hub } from "./hub.ts";
import { NoiseStore } from "./noiseStore.ts";
import { ProjectStore } from "./store.ts";

export async function start(overrides: Parameters<typeof loadConfig>[0] = {}) {
  const cfg = loadConfig(overrides);
  mkdirSync(cfg.projectsDir, { recursive: true });
  const fake = process.env.MAPMAKER_FAKE_MODEL === "1";
  // the texture noise is kept in the cache folder: worked out once per map size and seed, not at every launch
  const hub = new Hub(new ProjectStore(cfg.projectsDir), fake ? scriptedModel() : apiKeyConfigured() ? anthropicModelCall() : null, new WorkerCompute(cfg.cacheDir));
  hub.noise = new NoiseStore(cfg.cacheDir);
  await hub.ensureProject();
  if (cfg.assetsDir) {
    hub.assets = new AssetLibrary(cfg.assetsDir, cfg.cacheDir);
    void hub.assets.scan().catch((e) => console.error("Couldn't scan the asset packs:", e)); // in the background: the server is usable meanwhile
  }
  const server = createAppServer(cfg, hub);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  return { cfg, hub, server };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().then(({ cfg, hub, server }) => {
    const url = `http://localhost:${cfg.port}`;
    console.log("\n  Dragon Drop");
    console.log(`  Editor:  ${editorBuilt(cfg) ? url : `${url} (run "pnpm build" first, or use "pnpm dev" -> http://localhost:5173)`}`);
    console.log(`  MCP:     ${url}/mcp   (Claude Code picks this up from .mcp.json)`);
    if (cfg.accessToken) console.log(`  Access:  a key is required (MAPMAKER_ACCESS_TOKEN). Open ${url}/?t=<key> once in each browser, and send 'Authorization: Bearer <key>' to /mcp.`);
    if (cfg.assetsDir) console.log(`  Assets:  ${cfg.assetsDir} (scanning in the background)`);
    console.log(`  Project: ${hub.activeId}   (folder: ${cfg.projectsDir})`);
    console.log(`  Chat:    ${process.env.MAPMAKER_FAKE_MODEL === "1" ? "SCRIPTED TEST MODEL (MAPMAKER_FAKE_MODEL=1)" : apiKeyConfigured() ? "Claude API key found" : "no ANTHROPIC_API_KEY in .env - in-app chat disabled"}\n`);
    const shutdown = async () => {
      console.log("Saving and shutting down...");
      await hub.close().catch(() => {});
      server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // the desktop app starts this as a child process and asks it to save and stop this way (Windows has no gentle signals)
    process.on("message", (m) => { if (m === "shutdown") void shutdown(); });
  }).catch((e) => {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`Port ${loadConfig().port} is already in use. Is Dragon Drop already running? Set MAPMAKER_PORT in .env to use another port.`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
}
