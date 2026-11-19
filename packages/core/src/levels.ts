/**
 * Levels of a battlemap: a cellar under a ground floor under an attic. Each level is a floor document of its own (see docs/FOUNDRY.md, "Stage 2 design"); this
 * is the list that says which there are, what they are called and how high they sit. Level 1 is the battlemap as it always was, so a map with no list is a
 * map with one level. Elevations are in feet (what Foundry's levels use).
 */

export interface BattleLevel {
  /** Letters, digits and hyphens: it names the folder the level is kept in. */
  id: string;
  name: string;
  /** Floor and ceiling elevation, in feet. */
  bottom: number;
  top: number;
}

export interface LevelsFile {
  v: 1;
  /** The level the editor and Claude are working on. */
  active: string;
  /** In the order they are kept; the first is level 1 (the project's own files). */
  levels: BattleLevel[];
}

export const MAX_LEVELS = 12;
/** How tall a level is when it is added, in feet. */
export const DEFAULT_LEVEL_HEIGHT_FT = 10;
export const FIRST_LEVEL_NAME = "Ground floor";
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** One level, "Ground floor", from 0 to 10 feet: what a battlemap with no level list has. */
export function defaultLevels(): LevelsFile {
  return { v: 1, active: "level-1", levels: [{ id: "level-1", name: FIRST_LEVEL_NAME, bottom: 0, top: DEFAULT_LEVEL_HEIGHT_FT }] };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cleanName = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 60) : fallback);

/** A level list read from a file, made safe, or null when nothing in it is usable (the caller then uses defaultLevels). */
export function cleanLevels(raw: unknown): LevelsFile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const list = (raw as { levels?: unknown }).levels;
  if (!Array.isArray(list)) return null;
  const levels: BattleLevel[] = [];
  const seen = new Set<string>();
  for (const l of list.slice(0, MAX_LEVELS)) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    if (typeof o.id !== "string" || !ID_RE.test(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    const bottom = finite(o.bottom) ? o.bottom : 0;
    const top = finite(o.top) && o.top > bottom ? o.top : bottom + DEFAULT_LEVEL_HEIGHT_FT;
    levels.push({ id: o.id, name: cleanName(o.name, `Level ${levels.length + 1}`), bottom, top });
  }
  if (!levels.length) return null;
  const active = (raw as { active?: unknown }).active;
  return { v: 1, active: typeof active === "string" && seen.has(active) ? active : levels[0].id, levels };
}

/** An id for a new level that no level has. */
export function newLevelId(existing: readonly string[]): string {
  for (let n = existing.length + 1; ; n++) if (!existing.includes(`level-${n}`)) return `level-${n}`;
}

/** The elevation of a new level put above the highest or below the lowest. */
export function nextLevelElevation(levels: readonly BattleLevel[], where: "above" | "below"): { bottom: number; top: number } {
  if (where === "above") { const top = Math.max(...levels.map((l) => l.top)); return { bottom: top, top: top + DEFAULT_LEVEL_HEIGHT_FT }; }
  const bottom = Math.min(...levels.map((l) => l.bottom));
  return { bottom: bottom - DEFAULT_LEVEL_HEIGHT_FT, top: bottom };
}

/** A name for a new level that none of them has: "Level 2", "Level 3"... */
export function newLevelName(levels: readonly BattleLevel[], where: "above" | "below"): string {
  const names = new Set(levels.map((l) => l.name.toLowerCase()));
  const base = where === "below" ? "Cellar" : "Upper floor";
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** The levels from the lowest to the highest (the order Foundry and the editor's level bar show them). */
export function levelsByHeight(levels: readonly BattleLevel[]): BattleLevel[] {
  return [...levels].sort((a, b) => a.bottom - b.bottom || a.top - b.top);
}

/** The level just below `id` (by elevation), or null. */
export function levelBelow(levels: readonly BattleLevel[], id: string): BattleLevel | null {
  const sorted = levelsByHeight(levels);
  const i = sorted.findIndex((l) => l.id === id);
  return i > 0 ? sorted[i - 1] : null;
}
