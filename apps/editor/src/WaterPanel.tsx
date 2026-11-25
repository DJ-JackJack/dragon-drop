/**
 * Named rivers and lakes in the editor: the Map panel's Rivers and lakes section (the names, lowland rivers, carving valleys), the box that names a river or lake picked
 * with the River tool, and the inspector's editors for a named river or lake and for a river source.
 */
import { useEffect, useState } from "react";
import { type Features, type MapMeta, type RiverSize, type RiverSource, type Selection, type WaterName, newFeatureId, withNameSize } from "@mapmaker/core";
import { NameSizeSlider } from "./NameSize.tsx";
import { confirmBox } from "./dialogs.tsx";
import { type AppState, store } from "./store.ts";
import { type WaterPick, describeWater } from "./waterUi.ts";

export const RIVER_SIZE_NAMES: { id: RiverSize; label: string }[] = [
  { id: "stream", label: "Stream" }, { id: "river", label: "River" }, { id: "major", label: "Major river" }, { id: "great", label: "Great river" },
];

const sendName = (w: WaterName, label: string) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertWaterNames: [w] }, label } });

/** The Map panel's section: the named rivers and lakes, lowland rivers, and carving valleys. */
export function WaterSection({ meta, features, water, carving, selectedId, selection, onPick }: {
  meta: MapMeta; features: Features; water: AppState["water"]; carving: boolean; selectedId: string | null; selection: Selection | null; onPick: (id: string) => void;
}) {
  const names = features.waterNames ?? [];
  const lowland = !!meta.climate?.lowlandRivers;
  const [carveOpen, setCarveOpen] = useState(false);
  return (
    <section data-testid="water-section">
      <h3>Rivers and lakes</h3>
      <div className="places" data-testid="water-names">
        {names.length === 0 && <p className="muted">The Rivers tool (I) adds rivers (drag to draw one, or click to start one) and names them (Name and select: point at a river or lake and click). Rivers come from the land and the rain, so a name follows its river when the land changes.</p>}
        {[...names].sort((a, b) => a.name.localeCompare(b.name)).map((w) => {
          const n = water?.named.find((x) => x.id === w.id);
          const what = !n ? w.kind : !n.found ? `${w.kind}, not found` : w.kind === "river" ? `river · ${Math.round((n.lengthKm ?? 0) * 0.621371).toLocaleString()} mi` : `lake · ${Math.round((n.areaKm2 ?? 0) * 0.386102).toLocaleString()} sq mi`;
          return (
            <button key={w.id} className={`place-row ${selectedId === w.id ? "on" : ""}`} onClick={() => onPick(w.id)}>
              <span>{w.name}</span><span className="muted">{what}</span>
            </button>
          );
        })}
      </div>
      <label className="check" title="Big rivers on flat ground wander in wide loops, with oxbow lakes beside them, and widen into estuaries at the sea. Every river is worked out again.">
        <input
          type="checkbox" data-testid="lowland-rivers" checked={lowland}
          onChange={(e) => store.send({ t: "cmd", cmd: { op: "set_meta", patch: { climate: { ...(meta.climate ?? {}), lowlandRivers: e.target.checked } }, label: e.target.checked ? "Lowland rivers: wide loops and oxbow lakes" : "Lowland rivers off" } })}
        /> Lowland rivers (wide loops, oxbow lakes, estuaries)
      </label>
      <div className="row">
        <button onClick={() => setCarveOpen(true)} disabled={carving} data-testid="carve-valleys">{carving ? "Carving valleys…" : "Carve valleys…"}</button>
      </div>
      {carveOpen && <CarveDialog onClose={() => setCarveOpen(false)} where={carveTarget(selection, features)} />}
    </section>
  );
}

/** What the selection lets a carving be held to: an area (or a climate region), one river (a named river, or a river source's river), or nothing. */
export function carveTarget(sel: Selection | null, f: Features): { kind: "area" } | { kind: "river"; name: string } | null {
  if (!sel) return null;
  if (sel.kind === "area" || (sel.kind === "feature" && sel.featureKind === "region")) return { kind: "area" };
  if (sel.kind === "feature" && sel.featureKind === "water") {
    const w = f.waterNames?.find((x) => x.id === sel.id);
    return w?.kind === "river" ? { kind: "river", name: w.name } : null;
  }
  if (sel.kind === "feature" && sel.featureKind === "source") {
    const s = f.sources?.find((x) => x.id === sel.id);
    return s ? { kind: "river", name: s.name ?? "the river from the selected source" } : null;
  }
  return null;
}

function CarveDialog({ onClose, where: target }: { onClose: () => void; where: ReturnType<typeof carveTarget> }) {
  const [strength, setStrength] = useState(0.5);
  const [floodplains, setFloodplains] = useState(true);
  const [deltas, setDeltas] = useState(true);
  const [where, setWhere] = useState<"map" | "selection">(target ? "selection" : "map");
  const go = () => { store.carve({ strength, floodplains, deltas, where }); onClose(); };
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" data-testid="carve-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Carve valleys along the rivers</h2>
        <p className="muted">
          Cuts the land along the rivers into valleys: deeper and wider for big rivers, a narrow V where a river drops steeply, a broad flat floor where a big river crosses low ground.
          A checkpoint is saved first, and Undo takes it back.
        </p>
        <fieldset data-testid="carve-where">
          <legend>Where</legend>
          <label className="check"><input type="radio" name="carve-where" checked={where === "map"} onChange={() => setWhere("map")} data-testid="carve-where-map" /> The whole map</label>
          <label className="check">
            <input type="radio" name="carve-where" checked={where === "selection"} disabled={!target} onChange={() => setWhere("selection")} data-testid="carve-where-selection" />
            {" "}{target?.kind === "river" ? `Only along ${target.name}` : "Only in the selected area (the edge fades out)"}
          </label>
          {!target && <p className="muted">To carve only part of the map, select an area with the Select area tool first, or a river with the Rivers tool (Name and select).</p>}
        </fieldset>
        <label className="slider">
          <span>Depth and width <b>{Math.round(strength * 100)}%</b></span>
          <input type="range" min={10} max={100} value={Math.round(strength * 100)} onChange={(e) => setStrength(Number(e.target.value) / 100)} data-testid="carve-strength" />
        </label>
        <label className="check"><input type="checkbox" checked={floodplains} onChange={(e) => setFloodplains(e.target.checked)} /> Floodplains (flat valley floors for big rivers on low ground)</label>
        <label className="check"><input type="checkbox" checked={deltas} onChange={(e) => setDeltas(e.target.checked)} /> Deltas (new low land where big rivers meet the sea)</label>
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={go} data-testid="carve-go">Carve valleys</button>
        </div>
      </div>
    </div>
  );
}

/** The River tool picked a river or lake that has no name: name it (the facts about it are shown). */
export function WaterNameBox({ pick, onClose, onNamed }: { pick: WaterPick; onClose: () => void; onNamed: (id: string) => void }) {
  const [name, setName] = useState("");
  const save = () => {
    const n = name.trim();
    if (!n) return;
    const id = newFeatureId("w");
    sendName({ id, kind: pick.kind, name: n, x: Math.round(pick.x * 10) / 10, y: Math.round(pick.y * 10) / 10 }, `Name the ${pick.kind} ${n}`);
    onNamed(id);
  };
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" data-testid="water-name-box" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{pick.kind === "river" ? "A river" : "A lake"}</h2>
        <p className="muted" data-testid="water-facts">{describeWater(pick)}</p>
        <label>Name<input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} data-testid="water-name-input" /></label>
        <p className="muted">The name is drawn along the river (or in the lake) and follows it when the land changes.</p>
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!name.trim()} data-testid="water-name-save">Name it</button>
        </div>
      </div>
    </div>
  );
}

/** The inspector for a named river or lake: rename it, see what it is now, take the name off. */
export function WaterEditor({ w, water }: { w: WaterName; water: AppState["water"] }) {
  const [name, setName] = useState(w.name);
  useEffect(() => setName(w.name), [w.id, w.name]);
  const n = water?.named.find((x) => x.id === w.id);
  return (
    <>
      <label className="field">Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== w.name && sendName({ ...w, name: name.trim() }, `Rename the ${w.kind} ${w.name} to ${name.trim()}`)} data-testid="water-rename" /></label>
      <NameSizeSlider value={w.nameSize} onCommit={(v) => sendName(withNameSize(w, v), `Name size of the ${w.kind} ${w.name}`)} testid="water-name-size" />
      <p className="muted" data-testid="water-inspector-facts">
        {!n ? "Working out the rivers…" : !n.found ? `No ${w.kind} is at its spot now (the land or the rain changed). Name it again with the River tool, or remove the name.` : describeWater({ ...n, end: n.end === "elsewhere" ? "edge" : n.end })}
      </p>
      <p className="muted">Rivers and lakes come from the land and the rain: to change one, reshape the land, or draw a river with the Rivers tool (Add a river).</p>
    </>
  );
}

/** The inspector for a river source: how much water it adds, or remove it. */
export function SourceEditor({ s, features }: { s: RiverSource; features: Features }) {
  const at = s.placeId ? features.places.find((p) => p.id === s.placeId) : undefined;
  return (
    <>
      <label className="field">Size
        <select value={s.size} onChange={(e) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertSources: [{ ...s, size: e.target.value as RiverSize }] }, label: "Change a river source's size" } })} data-testid="source-size">
          {RIVER_SIZE_NAMES.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      <p className="muted">{at ? `At ${at.name}: it moves with the place.` : `At x ${Math.round(s.x ?? 0)} · y ${Math.round(s.y ?? 0)}.`} A source adds water where the land alone couldn't supply it (a great spring, a waterfall fed from beyond the map); the river runs downhill from there.</p>
      {s.notes && <p className="muted">{s.notes}</p>}
    </>
  );
}

/** Delete with a question: the water name or the river source. */
export function deleteWaterThing(f: Features, id: string): boolean {
  const w = f.waterNames?.find((x) => x.id === id);
  if (w) { store.send({ t: "cmd", cmd: { op: "features", patch: { removeWaterNames: [id] }, label: `Remove the name of the ${w.kind} ${w.name}` } }); return true; }
  const s = f.sources?.find((x) => x.id === id);
  if (s) {
    void confirmBox("Remove this river source? The river it fed shrinks to what its own land supplies, or disappears.", "Remove").then((yes) => {
      if (yes) store.send({ t: "cmd", cmd: { op: "features", patch: { removeSources: [id] }, label: "Remove a river source" } });
    });
    return true;
  }
  return false;
}
