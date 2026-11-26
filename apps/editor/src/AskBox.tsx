/**
 * The AI assistant's question before a risky action (tools risky.ts): what it wants to do ("Remove the place "Gate Town""), what Allow does in a few words
 * ("It is taken off the map. Undo brings it back."), with Don't allow, Allow, and Allow all (this request) when Undo can take it back: then the assistant
 * doesn't ask again about such changes until it finishes the request (the hub's askDm; the person, 2026-11-25: one request can need several answers).
 * Shown in the editor; the first answer from any counts, and the server takes the question away everywhere (`confirm_done`). After the wait runs out
 * the assistant is told nothing was done. While Allow all is on, a bar says so, with Ask me again.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { store } from "./store.ts";
import { capital, useAssistantName } from "./assistantName.ts";

export function AskBox() {
  const asks = useSyncExternalStore(store.subscribe, () => store.getState().asks);
  const allowAll = useSyncExternalStore(store.subscribe, () => store.getState().allowAll);
  const name = useAssistantName();
  const [, tick] = useState(0);
  const ask = asks[0];
  useEffect(() => {
    if (!ask) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ask?.id]);
  useEffect(() => {
    if (!ask) return;
    // Esc says no; nothing else on the page reacts to keys while the question is open
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); store.answerAsk(ask.id, false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask?.id]);
  if (!ask) {
    if (!allowAll) return null;
    const who = allowAll.via === "chat" ? "Claude" : capital(name);
    return (
      <div className="allow-all-bar" role="status" data-testid="allow-all-bar">
        <span><b>Allow all</b> is on: {who} makes changes Undo can take back without asking, until it finishes this request.</span>
        <button onClick={() => store.stopAllowAll()} data-testid="allow-all-stop">Ask me again</button>
      </div>
    );
  }
  const who = ask.via === "chat" ? "Claude" : capital(name);
  const left = Math.max(0, Math.round((ask.at + ask.waitMs - Date.now()) / 1000));
  const more = asks.length - 1;
  return (
    <div className="modal-back ask-back">
      <div className="modal ask-box" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" data-testid="ask-box">
        <h2 id="ask-title">{who} asks before doing this</h2>
        <p className="ask-what" data-testid="ask-what">{ask.text}.</p>
        {ask.note && <p className={`ask-note${ask.undoable ? "" : " final"}`} data-testid="ask-note"><b>If you allow it:</b> {ask.note}</p>}
        {ask.map && <p className="muted" data-testid="ask-map">On the map <b>{ask.map}</b>.</p>}
        <p className="muted">
          Nothing happens until you answer{left > 0 ? ` (${left} s left)` : ""}.{more > 0 ? ` ${more} more ${more === 1 ? "question" : "questions"} after this one.` : ""}
        </p>
        <div className="row end">
          <button onClick={() => store.answerAsk(ask.id, false)} data-testid="ask-refuse">Don't allow</button>
          {ask.undoable && (
            <button onClick={() => store.answerAsk(ask.id, true, true)} data-testid="ask-allow-all"
              title={`Allow this, and let ${who} make changes Undo can take back without asking until it finishes this request`}>Allow all{more > 0 ? ` ${more + 1}` : ""}</button>
          )}
          <button className="primary" onClick={() => store.answerAsk(ask.id, true)} data-testid="ask-allow" autoFocus>Allow</button>
        </div>
        {ask.undoable && <p className="muted ask-all-note">Allow all: no more questions about changes Undo can take back until {who} finishes this request (or 15 minutes pass). You'll see a note for each.</p>}
      </div>
    </div>
  );
}
