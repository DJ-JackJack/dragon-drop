/**
 * What the AI assistant asks the DM about before doing it: replacing a whole map's land, moving the sea, putting a whole map back from a checkpoint, carving every
 * river, rewriting the brief, removing named things (places, labels, climate regions, river and lake names, districts: the DM's canon), and removing many things
 * at once. The DM answers in the editor (`ToolContext.confirm`; the hub's `askDm`). It is asked in code, not left to the instructions,
 * because a smaller model may not follow them, and text inside a map (a place's notes, the brief) could steer one. Most of these can be undone; the DM decides.
 *
 * `riskOf` gives the question as a plain sentence that starts with a verb ("Remove the place "Gate Town""), or null when the call needs no answer.
 */
import type { Features } from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";

/** Removing this many things in one call asks first, whatever they are. */
export const MANY_AT_ONCE = 25;

/** Every tool that can ask (a test keeps this list and `riskOf` in step). */
export const RISKY_TOOLS = new Set([
  "generate_terrain", "import_sketch", "set_sea_level", "restore_checkpoint", "copy_from_map", "carve_valleys", "update_brief", "drain_lake",
  "remove_place", "remove_label", "remove_climate_region", "remove_river_source", "remove_line", "remove_water_name",
  "remove_city_labels", "remove_city_districts", "remove_buildings", "remove_streets", "remove_city_walls",
  "remove_props", "remove_walls", "remove_lights", "remove_light_zones", "remove_notes", "remove_land", "remove_trees", "remove_connectors", "remove_roofs", "remove_paths",
  // renaming a named thing replaces the DM's canon as surely as removing it (added 2026-11-22)
  "update_place", "update_label", "update_climate_region", "name_water", "update_city_labels", "update_city_districts",
  // a prefab is the DM's own work, like a map (added 2026-11-23)
  "save_prefab",
  // the generators replace a level's floor and walls, or a settlement's streets and buildings (added 2026-11-23)
  "generate_dungeon", "generate_village",
  // realms are named canon too (added 2026-11-23)
  "remove_realm", "update_realm",
]);

/** Renaming `from` to `to` (both names): the question, or null when the name stays (or there was none). */
function renaming(what: string, from: string | undefined, to: unknown): string | null {
  if (typeof to !== "string" || !to.trim() || !from?.trim() || to.trim() === from.trim()) return null;
  return `Rename the ${what} ${q(from)} to ${q(to.trim())}`;
}

type Named = { id: string; name?: string; text?: string };
const q = (s: string) => `"${s}"`;
/** A thing by its id or (ignoring case) its name. */
function find<T extends Named>(list: T[] | undefined, key: string): T | undefined {
  const k = key.trim().toLowerCase();
  return list?.find((x) => x.id === key) ?? list?.find((x) => (x.name ?? x.text ?? "").trim().toLowerCase() === k);
}
function namesOf(list: Named[] | undefined, ids: string[]): string[] {
  const want = new Set(ids);
  return (list ?? []).filter((x) => want.has(x.id)).map((x) => x.name ?? x.text ?? "").filter((n) => n.trim());
}
function listed(names: string[]): string {
  const shown = names.slice(0, 4).map(q).join(", ");
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}
function hasLand(ctx: ToolContext): boolean {
  const d = ctx.session().doc, h = d.height.data, sea = d.meta.seaLevel;
  for (let i = 0; i < h.length; i += 7) if (h[i] > sea) return true;
  return false;
}
/** Removing by ids: asks when any of them is named (a name is canon), or when there are many. */
function removal(ids: string[], list: Named[] | undefined, one: string, many: string): string | null {
  const names = list ? namesOf(list, ids) : [];
  if (names.length) return `Remove ${ids.length === 1 ? `the ${one}` : `${ids.length} ${many}, among them`} ${listed(names)}`;
  if (ids.length >= MANY_AT_ONCE) return `Remove ${ids.length} ${many} at once`;
  return null;
}

export async function riskOf(ctx: ToolContext, name: string, input: unknown): Promise<string | null> {
  if (!RISKY_TOOLS.has(name)) return null;
  const i = (input ?? {}) as Record<string, unknown>;
  let f: Features;
  try { f = ctx.session().doc.features ?? { places: [], labels: [] }; } catch { return null; } // (no map open: the tool says so itself)
  const ids = Array.isArray(i.ids) ? (i.ids as string[]) : [];
  if (name === "remove_realm" || name === "update_realm") {
    const r = find(f.realms, String(i.realm ?? ""));
    if (!r) return null;
    return name === "remove_realm" ? `Remove the realm ${q(r.name)} and its painting` : renaming("realm", r.name, i.name);
  }
  if (name === "generate_dungeon") {
    const d = ctx.session().doc, n = (f.walls?.length ?? 0) + (f.lights?.length ?? 0);
    let floored = false;
    for (let k = 0; k < d.height.data.length && !floored; k += 3) floored = d.height.data[k] !== 0;
    return floored || n ? `Replace this level's floor, walls, doors and lights with a generated ${i.style === "cave" ? "cave" : "dungeon"}` : null;
  }
  if (name === "generate_village") {
    const n = (f.streets?.length ?? 0) + (f.buildings?.length ?? 0);
    return n ? `Replace this settlement's ${f.streets?.length ?? 0} streets and ${f.buildings?.length ?? 0} buildings with a generated village` : null;
  }
  if (name === "save_prefab") {
    if (i.replace !== true || typeof i.name !== "string" || !ctx.prefabs) return null;
    const k = i.name.trim().toLowerCase(), had = (await ctx.prefabs.list()).prefabs.find((p) => p.name.toLowerCase() === k);
    return had ? `Replace the saved prefab ${q(had.name)} (${had.what}) with this area` : null;
  }
  switch (name) {
    case "generate_terrain":
      return i.replace_existing && hasLand(ctx) ? `Replace all the land on this map with newly generated terrain (${String(i.template)})` : null;
    case "import_sketch":
      return i.replace_existing && hasLand(ctx) ? "Replace all the land on this map with terrain made from a sketch" : null;
    case "set_sea_level":
      return `Move the sea level to ${String(i.level_m)} m: every coast on the map moves`;
    case "restore_checkpoint":
      return `Put the whole map back as it was in the checkpoint ${q(String(i.name))}`;
    case "copy_from_map": {
      const what = (i.what as string[] | undefined) ?? [];
      if (!what.includes("terrain") && !what.includes("climate")) return null;
      const parts = [what.includes("terrain") && "the land", what.includes("climate") && "the climate settings"].filter(Boolean).join(" and ");
      return `Copy ${parts} of ${q(String(i.map))} over ${i.area && (i.area as { type?: string }).type !== "all" ? "an area of " : ""}this map`;
    }
    case "carve_valleys":
      if (i.preview) return null;
      return i.river ? `Carve a valley along the river ${q(String(i.river))}` : i.where === "selection" ? "Carve valleys along the rivers in your selection" : "Carve valleys along every river on the map";
    case "update_brief": {
      if (i.mode !== "replace") return null;
      const cur = await ctx.readBrief().catch(() => "");
      return cur.trim().length > 200 ? `Rewrite the whole brief (it has ${cur.length.toLocaleString("en")} characters now; the new one has ${String(i.text ?? "").length.toLocaleString("en")})` : null;
    }
    case "drain_lake":
      return typeof i.lake === "string" && i.lake.trim() ? `Drain the lake ${q(i.lake)}, which has a name` : null;
    case "remove_place": { const p = find(f.places, String(i.place)); return p ? `Remove the place ${q(p.name)}` : null; }
    case "remove_label": { const l = find(f.labels as Named[], String(i.label)); return l ? `Remove the label ${q(l.text ?? l.name ?? "")}` : null; }
    case "remove_climate_region": { const r = find(f.regions, String(i.region)); return r ? `Remove the climate region ${q(r.name)}` : null; }
    case "remove_river_source": {
      const s = f.sources?.find((x) => x.id === i.source) ?? find(f.sources as Named[] | undefined, String(i.source));
      const placed = s && "placeId" in s && s.placeId ? f.places.find((p) => p.id === s.placeId)?.name : undefined;
      return s ? `Remove the river source${s.name ? ` of the river ${q(s.name)}` : placed ? ` at ${q(placed)}` : ""}` : null;
    }
    case "remove_line": { const l = find(f.lines as Named[] | undefined, String(i.line)); return l?.name ? `Remove the road or border ${q(l.name)}` : null; }
    case "remove_water_name": { const w = find(f.waterNames, String(i.water)); return w ? `Remove the name ${q(w.name)} from its river or lake` : null; }
    case "remove_city_labels": { const n = namesOf(f.labels as Named[], ids); return `Remove ${ids.length === 1 ? "the name" : `${ids.length} names`}${n.length ? ` ${listed(n)}` : ""}`; }
    case "remove_city_districts": { const n = namesOf(f.districts, ids); return `Remove ${ids.length === 1 ? "the district" : `${ids.length} districts`}${n.length ? ` ${listed(n)}` : ""}`; }
    case "remove_buildings":
      if (i.region) return "Remove every building in an area";
      return removal(ids, f.buildings, "building", "buildings");
    case "remove_streets": return removal(ids, f.streets, "street", "streets");
    case "remove_city_walls": return removal(ids, f.cityWalls, "town wall", "town walls");
    case "remove_props": return removal(ids, undefined, "object", "objects");
    case "remove_walls": return removal(ids, undefined, "wall", "walls, doors and windows");
    case "remove_lights": return removal(ids, undefined, "light", "lights");
    case "remove_light_zones": return removal(ids, undefined, "light zone", "light zones");
    case "remove_notes": return removal(ids, undefined, "note", "notes");
    case "remove_land": return removal(ids, undefined, "landform", "landforms");
    case "remove_trees": return removal(ids, undefined, "group of trees", "groups of trees");
    case "remove_connectors": return removal(ids, undefined, "stair, ladder or hole", "stairs, ladders and holes");
    case "remove_roofs": return removal(ids, undefined, "roof", "roofs");
    case "remove_paths": return removal(ids, f.paths, "path", "paths");
    case "update_place": return renaming("place", find(f.places, String(i.place))?.name, i.name);
    case "update_label": { const l = find(f.labels as Named[], String(i.label)); return renaming("label", l?.text ?? l?.name, i.text); }
    case "update_climate_region": return renaming("climate region", find(f.regions, String(i.region))?.name, i.name);
    case "name_water": return typeof i.water === "string" && i.water.trim() ? renaming("water", find(f.waterNames, i.water)?.name, i.name) : null;
    case "update_city_labels":
    case "update_city_districts": {
      const list = (name === "update_city_labels" ? f.labels : f.districts) as Named[] | undefined;
      const changes = Array.isArray(i.changes) ? (i.changes as { id?: string; text?: string; name?: string }[]) : [];
      const renamed = changes.map((c) => { const was = list?.find((x) => x.id === c.id); return renaming(name === "update_city_labels" ? "name" : "district", was?.text ?? was?.name, name === "update_city_labels" ? c.text : c.name); }).filter((s): s is string => !!s);
      return renamed.length === 0 ? null : renamed.length === 1 ? renamed[0] : `${renamed.length} renamings: ${renamed.slice(0, 3).join("; ")}${renamed.length > 3 ? " and more" : ""}`;
    }
  }
  return null;
}

/** What the tool answers when the DM didn't allow it (or wasn't there to answer). */
export function refusal(answer: "refused" | "timeout" | "nobody", what: string): string {
  if (answer === "refused") return `The DM said no to this: ${what}. Don't try it another way: ask them what they want instead.`;
  if (answer === "timeout") return `This needs the DM's OK and they didn't answer in time: ${what}. Nothing was changed. Ask them in words, then try again when they're there.`;
  return `This needs the DM's OK in the Dragon Drop window, and it isn't open: ${what}. Nothing was changed.`;
}
