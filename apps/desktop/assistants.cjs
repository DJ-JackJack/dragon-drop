"use strict";
// How each terminal assistant finds the map tools, so choosing one in Settings is all it takes (the person still signs into the assistant itself).
//
// The Claude workspace folder (Documents\Dragon Drop\Claude) is where the assistant starts. Each assistant reads MCP servers from its own project file there,
// so for the one that is chosen this module writes the entry that points at this app's map tools, and it takes our entry out of every other assistant's file.
// Whatever else the person put in those files stays; a file that isn't valid is left alone; the entry is recognised as ours by its address (127.0.0.1, /mcp).
// Two assistants can read the same file: Muse Code reads Claude Code's .mcp.json (tried with Muse Code 1.4.25: in a folder it trusts, outside a git
// repository too, with the key from the environment), so that file's `users` are both.
//
// The access key is not written into those files where the assistant can read it from the environment instead: the terminal is started with it in
// DRAGON_DROP_KEY and the files name the variable. (Documents often syncs to the cloud, and the key should not travel with it.) Antigravity can't do that,
// so while it is chosen its file holds the key; it is removed again when another assistant is chosen.
//
// Pure Node (no Electron), so it is tested on its own: see test/assistants.test.mjs.
const fs = require("node:fs");
const path = require("node:path");

/** The environment variable the terminal is started with. */
const KEY_ENV = "DRAGON_DROP_KEY";
const SERVER = "mapmaker";
const OURS = /^http:\/\/127\.0\.0\.1:\d+\/mcp$/;

/** What we know of each assistant. `auto` is false for ones we can only describe. */
const ASSISTANTS = {
  claude: { name: "Claude Code" },
  codex: { name: "Codex", hint: "Codex asks once whether to trust the folder it starts in. Say yes, so it can read the map tools." },
  gemini: { name: "Gemini CLI" },
  antigravity: { name: "Antigravity CLI", hint: "Antigravity can't read the key from the environment, so its config file in your workspace folder holds the key while it is chosen." },
  opencode: { name: "OpenCode" },
  muse: { name: "Muse Code", hint: "Muse Code asks once whether to trust the folder it starts in. Say yes, so it can read the map tools." },
};

/** The program a command starts, lower case without its folder or extension: `"C:\Tools\codex.cmd" --x` is "codex". */
function programOf(word) {
  const w = String(word || "").replace(/^["']|["']$/g, "");
  return path.win32.basename(w).replace(/\.(cmd|exe|bat|ps1)$/i, "").toLowerCase();
}

function words(command) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const BY_PROGRAM = { claude: "claude", codex: "codex", gemini: "gemini", agy: "antigravity", antigravity: "antigravity", opencode: "opencode", muse: "muse" };

/**
 * Which assistant a start command runs: "default" for an empty command (Claude Code, started by Dragon Drop with the map tools given on its command line),
 * one of the keys of ASSISTANTS, or null for anything else. `ollama launch <x>` is the assistant <x>.
 */
function profileFor(command) {
  const t = String(command || "").trim();
  if (!t) return "default";
  const w = words(t);
  let prog = programOf(w[0]);
  if (prog === "ollama" && String(w[1]).toLowerCase() === "launch") prog = programOf(w[2]);
  return Object.prototype.hasOwnProperty.call(BY_PROGRAM, prog) ? BY_PROGRAM[prog] : null;
}

// ---------------------------------------------------------------- JSON files

const bearerVar = (open, close) => `Bearer ${open}${KEY_ENV}${close}`;

/** The JSON project files: where each assistant looks, the object our entry lives in, and what the entry says. `users` are the assistants that read it (its own key when missing). */
const JSON_TARGETS = {
  claude: {
    file: ".mcp.json", under: ["mcpServers"], users: ["claude", "muse"],
    entry: (url) => ({ type: "http", url, headers: { Authorization: bearerVar("${", "}") } }),
  },
  gemini: {
    file: path.join(".gemini", "settings.json"), under: ["mcpServers"],
    entry: (url) => ({ httpUrl: url, headers: { Authorization: bearerVar("$", "") } }),
  },
  antigravity: {
    file: path.join(".agents", "mcp_config.json"), under: ["mcpServers"], secret: true,
    entry: (url, key) => ({ serverUrl: url, headers: { Authorization: `Bearer ${key}` } }),
  },
  opencode: {
    file: "opencode.json", under: ["mcp"],
    entry: (url) => ({ type: "remote", url, oauth: false, headers: { Authorization: bearerVar("{env:", "}") } }),
  },
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isOurs = (e) => isObject(e) && [e.url, e.httpUrl, e.serverUrl].some((u) => typeof u === "string" && OURS.test(u));

/**
 * Put `entry` into (or, with null, take our entry out of) the object at `under` in a JSON file. Returns true when the file was left as the person had it.
 * Nothing is touched when the file isn't valid JSON or the shape isn't what we expect.
 */
function syncJson(file, under, entry, secret) {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (!e || e.code !== "ENOENT") return; }
  if (cfg !== null && !isObject(cfg)) return;
  const root = cfg ? { ...cfg } : {};
  // walk down to the object that holds the servers, copying as we go
  const chain = [root];
  for (const key of under) {
    const here = chain[chain.length - 1];
    if (here[key] !== undefined && !isObject(here[key])) return; // not the shape we know: not ours to touch
    if (here[key] === undefined) { if (!entry) return; here[key] = {}; } else here[key] = { ...here[key] };
    chain.push(here[key]);
  }
  const servers = chain[chain.length - 1];
  if (entry) {
    servers[SERVER] = entry;
  } else {
    if (!isOurs(servers[SERVER])) return; // (a "mapmaker" that points somewhere else is the person's)
    delete servers[SERVER];
    // tidy up what only we needed: an empty servers object, and the file if nothing else is in it
    for (let i = chain.length - 1; i > 0; i--) if (Object.keys(chain[i]).length === 0) delete chain[i - 1][under[i - 1]];
    if (Object.keys(root).length === 0) {
      try { fs.unlinkSync(file); fs.rmdirSync(path.dirname(file)); } catch { /* already gone, or the folder holds other things */ }
      return;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(root, null, 2), secret ? { mode: 0o600 } : undefined);
}

// ---------------------------------------------------------------- Codex (TOML)

const TOML_BEGIN = "# BEGIN Dragon Drop map tools (managed by Dragon Drop: edits between these lines are overwritten)";
const TOML_END = "# END Dragon Drop map tools";
const TOML_BLOCK = new RegExp(`\\r?\\n?${TOML_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${TOML_END}\\r?\\n?`, "g");

function syncCodex(file, url) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (!e || e.code !== "ENOENT") return; }
  const without = text.replace(TOML_BLOCK, "\n").replace(/^\n+/, "");
  if (url) {
    // a table of the same name written by the person would make the file invalid TOML if we added ours: leave it, they have set it up themselves
    if (/^\s*\[mcp_servers\.(mapmaker|"mapmaker")\]/m.test(without)) return;
    const block = `${TOML_BEGIN}\n[mcp_servers.${SERVER}]\nurl = "${url}"\nbearer_token_env_var = "${KEY_ENV}"\n${TOML_END}\n`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, without.trim() ? `${without.replace(/\s*$/, "")}\n\n${block}` : block);
    return;
  }
  if (without === text) return; // (nothing of ours in there)
  if (!without.trim()) { try { fs.unlinkSync(file); fs.rmdirSync(path.dirname(file)); } catch { /* gone, or other things in the folder */ } return; }
  fs.writeFileSync(file, without);
}

const known = (profile) => Object.prototype.hasOwnProperty.call(ASSISTANTS, profile);
/** Does the JSON target `id` belong to `profile`? */
const readsTarget = (id, profile) => (JSON_TARGETS[id].users || [id]).includes(profile);

/** What is known about `profile` (see profileFor), for Settings: { assistant, name, auto, file, hint }. `auto` means its project file is written for it. */
function describe(profile) {
  const a = known(profile) ? ASSISTANTS[profile] : null;
  const json = known(profile) ? Object.keys(JSON_TARGETS).find((id) => readsTarget(id, profile)) : undefined;
  const file = profile === "codex" ? path.join(".codex", "config.toml") : json ? JSON_TARGETS[json].file : null;
  return { assistant: profile, name: a ? a.name : null, auto: !!a, file, hint: a && a.hint ? a.hint : "" };
}

/**
 * Make the workspace folder `dir` say that `profile` (see profileFor) finds the map tools at http://127.0.0.1:<port>/mcp, and that no other assistant does.
 * Returns describe(profile).
 */
function syncAssistantConfigs(dir, { profile, port, key }) {
  const url = `http://127.0.0.1:${port}/mcp`;
  for (const [id, t] of Object.entries(JSON_TARGETS)) syncJson(path.join(dir, t.file), t.under, readsTarget(id, profile) ? t.entry(url, key) : null, t.secret);
  syncCodex(path.join(dir, ".codex", "config.toml"), profile === "codex" ? url : null);
  return describe(profile);
}

module.exports = { KEY_ENV, ASSISTANTS, profileFor, describe, syncAssistantConfigs, syncJson, syncCodex };
