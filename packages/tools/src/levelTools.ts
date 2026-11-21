/**
 * Claude's tools for the levels of a battlemap (a cellar, a ground floor, an attic) and the stairs, ladders and holes between them. Levels are the DM's structure: a level is
 * added when they ask for one, and removing one is theirs to do in the editor. Every other battlemap tool works on the level that is being worked on.
 */
import { z } from "zod";
import { type MapConnector, battleSpec, connectorTo, newFeatureId } from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

const KIND = z.enum(["stairs", "ladder", "hole"]);
const connectorsOf = (ctx: ToolContext) => ctx.session().doc.features?.connectors ?? [];

/** The connector as Claude sees it. */
const describe = (c: MapConnector) => ({ id: c.id, kind: c.kind, ...(c.name && { name: c.name }), x: c.x, y: c.y, w: c.w, h: c.h, leads: connectorTo(c) });

/** Is the rectangle inside the map? An error message, or null. */
function boundsError(ctx: ToolContext, c: { x: number; y: number; w: number; h: number }): string | null {
  const sp = battleSpec(ctx.session().doc);
  if (c.x + c.w > sp.squaresX || c.y + c.h > sp.squaresY) return `That doesn't fit: the map is ${sp.squaresX} x ${sp.squaresY} squares, and a ${c.w} x ${c.h} one at (${c.x}, ${c.y}) reaches (${c.x + c.w}, ${c.y + c.h}).`;
  return null;
}

/** What a connector does where it is: a note for Claude's reply when it leads nowhere yet. */
function leadsNote(ctx: ToolContext, c: MapConnector): string | undefined {
  if (!ctx.levels) return undefined;
  const { active, levels } = ctx.levels.list();
  const i = levels.findIndex((l) => l.id === active), to = connectorTo(c);
  if (levels[i + (to === "up" ? 1 : -1)]) return undefined;
  return `This level has no level ${to === "up" ? "above" : "below"} it yet, so it leads nowhere and a Foundry scene will leave it out. Add one with add_level (the DM may want to say how high it is).`;
}

export const LEVEL_TOOLS = [
  define({
    name: "list_levels",
    description:
      "The levels of the open battlemap, from the lowest to the highest: id, name, elevation in feet (bottom and top), which one is being worked on, and what is on each (walls, doors, windows, lights, objects, notes, stairs/ladders/holes, floored squares). " +
      "A battlemap always has at least one level. Every other battlemap tool works on the active level.",
    schema: z.object({}),
    async run(ctx) {
      if (!ctx.levels) return fail("Levels aren't available here.");
      return json(ctx.levels.list());
    },
  }),

  define({
    name: "add_level",
    description:
      "Add an empty level above the highest or below the lowest, with the same size, grid, light level and floor textures as the one being worked on, and switch to it (the DM's editor moves to it too). " +
      "It is 10 ft tall unless changed with update_level. Only add a level when the DM asks for one or for a building with floors; at most 12. Then build on it with add_room and the other tools.",
    schema: z.object({
      where: z.enum(["above", "below"]).describe("Above the highest level (an upper floor) or below the lowest (a cellar)"),
      name: z.string().min(1).max(60).optional().describe("Only a name the DM gave; the default is Upper floor / Cellar (numbered if taken)"),
    }),
    async run(ctx, i) {
      if (!ctx.levels) return fail("Levels aren't available here.");
      const l = await ctx.levels.add(i.where, i.name);
      return json({ level: l, now_working_on: l.name, note: "It is empty. Use add_room, paint_floor and the other tools to build it; they work on this level now." });
    },
  }),

  define({
    name: "set_active_level",
    description: "Switch to another level of the battlemap, by id or name (from list_levels). The DM's editor moves to that level too, and add_room, add_door, render_battlemap and the others work on it from now on.",
    schema: z.object({ level: z.string().min(1).describe("A level's id or name") }),
    async run(ctx, i) {
      if (!ctx.levels) return fail("Levels aren't available here.");
      const l = await ctx.levels.select(i.level);
      return json({ now_working_on: l.name, level: l });
    },
  }),

  define({
    name: "update_level",
    description:
      "Rename a level or change where it sits: bottom and top are elevations in feet (0 is the ground, below it is negative; the top must be above the bottom). Stairs and holes lead to the level just above or below by elevation, " +
      "so changing elevations changes which level they lead to. Only use names and heights the DM gave.",
    schema: z.object({
      level: z.string().min(1).describe("A level's id or name"),
      name: z.string().min(1).max(60).optional(),
      bottom_ft: z.number().min(-1000).max(1000).optional(),
      top_ft: z.number().min(-1000).max(1000).optional(),
    }),
    async run(ctx, i) {
      if (!ctx.levels) return fail("Levels aren't available here.");
      const l = await ctx.levels.update(i.level, { ...(i.name !== undefined && { name: i.name }), ...(i.bottom_ft !== undefined && { bottom: i.bottom_ft }), ...(i.top_ft !== undefined && { top: i.top_ft }) });
      return json({ level: l });
    },
  }),

  define({
    name: "add_connector",
    description:
      "Add stairs, a ladder or a hole to the level being worked on, as a rectangle: x, y is the top-left corner and w, h the size, all in whole grid squares. " +
      "Stairs and a ladder lead 'up' or 'down' to the next level above or below; a hole is an opening in this level's floor, so it always leads down (leads is ignored). " +
      "In a Foundry scene stairs and ladders become a Change Level region over both levels and a hole a gap in this level's floor. The level it leads to must exist (add_level). " +
      "Stairs are usually 1 x 2 or 1 x 3 squares; a ladder 1 x 1. Draw the way up on the lower level; a matching one drawn on the level above at the same place counts as the same stair.",
    schema: z.object({
      kind: KIND,
      x: z.number().int().min(0), y: z.number().int().min(0),
      w: z.number().int().min(1).max(50), h: z.number().int().min(1).max(50),
      leads: z.enum(["up", "down"]).optional().describe("Default up; a hole always leads down"),
      name: z.string().min(1).max(60).optional().describe("Only a name the DM gave"),
    }),
    async run(ctx, i) {
      const err = boundsError(ctx, i);
      if (err) return fail(err);
      const c: MapConnector = { id: newFeatureId("c"), kind: i.kind, x: i.x, y: i.y, w: i.w, h: i.h, to: i.kind === "hole" ? "down" : i.leads ?? "up", ...(i.name && { name: i.name }) };
      const r = ctx.execute({ op: "features", patch: { upsertConnectors: [c] }, label: `Add ${i.kind}${i.name ? ` ${i.name}` : ""}` });
      return json({ change: r.seq, connector: describe(c), ...(leadsNote(ctx, c) && { note: leadsNote(ctx, c) }) });
    },
  }),

  define({
    name: "update_connector",
    description: "Change a stair, ladder or hole of this level: its kind, position, size, direction or name (ids from list_battle or list_connectors).",
    schema: z.object({
      id: z.string(),
      kind: KIND.optional(),
      x: z.number().int().min(0).optional(), y: z.number().int().min(0).optional(),
      w: z.number().int().min(1).max(50).optional(), h: z.number().int().min(1).max(50).optional(),
      leads: z.enum(["up", "down"]).optional(),
      name: z.string().max(60).optional().describe("An empty string removes the name"),
    }),
    async run(ctx, i) {
      const c = connectorsOf(ctx).find((x) => x.id === i.id);
      if (!c) return fail("No stair, ladder or hole on this level has that id. Use list_connectors (it lists this level's only).");
      const next: MapConnector = { ...c, ...(i.kind && { kind: i.kind }), ...(i.x !== undefined && { x: i.x }), ...(i.y !== undefined && { y: i.y }), ...(i.w !== undefined && { w: i.w }), ...(i.h !== undefined && { h: i.h }), ...(i.leads && { to: i.leads }) };
      if (i.name !== undefined) { if (i.name.trim()) next.name = i.name.trim(); else delete next.name; }
      if (next.kind === "hole") next.to = "down";
      const err = boundsError(ctx, next);
      if (err) return fail(err);
      const r = ctx.execute({ op: "features", patch: { upsertConnectors: [next] }, label: `Change ${next.kind}${next.name ? ` ${next.name}` : ""}` });
      return json({ change: r.seq, connector: describe(next), ...(leadsNote(ctx, next) && { note: leadsNote(ctx, next) }) });
    },
  }),

  define({
    name: "remove_connectors",
    description: "Remove stairs, ladders or holes of this level by id.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(100) }),
    async run(ctx, i) {
      const have = new Set(connectorsOf(ctx).map((c) => c.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids is a stair, ladder or hole of this level. Use list_connectors.");
      const r = ctx.execute({ op: "features", patch: { removeConnectors: ids }, label: `Remove ${ids.length} stair(s), ladder(s) or hole(s)` });
      return json({ change: r.seq, removed: ids, not_found: i.ids.filter((id) => !have.has(id)) });
    },
  }),

  define({
    name: "list_connectors",
    description: "The stairs, ladders and holes of the level being worked on (id, kind, position and size in squares, which way each leads). Other levels' are listed after switching to them.",
    schema: z.object({}),
    async run(ctx) {
      return json({ connectors: connectorsOf(ctx).map(describe) });
    },
  }),
] as const;
