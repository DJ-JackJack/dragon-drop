/**
 * Battlemap editing: the canvas (floors from the shared renderer, walls, doors and lights drawn as
 * crisp vectors), the tool panels, and the export dialog. Coordinates in here are grid SQUARES unless
 * a name says "cells" (the floor is stored at `sub` cells per square).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type BattleSpec, type ConnectorKind, type Features, type MapRoof, type RoofStyle, type LevelsFile, type MapAmbientZone, type MapConnector, type MapDoc, type MapLight, type MapMeta, type MapNote, type MapProp, type MapWall, type PaletteEntry, type Rect, type TileSource, type WallKind,
  CUSTOM_MATERIAL_BASE, type MapPath, type PathLook, renderPathLayer, smoothPath, WALL_BASE, type WallLook, type WallStyle, portalOf, wallStyleOf, LIGHT_PRESETS, ROOF_STYLES, ROOF_STYLE_NAMES, ROOF_BASE, type RoofTileSource, type WallPicture, type WallPictureSource, renderRoofLayer, roofColour, connectorTo, levelBelow, levelsByHeight, LIGHT_PRESET_NAMES, MATERIALS, PROP_PX_PER_SQUARE, ambientOf, applyLightPreset, assetLabel, battleSpec, circlePolygon, floorAtFn, hexToRgb, insertDoor, lightPresetName, lightVisibility, newFeatureId, nextNoteNumber, noteBadge, readingOrderNumbers, sortedNotes, parseAssetId, pointInPolygon, renderBattleFloor, renderWallLayer, roomWalls, visibilityPolygon, wallSegments, wallsAroundFloor,
} from "@mapmaker/core";
import { LevelBar } from "./LevelBar.tsx";
import { Popover, ToolBar } from "./ToolBar.tsx";
import { type FeatureClip, type ViewKeyAction, ARROW_DIRECTION, KEY_ZOOM_STEP, applyViewKey, boxSelect, clipBounds, copyFeatures, deleteFeatures, featureKindOf, moveFeatures, pasteFeatures, routeLength, type PaperId, MAX_PRINT_PAGES, describePlan, planPrint, selectionFromIds, selectionIds, toggleInSelection, viewKeyAction } from "@mapmaker/core";
import { armItemsPaste, getClip, itemsCopied, setClip, unstack } from "./clipboard.ts";
import { traceCtl } from "./trace.ts";
import { TraceBar } from "./TraceBar.tsx";
import { CompareBar } from "./CompareMaps.tsx";
import { compareCtl } from "./compare.ts";
import { noShiftTextSelect } from "./noShiftSelect.ts";
import { assetUrl } from "./assetsApi.ts";
import { PackFloors } from "./PackFloors.tsx";
import { PackGrid } from "./PackGrid.tsx";
import { GlowPicker, glowLabel, type PathChoice, PathLookPicker, PathSwatch, PortalPicker, PortalSwatch, type WallChoice, WallLookPicker, WallSwatch, pathChoiceLabel, portalLabel, wallChoiceLabel } from "./WallLookPicker.tsx";
import { drawMapGrid } from "./drawMapGrid.ts";
import { downloadBlob } from "./exportMap.ts";
import { store } from "./store.ts";
import { makeResizeKeeper } from "./viewResize.ts";
import { StatusBar, zoomPercent } from "./StatusBar.tsx";
import { focusBus, viewForBox } from "./focusBus.ts";
import { MEASURE_HINT, battleLength, measureCtl, useMeasure } from "./measure.ts";
import { DEFAULT_SCATTER, type ScatterSettings, ScatterStroke } from "./scatterUi.ts";

export type BattleTool = "pan" | "select" | "measure" | "brush" | "area" | "path" | "room" | "wall" | "invisible" | "door" | "secret" | "window" | "light" | "zone" | "note" | "prop" | "stairs" | "ladder" | "hole" | "roof";

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
  /** The Object tool strews objects with a drag (Scatter) instead of placing one a click. */
  propScatter: boolean;
  scatter: ScatterSettings;
  /** The shape the Area and Room tools make. */
  roomShape: "rect" | "circle" | "free";
  /** Which way a new stair or ladder leads from this level. */
  connectorTo: "up" | "down";
  /** The look a new roof gets. */
  roofStyle: RoofStyle;
  /** Roofs over the map: hidden, faint (to see the rooms through them while you work) or solid (as the players will see them). */
  roofView: "off" | "faint" | "solid";
  /** What new walls (the Wall and Room tools, walls around the floor) are built of: a look, or a picture from the asset packs. */
  wallLook: WallLook;
  wallAsset: string | null;
  /** The pictures from the asset packs new doors and windows get (null: the wooden door, the glass). */
  doorPicture: string | null;
  windowPicture: string | null;
  /** What new paths are made of, and how wide they are (squares). */
  pathLook: PathLook;
  pathAsset: string | null;
  pathWidth: number;
  /** The picture from the asset packs new roofs are tiled with (null: drawn in their look). */
  roofAsset: string | null;
  /** The light picture new lights take their shape from (null: round). */
  lightGlow: string | null;
}

/** The new-wall style the tools put on a wall (nothing for plain stone, so such a wall is stored exactly as walls always were). */
export function newWallStyle(o: Pick<BattleUi, "wallLook" | "wallAsset">): WallStyle {
  return wallStyleOf({ ...(o.wallLook !== "stone" && { look: o.wallLook }), ...(o.wallAsset && { asset: o.wallAsset }) });
}

export const defaultBattleUi: BattleUi = {
  tool: "pan", material: 1, brush: 1.5, showGrid: true, showLights: true, showNotes: true, selected: null, multi: [],
  asset: null, propScale: 1, propRotation: 0, propLayer: "above", propFlip: false, propScatter: false, scatter: DEFAULT_SCATTER, roomShape: "rect", connectorTo: "up", roofStyle: "slate", roofView: "faint",
  wallLook: "stone", wallAsset: null, doorPicture: null, windowPicture: null, pathLook: "dirt", pathAsset: null, pathWidth: 1, roofAsset: null, lightGlow: null,
};

/** The name of a floor material, including pack textures. */
export function materialLabel(meta: MapMeta | null | undefined, id: number): string {
  if (id >= CUSTOM_MATERIAL_BASE) return meta?.battle?.palette?.find((e) => e.id === id)?.name ?? "texture";
  return id === 0 ? "void" : MATERIALS[id]?.name ?? "floor";
}

export const BATTLE_TOOL_GROUPS: { name: string; tools: { id: BattleTool; label: string; key: string; tip: string }[] }[] = [
  { name: "Move", tools: [
    { id: "pan", label: "Pan", key: "H", tip: "Drag to move the map (or hold Space / right-drag with any tool)" },
    { id: "select", label: "Select", key: "V", tip: "Click a wall, door, light or object to edit it. Shift-click, or drag a box round bare ground, to select several; drag to move what is selected (hold Shift or Alt once you are dragging to put it anywhere, not snapped). Delete removes it" },
    { id: "measure", label: "Ruler", key: "M", tip: "Click points to measure a distance in feet and squares. Double-click or Enter finishes, Backspace takes back a point, Esc clears" },
  ] },
  { name: "Floor", tools: [
    { id: "brush", label: "Brush", key: "B", tip: "Paint the chosen floor material. Choose \"void\" to erase" },
    { id: "area", label: "Area", key: "A", tip: "Drag a rectangle of floor" },
    { id: "path", label: "Path", key: "Y", tip: "Click the points of a road, track or stream; double-click or Enter to finish" },
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
  { name: "Roofs", tools: [
    { id: "roof", label: "Roof", key: "F", tip: "Drag a rectangle (or a circle or free-form outline) for a roof over this level" },
  ] },
  { name: "Between levels", tools: [
    { id: "stairs", label: "Stairs", key: "T", tip: "Drag a rectangle (or click) for stairs to the level above or below" },
    { id: "ladder", label: "Ladder", key: "J", tip: "Drag a rectangle (or click) for a ladder to the level above or below" },
    { id: "hole", label: "Hole", key: "O", tip: "Drag a rectangle (or click) for a hole in this level's floor, open to the level below" },
  ] },
];
export const BATTLE_TOOLS = BATTLE_TOOL_GROUPS.flatMap((g) => g.tools);

const SCATTER_HINT = "Drag over the map to strew the chosen object under the brush: each is sized and turned a little differently, never closer than the spacing (nor to objects already there). Letting go makes it one undo step. Size and Layer below apply too.";
export const BATTLE_HINTS: Partial<Record<BattleTool, string>> = {
  pan: "Drag to move the map. Hold Space, or drag with the right button, to move it with any tool. + and - zoom.",
  brush: "Drag to paint the chosen floor. Pick a material with the floor button above. [ and ] change the brush size.",
  path: "Click the points of a road, track or stream: its corners are rounded off. Double-click or press Enter to finish; Backspace removes the last point, Esc cancels. It lies on the ground under objects and walls, and blocks nothing.",
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
  prop: "Choose an object in the Assets tab, then click the map to place it (hold Shift or Alt to place without snapping). Q and E rotate, X mirrors.",
  roof: "Draw the outline of a roof (Rectangle, Circle or Free-form like the Area tool), a little wider than the walls for an overhang. Choose its look above, or change it afterwards in the panel. Roofs show faintly while you work (Settings, Layers, Roofs: off, faint or solid). In a Foundry scene each roof becomes a tile that fades out of the way when a token stands under it; roofs are never in the ordinary picture or the Universal VTT file.",
  stairs: "Drag a rectangle for stairs (or click for one square by two). They belong to the level you are on and lead up or down, as chosen above; in a Foundry scene they are a Change Level region over both levels. You need at least two levels (Levels panel, top left of the map).",
  ladder: "Drag a rectangle for a ladder (or click for one square). It leads up or down, as chosen above, and works like stairs in a Foundry scene.",
  hole: "Drag a rectangle for a hole in this level's floor (or click for one square). It is open to the level below: a pit in the picture, and a gap in this level's floor in a Foundry scene.",
  select: "Click a wall piece, door, light, note or shaded area to select it. Drag a light, note or object to move it. Delete removes the selection.",
};

const snap = (v: number, step = 0.5) => Math.round(v / step) * step;
const isFloorTool = (t: BattleTool) => t === "brush" || t === "area" || t === "room";
/** Tools that draw a rectangle, circle or free-form outline. */
const isShapeTool = (t: BattleTool) => t === "area" || t === "room" || t === "zone" || t === "roof";
/** Tools that drag out a rectangle for a stair, ladder or hole. */
const isConnectorTool = (t: BattleTool): t is ConnectorKind => t === "stairs" || t === "ladder" || t === "hole";
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
  /** The levels of this battlemap and which one is on screen. */
  levels: LevelsFile | null;
  ui: BattleUi;
  onUi: (patch: Partial<BattleUi>) => void;
}

const BAND = 96;

export function BattleView({ meta, features, levels, ui, onUi }: ViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<ImageData | null>(null);
  /** The wall layer (stone, doors, windows, shadows) from the shared renderer, and what it was drawn from. */
  const wallRef = useRef<{ cv: HTMLCanvasElement; px: number } | null>(null);
  const wallSig = useRef("");
  const pathRef = useRef<{ cv: HTMLCanvasElement; px: number } | null>(null);
  const pathSig = useRef("");
  /** The roofs as one see-through layer, and what it was drawn from. */
  const roofRef = useRef<{ cv: HTMLCanvasElement; px: number } | null>(null);
  const roofSig = useRef("");
  const wallTimer = useRef<number | undefined>(undefined);
  const pathTimer = useRef<number | undefined>(undefined);
  const viewRef = useRef<View>({ scale: 20, ox: 0, oy: 0 });
  // when the canvas changes size (a panel shown or hidden): a fitted view is fitted again, any other keeps its middle (viewResize.ts)
  const keeper = useRef(makeResizeKeeper(() => viewRef.current, (v) => { viewRef.current = v; }, () => fit())).current;
  const fittedFor = useRef<string | null>(null);
  const drawQueued = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ mode: "pan" | "brush" | "rect" | "circle" | "move" | "marquee" | "trace" | "scatter"; sx: number; sy: number; ox: number; oy: number; ax: number; ay: number; lastX: number; lastY: number; id?: string;
    /** move: what is being dragged, whether the pointer has really moved yet, and whether it started on a member of a group (a click without a drag then picks that one). marquee: whether it adds to the selection, and what was selected before. */
    ids?: string[]; moved?: boolean; groupClick?: boolean; add?: boolean; base?: string[] } | null>(null);
  const draft = useRef<{ kind: WallKind | "path"; pts: [number, number][] } | null>(null);
  /** The objects a Scatter stroke has strewn so far (sent as one edit when the mouse is let go). */
  const scatterStroke = useRef<ScatterStroke | null>(null);
  /** Corners of a free-form floor or room being clicked out. */
  const shapeDraft = useRef<[number, number][] | null>(null);
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null);
  /** Things being dragged: which, and how far (squares) from where they started. */
  const moveGroup = useRef<{ ids: string[]; dx: number; dy: number } | null>(null);
  const nudgeTimer = useRef<number | undefined>(undefined);
  const paintToken = useRef(0);
  const metaRef = useRef(meta); metaRef.current = meta;
  const levelsRef = useRef(levels); levelsRef.current = levels;
  /** The level just below the one on screen, shown faintly where this level has no floor: which it is and its picture. */
  const belowId = levels ? levelBelow(levels.levels, levels.active)?.id ?? null : null;
  const belowRef = useRef<string | null>(null); belowRef.current = belowId;
  const ghostRef = useRef<{ id: string; bmp: ImageBitmap } | null>(null);
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

  // the trace picture redraws this view when it loads, while it is dragged and when its settings change
  useEffect(() => {
    traceCtl.redraw = requestDraw;
    compareCtl.redraw = requestDraw;
    const off = traceCtl.subscribe(requestDraw);
    return () => { off(); if (traceCtl.redraw === requestDraw) traceCtl.redraw = () => {}; if (compareCtl.redraw === requestDraw) compareCtl.redraw = () => {}; };
  }, [requestDraw]);
  const traceMode = useSyncExternalStore(traceCtl.subscribe, () => traceCtl.state.mode);

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
    const spec = m.battle, px = wallPx(spec, viewRef.current.scale), walls = featRef.current.walls ?? [], connectors = featRef.current.connectors ?? [];
    const sig = `${m.id}|${px}|${spec.squaresX}x${spec.squaresY}|${JSON.stringify(walls)}|${JSON.stringify(connectors)}`;
    if (!force && sig === wallSig.current && wallRef.current) return;
    wallSig.current = sig;
    const layer = renderWallLayer({ ...spec, pxPerSquare: px }, walls, { floorAt: floorAtFn({ meta: m, height: hf } as MapDoc), connectors, pictureFor: wallPictureFor });
    const cv = wallRef.current?.cv ?? document.createElement("canvas");
    cv.width = layer.w; cv.height = layer.h;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.w, layer.h), 0, 0);
    wallRef.current = { cv, px };
    requestDraw();
  }, []);

  /** Draw the path layer again if the paths, the map size or the zoom step changed (or `force`: a picture arrived). */
  const buildPaths = useCallback((force = false) => {
    const m = metaRef.current;
    if (!m?.battle) return;
    const paths = featRef.current.paths ?? [];
    if (!paths.length) { if (pathRef.current) { pathRef.current = null; pathSig.current = ""; requestDraw(); } return; }
    const spec = m.battle, px = wallPx(spec, viewRef.current.scale);
    const sig = `${m.id}|${px}|${spec.squaresX}x${spec.squaresY}|${JSON.stringify(paths)}`;
    if (!force && sig === pathSig.current && pathRef.current) return;
    pathSig.current = sig;
    const layer = renderPathLayer({ ...spec, pxPerSquare: px }, paths, { pictureFor: wallPictureFor });
    const cv = pathRef.current?.cv ?? document.createElement("canvas");
    cv.width = layer.w; cv.height = layer.h;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.w, layer.h), 0, 0);
    pathRef.current = { cv, px };
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The wall pictures from asset packs in their own shape, as the server prepares them (a long strip at most 128 px high, a squarer texture at most
   * 512 px a side): loaded once, and the walls are drawn again when one arrives.
   */
  const wallPictures = useRef(new Map<string, WallPicture | "loading" | "failed">());
  const wallPictureFor: WallPictureSource = (asset) => {
    const hit = wallPictures.current.get(asset);
    if (hit && hit !== "loading" && hit !== "failed") return hit;
    if (!hit) {
      wallPictures.current.set(asset, "loading");
      const img = new Image();
      img.onload = () => {
        const strip = img.naturalWidth / img.naturalHeight >= 2.5;
        const k = strip ? Math.min(1, 128 / img.naturalHeight) : Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const cx = c.getContext("2d")!;
        cx.drawImage(img, 0, 0, w, h);
        wallPictures.current.set(asset, { w, h, data: cx.getImageData(0, 0, w, h).data });
        buildWalls(true);
        buildPaths(true);
      };
      img.onerror = () => wallPictures.current.set(asset, "failed");
      img.src = assetUrl(asset);
    }
    return null;
  };

  /** A light's glow picture tinted with its colour (its brightness as the opacity), for the editor's light pools; null until the picture has loaded. */
  const glowCanvases = useRef(new Map<string, HTMLCanvasElement>());
  const glowCanvasFor = (l: MapLight): HTMLCanvasElement | null => {
    if (!l.glow) return null;
    const key = `${l.glow}|${l.colour ?? "#ffd68c"}`;
    const hit = glowCanvases.current.get(key);
    if (hit) return hit;
    const pic = wallPictureFor(l.glow);
    if (!pic) return null;
    const [r, g, b] = hexToRgb(l.colour ?? "#ffd68c");
    const c = document.createElement("canvas");
    c.width = pic.w; c.height = pic.h;
    const out = new ImageData(pic.w, pic.h);
    for (let i = 0; i < pic.w * pic.h * 4; i += 4) {
      const v = ((0.299 * pic.data[i] + 0.587 * pic.data[i + 1] + 0.114 * pic.data[i + 2]) / 255) * pic.data[i + 3];
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = v;
    }
    c.getContext("2d")!.putImageData(out, 0, 0);
    if (glowCanvases.current.size > 64) glowCanvases.current.clear();
    glowCanvases.current.set(key, c);
    return c;
  };

  /** The roof pictures from asset packs, as 512 px RGBA (loaded like floor textures: the roofs are drawn again when one arrives). */
  const roofTileFor: RoofTileSource = (asset) => {
    const hit = tiles.current.get(asset);
    if (hit && hit !== "loading" && hit !== "failed") return { data: hit, size: 512 };
    if (!hit) {
      tiles.current.set(asset, "loading");
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 512;
        const cx = c.getContext("2d")!;
        cx.drawImage(img, 0, 0, 512, 512);
        tiles.current.set(asset, cx.getImageData(0, 0, 512, 512).data);
        buildRoofs(true);
      };
      img.onerror = () => tiles.current.set(asset, "failed");
      img.src = assetUrl(asset, 512);
    }
    return null;
  };

  /** Draw the roof layer again when the roofs or the map size changed (at most 70 px a square: they are seen faintly, and a roof is expensive to draw). */
  const buildRoofs = useCallback((force = false) => {
    const m = metaRef.current;
    if (!m?.battle) return;
    const roofs = featRef.current.roofs ?? [];
    if (!roofs.length) { if (roofRef.current) { roofRef.current = null; roofSig.current = ""; requestDraw(); } return; }
    const spec = m.battle, px = Math.min(70, wallPx(spec, 1));
    const sig = `${m.id}|${px}|${spec.squaresX}x${spec.squaresY}|${JSON.stringify(roofs)}`;
    if (!force && sig === roofSig.current && roofRef.current) return;
    roofSig.current = sig;
    const layer = renderRoofLayer({ ...spec, pxPerSquare: px }, roofs, { tileFor: roofTileFor });
    const cv = roofRef.current?.cv ?? document.createElement("canvas");
    cv.width = layer.w; cv.height = layer.h;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.w, layer.h), 0, 0);
    roofRef.current = { cv, px };
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const draw1 = (rect: Rect) => {
      renderBattleFloor(doc, img.data, rect, tileSource);
      clearVoid(img.data, hf, rect, W, px / spec.sub);
      ctx.putImageData(img, 0, 0, rect.x, rect.y, rect.w, rect.h);
    };
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
    keeper.fitted();
  }

  const toSq = (sx: number, sy: number) => { const v = viewRef.current; return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale }; };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ------------------------------------------------------------ drawing
  /** The bottom bar's zoom: 100% draws the map at its picture's own size (set only when it changes). */
  const [zoomPct, setZoomPct] = useState<number | null>(null);
  const zoomShown = useRef<number | null>(null);
  function draw() {
    const cv = canvasRef.current, wrap = wrapRef.current, m = metaRef.current;
    if (!cv || !wrap) return;
    if (m?.battle) { const z = zoomPercent((viewRef.current.scale / m.battle.pxPerSquare) * 100); if (z !== zoomShown.current) { zoomShown.current = z; setZoomPct(z); } }
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
    // where there is no floor: the void, with the level below showing through faintly; then this level's floor
    ctx.fillStyle = "rgb(22, 22, 26)";
    ctx.fillRect(v.ox, v.oy, MW, MH);
    const gh = ghostRef.current;
    if (gh && gh.id === belowRef.current) { ctx.globalAlpha = 0.38; ctx.drawImage(gh.bmp, v.ox, v.oy, MW, MH); ctx.globalAlpha = 1; }
    ctx.drawImage(off, v.ox, v.oy, MW, MH);
    // roads, tracks and streams lie on the floor, under everything else
    const pl = pathRef.current;
    if (pl) { ctx.drawImage(pl.cv, v.ox, v.oy, MW, MH); if (pl.px !== wallPx(spec, v.scale)) { window.clearTimeout(pathTimer.current); pathTimer.current = window.setTimeout(() => buildPaths(), 220); } }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(v.ox - 0.5, v.oy - 0.5, MW + 1, MH + 1);
    // the trace picture: over the floor, under the grid, walls, objects and lights
    traceCtl.draw(ctx, featRef.current.trace, m.id, v);
    if (o.showGrid && spec.gridType !== "none") {
      // the shared grid drawer works in map px; here one map px is one floor cell
      drawMapGrid(ctx, { type: spec.gridType, sizeMi: spec.feetPerSquare / 5280, orient: "pointy", opacity: 0.3 },
        { scale: v.scale / spec.sub, ox: v.ox, oy: v.oy, mapWidth: m.width, mapHeight: m.height, kmPerPx: m.kmPerPx }, W, H);
    }
    const f = featRef.current, selSet = new Set(selectedIds()), isSel = (id: string) => selSet.has(id);
    const mg = moveGroup.current, mgSet = mg ? new Set(mg.ids) : null;
    const shifted = <T extends { id: string; x: number; y: number }>(a: T): T => (mgSet?.has(a.id) ? { ...a, x: a.x + mg!.dx, y: a.y + mg!.dy } : a);
    const shiftedPoly = <T extends { id: string; points: [number, number][] }>(a: T): T => (mgSet?.has(a.id) ? { ...a, points: a.points.map(([x, y]) => [x + mg!.dx, y + mg!.dy] as [number, number]) } : a);
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
      drawLights(ctx, lights, f.walls, v, glowCanvasFor);
      const amb = ambientOf(spec);
      const dimmed = amb < 0.999 || (f.zones ?? []).some((z) => z.ambient < 0.999);
      if (dimmed) drawAmbient(ctx, lights, f.walls, f.zones ?? [], v, spec, amb, dpr, W, H);
    }
    const rl = roofRef.current;
    if (o.roofView !== "off" && rl) { ctx.save(); ctx.globalAlpha = o.roofView === "solid" ? 1 : 0.5; ctx.imageSmoothingEnabled = true; ctx.drawImage(rl.cv, v.ox, v.oy, MW, MH); ctx.restore(); }
    if (o.tool === "roof" || o.tool === "select" || (f.roofs ?? []).some((r) => isSel(r.id))) drawRoofOutlines(ctx, (f.roofs ?? []).map(shiftedPoly), v, isSel, o.tool === "roof");
    if (o.tool === "zone" || o.tool === "select") drawZoneOutlines(ctx, f.zones ?? [], v, isSel, o.tool === "zone");
    drawConnectorMarks(ctx, (f.connectors ?? []).map(shifted), v, isSel, o.tool === "select" || isConnectorTool(o.tool));
    drawPathMarks(ctx, (f.paths ?? []).map(shiftedPoly), v, isSel);
    drawLightMarkers(ctx, lights, v, isSel);
    if (o.showNotes) drawNoteBadges(ctx, (f.notes ?? []).map(shifted), v, isSel);
    if (o.tool === "measure") measureCtl.draw(ctx, v, (u) => battleLength(u, spec.feetPerSquare));
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
    // another map being compared with this one, over it (compare.ts)
    compareCtl.draw(ctx, m.id, v, W, H);
    const mq = drag.current;
    if (mq?.mode === "marquee" && pointer.current) {
      const x = Math.min(mq.sx, pointer.current.x), y = Math.min(mq.sy, pointer.current.y), w = Math.abs(pointer.current.x - mq.sx), h = Math.abs(pointer.current.y - mq.sy);
      ctx.save(); ctx.fillStyle = "rgba(255, 224, 120, 0.12)"; ctx.fillRect(x, y, w, h);
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255, 224, 120, 0.95)"; ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.restore();
    }
    // a scatter stroke: what it has strewn so far, and the brush
    if (scatterStroke.current) for (const pr of scatterStroke.current.placed) drawProp(pr, 0.9);
    if (o.tool === "prop" && o.propScatter && pointer.current && !spaceRef.current) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pointer.current.x, pointer.current.y, o.scatter.radius * v.scale, 0, Math.PI * 2);
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255, 224, 120, 0.9)"; ctx.stroke();
      ctx.restore();
    }
    // the object about to be placed
    else if (o.tool === "prop" && o.asset && pointer.current && !drag.current && !spaceRef.current) {
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
      ctx.strokeStyle = dr.kind === "invisible" ? "rgba(214, 120, 230, 0.95)" : dr.kind === "path" ? "rgba(170, 226, 140, 0.97)" : "rgba(255, 210, 120, 0.97)";
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
  // the Objects list: bring a thing into view (squares)
  useEffect(() => focusBus.listen((bx) => { const w = wrapRef.current; if (!w) return; viewRef.current = viewForBox(viewRef.current, bx, w.clientWidth, w.clientHeight, 60, 3); requestDraw(); }), [requestDraw]);
  // the level below, as a picture from the server (fetched again each time a level is switched to, since the one below may have been changed meanwhile)
  const projectId = meta?.id ?? null, activeLevel = levels?.active ?? null;
  // a ruler's route belongs to its map and level
  useEffect(() => { measureCtl.clear(); }, [projectId, activeLevel]);
  useEffect(() => {
    if (!projectId || !belowId) { ghostRef.current?.bmp.close(); ghostRef.current = null; requestDraw(); return; }
    let dead = false;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/levels/${encodeURIComponent(belowId)}/picture.png`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return createImageBitmap(await r.blob()); })
      .then((bmp) => {
        if (dead) { bmp.close(); return; }
        ghostRef.current?.bmp.close();
        ghostRef.current = { id: belowId, bmp };
        requestDraw();
      })
      .catch(() => { /* no picture of the level below: it just isn't shown */ });
    return () => { dead = true; };
  }, [projectId, belowId, activeLevel, requestDraw]);
  useEffect(() => { if (meta && store.heights && fittedFor.current !== meta.id) repaint(null); }, [meta, repaint]);
  useEffect(() => { buildWalls(); buildRoofs(); buildPaths(); requestDraw(); }, [features, ui, meta, requestDraw, buildWalls, buildRoofs, buildPaths]);
  useEffect(() => { draft.current = null; shapeDraft.current = null; requestDraw(); }, [ui.tool, ui.roomShape, requestDraw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { const w = wrapRef.current; if (w) keeper.resized(w.clientWidth, w.clientHeight); requestDraw(); });
    if (wrapRef.current) ro.observe(wrapRef.current);
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable); };
    const kd = (e: KeyboardEvent) => {
      altRef.current = e.altKey || e.shiftKey; // ("free": Shift or Alt put things anywhere instead of on the snap grid)
      if (e.code === "Space" && !typing(e)) { setSpaceDown(true); e.preventDefault(); }
      const view = typing(e) ? null : viewKeyAction(e);
      // (arrow keys nudge what is selected; they move the view only when nothing is)
      if (view && !(view.kind === "pan" && selectedIds().length)) { e.preventDefault(); keyView(view); }
    };
    const ku = (e: KeyboardEvent) => { altRef.current = e.altKey || e.shiftKey; if (e.code === "Space") setSpaceDown(false); };
    const keys = (e: KeyboardEvent) => {
      if (typing(e)) return;
      // the ruler: Enter finishes the route, Escape clears it, Backspace takes back the last point
      if (uiRef.current.tool === "measure" && measureCtl.key(e)) { e.preventDefault(); requestDraw(); return; }
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
      // Page Up / Page Down: the level above / below
      if ((e.key === "PageUp" || e.key === "PageDown") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const lv = levelsRef.current;
        if (lv && lv.levels.length > 1) {
          const sorted = levelsByHeight(lv.levels), i = sorted.findIndex((l) => l.id === lv.active);
          const next = sorted[i + (e.key === "PageUp" ? 1 : -1)];
          if (next) store.setLevel(next.id);
          e.preventDefault();
          return;
        }
      }
      const arrow = ARROW_DIRECTION[e.key];
      if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey && nudge(arrow[0], arrow[1], e.shiftKey)) { e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        // (Ctrl+C and Ctrl+V let the browser's copy and paste events happen: a picture copied after the map items is pasted as a reference instead, see clipboard.ts)
        if (k === "c") { if (copySelection()) itemsCopied(); return; }
        if (k === "v") { armItemsPaste("battle", pasteClip); return; }
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
    if (o.tool === "roof") { makeRoof(polygon.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as [number, number])); return; }
    const shape = kind === "circle"
      ? { type: "circle" as const, x: toCells(pts[0][0], spec), y: toCells(pts[0][1], spec), r: toCells(r, spec) }
      : { type: "polygon" as const, points: polygon.map(([x, y]) => [toCells(x, spec), toCells(y, spec)] as [number, number]) };
    send({ t: "cmd", cmd: { op: "paint_floor", params: { shape, material: o.material } }, label: o.tool === "room" ? "Room floor" : `Paint ${materialLabel(metaRef.current, o.material)}` });
    if (o.tool === "room") {
      const wall: MapWall = { id: newFeatureId("w"), kind: "wall", points: polygon.map(([x, y]) => [x, y] as [number, number]), closed: true, ...newWallStyle(o) };
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

  /** A roof with this outline (squares), in the chosen look, selected so it can be changed. */
  function makeRoof(points: [number, number][]) {
    const ra = uiRef.current.roofAsset;
    const roof: MapRoof = { id: newFeatureId("f"), style: uiRef.current.roofStyle, points, ...(ra && { asset: ra }) };
    sendFeatures({ upsertRoofs: [roof] }, "Add roof");
    onUiRef.current({ multi: [], selected: roof.id });
  }

  function placeConnector(kind: ConnectorKind, x: number, y: number, w: number, h: number) {
    const c: MapConnector = { id: newFeatureId("c"), kind, x, y, w, h, to: kind === "hole" ? "down" : uiRef.current.connectorTo };
    sendFeatures({ upsertConnectors: [c] }, `Add ${kind}`);
    onUiRef.current({ multi: [], selected: c.id });
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
    if (dr.kind === "path") {
      const o = uiRef.current, pts = closed ? [...dr.pts, dr.pts[0]] : dr.pts;
      const path: MapPath = { id: newFeatureId("k"), points: pts, ...(o.pathWidth !== 1 && { width: o.pathWidth }), ...(!o.pathAsset && o.pathLook !== "dirt" && { look: o.pathLook }), ...(o.pathAsset && { asset: o.pathAsset }) };
      sendFeatures({ upsertPaths: [path] }, "Add path");
      onUiRef.current({ multi: [], selected: path.id });
      return;
    }
    const wall: MapWall = { id: newFeatureId("w"), kind: dr.kind, points: dr.pts, ...(closed && dr.pts.length >= 3 && { closed: true }), ...(dr.kind === "wall" && newWallStyle(uiRef.current)) };
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
    // paths: on the (rounded) line, within half the path's width
    {
      let near: { id: string; d: number } | null = null;
      for (const pa of f.paths ?? []) {
        const pts = smoothPath(pa.points), reach = Math.max(6, ((pa.width ?? 1) * v.scale) / 2);
        for (let i = 1; i < pts.length; i++) {
          const d = distToSegment(sx, sy, v.ox + pts[i - 1][0] * v.scale, v.oy + pts[i - 1][1] * v.scale, v.ox + pts[i][0] * v.scale, v.oy + pts[i][1] * v.scale);
          if (d < reach && (!near || d < near.d)) near = { id: pa.id, d };
        }
      }
      if (near) return near.id;
    }
    // stairs, ladders and holes: inside the rectangle, the smallest first
    const qc = toSq(sx, sy);
    const over = (f.connectors ?? []).filter((c) => qc.x >= c.x && qc.x <= c.x + c.w && qc.y >= c.y && qc.y <= c.y + c.h).sort((a, b) => a.w * a.h - b.w * b.h);
    if (over.length) return over[0].id;
    // roofs: inside the outline, the smallest first
    const qr = toSq(sx, sy);
    const roofsAt = (f.roofs ?? []).filter((r) => pointInPolygon(qr.x, qr.y, r.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points));
    if (roofsAt.length) return roofsAt[0].id;
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
    // lining up the trace picture takes a left click, whatever the tool (Space still pans)
    if (e.button === 0 && !spaceRef.current && traceCtl.down(featRef.current.trace, q)) {
      drag.current = { mode: "trace", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: q.x, ay: q.y, lastX: q.x, lastY: q.y };
      requestDraw();
      return;
    }
    if (e.button === 1 || e.button === 2 || o.tool === "pan" || spaceRef.current) {
      drag.current = { mode: "pan", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: 0, ay: 0, lastX: 0, lastY: 0 };
      return;
    }
    if (e.button !== 0) return;
    const spec = m.battle;
    if (o.tool === "measure") { measureCtl.down(q, p); requestDraw(); return; }
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
    if (isConnectorTool(o.tool) && (levelsRef.current?.levels.length ?? 0) < 2) {
      flash("Stairs, ladders and holes join two levels. Add another level first: use ＋ Level above or ＋ Level below in the Levels panel, top left of the map.");
      return;
    }
    if (isShapeTool(o.tool) || isConnectorTool(o.tool)) {
      drag.current = { mode: "rect", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: q.x, ay: q.y, lastX: q.x, lastY: q.y };
      return;
    }
    if (o.tool === "wall" || o.tool === "invisible" || o.tool === "path") {
      const kind: WallKind | "path" = o.tool === "invisible" ? "invisible" : o.tool === "path" ? "path" : "wall";
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
      const found = insertDoor(featRef.current.walls ?? [], q.x, q.y, 1, dk, () => newFeatureId("w"));
      if (!found) { flash("There's no wall there. Click right on a wall (draw one first with the Wall or Room tool)."); return; }
      // (a door or window gets the picture chosen for new ones; a secret door looks like the wall)
      const picture = dk === "door" ? o.doorPicture : dk === "window" ? o.windowPicture : null;
      const res = { ...found, add: found.add.map((w) => (w.id === found.door.id ? { ...w, ...portalOf(picture) } : w)), door: { ...found.door, ...portalOf(picture) } };
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
      const light: MapLight = { id: newFeatureId("g"), x: Math.min(spec.squaresX, Math.max(0, snap(q.x))), y: Math.min(spec.squaresY, Math.max(0, snap(q.y))), radius: 6, bright: 3, colour: "#ffb35c", ...(o.lightGlow && { glow: o.lightGlow }) };
      sendFeatures({ upsertLights: [light] }, "Add light");
      onUiRef.current({ multi: [], selected: light.id });
      return;
    }
    if (o.tool === "prop" && o.propScatter) {
      if (!o.asset) { flash("Choose an object in the Assets tab first."); return; }
      const hf = store.heights, sub = spec.sub;
      const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < spec.squaresX && y < spec.squaresY && (!o.scatter.floorOnly || !hf || (hf.get(Math.floor(x * sub), Math.floor(y * sub)) | 0) > 0);
      scatterStroke.current = new ScatterStroke({ ...o.scatter, asset: o.asset, scale: o.propScale, rotation: o.propRotation, flip: o.propFlip, layer: o.propLayer },
        (featRef.current.props ?? []).map((pr) => [pr.x, pr.y] as [number, number]), ok);
      scatterStroke.current.at(q.x, q.y);
      drag.current = { mode: "scatter", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: q.x, ay: q.y, lastX: q.x, lastY: q.y };
      requestDraw();
      return;
    }
    if (o.tool === "prop") {
      if (!o.asset) { flash("Choose an object in the Assets tab first."); return; }
      const prop: MapProp = {
        id: newFeatureId("o"), asset: o.asset, x: snapProp(q.x, e.altKey || e.shiftKey), y: snapProp(q.y, e.altKey || e.shiftKey),
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
    if (d?.mode === "trace") { traceCtl.move(q); return; }
    if (uiRef.current.tool === "measure" && !d) { measureCtl.move(q); requestDraw(); }
    if (d?.mode === "scatter") { scatterStroke.current?.at(q.x, q.y); requestDraw(); return; }
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
        const step = onlyObjects ? 0.25 : 0.5; // objects snap to a quarter square, everything else to half a square (Shift or Alt: anywhere)
        const free = e.altKey || e.shiftKey; // (Shift pressed after the drag has started: pressed at the click, it adds to the selection instead)
        const gx = free ? nx : snap(nx, step), gy = free ? ny : snap(ny, step);
        moveGroup.current = { ids: d.ids, dx: gx - d.ax, dy: gy - d.ay };
      }
    }
    requestDraw();
  };

  const endDrag = () => {
    const d = drag.current, p = pointer.current, spec = metaRef.current?.battle;
    drag.current = null;
    if (d?.mode === "trace") { traceCtl.up(); return; }
    if (d?.mode === "scatter") {
      const st = scatterStroke.current;
      scatterStroke.current = null;
      if (st?.placed.length) sendFeatures({ upsertProps: st.placed }, `Scatter ${st.placed.length} object${st.placed.length === 1 ? "" : "s"}`);
      requestDraw();
      return;
    }
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
        const kinds: ("prop" | "light" | "note" | "wall" | "zone" | "connector" | "roof" | "path")[] = ["prop", "light", "wall", "zone", "connector", "roof", "path", ...(o.showNotes ? (["note"] as const) : [])];
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
      if (isConnectorTool(o.tool)) {
        if (w >= 1 && h >= 1) placeConnector(o.tool, x0, y0, w, h);
        else if (Math.hypot(p.x - d.sx, p.y - d.sy) < 4) {
          // a click: the usual size, with its top-left corner in the square that was clicked
          const [dw, dh] = o.tool === "stairs" ? [1, 2] : [1, 1];
          placeConnector(o.tool, Math.min(spec.squaresX - dw, Math.max(0, Math.floor(d.ax))), Math.min(spec.squaresY - dh, Math.max(0, Math.floor(d.ay))), dw, dh);
        }
      } else if (w >= 1 && h >= 1 && o.tool === "roof") makeRoof([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]);
      else if (w >= 1 && h >= 1 && o.tool === "zone") makeZone([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]);
      else if (w >= 1 && h >= 1) {
        const shape = { type: "rect" as const, x: toCells(x0, spec), y: toCells(y0, spec), w: toCells(w, spec), h: toCells(h, spec) };
        send({ t: "cmd", cmd: { op: "paint_floor", params: { shape, material: o.material } }, label: o.tool === "room" ? `Room floor (${w}×${h})` : `Paint ${materialLabel(metaRef.current, o.material)}` });
        if (o.tool === "room") {
          const walls = roomWalls(newFeatureId("w"), x0, y0, w, h, [], newWallStyle(o));
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
  const cursor = traceMode === "move" && features.trace ? "move" : traceMode && features.trace ? "crosshair"
    : spaceDown || tool === "pan" ? (drag.current?.mode === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : tool === "brush" ? "none" : "crosshair";
  const spec = meta?.battle;
  return (
    <div className="mapview-col">
    <div className="mapview" ref={wrapRef}>
      <canvas
        ref={canvasRef} style={{ cursor }} data-testid="battle-canvas"
        onMouseDown={noShiftTextSelect} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onPointerLeave={() => { pointer.current = null; measureCtl.leave(); setHover(null); requestDraw(); }}
        onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
      />
      {levels && <LevelBar levels={levels} />}
      {meta && <TraceBar trace={features.trace} meta={meta} level={levels?.active} />}
      {meta && <CompareBar meta={meta} />}
      {(!meta || loadedId !== meta.id) && <div className="mapview-empty">Loading map…</div>}
      {status && meta && loadedId === meta.id && <div className="mapview-busy">{status}</div>}
      {note && <div className="mapview-note" data-testid="battle-note">{note}</div>}
      {exportOpen && meta && <BattleExportDialog meta={meta} levels={levels} onClose={() => setExportOpen(false)} />}
    </div>
    <StatusBar
      zoom={zoomPct} zoomTitle="100% draws the map at its picture's own size" onZoom={(dir) => keyView({ kind: "zoom", factor: dir > 0 ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP })}
      onFit={() => { fittedFor.current = null; fit(); requestDraw(); }}
      switches={[{ label: "Grid", on: ui.showGrid, onToggle: () => onUi({ showGrid: !ui.showGrid }), title: "Show the grid (G)", testId: "bar-grid" }]}
      info={hover && spec ? (
        <>x {hover.x.toFixed(1)} · y {hover.y.toFixed(1)} squares · {Math.round(hover.x * spec.feetPerSquare)} ft, {Math.round(hover.y * spec.feetPerSquare)} ft · {materialLabel(meta, hover.m)}</>
      ) : spec ? (
        <>{spec.squaresX}×{spec.squaresY} squares · {spec.squaresX * spec.feetPerSquare}×{spec.squaresY * spec.feetPerSquare} ft</>
      ) : null}
    >
      <button onClick={() => setExportOpen(true)} title="Export for Foundry, Universal VTT or as an image" data-testid="battle-export-button">⤓ Export</button>
    </StatusBar>
    </div>
  );
}

// ---------------------------------------------------------------- drawing helpers
/** Make the void (cells with no floor) transparent in a painted floor, so what lies under it (the level below, shown faintly) can be seen through it. */
function clearVoid(out: Uint8ClampedArray, hf: { w: number; h: number; data: ArrayLike<number> }, r: Rect, imgW: number, cellPx: number) {
  const { w: CW, h: CH, data } = hf;
  for (let y = r.y; y < r.y + r.h; y++) {
    const row = Math.min(CH - 1, Math.floor(y / cellPx)) * CW;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (((data[row + Math.min(CW - 1, Math.floor(x / cellPx))] as number) | 0) === 0) out[(y * imgW + x) * 4 + 3] = 0;
    }
  }
}

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

function drawLights(ctx: CanvasRenderingContext2D, lights: MapLight[], walls: MapWall[] | undefined, v: View, glowFor?: (l: MapLight) => HTMLCanvasElement | null) {
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
    const glow = glowFor?.(l);
    if (glow) { ctx.globalAlpha = Math.min(1, 0.45 * (l.intensity ?? 1)); ctx.drawImage(glow, cx - R, cy - R, 2 * R, 2 * R); } // (its own shape, tinted)
    else { ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); }
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

/** A mark on each stair, ladder and hole saying which way it leads (the picture itself is in the wall layer), and an outline round the selected ones. */
function drawConnectorMarks(ctx: CanvasRenderingContext2D, list: MapConnector[], v: View, isSelected: (id: string) => boolean, outlineAll: boolean) {
  if (!list.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const c of list) {
    const x = v.ox + c.x * v.scale, y = v.oy + c.y * v.scale, w = c.w * v.scale, h = c.h * v.scale;
    if (outlineAll || isSelected(c.id)) {
      ctx.setLineDash(isSelected(c.id) ? [6, 4] : [2, 4]);
      ctx.strokeStyle = isSelected(c.id) ? "rgba(255, 224, 120, 0.95)" : "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = isSelected(c.id) ? 2 : 1;
      ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      ctx.setLineDash([]);
    }
    const size = Math.max(9, Math.min(Math.min(w, h) * 0.5, 26));
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(15, 18, 28, 0.85)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    const g = connectorTo(c) === "up" ? "▲" : "▼";
    ctx.strokeText(g, x + w / 2, y + h / 2);
    ctx.fillText(g, x + w / 2, y + h / 2);
  }
  ctx.restore();
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

/** The outline of each roof (all of them while drawing roofs, else only the selected ones), with its look written inside. */
function drawRoofOutlines(ctx: CanvasRenderingContext2D, roofs: MapRoof[], v: View, isSelected: (id: string) => boolean, all: boolean) {
  ctx.save();
  for (const r of roofs) {
    if (!all && !isSelected(r.id)) continue;
    ctx.beginPath();
    r.points.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
    ctx.closePath();
    ctx.setLineDash([7, 5]); ctx.lineWidth = isSelected(r.id) ? 2 : 1.25;
    ctx.strokeStyle = isSelected(r.id) ? "rgba(255, 224, 120, 0.95)" : "rgba(255, 190, 150, 0.8)"; ctx.stroke(); ctx.setLineDash([]);
    if (isSelected(r.id)) {
      const cx = r.points.reduce((a, p) => a + p[0], 0) / r.points.length, cy = r.points.reduce((a, p) => a + p[1], 0) / r.points.length;
      ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10, 12, 20, 0.9)"; ctx.fillStyle = "#ffe0b0";
      const label = r.name ?? (r.asset ? "Roof (picture)" : `Roof (${ROOF_STYLE_NAMES[r.style] ?? r.style})`);
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
/** The tool bar: the settings of the tool in use (floor material, brush size, object size, shapes). The tools themselves are in the rail. */
export function BattleToolBar({ ui, onUi, meta, assetsOn, onOpenAssets }: { ui: BattleUi; onUi: (p: Partial<BattleUi>) => void; meta: MapMeta | null; assetsOn: boolean; onOpenAssets: () => void }) {
  const ms = useMeasure();
  const picked = ui.material >= CUSTOM_MATERIAL_BASE ? meta?.battle?.palette?.find((e) => e.id === ui.material) : undefined;
  const swatchStyle = picked ? { backgroundImage: `url(${assetUrl(picked.asset, 64)})` } : { background: `rgb(${(MATERIALS[ui.material]?.colour ?? [60, 60, 60]).join(",")})` };
  return (
    <ToolBar hint={ui.tool === "measure" ? MEASURE_HINT : ui.tool === "prop" && ui.propScatter ? SCATTER_HINT : BATTLE_HINTS[ui.tool]} tool={{ id: ui.tool, name: BATTLE_TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.id === ui.tool)?.label ?? ui.tool }}>
      {ui.tool === "measure" && (
        <span className="measure-result" data-testid="measure-result">
          {measureCtl.shown().length < 2 ? "Click to start measuring" : <b>{battleLength(routeLength(measureCtl.shown()), meta?.battle?.feetPerSquare ?? 5)}</b>}
          {ms.points.length > 2 && <span className="muted"> · {ms.points.length - 1} legs</span>}
        </span>
      )}
      {ui.tool === "roof" && (
        <>
          <label className="field">New roofs look like
            <select value={ui.roofStyle} onChange={(e) => onUi({ roofStyle: e.target.value as RoofStyle })} data-testid="roof-new-style">
              {ROOF_STYLES.map((s) => <option key={s} value={s}>{ROOF_STYLE_NAMES[s]}</option>)}
            </select>
          </label>
          <Popover label={ui.roofAsset ? <><span className="swatch now" style={{ backgroundImage: `url(${assetUrl(ui.roofAsset, 64)})` }} /> Picture: <b>{assetLabel(parseAssetId(ui.roofAsset)?.path ?? ui.roofAsset)}</b></> : "Picture: none"} title="A picture from your asset packs tiled across new roofs (none: drawn in their look)" testId="roof-picture-menu">
            {(close) => (
              <div className="wall-picker">
                <div className="row"><button className={ui.roofAsset ? "" : "on"} onClick={() => { onUi({ roofAsset: null }); close(); }} data-testid="roof-picture-none">No picture: drawn in its look</button></div>
                <PackGrid kinds={[{ cat: "roofs", label: "roofs" }, { cat: "patterns", label: "patterns" }, { cat: "terrain", label: "floor textures" }]} testId="pack-broofs" item="pack-broof" placeholder="Search: roof, slate, thatch…"
                  noneFound="Nothing of this kind in your asset packs." noFolder="To tile roofs with the pictures in your asset packs, choose your asset folder in Settings (Maps and assets)."
                  stateOf={(it) => ({ on: it.id === ui.roofAsset })} onChoose={(it) => { onUi({ roofAsset: it.id }); close(); }} />
              </div>
            )}
          </Popover>
        </>
      )}
      {(ui.tool === "stairs" || ui.tool === "ladder") && (
        <div className="seg" role="group" aria-label="Which way it leads" data-testid="connector-to">
          {([["up", "Leads up"], ["down", "Leads down"]] as const).map(([id, label]) => (
            <button key={id} className={ui.connectorTo === id ? "on" : ""} onClick={() => onUi({ connectorTo: id })} data-testid={`connector-${id}`}>{label}</button>
          ))}
        </div>
      )}
      {isShapeTool(ui.tool) && (
        <div className="seg" role="group" aria-label="Shape" data-testid="room-shape">
          {([["rect", "Rectangle"], ["circle", "Circle"], ["free", "Free-form"]] as const).map(([id, label]) => (
            <button key={id} className={ui.roomShape === id ? "on" : ""} onClick={() => onUi({ roomShape: id })} data-testid={`shape-${id}`}>{label}</button>
          ))}
        </div>
      )}
      {isFloorTool(ui.tool) && (
        <Popover label={<><span className="swatch now" style={swatchStyle} /> <b>{materialLabel(meta, ui.material)}</b></>} title="Choose the floor material" testId="floor-material-menu">
          {(close) => (
            <>
            <div className="materials" data-testid="materials">
              {MATERIALS.map((m) => (
                <button
                  key={m.id} className={`swatch ${ui.material === m.id ? "on" : ""}`} onClick={() => { onUi({ material: m.id }); close(); }} title={m.id === 0 ? "void (erases floor)" : m.name}
                  style={{ background: `rgb(${m.colour.join(",")})` }} data-testid={`material-${m.name.replace(/\s+/g, "-")}`}
                >
                  {m.id === 0 ? "✕" : ""}
                </button>
              ))}
              {(meta?.battle?.palette ?? []).map((e) => (
                <button
                  key={e.id} className={`swatch tex ${ui.material === e.id ? "on" : ""}`} onClick={() => { onUi({ material: e.id }); close(); }} title={`${e.name} (pack texture). Right-click to remove`}
                  style={{ backgroundImage: `url(${assetUrl(e.asset, 64)})` }} data-testid={`material-tex-${e.name.replace(/\s+/g, "-")}`}
                  onContextMenu={(ev) => { ev.preventDefault(); removeTexture(meta!, e, ui, onUi); }}
                />
              ))}
            </div>
            {/* (every floor texture in the asset packs, searched; the Assets tab shows them bigger) */}
            {assetsOn && <PackFloors meta={meta} current={ui.material} onChosen={(material) => { onUi({ material }); close(); }} onBrowse={() => { close(); onOpenAssets(); }} />}
            </>
          )}
        </Popover>
      )}
      {ui.tool === "prop" && (
        <div className="prop-options" data-testid="prop-options">
          <div className="seg" role="group" aria-label="How objects are placed" data-testid="prop-modes">
            <button className={ui.propScatter ? "" : "on"} onClick={() => onUi({ propScatter: false })} title="A click places one object" data-testid="prop-mode-one">One</button>
            <button className={ui.propScatter ? "on" : ""} onClick={() => onUi({ propScatter: true })} title="Drag to strew objects under a round brush: trees, rocks, debris" data-testid="prop-mode-scatter">Scatter</button>
          </div>
          <span className="muted">{ui.asset ? `${ui.propScatter ? "Strewing" : "Placing"}: ${assetLabel(parseAssetId(ui.asset)?.path ?? ui.asset)}` : "No object chosen yet: open the Assets tab and click one."}</span>
          {ui.propScatter && (
            <>
              <label className="slider"><span>Brush <b>{ui.scatter.radius}</b> sq</span>
                <input type="range" min={0.5} max={8} step={0.5} value={ui.scatter.radius} onChange={(e) => onUi({ scatter: { ...ui.scatter, radius: Number(e.target.value) } })} data-testid="scatter-radius" />
              </label>
              <label className="slider" title="Squares between the objects' centres (and from objects already there)"><span>Spacing <b>{ui.scatter.spacing}</b> sq</span>
                <input type="range" min={0.2} max={4} step={0.1} value={ui.scatter.spacing} onChange={(e) => onUi({ scatter: { ...ui.scatter, spacing: Number(e.target.value) } })} data-testid="scatter-spacing" />
              </label>
              <label className="slider"><span>Sizes vary <b>{Math.round(ui.scatter.vary * 100)}%</b></span>
                <input type="range" min={0} max={60} step={5} value={Math.round(ui.scatter.vary * 100)} onChange={(e) => onUi({ scatter: { ...ui.scatter, vary: Number(e.target.value) / 100 } })} />
              </label>
              <label className="check"><input type="checkbox" checked={ui.scatter.turn} onChange={(e) => onUi({ scatter: { ...ui.scatter, turn: e.target.checked } })} /> Turn each</label>
              <label className="check" title="Pictures of the same name in the same folder, numbered or lettered (Tree A1, A2, A3...)"><input type="checkbox" checked={ui.scatter.variants} onChange={(e) => onUi({ scatter: { ...ui.scatter, variants: e.target.checked } })} /> Mix in its variants</label>
              <label className="check"><input type="checkbox" checked={ui.scatter.floorOnly} onChange={(e) => onUi({ scatter: { ...ui.scatter, floorOnly: e.target.checked } })} /> Only on floor</label>
            </>
          )}
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
      {(ui.tool === "door" || ui.tool === "window") && (() => {
        const kind = ui.tool, picture = kind === "door" ? ui.doorPicture : ui.windowPicture;
        return (
          <Popover label={<><PortalSwatch kind={kind} picture={picture} /> {kind === "door" ? "Doors" : "Windows"}: <b>{portalLabel(kind, picture)}</b></>} title={`Choose what new ${kind}s look like`} testId={`${kind}-look-menu`}>
            {(close) => <PortalPicker kind={kind} value={picture} onPick={(pic) => { onUi(kind === "door" ? { doorPicture: pic } : { windowPicture: pic }); close(); }} />}
          </Popover>
        );
      })()}
      {ui.tool === "light" && (
        <Popover label={<>Shape: <b>{glowLabel(ui.lightGlow)}</b></>} title="Choose the shape of new lights: round, or a light picture from your asset packs" testId="light-glow-menu">
          {(close) => <GlowPicker value={ui.lightGlow} onPick={(pic) => { onUi({ lightGlow: pic }); close(); }} />}
        </Popover>
      )}
      {(ui.tool === "wall" || ui.tool === "room") && (
        <Popover label={<><WallSwatch c={{ look: ui.wallLook, asset: ui.wallAsset }} /> Walls: <b>{wallChoiceLabel({ look: ui.wallLook, asset: ui.wallAsset })}</b></>} title="Choose what new walls are built of" testId="wall-look-menu">
          {(close) => <WallLookPicker value={{ look: ui.wallLook, asset: ui.wallAsset }} onPick={(c) => { onUi({ wallLook: c.look, wallAsset: c.asset }); close(); }} />}
        </Popover>
      )}
      {ui.tool === "path" && (
        <>
          <Popover label={<><PathSwatch c={{ look: ui.pathLook, asset: ui.pathAsset }} /> Made of: <b>{pathChoiceLabel({ look: ui.pathLook, asset: ui.pathAsset })}</b></>} title="Choose what new paths are made of" testId="path-look-menu">
            {(close) => <PathLookPicker value={{ look: ui.pathLook, asset: ui.pathAsset }} onPick={(c) => { onUi({ pathLook: c.look, pathAsset: c.asset }); close(); }} />}
          </Popover>
          <label className="slider"><span>Width <b>{ui.pathWidth}</b> square{ui.pathWidth === 1 ? "" : "s"}</span>
            <input type="range" min={1} max={24} value={Math.round(ui.pathWidth * 4)} onChange={(e) => onUi({ pathWidth: Number(e.target.value) / 4 })} data-testid="path-width" />
          </label>
        </>
      )}
      {ui.tool === "brush" && (
        <label className="slider">
          <span>Brush size <b>{(ui.brush * 2).toFixed(1)}</b> squares across</span>
          <input type="range" min={1} max={40} value={Math.round(ui.brush * 4)} onChange={(e) => onUi({ brush: Number(e.target.value) / 4 })} />
        </label>
      )}
      {(isFloorTool(ui.tool) || ui.tool === "wall") && <div className="cavewalls" data-testid="cave-walls">
        <button onClick={() => buildWallsAroundFloor(meta, newWallStyle(ui))} title="Draw a wall along the edge of all the floor: handy for caves and anything you painted freehand" data-testid="walls-around-floor">▢ Walls around the floor</button>
      </div>}
    </ToolBar>
  );
}

/** Walls along the edge of all the floor. Walls built this way before are replaced, so it can be run again after changing the floor. */
export function buildWallsAroundFloor(meta: MapMeta | null, style: WallStyle = {}) {
  const hf = store.heights;
  if (!meta?.battle || !hf) return;
  const doc: MapDoc = { meta, height: hf };
  const walls = wallsAroundFloor(doc, () => newFeatureId("w")).map((w) => ({ ...w, ...style }));
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
  const [picking, setPicking] = useState(false);
  // (walls and windows can be restyled together; a door keeps its own look, an invisible wall has none)
  const buildable = (features.walls ?? []).filter((w) => ids.includes(w.id) && (w.kind === "wall" || w.kind === "window" || w.kind === "secret"));
  const parts = [[count("prop"), "object"], [count("light"), "light"], [count("wall"), "wall piece"], [count("note"), "room note"], [count("zone"), "light zone"], [count("connector"), "stair, ladder or hole"], [count("roof"), "roof"]]
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
      {buildable.length > 0 && (
        <>
          <button className="built-of" onClick={() => setPicking((v) => !v)} aria-expanded={picking} title="Choose what the selected walls are built of" data-testid="group-built-of">
            Build {buildable.length === 1 ? "the wall" : `these ${buildable.length} walls`} of… <span aria-hidden="true">{picking ? "▴" : "▾"}</span>
          </button>
          {picking && (
            <div className="inline-picker">
              <WallLookPicker value={{ look: buildable[0].look ?? "stone", asset: buildable[0].asset ?? null }} onPick={(c) => {
                const next = buildable.map((w) => { const n: MapWall = { ...w }; delete n.look; delete n.asset; delete n.tile; return { ...n, ...newWallStyle({ wallLook: c.look, wallAsset: c.asset }) }; });
                sendFeatures({ upsertWalls: next }, `Walls built of ${wallChoiceLabel(c)} (${next.length})`);
                setPicking(false);
              }} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function BattleInspector({ features, levels, chosenAsset, selected, multi, bounds, onClear, onSelect }: { features: Features; levels?: LevelsFile | null; chosenAsset?: string | null; selected: string | null; multi: string[]; bounds: { w: number; h: number }; onClear: () => void; onSelect: (ids: string[]) => void }) {
  if (multi.length >= 2) return <GroupPanel features={features} ids={multi} bounds={bounds} onClear={onClear} onSelect={onSelect} />;
  const wall = selected ? features.walls?.find((w) => w.id === selected) : undefined;
  const light = selected ? features.lights?.find((l) => l.id === selected) : undefined;
  const prop = selected ? features.props?.find((p) => p.id === selected) : undefined;
  const note = selected ? features.notes?.find((n) => n.id === selected) : undefined;
  const zone = selected ? features.zones?.find((z) => z.id === selected) : undefined;
  const conn = selected ? features.connectors?.find((c) => c.id === selected) : undefined;
  const roof = selected ? features.roofs?.find((r) => r.id === selected) : undefined;
  const path = selected ? features.paths?.find((r) => r.id === selected) : undefined;
  if (!wall && !light && !prop && !note && !zone && !conn && !roof && !path) return null;
  return (
    <section data-testid="battle-inspector">
      <h3>{wall ? (wall.kind === "wall" ? "Wall" : wall.kind === "secret" ? "Secret door" : wall.kind === "invisible" ? "Invisible wall" : wall.kind === "window" ? "Window" : "Door") : prop ? "Object" : note ? "Note" : zone ? "Light zone" : conn ? (conn.kind === "stairs" ? "Stairs" : conn.kind === "ladder" ? "Ladder" : "Hole") : roof ? "Roof" : path ? "Path" : "Light"}</h3>
      {wall && <WallEditor w={wall} onClear={onClear} />}
      {light && <LightEditor l={light} onClear={onClear} />}
      {prop && <PropEditor p={prop} onClear={onClear} />}
      {note && <NoteEditor key={note.id} n={note} onClear={onClear} />}
      {zone && <ZoneEditor key={zone.id} z={zone} onClear={onClear} />}
      {conn && <ConnectorEditor key={conn.id} c={conn} levels={levels ?? null} onClear={onClear} />}
      {roof && <RoofEditor key={roof.id} r={roof} chosenAsset={chosenAsset ?? null} onClear={onClear} />}
      {path && <PathEditor key={path.id} p={path} onClear={onClear} />}
    </section>
  );
}

/** Edit a path: what it is made of, and how wide it is. */
function PathEditor({ p, onClear }: { p: MapPath; onClear: () => void }) {
  const latest = useLatest(p);
  const [picking, setPicking] = useState(false);
  const send = (next: MapPath, label: string) => { latest.current = next; sendFeatures({ upsertPaths: [next] }, label); };
  const choice = { look: p.look ?? "dirt", asset: p.asset ?? null } as PathChoice;
  return (
    <>
      <button className="built-of" onClick={() => setPicking((v) => !v)} aria-expanded={picking} title="Choose what this path is made of" data-testid="path-made-of">
        Made of <PathSwatch c={choice} /> <b>{pathChoiceLabel(choice)}</b> <span aria-hidden="true">{picking ? "▴" : "▾"}</span>
      </button>
      {picking && (
        <div className="inline-picker">
          <PathLookPicker value={choice} onPick={(c) => {
            const next: MapPath = { ...latest.current };
            delete next.look; delete next.asset;
            if (c.asset) next.asset = c.asset; else if (c.look !== "dirt") next.look = c.look;
            send(next, `Path made of ${pathChoiceLabel(c)}`);
            setPicking(false);
          }} />
        </div>
      )}
      <label className="slider"><span>Width <b>{p.width ?? 1}</b> square{(p.width ?? 1) === 1 ? "" : "s"}</span>
        <input type="range" min={1} max={48} value={Math.round((p.width ?? 1) * 4)} onChange={(e) => send({ ...latest.current, width: Number(e.target.value) / 4 }, "Change path")} data-testid="path-width-one" />
      </label>
      <p className="muted">{p.points.length} points. Drag it with Select to move it; it blocks nothing (add walls or invisible walls for that).</p>
      <div className="row">
        <button onClick={() => { sendFeatures({ removePaths: [p.id] }, "Delete path"); onClear(); }} data-testid="path-delete">Delete</button>
      </div>
    </>
  );
}

/** Where the paths run: a dashed line down the middle of a selected one (its picture is in the path layer under everything). */
function drawPathMarks(ctx: CanvasRenderingContext2D, paths: MapPath[], v: { ox: number; oy: number; scale: number }, isSel: (id: string) => boolean) {
  for (const p of paths) {
    if (!isSel(p.id)) continue;
    const pts = smoothPath(p.points);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 224, 120, 0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
    ctx.stroke();
    ctx.restore();
  }
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

/** A roof: its look (one of four, or a picture from the Assets tab), colour, pitch and name. */
function RoofEditor({ r, chosenAsset, onClear }: { r: MapRoof; chosenAsset: string | null; onClear: () => void }) {
  const latest = useLatest(r);
  const [name, setName] = useState(r.name ?? "");
  const set = (patch: Partial<MapRoof>) => {
    const next = { ...latest.current, ...patch };
    for (const k of Object.keys(next) as (keyof MapRoof)[]) if (next[k] === undefined) delete next[k];
    latest.current = next;
    sendFeatures({ upsertRoofs: [next] }, `Change roof${next.name ? ` ${next.name}` : ""}`);
  };
  const own = roofColour(r.colour);
  const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  return (
    <>
      <label className="field">Look
        <select value={r.style} onChange={(e) => set({ style: e.target.value as RoofStyle })} data-testid="roof-style">
          {ROOF_STYLES.map((s) => <option key={s} value={s}>{ROOF_STYLE_NAMES[s]}</option>)}
        </select>
      </label>
      {r.asset ? (
        <>
          <p className="muted" data-testid="roof-asset">Made of the picture <b>{assetLabel(r.asset)}</b>, repeated.</p>
          <label className="field">One repeat is (squares)<input type="number" min={0.5} max={20} step={0.5} value={r.tile ?? 2} onChange={(e) => { const n = Number(e.target.value); if (n >= 0.25) set({ tile: n }); }} /></label>
          <div className="row"><button onClick={() => set({ asset: undefined, tile: undefined })}>Use the look above instead</button></div>
        </>
      ) : chosenAsset ? (
        <div className="row"><button onClick={() => set({ asset: chosenAsset })} title="Use the picture chosen in the Assets tab, repeated across the roof" data-testid="roof-use-asset">Use the picture chosen in Assets ({assetLabel(chosenAsset)})</button></div>
      ) : null}
      <label className="check"><input type="checkbox" checked={!!own} onChange={(e) => set({ colour: e.target.checked ? hex(ROOF_BASE[r.style] ?? [128, 128, 128]) : undefined })} /> Own colour</label>
      {own && <input type="color" value={hex(own)} onChange={(e) => set({ colour: e.target.value })} aria-label="Roof colour" data-testid="roof-colour" />}
      <label className="check"><input type="checkbox" checked={!!r.flat} onChange={(e) => set({ flat: e.target.checked || undefined })} data-testid="roof-flat" /> Flat (no ridge)</label>
      <label className="field">Name
        <input type="text" value={name} maxLength={60} placeholder="optional" onChange={(e) => setName(e.target.value)} onBlur={() => { const n = name.trim(); if (n !== (r.name ?? "")) set({ name: n || undefined }); }} data-testid="roof-name" />
      </label>
      <p className="muted">Over this level. Faint here while you work; a Foundry scene gets it as a tile that fades when a token stands under it. Draw it a little wider than the walls for an overhang.</p>
      <div className="row"><button onClick={() => { sendFeatures({ removeRoofs: [r.id] }, "Delete roof"); onClear(); }} data-testid="roof-delete">Delete</button></div>
    </>
  );
}

/** Stairs, ladders and holes: where they lead, what they are called, how big they are. */
function ConnectorEditor({ c, levels, onClear }: { c: MapConnector; levels: LevelsFile | null; onClear: () => void }) {
  const latest = useLatest(c);
  const [name, setName] = useState(c.name ?? "");
  const set = (patch: Partial<MapConnector>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    sendFeatures({ upsertConnectors: [next] }, `Change ${next.kind}`);
  };
  const to = connectorTo(c);
  const sorted = levels ? levelsByHeight(levels.levels) : [];
  const target = levels ? sorted[sorted.findIndex((l) => l.id === levels.active) + (to === "up" ? 1 : -1)] : undefined;
  const size = (key: "w" | "h", v: string) => { const n = Math.max(1, Math.round(Number(v))); if (Number.isFinite(n)) set({ [key]: n }); };
  return (
    <>
      <label className="field">Kind
        <select value={c.kind} onChange={(e) => set({ kind: e.target.value as ConnectorKind })} data-testid="connector-kind">
          <option value="stairs">Stairs</option><option value="ladder">Ladder</option><option value="hole">Hole</option>
        </select>
      </label>
      <label className="field">Leads
        <select value={to} disabled={c.kind === "hole"} onChange={(e) => set({ to: e.target.value as "up" | "down" })} data-testid="connector-lead">
          <option value="up">Up</option><option value="down">Down</option>
        </select>
      </label>
      <p className="muted" data-testid="connector-target">{target ? `Leads ${to} to ${target.name}.` : `There is no level ${to === "up" ? "above" : "below"} this one: it won't be in a Foundry scene.`}</p>
      <label className="field">Name
        <input value={name} maxLength={60} placeholder="optional" onChange={(e) => setName(e.target.value)} onBlur={() => { const n = name.trim(); if (n !== (c.name ?? "")) set({ name: n || undefined }); }} data-testid="connector-name" />
      </label>
      <div className="row">
        <label className="field">Wide<input type="number" min={1} value={c.w} onChange={(e) => size("w", e.target.value)} /></label>
        <label className="field">Long<input type="number" min={1} value={c.h} onChange={(e) => size("h", e.target.value)} /></label>
      </div>
      <div className="row">
        <button onClick={() => { sendFeatures({ removeConnectors: [c.id] }, `Delete ${c.kind}`); onClear(); }} data-testid="connector-delete">Delete</button>
      </div>
    </>
  );
}

function WallEditor({ w, onClear }: { w: MapWall; onClear: () => void }) {
  const latest = useLatest(w);
  const set = (patch: Partial<MapWall>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    sendFeatures({ upsertWalls: [next] }, `Change ${next.kind}`);
  };
  const [picking, setPicking] = useState(false);
  const [pickingPortal, setPickingPortal] = useState(false);
  const setPortal = (picture: string | null) => {
    const next: MapWall = { ...latest.current };
    delete next.portal;
    Object.assign(next, portalOf(picture));
    latest.current = next;
    sendFeatures({ upsertWalls: [next] }, `${next.kind === "door" ? "Door" : "Window"} looks like ${portalLabel(next.kind === "door" ? "door" : "window", picture)}`);
  };
  const setStyle = (c: WallChoice) => {
    const next: MapWall = { ...latest.current };
    delete next.look; delete next.asset; delete next.tile;
    Object.assign(next, newWallStyle({ wallLook: c.look, wallAsset: c.asset }));
    latest.current = next;
    sendFeatures({ upsertWalls: [next] }, `Wall built of ${wallChoiceLabel(c)}`);
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
      {(w.kind === "wall" || w.kind === "window" || w.kind === "secret") && (
        <>
          {/* (open in the panel, not as a pop-out: the panel scrolls, and would cut a pop-out off) */}
          <button className="built-of" onClick={() => setPicking((v) => !v)} aria-expanded={picking} title="Choose what this wall is built of" data-testid="wall-built-of">
            Built of <WallSwatch c={{ look: w.look ?? "stone", asset: w.asset ?? null }} /> <b>{wallChoiceLabel({ look: w.look ?? "stone", asset: w.asset ?? null })}</b> <span aria-hidden="true">{picking ? "▴" : "▾"}</span>
          </button>
          {picking && <div className="inline-picker"><WallLookPicker value={{ look: w.look ?? "stone", asset: w.asset ?? null }} onPick={(c) => { setStyle(c); setPicking(false); }} /></div>}
        </>
      )}
      {(w.kind === "door" || w.kind === "window") && (
        <>
          <button className="built-of" onClick={() => setPickingPortal((v) => !v)} aria-expanded={pickingPortal} title={`Choose what this ${w.kind} looks like`} data-testid="portal-look">
            Looks like <PortalSwatch kind={w.kind} picture={w.portal} /> <b>{portalLabel(w.kind, w.portal)}</b> <span aria-hidden="true">{pickingPortal ? "▴" : "▾"}</span>
          </button>
          {pickingPortal && <div className="inline-picker"><PortalPicker kind={w.kind} value={w.portal ?? null} onPick={(pic) => { setPortal(pic); setPickingPortal(false); }} /></div>}
        </>
      )}
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
  const [picking, setPicking] = useState(false);
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
      <button className="built-of" onClick={() => setPicking((v) => !v)} aria-expanded={picking} title="Choose the light's shape: round, or a light picture from your asset packs" data-testid="light-shape">
        Shape <b>{glowLabel(l.glow)}</b> <span aria-hidden="true">{picking ? "▴" : "▾"}</span>
      </button>
      {picking && <div className="inline-picker"><GlowPicker value={l.glow ?? null} onPick={(pic) => { const next: MapLight = { ...latest.current }; delete next.glow; if (pic) next.glow = pic; latest.current = next; sendFeatures({ upsertLights: [next] }, `Light shape: ${glowLabel(pic)}`); setPicking(false); }} /></div>}
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
      <label className="check eye"><input type="checkbox" checked={ui.showGrid} onChange={(e) => onUi({ showGrid: e.target.checked })} /> The grid (G)</label>
      <label className="check eye"><input type="checkbox" checked={ui.showLights} onChange={(e) => onUi({ showLights: e.target.checked })} /> Light glows (and the light level)</label>
      <label className="check eye"><input type="checkbox" checked={ui.showNotes} onChange={(e) => onUi({ showNotes: e.target.checked })} data-testid="show-notes" /> Room numbers</label>
      <label className="field">Roofs
        <select value={ui.roofView} onChange={(e) => onUi({ roofView: e.target.value as BattleUi["roofView"] })} data-testid="roof-view">
          <option value="faint">Faint (see the rooms through them)</option><option value="solid">Solid (as the players see them)</option><option value="off">Hidden</option>
        </select>
      </label>
      {meta.origin && (
        <>
          <h3>Where it's from</h3>
          <p className="muted" data-testid="battle-origin">Made from <b>{meta.origin.name}</b> {meta.origin.unit === "m" ? <>around ({meta.origin.x}, {meta.origin.y}) m</> : <>at map px ({meta.origin.x}, {meta.origin.y})</>}.</p>
          <div className="row"><button onClick={() => store.send({ t: "open_project", id: meta.origin!.id })} title={meta.origin.unit === "m" ? "Open the settlement map this scene came from" : "Open the world map this scene came from"}>↑ Back to {meta.origin.name}</button></div>
        </>
      )}
      <h3>This map</h3>
      <p className="muted" data-testid="battle-summary">
        {spec.squaresX} × {spec.squaresY} squares at {spec.feetPerSquare} ft = {spec.squaresX * spec.feetPerSquare} × {spec.squaresY * spec.feetPerSquare} ft.
        Image {spec.squaresX * spec.pxPerSquare} × {spec.squaresY * spec.pxPerSquare} px ({spec.pxPerSquare} px per square).
        {" "}{count("wall")} wall piece{count("wall") === 1 ? "" : "s"}, {count("door") + count("secret")} door{count("door") + count("secret") === 1 ? "" : "s"}, {count("window")} window{count("window") === 1 ? "" : "s"}, {(features.lights ?? []).length} light{(features.lights ?? []).length === 1 ? "" : "s"}, {(features.props ?? []).length} object{(features.props ?? []).length === 1 ? "" : "s"}{(features.roofs ?? []).length ? `, ${(features.roofs ?? []).length} roof${(features.roofs ?? []).length === 1 ? "" : "s"}` : ""}{(features.connectors ?? []).length ? `, ${(features.connectors ?? []).length} stair${(features.connectors ?? []).length === 1 ? "" : "s"}, ladder${(features.connectors ?? []).length === 1 ? "" : "s"} or hole${(features.connectors ?? []).length === 1 ? "" : "s"}` : ""}.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- export
export function BattleExportDialog({ meta, levels, onClose }: { meta: MapMeta; levels?: LevelsFile | null; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  /** Which level the picture and the Universal VTT file are of (a map with several levels). */
  const [levelId, setLevelId] = useState(levels?.active ?? "");
  const many = (levels?.levels.length ?? 0) > 1;
  const [error, setError] = useState<string | null>(null);
  /** Printing at table scale (core printPlan.ts): the paper, the grid and the ink-saving look; remembered while the dialog is open. */
  const [paper, setPaper] = useState<PaperId>(() => { try { return localStorage.getItem("dd.printPaper") === "a4" ? "a4" : "letter"; } catch { return "letter"; } });
  const [printGrid, setPrintGrid] = useState(true);
  const [ink, setInk] = useState(false);
  const plan = meta.battle ? planPrint(meta.battle.squaresX, meta.battle.squaresY, { paper }) : null;
  const files = [
    { fmt: "uvtt", name: `${meta.id}.dd2vtt`, title: "Universal VTT (.dd2vtt)", text: "One file with the image, walls, doors and lights (of the level you are working on). Use it in virtual tabletops that read Universal VTT files, or with the Universal Battlemap Importer module in Foundry. The format has no see-through wall, so windows and invisible walls are written as plain walls. In Foundry, the Foundry scene below is better: it keeps them (and your levels)." },
    { fmt: "foundry", name: `${meta.id}-foundry.zip`, title: "Foundry scene (.zip)", text: "A picture for each level plus a scene file for Foundry's Import Data, with the grid, levels, walls, doors, windows (see-through, but nothing walks through) and lights. A README inside says where things go." },
    { fmt: "key", name: `${meta.id}-key.md`, title: "Key (.md)", text: "Your numbered room notes as a list (Markdown), for the DM. Notes are never part of the picture." },
    { fmt: "png", name: `${meta.id}.png`, title: "Image only (.png)", text: "The picture of the level you are working on, with walls and doors drawn in. No lights (the tabletop does its own lighting)." },
  ] as const;
  const go = async (f: { fmt: string; name: string }) => {
    setError(null);
    setBusy(f.fmt);
    try {
      const params = new URLSearchParams();
      if (many && (f.fmt === "png" || f.fmt === "uvtt" || f.fmt === "print")) params.set("level", levelId);
      if (f.fmt === "print") { params.set("paper", paper); if (printGrid) params.set("grid", "1"); if (ink) params.set("ink", "1"); try { localStorage.setItem("dd.printPaper", paper); } catch { /* fine */ } }
      const q = params.size ? `?${params}` : "";
      const r = await fetch(`/api/projects/${encodeURIComponent(meta.id)}/export/${f.fmt}${q}`);
      if (!r.ok) throw new Error((await r.text()) || `The export failed (${r.status}).`);
      // (the server names the file, with the level's name when there are several)
      const named = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1];
      downloadBlob(await r.blob(), named ?? f.name);
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
        {many && levels && (
          <label className="field" data-testid="export-level">Level for the picture and the Universal VTT file
            <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
              {levelsByHeight(levels.levels).reverse().map((l) => <option key={l.id} value={l.id}>{l.name}{l.id === levels.active ? " (the one you are working on)" : ""}</option>)}
            </select>
          </label>
        )}
        {files.map((f) => (
          <div key={f.fmt} className="export-choice">
            <div><b>{f.title}</b><p className="muted">{f.text}</p></div>
            <button className="primary" disabled={!!busy} onClick={() => void go(f)} data-testid={`battle-export-${f.fmt}`}>{busy === f.fmt ? "Preparing…" : "Download"}</button>
          </div>
        ))}
        <div className="export-choice" data-testid="battle-print">
          <div>
            <b>Print at table scale (.pdf)</b>
            <p className="muted">One inch a square, across sheets of paper you trim and tape together, for miniatures on the table. An assembly page comes first; each page has corner marks to trim along and says which pages join it. Print it at actual size (100%), not fitted to the page.</p>
            <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
              <label className="field">Paper
                <select value={paper} onChange={(e) => setPaper(e.target.value as PaperId)} data-testid="print-paper">
                  <option value="letter">US Letter</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={printGrid} onChange={(e) => setPrintGrid(e.target.checked)} data-testid="print-grid" /> Grid</label>
              <label className="check" title="The picture greyed and lightened, the walls drawn again dark: far less ink"><input type="checkbox" checked={ink} onChange={(e) => setInk(e.target.checked)} data-testid="print-ink" /> Save ink</label>
            </div>
            {plan && <p className="muted" data-testid="print-pages">{plan.tiles.length > MAX_PRINT_PAGES ? `Too big to print this way (${plan.tiles.length} pages): export the picture and have a print shop print it at ${meta.battle!.squaresX} × ${meta.battle!.squaresY} inches.` : `${describePlan(plan)}.`}</p>}
          </div>
          <button className="primary" disabled={!!busy || !plan || plan.tiles.length > MAX_PRINT_PAGES} onClick={() => void go({ fmt: "print", name: `${meta.id}-print.pdf` })} data-testid="battle-export-print">{busy === "print" ? "Preparing…" : "Download"}</button>
        </div>
        <p className="muted">The Foundry scene has been tried in Foundry v14 (levels, walls, doors, windows, lights and stairs came through); the Universal VTT file with the Universal Battlemap Importer (walls, doors and lights came through). Neither has been tried in a live player view. If one doesn't import cleanly, tell me what it said.</p>
        {error && <p className="error-text" data-testid="battle-export-error">{error}</p>}
        <div className="row end"><button className="ghost" onClick={onClose} disabled={!!busy}>Close</button></div>
      </div>
    </div>
  );
}
