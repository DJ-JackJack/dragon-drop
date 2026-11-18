import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");

// the packaged desktop app keeps its settings elsewhere and passes them in as environment variables
if (process.env.MAPMAKER_NO_DOTENV !== "1") dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

export interface Config {
  port: number;
  host: string;
  projectsDir: string;
  editorDist: string;
  /** Folder with Dungeondraft packs (read in place), or null. */
  assetsDir: string | null;
  /** Where indexes and thumbnails are cached. */
  cacheDir: string;
  /** Extra Host values allowed to talk to the server (e.g. a Tailscale name), besides localhost. */
  extraHosts: string[];
  /**
   * A secret that every request to /api, /mcp and /ws must carry (as `Authorization: Bearer <key>` or as the session cookie the editor gets by opening
   * `/?t=<key>` once), or null for none. The desktop app always sets one; the developer setup is open unless MAPMAKER_ACCESS_TOKEN is set.
   */
  accessToken: string | null;
}

/** The shortest access key accepted (a short one would be guessable; this fails loudly instead of quietly protecting nothing). */
export const MIN_ACCESS_TOKEN = 16;

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const port = Number(process.env.MAPMAKER_PORT ?? 4747);
  const token = process.env.MAPMAKER_ACCESS_TOKEN?.trim() || null;
  if (token && token.length < MIN_ACCESS_TOKEN) throw new Error(`MAPMAKER_ACCESS_TOKEN must be at least ${MIN_ACCESS_TOKEN} characters (use a long random string).`);
  return {
    accessToken: token,
    port,
    host: process.env.MAPMAKER_HOST ?? "127.0.0.1",
    projectsDir: path.resolve(process.env.MAPMAKER_PROJECTS_DIR ?? path.join(REPO_ROOT, "projects")),
    editorDist: process.env.MAPMAKER_EDITOR_DIST ? path.resolve(process.env.MAPMAKER_EDITOR_DIST) : path.join(REPO_ROOT, "apps/editor/dist"),
    assetsDir: process.env.MAPMAKER_ASSETS_DIR?.trim() ? path.resolve(process.env.MAPMAKER_ASSETS_DIR.trim()) : null,
    cacheDir: path.resolve(process.env.MAPMAKER_CACHE_DIR ?? path.join(REPO_ROOT, ".cache")),
    // tolerate pasted URLs: "https://pc.tailnet.ts.net/" -> "pc.tailnet.ts.net"
    extraHosts: (process.env.MAPMAKER_ALLOWED_HOSTS ?? "").split(",")
      .map((s) => s.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")).filter(Boolean),
    ...overrides,
  };
}

export function apiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function editorBuilt(cfg: Config): boolean {
  return existsSync(path.join(cfg.editorDist, "index.html"));
}
