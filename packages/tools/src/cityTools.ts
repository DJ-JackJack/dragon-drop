/**
 * Claude's tools for city maps: a city seen from above, made of buildings and streets on a ground, in METRES from the map's top-left corner. Buildings and streets go in in
 * batches (one edit, one undo step); a city has thousands of buildings, so nothing here sends them all back: lists are paged and previews show the picture.
 */
import { z } from "zod";
import {
  BUILDING_KINDS, MATERIALS, type MapBuilding, type MapStreet, type Rect, type RoofChoice, type Shape, ROOF_STYLES, STREET_KINDS, chooseRoof, citySpec, cityGroundMaterial, cleanBuilding, cleanStreet,
  drawGrid, fittingRoofAssets, isCity, materialByName, newFeatureId, pointsBounds, polygonArea, polygonCentroid, rectPolygon, renderCity, roofTileMetres, streetBridges, streetWidthFor,
} from "@mapmaker/core";
import { encodeJpeg, toBase64 } from "./images.ts";
import { traceOverlay } from "./traceTools.ts";
import { landSummary } from "./cityLandTools.ts";
import { describeWall } from "./cityWallTools.ts";
import type { ToolContext, ToolDef, ToolResult } from "./tools.ts";

function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
const fail = (t: string): ToolResult => ({ ...text(t), isError: true });

const Pt = z.tuple([z.number(), z.number()]);
const Roof = z.enum(ROOF_STYLES as unknown as [string, ...string[]]);
const Colour = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "A colour like #4a7a8c");
const Kind = z.enum(BUILDING_KINDS as unknown as [string, ...string[]]);
const Metres = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).describe("A part of the city in metres");
const CShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ type: z.literal("circle"), x: z.number(), y: z.number(), r: z.number().positive() }),
  z.object({ type: z.literal("polygon"), points: z.array(Pt).min(3).max(400) }),
  z.object({ type: z.literal("stroke"), points: z.array(Pt).min(1).max(400), r: z.number().positive().describe("half the width, in metres") }),
  z.object({ type: z.literal("all") }),
]).describe("Area in metres. 'stroke' follows a polyline (r is half its width); 'all' is the whole city.");

const featuresOf = (ctx: ToolContext) => ctx.session().doc.features ?? { places: [], labels: [] };
const round = (n: number) => Math.round(n * 10) / 10;

function needCity(ctx: ToolContext): ToolResult | null {
  return isCity(ctx.session().doc) ? null : fail("This tool is for city maps, and the open project isn't one. create_city makes one; open_project switches to one.");
}

/** What the city holds, for get_map_summary. */
export function citySummary(ctx: ToolContext) {
  const doc = ctx.session().doc, sp = citySpec(doc), f = featuresOf(ctx);
  const counts: Record<number, number> = {};
  for (let i = 0; i < doc.height.data.length; i += 7) counts[doc.height.data[i]] = (counts[doc.height.data[i]] ?? 0) + 1;
  const sampled = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const kinds: Record<string, number> = {};
  for (const b of f.buildings ?? []) kinds[b.kind ?? "unspecified"] = (kinds[b.kind ?? "unspecified"] ?? 0) + 1;
  return {
    project: doc.meta.id, name: doc.meta.name, kind: "city map", size_metres: [sp.widthM, sp.heightM], ground_cell_metres: sp.cellM,
    ground: Object.entries(counts).map(([m, n]) => ({ material: MATERIALS[Number(m)]?.name ?? "?", share_percent: Math.round((n / sampled) * 100) })).filter((g) => g.share_percent > 0),
    buildings: (f.buildings ?? []).length, buildings_by_kind: kinds, streets: (f.streets ?? []).length, bridges: bridgesOf(ctx, f.streets ?? []).length,
    ...((f.cityWalls ?? []).length && { walls: (f.cityWalls ?? []).map((w) => describeWall(ctx, w)).map(({ id, kind, ring, length_m, towers, gates }) => ({ id, kind, ...(ring && { ring }), length_m, towers, gates: gates.length })) }),
    roofs_from_asset_packs: (f.buildings ?? []).filter((b) => b.asset).length, roof_textures_available: ctx.roofPools?.() ? Object.fromEntries(ROOF_STYLES.map((s) => [s, ctx.roofPools!()![s].length])) : "no asset library is set up",
    trace_picture: f.trace?.ref ?? null, latest_change: ctx.session().seq,
    land: landSummary(ctx),
    note: "Coordinates are metres from the top-left corner. render_city looks at it; shape_land, set_city_climate, paint_ground, add_streets, add_city_walls, add_buildings and add_trees build it.",
  };
}

/** The bridges of some streets, as Claude reads them: which street, stone, wood or a ford, how long. */
function bridgesOf(ctx: ToolContext, streets: readonly MapStreet[]) {
  const doc = ctx.session().doc, cell = citySpec(doc).cellM;
  return streets.flatMap((s) => streetBridges(s, doc.height, cell).map((b) => ({ street: s.id, ...(s.name && { street_name: s.name }), kind: b.kind === "ford" ? "ford (no bridge)" : `${b.kind} bridge`, length_m: Math.round(b.length), from: b.points[0].map(Math.round), to: b.points[b.points.length - 1].map(Math.round) })));
}
const Bridge = z.enum(["auto", "stone", "wood", "none"]).optional().describe(
  "Where it crosses water (ground painted shallow or deep water) it becomes a bridge, by itself: auto (the default) is stone for avenues and streets, wood for lanes, alleys and paths; none is a ford");

const bbox = (b: { points: [number, number][] }) => pointsBounds(b.points);
const centreOf = (b: { points: [number, number][] }) => polygonCentroid(b.points);
const inRegion = (b: { points: [number, number][] }, r: Rect) => { const [cx, cy] = centreOf(b); return cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h; };

function describeBuilding(b: MapBuilding) {
  const bb = bbox(b), [cx, cy] = centreOf(b);
  return { id: b.id, ...(b.name && { name: b.name }), ...(b.kind && { kind: b.kind }), ...(b.roof && { roof: b.roof }), ...(b.asset && { roof_picture: b.asset.split("/").pop() }), at: [round(cx), round(cy)], size: [round(bb.x1 - bb.x0), round(bb.y1 - bb.y0)], area_m2: Math.round(polygonArea(b.points)) };
}

function toCells(s: z.infer<typeof CShape>, cell: number): Shape {
  switch (s.type) {
    case "rect": return { type: "rect", x: s.x / cell, y: s.y / cell, w: s.w / cell, h: s.h / cell };
    case "circle": return { type: "circle", x: s.x / cell, y: s.y / cell, r: s.r / cell };
    case "polygon": return { type: "polygon", points: s.points.map(([x, y]) => [x / cell, y / cell] as [number, number]) };
    case "stroke": return { type: "stroke", points: s.points.map(([x, y]) => [x / cell, y / cell] as [number, number]), r: s.r / cell };
    case "all": return { type: "all" };
  }
}

const NewBuilding = z.object({
  x: z.number().optional().describe("Centre, metres (with w and h)"), y: z.number().optional(),
  w: z.number().positive().optional().describe("Width in metres"), h: z.number().positive().optional().describe("Depth in metres"),
  angle: z.number().min(-360).max(360).optional().describe("Degrees clockwise (default 0: sides along x and y)"),
  points: z.array(Pt).min(3).max(200).optional().describe("Or the outline: three or more [x, y] corners in metres"),
  roof: Roof.optional().describe("slate (blue-grey), tile (red clay), thatch (straw) or shingle (wood). Default slate"),
  colour: Colour.optional(), flat: z.boolean().optional(),
  kind: Kind.optional(), floors: z.number().int().min(1).max(30).optional(),
  name: z.string().min(1).max(80).optional().describe("Only a name the DM gave"),
  asset: z.string().optional().describe("A roof texture for this building only: an asset id from find_roof_assets (otherwise the packs' roofs are chosen for you)"),
  tile: z.number().min(0.25).max(20).optional().describe("Metres one repeat of that picture covers"),
});

const RoofAssetsMode = z.enum(["auto", "none"]).optional().describe(
  "auto (the default): each building gets a roof picture from the asset packs that fits its roof look (tile, slate, thatch, shingle), and its roof is DRAWN only where the packs have no appropriate picture. none: draw every roof. A building with an explicit colour is drawn in that colour.");

/** An explicit roof texture (an asset id) as a choice, or an error message. */
async function explicitRoof(ctx: ToolContext, id: string): Promise<RoofChoice | string> {
  const info = await ctx.assets?.info(id);
  if (!info) return ctx.assets ? `No asset has the id "${id}". find_roof_assets lists roof textures.` : "There is no asset library set up (the DM sets it in Settings), so no roof pictures can be used.";
  return { asset: info.id, tile: roofTileMetres(info), name: info.name };
}

export const CITY_TOOLS = [
  define({
    name: "create_city",
    description:
      "Create a new city map (a city seen from above, made of buildings and streets on a ground) and open it. Sizes are in metres: a village is about 300 x 200, a walled town 1000 x 700, a big city 3000 x 2000 (at most 6000 on a side). " +
      "It starts as grass. Then use paint_ground (water, cobbles, fields), add_streets and add_buildings, and render_city to look.",
    schema: z.object({
      name: z.string().min(1).max(80),
      width_m: z.number().min(50).max(6000), height_m: z.number().min(50).max(6000),
      cell_m: z.number().min(0.5).max(32).optional().describe("Metres per ground cell (automatic by default: finer for small cities)"),
    }),
    async run(ctx, i) {
      if (!ctx.createCity) return fail("City maps can't be created here.");
      const info = await ctx.createCity({ name: i.name, widthM: i.width_m, heightM: i.height_m, cellM: i.cell_m });
      return json({ created: info, summary: citySummary(ctx) });
    },
  }),

  define({
    name: "create_city_here",
    description:
      "Start a city map from a spot on the open WORLD map and open it: a place (its name, as on the map) or a point (x, y in map pixels). The city takes the world map's climate and height above the sea there, " +
      "the lie of the land (a slope as the ground rises), and where the world map has them the sea and a beach on the coast's side, a winding river in its valley, woods in wooded country and a hill in hilly country. " +
      "Its size follows the kind of place (a capital 3000 x 2000 m, a city 2000 x 1400, a town 1000 x 700, a village 450 x 320) unless given. It remembers the spot (a way back to the world map). " +
      "A world-map pixel is a kilometre or more, so this is a rough start: say what it took from the world map, then shape it (shape_land, paint_ground) with the DM. Refused at sea.",
    schema: z.object({
      place: z.string().min(1).max(80).optional().describe("A place on the open world map, by its name"),
      x: z.number().optional(), y: z.number().optional(),
      name: z.string().min(1).max(80).optional().describe("The city map's name (default: the place's)"),
      width_m: z.number().min(50).max(6000).optional(), height_m: z.number().min(50).max(6000).optional(),
    }),
    async run(ctx, i) {
      if (!ctx.createCityHere) return fail("Cities can't be started from a world map here.");
      let doc;
      try { doc = ctx.session().doc; } catch { return fail("Open a world map first."); }
      let x = i.x, y = i.y, place: string | undefined;
      if (i.place) {
        const q = i.place.trim().toLowerCase(), p = doc.features?.places.find((pl) => pl.name.toLowerCase() === q);
        if (!p) return fail(`No place called "${i.place}" on this map. list_places lists them.`);
        x = p.x; y = p.y; place = p.name;
      }
      if (x === undefined || y === undefined) return fail("Give a place (its name) or a point (x and y in map pixels).");
      try {
        const info = await ctx.createCityHere({ name: i.name ?? place ?? "", x, y, widthM: i.width_m, heightM: i.height_m, place });
        return json({ created: info, summary: citySummary(ctx) });
      } catch (e) { return fail((e as Error).message); }
    },
  }),

  define({
    name: "read_picture_buildings",
    description:
      "Read buildings out of the city's trace picture (a found city map laid over it with set_trace_picture and lined up), by roof colour: give where one roof of each kind is (x, y in metres, read off render_city with trace: true, " +
      "and the roof look its buildings get), where the ground between them is (one or more points: it tells roofs from ground of a similar colour, and a paved square from a slate roof), and the area to read. " +
      "Without add it shows what it would add (a picture with the found outlines in cyan) and counts them; check it, adjust (more ground points, another tolerance), then call again with add: true " +
      "(one edit, one undo step; roofs from the asset packs as add_buildings does). Buildings already on the map are left out. Expect some to fix by hand: say how many it found and that they come from the picture.",
    schema: z.object({
      roofs: z.array(z.object({ x: z.number(), y: z.number(), roof: Roof })).min(1).max(12).describe("One point on a roof of each kind, metres"),
      ground: z.array(Pt).max(12).optional().describe("Points on the ground between the roofs (and on squares or roads a roof's colour), metres"),
      area: z.union([Metres, z.array(Pt).min(3).max(100)]).optional().describe("A rectangle or an outline (metres) to read; default the whole picture"),
      tolerance: z.number().min(0).max(1).optional().describe("0 strict .. 1 loose (default 0.5): looser finds more, and more that isn't a roof"),
      min_area_m2: z.number().min(1).max(500).optional().describe("Default 10"), max_area_m2: z.number().min(50).max(20000).optional().describe("Default 3000"),
      add: z.boolean().optional(), roof_assets: RoofAssetsMode,
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      if (!ctx.readCityPicture) return fail("The picture reader isn't available here.");
      const area = !i.area ? undefined : Array.isArray(i.area) ? (i.area as [number, number][]) : ([[i.area.x, i.area.y], [i.area.x + i.area.w, i.area.y], [i.area.x + i.area.w, i.area.y + i.area.h], [i.area.x, i.area.y + i.area.h]] as [number, number][]);
      let res;
      try {
        res = await ctx.readCityPicture({ area, roofs: i.roofs.map((r) => ({ x: r.x, y: r.y, look: r.roof as MapBuilding["roof"] & string })), ground: i.ground as [number, number][] | undefined, tolerance: i.tolerance, minAreaM2: i.min_area_m2, maxAreaM2: i.max_area_m2 });
      } catch (e) { return fail((e as Error).message); }
      const counts = { found: res.buildings.length, already_on_the_map: res.alreadyThere, skipped_too_small: res.skipped.small, skipped_too_large: res.skipped.large, by_look: Object.fromEntries(ROOF_STYLES.map((s) => [s, res.buildings.filter((b) => b.look === s).length]).filter(([, n]) => n)) };
      if (!i.add) {
        // the picture: the area (or the whole city) with the trace picture half see-through and the found outlines in cyan
        const doc = ctx.session().doc, sp = citySpec(doc);
        const bb = area ? pointsBounds(area) : { x0: 0, y0: 0, x1: sp.widthM, y1: sp.heightM };
        const r = renderCity(doc, { region: { x: bb.x0, y: bb.y0, w: Math.max(10, bb.x1 - bb.x0), h: Math.max(10, bb.y1 - bb.y0) }, maxSize: 1200 });
        await traceOverlay(ctx, r.img, { x: Math.round(r.region.x * r.px), y: Math.round(r.region.y * r.px) }, 1, r.px);
        const d = r.img.data, Wp = r.img.w, Hp = r.img.h;
        const dot = (x: number, y: number) => { const X = Math.round(x), Y = Math.round(y); if (X < 0 || Y < 0 || X >= Wp || Y >= Hp) return; const o = (Y * Wp + X) * 4; d[o] = 0; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 255; };
        for (const b of res.buildings) for (let k = 0; k < b.points.length; k++) {
          const [ax, ay] = b.points[k], [bx, by] = b.points[(k + 1) % b.points.length];
          const x0 = (ax - r.region.x) * r.px, y0 = (ay - r.region.y) * r.px, x1 = (bx - r.region.x) * r.px, y1 = (by - r.region.y) * r.px, n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
          for (let s = 0; s <= n; s++) dot(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n);
        }
        const step = drawGrid(r.img, r.region, r.px);
        const jpg = encodeJpeg(r.img);
        const display = ctx.savePreview ? [await ctx.savePreview(jpg)] : undefined;
        return { content: [{ type: "text", text: JSON.stringify({ ...counts, preview: `the found outlines in cyan over the trace picture; grid every ${step} m`, next: "add: true adds them (one edit)" }, null, 1) }, { type: "image", mediaType: "image/jpeg", data: toBase64(jpg) }], display };
      }
      if (!res.buildings.length) return fail(`Nothing to add: ${JSON.stringify(counts)}. Check the roof points (render_city with trace: true), add ground points, or loosen the tolerance.`);
      const sp = citySpec(ctx.session().doc), pools = ctx.roofPools?.() ?? null, mode = i.roof_assets ?? "auto", added: MapBuilding[] = [];
      for (const b of res.buildings) {
        const id = newFeatureId("b"), pic = mode === "auto" ? chooseRoof(pools, b.look, id) : null;
        const c = cleanBuilding({ id, points: b.points, roof: b.look, kind: "house", ...(pic && { asset: pic.asset, tile: pic.tile }) }, sp);
        if (!("error" in c)) added.push(c);
      }
      const r = ctx.execute({ op: "features", patch: { upsertBuildings: added } }, `Read ${added.length} buildings from the picture`);
      return json({ change: r.seq, added: added.length, ...counts, note: "Read from the picture: some may need fixing by hand (merged neighbours, a yard read as a roof). check_city finds overlaps." });
    },
  }),

  define({
    name: "render_city",
    description:
      "Render the city (or a part of it, in metres) to an image so you can see it, with a labelled grid in metres. Use after edits, and a region with a larger max_size to inspect detail. " +
      "trace: true draws the trace picture (get_trace_picture) half see-through over it, to compare or redraw from.",
    schema: z.object({
      region: Metres.optional().describe("Crop in metres; omit for the whole city"),
      max_size: z.number().int().min(256).max(1568).optional().describe("Longest side of the image in px (default 1200)"),
      grid: z.boolean().optional().describe("Draw the labelled grid (default true)"),
      buildings: z.boolean().optional().describe("Draw the buildings (default true; false shows the ground and streets alone)"),
      contours: z.boolean().optional().describe("Draw the contour lines (default true when the city has any land; every fifth line is darker)"),
      trees: z.boolean().optional().describe("Draw the trees (default true)"),
      trace: z.boolean().optional(),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const doc = ctx.session().doc;
      const tiles = (await ctx.cityTiles?.()) ?? {};
      const r = renderCity(doc, { region: i.region, maxSize: i.max_size ?? 1200, buildings: i.buildings, contours: i.contours, trees: i.trees, tileFor: (a) => tiles[a] ?? null });
      const traced = i.trace ? await traceOverlay(ctx, r.img, { x: Math.round(r.region.x * r.px), y: Math.round(r.region.y * r.px) }, 1, r.px) : "";
      const step = i.grid === false ? null : drawGrid(r.img, r.region, r.px);
      const jpg = encodeJpeg(r.img);
      const display = ctx.savePreview ? [await ctx.savePreview(jpg)] : undefined;
      const sp = citySpec(doc);
      const note = `City ${sp.widthM} x ${sp.heightM} m, ${i.region ? `region x${Math.round(r.region.x)} y${Math.round(r.region.y)} ${Math.round(r.region.w)}x${Math.round(r.region.h)} m` : "whole city"}; image ${r.img.w}x${r.img.h}` +
        (step ? `, grid every ${step} m (numbers are metres)` : "") + traced + `. ${featuresOf(ctx).buildings?.length ?? 0} buildings. Change #${ctx.session().seq}.`;
      return { content: [{ type: "text", text: note }, { type: "image", mediaType: "image/jpeg", data: toBase64(jpg) }], display };
    },
  }),

  define({
    name: "find_roof_assets",
    description:
      "List the roof textures of the DM's asset packs (pictures meant to be tiled across a roof), by roof look: tile, slate, thatch or shingle. add_buildings uses these automatically, and draws a roof only where there is none for the look; " +
      "use this to see what there is, to pick one by name (the id goes in add_buildings' roof_asset or a building's asset), or to say there is nothing for a look. match words prefer names that say so (red, mossy, dark).",
    schema: z.object({
      look: Roof.optional().describe("Only this roof look"),
      match: z.string().max(60).optional().describe("Words the names should have"),
      limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
    }),
    async run(ctx, i) {
      const pools = ctx.roofPools?.();
      if (!pools) return text("No asset library is set up (the DM chooses the assets folder in Settings), so every roof is drawn.");
      const looks = i.look ? [i.look as keyof typeof pools] : (ROOF_STYLES as readonly (keyof typeof pools)[]);
      const counts = Object.fromEntries(ROOF_STYLES.map((s) => [s, pools[s].length]));
      // (what a default pick would choose first; asking by match words reaches the rest: purple tiles, snowy roofs, colourable ones)
      const items = looks.flatMap((l) => fittingRoofAssets(pools[l], l, i.match).map((a) => ({ look: l, a })));
      const lim = i.limit ?? 30;
      return json({
        textures_by_look: counts, matching: items.length,
        roofs: items.slice(0, lim).map(({ look, a }) => ({ id: a.id, look, name: a.name, pack: a.packName, tile_m: roofTileMetres(a) })),
        ...(Object.values(counts).some((n) => n === 0) && { no_texture_for: ROOF_STYLES.filter((s) => !counts[s]) }),
      });
    },
  }),

  define({
    name: "paint_ground",
    description:
      `Set the ground material inside a shape (metres): ${MATERIALS.filter((m) => m.id > 0).map((m) => m.name).join(", ")}. Use it for water (deep water, shallow water), parks and fields (grass, forest floor), plazas and paved areas (cobblestone, flagstone), ` +
      "dirt, sand, rock. The ground is painted in coarse cells (get_map_summary says how coarse), so streets and buildings are drawn over it, not painted into it.",
    schema: z.object({ shape: CShape, material: z.string().min(1).max(40) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const m = materialByName(i.material);
      const id = m ? cityGroundMaterial(m.id) : null;
      if (!m || id === null) return fail(`Unknown ground "${i.material}". Choose from: ${MATERIALS.filter((x) => x.id > 0).map((x) => x.name).join(", ")}.`);
      const sp = citySpec(ctx.session().doc);
      const r = ctx.execute({ op: "paint_floor", params: { shape: toCells(i.shape, sp.cellM), material: id } }, `Paint ${m.name}`);
      return json({ change: r.seq, painted: m.name });
    },
  }),

  define({
    name: "add_buildings",
    description:
      "Add buildings, many at once (up to 500 per call: one edit, one undo step). Each is a rectangle (x, y the CENTRE in metres, w, h its size, angle in degrees clockwise) or an outline (points: corners in metres). " +
      "A house is about 6 x 8 m, a shop 8 x 10, a tavern 12 x 15, a barn 10 x 20, a temple 20 x 30. Drawn as a roof seen from above: roof is slate, tile, thatch or shingle; with no colour each gets a slightly different shade. " +
      "Roofs come from the asset packs first: each building gets a roof texture that fits its roof look, and a roof is drawn only where the packs have no appropriate one (roof_assets: none draws them all; roof_asset sets one texture for every building; roof_match prefers pictures whose names say so, such as \"red\" or \"mossy\"; find_roof_assets shows what there is). " +
      "Buildings along a street: turn them to the street's direction (angle). Invalid ones are skipped and reported. Names only if the DM gave them. Render with render_city to check.",
    schema: z.object({
      buildings: z.array(NewBuilding).min(1).max(500),
      roof_assets: RoofAssetsMode,
      roof_asset: z.string().optional().describe("One roof texture (asset id from find_roof_assets) for every building of this call"),
      roof_match: z.string().max(60).optional().describe("Words the roof pictures' names should have: red, mossy, dark, black..."),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc);
      const pools = ctx.roofPools?.() ?? null, mode = i.roof_assets ?? "auto";
      let forced: RoofChoice | null = null;
      if (i.roof_asset) { const e = await explicitRoof(ctx, i.roof_asset); if (typeof e === "string") return fail(e); forced = e; }
      const own = new Map<string, RoofChoice | string>();
      for (const a of new Set(i.buildings.map((b) => b.asset).filter((a): a is string => !!a))) own.set(a, await explicitRoof(ctx, a));
      const added: MapBuilding[] = [], errors: string[] = [], missing = new Set<string>();
      let pictured = 0;
      i.buildings.forEach((b, n) => {
        let points: [number, number][];
        if (b.points) points = b.points as [number, number][];
        else if (b.x !== undefined && b.y !== undefined && b.w && b.h) points = rectPolygon(b.x, b.y, b.w, b.h, b.angle ?? 0);
        else { errors.push(`#${n + 1}: give x, y, w and h, or points`); return; }
        const id = newFeatureId("b"), look = (b.roof ?? "slate") as MapBuilding["roof"] & string;
        // the roof: a picture of the packs whenever an appropriate one exists, the look drawn only when none does
        let pic: RoofChoice | null = null;
        const mine = b.asset ? own.get(b.asset) : undefined;
        if (typeof mine === "string") { errors.push(`#${n + 1}: ${mine}`); return; }
        if (mine) pic = { ...mine, ...(b.tile && { tile: b.tile }) };
        else if (forced) pic = forced;
        else if (mode === "auto" && !b.colour) { pic = chooseRoof(pools, look, id, i.roof_match); if (!pic && pools) missing.add(look); }
        const c = cleanBuilding({ id, points, roof: b.roof, colour: b.colour, flat: b.flat, kind: b.kind, floors: b.floors, name: b.name, ...(pic && { asset: pic.asset, tile: pic.tile }) }, sp);
        if ("error" in c) errors.push(`#${n + 1}: ${c.error.replace(/^building [^ ]+ /, "")}`);
        else { added.push(c); if (c.asset) pictured++; }
      });
      if (!added.length) return fail(`Nothing was added. ${errors.slice(0, 8).join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertBuildings: added } }, `Add ${added.length} building${added.length === 1 ? "" : "s"}`);
      return json({
        change: r.seq, added: added.length, ids: added.length <= 40 ? added.map((b) => b.id) : `${added[0].id} … ${added[added.length - 1].id} (${added.length}; list_buildings finds them)`,
        roofs: { from_asset_packs: pictured, drawn: added.length - pictured, ...(missing.size && { no_asset_for_look: [...missing] }), ...(!pools && mode === "auto" && !forced && { note: "No asset library is set up, so every roof is drawn." }) },
        skipped: errors.length, ...(errors.length && { errors: errors.slice(0, 10) }),
      });
    },
  }),

  define({
    name: "update_buildings",
    description:
      "Change buildings by id (from add_buildings or list_buildings, up to 500): the same roof, colour, flat, kind or floors for all of them (colour \"\" goes back to the roof look's own). name only when changing one building. " +
      "Changing the roof look gives a building that has a roof picture a new picture that fits the new look (or draws the look when the packs have none); roof_asset: auto picks pictures for these buildings, none draws their look, or an asset id sets one. " +
      "A colour draws the roof in that colour (it replaces a picture) unless roof_asset says otherwise. To move or reshape a building, remove it and add it again.",
    schema: z.object({
      ids: z.array(z.string()).min(1).max(500),
      roof: Roof.optional(), colour: z.union([Colour, z.literal("")]).optional(), flat: z.boolean().optional(),
      kind: Kind.optional(), floors: z.number().int().min(1).max(30).optional(),
      name: z.string().max(80).optional().describe("One building only; an empty string removes the name"),
      roof_asset: z.string().optional().describe("auto, none, or a roof texture's asset id (from find_roof_assets)"),
      roof_match: z.string().max(60).optional().describe("With auto: words the roof pictures' names should have"),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      if (i.name !== undefined && i.ids.length !== 1) return fail("name can only be set on one building at a time.");
      const byId = new Map((featuresOf(ctx).buildings ?? []).map((b) => [b.id, b]));
      const out: MapBuilding[] = [], missing: string[] = [];
      const pools = ctx.roofPools?.() ?? null, mode = i.roof_asset;
      let forced: RoofChoice | null = null;
      if (mode && mode !== "auto" && mode !== "none") { const e = await explicitRoof(ctx, mode); if (typeof e === "string") return fail(e); forced = e; }
      let pictured = 0;
      for (const id of i.ids) {
        const b = byId.get(id);
        if (!b) { missing.push(id); continue; }
        const n: MapBuilding = { ...b };
        if (i.roof) n.roof = i.roof as MapBuilding["roof"];
        if (i.colour !== undefined) { if (i.colour === "") delete n.colour; else n.colour = `#${i.colour.replace("#", "").toLowerCase()}`; }
        // the roof picture: set, chosen again for a new look, or taken off (a colour draws the roof in that colour)
        if (mode === "none" || (i.colour && !mode)) { delete n.asset; delete n.tile; }
        else if (forced) { n.asset = forced.asset; n.tile = forced.tile; }
        else if (mode === "auto" || (i.roof && n.asset)) {
          const pic = n.colour && !mode ? null : chooseRoof(pools, n.roof ?? "slate", n.id, i.roof_match);
          if (pic) { n.asset = pic.asset; n.tile = pic.tile; } else { delete n.asset; delete n.tile; }
        }
        if (n.asset) pictured++;
        if (i.flat !== undefined) { if (i.flat) n.flat = true; else delete n.flat; }
        if (i.kind) n.kind = i.kind as MapBuilding["kind"];
        if (i.floors) n.floors = i.floors;
        if (i.name !== undefined) { if (i.name.trim()) n.name = i.name.trim(); else delete n.name; }
        out.push(n);
      }
      if (!out.length) return fail(`No such building: ${missing.slice(0, 5).join(", ")}. list_buildings finds ids.`);
      const r = ctx.execute({ op: "features", patch: { upsertBuildings: out } }, `Change ${out.length} building${out.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, changed: out.length, roofs_with_picture: pictured, ...(missing.length && { not_found: missing.slice(0, 10) }) });
    },
  }),

  define({
    name: "remove_buildings",
    description: "Remove buildings by id, or every building whose centre is inside a region (metres). One edit; Undo brings them back. Only when the DM asks.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(2000).optional(), region: Metres.optional() }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      if ((!i.ids && !i.region) || (i.ids && i.region)) return fail("Give either ids or a region, not both and not neither.");
      const all = featuresOf(ctx).buildings ?? [];
      const ids = i.ids ? i.ids.filter((id) => all.some((b) => b.id === id)) : all.filter((b) => inRegion(b, i.region!)).map((b) => b.id);
      if (!ids.length) return text("No building matched; nothing was removed.");
      const r = ctx.execute({ op: "features", patch: { removeBuildings: ids } }, `Remove ${ids.length} building${ids.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, removed: ids.length });
    },
  }),

  define({
    name: "list_buildings",
    description: "List buildings (id, kind, name, roof, centre, size), a page at a time (a city has thousands): filter by region (metres), kind or part of a name. Says how many match in all.",
    schema: z.object({
      region: Metres.optional(), kind: Kind.optional(), name_contains: z.string().optional(),
      limit: z.number().int().min(1).max(300).optional().describe("Default 60"), offset: z.number().int().min(0).optional(),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const q = i.name_contains?.toLowerCase();
      const hits = (featuresOf(ctx).buildings ?? []).filter((b) => (!i.region || inRegion(b, i.region)) && (!i.kind || b.kind === i.kind) && (!q || (b.name ?? "").toLowerCase().includes(q)));
      const off = i.offset ?? 0, lim = i.limit ?? 60;
      return json({ matching: hits.length, shown: Math.min(lim, Math.max(0, hits.length - off)), offset: off, buildings: hits.slice(off, off + lim).map(describeBuilding) });
    },
  }),

  define({
    name: "add_streets",
    description:
      "Add streets, lanes and paths (up to 200 per call, one edit): each a line through points (metres) with a width (metres; by kind if omitted: avenue 12, street 7, lane 4, alley 2, path 1.5). " +
      "Streets are drawn over the ground and under the buildings; give the corners of a curve as several points. A name only if the DM gave one. " +
      "Where a street crosses water it becomes a bridge by itself (the result lists them): cross a river where it is narrow and the banks are firm, square to the water, and keep long bridges for the main roads.",
    schema: z.object({
      streets: z.array(z.object({
        points: z.array(Pt).min(2).max(200), width: z.number().min(0.5).max(60).optional(),
        kind: z.enum(STREET_KINDS.map((k) => k.id) as [string, ...string[]]).optional(), name: z.string().min(1).max(80).optional(), bridge: Bridge,
      })).min(1).max(200),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc);
      const added: MapStreet[] = [], errors: string[] = [];
      i.streets.forEach((s, n) => {
        const c = cleanStreet({ id: newFeatureId("t"), points: s.points, width: s.width ?? streetWidthFor(s.kind), kind: s.kind, name: s.name, ...(s.bridge && s.bridge !== "auto" && { bridge: s.bridge }) }, sp);
        if ("error" in c) errors.push(`#${n + 1}: ${c.error.replace(/^street [^ ]+ /, "")}`); else added.push(c);
      });
      if (!added.length) return fail(`Nothing was added. ${errors.slice(0, 8).join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertStreets: added } }, `Add ${added.length} street${added.length === 1 ? "" : "s"}`);
      const bridges = bridgesOf(ctx, added);
      return json({ change: r.seq, added: added.length, ids: added.map((s) => s.id), skipped: errors.length, ...(errors.length && { errors: errors.slice(0, 10) }), ...(bridges.length && { bridges }) });
    },
  }),

  define({
    name: "update_streets",
    description: "Change streets by id (from list_streets): name, kind (sets the width that goes with it unless width is given), width, or bridge (what it becomes where it crosses water). One edit.",
    schema: z.object({
      changes: z.array(z.object({
        id: z.string(), name: z.string().max(80).optional().describe("Only a name the DM gave; empty removes it"), kind: z.enum(STREET_KINDS.map((k) => k.id) as [string, ...string[]]).optional(),
        width: z.number().min(0.5).max(60).optional(), bridge: Bridge,
      })).min(1).max(200),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), by = new Map((featuresOf(ctx).streets ?? []).map((s) => [s.id, s]));
      const out: MapStreet[] = [], skipped: string[] = [];
      for (const ch of i.changes) {
        const cur = by.get(ch.id);
        if (!cur) { skipped.push(`${ch.id}: no such street`); continue; }
        const { bridge: _b, name: _n, ...rest } = cur;
        const bridge = ch.bridge === undefined ? cur.bridge : ch.bridge === "auto" ? undefined : ch.bridge, name = ch.name === undefined ? cur.name : ch.name || undefined;
        const c = cleanStreet({ ...rest, ...(ch.kind && { kind: ch.kind, width: streetWidthFor(ch.kind) }), ...(ch.width !== undefined && { width: ch.width }), ...(bridge && { bridge }), ...(name && { name }) }, sp);
        if ("error" in c) skipped.push(c.error); else out.push(c);
      }
      if (!out.length) return fail(`Nothing changed. ${skipped.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertStreets: out } }, out.length === 1 ? `Change ${out[0].name ?? out[0].kind ?? "street"}` : `Change ${out.length} streets`);
      const bridges = bridgesOf(ctx, out);
      return json({ change: r.seq, changed: out.length, ...(skipped.length && { skipped }), ...(bridges.length && { bridges }) });
    },
  }),

  define({
    name: "list_streets",
    description: "List the streets (id, kind, name, width, length, first and last point, and their bridges).",
    schema: z.object({ limit: z.number().int().min(1).max(300).optional(), offset: z.number().int().min(0).optional() }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const all = featuresOf(ctx).streets ?? [], off = i.offset ?? 0, lim = i.limit ?? 100;
      const len = (s: MapStreet) => s.points.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - s.points[k][0], p[1] - s.points[k][1]), 0);
      return json({ total: all.length, offset: off, streets: all.slice(off, off + lim).map((s) => ({ id: s.id, ...(s.kind && { kind: s.kind }), ...(s.name && { name: s.name }), width: s.width, length_m: Math.round(len(s)), from: s.points[0], to: s.points[s.points.length - 1], ...(s.bridge && { bridge_setting: s.bridge }), ...((() => { const b = bridgesOf(ctx, [s]); return b.length ? { bridges: b.map(({ kind, length_m }) => ({ kind, length_m })) } : {}; })()) })) });
    },
  }),

  define({
    name: "remove_streets",
    description: "Remove streets by id (from add_streets or list_streets). One edit; Undo brings them back. Only when the DM asks.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(500) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const have = new Set((featuresOf(ctx).streets ?? []).map((s) => s.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return text("No street matched; nothing was removed.");
      const r = ctx.execute({ op: "features", patch: { removeStreets: ids } }, `Remove ${ids.length} street${ids.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, removed: ids.length });
    },
  }),
];

/** The names of the tools above, for keeping them off other kinds of map. */
export const CITY_TOOL_NAMES: string[] = CITY_TOOLS.map((t) => t.name);
