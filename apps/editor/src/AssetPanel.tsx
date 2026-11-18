/** The Assets tab: browse and search the user's asset library, and pick objects to place or textures to paint with. */
import { useEffect, useRef, useState } from "react";
import { type AssetItem, CUSTOM_MATERIAL_BASE, PROP_PX_PER_SQUARE, defaultTileSquares } from "@mapmaker/core";
import { type AssetPack, type AssetStatus, assetUrl, fetchAssetStatus, fetchAssets, fetchPacks } from "./assetsApi.ts";
import type { BattleUi } from "./Battle.tsx";
import { store } from "./store.ts";
import type { MapMeta } from "@mapmaker/core";

const CATS: { id: string; label: string; usable: boolean; tip: string }[] = [
  { id: "objects", label: "Objects", usable: true, tip: "Furniture, trees, rubble... click one, then click the map" },
  { id: "terrain", label: "Floors", usable: true, tip: "Seamless ground textures: click one to paint with it" },
  { id: "walls", label: "Walls", usable: false, tip: "Wall styles (browse only for now)" },
  { id: "paths", label: "Paths", usable: false, tip: "Path styles (browse only for now)" },
  { id: "portals", label: "Doors", usable: false, tip: "Doors and windows (browse only for now)" },
  { id: "roofs", label: "Roofs", usable: false, tip: "Roof patterns (browse only for now)" },
  { id: "patterns", label: "Patterns", usable: false, tip: "Colourable patterns (browse only for now)" },
  { id: "lights", label: "Lights", usable: false, tip: "Light shapes (browse only for now)" },
];

export function AssetPanel({ meta, ui, onUi, desktop, focus }: { meta: MapMeta | null; ui: BattleUi; onUi: (p: Partial<BattleUi>) => void; desktop: boolean; focus: { cat: string; n: number } }) {
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
      const r = await fetchAssets({ pack, cat, q, offset, limit: 60 });
      if (mine !== seq.current) return;
      setTotal(r.total);
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };
  useEffect(() => { if (status?.configured) void load(0); }, [pack, cat, q, status?.configured, status?.scanning, status?.usablePacks]);

  const pick = (it: AssetItem) => {
    setNote(null);
    if (it.cat === "objects" || it.cat === "other") { onUi({ asset: it.id, tool: "prop", propScale: 1, propRotation: 0 }); return; }
    if (it.cat === "terrain") { useAsFloor(it); return; }
    setNote("Only objects and floor textures can be used so far. Walls, paths, doors, roofs and patterns are on the way.");
  };

  const useAsFloor = (it: AssetItem) => {
    const spec = meta?.battle;
    if (!spec) { setNote("Open a battlemap first."); return; }
    const palette = spec.palette ?? [];
    let entry = palette.find((e) => e.asset.toLowerCase() === it.id.toLowerCase());
    if (!entry) {
      let name = it.name, n = 2;
      while (palette.some((e) => e.name.toLowerCase() === name.toLowerCase())) name = `${it.name} ${n++}`;
      entry = { id: Math.max(CUSTOM_MATERIAL_BASE - 1, ...palette.map((e) => e.id)) + 1, name, asset: it.id, squares: defaultTileSquares(it.w) };
      store.send({ t: "cmd", cmd: { op: "set_meta", patch: { battle: { ...spec, palette: [...palette, entry] } }, label: `Add floor texture ${name}` } });
    }
    onUi({ material: entry.id, tool: "brush" });
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
        <div className="chips" role="group" aria-label="Kind of asset">
          {CATS.filter((c) => c.usable || present(c.id)).map((c) => (
            <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)} title={c.tip} data-testid={`assets-cat-${c.id}`}>{c.label}</button>
          ))}
        </div>
      </div>
      <div className="assets-grid" data-testid="assets-grid">
        {items.map((it) => (
          <button key={`${it.id}`} className={`asset ${ui.asset === it.id ? "on" : ""}`} onClick={() => pick(it)} title={`${it.name}\n${it.packName}${it.w ? `\n${it.w} × ${it.h} px (${Math.round((it.w / PROP_PX_PER_SQUARE) * 10) / 10} × ${Math.round(((it.h ?? 0) / PROP_PX_PER_SQUARE) * 10) / 10} squares)` : ""}${it.tags ? `\n${it.tags.join(", ")}` : ""}`} data-testid="asset-item">
            <img loading="lazy" src={assetUrl(it.id, 160)} alt={it.name} />
            <span>{it.name}</span>
          </button>
        ))}
        {!busy && items.length === 0 && <p className="muted assets-none">{status?.scanning ? "Still reading your assets…" : "Nothing found. Try another word, or all packs."}</p>}
        {items.length < total && <button className="ghost assets-more" onClick={() => void load(items.length)} disabled={busy}>{busy ? "Loading…" : `Show more (${(total - items.length).toLocaleString()} left)`}</button>}
      </div>
      <div className="assets-foot">
        {note && <p className="muted">{note}</p>}
        {ui.asset && <p className="muted" data-testid="assets-selected">Object chosen: <b>{sel?.name ?? ui.asset.split("/").pop()}</b>. Click the map to place it.</p>}
        {meta?.kind !== "battle" && <p className="muted">Open a battlemap to use these.</p>}
      </div>
    </div>
  );
}
