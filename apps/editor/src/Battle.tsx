/**
 * Battlemap editing: the canvas (floors from the shared renderer, walls, doors and lights drawn as
 * crisp vectors), the tool panels, and the export dialog. Coordinates in here are grid SQUARES unless
 * a name says "cells" (the floor is stored at `sub` cells per square).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BattleSpec, type Features, type MapAmbientZone, type MapDoc, type MapLight, type MapMeta, type MapNote, type MapProp, type MapWall, type PaletteEntry, type Rect, type TileSource, type WallKind,
  CUSTOM_MATERIAL_BASE, LIGHT_PRESETS, LIGHT_PRESET_NAMES, MATERIALS, PROP_PX_PER_SQUARE, ambientOf, applyLightPreset, assetLabel, battleSpec, circlePolygon, floorAtFn, hexToRgb, insertDoor, lightPresetName, lightVisibility, newFeatureId, nextNoteNumber, noteBadge, readingOrderNumbers, sortedNotes, parseAssetId, renderBattleFloor, renderWallLayer, roomWalls, visibilityPolygon, wallSegments, wallsAroundFloor,
} from "@mapmaker/core";
import { type FeatureClip, type ViewKeyAction, ARROW_DIRECTION, applyViewKey, boxSelect, clipBounds, copyFeatures, deleteFeatures, featureKindOf, moveFeatures, pasteFeatures, selectionFromIds, selectionIds, toggleInSelection, viewKeyAction } from "@mapmaker/core";
import { getClip, setClip, unstack } from "./clipboard.ts";
import { noShiftTextSelect } from "./noShiftSelect.ts";
import { assetUrl } from "./assetsApi.ts";
import { drawMapGrid } from "./drawMapGrid.ts";
import { downloadBlob } from "./exportMap.ts";
import { store } from "./store.ts";

export type BattleTool = "pan" | "select" | "brush" | "area" | "room" | "wall" | "invisible" | "door" | "secret" | "window" | "light" | "zone" | "note" | "prop";

export interface BattleUi {
  tool: BattleTool;
  /** Material id painted by the floor tools (0 erases). */
  material: number;
  /** Brush radius, squares. */
  brush: number;
  showGrid: boolean;
  showLights: boolean;
  /** Draw the numbered room notes. */
  showNotes: boolean;
  selected: string | null;
  /** Two or more things selected together (then `selected` is null; never both). */
  multi: string[];
  /** The object chosen in the Assets tab (what the Object tool places). */
  asset: string | null;
  propScale: number;
  propRotation: number;
  propLayer: "above" | "below";
  propFlip: boolean;
  /** The shape the Area and Room tools make. */
  roomShape: "rect" | "circle" | "free";
}

export const defaultBattleUi: BattleUi = {
  tool: "pan", material: 1, brush: 1.5, showGrid: true, showLights: true, showNotes: true, selected: null, multi: [],
  asset: null, propScale: 1, propRotation: 0, propLayer: "above", propFlip: false, roomShape: "rect",
};

/** The name of a floor material, including pack textures. */
export function materialLabel(meta: MapMeta | null | undefined, id: number): string {
  if (id >= CUSTOM_MATERIAL_BASE) return meta?.battle?.palette?.find((e) => e.id === id)?.name ?? "texture";
  return id === 0 ? "void" : MATERIALS[id]?.name ?? "floor";
}

export const BATTLE_TOOL_GROUPS: { name: string; tools: { id: BattleTool; label: string; key: string; tip: string }[] }[] = [
  { name: "Move", tools: [
    { id: "pan", label: "Pan", key: "H", tip: "Drag to move the map (or hold Space / right-drag with any tool)" },
    { id: "select", label: "Select", key: "V", tip: "Click a wall, door, light or object to edit it. Shift-click, or drag a box round bare ground, to select several; drag to move what is selected (Shift or Alt while dragging: anywhere, not snapped). Delete removes it" },
  ] },
  { name: "Floor", tools: [
    { id: "brush", label: "Brush", key: "B", tip: "Paint the chosen floor material. Choose \"void\" to erase" },
    { id: "area", label: "Area", key: "A", tip: "Drag a rectangle of floor" },
  ] },
  { name: "Build", tools: [
    { id: "room", label: "Room", key: "R", tip: "Drag a room: floors it and builds its walls" },
    { id: "wall", label: "Wall", key: "W", tip: "Click the points of a wall; double-click or Enter to finish" },
    { id: "door", label: "Door", key: "D", tip: "Click a wall to cut a door into it" },
    { id: "secret", label: "Secret door", key: "S", tip: "Click a wall to cut a secret door into it" },
    { id: "window", label: "Window", key: "N", tip: "Click a wall to cut a window into it" },
    { id: "invisible", label: "Invisible wall", key: "I", tip: "Click points for a barrier that stops movement but isn't drawn or blocks light" },
  ] },
  { name: "Light", tools: [
    { id: "light", label: "Light", key: "L", tip: "Click to place a torch or other light" },
    { id: "zone", label: "Shade", key: "Z", tip: "Draw an area with its own light level, e.g. a building that is dimmer than outdoors" },
  ] },
  { name: "Key", tools: [
    { id: "note", label: "Note", key: "K", tip: "Click a room to add a numbered note to the map's key" },
  ] },
  { name: "Objects", tools: [
    { id: "prop", label: "Object", key: "P", tip: "Place an object from your asset packs (choose it in the Assets tab)" },
  ] },
];
export const BATTLE_TOOLS = BATTLE_TOOL_GROUPS.flatMap((g) => g.tools);

export const BATTLE_HINTS: Partial<Record<BattleTool, string>> = {
  brush: "Drag to paint the chosen floor. Pick a material below. [ and ] change the brush size.",
  area: "Drag a shape (rectangles snap to whole squares): it floors the area but builds no walls. Choose Rectangle, Circle (drag out from the centre) or Free-form (click the corners, double-click to finish).",
  room: "Drag a shape: it is floored with the chosen material and walled in. Choose Rectangle, Circle (drag out from the centre) or Free-form (click the corners, double-click or Enter to finish). Add doors afterwards with the Door tool.",
  wall: "Click the points of the wall. Double-click or press Enter to finish; click the first point to close a loop. Backspace removes the last point, Esc cancels. Points snap to half squares.",
  invisible: "Click the points of the barrier. Double-click or press Enter to finish. It stops movement only.",
  door: "Click on a wall: it is cut open and a door put in the gap.",
  secret: "Click on a wall: a secret door is put in the gap.",
  window: "Click on a wall: a window is put in the gap. Windows block movement but not sight.",
  light: "Click to place a light, then select it to change its size and colour.",
  zone: "Draw an area with its own light level (Rectangle, Circle or Free-form like the Area tool). Then select it to set how bright it is where no light reaches: indoors dimmer than outdoors, or a lit hall in a dark cave. Edges are soft.",
  note: "Click a room to place a numbered note, then give it a title and text in the panel. Notes are for you: they show here and in previews, never in the exported picture. Export the key as a list from Export.",
  prop: "Choose an object in the Assets tab, then click the map to place it (hold Alt to place without snapping). Q and E rotate, X mirrors.",
  select: "Click a wall piece, door, light, note or shaded area to select it. Drag a light, note or object to move it. Delete removes the selection.",
};

const snap = (v: number, step = 0.5) => Math.round(v / step) * step;
const isFloorTool = (t: BattleTool) => t === "brush" || t === "area" || t === "room";
/** Tools that draw a rectangle, circle or free-form outline. */
const isShapeTool = (t: BattleTool) => t === "area" || t === "room" || t === "zone";
/** How bright a new light zone is: dimmer than a bright map, brighter than a dim one. */
const newZoneLevel = (spec: BattleSpec) => (ambientOf(spec) > 0.7 ? 0.45 : Math.min(1, ambientOf(spec) * 2));
const doorKind = (t: BattleTool): "door" | "secret" | "window" | null => (t === "door" ? "door" : t === "secret" ? "secret" : t === "window" ? "window" : null);
const MAX_ZOOM = 400;

interface View { scale: number; ox: number; oy: number } // scale: screen px per square

/** Object placement snaps to a quarter square. */
const snapProp = (v: number, free: boolean) => (free ? v : Math.round(v / 0.25) * 0.25);
const send = (cmd: Parameters<typeof store.send>[0] & { t: "cmd" }) => store.send(cmd);
const sendFeatures = (patch: import("@mapmaker/core").FeaturesPatch, label: string) => send({ t: "cmd", cmd: { op: "features", patch }, label });
const toCells = (n: number, spec: BattleSpec) => n * spec.sub;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// ---------------------------------------------------------------- canvas
interface ViewProps {
  meta: MapMeta | null;
  features: Features;
  ui: BattleUi;
  onUi: (patch: Partial<BattleUi>) => void;
}

const BAND = 96;

export function BattleView({ meta, features, ui, onUi }: ViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<ImageData | null>(null);
  /** The wall layer (stone, doors, windows, shadows) from the shared renderer, and what it was drawn from. */
  const wallRef = useRef<{ cv: HTMLCanvasElement; px: number } | null>(null);
  const wallSig = useRef("");
  const wallTimer = useRef<number | undefined>(undefined);
  const viewRef = useRef<View>({ scale: 20, ox: 0, oy: 0 });
  const fittedFor = useRef<string | null>(null);
  const drawQueued = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ mode: "pan" | "brush" | "rect" | "circle" | "move" | "marquee"; sx: number; sy: number; ox: number; oy: number; ax: number; ay: number; lastX: number; lastY: number; id?: string;
    /** move: what is being dragged, whether the pointer has really moved yet, and whether it started on a member of a group (a click without a drag then picks that one). marquee: whether it adds to the selection, and what was selected before. */
    ids?: string[]; moved?: boolean; groupClick?: boolean; add?: boolean; base?: string[] } | null>(null);
  const draft = useRef<{ kind: WallKind; pts: [number, number][] } | null>(null);
  /** Corners of a free-form floor or room being clicked out. */
  const shapeDraft = useRef<[number, number][] | null>(null);
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null);
  /** Things being dragged: which, and how far (squares) from where they started. */
  const moveGroup = useRef<{ ids: string[]; dx: number; dy: number } | null>(null);
  const nudgeTimer = useRef<number | undefined>(undefined);
  const paintToken = useRef(0);
  const metaRef = useRef(meta); metaRef.current = meta;
  const featRef = useRef(features); featRef.current = features;
  const uiRef = useRef(ui); uiRef.current = ui;
  const onUiRef = useRef(onUi); onUiRef.current = onUi;
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false); spaceRef.current = spaceDown;
  const altRef = useRef(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; m: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const noteTimer = useRef<number | undefined>(undefined);
  /** Object images by asset id: loaded on demand from the server (a bitmap, and the original size in pixels). */
  const sprites = useRef(new Map<string, { bmp: ImageBitmap; w: number; h: number } | "loading" | "failed">());
  /** Pack floor textures by asset id, as 512 px RGBA. */
  const tiles = useRef(new Map<string, Uint8ClampedArray | "loading" | "failed">());

  const flash = (t: string) => {
    setNote(t);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 3500);
  };

  const requestDraw = useCallback(() => {
    if (drawQueued.current) return;
    drawQueued.current = true;
    requestAnimationFrame(() => { drawQueued.current = false; draw(); });
  }, []);

  const spriteFor = (id: string) => {
    const hit = sprites.current.get(id);
    if (hit && hit !== "loading" && hit !== "failed") return hit;
    if (!hit) {
      sprites.current.set(id, "loading");
      void fetch(assetUrl(id, 1024)).then(async (r) => {
        if (!r.ok) throw new Error("not found");
        const bmp = await createImageBitmap(await r.blob());
        sprites.current.set(id, { bmp, w: Number(r.headers.get("x-asset-width")) || bmp.width, h: Number(r.headers.get("x-asset-height")) || bmp.height });
        requestDraw();
      }).catch(() => sprites.current.set(id, "failed"));
    }
    return null;
  };

  const tileSource: TileSource = (matId) => {
    const entry = metaRef.current?.battle?.palette?.find((e) => e.id === matId);
    if (!entry) return null;
    const hit = tiles.current.get(entry.asset);
    if (hit && hit !== "loading" && hit !== "failed") return { data: hit, size: 512, squares: entry.squares ?? 4 };
    if (!hit) {
      tiles.current.set(entry.asset, "loading");
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 512;
        const cx = c.getContext("2d")!;
        cx.drawImage(img, 0, 0, 512, 512);
        tiles.current.set(entry.asset, cx.getImageData(0, 0, 512, 512).data);
        repaint(null);
      };
      img.onerror = () => tiles.current.set(entry.asset, "failed");
      img.src = assetUrl(entry.asset, 512);
    }
    return null;
  };

  /** Pixels per square in the editor's own copy of the floor image (lower than the export for huge maps). */
  const editPx = (spec: BattleSpec) => Math.max(16, Math.min(spec.pxPerSquare, Math.floor(4096 / Math.max(spec.squaresX, spec.squaresY))));

  /** Pixels per square for the wall layer at this zoom: sharp when zoomed in, within a memory budget. */
  const wallPx = (spec: BattleSpec, scale: number) => {
    const budget = Math.floor(Math.sqrt(12_000_000 / (spec.squaresX * spec.squaresY)));
    const want = Math.ceil(((scale * (window.devicePixelRatio || 1)) / 35)) * 35;
    return Math.max(8, Math.min(budget, Math.max(35, want), 210));
  };

  /** Draw the wall layer again if the walls, the map size or the zoom step changed (or `force`: the floors were repainted). */
  const buildWalls = useCallback((force = false) => {
    const m = metaRef.current, hf = store.heights;
    if (!m?.battle || !hf) return;
    const spec = m.battle, px = wallPx(spec, viewRef.current.scale), walls = featRef.current.walls ?? [];
    const sig = `${m.id}|${px}|${spec.squaresX}x${spec.squaresY}|${JSON.stringify(walls)}`;
    if (!force && sig === wallSig.current && wallRef.current) return;
    wallSig.current = sig;
    const layer = renderWallLayer({ ...spec, pxPerSquare: px }, walls, { floorAt: floorAtFn({ meta: m, height: hf } as MapDoc) });
    const cv = wallRef.current?.cv ?? document.createElement("canvas");
    cv.width = layer.w; cv.height = layer.h;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.w, layer.h), 0, 0);
    wallRef.current = { cv, px };
    requestDraw();
  }, []);

  const repaint = useCallback((r: Rect | null) => {
    const m = metaRef.current, hf = store.heights;
    if (!m || !m.battle || !hf) return;
    const spec = m.battle, px = editPx(spec);
    const W = spec.squaresX * px, H = spec.squaresY * px;
    let off = offRef.current;
    if (!off || off.width !== W || off.height !== H) {
      off = document.createElement("canvas");
      off.width = W; off.height = H;
      offRef.current = off;
      imgRef.current = new ImageData(W, H);
      r = null;
    }
    const img = imgRef.current!, ctx = off.getContext("2d")!;
    const doc: MapDoc = { meta: { ...m, battle: { ...spec, pxPerSquare: px } }, height: hf };
    const draw1 = (rect: Rect) => { renderBattleFloor(doc, img.data, rect, tileSource); ctx.putImageData(img, 0, 0, rect.x, rect.y, rect.w, rect.h); };
    if (r) {
      const cell = px / spec.sub, pad = 3;
      const x0 = Math.max(0, Math.floor((r.x - pad) * cell)), y0 = Math.max(0, Math.floor((r.y - pad) * cell));
      const x1 = Math.min(W, Math.ceil((r.x + r.w + pad) * cell)), y1 = Math.min(H, Math.ceil((r.y + r.h + pad) * cell));
      if (x1 > x0 && y1 > y0) draw1({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else {
      const token = ++paintToken.current;
      let y = 0;
      setStatus("Painting floors…");
      const step = () => {
        if (token !== paintToken.current || store.heights !== hf) return;
        draw1({ x: 0, y, w: W, h: Math.min(BAND, H - y) });
        requestDraw();
        y += BAND;
        if (y < H) setTimeout(step, 0); else { setStatus(null); buildWalls(true); }
      };
      step();
    }
    if (fittedFor.current !== m.id) fit();
    setLoadedId(m.id);
    requestDraw();
  }, [requestDraw, buildWalls]);

  /** Everything that is selected: one thing, or a group. */
  const selectedIds = () => selectionIds({ selected: uiRef.current.selected, multi: uiRef.current.multi });

  /** Ctrl+C: keep copies of the selected objects, lights, walls and light zones (room notes are numbered, so they aren't copied). */
  function copySelection(): boolean {
    const clip = copyFeatures(featRef.current, selectedIds());
    if (!clip) return false;
    setClip("battle", clip);
    return true;
  }

  /** Put a copy of `clip` on the map, `dx`, `dy` squares from where it came from, and select what was put there. */
  function pasteGroup(clip: FeatureClip, dx: number, dy: number, what: string) {
    const spec = metaRef.current?.battle;
    if (!spec) return;
    const r = pasteFeatures(clip, dx, dy, { bounds: { w: spec.squaresX, h: spec.squaresY } });
    sendFeatures(r.patch, `${what} ${r.ids.length === 1 ? "1 item" : `${r.ids.length} items`}`);
    onUiRef.current({ ...selectionFromIds(r.ids), tool: "select" });
  }

  /** Ctrl+V: paste what was copied, centred on the pointer (or a square along and down when the pointer is off the map). */
  function pasteClip(): boolean {
    const clip = getClip("battle");
    if (!clip) return false;
    const b = clipBounds(clip), p = pointer.current;
    let dx = 1, dy = 1;
    if (p) {
      const t = toSq(p.x, p.y);
      dx = snap(t.x - (b.x0 + b.x1) / 2); dy = snap(t.y - (b.y0 + b.y1) / 2);
    }
    ({ dx, dy } = unstack("battle", dx, dy, 1));
    pasteGroup(clip, dx, dy, "Paste");
    return true;
  }

  /** Ctrl+D: a copy of the selection one square along and down (the clipboard is left alone). */
  function duplicateSelection(): boolean {
    const clip = copyFeatures(featRef.current, selectedIds());
    if (!clip) return false;
    pasteGroup(clip, 1, 1, "Duplicate");
    return true;
  }

  /**
   * An arrow key with something selected: nudge it. Presses within a third of a second add up (the move is previewed as it grows) and are
   * sent as one command, so holding a key down is one undo step, not dozens. Returns whether it took the key.
   */
  function nudge(ax: number, ay: number, big: boolean): boolean {
    const f = featRef.current, spec = metaRef.current?.battle, ids = selectedIds();
    if (!spec || !ids.length) return false;
    if (drag.current) return true; // (the mouse is dragging something: leave it alone)
    const onlyObjects = ids.every((id) => f.props?.some((pr) => pr.id === id));
    const step = big ? 1 : onlyObjects ? 0.25 : 0.5; // a square with Shift; else the snap the thing has when dragged
    const pending = moveGroup.current && moveGroup.current.ids.length === ids.length && moveGroup.current.ids.every((id, i) => id === ids[i]) ? moveGroup.current : null;
    if (moveGroup.current && !pending) commitNudge(); // (the selection changed with a nudge still waiting: send that one first)
    const r = moveFeatures(f, ids, (pending?.dx ?? 0) + ax * step, (pending?.dy ?? 0) + ay * step, { w: spec.squaresX, h: spec.squaresY });
    moveGroup.current = { ids, dx: r.dx, dy: r.dy };
    requestDraw();
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(commitNudge, 350);
    return true;
  }

  function commitNudge() {
    window.clearTimeout(nudgeTimer.current);
    const mg = moveGroup.current, spec = metaRef.current?.battle, f = featRef.current;
    moveGroup.current = null;
    requestDraw();
    if (!mg || !spec) return;
    const r = moveFeatures(f, mg.ids, mg.dx, mg.dy, { w: spec.squaresX, h: spec.squaresY });
    if (!r.dx && !r.dy) return;
    const kind = mg.ids.length === 1 ? featureKindOf(f, mg.ids[0]) : null;
    sendFeatures(r.patch, mg.ids.length > 1 ? `Nudge ${mg.ids.length} items` : kind === "light" ? "Nudge light" : kind === "prop" ? "Nudge object" : kind === "wall" ? "Nudge wall piece" : kind === "zone" ? "Nudge light zone" : "Nudge note");
  }

  /** + - 0 and the arrow keys move the view (see core's viewKeys.ts). */
  function keyView(a: ViewKeyAction) {
    if (a.kind === "fit") { fittedFor.current = null; fit(); }
    else {
      const wrap = wrapRef.current;
      if (!wrap) return;
      viewRef.current = applyViewKey(viewRef.current, a, { w: wrap.clientWidth, h: wrap.clientHeight }, { min: 3, max: MAX_ZOOM });
    }
    requestDraw();
  }

  function fit() {
    const wrap = wrapRef.current, m = metaRef.current;
    if (!wrap || !m?.battle) return;
    const { squaresX, squaresY } = m.battle;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const scale = Math.min(W / squaresX, H / squaresY) * 0.95;
    viewRef.current = { scale, ox: (W - squaresX * scale) / 2, oy: (H - squaresY * scale) / 2 };
    fittedFor.current = m.id;
  }

  const toSq = (sx: number, sy: number) => { const v = viewRef.current; return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale }; };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ------------------------------------------------------------ drawing
  function draw() {
    const cv = canvasRef.current, wrap = wrapRef.current, m = metaRef.current;
    if (!cv || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(0, 0, W, H);
    const off = offRef.current;
    if (!off || !m?.battle) return;
    const spec = m.battle, v = viewRef.current, o = uiRef.current;
    const MW = spec.squaresX * v.scale, MH = spec.squaresY * v.scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, v.ox, v.oy, MW, MH);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(v.ox - 0.5, v.oy - 0.5, MW + 1, MH + 1);
    if (o.showGrid && spec.gridType !== "none") {
      // the shared grid drawer works in map px; here one map px is one floor cell
      drawMapGrid(ctx, { type: spec.gridType, sizeMi: spec.feetPerSquare / 5280, orient: "pointy", opacity: 0.3 },
        { scale: v.scale / spec.sub, ox: v.ox, oy: v.oy, mapWidth: m.width, mapHeight: m.height, kmPerPx: m.kmPerPx }, W, H);
    }
    const f = featRef.current, selSet = new Set(selectedIds()), isSel = (id: string) => selSet.has(id);
    const mg = moveGroup.current, mgSet = mg ? new Set(mg.ids) : null;
    const shifted = <T extends { id: string; x: number; y: number }>(a: T): T => (mgSet?.has(a.id) ? { ...a, x: a.x + mg!.dx, y: a.y + mg!.dy } : a);
    const lights = (f.lights ?? []).map(shifted);
    const props = (f.props ?? []).map(shifted);
    const drawProp = (pr: MapProp, alpha = 1) => {
      const spr = spriteFor(pr.asset);
      const k = ((pr.scale ?? 1) * v.scale) / PROP_PX_PER_SQUARE;
      ctx.save();
      ctx.translate(v.ox + pr.x * v.scale, v.oy + pr.y * v.scale);
      ctx.rotate(((pr.rotation ?? 0) * Math.PI) / 180);
      if (pr.flip) ctx.scale(-1, 1);
      ctx.globalAlpha = alpha * (pr.opacity ?? 1);
      if (spr) ctx.drawImage(spr.bmp, (-spr.w * k) / 2, (-spr.h * k) / 2, spr.w * k, spr.h * k);
      else { ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.setLineDash([4, 4]); ctx.strokeRect(-v.scale / 2, -v.scale / 2, v.scale, v.scale); }
      if (isSel(pr.id) && spr) { ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(255, 224, 120, 0.95)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect((-spr.w * k) / 2, (-spr.h * k) / 2, spr.w * k, spr.h * k); }
      ctx.restore();
    };
    for (const pr of props) if ((pr.layer ?? "above") === "below") drawProp(pr);
    const wl = wallRef.current;
    if (wl) { ctx.imageSmoothingEnabled = true; ctx.drawImage(wl.cv, v.ox, v.oy, MW, MH); }
    drawWallMarks(ctx, f.walls ?? [], v, isSel);
    if (wl && wl.px !== wallPx(spec, v.scale)) { window.clearTimeout(wallTimer.current); wallTimer.current = window.setTimeout(() => buildWalls(), 220); }
    for (const pr of props) if ((pr.layer ?? "above") === "above") drawProp(pr);
    if (o.showLights) {
      drawLights(ctx, lights, f.walls, v);
      const amb = ambientOf(spec);
      const dimmed = amb < 0.999 || (f.zones ?? []).some((z) => z.ambient < 0.999);
      if (dimmed) drawAmbient(ctx, lights, f.walls, f.zones ?? [], v, spec, amb, dpr, W, H);
    }
    if (o.tool === "zone" || o.tool === "select") drawZoneOutlines(ctx, f.zones ?? [], v, isSel, o.tool === "zone");
    drawLightMarkers(ctx, lights, v, isSel);
    if (o.showNotes) drawNoteBadges(ctx, (f.notes ?? []).map(shifted), v, isSel);
    // walls and light zones being dragged: where they will land (their picture stays until they are dropped), and the box being drawn
    if (mg && mgSet && (mg.dx || mg.dy)) {
      ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255, 224, 120, 0.95)";
      const ghost = (pts: [number, number][], closed: boolean) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + (x + mg.dx) * v.scale, v.oy + (y + mg.dy) * v.scale) : ctx.moveTo(v.ox + (x + mg.dx) * v.scale, v.oy + (y + mg.dy) * v.scale)));
        if (closed) ctx.closePath();
        ctx.stroke();
      };
      for (const w of f.walls ?? []) if (mgSet.has(w.id)) ghost(w.points, !!w.closed && w.points.length > 2);
      for (const z of f.zones ?? []) if (mgSet.has(z.id)) ghost(z.points, true);
      ctx.restore();
    }
    const mq = drag.current;
    if (mq?.mode === "marquee" && pointer.current) {
      const x = Math.min(mq.sx, pointer.current.x), y = Math.min(mq.sy, pointer.current.y), w = Math.abs(pointer.current.x - mq.sx), h = Math.abs(pointer.current.y - mq.sy);
      ctx.save(); ctx.fillStyle = "rgba(255, 224, 120, 0.12)"; ctx.fillRect(x, y, w, h);
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255, 224, 120, 0.95)"; ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.restore();
    }
    // the object about to be placed
    if (o.tool === "prop" && o.asset && pointer.current && !drag.current && !spaceRef.current) {
      const g = toSq(pointer.current.x, pointer.current.y);
      drawProp({ id: "ghost", asset: o.asset, x: snapProp(g.x, altRef.current), y: snapProp(g.y, altRef.current), rotation: o.propRotation, scale: o.propScale, flip: o.propFlip }, 0.6);
    }

    // a door about to be cut
    const dk = doorKind(o.tool), p = pointer.current;
    if (dk && p && !drag.current) {
      const q = toSq(p.x, p.y);
      const res = insertDoor(f.walls ?? [], q.x, q.y, 1, dk, () => "preview");
      if (res) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255, 235, 150, 0.9)";
        ctx.lineWidth = Math.max(4, v.scale * 0.2);
        ctx.beginPath();
        ctx.moveTo(v.ox + res.door.points[0][0] * v.scale, v.oy + res.door.points[0][1] * v.scale);
        ctx.lineTo(v.ox + res.door.points[1][0] * v.scale, v.oy + res.door.points[1][1] * v.scale);
        ctx.stroke();
        ctx.restore();
      }
    }
    // a wall being drawn
    const dr = draft.current;
    if (dr && dr.pts.length) {
      ctx.save();
      ctx.strokeStyle = dr.kind === "invisible" ? "rgba(214, 120, 230, 0.95)" : "rgba(255, 210, 120, 0.97)";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      dr.pts.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      if (p) { const q = toSq(p.x, p.y); ctx.lineTo(v.ox + snap(q.x) * v.scale, v.oy + snap(q.y) * v.scale); }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of dr.pts) { ctx.beginPath(); ctx.arc(v.ox + x * v.scale, v.oy + y * v.scale, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    // a free-form shape being clicked out, and a circle being dragged
    const sdr = shapeDraft.current;
    if (sdr && sdr.length) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)"; ctx.fillStyle = "rgba(255, 255, 255, 0.95)"; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
      ctx.beginPath();
      sdr.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      if (p) { const q = toSq(p.x, p.y); ctx.lineTo(v.ox + snap(q.x) * v.scale, v.oy + snap(q.y) * v.scale); }
      ctx.stroke(); ctx.setLineDash([]);
      for (const [x, y] of sdr) { ctx.beginPath(); ctx.arc(v.ox + x * v.scale, v.oy + y * v.scale, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (drag.current?.mode === "circle" && p) {
      const c = drag.current, b = toSq(p.x, p.y), r = Math.round(Math.hypot(b.x - c.ax, b.y - c.ay) * 2) / 2;
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)"; ctx.strokeStyle = "rgba(255, 255, 255, 0.95)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(v.ox + c.ax * v.scale, v.oy + c.ay * v.scale, r * v.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const text = `radius ${r} squares · ${r * spec.feetPerSquare} ft`;
      ctx.font = "600 12px system-ui, sans-serif"; ctx.textBaseline = "top"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(15, 18, 28, 0.9)"; ctx.fillStyle = "#fff";
      ctx.strokeText(text, v.ox + c.ax * v.scale + 6, v.oy + c.ay * v.scale + r * v.scale + 5); ctx.fillText(text, v.ox + c.ax * v.scale + 6, v.oy + c.ay * v.scale + r * v.scale + 5);
      ctx.restore();
    }
    // a rectangle being dragged
    const d = drag.current;
    if (d?.mode === "rect" && p) {
      const a = { x: snap(d.ax, 1), y: snap(d.ay, 1) }, b = toSq(p.x, p.y), bx = snap(b.x, 1), by = snap(b.y, 1);
      const x0 = Math.min(a.x, bx), y0 = Math.min(a.y, by), w = Math.abs(bx - a.x), h = Math.abs(by - a.y);
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(v.ox + x0 * v.scale, v.oy + y0 * v.scale, w * v.scale, h * v.scale);
      ctx.strokeRect(v.ox + x0 * v.scale, v.oy + y0 * v.scale, w * v.scale, h * v.scale);
      const text = `${w} × ${h} squares · ${w * spec.feetPerSquare} × ${h * spec.feetPerSquare} ft`;
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(15, 18, 28, 0.9)";
      ctx.fillStyle = "#fff";
      ctx.strokeText(text, v.ox + x0 * v.scale + 4, v.oy + (y0 + h) * v.scale + 5);
      ctx.fillText(text, v.ox + x0 * v.scale + 4, v.oy + (y0 + h) * v.scale + 5);
      ctx.restore();
    }
    // brush cursor
    if (p && o.tool === "brush" && !spaceRef.current) {
      const r = Math.max(2, o.brush * v.scale);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2); ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // ------------------------------------------------------------ effects
  useEffect(() => store.onPatch((r) => repaint(r)), [repaint]);
  useEffect(() => { if (meta && store.heights && fittedFor.current !== meta.id) repaint(null); }, [meta, repaint]);
  useEffect(() => { buildWalls(); requestDraw(); }, [features, ui, meta, requestDraw, buildWalls]);
  useEffect(() => { draft.current = null; shapeDraft.current = null; requestDraw(); }, [ui.tool, ui.roomShape, requestDraw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => requestDraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable); };
    const kd = (e: KeyboardEvent) => {
      altRef.current = e.altKey;
      if (e.code === "Space" && !typing(e)) { setSpaceDown(true); e.preventDefault(); }
      const view = typing(e) ? null : viewKeyAction(e);
      // (arrow keys nudge what is selected; they move the view only when nothing is)
      if (view && !(view.kind === "pan" && selectedIds().length)) { e.preventDefault(); keyView(view); }
    };
    const ku = (e: KeyboardEvent) => { altRef.current = e.altKey; if (e.code === "Space") setSpaceDown(false); };
    const keys = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const sd = shapeDraft.current;
      if (sd) {
        if (e.key === "Enter") finishShape();
        else if (e.key === "Escape") shapeDraft.current = null;
        else if (e.key === "Backspace" || e.key === "Delete") { sd.pop(); if (!sd.length) shapeDraft.current = null; }
        else return;
        e.preventDefault();
        requestDraw();
        return;
      }
      const dr = draft.current;
      if (dr) {
        if (e.key === "Enter") finishWall(false);
        else if (e.key === "Escape") draft.current = null;
        else if (e.key === "Backspace" || e.key === "Delete") { dr.pts.pop(); if (!dr.pts.length) draft.current = null; }
        else return;
        e.preventDefault();
        requestDraw();
        return;
      }
      const arrow = ARROW_DIRECTION[e.key];
      if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey && nudge(arrow[0], arrow[1], e.shiftKey)) { e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "c") { if (copySelection()) e.preventDefault(); return; }
        if (k === "v") { if (pasteClip()) e.preventDefault(); return; }
        if (k === "d") { e.preventDefault(); duplicateSelection(); return; } // (Ctrl+D is "bookmark this page" in a browser)
      }
      if (e.key === "Escape") { if (drag.current?.mode === "marquee") drag.current = null; onUiRef.current({ selected: null, multi: [] }); requestDraw(); return; }
      // rotate / mirror: the selected object if there is one, else what the Object tool will place
      const key = e.key.toLowerCase();
      if ((key === "q" || key === "e" || key === "x") && !e.ctrlKey && !e.metaKey) {
        const selProp = featRef.current.props?.find((pr) => pr.id === uiRef.current.selected);
        if (selProp) {
          const next = key === "x" ? { ...selProp, flip: !selProp.flip } : { ...selProp, rotation: (((selProp.rotation ?? 0) + (key === "e" ? 15 : -15)) % 360 + 360) % 360 };
          sendFeatures({ upsertProps: [next] }, "Change object");
        } else if (uiRef.current.tool === "prop") {
          if (key === "x") onUiRef.current({ propFlip: !uiRef.current.propFlip });
          else onUiRef.current({ propRotation: (((uiRef.current.propRotation + (key === "e" ? 15 : -15)) % 360) + 360) % 360 });
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds().length) {
        const ids = selectedIds(), f = featRef.current;
        const patch = deleteFeatures(f, ids);
        if (!Object.keys(patch).length) return;
        const kind = featureKindOf(f, ids[0]);
        sendFeatures(patch, ids.length > 1 ? `Delete ${ids.length} items` : kind === "wall" ? "Delete wall piece" : kind === "light" ? "Delete light" : kind === "prop" ? "Delete object" : kind === "note" ? "Delete note" : "Delete light zone");
        onUiRef.current({ selected: null, multi: [] });
      }
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => { ro.disconnect(); window.removeEventListener("keydown", keys); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [requestDraw]);

  // ------------------------------------------------------------ editing
  function paintStroke(points: [number, number][]) {
    const spec = metaRef.current?.battle;
    if (!spec) return;
    const r = uiRef.current.brush;
    const shape = points.length === 1
      ? { type: "circle" as const, x: toCells(points[0][0], spec), y: toCells(points[0][1], spec), r: toCells(r, spec) }
      : { type: "stroke" as const, points: points.map(([x, y]) => [toCells(x, spec), toCells(y, spec)] as [number, number]), r: toCells(r, spec) };
    send({ t: "cmd", cmd: { op: "paint_floor", params: { shape, material: uiRef.current.material } } });
  }

  /** Floor (and, for the Room tool, walls) in a round or free-form shape. */
  function makeShape(kind: "circle" | "free", pts: [number, number][], r: number) {
    const spec = metaRef.current?.battle, o = uiRef.current;
    if (!spec) return;
    const polygon = kind === "circle" ? circlePolygon(pts[0][0], pts[0][1], r) : pts;
    if (o.tool === "zone") { makeZone(polygon.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as [number, number])); return; }
    const shape = kind === "circle"
      ? { type: "circle" as const, x: toCells(pts[0][0], spec), y: toCells(pts[0][1], spec), r: toCells(r, spec) }
      : { type: "polygon" as const, points: polygon.map(([x, y]) => [toCells(x, spec), toCells(y, spec)] as [number, number]) };
    send({ t: "cmd", cmd: { op: "paint_floor", params: { shape, material: o.material } }, label: o.tool === "room" ? "Room floor" : `Paint ${materialLabel(metaRef.current, o.material)}` });
    if (o.tool === "room") {
      const wall: MapWall = { id: newFeatureId("w"), kind: "wall", points: polygon.map(([x, y]) => [x, y] as [number, number]), closed: true };
      sendFeatures({ upsertWalls: [wall] }, "Room walls");
    }
  }

  /** A light zone with this outline (squares), selected so its level can be set. */
  function makeZone(points: [number, number][]) {
    const spec = metaRef.current?.battle;
    if (!spec) return;
    const zone: MapAmbientZone = { id: newFeatureId("z"), points, ambient: newZoneLevel(spec) };
    sendFeatures({ upsertZones: [zone] }, "Add light zone");
    onUiRef.current({ multi: [], selected: zone.id, tool: "select" });
  }

  function finishShape() {
    const pts = shapeDraft.current;
    shapeDraft.current = null;
    requestDraw();
    if (pts && pts.length >= 3) makeShape("free", pts, 0);
  }

  function finishWall(closed: boolean) {
    const dr = draft.current;
    draft.current = null;
    requestDraw();
    if (!dr || dr.pts.length < 2) return;
    const wall: MapWall = { id: newFeatureId("w"), kind: dr.kind, points: dr.pts, ...(closed && dr.pts.length >= 3 && { closed: true }) };
    sendFeatures({ upsertWalls: [wall] }, `Add ${dr.kind === "wall" ? "wall" : "invisible wall"}`);
    onUiRef.current({ multi: [], selected: wall.id });
  }

  function hitTest(sx: number, sy: number): string | null {
    const v = viewRef.current, f = featRef.current, spec = metaRef.current?.battle;
    if (spec) for (const n of f.notes ?? []) if (Math.hypot(sx - (v.ox + n.x * v.scale), sy - (v.oy + n.y * v.scale)) < Math.max(11, noteBadge(Math.max(16, v.scale), n.n).r + 2)) return n.id;
    for (const l of f.lights ?? []) if (Math.hypot(sx - (v.ox + l.x * v.scale), sy - (v.oy + l.y * v.scale)) < Math.max(10, v.scale * 0.2)) return l.id;
    let best: { id: string; d: number } | null = null;
    for (const w of f.walls ?? []) {
      for (const [a, b] of wallSegments(w)) {
        const d = distToSegment(sx, sy, v.ox + a[0] * v.scale, v.oy + a[1] * v.scale, v.ox + b[0] * v.scale, v.oy + b[1] * v.scale);
        if (d < Math.max(7, v.scale * 0.12) && (!best || d < best.d)) best = { id: w.id, d };
      }
    }
    if (best) return best.id;
    // objects: topmost first, by their (rotated) picture
    for (const pr of [...(f.props ?? [])].reverse()) {
      const spr = sprites.current.get(pr.asset);
      const [w, h] = spr && spr !== "loading" && spr !== "failed" ? [spr.w / PROP_PX_PER_SQUARE, spr.h / PROP_PX_PER_SQUARE] : [1, 1];
      const dx = (sx - (v.ox + pr.x * v.scale)) / v.scale, dy = (sy - (v.oy + pr.y * v.scale)) / v.scale;
      const a = -((pr.rotation ?? 0) * Math.PI) / 180, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const sc = pr.scale ?? 1;
      if (Math.abs(lx) <= (w * sc) / 2 && Math.abs(ly) <= (h * sc) / 2) return pr.id;
    }
    // light zones last: inside the outline, the smallest first
    const q = toSq(sx, sy);
    const inside = (f.zones ?? []).filter((z) => pointInPolygon(q.x, q.y, z.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points));
    if (inside.length) return inside[0].id;
    return null;
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const m = metaRef.current;
    if (!m?.battle || !store.heights) return;
    const p = local(e), v = viewRef.current, o = uiRef.current;
    canvasRef.current!.setPointerCapture(e.pointerId);
    if (moveGroup.current && !drag.current) commitNudge(); // (a nudge still waiting goes first, so it can't be mistaken for this drag)
    const q = toSq(p.x, p.y);
    if (e.button === 1 || e.button === 2 || o.tool === "pan" || spaceRef.current) {
      drag.current = { mode: "pan", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: 0, ay: 0, lastX: 0, lastY: 0 };
      return;
    }
    if (e.button !== 0) return;
    const spec = m.battle;
    if (o.tool === "brush") {
      send({ t: "txn_begin", label: `Paint ${materialLabel(m, o.material)}` } as never);
      paintStroke([[q.x, q.y]]);
      drag.current = { mode: "brush", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: q.x, ay: q.y, lastX: q.x, lastY: q.y };
      return;
    }
    if (isShapeTool(o.tool) && o.roomShape === "circle") {
      drag.current = { mode: "circle", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: snap(q.x), ay: snap(q.y), lastX: q.x, lastY: q.y };
      return;
    }
    if (isShapeTool(o.tool) && o.roomShape === "free") {
      const pts = shapeDraft.current ?? [];
      const [fx, fy] = pts[0] ?? [0, 0];
      const nearFirst = pts.length >= 3 && Math.hypot((fx - q.x) * v.scale, (fy - q.y) * v.scale) < 10;
      const now = performance.now(), lc = lastClick.current;
      const dbl = !!lc && now - lc.t < 400 && Math.hypot(p.x - lc.x, p.y - lc.y) < 8;
      lastClick.current = { t: now, x: p.x, y: p.y };
      if (nearFirst || dbl) { shapeDraft.current = pts; finishShape(); }
      else {
        const pt: [number, number] = [Math.min(spec.squaresX, Math.max(0, snap(q.x))), Math.min(spec.squaresY, Math.max(0, snap(q.y)))];
        const last = pts[pts.length - 1];
        shapeDraft.current = last && last[0] === pt[0] && last[1] === pt[1] ? pts : [...pts, pt];
      }
      requestDraw();
      return;
    }
    if (isShapeTool(o.tool)) {
      drag.current = { mode: "rect", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: q.x, ay: q.y, lastX: q.x, lastY: q.y };
      return;
    }
    if (o.tool === "wall" || o.tool === "invisible") {
      const kind: WallKind = o.tool === "invisible" ? "invisible" : "wall";
      const dr = draft.current ?? { kind, pts: [] };
      const [fx, fy] = dr.pts[0] ?? [0, 0];
      const nearFirst = dr.pts.length >= 3 && Math.hypot((fx - q.x) * v.scale, (fy - q.y) * v.scale) < 10;
      const now = performance.now(), lc = lastClick.current;
      const dbl = !!lc && now - lc.t < 400 && Math.hypot(p.x - lc.x, p.y - lc.y) < 8;
      lastClick.current = { t: now, x: p.x, y: p.y };
      if (nearFirst) { draft.current = dr; finishWall(true); }
      else if (dbl) { draft.current = dr; finishWall(false); }
      else {
        const pt: [number, number] = [Math.min(spec.squaresX, Math.max(0, snap(q.x))), Math.min(spec.squaresY, Math.max(0, snap(q.y)))];
        const last = dr.pts[dr.pts.length - 1];
        draft.current = { kind, pts: last && last[0] === pt[0] && last[1] === pt[1] ? dr.pts : [...dr.pts, pt] };
      }
      requestDraw();
      return;
    }
    const dk = doorKind(o.tool);
    if (dk) {
      const res = insertDoor(featRef.current.walls ?? [], q.x, q.y, 1, dk, () => newFeatureId("w"));
      if (!res) { flash("There's no wall there. Click right on a wall (draw one first with the Wall or Room tool)."); return; }
      sendFeatures({ removeWalls: res.remove, upsertWalls: res.add }, `Add ${dk === "secret" ? "secret door" : dk}`);
      onUiRef.current({ multi: [], selected: res.door.id });
      return;
    }
    if (o.tool === "note") {
      const note: MapNote = { id: newFeatureId("n"), x: Math.min(spec.squaresX, Math.max(0, snap(q.x))), y: Math.min(spec.squaresY, Math.max(0, snap(q.y))), n: nextNoteNumber(featRef.current.notes), title: "" };
      note.title = `Room ${note.n}`;
      sendFeatures({ upsertNotes: [note] }, `Add note ${note.n}`);
      onUiRef.current({ multi: [], selected: note.id });
      return;
    }
    if (o.tool === "light") {
      const light: MapLight = { id: newFeatureId("g"), x: Math.min(spec.squaresX, Math.max(0, snap(q.x))), y: Math.min(spec.squaresY, Math.max(0, snap(q.y))), radius: 6, bright: 3, colour: "#ffb35c" };
      sendFeatures({ upsertLights: [light] }, "Add light");
      onUiRef.current({ multi: [], selected: light.id });
      return;
    }
    if (o.tool === "prop") {
      if (!o.asset) { flash("Choose an object in the Assets tab first."); return; }
      const prop: MapProp = {
        id: newFeatureId("o"), asset: o.asset, x: snapProp(q.x, e.altKey), y: snapProp(q.y, e.altKey),
        ...(o.propRotation && { rotation: o.propRotation }), ...(o.propScale !== 1 && { scale: o.propScale }), ...(o.propFlip && { flip: true }), ...(o.propLayer === "below" && { layer: "below" as const }),
      };
      sendFeatures({ upsertProps: [prop] }, "Add object");
      return;
    }
    if (o.tool === "select") {
      const id = hitTest(p.x, p.y), f = featRef.current;
      const cur = { selected: o.selected, multi: o.multi }, curIds = selectionIds(cur);
      const marquee = (add: boolean) => { drag.current = { mode: "marquee", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: 0, ay: 0, lastX: q.x, lastY: q.y, add, base: add ? curIds : [] }; };
      let next = cur;
      if (e.shiftKey) {
        // Shift-click adds to the selection or takes from it; Shift-drag on bare ground draws a box that adds
        if (!id) { marquee(true); return; }
        next = toggleInSelection(cur, id);
        onUiRef.current(next);
      } else if (!id) {
        onUiRef.current({ selected: null, multi: [] });
        marquee(false);
        return;
      } else if (!curIds.includes(id)) {
        next = selectionFromIds([id]);
        onUiRef.current(next);
      } // (else it is already part of the selection: dragging it moves the whole group)
      const ids = selectionIds(next);
      if (!id || !ids.includes(id)) return; // (Shift took it out of the selection: nothing to drag)
      const w = f.walls?.find((x) => x.id === id), z = f.zones?.find((x) => x.id === id);
      const anchor = w ? { x: w.points[0][0], y: w.points[0][1] } : z ? { x: z.points[0][0], y: z.points[0][1] } : (f.lights?.find((x) => x.id === id) ?? f.props?.find((x) => x.id === id) ?? f.notes?.find((x) => x.id === id) ?? { x: q.x, y: q.y });
      drag.current = { mode: "move", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: anchor.x, ay: anchor.y, lastX: q.x, lastY: q.y, id, ids, moved: false, groupClick: curIds.length > 1 && !e.shiftKey };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    pointer.current = p;
    const q = toSq(p.x, p.y), m = metaRef.current, hf = store.heights;
    if (m?.battle && hf && q.x >= 0 && q.y >= 0 && q.x < m.battle.squaresX && q.y < m.battle.squaresY) {
      setHover({ x: q.x, y: q.y, m: hf.get(Math.floor(q.x * m.battle.sub), Math.floor(q.y * m.battle.sub)) });
    } else setHover(null);
    const d = drag.current;
    if (d?.mode === "pan") {
      viewRef.current = { ...viewRef.current, ox: d.ox + p.x - d.sx, oy: d.oy + p.y - d.sy };
    } else if (d?.mode === "brush") {
      if (Math.hypot(q.x - d.lastX, q.y - d.lastY) >= 0.2) {
        paintStroke([[d.lastX, d.lastY], [q.x, q.y]]);
        d.lastX = q.x; d.lastY = q.y;
      }
    } else if (d?.mode === "move" && d.ids) {
      // a drag only starts after the pointer has really moved: a click (even a shaky one) never shifts anything
      if (d.moved || Math.hypot(p.x - d.sx, p.y - d.sy) > 4) {
        d.moved = true;
        const f = featRef.current;
        const onlyObjects = d.ids.every((id) => f.props?.some((pr) => pr.id === id));
        const nx = d.ax + (q.x - d.lastX), ny = d.ay + (q.y - d.lastY); // where the grabbed thing would go
        const step = onlyObjects ? 0.25 : 0.5; // objects snap to a quarter square, everything else to half a square (Alt: anywhere)
        const gx = e.altKey ? nx : snap(nx, step), gy = e.altKey ? ny : snap(ny, step);
        moveGroup.current = { ids: d.ids, dx: gx - d.ax, dy: gy - d.ay };
      }
    }
    requestDraw();
  };

  const endDrag = () => {
    const d = drag.current, p = pointer.current, spec = metaRef.current?.battle;
    drag.current = null;
    if (d?.mode === "brush") send({ t: "txn_end" } as never);
    if (d?.mode === "move" && d.ids && spec) {
      const mg = moveGroup.current, f = featRef.current;
      if (mg && (mg.dx || mg.dy)) {
        const r = moveFeatures(f, d.ids, mg.dx, mg.dy, { w: spec.squaresX, h: spec.squaresY });
        if (r.dx || r.dy) {
          const kind = d.ids.length === 1 ? featureKindOf(f, d.ids[0]) : null;
          const note = kind === "note" ? f.notes?.find((n) => n.id === d.ids![0]) : undefined;
          sendFeatures(r.patch, d.ids.length > 1 ? `Move ${d.ids.length} items` : kind === "light" ? "Move light" : kind === "prop" ? "Move object" : kind === "wall" ? "Move wall piece" : kind === "zone" ? "Move light zone" : `Move note ${note?.n ?? ""}`.trim());
        }
      } else if (!d.moved && d.groupClick && d.id) {
        onUiRef.current(selectionFromIds([d.id])); // a click on one of a group picks that one alone
      }
    }
    moveGroup.current = null;
    if (d?.mode === "marquee" && p && spec) {
      const o = uiRef.current;
      if (Math.hypot(p.x - d.sx, p.y - d.sy) >= 4) {
        const a = toSq(d.sx, d.sy), b = toSq(p.x, p.y);
        const kinds: ("prop" | "light" | "note" | "wall" | "zone")[] = ["prop", "light", "wall", "zone", ...(o.showNotes ? (["note"] as const) : [])];
        const found = boxSelect(featRef.current, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, kinds);
        onUiRef.current(selectionFromIds(d.add ? [...(d.base ?? []), ...found] : found));
      }
    }
    if (d?.mode === "circle" && p && spec) {
      const b = toSq(p.x, p.y), r = Math.round(Math.hypot(b.x - d.ax, b.y - d.ay) * 2) / 2;
      if (r >= 1) makeShape("circle", [[d.ax, d.ay]], r);
    }
    if (d?.mode === "rect" && p && spec) {
      const b = toSq(p.x, p.y);
      const x0 = Math.max(0, Math.min(snap(d.ax, 1), snap(b.x, 1))), y0 = Math.max(0, Math.min(snap(d.ay, 1), snap(b.y, 1)));
      const x1 = Math.min(spec.squaresX, Math.max(snap(d.ax, 1), snap(b.x, 1))), y1 = Math.min(spec.squaresY, Math.max(snap(d.ay, 1), snap(b.y, 1)));
      const w = x1 - x0, h = y1 - y0, o = uiRef.current;
      if (w >= 1 && h >= 1 && o.tool === "zone") makeZone([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]);
      else if (w >= 1 && h >= 1) {
        const shape = { type: "rect" as const, x: toCells(x0, spec), y: toCells(y0, spec), w: toCells(w, spec), h: toCells(h, spec) };
        send({ t: "cmd", cmd: { op: "paint_floor", params: { shape, material: o.material } }, label: o.tool === "room" ? `Room floor (${w}×${h})` : `Paint ${materialLabel(metaRef.current, o.material)}` });
        if (o.tool === "room") {
          const walls = roomWalls(newFeatureId("w"), x0, y0, w, h, []);
          sendFeatures({ upsertWalls: walls }, `Room walls (${w}×${h})`);
        }
      }
    }
    requestDraw();
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = local(e), v = viewRef.current;
    const scale = Math.min(MAX_ZOOM, Math.max(3, v.scale * Math.exp(-e.deltaY * 0.0015)));
    const mx = (p.x - v.ox) / v.scale, my = (p.y - v.oy) / v.scale;
    viewRef.current = { scale, ox: p.x - mx * scale, oy: p.y - my * scale };
    requestDraw();
  };

  const tool = ui.tool;
  const cursor = spaceDown || tool === "pan" ? (drag.current?.mode === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : tool === "brush" ? "none" : "crosshair";
  const spec = meta?.battle;
  return (
    <div className="mapview" ref={wrapRef}>
      <canvas
        ref={canvasRef} style={{ cursor }} data-testid="battle-canvas"
        onMouseDown={noShiftTextSelect} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onPointerLeave={() => { pointer.current = null; setHover(null); requestDraw(); }}
        onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
      />
      <div className="mapview-status">
        {hover && spec ? (
          <>x {hover.x.toFixed(1)} · y {hover.y.toFixed(1)} squares · {Math.round(hover.x * spec.feetPerSquare)} ft, {Math.round(hover.y * spec.feetPerSquare)} ft · {materialLabel(meta, hover.m)}</>
        ) : spec ? (
          <>{spec.squaresX}×{spec.squaresY} squares · {spec.squaresX * spec.feetPerSquare}×{spec.squaresY * spec.feetPerSquare} ft</>
        ) : null}
      </div>
      <div className="map-buttons">
        <button onClick={() => setExportOpen(true)} title="Export for Foundry, Universal VTT or as an image" data-testid="battle-export-button">⤓ Export</button>
        <button onClick={() => { fittedFor.current = null; fit(); requestDraw(); }} title="Fit map to window">⤢ Fit</button>
      </div>
      {(!meta || loadedId !== meta.id) && <div className="mapview-empty">Loading map…</div>}
      {status && meta && loadedId === meta.id && <div className="mapview-busy">{status}</div>}
      {note && <div className="mapview-note" data-testid="battle-note">{note}</div>}
      {exportOpen && meta && <BattleExportDialog meta={meta} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- drawing helpers
/** What is drawn over the wall layer: the selection, padlocks, and the dashed line of invisible walls. */
function drawWallMarks(ctx: CanvasRenderingContext2D, walls: MapWall[], v: View, isSelected: (id: string) => boolean) {
  const px = (x: number) => v.ox + x * v.scale, py = (y: number) => v.oy + y * v.scale;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const trace = (w: MapWall) => {
    ctx.beginPath();
    w.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    if (w.closed && w.points.length > 2) ctx.closePath();
  };
  for (const w of walls) {
    if (isSelected(w.id)) {
      trace(w); ctx.strokeStyle = "rgba(255, 224, 120, 0.4)"; ctx.lineWidth = Math.max(8, v.scale * 0.2 + 6); ctx.stroke();
      trace(w); ctx.strokeStyle = "rgba(255, 224, 120, 0.95)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (w.kind === "invisible") {
      trace(w); ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(214, 120, 230, 0.9)"; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    } else if (w.locked && (w.kind === "door" || w.kind === "secret")) {
      const [a, b] = [w.points[0], w.points[w.points.length - 1]];
      ctx.fillStyle = "#fff"; ctx.font = `${Math.max(9, v.scale * 0.28)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🔒", px((a[0] + b[0]) / 2), py((a[1] + b[1]) / 2));
    }
  }
  ctx.restore();
}

function drawLights(ctx: CanvasRenderingContext2D, lights: MapLight[], walls: MapWall[] | undefined, v: View) {
  ctx.save();
  for (const l of lights) {
    const [r, g, b] = hexToRgb(l.colour ?? "#ffd68c"), cx = v.ox + l.x * v.scale, cy = v.oy + l.y * v.scale, R = l.radius * v.scale;
    const a = 0.42 * (l.intensity ?? 1);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
    grad.addColorStop(Math.min(0.95, (l.bright ?? l.radius / 2) / l.radius), `rgba(${r},${g},${b},${a * 0.55})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    const vis = lightVisibility(l, walls);
    ctx.save();
    if (vis.segs.length) {
      // only what the light can see: walls and closed doors cast shadows
      ctx.beginPath();
      visibilityPolygon(vis).forEach(([x, y], i) => { const px = v.ox + x * v.scale, py = v.oy + y * v.scale; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath();
      ctx.clip();
    }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

let darkCanvas: HTMLCanvasElement | null = null;

/**
 * The map's light level: everything is darkened to `amb`, then each light cuts a hole shaped like what it can see,
 * with a soft edge. (The server's render does the same sum per pixel.)
 */
function drawAmbient(ctx: CanvasRenderingContext2D, lights: MapLight[], walls: MapWall[] | undefined, zones: MapAmbientZone[], v: View, spec: BattleSpec, amb: number, dpr: number, W: number, H: number) {
  darkCanvas ??= document.createElement("canvas");
  const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
  if (darkCanvas.width !== cw || darkCanvas.height !== ch) { darkCanvas.width = cw; darkCanvas.height = ch; }
  const d = darkCanvas.getContext("2d")!;
  d.setTransform(dpr, 0, 0, dpr, 0, 0);
  d.globalCompositeOperation = "source-over";
  d.clearRect(0, 0, W, H);
  // the ambient colour: a deep tint of the preset's colour (night blue, dusk orange), else a cool black
  const [tr, tg, tb] = spec.ambientTint ? hexToRgb(spec.ambientTint).map((c) => Math.round(c * 0.16)) : [4, 6, 16];
  const dark = (a: number) => `rgba(${tr}, ${tg}, ${tb}, ${a})`;
  const canBlur = typeof d.filter === "string";
  d.fillStyle = dark(1 - amb);
  d.fillRect(v.ox, v.oy, spec.squaresX * v.scale, spec.squaresY * v.scale);
  // each zone replaces the map's darkness inside its outline, with a soft edge
  const zonePath = (z: MapAmbientZone) => { d.beginPath(); z.points.forEach(([x, y], i) => (i ? d.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : d.moveTo(v.ox + x * v.scale, v.oy + y * v.scale))); d.closePath(); };
  for (const z of zones) {
    if (z.points.length < 3) continue;
    if (canBlur) d.filter = `blur(${Math.max(1, v.scale * 0.07) * dpr}px)`;
    d.globalCompositeOperation = "destination-out"; d.fillStyle = "#000"; zonePath(z); d.fill();
    d.globalCompositeOperation = "source-over"; d.fillStyle = dark(1 - Math.min(1, Math.max(0.05, z.ambient))); zonePath(z); d.fill();
    if (canBlur) d.filter = "none";
  }
  d.globalCompositeOperation = "destination-out";
  const falloff: [number, number][] = [[0, 1], [0.2, 0.8], [0.4, 0.54], [0.6, 0.3], [0.8, 0.12], [1, 0]];
  for (const l of lights) {
    const cx = v.ox + l.x * v.scale, cy = v.oy + l.y * v.scale, R = l.radius * v.scale, k = Math.min(1, l.intensity ?? 1);
    const grad = d.createRadialGradient(cx, cy, 0, cx, cy, R);
    for (const [t, a] of falloff) grad.addColorStop(t, `rgba(0,0,0,${a * k})`);
    d.fillStyle = grad;
    const vis = lightVisibility(l, walls);
    d.beginPath();
    if (vis.segs.length) visibilityPolygon(vis).forEach(([x, y], i) => { const px = v.ox + x * v.scale, py = v.oy + y * v.scale; if (i) d.lineTo(px, py); else d.moveTo(px, py); });
    else d.arc(cx, cy, R, 0, Math.PI * 2);
    d.closePath();
    if (canBlur && vis.segs.length) d.filter = `blur(${Math.max(1, v.scale * 0.045) * dpr}px)`;
    d.fill();
    if (canBlur) d.filter = "none";
  }
  d.globalCompositeOperation = "source-over";
  ctx.drawImage(darkCanvas, 0, 0, W, H);
}

function drawLightMarkers(ctx: CanvasRenderingContext2D, lights: MapLight[], v: View, isSelected: (id: string) => boolean) {
  ctx.save();
  for (const l of lights) {
    const cx = v.ox + l.x * v.scale, cy = v.oy + l.y * v.scale;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(4, v.scale * 0.11), 0, Math.PI * 2);
    ctx.fillStyle = "#fff8d8"; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 1.5; ctx.stroke();
    if (isSelected(l.id)) {
      ctx.beginPath(); ctx.arc(cx, cy, l.radius * v.scale, 0, Math.PI * 2);
      ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(255, 235, 150, 0.9)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(8, v.scale * 0.2), 0, Math.PI * 2); ctx.strokeStyle = "rgba(255, 235, 150, 0.95)"; ctx.stroke();
    }
  }
  ctx.restore();
}

function pointInPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i][1] > y) !== (pts[j][1] > y) && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  }
  return inside;
}
const polygonArea = (pts: [number, number][]) => Math.abs(pts.reduce((a, [x, y], i) => a + (x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y), 0)) / 2;

/** Dashed outlines of light zones (all of them while the Shade tool is active; the selected one otherwise). */
function drawZoneOutlines(ctx: CanvasRenderingContext2D, zones: MapAmbientZone[], v: View, isSelected: (id: string) => boolean, all: boolean) {
  ctx.save();
  for (const z of zones) {
    if (!all && !isSelected(z.id)) continue;
    ctx.beginPath();
    z.points.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
    ctx.closePath();
    ctx.setLineDash([7, 5]); ctx.lineWidth = isSelected(z.id) ? 2 : 1.25;
    ctx.strokeStyle = isSelected(z.id) ? "rgba(255, 224, 120, 0.95)" : "rgba(150, 190, 255, 0.8)"; ctx.stroke(); ctx.setLineDash([]);
    if (all || isSelected(z.id)) {
      const cx = z.points.reduce((a, p) => a + p[0], 0) / z.points.length, cy = z.points.reduce((a, p) => a + p[1], 0) / z.points.length;
      ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10, 12, 20, 0.9)"; ctx.fillStyle = "#cfe0ff";
      const label = `${z.name ? `${z.name}: ` : ""}${Math.round(z.ambient * 100)}%`;
      ctx.strokeText(label, v.ox + cx * v.scale, v.oy + cy * v.scale); ctx.fillText(label, v.ox + cx * v.scale, v.oy + cy * v.scale);
    }
  }
  ctx.restore();
}

/** The numbered markers of the room notes. */
function drawNoteBadges(ctx: CanvasRenderingContext2D, notes: MapNote[], v: View, isSelected: (id: string) => boolean) {
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const n of notes) {
    const cx = v.ox + n.x * v.scale, cy = v.oy + n.y * v.scale, r = Math.max(10, Math.min(18, noteBadge(Math.max(18, v.scale), n.n).r * 0.8));
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(26, 23, 30, 0.92)"; ctx.fill();
    ctx.lineWidth = isSelected(n.id) ? 3 : 2; ctx.strokeStyle = isSelected(n.id) ? "#fff1b8" : "#d6b250"; ctx.stroke();
    ctx.fillStyle = "#ffecb0"; ctx.font = `700 ${Math.round(r * (String(n.n).length > 2 ? 0.8 : 1.05))}px system-ui, sans-serif`;
    ctx.fillText(String(n.n), cx, cy + 0.5);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- side panels
/** The tool picker, material palette and brush size. */
export function BattleTools({ ui, onUi, canUndo, canRedo, meta, assetsOn, onOpenAssets }: { ui: BattleUi; onUi: (p: Partial<BattleUi>) => void; canUndo: boolean; canRedo: boolean; meta: MapMeta | null; assetsOn: boolean; onOpenAssets: () => void }) {
  return (
    <section data-testid="battle-tools">
      {BATTLE_TOOL_GROUPS.map((g) => (
        <div key={g.name}>
          <h3>{g.name}</h3>
          <div className="tools">
            {g.tools.map((x) => (
              <button key={x.id} className={ui.tool === x.id ? "on" : ""} onClick={() => onUi({ tool: x.id })} title={`${x.tip} (${x.key})`} data-testid={`btool-${x.id}`}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {BATTLE_HINTS[ui.tool] && <p className="tool-hint" data-testid="tool-hint">{BATTLE_HINTS[ui.tool]}</p>}
      {isShapeTool(ui.tool) && (
        <div className="seg" role="group" aria-label="Shape" data-testid="room-shape">
          {([["rect", "Rectangle"], ["circle", "Circle"], ["free", "Free-form"]] as const).map(([id, label]) => (
            <button key={id} className={ui.roomShape === id ? "on" : ""} onClick={() => onUi({ roomShape: id })} data-testid={`shape-${id}`}>{label}</button>
          ))}
        </div>
      )}
      {isFloorTool(ui.tool) && (
        <>
          <h3>Floor material</h3>
          <div className="materials" data-testid="materials">
            {MATERIALS.map((m) => (
              <button
                key={m.id} className={`swatch ${ui.material === m.id ? "on" : ""}`} onClick={() => onUi({ material: m.id })} title={m.id === 0 ? "void (erases floor)" : m.name}
                style={{ background: `rgb(${m.colour.join(",")})` }} data-testid={`material-${m.name.replace(/\s+/g, "-")}`}
              >
                {m.id === 0 ? "✕" : ""}
              </button>
            ))}
            {(meta?.battle?.palette ?? []).map((e) => (
              <button
                key={e.id} className={`swatch tex ${ui.material === e.id ? "on" : ""}`} onClick={() => onUi({ material: e.id })} title={`${e.name} (pack texture). Right-click to remove`}
                style={{ backgroundImage: `url(${assetUrl(e.asset, 64)})` }} data-testid={`material-tex-${e.name.replace(/\s+/g, "-")}`}
                onContextMenu={(ev) => { ev.preventDefault(); removeTexture(meta!, e, ui, onUi); }}
              />
            ))}
            {assetsOn && <button className="swatch add" onClick={onOpenAssets} title="Add a floor texture from your asset packs">＋</button>}
          </div>
          <p className="muted">{materialLabel(meta, ui.material)}</p>
        </>
      )}
      {ui.tool === "prop" && (
        <div className="prop-options" data-testid="prop-options">
          <p className="muted">{ui.asset ? `Placing: ${assetLabel(parseAssetId(ui.asset)?.path ?? ui.asset)}` : "No object chosen yet: open the Assets tab and click one."}</p>
          <label className="slider"><span>Size <b>{Math.round(ui.propScale * 100)}%</b></span>
            <input type="range" min={10} max={400} step={5} value={Math.round(ui.propScale * 100)} onChange={(e) => onUi({ propScale: Number(e.target.value) / 100 })} data-testid="prop-scale" />
          </label>
          <label className="slider"><span>Rotation <b>{ui.propRotation}°</b> (Q / E)</span>
            <input type="range" min={0} max={345} step={15} value={ui.propRotation} onChange={(e) => onUi({ propRotation: Number(e.target.value) })} />
          </label>
          <label className="check"><input type="checkbox" checked={ui.propFlip} onChange={(e) => onUi({ propFlip: e.target.checked })} /> Mirror (X)</label>
          <label className="field">Layer
            <select value={ui.propLayer} onChange={(e) => onUi({ propLayer: e.target.value as "above" | "below" })}>
              <option value="above">Above the walls</option><option value="below">Below the walls</option>
            </select>
          </label>
        </div>
      )}
      {ui.tool === "brush" && (
        <label className="slider">
          <span>Brush size <b>{(ui.brush * 2).toFixed(1)}</b> squares across</span>
          <input type="range" min={1} max={40} value={Math.round(ui.brush * 4)} onChange={(e) => onUi({ brush: Number(e.target.value) / 4 })} />
        </label>
      )}
      <div className="cavewalls" data-testid="cave-walls">
        <button onClick={() => buildWallsAroundFloor(meta)} title="Draw a wall along the edge of all the floor: handy for caves and anything you painted freehand" data-testid="walls-around-floor">▢ Walls around the floor</button>
      </div>
      <div className="row">
        <button disabled={!canUndo} onClick={() => store.send({ t: "undo" })} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button disabled={!canRedo} onClick={() => store.send({ t: "redo" })} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
      </div>
    </section>
  );
}

/** Walls along the edge of all the floor. Walls built this way before are replaced, so it can be run again after changing the floor. */
export function buildWallsAroundFloor(meta: MapMeta | null) {
  const hf = store.heights;
  if (!meta?.battle || !hf) return;
  const doc: MapDoc = { meta, height: hf };
  const walls = wallsAroundFloor(doc, () => newFeatureId("w"));
  const old = (store.getState().features.walls ?? []).filter((w) => w.auto).map((w) => w.id);
  if (!walls.length && !old.length) { window.alert("There's no floor to put walls around yet."); return; }
  sendFeatures({ removeWalls: old, upsertWalls: walls }, `Walls around the floor (${walls.length} outline${walls.length === 1 ? "" : "s"})`);
}

/** Remove a pack texture from the palette, unless some floor still uses it. */
function removeTexture(meta: MapMeta, e: PaletteEntry, ui: BattleUi, onUi: (p: Partial<BattleUi>) => void) {
  const hf = store.heights;
  if (hf) for (let i = 0; i < hf.data.length; i += 1) if (hf.data[i] === e.id) { window.alert(`"${e.name}" is still used by some floor. Paint over it first.`); return; }
  const spec = battleSpec({ meta } as MapDoc);
  store.send({ t: "cmd", cmd: { op: "set_meta", patch: { battle: { ...spec, palette: (spec.palette ?? []).filter((x) => x.id !== e.id) } }, label: `Remove floor texture ${e.name}` } });
  if (ui.material === e.id) onUi({ material: 1 });
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}

/** Edit the selected wall piece, door or light. */
/** Several things selected at once: what they are, and what can be done with them together. */
function GroupPanel({ features, ids, bounds, onClear, onSelect }: { features: Features; ids: string[]; bounds: { w: number; h: number }; onClear: () => void; onSelect: (ids: string[]) => void }) {
  const count = (k: string) => ids.filter((id) => featureKindOf(features, id) === k).length;
  const parts = [[count("prop"), "object"], [count("light"), "light"], [count("wall"), "wall piece"], [count("note"), "room note"], [count("zone"), "light zone"]]
    .filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`);
  return (
    <section data-testid="battle-group">
      <h3>{ids.length} things selected</h3>
      <p className="muted">{parts.join(", ")}. Drag one to move them all; the arrow keys nudge them.</p>
      <div className="row">
        <button onClick={() => {
          const clip = copyFeatures(features, ids);
          if (!clip) return;
          const r = pasteFeatures(clip, 1, 1, { bounds });
          sendFeatures(r.patch, `Duplicate ${r.ids.length} items`);
          onSelect(r.ids);
        }} data-testid="group-duplicate" title="Ctrl+D">Duplicate</button>
        <button className="danger" onClick={() => { sendFeatures(deleteFeatures(features, ids), `Delete ${ids.length} items`); onClear(); }} data-testid="group-delete" title="Delete">Delete</button>
        <button className="ghost" onClick={onClear}>Deselect</button>
      </div>
    </section>
  );
}

export function BattleInspector({ features, selected, multi, bounds, onClear, onSelect }: { features: Features; selected: string | null; multi: string[]; bounds: { w: number; h: number }; onClear: () => void; onSelect: (ids: string[]) => void }) {
  if (multi.length >= 2) return <GroupPanel features={features} ids={multi} bounds={bounds} onClear={onClear} onSelect={onSelect} />;
  const wall = selected ? features.walls?.find((w) => w.id === selected) : undefined;
  const light = selected ? features.lights?.find((l) => l.id === selected) : undefined;
  const prop = selected ? features.props?.find((p) => p.id === selected) : undefined;
  const note = selected ? features.notes?.find((n) => n.id === selected) : undefined;
  const zone = selected ? features.zones?.find((z) => z.id === selected) : undefined;
  if (!wall && !light && !prop && !note && !zone) return null;
  return (
    <section data-testid="battle-inspector">
      <h3>{wall ? (wall.kind === "wall" ? "Wall" : wall.kind === "secret" ? "Secret door" : wall.kind === "invisible" ? "Invisible wall" : wall.kind === "window" ? "Window" : "Door") : prop ? "Object" : note ? "Note" : zone ? "Light zone" : "Light"}</h3>
      {wall && <WallEditor w={wall} onClear={onClear} />}
      {light && <LightEditor l={light} onClear={onClear} />}
      {prop && <PropEditor p={prop} onClear={onClear} />}
      {note && <NoteEditor key={note.id} n={note} onClear={onClear} />}
      {zone && <ZoneEditor key={zone.id} z={zone} onClear={onClear} />}
    </section>
  );
}

/** Edit a numbered note: number, title and text are saved when you leave the field. */
function NoteEditor({ n, onClear }: { n: MapNote; onClear: () => void }) {
  const [num, setNum] = useState(String(n.n)), [title, setTitle] = useState(n.title), [text, setText] = useState(n.text ?? "");
  // each field follows the map only when its own value changes (a saved title must not wipe the text being typed)
  useEffect(() => setNum(String(n.n)), [n.n]);
  useEffect(() => setTitle(n.title), [n.title]);
  useEffect(() => setText(n.text ?? ""), [n.text]);
  const save = () => {
    const nn = Math.max(1, Math.min(999, Math.round(Number(num)) || n.n));
    if (nn === n.n && title === n.title && text === (n.text ?? "")) return;
    const next: MapNote = { ...n, n: nn, title: title.trim() || n.title };
    if (text.trim()) next.text = text; else delete next.text;
    sendFeatures({ upsertNotes: [next] }, `Change note ${nn}`);
  };
  return (
    <>
      <label className="field">Number
        <input type="number" min={1} max={999} value={num} onChange={(e) => setNum(e.target.value)} onBlur={save} data-testid="note-number" />
      </label>
      <label className="field">Title
        <input type="text" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} data-testid="note-title" />
      </label>
      <label className="field">What is here
        <textarea value={text} rows={5} maxLength={4000} onChange={(e) => setText(e.target.value)} onBlur={save} placeholder="Read-aloud text, who is here, treasure, traps..." data-testid="note-text" />
      </label>
      <p className="muted">Only you see notes: they are not in the exported picture.</p>
      <div className="row">
        <button onClick={() => { sendFeatures({ removeNotes: [n.id] }, "Delete note"); onClear(); }} data-testid="note-delete">Delete</button>
      </div>
    </>
  );
}

/** Edit a light zone: its level and name. */
function ZoneEditor({ z, onClear }: { z: MapAmbientZone; onClear: () => void }) {
  const [level, setLevel] = useState(z.ambient), [name, setName] = useState(z.name ?? "");
  useEffect(() => setLevel(z.ambient), [z.ambient]);
  useEffect(() => setName(z.name ?? ""), [z.name]);
  const save = (patch: Partial<MapAmbientZone>) => {
    const next: MapAmbientZone = { ...z, ...patch };
    if (!next.name) delete next.name;
    sendFeatures({ upsertZones: [next] }, `Change light zone${next.name ? ` ${next.name}` : ""}`);
  };
  const commitLevel = (a: number) => { if (Math.abs(a - z.ambient) > 0.004) save({ ambient: Math.round(a * 100) / 100 }); };
  return (
    <>
      <label className="field">Name
        <input type="text" value={name} maxLength={60} placeholder="e.g. Tavern" onChange={(e) => setName(e.target.value)} onBlur={() => name !== (z.name ?? "") && save({ name: name.trim() })} data-testid="zone-name" />
      </label>
      <div className="chips" role="group" aria-label="Zone light level">
        {(["bright", "dim", "dark"] as const).map((k) => (
          <button key={k} className={Math.abs(level - LIGHT_PRESETS[k].ambient) < 0.02 ? "on" : ""} onClick={() => { setLevel(LIGHT_PRESETS[k].ambient); commitLevel(LIGHT_PRESETS[k].ambient); }}>{k[0].toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
      <label className="slider"><span>Brightness where no light reaches <b>{Math.round(level * 100)}%</b></span>
        <input type="range" min={5} max={100} step={5} value={Math.round(level * 100)} onChange={(e) => setLevel(Number(e.target.value) / 100)}
          onPointerUp={() => commitLevel(level)} onKeyUp={() => commitLevel(level)} onBlur={() => commitLevel(level)} data-testid="zone-level" />
      </label>
      <p className="muted">Lights still brighten the zone. It only shows while <b>Light glows</b> is on.</p>
      <div className="row">
        <button onClick={() => { sendFeatures({ removeZones: [z.id] }, "Delete light zone"); onClear(); }} data-testid="zone-delete">Delete</button>
      </div>
    </>
  );
}

/** The map's key: its numbered notes (click one to select and edit it) and its light zones. */
export function BattleKey({ features, selected, onSelect }: { features: Features; selected: string | null; onSelect: (id: string) => void }) {
  const notes = sortedNotes(features.notes), zones = features.zones ?? [];
  if (!notes.length && !zones.length) return null;
  return (
    <section data-testid="battle-key">
      <h3>Key</h3>
      {notes.length > 0 && (
        <ol className="keylist">
          {notes.map((n) => (
            <li key={n.id} className={n.id === selected ? "on" : ""}>
              <button onClick={() => onSelect(n.id)} data-testid={`key-note-${n.n}`} title={n.text ?? n.title}><b>{n.n}</b> {n.title || "Untitled"}</button>
            </li>
          ))}
        </ol>
      )}
      {notes.length > 1 && (
        <div className="row">
          <button
            onClick={() => { const order = readingOrderNumbers(features.notes); sendFeatures({ upsertNotes: (features.notes ?? []).map((n) => ({ ...n, n: order[n.id] })) }, "Renumber notes"); }}
            title="Number the notes 1, 2, 3... from the top of the map down, left to right" data-testid="renumber-notes"
          >Renumber in order</button>
        </div>
      )}
      {zones.length > 0 && (
        <>
          <h3>Light zones</h3>
          <ul className="keylist">
            {zones.map((z) => (
              <li key={z.id} className={z.id === selected ? "on" : ""}>
                <button onClick={() => onSelect(z.id)} data-testid="key-zone">{z.name || "Zone"} <span className="muted">{Math.round(z.ambient * 100)}%</span></button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function WallEditor({ w, onClear }: { w: MapWall; onClear: () => void }) {
  const latest = useLatest(w);
  const set = (patch: Partial<MapWall>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    sendFeatures({ upsertWalls: [next] }, `Change ${next.kind}`);
  };
  const isDoor = w.kind === "door" || w.kind === "secret";
  const segs = wallSegments(w).length;
  return (
    <>
      <label className="field">Kind
        <select value={w.kind} onChange={(e) => set({ kind: e.target.value as WallKind })} data-testid="wall-kind">
          <option value="wall">Wall</option><option value="door">Door</option><option value="secret">Secret door</option>
          <option value="window">Window</option><option value="invisible">Invisible wall</option>
        </select>
      </label>
      {isDoor && <label className="check"><input type="checkbox" checked={!!w.open} onChange={(e) => set({ open: e.target.checked })} data-testid="wall-open" /> Open</label>}
      {isDoor && <label className="check"><input type="checkbox" checked={!!w.locked} onChange={(e) => set({ locked: e.target.checked })} /> Locked (Foundry)</label>}
      <p className="muted">{segs} piece{segs === 1 ? "" : "s"}{w.closed ? ", closed" : ""}</p>
      <div className="row">
        <button onClick={() => { sendFeatures({ removeWalls: [w.id] }, `Delete ${w.kind}`); onClear(); }} data-testid="wall-delete">Delete</button>
      </div>
    </>
  );
}

function PropEditor({ p, onClear }: { p: MapProp; onClear: () => void }) {
  const latest = useLatest(p);
  const set = (patch: Partial<MapProp>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    sendFeatures({ upsertProps: [next] }, "Change object");
  };
  return (
    <>
      <p className="muted" style={{ wordBreak: "break-all" }} title={p.asset}>{assetLabel(parseAssetId(p.asset)?.path ?? p.asset)}</p>
      <label className="slider"><span>Rotation <b>{Math.round(p.rotation ?? 0)}°</b> (Q / E)</span>
        <input type="range" min={0} max={359} step={1} value={Math.round(p.rotation ?? 0)} onChange={(e) => set({ rotation: Number(e.target.value) })} data-testid="prop-rotation" />
      </label>
      <label className="slider"><span>Size <b>{Math.round((p.scale ?? 1) * 100)}%</b></span>
        <input type="range" min={10} max={400} step={5} value={Math.round((p.scale ?? 1) * 100)} onChange={(e) => set({ scale: Number(e.target.value) / 100 })} />
      </label>
      <label className="check"><input type="checkbox" checked={!!p.flip} onChange={(e) => set({ flip: e.target.checked })} /> Mirror (X)</label>
      <label className="field">Layer
        <select value={p.layer ?? "above"} onChange={(e) => set({ layer: e.target.value as "above" | "below" })}>
          <option value="above">Above the walls</option><option value="below">Below the walls</option>
        </select>
      </label>
      <div className="row">
        <button onClick={() => { const c = { ...p, id: newFeatureId("o"), x: p.x + 0.5, y: p.y + 0.5 }; sendFeatures({ upsertProps: [c] }, "Duplicate object"); }}>Duplicate</button>
        <button onClick={() => { sendFeatures({ removeProps: [p.id] }, "Delete object"); onClear(); }} data-testid="prop-delete">Delete</button>
      </div>
    </>
  );
}

function LightEditor({ l, onClear }: { l: MapLight; onClear: () => void }) {
  const latest = useLatest(l);
  const set = (patch: Partial<MapLight>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    sendFeatures({ upsertLights: [next] }, "Change light");
  };
  return (
    <>
      <label className="slider"><span>Reach <b>{l.radius}</b> squares ({Math.round(l.radius * 5)} ft at 5 ft squares)</span>
        <input type="range" min={1} max={30} step={0.5} value={l.radius} onChange={(e) => set({ radius: Number(e.target.value), bright: Math.min(l.bright ?? Number(e.target.value) / 2, Number(e.target.value)) })} data-testid="light-radius" />
      </label>
      <label className="slider"><span>Bright part <b>{l.bright ?? l.radius / 2}</b> squares</span>
        <input type="range" min={0} max={l.radius} step={0.5} value={l.bright ?? l.radius / 2} onChange={(e) => set({ bright: Number(e.target.value) })} />
      </label>
      <label className="field">Colour
        <input type="color" value={l.colour ?? "#ffd68c"} onChange={(e) => set({ colour: e.target.value })} data-testid="light-colour" />
      </label>
      <label className="slider"><span>Strength <b>{Math.round((l.intensity ?? 1) * 100)}%</b></span>
        <input type="range" min={10} max={100} value={Math.round((l.intensity ?? 1) * 100)} onChange={(e) => set({ intensity: Number(e.target.value) / 100 })} />
      </label>
      <label className="check"><input type="checkbox" checked={l.shadows !== false} onChange={(e) => set({ shadows: e.target.checked })} /> Walls block it (in the tabletop)</label>
      <div className="row">
        <button onClick={() => { sendFeatures({ removeLights: [l.id] }, "Delete light"); onClear(); }} data-testid="light-delete">Delete</button>
      </div>
    </>
  );
}

/** How bright the map is where no light reaches: a preset (Bright, Dawn, Dusk, Dim, Night, Dark) or anything between, and its colour. */
function LightLevel({ spec }: { spec: BattleSpec }) {
  const cur = ambientOf(spec);
  const [v, setV] = useState(cur);
  useEffect(() => setV(cur), [cur]);
  const setSpec = (next: BattleSpec, label: string) => store.send({ t: "cmd", cmd: { op: "set_meta", patch: { battle: next }, label } });
  const preset = (k: (typeof LIGHT_PRESET_NAMES)[number]) => {
    if (lightPresetName(spec) === k) return;
    setV(LIGHT_PRESETS[k].ambient);
    setSpec(applyLightPreset(spec, k), `Light level: ${k}`);
  };
  const commit = (a: number) => {
    const n = Math.round(Math.min(1, Math.max(0.05, a)) * 100) / 100;
    if (Math.abs(n - ambientOf(spec)) < 0.005) return;
    const { ambient: _old, ...rest } = spec;
    const next = n >= 0.995 ? rest : { ...rest, ambient: n };
    setSpec(next, `Light level: ${lightPresetName(next) ?? `${Math.round(n * 100)}%`}`);
  };
  const setTint = (tint: string | null) => {
    const { ambientTint: _old, ...rest } = spec;
    setSpec(tint ? { ...rest, ambientTint: tint } : rest, tint ? "Light colour" : "Light colour: none");
  };
  const name = lightPresetName({ ambient: v, ambientTint: spec.ambientTint });
  return (
    <>
      <div className="chips" role="group" aria-label="Light level">
        {LIGHT_PRESET_NAMES.map((k) => (
          <button key={k} className={name === k ? "on" : ""} onClick={() => preset(k)} data-testid={`ambient-${k}`} title={k === "dawn" || k === "dusk" || k === "night" ? "Time of day: a level and a colour" : undefined}>{k[0].toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
      <label className="field">Brightness where no light reaches: {Math.round(v * 100)}%
        <input type="range" min={5} max={100} step={5} value={Math.round(v * 100)} data-testid="ambient-slider"
          onChange={(e) => setV(Number(e.target.value) / 100)}
          onPointerUp={() => commit(v)} onKeyUp={() => commit(v)} onBlur={() => commit(v)} />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>Ambient colour
          <input type="color" value={spec.ambientTint ?? "#7f8fbf"} onChange={(e) => setTint(e.target.value)} data-testid="ambient-tint" />
        </label>
        {spec.ambientTint && <button onClick={() => setTint(null)} data-testid="ambient-tint-clear">No colour</button>}
      </div>
      <p className="muted">Dim, Dusk, Night and Dark show the map in the lights' pools only (turn <b>Light glows</b> off to see it all while you build). Use the <b>Shade</b> tool for an area with its own level, like a building. The exported picture stays bright: Foundry and other tabletops do their own lighting.</p>
    </>
  );
}

/** Grid type, display toggles and a size summary. */
export function BattleSettings({ meta, features, ui, onUi }: { meta: MapMeta; features: Features; ui: BattleUi; onUi: (p: Partial<BattleUi>) => void }) {
  const spec = battleSpec({ meta } as MapDoc);
  const walls = features.walls ?? [];
  const count = (k: WallKind) => walls.filter((w) => w.kind === k).length;
  const setGrid = (gridType: BattleSpec["gridType"]) => {
    if (gridType === spec.gridType) return;
    store.send({ t: "cmd", cmd: { op: "set_meta", patch: { battle: { ...spec, gridType } }, label: `Grid: ${gridType}` } });
  };
  return (
    <section data-testid="battle-settings">
      <h3>Grid</h3>
      <div className="seg" role="group" aria-label="Grid type">
        {(["square", "hex", "none"] as const).map((t) => (
          <button key={t} className={spec.gridType === t ? "on" : ""} onClick={() => setGrid(t)} data-testid={`bgrid-${t}`}>{t === "none" ? "None" : t === "square" ? "Square" : "Hex"}</button>
        ))}
      </div>
      <p className="muted">The grid type goes into exports (Foundry and Universal VTT draw their own grid).</p>
      <h3>Light level</h3>
      <LightLevel spec={spec} />
      <h3>Layers</h3>
      <label className="check"><input type="checkbox" checked={ui.showGrid} onChange={(e) => onUi({ showGrid: e.target.checked })} /> Show the grid</label>
      <label className="check"><input type="checkbox" checked={ui.showLights} onChange={(e) => onUi({ showLights: e.target.checked })} /> Light glows (and the light level)</label>
      <label className="check"><input type="checkbox" checked={ui.showNotes} onChange={(e) => onUi({ showNotes: e.target.checked })} data-testid="show-notes" /> Room numbers</label>
      {meta.origin && (
        <>
          <h3>Where it's from</h3>
          <p className="muted" data-testid="battle-origin">Made from <b>{meta.origin.name}</b> at map px ({meta.origin.x}, {meta.origin.y}).</p>
          <div className="row"><button onClick={() => store.send({ t: "open_project", id: meta.origin!.id })} title="Open the world map this scene came from">↑ Back to {meta.origin.name}</button></div>
        </>
      )}
      <h3>This map</h3>
      <p className="muted" data-testid="battle-summary">
        {spec.squaresX} × {spec.squaresY} squares at {spec.feetPerSquare} ft = {spec.squaresX * spec.feetPerSquare} × {spec.squaresY * spec.feetPerSquare} ft.
        Image {spec.squaresX * spec.pxPerSquare} × {spec.squaresY * spec.pxPerSquare} px ({spec.pxPerSquare} px per square).
        {" "}{count("wall")} wall piece{count("wall") === 1 ? "" : "s"}, {count("door") + count("secret")} door{count("door") + count("secret") === 1 ? "" : "s"}, {count("window")} window{count("window") === 1 ? "" : "s"}, {(features.lights ?? []).length} light{(features.lights ?? []).length === 1 ? "" : "s"}, {(features.props ?? []).length} object{(features.props ?? []).length === 1 ? "" : "s"}.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- export
export function BattleExportDialog({ meta, onClose }: { meta: MapMeta; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const files = [
    { fmt: "uvtt", name: `${meta.id}.dd2vtt`, title: "Universal VTT (.dd2vtt)", text: "One file with the image, walls, doors and lights. Use it with the Universal Battlemap Importer module in Foundry, or in Roll20, Fantasy Grounds and other programs that read it." },
    { fmt: "foundry", name: `${meta.id}-foundry.zip`, title: "Foundry scene (.zip)", text: "The image plus a scene file for Foundry's Import Data, with the grid, walls, doors and lights. A README inside says where things go." },
    { fmt: "key", name: `${meta.id}-key.md`, title: "Key (.md)", text: "Your numbered room notes as a list (Markdown), for the DM. Notes are never part of the picture." },
    { fmt: "png", name: `${meta.id}.png`, title: "Image only (.png)", text: "The map picture with walls and doors drawn in. No lights (the tabletop does its own lighting)." },
  ] as const;
  const go = async (f: (typeof files)[number]) => {
    setError(null);
    setBusy(f.fmt);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(meta.id)}/export/${f.fmt}`);
      if (!r.ok) throw new Error((await r.text()) || `The export failed (${r.status}).`);
      downloadBlob(await r.blob(), f.name);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };
  const spec = meta.battle;
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" data-testid="battle-export-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Export the battlemap</h2>
        {spec && <p className="muted">{spec.squaresX * spec.pxPerSquare} × {spec.squaresY * spec.pxPerSquare} px, {spec.pxPerSquare} px per {spec.feetPerSquare}-ft square. Preparing a big map takes a few seconds.</p>}
        {files.map((f) => (
          <div key={f.fmt} className="export-choice">
            <div><b>{f.title}</b><p className="muted">{f.text}</p></div>
            <button className="primary" disabled={!!busy} onClick={() => void go(f)} data-testid={`battle-export-${f.fmt}`}>{busy === f.fmt ? "Preparing…" : "Download"}</button>
          </div>
        ))}
        <p className="muted">The Universal VTT and Foundry files are written from the published formats but haven't been tried in Foundry or any other program yet. If one doesn't import cleanly, tell me what it said.</p>
        {error && <p className="error-text" data-testid="battle-export-error">{error}</p>}
        <div className="row end"><button className="ghost" onClick={onClose} disabled={!!busy}>Close</button></div>
      </div>
    </div>
  );
}
