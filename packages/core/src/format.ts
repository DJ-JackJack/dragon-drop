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

/** One step: turns a map of format `n` into format `n + 1`, changing `doc` in place. */
export type MapMigration = (doc: MapDoc) => void;

/** Steps by the version they start from (key 1 turns format 1 into 2). Empty while 1 is the only format there has been. */
export const MIGRATIONS: Record<number, MapMigration> = {};

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
