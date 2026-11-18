// main.cjs only runs inside Electron, which CI exercises on Windows. This runs the parts that write the settings, the access key and the Claude workspace
// in plain Node, with a stand-in for the `electron` module, so a mistake in them (a typo, a variable used before it is set) fails here in seconds
// instead of at the end of a Windows build.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  describe("the map tools for other assistants (.mcp.json): written only while another assistant is chosen", () => {
    const setup = () => {
      const userData = mkdtempSync(path.join(os.tmpdir(), "dd-user-")), documents = mkdtempSync(path.join(os.tmpdir(), "dd-docs-"));
      const { main } = loadMain(userData, documents);
      main.loadSettings();
      main.setPort(4747);
      const dir = path.join(documents, "Dragon Drop", "Claude");
      const mcpFile = path.join(dir, ".mcp.json"), settingsFile = path.join(dir, ".claude", "settings.json");
      const write = () => main.writeClaudeWorkspace(null);
      const claudeSettings = () => JSON.parse(readFileSync(settingsFile, "utf8"));
      return { main, dir, mcpFile, write, claudeSettings, key: main.getSettings().accessToken };
    };

    it("leaves Claude Code in the panel exactly as it was: no .mcp.json and no pre-approval, so it cannot be asked to approve a second definition", () => {
      const { write, mcpFile, claudeSettings, dir } = setup();
      write();
      expect(existsSync(mcpFile)).toBe(false);
      expect(claudeSettings().enabledMcpjsonServers).toBeUndefined();
      expect(existsSync(path.join(dir, "mapmaker.mcp.json"))).toBe(true); // (what --mcp-config is given)
      expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(true);
    });

    it("adds the map tools and approves them while another assistant is chosen, once however often it starts", () => {
      const { main, write, mcpFile, claudeSettings, key } = setup();
      main.getSettings().terminalCommand = "ollama launch claude";
      write(); write();
      const mcp = JSON.parse(readFileSync(mcpFile, "utf8"));
      expect(mcp.mcpServers.mapmaker).toEqual({ type: "http", url: "http://127.0.0.1:4747/mcp", headers: { Authorization: `Bearer ${key}` } });
      expect(claudeSettings().enabledMcpjsonServers).toEqual(["mapmaker"]);
    });

    it("follows a changed port, and takes our entry out again when the default is back (the file goes with it)", () => {
      const { main, write, mcpFile } = setup();
      main.getSettings().terminalCommand = "codex";
      write();
      main.setPort(4800);
      write();
      expect(JSON.parse(readFileSync(mcpFile, "utf8")).mcpServers.mapmaker.url).toBe("http://127.0.0.1:4800/mcp");
      main.getSettings().terminalCommand = "";
      write();
      expect(existsSync(mcpFile)).toBe(false);
      write(); // (and again with nothing to remove)
      expect(existsSync(mcpFile)).toBe(false);
    });

    it("keeps whatever else the person put in .mcp.json, in both modes", () => {
      const { main, write, mcpFile } = setup();
      write(); // makes the folder
      writeFileSync(mcpFile, JSON.stringify({ mcpServers: { github: { type: "http", url: "https://example.com/mcp" } }, other: 1 }));
      main.getSettings().terminalCommand = "gemini";
      write();
      const both = JSON.parse(readFileSync(mcpFile, "utf8"));
      expect(Object.keys(both.mcpServers).sort()).toEqual(["github", "mapmaker"]);
      expect(both.other).toBe(1);
      main.getSettings().terminalCommand = "";
      write();
      const left = JSON.parse(readFileSync(mcpFile, "utf8"));
      expect(left).toEqual({ mcpServers: { github: { type: "http", url: "https://example.com/mcp" } }, other: 1 });
    });

    it("leaves a .mcp.json that is not valid JSON alone, and a \"mapmaker\" entry that points somewhere else", () => {
      const { main, write, mcpFile } = setup();
      write();
      writeFileSync(mcpFile, "{ not json");
      main.getSettings().terminalCommand = "opencode";
      write();
      expect(readFileSync(mcpFile, "utf8")).toBe("{ not json");
      main.getSettings().terminalCommand = "";
      write();
      expect(readFileSync(mcpFile, "utf8")).toBe("{ not json");
      const theirs = JSON.stringify({ mcpServers: { mapmaker: { type: "http", url: "https://my-own-server.example/mcp" } } });
      writeFileSync(mcpFile, theirs);
      write();
      expect(readFileSync(mcpFile, "utf8")).toBe(theirs);
    });

    it("does not add the pre-approval to the person's own Claude settings for the default, and keeps what they have for another assistant", () => {
      const { main, write, dir, claudeSettings } = setup();
      write();
      writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ ...claudeSettings(), enabledMcpjsonServers: ["theirs"], model: "keep-me" }));
      write();
      expect(claudeSettings().enabledMcpjsonServers).toEqual(["theirs"]);
      main.getSettings().terminalCommand = "codex";
      write();
      expect(claudeSettings().enabledMcpjsonServers).toEqual(["theirs", "mapmaker"]);
      expect(claudeSettings().model).toBe("keep-me");
    });
  });
});
