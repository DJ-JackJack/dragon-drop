/**
 * Claude's side of the player screen (core fog.ts): reveal what the party sees, or hide it again, on the battlemap level being worked on. Only when the DM asks
 * ("show them the throne room"): what the players see is the DM's call at the table.
 */
import { z } from "zod";
import { battleSpec, isBattle, newFeatureId, rectPoints, revealFrom } from "@mapmaker/core";
import { define, fail, json } from "./toolKit.ts";

export const REVEAL_TOOLS = [
  define({
    name: "reveal_to_players",
    description:
      "The player screen (a window the DM shows the players on a TV) shows a battlemap level; with the fog on, only what has been revealed. " +
      "action spot: reveal what can be seen from square (x, y), as if the party stood there (walls and closed doors block it: from inside a room, that room); " +
      "area / hide_area: reveal or hide the rectangle x, y, w, h; hide_all: hide everything again; fog_on / fog_off: whether the player screen hides what isn't revealed (revealing turns it on). " +
      "Each is one undo step. Only when the DM asks.",
    schema: z.object({
      action: z.enum(["spot", "area", "hide_area", "hide_all", "fog_on", "fog_off"]),
      x: z.number().optional(), y: z.number().optional(), w: z.number().positive().optional(), h: z.number().positive().optional(),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc;
      if (!isBattle(doc)) return fail("The player screen shows battlemaps.");
      const spec = battleSpec(doc), f = doc.features ?? { places: [], labels: [] };
      const fog = (on: boolean, label: string) => {
        const { fog: _f, ...rest } = spec;
        return ctx.execute({ op: "set_meta", patch: { battle: on ? { ...rest, fog: true } : rest } }, label);
      };
      if (i.action === "fog_on" || i.action === "fog_off") {
        const r = fog(i.action === "fog_on", i.action === "fog_on" ? "Fog on for the player screen" : "Fog off for the player screen");
        return json({ change: r.seq, fog: i.action === "fog_on" });
      }
      if (i.action === "hide_all") {
        const r = ctx.execute({ op: "features", patch: { removeReveals: ["*"] } }, "Hide everything from the players");
        return json({ change: r.seq, revealed: 0 });
      }
      if (i.x === undefined || i.y === undefined) return fail("Give x and y (squares).");
      let points: [number, number][];
      if (i.action === "spot") points = revealFrom(f.walls, i.x, i.y, Math.max(spec.squaresX, spec.squaresY) * 1.5);
      else {
        if (!i.w || !i.h) return fail("Give w and h (squares) for an area.");
        points = rectPoints(i.x, i.y, i.w, i.h);
      }
      if (points.length < 3) return fail("Nothing can be seen from there.");
      if (!spec.fog) fog(true, "Fog on for the player screen");
      const hide = i.action === "hide_area";
      const r = ctx.execute({ op: "features", patch: { upsertReveals: [{ id: newFeatureId("v"), points, ...(hide && { hide: true }) }] } },
        hide ? "Hide an area from the players" : i.action === "spot" ? "Reveal what can be seen from a spot" : "Reveal an area");
      return json({ change: r.seq, fog: true, note: "The player screen shows it now (the DM opens it from the Map panel)." });
    },
  }),
] as const;
