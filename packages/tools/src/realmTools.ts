/**
 * Claude's tools for realms (core realms.ts): the kingdoms, provinces and other territories of a world map, each a colour painted onto the land. Their names are
 * the DM's canon: a realm is added only under a name the DM gave, renaming or removing one asks the DM first (risky.ts).
 */
import { z } from "zod";
import {
  type MapRealm, REALM_COLOURS, decodeRealmCells, encodeRealmCells, isRealmColour, isWorld, newFeatureId, nextRealmNumber, paintRealmCells, realmAreas, realmGridOf, shapeContains,
} from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

type Pt = [number, number];
const pt = z.tuple([z.number(), z.number()]);

/** A realm by its id or (any case) its name. */
function realmBy(ctx: ToolContext, key: string): MapRealm | undefined {
  const realms = ctx.session().doc.features?.realms ?? [], k = key.trim().toLowerCase();
  return realms.find((r) => r.id === key) ?? realms.find((r) => r.name.trim().toLowerCase() === k);
}
const notWorld = (ctx: ToolContext) => (isWorld(ctx.session().doc) ? null : fail("Realms are painted on world maps."));

export const REALM_TOOLS = [
  define({
    name: "list_realms",
    description: "The realms of the world map (kingdoms, provinces and other territories the DM named, each a colour painted onto the land): id, name, colour, how big (km²), and whether its name is hidden or it is GM only.",
    schema: z.object({}),
    async run(ctx) {
      const bad = notWorld(ctx); if (bad) return bad;
      const doc = ctx.session().doc, realms = doc.features?.realms ?? [], areas = realmAreas(realmGridOf(doc), doc.meta.kmPerPx);
      return json({
        realms: realms.map((r) => ({ id: r.id, name: r.name, colour: r.colour, km2: Math.round(areas.get(r.n)?.km2 ?? 0), ...(r.hideName && { name_hidden: true }), ...(r.gmOnly && { gm_only: true }), ...(r.notes && { notes: r.notes }) })),
        ...(!realms.length && { note: "No realms yet. add_realm with a name the DM gave, then paint_realm." }),
      });
    },
  }),

  define({
    name: "add_realm",
    description: "Add a realm (a kingdom, province, barony...) to the world map, under a name the DM gave or confirmed, with a colour; then paint where it is with paint_realm. Its name is written on the map in its middle unless hidden.",
    schema: z.object({
      name: z.string().min(1).max(80).describe("Only a name the DM gave"),
      colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("#rrggbb; default the next of an atlas's muted colours"),
      gm_only: z.boolean().optional(),
    }),
    async run(ctx, i) {
      const bad = notWorld(ctx); if (bad) return bad;
      const realms = ctx.session().doc.features?.realms ?? [];
      if (realms.some((r) => r.name.trim().toLowerCase() === i.name.trim().toLowerCase())) return fail(`There is already a realm called "${i.name}".`);
      const n = nextRealmNumber(realms);
      if (n === null) return fail("A map can have at most 255 realms.");
      const r: MapRealm = { id: newFeatureId("r"), n, name: i.name.trim(), colour: i.colour ?? REALM_COLOURS[realms.length % REALM_COLOURS.length], ...(i.gm_only && { gmOnly: true }) };
      const res = ctx.execute({ op: "features", patch: { upsertRealms: [r] } }, `Add realm ${r.name}`);
      return json({ change: res.seq, realm: { id: r.id, name: r.name, colour: r.colour }, next: "paint_realm to paint where it is." });
    },
  }),

  define({
    name: "paint_realm",
    description:
      "Paint where a realm is on the world map (map px): inside an outline (`polygon`), a circle, or the outline of a closed border line or a climate region (`inside`: its id or name). " +
      "land_only (default true) leaves the sea and lakes' water out, so a realm stops at the coast by itself; only_empty keeps cells that belong to another realm. erase: take the realm off there instead (or, with no realm, every realm). One undo step. Look with render_preview.",
    schema: z.object({
      realm: z.string().optional().describe("Its name or id (none with erase: clears every realm there)"),
      polygon: z.array(pt).min(3).max(2000).optional(),
      circle: z.object({ x: z.number(), y: z.number(), r: z.number().positive() }).optional(),
      inside: z.string().optional().describe("A closed border line's or a climate region's id or name: paint inside its outline"),
      land_only: z.boolean().optional(),
      only_empty: z.boolean().optional(),
      erase: z.boolean().optional(),
    }),
    async run(ctx, i) {
      const bad = notWorld(ctx); if (bad) return bad;
      const session = ctx.session(), doc = session.doc, f = doc.features ?? { places: [], labels: [] };
      const r = i.realm ? realmBy(ctx, i.realm) : undefined;
      if (i.realm && !r) return fail(`There is no realm "${i.realm}". list_realms lists them; add_realm adds one.`);
      if (!r && !i.erase) return fail("Name the realm to paint.");
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
      const g = realmGridOf(doc), cells = decodeRealmCells(g);
      // (while the DM has locked Claude's edits to an area, only cells inside it change)
      const lock = session.editLock, before = lock ? cells.slice() : null;
      const changed = paintRealmCells(cells, g, {
        n: i.erase ? 0 : r!.n, ...(polygon ? { polygon } : { circle: i.circle }), ...(i.erase && r && { only: r.n }), onlyEmpty: !!i.only_empty,
        ...(i.land_only !== false && !i.erase && { landOnly: { heights: doc.height.data, w: doc.height.w, h: doc.height.h, seaLevel: doc.meta.seaLevel } }),
      });
      if (lock && before) for (let k = 0; k < cells.length; k++) {
        if (cells[k] === before[k]) continue;
        const x = ((k % g.w) + 0.5) * g.scale, y = (Math.floor(k / g.w) + 0.5) * g.scale;
        if (!shapeContains(lock.shape, x, y)) cells[k] = before[k];
      }
      if (!changed) return json({ changed: 0, note: "Nothing changed there (already painted, the sea with land_only, or another realm's with only_empty)." });
      const res = ctx.execute({ op: "features", patch: { setRealmCells: encodeRealmCells(g, cells) } }, i.erase ? `Erase ${r ? `realm ${r.name}` : "realms"}` : `Paint realm ${r!.name}`);
      const area = realmAreas(encodeRealmCells(g, cells), doc.meta.kmPerPx);
      return json({ change: res.seq, ...(r && { realm: r.name, km2: Math.round(area.get(r.n)?.km2 ?? 0) }), ...(lock && { note: "Held to the DM's locked area." }) });
    },
  }),

  define({
    name: "update_realm",
    description: "Change a realm: its name (only to one the DM gave; the DM is asked first), colour, whether its name is written on the map, GM only, notes.",
    schema: z.object({
      realm: z.string().min(1).describe("Its name or id"),
      name: z.string().min(1).max(80).optional(), colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      hide_name: z.boolean().optional(), gm_only: z.boolean().optional(), notes: z.string().max(2000).optional(),
    }),
    async run(ctx, i) {
      const bad = notWorld(ctx); if (bad) return bad;
      const r = realmBy(ctx, i.realm);
      if (!r) return fail(`There is no realm "${i.realm}".`);
      const next: MapRealm = { ...r, ...(i.name && { name: i.name.trim() }), ...(i.colour && isRealmColour(i.colour) && { colour: i.colour }), ...(i.notes !== undefined && { notes: i.notes }) };
      if (i.hide_name !== undefined) { if (i.hide_name) next.hideName = true; else delete next.hideName; }
      if (i.gm_only !== undefined) { if (i.gm_only) next.gmOnly = true; else delete next.gmOnly; }
      const res = ctx.execute({ op: "features", patch: { upsertRealms: [next] } }, `Change realm ${next.name}`);
      return json({ change: res.seq, realm: { id: next.id, name: next.name, colour: next.colour } });
    },
  }),

  define({
    name: "remove_realm",
    description: "Remove a realm and its painting from the world map (the DM is asked first: its name is canon). The land it covered belongs to nobody afterwards.",
    schema: z.object({ realm: z.string().min(1).describe("Its name or id") }),
    async run(ctx, i) {
      const bad = notWorld(ctx); if (bad) return bad;
      const r = realmBy(ctx, i.realm);
      if (!r) return fail(`There is no realm "${i.realm}".`);
      const doc = ctx.session().doc, g = realmGridOf(doc), cells = decodeRealmCells(g);
      for (let k = 0; k < cells.length; k++) if (cells[k] === r.n) cells[k] = 0;
      const res = ctx.execute({ op: "features", patch: { removeRealms: [r.id], setRealmCells: encodeRealmCells(g, cells) } }, `Remove realm ${r.name}`);
      return json({ change: res.seq, removed: r.name });
    },
  }),
] as const;

export const REALM_TOOL_NAMES = REALM_TOOLS.map((t) => t.name);
