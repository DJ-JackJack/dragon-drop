/** The floor picker's part for the asset packs: every floor texture in the packs, searched and by pack; a click adds it to the map and paints with it. */
import { useEffect, useRef, useState } from "react";
import type { AssetItem, MapMeta } from "@mapmaker/core";
import { type AssetPack, type AssetStatus, assetUrl, fetchAssetStatus, fetchAssets, fetchPacks } from "./assetsApi.ts";
import { floorTextureFor } from "./floorTextures.ts";

const PAGE = 48;

export function PackFloors({ meta, current, onChosen, onBrowse }: { meta: MapMeta | null; current: number; onChosen: (material: number) => void; onBrowse: () => void }) {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [packs, setPacks] = useState<AssetPack[]>([]);
  const [pack, setPack] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    void fetchAssetStatus().then((st) => {
      if (!alive) return;
      setStatus(st);
      if (st.configured) void fetchPacks().then((p) => alive && setPacks(p.filter((k) => !k.restricted && !k.supersededBy && (k.categories.terrain ?? 0) > 0))).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => { const t = window.setTimeout(() => setQ(text.trim()), 250); return () => window.clearTimeout(t); }, [text]);

  const load = async (offset: number) => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const r = await fetchAssets({ cat: "terrain", pack, q, offset, limit: PAGE });
      if (mine !== seq.current) return;
      setTotal(r.total);
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    } catch { /* the server is busy or gone: the picker stays as it was */ } finally {
      if (mine === seq.current) setBusy(false);
    }
  };
  useEffect(() => { if (status?.configured) void load(0); }, [status?.configured, pack, q]);

  if (!status) return null;
  if (!status.configured) {
    return <p className="muted pack-floors-note" data-testid="pack-floors-none">To paint with the floors in your asset packs, choose your asset folder in Settings (Maps and assets).</p>;
  }
  const onMap = new Map((meta?.battle?.palette ?? []).map((e) => [e.asset.toLowerCase(), e.id]));
  const choose = (it: AssetItem) => {
    const r = floorTextureFor(meta, it);
    if ("problem" in r) { setProblem(r.problem); return; }
    onChosen(r.id);
  };
  return (
    <div className="pack-floors" data-testid="pack-floors">
      <div className="pack-floors-head">
        <b>From your asset packs</b>
        <span className="muted">{status.scanning ? "reading…" : `${total.toLocaleString()} floor${total === 1 ? "" : "s"}`}</span>
        <button className="ghost" onClick={onBrowse} title="Open the Assets tab, with bigger pictures">Browse</button>
      </div>
      <div className="pack-floors-find">
        <input placeholder="Search: grass, cobble, planks…" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="pack-floors-search" autoFocus />
        {packs.length > 1 && (
          <select value={pack} onChange={(e) => setPack(e.target.value)} title="Which pack" data-testid="pack-floors-pack">
            <option value="">Every pack</option>
            {packs.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.categories.terrain})</option>)}
          </select>
        )}
      </div>
      {problem && <p className="error-text">{problem}</p>}
      <div className="materials pack-floor-grid" data-testid="pack-floors-grid">
        {items.map((it) => {
          const id = onMap.get(it.id.toLowerCase());
          return (
            <button key={it.id} className={`swatch tex${id !== undefined && id === current ? " on" : ""}${id !== undefined ? " added" : ""}`}
              style={{ backgroundImage: `url(${assetUrl(it.id, 64)})` }} onClick={() => choose(it)}
              title={`${it.name} (${it.packName})${id !== undefined ? ": already on this map" : ""}`} aria-label={`${it.name}, from ${it.packName}`} data-testid="pack-floor" />
          );
        })}
      </div>
      {!items.length && !busy && <p className="muted">{q ? `No floor textures match "${q}".` : "No floor textures were found in your asset packs. Dragon Drop knows a floor texture by the words in its folder or file name (floor, ground, terrain, tiles, textures, grass, cobblestone...)."}</p>}
      {items.length < total && <button className="ghost pack-floors-more" disabled={busy} onClick={() => void load(items.length)} data-testid="pack-floors-more">{busy ? "Loading…" : `More (${(total - items.length).toLocaleString()} left)`}</button>}
    </div>
  );
}
