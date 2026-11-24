/**
 * The battlemap's object layers (core objectLayers.ts) in the Map panel: listed top to bottom like other map programs, each with an eye (hidden layers are
 * drawn nowhere: not here, in exports or on the player screen), a lock (its objects can't be clicked), how many objects it holds, up and down, rename and
 * remove (its objects go to the bottom layer). Clicking a layer makes it the one new objects go into.
 */
import { useState, useSyncExternalStore } from "react";
import { type Features, type MapLayer, layerCounts, newFeatureId } from "@mapmaker/core";
import { store } from "./store.ts";
import type { BattleUi } from "./Battle.tsx";

const setLayers = (layers: MapLayer[], label: string, extra: Record<string, unknown> = {}) =>
  store.send({ t: "cmd", cmd: { op: "features", patch: { setLayers: layers, ...extra } }, label });

export function ObjectLayers({ features, ui, onUi }: { features: Features; ui: BattleUi; onUi: (p: Partial<BattleUi>) => void }) {
  const layers = features.layers ?? [], counts = layerCounts(features);
  // (a layer chosen on another level or map isn't here: new objects go into the bottom layer)
  const active = layers.some((l) => l.id === ui.activeLayer) ? ui.activeLayer : null;
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const l: MapLayer = { id: newFeatureId("h"), name: n };
    setLayers([...layers, l], `Add object layer ${n}`);
    onUi({ activeLayer: l.id });
    store.note(`New objects now go into ${n}. Choose an object in the Assets tab, then click the map with the Object tool.`, 6000);
    setName("");
  };
  const change = (id: string, patch: Partial<MapLayer>, label: string) => setLayers(layers.map((l) => (l.id === id ? clean({ ...l, ...patch }) : l)), label);
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= layers.length) return;
    const next = [...layers];
    [next[i], next[j]] = [next[j], next[i]];
    setLayers(next, `Move layer ${layers[i].name} ${by > 0 ? "up" : "down"}`);
  };
  const remove = (l: MapLayer) => {
    const props = (features.props ?? []).filter((p) => p.layerId === l.id).map(({ layerId: _x, ...p }) => p);
    setLayers(layers.filter((x) => x.id !== l.id), `Remove object layer ${l.name}`, props.length ? { upsertProps: props } : {});
    if (ui.activeLayer === l.id) onUi({ activeLayer: null });
  };
  const row = (l: MapLayer | null, i: number) => {
    const id = l?.id ?? null, on = active === id;
    return (
      <div key={id ?? "bottom"} className={`olayer${on ? " on" : ""}`} data-testid={`olayer-${l ? l.name : "bottom"}`}>
        {l ? (
          <>
            <label className="check eye" title={l.hidden ? "Hidden: drawn nowhere (not in exports either)" : "Shown"}><input type="checkbox" checked={!l.hidden} onChange={(e) => change(l.id, { hidden: !e.target.checked }, `${e.target.checked ? "Show" : "Hide"} layer ${l.name}`)} aria-label={`Show ${l.name}`} /></label>
            <button className={`olayer-lock${l.locked ? " on" : ""}`} onClick={() => change(l.id, { locked: !l.locked }, `${l.locked ? "Unlock" : "Lock"} layer ${l.name}`)} title={l.locked ? "Locked: its objects can't be clicked or moved" : "Lock it"} aria-pressed={!!l.locked}>{l.locked ? "🔒" : "🔓"}</button>
          </>
        ) : <span className="olayer-pad" />}
        {l && renaming?.id === l.id ? (
          <input value={renaming.name} autoFocus maxLength={60} onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && renaming.name.trim()) { change(l.id, { name: renaming.name.trim() }, `Rename layer ${l.name}`); setRenaming(null); } if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} />
        ) : (
          <button className="olayer-name" onClick={() => onUi({ activeLayer: id })} onDoubleClick={() => l && setRenaming({ id: l.id, name: l.name })} title={on ? "New objects go into this layer" : "Put new objects into this layer (double-click to rename)"}>
            {l ? l.name : "Objects"} <span className="muted">{counts.get(id ?? "") ?? 0}</span>{on && <span className="olayer-new"> ✎ new</span>}
          </button>
        )}
        {l && (
          <span className="olayer-actions">
            <button onClick={() => move(i, 1)} disabled={i === layers.length - 1} title="Up: drawn over the layers below">▲</button>
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Down">▼</button>
            <button onClick={() => remove(l)} title="Remove the layer (its objects stay, in the bottom layer)">✕</button>
          </span>
        )}
      </div>
    );
  };
  return (
    <div className="olayers" data-testid="object-layers">
      <h3>Object layers</h3>
      {/* (top to bottom, as other map programs list them) */}
      {[...layers].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => row(l, i))}
      {row(null, -1)}
      <div className="row">
        <input value={name} placeholder="New layer: its name" maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} data-testid="olayer-new-name" />
        <button onClick={add} disabled={!name.trim()} data-testid="olayer-new">Add</button>
      </div>
    </div>
  );
}

/** A layer's optional flags left out when off (so files stay small). */
function clean(l: MapLayer): MapLayer {
  const { hidden, locked, ...rest } = l;
  return { ...rest, ...(hidden && { hidden: true }), ...(locked && { locked: true }) };
}

/** Choose an object layer (the bottom one: undefined). */
export function LayerSelect({ value, onChange, label = "Object layer" }: { value: string | undefined; onChange: (layerId: string | undefined) => void; label?: string }) {
  const layers = useSyncExternalStore(store.subscribe, () => store.getState().features.layers) ?? [];
  if (!layers.length) return null;
  return (
    <label className="field">{label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} data-testid="prop-object-layer">
        {value === undefined && label !== "Object layer" && <option value="" disabled>Choose…</option>}
        <option value="">Objects (the bottom layer)</option>
        {[...layers].reverse().map((l) => <option key={l.id} value={l.id}>{l.name}{l.hidden ? " (hidden)" : ""}</option>)}
      </select>
    </label>
  );
}
