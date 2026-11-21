/** "Open Claude Code": starts Claude Code (on the user's Claude subscription) with the map tools already connected. */
import { useState } from "react";

const INSTALL_CMD = "irm https://claude.ai/install.ps1 | iex";

export function useClaudeLauncher() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const open = async () => {
    const bridge = window.dragonDrop;
    if (!bridge) return;
    setBusy(true);
    try {
      const r = await bridge.openClaude(true);
      if (r.ok) { setStarted(true); window.setTimeout(() => setStarted(false), 6000); }
      else setHelpOpen(true);
    } finally {
      setBusy(false);
    }
  };
  const help = helpOpen ? <ClaudeHelp onClose={() => setHelpOpen(false)} /> : null;
  return { open, busy, started, help };
}

/** Shown in the chat panel when there's no API key: the subscription route. */
export function ClaudeCard() {
  const c = useClaudeLauncher();
  return (
    <div className="claude-card" data-testid="claude-card">
      <b>Chat with Claude using your Claude subscription</b>
      <p className="muted">Opens a window where you talk to Claude Code. It builds on this map live, using the same tools, and you can undo anything it does. No API key needed.</p>
      <button className="primary" onClick={() => void c.open()} disabled={c.busy} data-testid="claude-card-button">{c.started ? "Opening…" : "Open Claude Code"}</button>
      <p className="muted">Prefer to chat in this panel? Add an Anthropic API key under <b>Settings</b> (it's billed separately, per use).</p>
      {c.help}
    </div>
  );
}

const WINGET_CMD = "winget install Anthropic.ClaudeCode";

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <code className="copyline">{text}</code>
      <div className="row end"><button onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button></div>
    </>
  );
}

/**
 * First-time setup for Claude Code: it isn't bundled with Dragon Drop, and every person signs in with their own Claude account.
 * With `onInstall` (the terminal panel) the install is one click; without it (the help dialog) the same steps are done by hand.
 */
export function ClaudeInstallSteps({ onInstall }: { onInstall?: () => void }) {
  return (
    <div className="setup-guide" data-testid="claude-setup-guide">
      <p><b>What you need.</b> A paid Claude plan (Pro, Max, Ultra, Team or Enterprise) or an Anthropic Console account: the free claude.ai plan doesn't include Claude Code. Also Windows 10 or later and an internet connection. No administrator rights and no other programs are needed. (No plan? The <b>API chat</b> tab works with an Anthropic API key instead; add it under Settings.)</p>
      <h4>Step 1: install Claude Code (about a minute)</h4>
      {onInstall ? (
        <>
          <p>Press the button. Dragon Drop runs Anthropic's official installer here in the panel so you can watch it. It shows very little while it downloads: that's normal.</p>
          <div className="row end"><button className="primary" onClick={onInstall} data-testid="claude-install">Install Claude Code for me</button></div>
          <details>
            <summary>Rather do it yourself?</summary>
            <p>Press the Windows key, type <b>PowerShell</b>, press Enter, paste this and press Enter (it must be PowerShell, not Command Prompt):</p>
            <CopyLine text={INSTALL_CMD} />
            <p>When it says it's done, press <b>I've installed it: start</b> below.</p>
          </details>
        </>
      ) : (
        <>
          <p>Press the Windows key, type <b>PowerShell</b>, press Enter, paste this and press Enter (it must be PowerShell, not Command Prompt):</p>
          <CopyLine text={INSTALL_CMD} />
          <p>When it says it's done, come back here and try again.</p>
        </>
      )}
      <h4>Step 2: sign in (once)</h4>
      <p>The first time Claude Code starts, it asks you to sign in. Choose your Claude account, your web browser opens, sign in and approve, then come back to Dragon Drop. If the browser doesn't open, select the web address shown in the panel, copy it (Ctrl+C) and paste it into your browser. Only you hold this sign-in: it stays on your PC.</p>
      <h4>Step 3: you're ready</h4>
      <p>When the dot beside <b>Suggest</b> turns green, Claude Code is ready and connected to your map. Ask it for anything, or press Suggest.</p>
      <details>
        <summary>Something went wrong?</summary>
        <ul>
          <li><b>"irm is not recognized"</b>: you used Command Prompt. Use PowerShell (the button above does this for you).</li>
          <li><b>The installer fails</b> (a 403 or network error): check your internet, VPN or proxy and antivirus, then try again. Another way, in PowerShell:<CopyLine text={WINGET_CMD} /></li>
          <li><b>"Claude Code not found" after installing</b>: close Dragon Drop and open it again. To check, open a new PowerShell window and type <code>claude --version</code>.</li>
          <li><b>The sign-in says your plan doesn't include Claude Code</b>: upgrade your plan at claude.ai, or use the API chat tab with an API key.</li>
          <li><b>Still stuck</b>: in PowerShell run <code>claude doctor</code>, and look up the message at code.claude.com/docs/en/troubleshoot-install .</li>
        </ul>
      </details>
    </div>
  );
}

function ClaudeHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" data-testid="claude-help" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Claude Code isn't installed yet</h2>
        <p className="dialog-message">Install it once (about a minute), then try again:</p>
        <ClaudeInstallSteps />
        <div className="row end"><button className="primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  );
}
