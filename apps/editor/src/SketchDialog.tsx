/** Turn a reference image (a drawing of the land) into terrain, with a live preview of how it will be read. */
import { useEffect, useMemo, useRef, useState } from "react";
import { type RefInfo, type SketchImage, type SketchParams, DEFAULT_MOUNTAIN_COLOUR, classifySketch, mountainStrokeShare } from "@mapmaker/core";
import { store } from "./store.ts";

/** Load the image at a modest size for the preview (same origin, so reading its pixels is allowed). */
function loadSketch(url: string): Promise<SketchImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 768 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ w, h, data: ctx.getImageData(0, 0, w, h).data });
    };
    img.onerror = () => reject(new Error("Couldn't load that image."));
    img.src = url;
  });
}

export function SketchDialog({ refInfo, mapHasLand, onClose }: { refInfo: RefInfo; mapHasLand: boolean; onClose: () => void }) {
  const [img, setImg] = useState<SketchImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enclosed, setEnclosed] = useState<"sea" | "land">("sea");
  const [mountains, setMountains] = useState(false);
  const [tolerance, setTolerance] = useState(48);
  const [fit, setFit] = useState<"contain" | "whole">("contain");
  const [landHeightM, setLandHeightM] = useState(500);
  const [mountainHeightM, setMountainHeightM] = useState(2600);
  const [roughness, setRoughness] = useState(0.5);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadSketch(refInfo.url).then((i) => { setImg(i); setMountains(mountainStrokeShare(i) > 0.002); }).catch((e) => setError((e as Error).message));
  }, [refInfo.url]);

  const params: SketchParams = useMemo(() => ({
    enclosed, tolerance, fit, landHeightM, mountainHeightM, coastRoughness: roughness,
    mountainColour: mountains ? DEFAULT_MOUNTAIN_COLOUR : null,
  }), [enclosed, tolerance, fit, landHeightM, mountainHeightM, roughness, mountains]);

  // preview: how the drawing will be read (sea, land, mountain strokes)
  const [info, setInfo] = useState<{ land: number; mountains: number; sea: string } | null>(null);
  useEffect(() => {
    if (!img || !canvas.current) return;
    const t = setTimeout(() => {
      const k = Math.min(1, 360 / Math.max(img.w, img.h));
      const pw = Math.max(8, Math.round(img.w * k)), ph = Math.max(8, Math.round(img.h * k));
      const m = classifySketch(img, params, pw, ph);
      const c = canvas.current!;
      c.width = pw; c.height = ph;
      const ctx = c.getContext("2d")!;
      const out = ctx.createImageData(pw, ph);
      let land = 0, mt = 0;
      for (let i = 0; i < pw * ph; i++) {
        const col = m.mountain[i] ? [196, 110, 70] : m.land[i] ? [96, 150, 80] : [44, 72, 124];
        out.data[i * 4] = col[0]; out.data[i * 4 + 1] = col[1]; out.data[i * 4 + 2] = col[2]; out.data[i * 4 + 3] = 255;
        land += m.land[i]; mt += m.mountain[i];
      }
      ctx.putImageData(out, 0, 0);
      setInfo({ land: Math.round((land / (pw * ph)) * 100), mountains: mt, sea: `rgb(${m.seaColour.join(", ")})` });
    }, 120);
    return () => clearTimeout(t);
  }, [img, params]);

  const go = () => {
    store.send({ t: "sketch_import", ref: refInfo.name, params });
    onClose();
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" data-testid="sketch-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Make terrain from this drawing</h2>
        {error && <p className="error-text">{error}</p>}
        <div className="sketch-preview">
          <canvas ref={canvas} data-testid="sketch-preview" />
          <div className="muted">
            How it will be read: <span className="swatch" style={{ background: "rgb(44,72,124)" }} /> sea · <span className="swatch" style={{ background: "rgb(96,150,80)" }} /> land
            {mountains && <> · <span className="swatch" style={{ background: "rgb(196,110,70)" }} /> mountains</>}
            {info && <><br />{info.land}% land{mountains ? `, ${info.mountains} mountain cells` : ""}. Sea colour found: <span className="swatch" style={{ background: info.sea }} /></>}
          </div>
        </div>
        <fieldset>
          <legend>Reading the drawing</legend>
          <label className="radio"><input type="radio" name="enc" checked={enclosed === "sea"} onChange={() => setEnclosed("sea")} />
            <span>Areas the sea can't reach are <b>water</b> (lakes, inner seas). Use this for a filled-in drawing.</span></label>
          <label className="radio"><input type="radio" name="enc" checked={enclosed === "land"} onChange={() => setEnclosed("land")} />
            <span>Areas inside an outline are <b>land</b>. Use this if the drawing only outlines the islands.</span></label>
          <label className="check"><input type="checkbox" checked={mountains} onChange={(e) => setMountains(e.target.checked)} /> Red strokes mark mountain ranges</label>
          <label className="field">How different from the sea counts as land: {tolerance}
            <input type="range" min={10} max={120} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} /></label>
        </fieldset>
        <fieldset>
          <legend>The terrain</legend>
          <label className="field">Fit
            <select value={fit} onChange={(e) => setFit(e.target.value as "contain" | "whole")}>
              <option value="contain">Keep the drawing's proportions, with a margin</option>
              <option value="whole">Stretch it over the whole map</option>
            </select></label>
          <label className="field">Lowlands
            <select value={landHeightM} onChange={(e) => setLandHeightM(Number(e.target.value))}>
              <option value={200}>Flat (about 200 m)</option><option value={500}>Rolling (about 500 m)</option><option value={900}>Highlands (about 900 m)</option>
            </select></label>
          {mountains && (
            <label className="field">Mountains
              <select value={mountainHeightM} onChange={(e) => setMountainHeightM(Number(e.target.value))}>
                <option value={1800}>Low (about 1,800 m)</option><option value={2600}>Tall (about 2,600 m)</option><option value={3800}>Very tall (about 3,800 m)</option>
              </select></label>
          )}
          <label className="field">Coastline: {roughness < 0.25 ? "smooth" : roughness < 0.7 ? "natural" : "ragged"}
            <input type="range" min={0} max={1} step={0.05} value={roughness} onChange={(e) => setRoughness(Number(e.target.value))} /></label>
        </fieldset>
        <p className="muted">
          This <b>replaces the whole map</b>{mapHasLand ? " (it has land now)" : ""}. A checkpoint called "Before sketch import" is saved first, and Undo also brings the old map back.
          Places, labels, climate regions and roads stay where they are.
        </p>
        <div className="row end">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={go} disabled={!img} data-testid="sketch-go">Create terrain</button>
        </div>
      </div>
    </div>
  );
}
