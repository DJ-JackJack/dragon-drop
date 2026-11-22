/**
 * The AI assistant's question before a risky action (tools risky.ts): "Claude wants to: Remove the place "Gate Town"", with Allow and Don't allow. Shown in the
 * editor and on the phone page; the first answer from either counts, and the server takes the question away everywhere (`confirm_done`). After the wait runs out
 * the assistant is told nothing was done.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { store } from "./store.ts";
import { capital, useAssistantName } from "./assistantName.ts";

export function AskBox() {
  const asks = useSyncExternalStore(store.subscribe, () => store.getState().asks);
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
  if (!ask) return null;
  const who = ask.via === "chat" ? "Claude" : capital(name);
  const left = Math.max(0, Math.round((ask.at + ask.waitMs - Date.now()) / 1000));
  return (
    <div className="modal-back ask-back">
      <div className="modal ask-box" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" data-testid="ask-box">
        <h2 id="ask-title">{who} wants to do something big</h2>
        <p className="ask-what" data-testid="ask-what">{ask.text}.</p>
        {ask.map && <p className="muted" data-testid="ask-map">On the map <b>{ask.map}</b>.</p>}
        <p className="muted">
          It waits for your answer{left > 0 ? ` (${left} s left)` : ""}; with no answer, nothing is done. Most changes can be undone afterwards, but this one is yours to decide.
          {asks.length > 1 ? ` (${asks.length - 1} more after this.)` : ""}
        </p>
        <div className="row end">
          <button onClick={() => store.answerAsk(ask.id, false)} data-testid="ask-refuse">Don't allow</button>
          <button className="primary" onClick={() => store.answerAsk(ask.id, true)} data-testid="ask-allow" autoFocus>Allow</button>
        </div>
      </div>
    </div>
  );
}
