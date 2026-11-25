/**
 * The Prefab tool's settings (core prefabs.ts): Place puts down a saved prefab (chosen from pictures, turned with Q and E, mirrored with X), Save drags a rectangle over
 * a piece of the map and names it. The prefabs are the DM's, kept beside the maps; Rename and Remove are here (removing moves the files to Prefabs/Removed).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PrefabInfo } from "@mapmaker/core";
import { store } from "./store.ts";
import { Popover } from "./ToolBar.tsx";
import type { BattleUi } from "./Battle.tsx";

/** The prefab's picture (it changes when the prefab is saved again). */
export const prefabPictureUrl = (p: Pick<PrefabInfo, "id" | "savedAt">) => `/api/prefabs/${p.id}.png?v=${encodeURIComponent(p.savedAt)}`;

const pictures = new Map<string, HTMLImageElement>();
/** The prefab's picture for drawing on the map, once it has loaded (`onLoad` is called then). */
export function prefabPicture(p: PrefabInfo, onLoad: () => void): HTMLImageElement | null {
  if (!p.picture) return null;
  const url = prefabPictureUrl(p);
  let img = pictures.get(url);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = url;
    pictures.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** The size of a prefab after turning, and where its top-left corner goes with the pointer at its middle (squares, kept inside the map). */
export function prefabSpot(p: PrefabInfo, turn: number, at: { x: number; y: number }, map: { squaresX: number; squaresY: number }) {
  const swap = turn === 90 || turn === 270, w = swap ? p.h : p.w, h = swap ? p.w : p.h;
  const x = Math.min(map.squaresX - w, Math.max(0, Math.round(at.x - w / 2))), y = Math.min(map.squaresY - h, Math.max(0, Math.round(at.y - h / 2)));
  return { x, y, w, h };
}

export const PREFAB_HINT_PLACE = "Click to place the chosen prefab: its floor, walls, doors, objects and lights come with it, as one undo step. Q and E turn it a quarter, X mirrors it.";
export const PREFAB_HINT_SAVE = "Drag a rectangle over a room, building or camp, then name it: everything inside (floor, walls, doors, objects, lights, stairs, roofs; walls across its edge are cut there) is saved to place again, on any battlemap.";

export function PrefabToolBar({ ui, onUi }: { ui: BattleUi; onUi: (p: Partial<BattleUi>) => void }) {
  const prefabs = useSyncExternalStore(store.subscribe, () => store.getState().prefabs);
  const ask = useSyncExternalStore(store.subscribe, () => store.getState().prefabAsk);
  const saved = useSyncExternalStore(store.subscribe, () => store.getState().prefabSaved);
  const [name, setName] = useState("");
  useEffect(() => { if (prefabs === null) store.send({ t: "prefabs_list" }); }, [prefabs]);
  // once saved: back to placing, with the new one chosen (as it was saved: not turned)
  useEffect(() => { if (saved) { onUi({ prefabDraft: null, prefabMode: "place", prefab: saved.id, prefabTurn: 0, prefabMirror: false }); setName(""); } }, [saved?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = prefabs?.find((p) => p.id === ui.prefab) ?? null;
  const d = ui.prefabDraft;
  const save = (replace = false) => {
    if (!d || !name.trim()) return;
    store.send({ t: "prefab_save", name: name.trim(), rect: d, ...(replace && { replace: true }) });
    if (replace) store.clearPrefabAsk();
  };
  return (
    <>
      <div className="seg" role="group" aria-label="Prefab mode">
        <button className={ui.prefabMode === "place" ? "on" : ""} onClick={() => onUi({ prefabMode: "place", prefabDraft: null })} data-testid="prefab-mode-place">Place</button>
        <button className={ui.prefabMode === "save" ? "on" : ""} onClick={() => onUi({ prefabMode: "save" })} data-testid="prefab-mode-save">Save</button>
      </div>
      {ui.prefabMode === "place" && (
        <>
          <Popover label={chosen ? <>Prefab: <b>{chosen.name}</b></> : "Choose a prefab"} title="The prefabs you have saved" testId="prefab-menu">
            {(close) => <PrefabList list={prefabs ?? []} chosen={ui.prefab} onChoose={(id) => { onUi({ prefab: id }); close(); }} />}
          </Popover>
          <button onClick={() => onUi({ prefabTurn: ((ui.prefabTurn + 270) % 360) as BattleUi["prefabTurn"] })} title="Turn it a quarter to the left (Q)" data-testid="prefab-turn-left">↺</button>
          <button onClick={() => onUi({ prefabTurn: ((ui.prefabTurn + 90) % 360) as BattleUi["prefabTurn"] })} title="Turn it a quarter to the right (E)" data-testid="prefab-turn-right">↻</button>
          <label className="check"><input type="checkbox" checked={ui.prefabMirror} onChange={(e) => onUi({ prefabMirror: e.target.checked })} data-testid="prefab-mirror" /> Mirror (X)</label>
          <span className="muted">{chosen ? `${ui.prefabTurn ? `turned ${ui.prefabTurn}°, ` : ""}${chosen.what}` : prefabs?.length ? "" : "None saved yet: choose Save and drag over what to keep."}</span>
        </>
      )}
      {ui.prefabMode === "save" && !d && <span className="muted">Drag a rectangle over what to save.</span>}
      {ui.prefabMode === "save" && d && !ask && (
        <>
          <label className="field">Save the {d.w} × {d.h} squares as
            <input value={name} autoFocus maxLength={60} placeholder="Guard post" onChange={(e) => setName(e.target.value)} data-testid="prefab-name"
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onUi({ prefabDraft: null }); }} />
          </label>
          <button className="primary" disabled={!name.trim()} onClick={() => save()} data-testid="prefab-save">Save prefab</button>
          <button onClick={() => onUi({ prefabDraft: null })}>Cancel</button>
        </>
      )}
      {ui.prefabMode === "save" && d && ask && (
        <>
          <span>There is already a prefab called <b>{ask.name}</b>.</span>
          <button className="danger" onClick={() => save(true)} data-testid="prefab-replace">Replace it</button>
          <button onClick={() => store.clearPrefabAsk()}>Choose another name</button>
        </>
      )}
    </>
  );
}

/** The saved prefabs, with their pictures; each can be renamed or put aside. */
function PrefabList({ list, chosen, onChoose }: { list: PrefabInfo[]; chosen: string | null; onChoose: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const skipped = useSyncExternalStore(store.subscribe, () => store.getState().prefabsSkipped);
  if (!list.length) return <p className="muted prefab-none">No prefabs yet. Choose <b>Save</b>, drag a rectangle over a room, building or camp, and name it.</p>;
  const q = filter.trim().toLowerCase();
  const shown = q ? list.filter((p) => p.name.toLowerCase().includes(q) || p.what.toLowerCase().includes(q)) : list;
  return (
    <div className="prefab-list" data-testid="prefab-list">
      {list.length > 8 && <input className="prefab-filter" placeholder="Find a prefab" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />}
      {shown.map((p) => (
        <div key={p.id} className={`prefab-row${p.id === chosen ? " on" : ""}`}>
          <button className="prefab-pick" onClick={() => onChoose(p.id)} title={`${p.what}${p.from ? `, saved from ${p.from}` : ""}`} data-testid={`prefab-${p.id}`}>
            {p.picture ? <img src={prefabPictureUrl(p)} alt="" /> : <span className="prefab-nopic" />}
            <span><b>{p.name}</b><br /><span className="muted">{p.what}</span></span>
          </button>
          {renaming?.id === p.id ? (
            <span className="prefab-actions">
              <input value={renaming.name} autoFocus maxLength={60} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && renaming.name.trim()) { store.send({ t: "prefab_rename", id: p.id, name: renaming.name.trim() }); setRenaming(null); } if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} />
            </span>
          ) : removing === p.id ? (
            <span className="prefab-actions">
              <button className="danger" onClick={() => { store.send({ t: "prefab_remove", id: p.id }); setRemoving(null); }} data-testid="prefab-remove-confirm">Remove</button>
              <button onClick={() => setRemoving(null)}>Keep</button>
            </span>
          ) : (
            <span className="prefab-actions">
              <button onClick={() => setRenaming({ id: p.id, name: p.name })} title="Rename it">Rename</button>
              <button onClick={() => setRemoving(p.id)} title="Take it out of the list (its files are moved to the Prefabs/Removed folder, not erased)">Remove</button>
            </span>
          )}
        </div>
      ))}
      {skipped.length > 0 && <p className="muted">Not shown (can't be read): {skipped.join(", ")}</p>}
    </div>
  );
}
