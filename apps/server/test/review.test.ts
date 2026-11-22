// The fixes from the adversarial review of 2026-11-22 (docs/CHECKLIST.md): each test is a flaw that was shown on a throwaway server.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PICTURE_MAX_PIXELS, shrinkPicture } from "@mapmaker/core";
import { decodeImage, runTool } from "@mapmaker/tools";
import { KEEP_PICTURES, MAX_HISTORY_CHARS, trimHistory } from "../src/agent.ts";
import { AssetLibrary, forbidsUse } from "../src/assets.ts";
import { thumbnailOf } from "../src/compute.ts";
import { loadConfig } from "../src/config.ts";
import { Hub } from "../src/hub.ts";
import { accessPolicy, createAppServer, pictureSide } from "../src/http.ts";
import { PictureRefused, ProjectStore } from "../src/store.ts";

const PORT = 46000 + Math.floor(Math.random() * 900);
const dir = mkdtempSync(path.join(tmpdir(), "mapmaker-review-"));
let hub: Hub;
let server: ReturnType<typeof createAppServer>;
let a = "", b = "";

beforeAll(async () => {
  const cfg = loadConfig({ port: PORT, host: "127.0.0.1", projectsDir: dir, editorDist: path.join(dir, "no-editor"), accessToken: null });
  hub = new Hub(new ProjectStore(dir), null);
  await hub.createProject({ name: "Map A", width: 128, height: 128, kmPerPx: 2 });
  a = hub.activeId!;
  await hub.createProject({ name: "Map B", width: 128, height: 128, kmPerPx: 2 });
  b = hub.activeId!;
  await hub.openProject(a);
  server = createAppServer(cfg, hub);
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
});

afterAll(async () => {
  server.close();
  await hub.flush().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

/** A small PNG file that says it is `side` pixels square (black, so it packs into almost nothing). */
function hugePng(side: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((side + 1) * (side <= 256 ? side : 64)); // (a big one has only its first rows: the size it says is what is read first)
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const placeNames = () => (hub.session.doc.features?.places ?? []).map((p) => p.name);

describe("edits while the AI opens another map", () => {
  it("saves an edit made while the other map is read, and refuses one meant for the old map after the switch", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const errors: string[] = [];
    ws.on("message", (d: Buffer, binary: boolean) => { if (binary) return; try { const m = JSON.parse(d.toString()); if (m.t === "error") errors.push(m.message); } catch { /* a frame */ } });
    await new Promise((r) => ws.on("open", r));
    const place = (name: string, x: number, projectId?: string) => JSON.stringify({ t: "cmd", projectId, cmd: { op: "features", patch: { upsertPlaces: [{ id: `p-${x}`, name, type: "town", x, y: 20 }] } } });
    // the AI opens map B; meanwhile the DM, still on map A, adds a place
    const opening = runTool(hub.toolContext("mcp"), "open_project", { id: b });
    ws.send(place("During the switch", 30, a));
    await opening;
    await new Promise((r) => setTimeout(r, 200));
    expect(hub.activeId).toBe(b);
    expect(placeNames()).toEqual([]); // (not on map B)
    // a stroke's tail that arrives after the switch, still meant for map A, is refused (said once), not made on map B
    ws.send(place("After the switch", 40, a));
    ws.send(place("After the switch too", 41, a));
    await new Promise((r) => setTimeout(r, 200));
    expect(placeNames()).toEqual([]);
    expect(errors.filter((e) => /done on another map/.test(e))).toHaveLength(1);
    // and the edit made during the switch was saved with map A
    await hub.openProject(a);
    expect(placeNames()).toEqual(["During the switch"]);
    // an edit that names no map (scripts) goes to the open one, as before
    ws.send(place("Unnamed", 50));
    await new Promise((r) => setTimeout(r, 200));
    expect(placeNames()).toContain("Unnamed");
    ws.close();
  });
});

describe("files and pictures the server sends", () => {
  it("sends only pictures from a map's references and previews, never a page", async () => {
    const refs = path.join(dir, a, "refs");
    mkdirSync(refs, { recursive: true });
    writeFileSync(path.join(refs, "notes.html"), "<script>alert(1)</script>");
    writeFileSync(path.join(refs, "pic.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    writeFileSync(path.join(refs, "map.png"), Buffer.from(hugePng(8)));
    for (const f of ["notes.html", "pic.svg"]) expect((await fetch(`http://127.0.0.1:${PORT}/api/projects/${a}/refs/${f}`)).status).toBe(404);
    const ok = await fetch(`http://127.0.0.1:${PORT}/api/projects/${a}/refs/map.png`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("content-security-policy")).toMatch(/sandbox/);
  });

  it("makes a sensible picture whatever size is asked", () => {
    expect(pictureSide("abc")).toBe(2048);
    expect(pictureSide(null)).toBe(2048);
    expect(pictureSide("100")).toBe(256);
    expect(pictureSide("99999")).toBe(4096);
    expect(pictureSide("1000.4")).toBe(1000);
  });

  it("refuses a small file that claims a huge picture, before reading it", async () => {
    const bomb = hugePng(12000);
    expect(bomb.byteLength).toBeLessThan(200_000);
    await expect(hub.store.addRef(a, "bomb.png", bomb)).rejects.toThrow(PictureRefused);
    await expect(hub.store.addRef(a, "bomb.png", bomb)).rejects.toThrow(/12,000 x 12,000 pixels/);
    expect(() => decodeImage(bomb)).toThrow(/at most 40 million/);
    expect(12000 * 12000).toBeGreaterThan(PICTURE_MAX_PIXELS);
    const r = await fetch(`http://127.0.0.1:${PORT}/api/projects/${a}/refs`, { method: "POST", headers: { "x-file-name": "bomb.png" }, body: Buffer.from(bomb) });
    expect(r.status).toBe(415);
  });

  it("reads pictures on the worker thread when one is there", async () => {
    const pics = hub.toolContext("mcp").pictures!;
    expect(await pics.decode(hugePng(8))).toMatchObject({ w: 8, h: 8 });
    await expect(pics.decode(hugePng(12000))).rejects.toThrow(/pixels/);
  });
});

describe("asset packs", () => {
  it("takes every way an author writes no as no", () => {
    for (const no of [false, 0, "false", "No", " off ", "0"]) expect(forbidsUse(no), String(no)).toBe(true);
    for (const yes of [true, undefined, null, "true", "yes", 1]) expect(forbidsUse(yes), String(yes)).toBe(false);
  });

  it("makes a pack's thumbnails on the worker thread, and keeps them", async () => {
    const packs = mkdtempSync(path.join(tmpdir(), "mapmaker-review-packs-"));
    mkdirSync(path.join(packs, "Kit", "Props"), { recursive: true });
    writeFileSync(path.join(packs, "Kit", "Props", "crate.png"), Buffer.from(hugePng(200)));
    const lib = new AssetLibrary(packs, path.join(packs, ".cache"));
    let made = 0;
    lib.pictures = { decode: async () => null, thumbnail: async (b, m) => { made++; return thumbnailOf(b, m); }, shrink: async () => null };
    await lib.scan();
    const id = lib.list({ q: "crate" }).items[0].id;
    const t = await lib.thumbnail(id, 64);
    expect(t?.mime).toBe("image/png");
    expect(t?.orig).toEqual({ w: 200, h: 200 });
    expect(await lib.thumbnail(id, 64)).not.toBeNull();
    expect(made).toBe(1); // (the second came from the cache)
    // floor tiles and objects are made ready there too (the first use of a big texture held up the server)
    let shrunk = 0;
    lib.pictures = { ...lib.pictures, shrink: async (b, j) => { shrunk++; const img = decodeImage(b); return img ? shrinkPicture(img, j) : null; } };
    expect(await lib.sprite(id, 0.5)).toMatchObject({ w: 100, h: 100, origW: 200 });
    expect((await lib.tile(id))?.size).toBe(512);
    expect(shrunk).toBe(2);
    rmSync(packs, { recursive: true, force: true });
  });
});

describe("the address the server answers to", () => {
  it("lets the developer editor's port in only when it is set", () => {
    const base = loadConfig({ port: 4747, accessToken: null, projectsDir: dir, editorDist: dir });
    expect(accessPolicy({ ...base, devEditorPort: 5173 }).hosts).toContain("localhost:5173");
    expect(accessPolicy({ ...base, devEditorPort: null }).hosts.some((h) => h.endsWith(":5173"))).toBe(false);
  });
});

describe("the in-app chat's history", () => {
  const picture = (n: number) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: `${n}`.repeat(50_000) } });
  it("keeps only the newest pictures, and every tool call with its result", () => {
    const messages: { role: string; content: unknown }[] = [];
    for (let t = 0; t < 10; t++) {
      messages.push({ role: "user", content: [{ type: "text", text: `turn ${t}` }, picture(t)] });
      messages.push({ role: "assistant", content: [{ type: "tool_use", id: `tu${t}`, name: "render_preview", input: {} }] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `tu${t}`, content: [{ type: "text", text: "ok" }, picture(100 + t)] }] });
      messages.push({ role: "assistant", content: [{ type: "text", text: "done" }] });
    }
    const out = trimHistory(messages);
    const pics = JSON.stringify(out).match(/"type":"image"/g) ?? [];
    expect(pics).toHaveLength(KEEP_PICTURES);
    expect(out).toHaveLength(messages.length); // (small enough: no turn dropped)
    expect(JSON.stringify(out[out.length - 2])).toMatch(/"type":"image"/); // (the newest stay)
    expect(JSON.stringify(out[0])).toMatch(/left out of the conversation/);
  });

  it("drops the oldest whole turns when it is too long, starting with the DM's words", () => {
    const long = "x".repeat(MAX_HISTORY_CHARS / 4);
    const messages: { role: string; content: unknown }[] = [];
    for (let t = 0; t < 8; t++) {
      messages.push({ role: "user", content: [{ type: "text", text: `turn ${t}` }] });
      messages.push({ role: "assistant", content: [{ type: "tool_use", id: `tu${t}`, name: "list_places", input: {} }] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `tu${t}`, content: long }] });
    }
    const out = trimHistory(messages);
    expect(out.length).toBeLessThan(messages.length);
    expect(out[0].role).toBe("user");
    expect(JSON.stringify(out[0])).toMatch(/start of this conversation was left out/);
    expect(JSON.stringify(out[0])).not.toMatch(/tool_result/); // (a turn starts with the DM's words: no tool result without its call)
    expect(JSON.stringify(out).length).toBeLessThan(MAX_HISTORY_CHARS + 2000);
  });
});
