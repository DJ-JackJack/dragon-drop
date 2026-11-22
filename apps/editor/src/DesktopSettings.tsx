/** Settings for the desktop app: Claude API key, where the maps live, and how to connect Claude Code. */
import { useEffect, useState } from "react";
import { type AssetStatus, fetchAssetStatus } from "./assetsApi.ts";
import { useClaudeLauncher } from "./ClaudeButton.tsx";
import { ASSISTANT_NEEDS_CHECKED, ASSISTANT_PRESETS as PRESETS } from "./assistantPresets.ts";
import { refreshAssistantName } from "./assistantName.ts";
import { HELP_LINKS } from "./helpLinks.ts";

type Settings = NonNullable<Awaited<ReturnType<DragonDropBridge["getSettings"]>>>;

/**
 * Takes out the map tools connection an earlier version's command made in Claude Code (it held the access key itself; since 0.1.13 the command holds the
 * map tools key). The old one goes on working: this is only to swap it for the safer key. (Claude Code's own help: `claude mcp remove [-s scope] <name>`.)
 */
const MCP_REMOVE = "claude mcp remove --scope user mapmaker";

export function DesktopSettings({ onClose }: { onClose: () => void }) {
  const bridge = window.dragonDrop!;
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
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
          <legend>Phone page</legend>
          <p className="muted">A view-only page of the map for your phone, reached through Tailscale (a private network between your own devices). It is off until you enter your PC's Tailscale name here, as <code>tailscale serve status</code> shows it (like my-pc.tail1234.ts.net). The setup guide's section 7 has the steps.</p>
          <label className="field">Tailscale name
            <input type="text" value={phone ?? s?.phoneHost ?? ""} placeholder="off" spellCheck={false} onChange={(e) => setPhone(e.target.value)} data-testid="phone-host" />
          </label>
          <div className="row end">
            <button className="primary" disabled={phone === null || phone.trim() === (s?.phoneHost ?? "")} data-testid="phone-host-save"
              onClick={() => void run("Restarting…", async () => { await bridge.setPhoneHost(phone ?? ""); setPhone(null); })}>Save</button>
          </div>
          {!!s?.phoneHost && (
            <>
              <p className="muted" data-testid="phone-on">On: open <b>https://{s.phoneHost}/view</b> on your phone, with Tailscale switched on there. The first time, use the link below: it holds your access key, so the phone is let in and remembers it. Send it only to your own phone.</p>
              <div className="row end"><button onClick={() => void navigator.clipboard.writeText(`https://${s.phoneHost}/view?t=${encodeURIComponent(s.phoneKey ?? "")}`)} data-testid="phone-link-copy">Copy the phone link</button></div>
            </>
          )}
        </fieldset>

        <fieldset disabled={!!busy}>
          <legend>Access key</legend>
          <p className="muted">Everything that talks to Dragon Drop (this window, the AI assistant's map tools, the phone page) carries a secret key, so other programs and web pages can't. If the phone link went somewhere it shouldn't, or a phone with it was lost, make a new key: the old one stops working everywhere. The phone then needs the new link, and an assistant you connected yourself, outside this window, needs its command again.</p>
          <div className="row end">
            <button data-testid="new-access-key"
              onClick={() => { if (!sureKey) { setSureKey(true); return; } void run("Making a new key…", async () => { await bridge.newAccessKey(); setSureKey(false); }); }}>
              {sureKey ? "Sure? Click again" : "Make a new access key"}
            </button>
          </div>
        </fieldset>

        <fieldset disabled={!!busy}>
          <legend>Asset library</legend>
          <p className="muted" style={{ wordBreak: "break-all" }} data-testid="assets-dir">{s?.assetsDir ?? "Not set. Choose the folder that holds your assets (folders of pictures, .zip files or asset packs, in any mix); they are read where they are and never copied."}</p>
          {assets?.configured && (
            <p className="muted" data-testid="assets-status">
              {assets.scanning ? `Reading assets… ${assets.scanned} of ${assets.total}` : `${assets.packs} packs read: ${assets.usablePacks} usable (${assets.files.toLocaleString()} files)`}
              {assets.restricted > 0 && `, ${assets.restricted} not used because their authors don't allow other programs`}
              {assets.errors.length > 0 && `, ${assets.errors.length} couldn't be read`}.
            </p>
          )}
          <div className="row end">
            {s?.assetsDir && <button onClick={() => void run("Removing…", async () => { await bridge.clearAssetsFolder(); })}>Remove</button>}
            {s?.assetsDir && <button onClick={() => void fetch("/api/assets/rescan", { method: "POST" })}>Rescan</button>}
            {s?.assetsDir && <button onClick={() => void fetch("/api/assets/report").then((r) => r.text()).then((t) => navigator.clipboard.writeText(t)).then(() => setCopied(true))} title="Copies a description of what's inside your asset library, to send to whoever is improving Dragon Drop">{copied ? "Copied" : "Copy report"}</button>}
            <button className="primary" onClick={() => void run("Switching…", async () => { await bridge.chooseAssetsFolder(); })}>{s?.assetsDir ? "Change…" : "Choose folder…"}</button>
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
              <option value="all">All of them (best for Claude, Codex, Gemini and other large models)</option>
              <option value="essentials">A smaller set, for smaller or local models</option>
            </select>
          </label>
          {s?.toolSet === "essentials" && <p className="muted" data-testid="tool-set-note">The assistant sees about 40 map tools instead of about 155, with shorter instructions: everyday work on world maps, battlemaps and city maps fits in a much smaller model. Changing this ends the running session.</p>}
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
          <div className="key-note" data-testid="mcp-key-note">
            <p><b>Changed in 0.1.13:</b> this command now carries a <b>map tools key</b> instead of your access key. It opens the map tools and nothing else, so a command the assistant runs can't answer the Allow box for you.</p>
            <p>Connected Claude Code from your own terminal with an earlier version's command? It still works, but it holds your full access key. To swap it for the safer key, run this in PowerShell first, then the command above:</p>
            <code className="copyline" data-testid="mcp-remove-command">{MCP_REMOVE}</code>
            <div className="row end"><button onClick={() => void navigator.clipboard.writeText(MCP_REMOVE)} title="Copies the command that takes out the connection an earlier version's command made">Copy</button></div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Help</legend>
          <p className="muted">They open in your web browser. When you ask, say which version of Dragon Drop you have (below) and include the last lines of the logs if something failed. Never paste your access key or an API key.</p>
          <div className="row">
            <a className="button-link" href={HELP_LINKS.faq} target="_blank" rel="noreferrer" data-testid="help-faq">Questions and answers</a>
            <a className="button-link" href={HELP_LINKS.ask} target="_blank" rel="noreferrer" data-testid="help-ask">Ask a question or report a problem</a>
            <a className="button-link" href={HELP_LINKS.guide} target="_blank" rel="noreferrer">Setup guide</a>
          </div>
        </fieldset>

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
