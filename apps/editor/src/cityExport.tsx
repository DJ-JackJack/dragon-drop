/**
 * A city map exported as a picture: drawn by the city view itself (`paint`) at a chosen number of pixels per metre, as one PNG or, when that is too big for one picture,
 * as PNG tiles in a ZIP (the same plan as the world map's export: planExport). Roof pictures and fonts are loaded first (`prepare`), so nothing is drawn as a placeholder.
 */
import { hasGmOnly } from "@mapmaker/core";
import { store } from "./store.ts";
import { useState } from "react";
import { type MapMeta, createZip, planExport } from "@mapmaker/core";
import type { CityPaintTarget } from "./CityView.tsx";
import { canvasBlob, downloadBlob, safeName } from "./exportMap.ts";

/** Pixels per metre on offer: 1 shows a house of 6 m as 6 px, 8 as 48 px (enough to print a street map). */
export const CITY_EXPORT_SCALES = [1, 2, 4, 8];

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A round length for the scale bar: 1, 2, 5 times a power of ten, at most `max` metres. */
function niceLength(max: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(0.1, max)));
  for (const m of [5, 2, 1]) if (m * p <= max) return m * p;
  return p;
}

/** A scale bar at the bottom left of the whole picture (drawn into each tile at its offset, so it lands in the one that holds it). */
function drawScaleBar(ctx: CanvasRenderingContext2D, k: number, fullW: number, fullH: number, x: number, y: number) {
  const len = niceLength((fullW * 0.2) / k), w = len * k, h = Math.max(14, Math.round(fullW / 120)), m = Math.max(16, Math.round(fullW / 60));
  ctx.save();
  ctx.translate(-x, -y);
  const bx = m, by = fullH - m - h * 2.6;
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(bx - h * 0.4, by - h * 1.4, w + h * 0.8, h * 3);
  ctx.fillStyle = "#17171c"; ctx.fillRect(bx, by + h * 0.6, w, h * 0.35);
  for (const t of [0, 0.5, 1]) ctx.fillRect(bx + w * t - 1, by + h * 0.3, 2, h * 0.9);
  ctx.font = `700 ${Math.round(h * 0.75)}px Cinzel, Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, bx + w / 2, by + h * 0.15);
  ctx.restore();
}

export function CityExportDialog({ meta, names: namesOn, contours: contoursOn, prepare, paint, onClose }: {
  meta: MapMeta; names: boolean; contours: boolean; prepare: () => Promise<void>; paint: (t: CityPaintTarget) => void; onClose: () => void;
}) {
  const spec = meta.city!;
  const [k, setK] = useState(() => [...CITY_EXPORT_SCALES].reverse().find((s) => Math.max(spec.widthM, spec.heightM) * s <= 4096) ?? 1);
  const [names, setNames] = useState(namesOn);
  const secrets = hasGmOnly(store.state.features);
  const [players, setPlayers] = useState(true);
  const [contours, setContours] = useState(contoursOn);
  const [scaleBar, setScaleBar] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    setBusy("Loading the roof pictures…");
    try {
      await prepare();
      const plan = planExport(spec.widthM, spec.heightM, k), base = safeName(meta.name);
      const tile = (x: number, y: number, w: number, h: number) => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d")!;
        paint({ ctx, v: { scale: k, ox: -x, oy: -y }, W: w, H: h, names, contours, players: secrets && players });
        if (scaleBar) drawScaleBar(ctx, k, plan.width, plan.height, x, y);
        return c;
      };
      if (!plan.tiled) {
        setBusy(`Drawing ${plan.width} × ${plan.height} px…`);
        await tick();
        downloadBlob(await canvasBlob(tile(0, 0, plan.width, plan.height)), `${base} (${k} px per m).png`);
      } else {
        const files: { name: string; data: Uint8Array }[] = [];
        for (let i = 0; i < plan.tiles.length; i++) {
          const t = plan.tiles[i];
          setBusy(`Tile ${i + 1} of ${plan.tiles.length}…`);
          await tick();
          const c = tile(t.x, t.y, t.w, t.h);
          files.push({ name: `${base}_r${t.row + 1}_c${t.col + 1}.png`, data: new Uint8Array(await (await canvasBlob(c)).arrayBuffer()) });
          c.width = c.height = 0;
        }
        files.push({ name: "README.txt", data: new TextEncoder().encode([
          `${meta.name}: ${plan.width} x ${plan.height} px in ${plan.cols} x ${plan.rows} tiles of up to 4096 px, ${k} px per metre (the settlement is ${spec.widthM} x ${spec.heightM} m).`,
          `Files are named ${base}_r<row>_c<column>.png, counting from 1 at the top-left.`,
          `Place them edge to edge, left to right and top to bottom, to rebuild the whole map.`,
        ].join("\r\n")) });
        setBusy("Packing the tiles into one file…");
        await tick();
        downloadBlob(new Blob([createZip(files) as BlobPart], { type: "application/zip" }), `${base}_tiles.zip`);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" data-testid="export-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Export the settlement</h2>
        <fieldset disabled={!!busy}>
          <legend>Size</legend>
          {CITY_EXPORT_SCALES.map((s) => {
            const p = planExport(spec.widthM, spec.heightM, s);
            return (
              <label key={s} className="radio">
                <input type="radio" name="export-size" checked={k === s} onChange={() => setK(s)} data-testid={`export-size-${s}`} />
                <span>
                  <b>{s} px per metre</b> · {p.width.toLocaleString()} × {p.height.toLocaleString()} px
                  <span className="muted"> · {p.tiled ? `${p.tiles.length} tiles in one .zip` : "one PNG"}{s === 1 ? " · a 6 m house is 6 px" : s === 8 ? " · fine enough to print" : ""}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <fieldset disabled={!!busy}>
          <legend>Include</legend>
          <label className="check"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} data-testid="export-names" /> Names and labels</label>
          {secrets && names && <label className="check" title="Labels and building names you marked GM only are left out"><input type="checkbox" checked={players} onChange={(e) => setPlayers(e.target.checked)} data-testid="export-players" /> For players: leave out what is GM only</label>}
          <label className="check"><input type="checkbox" checked={contours} onChange={(e) => setContours(e.target.checked)} /> Contour lines</label>
          <label className="check"><input type="checkbox" checked={scaleBar} onChange={(e) => setScaleBar(e.target.checked)} /> Scale bar</label>
        </fieldset>
        <p className="muted">The settlement is drawn afresh at the size you choose, so buildings, streets, walls and names stay sharp; the ground's colours are blended from its cells.</p>
        {error && <p className="error-text" data-testid="export-error">{error}</p>}
        <div className="row end">
          <button className="ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className="primary" onClick={go} disabled={!!busy} data-testid="export-go">{busy ?? "Export"}</button>
        </div>
      </div>
    </div>
  );
}
