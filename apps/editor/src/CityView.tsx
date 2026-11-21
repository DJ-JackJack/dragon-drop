/**
 * The city map: the ground, streets, trees and buildings drawn as vectors on a canvas (the same colours as the server's pictures: `buildingColour`, `cityGroundColours`, `treeColour`),
 * and the tools to build them. Everything is in metres from the map's top-left corner. The ground is the map's own grid of material cells in the climate's colours, shaded by the
 * land, drawn as a small picture that is scaled up smoothly; the contour lines go over it. Every change is one undoable edit sent to the server when the mouse is let go.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ARROW_DIRECTION, BRIDGE_COLOURS, CITY_LABEL_KINDS, MATERIALS, cityBattleBoxAt, cityBattleSquares, type CityClip, cityClipBounds, copyCity, pasteCity, STREET_EDGE, STREET_SURFACE, WALL_COLOURS, WALL_KINDS, type BridgeSpan, type CityClimate, type Features, type MapBuilding, type MapCityWall, type MapLandform, type MapMeta, type MapStreet, type MapTrees,
  type WallPieces, cleanCityWall, cleanDistrict, districtColour, distToWall, hexToRgb, portcullisBars, wallPieces,
  type Rect, type TreeCrown, type ViewKeyAction, applyViewKey, buildingColour, cityClimate, cityGroundColours, cleanLandform, cleanTrees, contourLines, distToPolyline, distToSegment,
  landAt, landGrid, landShade, newFeatureId, streetBridges, opaqueRowCount, pointInPolygon, pointsBounds, polygonCentroid, rectPolygon, roofTurn, snowCover, streetWidthFor, treeColour, treeCrowns,
  viewKeyAction,
} from "@mapmaker/core";
import { type CityUi, DEFAULT_HOUSE, landName, removeSelected, selectedOf, sendCityFeatures } from "./cityUi.ts";
import { assetUrl } from "./assetsApi.ts";
import { loadRoofPools, roofAssetsStore, roofChoiceFor } from "./roofAssetsClient.ts";
import { noShiftTextSelect } from "./noShiftSelect.ts";
import { store } from "./store.ts";
import { makeResizeKeeper } from "./viewResize.ts";
import { traceCtl } from "./trace.ts";
import { TraceBar } from "./TraceBar.tsx";
import { readerCtl } from "./reader.ts";
import { drawCityNames } from "./drawCityNames.ts";
import { type Hit, hitTest, loadLabelFonts } from "./drawFeatures.ts";
import { ask, notice } from "./dialogs.tsx";
import { CityExportDialog } from "./cityExport.tsx";
import { armItemsPaste, getClip, itemsCopied, setClip, unstack } from "./clipboard.ts";

type Pt = [number, number];
interface View { scale: number; ox: number; oy: number } // scale: screen px per metre
const MIN_ZOOM = 0.02, MAX_ZOOM = 40;
const GOLD = "rgba(255, 224, 120, 0.95)";

interface Props { meta: MapMeta | null; features: Features; ui: CityUi; onUi: (p: Partial<CityUi>) => void }

/** Somewhere else to draw the city: a tile of a picture export, at its own scale, with only the map on it (no selection, tools, trace picture or scale bar). */
export interface CityPaintTarget { ctx: CanvasRenderingContext2D; v: View; W: number; H: number; names: boolean; contours: boolean }

type Drag = {
  mode: "pan" | "trace" | "move" | "marquee" | "rect" | "brush" | "hill" | "slope" | "reader" | "battlebox";
  sx: number; sy: number; ox: number; oy: number;
  /** Where it started, in metres. */
  ax: number; ay: number;
  lastX: number; lastY: number;
  add?: boolean; base?: string[];
};

const isTyping = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable); };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Where a building's ridge runs: through its middle, the longer way (found from its longest side). */
function ridgeOf(pts: Pt[]): [number, number, number, number] {
  let best = 0, ux = 1, uy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], l = Math.hypot(x1 - x0, y1 - y0);
    if (l > best) { best = l; ux = (x1 - x0) / l; uy = (y1 - y0) / l; }
  }
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, y] of pts) { const a = x * ux + y * uy, b = -x * uy + y * ux; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
  const along = a1 - a0 >= b1 - b0, mid = [(a0 + a1) / 2, (b0 + b1) / 2];
  const dir: Pt = along ? [ux, uy] : [-uy, ux], half = (along ? a1 - a0 : b1 - b0) / 2 * 0.86;
  const cx = mid[0] * ux - mid[1] * uy, cy = mid[0] * uy + mid[1] * ux;
  return [cx - dir[0] * half, cy - dir[1] * half, cx + dir[0] * half, cy + dir[1] * half];
}

/** The slopes of a pitched roof: its middle, the direction across the ridge pointing toward the light (the top left), and how far the roof reaches that way. */
function slopeOf(pts: Pt[], ridge: [number, number, number, number]): [number, number, number, number, number] {
  const rx = ridge[2] - ridge[0], ry = ridge[3] - ridge[1], l = Math.hypot(rx, ry) || 1;
  let nx = -ry / l, ny = rx / l;
  if (nx + ny > 0) { nx = -nx; ny = -ny; }
  const cx = (ridge[0] + ridge[2]) / 2, cy = (ridge[1] + ridge[3]) / 2;
  let hw = 0;
  for (const [x, y] of pts) hw = Math.max(hw, Math.abs((x - cx) * nx + (y - cy) * ny));
  return [cx, cy, nx, ny, hw];
}

export function CityView({ meta, features, ui, onUi }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<ImageData | null>(null);
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  // when the canvas changes size (a panel shown or hidden): a fitted view is fitted again, any other keeps its middle (viewResize.ts)
  const keeper = useRef(makeResizeKeeper(() => viewRef.current, (v) => { viewRef.current = v; }, () => fit())).current;
  const fittedFor = useRef<string | null>(null);
  const drawQueued = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  /** Corners of a building outline or a street being clicked out, in metres. */
  const outline = useRef<Pt[] | null>(null);
  const streetDraft = useRef<Pt[] | null>(null);
  /** Points of a ridge, valley, plateau or hollow (the Land tool), or of a row or an area of trees (the Trees tool), being clicked out. */
  const landDraft = useRef<Pt[] | null>(null);
  const treeDraft = useRef<Pt[] | null>(null);
  /** Corners of a district being clicked out (the District tool). */
  const districtDraft = useRef<Pt[] | null>(null);
  /** Points of a city wall being clicked out (the Wall tool). */
  const wallDraft = useRef<Pt[] | null>(null);
  /** Each wall's towers and gates, worked out once for the wall and the streets as they are. */
  const wallCache = useRef(new WeakMap<MapCityWall, { streets: readonly MapStreet[]; ground: number; pieces: WallPieces }>());
  /** Where the labels were drawn last (screen boxes), to click them. */
  const labelHits = useRef<Hit[]>([]);
  /** Each street's bridges, worked out once for what the street is and the ground as it is (`groundVer` counts the ground's changes). */
  const groundVer = useRef(0);
  const bridgeCache = useRef(new Map<string, BridgeSpan[]>());
  /** Each group of trees' crowns and their colours, worked out once per group and climate (features arrive as new objects with every change, so this is keyed by what the group is). */
  const crowns = useRef(new Map<string, { list: TreeCrown[]; fills: string[]; x0: number; y0: number; x1: number; y1: number }>());
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null);
  /** Things being dragged or nudged: which, and how far (metres) from where they were. */
  const moving = useRef<{ ids: string[]; dx: number; dy: number } | null>(null);
  const nudgeTimer = useRef<number | undefined>(undefined);
  const metaRef = useRef(meta); metaRef.current = meta;
  const featRef = useRef(features); featRef.current = features;
  const uiRef = useRef(ui); uiRef.current = ui;
  const onUiRef = useRef(onUi); onUiRef.current = onUi;
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false); spaceRef.current = spaceDown;
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; ground: string; land: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** Per building: its box, colour and ridge, worked out once (a building's points never change in place: an edit makes a new object). */
  const cache = useRef(new WeakMap<object, { x0: number; y0: number; x1: number; y1: number; fill: string; ridge: [number, number, number, number]; slope: [number, number, number, number, number]; turn: number }>());
  /** Roof pictures of the asset packs, loaded as they are first drawn: the picture, its average colour (for when it is too small to see) and a tiling pattern. */
  const roofImgs = useRef(new Map<string, { w: number; h: number; avg: string; pattern: CanvasPattern } | "loading" | "failed">());

  const requestDraw = useCallback(() => {
    if (drawQueued.current) return;
    drawQueued.current = true;
    requestAnimationFrame(() => { drawQueued.current = false; draw(); });
  }, []);

  // the trace picture redraws this view when it loads, while it is dragged and when its settings change
  useEffect(() => {
    traceCtl.redraw = requestDraw;
    const off = traceCtl.subscribe(requestDraw);
    return () => { off(); if (traceCtl.redraw === requestDraw) traceCtl.redraw = () => {}; };
  }, [requestDraw]);
  const traceMode = useSyncExternalStore(traceCtl.subscribe, () => traceCtl.state.mode);
  // the picture reader's marks redraw the view as they change
  const reading = useSyncExternalStore(readerCtl.subscribe, () => readerCtl.state.on);
  useEffect(() => readerCtl.subscribe(requestDraw), [requestDraw]);

  const infoOf = (b: MapBuilding) => {
    let c = cache.current.get(b);
    if (!c) {
      const bb = pointsBounds(b.points as Pt[]), [r, g, bl] = buildingColour(b);
      const ridge = ridgeOf(b.points as Pt[]);
      c = { ...bb, fill: `rgb(${r},${g},${bl})`, ridge, slope: slopeOf(b.points as Pt[], ridge), turn: roofTurn(b.points as Pt[]) };
      cache.current.set(b, c);
    }
    return c;
  };

  /** A roof picture of the packs, once it has loaded (null while it loads or if it can't be had: the building is then drawn from its look; the view is redrawn when it arrives). */
  const roofPicture = (asset: string) => {
    const hit = roofImgs.current.get(asset);
    if (hit && hit !== "loading" && hit !== "failed") return hit;
    if (!hit) {
      roofImgs.current.set(asset, "loading");
      const img = new Image();
      img.onload = () => {
        try {
          // the packs' roof pictures often end in a see-through strip, which would show as a dark seam every repeat: cut it off (as the server does, so both draw the same roof)
          const iw = img.naturalWidth, ih = img.naturalHeight;
          const probe = document.createElement("canvas");
          probe.width = iw; probe.height = ih;
          const pc = probe.getContext("2d", { willReadFrequently: true })!;
          pc.drawImage(img, 0, 0);
          const rows = opaqueRowCount(pc.getImageData(0, 0, iw, ih).data, iw, ih);
          let source: CanvasImageSource = img, w = iw, h = ih;
          if (rows < ih) {
            const sq = document.createElement("canvas");
            sq.width = sq.height = w = h = 512;
            sq.getContext("2d")!.drawImage(img, 0, 0, iw, rows, 0, 0, 512, 512);
            source = sq;
          }
          const c = document.createElement("canvas");
          c.width = c.height = 4;
          const cx = c.getContext("2d")!;
          cx.drawImage(source, 0, 0, 4, 4);
          const d = cx.getImageData(0, 0, 4, 4).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < 64; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
          const pattern = canvasRef.current!.getContext("2d")!.createPattern(source, "repeat")!;
          roofImgs.current.set(asset, { w, h, avg: `rgb(${Math.round(r / 16)},${Math.round(g / 16)},${Math.round(b / 16)})`, pattern });
        } catch { roofImgs.current.set(asset, "failed"); }
        requestDraw();
      };
      img.onerror = () => roofImgs.current.set(asset, "failed");
      img.src = assetUrl(asset, 512);
    }
    return null;
  };

  // ------------------------------------------------------------ the ground
  const paintGround = useCallback((r: Rect | null) => {
    const m = metaRef.current, hf = store.heights;
    if (!m?.city || !hf) return;
    const W = hf.w, H = hf.h;
    let off = offRef.current;
    if (!off || off.width !== W || off.height !== H) {
      off = document.createElement("canvas");
      off.width = W; off.height = H;
      offRef.current = off;
      imgRef.current = new ImageData(W, H);
      r = null;
    }
    const x0 = r ? Math.max(0, r.x - 1) : 0, y0 = r ? Math.max(0, r.y - 1) : 0;
    const x1 = r ? Math.min(W, r.x + r.w + 1) : W, y1 = r ? Math.min(H, r.y + r.h + 1) : H;
    groundVer.current++; bridgeCache.current.clear(); // (the water may have moved: the bridges are worked out again)
    if (x1 > x0 && y1 > y0) {
      const d = imgRef.current!.data;
      // the ground's colours in the city's climate, shaded by the land (light from the top left)
      const cols = cityGroundColours(cityClimate(m.city)), land = landGrid({ meta: m, features: featRef.current });
      const shade = land && land.w === W && land.h === H ? landShade(land) : null;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const c = cols[Math.round(hf.data[y * W + x])] ?? cols[5] ?? MATERIALS[5].colour;
          const k = (0.96 + 0.08 * (((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 256) / 255) * (shade ? shade[y * W + x] : 1); // (a little mottling)
          const o = (y * W + x) * 4;
          d[o] = c[0] * k; d[o + 1] = c[1] * k; d[o + 2] = c[2] * k; d[o + 3] = 255;
        }
      }
      off.getContext("2d")!.putImageData(imgRef.current!, 0, 0, x0, y0, x1 - x0, y1 - y0);
    }
    if (fittedFor.current !== m.id) fit();
    setLoadedId(m.id);
    requestDraw();
  }, [requestDraw]);

  /** Before a picture export: every roof picture the buildings use loaded (or given up on after a while), and the fonts. */
  async function prepareExport() {
    const assets = new Set((featRef.current.buildings ?? []).flatMap((b) => (b.asset ? [b.asset] : [])));
    for (const a of assets) roofPicture(a);
    const t0 = performance.now();
    while ([...assets].some((a) => roofImgs.current.get(a) === "loading") && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
    await loadLabelFonts();
  }

  // ------------------------------------------------------------ view
  function fit() {
    const wrap = wrapRef.current, m = metaRef.current;
    if (!wrap || !m?.city) return;
    const W = wrap.clientWidth, H = wrap.clientHeight, { widthM, heightM } = m.city;
    const scale = Math.min(W / widthM, H / heightM) * 0.95;
    viewRef.current = { scale, ox: (W - widthM * scale) / 2, oy: (H - heightM * scale) / 2 };
    fittedFor.current = m.id;
    keeper.fitted();
  }
  function keyView(a: ViewKeyAction) {
    if (a.kind === "fit") { fittedFor.current = null; fit(); }
    else {
      const wrap = wrapRef.current;
      if (!wrap) return;
      viewRef.current = applyViewKey(viewRef.current, a, { w: wrap.clientWidth, h: wrap.clientHeight }, { min: MIN_ZOOM, max: MAX_ZOOM });
    }
    requestDraw();
  }
  const toM = (sx: number, sy: number): { x: number; y: number } => { const v = viewRef.current; return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale }; };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ------------------------------------------------------------ drawing
  /** Draw the city on the screen, or (with a target) into a tile of a picture export. */
  function draw(target?: CityPaintTarget) {
    const cv = canvasRef.current, wrap = wrapRef.current, m = metaRef.current;
    let ctx: CanvasRenderingContext2D, W: number, H: number, v: View;
    if (target) ({ ctx, W, H, v } = target);
    else {
      if (!cv || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      W = wrap.clientWidth; H = wrap.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      v = viewRef.current;
    }
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(0, 0, W, H);
    const off = offRef.current;
    if (!off || !m?.city) return;
    const spec = m.city, o = uiRef.current, f = featRef.current, screen = !target;
    const MW = spec.widthM * v.scale, MH = spec.heightM * v.scale;
    // the ground (the cells may run a little past the city's edge: clipped to it)
    ctx.save();
    ctx.beginPath(); ctx.rect(v.ox, v.oy, MW, MH); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, v.ox, v.oy, off.width * spec.cellM * v.scale, off.height * spec.cellM * v.scale);
    ctx.restore();
    if (screen) { ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.strokeRect(v.ox - 0.5, v.oy - 0.5, MW + 1, MH + 1); }
    if (target ? target.contours : o.contours) drawContours(ctx, v, W, H);
    if (screen) traceCtl.draw(ctx, f.trace, m.id, v); // (over the ground, under the streets and buildings: you see through to what you are redrawing)

    const mv = screen ? moving.current : null, mvSet = mv ? new Set(mv.ids) : null;
    const dx = (id: string) => (mvSet?.has(id) ? mv!.dx : 0), dy = (id: string) => (mvSet?.has(id) ? mv!.dy : 0);
    const vx0 = -v.ox / v.scale - 5, vy0 = -v.oy / v.scale - 5, vx1 = (W - v.ox) / v.scale + 5, vy1 = (H - v.oy) / v.scale + 5;
    const sel = new Set(screen ? o.selected : []);
    const px = (x: number) => v.ox + x * v.scale, py = (y: number) => v.oy + y * v.scale;

    // districts: a faint tint of their colour over the ground
    const districtPath = (pts: readonly (readonly number[])[], ox: number, oy: number) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + ox), py(y + oy)) : ctx.moveTo(px(x + ox), py(y + oy)))); ctx.closePath(); };
    for (const dst of f.districts ?? []) { const [r, g, bl] = hexToRgb(districtColour(dst)); districtPath(dst.points, dx(dst.id), dy(dst.id)); ctx.fillStyle = `rgba(${r},${g},${bl},0.14)`; ctx.fill(); }

    // streets: every edge first, then every surface, so crossings are one piece
    const streets = (f.streets ?? []).filter((s) => { const b = pointsBounds(s.points as Pt[]), w = s.width; return b.x1 + w >= vx0 - dx(s.id) && b.x0 - w <= vx1 - dx(s.id) && b.y1 + w >= vy0 - dy(s.id) && b.y0 - w <= vy1 - dy(s.id); });
    const stroke = (s: MapStreet, width: number, style: string) => {
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + dx(s.id)), py(y + dy(s.id))) : ctx.moveTo(px(x + dx(s.id)), py(y + dy(s.id)))));
      ctx.lineWidth = Math.max(1, width * v.scale); ctx.strokeStyle = style; ctx.stroke();
    };
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const edge = Math.max(1, 0.4 * v.scale) * 2;
    for (const s of streets) stroke(s, s.width + edge / v.scale, `rgba(${STREET_EDGE.join(",")},0.85)`);
    for (const s of streets) stroke(s, s.width, `rgb(${STREET_SURFACE.join(",")})`);
    // bridges where the streets cross water
    drawBridges(ctx, v, streets.flatMap((s) => bridgesOf(dx(s.id) || dy(s.id) ? { ...s, points: s.points.map(([x, y]) => [x + dx(s.id), y + dy(s.id)] as Pt) } : s, spec.cellM)));

    // trees, under the buildings (a garden's trees stand beside the house, not on its roof)
    const climate = cityClimate(spec);
    drawTrees(ctx, v, f.trees ?? [], climate, dx, dy, vx0, vy0, vx1, vy1);

    // buildings: a soft shadow, the roof in its own colour with a ridge, and a dark outline
    const detail = v.scale >= 1.4, shadow = Math.min(4, 0.45 * v.scale);
    const path = (pts: [number, number][], ddx: number, ddy: number, sx = 0, sy = 0) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + ddx) + sx, py(y + ddy) + sy) : ctx.moveTo(px(x + ddx) + sx, py(y + ddy) + sy))); ctx.closePath(); };
    const bs: MapBuilding[] = [];
    for (const b of f.buildings ?? []) { const c = infoOf(b), ox = dx(b.id), oy = dy(b.id); if (c.x1 + ox >= vx0 && c.x0 + ox <= vx1 && c.y1 + oy >= vy0 && c.y0 + oy <= vy1) bs.push(b); }
    if (detail) { ctx.fillStyle = "rgba(0,0,0,0.26)"; for (const b of bs) { path(b.points, dx(b.id), dy(b.id), shadow, shadow); ctx.fill(); } }
    ctx.lineWidth = 1; ctx.lineJoin = "miter";
    for (const b of bs) {
      path(b.points, dx(b.id), dy(b.id));
      // a roof picture of the packs, tiled across the roof turned to its ridge (as the server draws it), or its average colour when too small to see; else the look
      const info = infoOf(b), pic = b.asset ? roofPicture(b.asset) : null;
      if (pic && v.scale >= 0.9) {
        const k = (b.tile ?? 6) * v.scale;
        pic.pattern.setTransform(new DOMMatrix().translate(px(0), py(0)).rotate((info.turn * 180) / Math.PI).scale(k / pic.w, k / pic.h));
        ctx.fillStyle = pic.pattern;
      } else ctx.fillStyle = pic ? pic.avg : info.fill;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.stroke();
    }
    // snow lying on the roofs in a cold climate
    const snow = snowCover(climate);
    if (snow > 0) { ctx.fillStyle = `rgba(236,241,247,${(snow * 0.55).toFixed(3)})`; for (const b of bs) { path(b.points, dx(b.id), dy(b.id)); ctx.fill(); } }
    if (v.scale >= 2.5) {
      // the slope that faces the light is brighter, the other darker (light comes from the top left)
      for (const b of bs) {
        if (b.flat) continue;
        const c = infoOf(b), [cx, cy, nx, ny, hw] = c.slope, ox = dx(b.id), oy = dy(b.id);
        ctx.save(); path(b.points, ox, oy); ctx.clip();
        const g = ctx.createLinearGradient(px(cx + ox + nx * hw), py(cy + oy + ny * hw), px(cx + ox - nx * hw), py(cy + oy - ny * hw));
        g.addColorStop(0, "rgba(255,255,255,0.2)"); g.addColorStop(0.47, "rgba(255,255,255,0.03)"); g.addColorStop(0.53, "rgba(0,0,0,0.04)"); g.addColorStop(1, "rgba(0,0,0,0.22)");
        ctx.fillStyle = g; ctx.fillRect(px(c.x0 + ox) - 1, py(c.y0 + oy) - 1, (c.x1 - c.x0) * v.scale + 2, (c.y1 - c.y0) * v.scale + 2);
        ctx.restore();
      }
    }
    if (detail) {
      ctx.lineWidth = 1;
      for (const b of bs) {
        if (b.flat) continue;
        const [x0, y0, x1, y1] = infoOf(b).ridge, ox = dx(b.id), oy = dy(b.id);
        ctx.beginPath(); ctx.moveTo(px(x0 + ox), py(y0 + oy)); ctx.lineTo(px(x1 + ox), py(y1 + oy)); ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px(x0 + ox) + 1, py(y0 + oy) + 1); ctx.lineTo(px(x1 + ox) + 1, py(y1 + oy) + 1); ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
      }
    }

    // the city walls, over the roofs (their towers stand above the houses built against them)
    drawWalls(ctx, v, (f.cityWalls ?? []).map((w) => {
      const ox = dx(w.id), oy = dy(w.id), streetsMoved = (f.streets ?? []).some((s) => dx(s.id) || dy(s.id));
      if (!ox && !oy && !streetsMoved) return piecesOf(w, f.streets ?? []);
      return wallPieces(ox || oy ? { ...w, points: w.points.map(([x, y]) => [x + ox, y + oy] as Pt) } : w, streetsMoved ? (f.streets ?? []).map((s) => (dx(s.id) || dy(s.id) ? { ...s, points: s.points.map(([x, y]) => [x + dx(s.id), y + dy(s.id)] as Pt) } : s)) : f.streets ?? [], wallGround());
    }), vx0, vy0, vx1, vy1);

    // districts' borders, dashed in their colour, over everything but the names
    ctx.save(); ctx.setLineDash([10, 6]); ctx.lineWidth = 2; ctx.lineJoin = "round";
    for (const dst of f.districts ?? []) { const [r, g, bl] = hexToRgb(districtColour(dst)); districtPath(dst.points, dx(dst.id), dy(dst.id)); ctx.strokeStyle = `rgba(${Math.round(r * 0.7)},${Math.round(g * 0.7)},${Math.round(bl * 0.7)},0.85)`; ctx.stroke(); }
    ctx.restore();

    // the names: streets' along them, buildings' over them, then the labels (districts, water, landmarks)
    const moved = mv && ([...(f.labels ?? []), ...(f.districts ?? [])]).some((l) => mvSet!.has(l.id))
      ? { ...f, labels: f.labels.map((l) => (mvSet!.has(l.id) ? { ...l, x: l.x + mv.dx, y: l.y + mv.dy } : l)), districts: (f.districts ?? []).map((d) => (mvSet!.has(d.id) ? { ...d, points: d.points.map(([x, y]) => [x + mv.dx, y + mv.dy] as Pt) } : d)) } : f;
    if (!screen) {
      // (a picture is sized as if it were the whole city fitted on the screen: names keep the size they have on the map as a whole)
      if (target!.names) drawCityNames(ctx, f, { scale: v.scale, ox: v.ox, oy: v.oy, widthM: spec.widthM, W, H }, null);
      return;
    }
    labelHits.current = o.names ? drawCityNames(ctx, moved, { scale: v.scale, ox: v.ox, oy: v.oy, widthM: spec.widthM, fitScale: Math.min(W / spec.widthM, H / spec.heightM) * 0.95, W, H }, sel) : [];

    // what is selected
    ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = GOLD; ctx.lineJoin = "round";
    for (const b of f.buildings ?? []) if (sel.has(b.id)) { path(b.points, dx(b.id), dy(b.id)); ctx.stroke(); }
    for (const s of f.streets ?? []) if (sel.has(s.id)) {
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + dx(s.id)), py(y + dy(s.id))) : ctx.moveTo(px(x + dx(s.id)), py(y + dy(s.id)))));
      ctx.stroke();
    }
    for (const dst of f.districts ?? []) if (sel.has(dst.id)) { districtPath(dst.points, dx(dst.id), dy(dst.id)); ctx.stroke(); }
    for (const w of f.cityWalls ?? []) if (sel.has(w.id)) {
      ctx.beginPath();
      w.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + dx(w.id)), py(y + dy(w.id))) : ctx.moveTo(px(x + dx(w.id)), py(y + dy(w.id)))));
      if (w.closed) ctx.closePath();
      ctx.stroke();
    }
    for (const t of f.trees ?? []) if (sel.has(t.id)) {
      const ox = dx(t.id), oy = dy(t.id), pts = t.points;
      ctx.beginPath();
      if (t.kind === "tree") ctx.arc(px(pts[0][0] + ox), py(pts[0][1] + oy), Math.max(5, ((t.size ?? 8) / 2) * v.scale + 3), 0, Math.PI * 2);
      else { pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + ox), py(y + oy)) : ctx.moveTo(px(x + ox), py(y + oy)))); if (t.kind !== "row") ctx.closePath(); }
      ctx.stroke();
    }
    ctx.restore();
    // the landforms: shown while the Land tool is in use, and the selected one always
    if (o.tool === "hills" || (f.land ?? []).some((l) => sel.has(l.id))) drawLand(ctx, v, (f.land ?? []).filter((l) => o.tool === "hills" || sel.has(l.id)), sel, dx, dy);

    drawTools(ctx, v, o, W, H);
    if (readerCtl.state.on) drawReader(ctx, v);
    // the scale bar
    const bar = niceLength(90 / v.scale);
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(W - 24 - bar * v.scale - 8, H - 62, bar * v.scale + 16, 22);
    ctx.fillStyle = "#fff"; ctx.fillRect(W - 24 - bar * v.scale, H - 49, bar * v.scale, 2);
    ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, W - 24 - (bar * v.scale) / 2, H - 53); ctx.restore();
  }

  /** Contour lines: every interval faintly (once they are far enough apart to read), every fifth a little stronger; only those in view. */
  function drawContours(ctx: CanvasRenderingContext2D, v: View, W: number, H: number) {
    const m = metaRef.current, g = m ? landGrid({ meta: m, features: featRef.current }) : null;
    if (!g) return;
    const c = contourLines(g), vx0 = -v.ox / v.scale, vy0 = -v.oy / v.scale, vx1 = (W - v.ox) / v.scale, vy1 = (H - v.oy) / v.scale;
    const stroke = (segs: Float32Array, style: string, width: number) => {
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
        if (Math.max(ax, bx) < vx0 || Math.min(ax, bx) > vx1 || Math.max(ay, by) < vy0 || Math.min(ay, by) > vy1) continue;
        ctx.moveTo(v.ox + ax * v.scale, v.oy + ay * v.scale); ctx.lineTo(v.ox + bx * v.scale, v.oy + by * v.scale);
      }
      ctx.lineWidth = width; ctx.strokeStyle = style; ctx.stroke();
    };
    ctx.save(); ctx.lineCap = "round";
    if (c.interval * v.scale >= 4) stroke(c.minor, "rgba(72,54,32,0.32)", 1);
    stroke(c.major, "rgba(72,54,32,0.55)", 1.4);
    ctx.restore();
  }

  /** A street's bridges (cached until the street or the ground changes). */
  function bridgesOf(s: MapStreet, cellM: number): BridgeSpan[] {
    const hf = store.heights;
    if (!hf) return [];
    const key = `${s.id}|${s.width}|${s.kind ?? ""}|${s.bridge ?? ""}|${s.points.join(";")}`;
    let hit = bridgeCache.current.get(key);
    if (!hit) { hit = streetBridges(s, hf, cellM); if (bridgeCache.current.size > 4000) bridgeCache.current.clear(); bridgeCache.current.set(key, hit); }
    return hit;
  }

  /** Bridges, as the pictures draw them: a shadow on the water, stone piers or wooden posts, the deck between walls or railings (square at each end); a ford is the street under shallow water. */
  function drawBridges(ctx: CanvasRenderingContext2D, v: View, spans: BridgeSpan[]) {
    if (!spans.length) return;
    const X = (x: number) => v.ox + x * v.scale, Y = (y: number) => v.oy + y * v.scale, C = BRIDGE_COLOURS, rgb = (c: readonly number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const line = (pts: readonly (readonly number[])[], ox = 0, oy = 0) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x + ox), Y(y + oy)) : ctx.moveTo(X(x + ox), Y(y + oy)))); };
    ctx.save(); ctx.lineCap = "butt"; ctx.lineJoin = "round";
    for (const b of spans) {
      const half = b.width / 2, wall = b.kind === "stone" ? Math.max(0.45, b.width * 0.07) : Math.max(0.3, b.width * 0.05);
      if (b.kind === "ford") { line(b.points); ctx.lineWidth = Math.max(1, b.width * v.scale); ctx.strokeStyle = rgb(C.ford, 0.55); ctx.stroke(); continue; }
      const sh = Math.max(0.8, b.width * 0.15);
      line(b.points, sh, sh); ctx.lineWidth = Math.max(1, (b.width + 2 * wall) * v.scale); ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.stroke();
      for (const p of b.piers) {
        const across = half + wall + 1.8, thick = Math.max(1.3, b.width * 0.16);
        ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(p.angle); ctx.scale(v.scale, v.scale);
        ctx.beginPath(); ctx.moveTo(0, -across - 1); ctx.lineTo(thick / 2, -across); ctx.lineTo(thick / 2, across); ctx.lineTo(0, across + 1); ctx.lineTo(-thick / 2, across); ctx.lineTo(-thick / 2, -across); ctx.closePath();
        ctx.fillStyle = rgb(C.stonePier); ctx.fill(); ctx.restore();
      }
      line(b.points); ctx.lineWidth = Math.max(1, (b.width + 2 * wall) * v.scale); ctx.strokeStyle = rgb(b.kind === "stone" ? C.stoneWall : C.woodRail); ctx.stroke();
      line(b.points); ctx.lineWidth = Math.max(1, (b.width - 0.8 * wall) * v.scale); ctx.strokeStyle = rgb(b.kind === "stone" ? C.stoneDeck : C.woodDeck); ctx.stroke();
      if (b.kind === "wood" && v.scale >= 2.5) {
        // the planks, across the deck
        ctx.beginPath();
        for (let i = 0; i + 1 < b.points.length; i++) {
          const [ax, ay] = b.points[i], [bx, by] = b.points[i + 1], len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / (len || 1), uy = (by - ay) / (len || 1), w = half - wall * 0.4;
          for (let d = 0.35; d < len; d += 0.7) { const cx = ax + ux * d, cy = ay + uy * d; ctx.moveTo(X(cx - uy * w), Y(cy + ux * w)); ctx.lineTo(X(cx + uy * w), Y(cy - ux * w)); }
        }
        ctx.lineWidth = 1; ctx.strokeStyle = rgb(C.woodPlank, 0.45); ctx.stroke();
      }
      if (b.posts.length) {
        ctx.fillStyle = rgb(C.woodRail);
        const r = Math.max(1, 0.32 * v.scale);
        for (const [x, y] of b.posts) ctx.fillRect(X(x) - r, Y(y) - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  /** A wall's towers and gates (cached until the wall or the streets change). */
  function piecesOf(w: MapCityWall, streets: readonly MapStreet[]): WallPieces {
    const hit = wallCache.current.get(w);
    if (hit && hit.streets === streets && hit.ground === groundVer.current) return hit.pieces;
    const pieces = wallPieces(w, streets, wallGround());
    wallCache.current.set(w, { streets, ground: groundVer.current, pieces });
    return pieces;
  }
  /** The ground, to find where a wall crosses water. */
  function wallGround() {
    const spec = metaRef.current?.city, hf = store.heights;
    return spec && hf ? { ground: hf, cellM: spec.cellM } : null;
  }

  /**
   * City walls, as the pictures draw them: an earth rampart's ditch outside a ring, the shadow, the wall's edge and top (close up, a stone wall's battlements along both
   * sides of its wall-walk, a palisade's logs), then the towers (round with a roof lit from the top left, or square). The gates are the gaps the streets pass through.
   */
  function drawWalls(ctx: CanvasRenderingContext2D, v: View, walls: WallPieces[], vx0: number, vy0: number, vx1: number, vy1: number) {
    if (!walls.length) return;
    const X = (x: number) => v.ox + x * v.scale, Y = (y: number) => v.oy + y * v.scale, C = WALL_COLOURS, rgb = (c: readonly number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const path = (s: { points: Pt[]; closed: boolean }, ox = 0, oy = 0) => { ctx.beginPath(); s.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x) + ox, Y(y) + oy) : ctx.moveTo(X(x) + ox, Y(y) + oy))); if (s.closed) ctx.closePath(); };
    ctx.save(); ctx.lineCap = "butt"; ctx.lineJoin = "round";
    for (const w of walls) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const s of w.stretches) for (const [x, y] of s.points) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
      for (const q of w.towers) { a = Math.min(a, q.x); c = Math.max(c, q.x); b = Math.min(b, q.y); d = Math.max(d, q.y); }
      const pad = w.thickness * 2 + 10;
      if (c + pad < vx0 || a - pad > vx1 || d + pad < vy0 || b - pad > vy1) continue;
      const t = w.thickness, tw = Math.max(1.5, t * v.scale), edge = Math.min(tw * 0.25, Math.max(1, 0.35 * v.scale)), sh = Math.max(1, t * 0.3 * v.scale);
      const top = w.kind === "stone" ? C.stoneTop : w.kind === "palisade" ? C.woodTop : C.earthBank, rim = w.kind === "stone" ? C.stoneEdge : w.kind === "palisade" ? C.woodEdge : C.earthEdge;
      const stroke = (width: number, style: string, ox = 0, oy = 0, dash: number[] = []) => { ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = style; for (const s of w.stretches) { path(s, ox, oy); ctx.stroke(); } ctx.setLineDash([]); };
      // an earth rampart's ditch, outside a ring
      if (w.kind === "earth" && w.ring) {
        ctx.save();
        ctx.beginPath(); ctx.rect(X(a) - pad * v.scale, Y(b) - pad * v.scale, (c - a + 2 * pad) * v.scale, (d - b + 2 * pad) * v.scale);
        w.ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath();
        ctx.clip("evenodd");
        stroke(tw + 2 * t * 0.7 * v.scale, rgb(C.ditch, 0.75));
        ctx.restore();
      }
      stroke(tw, "rgba(0,0,0,0.28)", sh, sh);
      stroke(tw, rgb(rim));
      stroke(Math.max(1, tw - 2 * edge), rgb(top));
      if (w.kind === "stone") {
        if (v.scale >= 2.5) {
          // the battlements: the wall-walk between two rows of merlons (blocks of stone with gaps between), one along each side
          stroke(Math.max(1, tw - 2 * edge), rgb(C.stoneWalk));
          const mw = t * 0.2, off = t / 2 - edge / v.scale - mw;
          ctx.beginPath();
          for (const s of w.stretches) {
            const n = s.points.length, sides = s.closed ? n : n - 1;
            for (let i = 0; i < sides; i++) {
              const [ax, ay] = s.points[i], [bx, by] = s.points[(i + 1) % n], L = Math.hypot(bx - ax, by - ay);
              if (L < 0.5) continue;
              const ux = (bx - ax) / L, uy = (by - ay) / L;
              for (let k = 0.3; k + 0.8 <= L; k += 1.6) for (const side of [off, -off - mw]) {
                // (a block 0.8 m along the wall and mw across, its corners turned with the wall)
                const cx = ax + ux * k - uy * side, cy = ay + uy * k + ux * side;
                ctx.moveTo(X(cx), Y(cy)); ctx.lineTo(X(cx + ux * 0.8), Y(cy + uy * 0.8)); ctx.lineTo(X(cx + ux * 0.8 - uy * mw), Y(cy + uy * 0.8 + ux * mw)); ctx.lineTo(X(cx - uy * mw), Y(cy + ux * mw)); ctx.closePath();
              }
            }
          }
          ctx.fillStyle = rgb(top); ctx.fill();
        } else stroke(Math.max(1, t * 0.4 * v.scale), rgb(C.stoneWalk));
      }
      if (w.kind === "earth") stroke(Math.max(1, t * 0.28 * v.scale), rgb(C.earthCrest));
      if (w.kind === "palisade" && v.scale >= 4) stroke(Math.max(1, tw - 2 * edge), rgb(C.woodEdge, 0.55), 0, 0, [1, 0.3 * v.scale]);
      // a water gate's portcullis across the water
      if (w.gates.some((g) => g.water)) {
        ctx.beginPath();
        for (const g of w.gates) if (g.water) for (const [[ax, ay], [bx, by]] of portcullisBars(g, t)) { ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); }
        ctx.lineWidth = Math.max(1, 0.22 * v.scale); ctx.strokeStyle = rgb(C.iron, 0.9); ctx.stroke();
      }
      // the towers
      const body = w.kind === "palisade" ? C.woodTower : C.stoneTower, roof = w.kind === "palisade" ? C.woodEdge : C.stoneRoof;
      const shape = (q: WallPieces["towers"][number], grow: number, ox = 0, oy = 0) => {
        const r = q.r * v.scale + grow;
        ctx.beginPath();
        if (q.square) { ctx.save(); ctx.translate(X(q.x) + ox, Y(q.y) + oy); ctx.rotate(q.angle); ctx.rect(-r, -r, 2 * r, 2 * r); ctx.restore(); }
        else ctx.arc(X(q.x) + ox, Y(q.y) + oy, Math.max(0.5, r), 0, Math.PI * 2);
      };
      for (const q of w.towers) { shape(q, 0, sh, sh); ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fill(); }
      for (const q of w.towers) {
        shape(q, 0); ctx.fillStyle = rgb(rim); ctx.fill();
        shape(q, -edge); ctx.fillStyle = rgb(body); ctx.fill();
        if (q.r * v.scale >= 3) {
          shape(q, -(q.r * 0.3 * v.scale));
          if (q.square) { ctx.fillStyle = rgb(roof, 0.35); ctx.fill(); }
          else {
            const r = q.r * 0.7 * v.scale, g = ctx.createRadialGradient(X(q.x) - r * 0.4, Y(q.y) - r * 0.4, r * 0.1, X(q.x), Y(q.y), r);
            g.addColorStop(0, rgb(roof.map((k) => Math.min(255, k * 1.25)))); g.addColorStop(1, rgb(roof.map((k) => k * 0.8)));
            ctx.fillStyle = g; ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  }

  /** A group of trees' crowns and colours, worked out once for what it is and the climate. */
  function crownsOf(t: MapTrees, climate: CityClimate) {
    const key = `${t.id}|${t.kind}|${t.size ?? ""}|${t.species ?? ""}|${climate.temperature},${climate.moisture}|${t.points.join(";")}`;
    let hit = crowns.current.get(key);
    if (!hit) {
      const list = treeCrowns(t, climate), bb = pointsBounds(t.points as Pt[]), pad = (t.size ?? 8) + 2;
      hit = { list, fills: list.map((c) => { const [r, g, b] = treeColour(c.species, climate, c.tone); return `rgb(${r},${g},${b})`; }), x0: bb.x0 - pad, y0: bb.y0 - pad, x1: bb.x1 + pad, y1: bb.y1 + pad };
      if (crowns.current.size > 3000) crowns.current.clear();
      crowns.current.set(key, hit);
    }
    return hit;
  }

  /** Trees: a soft shadow down and to the right, the crown, and, close up, a firs's points, a palm's fronds and the light on the crown's top-left side. */
  function drawTrees(ctx: CanvasRenderingContext2D, v: View, trees: MapTrees[], climate: CityClimate, dx: (id: string) => number, dy: (id: string) => number, vx0: number, vy0: number, vx1: number, vy1: number) {
    const shown = trees.map((t) => ({ t, c: crownsOf(t, climate), ox: dx(t.id), oy: dy(t.id) })).filter(({ c, ox, oy }) => c.x1 + ox >= vx0 && c.x0 + ox <= vx1 && c.y1 + oy >= vy0 && c.y0 + oy <= vy1);
    if (!shown.length) return;
    const X = (x: number) => v.ox + x * v.scale, Y = (y: number) => v.oy + y * v.scale;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.24)";
    for (const { c, ox, oy } of shown) {
      ctx.beginPath();
      for (const k of c.list) { const r = k.r * v.scale; if (r < 1.5) continue; const sx = X(k.x + ox) + r * 0.35, sy = Y(k.y + oy) + r * 0.35; ctx.moveTo(sx + r, sy); ctx.arc(sx, sy, r, 0, Math.PI * 2); }
      ctx.fill();
    }
    for (const { c, ox, oy } of shown) {
      c.list.forEach((k, i) => {
        const r = k.r * v.scale, sx = X(k.x + ox), sy = Y(k.y + oy);
        if (sx + r < 0 || sy + r < 0 || sx - r > ctx.canvas.width || sy - r > ctx.canvas.height) return;
        ctx.fillStyle = c.fills[i];
        if (r < 1.2) { ctx.fillRect(sx - 0.8, sy - 0.8, 1.6, 1.6); return; }
        ctx.beginPath();
        if (k.species === "conifer" && r >= 5) {
          for (let j = 0; j < 16; j++) { const a = (j / 16) * Math.PI * 2, rr = j % 2 ? r * 0.72 : r; ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
          ctx.closePath();
        } else ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (r >= 3) {
          ctx.fillStyle = "rgba(255,255,255,0.14)";
          ctx.beginPath(); ctx.arc(sx - r * 0.28, sy - r * 0.28, r * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        if (k.species === "palm" && r >= 6) {
          ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; ctx.beginPath();
          for (let j = 0; j < 7; j++) { const a = (j / 7) * Math.PI * 2 + k.tone; ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * r * 0.95, sy + Math.sin(a) * r * 0.95); }
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  /** The landforms, as marks over the map: a hill's reach and top, a ridge's or valley's line, a plateau's outline, a slope's arrow from low to high; each with its height. */
  function drawLand(ctx: CanvasRenderingContext2D, v: View, land: MapLandform[], sel: Set<string>, dx: (id: string) => number, dy: (id: string) => number) {
    const X = (x: number) => v.ox + x * v.scale, Y = (y: number) => v.oy + y * v.scale;
    ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (const l of land) {
      const on = sel.has(l.id), ox = dx(l.id), oy = dy(l.id), pts = l.points.map(([x, y]) => [X(x + ox), Y(y + oy)] as Pt);
      const col = on ? GOLD : l.height < 0 ? "rgba(150,200,255,0.85)" : "rgba(255,255,255,0.75)";
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = on ? 2 : 1.4; ctx.setLineDash(on ? [] : [6, 4]);
      ctx.beginPath();
      if (l.kind === "hill") { ctx.arc(pts[0][0], pts[0][1], l.radius * v.scale, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 4, 0, Math.PI * 2); ctx.fill(); }
      else if (l.kind === "slope") {
        const [[ax, ay], [bx, by]] = pts, a = Math.atan2(by - ay, bx - ax);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 12 * Math.cos(a - 0.4), by - 12 * Math.sin(a - 0.4)); ctx.lineTo(bx - 12 * Math.cos(a + 0.4), by - 12 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
      } else { pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (l.kind === "plateau") ctx.closePath(); ctx.stroke(); }
      const at = l.kind === "slope" ? pts[1] : l.kind === "hill" ? pts[0] : pts[Math.floor(pts.length / 2)];
      ctx.setLineDash([]); ctx.font = "bold 11px sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.fillStyle = "#fff";
      const label = `${landName(l)} ${l.height > 0 ? "+" : ""}${l.height} m`;
      ctx.strokeText(label, at[0] + 7, at[1] - 7); ctx.fillText(label, at[0] + 7, at[1] - 7);
    }
    ctx.restore();
  }

  /** The picture reader's marks: the area (or the box being dragged), what was found (cyan), the roof samples (their colour, numbered) and the ground samples (squares). */
  function drawReader(ctx: CanvasRenderingContext2D, v: View) {
    const s = readerCtl.state, X = (x: number) => v.ox + x * v.scale, Y = (y: number) => v.oy + y * v.scale;
    ctx.save();
    const box = s.drag ? [[s.drag.ax, s.drag.ay], [s.drag.bx, s.drag.ay], [s.drag.bx, s.drag.by], [s.drag.ax, s.drag.by]] : s.area;
    if (box) {
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = GOLD;
      ctx.beginPath(); box.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }
    if (s.found) {
      ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(0, 240, 255, 0.95)"; ctx.fillStyle = "rgba(0, 240, 255, 0.12)";
      for (const b of s.found) { ctx.beginPath(); b.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    }
    if (s.foundStreets) {
      // each street as a band of its width, its middle line over it
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const st of s.foundStreets) {
        ctx.beginPath(); st.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.lineWidth = Math.max(3, st.width * v.scale); ctx.strokeStyle = "rgba(0, 240, 255, 0.28)"; ctx.stroke();
        ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(0, 240, 255, 0.95)"; ctx.stroke();
      }
    }
    if (s.foundWater) {
      const spec = metaRef.current?.city, gw = store.heights?.w ?? 0;
      if (spec && gw) {
        ctx.fillStyle = "rgba(0, 240, 255, 0.35)";
        for (const { runs } of s.foundWater.runs) for (let i = 0; i < runs.length; i += 2) {
          const c = runs[i], cx = c % gw, cy = Math.floor(c / gw);
          ctx.fillRect(X(cx * spec.cellM), Y(cy * spec.cellM), runs[i + 1] * spec.cellM * v.scale, spec.cellM * v.scale + 0.5);
        }
      }
    }
    s.roofs.forEach((r, i) => {
      ctx.beginPath(); ctx.arc(X(r.x), Y(r.y), 8, 0, Math.PI * 2); ctx.fillStyle = `rgb(${r.rgb.join(",")})`; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = "#000"; ctx.stroke();
      ctx.font = "bold 11px sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.fillStyle = "#fff"; ctx.strokeText(String(i + 1), X(r.x) + 10, Y(r.y) - 8); ctx.fillText(String(i + 1), X(r.x) + 10, Y(r.y) - 8);
    });
    for (const g of s.ground) {
      ctx.fillStyle = `rgb(${g.rgb.join(",")})`; ctx.fillRect(X(g.x) - 6, Y(g.y) - 6, 12, 12);
      ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.strokeRect(X(g.x) - 6, Y(g.y) - 6, 12, 12); ctx.lineWidth = 1; ctx.strokeStyle = "#000"; ctx.strokeRect(X(g.x) - 7.5, Y(g.y) - 7.5, 15, 15);
    }
    ctx.restore();
  }

  /** The tool's own marks: a building being sized, an outline or street being clicked out, the brush, the box being dragged. */
  function drawTools(ctx: CanvasRenderingContext2D, v: View, o: CityUi, _W: number, _H: number) {
    const p = pointer.current, d = drag.current;
    const px = (x: number) => v.ox + x * v.scale, py = (y: number) => v.oy + y * v.scale;
    const line = (pts: Pt[], close: boolean, style: string, width: number, dash: number[] = []) => {
      ctx.save(); ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = style; ctx.lineJoin = "round"; ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
      if (close) ctx.closePath();
      ctx.stroke(); ctx.restore();
    };
    const label = (text: string, x: number, y: number) => {
      ctx.save(); ctx.font = "bold 12px sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.fillStyle = "#fff"; ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.restore();
    };
    if (p && !spaceRef.current && !traceCtl.state.mode) {
      const m = toM(p.x, p.y);
      if (o.tool === "building") {
        const poly = d?.mode === "rect" ? rectFromDrag(d.ax, d.ay, m.x, m.y, o.angle) : rectPolygon(m.x, m.y, DEFAULT_HOUSE.w, DEFAULT_HOUSE.h, o.angle);
        line(poly, true, GOLD, 1.5, d?.mode === "rect" ? [] : [4, 3]);
        if (d?.mode === "rect") { const w = Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]), h = Math.hypot(poly[2][0] - poly[1][0], poly[2][1] - poly[1][1]); label(`${w.toFixed(1)} × ${h.toFixed(1)} m`, p.x + 12, p.y - 10); }
      }
      if (o.tool === "outline" && outline.current?.length) {
        line([...outline.current, [m.x, m.y]], false, GOLD, 1.8, [6, 4]);
        for (const [x, y] of outline.current) { ctx.beginPath(); ctx.arc(px(x), py(y), 3.5, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); }
      }
      if (o.tool === "street" && streetDraft.current?.length) {
        const w = streetWidthFor(o.streetKind) * v.scale;
        ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = 0.55; ctx.strokeStyle = `rgb(${STREET_SURFACE.join(",")})`; ctx.lineWidth = Math.max(2, w);
        ctx.beginPath(); [...streetDraft.current, [m.x, m.y] as Pt].forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)))); ctx.stroke(); ctx.restore();
        line(streetDraft.current, false, GOLD, 1.2, [5, 4]);
        for (const [x, y] of streetDraft.current) { ctx.beginPath(); ctx.arc(px(x), py(y), 3.5, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); }
      }
      if (o.tool === "district" && districtDraft.current?.length) {
        const pts = districtDraft.current;
        line([...pts, [m.x, m.y]], false, GOLD, 1.8, [8, 5]);
        if (pts.length >= 2) line([[m.x, m.y], pts[0]], false, "rgba(255,224,120,0.45)", 1.2, [3, 4]);
        for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(px(x), py(y), 3.5, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); }
        if (pts.length >= 3) { ctx.beginPath(); ctx.arc(px(pts[0][0]), py(pts[0][1]), 7, 0, Math.PI * 2); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      if (o.tool === "citywall" && wallDraft.current?.length) {
        const pts = wallDraft.current, k = WALL_KINDS.find((x) => x.id === o.wallKind) ?? WALL_KINDS[0], c = o.wallKind === "stone" ? WALL_COLOURS.stoneTop : o.wallKind === "palisade" ? WALL_COLOURS.woodTop : WALL_COLOURS.earthBank;
        ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = 0.6; ctx.strokeStyle = `rgb(${c.join(",")})`; ctx.lineWidth = Math.max(2, k.thickness * v.scale);
        ctx.beginPath(); [...pts, [m.x, m.y] as Pt].forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)))); ctx.stroke(); ctx.restore();
        line([...pts, [m.x, m.y]], false, GOLD, 1.4, [6, 4]);
        if (pts.length >= 2) line([[m.x, m.y], pts[0]], false, "rgba(255,224,120,0.4)", 1.2, [3, 4]);
        for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(px(x), py(y), 3.5, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); }
        if (pts.length >= 3) { ctx.beginPath(); ctx.arc(px(pts[0][0]), py(pts[0][1]), 7, 0, Math.PI * 2); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      if ((o.tool === "hills" && landDraft.current?.length) || (o.tool === "trees" && treeDraft.current?.length)) {
        const pts = (o.tool === "hills" ? landDraft.current : treeDraft.current)!;
        const closed = o.tool === "hills" ? o.landMode === "plateau" || o.landMode === "hollow" : o.treeKind !== "row";
        line([...pts, [m.x, m.y]], false, GOLD, 1.8, [6, 4]);
        if (closed && pts.length >= 2) line([[m.x, m.y], pts[0]], false, "rgba(255,224,120,0.45)", 1.2, [3, 4]);
        for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(px(x), py(y), 3.5, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); }
      }
      if (o.tool === "hills" && d?.mode === "hill") {
        const r = Math.max(4, Math.hypot(m.x - d.ax, m.y - d.ay)) * v.scale;
        ctx.beginPath(); ctx.arc(px(d.ax), py(d.ay), r, 0, Math.PI * 2); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.6; ctx.stroke();
        label(`${(r / v.scale).toFixed(0)} m across ${o.landMode === "hill" ? "the top" : ""}`.trim(), p.x + 12, p.y - 10);
      }
      if (o.tool === "hills" && d?.mode === "slope") { line([[d.ax, d.ay], [m.x, m.y]], false, GOLD, 2); label(`rises ${o.landHeight} m this way`, p.x + 12, p.y - 10); }
      if (o.tool === "hills" && !d && !landDraft.current && o.landMode === "hill") {
        ctx.beginPath(); ctx.arc(p.x, p.y, o.landSize * v.scale, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
      }
      if (o.tool === "trees" && o.treeKind === "tree") {
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, ((o.treeSize || 8) / 2) * v.scale), 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.2; ctx.stroke();
      }
      if (o.tool === "ground") {
        const r = Math.max(2, o.brush * v.scale);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2); ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.stroke();
      }
    }
    if (d?.mode === "battlebox" && p) {
      const b = toM(p.x, p.y), w = Math.abs(b.x - d.ax), h = Math.abs(b.y - d.ay), sq = cityBattleSquares({ w, h }), big = sq.squaresX > 150 || sq.squaresY > 150;
      const x = Math.min(d.sx, p.x), y = Math.min(d.sy, p.y);
      ctx.save(); ctx.fillStyle = big ? "rgba(220, 60, 50, 0.15)" : "rgba(255, 224, 120, 0.12)"; ctx.fillRect(x, y, Math.abs(p.x - d.sx), Math.abs(p.y - d.sy));
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = big ? "rgba(240, 90, 80, 0.95)" : GOLD; ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(p.x - d.sx), Math.abs(p.y - d.sy)); ctx.restore();
      label(`${Math.round(w)} × ${Math.round(h)} m · ${sq.squaresX} × ${sq.squaresY} squares${big ? " (too big: 150 at most)" : ""}`, p.x + 12, p.y - 10);
    }
    if (d?.mode === "marquee" && p) {
      const x = Math.min(d.sx, p.x), y = Math.min(d.sy, p.y), w = Math.abs(p.x - d.sx), h = Math.abs(p.y - d.sy);
      ctx.save(); ctx.fillStyle = "rgba(255, 224, 120, 0.12)"; ctx.fillRect(x, y, w, h); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = GOLD; ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.restore();
    }
  }

  // ------------------------------------------------------------ what is under a point
  function hitAt(mx: number, my: number): { kind: "building" | "street" | "wall" | "trees" | "district"; id: string } | null {
    const f = featRef.current, v = viewRef.current;
    const bs = f.buildings ?? [];
    for (let i = bs.length - 1; i >= 0; i--) { const c = infoOf(bs[i]); if (mx >= c.x0 && mx <= c.x1 && my >= c.y0 && my <= c.y1 && pointInPolygon(mx, my, bs[i].points as Pt[])) return { kind: "building", id: bs[i].id }; }
    const tol = 4 / v.scale, ws = f.cityWalls ?? [];
    for (let i = ws.length - 1; i >= 0; i--) { const w = ws[i]; if (distToWall(mx, my, w) <= (w.thickness ?? (WALL_KINDS.find((k) => k.id === (w.kind ?? "stone"))?.thickness ?? 3)) / 2 + tol) return { kind: "wall", id: w.id }; }
    const ss = f.streets ?? [];
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i];
      for (let k = 0; k + 1 < s.points.length; k++) if (distToSegment(mx, my, s.points[k][0], s.points[k][1], s.points[k + 1][0], s.points[k + 1][1]) <= s.width / 2 + tol) return { kind: "street", id: s.id };
    }
    const ds = f.districts ?? [];
    for (let i = ds.length - 1; i >= 0; i--) if (distToPolyline(mx, my, [...ds[i].points, ds[i].points[0]] as Pt[]) <= tol * 1.5) return { kind: "district", id: ds[i].id };
    const ts = f.trees ?? [];
    for (let i = ts.length - 1; i >= 0; i--) {
      const t = ts[i], pts = t.points as Pt[], half = (t.size ?? 7) / 2 + tol;
      if (t.kind === "tree" ? Math.hypot(mx - pts[0][0], my - pts[0][1]) <= half : t.kind === "row" ? distToPolyline(mx, my, pts) <= half : pointInPolygon(mx, my, pts)) return { kind: "trees", id: t.id };
    }
    return null;
  }

  /** The landform whose mark is under a point (the Land tool shows them): a hill's top or edge, a ridge's line, a plateau's outline, a slope's arrow. */
  function hitLand(mx: number, my: number): string | null {
    const land = featRef.current.land ?? [], tol = 8 / viewRef.current.scale;
    for (let i = land.length - 1; i >= 0; i--) {
      const l = land[i], pts = l.points as Pt[];
      const near = l.kind === "hill" ? (() => { const d = Math.hypot(mx - pts[0][0], my - pts[0][1]); return d <= tol * 1.5 || Math.abs(d - l.radius) <= tol; })()
        : l.kind === "plateau" ? distToPolyline(mx, my, [...pts, pts[0]]) <= tol
        : distToPolyline(mx, my, pts) <= tol;
      if (near) return l.id;
    }
    return null;
  }

  // ------------------------------------------------------------ editing
  const rectFromDrag = (ax: number, ay: number, bx: number, by: number, angle: number): Pt[] => {
    const a = (angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = bx - ax, dy = by - ay;
    return rectPolygon((ax + bx) / 2, (ay + by) / 2, Math.abs(dx * c + dy * s), Math.abs(-dx * s + dy * c), angle);
  };
  /** Keep a shape's points inside the city. */
  const inside = (pts: Pt[]): Pt[] | null => {
    const spec = metaRef.current?.city;
    if (!spec) return null;
    return pts.map(([x, y]) => [r2(Math.min(spec.widthM, Math.max(0, x))), r2(Math.min(spec.heightM, Math.max(0, y)))] as Pt);
  };

  function addBuilding(points: Pt[]) {
    const pts = inside(points), o = uiRef.current;
    if (!pts) return;
    const bb = pointsBounds(pts);
    if (bb.x1 - bb.x0 < 1 || bb.y1 - bb.y0 < 1) return; // (a sliver: most likely a stray click)
    const id = newFeatureId("b");
    const pic = o.roofSource === "assets" ? roofChoiceFor(o.roof, id) : null; // (a picture of the packs whenever one fits the look; the look is drawn only when none does)
    sendCityFeatures({ upsertBuildings: [{ id, points: pts, roof: o.roof, kind: o.kind, ...(pic && { asset: pic.asset, tile: pic.tile }) }] }, "Add building");
    onUiRef.current({ selected: [id] });
  }
  function finishOutline() {
    const pts = outline.current;
    outline.current = null;
    if (pts && pts.length >= 3) addBuilding(pts);
    requestDraw();
  }
  function finishStreet() {
    const pts = streetDraft.current;
    streetDraft.current = null;
    requestDraw();
    if (!pts || pts.length < 2) return;
    const clean = inside(pts)!, kind = uiRef.current.streetKind, bridge = uiRef.current.streetBridge, id = newFeatureId("t");
    sendCityFeatures({ upsertStreets: [{ id, points: clean, width: streetWidthFor(kind), kind, ...(bridge !== "auto" && { bridge }) }] }, `Add ${kind}`);
    onUiRef.current({ selected: [id] });
  }

  /** A new label where the Name tool was clicked: its text asked for, its kind and size from the tool bar. */
  async function addLabel(x: number, y: number) {
    const o = uiRef.current, kind = CITY_LABEL_KINDS.find((k) => k.id === o.labelKind) ?? CITY_LABEL_KINDS[0];
    const text = (await ask(`${kind.name} name:`))?.trim();
    if (!text) return;
    const id = newFeatureId("l");
    sendCityFeatures({ upsertLabels: [{ id, text: text.slice(0, 80), kind: kind.kind, x: r2(x), y: r2(y), ...(o.labelSize !== 1 && { size: o.labelSize }) }] }, `Name ${text}`);
    onUiRef.current({ selected: [id] });
  }
  /** Name (or rename) a street, building or wall clicked with the Name tool. */
  async function nameThing(kind: "building" | "street" | "wall", id: string) {
    const f = featRef.current;
    const cur = kind === "building" ? f.buildings?.find((b) => b.id === id) : kind === "street" ? f.streets?.find((s) => s.id === id) : f.cityWalls?.find((w) => w.id === id);
    if (!cur) return;
    const text = await ask(`Name of this ${kind} (empty for none):`, cur.name ?? "");
    if (text === null) return;
    const v = text.trim().slice(0, 80), { name: _n, ...rest } = cur, next = v ? { ...rest, name: v } : rest;
    if (v === (cur.name ?? "")) return;
    sendCityFeatures(kind === "building" ? { upsertBuildings: [next as MapBuilding] } : kind === "street" ? { upsertStreets: [next as MapStreet] } : { upsertCityWalls: [next as MapCityWall] }, v ? `Name ${kind} ${v}` : `Clear ${kind} name`);
  }

  /** A district from the corners clicked: its name asked for (it may have none yet). */
  async function finishDistrict() {
    const pts = districtDraft.current, spec = metaRef.current?.city;
    districtDraft.current = null;
    requestDraw();
    if (!pts || pts.length < 3 || !spec) return;
    const name = await ask("Name of this district (or leave it empty):", "", "Add district");
    if (name === null) return;
    const c = cleanDistrict({ id: newFeatureId("r"), points: pts, ...(name.trim() && { name: name.trim() }) }, spec);
    if ("error" in c) return;
    sendCityFeatures({ upsertDistricts: [c] }, c.name ? `Add district ${c.name}` : "Add district");
    onUiRef.current({ selected: [c.id] });
  }

  /** The Battlemap here tool's box let go of: say how big a battlemap it makes, ask its name, and have it made (the server opens it). */
  async function makeBattle(rect: { x: number; y: number; w: number; h: number }) {
    const m = metaRef.current, sq = cityBattleSquares(rect);
    if (!m) return;
    if (sq.squaresX > 150 || sq.squaresY > 150) { await notice(`That box is ${Math.round(rect.w)} × ${Math.round(rect.h)} m: ${sq.squaresX} × ${sq.squaresY} squares of 5 ft, and a battlemap can be at most 150 squares a side (about 228 m). Drag a smaller box.`); return; }
    const name = await ask(`A battlemap of ${Math.round(rect.w)} × ${Math.round(rect.h)} m here: ${sq.squaresX} × ${sq.squaresY} squares of 5 ft, with the buildings as walls, doors and roofs. Its name:`, `${m.name} scene`, "Make it");
    if (!name?.trim()) return;
    store.send({ t: "create_battle_from_city", name: name.trim(), rect });
  }

  /** A city wall from the Wall tool's settings, open or a ring. */
  function finishWall(closed: boolean) {
    const pts = wallDraft.current, spec = metaRef.current?.city, o = uiRef.current;
    wallDraft.current = null;
    requestDraw();
    if (!pts || !spec || pts.length < (closed ? 3 : 2)) return;
    const k = WALL_KINDS.find((x) => x.id === o.wallKind) ?? WALL_KINDS[0];
    const c = cleanCityWall({ id: newFeatureId("w"), points: inside(pts), ...(closed && { closed: true }), kind: o.wallKind, ...(o.wallTowers !== k.towers && { towers: o.wallTowers }) }, spec);
    if ("error" in c) return;
    sendCityFeatures({ upsertCityWalls: [c] }, `Add ${k.name.toLowerCase()}`);
    onUiRef.current({ selected: [c.id] });
  }

  /** A landform from the Land tool's settings (a valley is a ridge sunk, a hollow a plateau sunk). */
  function addLand(points: Pt[], radius: number) {
    const spec = metaRef.current?.city, o = uiRef.current, pts = inside(points);
    if (!spec || !pts) return;
    const kind = o.landMode === "valley" ? "ridge" : o.landMode === "hollow" ? "plateau" : o.landMode;
    const sunk = o.landMode === "valley" || o.landMode === "hollow";
    const c = cleanLandform({ id: newFeatureId("h"), kind, points: pts, height: sunk ? -o.landHeight : o.landHeight, radius: kind === "slope" ? 0 : Math.max(1, radius) }, spec);
    if ("error" in c) return;
    sendCityFeatures({ upsertLand: [c] }, `Add ${landName(c).toLowerCase()}`);
    onUiRef.current({ selected: [c.id] });
  }
  function finishLand() {
    const pts = landDraft.current, o = uiRef.current;
    landDraft.current = null;
    requestDraw();
    const need = o.landMode === "plateau" || o.landMode === "hollow" ? 3 : 2;
    if (pts && pts.length >= need) addLand(pts, o.landSize);
  }
  /** Trees from the Trees tool's settings. */
  function addTrees(points: Pt[]) {
    const spec = metaRef.current?.city, o = uiRef.current, pts = inside(points);
    if (!spec || !pts) return;
    const c = cleanTrees({ id: newFeatureId("v"), kind: o.treeKind, points: pts, ...(o.treeSize > 0 && { size: o.treeSize }), ...(o.treeSpecies && { species: o.treeSpecies }) }, spec);
    if ("error" in c) return;
    sendCityFeatures({ upsertTrees: [c] }, o.treeKind === "tree" ? "Add a tree" : `Add ${o.treeKind === "row" ? "a row of trees" : o.treeKind === "scattered" ? "scattered trees" : `an ${o.treeKind === "orchard" ? "orchard" : "wood"}`}`.replace("an wood", "a wood"));
    onUiRef.current({ selected: [c.id] });
  }
  function finishTrees() {
    const pts = treeDraft.current, o = uiRef.current;
    treeDraft.current = null;
    requestDraw();
    if (pts && pts.length >= (o.treeKind === "row" ? 2 : 3)) addTrees(pts);
  }

  function paintStroke(points: Pt[]) {
    const spec = metaRef.current?.city;
    if (!spec) return;
    const k = spec.cellM, r = uiRef.current.brush / k;
    const shape = points.length === 1 ? { type: "circle" as const, x: points[0][0] / k, y: points[0][1] / k, r } : { type: "stroke" as const, points: points.map(([x, y]) => [x / k, y / k] as [number, number]), r };
    store.send({ t: "cmd", cmd: { op: "paint_floor", params: { shape, material: uiRef.current.material } } });
  }

  /** Move the selected buildings and streets by (dx, dy) metres, kept inside the city. */
  function moveSelected(ids: string[], dx: number, dy: number, label: string) {
    const spec = metaRef.current?.city, f = featRef.current;
    if (!spec) return;
    const { buildings, streets, trees, land, walls, labels, districts } = selectedOf(f, ids);
    const all = [...buildings.flatMap((b) => b.points), ...streets.flatMap((s) => s.points), ...trees.flatMap((t) => t.points), ...land.flatMap((l) => l.points), ...walls.flatMap((w) => w.points), ...labels.map((l) => [l.x, l.y]), ...districts.flatMap((d) => d.points)] as Pt[];
    if (!all.length) return;
    const bb = pointsBounds(all);
    dx = Math.max(-bb.x0, Math.min(spec.widthM - bb.x1, dx)); dy = Math.max(-bb.y0, Math.min(spec.heightM - bb.y1, dy));
    if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) return;
    const mv = (p: [number, number]): [number, number] => [r2(p[0] + dx), r2(p[1] + dy)];
    sendCityFeatures({
      ...(buildings.length && { upsertBuildings: buildings.map((b) => ({ ...b, points: b.points.map(mv) })) }), ...(streets.length && { upsertStreets: streets.map((s) => ({ ...s, points: s.points.map(mv) })) }),
      ...(trees.length && { upsertTrees: trees.map((t) => ({ ...t, points: t.points.map(mv) })) }), ...(land.length && { upsertLand: land.map((l) => ({ ...l, points: l.points.map(mv) })) }),
      ...(walls.length && { upsertCityWalls: walls.map((w) => ({ ...w, points: w.points.map(mv) })) }),
      ...(labels.length && { upsertLabels: labels.map((l) => { const [x, y] = mv([l.x, l.y]); return { ...l, x, y }; }) }),
      ...(districts.length && { upsertDistricts: districts.map((d) => ({ ...d, points: d.points.map(mv) })) }),
    }, label);
  }
  function nudge(dx: number, dy: number, big: boolean): boolean {
    const ids = uiRef.current.selected;
    if (!ids.length) return false;
    const step = big ? 5 : 0.5, cur = moving.current && moving.current.ids === ids ? moving.current : { ids, dx: 0, dy: 0 };
    moving.current = { ids, dx: cur.dx + dx * step, dy: cur.dy + dy * step };
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(commitNudge, 400); // (quick presses add up to one edit)
    requestDraw();
    return true;
  }
  function commitNudge() {
    window.clearTimeout(nudgeTimer.current);
    const mv = moving.current;
    moving.current = null;
    if (mv && !drag.current) moveSelected(mv.ids, mv.dx, mv.dy, mv.ids.length === 1 ? "Nudge" : `Nudge ${mv.ids.length} items`);
    requestDraw();
  }
  function turnSelected(deg: number): boolean {
    const { buildings } = selectedOf(featRef.current, uiRef.current.selected);
    if (!buildings.length) return false;
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    const turned = buildings.map((b) => {
      const [cx, cy] = polygonCentroid(b.points as Pt[]);
      return { ...b, points: (inside(b.points.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] as Pt)) ?? b.points) as [number, number][] };
    });
    sendCityFeatures({ upsertBuildings: turned }, turned.length === 1 ? "Turn building" : `Turn ${turned.length} buildings`);
    return true;
  }
  /** Paste a copy (new ids, moved by dx, dy metres, held inside the city) and select it. */
  function pasteGroup(clip: CityClip, dx: number, dy: number, label: string) {
    const spec = metaRef.current?.city;
    if (!spec) return;
    const r = pasteCity(clip, dx, dy, spec), n = r.ids.length;
    sendCityFeatures(r.patch, n === 1 ? label : `${label} ${n} items`);
    onUiRef.current({ selected: r.ids });
  }
  /** Ctrl+V: what was copied, centred on the pointer (or 5 m along and down when the pointer is off the map); pasting again in the same place steps it along. */
  function pasteClip() {
    const clip = getClip("city");
    if (!clip) return;
    const b = cityClipBounds(clip), p = pointer.current;
    let dx = 5, dy = 5;
    if (p) { const q = toM(p.x, p.y); dx = r2(q.x - (b.x0 + b.x1) / 2); dy = r2(q.y - (b.y0 + b.y1) / 2); }
    ({ dx, dy } = unstack("city", dx, dy, 5));
    pasteGroup(clip, dx, dy, "Paste");
  }

  function deleteSelected() {
    if (removeSelected(featRef.current, uiRef.current.selected)) onUiRef.current({ selected: [] });
  }

  // ------------------------------------------------------------ effects
  useEffect(() => store.onPatch((r) => paintGround(r)), [paintGround]);
  useEffect(() => { void loadRoofPools(); return roofAssetsStore.subscribe(requestDraw); }, [meta?.id, requestDraw]);
  useEffect(() => { void loadLabelFonts().then(requestDraw); }, [requestDraw]);
  useEffect(() => { if (meta && store.heights && fittedFor.current !== meta.id) paintGround(null); }, [meta, paintGround]);
  useEffect(() => { requestDraw(); }, [features, ui, meta, requestDraw]);
  useEffect(() => { outline.current = null; streetDraft.current = null; landDraft.current = null; treeDraft.current = null; wallDraft.current = null; districtDraft.current = null; requestDraw(); }, [ui.tool, ui.landMode, ui.treeKind, requestDraw]);
  // the land or the climate changed: the ground's colours and shading with it
  const groundKey = `${JSON.stringify(features.land ?? [])}|${JSON.stringify(meta?.city?.climate ?? null)}`;
  useEffect(() => { if (metaRef.current?.city && store.heights && offRef.current) paintGround(null); }, [groundKey, paintGround]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { const w = wrapRef.current; if (w) keeper.resized(w.clientWidth, w.clientHeight); requestDraw(); });
    if (wrapRef.current) ro.observe(wrapRef.current);
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) { setSpaceDown(true); e.preventDefault(); }
      const view = isTyping(e) ? null : viewKeyAction(e);
      if (view && !(view.kind === "pan" && uiRef.current.selected.length)) { e.preventDefault(); keyView(view); }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceDown(false); };
    const keys = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const o = uiRef.current;
      const draft = o.tool === "outline" ? outline : o.tool === "street" ? streetDraft : o.tool === "hills" ? landDraft : o.tool === "trees" ? treeDraft : o.tool === "citywall" ? wallDraft : o.tool === "district" ? districtDraft : null;
      if (draft?.current) {
        if (e.key === "Enter") (o.tool === "outline" ? finishOutline : o.tool === "street" ? finishStreet : o.tool === "hills" ? finishLand : o.tool === "citywall" ? () => finishWall(false) : o.tool === "district" ? () => void finishDistrict() : finishTrees)();
        else if (e.key === "Escape") draft.current = null;
        else if (e.key === "Backspace" || e.key === "Delete") { draft.current.pop(); if (!draft.current.length) draft.current = null; }
        else return;
        e.preventDefault();
        requestDraw();
        return;
      }
      const arrow = ARROW_DIRECTION[e.key];
      if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey && nudge(arrow[0], arrow[1], e.shiftKey)) { e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        // (Ctrl+C and Ctrl+V let the browser's copy and paste events happen: a picture copied after the map items is pasted as a reference instead, see clipboard.ts)
        if (k === "c") { const clip = copyCity(featRef.current, o.selected); if (clip) { setClip("city", clip); itemsCopied(); } return; }
        if (k === "v") { armItemsPaste("city", pasteClip); return; }
        if (k === "d") { e.preventDefault(); const clip = copyCity(featRef.current, o.selected); if (clip) pasteGroup(clip, 5, 5, "Duplicate"); return; } // (Ctrl+D is "bookmark this page" in a browser)
      }
      if (e.key === "Escape") { if (drag.current?.mode === "marquee") drag.current = null; onUiRef.current({ selected: [] }); requestDraw(); return; }
      const key = e.key.toLowerCase();
      if ((key === "q" || key === "e") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const deg = key === "e" ? 15 : -15;
        if (!turnSelected(deg) && o.tool === "building") onUiRef.current({ angle: (((o.angle + deg) % 360) + 360) % 360 });
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && o.selected.length) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => { ro.disconnect(); window.removeEventListener("keydown", keys); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.clearTimeout(nudgeTimer.current); };
  }, [requestDraw]);

  // ------------------------------------------------------------ the mouse
  const onPointerDown = (e: React.PointerEvent) => {
    const m = metaRef.current;
    if (!m?.city || !store.heights) return;
    const p = local(e), v = viewRef.current, o = uiRef.current, q = toM(p.x, p.y);
    pointer.current = p; // (a click that comes with no earlier movement, as from a touch screen, must still know where it is)
    canvasRef.current!.setPointerCapture(e.pointerId);
    if (moving.current && !drag.current) commitNudge(); // (a nudge still waiting goes first, so it can't be mistaken for this drag)
    const base = { sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, ax: q.x, ay: q.y, lastX: q.x, lastY: q.y };
    // lining up the trace picture takes a left click, whatever the tool (Space still pans)
    if (e.button === 0 && !spaceRef.current && traceCtl.down(featRef.current.trace, q)) { drag.current = { mode: "trace", ...base }; requestDraw(); return; }
    // the picture reader takes a left click while it is on: the area's box, a roof or the ground
    if (e.button === 0 && !spaceRef.current && readerCtl.state.on) {
      const t = featRef.current.trace;
      readerCtl.click(q.x, q.y, t ? traceCtl.colourAt(m.id, t, q.x, q.y) : null);
      if (readerCtl.state.drag) drag.current = { mode: "reader", ...base };
      requestDraw();
      return;
    }
    if (e.button === 1 || e.button === 2 || o.tool === "pan" || spaceRef.current) { drag.current = { mode: "pan", ...base }; return; }
    if (e.button !== 0) return;
    if (o.tool === "select" || o.tool === "citylabel") {
      const lh = hitTest(labelHits.current, p.x, p.y);
      const hit = lh?.kind === "label" ? { kind: "label" as const, id: lh.id } : o.tool === "select" ? hitAt(q.x, q.y) : null;
      if (o.tool === "citylabel" && !hit) {
        // the Name tool: a street, building or wall is named; open ground gets a new label
        const thing = hitAt(q.x, q.y);
        if (thing && thing.kind !== "trees" && thing.kind !== "district") { void nameThing(thing.kind, thing.id); return; }
        void addLabel(q.x, q.y);
        return;
      }
      if (hit) {
        const has = o.selected.includes(hit.id);
        if (e.shiftKey) { onUiRef.current({ selected: has ? o.selected.filter((id) => id !== hit.id) : [...o.selected, hit.id] }); return; }
        const ids = has ? o.selected : [hit.id];
        if (!has) onUiRef.current({ selected: ids });
        drag.current = { mode: "move", ...base };
        moving.current = { ids, dx: 0, dy: 0 };
      } else {
        drag.current = { mode: "marquee", ...base, add: e.shiftKey, base: o.selected };
        if (!e.shiftKey) onUiRef.current({ selected: [] });
      }
      return;
    }
    if (o.tool === "building") { drag.current = { mode: "rect", ...base }; return; }
    if (o.tool === "citybattle") { drag.current = { mode: "battlebox", ...base }; return; }
    const dbl = (() => { const lc = lastClick.current, now = performance.now(); const d = !!lc && now - lc.t < 400 && Math.hypot(p.x - lc.x, p.y - lc.y) < 8; lastClick.current = { t: now, x: p.x, y: p.y }; return d; })();
    if (o.tool === "outline") {
      const pts = outline.current ?? [];
      const nearFirst = pts.length >= 3 && Math.hypot((pts[0][0] - q.x) * v.scale, (pts[0][1] - q.y) * v.scale) < 10;
      if (nearFirst || (dbl && pts.length >= 3)) finishOutline(); else outline.current = [...pts, [q.x, q.y]];
      requestDraw();
      return;
    }
    if (o.tool === "street") {
      const pts = streetDraft.current ?? [];
      if (dbl && pts.length >= 2) finishStreet(); else streetDraft.current = dbl ? pts : [...pts, [q.x, q.y]];
      requestDraw();
      return;
    }
    if (o.tool === "district") {
      const pts = districtDraft.current ?? [];
      const nearFirst = pts.length >= 3 && Math.hypot((pts[0][0] - q.x) * v.scale, (pts[0][1] - q.y) * v.scale) < 10;
      if (nearFirst || (dbl && pts.length >= 3)) void finishDistrict(); else districtDraft.current = dbl ? pts : [...pts, [q.x, q.y]];
      requestDraw();
      return;
    }
    if (o.tool === "citywall") {
      const pts = wallDraft.current ?? [];
      const nearFirst = pts.length >= 3 && Math.hypot((pts[0][0] - q.x) * v.scale, (pts[0][1] - q.y) * v.scale) < 10;
      if (nearFirst) finishWall(true); else if (dbl && pts.length >= 2) finishWall(false); else wallDraft.current = dbl ? pts : [...pts, [q.x, q.y]];
      requestDraw();
      return;
    }
    if (o.tool === "hills") {
      // a landform's mark selects it (and dragging moves it); anywhere else makes a new one
      const hit = landDraft.current ? null : hitLand(q.x, q.y);
      if (hit) {
        onUiRef.current({ selected: [hit] });
        drag.current = { mode: "move", ...base };
        moving.current = { ids: [hit], dx: 0, dy: 0 };
        return;
      }
      if (o.landMode === "hill") { drag.current = { mode: "hill", ...base }; return; }
      if (o.landMode === "slope") { drag.current = { mode: "slope", ...base }; return; }
      const pts = landDraft.current ?? [], closed = o.landMode === "plateau" || o.landMode === "hollow";
      const nearFirst = closed && pts.length >= 3 && Math.hypot((pts[0][0] - q.x) * v.scale, (pts[0][1] - q.y) * v.scale) < 10;
      if (nearFirst || (dbl && pts.length >= (closed ? 3 : 2))) finishLand(); else landDraft.current = dbl ? pts : [...pts, [q.x, q.y]];
      requestDraw();
      return;
    }
    if (o.tool === "trees") {
      if (o.treeKind === "tree") { addTrees([[q.x, q.y]]); return; }
      const pts = treeDraft.current ?? [], closed = o.treeKind !== "row";
      const nearFirst = closed && pts.length >= 3 && Math.hypot((pts[0][0] - q.x) * v.scale, (pts[0][1] - q.y) * v.scale) < 10;
      if (nearFirst || (dbl && pts.length >= (closed ? 3 : 2))) finishTrees(); else treeDraft.current = dbl ? pts : [...pts, [q.x, q.y]];
      requestDraw();
      return;
    }
    if (o.tool === "ground") {
      store.send({ t: "txn_begin", label: `Paint ${(MATERIALS[o.material] ?? MATERIALS[5]).name}` });
      paintStroke([[q.x, q.y]]);
      drag.current = { mode: "brush", ...base };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    pointer.current = p;
    const q = toM(p.x, p.y), m = metaRef.current, hf = store.heights;
    if (m?.city && hf && q.x >= 0 && q.y >= 0 && q.x < m.city.widthM && q.y < m.city.heightM) {
      const id = Math.round(hf.data[Math.floor(q.y / m.city.cellM) * hf.w + Math.floor(q.x / m.city.cellM)]);
      const f = featRef.current, at = (f.land?.length || m.city.elevation) ? landAt({ meta: m, features: f }, q.x, q.y) : null;
      setHover({ x: q.x, y: q.y, ground: MATERIALS[id]?.name ?? "", land: at ? `${Math.round(at.height)} m above the sea${at.slope >= 0.5 ? `, ${Math.round(at.slope)}% slope` : ""}` : "" });
    } else setHover(null);
    const d = drag.current;
    if (d?.mode === "trace") { traceCtl.move(q); return; }
    if (d?.mode === "reader") { readerCtl.dragTo(q.x, q.y); return; }
    if (d?.mode === "pan") viewRef.current = { ...viewRef.current, ox: d.ox + p.x - d.sx, oy: d.oy + p.y - d.sy };
    else if (d?.mode === "move" && moving.current) { if (Math.hypot(p.x - d.sx, p.y - d.sy) > 4 || moving.current.dx || moving.current.dy) moving.current = { ...moving.current, dx: q.x - d.ax, dy: q.y - d.ay }; }
    else if (d?.mode === "brush") {
      if (Math.hypot(q.x - d.lastX, q.y - d.lastY) >= Math.max(0.5, uiRef.current.brush / 3)) { paintStroke([[d.lastX, d.lastY], [q.x, q.y]]); d.lastX = q.x; d.lastY = q.y; }
    }
    requestDraw();
  };

  const endDrag = () => {
    const d = drag.current, p = pointer.current;
    drag.current = null;
    if (d?.mode === "trace") { traceCtl.up(); return; }
    if (d?.mode === "reader") { readerCtl.dragEnd(); requestDraw(); return; }
    if (d?.mode === "brush") store.send({ t: "txn_end" });
    if (d?.mode === "move") {
      const mv = moving.current;
      moving.current = null;
      if (mv && p && Math.hypot(p.x - d.sx, p.y - d.sy) > 3) moveSelected(mv.ids, mv.dx, mv.dy, mv.ids.length === 1 ? "Move" : `Move ${mv.ids.length} items`);
    }
    if (d?.mode === "marquee" && p) {
      if (Math.hypot(p.x - d.sx, p.y - d.sy) >= 4) {
        const a = toM(d.sx, d.sy), b = toM(p.x, p.y), x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        const f = featRef.current, found: string[] = [];
        for (const bl of f.buildings ?? []) { const [cx, cy] = polygonCentroid(bl.points as Pt[]); if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) found.push(bl.id); }
        for (const s of f.streets ?? []) if (s.points.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) found.push(s.id);
        for (const w of f.cityWalls ?? []) if (w.points.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) found.push(w.id);
        if (uiRef.current.names) for (const l of f.labels ?? []) if (l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1) found.push(l.id);
        for (const d of f.districts ?? []) if (d.points.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) found.push(d.id);
        for (const t of f.trees ?? []) { const [cx, cy] = t.points.length >= 3 ? polygonCentroid(t.points as Pt[]) : t.points[0]; if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) found.push(t.id); }
        onUiRef.current({ selected: d.add ? [...new Set([...(d.base ?? []), ...found])] : found });
      }
    }
    if (d?.mode === "hill" && p) {
      const b = toM(p.x, p.y), dragged = Math.hypot(p.x - d.sx, p.y - d.sy) >= 6;
      addLand([[d.ax, d.ay]], dragged ? Math.hypot(b.x - d.ax, b.y - d.ay) : uiRef.current.landSize); // (a click: the usual size)
    }
    if (d?.mode === "slope" && p && Math.hypot(p.x - d.sx, p.y - d.sy) >= 6) { const b = toM(p.x, p.y); addLand([[d.ax, d.ay], [b.x, b.y]], 0); }
    if (d?.mode === "battlebox" && p) {
      const b = toM(p.x, p.y), spec = metaRef.current?.city, rect = { x: Math.min(d.ax, b.x), y: Math.min(d.ay, b.y), w: Math.abs(b.x - d.ax), h: Math.abs(b.y - d.ay) };
      // a click, as on the world map: 30 x 20 squares round the spot; a drag: the box dragged
      if (spec && Math.hypot(p.x - d.sx, p.y - d.sy) < 5) void makeBattle(cityBattleBoxAt(d.ax, d.ay, spec));
      else if (spec && rect.w >= 6 && rect.h >= 6) void makeBattle(rect);
    }
    if (d?.mode === "rect" && p) {
      const o = uiRef.current, b = toM(p.x, p.y);
      if (Math.hypot(p.x - d.sx, p.y - d.sy) < 4) addBuilding(rectPolygon(d.ax, d.ay, DEFAULT_HOUSE.w, DEFAULT_HOUSE.h, o.angle)); // a click: the usual house
      else addBuilding(rectFromDrag(d.ax, d.ay, b.x, b.y, o.angle));
    }
    requestDraw();
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = local(e), v = viewRef.current;
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * Math.exp(-e.deltaY * 0.0015)));
    const mx = (p.x - v.ox) / v.scale, my = (p.y - v.oy) / v.scale;
    viewRef.current = { scale, ox: p.x - mx * scale, oy: p.y - my * scale };
    requestDraw();
  };

  const tool = ui.tool;
  const cursor = reading ? "crosshair" : traceMode === "move" && features.trace ? "move" : traceMode && features.trace ? "crosshair"
    : spaceDown || tool === "pan" ? (drag.current?.mode === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : tool === "ground" ? "none" : "crosshair";
  const spec = meta?.city;
  const counts = `${(features.buildings ?? []).length.toLocaleString()} buildings · ${(features.streets ?? []).length.toLocaleString()} streets`;
  return (
    <div className="mapview" ref={wrapRef}>
      <canvas
        ref={canvasRef} style={{ cursor }} data-testid="city-canvas"
        onMouseDown={noShiftTextSelect} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onPointerLeave={() => { pointer.current = null; setHover(null); requestDraw(); }}
        onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
      />
      <div className="mapview-status" data-testid="city-status">
        {hover ? <>x {hover.x.toFixed(1)} · y {hover.y.toFixed(1)} m · {hover.ground}{hover.land && <> · {hover.land}</>}</> : spec ? <>{spec.widthM} × {spec.heightM} m · {counts}</> : null}
        {hover && <> · {counts}</>}
      </div>
      <div className="map-buttons">
        <button onClick={() => setExportOpen(true)} title="Export the city as a picture (PNG), or tiles for very large sizes" data-testid="export-button">⤓ Export</button>
        <button onClick={() => { fittedFor.current = null; fit(); requestDraw(); }} title="Fit the whole city in the window (0)">⤢ Fit</button>
      </div>
      {exportOpen && meta?.city && <CityExportDialog meta={meta} names={ui.names} contours={ui.contours} prepare={prepareExport} paint={(t) => draw(t)} onClose={() => setExportOpen(false)} />}
      {meta && <TraceBar trace={features.trace} meta={meta} />}
      {(!meta || loadedId !== meta.id) && <div className="mapview-empty">Loading map…</div>}
    </div>
  );
}

/** A round length for the scale bar: 1, 2, 5 times a power of ten, at most `max` metres. */
function niceLength(max: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(0.1, max)));
  for (const m of [5, 2, 1]) if (m * p <= max) return m * p;
  return p;
}

