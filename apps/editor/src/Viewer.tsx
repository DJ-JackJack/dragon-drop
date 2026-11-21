/**
 * Read-only map page for phones and tablets (open /view). Shows the server's latest render
 * with crisp labels on top, follows edits live, and lets you tap places to read their notes.
 * Pinch or scroll to zoom, drag to pan, double-tap to zoom in. A city map is shown in metres,
 * with its names (streets, buildings, districts) drawn as the editor draws them (drawCityNames).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type MapMeta, type Place, placeKind } from "@mapmaker/core";
import { drawCityNames } from "./drawCityNames.ts";
import { type Hit, drawFeatures, hitTest, loadLabelFonts } from "./drawFeatures.ts";
import { drawFurniture, viewUnit } from "./drawFurniture.ts";
import { drawMapGrid } from "./drawMapGrid.ts";
import { store } from "./store.ts";
import { withWaterLabels } from "./waterUi.ts";

interface View { scale: number; ox: number; oy: number }

/** The map's size in the units its features use: pixels for a world map or battlemap, metres for a city. */
const dims = (m: MapMeta) => (m.city ? { w: m.city.widthM, h: m.city.heightM } : { w: m.width, h: m.height });

export function Viewer() {
  const s = useSyncExternalStore(store.subscribe, store.getState);
  const meta = s.meta;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const view = useRef<View | null>(null);
  const hits = useRef<Hit[]>([]);
  const raf = useRef(0);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Place | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [listOpen, setListOpen] = useState(false);

  // (a world map's river and lake names are drawn like its labels)
  const features = withWaterLabels(s.features, meta?.city ? null : s.water);
  const live = useRef({ features, showLabels, meta, picked });
  live.current = { features, showLabels, meta, picked };

  useEffect(() => { store.connect(true); }, []);
  useEffect(() => { if (meta) document.title = `${meta.name} · Dragon Drop`; }, [meta?.name]);

  const draw = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = canvasRef.current, m = live.current.meta, v = view.current;
      if (!c || !m || !v) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#0d0d10";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const img = imgRef.current, d = dims(m);
      if (img) {
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, v.ox, v.oy, d.w * v.scale, d.h * v.scale);
      }
      if (m.city) {
        const W = c.width / dpr, H = c.height / dpr;
        hits.current = live.current.showLabels ? drawCityNames(ctx, live.current.features, { scale: v.scale, ox: v.ox, oy: v.oy, widthM: d.w, fitScale: Math.min(W / d.w, H / d.h), W, H }) : [];
        return;
      }
      if (m.grid) drawMapGrid(ctx, m.grid, { scale: v.scale, ox: v.ox, oy: v.oy, mapWidth: m.width, mapHeight: m.height, kmPerPx: m.kmPerPx }, c.width / dpr, c.height / dpr);
      drawFurniture(ctx, m.furniture, { x: v.ox, y: v.oy, w: m.width * v.scale, h: m.height * v.scale, mapWidthPx: m.width, kmPerPx: m.kmPerPx, unit: viewUnit(m.width * v.scale) });
      hits.current = live.current.showLabels
        ? drawFeatures(ctx, live.current.features, { scale: v.scale, ox: v.ox, oy: v.oy, mapWidth: m.width, fitScale: Math.min(c.width / dpr / m.width, c.height / dpr / m.height) }, live.current.picked?.id)
        : [];
    });
  }, []);

  const fit = useCallback(() => {
    const w = wrapRef.current, m = live.current.meta;
    if (!w || !m) return;
    const W = w.clientWidth, H = w.clientHeight, d = dims(m);
    const scale = Math.min(W / d.w, H / d.h);
    view.current = { scale, ox: (W - d.w * scale) / 2, oy: (H - d.h * scale) / 2 };
    draw();
  }, [draw]);

  // keep the canvas matched to its box (rotation, browser bars appearing)
  useEffect(() => {
    const w = wrapRef.current, c = canvasRef.current;
    if (!w || !c) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w.clientWidth * dpr);
      c.height = Math.round(w.clientHeight * dpr);
      if (!view.current) fit(); else draw();
    });
    ro.observe(w);
    return () => ro.disconnect();
  }, [fit, draw]);

  // a new project: fit it to the screen
  useEffect(() => { view.current = null; imgRef.current = null; fit(); }, [meta?.id, fit]);

  // fetch a fresh render when the server finishes recomputing the map (debounced so a burst of edits loads once)
  useEffect(() => {
    if (!meta) return;
    const t = setTimeout(() => {
      const img = new Image();
      setLoading(true);
      img.onload = () => { imgRef.current = img; setUpdated(new Date()); setLoading(false); draw(); };
      img.onerror = () => setLoading(false);
      // native size: the server only upscales by whole factors (blocky), the browser scales smoothly (a city is drawn as sharp as the server's picture of it goes)
      img.src = `/api/projects/${meta.id}/render.jpg?max=${meta.city ? 2048 : Math.max(meta.width, meta.height)}&v=${s.derivedVersion}-${Date.now()}`;
    }, 400);
    return () => clearTimeout(t);
  }, [meta?.id, s.derivedVersion, draw]);

  useEffect(() => { void loadLabelFonts().then(draw); }, [draw]);
  useEffect(draw, [s.features, s.water, showLabels, picked, draw]);

  // keep the open place card in sync with edits made elsewhere
  useEffect(() => {
    if (picked) setPicked(s.features.places.find((p) => p.id === picked.id) ?? null);
  }, [s.features]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ gestures
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startX: 0, startY: 0, t: 0, moved: false, lastTap: 0 });

  const zoomAt = (x: number, y: number, k: number) => {
    const v = view.current, m = live.current.meta, w = wrapRef.current;
    if (!v || !m || !w) return;
    const d = dims(m), fitScale = Math.min(w.clientWidth / d.w, w.clientHeight / d.h);
    const ns = Math.min(fitScale * (m.city ? 40 : 16), Math.max(fitScale * 0.6, v.scale * k));
    const r = ns / v.scale;
    view.current = { scale: ns, ox: x - (x - v.ox) * r, oy: y - (y - v.oy) * r };
    draw();
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (pointers.current.size === 1) Object.assign(g, { startX: p.x, startY: p.y, t: performance.now(), moved: false });
    if (pointers.current.size > 1) g.moved = true;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !view.current) return;
    const p = local(e);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      if (Math.hypot(p.x - g.startX, p.y - g.startY) > 6) g.moved = true;
      view.current = { ...view.current, ox: view.current.ox + p.x - prev.x, oy: view.current.oy + p.y - prev.y };
      pointers.current.set(e.pointerId, p);
      draw();
    } else if (pointers.current.size === 2) {
      // pan by how far the midpoint moved, zoom by how much the fingers spread
      const [a0, b0] = [...pointers.current.values()];
      pointers.current.set(e.pointerId, p);
      const [a, b] = [...pointers.current.values()];
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.current = { ...view.current, ox: view.current.ox + mid.x - (a0.x + b0.x) / 2, oy: view.current.oy + mid.y - (a0.y + b0.y) / 2 };
      if (d0 > 0) zoomAt(mid.x, mid.y, d / d0);
      else draw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (!wasSingle || g.moved || performance.now() - g.t > 400) return;
    const p = local(e);
    const now = performance.now();
    if (now - g.lastTap < 300) { g.lastTap = 0; zoomAt(p.x, p.y, 2); return; }
    g.lastTap = now;
    const hit = hitTest(hits.current, p.x, p.y);
    const place = hit?.kind === "place" ? live.current.features.places.find((x) => x.id === hit.id) : undefined;
    setPicked(place ?? null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  };

  const goTo = (pl: Place) => {
    const w = wrapRef.current, m = live.current.meta;
    if (!w || !m) return;
    const d = dims(m), fitScale = Math.min(w.clientWidth / d.w, w.clientHeight / d.h);
    const scale = Math.max(view.current?.scale ?? 0, fitScale * 4);
    view.current = { scale, ox: w.clientWidth / 2 - pl.x * scale, oy: w.clientHeight / 2 - pl.y * scale };
    setPicked(pl);
    setListOpen(false);
    draw();
  };

  const places = [...s.features.places].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <span className={`dot ${s.connected ? "ok" : "off"}`} title={s.connected ? "Live" : "Reconnecting..."} />
        <div className="viewer-head">
          <b className="viewer-title">{meta?.name ?? "Dragon Drop"}</b>
          <span className="muted viewer-time">
            {loading ? "Updating..." : updated ? `Updated ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "\u00a0"}
          </span>
        </div>
        {!meta?.city && <button onClick={() => setListOpen((o) => !o)} className={listOpen ? "on" : ""}>Places</button>}
        <button onClick={() => setShowLabels((x) => !x)} className={showLabels ? "on" : ""}>{meta?.city ? "Names" : "Labels"}</button>
        <button onClick={fit} title="Fit the whole map">Fit</button>
        <a className="button" href="/">Editor</a>
      </header>
      <div className="viewer-map" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          data-testid="viewer-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
          onWheel={onWheel}
        />
        {!meta && <div className="viewer-empty">{s.connected ? "No map open in the editor." : "Connecting to the map server..."}</div>}
        {listOpen && (
          <div className="viewer-sheet" data-testid="viewer-places">
            {places.length === 0 && <p className="muted">No places yet.</p>}
            {places.map((p) => (
              <button key={p.id} onClick={() => goTo(p)}><span>{p.name}</span><span className="muted">{placeKind(p.type).name}</span></button>
            ))}
          </div>
        )}
        {picked && !listOpen && (
          <div className="viewer-card" data-testid="viewer-card">
            <div className="row"><b>{picked.name}</b><span className="muted">{picked.type}</span><span className="spacer" /><button onClick={() => setPicked(null)}>✕</button></div>
            {picked.notes && <p>{picked.notes}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
