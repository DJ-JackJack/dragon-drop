/** The city map's tools, their keys and the editor's own settings for them (nothing here is saved with the map). One list: the toolbar, the key handler and the shortcut sheet read it. */
import type { BuildingKind, CityLabelKind, CityWallKind, Features, FeaturesPatch, MapBuilding, MapCityWall, MapDistrict, MapLabel, MapLandform, MapStreet, MapTrees, RoofStyle, StreetKind, TreeGroup, TreeSpecies } from "@mapmaker/core";
import { store } from "./store.ts";

export type CityTool = "pan" | "select" | "measure" | "building" | "outline" | "street" | "citywall" | "ground" | "hills" | "trees" | "citylabel" | "district" | "citybattle";

/** What the Land tool makes: a hill (a click, or a drag for its size), a ridge or valley (points along it), a plateau or hollow (an outline), a slope (a drag from low to high). */
export type LandMode = "hill" | "ridge" | "valley" | "plateau" | "hollow" | "slope";

export interface CityUi {
  tool: CityTool;
  /** Ids of the selected buildings and streets. */
  selected: string[];
  /** What the next building looks like. */
  roof: RoofStyle;
  /**
   * Where a new building's roof comes from: a picture of the asset packs whenever one fits its roof look (the default: a different one for each building),
   * always drawn from the look, or the one picture the person chose (`roofPick`).
   */
  roofSource: "assets" | "drawn" | "picture";
  roofPick: { asset: string; tile: number } | null;
  kind: BuildingKind;
  /** The next rectangular building is turned this many degrees clockwise (Q and E change it). */
  angle: number;
  /** What the next street is, and what it becomes where it crosses water ("auto": stone for avenues and streets, wood for the rest). */
  streetKind: StreetKind;
  streetBridge: "auto" | "stone" | "wood" | "none";
  /** Ground material id and brush radius in metres. */
  material: number;
  brush: number;
  /** The Land tool: what it makes, how high or deep (metres) and how big (a hill's radius, a ridge's half-width, a plateau's soft edge, metres). */
  landMode: LandMode;
  landHeight: number;
  landSize: number;
  /** The Trees tool: what it plants, the crown size (metres, 0 for the usual) and the kind of tree ("" for the climate's mix). */
  treeKind: TreeGroup;
  treeSize: number;
  treeSpecies: TreeSpecies | "";
  /** The Wall tool: what the next wall is built of, and metres between its towers (0: none). */
  wallKind: CityWallKind;
  wallTowers: number;
  /** The Name tool: what a new label names, and its size (1 is usual). */
  labelKind: CityLabelKind;
  labelSize: number;
  /** Draw the contour lines. */
  contours: boolean;
  /** Draw the names (labels, and the names of streets and buildings). */
  names: boolean;
}

export const defaultCityUi: CityUi = {
  tool: "pan", selected: [], roof: "slate", roofSource: "assets", roofPick: null, kind: "house", angle: 0, streetKind: "street", streetBridge: "auto", material: 4, brush: 6,
  landMode: "hill", landHeight: 15, landSize: 80, treeKind: "wood", treeSize: 0, treeSpecies: "", wallKind: "stone", wallTowers: 40, labelKind: "district", labelSize: 1, contours: true, names: true,
};

export const CITY_TOOL_GROUPS: { name: string; tools: { id: CityTool; label: string; key: string; tip: string }[] }[] = [
  { name: "Move", tools: [
    { id: "pan", label: "Pan", key: "H", tip: "Drag to move the map (or hold Space / right-drag with any tool)" },
    { id: "select", label: "Select", key: "V", tip: "Click a building or street to select it, drag it to move it; drag on bare ground to box-select; Shift-click adds. Delete removes, Q and E turn buildings" },
    { id: "measure", label: "Ruler", key: "K", tip: "Click points to measure a distance in metres and feet, and how long it takes on foot. Double-click or Enter finishes, Backspace takes back a point, Esc clears" },
  ] },
  { name: "Build", tools: [
    { id: "building", label: "Building", key: "B", tip: "Click to place a house; drag a rectangle to size one. Q and E turn it (15° at a time)" },
    { id: "outline", label: "Outline", key: "O", tip: "Click the corners of a building of any shape. Double-click, click the first corner or press Enter to finish; Backspace drops a corner, Esc cancels" },
    { id: "street", label: "Street", key: "S", tip: "Click the points a street passes through; double-click or press Enter to finish. Backspace drops a point, Esc cancels" },
    { id: "citywall", label: "Wall", key: "W", tip: "Click the points of a town wall: click the first point to close it into a ring, or double-click or press Enter to end it. A gate appears wherever a street crosses it" },
  ] },
  { name: "Land", tools: [
    { id: "ground", label: "Paint ground", key: "P", tip: "Paint water, grass, cobbles and the like. [ and ] change the brush size" },
    { id: "hills", label: "Land", key: "L", tip: "Shape the land: hills, ridges, valleys, plateaus and slopes. Click one to select it" },
    { id: "trees", label: "Trees", key: "T", tip: "Plant woods, orchards, scattered trees, rows and single trees; their kind follows the climate" },
  ] },
  { name: "More", tools: [
    { id: "citylabel", label: "Name", key: "N", tip: "Click a street, building or wall to name it; click open ground to write a name there (a district, water, a landmark)" },
    { id: "district", label: "District", key: "D", tip: "Click the corners of a district (a quarter or ward); click the first corner, double-click or press Enter to finish, then name it" },
    { id: "citybattle", label: "Battlemap here", key: "M", tip: "Click a spot for a battlemap of 30 x 20 squares round it (as on the world map), or drag a box round the place of a fight: a battlemap of it opens, with its buildings as walls, doors and roofs" },
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
export function selectedOf(f: Features, ids: string[]): { buildings: MapBuilding[]; streets: MapStreet[]; trees: MapTrees[]; land: MapLandform[]; walls: MapCityWall[]; labels: MapLabel[]; districts: MapDistrict[] } {
  const want = new Set(ids);
  return {
    buildings: (f.buildings ?? []).filter((b) => want.has(b.id)), streets: (f.streets ?? []).filter((s) => want.has(s.id)),
    trees: (f.trees ?? []).filter((t) => want.has(t.id)), land: (f.land ?? []).filter((l) => want.has(l.id)), walls: (f.cityWalls ?? []).filter((w) => want.has(w.id)),
    labels: (f.labels ?? []).filter((l) => want.has(l.id)), districts: (f.districts ?? []).filter((d) => want.has(d.id)),
  };
}

/** Remove the selected things, as one edit. */
export function removeSelected(f: Features, ids: string[]): boolean {
  const { buildings, streets, trees, land, walls, labels, districts } = selectedOf(f, ids);
  const n = buildings.length + streets.length + trees.length + land.length + walls.length + labels.length + districts.length;
  if (!n) return false;
  const what = n > 1 ? `Delete ${n} items` : buildings.length ? "Delete building" : streets.length ? "Delete street" : trees.length ? "Delete trees" : walls.length ? "Delete wall" : labels.length ? `Delete name ${labels[0].text}` : districts.length ? `Delete district${districts[0].name ? ` ${districts[0].name}` : ""}` : `Delete ${landName(land[0]).toLowerCase()}`;
  sendCityFeatures({
    ...(buildings.length && { removeBuildings: buildings.map((b) => b.id) }), ...(streets.length && { removeStreets: streets.map((s) => s.id) }),
    ...(trees.length && { removeTrees: trees.map((t) => t.id) }), ...(land.length && { removeLand: land.map((l) => l.id) }), ...(walls.length && { removeCityWalls: walls.map((w) => w.id) }),
    ...(labels.length && { removeLabels: labels.map((l) => l.id) }), ...(districts.length && { removeDistricts: districts.map((d) => d.id) }),
  }, what);
  return true;
}

/** A landform as the DM thinks of it: a ridge sunk is a valley, a plateau sunk a hollow. */
export function landName(l: MapLandform): string {
  return l.name ?? (l.kind === "ridge" ? (l.height < 0 ? "Valley" : "Ridge") : l.kind === "plateau" ? (l.height < 0 ? "Hollow" : "Plateau") : l.kind === "hill" ? "Hill" : "Slope");
}
