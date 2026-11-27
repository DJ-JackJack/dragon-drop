/**
 * The Realm tool's settings (realmUi.ts): the realm to paint (chosen from the list, or a new one named by the DM), paint or erase, the brush, land only and
 * "round neighbours"; the list renames, recolours and removes realms, and says how big each is.
 */
import { useState, useSyncExternalStore } from "react";
import { type MapRealm, REALM_COLOURS, newFeatureId, nextRealmNumber, realmAreas, realmGridOf, withNameSize } from "@mapmaker/core";
import { NameSizeSlider } from "./NameSize.tsx";
import { store } from "./store.ts";
import { Popover } from "./ToolBar.tsx";
import { realmCtl, useRealmSettings } from "./realmUi.ts";
import { NoteLink, openNoteLink } from "./NoteLink.tsx";
import { ask } from "./dialogs.tsx";
import { BrushSize, across, half } from "./BrushSize.tsx";

export const REALM_HINT = "Paint a realm onto the land: choose it above (or make one with + New realm, under your own name for it), then drag. Land only keeps the sea out, so a realm stops at the coast; Round neighbours paints only land nobody has yet. Each stroke is one undo step.";

const sendRealm = (r: MapRealm, label: string) => store.send({ t: "cmd", cmd: { op: "features", patch: { upsertRealms: [r] } }, label });

/** A new realm under the DM's name for it (the next free number and colour), or why not; chosen to paint with. */
function addRealm(realms: MapRealm[], name: string): string | null {
  const clean = name.trim();
  if (!clean) return "A realm needs a name.";
  if (realms.some((r) => r.name.toLowerCase() === clean.toLowerCase())) return `There is already a realm called "${clean}".`;
  const n = nextRealmNumber(realms);
  if (n === null) return "A map can have at most 255 realms.";
  const r: MapRealm = { id: newFeatureId("r"), n, name: clean, colour: REALM_COLOURS[realms.length % REALM_COLOURS.length] };
  sendRealm(r, `Add realm ${clean}`);
  realmCtl.set({ realm: r.id, erase: false });
  return null;
}

export function RealmToolBar() {
  const st = useRealmSettings();
  const realms = useSyncExternalStore(store.subscribe, () => store.getState().features.realms) ?? [];
  const chosen = realms.find((r) => r.id === st.realm) ?? null;
  return (
    <>
      <Popover label={chosen ? <><span className="swatch now" style={{ background: chosen.colour }} /> <b>{chosen.name}</b></> : realms.length ? "Choose a realm" : "No realms yet"} title="The realm to paint, and the list of realms (colour, name, rename, remove)" testId="realm-menu">
        {(close) => <RealmList realms={realms} chosen={st.realm} onChoose={(id) => { realmCtl.set({ realm: id, erase: false }); close(); }} />}
      </Popover>
      <button
        className={realms.length ? "" : "primary"} title="Make a new realm under your own name for it, and paint with it"
        onClick={async () => { const name = await ask("Name of the new realm:", "", "Add realm"); if (name) { const why = addRealm(realms, name); if (why) window.alert(why); } }}
        data-testid="realm-add"
      >+ New realm</button>
      <div className="seg" role="group" aria-label="Paint or erase">
        <button className={st.erase ? "" : "on"} onClick={() => realmCtl.set({ erase: false })} data-testid="realm-paint">Paint</button>
        <button className={st.erase ? "on" : ""} onClick={() => realmCtl.set({ erase: true })} title="Take land away from every realm under the brush (or, with Only ticked, from the chosen realm alone)" data-testid="realm-erase">Erase</button>
      </div>
      {st.erase && chosen && (
        <label className="check" title="Erase only this realm's land, leaving other realms under the brush as they are">
          <input type="checkbox" checked={st.eraseOnly} onChange={(e) => realmCtl.set({ eraseOnly: e.target.checked })} data-testid="realm-erase-only" /> Only {chosen.name}
        </label>
      )}
      <BrushSize label="Brush" value={st.radius} min={2} max={300} show={across} unshow={half} unit="px across" testId="realm-brush" title="How wide the brush is, in map pixels. [ and ] change it too."
        onChange={(v) => realmCtl.set({ radius: v })} />
      <label className="check"><input type="checkbox" checked={st.landOnly} onChange={(e) => realmCtl.set({ landOnly: e.target.checked })} /> Land only</label>
      {!st.erase && <label className="check" title="Paint only land that belongs to no realm yet: a stroke along a neighbour fills up to its border without taking its land"><input type="checkbox" checked={st.onlyEmpty} onChange={(e) => realmCtl.set({ onlyEmpty: e.target.checked })} /> Round neighbours</label>}
    </>
  );
}

/** The realms, each with its colour, size, and Rename / Remove; and a new one. */
function RealmList({ realms, chosen, onChoose }: { realms: MapRealm[]; chosen: string | null; onChoose: (id: string) => void }) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [sizing, setSizing] = useState<string | null>(null);
  const meta = store.getState().meta, f = store.getState().features;
  const areas = meta ? realmAreas(realmGridOf({ meta, features: f }), meta.kmPerPx) : new Map();
  const add = () => {
    if (!name.trim()) return;
    const why = addRealm(realms, name);
    if (why) { window.alert(why); return; }
    setName("");
  };
  const rename = (r: MapRealm) => {
    const clean = renaming?.name.trim();
    if (!clean) return;
    if (clean !== r.name) {
      if (realms.some((o) => o.id !== r.id && o.name.toLowerCase() === clean.toLowerCase())) { window.alert(`There is already a realm called "${clean}".`); return; }
      sendRealm({ ...r, name: clean }, `Rename ${r.name} to ${clean}`);
    }
    setRenaming(null);
  };
  const remove = (r: MapRealm) => {
    const st = store.getState(), g = realmGridOf({ meta: st.meta!, features: st.features });
    store.send({ t: "cmd", cmd: { op: "features", patch: { removeRealms: [r.id], ...(areas.get(r.n) && { setRealmCells: clearRealm(g, r.n) }) } }, label: `Remove realm ${r.name}` });
    if (chosen === r.id) realmCtl.set({ realm: null });
  };
  return (
    <div className="realm-list" data-testid="realm-list">
      {realms.map((r) => (
        <div key={r.id} className="realm-item">
        <div className={`realm-row${r.id === chosen ? " on" : ""}`}>
          <input type="color" value={r.colour} title="Its colour" onChange={(e) => sendRealm({ ...r, colour: e.target.value }, `Colour of ${r.name}`)} />
          {renaming?.id === r.id ? (
            // (renaming: the name box and its own Save and Cancel, in place of the other buttons, so none is pushed off the list)
            <>
              <input className="realm-rename" value={renaming.name} autoFocus maxLength={80} onChange={(e) => setRenaming({ id: r.id, name: e.target.value })} data-testid="realm-rename"
                onKeyDown={(e) => { if (e.key === "Enter") rename(r); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} />
              <span className="realm-actions">
                <button className="primary" disabled={!renaming.name.trim()} onClick={() => rename(r)} data-testid="realm-rename-save">Save</button>
                <button onClick={() => setRenaming(null)}>Cancel</button>
              </span>
            </>
          ) : (
            <button className="realm-pick" onClick={() => onChoose(r.id)} data-testid={`realm-${r.n}`}>
              <b>{r.name}</b> <span className="muted">{areas.get(r.n) ? `${Math.round(areas.get(r.n).km2).toLocaleString()} km²` : "not painted yet"}</span>
            </button>
          )}
          {renaming?.id === r.id ? null : removing === r.id ? (
            <span className="realm-actions"><button className="danger" onClick={() => { remove(r); setRemoving(null); }}>Remove</button><button onClick={() => setRemoving(null)}>Keep</button></span>
          ) : (
            <span className="realm-actions">
              <label className="check" title="For your eyes only: left out of exports for players"><input type="checkbox" checked={!!r.gmOnly} onChange={(e) => { const { gmOnly: _g, ...rest } = r; sendRealm(e.target.checked ? { ...r, gmOnly: true } : rest, e.target.checked ? `Make ${r.name} GM only` : `Show ${r.name} to players`); }} /> GM</label>
              <label className="check" title="Write its name on the map"><input type="checkbox" checked={!r.hideName} onChange={(e) => { const { hideName: _h, ...rest } = r; sendRealm(e.target.checked ? rest : { ...r, hideName: true }, e.target.checked ? `Show the name ${r.name}` : `Hide the name ${r.name}`); }} /> Name</label>
              {r.link && <button onClick={() => void openNoteLink(r.link!)} title={`Open your notes: ${r.link}`}>Notes ↗</button>}
              {!r.hideName && <button onClick={() => setSizing(sizing === r.id ? null : r.id)} aria-expanded={sizing === r.id} title="How big its name is written on the map" data-testid={`realm-size-${r.n}`}>Size</button>}
              <button onClick={() => setLinking(linking === r.id ? null : r.id)} title="Link it to your own notes (a web page or a file)">Link</button>
              <button onClick={() => setRenaming({ id: r.id, name: r.name })}>Rename</button>
              <button onClick={() => setRemoving(r.id)}>Remove</button>
            </span>
          )}
        </div>
        {sizing === r.id && !r.hideName && <NameSizeSlider value={r.nameSize} onCommit={(v) => sendRealm(withNameSize(r, v), `Name size of ${r.name}`)} testid="realm-name-size" />}
        {linking === r.id && <NoteLink link={r.link} what={r.name} onChange={(link) => { const { link: _l, ...rest } = r; sendRealm(link ? { ...r, link } : rest, link ? `Link ${r.name} to notes` : `Unlink ${r.name}`); }} />}
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
