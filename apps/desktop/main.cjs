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
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell, utilityProcess } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const assistants = require("./assistants.cjs");

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
/** The open-source licences of everything the app bundles (scripts/notices.mjs makes it; the installer carries it). */
const noticesFile = () => path.join(resources, "THIRD-PARTY-NOTICES.txt");
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
  try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch (e) {
    settings = {};
    // a damaged file is kept aside rather than written over (it still says where the maps are)
    if (!(e && e.code === "ENOENT")) { try { fs.renameSync(settingsFile, `${settingsFile.replace(/\.json$/, "")}.unreadable-${Date.now()}.json`); } catch { /* can't move it: it is replaced */ } }
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) settings = {};
  // The access key: every request to this app's own server (the editor window, Claude Code's map tools, its hooks) carries it, so another program,
  // another Windows user or a web page can't drive the app. Made once per install and kept in the settings file (readable only by this user).
  // The map tools key: what the AI assistant is handed (its map tools and its hooks), so it doesn't hold the access key itself. The server takes it only for
  // the map tools and the hooks, never for the editor's own connection (where the Allow box is answered) or the rest of /api (found 2026-11-22).
  const weak = (k) => typeof k !== "string" || k.length < 32;
  if (weak(settings.accessToken) || weak(settings.toolsToken) || settings.toolsToken === settings.accessToken) {
    if (weak(settings.accessToken)) settings.accessToken = crypto.randomBytes(32).toString("hex");
    if (weak(settings.toolsToken) || settings.toolsToken === settings.accessToken) settings.toolsToken = crypto.randomBytes(32).toString("hex");
    try { saveSettings(); } catch { /* saved with the next change; the keys are only needed while the app runs */ }
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const tmp = `${settingsFile}.tmp`;
  // on the disk before the rename (a power cut could otherwise leave an empty settings file: the maps folder and the key forgotten)
  const fd = fs.openSync(tmp, "w", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(settings, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
  // The server gets only the settings chosen here: none of the developer setup's MAPMAKER_* switches (one turns off the Allow box) nor an ANTHROPIC_* key
  // or address from the PC's environment (the chat uses the key entered in Settings, and talks only to Anthropic).
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MAPMAKER_|ANTHROPIC_)/i.test(k)));
  const env = {
    ...inherited, MAPMAKER_START: "1", MAPMAKER_NO_DOTENV: "1", MAPMAKER_HOST: "127.0.0.1", MAPMAKER_DEV_EDITOR_PORT: "",
    MAPMAKER_PORT: String(port), MAPMAKER_PROJECTS_DIR: settings.projectsDir, MAPMAKER_EDITOR_DIST: editorDir, MAPMAKER_ACCESS_TOKEN: settings.accessToken,
    MAPMAKER_TOOLS_TOKEN: settings.toolsToken,
  };
  // the phone page is reached only through an address the person chose in Settings (their Tailscale name); one set in the PC's environment for the
  // developer setup is not taken, so the phone page stays off unless chosen here
  if (settings.phoneHost) env.MAPMAKER_ALLOWED_HOSTS = settings.phoneHost;
  const key = getApiKey();
  if (key) env.ANTHROPIC_API_KEY = key;
  env.MAPMAKER_CACHE_DIR = path.join(app.getPath("userData"), "cache");
  if (settings.assetsDir) env.MAPMAKER_ASSETS_DIR = settings.assetsDir;
  childLog = [];
  // An Electron utility process (Node, with no window), not this program run as plain Node (ELECTRON_RUN_AS_NODE): so the RunAsNode switch can be off,
  // and a signed Dragon Drop.exe can't be used by other programs as a Node.js of their own (found 2026-11-22). MAPMAKER_START tells main.mjs to start.
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = utilityProcess.fork(serverMain, [], { env, stdio: "pipe", serviceName: "Dragon Drop map server" });
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
  try { proc.postMessage("shutdown"); } catch { proc.kill(); }
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
/**
 * The editor's own address. 127.0.0.1, never "localhost": the window tries IPv6 ([::1]) first for "localhost", and the server listens on IPv4 only, so
 * another program (another Windows user's, say) listening on [::1] at this port would be sent the access key and would count as the editor (found 2026-11-22).
 */
const editorOrigin = () => `http://127.0.0.1:${port}`;
/** The editor's address with the access key: the server turns it into a session cookie and redirects to the plain address. */
const editorUrl = () => `${editorOrigin()}/?t=${settings.accessToken}`;

/** The file on disk behind one of the server's picture addresses (/api/projects/<map>/refs/<name> or .../previews/<name>), or null: only pictures inside the maps folder. */
function ownPicture(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== editorOrigin() || !settings.projectsDir) return null;
  const m = u.pathname.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]{0,63})\/(refs|previews)\/([^/]+)$/);
  if (!m) return null;
  let name;
  try { name = decodeURIComponent(m[3]); } catch { return null; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}\.(png|jpe?g|webp)$/i.test(name) || name.includes("..")) return null;
  const file = path.join(settings.projectsDir, m[1], m[2] === "refs" ? "refs" : path.join("map", "previews"), name);
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

function createWindow() {
  const overlay = process.platform === "win32" || process.platform === "darwin";
  win = new BrowserWindow({
    // (720 wide still fits the top bar and a usable map with both panels open, and lets the window share a screen with another one: styles.css narrows the rest)
    width: 1500, height: 940, minWidth: 720, minHeight: 640, backgroundColor: "#0a0a0c", title: APP_NAME, icon: iconPath,
    show: false, autoHideMenuBar: true,
    ...(overlay && { titleBarStyle: "hidden", titleBarOverlay: { color: "#0a0a0c", symbolColor: "#d4af37", height: 44 } }),
    // (no developer tools in the installed app: "press F12 and paste this" is how a scammer would get a person to run code in the page, which can drive
    // the terminal; the log folder is what support needs. A development run keeps them.)
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, devTools: !app.isPackaged },
  });
  win.once("ready-to-show", () => { if (!SMOKE || process.env.DRAGON_DROP_SHOT) win.show(); });
  win.loadURL(editorUrl());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // a picture of a map's (a chat attachment, a preview) opens in Windows' own picture viewer: the web browser has no access key, and would show "Unauthorized"
    const picture = ownPicture(url);
    if (picture) void shell.openPath(picture);
    else if (/^https?:/i.test(url) && !url.startsWith(`${editorOrigin()}/`)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const keepLocal = (e, url) => {
    if (!url.startsWith(`${editorOrigin()}/`)) { e.preventDefault(); if (/^https?:/i.test(url)) void shell.openExternal(url); }
  };
  win.webContents.on("will-navigate", keepLocal);
  win.webContents.on("will-redirect", keepLocal);
  // the editor needs no camera, microphone, location, notifications, ...: say no to every permission request except these
  const okPermissions = new Set(["clipboard-sanitized-write", "fullscreen"]);
  win.webContents.session.setPermissionRequestHandler((_wc, permission, done) => done(okPermissions.has(permission)));
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => okPermissions.has(permission));
  if (!app.isPackaged) {
    win.webContents.on("before-input-event", (e, input) => {
      if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i"))) win.webContents.toggleDevTools();
    });
  }
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
      { label: "Open-source licences", click: () => void shell.openPath(noticesFile()) },
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
  // (curl reads the Authorization header from a file, so the settings file in the workspace doesn't hold the key)
  const header = hookHeaderFile().replace(/\\/g, "/");
  return `${curl} -s -m 3 -X POST -H "Content-Type: application/json" -H "@${header}" --data-binary "@-" "http://127.0.0.1:${port}${HOOK_PATH}"`;
}

/** The settings with our hooks (re)written for the current port; the DM's own settings and hooks are kept. */
function withDragonDropHooks(cfg, approveMcp) {
  const hooks = cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? { ...cfg.hooks } : {};
  for (const ev of HOOK_EVENTS) {
    const others = (Array.isArray(hooks[ev]) ? hooks[ev] : []).filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h.command === "string" && h.command.includes(HOOK_PATH))));
    hooks[ev] = [...others, { hooks: [{ type: "command", command: hookCommand(), timeout: 5 }] }];
  }
  if (!approveMcp) return { ...cfg, hooks };
  // a .mcp.json server needs approving once: list ours as approved so a Claude Code started by another program (ollama launch claude) doesn't ask
  const enabled = Array.isArray(cfg.enabledMcpjsonServers) ? [...cfg.enabledMcpjsonServers] : [];
  if (!enabled.includes("mapmaker")) enabled.push("mapmaker");
  return { ...cfg, hooks, enabledMcpjsonServers: enabled };
}

/**
 * Files that hold the access key live in the app-data folder, not in the Documents workspace (Documents is often synced to the cloud): the map tools file Claude Code is
 * handed with --mcp-config, and the header file the hooks read. Assistants that read their own project file get the key from the environment (see assistants.cjs).
 */
function mcpConfigFile() { return path.join(app.getPath("userData"), "mapmaker.mcp.json"); }
function hookHeaderFile() { return path.join(app.getPath("userData"), "hook-header.txt"); }

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
  // the files that hold the key go in the app-data folder; an earlier version left a copy in the workspace, which is taken out now
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  // (the assistant gets the map tools key, never the access key: see loadSettings)
  const ours = { type: "http", url: assistants.mcpAddress(port, settings.toolSet), headers: { Authorization: `Bearer ${settings.toolsToken}` } };
  fs.writeFileSync(mcpConfigFile(), JSON.stringify({ mcpServers: { mapmaker: ours } }, null, 2), { mode: 0o600 });
  fs.writeFileSync(hookHeaderFile(), `Authorization: Bearer ${settings.toolsToken}\n`, { mode: 0o600 });
  try { fs.unlinkSync(path.join(dir, "mapmaker.mcp.json")); } catch { /* not there */ }
  // the chosen assistant finds the map tools in its own project file (and no other assistant's file keeps our entry)
  const assistant = assistants.syncAssistantConfigs(dir, { profile: assistants.profileFor(settings.terminalCommand), port, key: settings.toolsToken, tools: settings.toolSet });
  const another = assistant.assistant === "claude"; // Claude Code started by another program (typed, or `ollama launch claude`): it reads .mcp.json, and we pre-approve the server there
  // the same notes under each assistant's own file name
  for (const name of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
    const md = path.join(dir, name);
    let mine = true;
    try { mine = fs.readFileSync(md, "utf8").includes(CLAUDE_MARK); } catch { /* new file */ }
    if (mine) fs.writeFileSync(md, CLAUDE_MD);
  }
  const claudeSettings = path.join(dir, ".claude", "settings.json");
  // the map tools are safe (every change is undoable), so don't ask about each one; the hooks are rewritten each time (the port can change)
  if (!fs.existsSync(claudeSettings)) {
    fs.writeFileSync(claudeSettings, JSON.stringify(withDragonDropHooks({ permissions: { allow: ["mcp__mapmaker"] } }, another), null, 2));
  } else {
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(claudeSettings, "utf8")); } catch { /* the DM's file isn't valid JSON: leave it alone */ }
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) fs.writeFileSync(claudeSettings, JSON.stringify(withDragonDropHooks(cfg, another), null, 2));
  }
  // the path ends up inside a .cmd file: anything that cmd would treat specially is left out (the launcher then just says "claude")
  const exe = claudePath && !/["%\r\n&|<>^]/.test(claudePath) ? claudePath : "claude";
  // (the map tools file is in the app-data folder now: its path ends up in the .cmd file too, so anything cmd would treat specially stops the launcher)
  const mcpFile = mcpConfigFile();
  const body = /["%\r\n&|<>^]/.test(mcpFile)
    ? `echo This launcher can't use the folder Dragon Drop keeps its settings in. Open Claude Code from the Terminal tab in Dragon Drop instead.\r\npause\r\n`
    : `echo Starting Claude Code with the Dragon Drop map tools...\r\n"${exe}" --mcp-config "${mcpFile}"\r\n`;
  fs.writeFileSync(path.join(dir, "open-claude.cmd"), `@echo off\r\ntitle Claude Code - Dragon Drop\r\ncd /d "%~dp0"\r\n${body}`);
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

/** The start command trimmed, or null when it isn't acceptable: at most 500 characters, no control characters. Empty means Claude Code. */
function validTerminalCommand(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  return t.length <= 500 && !/[\x00-\x1f\x7f]/.test(t) ? t : null;
}

/** Run the saved start command (Claude Code when none) in a pseudo-terminal that the editor draws, with the map tools connected. */
function startTerminal({ cols, rows, resume }) {
  killTerminal();
  const custom = settings.terminalCommand || "";
  const claudePath = custom ? null : findClaude();
  const workspace = writeClaudeWorkspace(claudePath);
  if (!custom && !claudePath) return { ok: false, reason: "not-installed" };
  let file;
  let fileArgs;
  if (custom) {
    // the shell reads the text as typed (on Windows node-pty takes one command-line string)
    if (process.platform === "win32") { file = process.env.ComSpec || "cmd.exe"; fileArgs = '/s /c "' + custom + '"'; }
    else { file = process.env.SHELL || "/bin/sh"; fileArgs = ["-lc", custom]; }
  } else {
    const args = ["--mcp-config", mcpConfigFile()];
    if (resume) args.unshift("--continue");
    file = claudePath;
    fileArgs = args;
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(claudePath)) {
      file = process.env.ComSpec || "cmd.exe";
      fileArgs = ["/c", claudePath, ...args];
    }
  }
  try {
    // (the access key goes to the assistant in the environment: its project file names the variable, so the file in the workspace doesn't hold the key)
    // (the map tools key: with it the assistant's map tools and hooks work, but it can't drive the editor's connection, where the Allow box is answered)
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", [assistants.KEY_ENV]: settings.toolsToken };
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
      // a killed Claude may never send its own SessionEnd, and a stale "idle" would let Assist type into the next program
      void fetch(`http://127.0.0.1:${port}${HOOK_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.accessToken}` }, body: JSON.stringify({ hook_event_name: "SessionEnd" }) }).catch(() => {});
      sendToEditor("dd:term-exit", exitCode);
    });
    return { ok: true, workspace, claudePath, command: custom };
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
/**
 * "The move" (docs/GOING-PRIVATE.md): the address of Dragon Drop's new store page, set in the last release made while the code repository is
 * public. A copy from the GitHub release page then stops asking GitHub (which will be private) and Settings → Updates says where Dragon Drop
 * is now, with a link; the copy keeps working as it is. Empty: not moved. (A development run can try it with DRAGON_DROP_MOVED_TO.)
 */
const MOVED_TO = "";
const movedTo = () => {
  const url = MOVED_TO || (!app.isPackaged && process.env.DRAGON_DROP_MOVED_TO) || "";
  return /^https:\/\/\S+$/.test(url) ? url : "";
};

let autoUpdater = null;
let updateState = { status: "idle", version: null, message: "", channel: CHANNEL };

function setUpdate(patch) {
  updateState = { ...updateState, ...patch };
}

function setupUpdater() {
  if (CHANNEL === "itch") { setUpdate({ status: "unavailable", message: "This copy is updated by the itch app, not by Dragon Drop." }); return; } // (electron-updater is never even loaded)
  if (movedTo()) {
    setUpdate({ status: "moved", movedTo: movedTo(), message: "Dragon Drop has moved: new versions come from its new page. This copy keeps working as it is, and your maps stay where they are." });
    return;
  }
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
// (only the editor's own pages: a picture or file the server sends is never a page that can reach this bridge, see http.ts sendStored)
const fromEditor = (e) => !!win && e.senderFrame && e.senderFrame.url.startsWith(`${editorOrigin()}/`) && !/^\/api\//.test(new URL(e.senderFrame.url).pathname);

ipcMain.on("dd:version", (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle("dd:settings", (e) => {
  if (!fromEditor(e)) return null;
  return {
    version: app.getVersion(), projectsDir: settings.projectsDir, hasApiKey: !!getApiKey(), port, defaultPort: DEFAULT_PORT, autoUpdate: settings.autoUpdate !== false, assetsDir: settings.assetsDir || null,
    mcpUrl: assistants.mcpAddress(port, settings.toolSet),
    // the line for connecting Claude Code from the user's own terminal: with the access key to copy, and the same line with the key hidden to show
    mcpCommand: `claude mcp add --transport http --scope user mapmaker ${assistants.mcpAddress(port, settings.toolSet)} --header "Authorization: Bearer ${settings.toolsToken}"`,
    mcpCommandShown: `claude mcp add --transport http --scope user mapmaker ${assistants.mcpAddress(port, settings.toolSet)} --header "Authorization: Bearer (your map tools key)"`,
    logDir: path.dirname(logFile()), encrypted: safeStorage.isEncryptionAvailable(),
    mcpHeader: `Authorization: Bearer ${settings.toolsToken}`, // other assistants send this with every request to the map tools (the map tools key)
    phoneKey: settings.accessToken, // (the phone link: the phone page is an editor, so it needs the access key itself)
    terminalCommand: settings.terminalCommand || "",
    // all the map tools, or the smaller set for smaller models (tools essentials.ts)
    toolSet: settings.toolSet === "essentials" ? "essentials" : "all",
    // the phone page's address, "" while it is off
    phoneHost: settings.phoneHost || "",
    // whether the chosen assistant finds the map tools by itself, and what it needs from the person (Settings shows it)
    assistant: assistants.describe(assistants.profileFor(settings.terminalCommand)),
  };
});
ipcMain.handle("dd:set-terminal-command", (e, text) => {
  if (!fromEditor(e)) return { ok: false, command: "" };
  const cmd = validTerminalCommand(text);
  if (cmd === null) return { ok: false, command: settings.terminalCommand || "" };
  if (cmd !== (settings.terminalCommand || "")) {
    if (cmd) settings.terminalCommand = cmd; else delete settings.terminalCommand;
    saveSettings();
    const wasAlive = termAlive;
    killTerminal();
    // with no terminal alive (Claude Code missing, or an error screen) nothing else tells the panel to re-read the command
    if (!wasAlive) sendToEditor("dd:term-exit", 0);
  }
  return { ok: true, command: cmd };
});
// which map tools the assistant is shown: a change rewrites its files and ends the running terminal, so the assistant starts again with the new list
ipcMain.handle("dd:set-tool-set", (e, set) => {
  if (!fromEditor(e)) return "all";
  const next = set === "essentials" ? "essentials" : "all";
  if (next !== (settings.toolSet === "essentials" ? "essentials" : "all")) {
    if (next === "essentials") settings.toolSet = "essentials"; else delete settings.toolSet;
    saveSettings();
    const wasAlive = termAlive;
    killTerminal();
    if (!wasAlive) sendToEditor("dd:term-exit", 0);
  }
  return next;
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
  const r = await dialog.showOpenDialog(win, { title: "Choose your assets folder (folders of pictures, .zip files or asset packs)", properties: ["openDirectory"] });
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
// a map's backups folder (copies kept before a migration, removed pictures), or the map's own folder while it has none; only inside the maps folder
ipcMain.handle("dd:open-backups", (e, id) => {
  if (!fromEditor(e) || typeof id !== "string" || !/^[a-z0-9-]{1,80}$/.test(id)) return { ok: false, opened: null };
  const dir = path.join(settings.projectsDir, id);
  if (!fs.existsSync(path.join(dir, "project.json"))) return { ok: false, opened: null };
  const backups = path.join(dir, "backups");
  const has = fs.existsSync(backups);
  void shell.openPath(has ? backups : dir);
  return { ok: true, opened: has ? "backups" : "map" };
});
// the phone page's address (the PC's Tailscale name), or "" for off; the server starts again with it
ipcMain.handle("dd:set-phone-host", async (e, text) => {
  if (!fromEditor(e)) return settings.phoneHost || "";
  const host = String(text ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (host && !/^[a-z0-9][a-z0-9.-]{0,250}$/.test(host)) return settings.phoneHost || "";
  if (host === (settings.phoneHost || "")) return host;
  if (host) settings.phoneHost = host; else delete settings.phoneHost;
  saveSettings();
  await restartServer();
  return host;
});
// a new access key (Settings): the old one stops working everywhere (a lost phone, a link sent to the wrong place); the server starts again with it,
// the window gets its new cookie, and the assistant's files are written again with it
ipcMain.handle("dd:new-access-key", async (e) => {
  if (!fromEditor(e)) return false;
  settings.accessToken = crypto.randomBytes(32).toString("hex");
  settings.toolsToken = crypto.randomBytes(32).toString("hex");
  saveSettings();
  killTerminal();
  const ok = await restartServer();
  try { writeClaudeWorkspace(findClaude()); } catch { /* written again when the terminal starts */ }
  return ok;
});
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
ipcMain.handle("dd:term-attach", (e) => (fromEditor(e) ? { alive: termAlive, buffer: termBuf, command: settings.terminalCommand || "" } : { alive: false, buffer: "", command: "" }));
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
// the open-source licences of everything bundled: also in Settings, because the window's own title bar hides the Help menu on Windows
ipcMain.handle("dd:open-licences", (e) => {
  if (!fromEditor(e)) return { ok: false };
  if (!fs.existsSync(noticesFile())) return { ok: false };
  void shell.openPath(noticesFile());
  return { ok: true };
});

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
  // the AI assistant tab, further down (the map tools key and its note)
  await win.webContents.executeJavaScript(`document.querySelector('[data-testid="mcp-key-note"]')?.scrollIntoView({ block: "center" })`);
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(`${base}-settings-assistant.png`, (await win.webContents.capturePage()).toPNG());
  // every other tab
  for (const tab of ["maps", "phone", "help"]) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-tab-${tab}"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(`${base}-settings-${tab}.png`, (await win.webContents.capturePage()).toPNG());
  }
  // (nothing in the Settings dialog may be wider than it: a sideways scrollbar there once hid the start of every line)
  const wideBy = () => win.webContents.executeJavaScript(`Math.max(...['desktop-settings', 'settings-body'].map((id) => { const m = document.querySelector('[data-testid="' + id + '"]'); return m ? m.scrollWidth - m.clientWidth : 0; }))`);
  if (await wideBy() > 1) console.warn(`The Settings dialog is ${await wideBy()} px wider than its window: something in it doesn't wrap.`);
  // and the window at its narrowest, with Settings open and then closed
  const [w0, h0] = win.getSize();
  win.setSize(1, h0);
  await win.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-tab-ai"]')?.click()`);
  await new Promise((r) => setTimeout(r, 800));
  fs.writeFileSync(`${base}-narrow-settings.png`, (await win.webContents.capturePage()).toPNG());
  if (await wideBy() > 1) console.warn(`In the narrowest window the Settings dialog is ${await wideBy()} px wider than its window.`);
  await win.webContents.executeJavaScript(`document.querySelector('.modal-back')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(`${base}-narrow-main.png`, (await win.webContents.capturePage()).toPNG());
  const spill = await win.webContents.executeJavaScript(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  if (spill > 1) console.warn(`In the narrowest window the page is ${spill} px wider than the window.`);
  win.setSize(w0, h0);
}

async function smokeTest() {
  const deadline = Date.now() + 60000;
  const check = () => win.webContents.executeJavaScript(`({
    connected: document.body.innerText.includes("Connected"),
    bridge: !!(window.dragonDrop && window.dragonDrop.version && typeof window.dragonDrop.openLicences === "function"),
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
        if (app.isPackaged) {
          win.webContents.openDevTools();
          await new Promise((r) => setTimeout(r, 300));
          if (win.webContents.isDevToolsOpened()) return fatal("the installed app opened the developer tools");
        }
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
        // the map tools key opens the map tools and nothing else (not the API, not the editor's connection, where the Allow box is answered)
        const toolsAuth = { authorization: `Bearer ${settings.toolsToken}` };
        const toolsApi = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: toolsAuth }).catch(() => null);
        if (!toolsApi || toolsApi.status !== 401) return fatal(`the map tools key opened the API (${toolsApi ? toolsApi.status : "no answer"})`);
        const toolsMcp = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: toolsAuth }).catch(() => null);
        if (!toolsMcp || toolsMcp.status !== 405) return fatal(`the map tools key didn't reach the map tools (${toolsMcp ? toolsMcp.status : "no answer"})`);
        if (here.includes("t=")) return fatal(`the access key was left in the window's address: ${here}`);
        if (!here.startsWith(`http://127.0.0.1:${port}/`)) return fatal(`the window isn't on the IPv4 address (a "localhost" one goes to IPv6 first): ${here}`);
        const page = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
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
        // any start command can run in the panel: a multi-line one is refused, a one-line one runs through the shell, and clearing it goes back to Claude Code
        const badCmd = await win.webContents.executeJavaScript(`window.dragonDrop.setTerminalCommand("echo a\\necho b")`);
        if (!badCmd || badCmd.ok !== false) return fatal(`a multi-line start command was accepted: ${JSON.stringify(badCmd)}`);
        const setCmd = await win.webContents.executeJavaScript(`window.dragonDrop.setTerminalCommand("echo DD_CUSTOM_OK")`);
        if (!setCmd || setCmd.ok !== true || setCmd.command !== "echo DD_CUSTOM_OK") return fatal(`setTerminalCommand returned ${JSON.stringify(setCmd)}`);
        const custom = await win.webContents.executeJavaScript(`window.dragonDrop.termStart({ cols: 80, rows: 24 })`);
        if (!custom || custom.ok !== true || custom.command !== "echo DD_CUSTOM_OK") return fatal(`termStart with a custom command returned ${JSON.stringify(custom)}`);
        let customBuf = "";
        for (let i = 0; i < 40 && !customBuf.includes("DD_CUSTOM_OK"); i++) {
          customBuf = (await win.webContents.executeJavaScript(`window.dragonDrop.termAttach()`)).buffer || "";
          if (!customBuf.includes("DD_CUSTOM_OK")) await new Promise((r) => setTimeout(r, 500));
        }
        if (!customBuf.includes("DD_CUSTOM_OK")) return fatal(`the custom start command's output never showed: ${JSON.stringify(customBuf.slice(0, 200))}`);
        // a command that isn't a known assistant gets no config file; the known ones each get their own, and never the access key
        const wsDir = custom.workspace;
        const readWs = (rel) => { try { return fs.readFileSync(path.join(wsDir, rel), "utf8"); } catch { return null; } };
        for (const rel of [".mcp.json", ".codex/config.toml", ".gemini/settings.json", "opencode.json", ".agents/mcp_config.json"]) {
          if (readWs(rel) !== null) return fatal(`a start command that isn't a known assistant left ${rel} in the workspace`);
        }
        const url = `http://127.0.0.1:${port}/mcp`;
        for (const [cmd, rel] of [["ollama launch claude", ".mcp.json"], ["codex", ".codex/config.toml"], ["gemini", ".gemini/settings.json"], ["opencode", "opencode.json"]]) {
          const sc = await win.webContents.executeJavaScript(`window.dragonDrop.setTerminalCommand(${JSON.stringify(cmd)})`);
          if (!sc || sc.ok !== true) return fatal(`setTerminalCommand(${cmd}) returned ${JSON.stringify(sc)}`);
          await win.webContents.executeJavaScript("window.dragonDrop.openClaude(false)"); // (writes the workspace files without starting anything)
          const text = readWs(rel);
          if (text === null || !text.includes(url)) return fatal(`with "${cmd}" chosen, ${rel} should carry the map tools: ${text}`);
          if (text.includes(settings.accessToken) || text.includes(settings.toolsToken)) return fatal(`with "${cmd}" chosen, ${rel} holds a key`);
          for (const other of [".mcp.json", ".codex/config.toml", ".gemini/settings.json", "opencode.json", ".agents/mcp_config.json"]) {
            if (other !== rel && readWs(other) !== null) return fatal(`with "${cmd}" chosen, ${other} is still in the workspace`);
          }
        }
        // the smaller set of map tools: the chosen assistant's file points at ?tools=essentials, and back again
        if ((await win.webContents.executeJavaScript(`window.dragonDrop.setToolSet("essentials")`)) !== "essentials") return fatal("setToolSet(essentials) was refused");
        await win.webContents.executeJavaScript("window.dragonDrop.openClaude(false)");
        // (OpenCode is the assistant chosen last above)
        if (!(readWs("opencode.json") || "").includes(`${url}?tools=essentials`)) return fatal("with the smaller tool set chosen, the assistant's file doesn't point at it");
        if ((await win.webContents.executeJavaScript(`window.dragonDrop.setToolSet("all")`)) !== "all") return fatal("setToolSet(all) was refused");
        await win.webContents.executeJavaScript("window.dragonDrop.openClaude(false)");
        const back = readWs("opencode.json") || "";
        if (!back.includes(url) || back.includes("?tools=")) return fatal("back to all the tools, the assistant's file doesn't point at all of them");
        // a map's backups folder: only an id of a map in the maps folder; and the phone page takes only a host name
        const badOpen = await win.webContents.executeJavaScript(`window.dragonDrop.openBackups("../x")`);
        if (!badOpen || badOpen.ok !== false) return fatal(`openBackups("../x") returned ${JSON.stringify(badOpen)}`);
        if ((await win.webContents.executeJavaScript(`window.dragonDrop.setPhoneHost("bad host/with spaces")`)) !== "") return fatal("setPhoneHost took a name with spaces");
        const enabledNow = (() => { try { return JSON.parse(readWs(".claude/settings.json")).enabledMcpjsonServers; } catch { return null; } })();
        if (enabledNow !== undefined && (!Array.isArray(enabledNow) || enabledNow.filter((s) => s === "mapmaker").length > 1)) return fatal(`enabledMcpjsonServers is wrong: ${JSON.stringify(enabledNow)}`);
        if (process.platform === "win32") {
          // a quoted program path plus a quoted argument must reach cmd.exe untouched (its legacy rule strips quotes without /s)
          const quoted = JSON.stringify(`"${process.env.ComSpec}" /c echo "DD_QUOTED_OK"`);
          const setQ = await win.webContents.executeJavaScript(`window.dragonDrop.setTerminalCommand(${quoted})`);
          if (!setQ || setQ.ok !== true) return fatal(`setTerminalCommand (quoted) returned ${JSON.stringify(setQ)}`);
          const qStart = await win.webContents.executeJavaScript(`window.dragonDrop.termStart({ cols: 80, rows: 24 })`);
          if (!qStart || qStart.ok !== true) return fatal(`termStart with a quoted command returned ${JSON.stringify(qStart)}`);
          let qBuf = "";
          for (let i = 0; i < 40 && !qBuf.includes("DD_QUOTED_OK"); i++) {
            qBuf = (await win.webContents.executeJavaScript(`window.dragonDrop.termAttach()`)).buffer || "";
            if (!qBuf.includes("DD_QUOTED_OK")) await new Promise((r) => setTimeout(r, 500));
          }
          if (!qBuf.includes("DD_QUOTED_OK")) return fatal(`a quoted start command was mangled: ${JSON.stringify(qBuf.slice(0, 300))}`);
        }
        const clearCmd = await win.webContents.executeJavaScript(`window.dragonDrop.setTerminalCommand("")`);
        if (!clearCmd || clearCmd.ok !== true) return fatal(`clearing the start command returned ${JSON.stringify(clearCmd)}`);
        const cl = await win.webContents.executeJavaScript("window.dragonDrop.openClaude(false)");
        if (!cl || !cl.workspace) return fatal(`openClaude returned ${JSON.stringify(cl)}`);
        const mcp = (() => { try { return fs.readFileSync(mcpConfigFile(), "utf8"); } catch { return ""; } })();
        if (!mcp.includes(`http://127.0.0.1:${port}/mcp`)) return fatal(`the map tools file is wrong: ${mcp}`);
        if (!mcp.includes(`Bearer ${settings.toolsToken}`) || mcp.includes(settings.accessToken)) return fatal("the map tools file should hold the map tools key and never the access key");
        // (the Documents workspace is often synced to the cloud: no file in it may hold the access key)
        const holders = [];
        const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) scan(f); else if (fs.readFileSync(f, "utf8").includes(settings.accessToken) || fs.readFileSync(f, "utf8").includes(settings.toolsToken)) holders.push(f); } };
        scan(cl.workspace);
        if (holders.length) return fatal(`the access key is in the Claude workspace: ${holders.join(", ")}`);
        for (const f of ["CLAUDE.md", "AGENTS.md", "GEMINI.md", "open-claude.cmd", path.join(".claude", "settings.json")]) {
          if (!fs.existsSync(path.join(cl.workspace, f))) return fatal(`Claude workspace is missing ${f}`);
        }
        // the default assistant: Claude Code in the panel is handed the map tools with --mcp-config, so there is no .mcp.json (a second definition could ask for approval)
        if (fs.existsSync(path.join(cl.workspace, ".mcp.json"))) return fatal("with the default assistant chosen there should be no .mcp.json in the Claude workspace");
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
