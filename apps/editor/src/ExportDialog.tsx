/** The Export dialog: size, what to include, then a PNG (or a ZIP of tiles for very large sizes). */
import { useState } from "react";
import { type MapMeta, hasFurniture, planExport } from "@mapmaker/core";
import { EXPORT_FACTORS, type ExportOptions, type ExportSource, downloadBlob, exportMap } from "./exportMap.ts";

export function ExportDialog({ meta, source, onClose }: { meta: MapMeta; source: () => ExportSource | null; onClose: () => void }) {
  const hasGrid = !!meta.grid && meta.grid.type !== "off";
  const hasExtras = hasFurniture(meta.furniture);
  const [factor, setFactor] = useState(2);
  const [rivers, setRivers] = useState(true);
  const [features, setFeatures] = useState(true);
  const [grid, setGrid] = useState(hasGrid);
  const [furniture, setFurniture] = useState(hasExtras);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    const src = source();
    if (!src) return;
    setError(null);
    setBusy("Starting…");
    try {
      const opts: ExportOptions = { factor, rivers, features, grid: grid && hasGrid, furniture: furniture && hasExtras };
      const { blob, filename } = await exportMap(src, opts, setBusy);
      downloadBlob(blob, filename);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const mb = (w: number, h: number) => Math.round((w * h * 4) / 1e6);
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" data-testid="export-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Export the map</h2>
        <fieldset disabled={!!busy}>
          <legend>Size</legend>
          {EXPORT_FACTORS.map((f) => {
            const p = planExport(meta.width, meta.height, f);
            return (
              <label key={f} className="radio">
                <input type="radio" name="export-size" checked={factor === f} onChange={() => setFactor(f)} data-testid={`export-size-${f}`} />
                <span>
                  <b>{f}×</b> · {p.width} × {p.height} px
                  <span className="muted"> · {p.tiled ? `${p.tiles.length} tiles in one .zip` : `one PNG, about ${mb(p.width, p.height)} MB in memory`}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <fieldset disabled={!!busy}>
          <legend>Include</legend>
          {(meta.style ?? "painted") !== "painted" && <label className="check"><input type="checkbox" checked={rivers} onChange={(e) => setRivers(e.target.checked)} /> Rivers</label>}
          <label className="check"><input type="checkbox" checked={features} onChange={(e) => setFeatures(e.target.checked)} /> Places, labels, roads and borders</label>
          <label className="check"><input type="checkbox" checked={grid && hasGrid} disabled={!hasGrid} onChange={(e) => setGrid(e.target.checked)} /> Grid {!hasGrid && <span className="muted">(none set)</span>}</label>
          <label className="check"><input type="checkbox" checked={furniture && hasExtras} disabled={!hasExtras} onChange={(e) => setFurniture(e.target.checked)} /> Title, scale bar and compass {!hasExtras && <span className="muted">(none set)</span>}</label>
        </fieldset>
        <p className="muted">
          The terrain is enlarged from this map's own detail, so it gets softer above 2×. Rivers, names, roads, grids and the extras are drawn
          sharp at the full size. For sharper terrain, make a <b>Detail map</b> of the area and export that.
        </p>
        {error && <p className="error-text" data-testid="export-error">{error}</p>}
        <div className="row end">
          <button className="ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className="primary" onClick={go} disabled={!!busy} data-testid="export-go">{busy ?? "Export"}</button>
        </div>
      </div>
    </div>
  );
}
