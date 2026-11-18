/**
 * Claude Code running inside the right-hand panel: a real terminal (xterm.js) attached to a pseudo-terminal
 * that the desktop app runs. Uses the user's Claude subscription. The session lives in the desktop app, so
 * switching tabs or reloading the page reattaches to it.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { markTyping } from "./assistBus.ts";
import { ClaudeInstallSteps } from "./ClaudeButton.tsx";
import type { Assist } from "./useAssist.ts";
import type { ClaudeState } from "@mapmaker/core";

type State = "starting" | "running" | "ended" | "missing" | "error" | "installing" | "installfailed" | "launching";

const THEME = {
  background: "#0a0a0c", foreground: "#ece6d6", cursor: "#d4af37", cursorAccent: "#0a0a0c", selectionBackground: "rgba(212, 175, 55, 0.32)",
  black: "#15151a", red: "#e0786a", green: "#8fbf8a", yellow: "#d9b64a", blue: "#6f9bff", magenta: "#c590e8", cyan: "#6fc7c0", white: "#d8d2c0",
  brightBlack: "#6f6a5c", brightRed: "#f0988a", brightGreen: "#a9d6a4", brightYellow: "#f3d77c", brightBlue: "#92b4ff", brightMagenta: "#dcaef5", brightCyan: "#8fe0da", brightWhite: "#f6f1e3",
};

const CLAUDE_LABEL: Record<ClaudeState, string> = { unknown: "not reporting yet", idle: "ready", busy: "working", blocked: "waiting for you" };

export function ClaudeTerminal({ wide, onToggleWide, assist, claude }: { wide: boolean; onToggleWide: () => void; assist: Assist; claude: ClaudeState }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [state, setState] = useState<State>("starting");
  const [detail, setDetail] = useState("");
  // just installed Claude Code here: the first start asks the DM to sign in, so say so until Claude reports it is ready
  const [firstRun, setFirstRun] = useState(false);

  const start = async (resume: boolean) => {
    const bridge = window.dragonDrop, term = termRef.current;
    if (!bridge || !term) return;
    term.reset();
    setState("starting");
    const r = await bridge.termStart({ cols: term.cols, rows: term.rows, resume });
    if (r.ok) setState("running");
    else if (r.reason === "not-installed") setState("missing");
    else { setDetail(r.reason ?? ""); setState("error"); }
    term.focus();
  };

  const install = async () => {
    const bridge = window.dragonDrop, term = termRef.current;
    if (!bridge || !term) return;
    term.reset();
    setDetail("");
    setState("installing");
    const r = await bridge.claudeInstall({ cols: term.cols, rows: term.rows });
    if (!r.ok) { setDetail(r.reason ?? "The installer couldn't start."); setState("installfailed"); }
    term.focus();
  };

  useEffect(() => { if (claude === "idle") setFirstRun(false); }, [claude]);

  const launchTimer = useRef(0);
  useEffect(() => {
    const bridge = window.dragonDrop, host = hostRef.current;
    if (!bridge || !host) return;
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace', fontSize: 13, lineHeight: 1.15,
      cursorBlink: true, scrollback: 8000, theme: THEME, allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    const refit = () => { try { fit.fit(); } catch { /* the panel is hidden */ } };
    refit();
    // Windows habits: Ctrl+C copies when something is selected, Ctrl+V pastes
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "c" && term.hasSelection()) { void navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") { void navigator.clipboard.readText().then((t) => term.paste(t)); return false; }
      return true;
    });
    host.addEventListener("contextmenu", (e) => { e.preventDefault(); if (term.hasSelection()) { void navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); } else void navigator.clipboard.readText().then((t) => term.paste(t)); });
    const offData = bridge.onTermData((d) => term.write(d));
    const offExit = bridge.onTermExit(() => setState("ended"));
    const offInstalled = bridge.onClaudeInstalled((r) => {
      // let the installer's last lines be read before the terminal is cleared for Claude Code
      if (r.ok) { setFirstRun(true); setState("launching"); launchTimer.current = window.setTimeout(() => void start(false), 1500); }
      else { setDetail(`The installer finished with code ${r.code}${r.found ? "" : ", and Claude Code still wasn't found"}.`); setState("installfailed"); }
    });
    const typed = term.onData((d) => { markTyping(); bridge.termWrite(d); });
    const resized = term.onResize(({ cols, rows }) => bridge.termResize(cols, rows));
    const ro = new ResizeObserver(refit);
    ro.observe(host);
    void bridge.termAttach().then((a) => {
      if (a.alive) { term.write(a.buffer); setState("running"); bridge.termResize(term.cols, term.rows); }
      else void start(false);
    });
    return () => { window.clearTimeout(launchTimer.current); offData(); offExit(); offInstalled(); typed.dispose(); resized.dispose(); ro.disconnect(); term.dispose(); termRef.current = null; };
  }, []);

  // the panel's width changed: fit again
  useEffect(() => { const t = window.setTimeout(() => { try { termRef.current && window.dispatchEvent(new Event("resize")); } catch { /* ignore */ } }, 80); return () => window.clearTimeout(t); }, [wide]);

  const label = state === "running" ? "Running" : state === "starting" || state === "launching" ? "Starting…" : state === "installing" ? "Installing…" : state === "ended" ? "Ended" : state === "missing" ? "Not installed" : "Problem";
  return (
    <div className="chat term-panel" data-testid="claude-terminal">
      <div className="chat-head">
        <span className="chat-title">Claude Code</span>
        <span className={`term-state ${state}`}>{label}</span>
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={onToggleWide} title={wide ? "Make this panel narrower" : "Make this panel wider (easier to read)"}>{wide ? "⇥ Narrower" : "⇤ Wider"}</button>
        <button className="ghost" onClick={() => void window.dragonDrop?.openClaude(true)} title="Open Claude Code in its own window instead">Pop out</button>
      </div>
      <div className="assist-bar" data-testid="assist-bar">
        <button className="ghost" data-testid="assist-suggest" disabled={state !== "running"} onClick={() => void assist.suggest()}
          title="Ask Claude to look at the map (and what you changed) and suggest what to do next">Suggest</button>
        <label className="check assist-toggle" title="When on, Claude looks at your edits after you pause and suggests next steps here. It only suggests, never changes the map by itself, and uses your Claude subscription.">
          <input type="checkbox" data-testid="assist-toggle" checked={assist.enabled} onChange={(e) => assist.setEnabled(e.target.checked)} /> Assist
        </label>
        <span className={`claude-dot ${claude}`} title={`Claude Code: ${CLAUDE_LABEL[claude]}`} />
        <span className="assist-status" data-testid="assist-status">{assist.status || (assist.enabled ? "" : `Claude: ${CLAUDE_LABEL[claude]}`)}</span>
      </div>
      {state === "installing" && (
        <div className="term-banner" data-testid="claude-installing">Installing Claude Code with Anthropic's official installer. It shows very little while it downloads (about a minute). Keep this window open.</div>
      )}
      {state === "launching" && (
        <div className="term-banner" data-testid="claude-launching">Installed. Starting Claude Code…</div>
      )}
      {firstRun && state === "running" && claude !== "idle" && (
        <div className="term-banner" data-testid="claude-signin-hint">
          Installed. The first time, Claude Code asks you to sign in: choose your Claude account, sign in in the browser that opens, approve, then come back here.
          If the browser doesn't open, select the web address in the terminal, copy it (Ctrl+C) and paste it into your browser.
          <button className="ghost" onClick={() => setFirstRun(false)}>Hide</button>
        </div>
      )}
      <div className="term-body">
        <div className="term-host" ref={hostRef} onClick={() => termRef.current?.focus()} />
        {state === "missing" && (
          <div className="term-overlay" data-testid="claude-missing">
            <h3>Set up Claude Code</h3>
            <ClaudeInstallSteps onInstall={() => void install()} />
            <div className="row end"><button onClick={() => void start(false)}>I've installed it: start</button></div>
          </div>
        )}
        {state === "installfailed" && (
          <div className="term-overlay" data-testid="claude-install-failed">
            <h3>The installation didn't finish</h3>
            <p className="muted">{detail}</p>
            <div className="row end"><button className="primary" onClick={() => void install()}>Try again</button><button onClick={() => void start(false)}>I've installed it: start</button></div>
            <ClaudeInstallSteps />
          </div>
        )}
        {state === "error" && (
          <div className="term-overlay">
            <h3>Claude Code couldn't start</h3>
            <p className="muted">{detail || "Unknown problem."}</p>
            <div className="row end"><button className="primary" onClick={() => void start(false)}>Try again</button></div>
          </div>
        )}
        {state === "ended" && (
          <div className="term-ended" data-testid="claude-ended">
            <span>Claude Code has ended.</span>
            <button className="primary" onClick={() => void start(false)}>New conversation</button>
            <button onClick={() => void start(true)} title="Pick up the last conversation where it left off">Continue last</button>
          </div>
        )}
      </div>
    </div>
  );
}
