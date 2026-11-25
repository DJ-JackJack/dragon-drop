/**
 * Claude's tools for a city's land, climate and trees (core cityLand.ts). The land is shapes (hills, ridges and valleys, plateaus, slopes) that add up to the heights; the climate
 * colours the ground, brings snow or dust and picks the kinds of tree; trees come in woods, orchards, scattered groups, rows and single trees. Every call is one edit and one undo step.
 */
import { z } from "zod";
import {
  CITY_CLIMATES, type MapLandform, type MapTrees, STEEP_PERCENT, TREE_GROUPS, TREE_SPECIES, citySpec, cityClimate, cleanClimate, cleanLandform, cleanTrees, climatePreset,
  climateTrees, isCity, landAt, landGrid, newFeatureId, pointsBounds, snowCover, cleanGroundColours, GROUND_COLOUR_MATERIALS, groundMaterialId,
} from "@mapmaker/core";
import type { ToolContext, ToolResult } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

const Pt = z.tuple([z.number(), z.number()]);
const round = (n: number) => Math.round(n * 10) / 10;

function needCity(ctx: ToolContext): ToolResult | null {
  return isCity(ctx.session().doc) ? null : fail("This tool is for city maps, and the open project isn't one. create_city makes one; open_project switches to one.");
}
const featuresOf = (ctx: ToolContext) => ctx.session().doc.features ?? { places: [], labels: [] };

/** The land in a few numbers: how high and low it goes, and how much of the city is too steep to build on easily. */
export function landSummary(ctx: ToolContext) {
  const doc = ctx.session().doc, sp = citySpec(doc), g = landGrid(doc), base = sp.elevation ?? 0;
  const climate = cityClimate(sp), preset = climatePreset(climate);
  const out: Record<string, unknown> = {
    elevation_m: base,
    climate: { ...(preset ? { preset } : {}), temperature: climate.temperature, moisture: climate.moisture, ...(snowCover(climate) > 0 && { snow: `${Math.round(snowCover(climate) * 100)}% of open ground` }), trees_grow: climateTrees(climate).map(([s, w]) => `${s} ${Math.round(w * 100)}%`).join(", ") },
    landforms: (featuresOf(ctx).land ?? []).length, tree_groups: (featuresOf(ctx).trees ?? []).length,
    ...(sp.ground && Object.keys(sp.ground).length && { own_ground_colours: sp.ground }),
  };
  if (g) {
    let steep = 0, n = 0;
    for (let y = 1; y + 1 < g.h; y += 3) for (let x = 1; x + 1 < g.w; x += 3) {
      const gx = (g.data[y * g.w + x + 1] - g.data[y * g.w + x - 1]) / (2 * g.cellM), gy = (g.data[(y + 1) * g.w + x] - g.data[(y - 1) * g.w + x]) / (2 * g.cellM);
      if (Math.hypot(gx, gy) * 100 > STEEP_PERCENT) steep++;
      n++;
    }
    out.height_range_m = [round(base + g.min), round(base + g.max)];
    out.too_steep_to_build_percent = n ? Math.round((steep / n) * 100) : 0;
  } else out.land = "flat (no landforms yet)";
  return out;
}

function describeLand(l: MapLandform) {
  const b = pointsBounds(l.points);
  return {
    id: l.id, kind: l.kind === "ridge" && l.height < 0 ? "valley" : l.kind === "plateau" && l.height < 0 ? "hollow" : l.kind, ...(l.name && { name: l.name }), height_m: l.height,
    ...(l.kind !== "slope" && { [l.kind === "hill" ? "radius_m" : l.kind === "ridge" ? "half_width_m" : "soft_edge_m"]: l.radius }),
    ...(l.kind === "hill" ? { top: l.points[0] } : l.kind === "slope" ? { from_low: l.points[0], to_high: l.points[1] } : { points: l.points.length, spans: [round(b.x0), round(b.y0), round(b.x1), round(b.y1)] }),
  };
}

const NewLandform = z.object({
  kind: z.enum(["hill", "ridge", "valley", "plateau", "hollow", "slope"]).describe(
    "hill: x, y its top and radius. ridge: points along its crest, radius half its width; valley: the same, sunk (a river's bed, a ravine). plateau: an outline raised evenly, radius the width of its soft edge; hollow: sunk. " +
    "slope: points [low, high], the whole city rising by height from the first point to the second (the land falling to the sea or a river)"),
  x: z.number().optional(), y: z.number().optional(),
  points: z.array(Pt).min(1).max(200).optional(),
  height: z.number().min(0.1).max(1500).describe("Metres: how much higher the top is than the land around it (or how deep a valley or hollow is). A town's hill is 10-40 m, a castle mound 15-25, a river valley 5-20 deep, a coastal slope 10-60"),
  radius: z.number().min(1).max(10000).optional().describe("Metres (not needed for a slope)"),
  name: z.string().min(1).max(80).optional().describe("Only a name the DM gave"),
});

const NewTrees = z.object({
  kind: z.enum(TREE_GROUPS as unknown as [string, ...string[]]).describe("wood (dense), orchard (in rows), scattered (a few, with space between), row (along a line: an avenue or hedgerow), tree (one)"),
  points: z.array(Pt).min(1).max(200).describe("An outline for wood, orchard and scattered; a line for row; one point for tree. Metres"),
  size: z.number().min(1).max(40).optional().describe("Crown across in metres (default: 7 in a wood, 5 in an orchard, 8 for a single tree)"),
  species: z.enum(TREE_SPECIES as unknown as [string, ...string[]]).optional().describe("Only to override the climate's mix (e.g. cypress along a cemetery path)"),
  name: z.string().min(1).max(80).optional(),
});

export const CITY_LAND_TOOLS = [
  define({
    name: "shape_land",
    description:
      "Shape the city's land, many shapes at once (one edit, one undo step): hills, ridges, valleys, plateaus, hollows and slopes, in metres. They add up, and the city is shaded and given contour lines from them. " +
      "Shape the land FIRST, then put water in the low ground (paint_ground: the river along a valley, the sea or lake on the low side of a slope), then the streets and buildings, " +
      "which follow it: main streets along the valleys and contours or straight up only where it is gentle, the castle or temple on the high ground, the docks on the water. land_at tells the height and steepness at points.",
    schema: z.object({ landforms: z.array(NewLandform).min(1).max(100) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), added: MapLandform[] = [], skipped: string[] = [];
      i.landforms.forEach((l, n) => {
        const kind = l.kind === "valley" ? "ridge" : l.kind === "hollow" ? "plateau" : l.kind;
        const points = l.points ?? (l.x !== undefined && l.y !== undefined ? [[l.x, l.y] as [number, number]] : undefined);
        const height = l.kind === "valley" || l.kind === "hollow" ? -l.height : l.height;
        const c = cleanLandform({ id: newFeatureId("h"), kind, points, height, radius: l.radius, name: l.name }, sp);
        if ("error" in c) skipped.push(`#${n + 1}: ${c.error}`);
        else added.push(c);
      });
      if (!added.length) return fail(`Nothing added. ${skipped.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertLand: added } }, added.length === 1 ? `Add ${describeLand(added[0]).kind}` : `Shape the land (${added.length})`);
      return json({ change: r.seq, added: added.map(describeLand), ...(skipped.length && { skipped }), land: landSummary(ctx) });
    },
  }),

  define({
    name: "update_land",
    description: "Change landforms by id (from list_land): height (negative sinks a ridge into a valley), radius, points or name. One edit.",
    schema: z.object({
      changes: z.array(z.object({ id: z.string(), height: z.number().min(-1500).max(1500).optional(), radius: z.number().min(1).max(10000).optional(), points: z.array(Pt).min(1).max(200).optional(), name: z.string().max(80).optional() })).min(1).max(100),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), by = new Map((featuresOf(ctx).land ?? []).map((l) => [l.id, l]));
      const out: MapLandform[] = [], skipped: string[] = [];
      for (const ch of i.changes) {
        const cur = by.get(ch.id);
        if (!cur) { skipped.push(`${ch.id}: no such landform`); continue; }
        const c = cleanLandform({ ...cur, ...(ch.height !== undefined && { height: ch.height }), ...(ch.radius !== undefined && { radius: ch.radius }), ...(ch.points && { points: ch.points }), ...(ch.name !== undefined && { name: ch.name || undefined }) }, sp);
        if ("error" in c) skipped.push(c.error); else out.push(c);
      }
      if (!out.length) return fail(`Nothing changed. ${skipped.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertLand: out } }, out.length === 1 ? `Change ${describeLand(out[0]).kind}` : `Change ${out.length} landforms`);
      return json({ change: r.seq, changed: out.map(describeLand), ...(skipped.length && { skipped }), land: landSummary(ctx) });
    },
  }),

  define({
    name: "remove_land",
    description: "Remove landforms by id (from list_land). One edit.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(500) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const have = new Set((featuresOf(ctx).land ?? []).map((l) => l.id)), ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids is a landform. list_land lists them.");
      const r = ctx.execute({ op: "features", patch: { removeLand: ids } }, `Remove ${ids.length} landform${ids.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, removed: ids.length, land: landSummary(ctx) });
    },
  }),

  define({
    name: "list_land",
    description: "List the city's landforms (hills, ridges, valleys, plateaus, slopes) with their ids, and the land in numbers (height range, how much is too steep to build on, the climate).",
    schema: z.object({}),
    async run(ctx) {
      const bad = needCity(ctx); if (bad) return bad;
      return json({ ...landSummary(ctx), landforms: (featuresOf(ctx).land ?? []).map(describeLand) });
    },
  }),

  define({
    name: "land_at",
    description:
      `The height above the sea (metres), how steep (percent: metres of rise per 100 m) and which way the ground falls, at up to 100 points. Over ${STEEP_PERCENT}% is too steep for ordinary streets and houses ` +
      "(only steps, terraces or a winding way up); under 5% is easy. Use it to plan: where the streets can run, where the water gathers, what is the high ground.",
    schema: z.object({ points: z.array(Pt).min(1).max(100) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const doc = ctx.session().doc;
      return json({ points: i.points.map(([x, y]) => ({ at: [x, y], ...landAt(doc, x, y) })) });
    },
  }),

  define({
    name: "set_city_climate",
    description:
      `Set the city's climate: a preset (${CITY_CLIMATES.map((c) => `${c.id}: ${c.hint.toLowerCase()}`).join("; ")}) or temperature and moisture (0 to 1, the scales of a world map's climate regions). ` +
      "It colours the grass and fields (green when wet, golden when dry, sandy in a desert), lays snow on the ground and roofs when cold, and picks the kinds of tree. elevation is the city's height above the sea. " +
      "Use what the DM said about the place; if they said nothing, ask or leave it temperate. One edit.",
    schema: z.object({
      preset: z.enum(CITY_CLIMATES.map((c) => c.id) as unknown as [string, ...string[]]).optional(),
      temperature: z.number().min(0).max(1).optional(), moisture: z.number().min(0).max(1).optional(),
      elevation: z.number().min(-500).max(9000).optional().describe("Metres above the sea of the city's ground"),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), now = cityClimate(sp), p = CITY_CLIMATES.find((c) => c.id === i.preset);
      const climate = cleanClimate({ temperature: i.temperature ?? p?.temperature ?? now.temperature, moisture: i.moisture ?? p?.moisture ?? now.moisture });
      if ("error" in climate) return fail(climate.error);
      const city = { ...sp, climate, ...(i.elevation !== undefined && { elevation: Math.round(i.elevation) }) };
      const r = ctx.execute({ op: "set_meta", patch: { city } }, `Climate: ${CITY_CLIMATES.find((c) => c.id === climatePreset(climate))?.name ?? "own"}`);
      return json({ change: r.seq, land: landSummary(ctx) });
    },
  }),

  define({
    name: "set_ground_colours",
    description:
      "Give the settlement's ground its own colours instead of the ones its climate makes: by kind of ground (" + GROUND_COLOUR_MATERIALS.map((m) => m.name).join(", ") + "). " +
      "from_picture: true takes each painted kind's colour from the trace picture (measured under open ground of that kind: not under buildings, streets, walls or woods), " +
      "which is what a redraw of a found map wants once the ground is painted (only: just these kinds). colours sets them by hand (\"#rrggbb\"); reset gives the named kinds (or \"all\") back to the climate. One edit.",
    schema: z.object({
      from_picture: z.boolean().optional(),
      only: z.array(z.string()).optional().describe("With from_picture: only these kinds of ground"),
      colours: z.record(z.string(), z.string()).optional().describe("A kind of ground to \"#rrggbb\""),
      reset: z.union([z.literal("all"), z.array(z.string())]).optional(),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      if (i.from_picture) {
        if (!ctx.cityGroundFromPicture) return fail("Taking colours from the picture isn't available here.");
        const unknown = (i.only ?? []).filter((n) => groundMaterialId(n) === undefined);
        if (unknown.length) return fail(`There is no ground ${unknown.map((n) => `"${n}"`).join(", ")}.`);
        try {
          const r = await ctx.cityGroundFromPicture(i.only);
          return json({ coloured_from_picture: r.colours, measured_at: r.samples, note: "render_city to look; Undo takes it back." });
        } catch (e) { return fail((e as Error).message); }
      }
      const sp = citySpec(ctx.session().doc);
      let ground: Record<string, string> = { ...(sp.ground ?? {}) };
      if (i.reset === "all") ground = {};
      else for (const n of i.reset ?? []) { const id = groundMaterialId(n); if (id === undefined) return fail(`There is no ground "${n}".`); delete ground[GROUND_COLOUR_MATERIALS.find((m) => m.id === id)!.name]; }
      if (i.colours) {
        const c = cleanGroundColours(i.colours);
        if ("error" in c) return fail(`Not set: ${c.error}.`);
        ground = { ...ground, ...c };
      }
      if (!i.colours && i.reset === undefined) return fail("Say what to do: from_picture, colours or reset.");
      const { ground: _g, ...rest } = sp;
      const r = ctx.execute({ op: "set_meta", patch: { city: Object.keys(ground).length ? { ...rest, ground } : rest } }, Object.keys(ground).length ? "Ground colours" : "Ground colours as the climate makes them");
      return json({ change: r.seq, own_ground_colours: ground });
    },
  }),

  define({
    name: "add_trees",
    description:
      "Add trees, many groups at once (one edit, one undo step): woods, orchards, scattered trees (outlines), rows (along a line: avenues, hedgerows, river banks) and single trees. Their kind follows the climate " +
      "(firs when cold, broad trees when temperate, olives and cypresses in the Mediterranean, palms in the tropics, thorny trees when dry) unless species is given. " +
      "Woods on the steep ground and beyond the town, orchards and gardens behind houses on the edge, rows along the grand avenues and the river, a single old tree in a square. Keep them off the streets and out of buildings.",
    schema: z.object({ groups: z.array(NewTrees).min(1).max(200) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), added: MapTrees[] = [], skipped: string[] = [];
      i.groups.forEach((t, n) => {
        const c = cleanTrees({ id: newFeatureId("v"), ...t }, sp);
        if ("error" in c) skipped.push(`#${n + 1}: ${c.error}`); else added.push(c);
      });
      if (!added.length) return fail(`Nothing added. ${skipped.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertTrees: added } }, added.length === 1 ? `Add ${added[0].kind === "tree" ? "a tree" : added[0].kind}` : `Add ${added.length} groups of trees`);
      return json({ change: r.seq, added: added.map((t) => ({ id: t.id, kind: t.kind })), ...(skipped.length && { skipped }), climate_trees: climateTrees(cityClimate(sp)).map(([s, w]) => `${s} ${Math.round(w * 100)}%`).join(", ") });
    },
  }),

  define({
    name: "list_trees",
    description: "List the groups of trees (id, kind, where), optionally only those in a region (metres).",
    schema: z.object({ region: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(), limit: z.number().int().min(1).max(300).optional() }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      let all = featuresOf(ctx).trees ?? [];
      if (i.region) { const r = i.region; all = all.filter((t) => { const b = pointsBounds(t.points); return b.x1 >= r.x && b.x0 <= r.x + r.w && b.y1 >= r.y && b.y0 <= r.y + r.h; }); }
      const lim = i.limit ?? 100;
      return json({ total: all.length, groups: all.slice(0, lim).map((t) => { const b = pointsBounds(t.points); return { id: t.id, kind: t.kind, ...(t.name && { name: t.name }), ...(t.species && { species: t.species }), spans: [round(b.x0), round(b.y0), round(b.x1), round(b.y1)] }; }) });
    },
  }),

  define({
    name: "remove_trees",
    description: "Remove groups of trees by id (from list_trees). One edit.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(500) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const have = new Set((featuresOf(ctx).trees ?? []).map((t) => t.id)), ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids is a group of trees. list_trees lists them.");
      const r = ctx.execute({ op: "features", patch: { removeTrees: ids } }, `Remove ${ids.length} group${ids.length === 1 ? "" : "s"} of trees`);
      return json({ change: r.seq, removed: ids.length });
    },
  }),
];

export const CITY_LAND_TOOL_NAMES: string[] = CITY_LAND_TOOLS.map((t) => t.name);
