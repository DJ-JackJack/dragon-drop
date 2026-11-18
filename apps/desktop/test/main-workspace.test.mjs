// main.cjs only runs inside Electron, which CI exercises on Windows. This runs the parts that write the settings, the access key and the Claude workspace
// in plain Node, with a stand-in for the `electron` module, so a mistake in them (a typo, a variable used before it is set) fails here in seconds
// instead of at the end of a Windows build.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const mainFile = path.resolve(here, "../main.cjs");

/** Load main.cjs with a fake electron and hand back some of its functions. */
function loadMain(userData, documents) {
  const handlers = new Map();
  // (anything the stand-in doesn't define is a function that does nothing)
  const lenient = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : () => undefined) });
  const app = lenient({
    isPackaged: false, getPath: (n) => (n === "documents" ? documents : n === "userData" ? userData : os.tmpdir()), setPath() {},
    whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => "0.0.0-test", getName: () => "Dragon Drop",
    commandLine: { appendSwitch() {} }, setAppUserModelId() {}, disableHardwareAcceleration() {},
  });
  const electron = {
    app, BrowserWindow: class { static getAllWindows() { return []; } }, Menu: { setApplicationMenu() {}, buildFromTemplate: (t) => t }, dialog: {},
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openPath() {}, openExternal() {} },
    nativeImage: { createFromPath: () => ({}) }, session: {}, screen: {}, Tray: class {},
  };
  const req = createRequire(mainFile);
  const fakeRequire = (id) => (id === "electron" ? electron : req(id));
  const src = `${readFileSync(mainFile, "utf8")}\n;globalThis.__main = { loadSettings, writeClaudeWorkspace, hookCommand, editorUrl, getSettings: () => settings, setPort: (p) => { port = p; } };`;
  const sandbox = { require: fakeRequire, module: { exports: {} }, exports: {}, process, console, __dirname: path.dirname(mainFile), __filename: mainFile, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, URL, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`(function (require, module, exports, __dirname, __filename) {\n${src}\n}).call(this, require, module, exports, __dirname, __filename)`, sandbox, { filename: mainFile });
  return { main: sandbox.__main, handlers };
}

describe("the Windows app's settings and Claude workspace (main.cjs, without Electron)", () => {
  it("makes an access key once, keeps it, and writes it into the map tools' config, the hook command and the window's address", () => {
    const userData = mkdtempSync(path.join(os.tmpdir(), "dd-user-")), documents = mkdtempSync(path.join(os.tmpdir(), "dd-docs-"));
    const { main } = loadMain(userData, documents);
    main.loadSettings();
    const key = main.getSettings().accessToken;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // a second start reads the same key back from the settings file
    const again = loadMain(userData, documents).main;
    again.loadSettings();
    expect(again.getSettings().accessToken).toBe(key);

    main.setPort(4747);
    expect(main.editorUrl()).toBe(`http://localhost:4747/?t=${key}`);
    expect(main.hookCommand()).toContain(`Authorization: Bearer ${key}`);
    expect(main.hookCommand()).toContain("http://127.0.0.1:4747/api/claude-hook");

    main.writeClaudeWorkspace(null); // (this is the function that failed on Windows when a local variable hid `settings`)
    const dir = path.join(documents, "Dragon Drop", "Claude");
    const mcp = JSON.parse(readFileSync(path.join(dir, "mapmaker.mcp.json"), "utf8"));
    expect(mcp.mcpServers.mapmaker.url).toBe("http://127.0.0.1:4747/mcp");
    expect(mcp.mcpServers.mapmaker.headers.Authorization).toBe(`Bearer ${key}`);
    const cfg = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    for (const ev of ["SessionStart", "UserPromptSubmit", "Stop", "Notification", "SessionEnd"]) expect(JSON.stringify(cfg.hooks[ev])).toContain(`Bearer ${key}`);
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toContain("list_grounds");

    // the user's own Claude settings are kept, and the hooks are rewritten (not duplicated) on the next start
    const mine = { ...cfg, model: "keep-me" };
    writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify(mine));
    main.writeClaudeWorkspace(null);
    const after = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    expect(after.model).toBe("keep-me");
    expect(after.hooks.Stop).toHaveLength(1);
  });

  it("replaces a short or missing key in an old settings file with a new strong one", () => {
    const userData = mkdtempSync(path.join(os.tmpdir(), "dd-user-")), documents = mkdtempSync(path.join(os.tmpdir(), "dd-docs-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ projectsDir: "C:\\maps", accessToken: "short" }));
    const { main } = loadMain(userData, documents);
    main.loadSettings();
    expect(main.getSettings().accessToken).toMatch(/^[0-9a-f]{64}$/);
    expect(main.getSettings().projectsDir).toBe("C:\\maps"); // (the rest of the old settings stays)
  });
});
