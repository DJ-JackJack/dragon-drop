/**
 * Claude's tool for ground painted by hand on a world map (biome brushes; core groundPaint.ts): a kind of ground put over the climate's choice inside an
 * outline, a circle, or a closed border line's or climate region's outline, or taken off again. Paint, not climate: the rain and rivers stay as they are.
 * Only where the DM asks for a ground the climate doesn't give (a forest here, a desert there); to change what grows over a wider area, the climate is
 * usually the better tool (add_climate_region, set_climate).
 */
import { z } from "zod";
import { GROUND_INFO, PAINTABLE_GROUNDS, decodeRealmCells, encodeRealmCells, groundCode, groundGridOf, isWorld, paintRealmCells, shapeContains } from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

type Pt = [number, number];
const pt = z.tuple([z.number(), z.number()]);
const IDS = PAINTABLE_GROUNDS.map((g) => g.id) as [string, ...string[]];
const notWorld = (ctx: ToolContext) => (isWorld(ctx.session().doc) ? null : fail("Ground is painted on world maps (a settlement's ground is paint_ground)."));

export const GROUND_TOOLS = [
  define({
    name: "paint_biome",
    description:
      "Paint a kind of ground over what the climate makes there, on the world map (map px): inside an outline (`polygon`), a circle, or the outline of a closed border line or a climate region (`inside`: its id or name). " +
      "It is paint only (the rain, rivers and climate stay as they are) and shows in the Painted style. Use it where the DM asks for a ground the climate doesn't give there: 'a pine forest on that island', 'make this desert'. " +
      "For a wider change of climate, add_climate_region is usually better. land_only (default true) keeps the sea and lakes out. erase: take painted ground off there, so the climate decides again (no ground needed). " +
      "list_grounds lists the grounds; get_selection and render_preview check the result. One undo step.",
    schema: z.object({
      ground: z.enum(IDS).optional().describe("The ground to paint (not with erase)"),
      polygon: z.array(pt).min(3).max(2000).optional(),
      circle: z.object({ x: z.number(), y: z.number(), r: z.number().positive() }).optional(),
      inside: z.string().optional().describe("A closed border line's or a climate region's id or name: paint inside its outline"),
      land_only: z.boolean().optional(),
      erase: z.boolean().optional(),
    }),
    async run(ctx, i) {
      const bad = notWorld(ctx); if (bad) return bad;
      if (!i.erase && !i.ground) return fail("Name the ground to paint (list_grounds lists them), or erase.");
      const session = ctx.session(), doc = session.doc, f = doc.features ?? { places: [], labels: [] };
      let polygon: Pt[] | undefined = i.polygon as Pt[] | undefined;
      if (i.inside) {
        const k = i.inside.trim().toLowerCase();
        const line = (f.lines ?? []).find((l) => l.id === i.inside || (l.name ?? "").toLowerCase() === k);
        const region = (f.regions ?? []).find((g) => g.id === i.inside || (g.name ?? "").toLowerCase() === k);
        if (line && line.points.length >= 3) polygon = line.points as Pt[];
        else if (region && region.polygon.length >= 3) polygon = region.polygon as Pt[];
        else return fail(`No closed border line or climate region outline called "${i.inside}".`);
      }
      if (!polygon && !i.circle) return fail("Give a polygon, a circle or inside.");
      const g = groundGridOf(doc), cells = decodeRealmCells(g);
      // (while the DM has locked Claude's edits to an area, only cells inside it change)
      const lock = session.editLock, before = lock ? cells.slice() : null;
      const changed = paintRealmCells(cells, g, {
        n: i.erase ? 0 : groundCode(i.ground!), ...(polygon ? { polygon } : { circle: i.circle }),
        ...(i.land_only !== false && !i.erase && { landOnly: { heights: doc.height.data, w: doc.height.w, h: doc.height.h, seaLevel: doc.meta.seaLevel } }),
      });
      if (lock && before) for (let k = 0; k < cells.length; k++) {
        if (cells[k] === before[k]) continue;
        const x = ((k % g.w) + 0.5) * g.scale, y = (Math.floor(k / g.w) + 0.5) * g.scale;
        if (!shapeContains(lock.shape, x, y)) cells[k] = before[k];
      }
      if (!changed) return json({ changed: 0, note: "Nothing changed there (already that ground, or only sea with land_only)." });
      const name = GROUND_INFO.find((x) => x.id === i.ground)?.name ?? i.ground;
      const any = cells.some((v) => v);
      const res = ctx.execute({ op: "features", patch: { setGroundCells: any ? encodeRealmCells(g, cells) : null } }, i.erase ? "Erase painted ground" : `Paint ground: ${name}`);
      let painted = 0;
      for (const v of cells) if (v) painted++;
      const km2 = Math.round(painted * g.scale * g.scale * doc.meta.kmPerPx * doc.meta.kmPerPx);
      return json({
        change: res.seq, ...(i.ground && !i.erase && { ground: i.ground }), painted_km2_on_map: km2,
        note: "The map is painted again in a moment (the server works the painting out with the climate). render_preview shows it in the Painted style.",
        ...(lock && { held: "Held to the DM's locked area." }),
      });
    },
  }),
] as const;

export const GROUND_TOOL_NAMES = GROUND_TOOLS.map((t) => t.name);
