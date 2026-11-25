/**
 * Claude's tools for prefabs (core prefabs.ts): pieces of a battlemap the DM saved by name (a guard post, a camp, a tavern's taproom) to place again, on any battlemap.
 * A prefab's name is the DM's; Claude saves one only under a name the DM gave, and removing or renaming them is the DM's to do in the editor.
 */
import { z } from "zod";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

const need = (ctx: ToolContext) => ctx.prefabs ?? null;

export const PREFAB_TOOLS = [
  define({
    name: "list_prefabs",
    description:
      "The DM's prefabs: pieces of a battlemap saved by name to place again (a room, a building, a camp), each with its size in squares, what it holds (floor, walls, doors, objects, lights...) and the map it was saved from. " +
      "They belong to the DM, not to one map: any battlemap can use them. Place one with place_prefab.",
    schema: z.object({}),
    async run(ctx) {
      const p = need(ctx);
      if (!p) return fail("Prefabs aren't available here.");
      const { prefabs, skipped } = await p.list();
      return json({
        prefabs: prefabs.map((x) => ({ id: x.id, name: x.name, squares: `${x.w} x ${x.h}`, holds: x.what, ...(x.from && { saved_from: x.from }) })),
        ...(skipped.length && { unreadable: skipped }),
        ...(!prefabs.length && { note: "None saved yet. The DM saves them with the editor's Prefab tool (C), or asks you to with save_prefab." }),
      });
    },
  }),

  define({
    name: "place_prefab",
    description:
      "Place one of the DM's prefabs on the open battlemap (its level being worked on): its top-left corner at square (x, y), turned clockwise by quarter turns and mirrored left to right if asked. " +
      "Its floor covers the map's where it has floor (its empty parts leave the map as it is); its walls, doors, objects, lights, stairs and roofs come with it, all new. One edit, one undo step. " +
      "Its size after turning is w x h squares (90 and 270 swap them); it is moved inside the map if it would stick out. render_battlemap afterwards to check it sits well.",
    schema: z.object({
      prefab: z.string().min(1).describe("The prefab's name or id (list_prefabs)"),
      x: z.number().describe("Square x of its top-left corner (after turning)"),
      y: z.number().describe("Square y of its top-left corner (after turning)"),
      turn: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe("Clockwise turn in degrees (default 0)"),
      mirror: z.boolean().optional().describe("Mirror it left to right (before turning)"),
    }),
    async run(ctx, i) {
      const p = need(ctx);
      if (!p) return fail("Prefabs aren't available here.");
      const r = await p.place({ prefab: i.prefab, x: i.x, y: i.y, turn: i.turn, mirror: i.mirror });
      return json({ change: r.change, placed: r.prefab, at: { x: r.x, y: r.y }, squares: `${r.w} x ${r.h}`, things: r.ids.length, ...(r.problems.length && { problems: r.problems }) });
    },
  }),

  define({
    name: "save_prefab",
    description:
      "Save a rectangle of the open battlemap (whole squares, the level being worked on) as a prefab to place again later, on this map or another: the floor in it and everything inside it (walls crossing its edge cut there; doors and windows only when wholly inside) " +
      "(walls, doors, windows, objects, lights, shaded areas, stairs, roofs, paths; not the numbered notes). Only under a name the DM gave or agreed to. " +
      "A prefab of the same name is kept unless `replace` is true (the DM is asked first).",
    schema: z.object({
      name: z.string().min(1).max(60).describe("The DM's name for it"),
      x: z.number().int().min(0).describe("Left square"),
      y: z.number().int().min(0).describe("Top square"),
      w: z.number().int().min(1).max(100).describe("Width in squares"),
      h: z.number().int().min(1).max(100).describe("Height in squares"),
      replace: z.boolean().optional().describe("Replace a prefab of the same name"),
    }),
    async run(ctx, i) {
      const p = need(ctx);
      if (!p) return fail("Prefabs aren't available here.");
      const r = await p.save({ name: i.name, rect: { x: i.x, y: i.y, w: i.w, h: i.h }, replace: i.replace });
      return json({ saved: r.name, id: r.id, squares: `${r.w} x ${r.h}`, holds: r.what, note: "The DM sees it in the Prefab tool's list; place it with place_prefab." });
    },
  }),
] as const;

export const PREFAB_TOOL_NAMES = PREFAB_TOOLS.map((t) => t.name);
