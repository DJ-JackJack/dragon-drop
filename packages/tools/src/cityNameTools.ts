/**
 * Claude's tools for the names on a city map: free labels (a district, a stretch of water, a landmark), which are the world map's labels placed in metres, and districts
 * (outlines with a name and a colour). Streets, buildings and walls carry their own names (update_streets, update_buildings, update_city_walls). Names are the DM's canon:
 * only names the DM gave or confirmed.
 */
import { z } from "zod";
import { CITY_LABEL_KINDS, type MapDistrict, type MapLabel, citySpec, cityLabelKind, cleanDistrict, districtColour, isCity, newFeatureId, pointInPolygon, polygonArea, polygonCentroid } from "@mapmaker/core";
import type { ToolContext, ToolDef, ToolResult } from "./tools.ts";
import { define, fail, json, text } from "./toolKit.ts";

function needCity(ctx: ToolContext): ToolResult | null {
  return isCity(ctx.session().doc) ? null : fail("This tool is for city maps, and the open project isn't one. On a world map, add_label names things.");
}
const featuresOf = (ctx: ToolContext) => ctx.session().doc.features ?? { places: [], labels: [] };
const Kind = z.enum(CITY_LABEL_KINDS.map((k) => k.id) as [string, ...string[]]).describe("district: a quarter or district (big spaced capitals); water: a harbour, river, lake or pond; landmark: a square, gate, garden or other small place");
const r1 = (n: number) => Math.round(n * 10) / 10;
const describe = (l: MapLabel) => ({ id: l.id, text: l.text, kind: cityLabelKind(l.kind), at: [r1(l.x), r1(l.y)], ...(l.size && l.size !== 1 && { size: l.size }), ...(l.angle && { angle: l.angle }) });

export const CITY_NAME_TOOLS: ToolDef<z.ZodType>[] = [
  define({
    name: "add_city_labels",
    description:
      "Put names on a city map (up to 50 per call, one edit): a district's name over its middle, a harbour's or river's name on the water, a square's or landmark's name beside it. x, y are the label's centre in metres; " +
      "angle turns it (degrees clockwise, to lie along a river or a long district); size scales it (1 is usual). A street, building or wall gets its name with update_streets, update_buildings or update_city_walls instead. " +
      "Names are canon: only names the DM gave or confirmed; never invent them.",
    schema: z.object({
      labels: z.array(z.object({
        text: z.string().min(1).max(80), x: z.number(), y: z.number(), kind: Kind.optional().describe("Default district"),
        angle: z.number().min(-180).max(180).optional(), size: z.number().min(0.3).max(4).optional(),
      })).min(1).max(50),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), added: MapLabel[] = [], errors: string[] = [];
      i.labels.forEach((l, n) => {
        if (l.x < 0 || l.y < 0 || l.x > sp.widthM || l.y > sp.heightM) { errors.push(`#${n + 1} (${l.text}): (${l.x}, ${l.y}) is outside the map, which is ${sp.widthM} x ${sp.heightM} m`); return; }
        const kind = CITY_LABEL_KINDS.find((k) => k.id === (l.kind ?? "district"))!.kind;
        added.push({ id: newFeatureId("l"), text: l.text.trim(), kind, x: r1(l.x), y: r1(l.y), ...(l.angle && { angle: Math.round(l.angle) }), ...(l.size && l.size !== 1 && { size: Math.round(l.size * 100) / 100 }) });
      });
      if (!added.length) return fail(`Nothing was added. ${errors.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertLabels: added } }, added.length === 1 ? `Name ${added[0].text}` : `Add ${added.length} names`);
      return json({ change: r.seq, added: added.map(describe), ...(errors.length && { skipped: errors }) });
    },
  }),

  define({
    name: "update_city_labels",
    description: "Change city labels by id (from list_city_labels): the text, kind, place (x, y metres), angle or size. One edit. Only names the DM gave or confirmed.",
    schema: z.object({
      changes: z.array(z.object({
        id: z.string(), text: z.string().min(1).max(80).optional(), kind: Kind.optional(), x: z.number().optional(), y: z.number().optional(),
        angle: z.number().min(-180).max(180).optional(), size: z.number().min(0.3).max(4).optional(),
      })).min(1).max(100),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), by = new Map(featuresOf(ctx).labels.map((l) => [l.id, l]));
      const out: MapLabel[] = [], skipped: string[] = [];
      for (const ch of i.changes) {
        const cur = by.get(ch.id);
        if (!cur) { skipped.push(`${ch.id}: no such label`); continue; }
        const x = ch.x ?? cur.x, y = ch.y ?? cur.y;
        if (x < 0 || y < 0 || x > sp.widthM || y > sp.heightM) { skipped.push(`${ch.id}: (${x}, ${y}) is outside the map`); continue; }
        const { angle: _a, size: _s, ...rest } = cur, angle = ch.angle ?? cur.angle, size = ch.size ?? cur.size;
        out.push({ ...rest, ...(ch.text && { text: ch.text.trim() }), ...(ch.kind && { kind: CITY_LABEL_KINDS.find((k) => k.id === ch.kind)!.kind }), x: r1(x), y: r1(y), ...(angle && { angle: Math.round(angle) }), ...(size && size !== 1 && { size }) });
      }
      if (!out.length) return fail(`Nothing changed. ${skipped.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertLabels: out } }, out.length === 1 ? `Change ${out[0].text}` : `Change ${out.length} names`);
      return json({ change: r.seq, changed: out.map(describe), ...(skipped.length && { skipped }) });
    },
  }),

  define({
    name: "list_city_labels",
    description: "List the names on the city: its labels (id, text, kind, where), and the streets, buildings and walls that have a name (id and name).",
    schema: z.object({}),
    async run(ctx) {
      const bad = needCity(ctx); if (bad) return bad;
      const f = featuresOf(ctx);
      return json({
        labels: f.labels.map(describe),
        named_streets: (f.streets ?? []).filter((s) => s.name).map((s) => ({ id: s.id, name: s.name })),
        named_buildings: (f.buildings ?? []).filter((b) => b.name).map((b) => ({ id: b.id, name: b.name, ...(b.kind && { kind: b.kind }) })),
        named_walls: (f.cityWalls ?? []).filter((w) => w.name).map((w) => ({ id: w.id, name: w.name })),
      });
    },
  }),

  define({
    name: "remove_city_labels",
    description: "Remove city labels by id (from list_city_labels). One edit; Undo brings them back. Only when the DM asks.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const have = new Set(featuresOf(ctx).labels.map((l) => l.id)), ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return text("No label matched; nothing was removed.");
      const r = ctx.execute({ op: "features", patch: { removeLabels: ids } }, `Remove ${ids.length} name${ids.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, removed: ids.length });
    },
  }),
];

const describeDistrict = (ctx: ToolContext, d: MapDistrict) => ({
  id: d.id, ...(d.name && { name: d.name }), colour: districtColour(d), points: d.points.length, hectares: Math.round(polygonArea(d.points) / 100) / 100,
  buildings: (featuresOf(ctx).buildings ?? []).filter((b) => { const [x, y] = polygonCentroid(b.points as [number, number][]); return pointInPolygon(x, y, d.points); }).length,
});
const Pt = z.tuple([z.number(), z.number()]);
const Colour = z.string().regex(/^#?[0-9a-fA-F]{6}$/).describe("#rrggbb; default one picked for it");

CITY_NAME_TOOLS.push(
  define({
    name: "add_city_districts",
    description:
      "Mark districts (quarters, wards) on a city map (up to 30 per call, one edit): each an outline (metres, its corners in order) with a name and, if wanted, a colour. They are drawn as a faint tint " +
      "with a dashed border, the name in big spaced capitals at the middle. Follow streets, walls, rivers or the land for their borders. Names are canon: only the DM's; a district may have no name yet.",
    schema: z.object({
      districts: z.array(z.object({ points: z.array(Pt).min(3).max(400), name: z.string().min(1).max(80).optional(), colour: Colour.optional() })).min(1).max(30),
    }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), added: MapDistrict[] = [], errors: string[] = [];
      i.districts.forEach((d, n) => { const c = cleanDistrict({ id: newFeatureId("r"), ...d }, sp); if ("error" in c) errors.push(`#${n + 1}: ${c.error}`); else added.push(c); });
      if (!added.length) return fail(`Nothing was added. ${errors.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertDistricts: added } }, added.length === 1 ? `Add district${added[0].name ? ` ${added[0].name}` : ""}` : `Add ${added.length} districts`);
      return json({ change: r.seq, added: added.map((d) => describeDistrict(ctx, d)), ...(errors.length && { skipped: errors }) });
    },
  }),
  define({
    name: "update_city_districts",
    description: "Change districts by id (from list_city_districts): the outline, the name (only the DM's; empty removes it) or the colour. One edit.",
    schema: z.object({ changes: z.array(z.object({ id: z.string(), points: z.array(Pt).min(3).max(400).optional(), name: z.string().max(80).optional(), colour: Colour.optional() })).min(1).max(50) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const sp = citySpec(ctx.session().doc), by = new Map((featuresOf(ctx).districts ?? []).map((d) => [d.id, d]));
      const out: MapDistrict[] = [], skipped: string[] = [];
      for (const ch of i.changes) {
        const cur = by.get(ch.id);
        if (!cur) { skipped.push(`${ch.id}: no such district`); continue; }
        const { name: _n, ...rest } = cur, name = ch.name === undefined ? cur.name : ch.name || undefined;
        const c = cleanDistrict({ ...rest, ...(ch.points && { points: ch.points }), ...(ch.colour && { colour: ch.colour }), ...(name && { name }) }, sp);
        if ("error" in c) skipped.push(c.error); else out.push(c);
      }
      if (!out.length) return fail(`Nothing changed. ${skipped.join("; ")}`);
      const r = ctx.execute({ op: "features", patch: { upsertDistricts: out } }, out.length === 1 ? `Change district${out[0].name ? ` ${out[0].name}` : ""}` : `Change ${out.length} districts`);
      return json({ change: r.seq, changed: out.map((d) => describeDistrict(ctx, d)), ...(skipped.length && { skipped }) });
    },
  }),
  define({
    name: "list_city_districts",
    description: "List the districts: id, name, colour, size (hectares) and how many buildings stand in each.",
    schema: z.object({}),
    async run(ctx) {
      const bad = needCity(ctx); if (bad) return bad;
      const ds = featuresOf(ctx).districts ?? [];
      return json({ total: ds.length, districts: ds.map((d) => describeDistrict(ctx, d)) });
    },
  }),
  define({
    name: "remove_city_districts",
    description: "Remove districts by id. One edit; Undo brings them back. Only when the DM asks.",
    schema: z.object({ ids: z.array(z.string()).min(1).max(100) }),
    async run(ctx, i) {
      const bad = needCity(ctx); if (bad) return bad;
      const have = new Set((featuresOf(ctx).districts ?? []).map((d) => d.id)), ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return text("No district matched; nothing was removed.");
      const r = ctx.execute({ op: "features", patch: { removeDistricts: ids } }, `Remove ${ids.length} district${ids.length === 1 ? "" : "s"}`);
      return json({ change: r.seq, removed: ids.length });
    },
  }),
);

export const CITY_NAME_TOOL_NAMES: string[] = CITY_NAME_TOOLS.map((t) => t.name);
