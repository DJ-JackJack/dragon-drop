// End-to-end smoke test: real server + built editor + headless Chromium.
// Uses a throwaway copy of the projects folder so your maps are never touched.
// Run: pnpm build && pnpm e2e        (needs Playwright installed)
// A slow PC: E2E_CORES=2 keeps this test, the server and the browser on two processor cores (Windows), E2E_CPU_SLOWDOWN=4 makes the editor's page four times slower.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
if (process.env.E2E_CORES && process.platform === "win32") {
  // (set on this process before the server and the browser start: they inherit it)
  const mask = (1 << Math.max(1, Math.min(16, Number(process.env.E2E_CORES) || 2))) - 1;
  spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${process.pid}).ProcessorAffinity = ${mask}`], { stdio: "ignore" });
  console.log(`Slow PC: ${process.env.E2E_CORES} cores`);
}
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const port = 47900 + Math.floor(Math.random() * 90);
const key = randomBytes(24).toString("hex"); // the server is run with an access key, as the desktop app runs it: pages get in by opening /?t=<key> once
const tmp = mkdtempSync(path.join(tmpdir(), "mapmaker-e2e-"));
// (the projects folder starts empty: the server makes its generated "First Map", the same map a new install starts with)
const shots = process.env.E2E_SHOTS ?? tmp;

// a small asset pack file for the asset browser (generated here; nothing from a real pack)
const assetsDir = path.join(tmp, "Assets");
{
  const { PNG } = createRequire(path.join(root, "packages/tools/package.json"))("pngjs");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const png = (w, h, [r, g, b]) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) p.data.set([r, g, b, 255], i * 4); return new Uint8Array(PNG.sync.write(p)); };
  const enc = new TextEncoder();
  const files = [
    { path: "packs/E2EPACK1.json", data: enc.encode(JSON.stringify({ name: "E2E Pack", id: "E2EPACK1", version: "1" })) },
    { path: "textures/objects/Oak_Table.png", data: png(512, 256, [150, 100, 50]) },
    { path: "textures/objects/Barrel.png", data: png(256, 256, [120, 80, 40]) },
    { path: "textures/terrain/Grass.png", data: png(1024, 1024, [50, 160, 50]) },
  ];
  const pad = (n, a) => (a - (n % a)) % a;
  const names = files.map((f) => enc.encode(`res://${f.path}`));
  let index = 4 + 4 + 12 + 64 + 4;
  for (const n of names) index += 4 + n.length + pad(n.length, 4) + 8 + 8 + 16;
  let cursor = index + pad(index, 16);
  const offsets = files.map((f) => { const o = cursor; cursor += f.data.length + pad(f.data.length, 16); return o; });
  const out = new Uint8Array(cursor), dv = new DataView(out.buffer);
  let at = 0;
  const u32 = (v) => { dv.setUint32(at, v, true); at += 4; };
  const u64 = (v) => { dv.setUint32(at, v, true); dv.setUint32(at + 4, 0, true); at += 8; };
  u32(0x43504447); u32(1); u32(3); u32(5); u32(0); for (let i = 0; i < 16; i++) u32(0); u32(files.length);
  files.forEach((f, i) => { u32(names[i].length + pad(names[i].length, 4)); out.set(names[i], at); at += names[i].length + pad(names[i].length, 4); u64(offsets[i]); u64(f.data.length); at += 16; });
  files.forEach((f, i) => out.set(f.data, offsets[i]));
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(path.join(assetsDir, "E2E.test_pack"), out);
  // a rough sketch (green land on blue sea) to attach as a reference: the generated first map has none of its own
  const sk = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const land = (x - 128) ** 2 + (y - 128) ** 2 < 80 ** 2 || (x - 60) ** 2 + (y - 190) ** 2 < 30 ** 2;
    sk.data.set(land ? [90, 160, 70, 255] : [40, 90, 170, 255], (y * 256 + x) * 4);
  }
  writeFileSync(path.join(tmp, "e2e-sketch.png"), PNG.sync.write(sk));
  // a made-up town seen from above (300 x 200 px: grass, a sandy street, a row of red tile roofs above it and a row of grey slate ones below), for the city picture reader
  const town = new PNG({ width: 300, height: 200 });
  for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) {
    const k = (x - 20) % 30, house = x >= 20 && x < 290 && k < 8;
    const c = house && y >= 60 && y < 70 ? [178, 74, 52] : house && y >= 120 && y < 130 ? [96, 104, 112] : y >= 95 && y < 105 ? [196, 178, 140] : [100, 150, 70];
    town.data.set([...c, 255], (y * 300 + x) * 4);
  }
  writeFileSync(path.join(tmp, "e2e-town.png"), PNG.sync.write(town));
}

const env = { ...process.env, MAPMAKER_PORT: String(port), MAPMAKER_PROJECTS_DIR: tmp, ANTHROPIC_API_KEY: "", MAPMAKER_FAKE_MODEL: "1", MAPMAKER_ACCESS_TOKEN: key, MAPMAKER_ASSETS_DIR: assetsDir, MAPMAKER_CACHE_DIR: path.join(tmp, "cache"), MAPMAKER_AUTO_BACKUP_MINUTES: "0.03" }; // (rolling backups every couple of seconds instead of every 15 minutes)
// E2E_APP=<an unpacked Dragon Drop folder> runs the test against that program's own server and editor (a test copy before a release), the way the desktop app starts them
const appDir = process.env.E2E_APP ? path.resolve(process.env.E2E_APP) : null;
if (appDir) Object.assign(env, { ELECTRON_RUN_AS_NODE: "1", MAPMAKER_NO_DOTENV: "1", MAPMAKER_HOST: "127.0.0.1", MAPMAKER_EDITOR_DIST: path.join(appDir, "resources", "editor") });
const server = appDir
  ? spawn(path.join(appDir, "Dragon Drop.exe"), [path.join(appDir, "resources", "server", "main.mjs")], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] })
  : spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/main.ts"], { cwd: path.join(root, "apps/server"), env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const fail = (msg) => { console.error(`E2E FAIL: ${msg}\n--- server log ---\n${log}`); cleanup(1); };
function cleanup(code) {
  server.kill();
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the server may still be writing; the OS cleans /tmp */ }
  process.exit(code);
}

for (let i = 0; i < 60 && !log.includes("Dragon Drop"); i++) await new Promise((r) => setTimeout(r, 250));
if (!log.includes("Dragon Drop")) fail("server did not start");

const browser = await chromium.launch();
let failShot = async () => {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (process.env.E2E_CPU_SLOWDOWN) {
    await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.E2E_CPU_SLOWDOWN) });
    console.log(`Slow PC: the page runs ${process.env.E2E_CPU_SLOWDOWN} times slower`);
  }
  // The Map panel shows one tab at a time (Map, History). For the long walk through the editor below every tab body is shown at once, as the old single column was; one step checks the tabs themselves. The Assets panel is given room of its own so it does not shrink to nothing among them.
  await page.addInitScript(() => {
    const show = () => { const st = document.createElement("style"); st.id = "e2e-show-all-tabs"; st.textContent = ".tab-off { display: contents !important; } .side-body > .assets-panel { flex: none !important; min-height: 700px !important; }"; document.head.append(st); };
    if (document.head) show(); else document.addEventListener("DOMContentLoaded", show);
  });
  failShot = () => page.screenshot({ path: path.join(shots, "e2e-FAIL.png") }).catch(() => {}); // (what the page looked like when a step failed)
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // the page is served with a content security policy: anything it blocks is a bug in the page (or the policy)
  const blocked = (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(`blocked by the security policy: ${m.text()}`); };
  page.on("console", blocked);
  /** Type into the app's own dialog (it replaced the browser's pop-up boxes) and confirm. */
  const answer = async (text) => {
    const input = page.getByTestId("dialog-input");
    await input.waitFor({ timeout: 10000 });
    await input.fill(text);
    await input.press("Enter");
    await page.getByTestId("dialog").waitFor({ state: "detached", timeout: 10000 });
  };
  // without the key the API says no; with it, yes; and opening the page with the key leaves no key in the address
  const bare = await fetch(`http://localhost:${port}/api/health`);
  if (bare.status !== 401) throw new Error(`/api/health with no access key answered ${bare.status}, not 401`);
  const keyed = await fetch(`http://localhost:${port}/api/health`, { headers: { authorization: `Bearer ${key}` } });
  if (keyed.status !== 200) throw new Error(`/api/health with the access key answered ${keyed.status}`);
  await page.goto(`http://localhost:${port}/?t=${key}`);
  if (new URL(page.url()).search.includes("t=")) throw new Error(`the access key was left in the address: ${page.url()}`);
  await page.getByText("Connected").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector(".mapview-empty"), null, { timeout: 15000 });
  await page.waitForTimeout(400);

  // the canvas actually shows the map (not just background)
  const varied = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="map-canvas"]');
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return seen.size;
  });
  if (varied < 20) fail(`map canvas looks blank (${varied} colours)`);
  // Painted Relief arrives once the noise worker and the server's derived layers are ready
  await page.waitForFunction(() => !document.querySelector(".mapview-busy"), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector(".mapview-busy"), null, { timeout: 30000 });
  await page.screenshot({ path: path.join(shots, "e2e-1-loaded.png") });

  // save a checkpoint through the UI
  await page.getByRole("button", { name: "Save checkpoint" }).click();
  await answer("Before test");
  await page.getByTestId("checkpoints").getByText("Before test").waitFor({ timeout: 10000 });

  // switch style to Relief and back (undoable, shows in history)
  await page.getByRole("button", { name: "Relief", exact: true }).click();
  await page.getByTestId("history").getByText("Style: relief").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Painted", exact: true }).click();
  await page.getByTestId("history").getByText("Style: painted").waitFor({ timeout: 10000 });

  // the Map panel: its tabs show one list at a time, and each panel can be hidden and shown again (the Claude panel is on by default, and the choice is remembered)
  {
    await page.evaluate(() => document.getElementById("e2e-show-all-tabs")?.remove());
    await page.getByTestId("places").waitFor({ timeout: 5000 }); // (the Map tab is showing)
    if (await page.getByTestId("history").isVisible()) fail("the History list shows on the Map tab");
    await page.getByTestId("mp-tab-history").click();
    await page.getByTestId("history").waitFor({ timeout: 5000 });
    if (await page.getByTestId("places").isVisible()) fail("the Places list shows on the History tab");
    await page.getByTestId("mp-tab-map").click();
    await page.getByTestId("places").waitFor({ timeout: 5000 });
    if ((await page.getByTestId("toggle-claude-panel").getAttribute("aria-pressed")) !== "true") fail("the Claude panel is not on by default");
    if (!(await page.locator(".right-panel").count())) fail("no Claude panel on a fresh page");
    await page.getByTestId("toggle-claude-panel").click();
    if (await page.locator(".right-panel").count()) fail("the Claude panel is still there after hiding it");
    await page.reload();
    await page.getByText("Connected").waitFor({ timeout: 15000 });
    if (await page.locator(".right-panel").count()) fail("the Claude panel came back after a reload: the choice was not remembered");
    await page.getByTestId("toggle-claude-panel").click();
    await page.locator(".right-panel").waitFor({ timeout: 5000 });
    await page.getByTestId("toggle-map-panel").click();
    if (await page.getByTestId("places").count()) fail("the Map panel is still showing after hiding it");
    await page.getByTestId("toggle-map-panel").click();
    await page.getByTestId("places").waitFor({ timeout: 5000 });
    // (the map is painted again after the reload: wait for it as the first load does)
    await page.waitForFunction(() => !document.querySelector(".mapview-empty"), null, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector(".mapview-busy"), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !document.querySelector(".mapview-busy"), null, { timeout: 30000 });
  }

  // paint a raise stroke across the map centre
  await page.getByRole("button", { name: "Raise" }).click();
  const box = await page.locator('[data-testid="map-canvas"]').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 80, cy);
  await page.mouse.down();
  for (let i = 0; i <= 16; i++) await page.mouse.move(cx - 80 + i * 10, cy + Math.sin(i / 3) * 20);
  await page.mouse.up();
  await page.getByTestId("history").getByText("Raise brush").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(shots, "e2e-2-brushed.png") });

  // undo through the UI
  await page.getByRole("button", { name: /Undo/ }).click();
  await page.getByTestId("history").getByText("Undo: Raise brush").waitFor({ timeout: 10000 });
  // rolling backups: the first save after an edit leaves an automatic checkpoint in the list, next to the ones a person saves
  await page.getByTestId("checkpoints").getByText(/^Auto \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).first().waitFor({ timeout: 20000 });
  await page.getByTestId("checkpoints").getByText("Before test").waitFor({ timeout: 5000 });

  // the conventional keys: + and - zoom, the arrow keys pan, 0 fits the map again; Ctrl+S saves now; ? shows the keys
  {
    await page.waitForFunction(() => !document.querySelector(".mapview-busy"), null, { timeout: 60000 });
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
    const sig = () => page.evaluate(() => {
      const c = document.querySelector('[data-testid="map-canvas"]');
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4 * 211) h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) >>> 0;
      return h;
    });
    const canvasSize = () => page.evaluate(() => { const c = document.querySelector('[data-testid="map-canvas"]'); return `${c.clientWidth}x${c.clientHeight} (pixels ${c.width}x${c.height})`; });
    const sizeBefore = await canvasSize();
    // (the painted map can still be catching up after the Undo above: wait until two samples half a second apart agree)
    const settle = async () => { let prev = await sig(); for (let i = 0; i < 24; i++) { await page.waitForTimeout(500); const now = await sig(); if (now === prev) return now; prev = now; } return prev; };
    const fitted = await settle();
    await page.screenshot({ path: path.join(shots, "e2e-fit-before.png") });
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await page.waitForTimeout(400);
    const zoomed = await sig();
    if (zoomed === fitted) fail("pressing + twice didn't change the picture: keyboard zoom isn't working");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(300);
    if ((await sig()) === zoomed) fail("an arrow key didn't move the view");
    await page.keyboard.press("0");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(shots, "e2e-fit-after.png") });
    if ((await settle()) !== fitted) fail(`pressing 0 didn't bring back the fitted view (canvas ${sizeBefore} before, ${await canvasSize()} after)`);
    await page.keyboard.press("-");
    await page.waitForTimeout(300);
    if ((await sig()) === fitted) fail("pressing - didn't zoom out");
    await page.keyboard.press("Control+0");
    await page.waitForTimeout(600);
    if ((await settle()) !== fitted) fail("pressing Ctrl+0 didn't bring back the fitted view");

    await page.keyboard.press("Control+s");
    await page.getByTestId("saved").waitFor({ timeout: 10000 });

    await page.keyboard.press("Shift+Slash"); // the ? key
    await page.getByTestId("shortcuts").waitFor({ timeout: 5000 });
    const sheet = await page.getByTestId("shortcuts").innerText();
    for (const want of ["Ctrl+Z", "Ctrl+S", "Fit the whole map", "Raise", "Detail map"]) if (!sheet.includes(want)) fail(`the shortcut sheet doesn't mention "${want}"`);
    await page.keyboard.press("Escape");
    await page.getByTestId("shortcuts").waitFor({ state: "detached", timeout: 5000 });
    await page.getByTestId("shortcuts-button").click();
    await page.getByTestId("shortcuts").waitFor({ timeout: 5000 });
    await page.getByTestId("shortcuts").getByRole("button", { name: "Close" }).click();
    await page.getByTestId("shortcuts").waitFor({ state: "detached", timeout: 5000 });
  }

  // add a place with the Place tool, then change its type in the inspector
  await page.getByRole("button", { name: "Place", exact: true }).click();
  await page.getByTestId("tool-hint").getByText(/Click on the map where the place goes/).waitFor({ timeout: 5000 });
  await page.mouse.click(cx + 60, cy - 40);
  // cancelling the name box adds nothing, and the tool stays ready
  await page.getByTestId("dialog").getByText(/Name of this/).waitFor({ timeout: 5000 });
  await page.getByTestId("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByTestId("dialog").waitFor({ state: "detached", timeout: 5000 });
  await page.mouse.click(cx + 60, cy - 40);
  await answer("Test Harbour");
  await page.getByTestId("places").getByText("Test Harbour").waitFor({ timeout: 10000 });
  // a new place starts as the kind picked in the Place tool (a town by default); the inspector's picker changes it
  await page.getByTestId("places").getByText("Town", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByTestId("place-kind-current").click();
  await page.getByTestId("inspector-kind-port").click();
  await page.getByTestId("places").getByText("Port", { exact: true }).waitFor({ timeout: 10000 });
  // and one of the new pictures: choose a lighthouse in the Place tool, place one, see it in the list
  await page.getByRole("button", { name: "Place", exact: true }).click();
  await page.getByTestId("place-kind-menu").click(); // (the kinds open from a button in the tool bar, and it closes when one is chosen)
  await page.getByTestId("place-kind-lighthouse").click();
  await page.getByTestId("place-kind-menu-body").waitFor({ state: "detached", timeout: 5000 });
  await page.mouse.click(cx - 70, cy + 50);
  await answer("Test Light");
  await page.getByTestId("places").getByText("Lighthouse", { exact: true }).waitFor({ timeout: 10000 });
  // the picture is really drawn on the map: some of the pixels round the marker are the ink colour
  await page.waitForTimeout(600); // (the canvas redraws on the next frame)
  await page.screenshot({ path: path.join(shots, "e2e-place-kinds.png") });
  const inked = await page.evaluate(({ x, y }) => {
    const c = document.querySelector('[data-testid="map-canvas"]');
    const r = c.getBoundingClientRect(), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, k = c.width / r.width;
    const ink = (px, py) => { // dark (ink coloured) pixels in a 17 x 17 px window round a screen point
      let n = 0;
      for (let yy = -8; yy <= 8; yy++) for (let xx = -8; xx <= 8; xx++) { const o = (Math.round((py - r.top + yy) * k) * c.width + Math.round((px - r.left + xx) * k)) * 4; if (d[o] < 40 && d[o + 1] < 40 && d[o + 2] < 50) n++; }
      return n;
    };
    return { marker: ink(x, y), sea: ink(x - 40, y + 5) };
  }, { x: cx - 70, y: cy + 50 });
  if (inked.marker < 8 || inked.sea > 2) throw new Error(`the lighthouse picture doesn't seem to be drawn on the map (${inked.marker} ink pixels at the marker, ${inked.sea} beside it)`);
  // the Label size setting is there and takes a value (names and markers are drawn from it)
  await page.getByTestId("label-size").fill("0.6");
  if ((await page.getByTestId("label-size").inputValue()) !== "0.6") throw new Error("the Label size slider did not take a value");
  await page.getByTestId("label-size").fill("1");
  // and a label with the Label tool
  await page.getByRole("button", { name: "Label", exact: true }).click();
  await page.mouse.click(cx - 140, cy + 90);
  await answer("Test Sea");
  await page.getByTestId("history").getByText("Add label Test Sea").waitFor({ timeout: 10000 });
  // drag with the Label tool: the label follows the line
  await page.mouse.move(cx - 230, cy + 160);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cx - 230 + i * 14, cy + 160 + Math.sin(i / 3) * 18);
  await page.mouse.up();
  await answer("Test Range");
  await page.getByTestId("history").getByText("Add label Test Range").waitFor({ timeout: 10000 });
  await page.getByText(/Follows a line/).waitFor({ timeout: 5000 });
  // climate region: click corners, double-click to close, then make it frozen with snow
  await page.getByRole("button", { name: "Climate", exact: true }).click();
  for (const [dx, dy] of [[60, -150], [170, -140], [180, -60], [80, -50]]) await page.mouse.click(cx + dx, cy + dy);
  await page.mouse.dblclick(cx + 70, cy - 90);
  await answer("Test Frost");
  await page.getByTestId("regions").getByText("Test Frost").waitFor({ timeout: 10000 });
  await page.getByTestId("inspector").getByText("Temperature").click();
  await page.getByTestId("inspector").getByText("Ground snow").click();
  await page.getByTestId("regions").getByText(/frozen|cold/).waitFor({ timeout: 10000 });
  await page.getByTestId("history").getByText("Edit climate region Test Frost").first().waitFor({ timeout: 10000 });
  // grid: switch to hex, change the size, then back off
  await page.getByTestId("grid-panel").getByRole("button", { name: "Hex", exact: true }).click();
  await page.getByTestId("history").getByText(/Hex grid, \d/).first().waitFor({ timeout: 10000 });
  await page.getByTestId("grid-size").fill("60");
  await page.getByTestId("grid-size").press("Enter");
  await page.getByTestId("history").getByText("Hex grid, 60 mi").first().waitFor({ timeout: 10000 });
  await page.getByTestId("grid-panel").getByText(/One cell = 60 mi/).waitFor({ timeout: 5000 });
  await page.getByTestId("grid-panel").getByRole("button", { name: "Square", exact: true }).click();
  // (the server may still be working out the climate after the edits above: that can take 10 seconds or more)
  await page.getByTestId("history").getByText("Square grid, 60 mi").first().waitFor({ timeout: 40000 });
  // wait for the panel itself to show Square (the buttons follow the map, not the click) before switching back
  await page.locator('[data-testid="grid-panel"] .seg button.on', { hasText: "Square" }).waitFor({ timeout: 15000 });
  await page.getByTestId("grid-panel").getByRole("button", { name: "Hex", exact: true }).click();
  await page.locator('[data-testid="grid-panel"] .seg button.on', { hasText: "Hex" }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, "e2e-3b-hexgrid.png") });
  // a size too fine for this zoom says so, and the button zooms in until it can be seen
  await page.getByTestId("grid-panel").getByRole("button", { name: "6 mi", exact: true }).click();
  await page.getByTestId("grid-too-fine").waitFor({ timeout: 5000 });
  await page.getByTestId("grid-too-fine").getByRole("button").click();
  await page.getByTestId("grid-too-fine").waitFor({ state: "detached", timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, "e2e-3c-hex6.png") });
  // back to the whole map, grid off, for the steps that follow
  await page.getByTestId("grid-panel").getByRole("button", { name: "Off", exact: true }).click();
  await page.getByRole("button", { name: /Fit/ }).click();
  await page.waitForTimeout(300);
  // map extras: title, scale bar, compass; then export a real PNG
  await page.locator('[data-testid="extras-panel"] summary').click();
  await page.getByTestId("extras-title").fill("The Test Isles");
  await page.getByTestId("extras-title").press("Enter");
  await page.getByTestId("history").getByText(/Map extras: title/).first().waitFor({ timeout: 10000 });
  // one click each, waiting for every change to land before the next (the checkboxes follow the server's reply)
  await page.getByTestId("extras-panel").getByText("Scale bar", { exact: true }).click();
  await page.getByTestId("history").getByText("Map extras: title, scale bar").first().waitFor({ timeout: 10000 });
  await page.getByTestId("extras-panel").getByText("Compass rose").click();
  await page.getByTestId("history").getByText(/title, scale bar, compass/).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, "e2e-3e-extras.png") });
  await page.getByTestId("export-button").click();
  await page.getByTestId("export-dialog").getByText(/4096 × 4096 px/).waitFor({ timeout: 5000 }); // (the first map is 1024 px: its 4× size; tiling is covered by the exportPlan unit tests)
  await page.getByTestId("export-size-1").check();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("export-go").click()]);
  if (!/\(1x\)\.png$/.test(download.suggestedFilename())) fail(`unexpected export name ${download.suggestedFilename()}`);
  const dpath = await download.path();
  const { statSync, readFileSync } = await import("node:fs");
  const png = readFileSync(dpath);
  if (png.subarray(1, 4).toString() !== "PNG" || png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) fail("the exported PNG isn't 1024 x 1024");
  if (statSync(dpath).size < 200000) fail("the exported PNG looks empty");
  await page.getByTestId("export-dialog").waitFor({ state: "detached", timeout: 10000 });
  // climate panel opens and shows its sliders
  await page.locator("details.climate").filter({ hasText: "Top edge latitude" }).locator("summary").click();
  await page.getByText(/^Snowline \d+ m/).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, "e2e-3-places.png") });

  // a full chat turn (scripted model): streamed text, tool chips, preview image, Claude's edit in history
  // a kind of picture the map tools can't read (GIF) is left out, with a note; a WebP (a real, tiny one) attaches, and so does a PNG
  await page.locator('.composer input[type="file"]').setInputFiles({ name: "left-out.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary") });
  await page.getByTestId("attach-note").waitFor({ timeout: 5000 });
  if ((await page.locator(".pending .thumb").count()) !== 0) throw new Error("a GIF picture was attached to the chat");
  const { readFileSync: readWebp } = await import("node:fs");
  await page.locator('.composer input[type="file"]').setInputFiles({ name: "tiny.webp", mimeType: "image/webp", buffer: readWebp(new URL("../../../packages/tools/test/fixtures/webp/lossless-1x1.webp", import.meta.url)) });
  await page.locator(".pending .thumb").first().waitFor({ timeout: 5000 });
  await page.locator(".pending .thumb button").first().click(); // (taken off again: the steps below attach the sketch)
  if ((await page.locator(".pending .thumb").count()) !== 0) throw new Error("the WebP thumbnail did not go away");
  await page.locator('.composer input[type="file"]').setInputFiles(path.join(tmp, "e2e-sketch.png")); // (kept in the project's references: the sketch step below uses it)
  await page.getByTestId("chat-input").fill("Add a small island in the inner sea");
  await page.keyboard.press("Enter");
  await page.getByText("Want hills on it, or a name?").waitFor({ timeout: 20000 });
  await page.getByText("Added land").waitFor();
  await page.getByText("Looked at the map").waitFor();
  await page.locator(".tool-image img").first().waitFor();
  await page.getByTestId("history").getByText(/Add landmass/).waitFor();
  const claudeBadge = await page.getByTestId("history").locator(".who.claude").count();
  if (claudeBadge < 1) fail("Claude's edit is not attributed in history");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, "e2e-4-chat.png") });

  // References: add pictures without the chat (the Add picture button, a drop anywhere, a paste on the map), refuse a GIF with a
  // note, look at one full size, rename it (its ending stays) and remove it
  {
    const refs = page.getByTestId("references");
    const gif = { name: "left-out.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary") };
    await refs.getByTestId("ref-file").setInputFiles(gif);
    const gifNote = page.locator(".toast").filter({ hasText: /"left-out\.gif" is a GIF/ });
    await gifNote.waitFor({ timeout: 10000 });
    await gifNote.click(); // (dismissed)
    const { readFileSync: readPng } = await import("node:fs");
    await refs.getByTestId("ref-file").setInputFiles({ name: "from button.png", mimeType: "image/png", buffer: readPng(path.join(tmp, "e2e-sketch.png")) });
    const card = refs.getByTestId("ref-card").filter({ hasText: "from button.png" });
    await card.waitFor({ timeout: 15000 });
    await card.getByText("256 × 256 px", { exact: false }).waitFor({ timeout: 5000 });
    await page.getByTestId("picture-note").filter({ hasText: "Added from button.png to References." }).waitFor({ timeout: 10000 });
    await card.locator(".ref-thumb").click();
    await page.getByTestId("picture-viewer").waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.getByTestId("picture-viewer").waitFor({ state: "detached", timeout: 5000 });
    await card.getByTestId("ref-rename").click();
    await answer("Renamed by e2e");
    const renamed = refs.getByTestId("ref-card").filter({ hasText: "Renamed by e2e.png" });
    await renamed.waitFor({ timeout: 10000 });
    await renamed.getByTestId("ref-remove").click();
    await page.getByTestId("dialog").getByRole("button", { name: "Remove" }).click();
    await renamed.waitFor({ state: "detached", timeout: 10000 });
    if (!readdirSync(tmp).some((d) => existsSync(path.join(tmp, d, "backups", "removed-pictures", "Renamed by e2e.png")))) fail("a removed picture did not go to the map's backups folder");
    // a picture dropped on the map: the drop note shows while it is dragged over, then it is added
    const sendPicture = (how, name) => page.evaluate(async ({ how, name }) => {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 24;
      c.getContext("2d").fillRect(4, 4, 8, 8);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: "image/png" }));
      const target = document.querySelector('[data-testid="map-canvas"]');
      if (how === "paste") { document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); return true; }
      target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      const shown = !!document.querySelector('[data-testid="drop-overlay"]') || (await new Promise((r) => requestAnimationFrame(() => r(!!document.querySelector('[data-testid="drop-overlay"]')))));
      target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      return shown;
    }, { how, name });
    if (!(await sendPicture("drop", "dropped.png"))) fail("the drop note did not show while a picture was dragged over the map");
    await refs.getByTestId("ref-card").filter({ hasText: "dropped.png" }).waitFor({ timeout: 15000 });
    await page.getByTestId("drop-overlay").waitFor({ state: "detached", timeout: 5000 });
    await sendPicture("paste", "pasted.png");
    await refs.getByTestId("ref-card").filter({ hasText: "pasted.png" }).waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(shots, "e2e-4a-references.png") });
    // (taken off again, so the sketch step below finds the sketch first)
    for (const n of ["dropped.png", "pasted.png"]) {
      await refs.getByTestId("ref-card").filter({ hasText: n }).getByTestId("ref-remove").click();
      await page.getByTestId("dialog").getByRole("button", { name: "Remove" }).click();
      await refs.getByTestId("ref-card").filter({ hasText: n }).waitFor({ state: "detached", timeout: 10000 });
    }
    // the trace picture: laid over the map, hidden and shown with U, dragged with Move (one undoable edit), locked, then taken off
    const sketchCard = refs.getByTestId("ref-card").filter({ hasText: "e2e-sketch.png" });
    await sketchCard.getByTestId("ref-trace").click();
    const bar = page.getByTestId("trace-bar");
    await bar.getByText("e2e-sketch.png").waitFor({ timeout: 10000 });
    await page.getByTestId("history").getByText("Trace picture e2e-sketch.png").first().waitFor({ timeout: 10000 });
    await page.keyboard.press("u");
    await bar.getByTestId("trace-shown").getByText("Show").waitFor({ timeout: 5000 });
    await page.keyboard.press("u");
    await bar.getByTestId("trace-shown").getByText("Hide").waitFor({ timeout: 5000 });
    await bar.getByTestId("trace-move").click();
    await bar.getByTestId("trace-help").waitFor({ timeout: 5000 });
    const mbox = await page.locator('[data-testid="map-canvas"]').boundingBox();
    await page.mouse.move(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(mbox.x + mbox.width / 2 + 60, mbox.y + mbox.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId("history").getByText("Move the trace picture").first().waitFor({ timeout: 10000 });
    await bar.getByTestId("trace-done").click();
    await bar.getByTestId("trace-lock").click();
    await bar.getByTestId("trace-lock").getByText("Locked").waitFor({ timeout: 5000 });
    if (!(await bar.getByTestId("trace-move").isDisabled())) fail("Move still works on a locked trace picture");
    await page.screenshot({ path: path.join(shots, "e2e-4b-trace.png") });
    await bar.getByTestId("trace-stop").click();
    await bar.waitFor({ state: "detached", timeout: 10000 });
    // the picture's own card stops it too: its button reads Stop tracing while it is over the map
    await sketchCard.getByTestId("ref-trace").click();
    await bar.waitFor({ timeout: 10000 });
    await sketchCard.getByTestId("ref-trace-stop").click();
    await bar.waitFor({ state: "detached", timeout: 10000 });
    await sketchCard.getByTestId("ref-trace").waitFor({ timeout: 5000 });
  }

  // roads and borders: a routed road over real terrain, then a closed border
  {
    const cbox = await page.locator('[data-testid="map-canvas"]').boundingBox();
    const fitScale = Math.min(cbox.width / 1024, cbox.height / 1024) * 0.95; // (the first map is 1024 px square)
    const sx = (mx) => cbox.x + (cbox.width - 1024 * fitScale) / 2 + mx * fitScale;
    const sy = (my) => cbox.y + (cbox.height - 1024 * fitScale) / 2 + my * fitScale;
    await page.getByRole("button", { name: "Roads", exact: true }).click();
    await page.getByTestId("tool-hint").getByText(/Click where the road starts/).waitFor({ timeout: 5000 });
    await page.mouse.click(sx(160), sy(476)); // two points on the big island, about 150 px apart
    await page.mouse.dblclick(sx(172), sy(320));
    const rows = (re) => page.getByTestId("lines").locator("button").filter({ hasText: re });
    await rows(/road/).first().waitFor({ timeout: 30000 });
    await page.getByTestId("history").getByText(/Add road \(\d+ mi\)/).first().waitFor({ timeout: 10000 });
    await page.getByTestId("inspector").getByText(/days on foot/).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(shots, "e2e-3d-road.png") });
    // a border: three points, then click the first point again to close it
    await page.getByTestId("line-kind").selectOption("border");
    await page.getByTestId("tool-hint").getByText(/Click the points along the border/).waitFor({ timeout: 5000 });
    for (const [mx, my] of [[100, 380], [260, 420], [220, 560]]) await page.mouse.click(sx(mx), sy(my));
    await page.mouse.click(sx(100) + 2, sy(380) + 2);
    await rows(/border/).first().waitFor({ timeout: 10000 });
    await page.getByTestId("inspector").getByText(/Closed \(joins back/).waitFor({ timeout: 10000 });
    if (!(await page.getByTestId("inspector").getByRole("checkbox").first().isChecked())) fail("the border did not close");
    // delete the border from the inspector; the road stays
    await page.getByTestId("inspector").getByRole("button", { name: "Delete" }).click();
    await rows(/border/).first().waitFor({ state: "detached", timeout: 10000 });
    if ((await rows(/road/).count()) < 1) fail("the road disappeared");
    // a reef: drawn straight through the clicked points (no route over the terrain), listed as a reef
    await page.getByTestId("line-kind").selectOption("reef");
    await page.getByTestId("tool-hint").getByText(/Click the points along the reef/).waitFor({ timeout: 5000 });
    await page.mouse.click(sx(60), sy(980)); // out at sea
    await page.mouse.dblclick(sx(150), sy(990));
    await page.getByTestId("history").getByText("Add reef").first().waitFor({ timeout: 10000 });
    await rows(/reef/).first().waitFor({ timeout: 10000 });
    await page.getByTestId("inspector").getByText("Reef").first().waitFor({ timeout: 5000 });
    await page.getByTestId("inspector").getByRole("button", { name: "Delete" }).click();
    await rows(/reef/).first().waitFor({ state: "detached", timeout: 10000 });
    await page.getByRole("button", { name: "Select", exact: true }).click();
  }

  // a regional map: drag a box with the Detail map tool, name it, jump to it and back
  await page.getByRole("button", { name: "Detail map", exact: true }).click();
  await page.mouse.move(cx - 150, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 120, { steps: 6 });
  await page.mouse.up();
  await answer("Test Detail");
  await page.getByTestId("regional").getByText("Test Detail").waitFor({ timeout: 60000 }).catch(async () => {
    // the new map opens by itself: its sidebar then shows the parent link instead
    await page.getByTestId("regional").getByText("parent").waitFor({ timeout: 60000 });
  });
  await page.getByTestId("regional").getByText("parent").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".mapview-busy"), null, { timeout: 90000 });
  await page.screenshot({ path: path.join(shots, "e2e-4b-regional.png") });
  await page.getByTestId("regional").getByText("parent").click();
  await page.getByTestId("regional").getByText("Test Detail").waitFor({ timeout: 30000 });

  // sketch to terrain: open the dialog from a reference, check the preview, create, then undo
  {
    await page.getByTestId("sketch-open").first().click();
    await page.getByTestId("sketch-dialog").waitFor({ timeout: 10000 });
    await page.getByText(/% land/).waitFor({ timeout: 10000 });
    const lit = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="sketch-preview"]');
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let land = 0, sea = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > d[i + 2]) land++; else sea++; }
      return { land, sea };
    });
    if (lit.land < 500 || lit.sea < 500) fail(`the sketch preview looks wrong (${JSON.stringify(lit)})`);
    await page.getByTestId("sketch-go").click();
    await page.getByTestId("history").getByText(/Terrain from sketch/).first().waitFor({ timeout: 60000 });
    await page.getByTestId("checkpoints").getByText("Before sketch import").waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, "e2e-4c-sketch.png") });
    await page.getByRole("button", { name: /Undo/ }).click();
    await page.getByTestId("history").getByText(/Undo: Terrain from sketch/).first().waitFor({ timeout: 20000 });
  }

  // copy, paste and duplicate on a world map: Ctrl+D makes a "(copy)" of the selected place a little along; Ctrl+C then Ctrl+V puts one under the pointer; Delete removes each
  {
    await page.getByTestId("places").getByText("Test Harbour", { exact: true }).click();
    await page.keyboard.press("Control+d");
    await page.getByTestId("places").getByText("Test Harbour (copy)").waitFor({ timeout: 10000 });
    await page.keyboard.press("Delete"); // (the copy is the selected place now)
    await page.getByTestId("places").getByText("Test Harbour (copy)").waitFor({ state: "detached", timeout: 10000 });
    await page.getByTestId("places").getByText("Test Harbour", { exact: true }).click();
    await page.keyboard.press("Control+c");
    const wb = await page.locator('[data-testid="map-canvas"]').boundingBox();
    await page.mouse.move(wb.x + wb.width * 0.3, wb.y + wb.height * 0.7);
    await page.keyboard.press("Control+v");
    await page.getByTestId("places").getByText("Test Harbour (copy)").waitFor({ timeout: 10000 });
    await page.keyboard.press("Delete");
    await page.getByTestId("places").getByText("Test Harbour (copy)").waitFor({ state: "detached", timeout: 10000 });
    // arrow keys nudge the selected place (three quick presses are one undo step); with nothing selected they move the view instead
    await page.getByTestId("places").getByText("Test Harbour", { exact: true }).click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.getByTestId("history").getByText("Nudge Test Harbour").waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    if ((await page.getByTestId("history").getByText("Nudge Test Harbour").count()) !== 1) fail("three quick arrow presses should be one nudge");
    await page.keyboard.press("Control+z");
    await page.getByTestId("history").getByText("Undo: Nudge Test Harbour").waitFor({ timeout: 10000 });
    // several at once: with the Select tool, Shift-drag a box round the whole map: every place and label in it joins the group; Delete removes them in one step, Undo brings them back
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.keyboard.down("Shift");
    // (starting clear of the "Selected: ..." bar over the map's top-left corner, and of the Export and Fit buttons at the bottom right)
    await page.mouse.move(wb.x + 20, wb.y + 170);
    await page.mouse.down();
    await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2, { steps: 5 });
    await page.mouse.move(wb.x + wb.width - 20, wb.y + wb.height - 90, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.getByTestId("world-group").waitFor({ timeout: 5000 });
    await page.keyboard.press("Delete");
    await page.getByTestId("history").getByText(/Delete \d+ items/).first().waitFor({ timeout: 10000 });
    await page.getByTestId("places").getByText("Test Harbour", { exact: true }).waitFor({ state: "detached", timeout: 10000 });
    await page.keyboard.press("Control+z");
    await page.getByTestId("history").getByText(/Undo: Delete \d+ items/).first().waitFor({ timeout: 10000 });
    await page.getByTestId("places").getByText("Test Harbour", { exact: true }).waitFor({ timeout: 10000 });
  }

  // battlemaps: create one, build a room, cut a door, add a light and floor, export for a tabletop, then back to the world map
  {
    const worldId = await page.locator("select.project").inputValue();
    // a battlemap made from a spot on the world map, then back
    {
      const wbox = await page.getByTestId("map-canvas").boundingBox();
      await page.getByRole("button", { name: "Battlemap here", exact: true }).click();
      await page.mouse.click(wbox.x + wbox.width / 2, wbox.y + wbox.height / 2);
      await answer("E2E Scene");
      await page.getByTestId("battle-canvas").waitFor({ timeout: 30000 });
      await page.getByTestId("battle-origin").getByText(/Made from/).waitFor({ timeout: 10000 });
      await page.waitForFunction(() => !document.querySelector(".mapview-empty") && !document.querySelector(".mapview-busy"), null, { timeout: 30000 });
      await page.getByTestId("battle-summary").getByText(/30 × 20 squares/).waitFor({ timeout: 5000 });
      await page.screenshot({ path: path.join(shots, "e2e-4f-scene.png") });
      await page.getByRole("button", { name: /Back to/ }).click();
      await page.getByTestId("map-canvas").waitFor({ timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector(".mapview-empty"), null, { timeout: 15000 });
    }
    await page.getByRole("button", { name: "+ New map" }).click();
    await page.getByTestId("new-kind-battle").click();
    await page.getByTestId("new-name").fill("E2E Cellar");
    await page.getByTestId("new-sx").fill("24");
    await page.getByTestId("new-sy").fill("16");
    await page.getByTestId("new-create").click();
    await page.getByTestId("battle-canvas").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector(".mapview-empty") && !document.querySelector(".mapview-busy"), null, { timeout: 30000 });
    await page.getByTestId("battle-summary").getByText(/24 × 16 squares/).waitFor({ timeout: 5000 });
    const box = await page.getByTestId("battle-canvas").boundingBox();
    // where a grid square is on screen (the view fits the map at 95%)
    const k = Math.min(box.width / 24, box.height / 16) * 0.95;
    const sq = (x, y) => ({ x: box.x + (box.width - 24 * k) / 2 + x * k, y: box.y + (box.height - 16 * k) / 2 + y * k });
    const drag = async (a, b) => {
      const p = sq(...a), q = sq(...b);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
      await page.mouse.move(q.x, q.y, { steps: 4 });
      await page.mouse.up();
    };
    const click = async (x, y) => { const p = sq(x, y); await page.mouse.click(p.x, p.y); };
    const painted = async () => page.evaluate(() => {
      const c = document.querySelector('[data-testid="battle-canvas"]');
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      return seen.size;
    });
    if ((await painted()) < 12) fail("battlemap canvas looks blank");
    // a wooden room inside the starting room
    await page.getByTestId("btool-room").click();
    await page.getByTestId("floor-material-menu").click(); // (the floors open from a button in the tool bar; it closes when one is chosen)
    await page.getByTestId("material-wood-planks").click();
    await drag([10, 5], [14, 9]);
    await page.getByTestId("history").getByText("Room walls (4×4)").waitFor({ timeout: 10000 });
    // a door in its top wall; then try one on bare floor, which should explain itself
    await page.getByTestId("btool-door").click();
    await click(12, 5);
    await page.getByTestId("history").getByText("Add door").waitFor({ timeout: 10000 });
    await page.getByTestId("battle-inspector").getByText("Door").first().waitFor({ timeout: 5000 });
    await page.getByTestId("wall-open").click(); // a controlled checkbox: it ticks when the server echoes the change
    await page.getByTestId("history").getByText("Change door").first().waitFor({ timeout: 10000 });
    await click(5, 11);
    await page.getByTestId("battle-note").waitFor({ timeout: 5000 });
    // a torch, and water painted with the brush (one undoable stroke)
    await page.getByTestId("btool-light").click();
    await click(12, 7);
    await page.getByTestId("history").getByText("Add light").waitFor({ timeout: 10000 });
    await page.getByTestId("light-radius").waitFor({ timeout: 5000 });
    // duplicate and copy/paste: the torch is selected. Ctrl+D puts a copy a square along and down; Ctrl+C then Ctrl+V pastes one under the pointer
    {
      await page.keyboard.press("Control+d");
      await page.getByTestId("history").getByText("Duplicate 1 item").waitFor({ timeout: 10000 });
      await page.keyboard.press("Control+c");
      const at = sq(19, 12);
      await page.mouse.move(at.x, at.y);
      await page.keyboard.press("Control+v");
      await page.getByTestId("history").getByText("Paste 1 item").waitFor({ timeout: 10000 });
      // back to the one torch: undo the paste and the duplicate
      await page.keyboard.press("Control+z");
      await page.getByTestId("history").getByText("Undo: Paste 1 item").waitFor({ timeout: 10000 });
      await page.keyboard.press("Control+z");
      await page.getByTestId("history").getByText("Undo: Duplicate 1 item").waitFor({ timeout: 10000 });
    }
    // several things at once: a second torch, then Shift-click joins the two, a box round them does too, one drag moves both, Delete removes both
    {
      await page.getByTestId("btool-light").click();
      await click(13, 8);
      await page.getByTestId("history").getByText("Add light").nth(1).waitFor({ timeout: 10000 });
      await page.getByTestId("btool-select").click();
      await click(12, 7); // the first torch alone
      await page.getByTestId("light-radius").waitFor({ timeout: 5000 });
      const at = sq(13, 8);
      await page.keyboard.down("Shift");
      await page.mouse.click(at.x, at.y);
      await page.keyboard.up("Shift");
      await page.getByTestId("battle-group").getByText("2 things selected").waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await page.getByTestId("battle-group").waitFor({ state: "detached", timeout: 5000 });
      // a box on bare floor round both (it must not wholly contain the room's walls, so they aren't taken)
      await drag([10.6, 6.3], [13.6, 8.7]);
      await page.getByTestId("battle-group").getByText("2 things selected").waitFor({ timeout: 5000 });
      if (!(await page.getByTestId("battle-group").innerText()).includes("2 lights")) fail("the group panel doesn't say what is selected");
      // one drag moves both
      await drag([12, 7], [12, 8]);
      await page.getByTestId("history").getByText("Move 2 items").waitFor({ timeout: 10000 });
      await page.keyboard.press("Control+z");
      await page.getByTestId("history").getByText("Undo: Move 2 items").waitFor({ timeout: 10000 });
      // Delete takes both away in one step, and Undo brings them back
      await page.keyboard.press("Delete");
      await page.getByTestId("history").getByText("Delete 2 items").waitFor({ timeout: 10000 });
      await page.keyboard.press("Control+z");
      await page.getByTestId("history").getByText("Undo: Delete 2 items").waitFor({ timeout: 10000 });
      // and back to the one torch the rest of the test expects: undo the second torch
      await page.keyboard.press("Control+z");
      await page.getByTestId("history").getByText("Undo: Add light").first().waitFor({ timeout: 10000 });
      await page.keyboard.press("Escape");
    }
    // arrow keys: with the torch selected they nudge it (quick presses are one undo step); with nothing selected they move the view
    {
      const sigB = () => page.evaluate(() => {
        const c = document.querySelector('[data-testid="battle-canvas"]');
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 4 * 211) h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) >>> 0;
        return h;
      });
      await page.getByTestId("btool-select").click();
      await click(12, 7);
      await page.getByTestId("light-radius").waitFor({ timeout: 5000 });
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.getByTestId("history").getByText("Nudge light").waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      if ((await page.getByTestId("history").getByText("Nudge light").count()) !== 1) fail("two quick arrow presses should be one nudge");
      await page.keyboard.press("Control+z");
      await page.getByTestId("history").getByText("Undo: Nudge light").waitFor({ timeout: 10000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const before = await sigB();
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(300);
      if ((await sigB()) === before) fail("an arrow key with nothing selected didn't move the view");
      await page.keyboard.press("0"); // fit again, as the rest of the test expects
      await page.waitForTimeout(300);
    }
    // snapping: a small drag snaps back to nothing; with Shift held once the drag has started, the light lands where it was let go
    {
      await page.getByTestId("btool-select").click();
      const a = sq(12, 7), b = sq(12.2, 7); // (a fifth of a square: less than the half-square snap)
      const dragWith = async (shift) => {
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 3 });
        if (shift) await page.keyboard.down("Shift");
        await page.mouse.move(b.x, b.y, { steps: 3 });
        await page.mouse.up();
        if (shift) await page.keyboard.up("Shift");
      };
      const moves = () => page.getByTestId("history").getByText(/^Move light$/).count();
      await dragWith(false);
      await page.waitForTimeout(600);
      if ((await moves()) !== 0) fail("a drag smaller than the snap should have snapped back to nothing");
      await dragWith(true);
      await page.getByTestId("history").getByText(/^Move light$/).first().waitFor({ timeout: 10000 });
      await page.keyboard.press("Control+z");
      await page.getByTestId("history").getByText("Undo: Move light").waitFor({ timeout: 10000 });
      await page.keyboard.press("Escape");
    }
    // the light level: Dim darkens the map except where the torch reaches; Bright restores it
    const lum = async (x, y) => {
      const p = sq(x, y);
      return page.evaluate(([cx, cy]) => { const c = document.querySelector('[data-testid="battle-canvas"]'); const d = c.getContext("2d").getImageData(cx, cy, 1, 1).data; return d[0] + d[1] + d[2]; }, [Math.round(p.x - box.x), Math.round(p.y - box.y)]);
    };
    const farBefore = await lum(3.5, 12.5), litBefore = await lum(11, 8); // the torch is inside the wooden room at (12, 7)
    await page.getByTestId("ambient-dim").click();
    await page.getByTestId("history").getByText("Light level: dim").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const farDim = await lum(3.5, 12.5), litDim = await lum(11, 8);
    if (!(farDim < farBefore * 0.8)) fail(`Dim did not darken the map away from the light (${farBefore} -> ${farDim})`);
    if (!(litDim > farDim * 1.3)) fail(`the torch's pool is not brighter than the dark around it (${litDim} vs ${farDim})`);
    if (!(litDim > litBefore * 0.6)) fail(`the lit floor went dark in Dim (${litBefore} -> ${litDim})`);
    await page.screenshot({ path: path.join(shots, "e2e-4d2-dim.png") });
    await page.getByTestId("ambient-bright").click();
    await page.getByTestId("history").getByText("Light level: bright").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const farBack = await lum(3.5, 12.5);
    if (Math.abs(farBack - farBefore) > farBefore * 0.1) fail(`Bright did not restore the map (${farBefore} -> ${farBack})`);
    // time-of-day presets carry a colour; a light zone gives an area its own level; notes make the key
    await page.getByTestId("ambient-night").click();
    await page.getByTestId("history").getByText("Light level: night").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const nightLum = await lum(3.5, 12.5);
    if (!(nightLum < farBefore * 0.6)) fail(`Night did not darken the map (${farBefore} -> ${nightLum})`);
    await page.getByTestId("btool-zone").click();
    await drag([3, 11], [8, 14]); // a rectangle in the bottom-left corner of the room
    await page.getByTestId("history").getByText("Add light zone").first().waitFor({ timeout: 10000 });
    await page.getByTestId("zone-level").waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    const zoneLum = await lum(5.5, 12.5);
    const outsideZone = await lum(10.5, 12.5);
    if (!(zoneLum > outsideZone * 1.4)) fail(`the light zone is not brighter than the night around it (${zoneLum} vs ${outsideZone})`);
    await page.getByTestId("zone-delete").click();
    await page.getByTestId("history").getByText("Delete light zone").first().waitFor({ timeout: 10000 });
    await page.getByTestId("ambient-bright").click();
    await page.getByTestId("history").getByText("Light level: bright").first().waitFor({ timeout: 10000 });
    await page.getByTestId("btool-note").click();
    await click(12, 7);
    await page.getByTestId("history").getByText("Add note 1").first().waitFor({ timeout: 10000 });
    await page.getByTestId("note-title").fill("Wooden room");
    await page.getByTestId("note-text").fill("A torch burns here.");
    await page.getByTestId("note-text").blur();
    await page.getByTestId("history").getByText("Change note 1").first().waitFor({ timeout: 10000 });
    await page.getByTestId("battle-key").getByText("Wooden room").waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(shots, "e2e-4d3-key.png") });
    await page.getByTestId("btool-brush").click();
    await page.getByTestId("floor-material-menu").click();
    await page.getByTestId("material-shallow-water").click();
    await drag([4, 11], [9, 12]);
    await page.getByTestId("history").getByText("Paint shallow water").waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, "e2e-4d-battlemap.png") });
    // the summary counts what we built
    await page.getByTestId("battle-summary").getByText(/1 door/).waitFor({ timeout: 5000 });
    await page.getByTestId("battle-summary").getByText(/1 light/).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: /Undo/ }).click();
    await page.getByTestId("history").getByText(/Undo: Paint shallow water/).first().waitFor({ timeout: 10000 });
    // pack assets: browse, search, use a floor texture and place an object
    await page.getByTestId("tab-assets").click();
    await page.getByTestId("assets-panel").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-item"]').length >= 2, null, { timeout: 15000 });
    await page.getByTestId("assets-search").fill("table");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-item"]').length === 1, null, { timeout: 10000 });
    await page.getByTestId("assets-search").fill("");
    await page.getByTestId("assets-cat-terrain").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-item"]').length === 1, null, { timeout: 10000 });
    await page.getByTestId("asset-item").first().click(); // adds the texture to the palette and picks the brush
    await page.getByTestId("history").getByText("Add floor texture Grass").waitFor({ timeout: 10000 });
    await page.getByTestId("floor-material-menu").click();
    await page.getByTestId("material-tex-Grass").waitFor({ timeout: 10000 });
    await page.keyboard.press("Escape");
    await drag([4, 12], [8, 12]);
    await page.getByTestId("history").getByText("Paint Grass").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500); // the texture loads, then the floor repaints
    const pixelAt = (pt) => page.evaluate(({ x, y }) => {
      const c = document.querySelector('[data-testid="battle-canvas"]');
      const dpr = window.devicePixelRatio || 1;
      const d = c.getContext("2d").getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, { x: pt.x - box.x, y: pt.y - box.y });
    const green = await pixelAt(sq(6, 12));
    if (!(green[1] > green[0] + 40 && green[1] > green[2] + 40)) fail(`the pack texture isn't painted (got ${green})`);
    await page.getByTestId("assets-cat-objects").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-item"]').length === 2, null, { timeout: 10000 });
    await page.getByTestId("asset-item").filter({ hasText: "Oak Table" }).click();
    await page.getByTestId("btool-prop").waitFor();
    await page.getByTestId("prop-options").waitFor({ timeout: 5000 });
    await click(16, 4);
    await page.getByTestId("history").getByText("Add object").waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    await page.getByTestId("battle-summary").getByText(/1 object/).waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(shots, "e2e-4e-assets.png") });
    const brown = await pixelAt(sq(16, 4));
    if (!(brown[0] > brown[2] + 40)) fail(`the object isn't drawn (got ${brown})`);
    await page.getByTestId("btool-select").click();
    await click(16, 4);
    await page.getByTestId("battle-inspector").getByText("Object").first().waitFor({ timeout: 5000 });
    await page.keyboard.press("e");
    await page.getByTestId("history").getByText("Change object").first().waitFor({ timeout: 10000 });
    await page.getByTestId("prop-delete").click();
    await page.getByTestId("history").getByText("Delete object").waitFor({ timeout: 10000 });
    await page.getByTestId("bgrid-hex").click();
    await page.getByTestId("history").getByText("Grid: hex").waitFor({ timeout: 10000 });
    await page.getByTestId("bgrid-square").click();
    // export for tabletops: Universal VTT carries the walls, door and light
    await page.getByTestId("battle-export-button").click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("battle-export-uvtt").click()]);
    if (!dl.suggestedFilename().endsWith(".dd2vtt")) fail(`unexpected export name ${dl.suggestedFilename()}`);
    const uvtt = JSON.parse(await (await import("node:fs/promises")).readFile(await dl.path(), "utf8"));
    if (uvtt.resolution.map_size.x !== 24 || uvtt.resolution.pixels_per_grid !== 70) fail("bad Universal VTT resolution");
    if (uvtt.portals.length !== 1 || uvtt.portals[0].closed !== false) fail(`expected one open door, got ${JSON.stringify(uvtt.portals)}`);
    if (uvtt.lights.length !== 1 || uvtt.line_of_sight.length < 2) fail("Universal VTT is missing the light or walls");
    await page.getByTestId("battle-export-dialog").waitFor({ state: "detached", timeout: 10000 });
    // the key: the numbered notes as Markdown (and they are not in the Universal VTT picture's walls or lights)
    await page.getByTestId("battle-export-button").click();
    const [keyDl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("battle-export-key").click()]);
    if (!keyDl.suggestedFilename().endsWith("-key.md")) fail(`unexpected key name ${keyDl.suggestedFilename()}`);
    const keyText = await (await import("node:fs/promises")).readFile(await keyDl.path(), "utf8");
    if (!keyText.includes("1. **Wooden room**") || !keyText.includes("A torch burns here.")) fail(`the key is missing the note: ${keyText}`);
    await page.getByTestId("battle-export-dialog").waitFor({ state: "detached", timeout: 10000 });
    // levels: add one above (it starts empty, with the room below showing faintly through it), switch with Page Down / Page Up, and the Foundry export has a picture for each
    await page.getByTestId("level-bar").waitFor({ timeout: 5000 });
    const isOn = (id) => page.evaluate((i) => !!document.querySelector(`[data-testid="level-row-${i}"].on`), id);
    const waitOn = (id) => page.waitForFunction((i) => !!document.querySelector(`[data-testid="level-row-${i}"].on`), id, { timeout: 15000 });
    await page.getByTestId("level-add-above").click();
    await waitOn("level-2");
    await page.getByTestId("battle-summary").getByText(/0 doors/).waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200); // (the faint picture of the level below is fetched from the server)
    if ((await painted()) < 12) fail("the upper level's canvas looks blank (the level below should show through it)");
    await page.screenshot({ path: path.join(shots, "e2e-4e-levels.png") });
    await page.keyboard.press("PageDown");
    await waitOn("level-1");
    await page.getByTestId("battle-summary").getByText(/1 door/).waitFor({ timeout: 10000 });
    // stairs, ladders and holes between levels: stairs on this (the lower) level lead up to the Upper floor; a hole in the Upper floor is open to the level below
    await page.getByTestId("btool-stairs").click();
    await page.getByTestId("tool-hint").getByText(/Change Level/).waitFor({ timeout: 5000 });
    await drag([18, 10], [19, 12]);
    await page.getByTestId("battle-inspector").getByRole("heading", { name: "Stairs" }).waitFor({ timeout: 5000 });
    await page.getByTestId("connector-target").getByText(/Leads up to Upper floor/).waitFor({ timeout: 5000 });
    await page.getByTestId("battle-summary").getByText(/1 stair, ladder or hole/).waitFor({ timeout: 5000 });
    await page.getByTestId("connector-lead").selectOption("down");
    await page.getByTestId("connector-target").getByText(/no level below/).waitFor({ timeout: 5000 });
    await page.getByTestId("connector-lead").selectOption("up");
    await page.getByTestId("connector-target").getByText(/Leads up to Upper floor/).waitFor({ timeout: 5000 });
    await page.getByTestId("btool-hole").click();
    await page.keyboard.press("PageUp");
    await waitOn("level-2");
    await page.getByTestId("battle-summary").getByText(/0 doors/).waitFor({ timeout: 10000 }); // (the level's own map has arrived: the row lights up a moment before)
    await click(18, 11); // (a click makes one square)
    await page.getByTestId("battle-inspector").getByRole("heading", { name: "Hole" }).waitFor({ timeout: 5000 });
    await page.getByTestId("connector-target").getByText(/Leads down to Ground floor/).waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(shots, "e2e-4e2-hole.png") });
    // a roof on the upper floor: drawn, changed to clay tile, shown solid, and exported as a tile with a ceiling
    await page.getByTestId("btool-roof").click();
    await page.getByTestId("tool-hint").getByText(/fades out of the way/).waitFor({ timeout: 5000 });
    await drag([12, 3], [20, 9]);
    await page.getByTestId("battle-inspector").getByRole("heading", { name: "Roof" }).waitFor({ timeout: 5000 });
    await page.getByTestId("roof-style").selectOption("tile");
    await page.getByTestId("battle-summary").getByText(/1 roof/).waitFor({ timeout: 5000 });
    await page.getByTestId("roof-view").selectOption("solid");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, "e2e-4e3-roof.png") });
    await page.keyboard.press("PageUp"); // (nothing above: stays)
    await page.waitForTimeout(300);
    if (!(await isOn("level-2"))) fail("Page Up above the highest level should stay on it");
    // the picture and the Universal VTT file are of one level, chosen in the dialog and named with it
    await page.getByTestId("battle-export-button").click();
    await page.getByTestId("export-level").waitFor({ timeout: 5000 });
    await page.getByTestId("export-level").locator("select").selectOption({ label: "Ground floor" });
    const [udl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("battle-export-uvtt").click()]);
    if (!udl.suggestedFilename().endsWith("-ground-floor.dd2vtt")) fail(`the Universal VTT file of the Ground floor should be named with it, got ${udl.suggestedFilename()}`);
    await page.getByTestId("battle-export-dialog").waitFor({ state: "detached", timeout: 10000 });
    await page.getByTestId("battle-export-button").click();
    const [fdl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("battle-export-foundry").click()]);
    const zipText = (await import("node:fs")).readFileSync(await fdl.path()).toString("latin1");
    if (!zipText.includes("-1-ground-floor.png") || !zipText.includes("-2-upper-floor.png")) fail("the Foundry export should hold a picture for each level");
    if (!zipText.includes("-2-upper-floor-roof-1.png")) fail("the Foundry export should hold the upper floor's roof as a picture of its own");
    await page.getByTestId("battle-export-dialog").waitFor({ state: "detached", timeout: 10000 });
    // remove the upper level again (a checkpoint is saved first), leaving the map as it was
    await page.getByLabel("Remove Upper floor").click();
    await page.getByRole("button", { name: "Remove level", exact: true }).click();
    await waitOn("level-1");
    await page.getByTestId("level-row-level-2").waitFor({ state: "detached", timeout: 10000 });
    await page.getByTestId("battle-summary").getByText(/1 door/).waitFor({ timeout: 10000 });
    await page.getByTestId("btool-select").click();
    await click(18.5, 11);
    await page.getByTestId("connector-delete").click();
    await page.getByTestId("battle-summary").getByText(/1 door, 0 windows/).waitFor({ timeout: 10000 });
    // back to the world map (the viewer test below expects it)
    await page.locator("select.project").selectOption(worldId);
    await page.getByTestId("map-canvas").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector(".mapview-empty"), null, { timeout: 15000 });
  }

  // a smaller window (a laptop, or the window dragged narrower): the top bar stays on one line with nothing spilling sideways, and the map keeps room with both panels open
  {
    const measure = () => page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, top: Math.max(...[...document.querySelectorAll(".top")].map((e) => e.scrollWidth - e.clientWidth)), canvas: document.querySelector('[data-testid="map-canvas"]').getBoundingClientRect().width, wide: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 30)} right=${Math.round(e.getBoundingClientRect().right)}`) }));
    for (const [w, h] of [[1024, 768], [900, 700]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      const o = await measure();
      if (o.page > 0 || o.top > 1) fail(`at ${w} px wide the top bar spills sideways: ${JSON.stringify(o)}`);
      if (o.canvas < 380) fail(`at ${w} px wide the map is only ${Math.round(o.canvas)} px wide`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
  }

  // the phone viewer: server render + labels, places list, place card
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone.on("pageerror", (e) => errors.push(String(e)));
  phone.on("console", blocked);
  await phone.goto(`http://localhost:${port}/view?t=${key}`);
  await phone.getByText(/^Updated/).waitFor({ timeout: 20000 });
  await phone.waitForTimeout(500);
  const viewerColours = await phone.evaluate(() => {
    const c = document.querySelector('[data-testid="viewer-canvas"]');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return seen.size;
  });
  if (viewerColours < 20) fail(`viewer looks blank (${viewerColours} colours)`);
  await phone.screenshot({ path: path.join(shots, "e2e-5-viewer.png") });
  await phone.getByRole("button", { name: "Places", exact: true }).click();
  await phone.getByTestId("viewer-places").getByText("Test Harbour").click();
  await phone.getByTestId("viewer-card").getByText("Test Harbour").waitFor({ timeout: 5000 });
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(shots, "e2e-6-viewer-place.png") });

  // The map is painted in a worker: a brush stroke comes back as painted pixels, and Undo paints the old land back (the climate catches up a few seconds later)
  {
    await page.bringToFront();
    const spot = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="map-canvas"]'), ctx = c.getContext("2d"), dpr = c.width / c.clientWidth, rc = c.getBoundingClientRect();
      for (let y = 40; y < c.clientHeight - 40; y += 10) for (let x = 40; x < c.clientWidth - 40; x += 10) {
        const d = ctx.getImageData(Math.round((x - 14) * dpr), Math.round((y - 14) * dpr), Math.round(28 * dpr), Math.round(28 * dpr)).data;
        let green = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { n++; if (d[i + 1] > d[i + 2] + 6 && d[i + 1] > d[i] + 4 && d[i + 1] > 55) green++; }
        if (green >= n * 0.9) return [rc.left + x, rc.top + y]; // (mostly green: the generated map's forest is textured, never one flat colour)
      }
      return null;
    });
    if (!spot) fail("painted map: no plain land found to test a brush stroke on");
    const probe = ([x, y]) => page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid="map-canvas"]'), ctx = c.getContext("2d"), dpr = c.width / c.clientWidth, rc = c.getBoundingClientRect();
      const d = ctx.getImageData(Math.round((x - rc.left - 5) * dpr), Math.round((y - rc.top - 5) * dpr), Math.round(10 * dpr), Math.round(10 * dpr)).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return [r / n, g / n, b / n];
    }, [x, y]);
    const apart = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const before = await probe(spot);
    await page.getByRole("button", { name: "Raise", exact: true }).click();
    await page.mouse.move(spot[0] - 30, spot[1]);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) await page.mouse.move(spot[0] - 30 + i * 2, spot[1] + Math.sin(i / 3) * 3);
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const raised = await probe(spot);
    if (apart(before, raised) < 8) fail(`painted map: a brush stroke didn't change the pixels it touched (${before.map(Math.round)} -> ${raised.map(Math.round)})`);
    await page.getByRole("button", { name: /Undo/ }).first().click();
    let back = false;
    for (let i = 0; i < 50 && !back; i++) { await page.waitForTimeout(400); back = apart(await probe(spot), before) < 14; }
    if (!back) fail(`painted map: Undo didn't paint the old land back (${before.map(Math.round)} vs ${(await probe(spot)).map(Math.round)})`);
    await page.screenshot({ path: path.join(shots, "e2e-7-paint-worker.png") });
  }

  // Rivers are painted into the map by the worker (not drawn over it): switching the Rivers layer off and on repaints, and changes the picture
  {
    await page.bringToFront();
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    const snap = () => page.evaluate(() => {
      const c = document.querySelector('[data-testid="map-canvas"]'), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, out = [];
      for (let i = 1; i < d.length; i += 28) out.push(d[i]);
      return out;
    });
    const apart = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t; };
    const box = page.getByRole("checkbox", { name: "Rivers" }).first();
    await page.waitForTimeout(1500);
    const on1 = await snap();
    await box.uncheck();
    await page.waitForTimeout(3500);
    const off = await snap();
    await box.check();
    await page.waitForTimeout(3500);
    const on2 = await snap();
    const withOff = apart(on1, off), again = apart(on1, on2);
    if (withOff < 3000) fail(`rivers: switching the Rivers layer off changed the picture by only ${withOff} (rivers should be painted into the map)`);
    if (again > withOff * 0.25) fail(`rivers: switching them back on didn't restore the picture (off ${withOff}, back-on ${again})`);
  }

  // The ground legend (painted style): open it and read the kinds of ground
  {
    await page.bringToFront();
    const legend = page.getByTestId("ground-legend");
    await legend.waitFor({ timeout: 5000 });
    await legend.locator("summary").click();
    for (const name of ["Conifer forest", "Temperate rainforest", "Glacier", "Volcanic ground", "Beach"]) await legend.getByText(name, { exact: true }).waitFor({ timeout: 5000 });
    await legend.locator("summary").click();
  }

  // Selecting: drag an area (rectangle, circle, freehand), click for a point, see the bar and the gold outline, lock and unlock, Esc clears; the server shares it with Claude
  {
    await page.bringToFront();
    const serverSel = () => page.evaluate(() => new Promise((resolve) => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?lite=1`);
      ws.onmessage = (ev) => { if (typeof ev.data !== "string") return; const m = JSON.parse(ev.data); if (m.t === "selection") { ws.close(); resolve(m); } };
      setTimeout(() => { ws.close(); resolve(null); }, 5000);
    }));
    const waitServerSel = async (test, what) => {
      let m = null;
      for (let i = 0; i < 40; i++) { m = await serverSel(); if (m && test(m)) return m; await page.waitForTimeout(150); }
      fail(`selection: the server never had ${what} (last: ${JSON.stringify(m)})`);
    };
    const goldNear = (x, y) => page.evaluate(([x, y]) => {
      const c = document.querySelector('[data-testid="map-canvas"]'), ctx = c.getContext("2d"), dpr = c.width / c.clientWidth, rc = c.getBoundingClientRect();
      const d = ctx.getImageData(Math.round((x - rc.left - 3) * dpr), Math.round((y - rc.top - 3) * dpr), Math.round(6 * dpr), Math.round(6 * dpr)).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 175 && d[i + 2] < 140) return true;
      return false;
    }, [x, y]);
    await page.getByRole("button", { name: "Select area", exact: true }).click();
    await page.getByTestId("tool-hint").getByText(/Drag out an area/).waitFor({ timeout: 5000 });
    const sb = await page.locator('[data-testid="map-canvas"]').boundingBox();
    const mx = sb.x + sb.width / 2, my = sb.y + sb.height / 2;
    // a rectangle
    await page.mouse.move(mx - 100, my - 60);
    await page.mouse.down();
    await page.mouse.move(mx + 60, my + 50, { steps: 6 });
    await page.mouse.up();
    await page.getByTestId("selection-text").getByText(/rectangle/).waitFor({ timeout: 5000 });
    if (!(await page.getByTestId("selection-lock").isChecked())) fail("selection: the lock should be on by default when an area is selected");
    await page.getByTestId("selection-bar").getByText(/locked to this area/).waitFor({ timeout: 5000 });
    let m = await waitServerSel((q) => q.selection?.kind === "area" && q.selection.shape.type === "rect" && q.lock === true, "the locked rectangle");
    if (m.selection.shape.w < 10 || m.selection.shape.h < 10) fail(`selection: the rectangle is too small: ${JSON.stringify(m.selection)}`);
    await page.waitForTimeout(200);
    if (!(await goldNear(mx - 100 + 40, my - 60))) fail("selection: no gold outline along the top edge of the selected rectangle");
    if (await goldNear(mx - 100 + 40, my - 60 - 40)) fail("selection: gold drawn well outside the rectangle");
    await page.screenshot({ path: path.join(shots, "e2e-8-selection.png") });
    // unlocking tells the server
    await page.getByTestId("selection-lock").uncheck();
    await waitServerSel((q) => q.selection?.kind === "area" && q.lock === false, "the unlocked rectangle");
    await page.getByTestId("selection-bar").getByText(/Lock Claude's edits to this area/).waitFor({ timeout: 5000 });
    await page.getByTestId("selection-lock").check();
    await waitServerSel((q) => q.lock === true, "the lock back on");
    // without the desktop app there is no terminal to type into: the bar says how to point Claude at it instead
    await page.getByTestId("selection-bar").getByText(/Claude can see this selection/).waitFor({ timeout: 5000 });
    // a circle, from its centre
    await page.getByTestId("area-circle").click();
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + 70, my + 10, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId("selection-text").getByText(/circle of radius/).waitFor({ timeout: 5000 });
    await waitServerSel((q) => q.selection?.kind === "area" && q.selection.shape.type === "circle", "the circle");
    // freehand round a triangle
    await page.getByTestId("area-free").click();
    await page.mouse.move(mx - 80, my + 70);
    await page.mouse.down();
    await page.mouse.move(mx + 40, my + 75, { steps: 8 });
    await page.mouse.move(mx - 20, my - 10, { steps: 8 });
    await page.mouse.move(mx - 78, my + 68, { steps: 8 });
    await page.mouse.up();
    await page.getByTestId("selection-text").getByText(/a polygon of \d+ points/).waitFor({ timeout: 5000 });
    await waitServerSel((q) => q.selection?.kind === "area" && q.selection.shape.type === "polygon" && q.selection.shape.points.length >= 3, "the freehand area");
    // a polygon outlined corner by corner: click the corners, Enter closes it
    await page.getByTestId("area-poly").click();
    for (const [dx, dy] of [[-60, -40], [60, -50], [80, 40], [-40, 60]]) await page.mouse.click(mx + dx, my + dy);
    await page.keyboard.press("Enter");
    await page.getByTestId("selection-text").getByText(/a polygon of 4 points/).waitFor({ timeout: 5000 });
    await waitServerSel((q) => q.selection?.kind === "area" && q.selection.shape.type === "polygon" && q.selection.shape.points.length === 4, "the four-corner polygon");
    // (and a half-drawn outline can be backed out of corner by corner: two corners, one taken back, no selection change)
    await page.mouse.click(mx - 100, my - 80);
    await page.mouse.click(mx - 60, my - 80);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.getByTestId("selection-text").getByText(/a polygon of 4 points/).waitFor({ timeout: 5000 });
    // a click without dragging picks a point (no area, so nothing to lock)
    await page.getByTestId("area-rect").click();
    await page.mouse.click(mx + 90, my - 70);
    await page.getByTestId("selection-text").getByText(/the point \(/).waitFor({ timeout: 5000 });
    if (await page.getByTestId("selection-lock").count()) fail("selection: a point has no area to lock to, but the lock box is showing");
    await waitServerSel((q) => q.selection?.kind === "point" && q.lock === false, "the point");
    // the Select tool: a place, then bare ground; Esc clears
    await page.getByRole("button", { name: "Select", exact: true }).click();
    // (earlier steps put places, labels and a climate region on the map: try a few spots until one is bare ground)
    let picked = false;
    for (const [dx, dy] of [[150, -100], [200, 100], [-200, -100], [100, 120], [-150, 100], [220, -40]]) {
      await page.mouse.click(mx + dx, my + dy);
      await page.waitForTimeout(250);
      if (/the point \(/.test((await page.getByTestId("selection-text").textContent().catch(() => "")) ?? "")) { picked = true; break; }
    }
    if (!picked) fail("selection: clicking bare ground with the Select tool never picked a point");
    await waitServerSel((q) => q.selection?.kind === "point", "the point picked with the Select tool");
    await page.keyboard.press("Escape");
    await page.getByTestId("selection-bar").waitFor({ state: "detached", timeout: 5000 });
    await waitServerSel((q) => q.selection === null, "nothing selected after Esc");
  }

  // a city map: made from the New map dialog, buildings and streets drawn with the mouse, selected, turned, moved, undone and deleted
  {
    await page.getByRole("button", { name: "+ New map" }).click();
    await page.getByTestId("new-kind-city").click();
    await page.getByTestId("new-name").fill("E2E City");
    await page.getByTestId("new-create").click();
    await page.getByTestId("city-canvas").waitFor({ timeout: 20000 });
    await page.getByTestId("city-status").getByText(/600 × 400 m · 0 buildings · 0 streets/).waitFor({ timeout: 10000 });
    const cb = await page.getByTestId("city-canvas").boundingBox();
    const fitS = Math.min(cb.width / 600, cb.height / 400) * 0.95;
    const cx = (m) => cb.x + (cb.width - 600 * fitS) / 2 + m * fitS, cy = (m) => cb.y + (cb.height - 400 * fitS) / 2 + m * fitS;
    const status = (re) => page.getByTestId("city-status").getByText(re).waitFor({ timeout: 10000 });
    // a click with the Building tool places a house; a drag sizes one
    await page.getByTestId("ctool-building").click();
    await page.mouse.click(cx(100), cy(100));
    await status(/1 buildings/);
    await page.mouse.move(cx(200), cy(100));
    await page.mouse.down();
    await page.mouse.move(cx(240), cy(130), { steps: 5 });
    await page.mouse.up();
    await status(/2 buildings/);
    // a street, finished by a double-click
    await page.keyboard.press("s");
    await page.mouse.click(cx(50), cy(200));
    await page.mouse.click(cx(250), cy(220));
    await page.mouse.dblclick(cx(450), cy(200));
    await status(/1 streets/);
    // select the first house, turn it, move it, delete it; each is one undo step
    await page.keyboard.press("v");
    await page.mouse.click(cx(100), cy(100));
    await page.getByTestId("city-inspector").getByText("Building").first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.keyboard.press("e");
    await page.getByTestId("history").getByText("Turn building").first().waitFor({ timeout: 5000 });
    await page.mouse.move(cx(100), cy(100));
    await page.mouse.down();
    await page.mouse.move(cx(120), cy(160), { steps: 5 });
    await page.mouse.up();
    await page.getByTestId("history").getByText(/^Move$/).first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Delete");
    await status(/1 buildings/);
    await page.keyboard.press("Control+z");
    await status(/2 buildings/);
    // the ground: pick water and paint a stroke
    await page.keyboard.press("p");
    await page.getByTestId("city-ground-menu").click();
    await page.getByTestId("city-material-deep-water").click();
    await page.mouse.move(cx(500), cy(50));
    await page.mouse.down();
    await page.mouse.move(cx(520), cy(350), { steps: 6 });
    await page.mouse.up();
    await page.getByTestId("history").getByText("Paint deep water").first().waitFor({ timeout: 5000 });
    // a street across that water becomes a bridge: wooden, as chosen in the tool bar, and the street's inspector says so
    await page.keyboard.press("s");
    await page.getByTestId("city-street-bridge").selectOption("wood");
    await page.mouse.click(cx(460), cy(300));
    await page.mouse.dblclick(cx(575), cy(300));
    await status(/2 streets/);
    await page.getByTestId("city-street-edit-bridge").evaluate((s) => s.value === "wood" || Promise.reject(new Error(`bridge setting: ${s.value}`)));
    await page.getByTestId("city-street-edit-bridge").selectOption("stone");
    await page.getByTestId("history").getByText("Bridge: stone").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-street-bridge").selectOption("auto");
    // the land: a hill by a click with the Land tool, a valley by points; the status reads the height; the hill is selected by its top and made higher in the inspector
    await page.keyboard.press("l");
    await page.getByTestId("tool-hint").getByText(/drag out from its top/).waitFor({ timeout: 5000 });
    await page.mouse.click(cx(380), cy(120));
    await page.getByTestId("history").getByText("Add hill").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-land-valley").click();
    await page.mouse.click(cx(20), cy(330));
    await page.mouse.click(cx(200), cy(300));
    await page.mouse.dblclick(cx(420), cy(340));
    await page.getByTestId("history").getByText("Add valley").first().waitFor({ timeout: 5000 });
    await page.mouse.move(cx(370), cy(130));
    await page.getByTestId("city-status").getByText(/m above the sea/).waitFor({ timeout: 5000 });
    await page.mouse.click(cx(380), cy(120));
    await page.getByTestId("city-inspector").getByText("Hill").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-land-edit-height").fill("30");
    await page.getByTestId("city-land-edit-height").press("Tab");
    await page.getByTestId("history").getByText("Hill: 30 m").first().waitFor({ timeout: 5000 });
    // trees: a wood (an outline finished by a double-click) and one tree; then a cold climate
    await page.getByTestId("ctool-trees").click(); // (the rail: the keyboard is still in the height box)
    await page.mouse.click(cx(60), cy(40));
    await page.mouse.click(cx(170), cy(40));
    await page.mouse.click(cx(170), cy(130));
    await page.mouse.dblclick(cx(60), cy(130));
    await page.getByTestId("history").getByText("Add a wood").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-trees-tree").click();
    await page.mouse.click(cx(300), cy(60));
    await page.getByTestId("history").getByText("Add a tree").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-climate").selectOption("cold");
    await page.getByTestId("history").getByText("Climate: Cold").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-land").getByText(/firs and pines/i).waitFor({ timeout: 5000 });
    await page.getByTestId("city-summary").getByText("2 groups").waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, "e2e-5b-city-land.png") });
    // the climate is one undo step
    await page.getByRole("button", { name: /Undo/ }).click(); // (the keyboard is in the climate list, where Ctrl+Z is the list's own)
    await page.getByTestId("history").getByText("Undo: Climate: Cold").first().waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="city-climate"]')?.value === "temperate", null, { timeout: 5000 });
    // the trace picture works on a city map too (a new map has no pictures of its own: add one first)
    await page.getByTestId("references").getByTestId("ref-file").setInputFiles(path.join(tmp, "e2e-sketch.png"));
    await page.getByTestId("references").getByTestId("ref-card").first().waitFor({ timeout: 15000 });
    await page.getByTestId("references").getByTestId("ref-card").first().getByTestId("ref-trace").click();
    await page.getByTestId("trace-bar").waitFor({ timeout: 10000 });
    await page.getByTestId("trace-stop").click();
    await page.getByTestId("trace-bar").waitFor({ state: "detached", timeout: 10000 });
    // the picture reader: a town picture laid over the whole city (2 m a pixel), one red roof and one grey one clicked, the grass and the street clicked as ground,
    // Find shows what it found, Accept adds it as one edit (the house the town's row runs into is left out: it is already there)
    await page.getByTestId("references").getByTestId("ref-file").setInputFiles(path.join(tmp, "e2e-town.png"));
    const townCard = page.getByTestId("references").getByTestId("ref-card").filter({ hasText: "e2e-town.png" });
    await townCard.waitFor({ timeout: 15000 });
    await townCard.getByTestId("ref-trace").click();
    await page.getByTestId("trace-bar").getByText("e2e-town.png").waitFor({ timeout: 10000 });
    await page.getByTestId("reader-start").click();
    await page.getByTestId("reader-whole").click();
    await page.waitForTimeout(500); // (the trace picture loads in the page before its colours can be read)
    await page.mouse.click(cx(2 * 24), cy(2 * 65));
    await page.mouse.click(cx(2 * 84), cy(2 * 125));
    await page.getByTestId("reader-roof").nth(1).waitFor({ timeout: 5000 });
    const looks = await page.getByTestId("reader-roof").locator("select").evaluateAll((ss) => ss.map((x) => x.value));
    if (looks.join() !== "tile,slate") fail(`the reader guessed the roofs as ${looks.join()} (red tile and grey slate expected)`);
    await page.getByTestId("reader-ground").click();
    await page.mouse.click(cx(2 * 10), cy(2 * 30));
    await page.mouse.click(cx(2 * 150), cy(2 * 100));
    await page.getByTestId("reader-ground").getByText("3 Ground (2)").waitFor({ timeout: 5000 });
    await page.getByTestId("reader-find").click();
    await page.getByTestId("reader-help").getByText(/^Found \d+ buildings/).waitFor({ timeout: 20000 });
    const found = Number((await page.getByTestId("reader-accept").textContent()).replace(/\D/g, ""));
    if (!(found >= 15 && found <= 18)) fail(`the reader found ${found} buildings in the town picture (about 17 expected)`);
    await page.screenshot({ path: path.join(shots, "e2e-5c-city-reader.png") });
    await page.getByTestId("reader-accept").click();
    await page.getByTestId("history").getByText(`Read ${found} buildings from the picture`).first().waitFor({ timeout: 10000 });
    await status(new RegExp(`${2 + found} buildings`));
    // the same reader for streets: the picture's sandy street, in a box on the right (away from the wall drawn below), read by a click on it and on the grass and the river beside it
    await page.getByTestId("reader-what-streets").click();
    await page.getByTestId("reader-roofs").getByText("2 Streets (0)").waitFor({ timeout: 5000 });
    await page.getByTestId("reader-area").click();
    await page.mouse.move(cx(460), cy(150));
    await page.mouse.down();
    await page.mouse.move(cx(598), cy(250), { steps: 5 });
    await page.mouse.up();
    await page.mouse.click(cx(560), cy(200));
    await page.getByTestId("reader-ground").click();
    await page.mouse.click(cx(480), cy(170));
    await page.mouse.click(cx(510), cy(240));
    await page.getByTestId("reader-find").click();
    await page.getByTestId("reader-help").getByText(/^(Found \d+ streets?|No streets found)/).waitFor({ timeout: 20000 });
    if (await page.getByTestId("reader-accept").isEnabled()) {
      await page.getByTestId("reader-accept").click();
      await page.getByTestId("history").getByText(/Read \d+ streets? from the picture/).first().waitFor({ timeout: 10000 });
    }
    await page.getByTestId("reader-done").click();
    await page.getByTestId("reader-samples").waitFor({ state: "detached", timeout: 5000 });
    await page.getByTestId("trace-stop").click();
    await page.getByTestId("trace-bar").waitFor({ state: "detached", timeout: 10000 });
    // a city wall: a ring clicked out with the Wall tool and closed on its first point; the street crossing it twice makes two gates (gatehouses); an earth rampart instead has no towers
    await page.getByTestId("ctool-citywall").click();
    for (const [x, y] of [[100, 100], [250, 90], [260, 270], [95, 265], [100, 100]]) await page.mouse.click(cx(x), cy(y));
    await page.getByTestId("history").getByText("Add stone wall").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-wall-info").getByText(/· 2 gates/).waitFor({ timeout: 5000 });
    await page.getByTestId("city-wall-edit-kind").selectOption("earth");
    await page.getByTestId("history").getByText("Wall: Earth rampart").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-wall-info").getByText(/0 towers · 2 gates/).waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(shots, "e2e-5d-city-wall.png") });
    await page.getByRole("button", { name: /Undo/ }).click();
    await page.getByTestId("city-summary").getByText(/1 · 2 gates · \d+ towers/).waitFor({ timeout: 5000 });
    // names: the Name tool names the street it clicks, and writes a district's name on open ground; that label's panel makes it name water instead, and Delete removes it
    await page.getByTestId("ctool-citylabel").click();
    await page.mouse.click(cx(150), cy(210));
    await answer("Harbour Road");
    await page.getByTestId("history").getByText("Name street Harbour Road").first().waitFor({ timeout: 5000 });
    await page.mouse.click(cx(420), cy(330));
    await answer("Old Town");
    await page.getByTestId("history").getByText("Name Old Town").first().waitFor({ timeout: 5000 });
    await page.getByTestId("city-label-edit-kind").selectOption("water");
    await page.getByTestId("history").getByText("Name kind: water").first().waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(shots, "e2e-5e-city-names.png") });
    await page.getByTestId("city-delete").click();
    await page.getByTestId("history").getByText("Delete name Old Town").first().waitFor({ timeout: 5000 });
    // the city as a picture: 1 px per metre is 600 x 400 px
    await page.getByTestId("export-button").click();
    await page.getByTestId("export-dialog").getByText(/4,800 × 3,200 px/).waitFor({ timeout: 5000 });
    await page.getByTestId("export-size-1").check();
    const [cityPng] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("export-go").click()]);
    if (!/E2E City \(1 px per m\)\.png$/.test(cityPng.suggestedFilename())) fail(`unexpected city export name ${cityPng.suggestedFilename()}`);
    {
      const { readFileSync } = await import("node:fs");
      const png = readFileSync(await cityPng.path());
      if (png.subarray(1, 4).toString() !== "PNG" || png.readUInt32BE(16) !== 600 || png.readUInt32BE(20) !== 400) fail("the exported city PNG isn't 600 x 400");
    }
    await page.getByTestId("export-dialog").waitFor({ state: "detached", timeout: 10000 });
    // the bottom bar: the map is saved a moment after an edit; zoom in changes the zoom shown; the Names switch hides the names
    await page.getByTestId("save-state").getByText(/^Saved/).waitFor({ timeout: 15000 });
    const zoomWas = await page.getByTestId("zoom-level").innerText();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForFunction((z) => document.querySelector('[data-testid="zoom-level"]')?.textContent !== z, zoomWas, { timeout: 5000 });
    await page.getByRole("button", { name: /Fit/ }).click();
    await page.getByTestId("bar-names").click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="city-names"]')?.checked, null, { timeout: 5000 });
    await page.getByTestId("bar-names").click();
    // the Objects tab lists what is on the city by kind; the filter finds a street by its name, and a click selects it
    await page.getByTestId("mp-tab-objects").click();
    await page.getByTestId("objects-list").getByText("Buildings").first().waitFor({ timeout: 5000 });
    await page.getByTestId("objects-filter").fill("harbour");
    await page.getByTestId("objects-list").getByText("Harbour Road").click();
    await page.getByTestId("city-inspector").getByRole("heading", { name: "Street" }).waitFor({ timeout: 5000 });
    await page.getByTestId("objects-filter").fill("");
    await page.screenshot({ path: path.join(shots, "e2e-5h-city-objects.png") });
    await page.getByTestId("mp-tab-map").click();
    await page.keyboard.press("Escape");
    // the tool rail as pictures only, and back; the choice is remembered
    await page.getByTestId("rail-names").click();
    await page.locator(".main.rail-icons").waitFor({ timeout: 5000 });
    if ((await page.evaluate(() => localStorage.getItem("dd-rail-names"))) !== "0") fail("the pictures-only rail isn't remembered");
    await page.getByTestId("rail-names").click();
    await page.locator(".main.rail-icons").waitFor({ state: "detached", timeout: 5000 });
    await page.getByRole("button", { name: /Fit/ }).click(); // (the Objects list moved the view onto the street: the clicks below expect the whole city)
    await page.waitForTimeout(300);
    // the phone page shows the city (its picture drawn on the server's compute thread) with a Names switch instead of Places, and picks up an edit
    await phone.goto(`http://localhost:${port}/view`);
    await phone.getByText(/^Updated/).waitFor({ timeout: 20000 });
    await phone.getByRole("button", { name: "Names", exact: true }).waitFor({ timeout: 5000 });
    if (await phone.getByRole("button", { name: "Places", exact: true }).count()) fail("the phone page offers Places on a city map");
    const phoneLook = () => phone.evaluate(() => { const c = document.querySelector('[data-testid="viewer-canvas"]'); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 101) h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) >>> 0; return h; });
    const shownBefore = await phoneLook();
    await page.getByTestId("ctool-building").click();
    await page.mouse.click(cx(540), cy(40));
    await status(/20 buildings/);
    await phone.waitForFunction(async (h) => { const c = document.querySelector('[data-testid="viewer-canvas"]'); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let x = 0; for (let i = 0; i < d.length; i += 4 * 101) x = (x * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) >>> 0; return x !== h; }, shownBefore, { timeout: 20000 });
    await phone.screenshot({ path: path.join(shots, "e2e-5f-city-phone.png") });
    await page.bringToFront();
    await page.screenshot({ path: path.join(shots, "e2e-5-city.png") });
    // a battlemap of part of the city: a box dragged with Battlemap here and named opens as a battlemap made from the city, which leads back to it
    await page.getByTestId("ctool-citybattle").click();
    await page.mouse.move(cx(80), cy(170));
    await page.mouse.down();
    await page.mouse.move(cx(180), cy(250), { steps: 6 });
    await page.mouse.up();
    await page.getByTestId("dialog").getByText(/6\d × 5\d squares/).waitFor({ timeout: 5000 });
    await answer("E2E Street Fight");
    await page.getByTestId("battle-canvas").waitFor({ timeout: 20000 });
    await page.getByTestId("battle-origin").getByText(/E2E City/).waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, "e2e-5g-city-battle.png") });
    await page.getByRole("button", { name: /Back to E2E City/ }).click();
    await page.getByTestId("city-canvas").waitFor({ timeout: 20000 });
    // a city map is its own kind of project, listed as such, and the other kinds' tools are not on screen
    if (!(await page.locator("select.project").evaluate((s) => s.selectedOptions[0].textContent)).includes("(city)")) fail("a city map is not listed as a city");
    if (await page.getByRole("button", { name: "Raise", exact: true }).count()) fail("the world map's terrain tools are showing on a city map");
    // delete it: Cancel keeps it; Delete moves it aside, another map opens, and a note says where it went
    await page.getByTestId("delete-map-open").click();
    await page.getByTestId("delete-map-dialog").getByText(/Deleted maps/).waitFor({ timeout: 5000 });
    await page.getByTestId("delete-map-cancel").click();
    if ((await page.getByTestId("delete-map-dialog").count()) !== 0) fail("Cancel left the delete dialog open");
    await page.getByTestId("delete-map-open").click();
    await page.getByTestId("delete-map-confirm").click();
    await page.getByTestId("picture-note").getByText(/"E2E City" was deleted/).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => ![...document.querySelectorAll("select.project option")].some((o) => o.textContent.includes("E2E City")), null, { timeout: 10000 });
    await page.getByTestId("map-canvas").or(page.getByTestId("battle-canvas")).first().waitFor({ timeout: 20000 });
  }

  // the world map's labels and place markers can be hidden (and the choice is remembered); the map is drawn without them
  {
    await page.locator("select.project").selectOption(await page.locator("select.project option").filter({ hasText: /^First Map$/ }).first().getAttribute("value")) // (the generated first map);
    await page.getByTestId("map-canvas").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector(".mapview-empty"), null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const shot = () => page.getByTestId("map-canvas").screenshot();
    const withLabels = await shot();
    await page.getByTestId("show-labels").uncheck();
    await page.getByTestId("show-markers").uncheck();
    await page.waitForTimeout(400);
    const bare = await shot();
    if (Buffer.compare(withLabels, bare) === 0) fail("hiding the labels and markers changed nothing on the map");
    if ((await page.evaluate(() => [localStorage.getItem("dd.showLabels"), localStorage.getItem("dd.showMarkers")].join())) !== "0,0") fail("the label and marker switches are not remembered");
    await page.getByTestId("show-labels").check();
    await page.getByTestId("show-markers").check();
    // City here: a click on the world map asks for a city map's name and size (Cancel makes nothing; the making itself is tested on the server, where a spot on land is known)
    await page.getByRole("button", { name: "City here" }).click();
    await page.getByTestId("tool-hint").getByText(/town's marker or any spot on land/).waitFor({ timeout: 5000 });
    const wb = await page.getByTestId("map-canvas").boundingBox();
    await page.mouse.click(wb.x + wb.width / 2, wb.y + wb.height / 2);
    await page.getByTestId("city-here-dialog").waitFor({ timeout: 5000 });
    if ((await page.getByTestId("city-here-w").inputValue()) === "") fail("the City here box has no width");
    await page.getByTestId("city-here-dialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByTestId("city-here-dialog").waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.press("h");
  }

  // the River tool: it opens on Add a river; a click starts a great river on land, name it by clicking it, see it in the inspector and the Rivers and lakes list;
  // lowland rivers, the carve dialog (Where: along the selected river), and a river drawn with a drag
  {
    await page.keyboard.press("0");
    const cb = await page.getByTestId("map-canvas").boundingBox();
    // find land a little way inland: the bottom bar says the height under the pointer ("120 m", or "40 m deep" at sea)
    let land = null;
    for (let gy = 0.3; gy <= 0.7 && !land; gy += 0.1) for (let gx = 0.3; gx <= 0.7 && !land; gx += 0.05) {
      await page.mouse.move(cb.x + cb.width * gx, cb.y + cb.height * gy);
      const t = await page.getByTestId("status-bar").first().innerText();
      const m = /y \d+ · (\d+) m(?! deep)/.exec(t);
      if (m && Number(m[1]) >= 60) land = { x: cb.x + cb.width * gx, y: cb.y + cb.height * gy };
    }
    if (!land) fail("no land found on the first map for the River tool");
    await page.keyboard.press("i");
    await page.getByTestId("river-modes").waitFor({ timeout: 5000 });
    await page.getByTestId("tool-hint").getByText(/Drag from where a river starts/).waitFor({ timeout: 5000 });
    if (!(await page.getByTestId("river-mode-add").getAttribute("class"))?.includes("on")) fail("the Rivers tool doesn't open on Add a river");
    await page.getByTestId("river-size").selectOption("great");
    await page.mouse.click(land.x, land.y);
    await page.getByTestId("inspector").getByRole("heading", { name: "River source" }).waitFor({ timeout: 5000 });
    if ((await page.getByTestId("source-size").inputValue()) !== "great") fail("the new river source isn't a great river");
    // name the river it feeds: click round the source until the River tool finds the river (the rivers are worked out again first)
    await page.getByTestId("river-mode-name").click();
    let box = false;
    for (let tries = 0; tries < 30 && !box; tries++) {
      await page.waitForTimeout(500);
      for (const r of [14, 22, 32]) {
        for (let a = 0; a < 16 && !box; a++) {
          await page.mouse.click(land.x + Math.cos((a / 16) * Math.PI * 2) * r, land.y + Math.sin((a / 16) * Math.PI * 2) * r);
          box = (await page.getByTestId("water-name-box").count()) > 0;
        }
        if (box) break;
      }
    }
    if (!box) fail("clicking near the new river never found it with the River tool");
    await page.getByTestId("water-facts").getByText(/km .* long/).waitFor({ timeout: 5000 });
    await page.getByTestId("water-name-input").fill("E2E River");
    await page.getByTestId("water-name-save").click();
    await page.getByTestId("inspector").getByRole("heading", { name: "River" }).waitFor({ timeout: 10000 });
    if ((await page.getByTestId("water-rename").inputValue()) !== "E2E River") fail("the inspector doesn't show the river's name");
    await page.getByTestId("water-names").getByText("E2E River").waitFor({ timeout: 10000 });
    await page.getByTestId("water-inspector-facts").getByText(/long/).waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(shots, "river-named.png") });
    // lowland rivers switch on and off (each an undoable change of the map's climate)
    await page.getByTestId("lowland-rivers").click(); // (the box follows the server's reply)
    await page.waitForFunction(() => document.querySelector('[data-testid="lowland-rivers"]')?.checked === true, null, { timeout: 10000 });
    await page.getByTestId("lowland-rivers").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="lowland-rivers"]')?.checked === false, null, { timeout: 10000 });
    // the carve dialog opens with Where: along the selected river, and cancels (carving itself is tested on the server)
    await page.getByTestId("carve-valleys").click();
    await page.getByTestId("carve-dialog").waitFor({ timeout: 5000 });
    await page.getByTestId("carve-where").getByText("Only along E2E River").waitFor({ timeout: 5000 });
    if (!(await page.getByTestId("carve-where-selection").isChecked())) fail("the carve dialog doesn't offer the selected river first");
    await page.getByTestId("carve-dialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByTestId("carve-dialog").waitFor({ state: "detached", timeout: 5000 });
    // remove the name (the river stays) and the source
    await page.getByTestId("water-remove").click();
    await page.getByTestId("water-names").getByText("E2E River").waitFor({ state: "detached", timeout: 10000 });
    await page.getByTestId("river-mode-add").click();
    await page.mouse.click(land.x, land.y);
    await page.getByTestId("inspector").getByRole("heading", { name: "River source" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Delete");
    await page.getByTestId("inspector").waitFor({ state: "detached", timeout: 5000 });
    // (the server confirms the source is gone before the next press: a press on its dot would select it instead of drawing)
    await page.getByTestId("history").getByText("Remove a river source").first().waitFor({ timeout: 10000 });
    // a drag draws a river: the land is cut along the line and a note says how long it is; it is one step in the History, and Undo takes it back
    const from = { x: land.x + 14, y: land.y - 10 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let k = 1; k <= 12; k++) await page.mouse.move(from.x + k * 9, from.y + k * 6);
    await page.mouse.up();
    await page.getByTestId("picture-note").getByText(/River drawn/).waitFor({ timeout: 10000 });
    await page.getByTestId("history").getByText("Draw a great river").first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(shots, "river-drawn.png") });
    await page.getByRole("button", { name: /Undo/ }).click();
    await page.getByTestId("history").getByText("Undo: Draw a great river").waitFor({ timeout: 10000 });
    await page.keyboard.press("h");
  }

  // other maps: copy the open map (the copy opens and says what it is a copy of), compare it with its original (Fade, Swipe, Side by side, Stop), and go back
  {
    const originalName = await page.locator("select.project option:checked").innerText();
    await page.getByTestId("duplicate-map").click();
    await page.getByTestId("dialog-input").fill("E2E Copy");
    await page.getByTestId("dialog-ok").click();
    await page.getByTestId("copied-from").getByText(originalName.trim()).waitFor({ timeout: 20000 });
    await page.getByTestId("picture-note").getByText(/is a copy of/).waitFor({ timeout: 10000 });
    if ((await page.locator("select.project option:checked").innerText()).trim() !== "E2E Copy") fail("the copy isn't the open map");
    await page.getByTestId("compare-original").click();
    await page.getByTestId("compare-bar").getByText(/a copy of/).waitFor({ timeout: 30000 });
    await page.getByTestId("compare-swipe").click();
    await page.getByTestId("compare-amount").fill("30");
    await page.screenshot({ path: path.join(shots, "compare-swipe.png") });
    await page.getByTestId("compare-side").click();
    await page.waitForFunction(() => { const i = document.querySelector('[data-testid="compare-side-other"]'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 });
    await page.getByTestId("compare-side-window").getByRole("button", { name: "Close" }).click();
    await page.getByTestId("compare-stop").click();
    await page.getByTestId("compare-bar").waitFor({ state: "detached", timeout: 5000 });
    await page.locator("select.project").selectOption(await page.locator("select.project option").filter({ hasText: new RegExp(`^${originalName.trim()}$`) }).first().getAttribute("value"));
    await page.getByTestId("copied-from").waitFor({ state: "detached", timeout: 20000 });
  }

  // the AI asks before a risky action: removing a named place through the map tools waits for the DM's answer in the editor (Don't allow, then Allow)
  {
    const post = (body) => fetch(`http://localhost:${port}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    }).then((r) => r.json());
    const mcp = async (name, args) => {
      await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
      return (await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } })).result;
    };
    const made = await mcp("add_place", { name: "E2E Askton", type: "village", x: 40, y: 40 });
    if (made.isError) fail(`add_place: ${JSON.stringify(made.content)}`);
    const refused = mcp("remove_place", { place: "E2E Askton" });
    await page.getByTestId("ask-box").getByText(/Remove the place "E2E Askton"/).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(shots, "ask-box.png") });
    await page.getByTestId("ask-refuse").click();
    if (!(await refused).isError) fail("the place was removed although the DM said no");
    await page.getByTestId("ask-box").waitFor({ state: "detached", timeout: 5000 });
    const allowed = mcp("remove_place", { place: "E2E Askton" });
    await page.getByTestId("ask-allow").click({ timeout: 10000 });
    const done = await allowed;
    if (done.isError) fail(`with the DM's OK the place wasn't removed: ${JSON.stringify(done.content)}`);
    await page.getByTestId("ask-box").waitFor({ state: "detached", timeout: 5000 });
  }

  if (errors.length) fail(`page errors: ${errors.join("; ")}`);
  console.log(`E2E OK (screenshots in ${shots})`);
  await browser.close();
  if (shots === tmp) cleanup(0);
  server.kill();
  process.exit(0);
} catch (e) {
  await failShot();
  await browser.close();
  fail(e.stack ?? String(e));
}
