/**
 * A place's or realm's link to the DM's own notes (core links.ts): paste a web address or note link, or choose a file (the Windows app), and Open it. Only what
 * linkProblem allows is opened, and only on a click; the Windows app checks it again (links.cjs).
 */
import { useEffect, useRef, useState } from "react";
import { linkLabel, linkProblem } from "@mapmaker/core";
import { store } from "./store.ts";

type Bridge = { openLink?: (l: string) => Promise<{ ok: boolean; why?: string }>; chooseNoteFile?: () => Promise<string | null> };
const bridge = () => (window as unknown as { dragonDrop?: Bridge }).dragonDrop;

/** Open a note link: in the Windows app, in the person's own program; in a browser, a web page in a new tab. */
export async function openNoteLink(link: string): Promise<void> {
  const why = linkProblem(link);
  if (why) { store.note(why, 7000); return; }
  const b = bridge();
  if (b?.openLink) {
    const r = await b.openLink(link);
    if (!r.ok) store.note(r.why ?? "That link couldn't be opened.", 7000);
    return;
  }
  if (/^https?:/i.test(link.trim())) window.open(link.trim(), "_blank", "noopener,noreferrer");
  else store.note("Files and note links open from the Windows app.", 6000);
}

/**
 * The link box. It keeps what was typed on Enter, when it loses focus, when a link is pasted, and when it goes away (the realm list closes on a click on the
 * map, with no blur: the playtest's realm link was lost that way), and shows Open as soon as the typed link is one it can open.
 */
export function NoteLink({ link, onChange, what = "this place" }: { link: string | undefined; onChange: (link: string | undefined) => void; what?: string }) {
  const [text, setText] = useState(link ?? "");
  useEffect(() => { setText(link ?? ""); }, [link]);
  const b = bridge();
  // what was last sent (so a box closed before the map answers doesn't send it twice), and the latest text and props for when the box goes away
  const sent = useRef<string | null>(null);
  const latest = useRef({ text, link, onChange });
  latest.current = { text, link, onChange };
  const commit = (v: string) => {
    const t = v.trim();
    if (t === (link ?? "") || t === sent.current) return;
    if (t && linkProblem(t)) { store.note(linkProblem(t)!, 7000); setText(link ?? ""); return; }
    sent.current = t;
    onChange(t || undefined);
  };
  useEffect(() => () => {
    const { text: v, link: l, onChange: send } = latest.current, t = v.trim();
    if (t !== (l ?? "") && t !== sent.current && (!t || !linkProblem(t))) send(t || undefined);
  }, []);
  const typed = text.trim(), openable = typed && !linkProblem(typed) ? typed : link;
  return (
    <div className="note-link" data-testid="note-link">
      <label className="field" title={`Your own notes on ${what}: a web page (a wiki, a shared document), an Obsidian or OneNote note, or a file or folder on this PC`}>Your notes (a link)
        <input value={text} placeholder="https://… or a file" onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
          onPaste={(e) => { const el = e.currentTarget; setTimeout(() => commit(el.value), 0); }} data-testid="note-link-input" />
      </label>
      <div className="row">
        {b?.chooseNoteFile && <button onClick={async () => { const f = await b.chooseNoteFile!(); if (f) { setText(f); commit(f); } }} data-testid="note-link-file">Choose a file…</button>}
        {openable && <button className="primary" onClick={() => { if (openable !== link) commit(openable); void openNoteLink(openable); }} title={openable} data-testid="note-link-open">Open {linkLabel(openable)} ↗</button>}
      </div>
    </div>
  );
}
