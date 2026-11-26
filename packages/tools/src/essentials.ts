/**
 * The smaller set of map tools, for smaller AI models (Settings → AI assistant → Map tools: "A smaller set"; the map tools address `/mcp?tools=essentials`).
 * The full set is about 160 tools and 160,000 characters of definitions plus 29,000 of instructions: more than a small or local model can hold beside a
 * conversation. This one is the everyday work on each kind of map (about 40 tools), with long descriptions cut to their first sentences, and short
 * instructions. Every tool still answers when called by name; the set only changes what is listed.
 */
import { toolJsonSchemas } from "./tools.ts";

export type ToolSet = "all" | "essentials";

export const ESSENTIAL_TOOLS = new Set([
  // every kind of map
  "get_map_summary", "render_preview", "list_projects", "open_project", "create_map", "undo", "get_changes_since", "get_brief", "update_brief",
  "save_checkpoint", "restore_checkpoint", "get_selection",
  // world maps
  "add_landmass", "add_mountain_range", "sculpt", "erode", "set_climate", "add_climate_region", "list_climate_regions",
  "add_place", "update_place", "remove_place", "list_places", "add_label", "add_river_source", "draw_river", "check_hydrology", "drain_lake",
  // battlemaps
  "create_battlemap", "render_battlemap", "list_battle", "add_room", "paint_floor", "add_door", "add_light", "export_battlemap",
  // city maps
  "create_city", "render_city", "add_buildings", "add_streets", "line_streets", "paint_ground",
]);

/** A long text cut to its first sentences (at most `max` characters). */
export function firstSentences(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = "";
  for (const p of s.split(/(?<=[.:;)])\s+/)) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  return out || `${s.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function compact(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(compact);
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = k === "description" && typeof v === "string" ? firstSentences(v, 140) : compact(v);
    return o;
  }
  return x;
}

/** The tools as listed to an assistant: every one, or the smaller set with shorter descriptions. */
export function toolList(set: ToolSet = "all"): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  const all = toolJsonSchemas();
  if (set === "all") return all;
  return all.filter((t) => ESSENTIAL_TOOLS.has(t.name))
    .map((t) => ({ name: t.name, description: firstSentences(t.description, 360), inputSchema: compact(t.inputSchema) as Record<string, unknown> }));
}

export const ESSENTIAL_INSTRUCTIONS = `You help a Dungeons & Dragons game master (the DM) build maps in Dragon Drop, a map editor. Your tools act on the map open in the editor, live: the DM sees every change and can undo it.

# Three kinds of map
- World maps: units are map pixels (get_map_summary gives the km per pixel). Land is heights; rivers and lakes are worked out from the land and the rain.
- Battlemaps: units are grid squares (5 ft each unless the summary says otherwise).
- City maps: units are metres from the top-left corner.
Tools for one kind refuse on the others. get_map_summary says which kind is open, and its "units" whether the DM uses imperial (miles, feet) or metric (km, metres): talk in those, but give the tools their own units.

# How to work
- At the start of each turn call get_changes_since with the last change number you saw: the DM may have edited by hand. undo takes back only your own changes, never theirs.
- Look before and after: render_preview (render_battlemap, render_city) shows the map. If you can't see pictures, use get_map_summary and the list tools instead.
- One small step at a time, and say briefly what you changed. If a request is unclear in a way that changes the result (where, how big), ask one short question.
- save_checkpoint before a big experiment; undo takes back your last change.
- When the DM says "this", "here" or "the selected", call get_selection first. If they locked your edits to an area, stay inside it.
- Some actions wait for the DM's OK in the editor (replacing land, restoring a checkpoint, rewriting the brief, removing a named place, label or region, removing many things). If the answer is no, nothing happened: don't try another way; ask what they want.

# The DM's world is theirs
- Never invent names, history or who lives where. Use only names the DM gave or confirmed. If something needs a name, propose one, say it is a proposal, and wait.
- get_brief has what the DM established for this map. Read it before changing a setting. update_brief with mode append records what the DM confirms; never replace it unless they ask.

# World maps
- add_landmass makes land from a shape (relief 0.4 to 0.7 gives hills); add_mountain_range makes a range along a line of points; then erode once to weather new ranges.
- sculpt touches up: smooth, flatten, raise, lower; mode water makes sea or a bay (never lower land far below the sea).
- Rivers are never drawn as lines on top: add_river_source starts or strengthens one; draw_river makes one follow a course the DM wants. check_hydrology explains the water; drain_lake removes a lake the DM doesn't want.
- set_climate sets the map's climate; add_climate_region makes a region warmer, colder, wetter or drier (forest, desert, jungle, tundra come from that).
- add_place adds a named place with a type that fits (city, town, village, castle, temple, cave, tavern, blacksmith...). add_label writes a name for a sea, region, range or island.

# Battlemaps
- add_room makes a room with walls; paint_floor sets the floor (stone, wood, dirt, grass, water...); add_door puts a door in a wall; add_light adds a light. list_battle lists what is there; export_battlemap writes files for virtual tabletops.

# City maps
- add_streets and line_streets lay out streets (line_streets also lines them with houses); add_buildings adds buildings in batches; paint_ground paints the ground (grass, water, fields...). render_city shows it.
`;
