/**
 * Claude's tools for a battlemap's object layers (core objectLayers.ts): named groups of objects drawn in order, hidden or locked together. Not the levels
 * (floors) of a battlemap: those are list_levels and the rest.
 */
import { z } from "zod";
import { type MapLayer, isBattle, layerCounts, newFeatureId } from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";

const layersOf = (ctx: ToolContext) => ctx.session().doc.features?.layers ?? [];
/** A layer by id or (any case) name. */
export function objectLayerBy(ctx: ToolContext, key: string): MapLayer | undefined {
  const k = key.trim().toLowerCase();
  return layersOf(ctx).find((l) => l.id === key) ?? layersOf(ctx).find((l) => l.name.trim().toLowerCase() === k);
}
const notBattle = (ctx: ToolContext) => (isBattle(ctx.session().doc) ? null : fail("Object layers are on battlemaps."));

export const OBJECT_LAYER_TOOLS = [
  define({
    name: "list_object_layers",
    description: "The open battlemap level's object layers, bottom to top (later ones are drawn over earlier ones): id, name, how many objects, hidden (drawn nowhere, not in exports) or locked. Objects in no layer are in the bottom one, \"Objects\".",
    schema: z.object({}),
    async run(ctx) {
      const bad = notBattle(ctx); if (bad) return bad;
      const f = ctx.session().doc.features, counts = layerCounts(f);
      return json({ bottom: { name: "Objects", objects: counts.get("") ?? 0 }, layers: layersOf(ctx).map((l) => ({ id: l.id, name: l.name, objects: counts.get(l.id) ?? 0, ...(l.hidden && { hidden: true }), ...(l.locked && { locked: true }) })) });
    },
  }),

  define({
    name: "add_object_layer",
    description: "Add an object layer on top of the others (a group of objects to show, hide or lock together: furniture, clutter, the room after a fire). Put objects in it with add_props' or update_prop's object_layer.",
    schema: z.object({ name: z.string().min(1).max(60) }),
    async run(ctx, i) {
      const bad = notBattle(ctx); if (bad) return bad;
      if (objectLayerBy(ctx, i.name)) return fail(`There is already a layer called "${i.name}".`);
      const l: MapLayer = { id: newFeatureId("h"), name: i.name.trim() };
      const r = ctx.execute({ op: "features", patch: { setLayers: [...layersOf(ctx), l] } }, `Add object layer ${l.name}`);
      return json({ change: r.seq, layer: l });
    },
  }),

  define({
    name: "update_object_layer",
    description: "Change an object layer: rename it, hide or show it (a hidden layer is drawn nowhere, exports included), lock or unlock it (a locked layer's objects can't be clicked in the editor), or move it up, down, to the top or the bottom of the order.",
    schema: z.object({
      layer: z.string().min(1).describe("Its name or id"),
      name: z.string().min(1).max(60).optional(), hidden: z.boolean().optional(), locked: z.boolean().optional(),
      move: z.enum(["up", "down", "top", "bottom"]).optional(),
    }),
    async run(ctx, i) {
      const bad = notBattle(ctx); if (bad) return bad;
      const l = objectLayerBy(ctx, i.layer);
      if (!l) return fail(`There is no object layer "${i.layer}". list_object_layers lists them.`);
      const next: MapLayer = { ...l, ...(i.name && { name: i.name.trim() }) };
      if (i.hidden !== undefined) { if (i.hidden) next.hidden = true; else delete next.hidden; }
      if (i.locked !== undefined) { if (i.locked) next.locked = true; else delete next.locked; }
      const list = layersOf(ctx).map((x) => (x.id === l.id ? next : x));
      if (i.move) {
        const at = list.findIndex((x) => x.id === l.id);
        list.splice(at, 1);
        const to = i.move === "top" ? list.length : i.move === "bottom" ? 0 : Math.max(0, Math.min(list.length, at + (i.move === "up" ? 1 : -1)));
        list.splice(to, 0, next);
      }
      const r = ctx.execute({ op: "features", patch: { setLayers: list } }, `Change object layer ${next.name}`);
      return json({ change: r.seq, layer: next, order_bottom_to_top: list.map((x) => x.name) });
    },
  }),

  define({
    name: "remove_object_layer",
    description: "Remove an object layer. Its objects are not removed: they go to the bottom layer.",
    schema: z.object({ layer: z.string().min(1).describe("Its name or id") }),
    async run(ctx, i) {
      const bad = notBattle(ctx); if (bad) return bad;
      const l = objectLayerBy(ctx, i.layer);
      if (!l) return fail(`There is no object layer "${i.layer}".`);
      const props = (ctx.session().doc.features?.props ?? []).filter((p) => p.layerId === l.id).map(({ layerId: _x, ...p }) => p);
      const r = ctx.execute({ op: "features", patch: { setLayers: layersOf(ctx).filter((x) => x.id !== l.id), ...(props.length && { upsertProps: props }) } }, `Remove object layer ${l.name}`);
      return json({ change: r.seq, removed: l.name, objects_moved_to_bottom: props.length });
    },
  }),
] as const;
