/**
 * Claude's one-click generators (core generators.ts): a dungeon or cave filling a battlemap level, a village on a settlement map. Shapes only: no names, no
 * stories, nothing in the rooms. They replace what the level or the settlement had (the DM is asked first when there is something to replace).
 */
import { z } from "zod";
import { GEN_SIZES, VILLAGE_SIZES } from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

const need = (ctx: ToolContext) => ctx.generate ?? null;

export const GENERATOR_TOOLS = [
  define({
    name: "generate_dungeon",
    description:
      "Fill the open battlemap's level (the one being worked on) with a generated dungeon or cave, replacing its floor, walls, doors and lights (objects, notes, stairs and roofs stay). " +
      "Dungeon: separate rooms joined by one-square corridors, doors (a few secret) where corridors meet rooms, torches in some rooms. Cave: winding caverns with rough rock walls, patches of earth and a few shallow pools. " +
      "Seeded: the same seed gives the same map; leave it out for a new one. It makes shapes only: rooms are not numbered or described (that is the DM's: add_note when they say). One undo step. render_battlemap afterwards to look.",
    schema: z.object({
      style: z.enum(["dungeon", "cave"]),
      size: z.enum(GEN_SIZES as [string, ...string[]]).optional().describe("How many rooms (dungeon) or how open (cave), for the map's size; default medium"),
      seed: z.number().int().min(0).optional(),
      doors: z.boolean().optional().describe("Dungeon: doors in the room entrances (default true)"),
      torches: z.boolean().optional().describe("Dungeon: torches in some rooms (default true)"),
    }),
    async run(ctx, i) {
      const g = need(ctx);
      if (!g) return fail("Generators aren't available here.");
      const r = await g({ what: i.style, size: i.size as "small" | "medium" | "large" | undefined, seed: i.seed, doors: i.doors, torches: i.torches });
      return json({ change: r.change, made: r.summary, seed: r.seed, note: "The same seed makes it again. Undo takes it back." });
    },
  }),

  define({
    name: "generate_village",
    description:
      "Lay out a village on the open settlement map: a road across it that follows the land, lanes off it, cottages along them (denser in the middle), an inn and a temple near the middle (a hamlet gets a tavern). " +
      "It replaces the map's streets and buildings; its land, water and trees stay and are built around. Seeded: the same seed gives the same village. Shapes only: nothing is named. One undo step. render_city afterwards to look.",
    schema: z.object({
      size: z.enum(VILLAGE_SIZES as [string, ...string[]]).optional().describe("hamlet, village (default) or large"),
      seed: z.number().int().min(0).optional(),
    }),
    async run(ctx, i) {
      const g = need(ctx);
      if (!g) return fail("Generators aren't available here.");
      const r = await g({ what: "village", size: i.size as "hamlet" | "village" | "large" | undefined, seed: i.seed });
      return json({ change: r.change, made: r.summary, seed: r.seed, note: "The same seed makes it again. Undo takes it back." });
    },
  }),
] as const;
