/**
 * A picker's part for the asset packs: the pictures of one kind (or a choice of kinds) in every pack, searched and by pack, 48 at a time, as small
 * swatches. The floor picker (PackFloors.tsx) and the wall picker (WallLookPicker.tsx) use it; what a click does is theirs.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { AssetItem } from "@mapmaker/core";
import { type AssetPack, type AssetStatus, assetUrl, fetchAssetStatus, fetchAssets, fetchPacks } from "./assetsApi.ts";

const PAGE = 48;

export interface PackGridProps {
  /** The kinds it can show; the first is shown first, and more than one gives a choice. */
  kinds: { cat: string; label: string }[];
  /** The test ids' start ("pack-floors": pack-floors-search, pack-floors-grid...), and each swatch's own (`item`). */
  testId: string;
  item: string;
  placeholder: string;
  /** What to say when nothing of this kind is in the packs at all. */
  noneFound: string;
  /** What to say without an asset folder. */
  noFolder: string;
  /** A swatch's state: the one in use ("on"), one already on the map ("added"). */
  stateOf?: (it: AssetItem) => { on?: boolean; added?: boolean; note?: string };
  onChoose: (it: AssetItem) => void;
  onBrowse?: () => void;
  /** Shown over the grid (a problem the last click ran into). */
  problem?: ReactNode;
}

export function PackGrid(p: PackGridProps) {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [packs, setPacks] = useState<AssetPack[]>([]);
  const [cat, setCat] = useState(p.kinds[0].cat);
  const [pack, setPack] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    void fetchAssetStatus().then((st) => {
      if (!alive) return;
      setStatus(st);
      if (st.configured) void fetchPacks().then((list) => alive && setPacks(list.filter((k) => !k.restricted && !k.supersededBy))).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => { const t = window.setTimeout(() => setQ(text.trim()), 250); return () => window.clearTimeout(t); }, [text]);

  const load = async (offset: number) => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const r = await fetchAssets({ cat, pack, q, offset, limit: PAGE });
      if (mine !== seq.current) return;
      setTotal(r.total);
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    } catch { /* the server is busy or gone: the picker stays as it was */ } finally {
      if (mine === seq.current) setBusy(false);
    }
  };
  useEffect(() => { if (status?.configured) void load(0); }, [status?.configured, cat, pack, q]);

  if (!status) return null;
  if (!status.configured) return <p className="muted pack-floors-note" data-testid={`${p.testId}-none`}>{p.noFolder}</p>;
  const withKind = packs.filter((k) => (k.categories[cat] ?? 0) > 0);
  const label = p.kinds.find((k) => k.cat === cat)?.label ?? cat;
  return (
    <div className="pack-floors" data-testid={p.testId}>
      <div className="pack-floors-head">
        <b>From your asset packs</b>
        <span className="muted">{status.scanning ? "reading…" : `${total.toLocaleString()} ${label}`}</span>
        {p.onBrowse && <button className="ghost" onClick={p.onBrowse} title="Open the Assets tab, with bigger pictures">Browse</button>}
      </div>
      {p.kinds.length > 1 && (
        <div className="seg" role="group" aria-label="Which pictures" data-testid={`${p.testId}-kinds`}>
          {p.kinds.map((k) => <button key={k.cat} className={k.cat === cat ? "on" : ""} onClick={() => setCat(k.cat)} data-testid={`${p.testId}-kind-${k.cat}`}>{k.label}</button>)}
        </div>
      )}
      <div className="pack-floors-find">
        <input placeholder={p.placeholder} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid={`${p.testId}-search`} autoFocus />
        {withKind.length > 1 && (
          <select value={pack} onChange={(e) => setPack(e.target.value)} title="Which pack" data-testid={`${p.testId}-pack`}>
            <option value="">Every pack</option>
            {withKind.map((k) => <option key={k.key} value={k.key}>{k.name} ({k.categories[cat]})</option>)}
          </select>
        )}
      </div>
      {p.problem && <p className="error-text">{p.problem}</p>}
      <div className="materials pack-floor-grid" data-testid={`${p.testId}-grid`}>
        {items.map((it) => {
          const st = p.stateOf?.(it) ?? {};
          return (
            <button key={it.id} className={`swatch tex${st.on ? " on" : ""}${st.added ? " added" : ""}`}
              style={{ backgroundImage: `url(${assetUrl(it.id, 64)})` }} onClick={() => p.onChoose(it)}
              title={`${it.name} (${it.packName})${st.note ? `: ${st.note}` : ""}`} aria-label={`${it.name}, from ${it.packName}`} data-testid={p.item} />
          );
        })}
      </div>
      {!items.length && !busy && <p className="muted">{q ? `Nothing here matches "${q}".` : p.noneFound}</p>}
      {items.length < total && <button className="ghost pack-floors-more" disabled={busy} onClick={() => void load(items.length)} data-testid={`${p.testId}-more`}>{busy ? "Loading…" : `More (${(total - items.length).toLocaleString()} left)`}</button>}
    </div>
  );
}
