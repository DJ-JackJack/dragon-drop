/**
 * Imperial or metric in the editor (core units.ts): Settings' choice (per computer, `store.state.unitsPref`) unless the map has its own (`meta.units`).
 * Only what is shown changes; the maps keep their own units inside.
 */
import { useSyncExternalStore } from "react";
import { type MapMeta, type Units, UNITS, UNITS_NAME, cleanUnits, unitsFor } from "@mapmaker/core";
import { store } from "./store.ts";

/** Settings' measurement system. */
export function useUnitsPref(): Units {
  return useSyncExternalStore(store.subscribe, () => store.getState().unitsPref);
}

/** The units this map is shown in (its own choice, else Settings'). */
export function useUnits(meta: Pick<MapMeta, "units"> | null | undefined): Units {
  return unitsFor(meta, useUnitsPref());
}

/** The open map's units (its own choice, else Settings'), for panels that show the open map. */
export function useMapUnits(): Units {
  return useSyncExternalStore(store.subscribe, () => unitsFor(store.getState().meta, store.getState().unitsPref));
}

/** The open map's units, outside React (canvas drawing, notes). */
export const unitsNow = (): Units => unitsFor(store.state.meta, store.state.unitsPref);

/** The map's own Measurements choice, in its Map panel: as in Settings, imperial or metric. One undo step. */
export function MapUnitsChoice({ meta }: { meta: MapMeta | null }) {
  const pref = useUnitsPref();
  if (!meta) return null;
  const own = cleanUnits(meta.units);
  return (
    <label className="field" title="How this map shows distances, heights and sizes. Only what is shown changes: the map itself stays as it is. Settings chooses for every map that doesn't choose for itself.">
      Measurements
      <select value={own ?? ""} data-testid="map-units"
        onChange={(e) => {
          const u = cleanUnits(e.target.value) ?? null;
          store.send({ t: "cmd", cmd: { op: "set_meta", patch: { units: u }, label: u ? `Measurements: ${u}` : "Measurements: as in Settings" } });
        }}>
        <option value="">As in Settings ({pref})</option>
        {UNITS.map((u) => <option key={u} value={u}>{UNITS_NAME[u]}</option>)}
      </select>
    </label>
  );
}

/** Settings' own choice (the Maps and assets tab): every map that doesn't choose for itself. */
export function UnitsPrefChoice() {
  const pref = useUnitsPref();
  return (
    <label className="field">Measurements
      <select value={pref} onChange={(e) => store.setUnitsPref(cleanUnits(e.target.value) ?? "imperial")} data-testid="units-pref">
        {UNITS.map((u) => <option key={u} value={u}>{UNITS_NAME[u]}</option>)}
      </select>
    </label>
  );
}
