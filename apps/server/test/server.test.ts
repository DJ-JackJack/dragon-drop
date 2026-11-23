import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type ServerMsg, REFERENCE_PICTURE_MAX_BYTES, buildNoiseCache, decodeFrame, serializeNoise } from "@mapmaker/core";
import type { ModelCall } from "../src/agent.ts";
import { Hub } from "../src/hub.ts";
import { createAppServer } from "../src/http.ts";
import { loadConfig } from "../src/config.ts";
import { NoiseStore } from "../src/noiseStore.ts";
import { ProjectStore, refFileName, safeFileName } from "../src/store.ts";

const PORT = 47000 + Math.floor(Math.random() * 1000);
const dir = mkdtempSync(path.join(tmpdir(), "mapmaker-test-"));
let hub: Hub;
let server: ReturnType<typeof createAppServer>;
const calls: unknown[] = [];

// A scripted "Claude": first adds an island, then looks at it, then answers.
const fakeModel: ModelCall = async (params, onEvent) => {
  calls.push(structuredClone(params)); // snapshot: the agent keeps appending to its history
  const n = calls.length;
  const base = { id: `msg_${n}`, type: "message", role: "assistant", model: params.model, stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } };
  if (n === 1) {
    onEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "add_landmass", input: {} } } as never);
    return { ...base, stop_reason: "tool_use", content: [
      { type: "tool_use", id: "tu_1", name: "add_landmass", input: { shape: { type: "circle", x: 128, y: 128, r: 50 }, height_m: 300, seed: 1 } },
    ] } as never;
  }
  if (n === 2) {
    onEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_2", name: "render_preview", input: {} } } as never);
    return { ...base, stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_2", name: "render_preview", input: { max_size: 256 } }] } as never;
  }
  onEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Added a round island." } } as never);
  return { ...base, stop_reason: "end_turn", content: [{ type: "text", text: "Added a round island." }] } as never;
};

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const cfg = loadConfig({ port: PORT, host: "127.0.0.1", projectsDir: dir, editorDist: path.join(dir, "no-editor") });
  hub = new Hub(new ProjectStore(dir), fakeModel);
  await hub.createProject({ name: "Test World", width: 256, height: 256, kmPerPx: 2 });
  hub.session.execute({ op: "generate_terrain", params: { template: "ocean", seed: 1 } }, "system");
  server = createAppServer(cfg, hub);
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
});

afterAll(async () => {
  await hub.flush();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP endpoint", () => {
  it("lists tools and builds + previews an island through MCP", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("add_mountain_range");
    expect(client.getInstructions()).toContain("MAP PIXELS");

    const add = await client.callTool({ name: "add_landmass", arguments: { shape: { type: "circle", x: 128, y: 128, r: 40 }, seed: 3 } });
    expect(add.isError).toBe(false);
    const prev = await client.callTool({ name: "render_preview", arguments: { max_size: 512 } });
    const img = (prev.content as { type: string; mimeType?: string }[]).find((c) => c.type === "image");
    expect(img?.mimeType).toBe("image/jpeg");
    const bad = await client.callTool({ name: "sculpt", arguments: { mode: "nope" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });

  it("rejects requests from other websites and other hosts", async () => {
    const evil = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}",
    });
    expect(evil.status).toBe(403);
    // fetch() won't forge a Host header, so use a raw request (what a DNS-rebinding page would send)
    const rebindingStatus = await new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", headers: { host: `attacker.example:${PORT}` } },
        (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject);
    });
    expect(rebindingStatus).toBe(403);
    const ok = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    expect((await ok.json()).project).toBe("test-world");
  });
});

function connect(): Promise<{ ws: WebSocket; msgs: ServerMsg[]; frames: ReturnType<typeof decodeFrame>[]; wait: (p: () => boolean) => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const msgs: ServerMsg[] = [];
    const frames: ReturnType<typeof decodeFrame>[] = [];
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const b = data as Buffer;
        frames.push(decodeFrame(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer));
      } else msgs.push(JSON.parse(data.toString()));
    });
    const wait = async (p: () => boolean) => {
      for (let i = 0; i < 200 && !p(); i++) await new Promise((r) => setTimeout(r, 25));
      if (!p()) throw new Error("timed out waiting");
    };
    ws.on("open", () => resolve({ ws, msgs, frames, wait }));
    ws.on("error", reject);
  });
}

describe("who may talk to the server", () => {
  it("answers only this PC, whatever the environment says (the phone page and its outside address are gone)", async () => {
    const { accessPolicy } = await import("../src/http.ts");
    const prev = process.env.MAPMAKER_ALLOWED_HOSTS;
    process.env.MAPMAKER_ALLOWED_HOSTS = "my-pc.tail1234.ts.net"; // (an old setting: ignored)
    try {
      const pol = accessPolicy(loadConfig({ port: 4747, devEditorPort: null }));
      const req = (host: string, origin?: string) => ({ headers: { host, ...(origin ? { origin } : {}) } }) as unknown as http.IncomingMessage;
      expect(pol.allowed(req("127.0.0.1:4747"))).toBe(true);
      expect(pol.allowed(req("localhost:4747", "http://localhost:4747"))).toBe(true);
      expect(pol.allowed(req("my-pc.tail1234.ts.net"))).toBe(false);
      expect(pol.allowed(req("my-pc.tail1234.ts.net", "https://my-pc.tail1234.ts.net"))).toBe(false);
      expect(pol.allowed(req("192.168.1.20:4747"))).toBe(false);
      expect(pol.allowed(req("evil.example"))).toBe(false);
      expect(pol.allowed(req("127.0.0.1:4747", "https://evil.example"))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MAPMAKER_ALLOWED_HOSTS;
      else process.env.MAPMAKER_ALLOWED_HOSTS = prev;
    }
  });
});

describe("WebSocket sync", () => {
  it("sends a snapshot, then patches and history for user edits; undo works", async () => {
    const c = await connect();
    await c.wait(() => c.frames.some((f) => f.header.t === "snapshot"));
    const project = c.msgs.find((m) => m.t === "project");
    expect(project && project.t === "project" && project.meta.width).toBe(256);
    const snap = c.frames.find((f) => f.header.t === "snapshot")!;
    expect(snap.payload.length).toBe(256 * 256);

    c.ws.send(JSON.stringify({ t: "txn_begin", label: "Raise stroke" }));
    for (const x of [60, 66, 72]) {
      c.ws.send(JSON.stringify({ t: "cmd", cmd: { op: "sculpt", params: { mode: "raise", shape: { type: "circle", x, y: 60, r: 6 }, amountM: 400 } } }));
    }
    c.ws.send(JSON.stringify({ t: "txn_end" }));
    await c.wait(() => c.msgs.some((m) => m.t === "change" && m.change.label === "Raise stroke"));
    expect(c.frames.filter((f) => f.header.t === "patch").length).toBe(3);
    const change = c.msgs.find((m) => m.t === "change" && m.change.label === "Raise stroke");
    expect(change && change.t === "change" && change.change.author).toBe("user");

    c.ws.send(JSON.stringify({ t: "undo" }));
    await c.wait(() => c.msgs.some((m) => m.t === "change" && m.change.kind === "undo"));
    c.ws.close();
  });

  it("Ctrl+S: save_now writes the map and only then answers \"saved\"", async () => {
    const c = await connect();
    await c.wait(() => c.frames.some((f) => f.header.t === "snapshot"));
    c.ws.send(JSON.stringify({ t: "cmd", cmd: { op: "sculpt", params: { mode: "raise", shape: { type: "circle", x: 100, y: 100, r: 5 }, amountM: 300 } }, label: "Before saving" }));
    await c.wait(() => c.msgs.some((m) => m.t === "change" && m.change.label === "Before saving"));
    c.ws.send(JSON.stringify({ t: "save_now" }));
    await c.wait(() => c.msgs.some((m) => m.t === "saved"));
    // (it is on disk by the time the answer comes: read the file back)
    const back = await hub.store.load(hub.activeId!);
    expect(back.height.data[100 * back.meta.width + 100]).toBe(hub.session.doc.height.data[100 * back.meta.width + 100]);
    c.ws.close();
  });
});

describe("Claude Code hooks (Assist mode)", () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/api/claude-hook", method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
  const states = (c: Awaited<ReturnType<typeof connect>>) => c.msgs.filter((m) => m.t === "claude_state").map((m) => (m as { state: string }).state);

  it("tells the editor what Claude Code is doing, and answers with nothing (a hook's output can reach Claude)", async () => {
    const c = await connect();
    await c.wait(() => states(c).length >= 1);
    expect(states(c)[0]).toBe("unknown"); // nothing is ever nudged before Claude Code has reported in
    const start = await post(JSON.stringify({ hook_event_name: "SessionStart", session_id: "s" }));
    expect(start).toEqual({ status: 204, text: "" });
    await c.wait(() => states(c).includes("idle"));
    await post(JSON.stringify({ hook_event_name: "UserPromptSubmit" }));
    await c.wait(() => states(c).includes("busy"));
    await post(JSON.stringify({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }));
    await c.wait(() => states(c).includes("blocked"));
    await post(JSON.stringify({ hook_event_name: "Stop" }));
    await c.wait(() => states(c).filter((s) => s === "idle").length >= 2);
    // a new editor connecting is told the current state straight away
    const late = await connect();
    await late.wait(() => states(late).length >= 1);
    expect(states(late)[0]).toBe("idle");
    expect(hub.claudeState).toBe("idle");
    late.ws.close();
    c.ws.close();
  });

  it("shrugs off garbage, refuses GET, and refuses another website's origin", async () => {
    expect((await post("not json")).status).toBe(204);
    expect((await post(JSON.stringify([1, 2]))).status).toBe(204);
    expect(hub.claudeState).toBe("idle");
    const get = await new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: PORT, path: "/api/claude-hook" }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject);
    });
    expect(get).toBe(405);
    expect((await post(JSON.stringify({ hook_event_name: "SessionEnd" }), { origin: "https://evil.example" })).status).toBe(403);
    expect(hub.claudeState).toBe("idle"); // the foreign request changed nothing
    await post(JSON.stringify({ hook_event_name: "SessionEnd" }));
    expect(hub.claudeState).toBe("unknown");
  });
});

describe("texture noise endpoint", () => {
  const call = (method: string, query: string, body?: Uint8Array, headers: Record<string, string> = {}) => new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: `/api/noise?${query}`, method, headers: { ...(body ? { "content-length": String(body.length) } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
  const noise = (seed: number) => new Uint8Array(serializeNoise(buildNoiseCache(64, 64, seed)));

  it("is not there until the editor has stored one, then serves it back exactly", async () => {
    hub.noise = new NoiseStore(path.join(dir, "noise-cache"));
    expect((await call("GET", "w=64&h=64&seed=11")).status).toBe(404);
    const bytes = noise(11);
    expect((await call("PUT", "w=64&h=64&seed=11", bytes)).status).toBe(204);
    const got = await call("GET", "w=64&h=64&seed=11");
    expect(got.status).toBe(200);
    expect(got.body.equals(Buffer.from(bytes))).toBe(true);
    // storing it again is harmless
    expect((await call("PUT", "w=64&h=64&seed=11", bytes)).status).toBe(204);
  });

  it("refuses files that are the wrong length, for another map, or not noise at all", async () => {
    hub.noise = new NoiseStore(path.join(dir, "noise-cache"));
    const bytes = noise(12);
    expect((await call("PUT", "w=64&h=64&seed=12", bytes.subarray(0, bytes.length - 8))).status).toBe(400); // short
    expect((await call("PUT", "w=64&h=64&seed=13", bytes)).status).toBe(400); // seed 12's noise offered as seed 13's
    expect((await call("PUT", "w=64&h=64&seed=14", new Uint8Array(bytes.length))).status).toBe(400); // right size, not noise
    expect((await call("GET", "w=64&h=64&seed=13")).status).toBe(404);
    expect((await call("GET", "w=64&h=64&seed=14")).status).toBe(404);
  });

  it("only deals in sensible map sizes, GET and PUT, and not with other websites", async () => {
    hub.noise = new NoiseStore(path.join(dir, "noise-cache"));
    expect((await call("GET", "w=8&h=8&seed=1")).status).toBe(400);
    expect((await call("GET", "w=99999&h=64&seed=1")).status).toBe(400);
    expect((await call("GET", "w=abc&h=64&seed=1")).status).toBe(400);
    expect((await call("DELETE", "w=64&h=64&seed=11")).status).toBe(405);
    expect((await call("GET", "w=64&h=64&seed=11", undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("PUT", "w=64&h=64&seed=15", noise(15), { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("GET", "w=64&h=64&seed=15")).status).toBe(404); // the foreign request stored nothing
    hub.noise = null;
    expect((await call("GET", "w=64&h=64&seed=11")).status).toBe(404); // no cache folder: nothing to serve
  });
});

describe("M1 tools and derived layers", () => {
  it("styles, climate, erosion, checkpoints and comparisons work over MCP; derived layers reach the editor", async () => {
    const c = await connect();
    await c.wait(() => c.frames.some((f) => f.header.t === "snapshot"));
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBe(false);
      return r.content as { type: string; text?: string; data?: string }[];
    };
    await call("add_mountain_range", { path: [[100, 100], [110, 150]], width_px: 6, peak_m: 2500, seed: 4 });
    await call("save_checkpoint", { name: "Before erosion" });
    await call("erode", { passes: 2 });
    await call("set_climate", { lat_top: 0.8, lat_bot: 0.2, wind: "east" });
    expect(hub.session.doc.meta.climate).toMatchObject({ latTop: 0.8, latBot: 0.2, wind: "east" });
    const painted = await call("render_preview", { max_size: 256 });
    expect(painted[0].text).toContain("painted style");
    await call("set_style", { style: "relief" });
    expect((await call("render_preview", { max_size: 256 }))[0].text).toContain("relief style");
    expect((await call("list_checkpoints"))[0].text).toContain("Before erosion");
    await call("restore_checkpoint", { name: "before erosion" });
    expect(hub.session.changes.at(-1)?.label).toBe('Restore checkpoint "Before erosion"');
    // comparison against a reference image
    const png = await import("pngjs");
    const im = new png.PNG({ width: 64, height: 64 });
    im.data.fill(180);
    await hub.store.addRef("test-world", "sketch.png", new Uint8Array(png.PNG.sync.write(im)));
    const cmp = await call("compare_to_reference", { name: "sketch.png", max_size: 600 });
    expect(cmp.some((b) => b.type === "image")).toBe(true);
    await client.close();
    // derived layers (climate, rivers) are pushed to editors after edits settle
    await c.wait(() => c.frames.some((f) => f.header.t === "derived"));
    const der = c.frames.filter((f) => f.header.t === "derived").pop()!;
    expect(der.bytes.length).toBe(256 * 256 * 6);
    expect(Array.isArray(der.header.rivers)).toBe(true);
    await c.wait(() => c.msgs.some((m) => m.t === "checkpoints" && m.list.length === 1));
    c.ws.close();
  });

  it("places and labels: tools, sync to editors, gazetteer, preview, the map's picture", async () => {
    const c = await connect();
    await c.wait(() => c.msgs.some((m) => m.t === "project"));
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBe(false);
      return r.content as { type: string; text?: string }[];
    };
    await call("add_place", { name: "Test Harbour", type: "port", x: 120, y: 140, notes: "a test" });
    await call("add_label", { text: "Quiet Sea", kind: "sea", x: 60, y: 60, angle: -10, curve: 0.2 });
    await call("update_place", { place: "test harbour", x: 125, hide_marker: true });
    expect((await call("list_places"))[0].text).toContain("\"x\": 125");
    expect(hub.session.doc.features!.places[0].hideMarker).toBe(true);
    expect((await call("export_gazetteer"))[0].text).toContain("| Test Harbour | port | (125, 140)");
    await c.wait(() => c.msgs.some((m) => m.t === "features" && m.features.labels.length === 1 && m.features.places[0]?.x === 125));
    const prev = await call("render_preview", { max_size: 256 });
    expect(prev.some((b) => b.type === "image")).toBe(true);
    await call("remove_label", { label: "Quiet Sea" });
    await call("undo");
    expect(hub.session.doc.features!.labels).toHaveLength(1);
    // a label that follows a line: midpoint as its position; moving shifts the line; [] straightens it
    await call("add_label", { text: "Spine Range", kind: "range", path: [[10, 10], [60, 10], [60, 50]], spread: true });
    const spine = () => hub.session.doc.features!.labels.find((l) => l.text === "Spine Range")!;
    expect(spine()).toMatchObject({ x: 55, y: 10, spread: true }); // halfway along the 90-px line
    await call("update_label", { label: "Spine Range", x: 65 });
    expect(spine().path).toEqual([[20, 10], [70, 10], [70, 50]]);
    await call("update_label", { label: "Spine Range", path: [] });
    expect(spine().path).toBeUndefined();
    await call("remove_label", { label: "Spine Range" });

    // climate regions: recompute the climate, undoably
    const tempAt = async (x: number, y: number) => {
      const W = hub.session.doc.height.w;
      return (await (hub as unknown as { refreshDerived(op: unknown, force: boolean): Promise<{ temp: Uint8Array }> })
        .refreshDerived((hub as unknown as { open: unknown }).open, true)).temp[y * W + x];
    };
    const before = await tempAt(128, 128);
    await call("add_climate_region", { name: "Test Frost", shape: { type: "circle", x: 128, y: 128, r: 40 }, temperature: 0, snow: 1, border: "hard" });
    expect((await call("list_climate_regions"))[0].text).toContain("Test Frost");
    const frozen = await tempAt(128, 128);
    expect(frozen).toBeLessThan(before - 40);
    await call("update_climate_region", { region: "Test Frost", temperature: null });
    expect(hub.session.doc.features!.regions![0].temperature).toBeUndefined();
    await call("remove_climate_region", { region: "Test Frost" });
    expect(hub.session.doc.features!.regions).toHaveLength(0);
    await call("undo");
    expect(hub.session.doc.features!.regions).toHaveLength(1);
    await call("remove_climate_region", { region: "Test Frost" });
    await client.close();
    const img = await fetch(`http://127.0.0.1:${PORT}/api/projects/test-world/picture.jpg?max=300`);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await fetch(`http://127.0.0.1:${PORT}/api/projects/nope/picture.jpg`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${PORT}/api/projects/test-world/render.jpg`)).headers.get("content-type")).not.toBe("image/jpeg"); // (the phone page's picture is gone)
    c.ws.close();
  });
});

describe("grid", () => {
  it("set_grid draws nothing until asked, is undoable, persists, and doesn't recompute the climate", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBe(false);
      return r.content as { type: string; text?: string }[];
    };
    expect(hub.session.doc.meta.grid).toBeUndefined();
    const before = hub.session.doc.meta.kmPerPx;
    const made = JSON.parse((await call("set_grid", { type: "hex", size_miles: 12 }))[0].text!);
    expect(made.grid).toMatchObject({ type: "hex", sizeMi: 12, orient: "pointy" });
    expect(made.cell_px).toBeCloseTo(12 / 0.621371 / before, 1);
    await call("set_grid", { type: "square", size_miles: 5, opacity: 0.8 });
    expect(hub.session.doc.meta.grid).toMatchObject({ type: "square", sizeMi: 5, opacity: 0.8 });
    // a size is remembered when only the type changes, and is clamped to sensible bounds
    await call("set_grid", { type: "hex" });
    expect(hub.session.doc.meta.grid).toMatchObject({ type: "hex", sizeMi: 5 });
    await call("set_grid", { type: "hex", size_miles: 1e9 });
    expect(hub.session.doc.meta.grid!.sizeMi).toBeLessThan(1e9);
    await call("undo", { steps: 4 });
    expect(hub.session.doc.meta.grid).toBeUndefined();
    await hub.flush();
    await call("set_grid", { type: "hex", size_miles: 6 });
    await hub.flush();
    expect((await hub.store.load("test-world")).meta.grid).toMatchObject({ type: "hex", sizeMi: 6 });
    await call("set_grid", { type: "off" });
    await client.close();
  }, 30000);
});

describe("sketch to terrain", () => {
  it("import_sketch reads a drawing into terrain, asks before replacing, saves a checkpoint and undoes", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    // a drawing: blue sea, a green island, a red line across it
    const png = await import("pngjs");
    const im = new png.PNG({ width: 120, height: 90 });
    for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) {
      const o = (y * 120 + x) * 4, inIsland = Math.hypot(x - 60, y - 45) < 28, onLine = inIsland && Math.abs(y - 45) <= 1 && x > 40 && x < 80;
      const c = onLine ? [220, 40, 40] : inIsland ? [90, 150, 70] : [30, 60, 130];
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
    await hub.store.addRef("test-world", "island-drawing.png", new Uint8Array(png.PNG.sync.write(im)));
    const refused = await raw("import_sketch", { name: "island-drawing.png" });
    expect(refused.isError).toBe(true); // the map has land: it must ask first
    expect(JSON.stringify(refused.content)).toContain("replace_existing");
    const before = new Float32Array(hub.session.doc.height.data);
    const ok = await raw("import_sketch", { name: "island-drawing.png", replace_existing: true, erosion_passes: 0, seed: 3 });
    expect(ok.isError, JSON.stringify(ok.content).slice(0, 300)).toBeFalsy();
    const out = JSON.parse((ok.content as { text: string }[])[0].text);
    expect(out.land_percent).toBeGreaterThan(5);
    expect(out.land_percent).toBeLessThan(40);
    expect(out.mountain_stroke_cells).toBeGreaterThan(0);
    const heights = hub.session.doc.height;
    expect(heights.data[128 * 256 + 128]).toBeGreaterThan(300); // the middle of the island, on the red line: high
    expect(heights.data[3 * 256 + 3]).toBeLessThan(-500); // the corner is deep sea
    expect((await hub.store.listCheckpoints("test-world")).some((c) => c.name === "Before sketch import")).toBe(true);
    expect((await raw("import_sketch", { name: "missing.png", replace_existing: true })).isError).toBe(true);
    await raw("undo");
    expect(Array.from(hub.session.doc.height.data.subarray(0, 4096))).toEqual(Array.from(before.subarray(0, 4096)));
    await client.close();
  }, 60000);
});

describe("reference pictures", () => {
  const base = `http://127.0.0.1:${PORT}`;
  const upload = (name: string, body: Uint8Array<ArrayBuffer>, id = hub.activeId!) =>
    fetch(`${base}/api/projects/${id}/refs`, { method: "POST", headers: { "x-file-name": encodeURIComponent(name), "content-type": "application/octet-stream" }, body });
  let pngBytes: Uint8Array<ArrayBuffer>;
  beforeAll(async () => {
    const png = await import("pngjs");
    const im = new png.PNG({ width: 40, height: 30 });
    im.data.fill(120);
    pngBytes = new Uint8Array(png.PNG.sync.write(im));
  });

  it("refFileName makes a safe name that ends in what the picture really is", () => {
    const cases: [string, "png" | "jpeg" | "webp", string][] = [
      ["map.png", "png", "map.png"], ["photo.JPEG", "jpeg", "photo.jpeg"], ["photo.jpg", "jpeg", "photo.jpg"], ["scan.webp", "png", "scan.png"],
      ["..\\..\\evil.png", "png", "evil.png"], ["../../evil.png", "png", "evil.png"], ["___.png", "png", "picture.png"], ["", "webp", "picture.webp"],
      ["CON.png", "png", "picture-CON.png"], ["Café map.png", "png", "Cafe map.png"], ["(1) Old map: north.PNG.jpg", "png", "1_ Old map_ north.PNG.png"],
      ["a..b.png", "png", "a.b.png"], ["trailing dots... .png", "png", "trailing dots.png"],
    ];
    for (const [given, kind, want] of cases) expect(refFileName(given, kind), given).toBe(want);
    const long = refFileName(`${"x".repeat(300)}.png`, "png");
    expect(long.length).toBeLessThanOrEqual(105);
    for (const [given, kind] of cases) expect(() => safeFileName(refFileName(given, kind))).not.toThrow();
  });

  it("keeps an uploaded picture under a safe name with its real ending, with its size, and tells every editor", async () => {
    const c = await connect();
    await c.wait(() => c.msgs.some((m) => m.t === "project"));
    const r = await upload("(1) Old map: north.jpg", pngBytes); // (called .jpg, but it is a PNG)
    expect(r.status, await r.clone().text()).toBe(200);
    const ref = await r.json();
    expect(ref).toMatchObject({ name: "1_ Old map_ north.png", w: 40, h: 30, bytes: pngBytes.byteLength });
    await c.wait(() => c.msgs.some((m) => m.t === "refs" && m.refs.some((x) => x.name === ref.name && x.w === 40)));
    const back = await fetch(`${base}${ref.url}`);
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(pngBytes);
    // the same name again gets -2
    expect((await (await upload("(1) Old map: north.jpg", pngBytes)).json()).name).toBe("1_ Old map_ north-2.png");
    c.ws.close();
  });

  it("refuses what isn't a PNG, JPEG or still WebP, with a note that says what to do", async () => {
    const before = (await hub.store.listRefs(hub.activeId!)).length;
    const pad = (s: number[]) => new Uint8Array([...s, ...new Array(60).fill(0)]);
    const gif = await upload("dance.gif", pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
    expect(gif.status).toBe(415);
    expect(await gif.text()).toMatch(/"dance\.gif" is a GIF.*Save it as PNG or JPEG/);
    const heic = await upload("IMG_0001.png", pad([0, 0, 0, 0x18, ...[..."ftypheic"].map((ch) => ch.charCodeAt(0))])); // (named .png, but it is an iPhone photo)
    expect(heic.status).toBe(415);
    expect(await heic.text()).toMatch(/iPhone photo/);
    const text = await upload("notes.png", new TextEncoder().encode("just some words, not a picture at all"));
    expect(text.status).toBe(415);
    expect(await text.text()).toMatch(/only PNG, JPEG and WebP/);
    expect((await upload("empty.png", new Uint8Array(0))).status).toBe(415);
    expect((await fetch(`${base}/api/projects/${hub.activeId}/refs`)).status).toBe(405); // (only POST adds)
    expect((await upload("a.png", pngBytes, "not-the-open-map")).status).toBe(400);
    expect((await hub.store.listRefs(hub.activeId!)).length).toBe(before);
  });

  it("refuses a picture over 30 MB without reading all of it", async () => {
    const answer = await new Promise<{ code: number; text: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: PORT, path: `/api/projects/${hub.activeId}/refs`, method: "POST", headers: { "content-length": String(REFERENCE_PICTURE_MAX_BYTES + 1), "x-file-name": "huge.png" } }, (res) => {
        let t = "";
        res.on("data", (d) => { t += d; });
        res.on("end", () => resolve({ code: res.statusCode ?? 0, text: t }));
      });
      req.on("error", reject);
      req.write(pngBytes); // (a start; the server answers from the declared size)
    });
    expect(answer.code).toBe(413);
    expect(answer.text).toMatch(/"huge\.png" is 30 MB, and a picture can be at most 30 MB/);
  });

  it("renames a picture (its type stays) and removes it into the map's backups folder", async () => {
    const id = hub.activeId!;
    const c = await connect();
    await c.wait(() => c.msgs.some((m) => m.t === "project"));
    // send a message, then wait for an answer to it (only messages that arrive after it count)
    const sendAndWait = async (msg: object, p: (m: ServerMsg) => boolean) => {
      const from = c.msgs.length;
      c.ws.send(JSON.stringify(msg));
      await c.wait(() => c.msgs.slice(from).some(p));
    };
    const name = (await (await upload("to-rename.png", pngBytes)).json()).name as string;
    await sendAndWait({ t: "ref_rename", name, to: "North coast.jpg" }, (m) => m.t === "refs" && m.refs.some((x) => x.name === "North coast.png"));
    expect((await hub.store.listRefs(id)).some((x) => x.name === name)).toBe(false);
    // a name that is taken is refused; a change of capitals only is fine
    await upload("Other.png", pngBytes);
    await sendAndWait({ t: "ref_rename", name: "North coast.png", to: "Other" }, (m) => m.t === "error" && /already a picture called Other\.png/.test(m.message));
    await sendAndWait({ t: "ref_rename", name: "North coast.png", to: "north coast" }, (m) => m.t === "refs" && m.refs.some((x) => x.name === "north coast.png"));
    // removing moves the file to backups/removed-pictures
    await sendAndWait({ t: "ref_remove", name: "north coast.png" }, (m) => m.t === "refs" && !m.refs.some((x) => x.name === "north coast.png"));
    expect(existsSync(path.join(dir, id, "backups", "removed-pictures", "north coast.png"))).toBe(true);
    await sendAndWait({ t: "ref_remove", name: "north coast.png" }, (m) => m.t === "error" && /no picture called/.test(m.message));
    await sendAndWait({ t: "ref_remove", name: "../project.json" }, (m) => m.t === "error" && /Invalid file name|no picture called/.test(m.message));
    expect(existsSync(path.join(dir, id, "project.json"))).toBe(true);
    c.ws.close();
  });

  it("chat attachments follow the same rules: a GIF is left out with a note, and a message with nothing left isn't sent", async () => {
    const c = await connect();
    await c.wait(() => c.msgs.some((m) => m.t === "project"));
    const n = calls.length;
    c.ws.send(JSON.stringify({ t: "chat_send", text: "", images: [{ name: "x.gif", mediaType: "image/png", data: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary").toString("base64") }] }));
    await c.wait(() => c.msgs.some((m) => m.t === "error" && /Left out of your message: "x\.gif" is a GIF/.test(m.message)));
    await new Promise((r) => setTimeout(r, 100));
    expect(calls.length).toBe(n);
    c.ws.close();
  });
});

describe("the trace picture", () => {
  it("Claude lays a reference picture over the map, lines it up with two pins, sees it in a preview, and respects the DM's lock", async () => {
    const png = await import("pngjs");
    const im = new png.PNG({ width: 200, height: 100 });
    im.data.fill(200);
    const up = await fetch(`http://127.0.0.1:${PORT}/api/projects/${hub.activeId}/refs`, { method: "POST", headers: { "x-file-name": "trace-me.png" }, body: new Uint8Array(png.PNG.sync.write(im)) });
    expect(up.status).toBe(200);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const textOf = (r: Awaited<ReturnType<typeof raw>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");

    if (hub.session.doc.features?.trace) hub.session.execute({ op: "features", patch: { setTrace: null } }, "user");
    expect(textOf(await raw("get_trace_picture"))).toMatch(/no trace picture/);
    expect((await raw("set_trace_picture", { name: "missing.png" })).isError).toBe(true);
    // with only a name it is fitted inside the 256 x 256 map
    const fitted = await raw("set_trace_picture", { name: "trace-me.png" });
    expect(fitted.isError, textOf(fitted)).toBeFalsy();
    expect(hub.session.doc.features?.trace).toMatchObject({ ref: "trace-me.png", w: 200, h: 100, x: 0, y: 64, rotation: 0 });
    expect(hub.session.doc.features!.trace!.scale).toBeCloseTo(1.28);
    // two pins: picture (0, 0) to map (20, 30) and picture (200, 0) to map (20, 130): half size, turned a quarter clockwise
    const pinned = await raw("set_trace_picture", { name: "trace-me.png", pins: [{ picture: [0, 0], map: [20, 30] }, { picture: [200, 0], map: [20, 130] }] });
    expect(pinned.isError, textOf(pinned)).toBeFalsy();
    const t = hub.session.doc.features!.trace!;
    expect([t.x, t.y, t.scale, t.rotation].map((n) => Math.round(n * 1000) / 1000)).toEqual([20, 30, 0.5, 90]);
    expect(textOf(await raw("get_trace_picture"))).toMatch(/"rotation_degrees": 90/);
    // the preview draws it only when asked
    expect(textOf(await raw("render_preview", { max_size: 256 }))).not.toMatch(/trace picture/);
    expect(textOf(await raw("render_preview", { max_size: 256, trace: true }))).toMatch(/the trace picture trace-me\.png drawn half see-through/);
    // locked by the DM: Claude can neither move nor remove it
    hub.session.execute({ op: "features", patch: { setTrace: { ...t, locked: true } } }, "user");
    expect(textOf(await raw("set_trace_picture", { name: "trace-me.png", x: 0 }))).toMatch(/locked/);
    expect((await raw("clear_trace_picture")).isError).toBe(true);
    hub.session.execute({ op: "features", patch: { setTrace: t } }, "user");
    await client.close();
  }, 60000);

  it("follows its picture: renamed with it, taken away with it (and Undo brings it back)", async () => {
    const c = await connect();
    await c.wait(() => c.msgs.some((m) => m.t === "project"));
    const sendAndWait = async (msg: object, p: (m: ServerMsg) => boolean) => {
      const from = c.msgs.length;
      c.ws.send(JSON.stringify(msg));
      await c.wait(() => c.msgs.slice(from).some(p));
    };
    expect(hub.session.doc.features?.trace?.ref).toBe("trace-me.png");
    await sendAndWait({ t: "ref_rename", name: "trace-me.png", to: "Old coast" }, (m) => m.t === "refs" && m.refs.some((r) => r.name === "Old coast.png"));
    expect(hub.session.doc.features?.trace?.ref).toBe("Old coast.png");
    expect(hub.session.changes.at(-1)?.label).toBe("Trace picture renamed to Old coast.png");
    await sendAndWait({ t: "ref_remove", name: "Old coast.png" }, (m) => m.t === "refs" && !m.refs.some((r) => r.name === "Old coast.png"));
    expect(hub.session.doc.features?.trace).toBeUndefined();
    expect(hub.session.changes.at(-1)?.label).toBe("Stop tracing Old coast.png (the picture was removed)");
    hub.session.undo("user");
    expect(hub.session.doc.features?.trace?.ref).toBe("Old coast.png");
    hub.session.execute({ op: "features", patch: { setTrace: null } }, "user");
    c.ws.close();
  });
});

describe("map extras", () => {
  it("set_map_furniture sets, merges, clears, undoes and persists", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBe(false);
      return r.content as { type: string; text?: string }[];
    };
    await call("set_map_furniture", { title: "  Test Title ", scale_bar: true });
    expect(hub.session.doc.meta.furniture).toEqual({ title: "Test Title", scaleBar: true });
    await call("set_map_furniture", { compass: true, units: "km" });
    expect(hub.session.doc.meta.furniture).toMatchObject({ title: "Test Title", scaleBar: true, compass: true, units: "km" });
    await call("set_map_furniture", { title: "" });
    expect(hub.session.doc.meta.furniture!.title).toBeUndefined();
    await call("undo");
    expect(hub.session.doc.meta.furniture!.title).toBe("Test Title");
    await hub.flush();
    expect((await hub.store.load("test-world")).meta.furniture).toMatchObject({ title: "Test Title", compass: true });
    await call("undo", { steps: 3 });
    expect(hub.session.doc.meta.furniture).toBeUndefined();
    await client.close();
  }, 30000);
});

describe("roads and borders", () => {
  it("routes roads over the terrain, draws borders, lists, edits and removes them", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBe(false);
      return r.content as { type: string; text?: string }[];
    };
    const doc = hub.session.doc;
    // find two land points a fair distance apart
    const land: [number, number][] = [];
    for (let y = 20; y < 236 && land.length < 400; y += 4) for (let x = 20; x < 236; x += 4) if (doc.height.data[y * 256 + x] > 40) land.push([x, y]);
    expect(land.length).toBeGreaterThan(10);
    // the test world has several islands: take the first pair of far-apart points that a road can join
    let a = land[0], b = land[land.length - 1], first: { type: string; text?: string }[] | null = null;
    outer: for (const p of land.slice(0, 6)) {
      for (const q of [...land].reverse().slice(0, 40)) {
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 30) continue;
        const r = await client.callTool({ name: "route_road", arguments: { from: p, to: q, name: "Test Road" } });
        if (!r.isError) { a = p; b = q; first = r.content as { type: string; text?: string }[]; break outer; }
      }
    }
    expect(first, "no two far-apart land points on one island").not.toBeNull();
    const made = JSON.parse(first![0].text!);
    expect(made.line).toMatchObject({ kind: "road", name: "Test Road" });
    expect(made.line.length_km).toBeGreaterThan(0);
    expect(made.days_on_foot).toBeGreaterThan(0);
    await call("add_line", { kind: "border", closed: true, name: "Test March", points: [[30, 30], [80, 30], [80, 80]] });
    expect(hub.session.doc.features!.lines!.map((l) => l.kind).sort()).toEqual(["border", "road"]);
    const listed = JSON.parse((await call("list_lines"))[0].text!);
    expect(listed).toHaveLength(2);
    await call("update_line", { line: "Test March", kind: "trail", closed: false });
    expect(hub.session.doc.features!.lines!.find((l) => l.name === "Test March")).toMatchObject({ kind: "trail" });
    expect((await call("render_preview", { max_size: 256 })).some((c) => c.type === "image")).toBe(true);
    await call("remove_line", { line: "Test Road" });
    await call("undo");
    expect(hub.session.doc.features!.lines).toHaveLength(2);
    await call("remove_line", { line: "Test Road" });
    await call("remove_line", { line: "Test March" });
    // a route that can't be found says so
    const sea: [number, number] = [2, 2];
    expect(doc.height.data[2 * 256 + 2]).toBeLessThan(0);
    const bad = await client.callTool({ name: "route_road", arguments: { from: sea, to: b } });
    expect(bad.isError === true || /sea|water|land/i.test(JSON.stringify(bad.content))).toBe(true);
    await client.close();
  }, 60000);
});

describe("reefs across the straits", () => {
  it("measures the straits of a ring of islands, draws reefs across them, edits and undoes them", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    await call("create_map", { name: "Test Ring", width: 256, height: 256, km_per_px: 4 });
    const doc = hub.session.doc, W = 256;
    doc.height.data.fill(-400);
    const disc = (cx: number, cy: number, r: number) => { for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) <= r) doc.height.data[y * W + x] = 80; };
    for (let k = 0; k < 5; k++) { const a = (k / 5) * 2 * Math.PI; disc(128 + 90 * Math.sin(a), 128 - 90 * Math.cos(a), 24); }
    disc(128, 128, 20);
    await call("add_place", { name: "Test Crater", type: "landmark", x: 128, y: 128 });

    const found = await call("find_straits");
    expect(found.centre).toEqual([128, 128]); // the named place is the middle of the ring
    expect(found.ring_islands).toHaveLength(5);
    expect(found.straits).toHaveLength(5);
    for (const s of found.straits) {
      expect(s.width_px).toBeGreaterThan(30);
      expect(Math.abs(s.width_km - s.width_px * 4)).toBeLessThanOrEqual(4); // (the km figure comes from the unrounded width)
    }
    const lineList = async () => {
      const r = await raw("list_lines");
      const t = (r.content as { text: string }[])[0].text;
      return t.startsWith("[") ? (JSON.parse(t) as { id: string; kind: string; name?: string }[]) : [];
    };
    expect(await lineList()).toHaveLength(0);

    const added = await call("add_strait_reefs", { which: [0, 2], notes: "Guarded by razor reefs." });
    expect(added.added).toHaveLength(2);
    const lines = await lineList();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "reef", name: "Razor reefs" });
    const all = await call("add_strait_reefs", { name: "Reefs" });
    expect(all.added).toHaveLength(5);
    expect(await lineList()).toHaveLength(7);
    expect(await raw("add_strait_reefs", { which: [99] })).toMatchObject({ isError: true });
    // they are ordinary lines: retype one by hand
    await call("update_line", { line: added.added[0].id, name: "The Teeth" });
    expect((await lineList()).some((l) => l.name === "The Teeth")).toBe(true);
    // the whole batch undoes as one step
    await raw("undo");
    await raw("undo");
    expect(await lineList()).toHaveLength(2);
    // the outer coasts: measure first, then fringe them, leaving one island clear
    const dry = await call("add_coast_reefs", { dry_run: true });
    expect(dry.would_add).toBeGreaterThanOrEqual(5);
    expect(dry.total_km).toBeGreaterThan(500);
    const before = (await lineList()).length;
    const kept = await call("add_coast_reefs", { clear: [{ circle: { x: 128, y: 38, r: 40 } }], name: "Outer reefs" });
    expect(kept.added).toBe(dry.would_add - 1); // the cleared northern island's shore is not drawn
    expect(kept.total_km).toBeLessThan(dry.total_km);
    expect((await lineList()).length).toBe(before + kept.added);
    expect((await lineList()).filter((l) => l.name === "Outer reefs")).toHaveLength(kept.added);
    await raw("undo"); // one step takes all of them away again
    expect((await lineList()).length).toBe(before);
    // bare dark stone: a region that only changes the ground, then removed again
    const stone = await call("add_climate_region", { name: "Test stone", shape: { type: "circle", x: 128, y: 128, r: 40 }, rock: 1 });
    expect(stone.region.rock).toBe(1);
    expect(stone.region.temperature).toBeUndefined();
    const regions = JSON.parse(((await raw("list_climate_regions")).content as { text: string }[])[0].text);
    expect(regions[0]).toMatchObject({ name: "Test stone", rock: 1 });
    const half = await call("update_climate_region", { region: "Test stone", rock: 0.5 });
    expect(half.region.rock).toBe(0.5);
    await call("update_climate_region", { region: "Test stone", rock: null });
    expect(JSON.parse(((await raw("list_climate_regions")).content as { text: string }[])[0].text)[0].rock).toBeUndefined();
    // a reef can be drawn by hand too
    const hand = await call("add_line", { kind: "reef", points: [[10, 10], [40, 14], [70, 10]], name: "Shoal" });
    expect(hand.line.kind).toBe("reef");
    const preview = (await raw("render_preview", { max_size: 400 })).content as { type: string }[];
    expect(preview.some((b) => b.type === "image")).toBe(true);
    // not on a battlemap
    await call("open_project", { id: "test-world" });
    await client.close();
  }, 60000);
});

describe("river sources and the water check", () => {
  it("adds a source at a place or a point, follows the place, lists, edits, removes and undoes", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    await call("create_map", { name: "Test Falls", width: 256, height: 256, km_per_px: 4 });
    const doc = hub.session.doc, W = 256;
    // a plain slope of land running south into the sea
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) doc.height.data[y * W + x] = y >= 200 ? -300 : 300 + (200 - y) * 3;
    await call("add_place", { name: "Test Falls", type: "landmark", x: 128, y: 60 });
    expect(await raw("list_river_sources")).toMatchObject({ isError: false });

    // refuses the sea, a missing place and no position
    expect(await raw("add_river_source", { x: 128, y: 230 })).toMatchObject({ isError: true });
    expect(await raw("add_river_source", { place: "Nowhere" })).toMatchObject({ isError: true });
    expect(await raw("add_river_source", {})).toMatchObject({ isError: true });

    const added = await call("add_river_source", { place: "Test Falls", size: "major" });
    expect(added.source).toMatchObject({ placeId: expect.any(String), size: "major" });
    expect(added.share_of_map_runoff).toBe(0.03);
    expect(await raw("add_river_source", { place: "Test Falls" })).toMatchObject({ isError: true }); // one per place
    const listed = await call("list_river_sources");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ place: "Test Falls", size: "major", river: null, at: { x: 128, y: 60 } });

    // the rivers are worked out: a river runs from the source down to the sea
    const check = async () => {
      const r = await call("check_hydrology");
      return r as { riverCount: number; riverLengthKm: number; sources: { drawn: boolean; reaches: string | null; lengthKm: number }[]; notes: string[] };
    };
    let hydro = await check();
    for (let i = 0; i < 40 && !hydro.sources.length; i++) { await new Promise((r) => setTimeout(r, 250)); hydro = await check(); }
    expect(hydro.sources).toHaveLength(1);
    expect(hydro.sources[0]).toMatchObject({ drawn: true, reaches: "sea" });
    expect(hydro.sources[0].lengthKm).toBeGreaterThan(300);
    expect(Array.isArray(hydro.notes)).toBe(true);
    expect((await call("list_river_sources"))[0]).toMatchObject({ makes_a_river: true, reaches: "sea" });

    // the source follows its place
    await call("update_place", { place: "Test Falls", x: 60, y: 80 });
    expect((await call("list_river_sources"))[0].at).toEqual({ x: 60, y: 80 });
    expect(await raw("update_river_source", { source: "Test Falls", x: 10, y: 10 })).toMatchObject({ isError: true }); // move the place instead

    // a name, a size, a second source by point
    const named = await call("update_river_source", { source: "Test Falls", size: "great", name: "Test River" });
    expect(named.source).toMatchObject({ size: "great", name: "Test River" });
    expect((await call("list_river_sources"))[0].river).toBe("Test River");
    const second = await call("add_river_source", { x: 200, y: 100, size: "stream" });
    expect((await call("list_river_sources"))).toHaveLength(2);
    expect(await raw("update_river_source", { source: second.source.id, x: 200, y: 240 })).toMatchObject({ isError: true }); // into the sea
    await call("update_river_source", { source: "Test River", name: null });
    expect((await call("list_river_sources"))[0].river).toBeNull();

    // removing the place takes its source with it; undo brings both back
    await call("remove_place", { place: "Test Falls" });
    expect(await call("list_river_sources")).toHaveLength(1);
    await raw("undo");
    expect(await call("list_river_sources")).toHaveLength(2);
    await call("remove_river_source", { source: second.source.id });
    expect(await call("list_river_sources")).toHaveLength(1);
    await call("remove_river_source", { source: "Test Falls" });
    expect((await raw("list_river_sources")).content).toMatchObject([{ text: expect.stringContaining("No river sources") }]);
    expect(await raw("remove_river_source", { source: "Test Falls" })).toMatchObject({ isError: true });
    await call("remove_place", { place: "Test Falls" });
    await call("open_project", { id: "test-world" }); // (the tests after this one use the first map)
    await client.close();
  }, 60000);
});

describe("named rivers and lakes, carving valleys", () => {
  it("names a river, lists, renames and removes names, previews and carves valleys, and switches lowland rivers on", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    await call("create_map", { name: "Test Rivers", width: 256, height: 256, km_per_px: 4 });
    const doc = hub.session.doc, W = 256;
    // land falling south into the sea, with a great river fed in at the top
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) doc.height.data[y * W + x] = y >= 200 ? -300 : 300 + (200 - y) * 3 + Math.sin(x / 11) * 6;
    await call("add_river_source", { x: 128, y: 20, size: "great" });
    type Listed = { named: { name: string; found: boolean; length_km?: number; ends?: string }[]; unnamed_rivers: { length_km: number; point: [number, number]; ends: string }[] };
    let listed = (await call("list_waters")) as Listed;
    for (let i = 0; i < 40 && !listed.unnamed_rivers.some((r) => r.length_km > 400); i++) { await new Promise((r) => setTimeout(r, 250)); listed = await call("list_waters"); }
    const big = listed.unnamed_rivers[0];
    expect(big.length_km).toBeGreaterThan(400);

    // naming: on the river, never twice, never where there is no water
    const named = await call("name_water", { name: "Test River", x: big.point[0], y: big.point[1] });
    expect(named.named).toMatchObject({ kind: "river", name: "Test River" });
    expect(named).toMatchObject({ found: true, ends: "sea" });
    expect(await raw("name_water", { name: "Again", x: big.point[0], y: big.point[1] })).toMatchObject({ isError: true });
    expect(await raw("name_water", { name: "Nowhere", x: 5, y: 250 })).toMatchObject({ isError: true });
    listed = await call("list_waters");
    expect(listed.named[0]).toMatchObject({ name: "Test River", found: true, ends: "sea" });
    expect(listed.named[0].length_km).toBeGreaterThan(400);
    expect(listed.unnamed_rivers.some((r) => r.length_km === big.length_km && r.point[0] === big.point[0])).toBe(false);
    // the editors are sent its label along the river
    expect(hub.waterView()?.labels[0]).toMatchObject({ text: "Test River", kind: "feature", path: expect.any(Array) });
    // the DM selects it: Claude sees what it is
    hub.setSelection({ kind: "feature", featureKind: "water", id: named.named.id }, false);
    const sel = await call("get_selection");
    expect(sel.description).toBe('the river "Test River"');
    expect(sel.feature).toMatchObject({ name: "Test River", found: true, end: "sea" });
    hub.setSelection(null, false);
    // previews draw it
    const preview = (await raw("render_preview", { max_size: 400 })).content as { type: string }[];
    expect(preview.some((b) => b.type === "image")).toBe(true);
    // renaming and removing
    expect((await call("name_water", { water: "Test River", name: "Long Water" })).renamed.name).toBe("Long Water");
    expect(doc.features?.waterNames?.map((w) => w.name)).toEqual(["Long Water"]);

    // carving: a preview changes nothing; carving lowers the land, saves a checkpoint, and undo takes it back
    const before = new Float32Array(doc.height.data);
    const pv = (await raw("carve_valleys", { preview: true, strength: 0.6 })).content as { type: string; text?: string }[];
    expect(pv.some((b) => b.type === "image")).toBe(true);
    expect(doc.height.data).toEqual(before);
    const carved = await call("carve_valleys", { strength: 0.6 });
    expect(carved.cells_lowered).toBeGreaterThan(100);
    expect(carved.checkpoint).toBe("Before carving valleys");
    let lowered = 0;
    for (let i = 0; i < before.length; i++) { expect(doc.height.data[i]).toBeLessThanOrEqual(before[i] + 1e-3 + (before[i] <= 0 ? 400 : 0)); if (doc.height.data[i] < before[i] - 0.5) lowered++; }
    expect(lowered).toBeGreaterThan(100);
    expect(JSON.stringify((await raw("list_checkpoints")).content)).toContain("Before carving valleys");
    await raw("undo");
    expect(doc.height.data).toEqual(before);
    // the name is still on its river after all that
    expect((await call("list_waters")).named[0]).toMatchObject({ name: "Long Water", found: true });

    // lowland rivers are a climate setting
    await call("set_climate", { lowland_rivers: true });
    expect(doc.meta.climate?.lowlandRivers).toBe(true);
    await call("remove_water_name", { water: "Long Water" });
    expect(doc.features?.waterNames).toEqual([]);
    expect(await raw("remove_water_name", { water: "Long Water" })).toMatchObject({ isError: true });
    await call("open_project", { id: "test-world" }); // (the tests after this one use the first map)
    await client.close();
  }, 60000);

  it("carves along one river or inside the selection, and draws a river the water then follows", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    await call("create_map", { name: "Test Drawn Rivers", width: 256, height: 256, km_per_px: 4 });
    const doc = hub.session.doc, W = 256;
    // land falling south into the sea, with a great river fed in at the top
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) doc.height.data[y * W + x] = y >= 200 ? -300 : 300 + (200 - y) * 3 + Math.sin(x / 11) * 6;
    await call("add_river_source", { x: 128, y: 20, size: "great" });
    let listed = await call("list_waters");
    for (let i = 0; i < 40 && !listed.unnamed_rivers.some((r: { length_km: number }) => r.length_km > 400); i++) { await new Promise((r) => setTimeout(r, 250)); listed = await call("list_waters"); }
    const big = listed.unnamed_rivers[0];
    await call("name_water", { name: "Test River", x: big.point[0], y: big.point[1] });
    const before = new Float32Array(doc.height.data);
    const changed = () => { const out: number[] = []; for (let i = 0; i < before.length; i++) if (doc.height.data[i] !== before[i]) out.push(i); return out; };

    // along one named river
    const one = await call("carve_valleys", { river: "Test River", strength: 0.6 });
    expect(one.where).toBe("Test River");
    expect(one.cells_lowered).toBeGreaterThan(50);
    expect(changed().every((i) => Math.abs((i % W) - 128) < 40)).toBe(true);
    await raw("undo");
    expect(doc.height.data).toEqual(before);
    expect(await raw("carve_valleys", { river: "No Such River" })).toMatchObject({ isError: true });

    // inside the selected area: nothing outside it changes; with nothing selected it says what to do
    expect(await raw("carve_valleys", { where: "selection" })).toMatchObject({ isError: true });
    hub.setSelection({ kind: "area", shape: { type: "rect", x: 100, y: 60, w: 56, h: 60 } }, false);
    const part = await call("carve_valleys", { where: "selection", strength: 0.6 });
    expect(part.where).toBe("the selected area");
    expect(part.cells_lowered).toBeGreaterThan(10);
    expect(changed().every((i) => { const x = i % W, y = Math.floor(i / W); return x >= 100 && x < 156 && y >= 60 && y < 120; })).toBe(true);
    await raw("undo");
    expect(doc.height.data).toEqual(before);
    hub.setSelection(null, false);

    // a river drawn east across the slope (where water runs south), then south to the sea
    const sources = doc.features?.sources?.length ?? 0;
    expect(await raw("name_water", { name: "Drawn River", x: 65, y: 60 })).toMatchObject({ isError: true }); // (no river there yet)
    const drawn = await call("draw_river", { points: [[30, 60], [100, 60], [100, 215]], size: "river" });
    expect(drawn.ends).toBe("in the sea");
    expect(drawn.length_km).toBeGreaterThan(200);
    expect(doc.features?.sources?.length).toBe(sources + 1);
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { await new Promise((r) => setTimeout(r, 250)); ok = !(await raw("name_water", { name: "Drawn River", x: 65, y: 60 })).isError; }
    expect(ok, "the drawn river runs along its line").toBe(true);
    // one undo step takes the channel and its source away (after the one that takes the name off)
    await raw("undo");
    expect(doc.features?.waterNames?.some((w) => w.name === "Drawn River")).toBe(false);
    expect(doc.features?.sources?.length).toBe(sources + 1);
    await raw("undo");
    expect(doc.features?.sources?.length).toBe(sources);
    expect(doc.height.data).toEqual(before);
    expect(await raw("draw_river", { points: [[10, 230], [40, 240]] })).toMatchObject({ isError: true }); // (all in the sea)
    await call("open_project", { id: "test-world" });
    await client.close();
  }, 60000);
});

describe("maps that know about each other", () => {
  it("copies a map, looks at another without opening it, compares them, and says where things are across linked maps", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 400)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    const made = await call("create_map", { name: "Test Before", width: 256, height: 256, km_per_px: 4, template: "ocean" });
    const before = made.created.id as string;
    await call("add_landmass", { shape: { type: "circle", x: 128, y: 128, r: 70 }, height_m: 400, seed: 3 });
    await call("add_place", { name: "Mill", type: "village", x: 120, y: 120 });
    await hub.flush();

    // a copy: everything but the history, opened, and it remembers its original
    const copy = await call("duplicate_map", { name: "Test After" });
    expect(copy.copied).toBe("Test Before");
    expect(hub.activeId).toBe(copy.as.id);
    expect(hub.session.doc.meta.copiedFrom).toMatchObject({ id: before, name: "Test Before" });
    expect(hub.session.doc.features?.places.map((p) => p.name)).toEqual(["Mill"]);
    expect(await hub.store.readBrief(copy.as.id)).toMatch(/A copy of \*\*Test Before\*\*/);
    expect(Array.from(hub.session.doc.height.data.slice(128 * 256, 128 * 256 + 256))).toEqual(Array.from((await hub.store.peek(before)).height.data.slice(128 * 256, 128 * 256 + 256)));

    // change the copy: the mill moves, a new place, the land raised
    const mill = hub.session.doc.features!.places[0];
    await call("update_place", { place: mill.id, x: 130, y: 118 });
    await call("add_place", { name: "Ashfield", type: "ruin", x: 100, y: 150 });
    await call("sculpt", { mode: "raise", shape: { type: "circle", x: 150, y: 100, r: 10 }, amount_m: 300 });

    // looking at the original without opening it: the copy stays open
    const theirs = await call("list_places", { map: "Test Before" });
    expect(JSON.stringify(theirs)).toMatch(/Mill/);
    expect(JSON.stringify(theirs)).not.toMatch(/Ashfield/);
    expect(hub.activeId).toBe(copy.as.id);
    const summary = await call("get_map_summary", { map: before });
    expect(JSON.stringify(summary)).toMatch(/Test Before/);
    const pv = await raw("render_preview", { map: "Test Before", max_size: 300 });
    expect((pv.content as { type: string }[]).some((b) => b.type === "image")).toBe(true);
    // a tool that changes things never takes another map
    expect(await raw("add_place", { map: "Test Before", name: "Nope", type: "village", x: 10, y: 10 })).toMatchObject({ isError: true });
    expect(hub.session.doc.features?.places.some((p) => p.name === "Nope")).toBe(false);

    // comparing: a picture and the differences in words
    const cmp = await raw("compare_maps", { map: "Test Before" });
    expect(cmp.isError).toBeFalsy();
    const words = JSON.parse((cmp.content as { text: string }[])[0].text);
    expect((cmp.content as { type: string }[]).some((b) => b.type === "image")).toBe(true);
    const said = words.differences.join(" ");
    expect(said).toMatch(/map pixels? raised/);
    expect(said).toMatch(/Places: 1 added, 1 moved/);
    expect(words.linked.join(" ")).toMatch(/copy of Test Before/);

    // across maps: a battlemap made from a spot of the copy, where it is, how far from the original's mill
    await call("create_battlemap_here", { name: "Test Scene", x: 100, y: 150, squares_x: 20, squares_y: 20 });
    const where = await call("where_on_map", { from: {}, to: { map: "Test After", place: "Ashfield" } });
    expect(where.on.x).toBeCloseTo(100, 3);
    expect(where.on.y).toBeCloseTo(150, 3);
    expect(where.distance_m).toBeLessThan(5);
    const far = await call("where_on_map", { from: {}, to: { map: "Test Before", place: "Mill" } });
    expect(far.distance_m).toBeCloseTo(Math.hypot(20, 30) * 4000, -2);
    expect(far.linked.join(" ")).toMatch(/battlemap made at \(100, 150\) of Test After/);
    // a battlemap with two levels copies with both
    await call("add_level", { where: "above" });
    await hub.flush();
    const sceneId = hub.activeId;
    const scene2 = await call("duplicate_map", { name: "Test Scene burnt", open: false });
    const lv = await hub.store.readLevels(scene2.as.id);
    expect(lv.levels).toHaveLength(2);
    // the copy opened on its upper level knows its own name and its original (a level's files held the original's)
    expect(lv.active).not.toBe(lv.levels[0].id);
    await call("open_project", { id: scene2.as.id });
    expect((await call("get_map_summary")).name).toBe("Test Scene burnt");
    expect(hub.session.doc.meta.copiedFrom?.id).toBe(sceneId);
    const burnt = JSON.parse(((await raw("compare_maps", { map: sceneId })).content as { text: string }[])[0].text);
    expect(burnt.differences[0]).toMatch(/^Before: Test Scene \(the original\)\. After: Test Scene burnt \(the copy\)\./);
    // ... and compares the upper level with the original's upper level, not with its first: nothing is different yet
    expect(burnt.level).toBeTruthy();
    expect(burnt.differences.join(" ")).toMatch(/Nothing on the two maps is different/);

    // the editor's compare view: where the original lies over the copy, and its picture
    await call("open_project", { id: copy.as.id });
    expect(await hub.comparePlacement("Test Before")).toMatchObject({ rect: { x: 0, y: 0, w: 256, h: 256 }, kind: "world" });
    const jpeg = await new Promise<Buffer>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: PORT, path: `/api/projects/${before}/picture.jpg?max=512` }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c)).on("end", () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`status ${res.statusCode}`))));
      }).on("error", reject);
    });
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    await call("open_project", { id: "test-world" });
    await client.close();
  }, 90000);
});

describe("the tools for rebuilding and mending a map", () => {
  it("copies land and settings from another map, puts an area back, drains a lake, erodes keeping a peak, reads everything back", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 400)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    // the original: an island with hills, a range with a massif and spurs, a place, a region, a drawn river, its own climate
    const orig = (await call("create_map", { name: "Test Original", width: 256, height: 256, km_per_px: 4, template: "ocean" })).created.id as string;
    await call("add_landmass", { shape: { type: "circle", x: 128, y: 128, r: 90 }, height_m: 300, relief: 0.6, seed: 5 });
    await call("add_mountain_range", { path: [[70, 110], [128, 100], [190, 110]], width_px: 8, heights_m: [800, 3200, 800], widths_px: [5, 10, 5], spurs: 0.6, seed: 6 });
    await call("add_place", { name: "Mill", type: "village", x: 120, y: 160 });
    await call("add_climate_region", { name: "Wet", shape: { type: "rect", x: 60, y: 140, w: 50, h: 40 }, moisture: 0.9 });
    await call("set_climate", { moisture_bias: 0.8, wind: "east" });
    const drawn = await call("draw_river", { points: [[128, 112], [128, 170], [128, 225]], size: "river" });
    expect(drawn.length_km).toBeGreaterThan(0);
    await hub.flush();
    // read back exactly
    const sum = await call("get_map_summary");
    expect(sum.climate).toMatchObject({ moistureBias: 0.8, wind: "east" });
    const regions = await call("list_climate_regions", { outlines: true });
    expect(regions[0].outline.length).toBeGreaterThanOrEqual(4);
    const sources = await call("list_river_sources");
    expect(sources[0].drawn_course.length).toBeGreaterThan(5);
    const water = await call("check_hydrology");
    expect(JSON.stringify(water)).not.toMatch(/"outline"/);
    const pv = await raw("render_preview", { relief: true, max_size: 300 });
    expect((pv.content as { type: string }[]).some((b) => b.type === "image")).toBe(true);

    // a new map of the same size, built from the original's own land and settings
    await call("create_map", { name: "Test Rebuilt", width: 256, height: 256, km_per_px: 4, template: "ocean" });
    const copied = await call("copy_from_map", { map: "Test Original", what: ["terrain", "climate", "regions", "places", "sources"] });
    expect(copied.terrain_cells).toBeGreaterThan(5000);
    expect(copied).toMatchObject({ places: 1, regions: 1, sources: 1, climate: "copied" });
    expect(hub.session.doc.meta.climate).toMatchObject({ moistureBias: 0.8 });
    const cmp = await raw("compare_maps", { map: "Test Original", overlay: true });
    const facts = JSON.parse((cmp.content as { text: string }[])[0].text);
    expect(facts.coast_match).toBeGreaterThan(0.99);
    expect((cmp.content as { type: string }[]).filter((b) => b.type === "image")).toHaveLength(2);
    expect(await raw("copy_from_map", { map: "Test Original", what: ["terrain"], area: { type: "circle", x: 128, y: 128, r: 10 } })).toMatchObject({ isError: false });

    // a mistake, put back from a checkpoint in one area only
    await call("save_checkpoint", { name: "Before the mistake" });
    const before = new Float32Array(hub.session.doc.height.data);
    await call("sculpt", { mode: "raise", shape: { type: "circle", x: 80, y: 180, r: 12 }, amount_m: 900 });
    await call("sculpt", { mode: "raise", shape: { type: "circle", x: 190, y: 180, r: 12 }, amount_m: 900 });
    await call("restore_area", { checkpoint: "Before the mistake", area: { type: "circle", x: 80, y: 180, r: 30 } });
    const h = hub.session.doc.height.data;
    expect(h[180 * 256 + 80]).toBeCloseTo(before[180 * 256 + 80], 2);
    expect(h[180 * 256 + 190]).toBeGreaterThan(before[180 * 256 + 190] + 300); // (the other one stays)

    // a range closed on itself traps a lake; drain it
    await call("add_mountain_range", { path: [[150, 150], [175, 150], [175, 175], [150, 175], [150, 150]], width_px: 5, peak_m: 1500, roughness: 0, seed: 9 });
    let lake = null as null | { x: number; y: number };
    for (let i = 0; i < 40 && !lake; i++) {
      const w = await call("check_hydrology");
      lake = (w.every_lake as { x: number; y: number }[]).find((l) => Math.abs(l.x - 162) < 12 && Math.abs(l.y - 162) < 12) ?? null;
      if (!lake) await new Promise((r) => setTimeout(r, 250));
    }
    expect(lake, "the closed ring of mountains holds a lake").not.toBeNull();
    const dr = await call("drain_lake", { x: lake!.x, y: lake!.y });
    expect(dr.lake_cells).toBeGreaterThan(10);
    expect(await raw("drain_lake", { x: 5, y: 5 })).toMatchObject({ isError: true }); // (open sea: no lake)

    // erosion in an area keeping the massif's peak
    const peakBefore = Math.max(...hub.session.doc.height.data);
    await call("erode", { passes: 2, area: { type: "rect", x: 60, y: 60, w: 140, h: 120 }, keep_above_m: 2500 });
    expect(Math.max(...hub.session.doc.height.data)).toBeCloseTo(peakBefore, 1);
    void orig;
    await call("open_project", { id: "test-world" });
    await client.close();
  }, 120000);
});

describe("selection and the edit lock", () => {
  it("shares the DM's selection with Claude, locks Claude's edits to it, and lets only the DM change a locked selection", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    const refused = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name} should have been refused`).toBe(true);
      return (r.content as { text: string }[])[0].text;
    };
    await call("create_map", { name: "Test Select", width: 256, height: 256, km_per_px: 4 });
    const doc = hub.session.doc, W = 256;
    doc.height.data.fill(-300);
    const c = await connect();
    await c.wait(() => c.msgs.some((m) => m.t === "selection"));
    const lastSel = () => [...c.msgs].reverse().find((m) => m.t === "selection") as Extract<ServerMsg, { t: "selection" }>;
    expect(lastSel()).toMatchObject({ selection: null, lock: false });

    // nothing selected, and what the DM is looking at
    c.ws.send(JSON.stringify({ t: "view", rect: { x: 10, y: 20, w: 200, h: 150 }, zoom: 3.5 }));
    await new Promise((r) => setTimeout(r, 100));
    let got = await call("get_selection");
    expect(got.selected).toBe(false);
    expect(got.view).toMatchObject({ x: 10, y: 20, w: 200, h: 150, zoom: 3.5 });
    expect(await refused("render_preview", { selection: true })).toMatch(/Nothing is selected/);

    // the DM selects an area: Claude sees it
    await call("add_place", { name: "Inside", type: "town", x: 100, y: 100 });
    await call("add_place", { name: "Outside", type: "town", x: 20, y: 20 });
    c.ws.send(JSON.stringify({ t: "selection", selection: { kind: "area", shape: { type: "rect", x: 60, y: 60, w: 80, h: 80 } }, lock: false }));
    await c.wait(() => lastSel()?.selection?.kind === "area");
    got = await call("get_selection");
    expect(got).toMatchObject({ selected: true, kind: "area", locked: false, bounds: { x: 60, y: 60, w: 80, h: 80 }, sizeKm: { w: 320, h: 320 } });
    expect(got.inside.places).toEqual([expect.objectContaining({ name: "Inside" })]);
    expect(got.landShare).toBe(0);
    const preview = (await raw("render_preview", { selection: true, max_size: 256 })).content as { type: string; text?: string }[];
    expect(preview.some((b) => b.type === "image")).toBe(true);
    expect(preview[0].text).toMatch(/the DM's selection/);

    // a bad selection is refused and changes nothing
    c.ws.send(JSON.stringify({ t: "selection", selection: { kind: "area", shape: { type: "circle", x: 5, y: 5, r: -1 } }, lock: true }));
    await c.wait(() => c.msgs.some((m) => m.t === "error"));
    expect(hub.selectionState.selection).toMatchObject({ kind: "area" });
    expect(hub.selectionState.lock).toBe(false);

    // lock: Claude's terrain edit is clipped to the area, and edits outside are refused
    c.ws.send(JSON.stringify({ t: "selection", selection: { kind: "area", shape: { type: "rect", x: 60, y: 60, w: 80, h: 80 } }, lock: true }));
    await c.wait(() => lastSel()?.lock === true);
    expect((await call("get_selection")).locked).toBe(true);
    const before = new Float32Array(doc.height.data);
    await call("add_landmass", { shape: { type: "circle", x: 100, y: 100, r: 95 }, height_m: 500, seed: 4 });
    let outside = 0, inside = 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (doc.height.data[y * W + x] === before[y * W + x]) continue;
      if (x >= 60 && x < 140 && y >= 60 && y < 140) inside++; else outside++;
    }
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(2000);
    expect(await refused("add_place", { name: "Far", type: "town", x: 200, y: 200 })).toMatch(/Locked to the DM's selection/);
    expect(await refused("update_place", { place: "Outside", name: "Renamed" })).toMatch(/Locked/);
    expect(await refused("set_sea_level", { level_m: 10 })).toMatch(/Locked/);
    await call("add_place", { name: "Near", type: "town", x: 110, y: 110 });
    expect(await refused("select_area", { shape: { type: "circle", x: 200, y: 200, r: 20 } })).toMatch(/locked/);
    expect(await refused("clear_selection")).toMatch(/locked/);
    expect(hub.selectionState.selection).toMatchObject({ kind: "area" });
    // the DM's own brush isn't held
    c.ws.send(JSON.stringify({ t: "cmd", cmd: { op: "sculpt", params: { mode: "raise", shape: { type: "circle", x: 220, y: 220, r: 8 }, amountM: 500 } } }));
    await c.wait(() => doc.height.data[220 * W + 220] > before[220 * W + 220] + 100);

    // the DM unlocks: Claude may highlight and clear
    c.ws.send(JSON.stringify({ t: "selection", selection: lastSel().selection, lock: false }));
    await c.wait(() => lastSel()?.lock === false);
    await call("add_place", { name: "Free", type: "town", x: 200, y: 30 });
    await call("select_area", { shape: { type: "circle", x: 200, y: 200, r: 20 } });
    await c.wait(() => lastSel()?.selection?.kind === "area" && (lastSel().selection as { shape: { type: string } }).shape.type === "circle");
    await call("clear_selection");
    await c.wait(() => lastSel()?.selection === null);

    // a selected feature, and deselection when it is removed
    c.ws.send(JSON.stringify({ t: "selection", selection: { kind: "feature", featureKind: "place", id: doc.features!.places.find((p) => p.name === "Near")!.id }, lock: true }));
    await c.wait(() => lastSel()?.selection?.kind === "feature");
    got = await call("get_selection");
    expect(got).toMatchObject({ kind: "feature", locked: false, feature: { name: "Near" } });
    expect(got.note).toMatch(/update_place/);
    expect(hub.selectionState.lock).toBe(false); // a place is not an area: nothing to lock to
    await call("remove_place", { place: "Near" });
    await c.wait(() => lastSel()?.selection === null);
    // a selected climate region can be locked to
    const reg = await call("add_climate_region", { name: "Test region", shape: { type: "circle", x: 128, y: 128, r: 30 }, moisture: 0.2 });
    c.ws.send(JSON.stringify({ t: "selection", selection: { kind: "feature", featureKind: "region", id: reg.region.id }, lock: true }));
    await c.wait(() => lastSel()?.lock === true);
    expect(await refused("add_place", { name: "Out of region", type: "town", x: 20, y: 200 })).toMatch(/Locked/);
    // a selection belongs to its map: opening another clears it
    await call("open_project", { id: "test-world" });
    expect(hub.selectionState).toMatchObject({ selection: null, lock: false });
    expect(hub.session.editLock).toBeNull();
    c.ws.close();
    await client.close();
  }, 60000);
});

describe("volcanic ground", () => {
  it("a climate region can be volcanic: set, listed, cleared, and refused outside 0..1", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    const added = await call("add_climate_region", { name: "Test ash", shape: { type: "circle", x: 128, y: 128, r: 30 }, volcanic: 0.8 });
    expect(added.region.volcanic).toBe(0.8);
    const list = JSON.parse(((await raw("list_climate_regions")).content as { text: string }[])[0].text);
    expect(list.find((r: { name: string }) => r.name === "Test ash")).toMatchObject({ volcanic: 0.8 });
    expect((await call("update_climate_region", { region: "Test ash", volcanic: 1 })).region.volcanic).toBe(1);
    expect((await call("update_climate_region", { region: "Test ash", volcanic: null })).region.volcanic).toBeUndefined();
    expect(await raw("add_climate_region", { name: "Too much", shape: { type: "circle", x: 128, y: 128, r: 30 }, volcanic: 2 })).toMatchObject({ isError: true });
    await call("remove_climate_region", { region: "Test ash" });
    await client.close();
  }, 60000);
});

describe("the ground list for Claude", () => {
  it("list_grounds tells Claude every kind of ground, where it appears and how to get it, and the instructions point to it", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const all = JSON.parse(((await client.callTool({ name: "list_grounds", arguments: {} })).content as { text: string }[])[0].text);
    const ids = all.grounds.map((g: { id: string }) => g.id);
    for (const id of ["tundra", "boreal", "steppe", "savanna", "marsh", "jungle", "desert", "badlands", "glacier", "mangrove", "stone", "volcanic"]) expect(ids, id).toContain(id);
    for (const g of all.grounds) { expect(g.where.length).toBeGreaterThan(3); expect(g.how_to_get_it.length).toBeGreaterThan(10); }
    expect(all.grounds.find((g: { id: string }) => g.id === "tundra").how_to_get_it).toContain("0.15");
    const cold = JSON.parse(((await client.callTool({ name: "list_grounds", arguments: { group: "Cold" } })).content as { text: string }[])[0].text);
    expect(cold.grounds.map((g: { id: string }) => g.id).sort()).toEqual(["glacier", "tundra"]);
    expect(client.getInstructions()).toContain("list_grounds");
    await client.close();
  }, 60000);
});

describe("regional maps", () => {
  it("makes a detailed child map with the parent's climate, places and link, then returns", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBe(false);
      return r.content as { type: string; text?: string }[];
    };
    const parent = hub.session.doc;
    const landBefore = parent.height.copyRect({ x: 96, y: 96, w: 64, h: 64 }).reduce((n, v) => n + (v > 0 ? 1 : 0), 0) / (64 * 64);
    await call("add_place", { name: "Inside Town", type: "town", x: 120, y: 130 });
    await call("add_place", { name: "Outside Town", type: "town", x: 20, y: 20 });
    const made = JSON.parse((await call("create_regional_map", { name: "Heartland", region: { x: 96, y: 96, w: 64, h: 64 } }))[0].text!);
    expect(made.created).toMatchObject({ id: "heartland", width: 1024, height: 1024, parent: { id: "test-world", factor: 16, rect: { x: 96, y: 96, w: 64, h: 64 } } });
    const child = hub.session.doc;
    expect(child.meta.kmPerPx).toBeCloseTo(parent.meta.kmPerPx / 16, 6);
    const names = child.features!.places.map((p) => p.name);
    expect(names).toContain("Inside Town");
    expect(names).not.toContain("Outside Town");
    expect(child.features!.places.find((p) => p.name === "Inside Town")).toMatchObject({ x: (120 - 96) * 16, y: (130 - 96) * 16 });
    expect(child.baseClimate).toMatchObject({ w: 64, h: 64 });
    // same land, more detail: the land share of the area is about the same
    const landAfter = child.height.data.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) / child.height.data.length;
    expect(Math.abs(landAfter - landBefore)).toBeLessThan(0.08);
    // the brief includes the parent's, and previews work in the child
    expect((await call("get_brief"))[0].text).toContain("From the parent map, Test World");
    expect((await call("render_preview", { max_size: 256 })).some((b) => b.type === "image")).toBe(true);
    // it reloads from disk with its climate, and the parent lists it
    await hub.flush();
    const again = await hub.store.load("heartland");
    expect(again.baseClimate?.temp.length).toBe(64 * 64);
    expect((await hub.store.list()).find((p) => p.id === "heartland")?.parent?.id).toBe("test-world");
    await hub.refreshRegionalClimate();
    await call("open_project", { id: "test-world" });
    expect(hub.activeId).toBe("test-world");
    await call("remove_place", { place: "Inside Town" });
    await call("remove_place", { place: "Outside Town" });
    await client.close();
  }, 60000);
});

describe("battlemaps", () => {
  it("builds a battlemap with tools, keeps it apart from world maps, exports it and reloads it", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    const made = await call("create_battlemap", { name: "Test Cellar", squares_x: 24, squares_y: 16, px_per_square: 40, room_margin: 2 });
    expect(made.created).toMatchObject({ id: "test-cellar", kind: "battle" });
    expect(hub.activeId).toBe("test-cellar");
    expect(made.summary).toMatchObject({ size_squares: [24, 16], walls: 1 });

    // world-map tools refuse here, with a pointer to the right ones
    const refused = await raw("render_preview");
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("battlemap");
    // no climate work is scheduled for a battlemap
    expect(await (hub as unknown as { refreshDerived(op: unknown, f: boolean): Promise<unknown> }).refreshDerived((hub as never as { open: unknown }).open, true)).toBeNull();

    const room = await call("add_room", { x: 3, y: 3, w: 6, h: 5, floor: "wood planks", doors: [{ side: "right", offset: 2 }, { side: "top", offset: 1, kind: "window" }] });
    expect(room.doors).toHaveLength(2);
    const door = await call("add_door", { x: 12, y: 2 }); // the outer room's top wall
    expect(door.door.kind).toBe("door");
    expect(await raw("add_door", { x: 12, y: 8.3 })).toMatchObject({ isError: true }); // open floor: no wall nearby
    await call("paint_floor", { shape: { type: "circle", x: 16, y: 10, r: 2.5 }, material: "deep water" });
    await call("add_light", { x: 6, y: 5, radius: 6, colour: "#ff9900" });
    const listed = await call("list_battle");
    expect(listed.summary.doors).toBe(2);
    expect(listed.summary.windows).toBe(1);
    expect(listed.lights).toHaveLength(1);
    expect(listed.summary.floors.map((f: { material: string }) => f.material)).toEqual(expect.arrayContaining(["flagstone", "wood planks", "deep water"]));
    const sub = hub.session.doc.meta.battle!.sub;
    expect(hub.session.doc.height.get(16 * sub, 10 * sub)).toBe(8);

    const view = (await raw("render_battlemap", { max_size: 400 })).content as { type: string }[];
    expect(view.some((b) => b.type === "image")).toBe(true);
    const crop = (await raw("render_battlemap", { region: { x: 2, y: 2, w: 8, h: 6 }, max_size: 400 })).content as { type: string }[];
    expect(crop.some((b) => b.type === "image")).toBe(true);

    // the light level: dim, then a number, then back to bright (undoable like the rest)
    expect((await call("list_battle")).summary.light_level).toBe("bright");
    expect((await call("set_battle_lighting", { level: "dim" })).light_level).toBe("dim");
    expect(hub.session.doc.meta.battle!.ambient).toBe(0.55);
    expect((await call("list_battle")).summary.light_level).toBe("dim");
    const dimView = (await raw("render_battlemap", { max_size: 400 })).content as { type: string }[];
    expect(dimView.some((b) => b.type === "image")).toBe(true);
    expect((await call("set_battle_lighting", { level: 0.4 })).light_level).toBe(0.4);
    expect(await raw("set_battle_lighting", { level: 3 })).toMatchObject({ isError: true });
    await call("set_battle_lighting", { level: "bright" });
    expect("ambient" in hub.session.doc.meta.battle!).toBe(false);
    await raw("undo");
    expect(hub.session.doc.meta.battle!.ambient).toBe(0.4);
    await raw("redo");

    // time-of-day presets, light zones and the key (numbered notes)
    expect((await call("set_battle_lighting", { level: "dusk" })).light_level).toBe("dusk");
    expect(hub.session.doc.meta.battle).toMatchObject({ ambient: 0.6, ambientTint: "#ff8f5a" });
    expect((await call("set_battle_lighting", { tint: "#112233" })).tint).toBe("#112233");
    expect((await call("list_battle")).summary.light_level).toBe(0.6); // a custom tint is no longer the preset
    expect(await raw("set_battle_lighting", {})).toMatchObject({ isError: true });
    await call("set_battle_lighting", { level: "bright", tint: "none" });
    expect(hub.session.doc.meta.battle).not.toHaveProperty("ambientTint");
    const zone = await call("add_light_zone", { shape: { type: "rect", x: 3, y: 3, w: 6, h: 5 }, level: "dim", name: "Cellar room" });
    expect(zone.zone.level).toBe(0.55);
    await call("add_light_zone", { shape: { type: "circle", x: 16, y: 10, r: 2 }, level: 0.3 });
    expect((await call("update_light_zone", { id: zone.zone.id, level: "dark", name: "Back room" })).zone).toMatchObject({ name: "Back room", level: 0.25 });
    expect((await call("list_battle")).light_zones).toHaveLength(2);
    expect(await raw("update_light_zone", { id: "nope", level: 0.5 })).toMatchObject({ isError: true });
    const zoneView = (await raw("render_battlemap", { max_size: 400 })).content as { type: string }[];
    expect(zoneView.some((b) => b.type === "image")).toBe(true);
    await call("remove_light_zones", { ids: [zone.zone.id] });
    expect((await call("list_battle")).summary.light_zones).toBe(1);

    const n1 = await call("add_note", { x: 6, y: 5, title: "Cellar", text: "Barrels and a trapdoor." });
    const n2 = await call("add_note", { x: 15, y: 3, title: "Shrine" });
    expect([n1.note.n, n2.note.n]).toEqual([1, 2]);
    await call("update_note", { id: n2.note.id, number: 9, x: 2, y: 2 });
    expect((await call("renumber_notes")).notes).toEqual([{ n: 1, title: "Shrine" }, { n: 2, title: "Cellar" }]);
    expect(await raw("update_note", { id: "nope", title: "x" })).toMatchObject({ isError: true });
    expect((await call("list_battle")).notes).toHaveLength(2);
    expect((await call("list_battle")).summary.notes).toBe(2);
    const keyFile = await call("export_battlemap", { format: "key" });
    expect(keyFile.file).toBe("test-cellar-key.md");
    const keyText = await (await fetch(`http://127.0.0.1:${PORT}/api/projects/test-cellar/export/key`)).text();
    expect(keyText).toContain("1. **Shrine**");
    expect(keyText).toContain("Barrels and a trapdoor.");
    await raw("undo");
    expect((await call("list_battle")).notes.map((n: { n: number }) => n.n)).toEqual([1, 9]); // the renumbering is one undo step
    await raw("redo");
    await call("remove_notes", { ids: [n1.note.id, n2.note.id] });
    expect((await call("list_battle")).notes).toHaveLength(0);

    // undo/redo go through the same history
    const before = (await call("list_battle")).walls.length;
    await call("remove_walls", { ids: [door.door.id] });
    expect((await call("list_battle")).walls.length).toBe(before - 1);
    await raw("undo");
    expect((await call("list_battle")).walls.length).toBe(before);

    // exports: over HTTP and through the tool
    const base = `http://127.0.0.1:${PORT}/api/projects/test-cellar/export`;
    const png = new Uint8Array(await (await fetch(`${base}/png`)).arrayBuffer());
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const uvttRes = await fetch(`${base}/uvtt`);
    expect(uvttRes.headers.get("content-disposition")).toContain("test-cellar.dd2vtt");
    const uvtt = await uvttRes.json() as { resolution: { map_size: { x: number }; pixels_per_grid: number }; line_of_sight: unknown[]; objects_line_of_sight: unknown[]; portals: unknown[]; lights: unknown[]; image: string };
    expect(uvtt.resolution).toMatchObject({ map_size: { x: 24, y: 16 }, pixels_per_grid: 40 });
    // only real doors are portals (this map has no secret doors): a tabletop turns every portal into a door, so a window is written as a plain wall line instead
    expect(uvtt.portals.length).toBe(listed.summary.doors);
    expect(uvtt.objects_line_of_sight.length).toBe(0);
    expect(uvtt.line_of_sight.length).toBeGreaterThanOrEqual(listed.summary.windows);
    expect(uvtt.lights).toHaveLength(1);
    expect(Buffer.from(uvtt.image, "base64").subarray(1, 4).toString()).toBe("PNG");
    const zip = new Uint8Array(await (await fetch(`${base}/foundry`)).arrayBuffer());
    expect(String.fromCharCode(zip[0], zip[1])).toBe("PK");
    expect((await fetch(`http://127.0.0.1:${PORT}/api/projects/test-world/export/png`)).status).toBe(404); // not the open project
    // the map's picture works for a battlemap too (walls, doors and lights baked in)
    const pic = await fetch(`http://127.0.0.1:${PORT}/api/projects/test-cellar/picture.jpg?max=512`);
    expect(pic.headers.get("content-type")).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await pic.arrayBuffer()).subarray(0, 2))).toEqual([0xff, 0xd8]);
    const saved = await call("export_battlemap", { format: "uvtt" });
    expect(saved.saved_to).toContain("test-cellar/exports/test-cellar.dd2vtt");

    // saves and reloads from disk, and the project list knows it's a battlemap
    await hub.flush();
    const again = await hub.store.load("test-cellar");
    expect(again.meta.kind).toBe("battle");
    expect(again.features!.walls!.length).toBe(before);
    expect(again.height.get(16 * sub, 10 * sub)).toBe(8);
    expect((await hub.store.list()).find((p) => p.id === "test-cellar")?.kind).toBe("battle");

    // back on the world map the battlemap tools refuse
    await call("open_project", { id: "test-world" });
    expect(hub.activeId).toBe("test-world");
    expect((await raw("add_room", { x: 1, y: 1, w: 3, h: 3 })).isError).toBe(true);

    // a scene from a spot on the world map: the corner of the test world is open sea
    const here = await call("create_battlemap_here", { name: "Corner scene", x: 2, y: 2, squares_x: 12, squares_y: 8 });
    expect(here.ground).toBe("open sea");
    expect(here.created).toMatchObject({ kind: "battle" });
    expect(hub.session.doc.meta.origin).toMatchObject({ id: "test-world", x: 2, y: 2 });
    const floors = (await call("list_battle")).summary.floors.map((f: { material: string }) => f.material);
    expect(floors.every((m: string) => m === "deep water" || m === "shallow water")).toBe(true);
    expect((await raw("create_battlemap_here", { name: "Nope", x: 1, y: 1 })).isError).toBe(true); // from a battlemap: refused
    await call("open_project", { id: "test-world" });
    expect((await raw("create_battlemap_here", { name: "Off", x: 9999, y: 1 })).isError).toBe(true);
    await client.close();
  }, 60000);
});

describe("the access key", () => {
  const KEY = "test-access-key-0123456789abcdef";
  const PORT2 = PORT + 1001;
  const base = `http://127.0.0.1:${PORT2}`;
  let secured: ReturnType<typeof createAppServer>, hub2: Hub, dir2: string;

  beforeAll(async () => {
    dir2 = mkdtempSync(path.join(tmpdir(), "mapmaker-key-"));
    const cfg = loadConfig({ port: PORT2, host: "127.0.0.1", projectsDir: dir2, editorDist: path.join(dir2, "no-editor"), accessToken: KEY });
    hub2 = new Hub(new ProjectStore(dir2), fakeModel);
    await hub2.createProject({ name: "Locked World", width: 128, height: 128, kmPerPx: 2 });
    secured = createAppServer(cfg, hub2);
    await new Promise<void>((r) => secured.listen(PORT2, "127.0.0.1", r));
  });
  afterAll(async () => {
    await hub2.flush();
    secured.close();
    rmSync(dir2, { recursive: true, force: true });
  });

  const wsStatus = (headers: Record<string, string>) => new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT2}/ws`, { headers });
    ws.on("open", () => { ws.close(); resolve("open"); });
    ws.on("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
    ws.on("error", () => resolve("error"));
  });

  it("turns away requests with no key or a wrong one: API, MCP and WebSocket", async () => {
    const nothing: Record<string, string>[] = [{}, { authorization: "Bearer wrong-key-wrong-key-wrong" }, { authorization: `Basic ${KEY}` }, { cookie: "dd_session=nope" }];
    for (const headers of nothing) {
      expect((await fetch(`${base}/api/health`, { headers })).status, JSON.stringify(headers)).toBe(401);
      expect((await fetch(`${base}/mcp`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
      expect((await fetch(`${base}/api/claude-hook`, { method: "POST", headers, body: "{}" })).status).toBe(401);
      expect((await fetch(`${base}/api/projects/locked-world/refs`, { method: "POST", headers, body: "not even read" })).status).toBe(401);
      expect(await wsStatus(headers)).toBe("401");
    }
    // the wrong Host is still refused first, key or no key (the DNS-rebinding check stays)
    const r = await new Promise<number>((resolve, reject) => http.get({ host: "127.0.0.1", port: PORT2, path: "/api/health", headers: { host: "evil.example", authorization: `Bearer ${KEY}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject));
    expect(r).toBe(403);
  });

  it("lets the key through as a Bearer header (MCP clients, Claude Code hooks)", async () => {
    const h = { authorization: `Bearer ${KEY}` };
    const health = await fetch(`${base}/api/health`, { headers: h });
    expect(health.status).toBe(200);
    expect((await health.json()).project).toBeTruthy();
    expect((await fetch(`${base}/api/claude-hook`, { method: "POST", headers: h, body: JSON.stringify({ hook_event_name: "Stop" }) })).status).toBe(204);
    expect(await wsStatus(h)).toBe("open");
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: h } }));
    expect((await client.listTools()).tools.length).toBeGreaterThan(20);
    await client.close();
    // and an MCP client with no key can't even connect
    const bare = new Client({ name: "test", version: "1.0.0" });
    await expect(bare.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)))).rejects.toThrow();
  });

  // (2026-11-22: the AI assistant is handed this key, not the access key, so a command it runs can't answer the Allow box over the editor's connection)
  it("lets the map tools key into the map tools and the hooks only", async () => {
    const TOOLS = "test-tools-key-fedcba9876543210";
    const PORT3 = PORT2 + 1;
    const cfg = loadConfig({ port: PORT3, host: "127.0.0.1", projectsDir: dir2, editorDist: path.join(dir2, "no-editor"), accessToken: KEY, toolsToken: TOOLS });
    const s3 = createAppServer(cfg, hub2);
    await new Promise<void>((r) => s3.listen(PORT3, "127.0.0.1", r));
    const b3 = `http://127.0.0.1:${PORT3}`, h = { authorization: `Bearer ${TOOLS}` };
    try {
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${b3}/mcp`), { requestInit: { headers: h } }));
      expect((await client.listTools()).tools.length).toBeGreaterThan(20);
      await client.close();
      expect((await fetch(`${b3}/api/claude-hook`, { method: "POST", headers: h, body: JSON.stringify({ hook_event_name: "Stop" }) })).status).toBe(204);
      expect((await fetch(`${b3}/api/health`, { headers: h })).status).toBe(401);
      expect((await fetch(`${b3}/api/projects/locked-world/refs`, { method: "POST", headers: h, body: "x" })).status).toBe(401);
      expect((await fetch(`${b3}/?t=${TOOLS}`, { redirect: "manual" })).headers.get("set-cookie")).toBeNull(); // (it gives no editor cookie)
      const ws = await new Promise<string>((resolve) => {
        const w = new WebSocket(`ws://127.0.0.1:${PORT3}/ws`, { headers: h });
        w.on("open", () => { w.close(); resolve("open"); });
        w.on("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
        w.on("error", () => resolve("error"));
      });
      expect(ws).toBe("401");
    } finally {
      s3.close();
    }
  });

  it("gives the editor a session cookie when it opens the page with the key once, and then needs no header", async () => {
    // a wrong key gives no cookie
    const bad = await fetch(`${base}/?t=not-the-key-not-the-key-nope`, { redirect: "manual" });
    expect(bad.headers.get("set-cookie")).toBeNull();
    const ok = await fetch(`${base}/?t=${KEY}&x=1`, { redirect: "manual" });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/?x=1"); // (the key is not left in the address)
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^dd_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const jar = { cookie: cookie.split(";")[0] };
    expect((await fetch(`${base}/api/health`, { headers: jar })).status).toBe(200);
    expect(await wsStatus(jar)).toBe("open");
  });

  it("is open when no key is set (the developer setup), and refuses a key too short to be a key", async () => {
    expect((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status).toBe(200); // (the main test server has none)
    const before = process.env.MAPMAKER_ACCESS_TOKEN;
    process.env.MAPMAKER_ACCESS_TOKEN = "short";
    try { expect(() => loadConfig()).toThrow(/at least 16/); } finally { if (before === undefined) delete process.env.MAPMAKER_ACCESS_TOKEN; else process.env.MAPMAKER_ACCESS_TOKEN = before; }
  });
});

describe("place kinds", () => {
  it("add_place takes every kind, refuses a made-up one, and update_place can change the kind", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
    const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    const tool = (await client.listTools()).tools.find((t) => t.name === "add_place")!;
    const kinds = (tool.inputSchema as unknown as { properties: { type: { enum: string[] } } }).properties.type.enum;
    for (const k of ["castle", "lighthouse", "standing_stones", "volcano", "capital", "other"]) expect(kinds, k).toContain(k);
    const added = await call("add_place", { name: "Test Light", type: "lighthouse", x: 40, y: 40 });
    expect(added.place.type).toBe("lighthouse");
    expect(await raw("add_place", { name: "Nope", type: "spaceport", x: 41, y: 41 })).toMatchObject({ isError: true });
    expect((await call("update_place", { place: "Test Light", type: "tower" })).place.type).toBe("tower");
    await call("remove_place", { place: "Test Light" });
    await client.close();
  }, 60000);
});

describe("in-app chat", () => {
  it("runs a tool loop with a scripted Claude and streams events to the editor", async () => {
    const c = await connect();
    await c.wait(() => c.msgs.some((m) => m.t === "project"));
    c.ws.send(JSON.stringify({ t: "chat_send", text: "Put a round island in the middle", images: [] }));
    await c.wait(() => c.msgs.some((m) => m.t === "chat" && m.ev.type === "busy" && !m.ev.busy));

    expect(calls.length).toBe(3);
    const first = calls[0] as { system: { text: string }[]; tools: { name: string; eager_input_streaming: boolean }[]; messages: { content: { text?: string }[] }[]; fallbacks: string; thinking: { type: string } };
    expect(first.system[0].text).toContain("mapmaking partner");
    expect(first.tools.every((t) => t.eager_input_streaming)).toBe(true);
    expect(first.fallbacks).toBe("default");
    expect(first.thinking.type).toBe("adaptive");
    expect(JSON.stringify(first.messages[0])).toContain("Editor context");
    // tool results (including the preview image) were fed back to the model
    const third = calls[2] as { messages: { role: string; content: { type: string; content?: { type: string }[] }[] }[] };
    const lastUser = third.messages[third.messages.length - 1];
    expect(lastUser.content[0].type).toBe("tool_result");
    expect(lastUser.content[0].content?.some((b) => b.type === "image")).toBe(true);

    const events = c.msgs.filter((m) => m.t === "chat").map((m) => (m.t === "chat" ? m.ev : null));
    expect(events.some((e) => e?.type === "item_add" && e.item.kind === "tool" && e.item.name === "add_landmass")).toBe(true);
    expect(events.some((e) => e?.type === "item_update" && (e.patch as { text?: string }).text === "Added a round island.")).toBe(true);
    const usage = events.filter((e) => e?.type === "usage").pop();
    expect(usage && usage.type === "usage" && usage.session.costUsd).toBeGreaterThan(0);
    // Claude's edit is attributed to Claude in history
    expect(hub.session.changes.some((ch) => ch.author === "claude" && ch.label.startsWith("Add landmass"))).toBe(true);
    c.ws.close();
  });

  it("persists the project to disk", async () => {
    await hub.flush();
    const store = new ProjectStore(dir);
    const doc = await store.load("test-world");
    expect(doc.height.data.some((v) => v > 0)).toBe(true);
  });
});
