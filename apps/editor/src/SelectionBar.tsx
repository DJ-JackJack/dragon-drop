/**
 * The bar over the map that says what is selected, lets the DM lock Claude's edits to an area, and has the "Ask Claude about this" box
 * (which types the question into the Claude Code terminal, with a pointer to the selection, when Claude is idle).
 */
import { useEffect, useState } from "react";
import { type Features, type Selection, describeSelection, selectionShape } from "@mapmaker/core";

export interface AskResult {
  ok: boolean;
  message: string;
}

export function SelectionBar({ selection, lock, lockPref, features, kmPerPx, canAsk, onClear, onLockPref, onAsk }: {
  selection: Selection | null;
  lock: boolean;
  lockPref: boolean;
  features: Features;
  kmPerPx: number;
  /** The desktop app, where the Claude Code terminal can be typed into. */
  canAsk: boolean;
  onClear: () => void;
  onLockPref: (on: boolean) => void;
  onAsk: (text: string, selection: string, locked: boolean) => Promise<AskResult>;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);
  if (!selection) return null;
  const hasShape = !!selectionShape(selection, features);
  const desc = describeSelection(selection, features, kmPerPx);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await onAsk(t, desc, lock);
    setBusy(false);
    setNote(r);
    if (r.ok) setText("");
  };
  return (
    <div className="selection-bar" data-testid="selection-bar">
      <div className="sel-row">
        <span className="sel-what" data-testid="selection-text">Selected: {desc}</span>
        <button className="ghost" onClick={onClear} title="Clear the selection (Esc)" data-testid="selection-clear">Clear</button>
      </div>
      {hasShape && (
        <label className="check sel-lock" title="While this is on, anything Claude changes on the terrain is kept inside the area (with a soft edge), and it can't move or add places, labels, roads or regions outside it. Your own brushes are never held.">
          <input type="checkbox" data-testid="selection-lock" checked={lockPref} onChange={(e) => onLockPref(e.target.checked)} />
          {lock ? "Claude's edits are locked to this area" : "Lock Claude's edits to this area"}
        </label>
      )}
      {canAsk ? (
        <form className="sel-ask" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input
            data-testid="selection-ask-input" value={text} maxLength={500} placeholder="Ask Claude about this…"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" disabled={!text.trim() || busy} data-testid="selection-ask-send">Ask Claude</button>
        </form>
      ) : (
        <p className="muted sel-hint">Claude can see this selection. In Claude Code, say &ldquo;this&rdquo; or &ldquo;my selection&rdquo;.</p>
      )}
      {note && <div className={`sel-note ${note.ok ? "ok" : "bad"}`} data-testid="selection-note">{note.message}</div>}
    </div>
  );
}
