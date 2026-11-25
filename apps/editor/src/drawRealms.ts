/**
 * Drawing the realms of a world map (core realms.ts): each realm's cells as a soft wash of its colour, its border traced round them (the battlemap's floor tracer,
 * traceWalls.ts, on the realm grid: smooth, with no stair steps) in a darker shade, and its name as a region label in its middle. The layer is worked out again
 * only for the realms that changed: a brush stroke retraces one realm, not every one.
 */
import { type Features, HeightField, LABEL_SIZE, type MapDoc, type MapLabel, type RealmGrid, decodeRealmCells, hexToRgb, realmNameSpot, traceFloorOutlines } from "@mapmaker/core";

type Pt = [number, number];
interface Layer {
  grid: RealmGrid;
  cells: Uint8Array;
  colours: string;
  fill: HTMLCanvasElement;
  outlines: Map<number, Pt[][]>;
  spots: Map<number, { x: number; y: number; reach: number } | null>;
  /** Each realm's cells. */
  counts: Map<number, number>;
}
let layer: Layer | null = null;

function outlinesOf(cells: Uint8Array, g: RealmGrid, n: number): Pt[][] {
  const mask = new Float32Array(g.w * g.h);
  for (let k = 0; k < mask.length; k++) if (cells[k] === n) mask[k] = 1;
  const doc = { meta: { battle: { squaresX: g.w, squaresY: g.h, sub: 1, pxPerSquare: 1, feetPerSquare: 5, gridType: "none" } }, height: new HeightField(g.w, g.h, mask) } as unknown as MapDoc;
  return traceFloorOutlines(doc, { minPerimeter: 3, tolerance: 0.3 }).map((poly) => poly.map(([x, y]) => [x * g.scale, y * g.scale] as Pt));
}

/** The realm layer for these features (null when there is nothing to draw), worked out again only where it changed. */
export function realmLayer(f: Features): Layer | null {
  const g = f.realmCells, realms = f.realms ?? [];
  if (!g || !realms.length) return null;
  const colours = realms.map((r) => `${r.n}${r.colour}`).join(",");
  if (layer && layer.grid === g && layer.colours === colours) return layer;
  const cells = decodeRealmCells(g);
  const same = !!layer && layer.grid.w === g.w && layer.grid.h === g.h && layer.grid.scale === g.scale;
  // which realms changed: their cells, or their colour
  const changed = new Set<number>();
  if (same) {
    const old = layer!.cells;
    for (let k = 0; k < cells.length; k++) if (cells[k] !== old[k]) { changed.add(cells[k]); changed.add(old[k]); }
  } else for (const r of realms) changed.add(r.n);
  const fill = same ? layer!.fill : document.createElement("canvas");
  if (!same) { fill.width = g.w; fill.height = g.h; }
  const colourOf = new Map(realms.map((r) => [r.n, hexToRgb(r.colour)]));
  const recolour = !same || layer!.colours !== colours;
  if (recolour || changed.size) {
    const c = fill.getContext("2d")!, img = c.createImageData(g.w, g.h), d = img.data;
    for (let k = 0; k < cells.length; k++) {
      const rgb = cells[k] ? colourOf.get(cells[k]) : undefined;
      if (!rgb) continue;
      d[k * 4] = rgb[0]; d[k * 4 + 1] = rgb[1]; d[k * 4 + 2] = rgb[2]; d[k * 4 + 3] = 82;
    }
    c.putImageData(img, 0, 0);
  }
  const outlines = same ? new Map(layer!.outlines) : new Map<number, Pt[][]>();
  const spots = same ? new Map(layer!.spots) : new Map<number, { x: number; y: number; reach: number } | null>();
  for (const r of realms) {
    if (outlines.has(r.n) && !changed.has(r.n)) continue;
    outlines.set(r.n, outlinesOf(cells, g, r.n));
    spots.set(r.n, realmNameSpot(cells, g, r.n));
  }
  const counts = new Map<number, number>();
  for (let k = 0; k < cells.length; k++) if (cells[k]) counts.set(cells[k], (counts.get(cells[k]) ?? 0) + 1);
  layer = { grid: g, cells, colours, fill, outlines, spots, counts };
  return layer;
}

/** The realms' wash and borders, under everything else drawn on the map. `v`: map px to screen px. */
export function drawRealms(ctx: CanvasRenderingContext2D, f: Features, v: { scale: number; ox: number; oy: number }) {
  const L = realmLayer(f);
  if (!L) return;
  const g = L.grid;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(L.fill, v.ox, v.oy, g.w * g.scale * v.scale, g.h * g.scale * v.scale);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.2, Math.min(3, v.scale * 1.4));
  for (const r of f.realms ?? []) {
    const polys = L.outlines.get(r.n);
    if (!polys?.length) continue;
    const [cr, cg, cb] = hexToRgb(r.colour);
    ctx.strokeStyle = `rgba(${Math.round(cr * 0.6)}, ${Math.round(cg * 0.6)}, ${Math.round(cb * 0.6)}, 0.9)`;
    ctx.globalAlpha = r.gmOnly ? 0.5 : 1;
    ctx.beginPath();
    for (const p of polys) {
      p.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy + y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy + y * v.scale)));
      ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The realms' names as region labels in their middles (sized to fit), for the labels pass. */
export function realmNameLabels(f: Features, mapWidth: number): MapLabel[] {
  const L = realmLayer(f);
  if (!L) return [];
  const out: MapLabel[] = [];
  for (const r of f.realms ?? []) {
    const s = L.spots.get(r.n);
    if (!s || r.hideName || !r.name.trim()) continue;
    // (as wide as about half the realm's size, but not much wider than the land round its middle)
    const unit = LABEL_SIZE.region * (mapWidth / 1024) * Math.max(3, r.name.length) * 0.95;
    const across = Math.sqrt(L.counts.get(r.n) ?? 0) * L.grid.scale;
    const size = Math.max(0.6, Math.min(2.4, Math.min(0.6 * across, 4 * s.reach) / unit));
    out.push({ id: `realm-${r.id}`, text: r.name, kind: "region", x: s.x, y: s.y, size: size * (r.nameSize ?? 1), ...(r.gmOnly && { gmOnly: true }) });
  }
  return out;
}
