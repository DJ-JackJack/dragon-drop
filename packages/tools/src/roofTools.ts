/**
 * Claude's tools for the roofs of a battlemap: an area over the level being worked on, drawn in one of four looks or from an asset-pack picture. A roof hides the rooms under it
 * when it is shown, so previews leave roofs out unless asked; in a Foundry scene each roof becomes a tile with a ceiling region, fading when a token stands under it.
 */
import { z } from "zod";
import { type MapRoof, ROOF_STYLES, battleSpec, newFeatureId, roofColour } from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

const Style = z.enum(ROOF_STYLES as [string, ...string[]]);
const Colour = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "A colour like #4a7a8c");
const roofsOf = (ctx: ToolContext) => ctx.session().doc.features?.roofs ?? [];
const round = (n: number) => Math.round(n * 100) / 100;
const describe = (r: MapRoof) => ({ id: r.id, ...(r.name && { name: r.name }), style: r.style, ...(r.asset && { asset: r.asset, tile: r.tile ?? 2 }), ...(r.colour && { colour: r.colour }), ...(r.flat && { flat: true }), points: r.points.map(([x, y]) => [round(x), round(y)]) });

/** An error message when a point is outside the map, else null. */
function boundsError(ctx: ToolContext, pts: [number, number][]): string | null {
  const sp = battleSpec(ctx.session().doc);
  const bad = pts.find(([x, y]) => x < 0 || y < 0 || x > sp.squaresX || y > sp.squaresY);
  return bad ? `The point (${bad[0]}, ${bad[1]}) is outside the map, which is ${sp.squaresX} x ${sp.squaresY} squares.` : null;
}

/** A picture from the asset library: an error message when there isn't one by that id. */
async function assetError(ctx: ToolContext, asset: string): Promise<string | null> {
  if (!ctx.assets) return "There is no asset library set up, so a roof can't use a picture from it.";
  const a = await ctx.assets.info(asset);
  return a ? null : `No asset has the id "${asset}". Find one with search_assets (a roof texture usually lives in a folder called Roofs, Textures or Floors).`;
}

export const ROOF_TOOLS = [
  define({
    name: "add_roof",
    description:
      "Add a roof over the level being worked on, as a rectangle (rect: x, y the top-left corner, w, h in squares) or any outline (points: three or more [x, y] corners in squares). Draw it a little wider than the walls so it overhangs. " +
      "style is slate (blue-grey), tile (red clay), thatch (straw) or shingle (wood); colour (#rrggbb) replaces the style's own; flat: true gives no ridge (a pitched roof, with its ridge the longer way, is the default). " +
      "Or give asset (an id from search_assets) to tile that picture across the roof, tile squares per repeat (default 2). Roofs hide what is under them: render_battlemap leaves them out unless you pass roofs: true. " +
      "Only add roofs when the DM asks for them. In a Foundry scene each roof becomes a tile that fades while a token stands under it; roofs are never in the ordinary picture or the Universal VTT file.",
    schema: z.object({
      rect: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(),
      points: z.array(z.array(z.number()).length(2)).min(3).max(64).optional(),
      style: Style.optional().describe("Default slate"),
      colour: Colour.optional(),
      flat: z.boolean().optional(),
      asset: z.string().optional().describe("An asset id to tile across the roof"),
      tile: z.number().min(0.25).max(20).optional().describe("Squares one repeat of the asset picture covers (default 2)"),
      name: z.string().min(1).max(60).optional().describe("Only a name the DM gave"),
    }),
    async run(ctx, i) {
      if ((!i.rect && !i.points) || (i.rect && i.points)) return fail("Give either rect or points, not both and not neither.");
      const points = (i.rect ? [[i.rect.x, i.rect.y], [i.rect.x + i.rect.w, i.rect.y], [i.rect.x + i.rect.w, i.rect.y + i.rect.h], [i.rect.x, i.rect.y + i.rect.h]] : i.points!.map(([x, y]) => [x, y])) as [number, number][];
      const err = boundsError(ctx, points) ?? (i.asset ? await assetError(ctx, i.asset) : null);
      if (err) return fail(err);
      const roof: MapRoof = {
        id: newFeatureId("f"), points, style: (i.style ?? "slate") as MapRoof["style"], ...(i.asset && { asset: i.asset }), ...(i.tile && { tile: i.tile }),
        ...(i.colour && { colour: `#${i.colour.replace("#", "").toLowerCase()}` }), ...(i.flat && { flat: true }), ...(i.name && { name: i.name }),
      };
      const r = ctx.execute({ op: "features", patch: { upsertRoofs: [roof] }, label: `Add roof${i.name ? ` ${i.name}` : ""}` });
      return json({ change: r.seq, roof: describe(roof) });
    },
  }),

  define({
    name: "update_roof",
    description: "Change a roof of this level: its look, colour, picture, pitch, name or outline (ids from list_roofs or list_battle).",
    schema: z.object({
      id: z.string(),
      style: Style.optional(),
      colour: z.union([Colour, z.literal("")]).optional().describe("An empty string goes back to the style's own colour"),
      flat: z.boolean().optional(),
      asset: z.string().optional().describe("An asset id to tile across the roof; an empty string stops using a picture"),
      tile: z.number().min(0.25).max(20).optional(),
      name: z.string().max(60).optional().describe("An empty string removes the name"),
      rect: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(),
      points: z.array(z.array(z.number()).length(2)).min(3).max(64).optional(),
    }),
    async run(ctx, i) {
      const cur = roofsOf(ctx).find((r) => r.id === i.id);
      if (!cur) return fail("No roof on this level has that id. Use list_roofs (it lists this level's only).");
      if (i.rect && i.points) return fail("Give either rect or points, not both.");
      const next: MapRoof = { ...cur };
      if (i.style) next.style = i.style as MapRoof["style"];
      if (i.flat !== undefined) { if (i.flat) next.flat = true; else delete next.flat; }
      if (i.tile !== undefined) next.tile = i.tile;
      if (i.colour !== undefined) { if (i.colour && roofColour(i.colour)) next.colour = `#${i.colour.replace("#", "").toLowerCase()}`; else delete next.colour; }
      if (i.name !== undefined) { if (i.name.trim()) next.name = i.name.trim(); else delete next.name; }
      if (i.asset !== undefined) {
        if (i.asset) { const e = await assetError(ctx, i.asset); if (e) return fail(e); next.asset = i.asset; } else { delete next.asset; delete next.tile; }
      }
      if (i.rect) next.points = [[i.rect.x, i.rect.y], [i.rect.x + i.rect.w, i.rect.y], [i.rect.x + i.rect.w, i.rect.y + i.rect.h], [i.rect.x, i.rect.y + i.rect.h]];
      if (i.points) next.points = i.points.map(([x, y]) => [x, y] as [number, number]);
      const err = boundsError(ctx, next.points);
      if (err) return fail(err);
      const r = ctx.execute({ op: "features", patch: { upsertRoofs: [next] }, label: `Change roof${next.name ? ` ${next.name}` : ""}` });
      return json({ change: r.seq, roof: describe(next) });
    },
  }),

  define({
    name: "remove_roofs",
    description: "Remove roofs of this level by id.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(100) }),
    async run(ctx, i) {
      const have = new Set(roofsOf(ctx).map((r) => r.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids is a roof of this level. Use list_roofs.");
      const r = ctx.execute({ op: "features", patch: { removeRoofs: ids }, label: `Remove ${ids.length} roof(s)` });
      return json({ change: r.seq, removed: ids, not_found: i.ids.filter((id) => !have.has(id)) });
    },
  }),

  define({
    name: "list_roofs",
    description: "The roofs of the level being worked on: id, look, colour, picture, outline in squares. Other levels' are listed after switching to them.",
    schema: z.object({}),
    async run(ctx) {
      return json({ roofs: roofsOf(ctx).map(describe) });
    },
  }),
] as const;
