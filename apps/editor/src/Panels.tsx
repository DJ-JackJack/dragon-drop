import { useEffect, useRef, useState } from "react";
import { placeKind,
  GROUND_INFO, MI_PER_KM, WIND_NAMES, type ClimateParams, type ClimateRegion, DEFAULT_CLIMATE, type Corner, type Features, type MapFurniture, type MapGrid, type MapLine, describeFurniture, lineLengthKm, clampGridSize, describeGrid, gridCellPx, niceGridSize, type LabelKind, type MapLabel, type MapMeta, type NamePos, type Place, type PlaceType,
} from "@mapmaker/core";
import { PlaceGlyph, PlaceKindPicker } from "./PlaceKindPicker.tsx";
import { type AppState, store } from "./store.ts";
import { forAssistant } from "./assistantName.ts";
import { SourceEditor, WaterEditor, deleteWaterThing } from "./WaterPanel.tsx";

export const LABEL_KINDS: { id: LabelKind; label: string }[] = [
  { id: "sea", label: "Sea / ocean" }, { id: "region", label: "Region" }, { id: "range", label: "Mountain range" },
  { id: "island", label: "Island" }, { id: "feature", label: "Small feature" },
];

const sendPlace = (p: Place, label?: string) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertPlaces: [p] }, label } });
const sendRegion = (r: ClimateRegion, label?: string) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertRegions: [r] }, label: label ?? `Edit climate region ${r.name}` } });
const sendLabel = (l: MapLabel, label?: string) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertLabels: [l] }, label } });

/** Edit the selected place or label. Sliders preview locally and commit on release (one undo step each). */
export function Inspector({ features, selectedId, kmPerPx, onClear, water }: { features: Features; selectedId: string | null; kmPerPx: number; onClear: () => void; water?: AppState["water"] }) {
  const place = features.places.find((p) => p.id === selectedId);
  const lab = features.labels.find((l) => l.id === selectedId);
  const region = features.regions?.find((r) => r.id === selectedId);
  const line = features.lines?.find((l) => l.id === selectedId);
  // a named river or lake, or a river source
  const wn = features.waterNames?.find((w) => w.id === selectedId);
  const src = features.sources?.find((x) => x.id === selectedId);
  if (wn || src) {
    return (
      <section className="inspector" data-testid="inspector">
        <h3>{wn ? (wn.kind === "river" ? "River" : "Lake") : "River source"}</h3>
        {wn ? <WaterEditor w={wn} water={water ?? null} /> : <SourceEditor s={src!} features={features} />}
        <div className="row">
          <button onClick={onClear}>Done</button>
          <button className="danger" onClick={() => { if (deleteWaterThing(features, selectedId!) && wn) onClear(); }} data-testid="water-remove">{wn ? "Remove the name" : "Remove source"}</button>
        </div>
      </section>
    );
  }
  if (!place && !lab && !region && !line) return null;
  return (
    <section className="inspector" data-testid="inspector">
      <h3>{place ? "Place" : region ? "Climate region" : line ? (line.kind === "border" ? "Border" : line.kind === "trail" ? "Trail" : line.kind === "reef" ? "Reef" : "Road") : "Label"}</h3>
      {place ? <PlaceEditor p={place} /> : region ? <RegionEditor r={region} /> : line ? <LineEditor l={line} kmPerPx={kmPerPx} /> : <LabelEditor l={lab!} />}
      <div className="row">
        <button onClick={onClear}>Done</button>
        <button
          className="danger"
          onClick={() => {
            const patch = place ? { removePlaces: [place.id] } : region ? { removeRegions: [region.id] } : line ? { removeLines: [line.id] } : { removeLabels: [lab!.id] };
            store.send({ t: "cmd", cmd: { op: "features", patch, label: `Delete ${place?.name ?? region?.name ?? line?.name ?? line?.kind ?? lab!.text}` } });
            onClear();
          }}
        >Delete</button>
      </div>
    </section>
  );
}

function PlaceEditor({ p }: { p: Place }) {
  const [name, setName] = useState(p.name);
  const [notes, setNotes] = useState(p.notes ?? "");
  useEffect(() => { setName(p.name); setNotes(p.notes ?? ""); }, [p.id, p.name, p.notes]);
  return (
    <>
      <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.name && sendPlace({ ...p, name: name.trim() }, `Rename ${p.name}`)} /></label>
      <div className="field">Type
        <details className="kind-details">
          <summary data-testid="place-kind-current"><PlaceGlyph type={p.type} size={26} /> <span>{placeKind(p.type).name}</span></summary>
          <PlaceKindPicker value={p.type} onChange={(t) => sendPlace({ ...p, type: t }, `Make ${p.name} a ${placeKind(t).name.toLowerCase()}`)} testidPrefix="inspector-kind" />
        </details>
      </div>
      <label className="field">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (p.notes ?? "") && sendPlace({ ...p, notes })} /></label>
      <label className="check"><input type="checkbox" checked={!p.hideName} onChange={(e) => sendPlace({ ...p, hideName: !e.target.checked })} /> Show name on map</label>
      <label className="check"><input type="checkbox" checked={!p.hideMarker} onChange={(e) => sendPlace({ ...p, hideMarker: !e.target.checked })} /> Show marker (turn off for a peak the map already shows)</label>
      <label className="field">Name position
        <select value={p.namePos ?? "auto"} onChange={(e) => sendPlace({ ...p, namePos: e.target.value as NamePos })}>
          <option value="auto">Automatic (first free side)</option>
          <option value="right">Right</option>
          <option value="left">Left</option>
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
      </label>
      <p className="muted">x {Math.round(p.x)} · y {Math.round(p.y)} (drag on the map with Select to move)</p>
    </>
  );
}

function Slider({ label, value, min, max, step, fmt, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <label className="slider">
      <span>{label} <b>{fmt ? fmt(v) : v}</b></span>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </label>
  );
}

function LabelEditor({ l }: { l: MapLabel }) {
  const [text, setText] = useState(l.text);
  useEffect(() => setText(l.text), [l.id, l.text]);
  return (
    <>
      <label className="field">Text<input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== l.text && sendLabel({ ...l, text: text.trim() }, `Edit label ${l.text}`)} /></label>
      <label className="field">Kind
        <select value={l.kind} onChange={(e) => sendLabel({ ...l, kind: e.target.value as LabelKind })}>
          {LABEL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      {l.path ? (
        <>
          <p className="muted">Follows a line ({l.path.length} points). Drag it with Select to move it.</p>
          <label className="check"><input type="checkbox" checked={!!l.spread} onChange={(e) => sendLabel({ ...l, spread: e.target.checked }, `Spread label ${l.text}`)} /> Spread letters along the whole line</label>
          <button
            onClick={() => {
              const [[ax, ay], [bx, by]] = [l.path![0], l.path![l.path!.length - 1]];
              let angle = Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI);
              if (angle > 90) angle -= 180;
              if (angle < -90) angle += 180;
              const { path: _p, spread: _s, ...rest } = l;
              sendLabel({ ...rest, angle, curve: 0 }, `Straighten label ${l.text}`);
            }}
          >Straighten (drop the line)</button>
        </>
      ) : (
        <>
          <Slider label="Angle" value={l.angle ?? 0} min={-90} max={90} step={1} fmt={(v) => `${v}°`} onCommit={(v) => sendLabel({ ...l, angle: v }, `Rotate label ${l.text}`)} />
          <Slider label="Curve" value={l.curve ?? 0} min={-1} max={1} step={0.05} fmt={(v) => v.toFixed(2)} onCommit={(v) => sendLabel({ ...l, curve: v }, `Bend label ${l.text}`)} />
          <p className="muted">Tip: drag with the Label tool to make a label follow a line.</p>
        </>
      )}
      <Slider label="Size" value={l.size ?? 1} min={0.4} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onCommit={(v) => sendLabel({ ...l, size: v }, `Resize label ${l.text}`)} />
    </>
  );
}

const sendLine = (l: MapLine, label?: string) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertLines: [l] }, label: label ?? `Edit ${l.kind}${l.name ? ` ${l.name}` : ""}` } });

function LineEditor({ l, kmPerPx }: { l: MapLine; kmPerPx: number }) {
  const latest = useLatest(l);
  const [name, setName] = useState(l.name ?? "");
  const [notes, setNotes] = useState(l.notes ?? "");
  useEffect(() => { setName(l.name ?? ""); setNotes(l.notes ?? ""); }, [l.id, l.name, l.notes]);
  const km = lineLengthKm(l.points, kmPerPx, l.closed);
  const miles = km * MI_PER_KM;
  const set = (patch: Partial<MapLine>, drop?: keyof MapLine) => {
    const next = { ...latest.current, ...patch };
    if (drop) delete next[drop];
    latest.current = next;
    sendLine(next);
  };
  return (
    <>
      <label className="field">Name (optional)<input value={name} placeholder={l.kind === "border" ? "e.g. the northern march" : l.kind === "reef" ? "e.g. the razor reefs" : "e.g. the King's Road"} onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== (l.name ?? "") && (name.trim() ? set({ name: name.trim() }) : set({}, "name"))} /></label>
      <label className="field">Kind
        <select value={l.kind} onChange={(e) => set({ kind: e.target.value as MapLine["kind"] })}>
          <option value="road">Road</option>
          <option value="trail">Trail</option>
          <option value="border">Border</option>
          <option value="reef">Reef</option>
        </select>
      </label>
      {l.kind === "border" && (
        <label className="check"><input type="checkbox" checked={!!l.closed} onChange={(e) => (e.target.checked ? set({ closed: true }) : set({}, "closed"))} /> Closed (joins back to its start)</label>
      )}
      <p className="muted">
        {Math.round(miles).toLocaleString()} miles ({Math.round(km).toLocaleString()} km)
        {(l.kind === "road" || l.kind === "trail") && <> · about {(miles / 24).toFixed(1)} days on foot at 24 miles a day</>}
      </p>
      <label className="field">Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (l.notes ?? "") && set({ notes })} /></label>
      <p className="muted">Drag it with Select to move it.</p>
    </>
  );
}

const TEMP_WORDS = ["frozen", "cold", "temperate", "warm", "hot"];
const MOIST_WORDS = ["arid", "dry", "normal", "wet", "lush"];
const word = (w: string[], v: number) => w[Math.min(4, Math.round(v * 4))];

/** A climate value the region may override: a checkbox to override, a slider for how. */
function Override({ label, value, words, fallback, onChange }: {
  label: string; value: number | undefined; words?: string[]; fallback: number; onChange: (v: number | undefined) => void;
}) {
  const on = value !== undefined;
  return (
    <div className="override">
      <label className="check"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? fallback : undefined)} /> {label}</label>
      {on && (
        <Slider label="" value={value!} min={0} max={1} step={0.01} fmt={(v) => (words ? word(words, v) : `${Math.round(v * 100)}%`)} onCommit={onChange} />
      )}
    </div>
  );
}

/** The latest value, updated synchronously when changes are sent: quick changes then build on each other. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}

function RegionEditor({ r }: { r: ClimateRegion }) {
  const latest = useLatest(r);
  const [name, setName] = useState(r.name);
  const [owner, setOwner] = useState(r.owner ?? "");
  const [notes, setNotes] = useState(r.notes ?? "");
  useEffect(() => { setName(r.name); setOwner(r.owner ?? ""); setNotes(r.notes ?? ""); }, [r.id, r.name, r.owner, r.notes]);
  const set = (patch: Partial<ClimateRegion>, drop?: keyof ClimateRegion) => {
    const next = { ...latest.current, ...patch };
    if (drop) delete next[drop];
    latest.current = next;
    sendRegion(next);
  };
  const none = r.temperature === undefined && r.moisture === undefined && !r.snow && !r.rock && !r.volcanic;
  return (
    <>
      <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== r.name && set({ name: name.trim() })} /></label>
      {none && <p className="muted">This region doesn't change anything yet. Tick what it overrides:</p>}
      <Override label="Temperature" value={r.temperature} words={TEMP_WORDS} fallback={0.15} onChange={(v) => (v === undefined ? set({}, "temperature") : set({ temperature: v }))} />
      <Override label="Moisture" value={r.moisture} words={MOIST_WORDS} fallback={0.5} onChange={(v) => (v === undefined ? set({}, "moisture") : set({ moisture: v }))} />
      <Override label="Ground snow" value={r.snow} fallback={0.8} onChange={(v) => (v === undefined ? set({}, "snow") : set({ snow: v }))} />
      <Override label="Bare dark stone" value={r.rock} fallback={1} onChange={(v) => (v === undefined ? set({}, "rock") : set({ rock: v }))} />
      <Override label="Volcanic ground" value={r.volcanic} fallback={1} onChange={(v) => (v === undefined ? set({}, "volcanic") : set({ volcanic: v }))} />
      <Slider label="Strength" value={r.strength ?? 1} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set({ strength: v })} />
      <label className="field">Border
        <select value={r.border ?? "soft"} onChange={(e) => set({ border: e.target.value as "hard" | "soft" })}>
          <option value="soft">Soft (blends into the land around it)</option>
          <option value="hard">Hard (a sharp edge)</option>
        </select>
      </label>
      {(r.border ?? "soft") === "soft" && (
        <Slider label="Blend width" value={r.blendKm ?? 80} min={10} max={600} step={5} fmt={(v) => `${Math.round(v)} km`} onCommit={(v) => set({ blendKm: v })} />
      )}
      <label className="field">Held by (optional)<input value={owner} placeholder="e.g. a spirit" onChange={(e) => setOwner(e.target.value)} onBlur={() => owner !== (r.owner ?? "") && (owner.trim() ? set({ owner: owner.trim() }) : set({}, "owner"))} /></label>
      <label className="field">Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (r.notes ?? "") && set({ notes })} /></label>
      <p className="muted">Drag it with Select to move it. The map recolours about a second after each change.</p>
    </>
  );
}

const CORNERS: { id: Corner; label: string }[] = [
  { id: "top-left", label: "Top left" }, { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" }, { id: "bottom-right", label: "Bottom right" },
];

/** Title, scale bar, compass and frame. They show on the map, the phone page and in exports. Each change is undoable. */
export function ExtrasPanel({ meta }: { meta: MapMeta }) {
  const f: MapFurniture = meta.furniture ?? {};
  const [title, setTitle] = useState(f.title ?? "");
  useEffect(() => setTitle(f.title ?? ""), [f.title]);
  // build each change on the latest one sent, so two quick changes don't overwrite each other
  const latest = useRef(f);
  useEffect(() => { latest.current = meta.furniture ?? {}; }, [meta.furniture]);
  const commit = (patch: Partial<MapFurniture>) => {
    const next: MapFurniture = { ...latest.current, ...patch };
    latest.current = next;
    store.send({ t: "cmd", cmd: { op: "set_meta", patch: { furniture: next }, label: describeFurniture(next) } });
  };
  const commitTitle = () => { if (title.trim() !== (f.title ?? "")) commit({ title: title.trim() }); };
  return (
    <details className="climate" data-testid="extras-panel">
      <summary><h3>Map extras</h3></summary>
      <label className="field">Title
        <input value={title} placeholder="e.g. The Sunless Coast" data-testid="extras-title" onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />
      </label>
      {f.title?.trim() && (
        <label className="field">Title position
          <select value={f.titlePos ?? "top"} onChange={(e) => commit({ titlePos: e.target.value as "top" | "bottom" })}>
            <option value="top">Top</option><option value="bottom">Bottom</option>
          </select>
        </label>
      )}
      <label className="check"><input type="checkbox" checked={!!f.scaleBar} onChange={(e) => commit({ scaleBar: e.target.checked })} /> Scale bar</label>
      {f.scaleBar && (
        <div className="row2">
          <select value={f.scaleCorner ?? "bottom-left"} onChange={(e) => commit({ scaleCorner: e.target.value as Corner })} aria-label="Scale bar corner">
            {CORNERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select value={f.units ?? "miles"} onChange={(e) => commit({ units: e.target.value as "miles" | "km" })} aria-label="Scale bar units">
            <option value="miles">Miles</option><option value="km">Kilometres</option>
          </select>
        </div>
      )}
      <label className="check"><input type="checkbox" checked={!!f.compass} onChange={(e) => commit({ compass: e.target.checked })} /> Compass rose</label>
      {f.compass && (
        <select value={f.compassCorner ?? "top-right"} onChange={(e) => commit({ compassCorner: e.target.value as Corner })} aria-label="Compass corner">
          {CORNERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )}
      <label className="check"><input type="checkbox" checked={!!f.frame} onChange={(e) => commit({ frame: e.target.checked })} /> Frame</label>
    </details>
  );
}

const GRID_PRESETS_MI = [1, 5, 6, 12, 24, 60, 100, 200];

/** Square or hex grid over the map: type, cell size in miles, hex orientation, line strength. Each change is undoable. */
export function GridPanel({ meta }: { meta: MapMeta }) {
  const g = meta.grid;
  const widthMi = meta.width * meta.kmPerPx * MI_PER_KM;
  const type = g?.type ?? "off";
  const size = g?.sizeMi ?? niceGridSize(widthMi);
  const [text, setText] = useState(String(+size.toFixed(3)));
  useEffect(() => setText(String(+size.toFixed(3))), [size]);
  const latest = useRef<MapGrid | undefined>(g);
  useEffect(() => { latest.current = meta.grid; }, [meta.grid]);
  const commit = (patch: Partial<MapGrid>) => {
    const cur = latest.current;
    const next: MapGrid = { type: cur?.type ?? "off", sizeMi: cur?.sizeMi ?? size, orient: cur?.orient ?? "pointy", opacity: cur?.opacity ?? 0.5, ...patch };
    next.sizeMi = clampGridSize(next.sizeMi, widthMi);
    latest.current = next;
    store.send({ t: "cmd", cmd: { op: "set_meta", patch: { grid: next }, label: describeGrid(next) } });
  };
  const commitText = () => {
    const v = Number(text);
    if (!Number.isFinite(v) || v <= 0) { setText(String(+size.toFixed(3))); return; }
    // compare with what we last sent, not the (not yet echoed) prop: Enter commits and then blur would commit the same size again
    const cur = latest.current?.sizeMi ?? size;
    if (Math.abs(clampGridSize(v, widthMi) - cur) > 1e-9) commit({ sizeMi: v });
    else setText(String(+cur.toFixed(3)));
  };
  const cellPx = gridCellPx({ type: "square", sizeMi: size }, meta.kmPerPx);
  const across = widthMi / size;
  return (
    <div className="gridpanel" data-testid="grid-panel">
      <h3>Grid</h3>
      <div className="seg" role="group" aria-label="Grid type">
        {(["off", "square", "hex"] as const).map((t) => (
          <button key={t} className={type === t ? "on" : ""} onClick={() => type !== t && commit({ type: t })}>
            {t === "off" ? "Off" : t === "square" ? "Square" : "Hex"}
          </button>
        ))}
      </div>
      {type !== "off" && (
        <>
          <label className="field">{type === "hex" ? "Hex size across the flats (miles)" : "Square size (miles)"}
            <input
              type="number" min={0.1} step="any" value={text} data-testid="grid-size"
              onChange={(e) => setText(e.target.value)} onBlur={commitText}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitText(); (e.target as HTMLInputElement).blur(); } }}
            />
          </label>
          <div className="chips">
            {GRID_PRESETS_MI.filter((p) => p <= widthMi / 2).map((p) => (
              <button key={p} className={Math.abs(p - size) < 1e-6 ? "on" : ""} onClick={() => commit({ sizeMi: p })}>{p} mi</button>
            ))}
          </div>
          {type === "hex" && (
            <label className="field">Hex orientation
              <select value={g?.orient ?? "pointy"} onChange={(e) => commit({ orient: e.target.value as "pointy" | "flat" })}>
                <option value="pointy">Point on top</option>
                <option value="flat">Flat edge on top</option>
              </select>
            </label>
          )}
          <Slider label="Line strength" value={g?.opacity ?? 0.5} min={0.1} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => commit({ opacity: v })} />
          <p className="muted">One cell = {+size.toFixed(2)} mi ({cellPx.toFixed(1)} map px). About {Math.round(across)} cells across the map.</p>
          {cellPx < 12 && <p className="muted">Small cells only show once you zoom in. For cells under about 4 map px, a <b>Detail map</b> of the area (more pixels) gives cleaner results.</p>}
        </>
      )}
    </div>
  );
}

/** Climate settings for the painted style. Each slider release is one undoable change. */
export function ClimatePanel({ meta }: { meta: MapMeta }) {
  const c: ClimateParams = { ...DEFAULT_CLIMATE, ...(meta.climate ?? {}) };
  const set = (patch: Partial<ClimateParams>) =>
    store.send({ t: "cmd", cmd: { op: "set_meta", patch: { climate: { ...(meta.climate ?? {}), ...patch } }, label: "Change climate" } });
  const deg = (v: number) => `${Math.round(Math.abs(v) * 90)}°${v < 0 ? "S" : "N"}`;
  if (meta.parent) {
    // a regional map takes its climate from the map it was made from
    return (
      <details className="climate">
        <summary><h3>Climate</h3></summary>
        <p className="muted">Temperature and moisture come from {meta.parent.name}, refined by this map's finer terrain. Climate regions drawn here still apply on top.</p>
        <button onClick={() => store.send({ t: "regional_refresh" })} title="Use this after changing the parent map's climate or climate regions">Update from {meta.parent.name}</button>
        <Slider label="Snowline" value={c.snowlineM} min={500} max={6000} step={20} fmt={(v) => `${Math.round(v)} m`} onCommit={(v) => set({ snowlineM: v })} />
        <Slider label="Rivers" value={c.riverDensity} min={0} max={1} step={0.01} fmt={(v) => (v < 0.34 ? "few" : v < 0.67 ? "some" : "many")} onCommit={(v) => set({ riverDensity: v })} />
      </details>
    );
  }
  return (
    <details className="climate">
      <summary><h3>Climate</h3></summary>
      <Slider label="Top edge latitude" value={c.latTop} min={-1} max={1} step={0.01} fmt={deg} onCommit={(v) => set({ latTop: v })} />
      <Slider label="Bottom edge latitude" value={c.latBot} min={-1} max={1} step={0.01} fmt={deg} onCommit={(v) => set({ latBot: v })} />
      <label className="field">Prevailing wind
        <select value={c.wind} onChange={(e) => set({ wind: e.target.value as ClimateParams["wind"] })}>
          {WIND_NAMES.filter((w) => w !== "none").map((w) => <option key={w} value={w}>From the {w}</option>)}
          <option value="none">None (no rain shadows)</option>
        </select>
      </label>
      <Slider label="Wetness" value={c.moistureBias} min={0.1} max={1.1} step={0.01} fmt={(v) => v.toFixed(2)} onCommit={(v) => set({ moistureBias: v })} />
      <Slider label="Patchiness" value={c.moistureNoise} min={0} max={1.1} step={0.01} fmt={(v) => v.toFixed(2)} onCommit={(v) => set({ moistureNoise: v })} />
      <Slider label="Coastal wetness" value={c.coastMoisture} min={0} max={0.8} step={0.01} fmt={(v) => v.toFixed(2)} onCommit={(v) => set({ coastMoisture: v })} />
      <Slider label="Wetter toward" value={c.moistureLat} min={-1.2} max={1.2} step={0.02} fmt={(v) => (v > 0.02 ? "cold edge" : v < -0.02 ? "warm edge" : "neither")} onCommit={(v) => set({ moistureLat: v })} />
      <Slider label="Snowline" value={c.snowlineM} min={500} max={6000} step={20} fmt={(v) => `${Math.round(v)} m`} onCommit={(v) => set({ snowlineM: v })} />
      <Slider label="Snowline drop toward poles" value={c.snowLat} min={0} max={1.2} step={0.01} fmt={(v) => v.toFixed(2)} onCommit={(v) => set({ snowLat: v })} />
      <Slider label="Rivers" value={c.riverDensity} min={0} max={1} step={0.01} fmt={(v) => (v < 0.34 ? "few" : v < 0.67 ? "some" : "many")} onCommit={(v) => set({ riverDensity: v })} />
    </details>
  );
}

/** What each colour of the painted map is: every kind of ground, grouped, with where it appears. */
export function GroundLegend() {
  const groups = Array.from(new Set(GROUND_INFO.map((g) => g.group)));
  return (
    <details className="climate" data-testid="ground-legend">
      <summary><h3>Ground legend</h3></summary>
      {groups.map((grp) => (
        <div key={grp} className="legend-group">
          <h4>{grp}</h4>
          {GROUND_INFO.filter((g) => g.group === grp).map((g) => (
            <div key={g.id} className="legend-row" title={g.where}>
              <span className="legend-swatch" style={{ background: `rgb(${g.swatch.join(",")})` }} />
              <span className="legend-name">{g.name}</span>
              <span className="muted legend-where">{g.where}</span>
            </div>
          ))}
        </div>
      ))}
      <p className="muted">Colours are typical: the real ground varies with the light and the land. Names come from the temperature, moisture and height of each spot, so a spot's mix is in what {forAssistant("Claude")} reports when you select it.</p>
    </details>
  );
}
