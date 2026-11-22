// The smaller set of map tools for smaller models (tools essentials.ts): /mcp?tools=essentials lists it with short instructions; every tool still answers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ESSENTIAL_INSTRUCTIONS, ESSENTIAL_TOOLS, MAPMAKER_INSTRUCTIONS, TOOLS } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { createAppServer } from "../src/http.ts";
import { loadConfig } from "../src/config.ts";
import { ProjectStore } from "../src/store.ts";

const PORT = 48900 + Math.floor(Math.random() * 90);
const dir = mkdtempSync(path.join(tmpdir(), "mapmaker-set-"));
let hub: Hub, server: ReturnType<typeof createAppServer>;

beforeAll(async () => {
  const cfg = loadConfig({ port: PORT, host: "127.0.0.1", projectsDir: dir, editorDist: path.join(dir, "no-editor") });
  hub = new Hub(new ProjectStore(dir), null);
  await hub.createProject({ name: "Set World", width: 96, height: 96, kmPerPx: 2 });
  server = createAppServer(cfg, hub);
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
});
afterAll(async () => { await hub.flush(); server.close(); rmSync(dir, { recursive: true, force: true }); });

async function connect(query: string) {
  const c = new Client({ name: "test", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp${query}`)));
  return c;
}

describe("which map tools an assistant is shown", () => {
  it("all of them, or the smaller set with short instructions", async () => {
    const all = await connect("");
    expect((await all.listTools()).tools).toHaveLength(TOOLS.length);
    expect(all.getInstructions()).toBe(MAPMAKER_INSTRUCTIONS);
    await all.close();

    const small = await connect("?tools=essentials");
    const listed = (await small.listTools()).tools;
    expect(listed.map((t) => t.name).sort()).toEqual([...ESSENTIAL_TOOLS].sort());
    expect(small.getInstructions()).toBe(ESSENTIAL_INSTRUCTIONS);
    expect(JSON.stringify(listed).length).toBeLessThan(60_000);
    // a tool that isn't listed still answers when called by name
    const r = await small.callTool({ name: "list_labels", arguments: {} });
    expect(r.isError).toBeFalsy();
    await small.close();
  });

  it("every essential tool exists, and each kind of map has its own", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const n of ESSENTIAL_TOOLS) expect(names.has(n), n).toBe(true);
    for (const n of ["add_landmass", "add_room", "add_buildings"]) expect(ESSENTIAL_TOOLS.has(n)).toBe(true);
  });
});
