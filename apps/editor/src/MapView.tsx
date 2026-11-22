import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type Features, type LabelKind, type MapLabel, type MapMeta, type PaintView, type PlaceType, type ProjectInfo, type Rect,
  type SculptMode, type SelectableShape, type Selection, gridCellPx, moveLabel, newFeatureId, pathMidpoint, planRegional, selectionShape, simplifyPath,
  type RiverSize, type RiverSource,
} from "@mapmaker/core";
import { type FeatureClip, type ViewKeyAction, ARROW_DIRECTION, KEY_ZOOM_STEP, applyViewKey, boxSelect, clipBounds, copyFeatures, deleteFeatures, featureKindOf, moveFeatures, pasteFeatures, selectionFromIds, selectionIds, toggleInSelection, viewKeyAction } from "@mapmaker/core";
import { armItemsPaste, getClip, itemsCopied, setClip, unstack } from "./clipboard.ts";
import { traceCtl } from "./trace.ts";
import { forAssistant } from "./assistantName.ts";
import { TraceBar } from "./TraceBar.tsx";
import { CompareBar } from "./CompareMaps.tsx";
import { compareCtl } from "./compare.ts";
import { noShiftTextSelect } from "./noShiftSelect.ts";
import type { LineKind } from "@mapmaker/core";
import { type Hit, drawFeatures, hitTest, loadLabelFonts } from "./drawFeatures.ts";
import { ask } from "./dialogs.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { drawFurniture, viewUnit } from "./drawFurniture.ts";
import { MIN_CELL_SCREEN_PX, drawMapGrid } from "./drawMapGrid.ts";
import { drawRegions, regionAt } from "./drawRegions.ts";
import { PaintClient } from "./paintClient.ts";
import { type AppState, store } from "./store.ts";
import { makeResizeKeeper } from "./viewResize.ts";
import { type WaterPick, namedShape, pickWater, withWaterLabels } from "./waterUi.ts";
import type { RiverMode } from "./WorldToolBar.tsx";
import { StatusBar, zoomPercent } from "./StatusBar.tsx";

export type BrushTool = "raise" | "lower" | "smooth" | "flatten" | "land" | "water";
/** Most screen px per map px (so a very fine grid can still be inspected). */
const MAX_ZOOM = 80;
export type Tool = "pan" | "select" | "area" | "place" | "label" | "region" | "detail" | "line" | "river" | "battlehere" | "cityhere" | BrushTool;
/** The shape the Select area tool drags out. */
export type AreaShape = "rect" | "circle" | "free" | "poly";
const isBrush = (t: Tool): t is BrushTool => ["raise", "lower", "smooth", "flatten", "land", "water"].includes(t);

export interface Brush {
  radius: number; // map px
  strength: number; // 0..1
}

interface Props {
  meta: MapMeta | null;
  tool: Tool;
  brush: Brush;
  showGrid: boolean;
  /** Switch the coordinate numbers (the bottom bar's switch, as G). */
  onShowGrid?: () => void;
  hillshade: boolean;
  /** Blend the terrain's pixels when zoomed in instead of drawing hard blocks. */
  smooth: boolean;
  /** The user's multiplier for names and markers (1 = normal). */
  labelScale?: number;
  showRivers: boolean;
  features: Features;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  placeType: PlaceType;
  labelKind: LabelKind;
  showRegions: boolean;
  /** The Layers switches for the labels and place names, and for the place markers. */
  showLabels?: boolean;
  showMarkers?: boolean;
  /** Road tool: what is being drawn, and whether roads and trails are routed over the terrain for you. */
  lineKind: LineKind;
  lineAuto: boolean;
  /** A road is being routed (its id), so the app can show progress. */
  onRouting: (id: string) => void;
  /** Regional maps made from this one (outlined on the map). */
  childMaps: ProjectInfo[];
  /** The Detail map tool finished dragging an area (map px). */
  onDetailArea: (r: Rect) => void;
  /** The Battlemap here tool was clicked at a point (map px). */
  onBattleHere: (x: number, y: number) => void;
  /** "City here": a spot, or the place whose marker was clicked. */
  onCityHere?: (x: number, y: number, place: { name: string; type: string } | null) => void;
  /** What the DM has selected (drawn as a gold outline; a thicker, solid outline while Claude's edits are locked to it). */
  selection: Selection | null;
  selectionLock: boolean;
  /** The Select area tool: which shape it drags out, and what it did. */
  areaShape: AreaShape;
  onArea: (shape: SelectableShape) => void;
  /** A click on bare ground with Select or Select area (map px). */
  onPoint: (x: number, y: number) => void;
  /** Overlays that sit on the map (the selection bar). */
  children?: React.ReactNode;
  /** Named rivers and lakes (their labels are drawn; the River tool finds rivers and lakes with them), the River tool's mode and the size of a river it starts, and what it picked. */
  water?: AppState["water"];
  riverMode?: RiverMode;
  riverSize?: RiverSize;
  onWaterPick?: (p: WaterPick) => void;
}

interface View {
  scale: number; // screen px per map px (CSS px)
  ox: number;
  oy: number;
}

const BRUSH_LABEL: Record<BrushTool, string> = {
  raise: "Raise brush", lower: "Lower brush", smooth: "Smooth brush", flatten: "Flatten brush",
  land: "Land brush", water: "Water brush",
};

interface RiverChunk {
  path: Path2D;
  w: number;
}

export function MapView({ meta, tool, brush, showGrid, onShowGrid, hillshade, smooth, labelScale, showRivers, features, selectedId, onSelect, placeType, labelKind, showRegions, showLabels = true, showMarkers = true, lineKind, lineAuto, onRouting, childMaps, onDetailArea, onBattleHere, onCityHere, selection, selectionLock, areaShape, onArea, onPoint, children, water = null, riverMode = "add", riverSize = "river", onWaterPick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  // when the canvas changes size (a panel shown or hidden): a fitted view is fitted again, any other keeps its middle (viewResize.ts)
  const keeper = useRef(makeResizeKeeper(() => viewRef.current, (v) => { viewRef.current = v; }, () => fit())).current;
  const fittedFor = useRef<string | null>(null);
  const drawQueued = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    mode: "pan" | "brush" | "move" | "draw" | "river" | "rect" | "area" | "marquee" | "trace"; sx: number; sy: number; ox: number; oy: number; lastX: number; lastY: number; target?: number;
    hit?: Hit;
    /** move: the places and labels moving together (when there are two or more), whether the pointer has really moved yet, and whether it went down on one of a group (a click without a drag then picks that one). marquee: whether it adds to the group, and what was in it before. */
    ids?: string[]; moved?: boolean; groupClick?: boolean; add?: boolean; base?: string[];
    /** pan mode started on bare ground with the Select tool: a click that doesn't move picks that point */
    pick?: boolean;
    /** area mode: the farthest the pointer has been from where it went down (screen px), so a loop that ends where it began is still a drag */
    far?: number;
    /** draw mode: the line so far (map px) and its length on screen */
    pts?: [number, number][]; len?: number;
  } | null>(null);
  const hitsRef = useRef<Hit[]>([]);
  const moveOverride = useRef<{ id: string; ids?: string[]; dx: number; dy: number } | null>(null);
  const nudgeTimer = useRef<number | undefined>(undefined);
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const waterRef = useRef(water);
  waterRef.current = water;
  const riverRef = useRef({ mode: riverMode, size: riverSize, onPick: onWaterPick });
  riverRef.current = { mode: riverMode, size: riverSize, onPick: onWaterPick };
  /** The river or lake under the pointer while the River tool names and selects. */
  const waterHover = useRef<WaterPick | null>(null);
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  /** Places and labels selected together (two or more; `selectedId` is then the one most recently added). */
  const [group, setGroup] = useState<string[]>([]);
  const groupRef = useRef<string[]>([]);
  groupRef.current = group;
  const setGroupIds = (ids: string[]) => { groupRef.current = ids; setGroup(ids); };
  // when the selection is cleared or goes elsewhere (Esc, a click on something else, another map), so does the group
  useEffect(() => { if (groupRef.current.length && (!selectedId || !groupRef.current.includes(selectedId))) setGroupIds([]); }, [selectedId]);
  useEffect(() => setGroupIds([]), [meta?.id]);
  const [hover, setHover] = useState<{ x: number; y: number; e: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const optsRef = useRef({ labelScale, tool, brush, showGrid, hillshade, smooth, showRivers, placeType, labelKind, showRegions, showLabels, showMarkers, lineKind, lineAuto, areaShape });
  optsRef.current = { labelScale, tool, brush, showGrid, hillshade, smooth, showRivers, placeType, labelKind, showRegions, showLabels, showMarkers, lineKind, lineAuto, areaShape };
  const selectionRef = useRef({ selection, lock: selectionLock });
  selectionRef.current = { selection, lock: selectionLock };
  const onAreaRef = useRef(onArea);
  onAreaRef.current = onArea;
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;
  const viewKey = useRef("");
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Points of a road, trail or border being drawn (map px). */
  const lineDraft = useRef<[number, number][] | null>(null);
  /** Corners of a climate region being drawn (map px). */
  const regionDraft = useRef<[number, number][] | null>(null);
  /** Corners of an area being outlined corner by corner with the Select area tool's polygon shape (map px). */
  const polyDraft = useRef<[number, number][] | null>(null);
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null);
  const [gridTooFine, setGridTooFine] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const gridTooFineRef = useRef(false);
  const toMapRef = useRef((sx: number, sy: number) => ({ x: sx, y: sy }));
  const childMapsRef = useRef(childMaps);
  childMapsRef.current = childMaps;
  const onDetailRef = useRef(onDetailArea);
  onDetailRef.current = onDetailArea;
  const onBattleRef = useRef(onBattleHere);
  onBattleRef.current = onBattleHere;
  const onCityRef = useRef(onCityHere);
  onCityRef.current = onCityHere;
  const clientRef = useRef<PaintClient | null>(null);
  /** The heights (and map key) the paint worker was last opened with. */
  const openedRef = useRef<{ hf: unknown; key: string } | null>(null);
  const riverChunks = useRef<RiverChunk[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const requestDraw = useCallback(() => {
    if (drawQueued.current) return;
    drawQueued.current = true;
    requestAnimationFrame(() => {
      drawQueued.current = false;
      draw();
    });
  }, []);

  // the trace picture redraws this view when it loads, while it is dragged and when its settings change; so does a map being compared with this one
  useEffect(() => {
    traceCtl.redraw = requestDraw;
    compareCtl.redraw = requestDraw;
    const off = traceCtl.subscribe(requestDraw);
    return () => { off(); if (traceCtl.redraw === requestDraw) traceCtl.redraw = () => {}; if (compareCtl.redraw === requestDraw) compareCtl.redraw = () => {}; };
  }, [requestDraw]);
  const traceMode = useSyncExternalStore(traceCtl.subscribe, () => traceCtl.state.mode);

  /** What the paint worker should draw: the chosen style and its settings. */
  const paintView = useCallback((): PaintView | null => {
    const m = metaRef.current;
    return m ? { mode: (m.style ?? "painted") === "painted" ? "painted" : "relief", meta: m, hillshade: optsRef.current.hillshade, rivers: optsRef.current.showRivers } : null;
  }, []);

  // The map is painted in a worker (heights, climate layers and noise all live there): this thread only draws the pixels it sends back.
  useEffect(() => {
    const c = new PaintClient({
      pixels: (rect, data) => {
        const off = offRef.current;
        if (!off) return;
        off.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.length), rect.w, rect.h), rect.x, rect.y);
        requestDraw();
      },
      status: setStatus,
    });
    clientRef.current = c;
    openedRef.current = null;
    // a map that is already loaded (the view mounted after it arrived)
    if (store.heights && metaRef.current) openMap();
    return () => { c.dispose(); clientRef.current = null; openedRef.current = null; };
  }, []);

  /** Hand a newly loaded map (its heights) to the paint worker, and fit it to the window the first time. */
  function openMap() {
    const m = metaRef.current, hf = store.heights, c = clientRef.current, v = paintView();
    if (!m || !hf || !c || !v) return;
    const key = `${m.id}:${hf.w}x${hf.h}:${m.seed}`;
    if (openedRef.current && openedRef.current.hf === hf && openedRef.current.key === key) return;
    openedRef.current = { hf, key };
    let off = offRef.current;
    if (!off || off.width !== hf.w || off.height !== hf.h) {
      off = document.createElement("canvas");
      off.width = hf.w;
      off.height = hf.h;
      offRef.current = off;
    }
    c.setMap(hf.w, hf.h, m.seed, hf.data.slice(), v);
    if (fittedFor.current !== m.id) fit();
    setLoadedId(m.id);
    requestDraw();
  }

  /** Rivers as vector paths (crisp at any zoom), rebuilt when new derived layers arrive. */
  function buildRivers() {
    const d = store.derived;
    const chunks: RiverChunk[] = [];
    if (d) {
      for (const rv of d.rivers) {
        const p = rv.pts;
        for (let s = 0; s + 2 < p.length; s += 16) {
          const path = new Path2D();
          path.moveTo(p[s], p[s + 1]);
          let wsum = 0, n = 0;
          for (let t = s + 2; t < Math.min(p.length, s + 18); t += 2) {
            path.lineTo(p[t], p[t + 1]);
            wsum += rv.widths[t / 2];
            n++;
          }
          chunks.push({ path, w: n ? wsum / n : 0.5 });
        }
      }
    }
    riverChunks.current = chunks;
  }

  /** What is selected: the group, or the one place, label, region or line. */
  const worldIds = () => (groupRef.current.length >= 2 ? groupRef.current : selRef.current ? [selRef.current] : []);

  /**
   * An arrow key with something selected: nudge it (about 2 screen pixels, 20 with Shift, whatever the zoom). Presses within a third of a
   * second add up, previewed as they go, and are sent as one command: holding a key down is one undo step. Returns whether it took the key.
   */
  function nudge(ax: number, ay: number, big: boolean): boolean {
    const f = featuresRef.current, m = metaRef.current, ids = worldIds().filter((id) => featureKindOf(f, id));
    if (!m || !ids.length) return false;
    if (drag.current) return true; // (the mouse is dragging something: leave it alone)
    const k = (big ? 20 : 2) / viewRef.current.scale;
    const mo = moveOverride.current;
    const pending = mo?.ids && mo.ids.length === ids.length && mo.ids.every((id, i) => id === ids[i]) ? mo : null;
    if (moveOverride.current && !pending) commitNudge();
    const r = moveFeatures(f, ids, (pending?.dx ?? 0) + ax * k, (pending?.dy ?? 0) + ay * k, { w: m.width, h: m.height });
    moveOverride.current = { id: ids[0], ids, dx: r.dx, dy: r.dy };
    requestDraw();
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(commitNudge, 350);
    return true;
  }

  function commitNudge() {
    window.clearTimeout(nudgeTimer.current);
    const mo = moveOverride.current, m = metaRef.current, f = featuresRef.current;
    moveOverride.current = null;
    requestDraw();
    if (!mo?.ids || !m) return;
    const r = moveFeatures(f, mo.ids, mo.dx, mo.dy, { w: m.width, h: m.height });
    if (!r.dx && !r.dy) return;
    const first = mo.ids[0];
    const name = f.places.find((x) => x.id === first)?.name ?? f.labels.find((x) => x.id === first)?.text ?? f.regions?.find((x) => x.id === first)?.name ?? f.lines?.find((x) => x.id === first)?.name ?? "";
    store.send({ t: "cmd", cmd: { op: "features", patch: r.patch }, label: mo.ids.length > 1 ? `Nudge ${mo.ids.length} items` : `Nudge ${name}`.trim() });
  }

  /** Ctrl+C: keep a copy of the selected places and labels. */
  function copySelection(): boolean {
    const clip = copyFeatures(featuresRef.current, worldIds());
    if (!clip) return false;
    setClip("world", clip);
    return true;
  }

  /** Put a copy of `clip` on the map, `dx`, `dy` map px from where it came from, and select the first thing put there. */
  function pasteGroup(clip: FeatureClip, dx: number, dy: number, what: string) {
    const m = metaRef.current;
    if (!m) return;
    const r = pasteFeatures(clip, dx, dy, { bounds: { w: m.width, h: m.height } });
    store.send({ t: "cmd", cmd: { op: "features", patch: r.patch }, label: `${what} ${r.ids.length === 1 ? "1 item" : `${r.ids.length} items`}` });
    setGroupIds(r.ids.length >= 2 ? r.ids : []);
    onSelect(r.ids[r.ids.length - 1] ?? null);
  }

  /** How far a copy is moved along and down when there is no pointer to put it under: about 24 screen px, whatever the zoom. */
  const copyStep = () => 24 / viewRef.current.scale;

  /** Ctrl+V: paste what was copied, centred on the pointer (or a little along and down when the pointer is off the map). */
  function pasteClip(): boolean {
    const clip = getClip("world");
    if (!clip) return false;
    const b = clipBounds(clip), p = pointer.current;
    let dx = copyStep(), dy = copyStep();
    if (p) {
      const t = toMap(p.x, p.y);
      dx = t.x - (b.x0 + b.x1) / 2; dy = t.y - (b.y0 + b.y1) / 2;
    }
    ({ dx, dy } = unstack("world", dx, dy, copyStep()));
    pasteGroup(clip, dx, dy, "Paste");
    return true;
  }

  /** Ctrl+D: a copy of the selected place or label a little along and down (the clipboard is left alone). */
  function duplicateSelection(): boolean {
    const clip = copyFeatures(featuresRef.current, worldIds());
    if (!clip) return false;
    pasteGroup(clip, copyStep(), copyStep(), "Duplicate");
    return true;
  }

  /** + - 0 and the arrow keys move the view (see core's viewKeys.ts). */
  function keyView(a: ViewKeyAction) {
    if (a.kind === "fit") { fittedFor.current = null; fit(); }
    else {
      const wrap = wrapRef.current;
      if (!wrap) return;
      viewRef.current = applyViewKey(viewRef.current, a, { w: wrap.clientWidth, h: wrap.clientHeight }, { min: 0.05, max: MAX_ZOOM });
    }
    requestDraw();
  }

  function fit() {
    const wrap = wrapRef.current;
    const m = metaRef.current;
    if (!wrap || !m) return;
    const { clientWidth: W, clientHeight: H } = wrap;
    const scale = Math.min(W / m.width, H / m.height) * 0.95;
    viewRef.current = { scale, ox: (W - m.width * scale) / 2, oy: (H - m.height * scale) / 2 };
    fittedFor.current = m.id;
    keeper.fitted();
  }

  /** The bottom bar's zoom: screen pixels per map pixel, in percent (set only when it changes, so drawing doesn't re-render the view). */
  const [zoomPct, setZoomPct] = useState<number | null>(null);
  const zoomShown = useRef<number | null>(null);
  function draw() {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    { const z = zoomPercent(viewRef.current.scale * 100); if (z !== zoomShown.current) { zoomShown.current = z; setZoomPct(z); } }
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(0, 0, W, H);
    const off = offRef.current, m = metaRef.current;
    if (!off || !m) return;
    const v = viewRef.current;
    ctx.imageSmoothingEnabled = optsRef.current.smooth || v.scale < 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, v.ox, v.oy, m.width * v.scale, m.height * v.scale);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.strokeRect(v.ox - 0.5, v.oy - 0.5, m.width * v.scale + 1, m.height * v.scale + 1);
    // (the painted style paints its rivers into the map itself; only the relief style has them drawn over it)
    if (optsRef.current.showRivers && riverChunks.current.length && (metaRef.current?.style ?? "painted") !== "painted") {
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy);
      ctx.strokeStyle = "rgba(70, 88, 116, 0.92)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const c of riverChunks.current) {
        ctx.lineWidth = Math.max(c.w, 0.9 / v.scale);
        ctx.stroke(c.path);
      }
      ctx.restore();
    }
    // the trace picture: over the ground, under the grid and the map's own marks
    traceCtl.draw(ctx, featuresRef.current.trace, m.id, v);
    if (optsRef.current.showGrid) drawGridOverlay(ctx, m, v, W, H);
    // square or hex grid (a map setting); say so when it's too fine to draw at this zoom
    const gridOk = drawMapGrid(ctx, m.grid, { scale: v.scale, ox: v.ox, oy: v.oy, mapWidth: m.width, mapHeight: m.height, kmPerPx: m.kmPerPx }, W, H);
    if (gridOk === gridTooFineRef.current) { gridTooFineRef.current = !gridOk; setGridTooFine(!gridOk); }
    // places and labels (with the one being dragged at its live position)
    let f = featuresRef.current;
    const mo = moveOverride.current;
    if (mo) {
      const moving = (id: string) => (mo.ids ? mo.ids.includes(id) : id === mo.id);
      f = {
        places: f.places.map((p) => (moving(p.id) ? { ...p, x: p.x + mo.dx, y: p.y + mo.dy } : p)),
        labels: f.labels.map((l) => (moving(l.id) ? moveLabel(l, mo.dx, mo.dy) : l)),
        regions: f.regions?.map((r) => (moving(r.id) ? { ...r, polygon: r.polygon.map(([x, y]) => [x + mo.dx, y + mo.dy] as [number, number]) } : r)),
        lines: f.lines?.map((l) => (moving(l.id) ? { ...l, points: l.points.map(([x, y]) => [x + mo.dx, y + mo.dy] as [number, number]) } : l)),
      };
    }
    // climate regions: when the layer is on, while drawing one, or when one is selected
    const selRegion = f.regions?.some((r) => r.id === selRef.current);
    if (optsRef.current.showRegions || optsRef.current.tool === "region" || selRegion) drawRegions(ctx, f.regions, v, selRef.current);
    // a selected river or lake, whole; the one under the River tool; the river sources while the River tool is in use
    const wv = waterRef.current, rivers = store.derived?.rivers;
    if (wv && rivers && selRef.current && f.waterNames?.some((w) => w.id === selRef.current)) {
      const sh = namedShape(rivers, wv, selRef.current);
      if (sh) drawWaterShape(ctx, v, sh, "rgba(255, 215, 60, 0.95)");
    }
    if (optsRef.current.tool === "river") {
      const wh = waterHover.current;
      if (wh && riverRef.current.mode === "name") drawWaterShape(ctx, v, wh, "rgba(110, 220, 255, 0.95)");
      drawSources(ctx, v, f, selRef.current);
    }
    const ld = lineDraft.current;
    if (ld && ld.length) {
      const colour = optsRef.current.lineKind === "border" ? "rgba(214, 90, 150, 0.95)" : optsRef.current.lineKind === "reef" ? "rgba(120, 200, 190, 0.97)" : "rgba(255, 190, 90, 0.97)";
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ld.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      const pl = pointer.current;
      if (pl) ctx.lineTo(pl.x, pl.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of ld) { ctx.beginPath(); ctx.arc(v.ox + x * v.scale, v.oy + y * v.scale, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    const mq = drag.current;
    if (mq?.mode === "marquee" && pointer.current) {
      const x = Math.min(mq.sx, pointer.current.x), y = Math.min(mq.sy, pointer.current.y), w = Math.abs(pointer.current.x - mq.sx), h = Math.abs(pointer.current.y - mq.sy);
      ctx.save(); ctx.fillStyle = "rgba(255, 224, 120, 0.12)"; ctx.fillRect(x, y, w, h);
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255, 224, 120, 0.95)"; ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.restore();
    }
    const pdr = polyDraft.current;
    if (pdr && pdr.length) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      pdr.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      const pq = pointer.current;
      if (pq) ctx.lineTo(pq.x, pq.y);
      if (pdr.length >= 2) { ctx.fillStyle = "rgba(255, 255, 255, 0.08)"; ctx.fill(); ctx.fillStyle = "rgba(255, 255, 255, 0.95)"; }
      ctx.stroke();
      ctx.setLineDash([]);
      pdr.forEach(([x, y], i) => { ctx.beginPath(); ctx.arc(v.ox + x * v.scale, v.oy + y * v.scale, i === 0 && pdr.length >= 3 ? 5.5 : 3.5, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();
    }
    const rd = regionDraft.current;
    if (rd && rd.length) {
      ctx.save();
      ctx.strokeStyle = "rgba(196, 128, 255, 0.95)";
      ctx.fillStyle = "rgba(196, 128, 255, 0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      rd.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      const pp = pointer.current;
      if (pp) ctx.lineTo(pp.x, pp.y);
      ctx.stroke();
      for (const [x, y] of rd) { ctx.beginPath(); ctx.arc(v.ox + x * v.scale, v.oy + y * v.scale, 3.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    hitsRef.current = drawFeatures(ctx, withWaterLabels(f, waterRef.current), { scale: v.scale, ox: v.ox, oy: v.oy, mapWidth: m.width, fitScale: Math.min(W / m.width, H / m.height) * 0.95, labelScale: optsRef.current.labelScale, labels: optsRef.current.showLabels, markers: optsRef.current.showMarkers }, groupRef.current.length >= 2 ? new Set(groupRef.current) : selRef.current);
    drawSelectionOverlay(ctx, v, selectionRef.current.selection, selectionRef.current.lock, f, drag.current, pointer.current, optsRef.current.areaShape, toMapRef.current);
    // title, scale bar, compass and frame (what exports will show)
    drawFurniture(ctx, m.furniture, { x: v.ox, y: v.oy, w: m.width * v.scale, h: m.height * v.scale, mapWidthPx: m.width, kmPerPx: m.kmPerPx, unit: viewUnit(m.width * v.scale) });
    // regional maps made from this one
    for (const cm of childMapsRef.current) {
      const r = cm.parent!.rect;
      ctx.save();
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(v.ox + r.x * v.scale, v.oy + r.y * v.scale, r.w * v.scale, r.h * v.scale);
      ctx.setLineDash([]);
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(15, 18, 28, 0.85)";
      ctx.fillStyle = "#fff";
      ctx.strokeText(`${cm.name} ↗`, v.ox + r.x * v.scale + 2, v.oy + r.y * v.scale - 3);
      ctx.fillText(`${cm.name} ↗`, v.ox + r.x * v.scale + 2, v.oy + r.y * v.scale - 3);
      ctx.restore();
    }
    // the area being dragged for a new regional map
    const dr = drag.current;
    if (dr?.mode === "rect" && pointer.current) {
      const a = toMapRef.current(dr.sx, dr.sy), b = toMapRef.current(pointer.current.x, pointer.current.y);
      const plan = planRegional({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, m.width, m.height);
      const x0 = Math.min(dr.sx, pointer.current.x), y0 = Math.min(dr.sy, pointer.current.y);
      const w = Math.abs(pointer.current.x - dr.sx), h = Math.abs(pointer.current.y - dr.sy);
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.strokeStyle = "error" in plan ? "rgba(255, 150, 150, 0.95)" : "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeRect(x0, y0, w, h);
      const text = "error" in plan ? "Too small or too large"
        : `${plan.factor}× detail: ${plan.width}×${plan.height} px, ${(m.kmPerPx / plan.factor * 0.621371).toFixed(2)} mi per px`;
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(15, 18, 28, 0.9)";
      ctx.fillStyle = "#fff";
      ctx.strokeText(text, x0 + 4, y0 + h + 5);
      ctx.fillText(text, x0 + 4, y0 + h + 5);
      ctx.restore();
    }
    // a river's course being drawn: blue, with its first point (the source) marked
    const rv = drag.current;
    if (rv?.mode === "river" && rv.pts && rv.pts.length > 1) {
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(10, 30, 60, 0.7)"; ctx.lineWidth = 5;
      ctx.beginPath();
      rv.pts.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      ctx.stroke();
      ctx.strokeStyle = "rgba(110, 200, 255, 0.95)"; ctx.lineWidth = 2.5;
      ctx.stroke();
      const [sx, sy] = rv.pts[0];
      ctx.fillStyle = "rgba(110, 200, 255, 0.95)"; ctx.beginPath(); ctx.arc(v.ox + sx * v.scale, v.oy + sy * v.scale, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // a label line being drawn
    const dl = drag.current;
    if (dl?.mode === "draw" && dl.pts && dl.pts.length > 1) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      dl.pts.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      ctx.stroke();
      ctx.restore();
    }
    // another map being compared with this one, over it (compare.ts)
    compareCtl.draw(ctx, m.id, v, W, H);
    // what the River tool points at: its name, or that a click names it
    const wh = waterHover.current;
    if (optsRef.current.tool === "river" && riverRef.current.mode === "name" && wh && pointer.current) {
      const tip = wh.named ? `${wh.named.name} (click to select)` : `Click to name this ${wh.kind}`;
      ctx.save();
      ctx.font = "600 12px system-ui, sans-serif";
      const tw = ctx.measureText(tip).width + 12, tx = pointer.current.x + 14, ty = pointer.current.y + 14;
      ctx.fillStyle = "rgba(15, 18, 28, 0.88)"; ctx.fillRect(tx, ty, tw, 20);
      ctx.fillStyle = "#dff6ff"; ctx.textBaseline = "middle"; ctx.fillText(tip, tx + 6, ty + 10);
      ctx.restore();
    }
    // where a "Battlemap here" scene would be made
    if ((optsRef.current.tool === "battlehere" || optsRef.current.tool === "cityhere") && pointer.current) {
      const q = pointer.current;
      ctx.save();
      ctx.strokeStyle = "rgba(255, 224, 120, 0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.moveTo(q.x - 15, q.y); ctx.lineTo(q.x + 15, q.y); ctx.moveTo(q.x, q.y - 15); ctx.lineTo(q.x, q.y + 15); ctx.stroke();
      ctx.restore();
    }
    // brush cursor
    const p = pointer.current;
    const { tool: t, brush: b } = optsRef.current;
    if (p && isBrush(t) && !spaceDownRef.current) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, b.radius * v.scale), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, b.radius * v.scale), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 3;
      ctx.globalCompositeOperation = "destination-over";
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    reportView();
  }

  /** Tell the server (so Claude can ask) which part of the map is on screen: after the view settles. */
  function reportView() {
    const m = metaRef.current, w = wrapRef.current;
    if (!m || !w) return;
    const v = viewRef.current;
    const x0 = Math.max(0, -v.ox / v.scale), y0 = Math.max(0, -v.oy / v.scale);
    const x1 = Math.min(m.width, (w.clientWidth - v.ox) / v.scale), y1 = Math.min(m.height, (w.clientHeight - v.oy) / v.scale);
    if (x1 <= x0 || y1 <= y0) return;
    const rect = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    const key = `${rect.x},${rect.y},${rect.w},${rect.h},${v.scale.toFixed(3)}`;
    if (key === viewKey.current) return;
    viewKey.current = key;
    if (viewTimer.current) clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => store.sendView(rect, Math.round(v.scale * 1000) / 1000), 400);
  }

  const spaceDownRef = useRef(false);
  spaceDownRef.current = spaceDown;

  // climate layers go to the paint worker; rivers are vector paths drawn here, rebuilt whenever new layers arrive (even if no pixel changes)
  useEffect(() => store.onDerived((frame) => {
    buildRivers();
    requestDraw();
    const v = paintView();
    if (v) clientRef.current?.derived(frame, v);
  }), [requestDraw, paintView]);
  useEffect(() => store.onPatch((r, why) => {
    const c = clientRef.current, hf = store.heights, v = paintView();
    if (why === "snapshot") { buildRivers(); openMap(); return; }
    if (!c || !hf || !v) return;
    if (!r) c.repaint(null, v); // a setting changed how the whole map looks
    else c.patch(r, hf.copyRect(r), v);
  }), [paintView]);
  // a new style, or relief shading switched on or off
  useEffect(() => { const v = paintView(); if (v) clientRef.current?.repaint(null, v); }, [hillshade, showRivers, meta?.style, paintView]);
  useEffect(() => { requestDraw(); }, [labelScale, showGrid, smooth, showRivers, showRegions, showLabels, showMarkers, tool, brush, features, selectedId, meta, selection, selectionLock, areaShape, water, riverMode, requestDraw]);
  useEffect(() => {
    // fonts load asynchronously; redraw labels once Cinzel is ready
    void loadLabelFonts().then(() => requestDraw());
  }, [requestDraw]);
  // the map's identity or seed changed (or the heights arrived before this view had its meta)
  useEffect(() => { if (meta && store.heights) openMap(); }, [meta?.id, meta?.width, meta?.height, meta?.seed]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { const w = wrapRef.current; if (w) keeper.resized(w.clientWidth, w.clientHeight); requestDraw(); });
    if (wrapRef.current) ro.observe(wrapRef.current);
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) { setSpaceDown(true); e.preventDefault(); }
      const view = isTyping(e) ? null : viewKeyAction(e);
      // (arrow keys nudge what is selected; they move the view only when nothing is)
      if (view && !(view.kind === "pan" && worldIds().some((id) => featureKindOf(featuresRef.current, id)))) { e.preventDefault(); keyView(view); }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceDown(false); };
    const del = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      // outlining an area corner by corner: Enter closes it, Escape cancels, Backspace drops the last corner
      if (polyDraft.current) {
        if (e.key === "Enter") finishPoly();
        else if (e.key === "Escape") polyDraft.current = null;
        else if (e.key === "Backspace" || e.key === "Delete") { polyDraft.current.pop(); if (polyDraft.current.length === 0) polyDraft.current = null; }
        else return;
        e.preventDefault();
        requestDraw();
        return;
      }
      // drawing a climate region: Enter closes it, Escape cancels, Backspace drops the last corner
      if (regionDraft.current) {
        if (e.key === "Enter") finishRegion();
        else if (e.key === "Escape") regionDraft.current = null;
        else if (e.key === "Backspace" || e.key === "Delete") regionDraft.current.pop();
        else return;
        e.preventDefault();
        requestDraw();
        return;
      }
      // drawing a road, trail or border: Enter finishes, Escape cancels, Backspace drops the last point
      if (lineDraft.current) {
        if (e.key === "Enter") finishLine(false);
        else if (e.key === "Escape") lineDraft.current = null;
        else if (e.key === "Backspace" || e.key === "Delete") lineDraft.current.pop();
        else return;
        if (lineDraft.current && lineDraft.current.length === 0) lineDraft.current = null;
        e.preventDefault();
        requestDraw();
        return;
      }
      const arrow = ARROW_DIRECTION[e.key];
      if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey && nudge(arrow[0], arrow[1], e.shiftKey)) { e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        // (Ctrl+C and Ctrl+V let the browser's copy and paste events happen: a picture copied after the map items is pasted as a reference instead, see clipboard.ts)
        if (k === "c") { if (copySelection()) itemsCopied(); return; }
        if (k === "v") { armItemsPaste("world", pasteClip); return; }
        if (k === "d") { e.preventDefault(); duplicateSelection(); return; } // (Ctrl+D is "bookmark this page" in a browser)
      }
      if ((e.key === "Delete" || e.key === "Backspace") && groupRef.current.length >= 2) {
        const ids = groupRef.current;
        store.send({ t: "cmd", cmd: { op: "features", patch: deleteFeatures(featuresRef.current, ids) }, label: `Delete ${ids.length} items` });
        setGroupIds([]);
        onSelect(null);
        e.preventDefault();
        return;
      }
      if ((e.key !== "Delete" && e.key !== "Backspace") || !selRef.current) return;
      const id = selRef.current, f = featuresRef.current;
      // a named river or lake loses its name (the water itself stays); a river source is removed
      const wn = f.waterNames?.find((w) => w.id === id);
      if (wn) { store.send({ t: "cmd", cmd: { op: "features", patch: { removeWaterNames: [id] }, label: `Remove the name of the ${wn.kind} ${wn.name}` } }); onSelect(null); return; }
      if (f.sources?.some((x) => x.id === id)) { store.send({ t: "cmd", cmd: { op: "features", patch: { removeSources: [id] }, label: "Remove a river source" } }); onSelect(null); return; }
      const place = f.places.find((p) => p.id === id);
      const region = f.regions?.find((r) => r.id === id);
      const line = f.lines?.find((l) => l.id === id);
      if (!place && !region && !line && !f.labels.some((l) => l.id === id)) return; // nothing real is selected (e.g. a road still being routed)
      const name = place?.name ?? region?.name ?? line?.name ?? line?.kind ?? f.labels.find((l) => l.id === id)?.text ?? "";
      const patch = place ? { removePlaces: [id] } : region ? { removeRegions: [id] } : line ? { removeLines: [id] } : { removeLabels: [id] };
      store.send({ t: "cmd", cmd: { op: "features", patch, label: `Delete ${name}` } });
      onSelect(null);
    };
    window.addEventListener("keydown", del);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => { ro.disconnect(); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("keydown", del); };
  }, [requestDraw, onSelect]);

  const toMap = (sx: number, sy: number) => {
    const v = viewRef.current;
    return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
  };
  toMapRef.current = toMap;

  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function dab(mx: number, my: number, target?: number) {
    const { tool: t, brush: b } = optsRef.current;
    if (!isBrush(t)) return;
    const mode: SculptMode = t;
    const amount = t === "land" || t === "water" ? 40 + b.strength * 200 : 15 + b.strength * 400; // metres per dab
    store.send({ t: "cmd", cmd: { op: "sculpt", params: {
      mode, shape: { type: "circle", x: mx, y: my, r: b.radius }, amountM: amount, strength: b.strength, falloff: 0.6, targetM: target,
    } } });
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!metaRef.current || !store.heights) return;
    const p = local(e);
    const v = viewRef.current;
    canvasRef.current!.setPointerCapture(e.pointerId);
    if (moveOverride.current && !drag.current) commitNudge(); // (a nudge still waiting goes first, so it can't be mistaken for this drag)
    // lining up the trace picture takes a left click, whatever the tool (Space still pans)
    if (e.button === 0 && !spaceDownRef.current) {
      const tm = toMap(p.x, p.y);
      if (traceCtl.down(featuresRef.current.trace, tm)) {
        drag.current = { mode: "trace", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: tm.x, lastY: tm.y };
        requestDraw();
        return;
      }
    }
    const panning = e.button === 1 || e.button === 2 || optsRef.current.tool === "pan" || spaceDownRef.current;
    if (panning) {
      drag.current = { mode: "pan", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: 0, lastY: 0 };
      return;
    }
    if (e.button !== 0) return;
    const m = toMap(p.x, p.y);
    const tl = optsRef.current.tool;
    if (tl === "battlehere") {
      onBattleRef.current(m.x, m.y);
      return;
    }
    if (tl === "cityhere") {
      // a town's marker gives its own spot and kind (the size follows it); anywhere else is just a spot
      const hit = hitTest(hitsRef.current, p.x, p.y), pl = hit?.kind === "place" ? featuresRef.current?.places.find((q) => q.id === hit.id) : undefined;
      onCityRef.current?.(pl ? pl.x : m.x, pl ? pl.y : m.y, pl ? { name: pl.name, type: pl.type } : null);
      return;
    }
    if (tl === "detail") {
      drag.current = { mode: "rect", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y };
      return;
    }
    if (tl === "river") {
      const f = featuresRef.current;
      // a river source under the pointer is selected (to change its size or remove it), in either mode
      const near = sourceSpots(f).find((s) => Math.hypot((s.x - m.x) * v.scale, (s.y - m.y) * v.scale) < 9);
      if (near) { onSelect(near.id); return; }
      if (riverRef.current.mode === "add") {
        // a drag draws the river's course; a click that doesn't move starts a river at that spot (see endDrag)
        drag.current = { mode: "river", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, pts: [[m.x, m.y]], len: 0 };
        return;
      }
      const pick = waterHover.current ?? pickAt(m.x, m.y);
      if (pick) riverRef.current.onPick?.(pick);
      else onSelect(null);
      return;
    }
    if (tl === "area" && optsRef.current.areaShape === "poly") {
      // click the corners; a double-click, or a click on the first corner, closes the outline (Enter does too)
      const pd = polyDraft.current ?? [];
      const [fx, fy] = pd[0] ?? [0, 0];
      const nearFirst = pd.length >= 3 && Math.hypot((fx - m.x) * v.scale, (fy - m.y) * v.scale) < 10;
      const lc = lastClick.current, now = performance.now();
      const dbl = !!lc && now - lc.t < 400 && Math.hypot(p.x - lc.x, p.y - lc.y) < 8;
      lastClick.current = { t: now, x: p.x, y: p.y };
      if (nearFirst || (dbl && pd.length >= 3)) finishPoly();
      else polyDraft.current = [...pd, [m.x, m.y]];
      requestDraw();
      return;
    }
    if (tl === "area") {
      // drag out a rectangle, circle (from its centre) or freehand shape; a click that doesn't move picks that point
      drag.current = { mode: "area", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, pts: [[m.x, m.y]] };
      return;
    }
    if (tl === "line") {
      const ld = lineDraft.current ?? [];
      const [fx, fy] = ld[0] ?? [0, 0];
      const nearFirst = optsRef.current.lineKind === "border" && ld.length >= 3 && Math.hypot((fx - m.x) * v.scale, (fy - m.y) * v.scale) < 10;
      const lc = lastClick.current, now = performance.now();
      const dbl = !!lc && now - lc.t < 400 && Math.hypot(p.x - lc.x, p.y - lc.y) < 8;
      lastClick.current = { t: now, x: p.x, y: p.y };
      if (nearFirst) finishLine(true);
      else if (dbl) finishLine(false);
      else lineDraft.current = [...ld, [m.x, m.y]];
      requestDraw();
      return;
    }
    if (tl === "region") {
      const rd = regionDraft.current ?? [];
      const [fx, fy] = rd[0] ?? [0, 0];
      const nearFirst = rd.length >= 3 && Math.hypot((fx - m.x) * v.scale, (fy - m.y) * v.scale) < 10;
      // a double-click (second click soon after, in about the same spot) closes the outline
      const lc = lastClick.current, now = performance.now();
      const dbl = !!lc && now - lc.t < 400 && Math.hypot(p.x - lc.x, p.y - lc.y) < 8;
      lastClick.current = { t: now, x: p.x, y: p.y };
      if (dbl || nearFirst) finishRegion();
      else regionDraft.current = [...rd, [m.x, m.y]];
      requestDraw();
      return;
    }
    if (tl === "select") {
      let hit = hitTest(hitsRef.current, p.x, p.y);
      const f = featuresRef.current;
      if (!hit && (optsRef.current.showRegions || f.regions?.some((r) => r.id === selRef.current))) {
        const r = regionAt(f.regions, m.x, m.y);
        if (r) hit = { kind: "region", id: r.id, x0: 0, y0: 0, x1: 0, y1: 0 };
      }
      // several at once: Shift-click adds a place or label to the group (or takes it out); Shift-drag on bare ground draws a box that adds
      const groupable = !!hit && (hit.kind === "place" || hit.kind === "label");
      const isGroupMember = (id: string) => f.places.some((x) => x.id === id) || f.labels.some((x) => x.id === id);
      const before = worldIds().filter(isGroupMember);
      if (e.shiftKey && !hit) {
        drag.current = { mode: "marquee", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, add: true, base: before };
        return;
      }
      if (e.shiftKey && groupable && hit) {
        const ids = selectionIds(toggleInSelection(selectionFromIds(before), hit.id));
        setGroupIds(ids.length >= 2 ? ids : []);
        onSelect(ids.includes(hit.id) ? hit.id : ids[ids.length - 1] ?? null);
        if (ids.includes(hit.id) && ids.length >= 2) drag.current = { mode: "move", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, hit, ids, moved: false };
        return;
      }
      if (hit && groupRef.current.length >= 2 && groupRef.current.includes(hit.id)) {
        drag.current = { mode: "move", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, hit, ids: groupRef.current, moved: false, groupClick: true };
        return;
      }
      setGroupIds([]);
      onSelect(hit?.id ?? null);
      if (hit) {
        const item = hit.kind === "place" ? f.places.find((x) => x.id === hit.id) : hit.kind === "region" ? f.regions?.find((x) => x.id === hit.id)
          : hit.kind === "line" ? f.lines?.find((x) => x.id === hit.id) : f.labels.find((x) => x.id === hit.id);
        if (item) drag.current = { mode: "move", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, hit };
      } else {
        drag.current = { mode: "pan", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, pick: true };
      }
      return;
    }
    if (tl === "place") {
      const type = optsRef.current.placeType;
      void ask(`Name of this ${type}:`).then((name) => {
        if (!name) return;
        const id = newFeatureId("p");
        store.send({ t: "cmd", cmd: { op: "features", patch: { upsertPlaces: [{ id, name, type, x: m.x, y: m.y }] }, label: `Add place ${name}` } });
        onSelect(id);
      });
      return;
    }
    if (tl === "label") {
      // click: a label at that point; drag: a label that follows the line you draw
      drag.current = { mode: "draw", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, pts: [[m.x, m.y]], len: 0 };
      return;
    }
    const t = tl as BrushTool;
    const target = t === "flatten" ? store.heights.sample(m.x, m.y) : undefined;
    store.send({ t: "txn_begin", label: BRUSH_LABEL[t] });
    dab(m.x, m.y, target);
    drag.current = { mode: "brush", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, lastX: m.x, lastY: m.y, target };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    pointer.current = p;
    const m = toMap(p.x, p.y);
    const hf = store.heights, mt = metaRef.current;
    if (hf && mt && m.x >= 0 && m.y >= 0 && m.x < mt.width && m.y < mt.height) {
      setHover({ x: Math.floor(m.x), y: Math.floor(m.y), e: Math.round(hf.sample(m.x, m.y) - mt.seaLevel) });
    } else setHover(null);
    const d = drag.current;
    if (d?.mode === "trace") { traceCtl.move(m); return; }
    if (optsRef.current.tool === "river") waterHover.current = !d && riverRef.current.mode === "name" ? pickAt(m.x, m.y) : null;
    if (d?.mode === "pan") {
      viewRef.current = { ...viewRef.current, ox: d.ox + p.x - d.sx, oy: d.oy + p.y - d.sy };
    } else if (d?.mode === "move" && d.hit) {
      // a group only starts to move once the pointer has really moved: a click never shifts anything
      if (d.ids && !d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > 4) d.moved = true;
      if (!d.ids || d.moved) moveOverride.current = { id: d.hit.id, ids: d.ids, dx: m.x - d.lastX, dy: m.y - d.lastY };
    } else if (d?.mode === "area" && d.pts) {
      d.far = Math.max(d.far ?? 0, Math.hypot(p.x - d.sx, p.y - d.sy));
      const [lx, ly] = d.pts[d.pts.length - 1];
      if (optsRef.current.areaShape === "free" && Math.hypot(m.x - lx, m.y - ly) * viewRef.current.scale > 3) d.pts.push([m.x, m.y]);
    } else if ((d?.mode === "draw" || d?.mode === "river") && d.pts) {
      const [lx, ly] = d.pts[d.pts.length - 1];
      const ds = Math.hypot(m.x - lx, m.y - ly) * viewRef.current.scale;
      if (ds > 4) {
        d.pts.push([m.x, m.y]);
        d.len = (d.len ?? 0) + ds;
      }
    } else if (d?.mode === "brush") {
      const r = optsRef.current.brush.radius;
      const dist = Math.hypot(m.x - d.lastX, m.y - d.lastY);
      const spacing = Math.max(0.75, r * 0.3);
      if (dist >= spacing) {
        const steps = Math.min(20, Math.floor(dist / spacing));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          dab(d.lastX + (m.x - d.lastX) * t, d.lastY + (m.y - d.lastY) * t, d.target);
        }
        d.lastX = m.x;
        d.lastY = m.y;
      }
    }
    requestDraw();
  };

  const endDrag = () => {
    const d = drag.current;
    if (d?.mode === "trace") { drag.current = null; traceCtl.up(); return; }
    if (d?.mode === "brush") store.send({ t: "txn_end" });
    if (d?.mode === "pan" && d.pick && optsRef.current.tool === "select") {
      const pp = pointer.current;
      if (pp && Math.hypot(pp.x - d.sx, pp.y - d.sy) < 4) onPointRef.current(d.lastX, d.lastY);
    }
    if (d?.mode === "area") {
      drag.current = null;
      requestDraw();
      const pp = pointer.current;
      if (!pp) return;
      if ((d.far ?? 0) < 6) { onPointRef.current(d.lastX, d.lastY); return; }
      const scale = viewRef.current.scale;
      const shape = draftShape(optsRef.current.areaShape, { x: d.lastX, y: d.lastY }, toMap(pp.x, pp.y), d.pts, scale);
      if (shape) onAreaRef.current(shape);
      return;
    }
    const mo = moveOverride.current;
    if (d?.mode === "move" && d.ids && d.ids.length > 1) {
      const mt = metaRef.current;
      if (d.moved && mo && mt && Math.hypot(mo.dx, mo.dy) > 0.3) {
        const r = moveFeatures(featuresRef.current, d.ids, mo.dx, mo.dy, { w: mt.width, h: mt.height });
        if (r.dx || r.dy) store.send({ t: "cmd", cmd: { op: "features", patch: r.patch }, label: `Move ${d.ids.length} items` });
      } else if (!d.moved && d.groupClick && d.hit) {
        setGroupIds([]); // a click on one of a group picks that one alone
        onSelect(d.hit.id);
      }
    }
    if (d?.mode === "marquee") {
      const pp = pointer.current;
      if (pp && Math.hypot(pp.x - d.sx, pp.y - d.sy) >= 4) {
        const a = toMap(d.sx, d.sy), b = toMap(pp.x, pp.y);
        const found = boxSelect(featuresRef.current, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, ["place", "label"]);
        const ids = [...new Set([...(d.base ?? []), ...found])];
        setGroupIds(ids.length >= 2 ? ids : []);
        onSelect(ids.length ? ids[ids.length - 1] : null);
      }
    }
    if (d?.mode === "move" && d.hit && mo && Math.hypot(mo.dx, mo.dy) > 0.3 && !(d.ids && d.ids.length > 1)) {
      const f = featuresRef.current;
      if (d.hit.kind === "place") {
        const pl = f.places.find((x) => x.id === mo.id);
        if (pl) store.send({ t: "cmd", cmd: { op: "features", patch: { upsertPlaces: [{ ...pl, x: pl.x + mo.dx, y: pl.y + mo.dy }] }, label: `Move ${pl.name}` } });
      } else if (d.hit.kind === "line") {
        const ln = f.lines?.find((x) => x.id === mo.id);
        if (ln) store.send({ t: "cmd", cmd: { op: "features", patch: { upsertLines: [{ ...ln, points: ln.points.map(([x, y]) => [x + mo.dx, y + mo.dy] as [number, number]) }] }, label: `Move ${ln.kind}${ln.name ? ` ${ln.name}` : ""}` } });
      } else if (d.hit.kind === "region") {
        const rg = f.regions?.find((x) => x.id === mo.id);
        if (rg) store.send({ t: "cmd", cmd: { op: "features", patch: { upsertRegions: [{ ...rg, polygon: rg.polygon.map(([x, y]) => [x + mo.dx, y + mo.dy] as [number, number]) }] }, label: `Move climate region ${rg.name}` } });
      } else {
        const lb = f.labels.find((x) => x.id === mo.id);
        if (lb) store.send({ t: "cmd", cmd: { op: "features", patch: { upsertLabels: [moveLabel(lb, mo.dx, mo.dy)] }, label: `Move label ${lb.text}` } });
      }
    }
    if (d?.mode === "rect") {
      drag.current = null;
      requestDraw();
      const pp = pointer.current;
      if (!pp) return;
      const a = toMap(d.sx, d.sy), b = toMap(pp.x, pp.y);
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      if (rect.w * viewRef.current.scale > 6 && rect.h * viewRef.current.scale > 6) onDetailRef.current(rect);
      return;
    }
    if (d?.mode === "river" && d.pts) {
      drag.current = null;
      requestDraw();
      const size = riverRef.current.size;
      if ((d.len ?? 0) < 8 || d.pts.length < 2) {
        // a click: a river that starts here and finds its own way downhill
        if (!store.heights || store.heights.sample(d.lastX, d.lastY) <= (metaRef.current?.seaLevel ?? 0)) return; // (a river starts on land)
        const src: RiverSource = { id: newFeatureId("s"), x: Math.round(d.lastX * 10) / 10, y: Math.round(d.lastY * 10) / 10, size };
        store.send({ t: "cmd", cmd: { op: "features", patch: { upsertSources: [src] }, label: `Start a ${size === "major" ? "major river" : size === "great" ? "great river" : size} here` } });
        onSelect(src.id);
        return;
      }
      // a drag: the land is cut along the line so the river runs there (the server answers with river_drawn)
      store.drawRiver(d.pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]), size);
      return;
    }
    if (d?.mode === "draw" && d.pts) {
      drag.current = null;
      requestDraw();
      const pts = d.pts, len = d.len ?? 0, scale = viewRef.current.scale;
      void ask("Label text:").then((text) => {
        if (!text) return;
        const id = newFeatureId("l");
        const kind = optsRef.current.labelKind;
        let label: MapLabel;
        if (len > 24 && pts.length > 1) {
          const path = simplifyPath(pts, 1.5 / scale);
          const [x, y] = pathMidpoint(path);
          label = { id, text, kind, x, y, path, ...(kind === "range" && { spread: true }) };
        } else {
          label = { id, text, kind, x: pts[0][0], y: pts[0][1] };
        }
        store.send({ t: "cmd", cmd: { op: "features", patch: { upsertLabels: [label] }, label: `Add label ${text}` } });
        onSelect(id);
      });
      return;
    }
    moveOverride.current = null;
    drag.current = null;
    requestDraw();
  };

  /** The river or lake at a point (map px) with what is known about it, or null (the River tool reaches a few screen px either side of a river). */
  function pickAt(x: number, y: number): WaterPick | null {
    const wv = waterRef.current, rivers = store.derived?.rivers, mt = metaRef.current, hf = store.heights;
    if (!wv || !rivers || !mt) return null;
    return pickWater(rivers, wv, mt.kmPerPx, x, y, Math.max(1.2, 9 / viewRef.current.scale), hf ? { data: hf.data, w: hf.w, h: hf.h, sea: mt.seaLevel } : undefined);
  }

  /**
   * Finish the road, trail or border being drawn. Roads and trails are routed over the terrain
   * (by the server) unless automatic routing is off; borders and hand-drawn lines are used as drawn.
   */
  function finishLine(closed: boolean) {
    const pts = lineDraft.current;
    lineDraft.current = null;
    requestDraw();
    if (!pts || pts.length < 2) return;
    const { lineKind: kind, lineAuto: auto } = optsRef.current;
    const id = newFeatureId("m");
    if ((kind === "road" || kind === "trail") && auto) {
      onRouting(id);
      store.send({ t: "route_line", kind, points: pts, id });
    } else {
      const line = { id, kind, points: pts, ...(kind === "border" && closed && pts.length >= 3 && { closed: true }) };
      store.send({ t: "cmd", cmd: { op: "features", patch: { upsertLines: [line] }, label: `Add ${kind}` } });
    }
    onSelect(id);
  }

  /** Close the area being outlined corner by corner and select it. */
  function finishPoly() {
    const pts = polyDraft.current;
    polyDraft.current = null;
    requestDraw();
    if (!pts || pts.length < 3) return;
    onAreaRef.current({ type: "polygon", points: pts });
  }

  /** Close the climate region being drawn, name it and select it. */
  function finishRegion() {
    const pts = regionDraft.current;
    regionDraft.current = null;
    requestDraw();
    if (!pts || pts.length < 3) return;
    void ask("Name of this climate region:").then((name) => {
      if (!name) return;
      const id = newFeatureId("r");
      store.send({ t: "cmd", cmd: { op: "features", patch: { upsertRegions: [{ id, name, polygon: pts, border: "soft" }] }, label: `Add climate region ${name}` } });
      onSelect(id);
    });
  }

  /** Zoom in (about the middle of the view) until the grid's cells are comfortably readable. */
  function zoomToGrid() {
    const m = metaRef.current, w = wrapRef.current;
    if (!m?.grid || m.grid.type === "off" || !w) return;
    const target = Math.min(MAX_ZOOM, 26 / gridCellPx(m.grid, m.kmPerPx));
    const v = viewRef.current;
    if (target <= v.scale) return;
    const W = w.clientWidth, H = w.clientHeight;
    const mx = (W / 2 - v.ox) / v.scale, my = (H / 2 - v.oy) / v.scale;
    viewRef.current = { scale: target, ox: W / 2 - mx * target, oy: H / 2 - my * target };
    requestDraw();
  }

  // switching tools abandons a half-drawn line or region
  useEffect(() => { lineDraft.current = null; regionDraft.current = null; polyDraft.current = null; waterHover.current = null; requestDraw(); }, [tool, areaShape, riverMode, requestDraw]);
  // new rivers or names: what is under the pointer is looked for again
  useEffect(() => { waterHover.current = null; requestDraw(); }, [water, requestDraw]);

  const onWheel = (e: React.WheelEvent) => {
    const p = local(e);
    const v = viewRef.current;
    const k = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(MAX_ZOOM, Math.max(0.05, v.scale * k));
    const mx = (p.x - v.ox) / v.scale, my = (p.y - v.oy) / v.scale;
    viewRef.current = { scale, ox: p.x - mx * scale, oy: p.y - my * scale };
    requestDraw();
  };

  const cursor = traceMode === "move" && features.trace ? "move" : traceMode && features.trace ? "crosshair"
    : spaceDown || tool === "pan" ? (drag.current?.mode === "pan" ? "grabbing" : "grab")
    : tool === "select" ? "default" : tool === "river" ? "pointer" : tool === "place" || tool === "label" || tool === "region" || tool === "detail" || tool === "area" || tool === "line" || tool === "battlehere" || tool === "cityhere" ? "crosshair" : "none";

  return (
    <div className="mapview-col">
    <div className="mapview" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onMouseDown={noShiftTextSelect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { pointer.current = null; waterHover.current = null; setHover(null); requestDraw(); }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="map-canvas"
      />
      {group.length >= 2 && <div className="mapview-group" data-testid="world-group">{group.length} places and labels selected: drag to move, Delete to remove, Ctrl+D to duplicate</div>}
      {children}
      {meta && <TraceBar trace={features.trace} meta={meta} />}
      {meta && <CompareBar meta={meta} />}
      {(!meta || loadedId !== meta.id) && <div className="mapview-empty">Loading map…</div>}
      {status && meta && loadedId === meta.id && <div className="mapview-busy">{status}</div>}
      {exportOpen && meta && (
        <ExportDialog
          meta={meta} onClose={() => setExportOpen(false)}
          source={() => (offRef.current ? { off: offRef.current, meta, features: withWaterLabels(featuresRef.current, waterRef.current), rivers: riverChunks.current } : null)}
        />
      )}
      {gridTooFine && meta?.grid && (
        <div className="mapview-note" data-testid="grid-too-fine">
          {gridCellPx(meta.grid, meta.kmPerPx) * MAX_ZOOM >= MIN_CELL_SCREEN_PX ? (
            <>The grid's cells are too small to see at this zoom. <button onClick={zoomToGrid}>Zoom in to see the grid</button></>
          ) : (
            <>Cells this small are finer than this map's detail. Use a bigger size, or make a detail map of the area.</>
          )}
        </div>
      )}
    </div>
    <StatusBar
      zoom={zoomPct} zoomTitle="100% shows one pixel of the map as one pixel of the screen" onZoom={(dir) => keyView({ kind: "zoom", factor: dir > 0 ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP })}
      onFit={() => { fittedFor.current = null; fit(); requestDraw(); }}
      switches={onShowGrid ? [{ label: "Coordinates", on: showGrid, onToggle: onShowGrid, title: "The coordinate numbers along the edges (G)", testId: "bar-grid" }] : []}
      info={<>
        {hover && meta ? (
          <>x {hover.x} · y {hover.y} · {hover.e >= 0 ? `${hover.e} m` : `${-hover.e} m deep`}</>
        ) : meta ? (
          <>{meta.width}×{meta.height} px</>
        ) : null}
        {gridTooFine && <> · <b>Grid cells are too small to draw here: zoom in</b></>}
        {meta && <> · {meta.kmPerPx} km/px · {Math.round((meta.width * meta.kmPerPx) / 1.609).toLocaleString()} mi across</>}
      </>}
    >
      <button onClick={() => setExportOpen(true)} title="Export the map as a PNG, or tiles for very large sizes" data-testid="export-button">⤓ Export</button>
    </StatusBar>
    </div>
  );
}

/** The shape a drag so far makes (null when it is too small or has too few points to be an area), in map px. */
function draftShape(kind: AreaShape, a: { x: number; y: number }, b: { x: number; y: number }, pts: [number, number][] | undefined, scale: number): SelectableShape | null {
  const px = (n: number) => n * scale;
  if (kind === "rect") {
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    return px(w) > 6 && px(h) > 6 ? { type: "rect", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h } : null;
  }
  if (kind === "circle") {
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    return px(r) > 6 ? { type: "circle", x: a.x, y: a.y, r } : null;
  }
  if (!pts || pts.length < 3) return null;
  const poly = simplifyPath(pts, 1.5 / scale);
  if (poly.length < 3) return null;
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return px(Math.max(...xs) - Math.min(...xs)) > 6 && px(Math.max(...ys) - Math.min(...ys)) > 6 ? { type: "polygon", points: poly } : null;
}

function shapePath(ctx: CanvasRenderingContext2D, s: SelectableShape, v: View) {
  ctx.beginPath();
  if (s.type === "rect") ctx.rect(v.ox + s.x * v.scale, v.oy + s.y * v.scale, s.w * v.scale, s.h * v.scale);
  else if (s.type === "circle") ctx.arc(v.ox + s.x * v.scale, v.oy + s.y * v.scale, s.r * v.scale, 0, Math.PI * 2);
  else {
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
    ctx.closePath();
  }
}

/** The DM's selection in gold (dashed; solid and thicker with a "Locked" tag while Claude's edits are locked to it), a ring for a point, and the shape being dragged out. */
function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D, v: View, sel: Selection | null, locked: boolean, f: Features,
  d: { mode: string; sx: number; sy: number; lastX: number; lastY: number; pts?: [number, number][] } | null,
  pointerPos: { x: number; y: number } | null, areaShape: AreaShape, toMap: (sx: number, sy: number) => { x: number; y: number },
) {
  const shape = selectionShape(sel, f);
  ctx.save();
  if (shape) {
    shapePath(ctx, shape, v);
    ctx.fillStyle = locked ? "rgba(255, 215, 60, 0.13)" : "rgba(255, 215, 60, 0.08)";
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(40, 28, 4, 0.75)";
    ctx.lineWidth = locked ? 5 : 4;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 215, 60, 0.98)";
    ctx.lineWidth = locked ? 2.5 : 1.8;
    ctx.setLineDash(locked ? [] : [7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (locked) {
      let x0 = Infinity, y0 = Infinity;
      if (shape.type === "rect") { x0 = shape.x; y0 = shape.y; }
      else if (shape.type === "circle") { x0 = shape.x - shape.r; y0 = shape.y - shape.r; }
      else for (const [x, y] of shape.points) { if (y < y0 || (y === y0 && x < x0)) { x0 = x; y0 = y; } }
      const tx = v.ox + x0 * v.scale, ty = v.oy + y0 * v.scale - 6;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textBaseline = "bottom";
      const label = forAssistant("Claude's edits are locked to this");
      const wdt = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(255, 215, 60, 0.95)";
      ctx.fillRect(tx, ty - 17, wdt, 17);
      ctx.fillStyle = "#241a02";
      ctx.fillText(label, tx + 6, ty - 3);
    }
  } else if (sel?.kind === "point") {
    const x = v.ox + sel.x * v.scale, y = v.oy + sel.y * v.scale;
    ctx.strokeStyle = "rgba(255, 215, 60, 0.98)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.moveTo(x - 14, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 14); ctx.stroke();
  }
  if (d?.mode === "area" && pointerPos && ((d as { far?: number }).far ?? 0) >= 6) {
    const dr = draftShape(areaShape, { x: d.lastX, y: d.lastY }, toMap(pointerPos.x, pointerPos.y), d.pts, v.scale);
    const draft: SelectableShape | null = dr ?? (areaShape === "free" && d.pts && d.pts.length >= 2 ? { type: "polygon", points: d.pts.length >= 3 ? d.pts : [...d.pts, d.pts[0]] } : null);
    if (draft) {
      shapePath(ctx, draft, v);
      ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A river's course or a lake's shore, highlighted (a dark edge under a bright line). */
function drawWaterShape(ctx: CanvasRenderingContext2D, v: View, s: { course?: number[]; outline?: [number, number][] }, colour: string) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (s.course) for (let k = 0; k < s.course.length; k += 2) { const x = v.ox + s.course[k] * v.scale, y = v.oy + s.course[k + 1] * v.scale; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  else if (s.outline) { s.outline.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale))); ctx.closePath(); }
  ctx.strokeStyle = "rgba(8, 16, 28, 0.7)";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

/** Where each river source is (map px): at its place, or its own point. */
function sourceSpots(f: Features): { id: string; x: number; y: number }[] {
  const out: { id: string; x: number; y: number }[] = [];
  for (const s of f.sources ?? []) {
    const at = s.placeId ? f.places.find((p) => p.id === s.placeId) : s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y } : undefined;
    if (at) out.push({ id: s.id, x: at.x, y: at.y });
  }
  return out;
}

/** The river sources while the River tool is in use: blue drops, the selected one ringed in gold. */
function drawSources(ctx: CanvasRenderingContext2D, v: View, f: Features, selected: string | null) {
  ctx.save();
  for (const s of sourceSpots(f)) {
    const x = v.ox + s.x * v.scale, y = v.oy + s.y * v.scale;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#3ea6ff"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = s.id === selected ? "rgba(255, 215, 60, 0.98)" : "#ffffff"; ctx.stroke();
  }
  ctx.restore();
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable);
}

function drawGridOverlay(ctx: CanvasRenderingContext2D, m: MapMeta, v: View, W: number, H: number) {
  const target = 90; // screen px between lines
  const raw = target / v.scale;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 3;
  for (let gx = 0; gx <= m.width; gx += step) {
    const x = Math.round(v.ox + gx * v.scale) + 0.5;
    if (x < 0 || x > W) continue;
    ctx.beginPath(); ctx.moveTo(x, Math.max(0, v.oy)); ctx.lineTo(x, Math.min(H, v.oy + m.height * v.scale)); ctx.stroke();
    ctx.fillText(String(Math.round(gx)), x + 3, Math.max(12, v.oy + 12));
  }
  for (let gy = 0; gy <= m.height; gy += step) {
    const y = Math.round(v.oy + gy * v.scale) + 0.5;
    if (y < 0 || y > H) continue;
    ctx.beginPath(); ctx.moveTo(Math.max(0, v.ox), y); ctx.lineTo(Math.min(W, v.ox + m.width * v.scale), y); ctx.stroke();
    ctx.fillText(String(Math.round(gy)), Math.max(3, v.ox + 3), y - 3);
  }
  ctx.restore();
}
