/**
 * Claude's tools for named rivers and lakes and for carving valleys (water model stages 2 and 3, core waterNames.ts and carve.ts). The rivers are worked out from the land
 * and the rain, never drawn: a name is pinned to a spot on its river (or inside its lake) and follows that river when the land changes. Names are canon: only the DM's.
 */
import { z } from "zod";
import {
  type LakeShape, type MapLabel, type NamedWater, type RiverNet, type WaterName, HeightField, WATER_NAME_REACH, cropScale, drawRivers, newFeatureId, pointInPolygon, renderFull,
  riverList, waterAt, namedWaterAt,
} from "@mapmaker/core";
import type { ToolContext, ToolDef, ToolResult } from "./tools.ts";
import { encodeJpeg, toBase64 } from "./images.ts";

function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
const fail = (t: string): ToolResult => ({ ...text(t), isError: true });
const r1 = (n: number) => Math.round(n * 10) / 10;

type Water = { labels: MapLabel[]; named: NamedWater[]; lakes: LakeShape[]; net: RiverNet };

/** The water as it is now (the rivers worked out afresh first), or an error message. */
async function waterNow(ctx: ToolContext): Promise<Water | string> {
  if (!ctx.water) return "Named rivers and lakes aren't available in this session.";
  await ctx.derived?.();
  return ctx.water() ?? "The rivers haven't been worked out yet. Try again in a moment.";
}

const namesOf = (ctx: ToolContext): WaterName[] => ctx.session().doc.features?.waterNames ?? [];
const findName = (ctx: ToolContext, ref: string) => {
  const t = ref.trim().toLowerCase();
  return namesOf(ctx).find((w) => w.id === ref) ?? namesOf(ctx).find((w) => w.name.toLowerCase() === t);
};

/** What a name's river or lake is now, for answers. */
function factsOf(w: NamedWater | undefined) {
  if (!w) return {};
  if (!w.found) return { found: false, note: w.kind === "river" ? "No river runs past its spot now (the land or the rain changed). Rename it to a new spot or remove it." : "There is no lake at its spot now." };
  return w.kind === "river"
    ? { found: true, length_km: w.lengthKm, ends: w.end, ...(w.joins && { joins: w.joins }) }
    : { found: true, area_km2: w.areaKm2, outflow: w.outflow };
}

/** A point inside a lake's shore (its centre, or the middle of the shore's crossing through the centre's row). */
function insidePoint(l: LakeShape): [number, number] {
  if (pointInPolygon(l.x, l.y, l.outline)) return [r1(l.x), r1(l.y)];
  const xs: number[] = [], o = l.outline;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const [xi, yi] = o[i], [xj, yj] = o[j];
    if (yi > l.y !== yj > l.y) xs.push(xi + ((l.y - yi) / (yj - yi)) * (xj - xi));
  }
  xs.sort((a, b) => a - b);
  return xs.length >= 2 ? [r1((xs[0] + xs[1]) / 2), r1(l.y)] : [r1(o[0][0]), r1(o[0][1])];
}

export const WATER_TOOLS = [
  define({
    name: "name_water",
    description:
      "Name a river or a lake, or rename one. Only a name the DM gave or confirmed (names are canon). The rivers are worked out from the land and the rain, so a river's name is pinned to a spot on it " +
      "and follows that river when the land changes; the name is drawn along the river (or in the lake's middle) on the map, the phone page and exports. " +
      "To name: x, y in map px on the river (within 6 px) or inside the lake; list_waters gives a point on each of the biggest unnamed rivers and lakes, and get_selection the DM's selected point. " +
      "Below a junction the bigger river keeps its name, so a tributary's name ends where it joins. To rename: water (the name or id) and the new name; with x, y as well it moves to that spot.",
    schema: z.object({
      name: z.string().min(1).max(80).describe("The river's or lake's name, as the DM gave it"),
      x: z.number().optional(), y: z.number().optional(),
      kind: z.enum(["river", "lake"]).optional().describe("Which you mean when the point is in a lake that a river also runs through (default: the lake)"),
      water: z.string().optional().describe("Rename this one (its id or present name) instead of naming a new one"),
    }),
    async run(ctx, i) {
      const w = await waterNow(ctx);
      if (typeof w === "string") return fail(w);
      const existing = i.water ? findName(ctx, i.water) : undefined;
      if (i.water && !existing) return fail(`No river or lake is named "${i.water}". list_waters lists the names.`);
      let spot: WaterName;
      if (i.x !== undefined && i.y !== undefined) {
        const hit = waterAt(w.net.rivers, i.kind === "river" ? [] : w.lakes, i.x, i.y, WATER_NAME_REACH);
        if (!hit) return fail(`No river runs within ${WATER_NAME_REACH} px of (${Math.round(i.x)}, ${Math.round(i.y)}), and it isn't in a lake. list_waters gives a point on each of the biggest rivers; render_preview to look.`);
        if (i.kind === "lake" && hit.kind !== "lake") return fail("That point isn't inside a lake.");
        const already = namedWaterAt(w.named, w.net, hit);
        if (already && already.id !== existing?.id) return fail(`That ${already.kind} is already named ${already.name} (${already.id}). To rename it, give water: "${already.name}" and the new name.`);
        spot = { id: existing?.id ?? newFeatureId("w"), kind: hit.kind, name: i.name.trim(), x: r1(hit.kind === "lake" ? i.x : hit.x), y: r1(hit.kind === "lake" ? i.y : hit.y) };
      } else if (existing) {
        spot = { ...existing, name: i.name.trim() };
      } else return fail("Say where: x and y on the river or in the lake (or water, to rename one).");
      const label = existing ? (existing.name !== spot.name ? `Rename the ${spot.kind} ${existing.name} to ${spot.name}` : `Move the name of the ${spot.kind} ${spot.name}`) : `Name the ${spot.kind} ${spot.name}`;
      const res = ctx.execute({ op: "features", patch: { upsertWaterNames: [spot] }, label });
      const now = ctx.water?.()?.named.find((x) => x.id === spot.id);
      return json({ change: res.seq, [existing ? "renamed" : "named"]: spot, ...factsOf(now) });
    },
  }),

  define({
    name: "list_waters",
    description:
      "The named rivers and lakes (each with its length and where it ends, or its size), and the biggest rivers and lakes that have no name yet, each with a point to name it at (name_water). " +
      "Use it before naming, and to answer how long a river is or where it flows. It changes nothing.",
    schema: z.object({ unnamed: z.number().int().min(0).max(40).optional().describe("How many of the biggest unnamed rivers and lakes to list (default 12 each)") }),
    async run(ctx, i) {
      const w = await waterNow(ctx);
      if (typeof w === "string") return fail(w);
      const kmPx = ctx.session().doc.meta.kmPerPx, n = i.unnamed ?? 12;
      const named = namesOf(ctx).map((nm) => ({ id: nm.id, kind: nm.kind, name: nm.name, at: [nm.x, nm.y], ...factsOf(w.named.find((x) => x.id === nm.id)) }));
      const namedHeads = new Set(w.named.filter((x) => x.kind === "river" && x.found).map((x) => x.head));
      const namedLakes = new Set(w.named.filter((x) => x.kind === "lake" && x.found).map((x) => x.lake));
      const rivers = riverList(w.net, w.lakes).filter((r) => !namedHeads.has(r.head)).slice(0, n).map((r) => {
        const p = r.course.pts, mid = Math.floor(p.length / 4) * 2; // (a point halfway along it)
        return { length_km: Math.round(r.course.length * kmPx), point: [r1(p[mid]), r1(p[mid + 1])], from: [r1(p[0]), r1(p[1])], to: [r1(p[p.length - 2]), r1(p[p.length - 1])], ends: r.course.end === "open" ? "the sea or the map's edge" : r.course.end };
      });
      const lakes = w.lakes.map((l, li) => ({ l, li })).filter(({ li }) => !namedLakes.has(li)).sort((a, b) => b.l.areaKm2 - a.l.areaKm2).slice(0, n)
        .map(({ l }) => ({ area_km2: l.areaKm2, point: insidePoint(l), outflow: l.outflow }));
      return json({ named, unnamed_rivers: rivers, unnamed_lakes: lakes, notes: ["Name only with names the DM gave or confirmed.", "Points are map px; render_preview with markers at them to show the DM which one you mean."] });
    },
  }),

  define({
    name: "remove_water_name",
    description: "Take a river's or lake's name off the map (by its id or name). The river or lake itself stays: it is worked out from the land.",
    schema: z.object({ water: z.string() }),
    async run(ctx, i) {
      const nm = findName(ctx, i.water);
      if (!nm) return fail(`No river or lake is named "${i.water}". list_waters lists the names.`);
      const res = ctx.execute({ op: "features", patch: { removeWaterNames: [nm.id] }, label: `Remove the name of the ${nm.kind} ${nm.name}` });
      return json({ change: res.seq, removed: nm });
    },
  }),

  define({
    name: "carve_valleys",
    description:
      "Cut valleys into the land along the rivers as they are now: deeper and wider for bigger rivers, a narrow V where a river drops steeply, a broad flat floor where a big river crosses low flat ground (floodplains), " +
      "and a fan of new low land where a big river meets the sea over flat ground (deltas). It lowers land along every river on the whole map (it never raises land except the deltas) and the river beds never climb downstream. " +
      "Only when the DM asks for it, and look first with preview: true (the relief now and carved, side by side, nothing changed). Applying saves a checkpoint first and is one edit that undo takes back.",
    schema: z.object({
      strength: z.number().min(0).max(1).optional().describe("How deep and wide (default 0.5)"),
      floodplains: z.boolean().optional().describe("Broad flat valley floors for big rivers on low flat ground (default true)"),
      deltas: z.boolean().optional().describe("Fans of new land where big rivers meet the sea over flat ground (default true)"),
      preview: z.boolean().optional().describe("Only show what it would do (default false)"),
      region: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional().describe("Preview: crop to this area (map px)"),
    }),
    async run(ctx, i) {
      if (!ctx.carveValleys) return fail("Carving valleys isn't available in this session.");
      const r = await ctx.carveValleys({ strength: i.strength, floodplains: i.floodplains, deltas: i.deltas, preview: !!i.preview });
      const facts = { cells_lowered: r.lowered, deepest_cut_m: r.deepestM, delta_cells: r.deltaCells };
      if (!i.preview) return json({ ...facts, checkpoint: r.checkpoint, note: "Carved as one edit (undo takes it back; the checkpoint has the map as it was). The rivers recompute in a moment: render_preview and check_hydrology to look." });
      if (!r.heights) return fail("The preview couldn't be made.");
      // the relief now and carved, side by side, with the rivers as they are now
      const doc = ctx.session().doc, W = doc.height.w, H = doc.height.h;
      const rivers = (await ctx.derived?.())?.rivers ?? [];
      const region = i.region ? { x: Math.max(0, Math.round(i.region.x)), y: Math.max(0, Math.round(i.region.y)), w: Math.min(W, Math.round(i.region.w)), h: Math.min(H, Math.round(i.region.h)) } : { x: 0, y: 0, w: W, h: H };
      const side = (img: ReturnType<typeof renderFull>) => { const c = cropScale(img, region, 760); drawRivers(c.img, region, c.scale, rivers); return c.img; };
      const a = side(renderFull(doc)), b = side(renderFull({ meta: doc.meta, height: new HeightField(W, H, r.heights) }));
      const gap = 8, out = { w: a.w + gap + b.w, h: Math.max(a.h, b.h), data: new Uint8ClampedArray((a.w + gap + b.w) * Math.max(a.h, b.h) * 4).fill(255) };
      for (const [img, ox] of [[a, 0], [b, a.w + gap]] as const) for (let y = 0; y < img.h; y++) out.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), (y * out.w + ox) * 4);
      const jpg = encodeJpeg(out);
      const display = ctx.savePreview ? [await ctx.savePreview(jpg)] : undefined;
      return { content: [{ type: "text", text: `Preview only (nothing changed): the relief now (left) and carved (right), ${JSON.stringify(facts)}. Call again without preview to carve.` }, { type: "image", mediaType: "image/jpeg", data: toBase64(jpg) }], display };
    },
  }),
];

export const WATER_TOOL_NAMES = WATER_TOOLS.map((t) => t.name);
