/**
 * Claude's tools for the paths of a battlemap: roads, tracks and streams on the ground (below objects and walls), a line of points in squares with a
 * width, made of a look (dirt, gravel, cobblestones, a stream) or a picture from the asset packs laid along it. A path is only paint: it blocks nothing.
 */
import { z } from "zod";
import { type MapPath, PATH_LOOKS, type PathLook, battleSpec, newFeatureId } from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

const Look = z.enum(PATH_LOOKS as [string, ...string[]]).describe("What it is made of when no pack picture is given: dirt (the default: a track), gravel, cobble (a paved road or street) or water (a stream)");
const Asset = z.string().min(1).describe(
  "A path picture from the DM's asset packs, laid along it: an id from search_assets (category paths: a long strip runs along the path; or a square texture from category terrain, tiled along it). Prefer one when the packs have a fitting road, track or stream",
);
const XY = z.tuple([z.number(), z.number()]);
const pathsOf = (ctx: ToolContext) => ctx.session().doc.features?.paths ?? [];
const round = (n: number) => Math.round(n * 100) / 100;
const describe = (p: MapPath) => ({ id: p.id, ...(p.name && { name: p.name }), look: p.look ?? "dirt", ...(p.asset && { asset: p.asset }), width: p.width ?? 1, points: p.points.map(([x, y]) => [round(x), round(y)]) });

function boundsError(ctx: ToolContext, pts: [number, number][]): string | null {
  const sp = battleSpec(ctx.session().doc);
  const bad = pts.find(([x, y]) => x < -0.01 || y < -0.01 || x > sp.squaresX + 0.01 || y > sp.squaresY + 0.01);
  return bad ? `The point (${bad[0]}, ${bad[1]}) is outside the map, which is ${sp.squaresX} x ${sp.squaresY} squares.` : null;
}

async function assetError(ctx: ToolContext, asset: string): Promise<string | null> {
  if (!ctx.assets) return "There's no asset library set up (Settings), so there are no path pictures: give look instead.";
  return (await ctx.assets.info(asset)) ? null : `No asset has the id "${asset}". Find one with search_assets (category paths).`;
}

export const PATH_TOOLS = [
  define({
    name: "add_path",
    description:
      "Add a road, track or stream across the battlemap (on the active level): a line of points in squares, rounded at its corners, width squares across (default 1), " +
      "drawn on the ground under objects and walls. look: dirt (default), gravel, cobble or water; or asset, a picture from the asset packs laid along it. A path is only paint: " +
      "it doesn't block movement (a river that should, needs walls or invisible walls too). render_battlemap to check.",
    schema: z.object({
      points: z.array(XY).min(2).max(200),
      width: z.number().min(0.25).max(12).optional(),
      look: Look.optional(),
      asset: Asset.optional(),
      name: z.string().max(60).optional().describe("Only a name the DM gave"),
    }),
    async run(ctx, i) {
      const pts = i.points.map(([x, y]) => [x, y] as [number, number]);
      const bad = boundsError(ctx, pts);
      if (bad) return fail(bad);
      if (i.asset) { const e = await assetError(ctx, i.asset); if (e) return fail(e); }
      const path: MapPath = { id: newFeatureId("k"), points: pts, ...(i.width && i.width !== 1 && { width: i.width }), ...(i.look && i.look !== "dirt" && { look: i.look as PathLook }), ...(i.asset && { asset: i.asset }), ...(i.name && { name: i.name }) };
      const r = ctx.execute({ op: "features", patch: { upsertPaths: [path] }, label: `Add ${i.name ?? "path"}` });
      return json({ change: r.seq, path: describe(path) });
    },
  }),

  define({
    name: "update_path",
    description: "Change a path (ids from list_paths): its points, width, look, or picture (asset: null takes the picture off, and its look shows again).",
    schema: z.object({
      id: z.string(),
      points: z.array(XY).min(2).max(200).optional(),
      width: z.number().min(0.25).max(12).optional(),
      look: Look.optional(),
      asset: Asset.nullable().optional(),
    }),
    async run(ctx, i) {
      const p = pathsOf(ctx).find((x) => x.id === i.id);
      if (!p) return fail(`No path with id ${i.id}. Use list_paths.`);
      const pts = i.points?.map(([x, y]) => [x, y] as [number, number]);
      if (pts) { const bad = boundsError(ctx, pts); if (bad) return fail(bad); }
      if (i.asset) { const e = await assetError(ctx, i.asset); if (e) return fail(e); }
      const next: MapPath = { ...p, ...(pts && { points: pts }), ...(i.width && { width: i.width }), ...(i.look && { look: i.look as PathLook }), ...(i.asset && { asset: i.asset }) };
      if (i.asset === null) delete next.asset;
      const r = ctx.execute({ op: "features", patch: { upsertPaths: [next] }, label: `Change ${next.name ?? "path"}` });
      return json({ change: r.seq, path: describe(next) });
    },
  }),

  define({
    name: "list_paths",
    description: "The paths (roads, tracks, streams) on the active level: ids, looks, pictures, widths and points.",
    schema: z.object({}),
    async run(ctx) {
      return json({ paths: pathsOf(ctx).map(describe) });
    },
  }),

  define({
    name: "remove_paths",
    description: "Remove paths by id (from list_paths).",
    schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    async run(ctx, i) {
      const have = new Set(pathsOf(ctx).map((p) => p.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids are paths here. Use list_paths.");
      const r = ctx.execute({ op: "features", patch: { removePaths: ids }, label: `Remove ${ids.length} path(s)` });
      return json({ change: r.seq, removed: ids.length });
    },
  }),
];
