/**
 * Claude's tools for city walls (core cityWalls.ts): stone walls, wooden palisades and earth ramparts, as lines or rings in metres. Towers and gates are worked out from the
 * wall and the streets each time (a gate wherever a street crosses), so the results report them rather than taking them. Every call is one edit and one undo step.
 */
import { z } from "zod";
import { type MapCityWall, WALL_KINDS, citySpec, cleanCityWall, isCity, newFeatureId, wallPieces } from "@mapmaker/core";
import type { ToolContext, ToolDef, ToolResult } from "./tools.ts";

function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
const fail = (t: string): ToolResult => ({ ...text(t), isError: true });
const Pt = z.tuple([z.number(), z.number()]);

function needCity(ctx: ToolContext): ToolResult | null {
  return isCity(ctx.session().doc) ? null : fail("This tool is for city maps, and the open project isn't one. create_city makes one; open_project switches to one.");
}
const featuresOf = (ctx: ToolContext) => ctx.session().doc.features ?? { places: [], labels: [] };
const Kind = z.enum(WALL_KINDS.map((k) => k.id) as [string, ...string[]]).describe(WALL_KINDS.map((k) => `${k.id}: ${k.hint}`).join("; "));
const Towers = z.number().min(0).max(500).describe("Metres between towers, 0 for none (default by kind: stone 40, palisade 30, earth none). Towers also stand at the corners and the ends");

/** A wall as Claude reads it: what it is, how long, and what stands on it (its towers, and its gates: which street passes, where, with a gatehouse or not). */
export function describeWall(ctx: ToolContext, w: MapCityWall) {
  const doc = ctx.session().doc, p = wallPieces(w, featuresOf(ctx).streets ?? [], { ground: doc.height, cellM: citySpec(doc).cellM });
  return {
    id: w.id, ...(w.name && { name: w.name }), kind: p.kind, ...(p.closed && { ring: true }), length_m: Math.round(p.length), thickness_m: p.thickness, points: w.points.length,
    towers: p.towers.length,
    gates: p.gates.map((g) => ({ ...(g.streetId && { street: g.streetId }), ...(g.water && { water_gate: true }), at: [Math.round(g.x), Math.round(g.y)], ...(g.gatehouse ? { gatehouse: true } : {}), opening_m: Math.round(g.width * 10) / 10 })),
  };
}

export const CITY_WALL_TOOLS: ToolDef<z.ZodType>[] = [
  define({
    name: "add_city_walls",
    description:
      "Add city walls (up to 20 per call, one edit): each a line through points (metres), or a ring (closed: true) round the town or a district. " +
      "Kinds: stone (the default: a curtain wall with round towers), palisade (logs with square wooden towers: a village, a camp, a frontier town), earth (a rampart with a ditch outside it: an old hill fort). " +
      "Towers stand at the corners, at the ends and about every `towers` metres. A GATE appears by itself wherever a street crosses the wall (a gatehouse with two towers for avenues and streets, a plain opening for lanes and paths), " +
      "so draw the wall first and route the main roads through it where the gates should be, or draw the wall across the roads already there. Where it crosses water (a river, the harbour) a water gate appears by itself (a portcullis, a tower on each bank). " +
      "A wall follows the high ground, a river or the coast, encloses the old centre with room to spare, and is crossed by every road into town. A name only if the DM gave one. The result lists each wall's towers and gates.",
    schema: z.object({
      walls: z.array(z.object({
        points: z.array(Pt).min(2).max(400), closed: z.boolean().optional().describe("A ring: the last point joins the first (needs 3 or more points)"),
        kind: Kind.optional(), thickness: z.number().min(0.3).max(30).optional().describe("Metres across the top (default by kind: stone 3, palisade 1.2, earth 7)"), towers: Towers.optional(),
        name: z.string().min(1).max(80).optional(),
      })).min(1).max(20),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc);
      const added: MapCityWall[] = [], errors: string[] = [];
      i.walls.forEach((w, n) => {
        const c = cleanCityWall({ id: newFeatureId("w"), ...w }, sp);
        if ("error" in c) errors.push(`#${n + 1}: ${c.error.replace(/^wall [^ ]+ /, "")}`); else added.push(c);
      });
      if (!added.length) return fail(`Nothing was added. ${errors.slice(0, 8).join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertCityWalls: added } }, added.length === 1 ? `Add ${added[0].name ?? WALL_KINDS.find((k) => k.id === (added[0].kind ?? "stone"))!.name.toLowerCase()}` : `Add ${added.length} walls`);
      const walls = added.map((w) => describeWall(ctx, w));
      const noGate = walls.filter((w) => w.ring && !w.gates.length).map((w) => w.id);
      return json({ change: r.seq, added: added.length, walls, ...(errors.length && { skipped: errors.length, errors: errors.slice(0, 10) }), ...(noGate.length && { note: `No street crosses ring ${noGate.join(", ")} yet, so it has no gate: route a road through it.` }) });
    },
  }),

  define({
    name: "update_city_walls",
    description: "Change city walls by id (from list_city_walls or add_city_walls): the points, ring or not, kind, thickness, tower spacing or name. One edit.",
    schema: z.object({
      changes: z.array(z.object({
        id: z.string(), points: z.array(Pt).min(2).max(400).optional(), closed: z.boolean().optional(), kind: Kind.optional(),
        thickness: z.number().min(0.3).max(30).optional(), towers: Towers.optional(), name: z.string().max(80).optional().describe("Only a name the DM gave; empty removes it"),
      })).min(1).max(50),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), by = new Map((featuresOf(ctx).cityWalls ?? []).map((w) => [w.id, w]));
      const out: MapCityWall[] = [], skipped: string[] = [];
      for (const ch of i.changes) {
        const cur = by.get(ch.id);
        if (!cur) { skipped.push(`${ch.id}: no such wall`); continue; }
        const { name: _n, closed: _c, ...rest } = cur;
        const name = ch.name === undefined ? cur.name : ch.name || undefined, closed = ch.closed ?? cur.closed;
        const c = cleanCityWall({ ...rest, ...(ch.points && { points: ch.points }), ...(ch.kind && { kind: ch.kind }), ...(ch.thickness !== undefined && { thickness: ch.thickness }), ...(ch.towers !== undefined && { towers: ch.towers }), ...(closed && { closed: true }), ...(name && { name }) }, sp);
        if ("error" in c) skipped.push(c.error); else out.push(c);
      }
      if (!out.length) return fail(`Nothing changed. ${skipped.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertCityWalls: out } }, out.length === 1 ? `Change ${out[0].name ?? "wall"}` : `Change ${out.length} walls`);
      return json({ change: r.seq, changed: out.length, walls: out.map((w) => describeWall(ctx, w)), ...(skipped.length && { skipped }) });
    },
  }),

  define({
    name: "list_city_walls",
    description: "List the city walls: id, kind, name, ring or not, length, thickness, how many towers, and each gate (which street passes, where, gatehouse or not).",
    schema: z.object({}),
    async run(ctx) {
      const bad = needCity(ctx); if (bad) return bad;
      const walls = featuresOf(ctx).cityWalls ?? [];
      return json({ total: walls.length, walls: walls.map((w) => describeWall(ctx, w)) });
    },
  }),

  define({
    name: "remove_city_walls",
    description: "Remove city walls by id (from add_city_walls or list_city_walls). One edit; Undo brings them back. Only when the DM asks.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(100) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const have = new Set((featuresOf(ctx).cityWalls ?? []).map((w) => w.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return text("No wall matched; nothing was removed.");
      const r = ctx.execute({ op: "features", patch: { removeCityWalls: ids } }, `Remove ${ids.length} wall${ids.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, removed: ids.length });
    },
  }),
];

export const CITY_WALL_TOOL_NAMES: string[] = CITY_WALL_TOOLS.map((t) => t.name);
