/**
 * Claude's tools for city maps: a city seen from above, made of buildings and streets on a ground, in METRES from the map's top-left corner. Buildings and streets go in in
 * batches (one edit, one undo step); a city has thousands of buildings, so nothing here sends them all back: lists are paged and previews show the picture.
 */
import { z } from "zod";
import {
  BUILDING_KINDS, MATERIALS, type MapBuilding, type MapStreet, type Rect, type RoofChoice, type Shape, ROOF_STYLES, STREET_KINDS, chooseRoof, citySpec, cityGroundMaterial, cleanBuilding, cleanStreet,
  drawGrid, fittingRoofAssets, isCity, materialByName, newFeatureId, pointsBounds, polygonArea, polygonCentroid, rectPolygon, renderCity, roofTileMetres, streetWidthFor,
} from "@mapmaker/core";
import { encodeJpeg, toBase64 } from "./images.ts";
import { traceOverlay } from "./traceTools.ts";
import { landSummary } from "./cityLandTools.ts";
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
    buildings: (f.buildings ?? []).length, buildings_by_kind: kinds, streets: (f.streets ?? []).length,
    roofs_from_asset_packs: (f.buildings ?? []).filter((b) => b.asset).length, roof_textures_available: ctx.roofPools?.() ? Object.fromEntries(ROOF_STYLES.map((s) => [s, ctx.roofPools!()![s].length])) : "no asset library is set up",
    trace_picture: f.trace?.ref ?? null, latest_change: ctx.session().seq,
    land: landSummary(ctx),
    note: "Coordinates are metres from the top-left corner. render_city looks at it; shape_land, set_city_climate, paint_ground, add_streets, add_buildings and add_trees build it.",
  };
}

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
      "Streets are drawn over the ground and under the buildings; give the corners of a curve as several points. A name only if the DM gave one.",
    schema: z.object({
      streets: z.array(z.object({
        points: z.array(Pt).min(2).max(200), width: z.number().min(0.5).max(60).optional(),
        kind: z.enum(STREET_KINDS.map((k) => k.id) as [string, ...string[]]).optional(), name: z.string().min(1).max(80).optional(),
      })).min(1).max(200),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc);
      const added: MapStreet[] = [], errors: string[] = [];
      i.streets.forEach((s, n) => {
        const c = cleanStreet({ id: newFeatureId("t"), points: s.points, width: s.width ?? streetWidthFor(s.kind), kind: s.kind, name: s.name }, sp);
        if ("error" in c) errors.push(`#${n + 1}: ${c.error.replace(/^street [^ ]+ /, "")}`); else added.push(c);
      });
      if (!added.length) return fail(`Nothing was added. ${errors.slice(0, 8).join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertStreets: added } }, `Add ${added.length} street${added.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, added: added.length, ids: added.map((s) => s.id), skipped: errors.length, ...(errors.length && { errors: errors.slice(0, 10) }) });
    },
  }),

  define({
    name: "list_streets",
    description: "List the streets (id, kind, name, width, length, first and last point).",
    schema: z.object({ limit: z.number().int().min(1).max(300).optional(), offset: z.number().int().min(0).optional() }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const all = featuresOf(ctx).streets ?? [], off = i.offset ?? 0, lim = i.limit ?? 100;
      const len = (s: MapStreet) => s.points.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - s.points[k][0], p[1] - s.points[k][1]), 0);
      return json({ total: all.length, offset: off, streets: all.slice(off, off + lim).map((s) => ({ id: s.id, ...(s.kind && { kind: s.kind }), ...(s.name && { name: s.name }), width: s.width, length_m: Math.round(len(s)), from: s.points[0], to: s.points[s.points.length - 1] })) });
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
