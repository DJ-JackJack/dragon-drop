/**
 * The DM's side of maps that know about each other: the Map panel's "Other maps" section (where this map came from, Duplicate this map…, Compare with…), the compare
 * bar over the map while comparing (Fade, Swipe, Side by side; compare.ts draws the other map over this one), and the side-by-side window.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { MapMeta, ProjectInfo } from "@mapmaker/core";
import { ask } from "./dialogs.tsx";
import { type CompareMode, compareCtl } from "./compare.ts";
import { store } from "./store.ts";

const kindWord = (k: string | undefined) => (k === "battle" ? "battlemap" : k === "city" ? "settlement map" : "map");

/** The Map panel's section: what this map is a copy of, copying it, and comparing it with another map. */
export function OtherMaps({ meta, projects }: { meta: MapMeta; projects: ProjectInfo[] }) {
  const cmp = useSyncExternalStore(compareCtl.subscribe, compareCtl.getState);
  const others = projects.filter((p) => p.id !== meta.id);
  // the maps most likely to be compared first: its original, its copies, what it was made from and what was made from it
  const near = (p: ProjectInfo) => p.id === meta.copiedFrom?.id || p.copiedFrom?.id === meta.id || p.id === meta.parent?.id || p.parent?.id === meta.id || p.id === meta.origin?.id || p.origin?.id === meta.id;
  const sorted = [...others.filter(near), ...others.filter((p) => !near(p))];
  const copy = async () => {
    const name = await ask(`Name of the copy of "${meta.name}" (to change it: the same place before and after; the original stays as it is):`, `${meta.name} (after)`, "Make the copy");
    if (name?.trim()) store.send({ t: "duplicate_project", name: name.trim() });
  };
  const original = meta.copiedFrom && projects.find((p) => p.id === meta.copiedFrom!.id);
  return (
    <section data-testid="other-maps">
      <h3>Other maps</h3>
      {meta.copiedFrom && (
        <p className="muted" data-testid="copied-from">
          A copy of <b>{meta.copiedFrom.name}</b>{original ? "" : " (that map is no longer there)"}.
          {original && <> <button className="link" onClick={() => compareCtl.start(original.id)} data-testid="compare-original">Compare with it</button> · <button className="link" onClick={() => store.send({ t: "open_project", id: original.id })}>Open it</button></>}
        </p>
      )}
      <div className="row">
        <button onClick={() => void copy()} title="Copy this map (everything on it, every level) to make a changed version: a farmhouse before and after a fire, a town before and after a siege" data-testid="duplicate-map">Duplicate this {kindWord(meta.kind)}…</button>
      </div>
      {others.length > 0 && (
        <label className="field">Compare with
          <select value={cmp.id ?? ""} onChange={(e) => (e.target.value ? compareCtl.start(e.target.value) : compareCtl.stop())} data-testid="compare-with">
            <option value="">(another map)</option>
            {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === meta.copiedFrom?.id ? " (its original)" : p.copiedFrom?.id === meta.id ? " (a copy of it)" : near(p) ? " (linked)" : ""}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

/** Over the map while comparing: which map, how to look (Fade, Swipe, Side by side), the slider, Stop. */
export function CompareBar({ meta }: { meta: MapMeta }) {
  const s = useSyncExternalStore(compareCtl.subscribe, compareCtl.getState);
  // a comparison belongs to the map it was started on
  useEffect(() => { if (compareCtl.state.on && compareCtl.state.on !== meta.id) compareCtl.stop(); }, [meta.id]);
  useEffect(() => {
    if (!s.id) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("input, textarea, .xterm")) compareCtl.stop(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [s.id]);
  if (!s.id || s.on !== meta.id) return null;
  const mode = (m: CompareMode, label: string, title: string) => (
    <button className={s.mode === m ? "on" : ""} disabled={m !== "side" && !s.rect} onClick={() => compareCtl.setMode(m)} title={title} data-testid={`compare-${m}`}>{label}</button>
  );
  return (
    <>
      <div className="trace-bar compare-bar" data-testid="compare-bar">
        <div className="trace-row">
          <span className="trace-name" title={s.how.join(". ")}>Comparing with <b>{s.name || "…"}</b></span>
          <button className="trace-stop" onClick={() => compareCtl.stop()} title="Stop comparing (Esc)" data-testid="compare-stop">✕ Stop</button>
          {mode("fade", "Fade", "The other map see-through over this one")}
          {mode("swipe", "Swipe", "The other map on the left of a line, this one on the right: move the line with the slider")}
          {mode("side", "Side by side", "Both maps next to each other")}
          {s.mode !== "side" && s.rect && (
            <label className="trace-opacity" title={s.mode === "fade" ? "How solid the other map is" : "Where the line is"}>
              <span>{s.mode === "fade" ? "Other map" : "Line"}</span>
              <input type="range" min={0} max={100} step={1} value={Math.round(s.amount * 100)} onChange={(e) => compareCtl.setAmount(Number(e.target.value) / 100)} data-testid="compare-amount" />
            </label>
          )}
          {(s.waiting || s.loading) && <span className="muted">Drawing the other map…</span>}
        </div>
        {!s.waiting && (
          <div className="trace-row trace-help muted" data-testid="compare-how">
            {s.rect ? (s.how.length ? s.how.join(". ") + "." : "") : "These two maps aren't linked (neither was made from the other), so they can only be shown side by side."}
          </div>
        )}
      </div>
      {s.mode === "side" && !s.waiting && <SideBySide meta={meta} otherId={s.id} otherName={s.name} />}
    </>
  );
}

/** Both maps next to each other, whole. */
function SideBySide({ meta, otherId, otherName }: { meta: MapMeta; otherId: string; otherName: string }) {
  // closing goes back to Fade when the maps can be laid over each other, else it ends the comparison
  const close = () => { if (compareCtl.state.rect) compareCtl.setMode("fade"); else compareCtl.stop(); };
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal compare-side" role="dialog" aria-modal="true" data-testid="compare-side-window" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{meta.name} and {otherName}</h2>
        <div className="compare-pics">
          <figure><img src={compareCtl.pictureUrl(meta.id, 1600)} alt={meta.name} /><figcaption>{meta.name} (open)</figcaption></figure>
          <figure><img src={compareCtl.pictureUrl(otherId, 1600)} alt={otherName} data-testid="compare-side-other" /><figcaption>{otherName}</figcaption></figure>
        </div>
        <div className="row end"><button onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
