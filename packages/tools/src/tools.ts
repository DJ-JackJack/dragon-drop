/**
 * The map tools Claude uses. Defined once here; exposed through the in-app chat (Claude API)
 * and the MCP endpoint (Claude Code / Remote Control).
 */
import { z } from "zod";
import {
  type AssetItem, type ChangeEntry, type ChatImage, type CheckpointInfo, type Command, type MapSession, type ProjectInfo, type RefInfo,
  MI_PER_KM, type ClimateRegion, type Derived, type Features, type LineKind, type MapFurniture, type MapGrid, type MapLabel, type MapLine, type Place, type Rect, type RGBAImage, type RiverPath, DEFAULT_CLIMATE, climateOf, cropScale,
  clampGridSize, describeFurniture, describeGrid, drawGrid, drawLabel, drawMarker, gridCellPx, drawRivers, drawText, labelText, lineLengthKm, mapStats, newFeatureId, niceGridSize, pathMidpoint, polygonCentroid, renderFull,
  isBattle, isCity, routeWaypoints, sketchToHeights, textWidth,
  WIND_NAMES, type WindName, findStraits, findOuterCoasts, type StraitsResult,
  RIVER_SIZE_SHARE, type HydroSummary, type RiverSize, type RiverSource, landCellNear, resolveRiverSources,
  type RoofPools, type BattleExportFormat, GROUND_INFO, PLACE_KINDS, PLACE_TYPE_IDS, type Selection, type ViewInfo, cleanSelection, describeSelection, selectionFocusRect, selectionReport, selectionShape,
} from "@mapmaker/core";
import { ASSET_TOOLS, ASSET_BATTLE_TOOL_NAMES } from "./assetTools.ts";
import { BATTLE_TOOLS, battleSummary } from "./battleTools.ts";
import { CITY_TOOLS, CITY_TOOL_NAMES, citySummary } from "./cityTools.ts";
import { CITY_LAND_TOOLS, CITY_LAND_TOOL_NAMES } from "./cityLandTools.ts";
import { TRACE_TOOLS, traceOverlay } from "./traceTools.ts";
import { decodeImage, encodeJpeg, prepareReference, toBase64 } from "./images.ts";

export interface ToolContext {
  /** The open project's session (throws if no project is open). */
  session(): MapSession;
  projectId(): string | null;
  execute(cmd: Command, label?: string): { seq: number; label: string };
  undo(): ChangeEntry | null;
  redo(): ChangeEntry | null;
  listProjects(): ProjectInfo[];
  openProject(id: string): Promise<void>;
  createProject(o: { name: string; width: number; height: number; kmPerPx: number }): Promise<ProjectInfo>;
  /** Optional: the user's asset library (present when a folder is set). */
  assets?: {
    status(): { scanning: boolean; scanned: number; total: number; usablePacks: number; files: number };
    search(o: { q?: string; cat?: string; pack?: string; offset?: number; limit?: number }): Promise<{ total: number; items: AssetItem[] }>;
    thumbnail(id: string, size: number): Promise<Uint8Array | null>;
    info(id: string): Promise<AssetItem | null>;
  };
  /** Optional: the roof textures of the asset packs by roof look (null without an asset library): city buildings are drawn from these in preference to drawing a roof. */
  roofPools?(): RoofPools | null;
  /** Optional: the roof pictures the open city's buildings use, decoded by asset id, for drawing it. */
  cityTiles?(): Promise<Record<string, { data: Uint8ClampedArray; size: number }>>;
  /** Optional: make a city map (sized in metres) and open it. */
  createCity?(o: { name: string; widthM: number; heightM: number; cellM?: number }): Promise<ProjectInfo>;
  /** Optional: make a battlemap and open it. */
  createBattle?(o: { name: string; squaresX: number; squaresY: number; feetPerSquare?: number; pxPerSquare?: number; gridType?: "square" | "hex" | "none"; roomMargin?: number }): Promise<ProjectInfo>;
  /** Optional: make a battlemap of the ground at a point of the open world map, and open it. */
  createBattleHere?(o: { name: string; x: number; y: number; squaresX?: number; squaresY?: number; feetPerSquare?: number }): Promise<ProjectInfo & { description: string }>;
  /**
   * Optional: write the open battlemap as a tabletop file (Universal VTT, Foundry scene zip, or PNG) into the project's exports folder. For a battlemap with several levels the
   * picture and the Universal VTT file are of one level (`level`: its id or name; default the level being worked on); the Foundry scene holds every level.
   */
  exportBattle?(format: BattleExportFormat, level?: string): Promise<{ name: string; bytes: number; path: string }>;
  /** Optional: the levels of the open battlemap (a cellar under a ground floor under an attic), and the one being worked on. Every other tool works on that level. */
  levels?: {
    /** The levels from the lowest to the highest, each with what is on it. Throws on a world map. */
    list(): { active: string; levels: { id: string; name: string; bottom: number; top: number; counts: Record<string, number> }[] };
    /** Add an empty level (same size, grid, light level and floor textures as the one being worked on) and switch to it. */
    add(where: "above" | "below", name?: string): Promise<{ id: string; name: string; bottom: number; top: number }>;
    /** Switch to a level by id or name: the DM's editor moves to it too. */
    select(level: string): Promise<{ id: string; name: string; bottom: number; top: number }>;
    /** Rename a level or change its elevations (feet). */
    update(level: string, patch: { name?: string; bottom?: number; top?: number }): Promise<{ id: string; name: string; bottom: number; top: number }>;
  };
  /** Optional: make a more detailed map of an area of the open map, and open it. */
  createRegional?(o: { name: string; rect: Rect }): Promise<ProjectInfo>;
  /** Optional: the open map's climate, lakes and rivers (route finding avoids lakes and river crossings). */
  derived?(): Promise<Derived | null>;
  readBrief(): Promise<string>;
  writeBrief(text: string): Promise<void>;
  listRefs(): Promise<RefInfo[]>;
  readRef(name: string): Promise<Uint8Array | null>;
  /** Optional: store a preview so the editor's chat can show it. */
  savePreview?(jpeg: Uint8Array): Promise<ChatImage>;
  /** Optional: render the whole map in the project's style (default: plain relief, no rivers). */
  render?(o?: { roofs?: boolean }): Promise<{ img: RGBAImage; rivers: RiverPath[] }>;
  listCheckpoints?(): Promise<CheckpointInfo[]>;
  saveCheckpoint?(name: string, note?: string): Promise<CheckpointInfo>;
  restoreCheckpoint?(name: string): Promise<{ seq: number; label: string }>;
  /** Optional: what the DM has selected in the editor (and whether Claude's edits are locked to it), and what part of the map they are looking at. */
  selection?(): { selection: Selection | null; lock: boolean; view: ViewInfo | null };
  /** Optional: highlight an area (or clear the selection) in the editor. Refused while the DM's lock is on. */
  setSelection?(sel: Selection | null): void;
}

/** Places and labels on a preview (bitmap font: placement check, not the final lettering). */
function drawFeatures(img: RGBAImage, region: Rect, scale: number, f: Features | undefined) {
  if (!f) return;
  for (const l of f.labels) {
    const t = labelText(l);
    const sc = l.kind === "sea" || l.kind === "region" ? 2 : 1;
    if (l.path && l.path.length > 1) dotPath(img, region, scale, l.path);
    const x = (l.x - region.x) * scale - textWidth(t, sc) / 2, y = (l.y - region.y) * scale - 3.5 * sc;
    drawLabel(img, t, x, y, sc, true);
  }
  for (const p of f.places) {
    if (!p.hideMarker) drawMarker(img, region, scale, p.x, p.y, p.hideName ? undefined : p.name);
    else if (!p.hideName) drawLabel(img, p.name, Math.round((p.x - region.x) * scale) + 5, Math.round((p.y - region.y) * scale) - 3);
  }
}

/** The outline of the DM's selected area, dotted in gold with a darker edge (previews only). */
function drawSelectionOutline(img: RGBAImage, region: Rect, scale: number, shape: NonNullable<ReturnType<typeof selectionShape>>) {
  const ring: [number, number][] = shape.type === "polygon" ? shape.points
    : shape.type === "rect" ? [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]]
    : Array.from({ length: 64 }, (_, k) => [shape.x + shape.r * Math.cos((k / 64) * 2 * Math.PI), shape.y + shape.r * Math.sin((k / 64) * 2 * Math.PI)] as [number, number]);
  const closed = [...ring, ring[0]];
  for (let i = 1; i < closed.length; i++) {
    const [ax, ay] = closed[i - 1], [bx, by] = closed[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * scale));
    for (let k = 0; k <= n; k++) {
      const x = Math.round((ax + ((bx - ax) * k) / n - region.x) * scale), y = Math.round((ay + ((by - ay) * k) / n - region.y) * scale);
      const on = Math.floor(k / 5) % 2 === 0;
      for (const [dx, dy, dark] of [[0, 0, !on], [1, 0, true], [0, 1, true]] as [number, number, boolean][]) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
        const o = (py * img.w + px) * 4;
        if (dark) { if (dx || dy) { img.data[o] = 60; img.data[o + 1] = 40; img.data[o + 2] = 10; } } else { img.data[o] = 255; img.data[o + 1] = 215; img.data[o + 2] = 60; }
      }
    }
  }
}

/** A dotted line marking the path a label follows (previews only). */
function dotPath(img: RGBAImage, region: Rect, scale: number, path: [number, number][]) {
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.ceil((Math.hypot(bx - ax, by - ay) * scale) / 4);
    for (let k = 0; k <= n; k++) {
      const x = Math.round((ax + ((bx - ax) * k) / n - region.x) * scale), y = Math.round((ay + ((by - ay) * k) / n - region.y) * scale);
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const o = (y * img.w + x) * 4;
      img.data[o] = 250; img.data[o + 1] = 220; img.data[o + 2] = 90;
    }
  }
}

function findPlace(f: Features, key: string): Place | undefined {
  const k = key.trim().toLowerCase();
  return f.places.find((p) => p.id === key) ?? f.places.find((p) => p.name.toLowerCase() === k);
}

function findSource(f: Features, key: string): RiverSource | undefined {
  const k = key.trim().toLowerCase();
  const places = new Map(f.places.map((p) => [p.id, p]));
  const list = f.sources ?? [];
  return list.find((x) => x.id === key) ?? list.find((x) => (x.name ?? "").toLowerCase() === k)
    ?? list.find((x) => x.placeId && places.get(x.placeId)?.name.toLowerCase() === k);
}

const RIVER_SIZES = ["stream", "river", "major", "great"] as const;
const RIVER_SIZE_HELP = "stream (a small river), river, major (about the biggest an ordinary river gets), great (a mighty river from the first mile, e.g. below a huge waterfall)";

/** Plain-language findings from a map's water summary. */
function hydroNotes(h: HydroSummary): string[] {
  const notes: string[] = [];
  if (!h.riverCount) notes.push("No rivers: the land is dry, flat, or too small for any stretch of land to collect enough water.");
  if (h.ends.elsewhere) notes.push(`${h.ends.elsewhere} river(s) end on dry land. That shouldn't happen: report it.`);
  for (const l of h.lakes) {
    if (l.outflow === "none") notes.push(`The lake at (${l.x}, ${l.y}) (${l.areaKm2.toLocaleString()} km²) has no way out: nothing flows out of it.`);
    else if (l.outflow === "stream") notes.push(`The lake at (${l.x}, ${l.y}) is drained only by a small stream (less than a river).`);
  }
  if (h.bowlShare > 0.1) notes.push(`${Math.round(h.bowlShare * 100)}% of the river length crosses hollows the land doesn't drain: those stretches are really marsh or unmapped lakes.`);
  if (h.dryShare > 0.15) notes.push(`${Math.round(h.dryShare * 100)}% of the river length is in very dry land: expected for a river that crosses a desert from wetter country, otherwise check the climate.`);
  for (const s of h.sources) {
    if (!s.drawn) notes.push(`The river source at (${s.x}, ${s.y}) produced no river: is the point on land?`);
    else notes.push(`The river source at (${s.x}, ${s.y}) feeds a river of ${s.lengthKm.toLocaleString()} km that ${s.reaches === "sea" ? "reaches the sea" : s.reaches === "lake" ? "ends in a lake" : s.reaches === "river" ? "joins another river" : "ends on land"}${s.mouth ? ` at about (${s.mouth[0]}, ${s.mouth[1]})` : ""}.`);
  }
  return notes;
}

function findLine(f: Features, key: string): MapLine | undefined {
  const k = key.trim().toLowerCase();
  return (f.lines ?? []).find((l) => l.id === key) ?? (f.lines ?? []).find((l) => (l.name ?? "").toLowerCase() === k);
}

const LINE_COLOURS: Record<LineKind, [number, number, number]> = { road: [120, 70, 30], trail: [150, 100, 50], border: [170, 40, 90], reef: [38, 58, 68] };

/** Roads, trails, borders and reefs on a preview: solid roads, dotted trails, dashed borders, jagged dark reefs with foam. */
function drawLines(img: RGBAImage, region: Rect, scale: number, f: Features | undefined) {
  for (const l of f?.lines ?? []) {
    const pts = l.closed && l.points.length > 2 ? [...l.points, l.points[0]] : l.points;
    const [r, g, b] = LINE_COLOURS[l.kind];
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * scale));
      for (let k = 0; k <= n; k++, run++) {
        const reef = l.kind === "reef";
        const on = reef ? run % 5 < 3 : l.kind === "road" || (l.kind === "trail" ? run % 6 < 3 : run % 12 < 8);
        if (!on) continue;
        // reefs are ragged: each dot sits a little to one side of the line
        const jit = reef ? ((((run * 2654435761) >>> 0) % 5) - 2) * 0.9 : 0;
        const x = Math.round((ax + ((bx - ax) * k) / n - region.x) * scale + jit), y = Math.round((ay + ((by - ay) * k) / n - region.y) * scale - jit);
        for (let dy = 0; dy <= (l.kind === "road" ? 1 : 0); dy++) {
          for (let dx = 0; dx <= (l.kind === "road" ? 1 : 0); dx++) {
            const px = x + dx, py = y + dy;
            if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
            const o = (py * img.w + px) * 4;
            img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
          }
        }
      }
    }
  }
}

/** The straits of the open world map, around `centre` (default: the middle of the land). */
function straitsOf(ctx: ToolContext, centre?: number[], ringFraction?: number): StraitsResult {
  const doc = ctx.session().doc;
  const c = centre ? ([centre[0], centre[1]] as [number, number]) : undefined;
  return findStraits(doc.height, doc.meta.seaLevel, doc.meta.kmPerPx, { ...(c && { centre: c }), ...(ringFraction !== undefined && { ringFraction }) });
}

const LineKindSchema = z.enum(["road", "trail", "border", "reef"]);
const lineSummary = (l: MapLine, kmPerPx: number) => ({
  id: l.id, kind: l.kind, name: l.name, points: l.points.length, ...(l.closed && { closed: true }),
  length_km: Math.round(lineLengthKm(l.points, kmPerPx, l.closed)), length_miles: Math.round(lineLengthKm(l.points, kmPerPx, l.closed) * 0.621371),
  from: l.points[0].map(Math.round), to: l.points[l.points.length - 1].map(Math.round),
});

function findRegion(f: Features, key: string): ClimateRegion | undefined {
  const k = key.trim().toLowerCase();
  return (f.regions ?? []).find((r) => r.id === key) ?? (f.regions ?? []).find((r) => r.name.toLowerCase() === k);
}

/** Region outlines (dotted, violet) with names, for previews. */
function drawRegions(img: RGBAImage, region: Rect, scale: number, f: Features | undefined) {
  for (const r of f?.regions ?? []) {
    const poly = [...r.polygon, r.polygon[0]];
    for (let i = 1; i < poly.length; i++) {
      const [ax, ay] = poly[i - 1], [bx, by] = poly[i];
      const n = Math.ceil((Math.hypot(bx - ax, by - ay) * scale) / 3);
      for (let k = 0; k <= n; k += 2) {
        const x = Math.round((ax + ((bx - ax) * k) / n - region.x) * scale), y = Math.round((ay + ((by - ay) * k) / n - region.y) * scale);
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
        const o = (y * img.w + x) * 4;
        img.data[o] = 200; img.data[o + 1] = 120; img.data[o + 2] = 255;
      }
    }
    const [cx, cy] = polygonCentroid(r.polygon);
    drawLabel(img, r.name, (cx - region.x) * scale - textWidth(r.name) / 2, (cy - region.y) * scale - 3, 1, true);
  }
}

function findLabel(f: Features, key: string): MapLabel | undefined {
  const k = key.trim().toLowerCase();
  return f.labels.find((l) => l.id === key) ?? f.labels.find((l) => l.text.toLowerCase() === k);
}

const featuresOf = (ctx: ToolContext): Features => ctx.session().doc.features ?? { places: [], labels: [] };

const PlaceTypeSchema = z.enum(PLACE_TYPE_IDS).describe("What the place is (it chooses the marker): " + PLACE_KINDS.map((k) => `${k.id} (${k.hint.toLowerCase()})`).join("; "));
const LabelKindSchema = z.enum(["sea", "region", "range", "island", "feature"]);

async function renderMap(ctx: ToolContext): Promise<{ img: RGBAImage; rivers: RiverPath[] }> {
  return ctx.render ? ctx.render() : { img: renderFull(ctx.session().doc), rivers: [] };
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg"; data: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** Images saved for display in the editor (not sent to the model separately). */
  display?: ChatImage[];
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(ctx: ToolContext, input: z.infer<S>): Promise<ToolResult>;
}

function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
const fail = (t: string): ToolResult => ({ ...text(t), isError: true });

// ---------- shared schemas ----------
const XY = z.array(z.number()).length(2).describe("[x, y] in map pixels");

const RegionShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("polygon"), points: z.array(XY).min(3).max(400) }),
  z.object({ type: z.literal("circle"), x: z.number(), y: z.number(), r: z.number().positive() }),
  z.object({ type: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
]).describe("Outline in map pixels");

function regionPolygon(s: z.infer<typeof RegionShape>): [number, number][] {
  if (s.type === "polygon") return s.points.map((p) => [p[0], p[1]] as [number, number]);
  if (s.type === "rect") return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
  return Array.from({ length: 48 }, (_, i) => [s.x + s.r * Math.cos((i / 48) * 2 * Math.PI), s.y + s.r * Math.sin((i / 48) * 2 * Math.PI)] as [number, number]);
}

const regionClimate = {
  temperature: z.number().min(0).max(1).optional().describe("0 frozen, 0.25 cold, 0.5 temperate, 0.75 warm, 1 hot. Omit to keep the natural temperature"),
  moisture: z.number().min(0).max(1).optional().describe("0 arid, 0.25 dry, 0.5 normal, 0.75 wet, 1 lush. Omit to keep the natural moisture"),
  snow: z.number().min(0).max(1).optional().describe("Ground snow cover 0..1, even on low ground"),
  rock: z.number().min(0).max(1).optional().describe("Bare dark stone cover 0..1: the land inside shows dark rock instead of grass and forest (rocky outcroppings, barren or scorched ground). No temperature or moisture needed"),
  volcanic: z.number().min(0).max(1).optional().describe("Volcanic ground cover 0..1: black ash plains, dark lava fields with glowing cracks, cinder, black-sand shores (volcanic country, scorched land). No temperature or moisture needed. Only where the user said the land is volcanic"),
  strength: z.number().min(0).max(1).optional().describe("How completely it overrides the natural climate (default 1)"),
  border: z.enum(["hard", "soft"]).optional().describe("hard: a sharp edge; soft (default): blends across blend_km"),
  blend_km: z.number().min(1).max(2000).optional().describe("Width of a soft border in km (default 80)"),
  owner: z.string().max(120).optional().describe("Who or what holds it (the user's lore)"),
  notes: z.string().max(1000).optional(),
};

const Shape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("circle"), x: z.number(), y: z.number(), r: z.number().positive() }),
  z.object({ type: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ type: z.literal("polygon"), points: z.array(XY).min(3) }),
  z.object({ type: z.literal("stroke"), points: z.array(XY).min(1), r: z.number().positive().describe("half-width, px") }),
  z.object({ type: z.literal("all") }),
]).describe("Area to affect, in map pixels. 'stroke' is a polyline with a radius; 'all' is the whole map.");
const Region = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const seedSchema = z.number().int().optional().describe("Random seed; omit for a fresh one");

const randSeed = () => Math.floor(Math.random() * 2 ** 31);
const pts = (p: number[][]) => p.map((q) => [q[0], q[1]] as [number, number]);

function summary(ctx: ToolContext) {
  const s = ctx.session();
  if (isBattle(s.doc)) return battleSummary(ctx);
  if (isCity(s.doc)) return citySummary(ctx);
  const m = s.doc.meta;
  const st = mapStats(s.doc);
  return {
    project: m.id,
    name: m.name,
    size_px: [m.width, m.height],
    km_per_px: m.kmPerPx,
    map_size_km: [Math.round(m.width * m.kmPerPx), Math.round(m.height * m.kmPerPx)],
    map_size_miles: [Math.round((m.width * m.kmPerPx) / 1.609), Math.round((m.height * m.kmPerPx) / 1.609)],
    sea_level_m: m.seaLevel,
    elevation_range_m: [st.minM, st.maxM],
    land_fraction: Number(st.landFraction.toFixed(3)),
    latest_change: s.seq,
    can_undo: s.canUndo,
    can_redo: s.canRedo,
  };
}

function changeLine(c: ChangeEntry) {
  const r = c.rect ? ` [area x${c.rect.x} y${c.rect.y} ${c.rect.w}x${c.rect.h}]` : "";
  return `#${c.seq} ${c.kind} by ${c.author}: ${c.label}${r}`;
}

export const TOOLS = [
  define({
    name: "get_map_summary",
    description: "Size, real-world scale, sea level, elevation range, land fraction and latest change number of the open map.",
    schema: z.object({}),
    async run(ctx) {
      return json(summary(ctx));
    },
  }),

  define({
    name: "render_preview",
    description:
      "Render the map (or a region of it) to an image so you can see it. Draws a labelled grid in map-pixel coordinates. " +
      "Use after edits to check results; use a region with a larger max_size to inspect detail.",
    schema: z.object({
      region: Region.optional().describe("Crop in map pixels; omit for the whole map"),
      max_size: z.number().int().min(256).max(1568).optional().describe("Longest side of the image in px (default 1024)"),
      grid: z.boolean().optional().describe("Draw the coordinate grid (default true)"),
      grid_step: z.number().positive().optional().describe("Grid spacing in map px (default: automatic)"),
      labels: z.boolean().optional().describe("Draw places, labels and climate-region outlines (default true)"),
      markers: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().optional() })).optional()
        .describe("Temporary labelled points drawn on this preview only"),
      selection: z.boolean().optional().describe("Crop to what the DM has selected (the area with a margin, or a window round a point or feature). The selected area's outline is drawn in gold on every preview."),
      trace: z.boolean().optional().describe("Draw the trace picture (get_trace_picture) half see-through over the map, to compare with it or redraw from it (default false)"),
    }),
    async run(ctx, i) {
      const s = ctx.session();
      const sel = ctx.selection?.().selection ?? null;
      let focus: Rect | null = null;
      if (i.selection) {
        focus = selectionFocusRect(s.doc, sel);
        if (!focus) return fail(sel ? "The selection isn't on the map any more." : "Nothing is selected. Ask the DM to select a place or area (Select tool), or give a region.");
      }
      const { img: full, rivers } = await renderMap(ctx);
      const region = focus ?? i.region ?? { x: 0, y: 0, w: full.w, h: full.h };
      const { img, scale } = cropScale(full, region, i.max_size ?? 1024);
      drawRivers(img, region, scale, rivers);
      const traced = i.trace ? await traceOverlay(ctx, img, region, scale, 1) : "";
      const step = i.grid === false ? null : drawGrid(img, region, scale, i.grid_step);
      if (i.labels !== false) {
        drawRegions(img, region, scale, s.doc.features);
        drawLines(img, region, scale, s.doc.features);
        drawFeatures(img, region, scale, s.doc.features);
      }
      for (const m of i.markers ?? []) drawMarker(img, region, scale, m.x, m.y, m.label);
      const outline = selectionShape(sel, s.doc.features);
      if (outline) drawSelectionOutline(img, region, scale, outline);
      const jpg = encodeJpeg(img);
      const display = ctx.savePreview ? [await ctx.savePreview(jpg)] : undefined;
      const note = `Preview of ${focus ? `the DM's selection (region x${region.x} y${region.y} ${region.w}x${region.h})` : i.region ? `region x${region.x} y${region.y} ${region.w}x${region.h}` : "the whole map"}` +
        ` (${s.doc.meta.width}x${s.doc.meta.height} px, ${s.doc.meta.kmPerPx} km/px, ${s.doc.meta.style ?? "painted"} style); image ${img.w}x${img.h}` +
        (step ? `, grid every ${step} map px` : "") + (outline ? ", the DM's selected area outlined in gold" : "") + traced + `. Change #${s.seq}.`;
      return { content: [{ type: "text", text: note }, { type: "image", mediaType: "image/jpeg", data: toBase64(jpg) }], display };
    },
  }),

  define({
    name: "query_points",
    description: "Elevation (m) and land/sea at specific map-pixel points.",
    schema: z.object({ points: z.array(XY).min(1).max(64) }),
    async run(ctx, i) {
      const s = ctx.session();
      return json(i.points.map(([x, y]) => {
        const e = Math.round(s.doc.height.sample(x, y));
        return { x, y, elevation_m: e, is_land: e > s.doc.meta.seaLevel };
      }));
    },
  }),

  define({
    name: "list_projects",
    description: "List map projects. The open project is the one the editor shows.",
    schema: z.object({}),
    async run(ctx) {
      return json({ open: ctx.projectId(), projects: ctx.listProjects() });
    },
  }),

  define({
    name: "open_project",
    description: "Open a different map project (switches the editor too).",
    schema: z.object({ id: z.string() }),
    async run(ctx, i) {
      await ctx.openProject(i.id);
      return json(summary(ctx));
    },
  }),

  define({
    name: "create_map",
    description:
      "Create a new map project and open it. Starts as open ocean unless a template is given. " +
      "Choose km_per_px from the real size you want (map width km / width px).",
    schema: z.object({
      name: z.string().min(1),
      width: z.number().int().min(128).max(2048).optional().describe("px, default 1024"),
      height: z.number().int().min(128).max(2048).optional().describe("px, default 1024"),
      km_per_px: z.number().positive().optional().describe("Real-world km per pixel, default 2"),
      template: z.enum(["ocean", "island", "archipelago", "continent", "noise"]).optional(),
      land_fraction: z.number().min(0.02).max(0.95).optional(),
      seed: seedSchema,
    }),
    async run(ctx, i) {
      const info = await ctx.createProject({ name: i.name, width: i.width ?? 1024, height: i.height ?? 1024, kmPerPx: i.km_per_px ?? 2 });
      const template = i.template ?? "ocean";
      ctx.execute({ op: "generate_terrain", params: { template, seed: i.seed ?? randSeed(), landFraction: i.land_fraction } });
      return json({ created: info, template, summary: summary(ctx) });
    },
  }),

  define({
    name: "create_regional_map",
    description:
      "Make a separate, more detailed map of one area of the open map (2x to 16x finer, up to 2048 px) and open it. The terrain is the " +
      "same land with new detail; the climate carries over; places and labels inside the area are copied. Use it when the user wants " +
      "to zoom into a region for closer work. The two maps are separate afterwards: edits to one don't change the other. " +
      "open_project returns to the parent.",
    schema: z.object({
      name: z.string().min(1).max(80),
      region: Region.describe("The area, in the open map's pixels (at most 1024 px on a side)"),
    }),
    async run(ctx, i) {
      if (!ctx.createRegional) return { ...text("Regional maps aren't available here."), isError: true };
      const parent = ctx.projectId();
      const info = await ctx.createRegional({ name: i.name, rect: i.region });
      return json({ created: info, parent, summary: summary(ctx), note: "Now working in the regional map; coordinates are its own pixels." });
    },
  }),

  define({
    name: "generate_terrain",
    description:
      "Replace the WHOLE map with generated terrain. Destroys existing land, so only use on an empty map or when the user asked to start over " +
      "(set replace_existing=true if the map already has land).",
    schema: z.object({
      template: z.enum(["ocean", "island", "archipelago", "continent", "noise"]),
      land_fraction: z.number().min(0.02).max(0.95).optional().describe("Share of the map above sea level (default 0.35)"),
      mountains: z.number().min(0).max(1).optional().describe("How mountainous (default 0.5)"),
      max_elevation_m: z.number().positive().optional(),
      replace_existing: z.boolean().optional(),
      seed: seedSchema,
    }),
    async run(ctx, i) {
      const st = mapStats(ctx.session().doc);
      if (st.landFraction > 0.001 && !i.replace_existing) {
        return { ...text(`The map already has land (${(st.landFraction * 100).toFixed(1)}%). generate_terrain would erase it. ` +
          "Ask the user, then call again with replace_existing=true if they agree."), isError: true };
      }
      const seed = i.seed ?? randSeed();
      const r = ctx.execute({ op: "generate_terrain", params: {
        template: i.template, seed, landFraction: i.land_fraction, mountains: i.mountains, maxElevationM: i.max_elevation_m,
      } });
      return json({ change: r.seq, seed, summary: summary(ctx) });
    },
  }),

  define({
    name: "import_sketch",
    description:
      "Turn a reference image (a drawing of land and sea) into terrain, REPLACING the whole map. The sea is the background colour (found from the " +
      "image's edge), everything else is land, and strokes in a marker colour (red by default) are mountain ranges. Set enclosed='land' for drawings " +
      "that only outline their islands (same colour inside and out). Look at the image with view_reference first to choose the settings. " +
      "A checkpoint is saved first. Places, labels, regions and roads are NOT moved, so check them afterwards. The result is a starting point to refine with the other tools.",
    schema: z.object({
      name: z.string().describe("Reference image name (see list_references)"),
      replace_existing: z.boolean().optional().describe("Required when the map already has land"),
      enclosed: z.enum(["sea", "land"]).optional().describe("Background-coloured areas the sea can't reach: sea (lakes, inner seas; default) or land (outlined islands)"),
      mountain_colour: z.array(z.number().min(0).max(255)).length(3).nullable().optional().describe("[r, g, b] of mountain strokes (default red); null for none"),
      sea_colour: z.array(z.number().min(0).max(255)).length(3).optional().describe("[r, g, b] of the sea if auto-detection is wrong"),
      tolerance: z.number().min(5).max(150).optional().describe("How different from the sea colour still counts as sea (default 48)"),
      fit: z.enum(["contain", "whole"]).optional().describe("contain keeps the drawing's proportions (default); whole stretches it over the map"),
      land_height_m: z.number().min(50).max(3000).optional().describe("Typical inland height (default 500)"),
      mountain_height_m: z.number().min(300).max(9000).optional().describe("Height of mountain ranges (default 2600)"),
      coast_roughness: z.number().min(0).max(1).optional(),
      erosion_passes: z.number().int().min(0).max(6).optional(),
      seed: seedSchema,
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc;
      const st = mapStats(doc);
      if (st.landFraction > 0.001 && !i.replace_existing) {
        return { ...text(`The map already has land (${(st.landFraction * 100).toFixed(1)}%). import_sketch would replace all of it. ` +
          "Ask the user, then call again with replace_existing=true if they agree."), isError: true };
      }
      const bytes = await ctx.readRef(i.name);
      if (!bytes) return { ...text(`No reference named ${i.name}. Use list_references.`), isError: true };
      const img = decodeImage(bytes);
      if (!img) return { ...text("This image format can't be decoded here (use PNG, JPEG or a still WebP)."), isError: true };
      if (ctx.saveCheckpoint) await ctx.saveCheckpoint("Before sketch import", `Before turning ${i.name} into terrain`).catch(() => {});
      const r = sketchToHeights(img, { W: doc.height.w, H: doc.height.h, seaLevel: doc.meta.seaLevel }, {
        enclosed: i.enclosed, mountainColour: i.mountain_colour === null ? null : i.mountain_colour as [number, number, number] | undefined,
        seaColour: i.sea_colour as [number, number, number] | undefined, tolerance: i.tolerance, fit: i.fit, landHeightM: i.land_height_m,
        mountainHeightM: i.mountain_height_m, coastRoughness: i.coast_roughness, erosionPasses: i.erosion_passes, seed: i.seed ?? randSeed(),
      });
      const res = ctx.execute({ op: "replace_heights", data: r.data, label: `Terrain from sketch ${i.name}` });
      return json({
        change: res.seq, land_percent: +(r.landFraction * 100).toFixed(1), mountain_stroke_cells: r.mountainCells, sea_colour_used: r.seaColour,
        placed_in_map_px: r.region, note: "Check places, labels, regions and roads: they stayed where they were. render_preview to see the result.",
        summary: summary(ctx),
      });
    },
  }),

  define({
    name: "add_landmass",
    description: "Raise new land (island, peninsula, land bridge) inside a shape, with a natural ragged coast and a shallow shelf around it.",
    schema: z.object({
      shape: Shape,
      height_m: z.number().min(5).max(3000).optional().describe("Typical inland elevation above sea level (default 250)"),
      coast_roughness: z.number().min(0).max(1).optional().describe("0 smooth .. 1 very ragged (default 0.5)"),
      seed: seedSchema,
    }),
    async run(ctx, i) {
      const r = ctx.execute({ op: "add_landmass", params: {
        shape: normShape(i.shape), heightM: i.height_m, coastRoughness: i.coast_roughness, seed: i.seed ?? randSeed(),
      } });
      return json({ change: r.seq, done: r.label });
    },
  }),

  define({
    name: "add_mountain_range",
    description:
      "Add a mountain range along a path (polyline of map-pixel points): ridged crest with peaks and passes, plus foothills. " +
      "width_px is the half-width of the high core; foothills extend about twice as far.",
    schema: z.object({
      path: z.array(XY).min(1),
      width_px: z.number().positive().max(200),
      peak_m: z.number().min(100).max(8000).optional().describe("Highest crest elevation added, metres (default 2800)"),
      roughness: z.number().min(0).max(1).optional().describe("0 smooth crest .. 1 jagged (default 0.6)"),
      seed: seedSchema,
    }),
    async run(ctx, i) {
      const r = ctx.execute({ op: "add_mountain_range", params: {
        path: pts(i.path), widthPx: i.width_px, peakM: i.peak_m, roughness: i.roughness, seed: i.seed ?? randSeed(),
      } });
      return json({ change: r.seq, done: r.label });
    },
  }),

  define({
    name: "sculpt",
    description:
      "Brush-style edit inside a shape with a soft edge. raise/lower by amount_m; smooth by strength; flatten toward target_m " +
      "(default: elevation at the shape centre); set to target_m; roughen adds noise of amount_m; land pushes the coast out " +
      "(sea becomes low land); water pulls it in (land becomes shallow sea).",
    schema: z.object({
      mode: z.enum(["raise", "lower", "smooth", "flatten", "set", "roughen", "land", "water"]),
      shape: Shape,
      amount_m: z.number().optional(),
      target_m: z.number().optional(),
      strength: z.number().min(0).max(1).optional(),
      falloff: z.number().min(0).max(1).optional().describe("Soft edge as a fraction of the shape size (default 0.5)"),
      seed: seedSchema,
    }),
    async run(ctx, i) {
      const r = ctx.execute({ op: "sculpt", params: {
        mode: i.mode, shape: normShape(i.shape), amountM: i.amount_m, targetM: i.target_m,
        strength: i.strength, falloff: i.falloff, seed: i.seed ?? randSeed(),
      } });
      return json({ change: r.seq, done: r.label });
    },
  }),

  define({
    name: "set_sea_level",
    description: "Move the sea level (metres). Raising it floods lowlands; lowering it exposes shelves.",
    schema: z.object({ level_m: z.number() }),
    async run(ctx, i) {
      const r = ctx.execute({ op: "set_sea_level", levelM: i.level_m });
      return json({ change: r.seq, summary: summary(ctx) });
    },
  }),

  define({
    name: "undo",
    description: "Undo the most recent change(s), whoever made them (the user's own edits included, so check get_changes_since first).",
    schema: z.object({ steps: z.number().int().min(1).max(20).optional() }),
    async run(ctx, i) {
      const done: string[] = [];
      for (let k = 0; k < (i.steps ?? 1); k++) {
        const c = ctx.undo();
        if (!c) break;
        done.push(c.label);
      }
      return text(done.length ? done.join("\n") : "Nothing to undo.");
    },
  }),

  define({
    name: "redo",
    description: "Redo change(s) that were undone.",
    schema: z.object({ steps: z.number().int().min(1).max(20).optional() }),
    async run(ctx, i) {
      const done: string[] = [];
      for (let k = 0; k < (i.steps ?? 1); k++) {
        const c = ctx.redo();
        if (!c) break;
        done.push(c.label);
      }
      return text(done.length ? done.join("\n") : "Nothing to redo.");
    },
  }),

  define({
    name: "get_changes_since",
    description: "Changes after a given change number, with who made each (user or claude). Use at the start of each turn to see hand edits.",
    schema: z.object({ since: z.number().int().min(0) }),
    async run(ctx, i) {
      const s = ctx.session();
      const list = s.changesSince(i.since);
      return text(list.length
        ? `${list.length} change(s) since #${i.since} (latest #${s.seq}):\n${list.map(changeLine).join("\n")}`
        : `No changes since #${i.since} (latest #${s.seq}).`);
    },
  }),

  define({
    name: "get_brief",
    description: "Read the project's design brief: decisions, scale, names, open questions.",
    schema: z.object({}),
    async run(ctx) {
      const b = await ctx.readBrief();
      return text(b.trim() ? b : "(The brief is empty.)");
    },
  }),

  define({
    name: "update_brief",
    description:
      "Edit the design brief. mode=append adds a section at the end (use for decisions the user just made); mode=replace rewrites it entirely " +
      "(only when restructuring; keep everything still valid). Never record invented lore as fact; mark proposals as proposals.",
    schema: z.object({ mode: z.enum(["append", "replace"]), text: z.string().min(1) }),
    async run(ctx, i) {
      const cur = await ctx.readBrief();
      const next = i.mode === "replace" ? i.text : `${cur.replace(/\s*$/, "")}\n\n${i.text.trim()}\n`;
      await ctx.writeBrief(next);
      return text(`Brief updated (${next.length} chars).`);
    },
  }),

  define({
    name: "erode",
    description:
      "Weather the terrain with river erosion: carves valleys, sharpens ridges and makes new mountains look natural. " +
      "Affects the whole map (undoable). Good after adding ranges by hand or with add_mountain_range.",
    schema: z.object({
      strength: z.number().min(0.05).max(1).optional().describe("Per-pass strength (default 0.5)"),
      passes: z.number().int().min(1).max(12).optional().describe("More passes = deeper valleys (default 4)"),
    }),
    async run(ctx, i) {
      const r = ctx.execute({ op: "erode", params: { strength: i.strength, passes: i.passes } });
      return json({ change: r.seq, done: r.label });
    },
  }),

  define({
    name: "set_style",
    description: "Switch how the map is drawn: 'painted' (Painted Relief: textured biomes, rock, snow, coastal glow) or 'relief' (plain elevation colours, handy while sculpting).",
    schema: z.object({ style: z.enum(["painted", "relief"]) }),
    async run(ctx, i) {
      const r = ctx.execute({ op: "set_meta", patch: { style: i.style }, label: `Style: ${i.style}` });
      return json({ change: r.seq, style: i.style });
    },
  }),

  define({
    name: "set_climate",
    description:
      "Change the climate model that colours the painted map (temperature from latitude and altitude; moisture from coasts, " +
      "prevailing wind and rain shadows). Latitudes: 0 = equator, 1 = pole, for the top and bottom map edges. Only the fields " +
      "you pass change. Record climate decisions in the brief.",
    schema: z.object({
      lat_top: z.number().min(-1).max(1).optional(),
      lat_bot: z.number().min(-1).max(1).optional(),
      moisture_bias: z.number().min(0).max(1.2).optional().describe("Overall wetness (default 0.55)"),
      moisture_noise: z.number().min(0).max(1.2).optional().describe("Patchiness of wet/dry areas (default 0.45)"),
      coast_moisture: z.number().min(0).max(1).optional().describe("Extra wetness near coasts (default 0.3)"),
      moisture_lat: z.number().min(-1.5).max(1.5).optional().describe("+ wetter toward the cold edge, - wetter toward the warm edge"),
      snowline_m: z.number().min(200).max(8000).optional().describe("Snowline at the warm edge, metres"),
      snow_lat: z.number().min(0).max(1.5).optional().describe("How much the snowline drops toward the poles"),
      wind: z.enum(WIND_NAMES as [string, ...string[]]).optional().describe("Prevailing wind, named for where it blows FROM: west = westerlies, northwest = it blows toward the south-east (rain shadows fall downwind of ranges)"),
      river_density: z.number().min(0).max(1).optional().describe("More, smaller rivers (default 0.5)"),
    }),
    async run(ctx, i) {
      const cur = climateOf(ctx.session().doc);
      const next = {
        ...(ctx.session().doc.meta.climate ?? {}),
        ...(i.lat_top !== undefined && { latTop: i.lat_top }),
        ...(i.lat_bot !== undefined && { latBot: i.lat_bot }),
        ...(i.moisture_bias !== undefined && { moistureBias: i.moisture_bias }),
        ...(i.moisture_noise !== undefined && { moistureNoise: i.moisture_noise }),
        ...(i.coast_moisture !== undefined && { coastMoisture: i.coast_moisture }),
        ...(i.moisture_lat !== undefined && { moistureLat: i.moisture_lat }),
        ...(i.snowline_m !== undefined && { snowlineM: i.snowline_m }),
        ...(i.snow_lat !== undefined && { snowLat: i.snow_lat }),
        ...(i.wind !== undefined && { wind: i.wind as WindName }),
        ...(i.river_density !== undefined && { riverDensity: i.river_density }),
      };
      const r = ctx.execute({ op: "set_meta", patch: { climate: next }, label: "Change climate" });
      return json({ change: r.seq, before: cur, after: { ...DEFAULT_CLIMATE, ...next } });
    },
  }),

  define({
    name: "save_checkpoint",
    description: "Save a named copy of the map (terrain, sea level, style, climate) to come back to later, e.g. before a big experiment.",
    schema: z.object({ name: z.string().min(1).max(60), note: z.string().max(300).optional() }),
    async run(ctx, i) {
      if (!ctx.saveCheckpoint) return { ...text("Checkpoints aren't available here."), isError: true };
      const c = await ctx.saveCheckpoint(i.name, i.note);
      return json({ saved: c });
    },
  }),

  define({
    name: "list_checkpoints",
    description: "Named checkpoints saved for this map.",
    schema: z.object({}),
    async run(ctx) {
      const list = ctx.listCheckpoints ? await ctx.listCheckpoints() : [];
      return text(list.length ? list.map((c) => `${c.name} (change #${c.seq}, ${c.time})${c.note ? ` - ${c.note}` : ""}`).join("\n") : "No checkpoints yet.");
    },
  }),

  define({
    name: "restore_checkpoint",
    description: "Bring back a saved checkpoint. This is itself an undoable change, so nothing is lost.",
    schema: z.object({ name: z.string().min(1) }),
    async run(ctx, i) {
      if (!ctx.restoreCheckpoint) return { ...text("Checkpoints aren't available here."), isError: true };
      const r = await ctx.restoreCheckpoint(i.name);
      return json({ change: r.seq, done: r.label });
    },
  }),

  define({
    name: "compare_to_reference",
    description:
      "Side-by-side image: a reference image (left) next to the current map (right), optionally cropped on either side, " +
      "to check how closely the map follows a sketch or inspiration.",
    schema: z.object({
      name: z.string().describe("Reference image name (see list_references)"),
      ref_region: Region.optional().describe("Crop of the reference, in the reference image's pixels"),
      map_region: Region.optional().describe("Crop of the map, in map pixels"),
      max_size: z.number().int().min(512).max(1568).optional().describe("Total width of the comparison image (default 1400)"),
    }),
    async run(ctx, i) {
      const bytes = await ctx.readRef(i.name);
      if (!bytes) return { ...text(`No reference named ${i.name}. Use list_references.`), isError: true };
      const ref = decodeImage(bytes);
      if (!ref) return { ...text("This image format can't be decoded here (use PNG, JPEG or a still WebP)."), isError: true };
      const half = Math.floor((i.max_size ?? 1400) / 2) - 6;
      const rr = i.ref_region ?? { x: 0, y: 0, w: ref.w, h: ref.h };
      const a = cropScale(ref, rr, half).img;
      const { img: full, rivers } = await renderMap(ctx);
      const mr = i.map_region ?? { x: 0, y: 0, w: full.w, h: full.h };
      const mapped = cropScale(full, mr, half);
      drawRivers(mapped.img, mr, mapped.scale, rivers);
      drawGrid(mapped.img, mr, mapped.scale);
      const b = mapped.img;
      const W = a.w + 12 + b.w, H = Math.max(a.h, b.h) + 16;
      const out: RGBAImage = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
      for (let p = 0; p < out.data.length; p += 4) { out.data[p] = 24; out.data[p + 1] = 28; out.data[p + 2] = 38; out.data[p + 3] = 255; }
      const blit = (src: RGBAImage, ox: number, oy: number) => {
        for (let y = 0; y < src.h; y++) out.data.set(src.data.subarray(y * src.w * 4, (y + 1) * src.w * 4), ((oy + y) * W + ox) * 4);
      };
      blit(a, 0, 16);
      blit(b, a.w + 12, 16);
      drawText(out, "REFERENCE", 4, 4, [230, 230, 236]);
      drawText(out, "MAP", a.w + 16, 4, [230, 230, 236]);
      const jpg = encodeJpeg(out);
      const display = ctx.savePreview ? [await ctx.savePreview(jpg)] : undefined;
      return { content: [
        { type: "text", text: `Left: ${i.name} ${i.ref_region ? `crop x${rr.x} y${rr.y} ${rr.w}x${rr.h}` : `(${ref.w}x${ref.h})`}. Right: map ${i.map_region ? `region x${mr.x} y${mr.y} ${mr.w}x${mr.h}` : "(whole)"} with grid in map px.` },
        { type: "image", mediaType: "image/jpeg", data: toBase64(jpg) },
      ], display };
    },
  }),

  define({
    name: "add_place",
    description:
      "Add a named place to the map and the gazetteer (a city, a castle, a cave, a lighthouse...). It gets a marker that suits what it is, and its name. Pick the type that fits: there are small pictures for castles, towers, temples, caves, mines, lairs, camps, bridges, inns, peaks, volcanoes, waterfalls and more. " +
      "Set hide_marker for a landmark the terrain already shows (a peak, a crater) so the marker doesn't cover it. " +
      "Only add places the user named or confirmed; don't invent canon.",
    schema: z.object({
      name: z.string().min(1).max(80),
      type: PlaceTypeSchema,
      x: z.number(), y: z.number(),
      notes: z.string().max(1000).optional(),
      hide_marker: z.boolean().optional(),
    }),
    async run(ctx, i) {
      const place: Place = { id: newFeatureId("p"), name: i.name, type: i.type, x: i.x, y: i.y, notes: i.notes,
        ...(i.hide_marker && { hideMarker: true }) };
      const r = ctx.execute({ op: "features", patch: { upsertPlaces: [place] }, label: `Add place ${i.name}` });
      return json({ change: r.seq, place });
    },
  }),

  define({
    name: "update_place",
    description: "Move, rename, retype or annotate a place (find it by id or name).",
    schema: z.object({
      place: z.string().describe("Place id or current name"),
      name: z.string().min(1).max(80).optional(),
      type: PlaceTypeSchema.optional(),
      x: z.number().optional(), y: z.number().optional(),
      notes: z.string().max(1000).optional(),
      hide_name: z.boolean().optional(),
      hide_marker: z.boolean().optional(),
      name_pos: z.enum(["auto", "right", "left", "above", "below"]).optional().describe("Side of the marker for the name (default auto: the first free side)"),
    }),
    async run(ctx, i) {
      const p = findPlace(featuresOf(ctx), i.place);
      if (!p) return { ...text(`No place "${i.place}". Use list_places.`), isError: true };
      const next: Place = { ...p, ...(i.name && { name: i.name }), ...(i.type && { type: i.type }),
        ...(i.x !== undefined && { x: i.x }), ...(i.y !== undefined && { y: i.y }),
        ...(i.notes !== undefined && { notes: i.notes }), ...(i.hide_name !== undefined && { hideName: i.hide_name }),
        ...(i.hide_marker !== undefined && { hideMarker: i.hide_marker }),
        ...(i.name_pos !== undefined && { namePos: i.name_pos }) };
      const r = ctx.execute({ op: "features", patch: { upsertPlaces: [next] }, label: `Edit place ${next.name}` });
      return json({ change: r.seq, place: next });
    },
  }),

  define({
    name: "remove_place",
    description: "Remove a place (by id or name).",
    schema: z.object({ place: z.string() }),
    async run(ctx, i) {
      const p = findPlace(featuresOf(ctx), i.place);
      if (!p) return { ...text(`No place "${i.place}".`), isError: true };
      const r = ctx.execute({ op: "features", patch: { removePlaces: [p.id] }, label: `Remove place ${p.name}` });
      return json({ change: r.seq, removed: p.name });
    },
  }),

  define({
    name: "list_places",
    description: "The gazetteer: every named place with id, type, map-px position and notes.",
    schema: z.object({}),
    async run(ctx) {
      const f = featuresOf(ctx);
      return f.places.length ? json(f.places) : text("No places yet.");
    },
  }),

  define({
    name: "add_label",
    description:
      "Add a map label: sea/region names in large spaced capitals, ranges/islands/features smaller. Either place it at its " +
      "centre (x, y) with angle (degrees, clockwise) and curve (-1..1, + arches up), or give a path: a line of map-pixel points " +
      "the text follows, such as a range's crest, a river or a coast (it reads left to right, centred on the line). " +
      "spread stretches the letters along the whole path (good for ranges).",
    schema: z.object({
      text: z.string().min(1).max(60),
      kind: LabelKindSchema,
      x: z.number().optional(), y: z.number().optional(),
      path: z.array(XY).min(2).max(200).optional().describe("Points the text follows, in order"),
      spread: z.boolean().optional(),
      angle: z.number().min(-180).max(180).optional(),
      curve: z.number().min(-1).max(1).optional(),
      size: z.number().min(0.4).max(3).optional().describe("Size multiplier (default 1)"),
    }),
    async run(ctx, i) {
      const path = i.path?.map((p) => [p[0], p[1]] as [number, number]);
      const at = path ? pathMidpoint(path) : i.x !== undefined && i.y !== undefined ? [i.x, i.y] : null;
      if (!at) return { ...text("Give either x and y, or a path."), isError: true };
      const label: MapLabel = {
        id: newFeatureId("l"), text: i.text, kind: i.kind, x: at[0], y: at[1], size: i.size,
        ...(path ? { path, ...(i.spread && { spread: true }) } : { angle: i.angle, curve: i.curve }),
      };
      const r = ctx.execute({ op: "features", patch: { upsertLabels: [label] }, label: `Add label ${i.text}` });
      return json({ change: r.seq, label });
    },
  }),

  define({
    name: "update_label",
    description:
      "Move, re-word, rotate, bend or resize a label (find it by id or current text). Give a path to make it follow a line, " +
      "or path: [] to straighten it again. Moving x/y on a path label shifts the whole line.",
    schema: z.object({
      label: z.string().describe("Label id or current text"),
      text: z.string().min(1).max(60).optional(),
      kind: LabelKindSchema.optional(),
      x: z.number().optional(), y: z.number().optional(),
      path: z.array(XY).max(200).optional().describe("New line to follow; [] removes it"),
      spread: z.boolean().optional(),
      angle: z.number().min(-180).max(180).optional(),
      curve: z.number().min(-1).max(1).optional(),
      size: z.number().min(0.4).max(3).optional(),
    }),
    async run(ctx, i) {
      const l = findLabel(featuresOf(ctx), i.label);
      if (!l) return { ...text(`No label "${i.label}". Use list_labels.`), isError: true };
      let next: MapLabel = { ...l, ...(i.text && { text: i.text }), ...(i.kind && { kind: i.kind }),
        ...(i.angle !== undefined && { angle: i.angle }), ...(i.curve !== undefined && { curve: i.curve }),
        ...(i.size !== undefined && { size: i.size }), ...(i.spread !== undefined && { spread: i.spread }) };
      if (i.path !== undefined) {
        if (i.path.length === 1) return { ...text("A path needs at least 2 points (or [] to remove it)."), isError: true };
        if (i.path.length === 0) {
          const { path: _p, spread: _s, ...rest } = next;
          next = rest;
        } else {
          next.path = i.path.map((p) => [p[0], p[1]] as [number, number]);
          [next.x, next.y] = pathMidpoint(next.path);
        }
      }
      if (i.x !== undefined || i.y !== undefined) {
        const dx = (i.x ?? next.x) - next.x, dy = (i.y ?? next.y) - next.y;
        next = { ...next, x: next.x + dx, y: next.y + dy, ...(next.path && { path: next.path.map(([px, py]) => [px + dx, py + dy] as [number, number]) }) };
      }
      const r = ctx.execute({ op: "features", patch: { upsertLabels: [next] }, label: `Edit label ${next.text}` });
      return json({ change: r.seq, label: next });
    },
  }),

  define({
    name: "remove_label",
    description: "Remove a label (by id or text).",
    schema: z.object({ label: z.string() }),
    async run(ctx, i) {
      const l = findLabel(featuresOf(ctx), i.label);
      if (!l) return { ...text(`No label "${i.label}".`), isError: true };
      const r = ctx.execute({ op: "features", patch: { removeLabels: [l.id] }, label: `Remove label ${l.text}` });
      return json({ change: r.seq, removed: l.text });
    },
  }),

  define({
    name: "list_labels",
    description: "Every map label with id, kind, position, angle and curve.",
    schema: z.object({}),
    async run(ctx) {
      const f = featuresOf(ctx);
      return f.labels.length ? json(f.labels) : text("No labels yet.");
    },
  }),

  define({
    name: "add_climate_region",
    description:
      "Add a climate region: an area whose climate replaces the natural gradient inside its borders (a spirit's domain, a " +
      "curse, an eternal winter). Set any of temperature, moisture, ground snow, bare stone (rock: dark rock instead of green land, e.g. rocky outcroppings) and volcanic ground (volcanic: black ash and lava fields); the map's colours, vegetation and snow follow. " +
      "Only add regions the user asked for; record who holds it in owner only if the user said so.",
    schema: z.object({ name: z.string().min(1).max(80), shape: RegionShape, ...regionClimate }),
    async run(ctx, i) {
      const r: ClimateRegion = {
        id: newFeatureId("r"), name: i.name, polygon: regionPolygon(i.shape),
        ...(i.temperature !== undefined && { temperature: i.temperature }), ...(i.moisture !== undefined && { moisture: i.moisture }),
        ...(i.snow !== undefined && { snow: i.snow }), ...(i.rock !== undefined && { rock: i.rock }), ...(i.volcanic !== undefined && { volcanic: i.volcanic }), ...(i.strength !== undefined && { strength: i.strength }),
        ...(i.border && { border: i.border }), ...(i.blend_km !== undefined && { blendKm: i.blend_km }),
        ...(i.owner && { owner: i.owner }), ...(i.notes && { notes: i.notes }),
      };
      const res = ctx.execute({ op: "features", patch: { upsertRegions: [r] }, label: `Add climate region ${i.name}` });
      return json({ change: res.seq, region: { ...r, polygon: `${r.polygon.length} points` }, note: "The climate recomputes in about a second; render_preview to see it." });
    },
  }),

  define({
    name: "update_climate_region",
    description: "Change a climate region's outline, name, climate, border, owner or notes (find it by id or name). Set a climate value to null to stop overriding it.",
    schema: z.object({
      region: z.string().describe("Region id or current name"),
      name: z.string().min(1).max(80).optional(),
      shape: RegionShape.optional(),
      ...regionClimate,
      temperature: regionClimate.temperature.nullable(),
      moisture: regionClimate.moisture.nullable(),
      snow: regionClimate.snow.nullable(),
      rock: regionClimate.rock.nullable(),
      volcanic: regionClimate.volcanic.nullable(),
    }),
    async run(ctx, i) {
      const r = findRegion(featuresOf(ctx), i.region);
      if (!r) return { ...text(`No climate region "${i.region}". Use list_climate_regions.`), isError: true };
      const next: ClimateRegion = { ...r };
      if (i.name) next.name = i.name;
      if (i.shape) next.polygon = regionPolygon(i.shape);
      for (const k of ["temperature", "moisture", "snow", "rock", "volcanic"] as const) {
        if (i[k] === null) delete next[k];
        else if (i[k] !== undefined) next[k] = i[k];
      }
      if (i.strength !== undefined) next.strength = i.strength;
      if (i.border) next.border = i.border;
      if (i.blend_km !== undefined) next.blendKm = i.blend_km;
      if (i.owner !== undefined) next.owner = i.owner;
      if (i.notes !== undefined) next.notes = i.notes;
      const res = ctx.execute({ op: "features", patch: { upsertRegions: [next] }, label: `Edit climate region ${next.name}` });
      return json({ change: res.seq, region: { ...next, polygon: `${next.polygon.length} points` } });
    },
  }),

  define({
    name: "remove_climate_region",
    description: "Remove a climate region (by id or name); the natural climate returns there.",
    schema: z.object({ region: z.string() }),
    async run(ctx, i) {
      const r = findRegion(featuresOf(ctx), i.region);
      if (!r) return { ...text(`No climate region "${i.region}".`), isError: true };
      const res = ctx.execute({ op: "features", patch: { removeRegions: [r.id] }, label: `Remove climate region ${r.name}` });
      return json({ change: res.seq, removed: r.name });
    },
  }),

  define({
    name: "list_climate_regions",
    description: "Every climate region with its climate, border, owner and outline bounds.",
    schema: z.object({}),
    async run(ctx) {
      const rs = featuresOf(ctx).regions ?? [];
      if (!rs.length) return text("No climate regions yet.");
      return json(rs.map((r) => {
        const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
        const { polygon: _p, ...rest } = r;
        return { ...rest, points: r.polygon.length, bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
      }));
    },
  }),

  define({
    name: "add_river_source",
    description:
      "Mark where a river begins with more water than the land around it could supply: a great spring, or a great waterfall fed from far upstream beyond what the map shows. " +
      "It adds flow at that point and the river then runs downhill to the sea like any other (rivers are worked out from the terrain and climate, never drawn by hand). " +
      `size: ${RIVER_SIZE_HELP}. Tie it to a place (the source then moves with the place) or give x, y in map px. ` +
      "Only when the user asked for it; name the river only if the user gave a name.",
    schema: z.object({
      place: z.string().optional().describe("A place's id or name: the source is at that place and follows it if it is moved"),
      x: z.number().optional(), y: z.number().optional(),
      size: z.enum(RIVER_SIZES).optional().describe("Default river"),
      name: z.string().min(1).max(80).optional().describe("The river's name, only if the user gave one"),
      notes: z.string().max(1000).optional(),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc, f = featuresOf(ctx);
      let at: { x: number; y: number }, placeId: string | undefined, label: string;
      if (i.place) {
        const p = findPlace(f, i.place);
        if (!p) return fail(`No place "${i.place}". Use list_places, or give x and y.`);
        if ((f.sources ?? []).some((s) => s.placeId === p.id)) return fail(`${p.name} already has a river source. Use update_river_source to change it.`);
        at = p; placeId = p.id; label = p.name;
      } else if (i.x !== undefined && i.y !== undefined) {
        at = { x: i.x, y: i.y }; label = `(${Math.round(i.x)}, ${Math.round(i.y)})`;
      } else return fail("Say where: a place (place) or a point (x and y).");
      if (landCellNear(doc.height.data, doc.height.w, doc.height.h, doc.meta.seaLevel, at.x, at.y) < 0) return fail(`${label} isn't on land (or is more than 3 px from it): a river has to start on land.`);
      const src: RiverSource = { id: newFeatureId("s"), ...(placeId ? { placeId } : { x: at.x, y: at.y }), size: i.size ?? "river", ...(i.name && { name: i.name }), ...(i.notes && { notes: i.notes }) };
      const res = ctx.execute({ op: "features", patch: { upsertSources: [src] }, label: `Add river source ${label}` });
      return json({ change: res.seq, source: src, at, share_of_map_runoff: RIVER_SIZE_SHARE[src.size], note: "The rivers recompute in about a second. render_preview to see the river, and check_hydrology to see where it goes." });
    },
  }),

  define({
    name: "update_river_source",
    description: "Change a river source's size, name or notes, or move it (find it by id, river name or the name of its place). A source at a place moves when the place does: move the place, not the source.",
    schema: z.object({
      source: z.string().describe("Source id, river name, or the name of the place it is at"),
      size: z.enum(RIVER_SIZES).optional(),
      name: z.string().min(1).max(80).nullable().optional().describe("null removes the river's name"),
      notes: z.string().max(1000).optional(),
      x: z.number().optional(), y: z.number().optional(),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc, f = featuresOf(ctx);
      const s = findSource(f, i.source);
      if (!s) return fail(`No river source "${i.source}". Use list_river_sources.`);
      const next: RiverSource = { ...s };
      if (i.size) next.size = i.size;
      if (i.name === null) delete next.name; else if (i.name) next.name = i.name;
      if (i.notes !== undefined) next.notes = i.notes;
      if (i.x !== undefined || i.y !== undefined) {
        if (s.placeId) return fail("This source is at a place: move the place (update_place) and the source follows.");
        next.x = i.x ?? s.x; next.y = i.y ?? s.y;
        if (landCellNear(doc.height.data, doc.height.w, doc.height.h, doc.meta.seaLevel, next.x ?? 0, next.y ?? 0) < 0) return fail("That point isn't on land.");
      }
      const res = ctx.execute({ op: "features", patch: { upsertSources: [next] }, label: "Edit river source" });
      return json({ change: res.seq, source: next });
    },
  }),

  define({
    name: "remove_river_source",
    description: "Remove a river source (by id, river name or the name of its place). The river it fed shrinks to what its own land supplies, or disappears.",
    schema: z.object({ source: z.string() }),
    async run(ctx, i) {
      const s = findSource(featuresOf(ctx), i.source);
      if (!s) return fail(`No river source "${i.source}".`);
      const res = ctx.execute({ op: "features", patch: { removeSources: [s.id] }, label: "Remove river source" });
      return json({ change: res.seq, removed: s.name ?? s.placeId ?? s.id });
    },
  }),

  define({
    name: "list_grounds",
    description:
      "Every kind of ground the painted map shows (the editor's Ground legend): forests, open land, cold, dry, water's edge and the ones a climate region sets, each with where it appears and how to get it (climate-region settings, height, or found automatically). " +
      "Use it when the user asks what grounds or biomes the map has, or wants a place to look a certain way (a tundra island, a steppe, a marsh): set the climate with add_climate_region or set_climate, then check what grew with get_selection (its `biomes` shares) and render_preview. It changes nothing.",
    schema: z.object({ group: z.enum(["Forest", "Open land", "Cold", "Dry", "Water's edge", "Set by a region"]).optional().describe("Only this group") }),
    async run(_ctx, a) {
      const list = GROUND_INFO.filter((g) => !a.group || g.group === a.group).map((g) => ({ id: g.id, name: g.name, group: g.group, where: g.where, how_to_get_it: g.recipe }));
      return json({
        grounds: list,
        notes: [
          "Temperature and moisture run 0..1 on a climate region; the ground follows them and the height (trees stop at about 700 m up, snow and glacier lie on high cold ground), so the same region looks different on a mountain and on a plain.",
          "Ground is only paint: it names no place and records no lore. Use only names the DM gave.",
          "The Painted style shows all of this; the Relief style does not.",
        ],
      });
    },
  }),

  define({
    name: "list_river_sources",
    description: "Every river source: where it is, its size, and (once the rivers are worked out) how long its river is and where it ends.",
    schema: z.object({}),
    async run(ctx) {
      const f = featuresOf(ctx);
      const sources = f.sources ?? [];
      if (!sources.length) return text("No river sources yet. add_river_source makes one.");
      const places = new Map(f.places.map((p) => [p.id, p]));
      const where = (s: RiverSource) => (s.placeId ? places.get(s.placeId) : s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y, name: undefined } : undefined);
      const hydro = (await ctx.derived?.())?.hydro;
      let j = 0; // the water summary lists the sources that could be located, in the same order
      return json(sources.map((s) => {
        const at = where(s);
        const rep = at ? hydro?.sources[j++] : undefined;
        return { id: s.id, river: s.name ?? null, place: s.placeId ? at && "name" in at ? at.name : "(its place was removed)" : null, at: at ? { x: Math.round(at.x), y: Math.round(at.y) } : null, size: s.size, notes: s.notes ?? null,
          ...(rep && { river_drawn: rep.drawn, length_km: rep.lengthKm, reaches: rep.reaches, mouth: rep.mouth }) };
      }));
    },
  }),

  define({
    name: "check_hydrology",
    description:
      "Explain the map's water: how many rivers and how long, where they end, what each lake drains into, how much of the river length runs through hollows or very dry land, and what each river source feeds. " +
      "Use it after changing terrain, climate or river sources, and when the user asks whether the rivers and lakes make sense.",
    schema: z.object({}),
    async run(ctx) {
      const d = await ctx.derived?.();
      if (!d?.hydro) return fail("The climate and rivers haven't been worked out yet (or this isn't a world map). Try again in a moment.");
      return json({ ...d.hydro, notes: hydroNotes(d.hydro) });
    },
  }),

  define({
    name: "get_selection",
    description:
      "What the DM has selected in the editor right now (a point, an area, or one place, label, line, climate region or river source), with the facts about it: its shape and bounds in map px and in km and miles, elevation, climate, rivers, lakes and the features inside it, whether your edits are locked to it, and what part of the map the DM is looking at. " +
      "Call this first whenever the DM says \"this\", \"here\", \"this area\", \"the selected ...\" or gives an instruction without saying where.",
    schema: z.object({}),
    async run(ctx) {
      const st = ctx.selection?.();
      if (!st) return fail("The editor's selection isn't available in this session.");
      const doc = ctx.session().doc;
      const view = st.view ? { x: st.view.rect.x, y: st.view.rect.y, w: st.view.rect.w, h: st.view.rect.h, zoom: st.view.zoom, note: "the part of the map the DM is looking at (map px); zoom is screen px per map px" } : null;
      if (!st.selection) return json({ selected: false, view, note: "Nothing is selected. If the DM means a particular place, ask them to select it (Select tool: click a place or drag an area), or ask where; the view above is what they are looking at." });
      let derived = null;
      try { derived = (await ctx.derived?.()) ?? null; } catch { /* the climate isn't ready: the numbers that need it are left out */ }
      const rep = selectionReport(doc, derived, st.selection);
      const locked = st.lock && !!rep.shape;
      return json({
        selected: true, ...rep, locked, view,
        ...(locked && { lock_note: "Your edits are held to this area: terrain changes are clipped to it (soft edge inside, nothing outside changes) and changes to places, lines, regions or river sources outside it are refused. You can't change the selection while it is locked." }),
        ...(!rep.shape && st.selection.kind !== "point" && { note: "A single feature is selected (no area): edit it with its own tool (update_place, update_label, update_line, update_climate_region, update_river_source)." }),
      });
    },
  }),

  define({
    name: "select_area",
    description:
      "Highlight an area in the DM's editor so they can see what you mean (\"is this the area?\"). It only highlights: it does not edit anything and does not lock your edits. Refused while the DM has locked your edits to a selection. Clear it with clear_selection when you are done.",
    schema: z.object({ shape: RegionShape }),
    async run(ctx, i) {
      if (!ctx.setSelection || !ctx.selection) return fail("The editor's selection isn't available in this session.");
      const doc = ctx.session().doc;
      const sel = cleanSelection({ kind: "area", shape: i.shape }, doc.meta.width, doc.meta.height);
      if (!sel) return fail("That isn't a usable area.");
      if (ctx.selection().lock) return fail("The DM has locked your edits to their selection: you can't change it. Ask them.");
      ctx.setSelection(sel);
      return json({ selected: describeSelection(sel, doc.features, doc.meta.kmPerPx), note: "Highlighted in the editor. render_preview with selection: true to look at it." });
    },
  }),

  define({
    name: "clear_selection",
    description: "Clear the selection in the DM's editor (for instance a highlight you made with select_area). Refused while the DM has locked your edits to it.",
    schema: z.object({}),
    async run(ctx) {
      if (!ctx.setSelection || !ctx.selection) return fail("The editor's selection isn't available in this session.");
      if (ctx.selection().lock) return fail("The DM has locked your edits to their selection: you can't clear it. Ask them.");
      ctx.setSelection(null);
      return json({ selected: false });
    },
  }),

  define({
    name: "set_map_furniture",
    description:
      "Set the map's extras: a title banner, a scale bar, a compass rose and a frame. They show in the editor, the phone page and exports (not in " +
      "previews). Only give the fields to change; set title to an empty string to remove it. Only use a title the user gave or confirmed.",
    schema: z.object({
      title: z.string().max(80).optional(),
      title_position: z.enum(["top", "bottom"]).optional(),
      scale_bar: z.boolean().optional(),
      scale_corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
      units: z.enum(["miles", "km"]).optional(),
      compass: z.boolean().optional(),
      compass_corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
      frame: z.boolean().optional(),
    }),
    async run(ctx, i) {
      const cur: MapFurniture = ctx.session().doc.meta.furniture ?? {};
      const next: MapFurniture = {
        ...cur,
        ...(i.title !== undefined && { title: i.title.trim() }), ...(i.title_position && { titlePos: i.title_position }),
        ...(i.scale_bar !== undefined && { scaleBar: i.scale_bar }), ...(i.scale_corner && { scaleCorner: i.scale_corner }), ...(i.units && { units: i.units }),
        ...(i.compass !== undefined && { compass: i.compass }), ...(i.compass_corner && { compassCorner: i.compass_corner }),
        ...(i.frame !== undefined && { frame: i.frame }),
      };
      if (!next.title) delete next.title;
      const r = ctx.execute({ op: "set_meta", patch: { furniture: next }, label: describeFurniture(next) });
      return json({ change: r.seq, furniture: next });
    },
  }),

  define({
    name: "set_grid",
    description:
      "Show a square or hex grid over the map (or turn it off). size_miles is the side of a square, or the distance across the flats of a " +
      "hex (a '6-mile hex' is 6). The grid is a drawing aid: it shows in the editor, the phone page and PNG exports, but not in previews.",
    schema: z.object({
      type: z.enum(["off", "square", "hex"]),
      size_miles: z.number().min(0.1).optional().describe("Cell size in miles (default: keep the current size, or a tidy size for this map)"),
      orientation: z.enum(["pointy", "flat"]).optional().describe("Hex grids: point on top (default) or flat edge on top"),
      opacity: z.number().min(0.1).max(1).optional().describe("Line strength (default 0.5)"),
    }),
    async run(ctx, i) {
      const meta = ctx.session().doc.meta;
      const widthMi = meta.width * meta.kmPerPx * MI_PER_KM;
      const cur = meta.grid;
      const grid: MapGrid = {
        type: i.type, sizeMi: clampGridSize(i.size_miles ?? cur?.sizeMi ?? niceGridSize(widthMi), widthMi),
        orient: i.orientation ?? cur?.orient ?? "pointy", opacity: i.opacity ?? cur?.opacity ?? 0.5,
      };
      const r = ctx.execute({ op: "set_meta", patch: { grid }, label: describeGrid(grid) });
      return json({ change: r.seq, grid, cells_across_map: grid.type === "off" ? undefined : Math.round(widthMi / grid.sizeMi), cell_px: +gridCellPx(grid, meta.kmPerPx).toFixed(2) });
    },
  }),

  define({
    name: "route_road",
    description:
      "Lay a road or trail between points, found automatically over the terrain: it keeps to low ground, goes through passes, avoids " +
      "lakes and costly river crossings, can't cross sea, and joins existing roads. Give a start, an end and optional via waypoints. " +
      "The result reports its length (a day on foot is about 24 miles). Use add_line instead to draw a line exactly (borders, sea routes).",
    schema: z.object({
      from: XY, to: XY,
      via: z.array(XY).max(20).optional().describe("Waypoints the route must pass through, in order"),
      kind: z.enum(["road", "trail"]).optional().describe("Default road. Trails tolerate steeper ground"),
      name: z.string().max(80).optional(),
      follow_existing: z.boolean().optional().describe("Prefer existing roads (default true)"),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc;
      const waypoints = [i.from, ...(i.via ?? []), i.to].map((p) => [p[0], p[1]] as [number, number]);
      const r = routeWaypoints(doc, (await ctx.derived?.()) ?? null, waypoints, { followExisting: i.follow_existing, steepOk: i.kind === "trail" });
      if ("error" in r) return { ...text(r.error), isError: true };
      const line: MapLine = { id: newFeatureId("m"), kind: i.kind ?? "road", points: r.points, ...(i.name && { name: i.name }) };
      const res = ctx.execute({ op: "features", patch: { upsertLines: [line] }, label: `Add ${line.kind}${line.name ? ` ${line.name}` : ""}` });
      return json({ change: res.seq, line: lineSummary(line, doc.meta.kmPerPx), days_on_foot: +(r.lengthKm * 0.621371 / 24).toFixed(1) });
    },
  }),

  define({
    name: "add_line",
    description:
      "Add a road, trail, border or reef drawn exactly through the given points (map pixels). Borders can be closed to make a territory outline. " +
      "A reef is a barrier of razor rocks across a strait or along a coast (drawn as jagged dark rocks with a pale shoal). Only add borders and reefs the user described or confirmed; they are lore.",
    schema: z.object({
      kind: LineKindSchema,
      points: z.array(XY).min(2).max(400),
      closed: z.boolean().optional().describe("Borders: join the last point to the first"),
      name: z.string().max(80).optional(),
      notes: z.string().max(1000).optional(),
    }),
    async run(ctx, i) {
      const line: MapLine = {
        id: newFeatureId("m"), kind: i.kind, points: i.points.map((p) => [p[0], p[1]] as [number, number]),
        ...(i.closed && { closed: true }), ...(i.name && { name: i.name }), ...(i.notes && { notes: i.notes }),
      };
      const res = ctx.execute({ op: "features", patch: { upsertLines: [line] }, label: `Add ${line.kind}${line.name ? ` ${line.name}` : ""}` });
      return json({ change: res.seq, line: lineSummary(line, ctx.session().doc.meta.kmPerPx) });
    },
  }),

  define({
    name: "find_straits",
    description:
      "Measure the straits of an archipelago: the islands that form its outer ring and the narrowest crossing between each neighbouring pair (where their coasts come closest). " +
      "Returns each strait's width, the two coast points (map px) and its compass direction from the middle of the ring. It changes nothing: use add_strait_reefs or add_line (kind reef) to draw reefs across them. " +
      "centre defaults to the middle of the land: give it (map px) when the ring is centred elsewhere, for instance on an inner sea or an island at its heart.",
    schema: z.object({
      centre: XY.optional().describe("Middle of the ring in map px"),
      ring_fraction: z.number().min(0.2).max(0.95).optional().describe("Islands count as the ring when they are at least this fraction of the farthest island's distance from the centre (default 0.55)"),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc;
      if (isBattle(doc)) return fail("This is a battlemap.");
      const r = straitsOf(ctx, i.centre, i.ring_fraction);
      return json({
        centre: r.centre, scale_km_per_px: doc.meta.kmPerPx,
        ring_islands: r.islands.map((x) => ({ index: x.index, compass: x.compass, centroid: x.centroid, area_km2: x.areaKm2 })),
        straits: r.straits.map((x, n) => ({ index: n, between: x.between.map((b) => r.islands[b].compass), compass: x.compass, width_px: x.widthPx, width_km: x.widthKm, from: x.from, to: x.to, mid: x.mid })),
        note: r.straits.length ? "Each strait is the shortest line across the water between two ring islands. add_strait_reefs draws a reef along it." : "No ring of islands found: pass centre, or lower ring_fraction.",
      });
    },
  }),

  define({
    name: "add_strait_reefs",
    description:
      "Draw reefs (razor rocks with a pale shoal) across the straits found by find_straits, one line per strait, coast to coast, slightly wavy. Only when the user said the straits are guarded by reefs. " +
      "which = strait indices from find_straits (default all). The reefs are ordinary lines: move, rename or delete them with update_line / remove_line, or undo the whole step.",
    schema: z.object({
      which: z.array(z.number().int().min(0)).max(64).optional(),
      name: z.string().max(80).optional().describe("Default \"Razor reefs\""),
      notes: z.string().max(1000).optional(),
      centre: XY.optional(),
      ring_fraction: z.number().min(0.2).max(0.95).optional(),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc;
      if (isBattle(doc)) return fail("This is a battlemap.");
      const r = straitsOf(ctx, i.centre, i.ring_fraction);
      if (!r.straits.length) return fail("No straits found (no ring of islands). Pass centre or lower ring_fraction, or draw the reefs with add_line.");
      const picked = (i.which ?? r.straits.map((_, n) => n)).filter((n) => n < r.straits.length);
      if (!picked.length) return fail("None of those strait indices exist. Use find_straits.");
      const lines: MapLine[] = picked.map((n) => {
        const st = r.straits[n], [ax, ay] = st.from, [bx, by] = st.to, len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len;
        // a gentle S across the water, repeatable for the same strait
        const wob = (k: number) => ((((Math.imul(Math.round(ax * 31 + ay * 17 + k * 101), 2654435761) >>> 0) % 1000) / 1000) - 0.5) * 0.18 * len;
        const pts: [number, number][] = [[ax, ay], [ax + (bx - ax) / 3 + nx * wob(1), ay + (by - ay) / 3 + ny * wob(1)], [ax + (2 * (bx - ax)) / 3 + nx * wob(2), ay + (2 * (by - ay)) / 3 + ny * wob(2)], [bx, by]];
        return {
          id: newFeatureId("m"), kind: "reef" as const, name: i.name ?? "Razor reefs", points: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]),
          ...(i.notes && { notes: i.notes }),
        };
      });
      const res = ctx.execute({ op: "features", patch: { upsertLines: lines }, label: `Add ${lines.length} reef${lines.length === 1 ? "" : "s"} across the straits` });
      return json({ change: res.seq, added: lines.map((l, k) => ({ id: l.id, strait: picked[k], compass: r.straits[picked[k]].compass, width_km: r.straits[picked[k]].widthKm })) });
    },
  }),

  define({
    name: "add_coast_reefs",
    description:
      "Fringe the OUTER coasts of an archipelago's ring islands with reefs (razor rocks a little out to sea): the shores that face the open ocean, not the ones that face the inner sea (the straits count as closed). " +
      "clear = areas to leave bare, each a polygon [[x,y],...] or a circle {x,y,r} in map px, e.g. a home island whose coast must stay clear. dry_run = measure only. " +
      "Only when the user said the outer coasts are reef-bound. The reefs are ordinary lines (one per stretch of coast); one undo step removes them all.",
    schema: z.object({
      clear: z.array(z.union([
        z.object({ polygon: z.array(XY).min(3).max(200) }),
        z.object({ circle: z.object({ x: z.number(), y: z.number(), r: z.number().positive() }) }),
      ])).max(20).optional(),
      offset_px: z.number().min(0).max(20).optional().describe("How far out to sea the reef line sits, map px (default 2)"),
      min_length_px: z.number().min(2).max(500).optional().describe("Skip stretches shorter than this (default 14)"),
      name: z.string().max(80).optional().describe("Default \"Razor reefs\""),
      notes: z.string().max(1000).optional(),
      dry_run: z.boolean().optional(),
      centre: XY.optional(),
      ring_fraction: z.number().min(0.2).max(0.95).optional(),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc;
      if (isBattle(doc)) return fail("This is a battlemap.");
      const centre = i.centre ? ([i.centre[0], i.centre[1]] as [number, number]) : undefined;
      const clear = (i.clear ?? []).map((c) => ("polygon" in c ? { polygon: c.polygon.map((p) => [p[0], p[1]] as [number, number]) } : { circle: [c.circle.x, c.circle.y, c.circle.r] as [number, number, number] }));
      const pieces = findOuterCoasts(doc.height, doc.meta.seaLevel, doc.meta.kmPerPx, {
        ...(centre && { centre }), ...(i.ring_fraction !== undefined && { ringFraction: i.ring_fraction }), clear,
        ...(i.offset_px !== undefined && { offsetPx: i.offset_px }), ...(i.min_length_px !== undefined && { minLengthPx: i.min_length_px }),
      });
      if (!pieces.length) return fail("No outer coast found (no ring of islands). Pass centre or lower ring_fraction, or draw the reefs with add_line.");
      const totalKm = Math.round(pieces.reduce((a, p) => a + p.lengthPx, 0) * doc.meta.kmPerPx);
      if (i.dry_run) return json({ would_add: pieces.length, total_km: totalKm, total_miles: Math.round(totalKm * 0.621371), cleared_areas: clear.length });
      const lines: MapLine[] = [];
      for (const p of pieces) {
        for (let at = 0; at < p.points.length - 1; at += 300) {
          const chunk = p.points.slice(at, at + 301);
          if (chunk.length >= 2) lines.push({ id: newFeatureId("m"), kind: "reef", name: i.name ?? "Razor reefs", points: chunk, ...(i.notes && { notes: i.notes }) });
        }
      }
      const res = ctx.execute({ op: "features", patch: { upsertLines: lines }, label: `Add reefs along the outer coasts (${lines.length} stretches)` });
      return json({ change: res.seq, added: lines.length, total_km: totalKm, total_miles: Math.round(totalKm * 0.621371), cleared_areas: clear.length });
    },
  }),

  define({
    name: "update_line",
    description: "Rename, retype, reshape (new points), close or annotate a road, trail or border (find it by id or name).",
    schema: z.object({
      line: z.string().describe("Line id or current name"),
      kind: LineKindSchema.optional(),
      name: z.string().max(80).optional(),
      points: z.array(XY).min(2).max(400).optional(),
      closed: z.boolean().optional(),
      notes: z.string().max(1000).optional(),
    }),
    async run(ctx, i) {
      const l = findLine(featuresOf(ctx), i.line);
      if (!l) return { ...text(`No line "${i.line}". Use list_lines.`), isError: true };
      const next: MapLine = { ...l, ...(i.kind && { kind: i.kind }), ...(i.name !== undefined && { name: i.name }), ...(i.closed !== undefined && { closed: i.closed }),
        ...(i.notes !== undefined && { notes: i.notes }), ...(i.points && { points: i.points.map((p) => [p[0], p[1]] as [number, number]) }) };
      if (!next.closed) delete next.closed;
      const res = ctx.execute({ op: "features", patch: { upsertLines: [next] }, label: `Edit ${next.kind}${next.name ? ` ${next.name}` : ""}` });
      return json({ change: res.seq, line: lineSummary(next, ctx.session().doc.meta.kmPerPx) });
    },
  }),

  define({
    name: "remove_line",
    description: "Remove a road, trail or border (by id or name).",
    schema: z.object({ line: z.string() }),
    async run(ctx, i) {
      const l = findLine(featuresOf(ctx), i.line);
      if (!l) return { ...text(`No line "${i.line}".`), isError: true };
      const res = ctx.execute({ op: "features", patch: { removeLines: [l.id] }, label: `Remove ${l.kind}${l.name ? ` ${l.name}` : ""}` });
      return json({ change: res.seq, removed: l.name ?? l.id });
    },
  }),

  define({
    name: "list_lines",
    description: "Every road, trail, border and reef with its length, and where it starts and ends.",
    schema: z.object({}),
    async run(ctx) {
      const ls = featuresOf(ctx).lines ?? [];
      if (!ls.length) return text("No roads, trails, borders or reefs yet.");
      return json(ls.map((l) => lineSummary(l, ctx.session().doc.meta.kmPerPx)));
    },
  }),

  define({
    name: "export_gazetteer",
    description: "The gazetteer as a Markdown table (name, type, position in map px and km, notes), e.g. to put in the brief.",
    schema: z.object({}),
    async run(ctx) {
      const f = featuresOf(ctx);
      const k = ctx.session().doc.meta.kmPerPx;
      if (!f.places.length) return text("No places yet.");
      const rows = [...f.places].sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => `| ${p.name} | ${p.type} | (${Math.round(p.x)}, ${Math.round(p.y)}) | (${Math.round(p.x * k)} km, ${Math.round(p.y * k)} km) | ${(p.notes ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`);
      return text(["| Name | Type | Map px | From top-left | Notes |", "|---|---|---|---|---|", ...rows].join("\n"));
    },
  }),

  define({
    name: "list_references",
    description: "Reference images attached to this project (sketches, inspiration, existing maps).",
    schema: z.object({}),
    async run(ctx) {
      const refs = await ctx.listRefs();
      return text(refs.length ? refs.map((r) => `${r.name} (${Math.round(r.bytes / 1024)} KB)`).join("\n") : "No reference images yet.");
    },
  }),

  define({
    name: "view_reference",
    description: "Look at a reference image, optionally cropped (in the image's own pixels) to inspect detail.",
    schema: z.object({
      name: z.string(),
      region: Region.optional(),
      max_size: z.number().int().min(256).max(1568).optional(),
    }),
    async run(ctx, i) {
      const bytes = await ctx.readRef(i.name);
      if (!bytes) return { ...text(`No reference named ${i.name}. Use list_references.`), isError: true };
      const prep = prepareReference(bytes, i.max_size ?? 1568, i.region);
      if (!prep) return { ...text("This image format can't be decoded here (use PNG, JPEG or a still WebP)."), isError: true };
      return { content: [
        { type: "text", text: `${i.name}: ${prep.width}x${prep.height} px${i.region ? `, crop x${i.region.x} y${i.region.y} ${i.region.w}x${i.region.h}` : ""}, shown at ${prep.outW}x${prep.outH}.` },
        { type: "image", mediaType: "image/jpeg", data: toBase64(prep.jpeg) },
      ] };
    },
  }),
  ...BATTLE_TOOLS,
  ...ASSET_TOOLS,
  ...TRACE_TOOLS,
  ...CITY_TOOLS,
  ...CITY_LAND_TOOLS,
] as const;

function normShape(s: z.infer<typeof Shape>) {
  if (s.type === "polygon" || s.type === "stroke") return { ...s, points: pts(s.points) };
  return s;
}

export type AnyTool = (typeof TOOLS)[number];

export function findTool(name: string): AnyTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Tools that only make sense on a world map (terrain, climate, places, roads...). */
const WORLD_ONLY = new Set([
  "render_preview", "query_points", "create_regional_map", "generate_terrain", "import_sketch", "add_landmass", "add_mountain_range", "sculpt", "set_sea_level",
  "erode", "set_style", "set_climate", "create_battlemap_here", "compare_to_reference", "add_place", "update_place", "remove_place", "list_places", "add_label", "update_label", "remove_label",
  "list_labels", "add_climate_region", "update_climate_region", "remove_climate_region", "list_climate_regions", "set_map_furniture", "set_grid", "route_road",
  "add_line", "update_line", "remove_line", "list_lines", "export_gazetteer", "find_straits", "add_strait_reefs", "add_coast_reefs",
  "add_river_source", "update_river_source", "remove_river_source", "list_river_sources", "check_hydrology",
  "get_selection", "select_area", "clear_selection",
]);
const CITY_ONLY = new Set([...CITY_TOOL_NAMES.filter((n) => n !== "create_city"), ...CITY_LAND_TOOL_NAMES]);
const BATTLE_ONLY = new Set([...BATTLE_TOOLS.map((t) => t.name).filter((n) => n !== "create_battlemap" && n !== "create_battlemap_here"), ...ASSET_BATTLE_TOOL_NAMES]);

/** Validate input against the tool's schema and run it; errors become is_error results. */
export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) return { ...text(`Unknown tool: ${name}`), isError: true };
  let battle: boolean | null = null, city = false;
  try { const d = ctx.session().doc; battle = isBattle(d); city = isCity(d); } catch { /* no project open */ }
  if (city && (WORLD_ONLY.has(name) || BATTLE_ONLY.has(name))) {
    return { ...text(`${name} isn't available on a city map. A city map is made of buildings, streets and ground: use render_city, paint_ground, add_streets, add_buildings, list_buildings and the like (get_map_summary says what is there).`), isError: true };
  }
  if (!city && battle !== null && CITY_ONLY.has(name)) {
    return { ...text(`${name} is for city maps, and the open project is ${battle ? "a battlemap" : "a world map"}. create_city makes a city map; open_project switches to one.`), isError: true };
  }
  if (battle === true && WORLD_ONLY.has(name)) {
    return { ...text(`${name} is for world maps, and the open project is a battlemap. Use list_battle, render_battlemap, paint_floor, add_room, add_wall, add_door and add_light.`), isError: true };
  }
  if (battle === false && BATTLE_ONLY.has(name)) {
    return { ...text(`${name} is for battlemaps, and the open project is a world map. create_battlemap makes a battlemap; open_project switches to one.`), isError: true };
  }
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ...text(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`), isError: true };
  }
  try {
    return await (tool.run as (c: ToolContext, i: unknown) => Promise<ToolResult>)(ctx, parsed.data);
  } catch (e) {
    return { ...text(`${name} failed: ${(e as Error).message}`), isError: true };
  }
}

/** JSON Schema for each tool (for the Claude API and MCP tools/list). */
export function toolJsonSchemas() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema, { target: "draft-2020-12" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}
