/** The city map's tools, their keys and the editor's own settings for them (nothing here is saved with the map). One list: the toolbar, the key handler and the shortcut sheet read it. */
import type { BuildingKind, Features, FeaturesPatch, MapBuilding, MapStreet, RoofStyle, StreetKind } from "@mapmaker/core";
import { store } from "./store.ts";

export type CityTool = "pan" | "select" | "building" | "outline" | "street" | "ground";

export interface CityUi {
  tool: CityTool;
  /** Ids of the selected buildings and streets. */
  selected: string[];
  /** What the next building looks like. */
  roof: RoofStyle;
  /** Where a new building's roof comes from: a picture of the asset packs whenever one fits its roof look (the default), or always drawn from the look. */
  roofSource: "assets" | "drawn";
  kind: BuildingKind;
  /** The next rectangular building is turned this many degrees clockwise (Q and E change it). */
  angle: number;
  /** What the next street is. */
  streetKind: StreetKind;
  /** Ground material id and brush radius in metres. */
  material: number;
  brush: number;
}

export const defaultCityUi: CityUi = { tool: "pan", selected: [], roof: "slate", roofSource: "assets", kind: "house", angle: 0, streetKind: "street", material: 4, brush: 6 };

export const CITY_TOOL_GROUPS: { name: string; tools: { id: CityTool; label: string; key: string; tip: string }[] }[] = [
  { name: "Move", tools: [
    { id: "pan", label: "Pan", key: "H", tip: "Drag to move the map (or hold Space / right-drag with any tool)" },
    { id: "select", label: "Select", key: "V", tip: "Click a building or street to select it, drag it to move it; drag on bare ground to box-select; Shift-click adds. Delete removes, Q and E turn buildings" },
  ] },
  { name: "Build", tools: [
    { id: "building", label: "Building", key: "B", tip: "Click to place a house; drag a rectangle to size one. Q and E turn it (15° at a time)" },
    { id: "outline", label: "Outline", key: "O", tip: "Click the corners of a building of any shape. Double-click, click the first corner or press Enter to finish; Backspace drops a corner, Esc cancels" },
    { id: "street", label: "Street", key: "S", tip: "Click the points a street passes through; double-click or press Enter to finish. Backspace drops a point, Esc cancels" },
  ] },
  { name: "Ground", tools: [
    { id: "ground", label: "Paint ground", key: "P", tip: "Paint water, grass, cobbles and the like. [ and ] change the brush size" },
  ] },
];
export const CITY_TOOL_DEFS = CITY_TOOL_GROUPS.flatMap((g) => g.tools);

/** A new building 6 x 8 m (what a click with the Building tool makes). */
export const DEFAULT_HOUSE = { w: 6, h: 8 };

/** Send a change to features as one undoable edit. */
export function sendCityFeatures(patch: FeaturesPatch, label: string) {
  store.send({ t: "cmd", cmd: { op: "features", patch }, label });
}

/** The selected things, split by kind. */
export function selectedOf(f: Features, ids: string[]): { buildings: MapBuilding[]; streets: MapStreet[] } {
  const want = new Set(ids);
  return { buildings: (f.buildings ?? []).filter((b) => want.has(b.id)), streets: (f.streets ?? []).filter((s) => want.has(s.id)) };
}
