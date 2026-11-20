/** Vector features drawn over the terrain: named places (the gazetteer) and map labels. */
import type { RiverInflow } from "./hydrology.ts";
import type { TracePicture } from "./trace.ts";

import { PLACE_KINDS, type PlaceType } from "./placeKinds.ts"; // (PlaceType itself is exported from placeKinds.ts, through the index)

export interface Place {
  id: string;
  name: string;
  type: PlaceType;
  /** Map px. */
  x: number;
  y: number;
  notes?: string;
  /** Hide the name next to the marker (e.g. when a separate label is used). */
  hideName?: boolean;
  /** Don't draw a marker: for landmarks the terrain already shows (a peak, a crater). */
  hideMarker?: boolean;
  /** Where the name goes relative to the marker (default "auto": the first free side). */
  namePos?: NamePos;
}

export type NamePos = "auto" | "right" | "left" | "above" | "below";

export type LabelKind = "sea" | "region" | "range" | "island" | "feature";

export interface MapLabel {
  id: string;
  text: string;
  kind: LabelKind;
  /** Centre of the label, map px. */
  x: number;
  y: number;
  /** Rotation in degrees (clockwise). */
  angle?: number;
  /** Bend: -1..1 (positive arches upward like a rainbow). */
  curve?: number;
  /** Size multiplier (default 1). */
  size?: number;
  /**
   * Optional line (map px) the text follows, e.g. a range's crest or a river. The text is
   * centred on it and reads left to right; angle and curve are ignored. x/y is its midpoint.
   */
  path?: [number, number][];
  /** With a path: stretch the letter spacing so the name runs the length of the line. */
  spread?: boolean;
}

/**
 * An area whose climate replaces the natural gradient inside its borders (a spirit's domain,
 * a curse, an eternal winter). Unset values leave that part of the climate alone.
 */
export interface ClimateRegion {
  id: string;
  name: string;
  /** Outline (map px), closed automatically. */
  polygon: [number, number][];
  /** 0 frozen, 0.25 cold, 0.5 temperate, 0.75 warm, 1 hot. */
  temperature?: number;
  /** 0 arid, 0.25 dry, 0.5 normal, 0.75 wet, 1 lush. */
  moisture?: number;
  /** Ground snow cover 0..1, even on low ground. */
  snow?: number;
  /** Bare dark stone cover 0..1: the land inside shows dark rock instead of grass and forest (rocky outcroppings, scorched or barren ground). */
  rock?: number;
  /** Volcanic ground cover 0..1: black ash plains, dark lava fields with glowing cracks and cinders (volcanic country, scorched land); black-sand shores. */
  volcanic?: number;
  /** How completely it overrides the natural climate, 0..1 (default 1). */
  strength?: number;
  /** "hard": a sharp edge; "soft" (default): blends across blendKm. */
  border?: "hard" | "soft";
  /** Width of a soft border in km (default 80). */
  blendKm?: number;
  /** Who or what holds it (free text, e.g. a spirit). */
  owner?: string;
  notes?: string;
}

export type LineKind = "road" | "trail" | "border" | "reef";

/** A road, trail or border: a polyline on the map. */
export interface MapLine {
  id: string;
  kind: LineKind;
  name?: string;
  /** Map px. */
  points: [number, number][];
  /** Borders: join the last point back to the first. */
  closed?: boolean;
  notes?: string;
}

export type WallKind = "wall" | "door" | "secret" | "window" | "invisible";

/** A wall, door, secret door, window or invisible barrier on a battlemap. Points are in grid squares. */
export interface MapWall {
  id: string;
  kind: WallKind;
  points: [number, number][];
  /** Join the last point back to the first. */
  closed?: boolean;
  /** Doors: drawn and exported open. */
  open?: boolean;
  /** Doors: locked (Foundry only). */
  locked?: boolean;
  /** Built automatically around painted floor (so it can be rebuilt without piling up). */
  auto?: boolean;
  notes?: string;
}

/** The straight pieces a wall is made of (a closed wall includes the piece back to its start). */
export function wallSegments(w: MapWall): [[number, number], [number, number]][] {
  const pts = w.closed && w.points.length > 2 ? [...w.points, w.points[0]] : w.points;
  const out: [[number, number], [number, number]][] = [];
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
  return out;
}

/** A light on a battlemap (grid squares). */
export interface MapLight {
  id: string;
  x: number;
  y: number;
  /** Reach of the dim light, in squares. */
  radius: number;
  /** Reach of the bright light, in squares (default half the radius). */
  bright?: number;
  /** "#rrggbb" (default a warm torch colour). */
  colour?: string;
  /** 0..1 (default 1). */
  intensity?: number;
  /** Blocked by walls (default true). */
  shadows?: boolean;
  notes?: string;
}

/** A numbered note on a battlemap: a room or spot the DM wants to describe (the map's "key"). Grid squares. */
export interface MapNote {
  id: string;
  x: number;
  y: number;
  /** The number shown on the marker and in the key (no two notes need to differ, but they usually do). */
  n: number;
  title: string;
  /** What is here: read-aloud text, treasure, traps... */
  text?: string;
}

/** An area with its own light level, e.g. a roofed building that is dimmer than the open air around it. Grid squares. */
export interface MapAmbientZone {
  id: string;
  name?: string;
  /** The outline (closed). */
  points: [number, number][];
  /** How bright it is inside where no light reaches, 0.05..1 (see BattleSpec.ambient). */
  ambient: number;
}

/** An object from an asset pack placed on a battlemap (grid squares). */
export interface MapProp {
  id: string;
  /** "<pack>:<path>" */
  asset: string;
  /** Centre, in squares. */
  x: number;
  y: number;
  /** Degrees clockwise. */
  rotation?: number;
  /** 1 = the image's own size (256 px per square). */
  scale?: number;
  /** Mirror left-right. */
  flip?: boolean;
  /** Drawn under the walls ("below") or over them (default "above"). */
  layer?: "below" | "above";
  opacity?: number;
}

export type RoofStyle = "slate" | "tile" | "thatch" | "shingle";
export const ROOF_STYLES: readonly RoofStyle[] = ["slate", "tile", "thatch", "shingle"];

/**
 * A roof on a battlemap: an area (squares) on the level it covers, drawn over everything on that level when roofs are shown. In a Foundry scene the roofs of a level are
 * drawn into one transparent picture that becomes the level's foreground (it hides the inside from a distance, and Foundry fades it as tokens go under it: docs/FOUNDRY.md).
 * They are never part of the ordinary picture or the Universal VTT file, or they would hide the rooms.
 */
export interface MapRoof {
  id: string;
  name?: string;
  /** The outline, closed, in squares: a rectangle's four corners, or any polygon. */
  points: [number, number][];
  /** The look Dragon Drop draws. */
  style: RoofStyle;
  /** Or a picture from an asset pack ("<pack>:<path>"), tiled across the roof; then `style` only matters if the picture is missing. */
  asset?: string;
  /** How many squares one repeat of the asset picture covers (default 2). */
  tile?: number;
  /** A colour that replaces the style's own (or tints the asset), "#rrggbb". */
  colour?: string;
  /** No ridge and slopes: a flat roof (the default is a pitched one, its ridge along the longer way). */
  flat?: boolean;
}

/** What a building is, for pickers and for Claude (a free choice: it changes nothing about how it is drawn). */
export const BUILDING_KINDS = ["house", "shop", "tavern", "inn", "temple", "hall", "tower", "barn", "warehouse", "arena", "gatehouse", "other"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/**
 * A building on a city map: its outline seen from above, in METRES from the map's top-left corner, drawn as a roof (`roof`, `colour` and `flat` mean what they do for a
 * battlemap roof; with no colour, each building gets a slightly different shade of its roof look, so a street of houses does not look stamped).
 */
export interface MapBuilding {
  id: string;
  name?: string;
  /** The outline, closed, in metres: a rectangle's four corners or any polygon. */
  points: [number, number][];
  /** The roof look (default slate). */
  roof?: RoofStyle;
  /** "#rrggbb": replaces the look's own colour (or tints the roof picture). */
  colour?: string;
  /** No ridge and slopes. */
  flat?: boolean;
  kind?: BuildingKind;
  floors?: number;
  /** A roof texture from an asset pack ("<pack>:<path>"), tiled across the roof in place of drawing the look: buildings get one whenever the packs have an appropriate one (roofAssets.ts). */
  asset?: string;
  /** Metres one repeat of the roof picture covers (default 6). */
  tile?: number;
}

/** The kinds of street, with the width (metres) each starts with. */
export const STREET_KINDS = [
  { id: "avenue", name: "Avenue", width: 12 },
  { id: "street", name: "Street", width: 7 },
  { id: "lane", name: "Lane", width: 4 },
  { id: "alley", name: "Alley", width: 2 },
  { id: "path", name: "Path", width: 1.5 },
] as const;
export type StreetKind = (typeof STREET_KINDS)[number]["id"];

/** A street, lane or path on a city map: a line through points in metres, with a width in metres. */
export interface MapStreet {
  id: string;
  name?: string;
  points: [number, number][];
  /** Metres across. */
  width: number;
  kind?: StreetKind;
}

/**
 * The lie of the land on a city map, as shapes (cityLand.ts adds them up into heights, the shading and the contour lines). A hill is its top (one point); a ridge is a line along its
 * crest, and with a negative height it is a valley; a plateau is an outline raised (or, negative, sunk) evenly with a soft edge; a slope is two points, the ground rising by `height` from
 * the first to the second across the whole city (the land falling to the sea, say).
 */
export const LANDFORM_KINDS = ["hill", "ridge", "plateau", "slope"] as const;
export type LandformKind = (typeof LANDFORM_KINDS)[number];
export interface MapLandform {
  id: string;
  kind: LandformKind;
  points: [number, number][];
  /** Metres higher (negative: lower) than the ground around it at its top or crest; for a slope, the rise from the first point to the second. */
  height: number;
  /** Metres: a hill's radius, a ridge's half-width, a plateau's soft edge (unused by a slope). */
  radius: number;
  name?: string;
}

/** Trees on a city map: an area of wood, orchard or scattered trees (an outline), a row along a line, or one tree (one point). Their kind follows the city's climate unless given. */
export const TREE_GROUPS = ["wood", "orchard", "scattered", "row", "tree"] as const;
export type TreeGroup = (typeof TREE_GROUPS)[number];
export const TREE_SPECIES = ["conifer", "broadleaf", "palm", "olive", "cypress", "thorn"] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];
export interface MapTrees {
  id: string;
  kind: TreeGroup;
  points: [number, number][];
  /** Crown across, metres (default by kind: 7 in a wood, 5 in an orchard). */
  size?: number;
  /** One kind of tree for all of them (default: the climate's mix). */
  species?: TreeSpecies;
  name?: string;
}

export type ConnectorKind = "stairs" | "ladder" | "hole";
export const CONNECTOR_KINDS: readonly ConnectorKind[] = ["stairs", "ladder", "hole"];

/**
 * A way between the levels of a battlemap, as a rectangle on the level it starts on (grid squares). Stairs and ladders lead to the level above or below (by
 * elevation); a hole is an opening in this level's floor, so it always leads down. In a Foundry scene a stair or ladder is a Change Level region over both levels and
 * a hole is a gap in the level's floor region (docs/FOUNDRY.md).
 */
export interface MapConnector {
  id: string;
  kind: ConnectorKind;
  name?: string;
  /** The top-left corner and the size, in squares. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which way it leads from this level. (A hole always leads down: see connectorTo.) */
  to: "up" | "down";
}

/** Which way a connector leads: a hole always leads down. */
export function connectorTo(c: Pick<MapConnector, "kind" | "to">): "up" | "down" {
  return c.kind === "hole" ? "down" : c.to;
}

/** How much water a river source adds. The numbers are shares of the whole map's runoff: a river is anything above about 0.002, and the biggest ordinary rivers carry about 0.03. */
export type RiverSize = "stream" | "river" | "major" | "great";
export const RIVER_SIZE_SHARE: Record<RiverSize, number> = { stream: 0.002, river: 0.008, major: 0.03, great: 0.08 };

/**
 * Where a river begins with more water than the land around it could supply: a great spring, or a waterfall that is fed from far
 * upstream, beyond what the map shows. It adds flow at one point and the river runs downhill from there like any other.
 */
export interface RiverSource {
  id: string;
  /** The name of the river it feeds: only a name the user gave. */
  name?: string;
  /** The place it is at: the source moves with that place. */
  placeId?: string;
  /** Map px, when it isn't tied to a place. */
  x?: number;
  y?: number;
  size: RiverSize;
  notes?: string;
}

/** The sources that can be located (a source whose place was removed is skipped), ready for the hydrology. */
export function resolveRiverSources(f: Features | undefined): RiverInflow[] {
  const places = new Map((f?.places ?? []).map((p) => [p.id, p]));
  const out: RiverInflow[] = [];
  for (const s of f?.sources ?? []) {
    const at = s.placeId ? places.get(s.placeId) : s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y } : undefined;
    if (at) out.push({ x: at.x, y: at.y, share: RIVER_SIZE_SHARE[s.size] ?? RIVER_SIZE_SHARE.river });
  }
  return out;
}

export interface Features {
  places: Place[];
  labels: MapLabel[];
  /** Battlemaps: walls, doors and windows. */
  walls?: MapWall[];
  /** Battlemaps: lights. */
  lights?: MapLight[];
  /** Battlemaps: objects from asset packs. */
  props?: MapProp[];
  /** Battlemaps: numbered notes (the key to the map). Drawn in previews, never in exports. */
  notes?: MapNote[];
  /** Battlemaps: areas with their own light level. */
  zones?: MapAmbientZone[];
  /** Battlemaps: stairs, ladders and holes between levels. */
  connectors?: MapConnector[];
  /** Battlemaps: roofs over this level. */
  roofs?: MapRoof[];
  /** Roads, trails and borders (optional: older projects have none). */
  lines?: MapLine[];
  /** Climate regions (optional: older projects have none). */
  regions?: ClimateRegion[];
  /** River sources: where a river starts with more water than its land supplies (optional). */
  sources?: RiverSource[];
  /** The trace picture: a reference picture laid over the map (or this battlemap level) to redraw from. Never exported (trace.ts). */
  trace?: TracePicture;
  /** City maps: the buildings (outlines in metres, drawn as roofs). */
  buildings?: MapBuilding[];
  /** City maps: streets, lanes and paths. */
  streets?: MapStreet[];
  /** City maps: the lie of the land (hills, ridges, valleys, plateaus, slopes). */
  land?: MapLandform[];
  /** City maps: woods, orchards, rows and single trees. */
  trees?: MapTrees[];
}

export interface FeaturesPatch {
  upsertPlaces?: Place[];
  removePlaces?: string[];
  upsertLabels?: MapLabel[];
  removeLabels?: string[];
  upsertRegions?: ClimateRegion[];
  removeRegions?: string[];
  upsertSources?: RiverSource[];
  removeSources?: string[];
  upsertLines?: MapLine[];
  removeLines?: string[];
  upsertWalls?: MapWall[];
  removeWalls?: string[];
  upsertLights?: MapLight[];
  removeLights?: string[];
  upsertProps?: MapProp[];
  removeProps?: string[];
  upsertNotes?: MapNote[];
  removeNotes?: string[];
  upsertZones?: MapAmbientZone[];
  removeZones?: string[];
  upsertConnectors?: MapConnector[];
  removeConnectors?: string[];
  upsertRoofs?: MapRoof[];
  removeRoofs?: string[];
  /** Lay a trace picture over the map (replacing any), or null to take it away. */
  setTrace?: TracePicture | null;
  upsertBuildings?: MapBuilding[];
  removeBuildings?: string[];
  upsertStreets?: MapStreet[];
  removeStreets?: string[];
  upsertLand?: MapLandform[];
  removeLand?: string[];
  upsertTrees?: MapTrees[];
  removeTrees?: string[];
}

export function emptyFeatures(): Features {
  return { places: [], labels: [], regions: [], lines: [] };
}

export function applyFeaturesPatch(f: Features, p: FeaturesPatch): Features {
  const places = new Map(f.places.map((x) => [x.id, x]));
  const labels = new Map(f.labels.map((x) => [x.id, x]));
  for (const id of p.removePlaces ?? []) places.delete(id);
  for (const id of p.removeLabels ?? []) labels.delete(id);
  // upserts replace the whole item (callers send complete objects), so dropping an optional
  // field such as a label's path really removes it
  for (const x of p.upsertPlaces ?? []) places.set(x.id, x);
  for (const x of p.upsertLabels ?? []) labels.set(x.id, x);
  const out: Features = { places: [...places.values()], labels: [...labels.values()] };
  if (f.regions || p.upsertRegions || p.removeRegions) {
    const regions = new Map((f.regions ?? []).map((x) => [x.id, x]));
    for (const id of p.removeRegions ?? []) regions.delete(id);
    for (const x of p.upsertRegions ?? []) regions.set(x.id, x);
    out.regions = [...regions.values()];
  }
  if (f.sources || p.upsertSources || p.removeSources || p.removePlaces?.length) {
    const sources = new Map((f.sources ?? []).map((x) => [x.id, x]));
    for (const id of p.removeSources ?? []) sources.delete(id);
    for (const x of p.upsertSources ?? []) sources.set(x.id, x);
    // a source that is at a place goes when the place does
    const gone = new Set(p.removePlaces ?? []);
    for (const [id, x] of sources) if (x.placeId && gone.has(x.placeId)) sources.delete(id);
    if (sources.size || f.sources || p.upsertSources) out.sources = [...sources.values()];
  }
  if (f.lines || p.upsertLines || p.removeLines) {
    const lines = new Map((f.lines ?? []).map((x) => [x.id, x]));
    for (const id of p.removeLines ?? []) lines.delete(id);
    for (const x of p.upsertLines ?? []) lines.set(x.id, x);
    out.lines = [...lines.values()];
  }
  if (f.walls || p.upsertWalls || p.removeWalls) {
    const walls = new Map((f.walls ?? []).map((x) => [x.id, x]));
    for (const id of p.removeWalls ?? []) walls.delete(id);
    for (const x of p.upsertWalls ?? []) walls.set(x.id, x);
    out.walls = [...walls.values()];
  }
  if (f.lights || p.upsertLights || p.removeLights) {
    const lights = new Map((f.lights ?? []).map((x) => [x.id, x]));
    for (const id of p.removeLights ?? []) lights.delete(id);
    for (const x of p.upsertLights ?? []) lights.set(x.id, x);
    out.lights = [...lights.values()];
  }
  if (f.props || p.upsertProps || p.removeProps) {
    const props = new Map((f.props ?? []).map((x) => [x.id, x]));
    for (const id of p.removeProps ?? []) props.delete(id);
    for (const x of p.upsertProps ?? []) props.set(x.id, x);
    out.props = [...props.values()];
  }
  if (f.notes || p.upsertNotes || p.removeNotes) {
    const notes = new Map((f.notes ?? []).map((x) => [x.id, x]));
    for (const id of p.removeNotes ?? []) notes.delete(id);
    for (const x of p.upsertNotes ?? []) notes.set(x.id, x);
    out.notes = [...notes.values()];
  }
  if (f.zones || p.upsertZones || p.removeZones) {
    const zones = new Map((f.zones ?? []).map((x) => [x.id, x]));
    for (const id of p.removeZones ?? []) zones.delete(id);
    for (const x of p.upsertZones ?? []) zones.set(x.id, x);
    out.zones = [...zones.values()];
  }
  if (f.connectors || p.upsertConnectors || p.removeConnectors) {
    const connectors = new Map((f.connectors ?? []).map((x) => [x.id, x]));
    for (const id of p.removeConnectors ?? []) connectors.delete(id);
    for (const x of p.upsertConnectors ?? []) connectors.set(x.id, x);
    out.connectors = [...connectors.values()];
  }
  if (f.roofs || p.upsertRoofs || p.removeRoofs) {
    const roofs = new Map((f.roofs ?? []).map((x) => [x.id, x]));
    for (const id of p.removeRoofs ?? []) roofs.delete(id);
    for (const x of p.upsertRoofs ?? []) roofs.set(x.id, x);
    out.roofs = [...roofs.values()];
  }
  if (f.buildings || p.upsertBuildings || p.removeBuildings) {
    const buildings = new Map((f.buildings ?? []).map((x) => [x.id, x]));
    for (const id of p.removeBuildings ?? []) buildings.delete(id);
    for (const x of p.upsertBuildings ?? []) buildings.set(x.id, x);
    out.buildings = [...buildings.values()];
  }
  if (f.streets || p.upsertStreets || p.removeStreets) {
    const streets = new Map((f.streets ?? []).map((x) => [x.id, x]));
    for (const id of p.removeStreets ?? []) streets.delete(id);
    for (const x of p.upsertStreets ?? []) streets.set(x.id, x);
    out.streets = [...streets.values()];
  }
  // (the land and the trees keep their array when a patch doesn't touch them: the heights, shading and tree crowns worked out from them are cached by it)
  if (p.upsertLand || p.removeLand) {
    const land = new Map((f.land ?? []).map((x) => [x.id, x]));
    for (const id of p.removeLand ?? []) land.delete(id);
    for (const x of p.upsertLand ?? []) land.set(x.id, x);
    out.land = [...land.values()];
  } else if (f.land) out.land = f.land;
  if (p.upsertTrees || p.removeTrees) {
    const trees = new Map((f.trees ?? []).map((x) => [x.id, x]));
    for (const id of p.removeTrees ?? []) trees.delete(id);
    for (const x of p.upsertTrees ?? []) trees.set(x.id, x);
    out.trees = [...trees.values()];
  } else if (f.trees) out.trees = f.trees;
  const trace = p.setTrace === undefined ? f.trace : p.setTrace;
  if (trace) out.trace = trace;
  return out;
}

export function describeFeaturesPatch(p: FeaturesPatch): string {
  const parts: string[] = [];
  const names = (a?: { name?: string; text?: string }[]) => (a ?? []).map((x) => x.name ?? x.text).filter(Boolean).join(", ");
  if (p.upsertPlaces?.length) parts.push(`place ${names(p.upsertPlaces)}`);
  if (p.upsertLabels?.length) parts.push(`label ${names(p.upsertLabels)}`);
  if (p.removePlaces?.length) parts.push(`remove ${p.removePlaces.length} place(s)`);
  if (p.removeLabels?.length) parts.push(`remove ${p.removeLabels.length} label(s)`);
  if (p.upsertSources?.length) parts.push(`river source ${names(p.upsertSources) || p.upsertSources[0].size}`);
  if (p.removeSources?.length) parts.push(`remove ${p.removeSources.length} river source(s)`);
  if (p.upsertRegions?.length) parts.push(`climate region ${names(p.upsertRegions)}`);
  if (p.removeRegions?.length) parts.push(`remove ${p.removeRegions.length} climate region(s)`);
  if (p.upsertLines?.length) parts.push(`${p.upsertLines.map((l) => l.kind).join(", ")} ${names(p.upsertLines)}`.trim());
  if (p.removeLines?.length) parts.push(`remove ${p.removeLines.length} line(s)`);
  if (p.upsertWalls?.length) parts.push(p.upsertWalls.length === 1 ? p.upsertWalls[0].kind : `${p.upsertWalls.length} walls/doors`);
  if (p.removeWalls?.length) parts.push(`remove ${p.removeWalls.length} wall(s)`);
  if (p.upsertLights?.length) parts.push(`${p.upsertLights.length} light(s)`);
  if (p.removeLights?.length) parts.push(`remove ${p.removeLights.length} light(s)`);
  if (p.upsertProps?.length) parts.push(p.upsertProps.length === 1 ? "object" : `${p.upsertProps.length} objects`);
  if (p.removeProps?.length) parts.push(`remove ${p.removeProps.length} object(s)`);
  if (p.upsertNotes?.length) parts.push(p.upsertNotes.length === 1 ? `note ${p.upsertNotes[0].n}` : `${p.upsertNotes.length} notes`);
  if (p.removeNotes?.length) parts.push(`remove ${p.removeNotes.length} note(s)`);
  if (p.upsertZones?.length) parts.push(p.upsertZones.length === 1 ? `light zone${p.upsertZones[0].name ? ` ${p.upsertZones[0].name}` : ""}` : `${p.upsertZones.length} light zones`);
  if (p.removeZones?.length) parts.push(`remove ${p.removeZones.length} light zone(s)`);
  if (p.upsertConnectors?.length) parts.push(p.upsertConnectors.length === 1 ? (p.upsertConnectors[0].name ?? p.upsertConnectors[0].kind) : `${p.upsertConnectors.length} stairs, ladders and holes`);
  if (p.upsertRoofs?.length) parts.push(p.upsertRoofs.length === 1 ? (p.upsertRoofs[0].name ?? "roof") : `${p.upsertRoofs.length} roofs`);
  if (p.removeRoofs?.length) parts.push(`remove ${p.removeRoofs.length} roof(s)`);
  if (p.removeConnectors?.length) parts.push(`remove ${p.removeConnectors.length} stair(s), ladder(s) or hole(s)`);
  if (p.setTrace !== undefined) parts.push(p.setTrace ? `trace picture ${p.setTrace.ref}` : "remove the trace picture");
  if (p.upsertBuildings?.length) parts.push(p.upsertBuildings.length === 1 ? (p.upsertBuildings[0].name ?? p.upsertBuildings[0].kind ?? "building") : `${p.upsertBuildings.length} buildings`);
  if (p.removeBuildings?.length) parts.push(`remove ${p.removeBuildings.length} building(s)`);
  if (p.upsertStreets?.length) parts.push(p.upsertStreets.length === 1 ? (p.upsertStreets[0].name ?? p.upsertStreets[0].kind ?? "street") : `${p.upsertStreets.length} streets`);
  if (p.removeStreets?.length) parts.push(`remove ${p.removeStreets.length} street(s)`);
  if (p.upsertLand?.length) parts.push(p.upsertLand.length === 1 ? (p.upsertLand[0].name ?? (p.upsertLand[0].kind === "ridge" && p.upsertLand[0].height < 0 ? "valley" : p.upsertLand[0].kind)) : `${p.upsertLand.length} landforms`);
  if (p.removeLand?.length) parts.push(`remove ${p.removeLand.length} landform(s)`);
  if (p.upsertTrees?.length) parts.push(p.upsertTrees.length === 1 ? (p.upsertTrees[0].name ?? p.upsertTrees[0].kind) : `${p.upsertTrees.length} groups of trees`);
  if (p.removeTrees?.length) parts.push(`remove ${p.removeTrees.length} group(s) of trees`);
  return parts.length ? `Edit ${parts.join("; ")}` : "Edit places/labels";
}

/** Base text size per label kind, in map px for a 1024-px-wide map. */
export const LABEL_SIZE: Record<LabelKind, number> = { sea: 22, region: 17, range: 12, island: 12, feature: 10 };
export const PLACE_SIZE = Object.fromEntries(PLACE_KINDS.map((x) => [x.id, x.label])) as Record<PlaceType, number>;

/** Scale every coordinate (after resizing a map). Sizes are relative to map width, so they stay. */
export function scaleFeatures(f: Features, k: number): Features {
  return {
    ...f,
    places: f.places.map((p) => ({ ...p, x: p.x * k, y: p.y * k })),
    labels: f.labels.map((l) => ({ ...l, x: l.x * k, y: l.y * k, ...(l.path && { path: l.path.map(([x, y]) => [x * k, y * k] as [number, number]) }) })),
    ...(f.regions && { regions: f.regions.map((r) => ({ ...r, polygon: r.polygon.map(([x, y]) => [x * k, y * k] as [number, number]) })) }),
    ...(f.lines && { lines: f.lines.map((l) => ({ ...l, points: l.points.map(([x, y]) => [x * k, y * k] as [number, number]) })) }),
  };
}

/** A label moved by (dx, dy), path included. */
export function moveLabel(l: MapLabel, dx: number, dy: number): MapLabel {
  return { ...l, x: l.x + dx, y: l.y + dy, ...(l.path && { path: l.path.map(([x, y]) => [x + dx, y + dy] as [number, number]) }) };
}

/** The point halfway along a polyline (by length). */
export function pathMidpoint(path: [number, number][]): [number, number] {
  if (path.length === 1) return path[0];
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  let left = total / 2;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg >= left && seg > 0) return [ax + ((bx - ax) * left) / seg, ay + ((by - ay) * left) / seg];
    left -= seg;
  }
  return path[path.length - 1];
}

/** Ramer-Douglas-Peucker: drop points within eps of the simplified line. */
export function simplifyPath(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1, wd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function labelText(l: MapLabel): string {
  return l.kind === "sea" || l.kind === "region" || l.kind === "range" ? l.text.toUpperCase() : l.text;
}

let counter = 0;
export function newFeatureId(prefix: "p" | "l" | "r" | "m" | "w" | "g" | "o" | "n" | "z" | "s" | "c" | "f" | "b" | "t" | "h" | "v"): string {
  return `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
