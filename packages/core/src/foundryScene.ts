/**
 * A Foundry VTT scene, built the way Foundry v14 stores one: a scene holds LEVELS (each with its own elevation range and its own background picture),
 * and walls, lights and regions are tagged with the levels they belong to. A one-floor map is simply a scene with one level.
 *
 * Checked in a real Foundry (v14 build 367, 2026-11-18; the results are in docs/foundry-test-kit/results/v14.367/ and docs/FOUNDRY.md):
 *  - A scene file with no `_stats.coreVersion` is treated as old data: Foundry replaces its levels with one empty default level and every wall and light
 *    is left pointing at levels that no longer exist, so the scene imports "successfully" and shows nothing. Every scene written here therefore carries
 *    `_stats.coreVersion` (FOUNDRY_CORE_VERSION). With it, levels, pictures, walls, lights and regions come through exactly as written.
 *  - A Scene has `levels` and `initialLevel`; the scene itself has no background picture. A Level has `_id`, `name`, `sort`, `elevation`, `background.src`,
 *    `foreground.src` and `visibility.levels` (the other levels it can see: empty means only itself, which works).
 *  - Walls and lights have a `levels` set and behave per level (sight and light stop at the level boundary); a light also has an `elevation`.
 *  - A stair is a Region with a "Change Level" behaviour (`type: "changeLevel"`, `system: { movementActions: [] }`, empty meaning every kind of movement):
 *    walking onto it asks the player whether to move to the other level. A floor is a Region on the upper level with a "Define Surface" behaviour
 *    (`type: "defineSurface"`, placement "bottom"), a ceiling the same on the lower level with placement "top", and a hole is an extra shape of the floor's
 *    region with `hole: true`. (Only the stair has been written by us so far; the floor, ceiling and hole shapes are as Foundry stored them when they were
 *    made by hand.)
 *  - The scene's light level is `environment.darknessLevel`; the older top-level `darkness` is dropped, and so is anything of the kind put on a level.
 * docs/FOUNDRY.md keeps the list of what is still unchecked.
 */
import { type MapLight, type MapWall, wallSegments } from "./features.ts";

/**
 * The Foundry build every scene file says it was written by. Foundry keeps a file's levels only when this is at least 14.353 (older values make it run the
 * old-data migration that drops them) and refuses a file that says it is newer than the Foundry it is imported into, so it is the lowest value that works:
 * 14.353 was tried against build 367 and keeps the levels, 14.352 does not.
 */
export const FOUNDRY_CORE_VERSION = "14.353";

export interface FoundryLevelInput {
  name: string;
  /** The elevation range in scene units (feet): a level's bottom is below its top; stacked levels share their boundary. */
  bottom: number;
  top: number;
  /** Where this level's background picture is (a path in the Foundry data folder). */
  image: string;
  /** A picture drawn above the tokens on this level (a roof), if there is one. */
  foreground?: string;
  /** Walls, doors and windows of this level, in grid squares. */
  walls: MapWall[];
  /** Lights on this level, in grid squares. */
  lights: MapLight[];
}

/** A way between two levels, as a rectangle on the map in grid squares. */
export interface FoundryStairInput {
  name: string;
  /** Indices of the levels it connects. */
  between: [number, number];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FoundrySceneInput {
  name: string;
  /** The picture size in pixels (every level's picture is this size). */
  width: number;
  height: number;
  pxPerSquare: number;
  feetPerSquare: number;
  gridType: "square" | "hex" | "none";
  /** 0.05..1: how bright the scene is where no light reaches (1 = full daylight). */
  ambient?: number;
  levels: FoundryLevelInput[];
  stairs?: FoundryStairInput[];
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** A Foundry document id: 16 letters and digits. The same seed always gives the same id (so re-exporting a map doesn't change its ids). */
export function foundryId(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length, h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  let out = "";
  let a = h1 >>> 0, b = h2 >>> 0;
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[(i % 2 ? b : a) % ALPHABET.length];
    if (i % 2) { a = Math.imul(a, 1103515245) + 12345 >>> 0; b = Math.imul(b, 22695477) + 1 >>> 0; }
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Foundry's wall settings for one of our wall kinds. (door: 0 none, 1 door, 2 secret; ds: 0 closed, 1 open, 2 locked; senses: 0 none, 20 normal.) */
function wallSettings(w: MapWall) {
  const s = { move: 20, sight: 20, light: 20, sound: 20, door: 0, ds: 0 };
  if (w.kind === "door") { s.door = 1; s.ds = w.locked ? 2 : w.open ? 1 : 0; }
  else if (w.kind === "secret") { s.door = 2; s.ds = w.locked ? 2 : w.open ? 1 : 0; }
  else if (w.kind === "window") { s.sight = 0; s.light = 0; }
  else if (w.kind === "invisible") { s.sight = 0; s.light = 0; s.sound = 0; }
  return s;
}

/** The scene as Foundry stores it, ready to be written as JSON and imported (Scene > Import Data). */
export function foundryScene(input: FoundrySceneInput, opts: { stairs?: boolean } = {}) {
  if (!input.levels.length) throw new Error("A Foundry scene needs at least one level.");
  const px = input.pxPerSquare;
  const ids = input.levels.map((l, i) => foundryId(`level:${i}:${l.name}`));
  const sc = (n: number) => r2(n * px);

  const levels = input.levels.map((l, i) => {
    if (!(l.bottom < l.top)) throw new Error(`Level "${l.name}": its bottom (${l.bottom}) must be below its top (${l.top}).`);
    return {
      _id: ids[i], name: l.name, sort: i * 100000,
      elevation: { bottom: l.bottom, top: l.top },
      background: { src: l.image },
      foreground: { src: l.foreground ?? null },
      // each level sees itself; what else it can see (through a hole, down a stairwell) is for the person running the game to open up
      visibility: { levels: [] as string[] },
      flags: {},
    };
  });

  const walls: object[] = [];
  const lights: object[] = [];
  input.levels.forEach((l, i) => {
    for (const wall of l.walls) {
      const set = wallSettings(wall);
      // (a wall is a polyline: every piece becomes one Foundry wall)
      for (const [a, b] of wallSegments(wall)) {
        walls.push({ c: [sc(a[0]), sc(a[1]), sc(b[0]), sc(b[1])], dir: 0, threshold: { light: null, sight: null, sound: null, attenuation: false }, flags: {}, levels: [ids[i]], ...set });
      }
    }
    for (const light of l.lights) {
      const dim = light.radius * input.feetPerSquare, bright = (light.bright ?? light.radius / 2) * input.feetPerSquare;
      lights.push({
        x: sc(light.x), y: sc(light.y), elevation: l.bottom, rotation: 0, walls: light.shadows !== false, vision: false, hidden: false, levels: [ids[i]],
        config: { alpha: 0.5 * (light.intensity ?? 1), angle: 360, bright: r4(bright), dim: r4(dim), color: light.colour ?? "#ffd68c", coloration: 1, luminosity: 0.5, attenuation: 0.5, shadows: 0 },
      });
    }
  });

  // stairs and ladders: a region where tokens change level (the stored shape of this behaviour is a best guess: see the note at the top)
  const regions = opts.stairs ? (input.stairs ?? []).map((s, k) => {
    const lo = Math.min(...s.between.map((i) => input.levels[i].bottom));
    const hi = Math.max(...s.between.map((i) => input.levels[i].top));
    return {
      _id: foundryId(`stair:${k}:${s.name}`), name: s.name, color: "#d4af37",
      shapes: [{ type: "rectangle", x: sc(s.x), y: sc(s.y), width: sc(s.w), height: sc(s.h), rotation: 0, hole: false }],
      // (what Foundry itself stores for a stair made by hand: the behaviour's one setting is the kinds of movement allowed, none listed meaning all)
      elevation: { bottom: lo, top: hi, topInclusive: false }, levels: s.between.map((i) => ids[i]),
      behaviors: [{ _id: foundryId(`stairb:${k}:${s.name}`), name: "Change Level", type: "changeLevel", system: { movementActions: [] as string[] }, disabled: false, flags: {} }],
      visibility: 4, locked: false, flags: {},
    };
  }) : [];

  const ambient = input.ambient ?? 1;
  return {
    name: input.name,
    // without this Foundry treats the file as old data and drops the levels (see the top of this file)
    _stats: { coreVersion: FOUNDRY_CORE_VERSION },
    navigation: false,
    width: input.width, height: input.height, padding: 0, shiftX: 0, shiftY: 0,
    grid: { type: input.gridType === "hex" ? 2 : input.gridType === "none" ? 0 : 1, size: px, distance: input.feetPerSquare, units: "ft", color: "#000000", alpha: 0.2 },
    tokenVision: true,
    // the light level: Foundry's darkness is the opposite of ambient (0 = bright day)
    ...(ambient < 0.999 && { environment: { darknessLevel: r4(1 - ambient) } }),
    initialLevel: ids[0],
    levels,
    walls,
    lights,
    tiles: [] as object[],
    regions,
  };
}
