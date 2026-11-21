/**
 * Claude's planning tools for city maps (core cityPlan.ts): line streets with buildings the way a street fills up, route a street that follows the land, and check the city
 * for what is wrong (and for the look of a grid of stamps). Each change is one edit and one undo step.
 */
import { z } from "zod";
import {
  BUILDING_KINDS, type MapBuilding, type MapStreet, ROOF_STYLES, STREET_CHARACTERS, STREET_KINDS, type StreetCharacterId, chooseRoof, citySpec, cityProblems, cleanBuilding, cleanStreet,
  isCity, newFeatureId, planFrontage, routeStreet, streetBridges, streetWidthFor,
} from "@mapmaker/core";
import type { ToolContext, ToolDef, ToolResult } from "./tools.ts";

function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
const fail = (t: string): ToolResult => ({ ...text(t), isError: true });
const Pt = z.tuple([z.number(), z.number()]);
const Range = z.tuple([z.number().min(0), z.number().min(0)]);
function needCity(ctx: ToolContext): ToolResult | null {
  return isCity(ctx.session().doc) ? null : fail("This tool is for city maps, and the open project isn't one. create_city makes one; open_project switches to one.");
}
const weights = (keys: readonly string[]) => z.record(z.string(), z.number().min(0)).refine((o) => Object.keys(o).every((k) => keys.includes(k)), { message: `keys are ${keys.join(", ")}` });

export const CITY_PLAN_TOOLS = [
  define({
    name: "line_streets",
    description:
      "Fill streets with buildings the way a street fills up: facing the street and following its curves, varied in width, depth, set-back, gaps and roofs, skipping water, steep ground, other streets, " +
      "buildings and woods (one edit). Use this instead of placing rows of buildings by their numbers. character: " +
      Object.entries(STREET_CHARACTERS).map(([k, c]) => `${k} (${c.hint})`).join("; ") + ". " +
      "Run it district by district: dense along the market street and near the centre, town along the main streets, village and farm toward the edge; from_m/to_m limit it to part of a street. " +
      "Roofs come from the asset packs as add_buildings does. The result counts what was placed and why spots were skipped.",
    schema: z.object({
      streets: z.array(z.string()).min(1).max(300).describe("Street ids (list_streets), or [\"all\"]"),
      character: z.enum(Object.keys(STREET_CHARACTERS) as [string, ...string[]]).optional().describe("Default town"),
      sides: z.enum(["both", "left", "right"]).optional().describe("Left and right as you walk from the street's first point to its last; default both"),
      back_row: z.boolean().optional().describe("A second row behind the first, across a yard (default: only for dense)"),
      width_m: Range.optional(), depth_m: Range.optional(), gap_m: Range.optional(), setback_m: Range.optional(),
      roofs: weights(ROOF_STYLES).optional().describe("Shares of roof looks, e.g. {\"tile\": 3, \"slate\": 1}"),
      kinds: weights(BUILDING_KINDS).optional().describe("Shares of kinds, e.g. {\"house\": 8, \"shop\": 2}"),
      from_m: z.number().min(0).optional(), to_m: z.number().min(0).optional(),
      max_slope_percent: z.number().min(1).max(100).optional().describe("Steeper ground is left empty (default 20)"),
      seed: z.number().int().optional().describe("Another seed gives another arrangement"),
      limit: z.number().int().min(1).max(1500).optional().describe("The most buildings this call (default 1500)"),
      roof_assets: z.enum(["auto", "none"]).optional(), roof_match: z.string().max(60).optional(),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const doc = ctx.session().doc, sp = citySpec(doc), all = (doc.features?.streets ?? []) as MapStreet[];
      const want = i.streets.includes("all") ? all : all.filter((s) => i.streets.includes(s.id));
      const unknown = i.streets.filter((id) => id !== "all" && !all.some((s) => s.id === id));
      if (!want.length) return fail(`No such street${unknown.length ? `: ${unknown.join(", ")}` : ""}. list_streets lists them.`);
      const plan = planFrontage(doc, want, {
        character: i.character as StreetCharacterId | undefined, sides: i.sides, backRow: i.back_row,
        ...(i.width_m && { width: i.width_m }), ...(i.depth_m && { depth: i.depth_m }), ...(i.gap_m && { gap: i.gap_m }), ...(i.setback_m && { setback: i.setback_m }),
        ...(i.roofs && { roofs: i.roofs }), ...(i.kinds && { kinds: i.kinds }), from: i.from_m, to: i.to_m, maxSlope: i.max_slope_percent, seed: i.seed, limit: i.limit,
      });
      if (!plan.buildings.length) return fail(`No building fitted. Skipped spots: ${JSON.stringify(plan.skipped)} (water, steep ground, other streets, buildings, woods or the map's edge). Try another character, smaller sizes or another street.`);
      const pools = ctx.roofPools?.() ?? null, mode = i.roof_assets ?? "auto", missing = new Set<string>();
      const added: MapBuilding[] = [];
      for (const b of plan.buildings) {
        const id = newFeatureId("b"), pic = mode === "auto" ? chooseRoof(pools, b.roof, id, i.roof_match) : null;
        if (!pic && pools && mode === "auto") missing.add(b.roof);
        const c = cleanBuilding({ id, points: b.points, roof: b.roof, kind: b.kind, ...(pic && { asset: pic.asset, tile: pic.tile }) }, sp);
        if (!("error" in c)) added.push(c);
      }
      const r = ctx.execute({ op: "features", patch: { upsertBuildings: added } }, `Line ${want.length === 1 ? (want[0].name ?? "a street") : `${want.length} streets`} with ${added.length} buildings`);
      return json({
        change: r.seq, added: added.length, by_street: plan.byStreet, skipped_spots: plan.skipped, ...(unknown.length && { unknown_streets: unknown }),
        roofs: { from_asset_packs: added.filter((b) => b.asset).length, drawn: added.filter((b) => !b.asset).length, ...(missing.size && { no_asset_for_look: [...missing] }) },
        next: "render_city to look; check_city to find problems.",
      });
    },
  }),

  define({
    name: "route_street",
    description:
      "Add a street that follows the land, from the first point to the last through the others in order (metres): it climbs no steeper than max_grade_percent where it can (winding up a steep hill), " +
      "goes round buildings, and crosses water where it is narrow, on a bridge (or not at all with bridges: false). Use it for main roads and anything crossing hills or water; give a few waypoints " +
      "(a gate, the market, the bridge-head) rather than every bend. The result says its length, steepest climb and bridges. One edit.",
    schema: z.object({
      points: z.array(Pt).min(2).max(20),
      kind: z.enum(STREET_KINDS.map((k) => k.id) as [string, ...string[]]).optional().describe("Default street"),
      width: z.number().min(0.5).max(60).optional(), name: z.string().min(1).max(80).optional().describe("Only a name the DM gave"),
      max_grade_percent: z.number().min(1).max(40).optional().describe("Default 8 (a loaded cart); 12-15 for a lane, more for a path or stairs"),
      bridges: z.boolean().optional().describe("Default true"),
      bridge: z.enum(["auto", "stone", "wood", "none"]).optional().describe("What it becomes over water (default auto)"),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const doc = ctx.session().doc, sp = citySpec(doc);
      const route = routeStreet(doc, i.points as [number, number][], { maxGrade: i.max_grade_percent, bridges: i.bridges });
      if ("error" in route) return fail(route.error);
      const kind = (i.kind ?? "street") as MapStreet["kind"];
      const c = cleanStreet({ id: newFeatureId("t"), points: route.points, width: i.width ?? streetWidthFor(kind), kind, name: i.name, ...(i.bridge && i.bridge !== "auto" && { bridge: i.bridge }) }, sp);
      if ("error" in c) return fail(c.error);
      const r = ctx.execute({ op: "features", patch: { upsertStreets: [c] } }, `Add ${c.name ?? kind}`);
      const bridges = streetBridges(c, doc.height, sp.cellM).map((b) => ({ kind: b.kind === "ford" ? "ford" : `${b.kind} bridge`, length_m: Math.round(b.length) }));
      const limit = i.max_grade_percent ?? 8;
      return json({
        change: r.seq, id: c.id, points: c.points.length, length_m: route.length, steepest_climb_percent: route.maxGrade, ...(bridges.length && { bridges }),
        ...(route.maxGrade > limit * 1.25 && { note: `Part of it climbs ${route.maxGrade}% (more than ${limit}%): the ground there allows nothing gentler on this way. Add a waypoint to lead it round, allow a steeper grade, or make it a lane or path.` }),
      });
    },
  }),

  define({
    name: "check_city",
    description:
      "Check the city for what is wrong, with counts and a few examples (ids and where): buildings in water, on streets, overlapping or on steep ground; main streets that end nowhere; very long bridges; " +
      "fords on main streets; and whether the buildings read as a grid of stamps (most of one angle and one size). Run it before saying a city is done, and fix what it finds.",
    schema: z.object({}),
    async run(ctx) {
      const bad = needCity(ctx); if (bad) return bad;
      const r = cityProblems(ctx.session().doc);
      const advice: string[] = [];
      if (r.in_water.count) advice.push("Remove or move the buildings in water (remove_buildings).");
      if (r.on_streets.count) advice.push("Buildings stand on streets: move or remove them, or move the street.");
      if (r.overlapping.count) advice.push("Some buildings overlap: remove one of each pair.");
      if (r.on_steep_ground.count) advice.push("Buildings on steep ground: fine for a few terraced houses, odd for many.");
      if (r.dead_end_main_streets.count) advice.push("Main streets that end nowhere: join them to another street or make them lanes.");
      if (r.regularity.looks_stamped) advice.push("The buildings are nearly all one angle and one size, which reads as a grid of stamps: re-line the streets with line_streets (vary the character), and let streets follow the land (route_street).");
      return json({ ...r, ...(advice.length ? { advice } : { verdict: "Nothing wrong found." }) });
    },
  }),
];

export const CITY_PLAN_TOOL_NAMES: string[] = CITY_PLAN_TOOLS.map((t) => t.name);
