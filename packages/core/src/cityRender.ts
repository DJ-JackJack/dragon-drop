/**
 * A city map as a picture (for Claude's previews and for exports): the ground (in the climate's colours, shaded by the land), the contour lines, the streets, the trees, then the
 * buildings drawn as roofs (with snow on them in the cold), then the city walls with their towers and gates. The editor draws the same things as vectors on its canvas (CityView), with the same colours (`buildingColour`,
 * `cityGroundColours`, `treeColour`).
 */
import { type MapDoc } from "./doc.ts";
import { MATERIALS } from "./battle.ts";
import { type LookImage, lookKit } from "./battleLook.ts";
import { type RoofTileSource, paintRoofsInto } from "./battleRoof.ts";
import { type CitySpec, buildingToRoof, citySpec } from "./city.ts";
import { type LandGrid, cityClimate, cityGroundColours, contourLines, landGrid, landShade, snowCover, treeColour, treeCrowns } from "./cityLand.ts";
import { pointInPolygon } from "./geom.ts";
import { BRIDGE_COLOURS, type BridgeSpan, cityBridges, deckDistance } from "./cityBridges.ts";
import { WALL_COLOURS, type WallPieces, cityWallPieces } from "./cityWalls.ts";
import { type Rect, distToSegment } from "./geom.ts";
import { type RGBAImage, drawLabel } from "./render.ts";
import { textWidth } from "./font.ts";
import { polygonCentroid } from "./regions.ts";

const { clamp, vnoise, over } = lookKit;

export interface CityRenderOptions {
  /** The part of the city to draw, in metres (default: all of it). */
  region?: Rect;
  /** The longest side of the picture in pixels (default 1024). */
  maxSize?: number;
  /** Leave the buildings out (to see the ground and streets). */
  buildings?: boolean;
  /** The decoded roof pictures of the asset packs, by asset id (a building with a roof picture is drawn with it, or with its look when this has none for it). */
  tileFor?: RoofTileSource;
  /** Draw the contour lines (default: yes, when the city has any land). */
  contours?: boolean;
  /** Leave the trees out. */
  trees?: boolean;
}

export interface CityRender {
  img: RGBAImage;
  /** Pixels per metre. */
  px: number;
  /** The part of the city the picture shows, in metres (the region asked for, clipped to the map and to whole pixels). */
  region: Rect;
}

/** The street surface and its edge. */
export const STREET_SURFACE: [number, number, number] = [206, 196, 170];
export const STREET_EDGE: [number, number, number] = [96, 88, 74];

/** Pixels per metre for a picture of `maxSize` px showing a region of w x h metres (at most 20: a house of 6 m is then 120 px, as close as a preview needs to go). */
export function cityPx(w: number, h: number, maxSize: number): number {
  return Math.min(20, Math.max(0.01, maxSize / Math.max(w, h)));
}

/** Draw the city (or a region of it). */
export function renderCity(doc: MapDoc, o: CityRenderOptions = {}): CityRender {
  const spec = citySpec(doc);
  const want = o.region ?? { x: 0, y: 0, w: spec.widthM, h: spec.heightM };
  const rx = Math.max(0, Math.min(spec.widthM - 1, want.x)), ry = Math.max(0, Math.min(spec.heightM - 1, want.y));
  const rw = Math.max(1, Math.min(spec.widthM - rx, want.w)), rh = Math.max(1, Math.min(spec.heightM - ry, want.h));
  const px = cityPx(rw, rh, o.maxSize ?? 1024);
  const OX = Math.round(rx * px), OY = Math.round(ry * px);
  const W = Math.max(1, Math.round(rw * px)), H = Math.max(1, Math.round(rh * px));
  const img: LookImage = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  const land = landGrid(doc);
  paintGround(doc, spec, img, OX, OY, px, land);
  if (land && o.contours !== false) paintContours(land, img, OX, OY, px);
  paintStreets(doc, img, OX, OY, px);
  paintBridges(cityBridges(spec, doc.height, doc.features?.streets ?? []), img, OX, OY, px);
  if (o.trees !== false) paintTrees(doc, spec, img, OX, OY, px);
  if (o.buildings !== false) {
    const have = (a: string) => !!o.tileFor?.(a);
    const shown = (doc.features?.buildings ?? []).filter((b) => touches(b.points, OX / px, OY / px, (OX + W) / px, (OY + H) / px));
    const roofs = shown.map((b) => buildingToRoof(b, b.asset ? have(b.asset) : true));
    paintRoofsInto(img, OX, OY, Math.round(spec.widthM * px), Math.round(spec.heightM * px), px, roofs, { shadow: px >= 0.6, ...(o.tileFor && { tileFor: o.tileFor }) });
    const snow = snowCover(cityClimate(spec));
    if (snow > 0) for (const b of shown) fillPolygon(img, b.points, OX, OY, px, SNOW, snow * 0.55);
  }
  paintWalls(cityWallPieces(doc.features?.cityWalls, doc.features?.streets), img, OX, OY, px);
  return { img, px, region: { x: OX / px, y: OY / px, w: W / px, h: H / px } };
}

function touches(points: [number, number][], x0: number, y0: number, x1: number, y1: number): boolean {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of points) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return c >= x0 - 2 && a <= x1 + 2 && d >= y0 - 2 && b <= y1 + 2;
}

const SNOW: [number, number, number] = [236, 241, 247];

function paintGround(doc: MapDoc, spec: CitySpec, img: LookImage, OX: number, OY: number, px: number, land: LandGrid | null) {
  const cols = cityGroundColours(cityClimate(spec)), grass = cols[5] ?? MATERIALS[5].colour;
  const { w: cw, h: ch, data } = doc.height, cell = spec.cellM;
  const shade = land ? landShade(land) : null;
  const colour = (cx: number, cy: number): [number, number, number] => {
    const i = Math.max(0, Math.min(ch - 1, cy)) * cw + Math.max(0, Math.min(cw - 1, cx)), c = cols[Math.round(data[i])] ?? grass;
    if (!shade) return c;
    const k = shade[i];
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  const d = img.data;
  for (let y = 0; y < img.h; y++) {
    const my = (OY + y + 0.5) / px, v = my / cell - 0.5, y0 = Math.floor(v), fy = v - y0;
    for (let x = 0; x < img.w; x++) {
      const mx = (OX + x + 0.5) / px, u = mx / cell - 0.5, x0 = Math.floor(u), fx = u - x0;
      // the four nearest cells blended, so the edge between two grounds is soft rather than blocky
      const a = colour(x0, y0), b = colour(x0 + 1, y0), c = colour(x0, y0 + 1), e = colour(x0 + 1, y0 + 1);
      const n = 0.96 + 0.08 * vnoise(mx / 3, my / 3); // (a little mottling, on the scale of a few metres)
      const o = (y * img.w + x) * 4;
      for (let k = 0; k < 3; k++) d[o + k] = clamp(((a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + e[k] * fx) * fy) * n, 0, 255);
      d[o + 3] = 255;
    }
  }
}

/** A thin line (anti-aliased by its sub-pixel position) laid over the picture. */
function lineOver(img: LookImage, x0: number, y0: number, x1: number, y1: number, col: readonly number[], alpha: number) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 1.5));
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n - 0.5, y = y0 + ((y1 - y0) * k) / n - 0.5, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
      const X = xi + dx, Y = yi + dy;
      if (X < 0 || Y < 0 || X >= img.w || Y >= img.h || w <= 0.02) continue;
      over(img.data, (Y * img.w + X) * 4, col[0], col[1], col[2], alpha * w * 0.7);
    }
  }
}

/** Contour lines: every interval faintly, every fifth a little stronger (the minor ones only once they are far enough apart to read). */
function paintContours(g: LandGrid, img: LookImage, OX: number, OY: number, px: number) {
  const c = contourLines(g), ink = [72, 54, 32];
  const draw = (segs: Float32Array, alpha: number) => {
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i] * px - OX, ay = segs[i + 1] * px - OY, bx = segs[i + 2] * px - OX, by = segs[i + 3] * px - OY;
      if (Math.max(ax, bx) < -1 || Math.min(ax, bx) > img.w + 1 || Math.max(ay, by) < -1 || Math.min(ay, by) > img.h + 1) continue;
      lineOver(img, ax, ay, bx, by, ink, alpha);
    }
  };
  if (c.interval * px >= 3) draw(c.minor, 0.3);
  draw(c.major, 0.55);
}

/** Trees: a soft shadow down and to the right, then the crown, lit from the top left. */
function paintTrees(doc: MapDoc, spec: CitySpec, img: LookImage, OX: number, OY: number, px: number) {
  const trees = doc.features?.trees ?? [];
  if (!trees.length) return;
  const climate = cityClimate(spec), d = img.data;
  const x0m = OX / px, y0m = OY / px, x1m = (OX + img.w) / px, y1m = (OY + img.h) / px;
  for (const t of trees) {
    if (!touches(t.points, x0m - 20, y0m - 20, x1m + 20, y1m + 20)) continue;
    for (const c of treeCrowns(t, climate)) {
      const sx = c.x * px - OX, sy = c.y * px - OY, r = Math.max(0.6, c.r * px);
      if (sx + r * 1.4 < 0 || sy + r * 1.4 < 0 || sx - r > img.w || sy - r > img.h) continue;
      const col = treeColour(c.species, climate, c.tone), off = r * 0.35;
      for (let pass = 0; pass < 2; pass++) {
        const cx = pass ? sx : sx + off, cy = pass ? sy : sy + off;
        const X0 = Math.max(0, Math.floor(cx - r - 1)), X1 = Math.min(img.w - 1, Math.ceil(cx + r + 1)), Y0 = Math.max(0, Math.floor(cy - r - 1)), Y1 = Math.min(img.h - 1, Math.ceil(cy + r + 1));
        for (let y = Y0; y <= Y1; y++) {
          for (let x = X0; x <= X1; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dist = Math.hypot(dx, dy), a = clamp(r - dist + 0.5, 0, 1);
            if (a <= 0) continue;
            const o = (y * img.w + x) * 4;
            if (!pass) { over(d, o, 0, 0, 0, a * 0.26); continue; }
            const lit = 1 + 0.28 * clamp(-(dx + dy) / (r * 1.4), -1, 1) - (c.species === "conifer" ? 0.12 * clamp(dist / r, 0, 1) : 0);
            over(d, o, clamp(col[0] * lit, 0, 255), clamp(col[1] * lit, 0, 255), clamp(col[2] * lit, 0, 255), a);
          }
        }
      }
    }
  }
}

/**
 * Bridges over the streets where they cross water: the shadow on the water, stone piers (with pointed cutwaters, sticking out beyond the deck) or wooden posts, then the deck
 * between its low walls or railings. A ford is the street seen through shallow water.
 */
function paintBridges(spans: BridgeSpan[], img: LookImage, OX: number, OY: number, px: number) {
  const d = img.data, C = BRIDGE_COLOURS;
  for (const b of spans) {
    const half = b.width / 2, wall = b.kind === "stone" ? Math.max(0.45, b.width * 0.07) : Math.max(0.3, b.width * 0.05), reach = half + wall + 2.5;
    let a = Infinity, c = -Infinity, e = Infinity, f = -Infinity;
    for (const [x, y] of b.points) { if (x < a) a = x; if (x > c) c = x; if (y < e) e = y; if (y > f) f = y; }
    const X0 = Math.max(0, Math.floor((a - reach) * px - OX)), X1 = Math.min(img.w - 1, Math.ceil((c + reach) * px - OX));
    const Y0 = Math.max(0, Math.floor((e - reach) * px - OY)), Y1 = Math.min(img.h - 1, Math.ceil((f + reach) * px - OY));
    if (X0 > X1 || Y0 > Y1) continue;
    const at = (x: number, y: number) => [(OX + x + 0.5) / px, (OY + y + 0.5) / px] as const;
    if (b.kind === "ford") {
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const [mx, my] = at(x, y), k = clamp((half - deckDistance(mx, my, b.points)) * px + 0.5, 0, 1);
        if (k > 0) over(d, (y * img.w + x) * 4, C.ford[0], C.ford[1], C.ford[2], k * 0.55);
      }
      continue;
    }
    // the shadow on the water, down and to the right
    const sh = Math.max(0.8, b.width * 0.15), shPts = b.points.map(([x, y]) => [x + sh, y + sh] as [number, number]);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const [mx, my] = at(x, y), k = clamp((half + wall - deckDistance(mx, my, shPts)) * px + 0.5, 0, 1);
      if (k > 0) over(d, (y * img.w + x) * 4, 0, 0, 0, k * 0.3);
    }
    // stone piers: a block across the deck with a point at each end, in the water
    for (const p of b.piers) {
      const ca = Math.cos(p.angle), sa = Math.sin(p.angle), across = half + wall + 1.8, thick = Math.max(1.3, b.width * 0.16);
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const [mx, my] = at(x, y), u = (mx - p.x) * ca + (my - p.y) * sa, v = -(mx - p.x) * sa + (my - p.y) * ca;
        // (a diamond-ended block: inside when |u| fits the thickness, narrowing to a point over the last metre at each end)
        const room = across + 1 - Math.abs(v), w = Math.min(thick / 2, room * (thick / 2));
        if (Math.abs(u) <= w) over(d, (y * img.w + x) * 4, C.stonePier[0], C.stonePier[1], C.stonePier[2], 1);
      }
    }
    // the deck between its walls or railings
    const edge = b.kind === "stone" ? C.stoneWall : C.woodRail, deck = b.kind === "stone" ? C.stoneDeck : C.woodDeck;
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const [mx, my] = at(x, y), dist = deckDistance(mx, my, b.points), o = (y * img.w + x) * 4;
      const outer = clamp((half + wall - dist) * px + 0.5, 0, 1);
      if (outer <= 0) continue;
      over(d, o, edge[0], edge[1], edge[2], outer);
      const inner = clamp((half - wall * 0.4 - dist) * px + 0.5, 0, 1);
      if (inner > 0) over(d, o, deck[0], deck[1], deck[2], inner);
    }
    for (const [x, y] of b.posts) {
      const sx = x * px - OX, sy = y * px - OY, r = Math.max(0.6, 0.3 * px);
      for (let yy = Math.max(0, Math.floor(sy - r)); yy <= Math.min(img.h - 1, Math.ceil(sy + r)); yy++) for (let xx = Math.max(0, Math.floor(sx - r)); xx <= Math.min(img.w - 1, Math.ceil(sx + r)); xx++) over(d, (yy * img.w + xx) * 4, C.woodRail[0], C.woodRail[1], C.woodRail[2], 1);
    }
  }
}

/**
 * City walls: an earth rampart's ditch (outside a ring), the shadow, the wall (its edge, its top, a stone wall's wall-walk or a rampart's crest), then the towers (round with a
 * roof, or square). The gates are the gaps the streets pass through, flanked by a gatehouse's towers.
 */
function paintWalls(walls: WallPieces[], img: LookImage, OX: number, OY: number, px: number) {
  const C = WALL_COLOURS, d = img.data, W = img.w, H = img.h;
  for (const w of walls) {
    if (!w.stretches.length && !w.towers.length) continue;
    const t = w.thickness, half = t / 2, edgeM = Math.max(0.35, 0.8 / px), sh = Math.max(0.6, t * 0.3), ditch = w.kind === "earth" ? t * 0.7 : 0;
    const top = w.kind === "stone" ? C.stoneTop : w.kind === "palisade" ? C.woodTop : C.earthBank, edge = w.kind === "stone" ? C.stoneEdge : w.kind === "palisade" ? C.woodEdge : C.earthEdge;
    // the distance of every pixel near the wall to its middle line (metres)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of w.stretches) for (const [x, y] of s.points) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (const q of w.towers) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const reach = half + ditch + sh + 2 + Math.max(0, ...w.towers.map((q) => q.r * 1.5));
    const X0 = Math.max(0, Math.floor((x0 - reach) * px - OX)), X1 = Math.min(W - 1, Math.ceil((x1 + reach) * px - OX));
    const Y0 = Math.max(0, Math.floor((y0 - reach) * px - OY)), Y1 = Math.min(H - 1, Math.ceil((y1 + reach) * px - OY));
    if (X0 > X1 || Y0 > Y1) continue;
    const bw = X1 - X0 + 1, bh = Y1 - Y0 + 1, dist = new Float32Array(bw * bh).fill(Infinity);
    for (const s of w.stretches) {
      const pts = s.points, n = pts.length, sides = s.closed ? n : n - 1;
      for (let i = 0; i < sides; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], r = half + ditch + 1 / px;
        const sx0 = Math.max(X0, Math.floor((Math.min(ax, bx) - r) * px - OX)), sx1 = Math.min(X1, Math.ceil((Math.max(ax, bx) + r) * px - OX));
        const sy0 = Math.max(Y0, Math.floor((Math.min(ay, by) - r) * px - OY)), sy1 = Math.min(Y1, Math.ceil((Math.max(ay, by) + r) * px - OY));
        // (an open stretch ends square at a gate or at the wall's end: past its first or last point nothing is drawn)
        const cutStart = !s.closed && i === 0, cutEnd = !s.closed && i === sides - 1, ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1e-9;
        for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
          const mx = (OX + x + 0.5) / px, my = (OY + y + 0.5) / px;
          if (cutStart || cutEnd) { const f = ((mx - ax) * ex + (my - ay) * ey) / l2; if ((cutStart && f < 0) || (cutEnd && f > 1)) continue; }
          const k = (y - Y0) * bw + (x - X0), dd = distToSegment(mx, my, ax, ay, bx, by);
          if (dd < dist[k]) dist[k] = dd;
        }
      }
    }
    const cover = (inside: number) => clamp(inside * px + 0.5, 0, 1);
    // an earth rampart's ditch, outside a ring
    if (ditch > 0 && w.ring) {
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const dd = dist[(y - Y0) * bw + (x - X0)];
        if (dd <= half - 0.5 || dd >= half + ditch + 1) continue;
        if (pointInPolygon((OX + x + 0.5) / px, (OY + y + 0.5) / px, w.ring)) continue;
        over(d, (y * W + x) * 4, C.ditch[0], C.ditch[1], C.ditch[2], 0.75 * cover(half + ditch - dd));
      }
    }
    // the shadow, down and to the right
    const shp = Math.round(sh * px);
    if (shp >= 1) for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const sx = x - shp, sy = y - shp;
      if (sx < X0 || sy < Y0) continue;
      const a = cover(half - dist[(sy - Y0) * bw + (sx - X0)]);
      if (a > 0) over(d, (y * W + x) * 4, 0, 0, 0, a * 0.28);
    }
    // the wall: its edge, its top, and down the middle the wall-walk (stone) or the crest (earth)
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const dd = dist[(y - Y0) * bw + (x - X0)], o = (y * W + x) * 4, a = cover(half - dd);
      if (a <= 0) continue;
      over(d, o, edge[0], edge[1], edge[2], a);
      const b = cover(half - edgeM - dd);
      if (b > 0) over(d, o, top[0], top[1], top[2], b);
      if (w.kind === "stone") { const c = cover(t * 0.2 - dd); if (c > 0) over(d, o, C.stoneWalk[0], C.stoneWalk[1], C.stoneWalk[2], c); }
      if (w.kind === "earth") { const c = cover(t * 0.14 - dd); if (c > 0) over(d, o, C.earthCrest[0], C.earthCrest[1], C.earthCrest[2], c); }
    }
    // the towers
    for (const q of w.towers) {
      const cx = q.x * px - OX, cy = q.y * px - OY, R = q.r * px * (q.square ? 1.42 : 1) + 2;
      const tx0 = Math.max(0, Math.floor(cx - R)), tx1 = Math.min(W - 1, Math.ceil(cx + R + sh * px)), ty0 = Math.max(0, Math.floor(cy - R)), ty1 = Math.min(H - 1, Math.ceil(cy + R + sh * px));
      const ca = Math.cos(q.angle), sa = Math.sin(q.angle);
      /** How far inside the tower a point is (metres; negative outside). */
      const inside = (mx: number, my: number) => {
        const ux = mx - q.x, uy = my - q.y;
        if (!q.square) return q.r - Math.hypot(ux, uy);
        return q.r - Math.max(Math.abs(ux * ca + uy * sa), Math.abs(-ux * sa + uy * ca));
      };
      const body = w.kind === "palisade" ? C.woodTower : C.stoneTower, roof = w.kind === "palisade" ? C.woodEdge : C.stoneRoof;
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const mx = (OX + x + 0.5) / px, my = (OY + y + 0.5) / px, o = (y * W + x) * 4;
        const s = cover(inside(mx - sh, my - sh));
        if (s > 0) over(d, o, 0, 0, 0, s * 0.28);
        const k = inside(mx, my), a = cover(k);
        if (a <= 0) continue;
        over(d, o, edge[0], edge[1], edge[2], a);
        const b = cover(k - edgeM);
        if (b > 0) over(d, o, body[0], body[1], body[2], b);
        // a round tower's roof (lit from the top left), a square one's flat top inside its parapet
        const rr = cover(k - q.r * 0.3);
        if (rr > 0) {
          const lit = q.square ? 1 : 1 + 0.25 * clamp(-((mx - q.x) + (my - q.y)) / (q.r * 1.2), -1, 1);
          over(d, o, clamp(roof[0] * lit, 0, 255), clamp(roof[1] * lit, 0, 255), clamp(roof[2] * lit, 0, 255), rr * (q.square ? 0.35 : 0.9));
        }
      }
    }
  }
}

/** The names on a city, where they are (metres): its labels, then the named streets (at their middle), buildings (at their centre) and walls. For Claude's previews. */
export function cityNamesForPreview(doc: MapDoc): { text: string; x: number; y: number; big: boolean }[] {
  const f = doc.features, out: { text: string; x: number; y: number; big: boolean }[] = [];
  const middle = (pts: readonly (readonly number[])[]) => {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let d = total / 2;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= l && l > 0) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * d) / l, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * d) / l];
      d -= l;
    }
    return [pts[0][0], pts[0][1]];
  };
  for (const l of f?.labels ?? []) out.push({ text: l.text, x: l.x, y: l.y, big: l.kind === "region" || l.kind === "sea" });
  for (const s of f?.streets ?? []) if (s.name) { const [x, y] = middle(s.points); out.push({ text: s.name, x, y, big: false }); }
  for (const b of f?.buildings ?? []) if (b.name) { const [x, y] = polygonCentroid(b.points); out.push({ text: b.name, x, y, big: false }); }
  for (const w of f?.cityWalls ?? []) if (w.name) { const [x, y] = middle(w.points); out.push({ text: w.name, x, y, big: false }); }
  return out;
}

/** The city's names written over a picture of it (Claude's previews: small capitals with a dark halo, centred on where each name is). */
export function drawCityNames(img: RGBAImage, doc: MapDoc, region: Rect, px: number) {
  for (const n of cityNamesForPreview(doc)) {
    const sx = (n.x - region.x) * px, sy = (n.y - region.y) * px, k = n.big ? 2 : 1;
    if (sx < -200 || sy < -20 || sx > img.w + 200 || sy > img.h + 20) continue;
    drawLabel(img, n.text, Math.round(sx - textWidth(n.text, k) / 2), Math.round(sy - 3.5 * k), k);
  }
}

/** Fill a polygon (metres) over the picture, at `alpha`. */
function fillPolygon(img: LookImage, points: [number, number][], OX: number, OY: number, px: number, col: readonly number[], alpha: number) {
  let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
  for (const [x, y] of points) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > e) e = y; }
  const X0 = Math.max(0, Math.floor(a * px - OX)), X1 = Math.min(img.w - 1, Math.ceil(c * px - OX)), Y0 = Math.max(0, Math.floor(b * px - OY)), Y1 = Math.min(img.h - 1, Math.ceil(e * px - OY));
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      if (!pointInPolygon((OX + x + 0.5) / px, (OY + y + 0.5) / px, points)) continue;
      over(img.data, (y * img.w + x) * 4, col[0], col[1], col[2], alpha * (0.85 + 0.3 * vnoise((OX + x) / (px * 2.5), (OY + y) / (px * 2.5)) - 0.15));
    }
  }
}

function paintStreets(doc: MapDoc, img: LookImage, OX: number, OY: number, px: number) {
  const streets = doc.features?.streets ?? [];
  if (!streets.length) return;
  const fill = new Float32Array(img.w * img.h), edge = new Float32Array(img.w * img.h);
  const edgeM = Math.max(0.35, 0.8 / px); // (the edge line is at least about a pixel wide)
  for (const s of streets) {
    const half = s.width / 2;
    for (let i = 0; i + 1 < s.points.length; i++) {
      const [ax, ay] = s.points[i], [bx, by] = s.points[i + 1];
      const reach = half + edgeM + 1 / px;
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) * px - OX)), x1 = Math.min(img.w - 1, Math.ceil((Math.max(ax, bx) + reach) * px - OX));
      const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) * px - OY)), y1 = Math.min(img.h - 1, Math.ceil((Math.max(ay, by) + reach) * px - OY));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dist = distToSegment((OX + x + 0.5) / px, (OY + y + 0.5) / px, ax, ay, bx, by);
          const i2 = y * img.w + x;
          const f = clamp((half - dist) * px + 0.5, 0, 1), e = clamp((half + edgeM - dist) * px + 0.5, 0, 1);
          if (f > fill[i2]) fill[i2] = f;
          if (e > edge[i2]) edge[i2] = e;
        }
      }
    }
  }
  const d = img.data;
  for (let i = 0; i < fill.length; i++) {
    if (edge[i] <= 0) continue;
    over(d, i * 4, STREET_EDGE[0], STREET_EDGE[1], STREET_EDGE[2], edge[i] * 0.8);
    if (fill[i] > 0) over(d, i * 4, STREET_SURFACE[0], STREET_SURFACE[1], STREET_SURFACE[2], fill[i]);
  }
}
