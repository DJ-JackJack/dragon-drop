/**
 * Choosing a settlement building's roof picture by sight: the roof pictures the asset packs hold for each roof look (the ones the server found:
 * roofAssetsClient.ts), with a search; and, when none of those will do, any picture of the packs (patterns, roofs, floor textures). The Building and
 * Outline tools use it for new buildings, the inspector for chosen ones.
 */
import { useState, useSyncExternalStore } from "react";
import { ROOF_STYLES, ROOF_STYLE_NAMES, type RoofStyle, assetLabel, parseAssetId, roofTileMetres } from "@mapmaker/core";
import { assetUrl } from "./assetsApi.ts";
import { PackGrid } from "./PackGrid.tsx";
import { roofAssetsStore } from "./roofAssetsClient.ts";

/** A roof picture chosen by the person: the asset and the metres one repeat covers. */
export interface RoofPick { asset: string; tile: number }

export function roofPickOf(asset: { id: string; path: string }): RoofPick {
  return { asset: asset.id, tile: roofTileMetres({ path: asset.path }) };
}

export function roofPictureName(asset: string | null | undefined): string {
  return asset ? assetLabel(parseAssetId(asset)?.path ?? asset) : "";
}

export function RoofPicturePicker({ look, value, onPick }: { look: RoofStyle; value: string | null; onPick: (p: RoofPick) => void }) {
  const roofs = useSyncExternalStore(roofAssetsStore.subscribe, roofAssetsStore.get);
  const [tab, setTab] = useState<RoofStyle>(look);
  const [text, setText] = useState("");
  const [any, setAny] = useState(false);
  const q = text.trim().toLowerCase();
  const pool = (roofs.pools?.[tab] ?? []).filter((a) => !q || `${a.path} ${a.packName ?? ""}`.toLowerCase().includes(q));
  return (
    <div className="wall-picker roof-picker" data-testid="roof-pictures">
      {!roofs.loaded ? <p className="muted">Looking in your asset packs…</p> : !roofs.pools ? (
        <p className="muted">To use the roof pictures in your asset packs, choose your asset folder in Settings (Maps and assets).</p>
      ) : (
        <>
          <div className="seg" role="group" aria-label="Roof look" data-testid="roof-picture-looks">
            {ROOF_STYLES.map((r) => <button key={r} className={tab === r ? "on" : ""} onClick={() => setTab(r)} data-testid={`roof-picture-look-${r}`}>{ROOF_STYLE_NAMES[r]} ({roofs.pools?.[r]?.length ?? 0})</button>)}
          </div>
          <div className="pack-floors-find"><input placeholder="Search: red, mossy, dark…" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="roof-picture-search" /></div>
          <div className="materials pack-floor-grid" data-testid="roof-picture-grid">
            {pool.slice(0, 120).map((a) => (
              <button key={a.id} className={`swatch tex${a.id === value ? " on" : ""}`} style={{ backgroundImage: `url(${assetUrl(a.id, 64)})` }}
                title={`${a.name ?? roofPictureName(a.id)}${a.packName ? ` (${a.packName})` : ""}`} aria-label={a.name ?? roofPictureName(a.id)} onClick={() => onPick(roofPickOf(a))} data-testid="roof-picture" />
            ))}
          </div>
          {!pool.length && <p className="muted">{q ? `No ${ROOF_STYLE_NAMES[tab].toLowerCase()} roof picture matches "${text.trim()}".` : `Your packs have no ${ROOF_STYLE_NAMES[tab].toLowerCase()} roof picture Dragon Drop recognised: try another look, or any picture below.`}</p>}
          {pool.length > 120 && <p className="muted">The first 120 are shown: search to find the rest.</p>}
        </>
      )}
      <button className="ghost" onClick={() => setAny((v) => !v)} aria-expanded={any} data-testid="roof-picture-any">{any ? "▴" : "▾"} Any picture from your packs</button>
      {any && (
        <PackGrid
          kinds={[{ cat: "patterns", label: "patterns" }, { cat: "roofs", label: "roofs" }, { cat: "terrain", label: "floor textures" }]} testId="pack-roofs" item="pack-roof" placeholder="Search: roof, tile, thatch…"
          noneFound="Nothing of this kind in your asset packs." noFolder="Choose your asset folder in Settings (Maps and assets)."
          stateOf={(it) => ({ on: it.id === value })} onChoose={(it) => onPick(roofPickOf(it))}
        />
      )}
    </div>
  );
}
