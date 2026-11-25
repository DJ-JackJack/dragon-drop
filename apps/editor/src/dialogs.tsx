/**
 * The app's own dialogs, used instead of the browser's prompt/confirm/alert (which browsers
 * can block, hide or suppress, and which some embedded browsers don't support at all).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Dialog =
  | { kind: "ask"; message: string; value: string; ok: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; message: string; ok: string; resolve: (v: boolean) => void }
  | { kind: "notice"; message: string; resolve: () => void };

let current: Dialog | null = null;
const queue: Dialog[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function show(d: Dialog) {
  if (current) queue.push(d);
  else current = d;
  emit();
}
function close() {
  current = queue.shift() ?? null;
  emit();
}

/**
 * Ask for a line of text. Resolves with the trimmed text, or null if cancelled or left empty; with `emptyOk` an empty answer is "" (only Cancel is null), for
 * a question that says it may be left empty.
 */
export function ask(message: string, value = "", ok = "OK", emptyOk = false): Promise<string | null> {
  return new Promise((resolve) => show({ kind: "ask", message, value, ok, resolve: (v) => resolve(v?.trim() ? v.trim() : v !== null && emptyOk ? "" : null) }));
}
export function confirmBox(message: string, ok = "OK"): Promise<boolean> {
  return new Promise((resolve) => show({ kind: "confirm", message, ok, resolve }));
}
export function notice(message: string): Promise<void> {
  return new Promise((resolve) => show({ kind: "notice", message, resolve }));
}

/** Render once, near the top of the app. */
export function DialogHost() {
  const d = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (d?.kind === "ask") { setText(d.value); setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0); }
  }, [d]);
  if (!d) return null;
  const cancel = () => { if (d.kind === "ask") d.resolve(null); else if (d.kind === "confirm") d.resolve(false); else d.resolve(); close(); };
  const accept = () => { if (d.kind === "ask") d.resolve(text); else if (d.kind === "confirm") d.resolve(true); else d.resolve(); close(); };
  return (
    <div className="modal-back" onMouseDown={cancel} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } }}>
      <div className="modal" role="dialog" aria-modal="true" data-testid="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <p className="dialog-message">{d.message}</p>
        {d.kind === "ask" && (
          <input
            ref={input} value={text} data-testid="dialog-input" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); accept(); } }}
          />
        )}
        <div className="row end">
          {d.kind !== "notice" && <button className="ghost" onClick={cancel}>Cancel</button>}
          <button className="primary" data-testid="dialog-ok" onClick={accept} autoFocus={d.kind !== "ask"}>{d.kind === "notice" ? "OK" : d.ok}</button>
        </div>
      </div>
    </div>
  );
}
