/**
 * Claude's tools for the user's asset library: find images, look at them, use textures as floors
 * and place objects on a battlemap. The pictures stay on the user's PC and are read in place.
 */
import { z } from "zod";
import { type MapProp,
  type PaletteEntry, type RGBAImage, type XY, boxResize, defaultTileSquares, drawLabel, newFeatureId, CUSTOM_MATERIAL_BASE, MAX_FLOOR_TEXTURES, PROP_PX_PER_SQUARE,
  SpotIndex, battleSpec, parseAssetId, scatterInArea, scatterLook, seededRandom, variantStem,
} from "@mapmaker/core";
import { decodeImage, encodeJpeg, toBase64 } from "./images.ts";
import type { ToolContext } from "./tools.ts";
import { objectLayerBy } from "./objectLayerTools.ts";
import { define, fail, json } from "./toolKit.ts";

const NO_ASSETS = "No asset folder is set up. The user can choose their assets folder in Dragon Drop's Settings.";
const squaresOf = (px: number | undefined) => (px ? Math.round((px / PROP_PX_PER_SQUARE) * 100) / 100 : undefined);

export const ASSET_TOOLS = [
  define({
    name: "search_assets",
    description:
      "Search the user's asset library (objects like furniture and trees, terrain textures for floors, walls, paths...; it can hold folders of pictures, zip files and asset packs). Results give an id to use with add_props or add_floor_texture, " +
      "the pack, the image size and its size in grid squares (pixels / 256). Use view_assets to see what they look like. The search matches names, pack names and tags (the packs' own, and words given with tag_assets). " +
      "only: favourites lists the pictures the DM starred (prefer those when they fit), recent the ones used most recently; a starred result says favourite: true.",
    schema: z.object({
      query: z.string().max(100).optional().describe("Words to look for, e.g. 'oak table' or 'torch'. All words must match"),
      category: z.enum(["objects", "terrain", "walls", "paths", "portals", "roofs", "patterns", "lights", "other"]).optional().describe("objects are things to place; terrain are floor textures"),
      pack: z.string().optional().describe("A pack key from an earlier result"),
      limit: z.number().int().min(1).max(40).optional().describe("Default 20"),
      offset: z.number().int().min(0).optional(),
      only: z.enum(["favourites", "recent"]).optional().describe("Only the DM's starred pictures, or the ones used most recently"),
    }),
    async run(ctx, i) {
      if (!ctx.assets) return fail(NO_ASSETS);
      const st = ctx.assets.status();
      const r = await ctx.assets.search({ q: i.query, cat: i.category, pack: i.pack, limit: i.limit ?? 20, offset: i.offset, ...(i.only && { only: i.only }) });
      return json({
        total: r.total, shown: r.items.length, ...(st.scanning && { note: `Still scanning the packs (${st.scanned}/${st.total}); results may be incomplete.` }),
        items: r.items.map((a) => ({ id: a.id, name: a.name, category: a.cat, pack: a.packName, ...(a.w && { px: [a.w, a.h], squares: [squaresOf(a.w), squaresOf(a.h)] }), ...(a.tags && { tags: a.tags }), ...(a.favourite && { favourite: true }) })),
      });
    },
  }),

  define({
    name: "view_assets",
    description: "Look at assets: a numbered contact sheet of up to 12 images (ids from search_assets), so you can pick the right ones before placing them.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(12), cell_size: z.number().int().min(80).max(300).optional().describe("Pixels per picture (default 160)") }),
    async run(ctx, i) {
      if (!ctx.assets) return fail(NO_ASSETS);
      const cell = i.cell_size ?? 160, cols = Math.min(4, i.ids.length), rows = Math.ceil(i.ids.length / cols), pad = 6, labelH = 12;
      const W = cols * (cell + pad) + pad, H = rows * (cell + pad + labelH) + pad;
      const sheet: RGBAImage = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
      for (let p = 0; p < W * H; p++) { const v = ((p % W >> 4) + (Math.floor(p / W) >> 4)) & 1 ? 34 : 28; sheet.data[p * 4] = v; sheet.data[p * 4 + 1] = v; sheet.data[p * 4 + 2] = v + 3; sheet.data[p * 4 + 3] = 255; }
      const missing: string[] = [];
      for (let n = 0; n < i.ids.length; n++) {
        const png = await ctx.assets.thumbnail(i.ids[n], cell);
        const img = png ? decodeImage(png) : null;
        const ox = pad + (n % cols) * (cell + pad), oy = pad + Math.floor(n / cols) * (cell + pad + labelH);
        if (!img) { missing.push(i.ids[n]); drawLabel(sheet, "?", ox + 4, oy + 4); continue; }
        const k = Math.min(1, cell / Math.max(img.w, img.h)), w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
        const px = k < 1 ? boxResize(img.data, img.w, img.h, w, h) : img.data;
        const x0 = ox + Math.floor((cell - w) / 2), y0 = oy + Math.floor((cell - h) / 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const s = (y * w + x) * 4, d = ((y0 + y) * W + x0 + x) * 4, a = px[s + 3] / 255;
          for (let c = 0; c < 3; c++) sheet.data[d + c] = sheet.data[d + c] * (1 - a) + px[s + c] * a;
        }
        const label = String(n + 1);
        drawLabel(sheet, label, ox + 3, oy + 3);
      }
      const jpg = encodeJpeg(sheet);
      const display = ctx.savePreview ? [await ctx.savePreview(jpg)] : undefined;
      const note = i.ids.map((id, n) => `${n + 1}: ${id}`).join("\n") + (missing.length ? `\n(couldn't show: ${missing.join(", ")})` : "");
      return { content: [{ type: "text", text: note }, { type: "image", mediaType: "image/jpeg", data: toBase64(jpg) }], display };
    },
  }),

  define({
    name: "tag_assets",
    description:
      "Give pictures of the asset library words for what they show (look at them first with view_assets): later searches, the DM's and yours, find them by these words. " +
      "Use it when a pack's names say little (asset_0001.png) or leave out what matters (a colour, a material, what the thing is): e.g. ['round table', 'oak', 'tavern']. " +
      "Words are added to any a picture has; they stay on the DM's PC, never in the packs. Up to 60 pictures a call, up to 12 words each.",
    schema: z.object({
      tags: z.array(z.object({ id: z.string().describe("An id from search_assets"), tags: z.array(z.string().min(1).max(40)).min(1).max(12) })).min(1).max(60),
    }),
    async run(ctx, i) {
      if (!ctx.assets?.tag) return fail(NO_ASSETS);
      const missing: string[] = [];
      for (const t of i.tags) if (!(await ctx.assets.info(t.id))) missing.push(t.id);
      const ok = i.tags.filter((t) => !missing.includes(t.id));
      const n = ok.length ? await ctx.assets.tag(ok) : 0;
      return json({ tagged: n, ...(missing.length && { not_found: missing, note: "These ids aren't in the library: use ids from search_assets." }) });
    },
  }),

  define({
    name: "add_floor_texture",
    description:
      "Add a terrain texture or a repeating pattern from the asset packs to this battlemap's floor materials. It then works as a material name in paint_floor and add_room. " +
      "squares is how many grid squares one repeat of the texture covers (default: its pixel width / 256, so a 1024 px texture repeats every 4 squares).",
    schema: z.object({
      asset: z.string().describe("An id from search_assets (category terrain, or patterns)"),
      name: z.string().min(1).max(40).optional().describe("The material name to use (default: the file's name)"),
      squares: z.number().min(0.5).max(32).optional(),
    }),
    async run(ctx, i) {
      if (!ctx.assets) return fail(NO_ASSETS);
      const info = await ctx.assets.info(i.asset);
      if (!info) return fail(`No asset ${i.asset}. Use search_assets.`);
      const spec = ctx.session().doc.meta.battle;
      if (!spec) return fail("This isn't a battlemap.");
      const palette = spec.palette ?? [];
      const existing = palette.find((e) => e.asset.toLowerCase() === info.id.toLowerCase());
      if (existing) return json({ name: existing.name, note: "Already added.", material: existing.name });
      if (palette.length >= MAX_FLOOR_TEXTURES) return fail(`This battlemap already has ${MAX_FLOOR_TEXTURES} floor textures.`);
      const name = i.name ?? info.name;
      if (palette.some((e) => e.name.toLowerCase() === name.toLowerCase())) return fail(`A floor texture called "${name}" already exists: choose another name.`);
      const entry: PaletteEntry = { id: Math.max(CUSTOM_MATERIAL_BASE - 1, ...palette.map((e) => e.id)) + 1, name, asset: info.id, squares: i.squares ?? defaultTileSquares(info.w) };
      const r = ctx.execute({ op: "set_meta", patch: { battle: { ...spec, palette: [...palette, entry] } }, label: `Add floor texture ${name}` });
      return json({ change: r.seq, material: name, repeats_every_squares: entry.squares, note: `Use it with paint_floor or add_room as material "${name}".` });
    },
  }),

  define({
    name: "add_props",
    description:
      "Place objects from the asset packs on the battlemap (furniture, trees, barrels, rubble...). Squares: x, y is the object's CENTRE. An object is as big as its image at 256 px per square times scale " +
      "(search_assets shows 'squares'). Rotation is degrees clockwise. layer 'above' (default) draws over walls, 'below' under them. Place several at once (up to 60); render_battlemap afterwards to check.",
    schema: z.object({
      props: z.array(z.object({
        asset: z.string().describe("An id from search_assets (category objects)"),
        x: z.number(), y: z.number(),
        rotation: z.number().optional(), scale: z.number().min(0.05).max(10).optional(), flip: z.boolean().optional(),
        layer: z.enum(["below", "above"]).optional(), opacity: z.number().min(0.05).max(1).optional(),
        object_layer: z.string().optional().describe("The object layer it goes into (name or id, list_object_layers); default the bottom one"),
        shadow: z.boolean().optional().describe("A soft drop shadow"), tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("#rrggbb: the colours multiplied by it (colours a grey picture)"),
        tint_strength: z.number().min(0).max(1).optional(),
      })).min(1).max(60),
    }),
    async run(ctx, i) {
      if (!ctx.assets) return fail(NO_ASSETS);
      const spec = ctx.session().doc.meta.battle;
      if (!spec) return fail("This isn't a battlemap.");
      const sizes = new Map<string, { w?: number; h?: number }>();
      const bad: string[] = [];
      for (const a of new Set(i.props.map((p) => p.asset))) {
        const info = await ctx.assets.info(a);
        if (info) sizes.set(a, { w: info.w, h: info.h }); else bad.push(a);
      }
      if (bad.length) return fail(`No such asset: ${bad.join(", ")}. Use search_assets for ids.`);
      const props = i.props.map((p) => ({
        id: newFeatureId("o"), asset: p.asset, x: p.x, y: p.y,
        ...(p.rotation && { rotation: p.rotation }), ...(p.scale && p.scale !== 1 && { scale: p.scale }), ...(p.flip && { flip: true }), ...(p.layer && p.layer !== "above" && { layer: p.layer }), ...(p.opacity && { opacity: p.opacity }),
        ...(p.shadow && { shadow: true }), ...(p.tint && { tint: p.tint }), ...(p.object_layer && objectLayerBy(ctx, p.object_layer) && { layerId: objectLayerBy(ctx, p.object_layer)!.id }), ...(p.tint && p.tint_strength !== undefined && p.tint_strength < 1 && { tintStrength: p.tint_strength }),
      }));
      const off = props.filter((p) => p.x < -1 || p.y < -1 || p.x > spec.squaresX + 1 || p.y > spec.squaresY + 1);
      if (off.length) return fail(`${off.length} object(s) are off the map (${spec.squaresX} x ${spec.squaresY} squares).`);
      const r = ctx.execute({ op: "features", patch: { upsertProps: props }, label: props.length === 1 ? "Add object" : `Add ${props.length} objects` });
      return json({ change: r.seq, added: props.map((p) => ({ id: p.id, asset: p.asset, footprint_squares: [squaresOf((sizes.get(p.asset)?.w ?? 0) * (p.scale ?? 1)), squaresOf((sizes.get(p.asset)?.h ?? 0) * (p.scale ?? 1))] })) });
    },
  }),

  define({
    name: "scatter_props",
    description:
      "Strew objects over an area of the battlemap, as a person does with the Object tool's Scatter mode: trees in a wood, rocks on a slope, debris in a ruin, " +
      "barrels in a storeroom. Spots fall naturally (never in rows), at least `spacing` squares from each other and from objects already there, and each object " +
      "is varied in size and turned (and mirrored) unless asked not to. With mix_variants (default true) a picture's variants in the same folder are mixed in " +
      "(\"Tree_A1\", \"Tree_A2\"...). Only on floor (never on void) unless on_floor_only is false. One edit, one undo step. Find pictures with search_assets " +
      "(category objects); render_battlemap afterwards to look.",
    schema: z.object({
      assets: z.array(z.string()).min(1).max(12).describe("Picture ids from search_assets (category objects); each spot takes one at random"),
      area: z.union([
        z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
        z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(3).max(100) }),
      ]).describe("Where, in squares: a rectangle (x, y = top-left corner) or an outline"),
      spacing: z.number().min(0.2).max(20).optional().describe("Squares between objects' centres (default 1.5)"),
      count: z.number().int().min(1).max(400).optional().describe("At most this many (default: as many as fit)"),
      scale: z.number().min(0.05).max(10).optional().describe("Their size (default 1, the picture's own)"),
      vary: z.number().min(0).max(0.8).optional().describe("How much sizes vary, either way (default 0.25 = 75% to 125%)"),
      turn: z.boolean().optional().describe("Turn and mirror each at random (default true; false keeps them upright)"),
      mix_variants: z.boolean().optional(),
      on_floor_only: z.boolean().optional(),
      layer: z.enum(["below", "above"]).optional(),
      shadow: z.boolean().optional().describe("Each object casts a soft drop shadow"),
      seed: z.number().int().optional().describe("The same seed gives the same spots"),
    }),
    async run(ctx, i) {
      if (!ctx.assets) return fail(NO_ASSETS);
      const doc = ctx.session().doc, spec = doc.meta.battle;
      if (!spec) return fail("This isn't a battlemap.");
      const bad: string[] = [];
      for (const a of i.assets) if (!(await ctx.assets.info(a))) bad.push(a);
      if (bad.length) return fail(`No such asset: ${bad.join(", ")}. Use search_assets for ids.`);
      const pics = i.mix_variants === false ? [...new Set(i.assets)] : await withVariants(ctx, i.assets);
      const poly: XY[] = "points" in i.area ? (i.area.points as XY[]) : [[i.area.x, i.area.y], [i.area.x + i.area.w, i.area.y], [i.area.x + i.area.w, i.area.y + i.area.h], [i.area.x, i.area.y + i.area.h]];
      const spacing = i.spacing ?? 1.5, sub = battleSpec(doc).sub, hf = doc.height;
      const taken = new SpotIndex(spacing, (doc.features?.props ?? []).map((p) => [p.x, p.y] as XY));
      const rnd = seededRandom(i.seed ?? Date.now());
      const onFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < spec.squaresX && y < spec.squaresY && (i.on_floor_only === false || (hf.get(Math.floor(x * sub), Math.floor(y * sub)) | 0) > 0);
      const spots = scatterInArea(poly, spacing, taken, rnd, { max: i.count ?? 400, ok: onFloor });
      if (!spots.length) return fail("No room there: the area is full (objects within the spacing), off the map, or not on floor. Try a smaller spacing or another area.");
      const props = spots.map(([x, y]) => {
        const look = scatterLook(rnd, { scale: i.scale ?? 1, vary: i.vary ?? 0.25, turn: i.turn !== false });
        return {
          id: newFeatureId("o"), asset: pics[Math.floor(rnd() * pics.length)], x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100,
          ...(look.rotation && { rotation: look.rotation }), ...(Math.abs(look.scale - 1) > 0.005 && { scale: Math.round(look.scale * 100) / 100 }), ...(look.flip && { flip: true }),
          ...(i.layer === "below" && { layer: "below" as const }), ...(i.shadow && { shadow: true }),
        };
      });
      const r = ctx.execute({ op: "features", patch: { upsertProps: props }, label: `Scatter ${props.length} object${props.length === 1 ? "" : "s"}` });
      return json({ change: r.seq, added: props.length, pictures_used: [...new Set(props.map((p) => p.asset))], note: "render_battlemap to look; remove_props takes any back." });
    },
  }),

  define({
    name: "update_prop",
    description: "Move, rotate, resize, mirror or re-layer an object on the battlemap, give it a drop shadow or a tint (a colour its picture is multiplied by; \"none\" takes it off). Ids come from list_battle.",
    schema: z.object({
      id: z.string(), x: z.number().optional(), y: z.number().optional(), rotation: z.number().optional(), scale: z.number().min(0.05).max(10).optional(),
      flip: z.boolean().optional(), layer: z.enum(["below", "above"]).optional(), opacity: z.number().min(0.05).max(1).optional(),
      shadow: z.boolean().optional(), tint: z.string().regex(/^(#[0-9a-fA-F]{6}|none)$/).optional(), tint_strength: z.number().min(0).max(1).optional(),
      object_layer: z.string().optional().describe("Move it to this object layer (name or id); \"\" for the bottom one"),
    }),
    async run(ctx, i) {
      const p = ctx.session().doc.features?.props?.find((x) => x.id === i.id);
      if (!p) return fail(`No object with id ${i.id}. Use list_battle.`);
      const { id: _id, shadow, tint, tint_strength, object_layer, ...patch } = i;
      const next: MapProp = { ...p, ...patch };
      if (object_layer !== undefined) {
        if (!object_layer) delete next.layerId;
        else { const l = objectLayerBy(ctx, object_layer); if (!l) return fail(`There is no object layer "${object_layer}".`); next.layerId = l.id; }
      }
      if (shadow !== undefined) { if (shadow) next.shadow = true; else delete next.shadow; }
      if (tint === "none") { delete next.tint; delete next.tintStrength; } else if (tint) next.tint = tint;
      if (tint_strength !== undefined && next.tint) next.tintStrength = tint_strength;
      const r = ctx.execute({ op: "features", patch: { upsertProps: [next] }, label: "Change object" });
      return json({ change: r.seq });
    },
  }),

  define({
    name: "remove_props",
    description: "Remove objects from the battlemap by id (from list_battle).",
    schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    async run(ctx, i) {
      const have = new Set((ctx.session().doc.features?.props ?? []).map((p) => p.id));
      const ids = i.ids.filter((x) => have.has(x));
      if (!ids.length) return fail("None of those ids exist. Use list_battle.");
      const r = ctx.execute({ op: "features", patch: { removeProps: ids }, label: `Remove ${ids.length} object(s)` });
      return json({ change: r.seq, removed: ids.length });
    },
  }),
] as const;

/** The asset tools that only make sense on a battlemap (search and view work anywhere). */
export const ASSET_BATTLE_TOOL_NAMES = ["add_floor_texture", "add_props", "scatter_props", "update_prop", "remove_props"];

/** The pictures and their variants in the same folder ("Tree_A1" brings "Tree_A2", "Tree_A3"...), at most 24. */
async function withVariants(ctx: ToolContext, ids: string[]): Promise<string[]> {
  const out = new Set(ids);
  for (const id of ids) {
    const a = parseAssetId(id);
    if (!a || !ctx.assets) continue;
    const want = variantStem(a.path);
    if (!want.stem) continue;
    const found = await ctx.assets.search({ pack: a.pack, q: want.stem, limit: 200 });
    for (const it of found.items) {
      const v = variantStem(it.path);
      if (v.dir === want.dir && v.stem === want.stem) out.add(it.id);
      if (out.size >= 24) break;
    }
  }
  return [...out];
}

export type { ToolContext };
