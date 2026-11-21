/**
 * The small pictures for place markers (castle, temple, cave, lighthouse...): drawn as vector shapes, so they are sharp at any zoom and in exports.
 *
 * Each picture is a few shapes in a box from -1 to 1. They are drawn in ink with a white outline round the whole picture (so they read on forest, sand
 * or sea alike); some shapes are cut out in white (a gate, a window) or tinted (flame, water, gold). Written against a tiny drawing interface, so it
 * runs on a browser canvas and in tests.
 */
import type { PlaceType } from "./placeKinds.ts";

/** The part of a 2D canvas context the pictures use. */
export interface IconCtx {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
}

type Shape = (c: IconCtx) => void;
/** fill: ink. line: an ink stroke. tint: a coloured fill. cut: white over the ink. cutline: a white stroke. mark: an ink stroke over the cuts. */
interface Part { d: Shape; k: "fill" | "line" | "tint" | "cut" | "cutline" | "mark"; w?: number; color?: string }

const INK = "#17171c", PAPER = "#ffffff", HALO = 0.34;
const WATER = "#4a86c8", FIRE = "#e2531f", GOLD = "#f0c230";

const poly = (...p: number[]): Shape => (c) => { c.beginPath(); c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); };
const open = (...p: number[]): Shape => (c) => { c.beginPath(); c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); };
const rect = (x: number, y: number, w: number, h: number): Shape => (c) => { c.beginPath(); c.rect(x, y, w, h); };
const disc = (x: number, y: number, r: number): Shape => (c) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); };
const oval = (x: number, y: number, rx: number, ry: number): Shape => (c) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
const quad = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): Shape => (c) => { c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1); };

const F = (d: Shape): Part => ({ d, k: "fill" });
const L = (d: Shape, w = 0.2): Part => ({ d, k: "line", w });
const T = (d: Shape, color: string): Part => ({ d, k: "tint", color });
const C = (d: Shape): Part => ({ d, k: "cut" });
const CL = (d: Shape, w = 0.1): Part => ({ d, k: "cutline", w });
const M = (d: Shape, w = 0.1): Part => ({ d, k: "mark", w });

/** A spiral from radius r0 inward to r1, `turns` times round (a whirlpool's swirl). */
const spiral = (turns: number, r0: number, r1: number): Shape => (c) => {
  c.beginPath();
  for (let i = 0, n = 72; i <= n; i++) { const t = i / n, a = t * turns * Math.PI * 2, r = r0 + (r1 - r0) * t; if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
};

/** A star with `n` points, outer radius r0 and inner r1, centred on (x, y), one point up. */
const star = (x: number, y: number, n: number, r0: number, r1: number): Shape => (c) => {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? r1 : r0; if (i) c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  c.closePath();
};
/** A cog with `n` square teeth between radius r1 (the rim) and r0 (the tips). */
const cog = (n: number, r0: number, r1: number): Shape => (c) => {
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n, h = Math.PI / n / 2;
    const pts: [number, number][] = [[r1, a - 2 * h], [r0, a - h], [r0, a + h], [r1, a + 2 * h]];
    pts.forEach(([r, t], j) => (i === 0 && j === 0 ? c.moveTo(Math.cos(t) * r, Math.sin(t) * r) : c.lineTo(Math.cos(t) * r, Math.sin(t) * r)));
  }
  c.closePath();
};
/** Any path, closed. */
const path = (draw: (c: IconCtx) => void): Shape => (c) => { c.beginPath(); draw(c); c.closePath(); };

/** The shape of an arch cut into a wall: a half circle standing on the line y. */
const arch = (cx: number, y: number, r: number): Shape => (c) => { c.beginPath(); c.moveTo(cx - r, y); c.arc(cx, y, r, Math.PI, Math.PI * 2); c.closePath(); };

export const PLACE_ICONS: Partial<Record<PlaceType, Part[]>> = {
  hamlet: [F(poly(-0.75, 0.1, 0, -0.62, 0.75, 0.1, 0.75, 0.75, -0.75, 0.75)), C(rect(-0.16, 0.25, 0.32, 0.5))],
  farm: [F(poly(-0.8, 0.8, -0.8, -0.1, -0.42, -0.62, 0.42, -0.62, 0.8, -0.1, 0.8, 0.8)), C(rect(-0.32, 0.12, 0.64, 0.68)), M(open(-0.32, 0.12, 0.32, 0.8)), M(open(0.32, 0.12, -0.32, 0.8))],
  castle: [F(rect(-0.8, -0.1, 1.6, 0.88)), F(rect(-0.8, -0.5, 0.34, 0.42)), F(rect(-0.17, -0.5, 0.34, 0.42)), F(rect(0.46, -0.5, 0.34, 0.42)), C(rect(-0.18, 0.28, 0.36, 0.5)), C(disc(0, 0.28, 0.18))],
  tower: [F(rect(-0.3, -0.55, 0.6, 1.35)), F(rect(-0.5, -0.88, 1.0, 0.36)), C(rect(-0.22, -0.88, 0.14, 0.18)), C(rect(0.08, -0.88, 0.14, 0.18)), C(rect(-0.07, -0.25, 0.14, 0.26)), C(rect(-0.11, 0.42, 0.22, 0.38))],
  battlefield: [
    F(poly(0.371, 0.229, -0.9, -0.9, 0.229, 0.371)), L(open(0.05, 0.55, 0.55, 0.05), 0.16), L(open(0.3, 0.3, 0.7, 0.7), 0.18), F(disc(0.78, 0.78, 0.12)),
    F(poly(-0.371, 0.229, 0.9, -0.9, -0.229, 0.371)), L(open(-0.05, 0.55, -0.55, 0.05), 0.16), L(open(-0.3, 0.3, -0.7, 0.7), 0.18), F(disc(-0.78, 0.78, 0.12)),
  ],
  temple: [F(poly(-0.9, -0.18, 0, -0.88, 0.9, -0.18)), F(rect(-0.9, -0.12, 1.8, 0.14)), L(open(-0.58, 0.1, -0.58, 0.62), 0.22), L(open(0, 0.1, 0, 0.62), 0.22), L(open(0.58, 0.1, 0.58, 0.62), 0.22), F(rect(-0.95, 0.62, 1.9, 0.18))],
  shrine: [
    F(rect(-0.7, 0.15, 1.4, 0.2)), F(rect(-0.5, 0.35, 0.22, 0.45)), F(rect(0.28, 0.35, 0.22, 0.45)),
    T((c) => { c.beginPath(); c.moveTo(0, -0.85); c.quadraticCurveTo(0.42, -0.35, 0.28, -0.02); c.quadraticCurveTo(0.14, 0.15, 0, 0.15); c.quadraticCurveTo(-0.14, 0.15, -0.28, -0.02); c.quadraticCurveTo(-0.42, -0.35, 0, -0.85); c.closePath(); }, FIRE),
    C(disc(0, -0.02, 0.12)),
  ],
  graveyard: [
    F((c) => { c.beginPath(); c.moveTo(-0.45, 0.8); c.lineTo(-0.45, -0.15); c.arc(0, -0.15, 0.45, Math.PI, Math.PI * 2); c.lineTo(0.45, 0.8); c.closePath(); }),
    L(open(-0.95, 0.8, 0.95, 0.8), 0.14), CL(open(0, -0.5, 0, 0.05), 0.14), CL(open(-0.2, -0.28, 0.2, -0.28), 0.14),
  ],
  portal: [L(oval(0, 0, 0.52, 0.8), 0.28), T(oval(0, 0, 0.28, 0.58), "#7b4fd6"), C(oval(0, 0, 0.1, 0.28)), F(rect(-0.72, 0.72, 1.44, 0.16))],
  standing_stones: [
    F(poly(-0.8, 0.8, -0.8, -0.1, -0.55, -0.4, -0.3, -0.1, -0.3, 0.8)), F(poly(-0.2, 0.8, -0.2, -0.5, 0, -0.85, 0.2, -0.5, 0.2, 0.8)), F(poly(0.3, 0.8, 0.3, -0.1, 0.55, -0.4, 0.8, -0.1, 0.8, 0.8)),
    L(open(-0.95, 0.82, 0.95, 0.82), 0.14),
  ],
  cave: [
    F((c) => { c.beginPath(); c.moveTo(-0.95, 0.8); c.bezierCurveTo(-0.95, -0.3, -0.5, -0.85, 0, -0.85); c.bezierCurveTo(0.5, -0.85, 0.95, -0.3, 0.95, 0.8); c.closePath(); }),
    C(arch(0, 0.8, 0.42)),
  ],
  dungeon: [F(rect(-0.8, -0.8, 1.6, 1.6)), C(rect(-0.55, -0.6, 1.1, 0.24)), C(rect(-0.4, -0.25, 0.8, 0.24)), C(rect(-0.25, 0.1, 0.5, 0.24)), C(rect(-0.1, 0.45, 0.2, 0.24))],
  mine: [L(open(-0.72, 0.85, 0.3, -0.4), 0.24), L(quad(-0.3, -0.7, 0.55, -0.95, 0.92, -0.05), 0.28)],
  lair: [F(poly(-0.74, -0.85, -0.46, -0.85, -0.3, 0.9)), F(poly(-0.14, -0.9, 0.14, -0.9, 0.2, 0.92)), F(poly(0.46, -0.85, 0.74, -0.85, 0.3, 0.9))],
  camp: [F(poly(-0.95, 0.75, 0, -0.8, 0.95, 0.75)), C(poly(0, -0.15, 0.34, 0.75, -0.34, 0.75))],
  lighthouse: [
    F(poly(-0.36, 0.85, -0.24, -0.3, 0.24, -0.3, 0.36, 0.85)), T(rect(-0.3, -0.72, 0.6, 0.4), GOLD), F(poly(-0.42, -0.72, 0, -0.98, 0.42, -0.72)), C(rect(-0.3, 0.08, 0.6, 0.2)),
    L(open(0.5, -0.58, 0.92, -0.7), 0.12), L(open(0.5, -0.46, 0.95, -0.42), 0.12), L(open(-0.5, -0.58, -0.92, -0.7), 0.12), L(open(-0.5, -0.46, -0.95, -0.42), 0.12),
  ],
  bridge: [F(rect(-0.95, -0.38, 1.9, 0.3)), F(rect(-0.8, -0.1, 1.6, 0.82)), C(arch(0, 0.72, 0.42))],
  inn: [
    F(rect(-0.5, -0.3, 0.85, 1.1)), F(disc(-0.28, -0.42, 0.26)), F(disc(0.02, -0.52, 0.28)), F(disc(0.3, -0.4, 0.24)),
    L((c) => { c.beginPath(); c.arc(0.35, 0.22, 0.3, -Math.PI / 2, Math.PI / 2); }, 0.2), CL(open(-0.5, -0.1, 0.35, -0.1), 0.1),
  ],
  crossroads: [L(open(0, -0.92, 0, 0.92), 0.2), F(poly(0, -0.78, 0.75, -0.78, 0.95, -0.57, 0.75, -0.36, 0, -0.36)), F(poly(0, -0.2, -0.75, -0.2, -0.95, 0.01, -0.75, 0.22, 0, 0.22))],
  peak: [F(poly(-0.95, 0.75, -0.3, -0.58, 0.12, 0.02, 0.48, -0.4, 0.95, 0.75)), C(poly(-0.3, -0.58, -0.03, -0.2, -0.14, -0.08, -0.25, -0.22, -0.37, -0.08, -0.49, -0.2))],
  volcano: [F(poly(-0.95, 0.8, -0.32, -0.38, 0.32, -0.38, 0.95, 0.8)), T(poly(-0.32, -0.38, 0.32, -0.38, 0.2, -0.12, -0.2, -0.12), FIRE), T(poly(-0.13, -0.38, 0, -0.9, 0.13, -0.38), FIRE)],
  // a scholar's cap: the square board seen at a slant, the cap under it, and its tassel
  school: [
    F(poly(-0.95, -0.3, 0, -0.75, 0.95, -0.3, 0, 0.15)), F(poly(-0.55, -0.08, 0.55, -0.08, 0.55, 0.42, 0, 0.6, -0.55, 0.42)), CL(open(-0.55, -0.08, 0, 0.15, 0.55, -0.08), 0.09),
    CL(open(0, -0.3, 0.72, -0.34), 0.08), L(open(0.74, -0.34, 0.8, 0.42), 0.09), T(poly(0.68, 0.38, 0.92, 0.38, 0.98, 0.82, 0.62, 0.82), GOLD),
  ],
  // swirling water, round and in
  whirlpool: [T(oval(0, 0, 0.92, 0.88), WATER), CL(spiral(2.3, 0.78, 0.06), 0.12), F(disc(0, 0, 0.11))],
  waterfall: [F(rect(-0.95, -0.85, 1.9, 0.42)), T(rect(-0.3, -0.43, 0.6, 0.95), WATER), T(oval(0, 0.68, 0.65, 0.2), WATER), CL(open(-0.1, -0.35, -0.1, 0.45), 0.08), CL(open(0.12, -0.3, 0.12, 0.5), 0.08)],
  grove: [F(disc(-0.4, -0.1, 0.46)), F(disc(0.4, -0.1, 0.46)), F(disc(0, -0.42, 0.5)), L(open(0, 0.15, 0, 0.9), 0.3)],
  oasis: [
    L(quad(0.05, 0.8, 0.25, 0.2, 0.1, -0.35), 0.2), L(open(0.1, -0.35, -0.75, -0.15), 0.16), L(open(0.1, -0.35, -0.5, -0.75), 0.16), L(open(0.1, -0.35, 0.8, -0.6), 0.16), L(open(0.1, -0.35, 0.8, 0.05), 0.16),
    T(oval(-0.25, 0.82, 0.65, 0.16), WATER),
  ],
  mill: [F(poly(-0.3, 0.85, -0.2, -0.12, 0.2, -0.12, 0.3, 0.85)), L(open(-0.85, -0.88, 0.85, 0.58), 0.2), L(open(0.85, -0.88, -0.85, 0.58), 0.2), C(disc(0, -0.15, 0.1))],
  shipwreck: [F(poly(-0.9, 0.05, 0.9, 0.05, 0.55, 0.62, -0.55, 0.62)), L(open(0.05, 0.05, 0.4, -0.82), 0.16), F(poly(0.12, -0.12, 0.55, -0.3, 0.45, 0.05)), T(rect(-0.95, 0.62, 1.9, 0.18), WATER)],
  treasure: [
    F((c) => { c.beginPath(); c.moveTo(-0.8, 0.02); c.quadraticCurveTo(-0.8, -0.72, 0, -0.72); c.quadraticCurveTo(0.8, -0.72, 0.8, 0.02); c.closePath(); }), F(rect(-0.8, 0, 1.6, 0.76)),
    CL(open(-0.8, 0.02, 0.8, 0.02), 0.1), T(rect(-0.13, -0.14, 0.26, 0.34), GOLD),
  ],
  danger: [
    F(disc(0, -0.12, 0.62)), F(rect(-0.34, 0.2, 0.68, 0.6)), C(disc(-0.26, -0.12, 0.17)), C(disc(0.26, -0.12, 0.17)), C(poly(0, 0.02, 0.1, 0.22, -0.1, 0.22)),
    CL(open(-0.12, 0.45, -0.12, 0.78), 0.07), CL(open(0.12, 0.45, 0.12, 0.78), 0.07),
  ],
  mystery: [L((c) => { c.beginPath(); c.arc(0, -0.3, 0.42, Math.PI, Math.PI * 2.5); c.lineTo(0, 0.34); }, 0.26), F(disc(0, 0.72, 0.15))],

  // shops and trades
  // a stall under a striped awning
  market: [
    F(poly(-0.95, -0.3, -0.8, -0.85, 0.8, -0.85, 0.95, -0.3)), C(poly(-0.48, -0.85, -0.2, -0.85, -0.24, -0.3, -0.56, -0.3)), C(poly(0.2, -0.85, 0.48, -0.85, 0.56, -0.3, 0.24, -0.3)),
    L(open(-0.82, -0.3, -0.82, 0.85), 0.16), L(open(0.82, -0.3, 0.82, 0.85), 0.16), F(rect(-0.82, 0.12, 1.64, 0.3)),
  ],
  // a tied sack of goods
  general_store: [F(oval(0, 0.28, 0.72, 0.58)), F(poly(-0.32, -0.42, 0.32, -0.42, 0.5, -0.05, -0.5, -0.05)), F(poly(-0.45, -0.88, 0.45, -0.88, 0.22, -0.45, -0.22, -0.45)), C(rect(-0.34, -0.5, 0.68, 0.09))],
  // a mug of ale with a head of foam
  tavern: [
    F(rect(-0.62, -0.45, 0.95, 1.3)), L((c) => { c.beginPath(); c.arc(0.36, 0.2, 0.33, -Math.PI / 2, Math.PI / 2); }, 0.18), T(rect(-0.47, -0.25, 0.65, 0.95), GOLD),
    C(disc(-0.42, -0.5, 0.22)), C(disc(-0.12, -0.58, 0.24)), C(disc(0.18, -0.5, 0.2)),
  ],
  // an anvil
  blacksmith: [F(poly(-0.95, -0.42, 0.9, -0.42, 0.9, -0.12, 0.35, -0.02, 0.3, 0.35, 0.62, 0.75, -0.62, 0.75, -0.3, 0.35, -0.35, -0.02, -0.62, -0.12)), CL(open(-0.6, -0.3, 0.75, -0.3), 0.06)],
  // two crossed swords
  weaponsmith: [
    L(open(-0.72, 0.72, 0.8, -0.8), 0.16), L(open(0.72, 0.72, -0.8, -0.8), 0.16), L(open(-0.78, 0.36, -0.36, 0.78), 0.14), L(open(0.78, 0.36, 0.36, 0.78), 0.14),
    F(disc(-0.84, 0.84, 0.11)), F(disc(0.84, 0.84, 0.11)),
  ],
  // a shield with a chevron
  armorer: [F(poly(-0.72, -0.82, 0.72, -0.82, 0.72, 0.02, 0.42, 0.55, 0, 0.9, -0.42, 0.55, -0.72, 0.02)), C(poly(-0.5, -0.12, 0, 0.3, 0.5, -0.12, 0.5, 0.12, 0, 0.54, -0.5, 0.12))],
  // a bow with an arrow nocked
  bowyer: [
    L((c) => { c.beginPath(); c.arc(-0.9, 0, 1.25, -0.75, 0.75); }, 0.16), L(open(0.014, -0.85, 0.014, 0.85), 0.06), L(open(-0.92, 0, 0.72, 0), 0.1),
    F(poly(0.97, 0, 0.66, -0.2, 0.66, 0.2)), F(poly(-0.95, 0, -0.72, -0.22, -0.6, -0.22, -0.8, 0)), F(poly(-0.95, 0, -0.72, 0.22, -0.6, 0.22, -0.8, 0)),
  ],
  // a cut gem
  jeweler: [
    T(poly(-0.82, -0.25, -0.45, -0.72, 0.45, -0.72, 0.82, -0.25, 0, 0.88), "#3fb6d6"), M(poly(-0.82, -0.25, -0.45, -0.72, 0.45, -0.72, 0.82, -0.25, 0, 0.88), 0.1),
    M(open(-0.82, -0.25, 0.82, -0.25), 0.07), M(open(-0.45, -0.72, -0.25, -0.25, 0, 0.88), 0.07), M(open(0.45, -0.72, 0.25, -0.25, 0, 0.88), 0.07), M(open(-0.25, -0.25, 0, -0.72, 0.25, -0.25), 0.07),
  ],
  // a round flask, half full
  alchemist: [
    F(rect(-0.18, -0.85, 0.36, 0.5)), F(rect(-0.3, -0.94, 0.6, 0.14)), F(disc(0, 0.3, 0.62)), T(disc(0, 0.3, 0.46), PAPER),
    T(path((c) => c.arc(0, 0.3, 0.46, 0.12, Math.PI - 0.12)), "#4fbf6a"), C(disc(0.12, 0.5, 0.07)), C(disc(-0.14, 0.62, 0.05)),
  ],
  // a mortar and pestle
  apothecary: [
    F(path((c) => { c.moveTo(-0.88, -0.05); c.lineTo(0.88, -0.05); c.quadraticCurveTo(0.82, 0.78, 0, 0.78); c.quadraticCurveTo(-0.82, 0.78, -0.88, -0.05); })), F(rect(-0.42, 0.72, 0.84, 0.14)),
    L(open(0.05, -0.12, 0.62, -0.9), 0.24),
  ],
  // a pointed hat with a star
  magic_shop: [F(poly(-0.88, 0.62, -0.22, -0.2, 0.08, -0.92, 0.3, -0.22, 0.88, 0.62)), F(oval(0, 0.66, 0.95, 0.18)), C(star(0.02, 0.12, 5, 0.26, 0.11))],
  // an open book
  bookshop: [
    F(poly(-0.95, -0.6, -0.05, -0.45, -0.05, 0.75, -0.95, 0.6)), F(poly(0.95, -0.6, 0.05, -0.45, 0.05, 0.75, 0.95, 0.6)),
    CL(open(-0.8, -0.3, -0.22, -0.2), 0.07), CL(open(-0.8, 0.0, -0.22, 0.1), 0.07), CL(open(0.8, -0.3, 0.22, -0.2), 0.07), CL(open(0.8, 0.0, 0.22, 0.1), 0.07),
  ],
  // a rolled map with a route on it
  cartographer: [
    F(rect(-0.62, -0.55, 1.24, 1.1)), F(rect(-0.9, -0.72, 0.32, 1.44)), F(rect(0.58, -0.72, 0.32, 1.44)), C(rect(-0.5, -0.44, 1.0, 0.88)),
    M(open(-0.4, 0.3, -0.12, 0.02, 0.12, 0.16, 0.36, -0.22), 0.07), M(open(0.26, -0.36, 0.44, -0.18), 0.06), M(open(0.44, -0.36, 0.26, -0.18), 0.06),
  ],
  // a loaf with scored crust
  bakery: [
    F(path((c) => { c.ellipse(0, 0.2, 0.92, 0.62, 0, Math.PI, 0); c.lineTo(0.92, 0.55); c.lineTo(-0.92, 0.55); })),
    CL(open(-0.48, -0.22, -0.28, 0.18), 0.1), CL(open(-0.08, -0.34, 0.12, 0.1), 0.1), CL(open(0.32, -0.22, 0.5, 0.14), 0.1),
  ],
  // a joint of meat on the bone
  butcher: [F(path((c) => c.ellipse(-0.18, -0.2, 0.64, 0.5, -0.6, 0, Math.PI * 2))), L(open(0.25, 0.2, 0.72, 0.68), 0.2), F(disc(0.84, 0.6, 0.14)), F(disc(0.64, 0.84, 0.14)), C(disc(-0.32, -0.3, 0.14))],
  // a fish
  fishmonger: [F(oval(-0.15, 0, 0.64, 0.38)), F(poly(0.38, 0, 0.94, -0.44, 0.94, 0.44)), C(disc(-0.52, -0.08, 0.08)), CL(open(-0.25, -0.3, -0.12, 0, -0.25, 0.3), 0.07)],
  // a barrel with two hoops
  brewery: [
    F(path((c) => { c.moveTo(-0.55, -0.86); c.lineTo(0.55, -0.86); c.quadraticCurveTo(0.95, 0, 0.55, 0.86); c.lineTo(-0.55, 0.86); c.quadraticCurveTo(-0.95, 0, -0.55, -0.86); })),
    CL(open(-0.72, -0.45, 0.72, -0.45), 0.1), CL(open(-0.72, 0.45, 0.72, 0.45), 0.1),
  ],
  // scissors
  tailor: [
    L(oval(-0.42, 0.58, 0.24, 0.24), 0.14), L(oval(0.42, 0.58, 0.24, 0.24), 0.14),
    F(poly(-0.3, 0.4, -0.16, 0.3, 0.72, -0.9, 0.52, -0.86)), F(poly(0.3, 0.4, 0.16, 0.3, -0.72, -0.9, -0.52, -0.86)), C(disc(0, 0.02, 0.06)),
  ],
  // a boot
  cobbler: [F(poly(-0.55, -0.9, 0.08, -0.9, 0.08, 0.18, 0.78, 0.34, 0.92, 0.58, 0.92, 0.82, -0.55, 0.82)), C(rect(-0.55, -0.62, 0.63, 0.1)), C(rect(-0.55, 0.62, 1.47, 0.06))],
  // a hammer, held at a slant
  carpenter: [L(open(0.2, -0.12, -0.62, 0.9), 0.24), F(poly(-0.06, -0.79, 0.91, -0.02, 0.66, 0.29, -0.31, -0.48)), C(poly(-0.06, -0.79, -0.08, -0.6, -0.2, -0.62))],
  // a pot
  potter: [
    F(path((c) => { c.moveTo(-0.32, -0.86); c.lineTo(0.32, -0.86); c.lineTo(0.22, -0.6); c.quadraticCurveTo(0.98, -0.2, 0.52, 0.86); c.lineTo(-0.52, 0.86); c.quadraticCurveTo(-0.98, -0.2, -0.22, -0.6); })),
    CL(open(-0.64, 0.04, 0.64, 0.04), 0.08),
  ],
  // a candle in a dish
  chandler: [F(rect(-0.22, -0.3, 0.44, 1.08)), T(poly(0, -0.96, 0.17, -0.62, 0, -0.4, -0.17, -0.62), FIRE), F(oval(0, 0.8, 0.58, 0.13)), L(open(0, -0.42, 0, -0.3), 0.05)],
  // a cog
  tinker: [F(cog(8, 0.9, 0.66)), C(disc(0, 0, 0.26))],
  // a horseshoe
  stables: [L((c) => { c.beginPath(); c.arc(0, -0.08, 0.6, Math.PI * 0.78, Math.PI * 0.22); }, 0.3), C(disc(-0.56, -0.18, 0.05)), C(disc(0.56, -0.18, 0.05)), C(disc(-0.4, -0.55, 0.05)), C(disc(0.4, -0.55, 0.05))],
  // an anchor
  shipwright: [
    L(disc(0, -0.72, 0.17), 0.12), L(open(0, -0.55, 0, 0.82), 0.16), L(open(-0.42, -0.36, 0.42, -0.36), 0.14),
    L((c) => { c.beginPath(); c.arc(0, 0.15, 0.68, 0.18, Math.PI - 0.18); }, 0.16), F(poly(0.66, 0.27, 0.92, 0.05, 0.8, 0.45)), F(poly(-0.66, 0.27, -0.92, 0.05, -0.8, 0.45)),
  ],
  // a pair of scales
  trading_post: [
    L(open(0, -0.78, 0, 0.74), 0.12), F(rect(-0.45, 0.72, 0.9, 0.14)), L(open(-0.75, -0.6, 0.75, -0.6), 0.12),
    L(open(-0.75, -0.6, -0.95, 0.0), 0.05), L(open(-0.75, -0.6, -0.55, 0.0), 0.05), L(open(0.75, -0.6, 0.55, 0.0), 0.05), L(open(0.75, -0.6, 0.95, 0.0), 0.05),
    F(path((c) => c.arc(-0.75, 0, 0.27, 0, Math.PI))), F(path((c) => c.arc(0.75, 0, 0.27, 0, Math.PI))),
  ],
  // a stack of gold coins
  bank: [
    T(oval(0, 0.58, 0.72, 0.24), GOLD), M(oval(0, 0.58, 0.72, 0.24), 0.08), T(oval(0, 0.22, 0.72, 0.24), GOLD), M(oval(0, 0.22, 0.72, 0.24), 0.08),
    T(oval(0, -0.14, 0.72, 0.24), GOLD), M(oval(0, -0.14, 0.72, 0.24), 0.08), T(oval(0.1, -0.52, 0.72, 0.24), GOLD), M(oval(0.1, -0.52, 0.72, 0.24), 0.08),
  ],
  // three gold balls hanging from a bar
  pawnshop: [
    L(open(-0.85, -0.86, 0.85, -0.86), 0.14), L(open(-0.48, -0.86, -0.48, -0.25), 0.06), L(open(0.48, -0.86, 0.48, -0.25), 0.06), L(open(0, -0.86, 0, 0.3), 0.06),
    T(disc(-0.48, 0.0, 0.27), GOLD), M(disc(-0.48, 0.0, 0.27), 0.08), T(disc(0.48, 0.0, 0.27), GOLD), M(disc(0.48, 0.0, 0.27), 0.08), T(disc(0, 0.56, 0.27), GOLD), M(disc(0, 0.56, 0.27), 0.08),
  ],
  // a hall with columns and a banner
  guildhall: [
    F(poly(-0.86, 0.86, -0.86, -0.12, 0, -0.58, 0.86, -0.12, 0.86, 0.86)), C(rect(-0.14, 0.36, 0.28, 0.5)), C(rect(-0.62, 0.02, 0.14, 0.62)), C(rect(0.48, 0.02, 0.14, 0.62)),
    L(open(0, -0.58, 0, -0.98), 0.07), T(poly(0.03, -0.98, 0.48, -0.88, 0.03, -0.78), FIRE),
  ],
  // a die showing five
  gambling_den: [F(path((c) => { c.moveTo(-0.62, -0.82); c.lineTo(0.62, -0.82); c.quadraticCurveTo(0.82, -0.82, 0.82, -0.62); c.lineTo(0.82, 0.62); c.quadraticCurveTo(0.82, 0.82, 0.62, 0.82); c.lineTo(-0.62, 0.82); c.quadraticCurveTo(-0.82, 0.82, -0.82, 0.62); c.lineTo(-0.82, -0.62); c.quadraticCurveTo(-0.82, -0.82, -0.62, -0.82); })), C(disc(-0.42, -0.42, 0.15)), C(disc(0.42, -0.42, 0.15)), C(disc(0, 0, 0.15)), C(disc(-0.42, 0.42, 0.15)), C(disc(0.42, 0.42, 0.15))],
};

/** Does this kind have a picture (the original nine are drawn by the editor as plain symbols)? */
export const hasPlaceIcon = (type: string): boolean => Object.prototype.hasOwnProperty.call(PLACE_ICONS, type);

/**
 * Draw the picture for `type` centred on (x, y), reaching `r` from the centre. Returns false (drawing nothing) for a kind with no picture.
 */
export function drawPlaceIcon(ctx: IconCtx, type: string, x: number, y: number, r: number): boolean {
  const parts = PLACE_ICONS[type as PlaceType];
  if (!parts) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // a white outline round the whole picture first, so the ink reads on any ground
  for (const p of parts) {
    if (p.k === "fill" || p.k === "tint") { ctx.fillStyle = PAPER; ctx.strokeStyle = PAPER; ctx.lineWidth = HALO; p.d(ctx); ctx.fill(); ctx.stroke(); }
    else if (p.k === "line") { ctx.strokeStyle = PAPER; ctx.lineWidth = (p.w ?? 0.2) + HALO; p.d(ctx); ctx.stroke(); }
  }
  for (const p of parts) {
    if (p.k === "fill") { ctx.fillStyle = INK; p.d(ctx); ctx.fill(); }
    else if (p.k === "tint") { ctx.fillStyle = p.color ?? INK; p.d(ctx); ctx.fill(); }
    else if (p.k === "line") { ctx.strokeStyle = INK; ctx.lineWidth = p.w ?? 0.2; p.d(ctx); ctx.stroke(); }
  }
  for (const p of parts) {
    if (p.k === "cut") { ctx.fillStyle = PAPER; p.d(ctx); ctx.fill(); }
    else if (p.k === "cutline") { ctx.strokeStyle = PAPER; ctx.lineWidth = p.w ?? 0.1; p.d(ctx); ctx.stroke(); }
  }
  for (const p of parts) {
    if (p.k === "mark") { ctx.strokeStyle = INK; ctx.lineWidth = p.w ?? 0.1; p.d(ctx); ctx.stroke(); }
  }
  ctx.restore();
  return true;
}
