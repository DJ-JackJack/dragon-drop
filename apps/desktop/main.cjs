"use strict";
/**
 * Dragon Drop desktop shell.
 *
 * Starts the map server (the same code as `pnpm start`, bundled into one file) as a child process using
 * Electron's own copy of Node, waits for it, then shows the editor in a window. Settings (API key, where
 * the maps live) are kept in the user's app-data folder, not in a .env file.
 *
 * Run `node scripts/prepare.mjs` first; then `npx electron .` for a development run, or
 * `npm run dist` to build the Windows installer.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "Dragon Drop";
const DEFAULT_PORT = 4747;
const SMOKE = process.argv.includes("--smoke-test");

app.setName(APP_NAME);
if (process.platform === "win32") app.setAppUserModelId("com.dragondrop.app");
if (process.env.DRAGON_DROP_DATA) app.setPath("userData", path.resolve(process.env.DRAGON_DROP_DATA));
let smokeDir = null;
if (SMOKE) {
  smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dragon-drop-smoke-"));
  app.setPath("userData", path.join(smokeDir, "userData"));
}

const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, "build");
// Which build is this? A copy made for itch.io carries resources/channel.json ({"channel":"itch"}): the itch app does the updating there, so the in-app updater stays off.
const CHANNEL = (() => { try { return JSON.parse(fs.readFileSync(path.join(resources, "channel.json"), "utf8")).channel === "itch" ? "itch" : "github"; } catch { return "github"; } })();
const serverMain = path.join(resources, "server", "main.mjs");
const editorDir = path.join(resources, "editor");
const iconPath = path.join(__dirname, "assets", process.platform === "win32" ? "icon.ico" : "icon.png");

let settingsFile = null;
let settings = {};
let child = null;
let childLog = [];
let port = DEFAULT_PORT;
let win = null;
let quitting = false;
let restarting = false;

// ---------------------------------------------------------------- settings
function loadSettings() {
  settingsFile = path.join(app.getPath("userData"), "settings.json");
  try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch { settings = {}; }
  // The access key: every request to this app's own server (the editor window, Claude Code's map tools, its hooks) carries it, so another program,
  // another Windows user or a web page can't drive the app. Made once per install and kept in the settings file (readable only by this user).
  if (typeof settings.accessToken !== "string" || settings.accessToken.length < 32) {
    settings.accessToken = crypto.randomBytes(32).toString("hex");
    try { saveSettings(); } catch { /* saved with the next change; the key is only needed while the app runs */ }
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const tmp = `${settingsFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, settingsFile);
}

function getApiKey() {
  try {
    if (settings.apiKeyEnc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(settings.apiKeyEnc, "base64"));
  } catch { /* unreadable (e.g. moved between computers): treat as not set */ }
  return settings.apiKey || "";
}

function setApiKey(key) {
  delete settings.apiKey;
  delete settings.apiKeyEnc;
  const k = (key || "").trim();
  if (k) {
    if (safeStorage.isEncryptionAvailable()) settings.apiKeyEnc = safeStorage.encryptString(k).toString("base64");
    else settings.apiKey = k; // no OS keystore (rare): the file is private to this user
  }
  saveSettings();
}

// ---------------------------------------------------------------- maps folder
const hasProjects = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).some((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "project.json"))); } catch { return false; }
};

/** A projects folder from the developer setup (the git checkout), if one is where people usually put it. */
function findExistingProjects() {
  const home = os.homedir();
  const docs = app.getPath("documents");
  const bases = [home, docs, path.join(docs, "GitHub"), path.join(home, "source", "repos"), path.join(home, "Desktop"), path.join(home, "Downloads"), path.join(home, "repos"), path.join(home, "code")];
  for (const b of bases) {
    for (const name of ["AI-Mapmaker-Build", "AI-Mapmaker-Build-main", "ai-mapmaker-build", "dragon-drop", "Dragon-Drop", "dragon-drop-main"]) {
      const p = path.join(b, name, "projects");
      if (hasProjects(p)) return p;
    }
  }
  return null;
}

async function chooseProjectsFolder(parent) {
  const r = await dialog.showOpenDialog(parent ?? undefined, {
    title: "Choose the folder that holds your maps (the one that contains a folder per map)",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

async function firstRun() {
  const defaultDir = path.join(app.getPath("documents"), "Dragon Drop", "projects");
  const found = findExistingProjects();
  const buttons = found
    ? ["Use my existing maps", "Start fresh", "Choose another folder…"]
    : ["Start fresh", "I already have maps: choose the folder…"];
  const r = await dialog.showMessageBox({
    type: "question", title: `Welcome to ${APP_NAME}`, message: "Where are your maps?",
    detail: found
      ? `I found maps from the earlier version of this program at:\n${found}\n\nUsing them keeps everything you've made, exactly as it is.`
      : `"Start fresh" keeps your maps in:\n${defaultDir}\n\nand begins with a small new map to try things on. If you used the earlier version of this program, choose its "projects" folder instead (it's inside the AI-Mapmaker-Build folder) and nothing is lost.`,
    buttons, defaultId: 0, cancelId: found ? 1 : 0, noLink: true,
  });
  const pick = buttons[r.response];
  let dir = null;
  if (pick === "Use my existing maps") dir = found;
  else if (pick === "Start fresh") dir = defaultDir;
  else dir = await chooseProjectsFolder(null);
  if (!dir) dir = defaultDir;
  fs.mkdirSync(dir, { recursive: true }); // (a folder with no maps starts with a new first map)
  settings.projectsDir = dir;
  saveSettings();
}

// ---------------------------------------------------------------- the map server
/** The preferred port if it's free, else the next free one above it (4748, 4749, ...), so the address stays predictable. */
function freePort(preferred) {
  return new Promise((resolve) => {
    const candidates = [preferred, ...Array.from({ length: 30 }, (_, i) => preferred + 1 + i), 0];
    const tryNext = () => {
      if (!candidates.length) return resolve(DEFAULT_PORT);
      const p = candidates.shift();
      const s = net.createServer();
      s.once("error", tryNext);
      s.listen(p, "127.0.0.1", () => { const got = s.address().port; s.close(() => resolve(got)); });
    };
    tryNext();
  });
}

function healthy(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: p, path: "/api/health", timeout: 4000, headers: { authorization: `Bearer ${settings.accessToken}` } }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function logFile() {
  return path.join(app.getPath("userData"), "logs", "server.log");
}

async function startServer() {
  port = await freePort(settings.port || DEFAULT_PORT);
  fs.mkdirSync(path.dirname(logFile()), { recursive: true });
  try { if (fs.statSync(logFile()).size > 2_000_000) fs.rmSync(logFile()); } catch { /* no log yet */ }
  const out = fs.createWriteStream(logFile(), { flags: "a" });
  out.write(`\n--- ${new Date().toISOString()} starting on port ${port}, maps in ${settings.projectsDir} ---\n`);
  const env = {
    ...process.env, ELECTRON_RUN_AS_NODE: "1", MAPMAKER_NO_DOTENV: "1", MAPMAKER_HOST: "127.0.0.1",
    MAPMAKER_PORT: String(port), MAPMAKER_PROJECTS_DIR: settings.projectsDir, MAPMAKER_EDITOR_DIST: editorDir, MAPMAKER_ACCESS_TOKEN: settings.accessToken,
  };
  const key = getApiKey();
  if (key) env.ANTHROPIC_API_KEY = key;
  env.MAPMAKER_CACHE_DIR = path.join(app.getPath("userData"), "cache");
  if (settings.assetsDir) env.MAPMAKER_ASSETS_DIR = settings.assetsDir;
  childLog = [];
  const proc = spawn(process.execPath, [serverMain], { env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  child = proc;
  const sink = (d) => {
    out.write(d);
    childLog.push(...d.toString().split(/\r?\n/).filter(Boolean));
    if (childLog.length > 60) childLog = childLog.slice(-60);
  };
  proc.stdout.on("data", sink);
  proc.stderr.on("data", sink);
  proc.on("exit", (code) => {
    out.end(`--- server exited (${code}) ---\n`);
    if (child === proc) child = null;
  });
  const exited = new Promise((resolve) => proc.once("exit", () => resolve(false)));
  const up = (async () => {
    for (let i = 0; i < 120; i++) {
      if (await healthy(port)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })();
  return Promise.race([up, exited]);
}

async function stopServer() {
  const proc = child;
  if (!proc) return;
  const done = new Promise((resolve) => proc.once("exit", resolve));
  try { proc.send("shutdown"); } catch { proc.kill(); }
  const timer = setTimeout(() => proc.kill(), 8000); // it saves first; this only matters if it hangs
  await done;
  clearTimeout(timer);
}

async function restartServer() {
  if (restarting) return false;
  restarting = true;
  try {
    await stopServer();
    const ok = await startServer();
    if (ok && win) win.loadURL(editorUrl());
    return ok;
  } finally {
    restarting = false;
  }
}

// ---------------------------------------------------------------- window
/** The editor's address with the access key: the server turns it into a session cookie and redirects to the plain address. */
const editorUrl = () => `http://localhost:${port}/?t=${settings.accessToken}`;

function createWindow() {
  const overlay = process.platform === "win32" || process.platform === "darwin";
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 980, minHeight: 640, backgroundColor: "#0a0a0c", title: APP_NAME, icon: iconPath,
    show: false, autoHideMenuBar: true,
    ...(overlay && { titleBarStyle: "hidden", titleBarOverlay: { color: "#0a0a0c", symbolColor: "#d4af37", height: 44 } }),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once("ready-to-show", () => { if (!SMOKE || process.env.DRAGON_DROP_SHOT) win.show(); });
  win.loadURL(editorUrl());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const keepLocal = (e, url) => {
    if (!url.startsWith(`http://localhost:${port}/`)) { e.preventDefault(); if (/^https?:/i.test(url)) void shell.openExternal(url); }
  };
  win.webContents.on("will-navigate", keepLocal);
  win.webContents.on("will-redirect", keepLocal);
  // the editor needs no camera, microphone, location, notifications, ...: say no to every permission request except these
  const okPermissions = new Set(["clipboard-sanitized-write", "fullscreen"]);
  win.webContents.session.setPermissionRequestHandler((_wc, permission, done) => done(okPermissions.has(permission)));
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => okPermissions.has(permission));
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i"))) win.webContents.toggleDevTools();
  });
  win.on("closed", () => { win = null; });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "Open the maps folder", click: () => void shell.openPath(settings.projectsDir) },
      { label: "Open the log folder", click: () => void shell.openPath(path.dirname(logFile())) },
      { type: "separator" },
      { role: "quit", label: "Quit" },
    ] },
    { label: "View", submenu: [
      { role: "reload" }, { role: "forceReload" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { label: "Help", submenu: [
      { label: "Open-source licences", click: () => void shell.openPath(path.join(resources, "THIRD-PARTY-NOTICES.txt")) },
    ] },
  ]));
}

// ---------------------------------------------------------------- Claude Code (uses the user's Claude subscription, no API key)
const CLAUDE_MARK = "<!-- Managed by Dragon Drop. Delete this line if you edit the file and don't want it rewritten. -->";

const CLAUDE_MD = `${CLAUDE_MARK}
# Dragon Drop map session

You are helping a DM build maps in **Dragon Drop**, a map editor that the DM and you edit together.
Use the **mapmaker** MCP tools (they act on the project open in the editor). The editor shows every change live, attributes it to you, and the DM can undo it.

- Look with \`render_preview\` (world maps) or \`render_battlemap\` (battlemaps) before and after edits.
- Call \`get_changes_since\` at the start of each turn to see what the DM changed by hand.
- Prefer \`add_landmass\` / \`add_mountain_range\` over many small \`sculpt\` calls, then \`erode\`.
- The painted map has many kinds of ground (tundra, forests, steppe, savanna, marsh, desert, badlands, glacier and more: the Ground legend in the editor). \`list_grounds\` lists them and how to get each one; \`get_selection\` reports which are in the selected area.
- Use \`save_checkpoint\` before big experiments. Never call \`generate_terrain\` on an existing map unless asked.
- Battlemaps are separate projects, in grid squares: \`create_battlemap\`, \`add_room\`, \`paint_floor\`, \`add_wall\`, \`add_door\`, \`add_light\`, \`export_battlemap\`.
- **Lore belongs to the DM.** Read the project brief (\`get_brief\`). Never invent canon (names, history, who lives where): propose it, mark it as a proposal, and record it only when the DM confirms.
- If the mapmaker tools are missing, say so. Don't try to edit map files by hand.

## Assist messages
When the DM's message starts with **[Assist]** or **[Suggest]**, they want ideas, not changes:
- Call \`get_changes_since\` with the number they give, and look with \`render_preview\` at the area they touched.
- Reply with up to 3 short, concrete suggestions (what, where, why it helps), numbered so the DM can answer "do 1 and 3".
- Suggest only. Don't change the map until the DM says yes. Use only the mapmaker tools for this (no files, no shell).
- Don't invent names or lore. If an idea needs a name or a fact, say it is a proposal and ask. Check the brief (\`get_brief\`) so you don't suggest what is already decided.
- If there is nothing useful to suggest, say so in one line.
`;

// Claude Code reports through hooks when it is idle, working or waiting at a question, so Assist mode never types at the wrong moment.
// The hooks post to this app's own server (curl ships with Windows 10 and later). Their output is empty: a hook's output can reach Claude.
const HOOK_PATH = "/api/claude-hook";
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "Notification", "SessionEnd"];

function hookCommand() {
  const curl = process.platform === "win32" ? "curl.exe" : "curl";
  return `${curl} -s -m 3 -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${settings.accessToken}" --data-binary "@-" "http://127.0.0.1:${port}${HOOK_PATH}"`;
}

/** The settings with our hooks (re)written for the current port; the DM's own settings and hooks are kept. */
function withDragonDropHooks(cfg) {
  const hooks = cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? { ...cfg.hooks } : {};
  for (const ev of HOOK_EVENTS) {
    const others = (Array.isArray(hooks[ev]) ? hooks[ev] : []).filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h.command === "string" && h.command.includes(HOOK_PATH))));
    hooks[ev] = [...others, { hooks: [{ type: "command", command: hookCommand(), timeout: 5 }] }];
  }
  return { ...cfg, hooks };
}

function claudeWorkspace() {
  return SMOKE ? path.join(smokeDir, "claude") : path.join(app.getPath("documents"), "Dragon Drop", "Claude");
}

/** Where Claude Code is installed, or null. (It may not be on the PATH yet: the installer puts it in ~/.local/bin.) */
function findClaude() {
  if (SMOKE && process.env.DRAGON_DROP_CLAUDE_PATH) return process.env.DRAGON_DROP_CLAUDE_PATH; // the automated test uses a stand-in
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const first = execFileSync(finder, ["claude"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  } catch { /* not on the PATH */ }
  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "claude", "claude.exe"),
    path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

/** Write the little workspace Claude Code starts in: it knows this app's address, even if the port changes. */
function writeClaudeWorkspace(claudePath) {
  // (careful: `settings` is the app's settings here; the Claude settings file is claudeSettings. A second `settings` in this function would make the first use fail.)
  const dir = claudeWorkspace();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, "mapmaker.mcp.json"), JSON.stringify({ mcpServers: { mapmaker: { type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${settings.accessToken}` } } } }, null, 2), { mode: 0o600 });
  const md = path.join(dir, "CLAUDE.md");
  let mine = true;
  try { mine = fs.readFileSync(md, "utf8").includes(CLAUDE_MARK); } catch { /* new file */ }
  if (mine) fs.writeFileSync(md, CLAUDE_MD);
  const claudeSettings = path.join(dir, ".claude", "settings.json");
  // the map tools are safe (every change is undoable), so don't ask about each one; the hooks are rewritten each time (the port can change)
  if (!fs.existsSync(claudeSettings)) {
    fs.writeFileSync(claudeSettings, JSON.stringify(withDragonDropHooks({ permissions: { allow: ["mcp__mapmaker"] } }), null, 2));
  } else {
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(claudeSettings, "utf8")); } catch { /* the DM's file isn't valid JSON: leave it alone */ }
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) fs.writeFileSync(claudeSettings, JSON.stringify(withDragonDropHooks(cfg), null, 2));
  }
  // the path ends up inside a .cmd file: anything that cmd would treat specially is left out (the launcher then just says "claude")
  const exe = claudePath && !/["%\r\n&|<>^]/.test(claudePath) ? claudePath : "claude";
  fs.writeFileSync(path.join(dir, "open-claude.cmd"),
    `@echo off\r\ntitle Claude Code - Dragon Drop\r\ncd /d "%~dp0"\r\necho Starting Claude Code with the Dragon Drop map tools...\r\n"${exe}" --mcp-config "%~dp0mapmaker.mcp.json"\r\n`);
  return dir;
}

function hasCommand(name) {
  try { execFileSync("where", [name], { windowsHide: true, stdio: "ignore" }); return true; } catch { return false; }
}

function openClaude(launch) {
  const claudePath = findClaude();
  const workspace = writeClaudeWorkspace(claudePath);
  if (!claudePath) return { ok: false, reason: "not-installed", workspace };
  if (!launch) return { ok: true, workspace, claudePath };
  if (process.platform !== "win32") return { ok: false, reason: "unsupported-platform", workspace, claudePath };
  const detached = { detached: true, stdio: "ignore", cwd: workspace };
  if (hasCommand("wt")) spawn("wt.exe", ["-d", workspace, "--title", "Claude Code - Dragon Drop", "cmd.exe", "/k", "open-claude.cmd"], detached).unref();
  else spawn("cmd.exe", ["/c", "start", "Claude Code - Dragon Drop", "cmd.exe", "/k", "open-claude.cmd"], detached).unref();
  return { ok: true, workspace, claudePath };
}

// ---------------------------------------------------------------- the Claude Code terminal inside the window
let nodePty = null;
let term = null;
let termAlive = false;
let termBuf = "";
let termPending = "";
let termTimer = null;
let termLastOutput = 0;
const TERM_BUF_MAX = 400000;

/** For Assist mode: is the terminal alive, how long has it been silent, and does its last screen look busy or like a question? */
function termStatus() {
  const tail = termBuf.slice(-1200).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  const looksBusy = /esc to interrupt|do you want to|esc to cancel|\(y\/n\)|❯\s*1\./i.test(tail);
  return { alive: termAlive, quietMs: termAlive ? Date.now() - termLastOutput : 0, looksBusy };
}

function loadPty() {
  if (!nodePty) nodePty = require("@lydell/node-pty");
  return nodePty;
}

function sendToEditor(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function killTerminal() {
  const t = term;
  term = null;
  termAlive = false;
  if (t) { try { t.kill(); } catch { /* already gone */ } }
}

/**
 * Claude Code's own installer (https://code.claude.com/docs/en/setup), run visibly in the panel's terminal so nothing is hidden.
 * The command is fixed here: the page can start it, but can't choose what runs. (The automated test swaps in a harmless stand-in.)
 */
function installCommand() {
  if (SMOKE) return process.platform === "win32" ? { file: process.env.ComSpec || "cmd.exe", args: ["/c", "echo DD_FAKE_INSTALL_OK"] } : { file: "/bin/sh", args: ["-c", "echo DD_FAKE_INSTALL_OK"] };
  if (process.platform === "win32") return { file: "powershell.exe", args: ["-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex"] };
  return { file: "/bin/bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] };
}

function startInstall({ cols, rows }) {
  killTerminal();
  const { file, args } = installCommand();
  try {
    const env = { ...process.env, TERM: "xterm-256color" };
    delete env.ELECTRON_RUN_AS_NODE;
    const proc = loadPty().spawn(file, args, { name: "xterm-256color", cols: Math.max(20, cols | 0 || 80), rows: Math.max(5, rows | 0 || 24), cwd: os.homedir(), env });
    term = proc;
    termAlive = true;
    termBuf = "";
    termLastOutput = Date.now();
    proc.onData((d) => {
      termLastOutput = Date.now();
      termBuf = (termBuf + d).slice(-TERM_BUF_MAX);
      termPending += d;
      if (!termTimer) termTimer = setTimeout(() => { termTimer = null; const chunk = termPending; termPending = ""; sendToEditor("dd:term-data", chunk); }, 12);
    });
    proc.onExit(({ exitCode }) => {
      if (term === proc) { termAlive = false; term = null; }
      const found = !!findClaude();
      sendToEditor("dd:claude-installed", { ok: exitCode === 0 && found, code: exitCode, found });
    });
    return { ok: true };
  } catch (err) {
    termAlive = false;
    return { ok: false, reason: String(err && err.message ? err.message : err) };
  }
}

/** Is Claude Code installed, and which version? (Whether the DM is signed in is Claude Code's own business: it asks on first start.) */
async function claudeCheck() {
  const claudePath = findClaude();
  if (!claudePath) return { installed: false, path: null, version: null };
  const cmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(claudePath) ? { file: process.env.ComSpec || "cmd.exe", args: ["/c", claudePath, "--version"] } : { file: claudePath, args: ["--version"] };
  // stdin is closed so a program that waits for a key (the test's stand-in) can't hang the check
  const version = await new Promise((resolve) => {
    try {
      const p = spawn(cmd.file, cmd.args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let out = "";
      const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } resolve(null); }, 8000);
      p.stdout.on("data", (d) => { out += d; });
      p.on("error", () => { clearTimeout(timer); resolve(null); });
      p.on("close", () => { clearTimeout(timer); resolve(out.trim().split(/\r?\n/).find(Boolean) || null); });
    } catch { resolve(null); }
  });
  return { installed: true, path: claudePath, version };
}

/** Run Claude Code (with the map tools connected) in a pseudo-terminal that the editor draws. */
function startTerminal({ cols, rows, resume }) {
  killTerminal();
  const claudePath = findClaude();
  const workspace = writeClaudeWorkspace(claudePath);
  if (!claudePath) return { ok: false, reason: "not-installed" };
  const args = ["--mcp-config", path.join(workspace, "mapmaker.mcp.json")];
  if (resume) args.unshift("--continue");
  let file = claudePath;
  let fileArgs = args;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(claudePath)) {
    file = process.env.ComSpec || "cmd.exe";
    fileArgs = ["/c", claudePath, ...args];
  }
  try {
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
    delete env.ELECTRON_RUN_AS_NODE;
    const proc = loadPty().spawn(file, fileArgs, { name: "xterm-256color", cols: Math.max(20, cols | 0 || 80), rows: Math.max(5, rows | 0 || 24), cwd: workspace, env });
    term = proc;
    termAlive = true;
    termBuf = "";
    termLastOutput = Date.now();
    proc.onData((d) => {
      termLastOutput = Date.now();
      termBuf = (termBuf + d).slice(-TERM_BUF_MAX);
      termPending += d;
      if (!termTimer) termTimer = setTimeout(() => { termTimer = null; const chunk = termPending; termPending = ""; sendToEditor("dd:term-data", chunk); }, 12);
    });
    proc.onExit(({ exitCode }) => {
      if (term === proc) { termAlive = false; term = null; }
      sendToEditor("dd:term-exit", exitCode);
    });
    return { ok: true, workspace, claudePath };
  } catch (err) {
    termAlive = false;
    return { ok: false, reason: String(err && err.message ? err.message : err) };
  }
}

/** Automated test only: run a trivial command through a pseudo-terminal and return what it printed. */
function ptySelfTest() {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const win32 = process.platform === "win32";
      const p = loadPty().spawn(win32 ? (process.env.ComSpec || "cmd.exe") : "/bin/sh", win32 ? ["/c", "echo DD_PTY_OK"] : ["-c", "echo DD_PTY_OK"], { name: "xterm-256color", cols: 80, rows: 24, cwd: os.tmpdir(), env: process.env });
      p.onData((d) => { out += d; if (out.includes("DD_PTY_OK")) finish(true); });
      p.onExit(() => finish(out.includes("DD_PTY_OK")));
      setTimeout(() => finish(false), 15000);
    } catch (e) {
      finish(false);
    }
  });
}

// ---------------------------------------------------------------- updates (from GitHub Releases, for the installed app)
let autoUpdater = null;
let updateState = { status: "idle", version: null, message: "", channel: CHANNEL };

function setUpdate(patch) {
  updateState = { ...updateState, ...patch };
}

function setupUpdater() {
  if (CHANNEL === "itch") { setUpdate({ status: "unavailable", message: "This copy is updated by the itch app, not by Dragon Drop." }); return; } // (electron-updater is never even loaded)
  if (!app.isPackaged || SMOKE) { setUpdate({ status: "unavailable", message: "Updates are only checked in the installed app." }); return; }
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    setUpdate({ status: "unavailable", message: "Update checking isn't available." });
    return;
  }
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdate({ status: "checking", message: "Checking for updates..." }));
  autoUpdater.on("update-available", (i) => setUpdate({ status: "downloading", version: i.version, message: `Downloading version ${i.version}...` }));
  autoUpdater.on("update-not-available", () => setUpdate({ status: "current", message: "You're up to date." }));
  autoUpdater.on("error", (e) => setUpdate({ status: "error", message: `Couldn't check for updates: ${(e && e.message ? e.message : String(e)).split("\n")[0]}` }));
  autoUpdater.on("download-progress", (p) => setUpdate({ status: "downloading", message: `Downloading version ${updateState.version || ""}... ${Math.round(p.percent)}%` }));
  autoUpdater.on("update-downloaded", (i) => {
    setUpdate({ status: "ready", version: i.version, message: `Version ${i.version} is ready.` });
    if (!win) return;
    void dialog.showMessageBox(win, {
      type: "info", title: "Update ready", message: `Dragon Drop ${i.version} is ready to install.`,
      detail: "Restart now to update (your maps are saved first), or it will install the next time you close the app.",
      buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1, noLink: true,
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  const check = () => {
    if (settings.autoUpdate === false) return;
    autoUpdater.checkForUpdates().catch(() => { /* reported through the error event */ });
  };
  setTimeout(check, 20000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------- bridge to the editor (see preload.cjs)
const fromEditor = (e) => !!win && e.senderFrame && e.senderFrame.url.startsWith(`http://localhost:${port}/`);

ipcMain.on("dd:version", (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle("dd:settings", (e) => {
  if (!fromEditor(e)) return null;
  return {
    version: app.getVersion(), projectsDir: settings.projectsDir, hasApiKey: !!getApiKey(), port, defaultPort: DEFAULT_PORT, autoUpdate: settings.autoUpdate !== false, assetsDir: settings.assetsDir || null,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    // the line for connecting Claude Code from the user's own terminal: with the access key to copy, and the same line with the key hidden to show
    mcpCommand: `claude mcp add --transport http --scope user mapmaker http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${settings.accessToken}"`,
    mcpCommandShown: `claude mcp add --transport http --scope user mapmaker http://127.0.0.1:${port}/mcp --header "Authorization: Bearer (your access key)"`,
    logDir: path.dirname(logFile()), encrypted: safeStorage.isEncryptionAvailable(),
  };
});
ipcMain.handle("dd:set-api-key", async (e, key) => {
  if (!fromEditor(e)) return false;
  setApiKey(typeof key === "string" && key.length <= 400 ? key.trim() : "");
  return restartServer();
});
ipcMain.handle("dd:choose-projects", async (e) => {
  if (!fromEditor(e)) return null;
  const dir = await chooseProjectsFolder(win);
  if (!dir) return null;
  if (!hasProjects(dir)) {
    const r = await dialog.showMessageBox(win, {
      type: "question", message: "That folder has no maps in it yet.", detail: `${dir}\n\nUse it anyway? A new first map will be started in it.`,
      buttons: ["Use it", "Cancel"], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (r.response !== 0) return null;
  }
  settings.projectsDir = dir;
  saveSettings();
  await restartServer();
  return dir;
});
ipcMain.handle("dd:choose-assets", async (e) => {
  if (!fromEditor(e)) return null;
  const r = await dialog.showOpenDialog(win, { title: "Choose your Dungeondraft assets folder (the one holding the .dungeondraft_pack files)", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.assetsDir = r.filePaths[0];
  saveSettings();
  await restartServer();
  return settings.assetsDir;
});
ipcMain.handle("dd:clear-assets", async (e) => {
  if (!fromEditor(e)) return;
  delete settings.assetsDir;
  saveSettings();
  await restartServer();
});
ipcMain.handle("dd:open-projects", (e) => { if (fromEditor(e)) void shell.openPath(settings.projectsDir); });
ipcMain.handle("dd:open-claude", (e, opts) => {
  if (!fromEditor(e)) return { ok: false, reason: "not-allowed" };
  try { return openClaude(!(opts && opts.launch === false)); } catch (err) { return { ok: false, reason: String(err && err.message ? err.message : err) }; }
});
ipcMain.handle("dd:term-start", (e, opts) => {
  if (!fromEditor(e)) return { ok: false, reason: "not-allowed" };
  return startTerminal({ cols: opts && opts.cols, rows: opts && opts.rows, resume: !!(opts && opts.resume) });
});
ipcMain.handle("dd:claude-install", (e, opts) => (fromEditor(e) ? startInstall({ cols: opts && opts.cols, rows: opts && opts.rows }) : { ok: false, reason: "not-allowed" }));
ipcMain.handle("dd:claude-check", async (e) => (fromEditor(e) ? await claudeCheck() : { installed: false, path: null, version: null }));
ipcMain.handle("dd:term-attach", (e) => (fromEditor(e) ? { alive: termAlive, buffer: termBuf } : { alive: false, buffer: "" }));
ipcMain.handle("dd:term-status", (e) => (fromEditor(e) ? termStatus() : { alive: false, quietMs: 0, looksBusy: true }));
ipcMain.on("dd:term-write", (e, data) => { if (fromEditor(e) && term && termAlive && typeof data === "string") term.write(data); });
ipcMain.on("dd:term-resize", (e, cols, rows) => { if (fromEditor(e) && term && termAlive) { try { term.resize(Math.max(2, cols | 0), Math.max(2, rows | 0)); } catch { /* the program just ended */ } } });
ipcMain.handle("dd:term-kill", (e) => { if (fromEditor(e)) killTerminal(); });
ipcMain.handle("dd:update-state", (e) => (fromEditor(e) ? updateState : null));
ipcMain.handle("dd:check-update", async (e) => {
  if (!fromEditor(e)) return null;
  if (autoUpdater) { try { await autoUpdater.checkForUpdates(); } catch { /* shown through the error event */ } }
  return updateState;
});
ipcMain.handle("dd:install-update", (e) => { if (fromEditor(e) && autoUpdater && updateState.status === "ready") autoUpdater.quitAndInstall(); });
ipcMain.handle("dd:set-auto-update", (e, on) => { if (fromEditor(e)) { settings.autoUpdate = !!on; saveSettings(); } return settings.autoUpdate !== false; });
ipcMain.handle("dd:open-logs", (e) => { if (fromEditor(e)) void shell.openPath(path.dirname(logFile())); });

// ---------------------------------------------------------------- start up
/** Smoke-test result: to the console, and to a file when DRAGON_DROP_SMOKE_OUT is set (a Windows GUI app has no console). */
function smokeReport(line) {
  console.log(line);
  if (process.env.DRAGON_DROP_SMOKE_OUT) { try { fs.appendFileSync(process.env.DRAGON_DROP_SMOKE_OUT, `${line}\n`); } catch { /* best effort */ } }
}

function fatal(message) {
  if (SMOKE) {
    smokeReport(`SMOKE FAIL: ${message}`);
    quitting = true;
    app.exit(1);
    return;
  }
  dialog.showErrorBox(`${APP_NAME} couldn't start`, message);
  quitting = true;
  app.exit(1);
}

/** Development aid: save screenshots of the main window, and of the Settings dialog, as <base>-main.png / <base>-settings.png. */
async function takeShots(base) {
  await new Promise((r) => setTimeout(r, 4000)); // let the map paint
  fs.writeFileSync(`${base}-main.png`, (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-button"]')?.click()`);
  await new Promise((r) => setTimeout(r, 800));
  fs.writeFileSync(`${base}-settings.png`, (await win.webContents.capturePage()).toPNG());
}

async function smokeTest() {
  const deadline = Date.now() + 60000;
  const check = () => win.webContents.executeJavaScript(`({
    connected: document.body.innerText.includes("Connected"),
    bridge: !!(window.dragonDrop && window.dragonDrop.version),
    brand: document.body.innerText.toUpperCase().includes("DRAGON DROP"),
    canvas: !!document.querySelector('[data-testid="map-canvas"]'),
  })`);
  while (Date.now() < deadline) {
    try {
      const r = await check();
      if (r.connected && r.bridge && r.canvas) {
        // the server can be busy right after start (it prepares the map in the background): ask again for a while
        let info = null;
        for (let i = 0; i < 20 && !info; i++) { info = await healthy(port); if (!info) await new Promise((r) => setTimeout(r, 1500)); }
        const s = await win.webContents.executeJavaScript("window.dragonDrop.getSettings()");
        if (!info || !info.project) return fatal(`server health had no open project: ${JSON.stringify(info)}`);
        if (!s || s.port !== port) return fatal("settings bridge returned nothing");
        // the web page is sandboxed: no Node in it, it can't leave the local address, and a pop-up window is refused
        const iso = await win.webContents.executeJavaScript(`({ req: typeof require, proc: typeof process })`);
        if (iso.req !== "undefined" || iso.proc !== "undefined") return fatal(`the editor page can see Node (${JSON.stringify(iso)})`);
        const here = win.webContents.getURL();
        await win.webContents.executeJavaScript(`location.href = "ftp://dragon-drop.invalid/"`).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
        if (win.webContents.getURL() !== here) return fatal(`the window navigated away from the editor to ${win.webContents.getURL()}`);
        const windows = BrowserWindow.getAllWindows().length;
        await win.webContents.executeJavaScript(`window.open("about:blank") && 1`).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
        if (BrowserWindow.getAllWindows().length !== windows) return fatal("the editor page could open a new window");
        // the server wants its access key: without it the API and the map tools are refused, with it they answer, and the window has its cookie
        const bare = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null);
        if (!bare || bare.status !== 401) return fatal(`the server answered a request with no access key (${bare ? bare.status : "no answer"})`);
        const keyed = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { authorization: `Bearer ${settings.accessToken}` } }).catch(() => null);
        if (!keyed || keyed.status !== 200) return fatal(`the server refused the access key (${keyed ? keyed.status : "no answer"})`);
        if (here.includes("t=")) return fatal(`the access key was left in the window's address: ${here}`);
        const page = await fetch(`http://localhost:${port}/`).catch(() => null);
        if (!page || !page.headers.get("content-security-policy") || page.headers.get("x-content-type-options") !== "nosniff") return fatal("the editor page is served without its security headers");
        const ptyOk = await ptySelfTest();
        if (!ptyOk) return fatal("the pseudo-terminal could not run a command");
        // the editor's Claude Code panel should have started the stand-in through the pseudo-terminal
        let shown = "";
        for (let i = 0; i < 40 && !shown.includes("DD_FAKE_CLAUDE_READY"); i++) {
          shown = await win.webContents.executeJavaScript(`(document.querySelector('[data-testid="claude-terminal"] .xterm-rows') || {}).innerText || ""`);
          if (!shown.includes("DD_FAKE_CLAUDE_READY")) await new Promise((r) => setTimeout(r, 500));
        }
        if (!shown.includes("DD_FAKE_CLAUDE_READY") || !shown.includes("--mcp-config")) return fatal(`the Claude Code panel didn't show the terminal output: ${JSON.stringify(shown.slice(0, 200))}`);
        // typing reaches the program, and when it ends the panel offers a new conversation
        await win.webContents.executeJavaScript(`window.dragonDrop.termWrite("\\r")`);
        let ended = false;
        for (let i = 0; i < 30 && !ended; i++) {
          ended = await win.webContents.executeJavaScript(`!!document.querySelector('[data-testid="claude-ended"]')`);
          if (!ended) await new Promise((r) => setTimeout(r, 500));
        }
        if (!ended) return fatal("the Claude Code panel didn't notice the program ending (or typing didn't reach it)");
        const cl = await win.webContents.executeJavaScript("window.dragonDrop.openClaude(false)");
        if (!cl || !cl.workspace) return fatal(`openClaude returned ${JSON.stringify(cl)}`);
        const mcp = (() => { try { return fs.readFileSync(path.join(cl.workspace, "mapmaker.mcp.json"), "utf8"); } catch { return ""; } })();
        if (!mcp.includes(`http://127.0.0.1:${port}/mcp`)) return fatal(`Claude workspace file is wrong: ${mcp}`);
        if (!mcp.includes(`Bearer ${settings.accessToken}`)) return fatal("Claude workspace file has no access key for the map tools");
        for (const f of ["CLAUDE.md", "open-claude.cmd", path.join(".claude", "settings.json")]) {
          if (!fs.existsSync(path.join(cl.workspace, f))) return fatal(`Claude workspace is missing ${f}`);
        }
        // first-time setup: the Claude Code check works, and the one-click installer runs (a harmless stand-in under test) and reports back
        const chk = await win.webContents.executeJavaScript("window.dragonDrop.claudeCheck()");
        if (!chk || chk.installed !== true || typeof chk.path !== "string") return fatal(`claudeCheck returned ${JSON.stringify(chk)}`);
        // (the panel starts Claude Code after a short pause, which clears the terminal: so collect the installer's output as it streams)
        const inst = await win.webContents.executeJavaScript(`new Promise((resolve) => {
          let seen = "";
          const offData = window.dragonDrop.onTermData((d) => { seen += d; });
          const finish = (r) => { offData(); resolve(Object.assign({}, r, { seen })); };
          const off = window.dragonDrop.onClaudeInstalled((r) => { off(); setTimeout(() => finish(r), 500); });
          window.dragonDrop.claudeInstall({ cols: 80, rows: 24 }).then((s) => { if (!s.ok) { off(); finish({ failedToStart: s }); } });
          setTimeout(() => { off(); finish({ timeout: true }); }, 15000);
        })`);
        if (!inst || inst.ok !== true) return fatal(`the Claude Code installer flow didn't report success: ${JSON.stringify(inst)}`);
        if (!String(inst.seen).includes("DD_FAKE_INSTALL_OK")) return fatal(`the installer's output didn't reach the terminal: ${JSON.stringify(String(inst.seen).slice(0, 200))}`);
        // Assist mode: Claude Code's hooks point at this app, and the terminal's status is available to the editor
        const cfgText = (() => { try { return fs.readFileSync(path.join(cl.workspace, ".claude", "settings.json"), "utf8"); } catch { return ""; } })();
        let hooks = {};
        try { hooks = JSON.parse(cfgText).hooks || {}; } catch { return fatal(`Claude workspace settings.json isn't valid JSON: ${cfgText.slice(0, 200)}`); }
        for (const ev of HOOK_EVENTS) {
          const cmd = JSON.stringify(hooks[ev] || []);
          if (!cmd.includes(`http://127.0.0.1:${port}${HOOK_PATH}`)) return fatal(`Claude hook ${ev} isn't set up for port ${port}: ${cmd.slice(0, 200)}`);
        }
        const ts = await win.webContents.executeJavaScript("window.dragonDrop.termStatus()");
        if (!ts || typeof ts.alive !== "boolean" || typeof ts.quietMs !== "number" || typeof ts.looksBusy !== "boolean") return fatal(`termStatus returned ${JSON.stringify(ts)}`);
        if (process.env.DRAGON_DROP_SHOT) await takeShots(process.env.DRAGON_DROP_SHOT);
        smokeReport(`SMOKE OK (project ${info.project}, port ${port}, sandbox ok, brand text ${r.brand ? "found" : "MISSING"}, version ${app.getVersion()}, channel ${CHANNEL}, updater ${autoUpdater ? "on" : "off"}, claude ${cl.ok ? "found" : cl.reason}, terminal ok)`);
        if (!r.brand) return fatal("the Dragon Drop name isn't on screen");
        quitting = true;
        await stopServer();
        app.exit(0);
        return;
      }
    } catch { /* the page is still loading */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  fatal(`the editor didn't load in 60 s. Server log:\n${childLog.slice(-15).join("\n")}`);
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.on("before-quit", (e) => {
    killTerminal();
    if (quitting || !child) return;
    e.preventDefault();
    quitting = true;
    void stopServer().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(async () => {
    loadSettings();
    if (SMOKE) {
      settings.projectsDir = path.join(smokeDir, "projects");
      // a stand-in for Claude Code, so the embedded terminal can be tested without it (or an account)
      const fake = path.join(smokeDir, process.platform === "win32" ? "fake-claude.cmd" : "fake-claude.sh");
      fs.writeFileSync(fake, process.platform === "win32"
        ? "@echo off\r\necho DD_FAKE_CLAUDE_READY %*\r\npause >nul\r\n"
        : '#!/bin/sh\necho DD_FAKE_CLAUDE_READY "$@"\nread x\n', { mode: 0o755 });
      process.env.DRAGON_DROP_CLAUDE_PATH = fake;
    } else if (!settings.projectsDir || !fs.existsSync(settings.projectsDir)) {
      await firstRun();
    }
    for (const p of [serverMain, path.join(editorDir, "index.html")]) {
      if (!fs.existsSync(p)) return fatal(`A program file is missing: ${p}\n\nRun "node scripts/prepare.mjs" in apps/desktop first (or reinstall Dragon Drop).`);
    }
    const ok = await startServer();
    if (!ok) {
      return fatal(`The map server didn't start.\n\n${childLog.slice(-8).join("\n") || "(no output)"}\n\nThe full log is in ${logFile()}`);
    }
    buildMenu();
    createWindow();
    setupUpdater();
    if (SMOKE) void smokeTest();
  });
}
