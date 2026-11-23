/**
 * Printing a battlemap at table scale (1 inch a square by default) across sheets of US Letter or A4: which squares go on which page (whole squares, so the
 * pages join along grid lines), an assembly page first, and each page's picture, grid, corner marks for trimming and labels saying where it goes. The
 * server draws the pictures and writes the PDF (pdf.ts); the editor shows the page count before you download.
 */
import type { PdfOp, PdfPage } from "./pdf.ts";

export const PAPERS = {
  letter: { name: "US Letter", w: 8.5, h: 11 },
  a4: { name: "A4", w: 210 / 25.4, h: 297 / 25.4 },
} as const;
export type PaperId = keyof typeof PAPERS;

/** One page's part of the map, in squares. */
export interface PrintTile {
  label: string;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrintPlan {
  paper: PaperId;
  landscape: boolean;
  /** The sheet, in inches (as it lies). */
  pageW: number;
  pageH: number;
  /** The blank border every printer needs, inches. */
  margin: number;
  inchPerSquare: number;
  /** Squares across and down on each page. */
  perX: number;
  perY: number;
  cols: number;
  rows: number;
  tiles: PrintTile[];
}

/** The most pages a print may have (a map that big is better printed at a print shop from the PNG). */
export const MAX_PRINT_PAGES = 80;

const rowName = (r: number) => (r < 26 ? String.fromCharCode(65 + r) : String.fromCharCode(64 + Math.floor(r / 26)) + String.fromCharCode(65 + (r % 26)));

/** Which squares go on which page, in the orientation that needs fewer sheets (portrait when it's a tie). */
export function planPrint(squaresX: number, squaresY: number, o: { paper?: PaperId; inchPerSquare?: number; margin?: number } = {}): PrintPlan {
  const paper = o.paper && PAPERS[o.paper] ? o.paper : "letter", inch = Math.max(0.25, Math.min(3, o.inchPerSquare ?? 1)), margin = o.margin ?? 0.4;
  const layout = (landscape: boolean) => {
    const pw = landscape ? PAPERS[paper].h : PAPERS[paper].w, ph = landscape ? PAPERS[paper].w : PAPERS[paper].h;
    const perX = Math.max(1, Math.floor((pw - 2 * margin) / inch + 1e-9)), perY = Math.max(1, Math.floor((ph - 2 * margin - 0.35) / inch + 1e-9)); // (room below for the label)
    const cols = Math.ceil(squaresX / perX), rows = Math.ceil(squaresY / perY);
    return { landscape, pw, ph, perX, perY, cols, rows, pages: cols * rows };
  };
  const port = layout(false), land = layout(true);
  const best = land.pages < port.pages ? land : port;
  const tiles: PrintTile[] = [];
  for (let r = 0; r < best.rows; r++) for (let c = 0; c < best.cols; c++) {
    const x = c * best.perX, y = r * best.perY;
    tiles.push({ label: `${rowName(r)}${c + 1}`, row: r, col: c, x, y, w: Math.min(best.perX, squaresX - x), h: Math.min(best.perY, squaresY - y) });
  }
  return { paper, landscape: best.landscape, pageW: best.pw, pageH: best.ph, margin, inchPerSquare: inch, perX: best.perX, perY: best.perY, cols: best.cols, rows: best.rows, tiles };
}

/** "9 pages of US Letter, landscape (3 across, 3 down), and an assembly page". */
export function describePlan(p: PrintPlan): string {
  const n = p.tiles.length;
  return `${n} page${n === 1 ? "" : "s"} of ${PAPERS[p.paper].name}, ${p.landscape ? "landscape" : "portrait"} (${p.cols} across, ${p.rows} down), and an assembly page`;
}

/** A JPEG of part of the map (or all of it), with its pixel size. */
export interface PrintPicture { jpeg: Uint8Array; pw: number; ph: number }

/** A line on the map (squares), for the ink-saving look: walls drawn again dark over the lightened picture. */
export interface PrintLine { points: [number, number][]; kind: "wall" | "door" | "window" }

/**
 * The PDF's pages: the assembly page, then a page for each tile with its picture at scale, the grid (when asked), the walls again (ink saver), corner
 * marks to trim along and labels. `tile` gives each tile's picture, `overview` the whole map's.
 */
export function printPages(plan: PrintPlan, o: {
  title: string; feetPerSquare: number; squaresX: number; squaresY: number; overview: PrintPicture; tile: (t: PrintTile) => PrintPicture; grid?: boolean; walls?: PrintLine[];
}): PdfPage[] {
  const PT = 72, W = plan.pageW * PT, H = plan.pageH * PT, m = plan.margin * PT, sq = plan.inchPerSquare * PT;
  const scale = `1 inch = ${trim(o.feetPerSquare / plan.inchPerSquare)} ft`;
  const pages: PdfPage[] = [];

  // the assembly page: the whole map with the pages laid over it
  {
    const ops: PdfOp[] = [];
    const top = H - m;
    ops.push({ t: "text", x: m, y: top - 14, size: 15, text: o.title });
    ops.push({ t: "text", x: m, y: top - 32, size: 9.5, gray: 0.25, text: `${describePlan(plan)}. ${scale} (one square a ${trim(plan.inchPerSquare)} inch). Print at actual size (100%, not "fit to page").` });
    ops.push({ t: "text", x: m, y: top - 46, size: 9.5, gray: 0.25, text: "Trim each page along its corner marks, then tape the pages edge to edge as laid out below. Each page says which pages join it." });
    const boxW = W - 2 * m, boxH = top - 60 - m;
    const k = Math.min(boxW / o.squaresX, boxH / o.squaresY);
    const ox = m + (boxW - o.squaresX * k) / 2, oy = m + (boxH - o.squaresY * k) / 2 + o.squaresY * k; // (top-left of the map, PDF y up)
    ops.push({ t: "image", jpeg: o.overview.jpeg, pw: o.overview.pw, ph: o.overview.ph, x: ox, y: oy - o.squaresY * k, w: o.squaresX * k, h: o.squaresY * k });
    for (const t of plan.tiles) {
      const x = ox + t.x * k, y = oy - (t.y + t.h) * k;
      ops.push({ t: "rect", x, y, w: t.w * k, h: t.h * k, width: 1.2, gray: 0.1 });
      ops.push({ t: "text", x: x + 4, y: y + t.h * k - 13, size: Math.max(7, Math.min(14, t.h * k * 0.25)), text: t.label, gray: 0.05 });
    }
    pages.push({ w: W, h: H, ops });
  }

  const byPos = new Map(plan.tiles.map((t) => [`${t.row},${t.col}`, t]));
  for (const t of plan.tiles) {
    const ops: PdfOp[] = [];
    const pic = o.tile(t);
    const tw = t.w * sq, th = t.h * sq, x0 = m, y0 = H - m - th; // (the picture's bottom-left, PDF y up)
    ops.push({ t: "image", jpeg: pic.jpeg, pw: pic.pw, ph: pic.ph, x: x0, y: y0, w: tw, h: th });
    const toPdf = (sx: number, sy: number): [number, number] => [x0 + (sx - t.x) * sq, y0 + th - (sy - t.y) * sq];
    if (o.walls?.length) {
      for (const w of o.walls) {
        const style = w.kind === "wall" ? { width: 0.06 * PT, gray: 0.08 } : w.kind === "door" ? { width: 0.035 * PT, gray: 0.15, dash: [3, 2] } : { width: 0.02 * PT, gray: 0.35 };
        for (let i = 1; i < w.points.length; i++) {
          const seg = clip(w.points[i - 1], w.points[i], t);
          if (!seg) continue;
          const [a, b] = seg, [x1, y1] = toPdf(a[0], a[1]), [x2, y2] = toPdf(b[0], b[1]);
          ops.push({ t: "line", x1, y1, x2, y2, ...style });
        }
      }
    }
    if (o.grid) {
      for (let i = 0; i <= t.w; i++) ops.push({ t: "line", x1: x0 + i * sq, y1: y0, x2: x0 + i * sq, y2: y0 + th, width: 0.45, gray: 0.4 });
      for (let j = 0; j <= t.h; j++) ops.push({ t: "line", x1: x0, y1: y0 + j * sq, x2: x0 + tw, y2: y0 + j * sq, width: 0.45, gray: 0.4 });
    }
    // corner marks: trim along them (short lines in the margin, clear of the picture)
    const L = 0.22 * PT, g = 3;
    for (const [cx, cy, dx, dy] of [[x0, y0, -1, -1], [x0 + tw, y0, 1, -1], [x0, y0 + th, -1, 1], [x0 + tw, y0 + th, 1, 1]] as const) {
      ops.push({ t: "line", x1: cx + dx * g, y1: cy, x2: cx + dx * (g + L), y2: cy, width: 0.6, gray: 0 });
      ops.push({ t: "line", x1: cx, y1: cy + dy * g, x2: cx, y2: cy + dy * (g + L), width: 0.6, gray: 0 });
    }
    // which pages join this one
    const near = (dr: number, dc: number) => byPos.get(`${t.row + dr},${t.col + dc}`)?.label;
    const up = near(-1, 0), down = near(1, 0), left = near(0, -1), right = near(0, 1);
    if (up) ops.push({ t: "text", x: x0 + tw / 2 - 12, y: y0 + th + 8, size: 7.5, gray: 0.35, text: `${up} above` });
    if (down) ops.push({ t: "text", x: x0 + tw / 2 - 12, y: y0 - 14, size: 7.5, gray: 0.35, text: `${down} below` });
    if (left) ops.push({ t: "text", x: 2, y: y0 + th / 2, size: 7.5, gray: 0.35, text: left });
    if (right) ops.push({ t: "text", x: Math.min(W - 18, x0 + tw + 6), y: y0 + th / 2, size: 7.5, gray: 0.35, text: right });
    ops.push({ t: "text", x: m, y: Math.max(8, y0 - 28), size: 8.5, gray: 0.2, text: `${t.label}: row ${t.row + 1} of ${plan.rows}, column ${t.col + 1} of ${plan.cols}. ${o.title}. ${scale}.` });
    pages.push({ w: W, h: H, ops });
  }
  return pages;
}

const trim = (v: number) => String(Math.round(v * 100) / 100);

/** A segment clipped to a tile (squares), or null when none of it is on the tile. */
function clip(a: [number, number], b: [number, number], t: PrintTile): [[number, number], [number, number]] | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - t.x], [dx, t.x + t.w - a[0]], [-dy, a[1] - t.y], [dy, t.y + t.h - a[1]]] as const) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

/** The ink-saving look: colours greyed and lightened (in place), so a printer lays down little ink; the walls are drawn again dark over it. */
export function inkSaver(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], l = 0.3 * r + 0.59 * g + 0.11 * b;
    for (let k = 0; k < 3; k++) {
      const c = (data[i + k] + l) / 2; // (half grey)
      data[i + k] = 255 - (255 - c) * 0.38;
    }
  }
}
