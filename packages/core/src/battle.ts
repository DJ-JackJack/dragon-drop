/**
 * Battlemaps: a grid-based tabletop map (rooms, floors, walls, doors, lights).
 *
 * It reuses the map document: the heightfield holds the floor material of each sub-cell
 * (value = material id), and walls and lights live with the other features. Wall and light
 * coordinates are in grid SQUARES (floats), which is also what the VTT exports use.
 */
import type { MapDoc } from "./doc.ts";
import { HeightField } from "./doc.ts";
import { type PaletteEntry, CUSTOM_MATERIAL_BASE, PROP_PX_PER_SQUARE } from "./assets.ts";
import { type Features, type MapAmbientZone, type MapLight, type MapProp, type MapWall, emptyFeatures, wallSegments } from "./features.ts";
import { lightVisibility, visibleDistance } from "./lighting.ts";
import { boxBlur, compositeOver, renderWallLayer } from "./battleLook.ts";
import { drawBattleNotes } from "./battleNotes.ts";
import { foundryScene } from "./foundryScene.ts";
import { type Rect, type Shape, clipRect, expandRect, shapeBounds, signedDistance } from "./geom.ts";

export type BattleGridType = "square" | "hex" | "none";

export interface BattleSpec {
  squaresX: number;
  squaresY: number;
  /** Image pixels per grid square. */
  pxPerSquare: number;
  /** In-game feet per square (5 for D&D). */
  feetPerSquare: number;
  /** Floor cells per square, each way (the floor is painted at this finer resolution). */
  sub: number;
  gridType: BattleGridType;
  /** Pack textures available as floor materials (ids from CUSTOM_MATERIAL_BASE up). */
  palette?: PaletteEntry[];
  /**
   * How bright the map is where no light reaches, 0.05..1 (default 1: everything bright, lights only add a glow).
   * Lower it for a dim or dark scene: only what the lights reach shows in full. Shown in the editor and in renders;
   * never baked into the exported background image (the tabletop does its own lighting).
   */
  ambient?: number;
  /** "#rrggbb": the colour of the ambient light where no light reaches (dawn pink, dusk orange, night blue). Only shows when the map is dimmed. */
  ambientTint?: string;
}

/** Named light levels for the ambient setting. */
export const AMBIENT_PRESETS = { bright: 1, dim: 0.55, dark: 0.25 } as const;
export type AmbientPreset = keyof typeof AMBIENT_PRESETS;

/** Light presets: a level and, for times of day, a colour. */
export const LIGHT_PRESETS = {
  bright: { ambient: 1 },
  dawn: { ambient: 0.8, tint: "#ffb08a" },
  dusk: { ambient: 0.6, tint: "#ff8f5a" },
  dim: { ambient: 0.55 },
  night: { ambient: 0.25, tint: "#5b73c9" },
  dark: { ambient: 0.25 },
} as const;
export type LightPresetName = keyof typeof LIGHT_PRESETS;
export const LIGHT_PRESET_NAMES = Object.keys(LIGHT_PRESETS) as LightPresetName[];

/** The preset a map's level and tint match, or null (a custom setting). */
export function lightPresetName(spec: { ambient?: number; ambientTint?: string }): LightPresetName | null {
  const a = ambientOf(spec), t = spec.ambientTint?.toLowerCase();
  for (const k of LIGHT_PRESET_NAMES) {
    const p = LIGHT_PRESETS[k] as { ambient: number; tint?: string };
    if (Math.abs(p.ambient - a) < 0.02 && (p.tint?.toLowerCase() ?? undefined) === t) return k;
  }
  return null;
}

/** The map settings that make a preset: bright removes both fields. */
export function applyLightPreset(spec: BattleSpec, name: LightPresetName): BattleSpec {
  const { ambient: _a, ambientTint: _t, ...rest } = spec;
  const p = LIGHT_PRESETS[name] as { ambient: number; tint?: string };
  return { ...rest, ...(p.ambient < 0.995 && { ambient: p.ambient }), ...(p.tint && { ambientTint: p.tint }) };
}

/** The ambient level of a battlemap (1 = bright). */
export const ambientOf = (spec: { ambient?: number }): number => {
  const a = spec.ambient;
  return typeof a === "number" && Number.isFinite(a) ? Math.min(1, Math.max(0.05, a)) : 1;
};

/** The name of the closest preset, or null for a custom level. */
export function ambientName(a: number): AmbientPreset | null {
  for (const [k, v] of Object.entries(AMBIENT_PRESETS)) if (Math.abs(v - a) < 0.02) return k as AmbientPreset;
  return null;
}

export const FEET_PER_KM = 3280.84;

// ---------------------------------------------------------------- materials
export interface BattleMaterial {
  id: number;
  name: string;
  /** Average colour, for swatches and quick previews. */
  colour: [number, number, number];
}

/** Floor materials. id 0 is "void": nothing there (outside the rooms). */
export const MATERIALS: BattleMaterial[] = [
  { id: 0, name: "void", colour: [22, 22, 26] },
  { id: 1, name: "flagstone", colour: [138, 134, 126] },
  { id: 2, name: "cobblestone", colour: [118, 112, 104] },
  { id: 3, name: "wood planks", colour: [150, 108, 66] },
  { id: 4, name: "dirt", colour: [122, 92, 62] },
  { id: 5, name: "grass", colour: [86, 128, 60] },
  { id: 6, name: "sand", colour: [208, 188, 136] },
  { id: 7, name: "shallow water", colour: [96, 150, 178] },
  { id: 8, name: "deep water", colour: [40, 82, 128] },
  { id: 9, name: "snow", colour: [232, 238, 244] },
  { id: 10, name: "lava", colour: [196, 74, 24] },
  { id: 11, name: "carpet", colour: [128, 36, 40] },
  { id: 12, name: "marble", colour: [214, 212, 208] },
  { id: 13, name: "rock", colour: [112, 108, 102] },
  { id: 14, name: "mud", colour: [84, 62, 42] },
  { id: 15, name: "forest floor", colour: [66, 76, 40] },
];

export function materialByName(name: string): BattleMaterial | undefined {
  const k = name.trim().toLowerCase();
  return MATERIALS.find((m) => m.name === k) ?? MATERIALS.find((m) => m.name.startsWith(k)) ?? MATERIALS.find((m) => m.name.split(" ")[0] === k);
}

// ---------------------------------------------------------------- the document
export interface CreateBattleOptions {
  id: string;
  name: string;
  squaresX: number;
  squaresY: number;
  pxPerSquare?: number;
  feetPerSquare?: number;
  sub?: number;
  gridType?: BattleGridType;
  seed?: number;
  /** Start with a stone-floored, walled room filling all but a margin (in squares); 0 or undefined: an empty (void) map. */
  roomMargin?: number;
}

export function isBattle(doc: MapDoc | { meta: { kind: string } }): boolean {
  return doc.meta.kind === "battle";
}

export function battleSpec(doc: MapDoc): BattleSpec {
  const b = doc.meta.battle;
  if (!b) throw new Error("This isn't a battlemap.");
  return b;
}

export function createBattleDoc(o: CreateBattleOptions): MapDoc {
  const spec: BattleSpec = {
    squaresX: Math.round(o.squaresX), squaresY: Math.round(o.squaresY),
    pxPerSquare: o.pxPerSquare ?? 70, feetPerSquare: o.feetPerSquare ?? 5, sub: o.sub ?? 8, gridType: o.gridType ?? "square",
  };
  const w = spec.squaresX * spec.sub, h = spec.squaresY * spec.sub;
  const now = new Date().toISOString();
  const doc: MapDoc = {
    meta: {
      id: o.id, name: o.name, kind: "battle", width: w, height: h,
      kmPerPx: spec.feetPerSquare / spec.sub / FEET_PER_KM, seaLevel: 0, seed: o.seed ?? 1, createdAt: now, updatedAt: now, battle: spec,
    },
    height: new HeightField(w, h),
    features: { ...emptyFeatures(), walls: [], lights: [] },
  };
  if (o.roomMargin && o.roomMargin > 0) {
    const m = o.roomMargin;
    const room = { x: m, y: m, w: spec.squaresX - 2 * m, h: spec.squaresY - 2 * m };
    if (room.w >= 2 && room.h >= 2) {
      paintFloor(doc, { shape: { type: "rect", x: room.x * spec.sub, y: room.y * spec.sub, w: room.w * spec.sub, h: room.h * spec.sub }, material: 1 });
      doc.features!.walls!.push({ id: "w-room", kind: "wall", closed: true, points: [[room.x, room.y], [room.x + room.w, room.y], [room.x + room.w, room.y + room.h], [room.x, room.y + room.h]] });
    }
  }
  return doc;
}

export interface PaintFloorParams {
  /** In floor cells (sub-cells), not squares. */
  shape: Shape;
  material: number;
}

/** Set the floor material of every cell whose centre is inside the shape. Returns the changed rectangle. */
export function paintFloor(doc: MapDoc, p: PaintFloorParams): Rect | null {
  const { w: W, h: H, data } = doc.height;
  const rect = clipRect(expandRect(shapeBounds(p.shape, W, H), 1), W, H);
  if (!rect) return null;
  const want = Math.round(p.material);
  const custom = want >= CUSTOM_MATERIAL_BASE && !!doc.meta.battle?.palette?.some((e) => e.id === want);
  const m = custom ? want : Math.max(0, Math.min(MATERIALS.length - 1, want));
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (p.shape.type === "all" || signedDistance(p.shape, x + 0.5, y + 0.5) > 0) data[y * W + x] = m;
    }
  }
  return rect;
}

/** Squares to floor cells. */
export const toCells = (squares: number, spec: BattleSpec) => squares * spec.sub;

// ---------------------------------------------------------------- walls and lights

/** Corner points of a rectangular room (squares), clockwise from the top-left. */
export function roomCorners(x: number, y: number, w: number, h: number): [number, number][] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/**
 * Walls for a room with doors: the outline is split so each door sits in a gap of the wall.
 * side: which edge; offset: squares from the edge's start (top/bottom: from the left; left/right: from the top).
 */
export function roomWalls(
  idPrefix: string, x: number, y: number, w: number, h: number, doors: { side: "top" | "bottom" | "left" | "right"; offset: number; width?: number; kind?: "door" | "secret" | "window" }[],
): MapWall[] {
  const edges: Record<string, { a: [number, number]; b: [number, number] }> = {
    top: { a: [x, y], b: [x + w, y] }, right: { a: [x + w, y], b: [x + w, y + h] },
    bottom: { a: [x + w, y + h], b: [x, y + h] }, left: { a: [x, y + h], b: [x, y] },
  };
  const out: MapWall[] = [];
  let n = 0;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const { a, b } = edges[side];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    // doors on this edge, measured along the room's clockwise direction (so bottom and left run backwards)
    const along = (d: { offset: number; width?: number }) => (side === "bottom" || side === "left" ? len - d.offset - (d.width ?? 1) : d.offset);
    const here = doors.filter((d) => d.side === side).sort((p, q) => along(p) - along(q));
    let cursor = 0;
    const pt = (t: number): [number, number] => [a[0] + dir[0] * t, a[1] + dir[1] * t];
    for (const d of here) {
      const start = Math.max(cursor, Math.min(len, along(d))), width = Math.min(d.width ?? 1, len - start);
      if (start > cursor) out.push({ id: `${idPrefix}-${n++}`, kind: "wall", points: [pt(cursor), pt(start)] });
      out.push({ id: `${idPrefix}-${n++}`, kind: d.kind ?? "door", points: [pt(start), pt(start + width)] });
      cursor = start + width;
    }
    if (cursor < len - 1e-9) out.push({ id: `${idPrefix}-${n++}`, kind: "wall", points: [pt(cursor), pt(len)] });
  }
  return out;
}

/** Largest battlemap image we'll render, in pixels (RGBA, so 4 bytes each). */
export const MAX_BATTLE_PX = 25_000_000;

/** An error message if the size is out of range, else null. */
export function battleSizeError(squaresX: number, squaresY: number, pxPerSquare: number): string | null {
  if (!(squaresX >= 3 && squaresY >= 3)) return "A battlemap needs at least 3 x 3 squares.";
  if (squaresX > 150 || squaresY > 150) return "A battlemap can be at most 150 squares on a side.";
  if (pxPerSquare < 20 || pxPerSquare > 200) return "Pixels per square must be between 20 and 200.";
  if (squaresX * squaresY * pxPerSquare * pxPerSquare > MAX_BATTLE_PX) {
    const maxPx = Math.floor(Math.sqrt(MAX_BATTLE_PX / (squaresX * squaresY)));
    return `That would be a ${Math.round((squaresX * squaresY * pxPerSquare * pxPerSquare) / 1e6)} megapixel image (the limit is ${MAX_BATTLE_PX / 1e6}). Use at most ${maxPx} px per square for ${squaresX} x ${squaresY} squares.`;
  }
  return null;
}

/**
 * Put a door (or secret door or window) into the nearest wall: the wall is cut so the door sits in a gap.
 * (x, y) is where the door should be centred, in squares; it snaps onto the wall. Walls that are closed
 * or have several points are split into separate pieces. Returns what to remove and add, or null if no
 * wall is within `reach` squares.
 */
export function insertDoor(
  walls: MapWall[], x: number, y: number, width: number, kind: "door" | "secret" | "window", newId: () => string, reach = 0.8,
): { remove: string[]; add: MapWall[]; door: MapWall } | null {
  let best: { wall: MapWall; i: number; d: number; t: number } | null = null;
  for (const wall of walls) {
    if (wall.kind !== "wall") continue;
    wallSegments(wall).forEach(([a, b], i) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      if (len2 === 0) return;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
      const d = Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
      if (d <= reach && (!best || d < best.d)) best = { wall, i, d, t };
    });
  }
  if (!best) return null;
  const { wall, i, t } = best as { wall: MapWall; i: number; d: number; t: number };
  const segs = wallSegments(wall);
  const [a, b] = segs[i];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const w = Math.min(width, len);
  const centre = Math.max(w / 2, Math.min(len - w / 2, t * len));
  const at = (s: number): [number, number] => [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len];
  const add: MapWall[] = [];
  const piece = (p: [number, number], q: [number, number], k: MapWall["kind"]): MapWall => ({ id: newId(), kind: k, points: [p, q] });
  segs.forEach((seg, j) => {
    if (j !== i) { add.push(piece(seg[0], seg[1], "wall")); return; }
    if (centre - w / 2 > 1e-6) add.push(piece(a, at(centre - w / 2), "wall"));
    if (centre + w / 2 < len - 1e-6) add.push(piece(at(centre + w / 2), b, "wall"));
  });
  const door = piece(at(centre - w / 2), at(centre + w / 2), kind);
  add.push(door);
  return { remove: [wall.id], add, door };
}

// ---------------------------------------------------------------- procedural floor textures
const TILE = 256;

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Value noise that repeats every px cells across and py cells down (so tiles join seamlessly). */
function pnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const fx = Math.floor(x), fy = Math.floor(y);
  const tx = x - fx, ty = y - fy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(mod(fx, px), mod(fy, py), seed), b = hash(mod(fx + 1, px), mod(fy, py), seed);
  const c = hash(mod(fx, px), mod(fy + 1, py), seed), d = hash(mod(fx + 1, px), mod(fy + 1, py), seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Fractal repeating noise over the tile, 0..1; (cx, cy) are the base cells across the tile. */
function fbm(u: number, v: number, cx: number, cy: number, octaves: number, seed: number): number {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 1 << o;
    sum += amp * pnoise((u / TILE) * cx * f, (v / TILE) * cy * f, cx * f, cy * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

type RGB3 = [number, number, number];
const mix = (a: RGB3, b: RGB3, t: number): RGB3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (c: RGB3, k: number): RGB3 => [c[0] * k, c[1] * k, c[2] * k];

/** Repeating Worley cells: nearest and second nearest distances, and the nearest cell's id. */
function worley(u: number, v: number, n: number, seed: number): { d1: number; d2: number; id: number } {
  const cell = TILE / n;
  const cx = Math.floor(u / cell), cy = Math.floor(v / cell);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy;
      const hx = mod(gx, n), hy = mod(gy, n);
      const px = (gx + 0.15 + 0.7 * hash(hx, hy, seed)) * cell, py = (gy + 0.15 + 0.7 * hash(hx, hy, seed + 5)) * cell;
      const d = Math.hypot(u - px, v - py);
      if (d < d1) { d2 = d1; d1 = d; id = hx * 97 + hy; } else if (d < d2) d2 = d;
    }
  }
  return { d1, d2, id };
}

type TextureFn = (u: number, v: number) => RGB3;

const TEXTURES: Record<number, TextureFn> = {
  0: () => [22, 22, 26],
  1: (u, v) => { // flagstones: rows of slabs, each its own shade, with dark joints and a lit top edge
    const row = Math.floor(v / 64), off = (row & 1) * 32 + hash(row, 0, 3) * 24;
    const x = mod(u + off, TILE), col = Math.floor(x / 64);
    const lu = x - col * 64, lv = v - row * 64;
    const slab = 0.84 + 0.3 * hash(col, row, 11);
    let k = slab * (0.94 + 0.12 * fbm(u, v, 8, 8, 4, 2));
    const edge = Math.min(lu, lv, 64 - lu, 64 - lv);
    if (edge < 1.6) k *= 0.45;
    else if (lu < 3.5 || lv < 3.5) k *= 1.1;
    else if (64 - lu < 3.5 || 64 - lv < 3.5) k *= 0.9;
    return scale3([140, 136, 128], k);
  },
  2: (u, v) => { // cobblestones
    const w = worley(u, v, 7, 4), gap = w.d2 - w.d1;
    const k = (0.78 + 0.36 * hash(w.id, 1, 9)) * (0.92 + 0.16 * fbm(u, v, 12, 12, 3, 6)) * (gap < 2.2 ? 0.45 : 0.85 + Math.min(0.2, gap / 90));
    return scale3([124, 118, 110], k);
  },
  3: (u, v) => { // planks with grain and end joints
    const pl = Math.floor(v / 32), lv = v - pl * 32;
    const joint = hash(pl, 2, 7) * TILE;
    const along = mod(u - joint, TILE);
    const grain = pnoise((u / TILE) * 4, (v / TILE) * 96, 4, 96, 13);
    let k = (0.82 + 0.3 * hash(pl, 0, 5)) * (0.9 + 0.2 * grain);
    if (lv < 1.4) k *= 0.5;
    if (along < 1.6 || along > TILE - 1.6) k *= 0.55;
    return scale3([158, 112, 68], k);
  },
  4: (u, v) => scale3(mix([112, 84, 56], [138, 106, 72], fbm(u, v, 6, 6, 5, 21)), 0.9 + 0.2 * pnoise((u / TILE) * 64, (v / TILE) * 64, 64, 64, 22)),
  5: (u, v) => {
    const base = mix([70, 112, 48], [104, 146, 66], fbm(u, v, 5, 5, 5, 31));
    return scale3(base, 0.88 + 0.24 * pnoise((u / TILE) * 96, (v / TILE) * 96, 96, 96, 32));
  },
  6: (u, v) => scale3(mix([200, 180, 128], [222, 204, 152], fbm(u, v, 5, 5, 4, 41)), 0.95 + 0.1 * pnoise((u / TILE) * 128, (v / TILE) * 128, 128, 128, 42)),
  7: (u, v) => {
    const ripple = Math.abs(fbm(u, v, 4, 4, 4, 51) - 0.5) * 2;
    return mix([88, 144, 176], [150, 200, 220], Math.pow(1 - ripple, 4) * 0.8);
  },
  8: (u, v) => {
    const ripple = Math.abs(fbm(u, v, 3, 3, 4, 61) - 0.5) * 2;
    return mix([30, 70, 118], [62, 112, 156], Math.pow(1 - ripple, 5) * 0.6);
  },
  9: (u, v) => scale3(mix([226, 232, 240], [244, 248, 252], fbm(u, v, 5, 5, 4, 71)), 0.97 + 0.05 * pnoise((u / TILE) * 64, (v / TILE) * 64, 64, 64, 72)),
  10: (u, v) => {
    const f = fbm(u, v, 5, 5, 5, 81), crack = Math.abs(fbm(u, v, 7, 7, 3, 82) - 0.5) * 2;
    return mix([40, 14, 10], [255, 150, 40], Math.min(1, Math.pow(1 - crack, 3) * 0.9 + f * 0.25));
  },
  11: (u, v) => { // woven carpet with a faint diamond pattern
    const weave = 0.92 + 0.08 * (((Math.floor(u / 2) + Math.floor(v / 2)) & 1) ? 1 : 0.6);
    const du = mod(u, 64) - 32, dv = mod(v, 64) - 32;
    const diamond = Math.abs(Math.abs(du) + Math.abs(dv) - 22) < 2.2;
    const base: RGB3 = diamond ? [176, 130, 66] : [132, 36, 42];
    return scale3(base, weave * (0.94 + 0.12 * fbm(u, v, 6, 6, 3, 91)));
  },
  13: (u, v) => { // broken rock: angular pieces with dark cracks
    const w = worley(u, v, 9, 12), gap = w.d2 - w.d1;
    const k = (0.7 + 0.5 * hash(w.id, 2, 15)) * (0.9 + 0.2 * fbm(u, v, 10, 10, 3, 16)) * (gap < 3 ? 0.5 : 1);
    return scale3([116, 111, 104], k);
  },
  14: (u, v) => { // wet mud with darker puddles
    const wet = fbm(u, v, 5, 5, 4, 24);
    return scale3(mix([74, 54, 36], [100, 76, 50], fbm(u, v, 6, 6, 5, 23)), (wet > 0.58 ? 0.72 : 1) * (0.92 + 0.16 * pnoise((u / TILE) * 64, (v / TILE) * 64, 64, 64, 25)));
  },
  15: (u, v) => { // leaf litter: mossy ground with scattered leaf blotches
    const base = mix([50, 66, 32], [86, 82, 42], fbm(u, v, 6, 6, 5, 26));
    const leaf = pnoise((u / TILE) * 96, (v / TILE) * 96, 96, 96, 27);
    return scale3(leaf > 0.72 ? mix(base, [128, 96, 44], 0.55) : base, 0.88 + 0.24 * pnoise((u / TILE) * 160, (v / TILE) * 160, 160, 160, 28));
  },
  12: (u, v) => {
    const vein = Math.pow(1 - Math.abs(fbm(u, v, 3, 3, 5, 101) - 0.5) * 2, 8);
    const tile = Math.min(mod(u, 128), mod(v, 128)) < 1.6 ? 0.7 : 1;
    return scale3(mix([218, 216, 212], [120, 124, 134], vein * 0.7), tile);
  },
};

const tileCache = new Map<number, Uint8ClampedArray>();

function tileFor(m: number): Uint8ClampedArray {
  let t = tileCache.get(m);
  if (t) return t;
  const fn = TEXTURES[m] ?? TEXTURES[0];
  t = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const c = fn(x + 0.5, y + 0.5), o = (y * TILE + x) * 4;
      t[o] = c[0]; t[o + 1] = c[1]; t[o + 2] = c[2]; t[o + 3] = 255;
    }
  }
  tileCache.set(m, t);
  return t;
}

/** Output size in image pixels. */
export function battleImageSize(spec: BattleSpec): { w: number; h: number } {
  return { w: spec.squaresX * spec.pxPerSquare, h: spec.squaresY * spec.pxPerSquare };
}

/** A texture tile for a custom floor material: RGBA, size x size, repeating every `squares` grid squares. */
export interface TileData {
  data: Uint8ClampedArray;
  size: number;
  squares: number;
}
export type TileSource = (materialId: number) => TileData | null;

interface Sampler {
  data: Uint8ClampedArray;
  size: number;
  /** Image pixels per repeat of the tile. */
  period: number;
}

const FLAT: Uint8ClampedArray = new Uint8ClampedArray([112, 112, 120, 255]);

/**
 * Draw the floors (rect, in image px; default all) into a full-size RGBA buffer. Where materials meet, each
 * pixel takes a smoothed vote of the floor cells around it and then sharpens it, so the boundary is a clean,
 * slightly feathered curve rather than a staircase of cells. Pack textures come from `tiles` (grey until they load).
 */
export function renderBattleFloor(doc: MapDoc, out: Uint8ClampedArray, rect?: Rect, tiles?: TileSource): void {
  const spec = battleSpec(doc);
  const { w: IW, h: IH } = battleImageSize(spec);
  const r = clipRect(rect ?? { x: 0, y: 0, w: IW, h: IH }, IW, IH);
  if (!r) return;
  const { w: CW, h: CH, data } = doc.height;
  const cellPx = spec.pxPerSquare / spec.sub;
  const samplers = new Map<number, Sampler>();
  const samplerFor = (m: number): Sampler => {
    let s = samplers.get(m);
    if (s) return s;
    if (m >= CUSTOM_MATERIAL_BASE) {
      const t = tiles?.(m);
      s = t ? { data: t.data, size: t.size, period: t.squares * spec.pxPerSquare } : { data: FLAT, size: 1, period: spec.pxPerSquare };
    } else {
      s = { data: tileFor(m), size: TILE, period: (TILE * spec.pxPerSquare) / 70 }; // slabs and planks are authored for 70 px squares
    }
    samplers.set(m, s);
    return s;
  };
  const mat = (cx: number, cy: number) => data[Math.min(CH - 1, Math.max(0, cy)) * CW + Math.min(CW - 1, Math.max(0, cx))] | 0;
  const REACH = 1.7; // cells; the vote kernel
  const ids = new Int32Array(16);
  const wts = new Float32Array(16);
  const cells = new Int32Array(16);
  let R = 0, G = 0, B = 0;
  const rgb = (m: number, x: number, y: number, w: number) => {
    const s = samplerFor(m);
    const inv = s.size / s.period;
    const tu = Math.floor(mod(x * inv, s.size)), tv = Math.floor(mod(y * inv, s.size));
    const i = (tv * s.size + tu) * 4;
    R += s.data[i] * w; G += s.data[i + 1] * w; B += s.data[i + 2] * w;
  };
  for (let y = r.y; y < r.y + r.h; y++) {
    const cv = (y + 0.5) / cellPx - 0.5, cy0 = Math.floor(cv);
    for (let x = r.x; x < r.x + r.w; x++) {
      const cu = (x + 0.5) / cellPx - 0.5, cx0 = Math.floor(cu);
      let same = true, n = 0;
      for (let j = -1; j <= 2; j++) {
        for (let i = -1; i <= 2; i++) {
          const m = mat(cx0 + i, cy0 + j);
          cells[n++] = m;
          if (m !== cells[0]) same = false;
        }
      }
      R = G = B = 0;
      if (same) {
        rgb(cells[0], x, y, 1);
      } else {
        let nf = 0;
        n = 0;
        for (let j = -1; j <= 2; j++) {
          for (let i = -1; i <= 2; i++) {
            const m = cells[n++];
            const d = Math.hypot(cu - (cx0 + i), cv - (cy0 + j));
            if (d >= REACH) continue;
            const k = 1 - d / REACH, w = k * k;
            let q = 0;
            while (q < nf && ids[q] !== m) q++;
            if (q === nf) { ids[nf] = m; wts[nf] = 0; nf++; }
            wts[q] += w;
          }
        }
        let sum = 0;
        for (let q = 0; q < nf; q++) { const v3 = wts[q] * wts[q] * wts[q]; wts[q] = v3 * v3; sum += wts[q]; }
        for (let q = 0; q < nf; q++) rgb(ids[q], x, y, wts[q] / sum);
      }
      const o = (y * IW + x) * 4;
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------- raster overlay (previews)
function stamp(img: { w: number; h: number; data: Uint8ClampedArray }, cx: number, cy: number, r: number, c: [number, number, number], alpha = 1) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(img.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(img.h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const a = alpha * Math.min(1, r - d + 0.5), o = (y * img.w + x) * 4;
      img.data[o] = img.data[o] * (1 - a) + c[0] * a;
      img.data[o + 1] = img.data[o + 1] * (1 - a) + c[1] * a;
      img.data[o + 2] = img.data[o + 2] * (1 - a) + c[2] * a;
    }
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 214, 140];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Is there floor under this point (in squares)? */
export function floorAtFn(doc: MapDoc): (xSquares: number, ySquares: number) => boolean {
  const spec = battleSpec(doc);
  const { w: CW, h: CH, data } = doc.height;
  return (x, y) => {
    const cx = Math.floor(x * spec.sub), cy = Math.floor(y * spec.sub);
    return cx >= 0 && cy >= 0 && cx < CW && cy < CH && (data[cy * CW + cx] | 0) > 0;
  };
}

const LIGHT_LUT = 1440;

/** Is the point inside the polygon (even-odd)? */
function inPolygon(x: number, y: number, xs: number[], ys: number[]): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
  }
  return inside;
}

/**
 * How bright it is where no light reaches, at an image pixel: the map's level, with each light zone laid over it and
 * a soft edge between. Null when there are no zones (then it is just the map's level everywhere).
 */
export function ambientField(spec: BattleSpec, zones: MapAmbientZone[] | undefined, W: number, H: number): ((x: number, y: number) => number) | null {
  const usable = (zones ?? []).filter((z) => z.points.length >= 3);
  if (!usable.length) return null;
  const px = spec.pxPerSquare, S = Math.max(1, Math.round(px / 16)), lw = Math.ceil(W / S), lh = Math.ceil(H / S);
  const raw = new Float32Array(lw * lh).fill(ambientOf(spec));
  for (const z of usable) {
    const xs = z.points.map((p) => p[0] * px), ys = z.points.map((p) => p[1] * px), lvl = Math.min(1, Math.max(0.05, z.ambient));
    const x0 = Math.max(0, Math.floor(Math.min(...xs) / S)), x1 = Math.min(lw - 1, Math.ceil(Math.max(...xs) / S));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) / S)), y1 = Math.min(lh - 1, Math.ceil(Math.max(...ys) / S));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inPolygon(x * S + S / 2, y * S + S / 2, xs, ys)) raw[y * lw + x] = lvl;
  }
  // blur with the edge values carried outward, so the map's border doesn't fade toward black
  const r = Math.max(1, Math.round((0.12 * px) / S)), pad = r * 2 + 2, aw = lw + 2 * pad, ah = lh + 2 * pad;
  const a = new Float32Array(aw * ah);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) a[y * aw + x] = raw[Math.min(lh - 1, Math.max(0, y - pad)) * lw + Math.min(lw - 1, Math.max(0, x - pad))];
  boxBlur(a, aw, ah, r);
  return (x, y) => {
    const gx = x / S - 0.5 + pad, gy = y / S - 0.5 + pad, x0 = Math.min(aw - 1, Math.max(0, Math.floor(gx))), y0 = Math.min(ah - 1, Math.max(0, Math.floor(gy)));
    const x1 = Math.min(aw - 1, x0 + 1), y1 = Math.min(ah - 1, y0 + 1), fx = Math.min(1, Math.max(0, gx - x0)), fy = Math.min(1, Math.max(0, gy - y0));
    return (a[y0 * aw + x0] * (1 - fx) + a[y0 * aw + x1] * fx) * (1 - fy) + (a[y1 * aw + x0] * (1 - fx) + a[y1 * aw + x1] * fx) * fy;
  };
}

/**
 * Light onto an image of the whole battlemap (image px). Each light tints what it reaches and, when the map (or a
 * light zone) is dimmer than bright, reveals it: the rest is dimmed and coloured by the ambient tint (cooler by default).
 * Walls and closed doors cast shadows, with a soft edge where the shadow of a corner begins.
 */
export function drawBattleLights(
  img: { w: number; h: number; data: Uint8ClampedArray }, spec: BattleSpec, lights: MapLight[] | undefined, walls: MapWall[] | undefined, zones?: MapAmbientZone[],
) {
  const px = spec.pxPerSquare, amb = ambientOf(spec);
  const dimmed = amb < 0.999 || (zones ?? []).some((z) => z.points.length >= 3 && z.ambient < 0.999);
  if (!lights?.length && !dimmed) return;
  const reveal = dimmed ? new Float32Array(img.w * img.h) : null;
  for (const l of lights ?? []) {
    const c = hexToRgb(l.colour ?? "#ffd68c"), R = l.radius * px, inten = l.intensity ?? 1;
    const vis = lightVisibility(l, walls);
    // how far the light travels at each angle (so a pixel only needs a lookup)
    let lut: Float32Array | null = null;
    if (vis.segs.length) {
      lut = new Float32Array(LIGHT_LUT);
      for (let i = 0; i < LIGHT_LUT; i++) lut[i] = visibleDistance(vis, -Math.PI + ((i + 0.5) / LIGHT_LUT) * 2 * Math.PI);
    }
    const x0 = Math.max(0, Math.floor(l.x * px - R)), x1 = Math.min(img.w - 1, Math.ceil(l.x * px + R));
    const y0 = Math.max(0, Math.floor(l.y * px - R)), y1 = Math.min(img.h - 1, Math.ceil(l.y * px + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - l.x * px, dy = y + 0.5 - l.y * px;
        const dm = Math.hypot(dx, dy), d = dm / R;
        if (d >= 1) continue;
        let lit = 1;
        if (lut) {
          // five looks around the pixel's direction, so the edge of a shadow fades over about 0.2 squares
          const dist = dm / px, th = Math.atan2(dy, dx), spread = Math.min(0.5, 0.1 / Math.max(0.3, dist)) / 2;
          let n = 0;
          for (let k = -2; k <= 2; k++) {
            let idx = Math.floor(((th + k * spread + Math.PI) / (2 * Math.PI)) * LIGHT_LUT) % LIGHT_LUT;
            if (idx < 0) idx += LIGHT_LUT;
            if (dist <= lut[idx]) n++;
          }
          if (n === 0) continue;
          lit = n / 5;
        }
        const o = (y * img.w + x) * 4, a = Math.pow(1 - d, 1.6) * 0.45 * inten * lit;
        img.data[o] = Math.min(255, img.data[o] + (c[0] - img.data[o]) * a);
        img.data[o + 1] = Math.min(255, img.data[o + 1] + (c[1] - img.data[o + 1]) * a);
        img.data[o + 2] = Math.min(255, img.data[o + 2] + (c[2] - img.data[o + 2]) * a);
        if (reveal) reveal[y * img.w + x] += Math.pow(1 - d, 1.4) * inten * lit;
      }
    }
  }
  if (reveal) {
    const dk = img.data, field = ambientField(spec, zones, img.w, img.h);
    const tint = spec.ambientTint ? hexToRgb(spec.ambientTint).map((v) => v / 255) : null;
    for (let i = 0, o = 0, x = 0, y = 0; i < reveal.length; i++, o += 4) {
      const am = field ? field(x + 0.5, y + 0.5) : amb;
      if (++x === img.w) { x = 0; y++; }
      if (am >= 0.999) continue;
      const m = am + (1 - am) * Math.min(1, reveal[i] * 1.1), dark = 1 - m;
      if (tint) {
        dk[o] *= m * (1 + (tint[0] - 1) * dark * 0.9);
        dk[o + 1] *= m * (1 + (tint[1] - 1) * dark * 0.9);
        dk[o + 2] = Math.min(255, dk[o + 2] * m * (1 + (tint[2] - 1) * dark * 0.9));
      } else {
        dk[o] *= m * (1 - 0.1 * dark);
        dk[o + 1] *= m * (1 - 0.02 * dark);
        dk[o + 2] = Math.min(255, dk[o + 2] * m * (1 + 0.1 * dark));
      }
    }
  }
  for (const l of lights ?? []) stamp(img, l.x * px, l.y * px, Math.max(2, px * 0.09), [255, 250, 220]);
}

/** Walls, doors and windows (and, unless `lights` is false, light) onto an image of the whole battlemap (image px). */
export function drawBattleOverlay(img: { w: number; h: number; data: Uint8ClampedArray }, spec: BattleSpec, f: Features | undefined, opts: { lights?: boolean; floorAt?: (xSquares: number, ySquares: number) => boolean } = {}) {
  compositeOver(img, renderWallLayer(spec, f?.walls, { floorAt: opts.floorAt }));
  if (opts.lights !== false) drawBattleLights(img, spec, f?.lights, f?.walls, f?.zones);
}

/** A decoded object image for drawing props. */
export interface SpriteData {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}
export type SpriteSource = (assetId: string) => SpriteData | null;

/** Composite one image onto the buffer, centred at (cx, cy) with the given size in px, rotated and optionally mirrored. */
export function drawSprite(
  img: { w: number; h: number; data: Uint8ClampedArray }, spr: SpriteData, cx: number, cy: number, dw: number, dh: number, rotDeg: number, flip: boolean, opacity: number,
) {
  const rad = (rotDeg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad), hw = dw / 2, hh = dh / 2;
  const ex = Math.abs(hw * cos) + Math.abs(hh * sin), ey = Math.abs(hw * sin) + Math.abs(hh * cos);
  const x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(img.w - 1, Math.ceil(cx + ex));
  const y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(img.h - 1, Math.ceil(cy + ey));
  const { w: SW, h: SH, data: sd } = spr;
  const px = (ix: number, iy: number, ch: number) => sd[(Math.min(SH - 1, Math.max(0, iy)) * SW + Math.min(SW - 1, Math.max(0, ix))) * 4 + ch];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
      if (lx < -hw || lx > hw || ly < -hh || ly > hh) continue;
      let u = ((lx + hw) / dw) * SW - 0.5;
      const v = ((ly + hh) / dh) * SH - 0.5;
      if (flip) u = SW - 1 - u;
      const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
      const a00 = px(iu, iv, 3) * w00, a10 = px(iu + 1, iv, 3) * w10, a01 = px(iu, iv + 1, 3) * w01, a11 = px(iu + 1, iv + 1, 3) * w11;
      const a = (a00 + a10 + a01 + a11) / 255 * opacity;
      if (a <= 0.004) continue;
      const o = (y * img.w + x) * 4;
      // premultiplied interpolation so transparent pixels' colour doesn't bleed into the edge
      const mixc = (ch: number) => (px(iu, iv, ch) * a00 + px(iu + 1, iv, ch) * a10 + px(iu, iv + 1, ch) * a01 + px(iu + 1, iv + 1, ch) * a11) / ((a00 + a10 + a01 + a11) || 1);
      img.data[o] = img.data[o] * (1 - a) + mixc(0) * a;
      img.data[o + 1] = img.data[o + 1] * (1 - a) + mixc(1) * a;
      img.data[o + 2] = img.data[o + 2] * (1 - a) + mixc(2) * a;
    }
  }
}

/** Draw the objects of one layer. A prop is as big as its image at 256 px per square, times its scale. */
export function drawBattleProps(
  img: { w: number; h: number; data: Uint8ClampedArray }, spec: BattleSpec, props: MapProp[] | undefined, sprites: SpriteSource | undefined, layer: "below" | "above",
) {
  if (!props?.length || !sprites) return;
  for (const p of props) {
    if ((p.layer ?? "above") !== layer) continue;
    const spr = sprites(p.asset);
    if (!spr) continue;
    const k = ((p.scale ?? 1) * spec.pxPerSquare) / PROP_PX_PER_SQUARE;
    // a sprite prepared at a smaller size still stands for its original footprint
    const f = footprint(spr);
    drawSprite(img, spr, p.x * spec.pxPerSquare, p.y * spec.pxPerSquare, f.w * k, f.h * k, p.rotation ?? 0, !!p.flip, p.opacity ?? 1);
  }
}

/** The size in 256-px-per-square pixels an image stands for (prepared sprites may carry their original size). */
export function footprint(spr: SpriteData & { origW?: number; origH?: number }): { w: number; h: number } {
  return { w: spr.origW ?? spr.w, h: spr.origH ?? spr.h };
}

/** The whole battlemap as an image: floors, objects below the walls, walls and doors, objects above, then lights. */
export function renderBattle(
  doc: MapDoc, opts: { overlay?: boolean; lights?: boolean; notes?: boolean; tiles?: TileSource; sprites?: SpriteSource } = {},
): { w: number; h: number; data: Uint8ClampedArray } {
  const spec = battleSpec(doc);
  const { w, h } = battleImageSize(spec);
  const img = { w, h, data: new Uint8ClampedArray(w * h * 4) };
  renderBattleFloor(doc, img.data, undefined, opts.tiles);
  drawBattleProps(img, spec, doc.features?.props, opts.sprites, "below");
  if (opts.overlay !== false) {
    compositeOver(img, renderWallLayer(spec, doc.features?.walls, { floorAt: floorAtFn(doc) }));
    drawBattleProps(img, spec, doc.features?.props, opts.sprites, "above");
    if (opts.lights !== false) drawBattleLights(img, spec, doc.features?.lights, doc.features?.walls, doc.features?.zones);
    if (opts.notes) drawBattleNotes(img, spec, doc.features?.notes);
  } else {
    drawBattleProps(img, spec, doc.features?.props, opts.sprites, "above");
  }
  return img;
}

// ---------------------------------------------------------------- exports
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Lines that block sight and movement in a Universal VTT file: walls, and secret doors (which look and act like wall until the
 * DM reveals them; the format has no secret door, and writing one as an ordinary door would show the players where it is).
 */
function sightLines(f: Features | undefined) {
  return (f?.walls ?? []).filter((w) => w.kind === "wall" || w.kind === "secret").map((w) => {
    const pts = w.closed && w.points.length > 2 ? [...w.points, w.points[0]] : w.points;
    return pts.map(([x, y]) => ({ x: r4(x), y: r4(y) }));
  });
}

/** A colour as the Universal VTT "AARRGGBB" string (fully opaque). */
function argb(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return "ff" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Universal VTT (.dd2vtt / .uvtt) data. Positions are in grid squares. Only doors become portals, because
 * a VTT turns every portal into a door that opens. The format has no window and no secret door, so:
 *   - a window becomes an "objects_line_of_sight" line, like an invisible wall: it blocks movement but not sight or light;
 *   - a secret door becomes a plain wall line (see sightLines), so it can't be told from the wall around it.
 * Written from the format as I know it: the field names and the colour byte order haven't been checked
 * against a program that reads it, so test it in yours.
 */
export function toUniversalVtt(doc: MapDoc, imagePngBase64: string) {
  const spec = battleSpec(doc);
  const f = doc.features;
  const walls = f?.walls ?? [];
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: spec.squaresX, y: spec.squaresY }, pixels_per_grid: spec.pxPerSquare },
    line_of_sight: sightLines(f),
    objects_line_of_sight: walls.filter((w) => w.kind === "invisible" || w.kind === "window").map((w) => w.points.map(([x, y]) => ({ x: r4(x), y: r4(y) }))),
    portals: walls.filter((w) => w.kind === "door").map((w) => {
      const [a, b] = [w.points[0], w.points[w.points.length - 1]];
      return {
        position: { x: r4((a[0] + b[0]) / 2), y: r4((a[1] + b[1]) / 2) },
        bounds: [{ x: r4(a[0]), y: r4(a[1]) }, { x: r4(b[0]), y: r4(b[1]) }],
        rotation: r4(Math.atan2(b[1] - a[1], b[0] - a[0])),
        closed: !w.open,
        freestanding: false,
      };
    }),
    // the map's light level as a grey ambient light (bright = white); the picture itself is never darkened
    environment: { baked_lighting: false, ambient_light: argb(`#${Math.round(ambientOf(spec) * 255).toString(16).padStart(2, "0").repeat(3)}`) },
    lights: (f?.lights ?? []).map((l) => ({
      position: { x: r4(l.x), y: r4(l.y) }, range: r4(l.radius), intensity: r4(l.intensity ?? 1), color: argb(l.colour ?? "#ffd68c"), shadows: l.shadows !== false,
    })),
    image: imagePngBase64,
  };
}

/** One level of a battlemap for a Foundry scene: its floor document, its name, its elevation (feet) and where its picture will be. */
export interface FoundryLevelDoc {
  doc: MapDoc;
  name: string;
  bottom: number;
  top: number;
  image: string;
}

/**
 * A Foundry VTT scene for Scene "Import Data", in Foundry v14's format (see foundryScene.ts): one level for each floor document, in the order given
 * (the first is the level the scene opens on), each with its own picture, walls, doors and lights tagged to it. The size, grid and light level of the scene
 * are the first level's (every level of a battlemap is made with the same size and grid). Coordinates are in image pixels.
 */
export function toFoundryLevelsScene(levels: FoundryLevelDoc[], sceneName?: string) {
  if (!levels.length) throw new Error("A Foundry scene needs at least one level.");
  const first = levels[0].doc;
  const spec = battleSpec(first);
  const { w, h } = battleImageSize(spec);
  return foundryScene({
    name: sceneName ?? first.meta.name, width: w, height: h, pxPerSquare: spec.pxPerSquare, feetPerSquare: spec.feetPerSquare, gridType: spec.gridType, ambient: ambientOf(spec),
    levels: levels.map((l) => ({ name: l.name, bottom: l.bottom, top: l.top, image: l.image, walls: l.doc.features?.walls ?? [], lights: l.doc.features?.lights ?? [] })),
  });
}

/** The same for a battlemap of one level: "Ground floor", from 0 to 10 feet, holding the whole map. */
export function toFoundryScene(doc: MapDoc, imageSrc: string, sceneName?: string) {
  return toFoundryLevelsScene([{ doc, name: "Ground floor", bottom: 0, top: 10, image: imageSrc }], sceneName);
}
