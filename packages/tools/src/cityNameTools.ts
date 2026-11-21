/**
 * Claude's tools for the names on a city map: free labels (a district, a stretch of water, a landmark), which are the world map's labels placed in metres. Streets, buildings
 * and walls carry their own names (update_streets, update_buildings, update_city_walls). Names are the DM's canon: only names the DM gave or confirmed.
 */
import { z } from "zod";
import { CITY_LABEL_KINDS, type MapLabel, citySpec, cityLabelKind, isCity, newFeatureId } from "@mapmaker/core";
import type { ToolContext, ToolDef, ToolResult } from "./tools.ts";

function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
const fail = (t: string): ToolResult => ({ ...text(t), isError: true });

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

export const CITY_NAME_TOOL_NAMES: string[] = CITY_NAME_TOOLS.map((t) => t.name);
