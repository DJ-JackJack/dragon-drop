/**
 * The version of a saved map's files, and how an older map is brought up to date.
 *
 * Every map folder's project.json carries `formatVersion`. A map saved before this existed has none, and that means 1: the format
 * every map had until now. Rules, so that a map a person made never breaks after an update:
 *
 *   - Change what a saved map contains or means (a field renamed, a unit changed, a layer stored differently)? Raise CURRENT_FORMAT
 *     and add the step that turns the old form into the new one to MIGRATIONS. Adding an optional field that old files simply don't
 *     have does not need a new version.
 *   - A map from an OLDER format is copied aside first (the store does this), then migrated in memory and saved in the new form.
 *   - A map from a NEWER format is never opened: an older program rewriting it could silently drop what it doesn't understand.
 */
import type { MapDoc } from "./doc.ts";

/** The format this build reads and writes. */
export const CURRENT_FORMAT = 1;

/**
 * City maps (kind "city") are written in their own format, though every other map stays in format 1: a Dragon Drop from before city maps would treat a city as a world map and
 * drop its buildings the next time it saved, so it must refuse it (it refuses any map in a format newer than its own). Everything else is unchanged by this.
 *   2: city maps (0.1.10).
 *   3: a city's land (hills, ridges, valleys...), trees and climate (0.1.11). 0.1.10 would drop them the first time it changed the city, so it must refuse these.
 */
export const CITY_FORMAT = 3;
/** The format the first city maps were written in (a city's file never means less). */
export const FIRST_CITY_FORMAT = 2;

/** The format a map of this kind is read and written in, given the format the program writes ordinary maps in. */
export function formatFor(kind: string | undefined, general: number = CURRENT_FORMAT): number {
  return kind === "city" ? Math.max(general, CITY_FORMAT) : general;
}

/** One step: turns a map of format `n` into format `n + 1`, changing `doc` in place. */
export type MapMigration = (doc: MapDoc) => void;

/**
 * Steps by the version they start from (key 1 turns format 1 into 2). Only city maps have gone past format 1 so far, and a city is written in 2 from the start, so there is
 * no step 1 yet. A step must leave every other kind of map as it is (when ordinary maps reach that format, the same table serves them).
 */
export const MIGRATIONS: Record<number, MapMigration> = {
  // city maps 2 -> 3: the land, the trees and the climate are new and optional (a city without them is flat, treeless and temperate), so nothing changes
  2: () => {},
};

/** A map saved by a newer Dragon Drop than this one. */
export class NewerFormatError extends Error {
  constructor(readonly found: number, readonly known: number, readonly mapName?: string) {
    super(
      `${mapName ? `"${mapName}" was` : "This map was"} saved by a newer version of Dragon Drop (map format ${found}; this version understands up to ${known}). ` +
      `Update Dragon Drop to open it: opening it with this older version could damage it, so it has been left exactly as it is.`,
    );
    this.name = "NewerFormatError";
  }
}

/** The format a map's metadata says it has: a whole number from 1, and 1 when it says nothing (or nonsense). */
export function formatOf(meta: { formatVersion?: unknown } | undefined): number {
  const v = meta?.formatVersion;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
}

/**
 * Bring `doc` from format `from` up to `to`, one step at a time. Returns how many steps ran. A missing step is an error:
 * skipping it would hand back a map in a form nothing downstream expects.
 */
export function migrateMap(doc: MapDoc, from: number, to: number = CURRENT_FORMAT, steps: Record<number, MapMigration> = MIGRATIONS): number {
  let n = 0;
  for (let v = from; v < to; v++) {
    const step = steps[v];
    if (!step) throw new Error(`No way to bring a map from format ${v} to ${v + 1}.`);
    step(doc);
    n++;
  }
  doc.meta.formatVersion = to;
  return n;
}
