/**
 * The References panel: the map's reference pictures (sketches, maps found elsewhere, pictures for inspiration), which the DM and
 * Claude both look at, and the ways to add one. Pictures are also added by dropping or pasting them anywhere in the window (App).
 */
import { useEffect, useRef, useState } from "react";
import { type RefInfo, REFERENCE_PICTURE_ACCEPT, REFERENCE_PICTURE_MAX_BYTES } from "@mapmaker/core";
import { ask, confirmBox } from "./dialogs.tsx";
import { store } from "./store.ts";

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const describe = (r: RefInfo) => `${r.w && r.h ? `${r.w} × ${r.h} px · ` : ""}${size(r.bytes)}`;
const stem = (name: string) => name.replace(/\.(png|jpe?g|webp)$/i, "");

/** What the Add picture button and the drop note say a picture can be. */
export const PICTURE_RULE = `PNG, JPEG or WebP, up to ${REFERENCE_PICTURE_MAX_BYTES / 1048576} MB`;

export function References({ refs, worldMap, addedAt, tracing, onTrace, onMakeTerrain, onAskClaude }: {
  refs: RefInfo[];
  /** The picture laid over the map (or this battlemap level) to trace, if any. */
  tracing?: string;
  onTrace: (r: RefInfo) => void;
  /** World maps can turn a drawing into terrain; battlemaps can't. */
  worldMap: boolean;
  /** Changes when pictures have just been added (the panel scrolls into view). */
  addedAt: number;
  onMakeTerrain: (r: RefInfo) => void;
  /** Only in the desktop app, where Claude Code runs in the terminal panel. */
  onAskClaude?: (r: RefInfo) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLElement>(null);
  const [viewing, setViewing] = useState<RefInfo | null>(null);
  useEffect(() => { if (addedAt) section.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [addedAt]);
  useEffect(() => { if (viewing && !refs.some((r) => r.name === viewing.name)) setViewing(null); }, [refs, viewing]);

  const rename = (r: RefInfo) => {
    void ask("New name for this picture:", stem(r.name), "Rename").then((to) => {
      if (to && to.trim() && to.trim() !== stem(r.name)) store.renamePicture(r.name, to.trim());
    });
  };
  const remove = (r: RefInfo) => {
    void confirmBox(`Remove "${r.name}" from References? It is moved to the map's backups folder, so it isn't lost.`, "Remove").then((yes) => {
      if (yes) store.removePicture(r.name);
    });
  };

  return (
    <section ref={section} data-testid="references">
      <div className="section-head">
        <h3>References</h3>
        <button className="small" onClick={() => input.current?.click()} title={`Add a sketch, a map or any picture (${PICTURE_RULE})`} data-testid="ref-add">Add picture…</button>
      </div>
      <input
        ref={input} type="file" accept={REFERENCE_PICTURE_ACCEPT} multiple hidden data-testid="ref-file"
        onChange={(e) => { if (e.target.files?.length) void store.addPictures([...e.target.files]); e.target.value = ""; }}
      />
      {refs.length === 0 ? (
        <p className="muted">Sketches, maps and pictures for inspiration, for you and Claude to look at. Add one with the button, or drop or paste a picture anywhere in the window.</p>
      ) : (
        <>
          <div className="ref-list">
            {refs.map((r) => (
              <div key={r.name} className="ref-card" data-testid="ref-card">
                <button className="ref-thumb" onClick={() => setViewing(r)} title="Look at it full size"><img src={r.url} alt="" loading="lazy" /></button>
                <div className="ref-name" title={r.name}>{r.name}</div>
                <div className="ref-meta muted">{describe(r)}</div>
                <div className="ref-actions">
                  <button disabled={tracing === r.name} onClick={() => onTrace(r)} title={tracing === r.name ? "This picture is over the map: line it up with the trace bar under the map" : "Lay this picture over the map, see-through, to redraw the map on top of it"} data-testid="ref-trace">{tracing === r.name ? "Tracing" : "Trace over map"}</button>
                  {worldMap && <button onClick={() => onMakeTerrain(r)} title="Turn this drawing into terrain" data-testid="sketch-open">Make terrain…</button>}
                  {onAskClaude && <button onClick={() => onAskClaude(r)} title="Ask Claude Code, in the terminal panel, about this picture" data-testid="ref-ask">Ask Claude…</button>}
                  <button onClick={() => rename(r)} data-testid="ref-rename">Rename</button>
                  <button onClick={() => remove(r)} data-testid="ref-remove">Remove</button>
                </div>
              </div>
            ))}
          </div>
          <p className="muted hint">Drop or paste a picture anywhere in the window to add it.</p>
        </>
      )}
      {viewing && <PictureViewer r={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

/** One reference picture as big as the window allows. Esc, a click outside it or Close shuts it. */
function PictureViewer({ r, onClose }: { r: RefInfo; onClose: () => void }) {
  // (attached once: a listener swapped on every render can be taken off in the middle of a real key press, when an earlier keydown
  // handler makes React redraw before this one's turn comes, and then Escape does nothing)
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div className="picture-viewer" role="dialog" aria-label={r.name} onClick={onClose} data-testid="picture-viewer">
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={r.url} alt={r.name} />
        <figcaption>
          <span className="ref-name">{r.name}</span>
          <span className="muted">{describe(r)}</span>
          <button onClick={onClose} autoFocus>Close</button>
        </figcaption>
      </figure>
    </div>
  );
}
