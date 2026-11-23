/** The Assets tab: browse and search the user's asset library, and pick objects to place or textures to paint with. */
import { useEffect, useRef, useState } from "react";
import { type AssetItem, PROP_PX_PER_SQUARE } from "@mapmaker/core";
import { type AssetPack, type AssetStatus, assetUrl, fetchAssetStatus, fetchAssets, fetchPacks, markAssetUsed, starAsset, tagAsset } from "./assetsApi.ts";
import { floorTextureFor } from "./floorTextures.ts";
import type { BattleUi } from "./Battle.tsx";
import type { MapMeta } from "@mapmaker/core";

const CATS: { id: string; label: string; usable: boolean; tip: string }[] = [
  { id: "objects", label: "Objects", usable: true, tip: "Furniture, trees, rubble... click one, then click the map" },
  { id: "terrain", label: "Floors", usable: true, tip: "Seamless ground textures: click one to paint with it" },
  { id: "walls", label: "Walls", usable: true, tip: "Wall pictures: click one, then draw walls with it (or choose one for a wall in the inspector)" },
  { id: "paths", label: "Paths", usable: true, tip: "Roads, tracks and streams: click one, then click the points of a path with it" },
  { id: "portals", label: "Doors", usable: true, tip: "Doors and windows: click one, then click a wall to put it there (or choose one for a door in the inspector)" },
  { id: "roofs", label: "Roofs", usable: true, tip: "Roof pictures: click one, then draw roofs with it (or choose one for a roof in its panel)" },
  { id: "patterns", label: "Patterns", usable: true, tip: "Repeating patterns: click one to paint floors with it, like a floor texture" },
  { id: "lights", label: "Lights", usable: true, tip: "Light shapes: click one, then place lights with it (or give a light that shape in its panel)" },
];

export function AssetPanel({ meta, ui, onUi, desktop, focus, onAskTags }: {
  meta: MapMeta | null; ui: BattleUi; onUi: (p: Partial<BattleUi>) => void; desktop: boolean; focus: { cat: string; n: number };
  /** Type a request into Claude Code to give a pack's pictures words (desktop app only, and only when Claude is idle). */
  onAskTags?: (pack: string, key: string, count: number) => Promise<{ ok: boolean; message: string }>;
}) {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [packs, setPacks] = useState<AssetPack[]>([]);
  const [pack, setPack] = useState("");
  const [cat, setCat] = useState("objects");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [only, setOnly] = useState<"" | "favourites" | "recent">("");
  /** The picture last clicked: its words can be read and changed at the foot of the tab. */
  const [focused, setFocused] = useState<AssetItem | null>(null);
  const [newWords, setNewWords] = useState("");
  const [askNote, setAskNote] = useState<string | null>(null);
  const saveWords = async () => {
    const words = newWords.split(",").map((w) => w.trim()).filter(Boolean);
    if (!focused || !words.length) return;
    await tagAsset(focused.id, words);
    setFocused({ ...focused, tags: [...new Set([...(focused.tags ?? []), ...words.map((w) => w.toLowerCase())])] });
    setNewWords("");
  };
  const dropWord = async (w: string) => {
    if (!focused) return;
    await tagAsset(focused.id, [w], true);
    setFocused({ ...focused, tags: (focused.tags ?? []).filter((t) => t !== w) });
  };
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const seq = useRef(0);

  useEffect(() => { setCat(focus.cat); }, [focus.n]);
  useEffect(() => { const t = window.setTimeout(() => setQ(text.trim()), 250); return () => window.clearTimeout(t); }, [text]);

  // status (and the pack list once scanning has finished)
  useEffect(() => {
    let alive = true, last = "";
    const poll = async () => {
      const st = await fetchAssetStatus().catch(() => null);
      if (!alive || !st) return;
      setStatus(st);
      const key = `${st.configured}:${st.scanning}:${st.packs}`;
      if (st.configured && key !== last) { last = key; fetchPacks().then((p) => alive && setPacks(p)).catch(() => {}); }
    };
    void poll();
    const t = window.setInterval(poll, 2000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const load = async (offset: number) => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const r = await fetchAssets({ pack, cat, q, offset, limit: 60, ...(only && { only }) });
      if (mine !== seq.current) return;
      setTotal(r.total);
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };
  useEffect(() => { if (status?.configured) void load(0); }, [pack, cat, q, only, status?.configured, status?.scanning, status?.usablePacks]);
  const starred = (it: AssetItem) => stars[it.id] ?? !!it.favourite;
  const toggleStar = (it: AssetItem) => { const on = !starred(it); setStars((st) => ({ ...st, [it.id]: on })); void starAsset(it.id, on); };

  const pick = (it: AssetItem) => {
    setNote(null);
    void markAssetUsed(it.id);
    setFocused(it);
    if (it.cat === "objects" || it.cat === "other") { onUi({ asset: it.id, tool: "prop", propScale: 1, propRotation: 0 }); return; }
    if (it.cat === "terrain" || it.cat === "patterns") { useAsFloor(it); return; }
    if (it.cat === "walls") { onUi({ tool: "wall", wallAsset: it.id }); return; }
    if (it.cat === "portals") { onUi(/window|shutter/i.test(it.path) ? { tool: "window", windowPicture: it.id } : { tool: "door", doorPicture: it.id }); return; }
    if (it.cat === "paths") { onUi({ tool: "path", pathAsset: it.id }); return; }
    if (it.cat === "roofs") { onUi({ tool: "roof", roofAsset: it.id, asset: it.id }); return; }
    if (it.cat === "lights") { onUi({ tool: "light", lightGlow: it.id }); return; }
    setNote("This kind of picture can't be used on a battlemap.");
  };

  const useAsFloor = (it: AssetItem) => {
    const r = floorTextureFor(meta, it);
    if ("problem" in r) { setNote(r.problem); return; }
    onUi({ material: r.id, tool: "brush" });
  };

  if (status && !status.configured) {
    return (
      <div className="chat assets-panel" data-testid="assets-panel">
        <div className="chat-head"><span className="chat-title">Assets</span></div>
        <div className="assets-empty">
          <p>No asset folder is set up yet.</p>
          {desktop
            ? <p className="muted">Open <b>Settings</b> (top right) and choose the folder that holds your assets: folders of pictures (PNG, JPEG or WebP), <code>.zip</code> files or asset pack files, in any mix. They're read where they are, never copied.</p>
            : <p className="muted">Set <code>MAPMAKER_ASSETS_DIR</code> in the <code>.env</code> file to the folder that holds your assets (pictures, <code>.zip</code> files or asset packs), then restart.</p>}
        </div>
      </div>
    );
  }
  const present = (c: string) => packs.some((p) => !p.restricted && !p.supersededBy && (p.categories[c] ?? 0) > 0);
  const sel = items.find((i) => i.id === ui.asset);
  return (
    <div className="chat assets-panel" data-testid="assets-panel">
      <div className="chat-head">
        <span className="chat-title">Assets</span>
        <span className="muted" style={{ flex: 1 }} data-testid="assets-count">
          {status?.scanning ? `Reading assets… ${status.scanned}/${status.total}` : `${total.toLocaleString()} found`}
        </span>
      </div>
      <div className="assets-controls">
        <input placeholder="Search: table, torch, oak…" value={text} onChange={(e) => setText(e.target.value)} data-testid="assets-search" />
        <select value={pack} onChange={(e) => setPack(e.target.value)} data-testid="assets-pack">
          <option value="">All packs</option>
          {packs.filter((p) => !p.restricted && !p.supersededBy).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        <div className="seg pack-only" role="group" aria-label="Which of them" data-testid="assets-only">
          {([["", "All"], ["favourites", "★ Starred"], ["recent", "Recent"]] as const).map(([id, label]) => (
            <button key={id || "all"} className={only === id ? "on" : ""} onClick={() => setOnly(id)} title={id === "favourites" ? "Only the pictures you starred (right-click a picture to star it)" : id === "recent" ? "The pictures you used most recently" : "Every picture"} data-testid={`assets-only-${id || "all"}`}>{label}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Kind of asset">
          {CATS.filter((c) => c.usable || present(c.id)).map((c) => (
            <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)} title={c.tip} data-testid={`assets-cat-${c.id}`}>{c.label}</button>
          ))}
        </div>
      </div>
      <div className="assets-grid" data-testid="assets-grid">
        {items.map((it) => (
          <button key={`${it.id}`} className={`asset ${ui.asset === it.id ? "on" : ""}${starred(it) ? " starred" : ""}`} onClick={() => pick(it)} onContextMenu={(e) => { e.preventDefault(); toggleStar(it); }} title={`${starred(it) ? "★ " : ""}${it.name}\n${it.packName}${it.w ? `\n${it.w} × ${it.h} px (${Math.round((it.w / PROP_PX_PER_SQUARE) * 10) / 10} × ${Math.round(((it.h ?? 0) / PROP_PX_PER_SQUARE) * 10) / 10} squares)` : ""}${it.tags ? `\n${it.tags.join(", ")}` : ""}`} data-testid="asset-item">
            <img loading="lazy" src={assetUrl(it.id, 160)} alt={it.name} />
            <span>{starred(it) ? "★ " : ""}{it.name}</span>
          </button>
        ))}
        {!busy && items.length === 0 && <p className="muted assets-none">{only === "favourites" ? "No starred pictures of this kind yet: right-click a picture to star it." : only === "recent" ? "None of this kind used yet." : status?.scanning ? "Still reading your assets…" : "Nothing found. Try another word, or all packs."}</p>}
        {items.length < total && <button className="ghost assets-more" onClick={() => void load(items.length)} disabled={busy}>{busy ? "Loading…" : `Show more (${(total - items.length).toLocaleString()} left)`}</button>}
      </div>
      <div className="assets-foot">
        {focused && (
          <div className="asset-words" data-testid="asset-words">
            <p className="muted"><b>{focused.name}</b>: {focused.tags?.length ? "" : "no words yet."}</p>
            {!!focused.tags?.length && (
              <div className="chips">{focused.tags.map((w) => <button key={w} onClick={() => void dropWord(w)} title="Take this word away" data-testid="asset-word">{w} ×</button>)}</div>
            )}
            <form className="row" onSubmit={(e) => { e.preventDefault(); void saveWords(); }}>
              <input placeholder="Add words: round table, oak…" value={newWords} onChange={(e) => setNewWords(e.target.value)} spellCheck={false} data-testid="asset-words-input" />
              <button type="submit" disabled={!newWords.trim()} title="Searches find the picture by these words too (they stay on this PC)" data-testid="asset-words-add">Add</button>
            </form>
          </div>
        )}
        {onAskTags && pack && (
          <div className="row">
            <button onClick={() => { const p = packs.find((k) => k.key === pack); if (p) void onAskTags(p.name, p.key, p.files).then((r) => setAskNote(r.message)); }}
              title="Claude looks at the pack's pictures and gives each words for what it shows, so searches find them" data-testid="assets-ask-tags">Ask Claude to tag this pack</button>
            {askNote && <span className="muted">{askNote}</span>}
          </div>
        )}
        {note && <p className="muted">{note}</p>}
        {ui.asset && <p className="muted" data-testid="assets-selected">Object chosen: <b>{sel?.name ?? ui.asset.split("/").pop()}</b>. Click the map to place it.</p>}
        {meta?.kind !== "battle" && <p className="muted">Open a battlemap to use these.</p>}
      </div>
    </div>
  );
}
