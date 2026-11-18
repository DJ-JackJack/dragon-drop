import { ClaudeCard } from "./ClaudeButton.tsx";
import { confirmBox } from "./dialogs.tsx";
import { useEffect, useRef, useState } from "react";
import { type ChatItem, type Effort, type ModelId, MODEL_PRICES } from "@mapmaker/core";
import { Markdown } from "./Markdown.tsx";
import { type AppState, store } from "./store.ts";

interface Pending {
  name: string;
  mediaType: string;
  data: string; // base64
  preview: string; // object URL
}

const TOOL_LABELS: Record<string, string> = {
  render_preview: "Looked at the map",
  view_reference: "Looked at a reference",
  add_landmass: "Added land",
  add_mountain_range: "Added a mountain range",
  sculpt: "Sculpted terrain",
  generate_terrain: "Generated terrain",
  create_map: "Created a map",
  get_map_summary: "Checked the map",
  get_changes_since: "Checked recent edits",
  get_brief: "Read the brief",
  update_brief: "Updated the brief",
  query_points: "Measured elevations",
  set_sea_level: "Changed sea level",
  undo: "Undid a change",
  redo: "Redid a change",
  list_references: "Listed references",
  list_projects: "Listed projects",
  open_project: "Opened a project",
  erode: "Eroded the terrain",
  set_style: "Changed the map style",
  set_climate: "Changed the climate",
  save_checkpoint: "Saved a checkpoint",
  list_checkpoints: "Listed checkpoints",
  restore_checkpoint: "Restored a checkpoint",
  compare_to_reference: "Compared with a reference",
  add_place: "Added a place",
  update_place: "Updated a place",
  remove_place: "Removed a place",
  list_places: "Listed places",
  add_label: "Added a label",
  update_label: "Updated a label",
  remove_label: "Removed a label",
  list_labels: "Listed labels",
  export_gazetteer: "Wrote the gazetteer",
};

export function ChatPanel({ s }: { s: AppState }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [s.chat]);

  async function addFiles(files: FileList | File[]) {
    const out: Pending[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      out.push({ name: f.name || "pasted-image.png", mediaType: f.type, data, preview: URL.createObjectURL(f) });
    }
    setPending((p) => [...p, ...out].slice(0, 8));
  }

  function send() {
    if (s.chatBusy || (!text.trim() && !pending.length)) return;
    store.send({ t: "chat_send", text: text.trim(), images: pending.map(({ name, mediaType, data }) => ({ name, mediaType, data })) });
    pending.forEach((p) => URL.revokeObjectURL(p.preview));
    setText("");
    setPending([]);
    stick.current = true;
  }

  const price = MODEL_PRICES[s.chatSettings.model];

  return (
    <aside
      className={`chat ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
    >
      <div className="chat-head">
        <div className="chat-title">Claude</div>
        <select
          value={s.chatSettings.model}
          onChange={(e) => store.send({ t: "chat_settings", settings: { model: e.target.value as ModelId } })}
          title="Model"
        >
          {(Object.keys(MODEL_PRICES) as ModelId[]).map((m) => <option key={m} value={m}>{MODEL_PRICES[m].label}</option>)}
        </select>
        <select
          value={s.chatSettings.effort}
          onChange={(e) => store.send({ t: "chat_settings", settings: { effort: e.target.value as Effort } })}
          title="Effort: how hard Claude thinks (higher costs more)"
        >
          <option value="low">Low effort</option>
          <option value="medium">Medium effort</option>
          <option value="high">High effort</option>
        </select>
        <span className="cost" title={`${s.usage.inputTokens.toLocaleString()} in · ${s.usage.cacheReadTokens.toLocaleString()} cached · ${s.usage.outputTokens.toLocaleString()} out\n${price.label}: $${price.input}/$${price.output} per M tokens`}>
          ${s.usage.costUsd.toFixed(2)}
        </span>
        <button className="ghost" onClick={() => { void confirmBox("Start a new conversation? The map and brief stay as they are.", "New conversation").then((yes) => { if (yes) store.send({ t: "chat_reset" }); }); }} title="New conversation">New</button>
      </div>

      {!s.apiKeyConfigured && (window.dragonDrop ? <ClaudeCard /> : (
        <div className="banner">
          In-app chat needs an Anthropic API key. Add <code>ANTHROPIC_API_KEY=…</code> to the <code>.env</code> file in the project folder and restart.
          {" "}Until then, you can use Claude Code with the map tools (see <code>docs/SETUP-WINDOWS.md</code>).
        </div>
      ))}

      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {s.chat.length === 0 && (
          <div className="chat-empty">
            <p>Describe what you want to build, drop in a sketch or reference image, or paint on the map and ask Claude what to do next.</p>
            <p className="hint">Try: “Add a chain of volcanic islands along the east coast” or “Make the northern range taller and snowier.”</p>
          </div>
        )}
        {s.chat.map((it) => <Item key={it.id} it={it} />)}
        {s.chatBusy && <div className="working"><span className="dot" /><span className="dot" /><span className="dot" /></div>}
      </div>

      {pending.length > 0 && (
        <div className="pending">
          {pending.map((p, i) => (
            <div key={p.preview} className="thumb">
              <img src={p.preview} alt={p.name} />
              <button onClick={() => { URL.revokeObjectURL(p.preview); setPending((x) => x.filter((_, j) => j !== i)); }} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="composer">
        <button className="ghost attach" onClick={() => fileRef.current?.click()} title="Attach images (or drag & drop / paste)">📎</button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <textarea
          value={text}
          placeholder={s.chatBusy ? "Claude is working…" : "Message Claude (Enter to send, Shift+Enter for a new line)"}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) { e.preventDefault(); void addFiles(files); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          data-testid="chat-input"
        />
        {s.chatBusy
          ? <button className="stop" onClick={() => store.send({ t: "chat_stop" })}>Stop</button>
          : <button className="send" onClick={send} disabled={!text.trim() && !pending.length}>Send</button>}
      </div>
    </aside>
  );
}

function Item({ it }: { it: ChatItem }) {
  const [open, setOpen] = useState(false);
  switch (it.kind) {
    case "user":
      return (
        <div className="msg user">
          {it.images.length > 0 && (
            <div className="msg-images">
              {it.images.map((im) => <a key={im.url} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt={im.name ?? ""} /></a>)}
            </div>
          )}
          {it.text && <div className="msg-text">{it.text}</div>}
        </div>
      );
    case "assistant":
      return (
        <div className="msg assistant">
          {it.thinking ? (
            <details className="thinking">
              <summary>Thinking</summary>
              <div>{it.thinking}</div>
            </details>
          ) : null}
          {it.text ? <Markdown text={it.text} /> : null}
        </div>
      );
    case "tool":
      return (
        <div className={`tool ${it.status}`}>
          <button className="tool-head" onClick={() => setOpen(!open)}>
            <span className="tool-icon">{it.status === "running" ? "◌" : it.status === "error" ? "!" : "✓"}</span>
            {TOOL_LABELS[it.name] ?? it.name}
            <span className="tool-name">{it.name}</span>
          </button>
          {it.images?.map((im) => (
            <a key={im.url} href={im.url} target="_blank" rel="noreferrer" className="tool-image"><img src={im.url} alt="preview" /></a>
          ))}
          {open && (
            <div className="tool-body">
              <pre>{JSON.stringify(it.input, null, 1)}</pre>
              {it.result && <pre className="result">{it.result}</pre>}
            </div>
          )}
        </div>
      );
    case "notice":
      return <div className={`notice ${it.level}`}>{it.text}</div>;
  }
}
