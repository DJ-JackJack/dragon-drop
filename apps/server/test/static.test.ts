import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createAppServer, editorCsp } from "../src/http.ts";

const PORT = 48210 + Math.floor(Math.random() * 40);
const dir = mkdtempSync(path.join(tmpdir(), "dd-static-"));
let server: ReturnType<typeof createAppServer>;

/** A raw GET (fetch would tidy the path up first, hiding what a hostile page could send). */
function get(rawPath: string, host = `127.0.0.1:${PORT}`) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, path: rawPath, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  mkdirSync(path.join(dir, "editor", "assets"), { recursive: true });
  mkdirSync(path.join(dir, "editor-other"), { recursive: true });
  writeFileSync(path.join(dir, "editor", "index.html"), "<html>EDITOR</html>");
  writeFileSync(path.join(dir, "editor", "assets", "a.js"), "console.log(1)");
  writeFileSync(path.join(dir, "editor-other", "secret.txt"), "SECRET");
  writeFileSync(path.join(dir, "secret.txt"), "SECRET");
  const cfg = loadConfig({ port: PORT, host: "127.0.0.1", projectsDir: dir, editorDist: path.join(dir, "editor") });
  server = createAppServer(cfg, {} as never); // the static routes never touch the hub
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("serving the editor", () => {
  it("sends the page with a content security policy that only allows itself", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("EDITOR");
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain(`ws://127.0.0.1:${PORT}`);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    const phone = await get("/view");
    expect(phone.body).toContain("EDITOR");
    expect(phone.headers["content-security-policy"]).toBe(csp);
  });

  it("serves assets, and refuses to walk out of the editor folder (including into a folder that shares its name's start)", async () => {
    const a = await get("/assets/a.js");
    expect(a.status).toBe(200);
    expect(a.body).toBe("console.log(1)");
    for (const bad of ["/..%2feditor-other%2fsecret.txt", "/..%2fsecret.txt", "/%2e%2e%2f%2e%2e%2fsecret.txt", "/assets/..%2f..%2feditor-other%2fsecret.txt"]) {
      const r = await get(bad);
      expect(r.body).not.toContain("SECRET");
    }
  });

  it("only allows a websocket to hosts it recognises", () => {
    expect(editorCsp("localhost:4747", ["localhost:4747"])).toContain("ws://localhost:4747 wss://localhost:4747");
    expect(editorCsp("evil.example", ["localhost:4747"])).not.toContain("evil.example");
    expect(editorCsp(undefined, [])).toContain("connect-src 'self' blob: data:");
  });
});
