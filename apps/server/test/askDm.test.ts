// The AI asks the DM before a risky action (tools risky.ts, Hub.askDm): asked in the open editors, answered in any; refused with no answer, no editor, or a no.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ServerMsg } from "@mapmaker/core";
import { Hub } from "../src/hub.ts";
import { createAppServer } from "../src/http.ts";
import { loadConfig } from "../src/config.ts";
import { ProjectStore } from "../src/store.ts";

const PORT = 48600 + Math.floor(Math.random() * 300);
const dir = mkdtempSync(path.join(tmpdir(), "mapmaker-ask-"));
let hub: Hub, server: ReturnType<typeof createAppServer>, client: Client;

beforeAll(async () => {
  const cfg = loadConfig({ port: PORT, host: "127.0.0.1", projectsDir: dir, editorDist: path.join(dir, "no-editor") });
  hub = new Hub(new ProjectStore(dir), null, undefined, { askBeforeRisky: true, askWaitMs: 1500 });
  await hub.createProject({ name: "Ask World", width: 128, height: 128, kmPerPx: 2 });
  hub.session.execute({ op: "generate_terrain", params: { template: "island", seed: 2 } }, "system");
  server = createAppServer(cfg, hub);
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
});

afterAll(async () => {
  await client.close();
  await hub.flush();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const textOf = (r: unknown) => ((r as { content: { text?: string }[] }).content[0]?.text ?? "");
const places = () => hub.session.doc.features?.places.map((p) => p.name) ?? [];

/** An editor that answers every question with `allow`, or never (null); with `all`, its yes is Allow all (when the question offers it). */
function page(allow: boolean | null, all = false): Promise<{ ws: WebSocket; asked: ServerMsg[]; done: ServerMsg[]; other: ServerMsg[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const asked: ServerMsg[] = [], done: ServerMsg[] = [], other: ServerMsg[] = [];
    ws.on("message", (data, bin) => {
      if (bin) return;
      const m = JSON.parse(data.toString()) as ServerMsg;
      if (m.t === "confirm") { asked.push(m); if (allow !== null) ws.send(JSON.stringify({ t: "confirm_answer", id: m.id, allow, ...(all && allow && m.undoable && { all: true }) })); }
      if (m.t === "confirm_done") done.push(m);
      if (m.t === "allow_all" || m.t === "confirm_auto") other.push(m);
    });
    ws.on("open", () => { ws.send(JSON.stringify({ t: "hello" })); resolve({ ws, asked, done, other }); });
    ws.on("error", reject);
  });
}

describe("asking the DM before a risky action", () => {
  it("does what isn't risky without asking, and refuses a risky one when no editor is open", async () => {
    expect((await client.callTool({ name: "add_place", arguments: { name: "Ashford", type: "village", x: 64, y: 64 } })).isError).toBe(false);
    const r = await client.callTool({ name: "remove_place", arguments: { place: "Ashford" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/needs the DM's OK in the Dragon Drop window, and it isn't open: Remove the place "Ashford"/);
    expect(places()).toContain("Ashford");
  });

  it("asks every open page; a no refuses, a yes goes ahead", async () => {
    const no = await page(false);
    const r = await client.callTool({ name: "remove_place", arguments: { place: "Ashford" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/The DM said no to this: Remove the place "Ashford"/);
    expect(no.asked).toHaveLength(1);
    expect(no.asked[0]).toMatchObject({ via: "mcp", tool: "remove_place", text: 'Remove the place "Ashford"' });
    expect(places()).toContain("Ashford");
    no.ws.close();

    const yes = await page(true);
    const ok = await client.callTool({ name: "remove_place", arguments: { place: "Ashford" } });
    expect(ok.isError).toBe(false);
    expect(places()).not.toContain("Ashford");
    for (let i = 0; i < 40 && !yes.done.length; i++) await new Promise((r2) => setTimeout(r2, 25));
    expect(yes.done[0]).toMatchObject({ t: "confirm_done", answer: "allowed" });
    yes.ws.close();
  });

  it("with no answer in time nothing is done, and every page is told the question is gone", async () => {
    const silent = await page(null);
    const before = hub.session.doc.meta.seaLevel;
    const r = await client.callTool({ name: "set_sea_level", arguments: { level_m: 200 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/didn't answer in time: Move the sea level to 200 m/);
    expect(hub.session.doc.meta.seaLevel).toBe(before);
    for (let i = 0; i < 40 && !silent.done.length; i++) await new Promise((r2) => setTimeout(r2, 25));
    expect(silent.done[0]).toMatchObject({ answer: "timeout" });
    silent.ws.close();
  });

  it("says what Allow does; Allow all lets the rest of the request through without asking, but never what Undo can't take back, and ends with the request", async () => {
    for (const name of ["Fen", "Moor", "Holt"]) expect((await client.callTool({ name: "add_place", arguments: { name, type: "village", x: 60, y: 60 } })).isError).toBe(false);
    const dm = await page(true, true);
    expect((await client.callTool({ name: "remove_place", arguments: { place: "Fen" } })).isError).toBe(false);
    expect(dm.asked).toHaveLength(1);
    expect(dm.asked[0]).toMatchObject({ text: 'Remove the place "Fen"', note: "It is taken off the map. Undo brings it back.", undoable: true });
    // the next one in the same request goes ahead without a question, and the page is told what it was
    expect((await client.callTool({ name: "remove_place", arguments: { place: "Moor" } })).isError).toBe(false);
    expect(dm.asked).toHaveLength(1);
    expect(places()).not.toContain("Moor");
    for (let i = 0; i < 40 && !dm.other.some((m) => m.t === "confirm_auto"); i++) await new Promise((r2) => setTimeout(r2, 25));
    expect(dm.other).toEqual(expect.arrayContaining([expect.objectContaining({ t: "allow_all", on: true, via: "mcp" }), expect.objectContaining({ t: "confirm_auto", text: 'Remove the place "Moor"' })]));
    // rewriting the brief can't be undone: it is still asked (this page says yes, but not Allow all)
    await client.callTool({ name: "update_brief", arguments: { mode: "replace", text: "x".repeat(300) } });
    await client.callTool({ name: "update_brief", arguments: { mode: "replace", text: "y".repeat(300) } });
    expect(dm.asked.filter((m) => m.t === "confirm" && m.tool === "update_brief")).toHaveLength(1);
    expect(dm.asked.at(-1)).toMatchObject({ undoable: false });
    // Claude Code finished the request: the next one asks again
    hub.claudeHook({ hook_event_name: "Stop" });
    expect(dm.other.at(-1) ?? null).not.toBeNull();
    const before = dm.asked.length;
    expect((await client.callTool({ name: "remove_place", arguments: { place: "Holt" } })).isError).toBe(false);
    expect(dm.asked.length).toBe(before + 1);
    hub.endAllowAll();
    dm.ws.close();
  });

  it("a page opened while a question waits is shown it", async () => {
    const first = await page(null);
    const pending = client.callTool({ name: "generate_terrain", arguments: { template: "continent", replace_existing: true } });
    for (let i = 0; i < 40 && !first.asked.length; i++) await new Promise((r2) => setTimeout(r2, 25));
    const late = await page(false);
    const r = await pending;
    expect(late.asked[0]).toMatchObject({ tool: "generate_terrain" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/said no/);
    first.ws.close(); late.ws.close();
  });
});
