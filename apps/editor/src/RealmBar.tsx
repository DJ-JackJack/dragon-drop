/**
 * The Realm tool's settings (realmUi.ts): the realm to paint (chosen from the list, or a new one named by the DM), paint or erase, the brush, land only and
 * "round neighbours"; the list renames, recolours and removes realms, and says how big each is.
 */
import { useState, useSyncExternalStore } from "react";
import { type MapRealm, REALM_COLOURS, newFeatureId, nextRealmNumber, realmAreas, realmGridOf } from "@mapmaker/core";
import { store } from "./store.ts";
import { Popover } from "./ToolBar.tsx";
import { realmCtl, useRealmSettings } from "./realmUi.ts";

export const REALM_HINT = "Paint a realm onto the land: choose it above (or make a new one, under your own name for it), then drag. Land only keeps the sea out, so a realm stops at the coast; Round neighbours paints only land nobody has yet. Each stroke is one undo step.";

const sendRealm = (r: MapRealm, label: string) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertRealms: [r] } }, label });

export function RealmToolBar() {
  const st = useRealmSettings();
  const realms = useSyncExternalStore(store.subscribe, () => store.getState().features.realms) ?? [];
  const chosen = realms.find((r) => r.id === st.realm) ?? null;
  return (
    <>
      <Popover label={chosen ? <><span className="swatch now" style={{ background: chosen.colour }} /> <b>{chosen.name}</b></> : "Choose a realm"} title="The realm to paint" testId="realm-menu">
        {(close) => <RealmList realms={realms} chosen={st.realm} onChoose={(id) => { realmCtl.set({ realm: id, erase: false }); close(); }} />}
      </Popover>
      <div className="seg" role="group" aria-label="Paint or erase">
        <button className={st.erase ? "" : "on"} onClick={() => realmCtl.set({ erase: false })} data-testid="realm-paint">Paint</button>
        <button className={st.erase ? "on" : ""} onClick={() => realmCtl.set({ erase: true })} title="Take land away from the chosen realm (or, with none chosen, from every realm)" data-testid="realm-erase">Erase</button>
      </div>
      <label className="slider">
        <span>Brush <b>{Math.round(st.radius * 2)}</b> px across</span>
        <input type="range" min={4} max={300} value={st.radius} onChange={(e) => realmCtl.set({ radius: Number(e.target.value) })} data-testid="realm-brush" />
      </label>
      <label className="check"><input type="checkbox" checked={st.landOnly} onChange={(e) => realmCtl.set({ landOnly: e.target.checked })} /> Land only</label>
      <label className="check" title="Paint only land that belongs to no realm yet: a stroke along a neighbour fills up to its border without taking its land"><input type="checkbox" checked={st.onlyEmpty} onChange={(e) => realmCtl.set({ onlyEmpty: e.target.checked })} /> Round neighbours</label>
    </>
  );
}

/** The realms, each with its colour, size, and Rename / Remove; and a new one. */
function RealmList({ realms, chosen, onChoose }: { realms: MapRealm[]; chosen: string | null; onChoose: (id: string) => void }) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const meta = store.getState().meta, f = store.getState().features;
  const areas = meta ? realmAreas(realmGridOf({ meta, features: f }), meta.kmPerPx) : new Map();
  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    if (realms.some((r) => r.name.toLowerCase() === clean.toLowerCase())) { window.alert(`There is already a realm called "${clean}".`); return; }
    const n = nextRealmNumber(realms);
    if (n === null) { window.alert("A map can have at most 255 realms."); return; }
    const r: MapRealm = { id: newFeatureId("r"), n, name: clean, colour: REALM_COLOURS[realms.length % REALM_COLOURS.length] };
    sendRealm(r, `Add realm ${clean}`);
    setName("");
    onChoose(r.id);
  };
  const remove = (r: MapRealm) => {
    const st = store.getState(), g = realmGridOf({ meta: st.meta!, features: st.features });
    store.send({ t: "cmd", cmd: { op: "features", patch: { removeRealms: [r.id], ...(areas.get(r.n) && { setRealmCells: clearRealm(g, r.n) }) } }, label: `Remove realm ${r.name}` });
    if (chosen === r.id) realmCtl.set({ realm: null });
  };
  return (
    <div className="realm-list" data-testid="realm-list">
      {realms.map((r) => (
        <div key={r.id} className={`realm-row${r.id === chosen ? " on" : ""}`}>
          <input type="color" value={r.colour} title="Its colour" onChange={(e) => sendRealm({ ...r, colour: e.target.value }, `Colour of ${r.name}`)} />
          {renaming?.id === r.id ? (
            <input value={renaming.name} autoFocus maxLength={80} onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && renaming.name.trim()) { sendRealm({ ...r, name: renaming.name.trim() }, `Rename ${r.name} to ${renaming.name.trim()}`); setRenaming(null); } if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} />
          ) : (
            <button className="realm-pick" onClick={() => onChoose(r.id)} data-testid={`realm-${r.n}`}>
              <b>{r.name}</b> <span className="muted">{areas.get(r.n) ? `${Math.round(areas.get(r.n).km2).toLocaleString()} km²` : "not painted yet"}</span>
            </button>
          )}
          {removing === r.id ? (
            <span className="realm-actions"><button className="danger" onClick={() => { remove(r); setRemoving(null); }}>Remove</button><button onClick={() => setRemoving(null)}>Keep</button></span>
          ) : (
            <span className="realm-actions">
              <label className="check" title="For your eyes only: left out of exports for players"><input type="checkbox" checked={!!r.gmOnly} onChange={(e) => { const { gmOnly: _g, ...rest } = r; sendRealm(e.target.checked ? { ...r, gmOnly: true } : rest, e.target.checked ? `Make ${r.name} GM only` : `Show ${r.name} to players`); }} /> GM</label>
              <label className="check" title="Write its name on the map"><input type="checkbox" checked={!r.hideName} onChange={(e) => { const { hideName: _h, ...rest } = r; sendRealm(e.target.checked ? rest : { ...r, hideName: true }, e.target.checked ? `Show the name ${r.name}` : `Hide the name ${r.name}`); }} /> Name</label>
              <button onClick={() => setRenaming({ id: r.id, name: r.name })}>Rename</button>
              <button onClick={() => setRemoving(r.id)}>Remove</button>
            </span>
          )}
        </div>
      ))}
      <div className="realm-new">
        <input value={name} placeholder="New realm: its name" maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} data-testid="realm-new-name" />
        <button className="primary" disabled={!name.trim()} onClick={add} data-testid="realm-new">Add</button>
      </div>
    </div>
  );
}

/** The grid with one realm's cells cleared. */
function clearRealm(g: import("@mapmaker/core").RealmGrid, n: number) {
  const cells: number[] = [];
  for (let i = 0; i + 1 < g.cells.length; i += 2) {
    const v = g.cells[i] === n ? 0 : g.cells[i], c = g.cells[i + 1];
    if (cells.length && cells[cells.length - 2] === v) cells[cells.length - 1] += c;
    else cells.push(v, c);
  }
  return { ...g, cells };
}
