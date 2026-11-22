// What each terminal assistant needs to find the map tools: which assistant a start command is, and the files written for it (see assistants.cjs).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { ASSISTANTS, KEY_ENV, describe: describeAssistant, profileFor, syncAssistantConfigs } = require("../assistants.cjs");

const KEY = "k".repeat(64);
const URL4747 = "http://127.0.0.1:4747/mcp";
const folder = () => mkdtempSync(path.join(os.tmpdir(), "dd-assist-"));
const sync = (dir, profile, port = 4747) => syncAssistantConfigs(dir, { profile, port, key: KEY });
const read = (dir, ...p) => readFileSync(path.join(dir, ...p), "utf8");
const json = (dir, ...p) => JSON.parse(read(dir, ...p));
const put = (dir, rel, text) => { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, typeof text === "string" ? text : JSON.stringify(text)); };
/** Every file under a folder, as relative paths. */
const files = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).replace(/\\/g, "/")]));

describe("which assistant a start command runs", () => {
  it("knows the programs by name, with or without a folder, extension or arguments, and `ollama launch`", () => {
    expect(profileFor("")).toBe("default");
    expect(profileFor("   ")).toBe("default");
    expect(profileFor("claude")).toBe("claude");
    expect(profileFor("claude --model opus")).toBe("claude");
    expect(profileFor("codex")).toBe("codex");
    expect(profileFor('"C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd" --full-auto')).toBe("codex");
    expect(profileFor("gemini")).toBe("gemini");
    expect(profileFor("opencode")).toBe("opencode");
    expect(profileFor("OpenCode.exe")).toBe("opencode");
    expect(profileFor("muse")).toBe("muse");
    expect(profileFor('"C:\\Users\\me\\AppData\\Local\\Programs\\muse\\muse.cmd" --effort high')).toBe("muse");
    expect(profileFor("ollama launch claude")).toBe("claude");
    expect(profileFor("ollama launch codex")).toBe("codex");
    expect(profileFor("ollama launch opencode")).toBe("opencode");
  });

  it("the Settings choices (with what each assistant needs) and the assistants connected here are the same list", async () => {
    const { ASSISTANT_PRESETS } = await import("../../editor/src/assistantPresets.ts");
    const covered = new Set();
    for (const [label, command, needs] of ASSISTANT_PRESETS) {
      const p = profileFor(command);
      expect(p === "default" || (p !== null && describeAssistant(p).auto),`${label}: "${command}" isn't an assistant Dragon Drop connects`).toBe(true);
      expect(needs.length, `${label} says what it needs`).toBeGreaterThan(40);
      covered.add(p === "default" ? "claude" : p);
    }
    for (const id of Object.keys(ASSISTANTS)) expect(covered.has(id), `${id} has a choice in Settings`).toBe(true);
  });

  it("says null for anything else, so nothing is written and the person adds the map tools themselves", () => {
    for (const c of ["npx something", "ollama run llama3", "ollama launch other", "python -m foo", "echo codex", "constructor", "toString"]) expect(profileFor(c)).toBeNull();
    // Antigravity is no longer connected (Google's terms forbid its use with other companies' products): it is a command like any other
    for (const c of ["agy", "antigravity", "C:\\Tools\\agy.exe --print"]) expect(profileFor(c)).toBeNull();
  });
});

describe("the files written for each assistant", () => {
  it("Claude Code (typed, or through ollama): .mcp.json, with the key as a variable", () => {
    const dir = folder();
    const r = sync(dir, "claude");
    expect(r).toMatchObject({ assistant: "claude", name: "Claude Code", auto: true, file: ".mcp.json" });
    expect(json(dir, ".mcp.json").mcpServers.mapmaker).toEqual({ type: "http", url: URL4747, headers: { Authorization: "Bearer ${" + KEY_ENV + "}" } });
  });

  it("Codex: a marked block in .codex/config.toml naming the variable that holds the key", () => {
    const dir = folder();
    const r = sync(dir, "codex");
    expect(r).toMatchObject({ assistant: "codex", name: "Codex", auto: true, file: path.join(".codex", "config.toml") });
    expect(r.hint).toMatch(/trust/);
    const toml = read(dir, ".codex", "config.toml");
    expect(toml).toContain("[mcp_servers.mapmaker]");
    expect(toml).toContain(`url = "${URL4747}"`);
    expect(toml).toContain(`bearer_token_env_var = "${KEY_ENV}"`);
  });

  it("Gemini CLI: .gemini/settings.json with an httpUrl entry and the key as a variable", () => {
    const dir = folder();
    sync(dir, "gemini");
    expect(json(dir, ".gemini", "settings.json").mcpServers.mapmaker).toEqual({ httpUrl: URL4747, headers: { Authorization: "Bearer $" + KEY_ENV } });
  });

  it("OpenCode: opencode.json with a remote entry and the key as a variable", () => {
    const dir = folder();
    sync(dir, "opencode");
    expect(json(dir, "opencode.json").mcp.mapmaker).toEqual({ type: "remote", url: URL4747, oauth: false, headers: { Authorization: "Bearer {env:" + KEY_ENV + "}" } });
  });

  it("Muse Code: Claude Code's .mcp.json (Muse reads it), the same entry, and a note about trusting the folder", () => {
    const dir = folder();
    const r = sync(dir, "muse");
    expect(r).toMatchObject({ assistant: "muse", name: "Muse Code", auto: true, file: ".mcp.json" });
    expect(r.hint).toMatch(/trust/);
    expect(files(dir)).toEqual([".mcp.json"]);
    expect(json(dir, ".mcp.json").mcpServers.mapmaker).toEqual({ type: "http", url: URL4747, headers: { Authorization: "Bearer ${" + KEY_ENV + "}" } });
  });

  it("Antigravity's file from an earlier version (it held the key) loses our entry, whatever is chosen, and keeps the person's own", () => {
    for (const p of ["default", "claude", null]) {
      const dir = folder();
      put(dir, ".agents/mcp_config.json", { mcpServers: { mapmaker: { serverUrl: URL4747, headers: { Authorization: `Bearer ${KEY}` } }, theirs: { serverUrl: "https://example.test/mcp" } } });
      sync(dir, p);
      expect(json(dir, ".agents", "mcp_config.json"), String(p)).toEqual({ mcpServers: { theirs: { serverUrl: "https://example.test/mcp" } } });
      expect(read(dir, ".agents", "mcp_config.json")).not.toContain(KEY);
    }
    const alone = folder();
    put(alone, ".agents/mcp_config.json", { mcpServers: { mapmaker: { serverUrl: URL4747, headers: { Authorization: `Bearer ${KEY}` } } } });
    sync(alone, profileFor("agy"));
    expect(files(alone)).toEqual([]); // (only ours was in it: the file and its folder go)
  });

  it("the key is in no file for any assistant", () => {
    for (const p of ["default", "claude", "codex", "gemini", "opencode", "muse"]) {
      const dir = folder();
      sync(dir, p);
      for (const f of files(dir)) expect(read(dir, f), `${p}: ${f}`).not.toContain(KEY);
    }
  });

  it("the default Claude Code and a command we don't know get no file at all", () => {
    for (const p of ["default", null]) {
      const dir = folder();
      const r = sync(dir, p);
      expect(files(dir)).toEqual([]);
      expect(r.auto).toBe(false);
    }
  });

  it("follows a changed port", () => {
    const dir = folder();
    sync(dir, "gemini", 4747);
    sync(dir, "gemini", 4800);
    expect(json(dir, ".gemini", "settings.json").mcpServers.mapmaker.httpUrl).toBe("http://127.0.0.1:4800/mcp");
  });
});

describe("switching assistants", () => {
  it("takes our entry out of every other assistant's file, and the files and folders that then hold nothing", () => {
    const dir = folder();
    for (const p of ["claude", "codex", "muse", "gemini", "opencode"]) {
      sync(dir, p);
      const here = files(dir);
      // only the chosen assistant's file is there
      expect(here).toHaveLength(1);
    }
    sync(dir, "default");
    expect(files(dir)).toEqual([]);
    expect(existsSync(path.join(dir, ".agents"))).toBe(false);
    expect(existsSync(path.join(dir, ".gemini"))).toBe(false);
    expect(existsSync(path.join(dir, ".codex"))).toBe(false);
  });

  it("Claude Code and Muse Code share .mcp.json: going from one to the other keeps the entry, going elsewhere takes it out", () => {
    const dir = folder();
    sync(dir, "claude");
    sync(dir, "muse");
    expect(files(dir)).toEqual([".mcp.json"]);
    expect(json(dir, ".mcp.json").mcpServers.mapmaker.url).toBe(URL4747);
    sync(dir, "claude", 4800);
    expect(json(dir, ".mcp.json").mcpServers.mapmaker.url).toBe("http://127.0.0.1:4800/mcp");
    sync(dir, "muse");
    sync(dir, "codex");
    expect(files(dir)).toEqual([".codex/config.toml"]);
  });
});

describe("what the person has put in those files", () => {
  it("is kept: other servers and other settings, while we add ours and when we take it out", () => {
    const dir = folder();
    put(dir, ".gemini/settings.json", { theme: "dark", mcpServers: { github: { httpUrl: "https://example.com/mcp" } } });
    sync(dir, "gemini");
    const both = json(dir, ".gemini", "settings.json");
    expect(Object.keys(both.mcpServers).sort()).toEqual(["github", "mapmaker"]);
    expect(both.theme).toBe("dark");
    sync(dir, "default");
    expect(json(dir, ".gemini", "settings.json")).toEqual({ theme: "dark", mcpServers: { github: { httpUrl: "https://example.com/mcp" } } });
  });

  it("is kept in opencode.json too, below the nested object", () => {
    const dir = folder();
    put(dir, "opencode.json", { model: "x/y", mcp: { other: { type: "local", command: ["a"] } } });
    sync(dir, "opencode");
    expect(Object.keys(json(dir, "opencode.json").mcp).sort()).toEqual(["mapmaker", "other"]);
    sync(dir, "codex");
    expect(json(dir, "opencode.json")).toEqual({ model: "x/y", mcp: { other: { type: "local", command: ["a"] } } });
  });

  it("a file that isn't valid JSON, or has an unexpected shape, is left exactly as it is", () => {
    const dir = folder();
    put(dir, ".mcp.json", "{ not json");
    put(dir, ".gemini/settings.json", { mcpServers: ["not", "an", "object"] });
    put(dir, "opencode.json", [1, 2]);
    sync(dir, "claude");
    sync(dir, "gemini");
    sync(dir, "opencode");
    expect(read(dir, ".mcp.json")).toBe("{ not json");
    expect(json(dir, ".gemini", "settings.json")).toEqual({ mcpServers: ["not", "an", "object"] });
    expect(json(dir, "opencode.json")).toEqual([1, 2]);
    sync(dir, "default");
    expect(read(dir, ".mcp.json")).toBe("{ not json");
  });

  it("a mapmaker entry that points somewhere else is theirs: not removed", () => {
    const dir = folder();
    put(dir, ".mcp.json", { mcpServers: { mapmaker: { type: "http", url: "https://my-own-server.example/mcp" } } });
    sync(dir, "default");
    expect(json(dir, ".mcp.json").mcpServers.mapmaker.url).toBe("https://my-own-server.example/mcp");
  });

  it("Codex: text before and after our block is kept; the block is replaced, not repeated; it goes when the assistant changes", () => {
    const dir = folder();
    put(dir, ".codex/config.toml", 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n');
    sync(dir, "codex", 4747);
    sync(dir, "codex", 4800);
    sync(dir, "codex", 4800);
    const toml = read(dir, ".codex", "config.toml");
    expect(toml.match(/\[mcp_servers\.mapmaker\]/g)).toHaveLength(1);
    expect(toml).toContain("http://127.0.0.1:4800/mcp");
    expect(toml).not.toContain("4747");
    expect(toml.startsWith('model = "o3"')).toBe(true);
    expect(toml).toContain("[mcp_servers.other]");
    sync(dir, "default");
    expect(read(dir, ".codex", "config.toml").trim()).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"');
  });

  it("Codex: a mapmaker table the person wrote is left alone (a second one would break the file)", () => {
    const dir = folder();
    const own = '[mcp_servers.mapmaker]\nurl = "https://my-own-server.example/mcp"\n';
    put(dir, ".codex/config.toml", own);
    sync(dir, "codex");
    expect(read(dir, ".codex", "config.toml")).toBe(own);
    sync(dir, "default");
    expect(read(dir, ".codex", "config.toml")).toBe(own);
  });
});

describe("the assistant's name in the editor's words", () => {
  it("names every assistant Dragon Drop connects, and says \"the AI assistant\" for any other command", async () => {
    const { assistantNameFor } = await import("../../editor/src/assistantName.ts");
    for (const id of ["default", ...Object.keys(ASSISTANTS)]) expect(assistantNameFor(id), id).not.toBe("the AI assistant");
    expect(assistantNameFor("default")).toBe("Claude");
    expect(assistantNameFor("codex")).toBe("Codex");
    expect(assistantNameFor(null)).toBe("the AI assistant");
  });
  it("swaps Claude (never Claude Code) for the chosen name, with a capital where a sentence starts", async () => {
    const { forAssistant } = await import("../../editor/src/assistantName.ts");
    expect(forAssistant("Lock Claude's edits to this area", "Codex")).toBe("Lock Codex's edits to this area");
    expect(forAssistant("Claude can see this selection: say this.", "the AI assistant")).toBe("The AI assistant can see this selection: say this.");
    expect(forAssistant("Use the Place tool, or ask Claude, to add places.", "the AI assistant")).toBe("Use the Place tool, or ask the AI assistant, to add places.");
    expect(forAssistant("Start Claude Code first. Claude sees it.", "Gemini")).toBe("Start Claude Code first. Gemini sees it.");
    expect(forAssistant("Undo (Claude's edits too)", "the AI assistant")).toBe("Undo (the AI assistant's edits too)");
    expect(forAssistant("Lock Claude's edits", "Claude")).toBe("Lock Claude's edits");
  });
});

describe("the smaller set of map tools (for smaller models)", () => {
  it("points the chosen assistant at ?tools=essentials, and switching back or to another assistant replaces it", () => {
    const dir = folder();
    syncAssistantConfigs(dir, { profile: "gemini", port: 4747, key: KEY, tools: "essentials" });
    expect(json(dir, ".gemini", "settings.json").mcpServers.mapmaker.httpUrl).toBe(`${URL4747}?tools=essentials`);
    syncAssistantConfigs(dir, { profile: "gemini", port: 4747, key: KEY });
    expect(json(dir, ".gemini", "settings.json").mcpServers.mapmaker.httpUrl).toBe(URL4747);
    syncAssistantConfigs(dir, { profile: "codex", port: 4747, key: KEY, tools: "essentials" });
    expect(read(dir, ".codex", "config.toml")).toContain(`url = "${URL4747}?tools=essentials"`);
    // the essentials address is still recognised as ours: choosing another assistant takes it out of the others' files
    syncAssistantConfigs(dir, { profile: "opencode", port: 4747, key: KEY, tools: "essentials" });
    expect(existsSync(path.join(dir, ".codex", "config.toml")) ? read(dir, ".codex", "config.toml") : "").not.toContain("127.0.0.1");
    expect(json(dir, "opencode.json").mcp.mapmaker.url).toBe(`${URL4747}?tools=essentials`);
  });
});
