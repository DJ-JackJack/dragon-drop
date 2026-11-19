import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Hub } from "../src/hub.ts";
import { createAppServer } from "../src/http.ts";
import { loadConfig } from "../src/config.ts";
import { ProjectStore } from "../src/store.ts";

const PORT = 48000 + Math.floor(Math.random() * 900);
const dir = mkdtempSync(path.join(tmpdir(), "mapmaker-gone-"));
let hub: Hub, server: ReturnType<typeof createAppServer>;

beforeAll(async () => {
  hub = new Hub(new ProjectStore(dir), null);
  await hub.createProject({ name: "Soon Gone", width: 64, height: 64, kmPerPx: 2 });
  server = createAppServer(loadConfig({ port: PORT, host: "127.0.0.1", projectsDir: dir, editorDist: path.join(dir, "no-editor") }), hub);
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
});
afterAll(async () => { server.close(); await hub.close().catch(() => {}); rmSync(dir, { recursive: true, force: true }); });

describe("a client that connects while the projects folder can't be read", () => {
  it("is told the server couldn't read the projects (the socket is closed), and the server carries on", async () => {
    // (a folder that disappears between the server checking it is there and reading it, as on a drive that is unplugged: here the path is made a plain file, so reading it fails.
    // A rejection nobody handles used to stop the whole server.)
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, "not a folder");
    const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("the socket was never closed")), 5000);
    });
    expect(closed.code).toBe(1011);
    expect(closed.reason).toMatch(/could not read your projects/);
    expect((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status).toBeLessThan(500); // (still answering)
  });
});
