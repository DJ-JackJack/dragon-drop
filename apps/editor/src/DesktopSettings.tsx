/** Settings for the desktop app, in tabs: the AI assistant (and the chat's API key), the maps and asset folders, the access key, and help and updates. */
import { useEffect, useState } from "react";
import { type AssetStatus, fetchAssetStatus } from "./assetsApi.ts";
import { useClaudeLauncher } from "./ClaudeButton.tsx";
import { ASSISTANT_NEEDS_CHECKED, ASSISTANT_PRESETS as PRESETS } from "./assistantPresets.ts";
import { refreshAssistantName } from "./assistantName.ts";
import { HELP_LINKS } from "./helpLinks.ts";

type Settings = NonNullable<Awaited<ReturnType<DragonDropBridge["getSettings"]>>>;

/** The Settings tabs, in order. It always opens on the first: setting up the AI assistant is what people come for most. */
type SettingsTab = "ai" | "maps" | "key" | "help";
export const SETTINGS_TABS: readonly (readonly [SettingsTab, string])[] = [
  ["ai", "AI assistant"],
  ["maps", "Maps and assets"],
  ["key", "Access key"],
  ["help", "Help and updates"],
];

export function DesktopSettings({ onClose }: { onClose: () => void }) {
  const bridge = window.dragonDrop!;
  const [s, setS] = useState<Settings | null>(null);
  const [tab, setTab] = useState<SettingsTab>("ai");
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
  const [sureKey, setSureKey] = useState(false);
  const [upd, setUpd] = useState<{ status: string; version: string | null; message: string; channel?: string; movedTo?: string } | null>(null);
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
      <div className="modal wide settings" role="dialog" aria-modal="true" aria-label="Settings" data-testid="desktop-settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="settings-tabs" role="tablist" aria-label="Settings">
          {SETTINGS_TABS.map(([id, label]) => (
            <button key={id} id={`settings-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`settings-${id}`} className={tab === id ? "on" : ""} onClick={() => setTab(id)} data-testid={`settings-tab-${id}`}>{label}</button>
          ))}
        </div>
        {/* (every tab stays in the page, the others hidden: what you typed in one is still there when you come back) */}
        <div className="settings-body" data-testid="settings-body">
          <div role="tabpanel" id="settings-ai" aria-labelledby="settings-tab-ai" className={tab === "ai" ? "settings-panel" : "settings-panel tab-off"} data-testid="settings-panel-ai">
            <fieldset>
              <legend>AI assistant</legend>
              <p className="muted">The terminal on the right runs this. Saving ends the running session. You sign into the assistant yourself, the first time it starts.</p>
              <label className="field">Assistant
                <select value={preset ? preset[1] : "custom"} onChange={(e) => { if (e.target.value !== "custom") setTermCmd(e.target.value); }} data-testid="terminal-preset">
                  {PRESETS.map(([label, c]) => <option key={label} value={c}>{label}</option>)}
                  <option value="custom">Custom</option>
                </select>
              </label>
              {preset && <p className="muted" data-testid="assistant-needs"><b>What it needs:</b> {preset[2]} <i>(Checked {ASSISTANT_NEEDS_CHECKED}; plans change, so the company's own pricing page has the last word.)</i></p>}
              <label className="field">Start command
                <input type="text" value={shownCmd} placeholder="claude" spellCheck={false} onChange={(e) => setTermCmd(e.target.value)} data-testid="terminal-command" />
              </label>
              <div className="row end">
                <button className="primary" disabled={shownCmd === (s?.terminalCommand ?? "")} data-testid="terminal-command-save"
                  onClick={() => void bridge.setTerminalCommand(shownCmd).then((r) => { setTermError(r.ok ? null : "That command can't be used (too long, or it has control characters)."); setTermCmd(null); refreshAssistantName(); return refresh(); })}>Save</button>
              </div>
              {termError && <p className="error-text">{termError}</p>}
              <label className="field">Map tools
                <select value={s?.toolSet ?? "all"} onChange={(e) => void bridge.setToolSet(e.target.value === "essentials" ? "essentials" : "all").then(refresh)} data-testid="tool-set">
                  <option value="all" title="Best for Claude, Codex, Gemini and other large models">All of them (for large models)</option>
                  <option value="essentials">A smaller set (for small or local models)</option>
                </select>
              </label>
              {s?.toolSet === "essentials" && <p className="muted" data-testid="tool-set-note">The assistant sees about 40 map tools instead of about 160, with shorter instructions: everyday work on world maps, battlemaps and settlement maps fits in a much smaller model. Changing this ends the running session.</p>}
              {!!s?.terminalCommand && (
                <p className="muted" data-testid="assistant-status">
                  {s.assistant?.auto
                    ? `Map tools: connected automatically for ${s.assistant.name} (Dragon Drop writes ${s.assistant.file} in your Claude workspace folder). ${s.assistant.hint}`
                    : "Map tools: Dragon Drop doesn't know this command, so it can't connect the map tools by itself. Add the address and header below in the assistant's own settings."}
                </p>
              )}
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
              <p className="muted">Map tools address, for an assistant Dragon Drop doesn't connect by itself, sent with the header below (it holds your map tools key, which opens the map tools and nothing else):</p>
              <code className="copyline" data-testid="mcp-url">{s?.mcpUrl ?? ""}</code>
              <code className="copyline" data-testid="mcp-header">Authorization: Bearer (your map tools key)</code>
              <div className="row end">
                <button onClick={() => void navigator.clipboard.writeText(s?.mcpUrl ?? "")}>Copy address</button>
                <button onClick={() => void navigator.clipboard.writeText(s?.mcpHeader ?? "")} title="Copies the header with your map tools key. It opens the map tools only: not the rest of Dragon Drop, and not the Allow box.">Copy header</button>
              </div>
              <p className="muted">For Claude Code, the Open Claude Code button sets everything up for you. To use it from your own terminal instead (it must be running), run this once in PowerShell (not inside Claude Code; type /exit first if you are):</p>
              <code className="copyline" data-testid="mcp-command">{s?.mcpCommandShown ?? ""}</code>
              <div className="row end"><button onClick={() => void navigator.clipboard.writeText(cmd)} title="Copies the command with your map tools key. Paste it into PowerShell once.">Copy</button></div>
              <p className="muted" data-testid="mcp-key-note">The command and the header carry your <b>map tools key</b>: it opens the map tools and nothing else, so a command the assistant runs can't answer the Allow box for you.</p>
            </fieldset>

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
          </div>
          <div role="tabpanel" id="settings-maps" aria-labelledby="settings-tab-maps" className={tab === "maps" ? "settings-panel" : "settings-panel tab-off"} data-testid="settings-panel-maps">
            <fieldset disabled={!!busy}>
              <legend>Your maps</legend>
              <p className="muted" data-testid="projects-dir" style={{ wordBreak: "break-all" }}>{s?.projectsDir ?? "…"}</p>
              <div className="row end">
                <button onClick={() => void bridge.openProjectsFolder()}>Open folder</button>
                <button onClick={() => void run("Switching…", async () => { await bridge.chooseProjectsFolder(); })}>Change…</button>
              </div>
            </fieldset>

            <fieldset disabled={!!busy}>
              <legend>Asset library</legend>
              <p className="muted" style={{ wordBreak: "break-all" }} data-testid="assets-dir">{s?.assetsDir ?? "Not set. Choose the folder that holds your assets (folders of pictures, .zip files or asset packs, in any mix); they are read where they are and never copied."}</p>
              {assets?.starter && <p className="muted" data-testid="assets-starter-note">Dragon Drop's own Starter Pack (a few floor textures and objects, free to use) is always there too.</p>}
              {assets?.configured && s?.assetsDir && (
                <p className="muted" data-testid="assets-status">
                  {assets.scanning ? `Reading assets… ${assets.scanned} of ${assets.total}` : `${assets.packs} packs read: ${assets.usablePacks} usable (${assets.files.toLocaleString()} files)`}
                  {assets.restricted > 0 && `, ${assets.restricted} not used because their authors don't allow other programs`}
                  {assets.errors.length > 0 && `, ${assets.errors.length} couldn't be read`}.
                  {assets.looking && ` Looking at the pictures whose names don't say what they are: ${assets.looking.done.toLocaleString()} of ${assets.looking.total.toLocaleString()}.`}
                </p>
              )}
              <div className="row end">
                {s?.assetsDir && <button onClick={() => void run("Removing…", async () => { await bridge.clearAssetsFolder(); })}>Remove</button>}
                {s?.assetsDir && <button onClick={() => void fetch("/api/assets/rescan", { method: "POST" })}>Rescan</button>}
                {s?.assetsDir && <button onClick={() => void fetch("/api/assets/report").then((r) => r.text()).then((t) => navigator.clipboard.writeText(t)).then(() => setCopied(true))} title="Copies a description of what's inside your asset library, to send to whoever is improving Dragon Drop">{copied ? "Copied" : "Copy report"}</button>}
                <button className="primary" onClick={() => void run("Switching…", async () => { await bridge.chooseAssetsFolder(); })}>{s?.assetsDir ? "Change…" : "Choose folder…"}</button>
              </div>
            </fieldset>
          </div>
          <div role="tabpanel" id="settings-key" aria-labelledby="settings-tab-key" className={tab === "key" ? "settings-panel" : "settings-panel tab-off"} data-testid="settings-panel-key">
            <fieldset disabled={!!busy}>
              <legend>Access key</legend>
              <p className="muted">Everything that talks to Dragon Drop (this window and the AI assistant's map tools) carries a secret key, so other programs and web pages on this PC can't. Dragon Drop only answers this PC: nothing on your network or the internet can reach it. If you think the key got out (you pasted the map tools command somewhere public), make a new one: the old one stops working everywhere, and an assistant you connected yourself, outside this window, needs its command again.</p>
              <div className="row end">
                <button data-testid="new-access-key"
                  onClick={() => { if (!sureKey) { setSureKey(true); return; } void run("Making a new key…", async () => { await bridge.newAccessKey(); setSureKey(false); }); }}>
                  {sureKey ? "Sure? Click again" : "Make a new access key"}
                </button>
              </div>
            </fieldset>
          </div>
          <div role="tabpanel" id="settings-help" aria-labelledby="settings-tab-help" className={tab === "help" ? "settings-panel" : "settings-panel tab-off"} data-testid="settings-panel-help">
            <fieldset>
              <legend>Help</legend>
              <p className="muted">They open in your web browser. When you ask, say which version of Dragon Drop you have (below) and include the last lines of the logs if something failed. Never paste your access key or an API key.</p>
              <div className="row">
                <a className="button-link" href={HELP_LINKS.faq} target="_blank" rel="noreferrer" data-testid="help-faq">Questions and answers</a>
                <a className="button-link" href={HELP_LINKS.ask} target="_blank" rel="noreferrer" data-testid="help-ask">Ask a question or report a problem</a>
                <a className="button-link" href={HELP_LINKS.guide} target="_blank" rel="noreferrer">Setup guide</a>
              </div>
            </fieldset>

            <fieldset>
              <legend>Updates</legend>
              <p className="muted" data-testid="update-message">Dragon Drop {s?.version ?? bridge.version}. {upd?.message || ""}</p>
              {upd?.channel !== "itch" && upd?.status !== "moved" && <label className="check"><input type="checkbox" checked={s?.autoUpdate ?? true} onChange={(e) => void bridge.setAutoUpdate(e.target.checked).then(refresh)} /> Check for updates automatically</label>}
              <div className="row end">
                {upd?.status === "ready" && <button className="primary" onClick={() => void bridge.installUpdate()} data-testid="update-install">Restart to update</button>}
                {upd?.status === "moved" && upd.movedTo && <a className="button-link primary" href={upd.movedTo} target="_blank" rel="noreferrer" data-testid="update-moved">Open the new page</a>}
                {upd?.channel !== "itch" && upd?.status !== "moved" && <button onClick={() => void bridge.checkForUpdates().then(setUpd)} disabled={upd?.status === "checking" || upd?.status === "downloading" || upd?.status === "unavailable"} data-testid="update-check">Check now</button>}
              </div>
            </fieldset>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        <div className="row">
          <span className="muted" style={{ flex: 1 }}>Dragon Drop {s?.version ?? bridge.version}</span>
          <button className="ghost" onClick={() => void bridge.openLogs()} style={{ flex: "none" }}>Open logs</button>
          <button className="ghost" onClick={() => void bridge.openLicences().then((r) => { if (!r.ok) setError("The licences file isn't in this copy (it comes with the installed app)."); })} style={{ flex: "none" }} data-testid="open-licences" title="The open-source licences of everything Dragon Drop is built with">Licences</button>
          <button className="ghost" onClick={onClose} disabled={!!busy} style={{ flex: "none" }}>Close</button>
        </div>
      </div>
    </div>
  );
}
