/**
 * The trace bar, at the bottom of the map while a trace picture is laid over it: how see-through it is, show or hide it (U), and the
 * ways to line it up (Move, Pin 2 points, on a battlemap Match grid, Fit), Lock and Stop tracing. trace.ts does the work.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { MapMeta, TracePicture } from "@mapmaker/core";
import { traceCtl, traceStep } from "./trace.ts";

export function TraceBar({ trace, meta, level }: { trace: TracePicture | undefined; meta: MapMeta; level?: string }) {
  const s = useSyncExternalStore(traceCtl.subscribe, traceCtl.getState);
  // a mode belongs to the map (and level) it was started on
  useEffect(() => () => traceCtl.reset(), [meta.id, level]);
  useEffect(() => { if (!trace || trace.locked) traceCtl.reset(); }, [trace?.ref, trace?.locked]);
  useEffect(() => {
    if (!s.mode) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") traceCtl.reset(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [s.mode]);
  if (!trace) return null;
  const locked = !!trace.locked, battle = !!meta.battle;
  const mode = (m: "move" | "pin" | "grid", label: string, title: string) => (
    <button className={s.mode === m ? "on" : ""} disabled={locked} onClick={() => traceCtl.setMode(m)} title={title} data-testid={`trace-${m}`}>{label}</button>
  );
  return (
    <div className="trace-bar" data-testid="trace-bar">
      <div className="trace-row">
        <span className="trace-name" title={trace.ref}>Tracing <b>{trace.ref}</b></span>
        {/* first in the row, so it never wraps out of sight on a narrow map */}
        <button className="trace-stop" onClick={() => traceCtl.stop(trace)} title="Take the picture off the map (it stays in References; Undo brings it back)" data-testid="trace-stop">✕ Stop tracing</button>
        <label className="trace-opacity" title="How solid the picture is drawn">
          <span>See-through</span>
          <input type="range" min={10} max={100} step={5} value={Math.round(s.opacity * 100)} onChange={(e) => traceCtl.setOpacity(Number(e.target.value) / 100)} data-testid="trace-opacity" />
        </label>
        <button onClick={() => traceCtl.toggleShown()} title="Show or hide the trace picture (U)" data-testid="trace-shown">{s.shown ? "Hide" : "Show"}</button>
        {mode("move", "Move", "Drag the picture into place; size and turn it")}
        {mode("pin", "Pin 2 points", "Click a point on the picture, then where it belongs on the map; twice. The picture is moved, sized and turned to match")}
        {battle && mode("grid", "Match grid", "Click two crossings of the picture's own grid: its squares become the map's squares")}
        <button disabled={locked} onClick={() => traceCtl.fit(trace, meta)} title="Fit the whole picture inside the map again" data-testid="trace-fit">Fit</button>
        <button className={locked ? "on" : ""} onClick={() => traceCtl.setLocked(trace, !locked)} title={locked ? "Unlock it so it can be moved again" : "Lock it in place, so neither you nor Claude moves it by accident"} data-testid="trace-lock">{locked ? "Locked" : "Lock"}</button>
      </div>
      {s.mode && (
        <div className="trace-row trace-help" data-testid="trace-help">
          <span>{traceStep(s)}</span>
          {s.mode === "move" && (
            <span className="trace-adjust">
              Size <button onClick={() => traceCtl.resize(trace, 1 / 1.05)} title="Smaller">−</button><button onClick={() => traceCtl.resize(trace, 1.05)} title="Bigger">+</button>
              Turn <button onClick={() => traceCtl.turn(trace, -1)} title="1° anticlockwise">⟲</button><button onClick={() => traceCtl.turn(trace, 1)} title="1° clockwise">⟳</button>
            </span>
          )}
          <button onClick={() => traceCtl.reset()} data-testid="trace-done">{s.mode === "move" ? "Done" : "Cancel"}</button>
        </div>
      )}
      {!s.mode && locked && <div className="trace-row trace-help muted">Locked in place: unlock it to move it again.</div>}
    </div>
  );
}
