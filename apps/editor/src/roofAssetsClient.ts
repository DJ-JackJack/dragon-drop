/**
 * The roof textures of the asset packs, as the editor needs them: which pictures there are for each roof look (from the server, which sorts them: core's roofAssets.ts), so a
 * building the DM draws gets a roof picture whenever an appropriate one exists, and is drawn from its look only when none does.
 */
import { type RoofChoice, type RoofPools, type RoofStyle, chooseRoof, fittingRoofAssets } from "@mapmaker/core";

interface State { pools: RoofPools | null; loaded: boolean }
let state: State = { pools: null, loaded: false };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

/** For useSyncExternalStore: the state changes (a new object) when the pools have been fetched. */
export const roofAssetsStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  get: (): State => state,
};

/** Ask the server which roof pictures the packs hold (null pools when no asset folder is set up). */
export function loadRoofPools(force = false): Promise<void> {
  if (inflight) return inflight;
  if (state.loaded && !force) return Promise.resolve();
  inflight = fetch("/api/assets/roofs")
    .then(async (r) => {
      const j = r.ok ? ((await r.json()) as RoofPools | null) : null;
      state = { pools: j && typeof j === "object" && Array.isArray(j.tile) ? j : null, loaded: true };
    })
    .catch(() => { state = { pools: null, loaded: true }; })
    .finally(() => { inflight = null; for (const l of listeners) l(); });
  return inflight;
}

/** The roof picture a building of this roof look gets (a stable pick for its id), or null when the packs have none for the look. */
export function roofChoiceFor(look: RoofStyle, seed: string, match?: string): RoofChoice | null {
  return chooseRoof(state.pools, look, seed, match);
}

/** The next picture of the pool after `current` (for "another picture"), or null when the look has fewer than two. */
export function nextRoofPicture(look: RoofStyle, current: string | undefined): RoofChoice | null {
  const pool = fittingRoofAssets(state.pools?.[look] ?? [], look);
  if (pool.length < 2) return null;
  const i = pool.findIndex((a) => a.id === current);
  const a = pool[(i + 1) % pool.length];
  return chooseRoof({ ...emptyPools(), [look]: [a] }, look, a.id);
}

const emptyPools = (): RoofPools => ({ slate: [], tile: [], thatch: [], shingle: [] });
