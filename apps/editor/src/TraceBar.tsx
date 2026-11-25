/**
 * The trace bar, at the bottom of the map while a trace picture is laid over it: how see-through it is, show or hide it (U), and the
 * ways to line it up (Move, Pin 2 points, on a battlemap Match grid, Fit), Lock and Stop tracing. trace.ts does the work. On a city map
 * it also starts the picture reader (Read buildings…, reader.ts), whose steps and buttons are shown here while it is on.
 */
import { store } from "./store.ts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cityViewBox } from "./cityUi.ts";
import { type MapMeta, ROOF_STYLES, ROOF_STYLE_NAMES, type RoofStyle, type TracePicture } from "@mapmaker/core";
import { MAX_ROOFS, type ReaderWhat, readerCtl } from "./reader.ts";
import { traceCtl, traceStep } from "./trace.ts";
import { forAssistant } from "./assistantName.ts";

const READER_STEP: Record<ReaderWhat, Record<"area" | "roofs" | "ground", string>> = {
  buildings: {
    area: "Drag a box around the part of the picture to read, or read the whole picture.",
    roofs: `Click one roof of each kind (up to ${MAX_ROOFS}): a red tile roof, a grey slate one, a straw one… Its look is guessed from its colour: change it if it's wrong.`,
    ground: "Click the ground between the buildings (streets, yards, grass, a square), so it isn't taken for roofs. Then Find.",
  },
  streets: {
    area: "Drag a box around the part of the picture to read, or read the whole picture.",
    roofs: "Click a street (and a lane or path too, if it is drawn in another colour).",
    ground: "Click what isn't a street beside them (roofs, gardens, a square, water), so it isn't taken for street. Then Find. Read the streets before the buildings.",
  },
  water: {
    area: "Drag a box around the part of the picture to read, or read the whole picture.",
    roofs: "Click the water (a river, the harbour, a pond); say whether each is deep or shallow (a ford, a beach's edge).",
    ground: "Click the shore and what is beside the water (land, roofs, streets, bridges), so it isn't taken for water. Then Find.",
  },
};
const READER_WHAT: { id: ReaderWhat; name: string; example: string; not: string }[] = [
  { id: "buildings", name: "Buildings", example: "Roofs", not: "Ground" },
  { id: "streets", name: "Streets", example: "Streets", not: "Not streets" },
  { id: "water", name: "Water", example: "Water", not: "Land" },
];

/** The picture reader's rows: steps, the roofs and ground clicked (with their colours), how strict, Find, Accept, Done. */
function ReaderRows() {
  const r = useSyncExternalStore(readerCtl.subscribe, readerCtl.getState);
  const n = r.what === "streets" ? r.foundStreets?.length ?? 0 : r.what === "water" ? r.foundWater?.cells ?? 0 : r.found?.length ?? 0, w = READER_WHAT.find((x) => x.id === r.what)!;
  const step = (k: "area" | "roofs" | "ground", label: string) => (
    <button className={r.step === k ? "on" : ""} onClick={() => readerCtl.setStep(k)} data-testid={`reader-${k}`}>{label}</button>
  );
  return (
    <>
      <div className="trace-row reader-row">
        <span className="seg" role="group" aria-label="What to read" data-testid="reader-what">
          {READER_WHAT.map((x) => <button key={x.id} className={r.what === x.id ? "on" : ""} onClick={() => readerCtl.setWhat(x.id)} data-testid={`reader-what-${x.id}`}>{x.name}</button>)}
        </span>
        {step("area", r.area ? "1 Area ✓" : "1 Area")}
        <button onClick={() => readerCtl.wholePicture()} title="Read all of the picture instead of a box" data-testid="reader-whole">Whole picture</button>
        {step("roofs", `2 ${w.example} (${r.roofs.length})`)}
        {step("ground", `3 ${w.not} (${r.ground.length})`)}
        <label className="trace-opacity" title="Strict finds only roofs very like the ones you clicked; loose also takes ones in shadow or a little faded (and more of what isn't a roof)">
          <span>Strict</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(r.tolerance * 100)} onChange={(e) => readerCtl.setTolerance(Number(e.target.value) / 100)} data-testid="reader-tolerance" />
          <span>Loose</span>
        </label>
        <button disabled={!r.roofs.length || r.busy} onClick={() => readerCtl.find()} title={`Look for ${r.what} of these colours`} data-testid="reader-find">{r.busy ? "Reading…" : "Find"}</button>
        <button className={n ? "on" : ""} disabled={!n} onClick={() => readerCtl.accept()} title="Add what was found to the map, as one edit (Undo takes it all back)" data-testid="reader-accept">Accept {n ? n.toLocaleString() : ""}</button>
        <button onClick={() => readerCtl.stop()} title="Stop reading (Esc)" data-testid="reader-done">Done</button>
      </div>
      {(r.roofs.length > 0 || r.ground.length > 0) && (
        <div className="trace-row reader-samples" data-testid="reader-samples">
          {r.roofs.map((s, i) => (
            <span key={`r${i}`} className="reader-sample" data-testid="reader-roof">
              <i className="reader-dot" style={{ background: `rgb(${s.rgb.join(",")})` }} />{i + 1}
              {r.what === "buildings" && (
                <select value={s.look} onChange={(e) => readerCtl.setLook(i, e.target.value as RoofStyle)} aria-label={`Roof ${i + 1} look`}>
                  {ROOF_STYLES.map((k) => <option key={k} value={k}>{ROOF_STYLE_NAMES[k]}</option>)}
                </select>
              )}
              {r.what === "water" && (
                <select value={s.deep === false ? "shallow" : "deep"} onChange={(e) => readerCtl.setDeep(i, e.target.value === "deep")} aria-label={`Water ${i + 1} depth`} data-testid="reader-depth">
                  <option value="deep">Deep water</option><option value="shallow">Shallow water</option>
                </select>
              )}
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
        <span>{r.note || READER_STEP[r.what][r.step]}</span>
      </div>
    </>
  );
}

/**
 * How close the settlement is to the picture (core cityCompare.ts through the hub): a button to measure, the totals, which measure the map's squares are
 * tinted by (red far off, green close), and showing or hiding them. Measured again on demand, since a redraw changes all the time.
 */
function CompareRow() {
  const c = useSyncExternalStore(store.subscribe, () => store.getState().traceCompare);
  const districts = useSyncExternalStore(store.subscribe, () => store.getState().features.districts) ?? [];
  const [where, setWhere] = useState("all");
  const r = c.result, T = r?.totals, pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");
  // what to measure: all of it, what is on screen (zoom to the town: outside one, a picture's parchment can look like thatch), or a named district
  const areaOf = (): [number, number][] | undefined => {
    if (where === "screen") { const b = cityViewBox.current; return b ? [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]] : undefined; }
    const d = districts.find((x) => x.id === where);
    return d ? (d.points.map(([x, y]) => [x, y]) as [number, number][]) : undefined;
  };
  return (
    <div className="trace-row compare-row" data-testid="compare-row">
      <select value={where} onChange={(e) => setWhere(e.target.value)} title="Where to measure: zoom to the town and measure what's on screen, so the country round it isn't counted" data-testid="compare-where">
        <option value="all">Whole map</option>
        <option value="screen">What's on screen</option>
        {districts.filter((d) => d.name).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button onClick={() => store.compareTrace(areaOf())} disabled={c.busy} title="Measure the settlement against the picture, square by square: roofs, streets and water" data-testid="compare-trace">{c.busy ? "Measuring…" : r ? "Measure again" : "How close?"}</button>
      {c.error && <span className="error-text">{c.error}</span>}
      {T && (
        <>
          <span className="compare-totals" data-testid="compare-totals" title="Covered: how much of what the picture shows the map has. On: how much of what the map has the picture shows there.">
            Roofs {pct(T.roofs.both, T.roofs.picture)} covered, {pct(T.roofs.both, T.roofs.map)} on roofs · {T.roofCount.picture} roofs / {T.roofCount.map} buildings ·
            Streets {pct(T.streets.both, T.streets.picture)}{T.streetWidth ? ` (width ×${T.streetWidth.median})` : ""}{T.treesOnRoofs.onRoofs ? ` · ${T.treesOnRoofs.onRoofs} tree groups on roofs` : ""}
          </span>
          <select value={c.metric} onChange={(e) => store.setTraceCompare({ metric: e.target.value as "roofs" | "streets" | "water", shown: true })} title="Which measure the squares are tinted by" data-testid="compare-metric">
            <option value="roofs">Roofs</option><option value="streets">Streets</option><option value="water">Water</option>
          </select>
          <button onClick={() => store.setTraceCompare({ shown: !c.shown })} data-testid="compare-shown">{c.shown ? "Hide squares" : "Show squares"}</button>
        </>
      )}
    </div>
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
        <button className={locked ? "on" : ""} onClick={() => traceCtl.setLocked(trace, !locked)} title={locked ? "Unlock it so it can be moved again" : forAssistant("Lock it in place, so neither you nor Claude moves it by accident")} data-testid="trace-lock">{locked ? "Locked" : "Lock"}</button>
        {city && !reading && (
          <button onClick={() => { traceCtl.reset(); readerCtl.start(); }} title="Find the buildings, streets or water in the picture by their colours and add them to the settlement (line the picture up first)" data-testid="reader-start">Read the picture…</button>
        )}
      </div>
      {reading && <ReaderRows />}
      {city && !reading && !s.mode && <CompareRow />}
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
