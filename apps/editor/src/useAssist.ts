/**
 * Assist mode for the Claude Code panel: the Suggest button, and (when switched on) a nudge after the DM pauses editing.
 * The rules are in core's assist.ts. Claude Code only ever hears from us when its hooks say it is idle.
 */
import { askMessage, assistDecision, assistMessage, userEditsSince } from "@mapmaker/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { sendToClaude, typingAt } from "./assistBus.ts";
import type { AppState } from "./store.ts";

const KEY = "dd.assist";
const HOUR = 3_600_000;

function loadEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export interface Assist {
  enabled: boolean;
  setEnabled(on: boolean): void;
  /** Ask for suggestions now (the Suggest button). Resolves to a message to show. */
  suggest(): Promise<string>;
  /** The "Ask Claude about this" box: type the DM's words, with a pointer to their selection, into Claude Code when it is idle. Resolves to a message to show. */
  ask(text: string, selection: string, locked: boolean): Promise<{ ok: boolean; message: string }>;
  /** Why Assist is waiting, or what it just did. */
  status: string;
  /** A suggestion was asked for and Claude has finished answering: look at the panel. */
  ready: boolean;
  clearReady(): void;
}

export function useAssist(s: AppState, desktop: boolean): Assist {
  const [enabled, setEnabledState] = useState(loadEnabled);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const sRef = useRef(s);
  sRef.current = s;
  // the last change Claude has been told about: edits made before Assist was switched on or the map opened don't count
  const told = useRef(s.seq);
  const mapId = useRef(s.meta?.id);
  const nudges = useRef<number[]>([]);
  const lastNudgeAt = useRef<number | null>(null);
  const waitingForAnswer = useRef(false);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private window */ }
    if (on) told.current = sRef.current.seq;
    setStatus(on ? "Assist is on: I'll look when you pause." : "");
  }, []);

  useEffect(() => {
    if (s.meta?.id !== mapId.current) { mapId.current = s.meta?.id; told.current = s.seq; }
  }, [s.meta?.id, s.seq]);

  // Claude finished the turn we asked for: tell the DM (the tab shows a dot when the panel is hidden)
  useEffect(() => {
    if (s.claude === "idle" && waitingForAnswer.current) { waitingForAnswer.current = false; setReady(true); }
  }, [s.claude]);

  const send = useCallback(async (manual: boolean): Promise<string> => {
    const st = sRef.current;
    const edits = userEditsSince(st.changes, told.current);
    const text = assistMessage({ since: told.current, latest: st.seq, labels: edits.labels, manual });
    if (!(await sendToClaude(text))) return "Claude Code isn't running. Start it in this panel first.";
    told.current = st.seq;
    lastNudgeAt.current = Date.now();
    nudges.current = [...nudges.current.filter((t) => Date.now() - t < HOUR), Date.now()];
    waitingForAnswer.current = true;
    return manual ? "Asked Claude for suggestions." : "Asked Claude to look at your latest changes.";
  }, []);

  const suggest = useCallback(async (): Promise<string> => {
    const bridge = window.dragonDrop;
    if (!bridge) return "Suggestions need the desktop app.";
    const st = sRef.current;
    const t = await bridge.termStatus();
    if (!t.alive) return "Claude Code isn't running. Start it in this panel first.";
    if (st.claude === "blocked") return "Claude is waiting for your answer in the terminal. Answer it first.";
    if (st.claude === "busy" || t.looksBusy) return "Claude is busy or has a question open. Try again when it's done.";
    const msg = await send(true);
    setStatus(msg);
    return msg;
  }, [send]);

  const ask = useCallback(async (text: string, selection: string, locked: boolean): Promise<{ ok: boolean; message: string }> => {
    const bridge = window.dragonDrop;
    if (!bridge) return { ok: false, message: "Asking from here needs the desktop app. Type it into Claude Code and say \"my selection\"." };
    const st = sRef.current;
    const t = await bridge.termStatus();
    if (!t.alive) return { ok: false, message: "Claude Code isn't running. Start it in the Claude panel first." };
    if (st.claude === "blocked") return { ok: false, message: "Claude is waiting for your answer in the terminal. Answer it first." };
    if (st.claude === "busy" || t.looksBusy) return { ok: false, message: "Claude is busy or has a question open. Try again when it's done." };
    if (!(await sendToClaude(askMessage({ text, selection, locked })))) return { ok: false, message: "Claude Code isn't running. Start it in the Claude panel first." };
    waitingForAnswer.current = true;
    return { ok: true, message: "Asked Claude." };
  }, []);

  useEffect(() => {
    if (!enabled || !desktop) return;
    let stopped = false;
    const tick = async () => {
      const bridge = window.dragonDrop;
      if (!bridge || stopped) return;
      const st = sRef.current, now = Date.now();
      const edits = userEditsSince(st.changes, told.current);
      const term = await bridge.termStatus();
      if (stopped) return;
      const d = assistDecision({
        now, enabled: true, claude: st.claude, terminal: term, pending: edits.count, lastEditAt: edits.lastAt,
        lastTypingAt: typingAt(), lastNudgeAt: lastNudgeAt.current, nudgesLastHour: nudges.current.filter((t) => now - t < HOUR).length,
      });
      if (d.send) setStatus(await send(false));
      else setStatus(edits.count ? `Assist is waiting: ${d.reason}.` : "Assist is on: I'll look when you pause.");
    };
    const id = window.setInterval(() => void tick(), 5000);
    return () => { stopped = true; window.clearInterval(id); };
  }, [enabled, desktop, send]);

  return { enabled, setEnabled, suggest, ask, status, ready, clearReady: () => setReady(false) };
}
