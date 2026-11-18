// `pnpm start`: build the editor if needed, start the map server, open the browser.
// Works the same on Windows, macOS and Linux.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const port = Number(process.env.MAPMAKER_PORT ?? readEnvPort() ?? 4747);
const url = `http://localhost:${port}`;

function readEnvPort() {
  const f = path.join(root, ".env");
  if (!existsSync(f)) return null;
  const m = readFileSync(f, "utf8").match(/^\s*MAPMAKER_PORT\s*=\s*(\d+)/m);
  return m ? m[1] : null;
}

/** The newest change time (ms) under these folders and files, ignoring anything missing. */
function newestChange(paths) {
  let newest = 0;
  const visit = (p) => {
    let st;
    try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) if (name !== "node_modules" && name !== "dist") visit(path.join(p, name));
    } else if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  paths.forEach(visit);
  return newest;
}

// Rebuild when the editor isn't built yet, when asked, or when the code changed since the last build
// (for example after "git pull"), so the page always matches the code.
const builtIndex = path.join(root, "apps/editor/dist/index.html");
const builtAt = existsSync(builtIndex) ? statSync(builtIndex).mtimeMs : 0;
const sourcesChanged = builtAt > 0 && newestChange([
  path.join(root, "apps/editor/src"), path.join(root, "apps/editor/index.html"), path.join(root, "apps/editor/package.json"),
  path.join(root, "apps/editor/vite.config.ts"), path.join(root, "packages/core/src"), path.join(root, "pnpm-lock.yaml"),
]) > builtAt;
const needBuild = process.argv.includes("--build") || builtAt === 0 || sourcesChanged;
if (needBuild) {
  console.log(builtAt === 0 ? "Building the editor (first run only)..." : "Building the editor (the code has changed since the last build)...");
  const r = spawnSync("pnpm", ["--filter", "@mapmaker/editor", "build"], { cwd: root, stdio: "inherit", shell: isWin });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const server = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/main.ts"], {
  cwd: path.join(root, "apps/server"),
  stdio: "inherit",
  env: process.env,
});
server.on("exit", (code) => process.exit(code ?? 0));

if (!process.argv.includes("--no-open") && process.env.MAPMAKER_NO_OPEN !== "1") {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) {
        const opener = isWin ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
        spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
