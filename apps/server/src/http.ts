/** HTTP + WebSocket front door: editor static files, image files, /ws sync, /mcp tools. */
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { BATTLE_EXPORT_FORMATS, type BattleExportFormat, type ClientMsg, REFERENCE_PICTURE_MAX_BYTES, noiseFileSize, referencePictureProblem } from "@mapmaker/core";
import { type Config, apiKeyConfigured, editorBuilt } from "./config.ts";
import type { Hub } from "./hub.ts";
import { handleMcp } from "./mcp.ts";
import { NOISE_MAX_SIDE, NOISE_MIN_SIDE } from "./noiseStore.ts";
import { PictureRefused } from "./store.ts";
import { encodeJpeg } from "@mapmaker/tools";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

/**
 * Only accept requests addressed to this machine (blocks DNS-rebinding) and, for browser
 * requests, only from the editor's own origin (blocks other websites driving the app or
 * spending your API credits).
 */
export function accessPolicy(cfg: Config) {
  const ports = [cfg.port, 5173];
  const names = ["localhost", "127.0.0.1", "[::1]", ...cfg.extraHosts.map((h) => h.toLowerCase())];
  // extra hosts (e.g. a private Tailscale name) may also arrive without a port (HTTPS on 443)
  const hosts = [...names.flatMap((n) => ports.map((p) => `${n}:${p}`)), ...cfg.extraHosts.map((h) => h.toLowerCase())];
  const origins = hosts.flatMap((h) => [`http://${h}`, `https://${h}`]);
  return {
    hosts,
    origins,
    allowed(req: IncomingMessage): boolean {
      const host = (req.headers.host ?? "").toLowerCase();
      if (!hosts.includes(host)) return false;
      const origin = req.headers.origin;
      return !origin || origins.includes(origin.toLowerCase());
    },
  };
}

/**
 * What the editor page may load and talk to: its own scripts, styles, fonts and workers, images from here (or made in the
 * page), and connections back to this server only. A page that somehow ran foreign script would find little to reach.
 */
export function editorCsp(host: string | undefined, hosts: string[]): string {
  const h = (host ?? "").toLowerCase();
  const ws = h && hosts.includes(h) ? ` ws://${h} wss://${h}` : "";
  return [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    `connect-src 'self' blob: data:${ws}`, "worker-src 'self' blob:", "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join("; ");
}

/** The name of the cookie that carries the access key for the editor's own requests (HttpOnly: the page's script can't read it). */
export const SESSION_COOKIE = "dd_session";

const digest = (s: string) => createHash("sha256").update(s).digest();
/** Compare two secrets without leaking, through timing, how much of the guess was right. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Does the request carry the access key (as a Bearer header or the session cookie)? Always true when no key is set. */
export function authorised(cfg: Config, req: IncomingMessage): boolean {
  if (!cfg.accessToken) return true;
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ") && sameSecret(h.slice(7).trim(), cfg.accessToken)) return true;
  const c = cookieValue(req.headers.cookie, SESSION_COOKIE);
  return c !== undefined && sameSecret(c, cfg.accessToken);
}

export function createAppServer(cfg: Config, hub: Hub) {
  const policy = accessPolicy(cfg);

  const server = createServer(async (req, res) => {
    try {
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/api/")) {
        if (!policy.allowed(req)) return deny(res);
        if (!authorised(cfg, req)) return unauthorised(res);
      } else if (cfg.accessToken && url.searchParams.has("t") && policy.allowed(req)) {
        // Opening the editor with the key once (`/?t=<key>`) gives the browser or window the session cookie, then goes on to the same page without the key in its address.
        if (sameSecret(url.searchParams.get("t") ?? "", cfg.accessToken)) {
          url.searchParams.delete("t");
          const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
          res.writeHead(302, { location: url.pathname + url.search, "cache-control": "no-store", "set-cookie": `${SESSION_COOKIE}=${cfg.accessToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}` }).end();
          return;
        }
      }
      if (url.pathname === "/mcp") return await handleMcp(hub, req, res, policy.hosts, policy.origins);
      if (url.pathname === "/api/health") return sendJson(res, { ok: true, project: hub.activeId, apiKeyConfigured: apiKeyConfigured() });
      if (url.pathname === "/api/claude-hook") return await handleClaudeHook(hub, req, res);
      if (url.pathname === "/api/noise") return await handleNoise(hub, url, req, res);
      const rj = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/render\.jpg$/);
      if (rj) {
        const max = Math.min(4096, Math.max(256, Number(url.searchParams.get("max") ?? 2048)));
        const bytes = await hub.renderJpeg(rj[1], max, (img) => encodeJpeg(img, 88, 16_000_000));
        if (!bytes) return void res.writeHead(404, { "content-type": "text/plain" }).end("Not the open project");
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-cache" }).end(bytes);
        return;
      }
      // one level of the open battlemap as a picture (the editor shows the level below faintly under the one being worked on)
      const lv = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/levels\/([a-z0-9-]+)\/picture\.png$/);
      if (lv) {
        const png = await hub.levelPicture(lv[1], lv[2]);
        if (!png) return void res.writeHead(404, { "content-type": "text/plain" }).end("No such level in the open project");
        res.writeHead(200, { "content-type": "image/png", "content-length": png.byteLength, "cache-control": "no-cache" }).end(png);
        return;
      }
      if (url.pathname.startsWith("/api/assets/")) return await handleAssets(hub, url, req, res);
      const ex = url.pathname.match(new RegExp(`^/api/projects/([a-z0-9-]+)/export/(${BATTLE_EXPORT_FORMATS.join("|")})$`));
      if (ex) {
        if (hub.activeId !== ex[1]) return void res.writeHead(404, { "content-type": "text/plain" }).end("Not the open project");
        try {
          const f = await hub.battleExport(ex[2] as BattleExportFormat, url.searchParams.get("level") ?? undefined);
          res.writeHead(200, { "content-type": f.mime, "content-disposition": `attachment; filename="${f.name}"`, "content-length": f.bytes.byteLength, "cache-control": "no-cache" }).end(f.bytes);
        } catch (e) {
          res.writeHead(400, { "content-type": "text/plain" }).end((e as Error).message);
        }
        return;
      }
      const up = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/refs$/);
      if (up) return await handleRefUpload(hub, up[1], req, res);
      const m = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(refs|previews)\/([^/]+)$/);
      if (m) {
        const file = hub.store.filePath(m[1], m[2] as "refs" | "previews", decodeURIComponent(m[3]));
        return sendFile(res, file, "private, max-age=3600");
      }
      return serveEditor(cfg, url.pathname, res, editorCsp(req.headers.host, policy.hosts));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Server error: ${(e as Error).message}`);
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !policy.allowed(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!authorised(cfg, req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let msg: ClientMsg;
        try {
          msg = JSON.parse(data.toString()) as ClientMsg;
        } catch {
          return;
        }
        void hub.handleClient(ws, msg);
      });
      // (if the projects folder can't be read just now, say so by closing this socket: a rejection nobody handles would stop the whole server)
      hub.addClient(ws, { lite: url.searchParams.get("lite") === "1" }).catch(() => { try { ws.close(1011, "The server could not read your projects."); } catch { /* it is gone already */ } });
    });
  });

  return server;
}

/**
 * Claude Code's hooks (installed by the desktop app) post their JSON here so the editor knows whether Claude is idle, working
 * or waiting at a question. The answer is empty on purpose: a hook's output can be fed back to Claude as text.
 */
async function handleClaudeHook(hub: Hub, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return void res.writeHead(405, { allow: "POST" }).end();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) return void res.writeHead(413).end();
    chunks.push(c as Buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 500) : undefined);
    if (body && typeof body === "object") hub.claudeHook({ hook_event_name: s(body.hook_event_name), notification_type: s(body.notification_type), message: s(body.message) });
  } catch { /* not JSON: ignore */ }
  res.writeHead(204).end();
}

/**
 * The texture noise of a map (about 80 MB for a 2048 map), kept in the cache folder so it isn't worked out again at every launch.
 * GET sends the file (404 if there isn't one yet). PUT stores one the editor had to work out itself: the length must be exact and the
 * header must name this very map, size and seed.
 */
async function handleNoise(hub: Hub, url: URL, req: IncomingMessage, res: ServerResponse) {
  const store = hub.noise;
  if (!store) return void res.writeHead(404).end();
  const W = Number(url.searchParams.get("w")), H = Number(url.searchParams.get("h")), seed = Number(url.searchParams.get("seed")) >>> 0;
  const sane = (n: number) => Number.isInteger(n) && n >= NOISE_MIN_SIDE && n <= NOISE_MAX_SIDE;
  if (!sane(W) || !sane(H) || !Number.isFinite(Number(url.searchParams.get("seed")))) return void res.writeHead(400).end();
  if (req.method === "GET") {
    const size = store.size(W, H, seed);
    if (size === null) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": size, "cache-control": "no-store" });
    createReadStream(store.file(W, H, seed)).pipe(res);
    return;
  }
  if (req.method !== "PUT") return void res.writeHead(405, { allow: "GET, PUT" }).end();
  const expected = noiseFileSize(W, H);
  if (Number(req.headers["content-length"]) !== expected) return void res.writeHead(400).end();
  if (store.size(W, H, seed) !== null) { req.resume(); return void res.writeHead(204).end(); } // already kept
  const body = Buffer.allocUnsafe(expected);
  let got = 0;
  for await (const c of req) {
    const chunk = c as Buffer;
    if (got + chunk.length > expected) return void res.writeHead(413).end();
    chunk.copy(body, got);
    got += chunk.length;
  }
  if (got !== expected) return void res.writeHead(400).end();
  try {
    store.writeBytes(W, H, seed, body);
  } catch {
    return void res.writeHead(400).end();
  }
  res.writeHead(204).end();
}

/**
 * A reference picture the DM adds in the editor (the Add picture button, or one dropped or pasted anywhere): the body is the file
 * itself and `x-file-name` its name (URI-encoded). What it is comes from its bytes, never from the name or the content type. Answers
 * the RefInfo, or a plain-text message for the person (415 for a kind of picture that can't be used, 413 for one that is too big).
 */
async function handleRefUpload(hub: Hub, id: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return void res.writeHead(405, { allow: "POST" }).end();
  const say = (code: number, text: string, close = false) => res.writeHead(code, { "content-type": "text/plain; charset=utf-8", ...(close && { connection: "close" }) }).end(text, () => { if (close) req.destroy(); });
  let name = "picture";
  try { name = decodeURIComponent(String(req.headers["x-file-name"] ?? "picture")).slice(0, 300) || "picture"; } catch { /* keep the default */ }
  const tooBig = (n: number) => say(413, referencePictureProblem(name, null, n) ?? "That picture is too big.", true);
  const declared = Number(req.headers["content-length"]);
  if (declared > REFERENCE_PICTURE_MAX_BYTES) return tooBig(declared);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > REFERENCE_PICTURE_MAX_BYTES) return tooBig(size);
    chunks.push(c as Buffer);
  }
  const body = Buffer.concat(chunks);
  try {
    sendJson(res, await hub.addReference(id, name, new Uint8Array(body.buffer, body.byteOffset, body.byteLength)));
  } catch (e) {
    say(e instanceof PictureRefused ? 415 : 400, (e as Error).message);
  }
}

async function handleAssets(hub: Hub, url: URL, req: IncomingMessage, res: ServerResponse) {
  const lib = hub.assets;
  const route = url.pathname.slice("/api/assets/".length);
  if (route === "status") return sendJson(res, lib ? { configured: true, ...lib.status() } : { configured: false });
  if (!lib) return void res.writeHead(404, { "content-type": "text/plain" }).end("No asset folder is set.");
  if (route === "packs") return sendJson(res, lib.packList());
  if (route === "roofs") return sendJson(res, hub.roofPools()); // (the roof textures of the packs, by roof look: city buildings are drawn from these)
  if (route === "list") {
    const r = lib.list({
      pack: url.searchParams.get("pack") || undefined, cat: url.searchParams.get("cat") || undefined, q: url.searchParams.get("q") || undefined,
      offset: Number(url.searchParams.get("offset") ?? 0), limit: Number(url.searchParams.get("limit") ?? 60),
    });
    return sendJson(res, { total: r.total, items: await lib.withSizes(r.items) });
  }
  if (route === "file") {
    const id = url.searchParams.get("id") ?? "";
    const thumb = Number(url.searchParams.get("thumb") ?? 0);
    const f = thumb > 0 ? await lib.thumbnail(id, Math.min(1024, Math.max(16, thumb))) : await lib.read(id);
    if (!f) return void res.writeHead(404, { "content-type": "text/plain" }).end("No such asset (or its author doesn't allow its use here).");
    const orig = (f as { orig?: { w: number; h: number } }).orig;
    res.writeHead(200, {
      "content-type": f.mime, "content-length": f.bytes.byteLength, "cache-control": "private, max-age=86400",
      ...(orig && { "x-asset-width": String(orig.w), "x-asset-height": String(orig.h), "access-control-expose-headers": "x-asset-width, x-asset-height" }),
    }).end(f.bytes);
    return;
  }
  if (route === "report") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" }).end(await lib.report());
    return;
  }
  if (route === "rescan" && req.method === "POST") {
    void lib.scan().catch(() => {});
    return sendJson(res, { started: true });
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
}

function unauthorised(res: ServerResponse) {
  res.writeHead(401, { "content-type": "text/plain", "www-authenticate": "Bearer" }).end("Unauthorized: this server needs its access key. Open Dragon Drop from the app, or send the key as 'Authorization: Bearer <key>'.");
}

function deny(res: ServerResponse) {
  res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden: requests must come from this computer's editor.");
}

function sendJson(res: ServerResponse, v: unknown) {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
}

function sendFile(res: ServerResponse, file: string, cache = "no-cache") {
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": cache });
  createReadStream(file).pipe(res);
}

function serveEditor(cfg: Config, pathname: string, res: ServerResponse, csp: string) {
  if (!editorBuilt(cfg)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
      "<h1>Dragon Drop server is running</h1><p>The editor hasn't been built yet. Run <code>pnpm build</code> (or use <code>pnpm dev</code> and open http://localhost:5173).</p>",
    );
    return;
  }
  const dist = path.resolve(cfg.editorDist);
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const file = path.resolve(dist, rel);
  // inside the editor folder (a plain prefix test would also let "dist-other" through)
  if (rel && file.startsWith(dist + path.sep) && existsSync(file) && statSync(file).isFile()) {
    if (file.toLowerCase().endsWith(".html")) res.setHeader("content-security-policy", csp);
    return sendFile(res, file, rel.startsWith("assets") ? "public, max-age=31536000, immutable" : "no-cache");
  }
  res.setHeader("content-security-policy", csp);
  return sendFile(res, path.join(dist, "index.html"));
}
