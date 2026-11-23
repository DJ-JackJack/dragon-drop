/**
 * A place's or realm's link to the DM's own notes (core links.ts): paste a web address or note link, or choose a file (the Windows app), and Open it. Only what
 * linkProblem allows is opened, and only on a click; the Windows app checks it again (links.cjs).
 */
import { useEffect, useState } from "react";
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

export function NoteLink({ link, onChange, what = "this place" }: { link: string | undefined; onChange: (link: string | undefined) => void; what?: string }) {
  const [text, setText] = useState(link ?? "");
  useEffect(() => { setText(link ?? ""); }, [link]);
  const b = bridge();
  const commit = (v: string) => {
    const t = v.trim();
    if (t === (link ?? "")) return;
    if (t && linkProblem(t)) { store.note(linkProblem(t)!, 7000); setText(link ?? ""); return; }
    onChange(t || undefined);
  };
  return (
    <div className="note-link" data-testid="note-link">
      <label className="field" title={`Your own notes on ${what}: a web page (a wiki, a shared document), an Obsidian or OneNote note, or a file or folder on this PC`}>Your notes (a link)
        <input value={text} placeholder="https://… or a file" onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }} data-testid="note-link-input" />
      </label>
      <div className="row">
        {b?.chooseNoteFile && <button onClick={async () => { const f = await b.chooseNoteFile!(); if (f) { setText(f); commit(f); } }} data-testid="note-link-file">Choose a file…</button>}
        {link && <button className="primary" onClick={() => void openNoteLink(link)} title={link} data-testid="note-link-open">Open {linkLabel(link)} ↗</button>}
      </div>
    </div>
  );
}
