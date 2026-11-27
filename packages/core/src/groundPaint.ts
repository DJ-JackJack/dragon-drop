/**
 * Ground painted by hand on a world map (biome brushes; the person, 2026-11-25: "let the users paint the biomes they want themselves"). The climate
 * chooses the ground everywhere (biomeLook.ts); a painting puts a chosen kind of ground over that choice where the DM wants it: a pine forest in the
 * south, a desert the rain would never make, a moor on a hill.
 *
 * The painting is a grid over the map like the realms' (`features.groundCells`: a few map px a cell, run-length coded; realms.ts paints and codes it),
 * each cell holding a ground's code (`PAINTABLE_GROUNDS`) or 0 for "as the climate makes it". It is paint, not climate: the rain, the rivers and the
 * climate settings stay as they were. The server works it out per map pixel with the other derived layers (`groundPaintPlanes`: which ground, and how
 * much, with a soft edge and a broken boundary so it doesn't look blocky), and everything that reads the ground (the painter, the selection report, the
 * ruler's survey) applies it to the climate's weights with `applyPaintedGround`.
 */
import type { MapDoc } from "./doc.ts";
import type { RealmGrid } from "./features.ts";
import type { BiomeWeights } from "./biomeLook.ts";
import { decodeRealmCells, emptyRealmGrid } from "./realms.ts";

/**
 * The grounds a brush can paint, each with its code in the painting. Never renumber or reuse a code: saved maps hold them. The water's-edge grounds
 * (beach, reeds) follow the coast and the lakes by themselves, and stone and volcanic ground belong to climate regions.
 */
export const PAINTABLE_GROUNDS = [
  { code: 1, id: "tundra" }, { code: 2, id: "boreal" }, { code: 3, id: "temperate" }, { code: 4, id: "warm" }, { code: 5, id: "alpine" },
  { code: 6, id: "savanna" }, { code: 7, id: "steppe" }, { code: 8, id: "marsh" }, { code: 9, id: "jungle" }, { code: 10, id: "desert" },
  { code: 11, id: "rainforest" }, { code: 12, id: "cloud" }, { code: 13, id: "bamboo" }, { code: 14, id: "autumn" }, { code: 15, id: "chaparral" },
  { code: 16, id: "moor" }, { code: 17, id: "glacier" }, { code: 18, id: "badlands" }, { code: 19, id: "saltflat" }, { code: 20, id: "stony" },
  { code: 21, id: "mangrove" },
] as const;
export type PaintableGround = (typeof PAINTABLE_GROUNDS)[number]["id"];
const BY_CODE: (PaintableGround | undefined)[] = [];
for (const g of PAINTABLE_GROUNDS) BY_CODE[g.code] = g.id;
/** A ground's code (0 when it can't be painted). */
export const groundCode = (id: string): number => PAINTABLE_GROUNDS.find((g) => g.id === id)?.code ?? 0;
/** The ground of a code (undefined for 0 or a code this version doesn't know). */
export const groundOfCode = (code: number): PaintableGround | undefined => BY_CODE[code];

/** The painting for this map: its own, or an empty one when it has none (or one made for another size). */
export function groundGridOf(doc: Pick<MapDoc, "meta" | "features">): RealmGrid {
  const g = doc.features?.groundCells, e = emptyRealmGrid(doc.meta.width, doc.meta.height);
  return g && g.w === e.w && g.h === e.h && g.scale === e.scale ? g : e;
}

const hash = (x: number, y: number) => {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
/** A smooth value noise 0..1, `S` px across (the painted edge wanders with it). */
function wander(x: number, y: number, S: number): number {
  const gx = Math.floor(x / S), gy = Math.floor(y / S), fx = x / S - gx, fy = y / S - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(gx, gy), b = hash(gx + 1, gy), c = hash(gx, gy + 1), d = hash(gx + 1, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * The painting per map pixel: `code` (which ground, 0 none) and `weight` (0..255: how much it replaces the climate's ground, fading out over about a
 * cell and a half at the painting's edge). The boundary is broken up (each pixel looks a little way off, by a smooth noise), so a stroke's edge looks
 * like the edge of a wood or a desert, not a staircase of cells. Null when nothing is painted.
 */
export function groundPaintPlanes(doc: Pick<MapDoc, "meta" | "features">): { code: Uint8Array; weight: Uint8Array } | null {
  const raw = doc.features?.groundCells;
  if (!raw) return null;
  const g = groundGridOf(doc), cells = decodeRealmCells(g);
  if (!cells.some((v) => v)) return null;
  const W = doc.meta.width, H = doc.meta.height, gw = g.w, gh = g.h, s = g.scale;
  // how painted each cell is: 1 inside, a little less on the painting's edge, a little more than nothing just outside it
  const soft = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && cells[yy * gw + xx]) n++;
    }
    soft[y * gw + x] = cells[y * gw + x] ? (n >= 6 ? 1 : 0.8) : (n / 8) * 0.45;
  }
  const at = (x: number, y: number) => soft[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];
  // (cells within two of a painted one: only their pixels can be painted, so a big map's other millions of pixels cost nothing)
  const near = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!cells[y * gw + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) near[yy * gw + xx] = 1;
    }
  }
  const code = new Uint8Array(W * H), weight = new Uint8Array(W * H);
  const reach = s * 0.9, S = Math.max(4, s * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!near[Math.min(gh - 1, Math.floor(y / s)) * gw + Math.min(gw - 1, Math.floor(x / s))]) continue;
    // a little way off, by a smooth noise: the edge wanders
    const jx = x + 0.5 + (wander(x, y, S) - 0.5) * 2 * reach, jy = y + 0.5 + (wander(x + 7919, y + 104729, S) - 0.5) * 2 * reach;
    const fx = jx / s - 0.5, fy = jy / s - 0.5, cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
    const v = at(cx, cy) * (1 - tx) * (1 - ty) + at(cx + 1, cy) * tx * (1 - ty) + at(cx, cy + 1) * (1 - tx) * ty + at(cx + 1, cy + 1) * tx * ty;
    if (v < 0.02) continue;
    // the ground: the cell under the (moved) pixel, or the nearest painted one beside it at the painting's edge
    const nx = Math.min(gw - 1, Math.max(0, Math.floor(jx / s))), ny = Math.min(gh - 1, Math.max(0, Math.floor(jy / s)));
    let c = cells[ny * gw + nx];
    if (!c) {
      for (let r = 1; r <= 1 && !c; r++) for (let dy = -r; dy <= r && !c; dy++) for (let dx = -r; dx <= r && !c; dx++) {
        const xx = nx + dx, yy = ny + dy;
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) c = cells[yy * gw + xx];
      }
    }
    if (!c || !groundOfCode(c)) continue;
    const i = y * W + x;
    code[i] = c;
    weight[i] = Math.round(Math.min(1, v) * 255);
  }
  return { code, weight };
}

const BIOME_KEYS = ["tundra", "boreal", "temperate", "warm", "alpine", "savanna", "steppe", "marsh",
  "beach", "mangrove", "reeds", "glacier", "moor", "chaparral", "badlands", "saltflat", "stony", "rainforest", "cloud", "bamboo", "autumn"] as const;
/** Grounds that grow in patches among others (their base is left as it is). */
const PATCHY = new Set(["bamboo", "autumn", "moor"]);

/**
 * Put a painted ground (its code, at strength `k` 0..1) over the climate's weights: `bw` changed in place, `jd` = [jungle, desert] weights changed in place.
 * An ordinary ground replaces the climate's by `k`. Bamboo, autumn colour and moor grow in patches over what is there, so its ground stays under them.
 * Desert and stony desert set the desert's weight; a salt flat lies on pale straw, a glacier on tundra, as they do in nature.
 */
export function applyPaintedGround(code: number, k: number, bw: BiomeWeights, jd: number[]): void {
  const id = groundOfCode(code);
  if (!id || k <= 0) return;
  const w = bw as Record<string, number>;
  if (PATCHY.has(id)) { w[id] = Math.max(w[id], k); return; }
  const keep = 1 - k;
  for (const b of BIOME_KEYS) w[b] *= keep;
  jd[0] *= keep; jd[1] *= keep;
  if (id === "jungle") jd[0] += k;
  else if (id === "desert") jd[1] += k;
  else if (id === "stony") { jd[1] += k; w.stony += k; }
  else if (id === "saltflat") { w.saltflat += k; w.steppe += k; }
  else if (id === "glacier") { w.glacier += k; w.tundra += k; }
  else w[id] += k;
}

/** The planes of the painted ground (`groundPaintPlanes`), or none. */
export type GroundPlanes = { code: Uint8Array; weight: Uint8Array } | null;

/**
 * The box (map px) where two paintings' planes differ, code or weight, or null when they are the same; a missing painting counts as nothing painted. A
 * Ground stroke sends the editors only this part (docs/BRUSH-SPEED.md, stage 1).
 */
export function groundPlanesBox(a: GroundPlanes | undefined, b: GroundPlanes | undefined, W: number, H: number): { x: number; y: number; w: number; h: number } | null {
  const ac = a?.code, aw = a?.weight, bc = b?.code, bw = b?.weight;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let first = -1, last = -1;
    for (let x = 0; x < W; x++) {
      const i = o + x;
      if ((ac ? ac[i] : 0) !== (bc ? bc[i] : 0) || (aw ? aw[i] : 0) !== (bw ? bw[i] : 0)) { if (first < 0) first = x; last = x; }
    }
    if (first >= 0) { if (first < x0) x0 = first; if (last > x1) x1 = last; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The part `rect` of the planes, code then weight (rect.w * rect.h bytes each), for the editors' `ground` frame. */
export function cropGroundPlanes(p: GroundPlanes, W: number, rect: { x: number; y: number; w: number; h: number }): Uint8Array {
  const n = rect.w * rect.h, out = new Uint8Array(2 * n);
  if (!p) return out;
  for (let y = 0; y < rect.h; y++) {
    const from = (rect.y + y) * W + rect.x;
    out.set(p.code.subarray(from, from + rect.w), y * rect.w);
    out.set(p.weight.subarray(from, from + rect.w), n + y * rect.w);
  }
  return out;
}
