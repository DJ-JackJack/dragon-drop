/** Settings for the desktop app: Claude API key, where the maps live, and how to connect Claude Code. */
import { useEffect, useState } from "react";
import { type AssetStatus, fetchAssetStatus } from "./assetsApi.ts";
import { useClaudeLauncher } from "./ClaudeButton.tsx";

const PRESETS: [label: string, command: string][] = [
  ["Claude Code", ""], ["Codex", "codex"], ["Gemini CLI", "gemini"], ["OpenCode", "opencode"],
  ["Claude Code via Ollama", "ollama launch claude"], ["Codex via Ollama", "ollama launch codex"], ["OpenCode via Ollama", "ollama launch opencode"],
];

type Settings = NonNullable<Awaited<ReturnType<DragonDropBridge["getSettings"]>>>;

export function DesktopSettings({ onClose }: { onClose: () => void }) {
  const bridge = window.dragonDrop!;
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => bridge.getSettings().then(setS).catch(() => {});
  useEffect(() => { void refresh(); }, []);

  const run = async (label: string, job: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try { await job(); await refresh(); } catch (e) { setError((e as Error).message); }
    setBusy(null);
  };
  const claude = useClaudeLauncher();
  const [cc, setCc] = useState<{ installed: boolean; version: string | null } | null>(null);
  useEffect(() => { void bridge.claudeCheck().then(setCc).catch(() => setCc({ installed: false, version: null })); }, [bridge]);
  const [assets, setAssets] = useState<AssetStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => fetchAssetStatus().then((a) => { if (alive) setAssets(a); }).catch(() => {});
    void poll();
    const t = window.setInterval(poll, 2000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const [copied, setCopied] = useState(false);
  const [upd, setUpd] = useState<{ status: string; version: string | null; message: string; channel?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => bridge.getUpdateState().then((u) => { if (alive) setUpd(u); }).catch(() => {});
    void poll();
    const t = window.setInterval(poll, 1500);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const [termCmd, setTermCmd] = useState<string | null>(null);
  const [termError, setTermError] = useState<string | null>(null);
  const shownCmd = termCmd ?? s?.terminalCommand ?? "";
  const preset = PRESETS.find(([, c]) => c === shownCmd.trim());
  const cmd = s?.mcpCommand ?? "";

  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" data-testid="desktop-settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <fieldset disabled={!!busy}>
          <legend>Claude (the chat in this window)</legend>
          <p className="muted">
            {s?.hasApiKey ? "An API key is saved. " : "No API key yet: the chat needs one. "}
            Get a key at console.anthropic.com. It is stored on this PC only{s?.encrypted ? ", encrypted with your Windows login" : ""}, and used only to talk to Claude.
          </p>
          <label className="field">{s?.hasApiKey ? "Replace the key" : "Anthropic API key"}
            <input type="password" value={key} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} onChange={(e) => setKey(e.target.value)} data-testid="api-key-input" />
          </label>
          <div className="row end">
            {s?.hasApiKey && <button onClick={() => void run("Removing…", async () => { if (await bridge.setApiKey("")) setKey(""); })}>Remove key</button>}
            <button className="primary" disabled={!key.trim()} onClick={() => void run("Saving…", async () => { if (await bridge.setApiKey(key)) setKey(""); })} data-testid="api-key-save">
              {busy ?? "Save key"}
            </button>
          </div>
        </fieldset>

        <fieldset disabled={!!busy}>
          <legend>Your maps</legend>
          <p className="muted" data-testid="projects-dir" style={{ wordBreak: "break-all" }}>{s?.projectsDir ?? "…"}</p>
          <div className="row end">
            <button onClick={() => void bridge.openProjectsFolder()}>Open folder</button>
            <button onClick={() => void run("Switching…", async () => { await bridge.chooseProjectsFolder(); })}>Change…</button>
          </div>
        </fieldset>

        <fieldset disabled={!!busy}>
          <legend>Dungeondraft assets</legend>
          <p className="muted" style={{ wordBreak: "break-all" }} data-testid="assets-dir">{s?.assetsDir ?? "Not set. Choose the folder that holds your .dungeondraft_pack files; they are read where they are and never copied."}</p>
          {assets?.configured && (
            <p className="muted" data-testid="assets-status">
              {assets.scanning ? `Reading packs… ${assets.scanned} of ${assets.total}` : `${assets.packs} packs read: ${assets.usablePacks} usable (${assets.files.toLocaleString()} files)`}
              {assets.restricted > 0 && `, ${assets.restricted} not used because their authors don't allow other programs`}
              {assets.errors.length > 0 && `, ${assets.errors.length} couldn't be read`}.
            </p>
          )}
          <div className="row end">
            {s?.assetsDir && <button onClick={() => void run("Removing…", async () => { await bridge.clearAssetsFolder(); })}>Remove</button>}
            {s?.assetsDir && <button onClick={() => void fetch("/api/assets/rescan", { method: "POST" })}>Rescan</button>}
            {s?.assetsDir && <button onClick={() => void fetch("/api/assets/report").then((r) => r.text()).then((t) => navigator.clipboard.writeText(t)).then(() => setCopied(true))} title="Copies a description of what's inside your packs, to send to whoever is improving Dragon Drop">{copied ? "Copied" : "Copy report"}</button>}
            <button className="primary" onClick={() => void run("Switching…", async () => { await bridge.chooseAssetsFolder(); })}>{s?.assetsDir ? "Change…" : "Choose folder…"}</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Updates</legend>
          <p className="muted" data-testid="update-message">Dragon Drop {s?.version ?? bridge.version}. {upd?.message || ""}</p>
          {upd?.channel !== "itch" && <label className="check"><input type="checkbox" checked={s?.autoUpdate ?? true} onChange={(e) => void bridge.setAutoUpdate(e.target.checked).then(refresh)} /> Check for updates automatically</label>}
          <div className="row end">
            {upd?.status === "ready" && <button className="primary" onClick={() => void bridge.installUpdate()} data-testid="update-install">Restart to update</button>}
            {upd?.channel !== "itch" && <button onClick={() => void bridge.checkForUpdates().then(setUpd)} disabled={upd?.status === "checking" || upd?.status === "downloading" || upd?.status === "unavailable"} data-testid="update-check">Check now</button>}
          </div>
        </fieldset>

        <fieldset>
          <legend>AI assistant</legend>
          <p className="muted">The terminal on the right runs this. Saving ends the running session. Tools other than Claude Code need the map tools added once: their address is below.</p>
          <label className="field">Assistant
            <select value={preset ? preset[1] : "custom"} onChange={(e) => { if (e.target.value !== "custom") setTermCmd(e.target.value); }} data-testid="terminal-preset">
              {PRESETS.map(([label, c]) => <option key={label} value={c}>{label}</option>)}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="field">Start command
            <input type="text" value={shownCmd} placeholder="claude" spellCheck={false} onChange={(e) => setTermCmd(e.target.value)} data-testid="terminal-command" />
          </label>
          <div className="row end">
            <button className="primary" disabled={shownCmd === (s?.terminalCommand ?? "")} data-testid="terminal-command-save"
              onClick={() => void bridge.setTerminalCommand(shownCmd).then((r) => { setTermError(r.ok ? null : "That command can't be used (too long, or it has control characters)."); setTermCmd(null); return refresh(); })}>Save</button>
          </div>
          {termError && <p className="error-text">{termError}</p>}
          {!s?.terminalCommand && (
            <>
              <p className="muted" data-testid="claude-status">
                Claude Code: {cc === null ? "checking…" : cc.installed ? `installed${cc.version ? ` (${cc.version})` : ""}` : "not installed yet. Open the Terminal tab on the right to set it up."}
              </p>
              <div className="row end"><button onClick={() => void claude.open()} disabled={claude.busy}>Open Claude Code</button></div>
              {claude.help}
            </>
          )}
          {s && s.port !== s.defaultPort && (
            <p className="error-text" data-testid="port-warning">
              Port {s.defaultPort} is already used by another program (most likely an older copy of this app still running, such as a <code>pnpm start</code> window), so this one is using {s.port}. Close the other one and reopen Dragon Drop to get back to {s.defaultPort}; the command below uses the right number either way.
            </p>
          )}
          <p className="muted">Map tools address (for tools other than Claude Code), sent with the header below (it holds your access key):</p>
          <code className="copyline" data-testid="mcp-url">{s?.mcpUrl ?? ""}</code>
          <code className="copyline" data-testid="mcp-header">Authorization: Bearer (your access key)</code>
          <div className="row end">
            <button onClick={() => void navigator.clipboard.writeText(s?.mcpUrl ?? "")}>Copy address</button>
            <button onClick={() => void navigator.clipboard.writeText(s?.mcpHeader ?? "")}>Copy header</button>
          </div>
          <p className="muted">For Claude Code, the Open Claude Code button sets everything up for you. To use it from your own terminal instead (it must be running), run this once in PowerShell (not inside Claude Code; type /exit first if you are):</p>
          <code className="copyline" data-testid="mcp-command">{s?.mcpCommandShown ?? ""}</code>
          <div className="row end"><button onClick={() => void navigator.clipboard.writeText(cmd)}>Copy</button></div>
        </fieldset>

        {error && <p className="error-text">{error}</p>}
        <div className="row">
          <span className="muted" style={{ flex: 1 }}>Dragon Drop {s?.version ?? bridge.version}</span>
          <button className="ghost" onClick={() => void bridge.openLogs()} style={{ flex: "none" }}>Open logs</button>
          <button className="ghost" onClick={onClose} disabled={!!busy} style={{ flex: "none" }}>Close</button>
        </div>
      </div>
    </div>
  );
}
