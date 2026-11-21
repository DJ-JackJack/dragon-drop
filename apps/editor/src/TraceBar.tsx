/**
 * The trace bar, at the bottom of the map while a trace picture is laid over it: how see-through it is, show or hide it (U), and the
 * ways to line it up (Move, Pin 2 points, on a battlemap Match grid, Fit), Lock and Stop tracing. trace.ts does the work. On a city map
 * it also starts the picture reader (Read buildings…, reader.ts), whose steps and buttons are shown here while it is on.
 */
import { useEffect, useSyncExternalStore } from "react";
import { type MapMeta, ROOF_STYLES, ROOF_STYLE_NAMES, type RoofStyle, type TracePicture } from "@mapmaker/core";
import { MAX_ROOFS, readerCtl } from "./reader.ts";
import { traceCtl, traceStep } from "./trace.ts";

const READER_STEP: Record<"area" | "roofs" | "ground", string> = {
  area: "Drag a box around the part of the picture to read, or read the whole picture.",
  roofs: `Click one roof of each kind (up to ${MAX_ROOFS}): a red tile roof, a grey slate one, a straw one… Its look is guessed from its colour: change it if it's wrong.`,
  ground: "Click the ground between the buildings (streets, yards, grass, a square), so it isn't taken for roofs. Then Find.",
};

/** The picture reader's rows: steps, the roofs and ground clicked (with their colours), how strict, Find, Accept, Done. */
function ReaderRows() {
  const r = useSyncExternalStore(readerCtl.subscribe, readerCtl.getState);
  const n = r.found?.length ?? 0;
  const step = (k: "area" | "roofs" | "ground", label: string) => (
    <button className={r.step === k ? "on" : ""} onClick={() => readerCtl.setStep(k)} data-testid={`reader-${k}`}>{label}</button>
  );
  return (
    <>
      <div className="trace-row reader-row">
        <b className="reader-title">Read buildings</b>
        {step("area", r.area ? "1 Area ✓" : "1 Area")}
        <button onClick={() => readerCtl.wholePicture()} title="Read all of the picture instead of a box" data-testid="reader-whole">Whole picture</button>
        {step("roofs", `2 Roofs (${r.roofs.length})`)}
        {step("ground", `3 Ground (${r.ground.length})`)}
        <label className="trace-opacity" title="Strict finds only roofs very like the ones you clicked; loose also takes ones in shadow or a little faded (and more of what isn't a roof)">
          <span>Strict</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(r.tolerance * 100)} onChange={(e) => readerCtl.setTolerance(Number(e.target.value) / 100)} data-testid="reader-tolerance" />
          <span>Loose</span>
        </label>
        <button disabled={!r.roofs.length || r.busy} onClick={() => readerCtl.find()} title="Look for buildings with these roof colours" data-testid="reader-find">{r.busy ? "Reading…" : "Find"}</button>
        <button className={n ? "on" : ""} disabled={!n} onClick={() => readerCtl.accept()} title="Add what was found to the map, as one edit (Undo takes it all back)" data-testid="reader-accept">Accept {n || ""}</button>
        <button onClick={() => readerCtl.stop()} title="Stop reading (Esc)" data-testid="reader-done">Done</button>
      </div>
      {(r.roofs.length > 0 || r.ground.length > 0) && (
        <div className="trace-row reader-samples" data-testid="reader-samples">
          {r.roofs.map((s, i) => (
            <span key={`r${i}`} className="reader-sample" data-testid="reader-roof">
              <i className="reader-dot" style={{ background: `rgb(${s.rgb.join(",")})` }} />{i + 1}
              <select value={s.look} onChange={(e) => readerCtl.setLook(i, e.target.value as RoofStyle)} aria-label={`Roof ${i + 1} look`}>
                {ROOF_STYLES.map((k) => <option key={k} value={k}>{ROOF_STYLE_NAMES[k]}</option>)}
              </select>
              <button onClick={() => readerCtl.removeRoof(i)} title="Take this roof away" aria-label={`Remove roof ${i + 1}`}>×</button>
            </span>
          ))}
          {r.ground.map((s, i) => (
            <span key={`g${i}`} className="reader-sample">
              <i className="reader-square" style={{ background: `rgb(${s.rgb.join(",")})` }} />ground
              <button onClick={() => readerCtl.removeGround(i)} title="Take this ground sample away" aria-label={`Remove ground ${i + 1}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="trace-row trace-help" data-testid="reader-help">
        <span>{r.note || READER_STEP[r.step]}</span>
      </div>
    </>
  );
}

export function TraceBar({ trace, meta, level }: { trace: TracePicture | undefined; meta: MapMeta; level?: string }) {
  const s = useSyncExternalStore(traceCtl.subscribe, traceCtl.getState);
  const reading = useSyncExternalStore(readerCtl.subscribe, () => readerCtl.state.on);
  // a mode (and the reader) belongs to the map (and level) it was started on
  useEffect(() => () => { traceCtl.reset(); readerCtl.stop(); }, [meta.id, level]);
  useEffect(() => { if (!trace || trace.locked) traceCtl.reset(); }, [trace?.ref, trace?.locked]);
  useEffect(() => { if (!trace) readerCtl.stop(); }, [trace?.ref]);
  useEffect(() => {
    if (!s.mode && !reading) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { traceCtl.reset(); readerCtl.stop(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [s.mode, reading]);
  if (!trace) return null;
  const locked = !!trace.locked, battle = !!meta.battle, city = meta.kind === "city";
  const mode = (m: "move" | "pin" | "grid", label: string, title: string) => (
    <button className={s.mode === m ? "on" : ""} disabled={locked || reading} onClick={() => traceCtl.setMode(m)} title={title} data-testid={`trace-${m}`}>{label}</button>
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
        {city && !reading && (
          <button onClick={() => { traceCtl.reset(); readerCtl.start(); }} title="Find the buildings in the picture by their roof colours and add them to the city (line the picture up first)" data-testid="reader-start">Read buildings…</button>
        )}
      </div>
      {reading && <ReaderRows />}
      {s.mode && !reading && (
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
      {!s.mode && !reading && locked && <div className="trace-row trace-help muted">Locked in place: unlock it to move it again.</div>}
    </div>
  );
}
