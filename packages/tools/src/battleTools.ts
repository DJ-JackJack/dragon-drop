/**
 * Claude's tools for battlemaps (grid-based tabletop maps): floors, rooms, walls, doors, lights,
 * previews and exports for virtual tabletops. All coordinates here are grid SQUARES, origin top-left.
 */
import { z } from "zod";
import {
  type MapAmbientZone, type MapLight, type MapNote, type MapWall, type RGBAImage, type Rect, type Shape, LIGHT_PRESETS, LIGHT_PRESET_NAMES, MATERIALS, ambientOf, applyLightPreset, battleSizeError, battleSpec, circlePolygon, cropScale, drawLabel, insertDoor,
  connectorTo, lightPresetName, nextNoteNumber, readingOrderNumbers, sortedNotes,
  materialByName, newFeatureId, renderBattle, roomWalls, textWidth, wallSegments, wallsAroundFloor, BATTLE_EXPORT_FORMATS, WALL_LOOKS, type WallStyle, portalOf, wallStyleOf,
} from "@mapmaker/core";
import { encodeJpeg, toBase64 } from "./images.ts";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";
import { LEVEL_TOOLS } from "./levelTools.ts";
import { ROOF_TOOLS } from "./roofTools.ts";
import { PREFAB_TOOLS } from "./prefabTools.ts";
import { PATH_TOOLS } from "./pathTools.ts";
import { traceOverlay } from "./traceTools.ts";

const XY = z.array(z.number()).length(2).describe("[x, y] in grid squares");
const MaterialNames = MATERIALS.map((m) => m.name) as [string, ...string[]];
const MaterialSchema = z.string().min(1).max(80).describe(`Floor material: one of ${MaterialNames.join(", ")}, or the name of a pack floor texture added with add_floor_texture`);
const WallKindSchema = z.enum(["wall", "door", "secret", "window", "invisible"]);
const WallLookSchema = z.enum(WALL_LOOKS as [string, ...string[]]).describe("What the walls are built of when no pack picture is given: stone (the default), brick, wood, plaster, or rock (a cave)");
const WallAssetSchema = z.string().min(1).describe(
  "A picture from the DM's asset packs to draw the walls with: an id from search_assets (category walls: a long strip, laid along the wall; or a square texture such as bricks from category terrain, tiled along it). Prefer one when the packs have a fitting wall",
);

/** The wall style a call asks for, its pack picture checked; or a message why not. */
async function wallStyleFrom(ctx: ToolContext, i: { wall_look?: string; wall_asset?: string; wall_tile?: number }): Promise<WallStyle | string> {
  if (i.wall_asset) {
    if (!ctx.assets) return "There's no asset library set up (Settings), so there are no wall pictures: give wall_look instead.";
    const info = await ctx.assets.info(i.wall_asset);
    if (!info) return `No asset has the id "${i.wall_asset}". Find one with search_assets (category walls).`;
  }
  return wallStyleOf({ ...(i.wall_look && { look: i.wall_look as WallStyle["look"] }), ...(i.wall_asset && { asset: i.wall_asset }), ...(i.wall_tile && { tile: i.wall_tile }) });
}
const PortalPictureSchema = z.string().min(1).describe(
  "A door or window picture from the DM's asset packs, drawn in the opening instead of the built-in wooden door or glass: an id from search_assets (category portals). Prefer one when the packs have a fitting door or window",
);
/** A door or window picture, checked against the library; or a message why not. */
async function portalFrom(ctx: ToolContext, picture: string | undefined): Promise<string | undefined | { problem: string }> {
  if (!picture) return undefined;
  if (!ctx.assets) return { problem: "There's no asset library set up (Settings), so there are no door or window pictures: leave picture out for the built-in look." };
  if (!(await ctx.assets.info(picture))) return { problem: `No asset has the id "${picture}". Find one with search_assets (category portals).` };
  return picture;
}
const GlowSchema = z.string().min(1).describe(
  "A light picture from the DM's asset packs giving the light its shape (a soft glow, light through a window): an id from search_assets (category lights). Its brightness, tinted with the light's colour, replaces the round fall-off",
);
async function glowFrom(ctx: ToolContext, picture: string | undefined): Promise<string | undefined | { problem: string }> {
  if (!picture) return undefined;
  if (!ctx.assets) return { problem: "There's no asset library set up (Settings), so there are no light pictures: leave glow out for the round fall-off." };
  if (!(await ctx.assets.info(picture))) return { problem: `No asset has the id "${picture}". Find one with search_assets (category lights).` };
  return picture;
}
const WallStyleFields = {
  wall_look: WallLookSchema.optional(),
  wall_asset: WallAssetSchema.optional(),
  wall_tile: z.number().min(0.25).max(8).optional().describe("For a square wall_asset texture: squares one repeat covers (default 1)"),
};
const LightLevelSchema = z.union([z.enum(LIGHT_PRESET_NAMES as [string, ...string[]]), z.number().min(0.05).max(1)]);
const ZoneShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ type: z.literal("circle"), x: z.number(), y: z.number(), r: z.number().positive() }),
  z.object({ type: z.literal("polygon"), points: z.array(XY).min(3).max(400) }),
]).describe("Outline in grid squares: a rectangle, a circle or a polygon");

const BShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ type: z.literal("circle"), x: z.number(), y: z.number(), r: z.number().positive() }),
  z.object({ type: z.literal("polygon"), points: z.array(XY).min(3).max(400) }),
  z.object({ type: z.literal("stroke"), points: z.array(XY).min(1).max(400), r: z.number().positive().describe("half-width in squares") }),
  z.object({ type: z.literal("all") }),
]).describe("Area in grid squares. 'stroke' is a corridor along a polyline (r is half its width); 'all' is the whole map.");

const spec = (ctx: ToolContext) => battleSpec(ctx.session().doc);

function toCells(s: z.infer<typeof BShape>, sub: number): Shape {
  switch (s.type) {
    case "rect": return { type: "rect", x: s.x * sub, y: s.y * sub, w: s.w * sub, h: s.h * sub };
    case "circle": return { type: "circle", x: s.x * sub, y: s.y * sub, r: s.r * sub };
    case "polygon": return { type: "polygon", points: s.points.map(([x, y]) => [x * sub, y * sub] as [number, number]) };
    case "stroke": return { type: "stroke", points: s.points.map(([x, y]) => [x * sub, y * sub] as [number, number]), r: s.r * sub };
    case "all": return { type: "all" };
  }
}

export function materialId(ctx: ToolContext, name: string): number {
  const k = name.trim().toLowerCase();
  const custom = ctx.session().doc.meta.battle?.palette?.find((e) => e.name.toLowerCase() === k);
  if (custom) return custom.id;
  const m = materialByName(name);
  if (!m) throw new Error(`Unknown material "${name}". Choose from: ${MATERIALS.map((x) => x.name).join(", ")}${ctx.session().doc.meta.battle?.palette?.length ? `, or a floor texture: ${ctx.session().doc.meta.battle!.palette!.map((e) => e.name).join(", ")}` : ""}.`);
  return m.id;
}

const wallsOf = (ctx: ToolContext) => ctx.session().doc.features?.walls ?? [];
const lightsOf = (ctx: ToolContext) => ctx.session().doc.features?.lights ?? [];
const round = (n: number) => Math.round(n * 100) / 100;

export function battleSummary(ctx: ToolContext) {
  const doc = ctx.session().doc, sp = battleSpec(doc);
  const counts: Record<string, number> = {};
  const { data } = doc.height;
  for (let i = 0; i < data.length; i++) counts[data[i]] = (counts[data[i]] ?? 0) + 1;
  const total = data.length;
  const floors = Object.entries(counts).filter(([m]) => Number(m) !== 0).map(([m, n]) => ({ material: Number(m) >= 100 ? (sp.palette?.find((e) => e.id === Number(m))?.name ?? "texture") : MATERIALS[Number(m)]?.name, squares: Math.round(n / (sp.sub * sp.sub)) }));
  return {
    project: doc.meta.id, name: doc.meta.name, size_squares: [sp.squaresX, sp.squaresY], feet_per_square: sp.feetPerSquare, grid: sp.gridType,
    size_feet: [sp.squaresX * sp.feetPerSquare, sp.squaresY * sp.feetPerSquare], image_px: [sp.squaresX * sp.pxPerSquare, sp.squaresY * sp.pxPerSquare],
    floored_squares: Math.round((total - (counts[0] ?? 0)) / (sp.sub * sp.sub)), floors,
    light_level: lightPresetName(sp) ?? round(ambientOf(sp)), ...(sp.ambientTint && { light_tint: sp.ambientTint }),
    notes: (doc.features?.notes ?? []).length, light_zones: (doc.features?.zones ?? []).length,
    walls: wallsOf(ctx).filter((w) => w.kind === "wall").length, doors: wallsOf(ctx).filter((w) => w.kind === "door" || w.kind === "secret").length,
    windows: wallsOf(ctx).filter((w) => w.kind === "window").length, lights: lightsOf(ctx).length,
    objects: (doc.features?.props ?? []).length, connectors: (doc.features?.connectors ?? []).length, roofs: (doc.features?.roofs ?? []).length, floor_textures: (sp.palette ?? []).map((e) => e.name), latest_change: ctx.session().seq,
  };
}

export const BATTLE_TOOLS = [
  define({
    name: "create_battlemap",
    description:
      "Create a new battlemap (a grid-based tabletop map for combat or exploration) and open it. Sizes are in grid squares (a square is 5 ft by default, so 30 x 20 squares is 150 x 100 ft). " +
      "It starts empty (void) unless room_margin is given, which floors and walls one room leaving that many squares of margin. Then use add_room, paint_floor, add_wall, add_door and add_light.",
    schema: z.object({
      name: z.string().min(1).max(80),
      squares_x: z.number().int().min(3).max(150).describe("Width in squares"),
      squares_y: z.number().int().min(3).max(150).describe("Height in squares"),
      feet_per_square: z.number().min(1).max(100).optional().describe("Default 5"),
      px_per_square: z.number().int().min(20).max(200).optional().describe("Image pixels per square (default 70, what Foundry expects; the whole image is limited to 25 megapixels)"),
      grid: z.enum(["square", "hex", "none"]).optional().describe("Default square"),
      room_margin: z.number().int().min(1).max(20).optional().describe("Start with a stone-floored, walled room inside this margin"),
    }),
    async run(ctx, i) {
      if (!ctx.createBattle) return fail("Battlemaps can't be created here.");
      const err = battleSizeError(i.squares_x, i.squares_y, i.px_per_square ?? 70);
      if (err) return fail(err);
      const info = await ctx.createBattle({ name: i.name, squaresX: i.squares_x, squaresY: i.squares_y, feetPerSquare: i.feet_per_square, pxPerSquare: i.px_per_square, gridType: i.grid, roomMargin: i.room_margin });
      return json({ created: info, summary: battleSummary(ctx), note: "Coordinates are grid squares from the top-left; fractions are fine (a wall along x=4.5 runs through the middle of a square)." });
    },
  }),

  define({
    name: "create_battlemap_here",
    description:
      "Make a battlemap of the ground at a point on the open WORLD map (x, y in map pixels) and open it. The floors are chosen from what the world map says is there: climate (snow, desert, woodland, meadow), steep rocky ground, a lake, a river running along its real direction, or the sea on the correct side of a coast. " +
      "It gives a natural-looking outdoor scene to build on: add rooms, walls, objects and lights afterwards. The scene is a few dozen metres across, not the area of a world-map pixel. Only the biome and water come from the world; what is there (names, who lives here) is the DM's to decide. " +
      "With an asset library, each floor is a fitting floor texture of the packs (the DM's starred ones first) where one fits; pack_pictures: false keeps the built-in floors.",
    schema: z.object({
      name: z.string().min(1).max(80),
      x: z.number().describe("World-map pixel x"), y: z.number().describe("World-map pixel y"),
      squares_x: z.number().int().min(3).max(150).optional().describe("Default 30"),
      squares_y: z.number().int().min(3).max(150).optional().describe("Default 20"),
      feet_per_square: z.number().min(1).max(100).optional(),
      pack_pictures: z.boolean().optional().describe("Use fitting pictures from the asset packs for the floors (default true when there is an asset library)"),
    }),
    async run(ctx, i) {
      if (!ctx.createBattleHere) return fail("Battlemaps can't be created here.");
      const info = await ctx.createBattleHere({ name: i.name, x: i.x, y: i.y, squaresX: i.squares_x, squaresY: i.squares_y, feetPerSquare: i.feet_per_square, ...(i.pack_pictures === false && { packPictures: false }) });
      return json({ created: info, ground: info.description, ...(info.packPictures && { pack_pictures: info.packPictures }), summary: battleSummary(ctx), note: "Now working in the battlemap (open_project returns to the world map). Look with render_battlemap." });
    },
  }),

  define({
    name: "paint_floor",
    description:
      "Set the floor material inside a shape (squares). Painting void erases floor. Floors look best with walls around them: use add_room for a room, " +
      "paint_floor for lakes, cave areas, corridors (stroke), carpets and the like.",
    schema: z.object({ shape: BShape, material: MaterialSchema }),
    async run(ctx, i) {
      const sp = spec(ctx);
      const r = ctx.execute({ op: "paint_floor", params: { shape: toCells(i.shape, sp.sub), material: materialId(ctx, i.material) } }, `Paint ${i.material}`);
      return json({ change: r.seq, painted: i.material });
    },
  }),

  define({
    name: "add_room",
    description:
      "Add a rectangular room: floors it and builds its walls, with optional doors, secret doors and windows set into the walls. Squares: (x, y) is the top-left corner of the " +
      "inside, w and h its size. Door side is top/bottom/left/right; offset is how many squares from the left end of that side (top, bottom) or the top end (left, right) the door starts.",
    schema: z.object({
      x: z.number(), y: z.number(), w: z.number().min(1), h: z.number().min(1),
      floor: MaterialSchema.optional().describe("Default flagstone"),
      walls: z.boolean().optional().describe("Build walls around it (default true)"),
      doors: z.array(z.object({
        side: z.enum(["top", "bottom", "left", "right"]), offset: z.number().min(0),
        width: z.number().min(0.5).max(4).optional().describe("Squares (default 1)"),
        kind: z.enum(["door", "secret", "window"]).optional(),
        picture: PortalPictureSchema.optional(),
      })).max(24).optional(),
      ...WallStyleFields,
    }),
    async run(ctx, i) {
      const sp = spec(ctx);
      if (i.x < 0 || i.y < 0 || i.x + i.w > sp.squaresX || i.y + i.h > sp.squaresY) return fail(`The room runs off the map (${sp.squaresX} x ${sp.squaresY} squares).`);
      const style = await wallStyleFrom(ctx, i);
      if (typeof style === "string") return fail(style);
      for (const d of i.doors ?? []) { const pic = await portalFrom(ctx, d.picture); if (typeof pic === "object") return fail(pic.problem); }
      const floor = materialId(ctx, i.floor ?? "flagstone");
      ctx.execute({ op: "paint_floor", params: { shape: { type: "rect", x: i.x * sp.sub, y: i.y * sp.sub, w: i.w * sp.sub, h: i.h * sp.sub }, material: floor } }, `Room floor (${i.w}x${i.h})`);
      let walls: MapWall[] = [];
      if (i.walls !== false) {
        const id = newFeatureId("w");
        walls = roomWalls(id, i.x, i.y, i.w, i.h, i.doors ?? [], style);
      }
      const r = walls.length ? ctx.execute({ op: "features", patch: { upsertWalls: walls }, label: `Room walls (${i.w}x${i.h})` }) : null;
      return json({ change: r?.seq, room: { x: i.x, y: i.y, w: i.w, h: i.h }, walls: walls.length, doors: walls.filter((w) => w.kind !== "wall").map((w) => ({ id: w.id, kind: w.kind, from: w.points[0], to: w.points[1] })) });
    },
  }),

  define({
    name: "add_room_shape",
    description:
      "Add a round or free-form room: floors the shape and builds a closed wall around it (squares). circle: centre x, y and radius r. polygon: its corner points in order (at least 3). " +
      "For a rectangle use add_room. Add doors afterwards with add_door.",
    schema: z.object({
      shape: z.discriminatedUnion("type", [
        z.object({ type: z.literal("circle"), x: z.number(), y: z.number(), r: z.number().min(1) }),
        z.object({ type: z.literal("polygon"), points: z.array(XY).min(3).max(200) }),
      ]),
      floor: MaterialSchema.optional().describe("Default flagstone"),
      walls: z.boolean().optional().describe("Build the wall around it (default true)"),
      ...WallStyleFields,
    }),
    async run(ctx, i) {
      const sp = spec(ctx);
      const style = await wallStyleFrom(ctx, i);
      if (typeof style === "string") return fail(style);
      const polygon = i.shape.type === "circle" ? circlePolygon(i.shape.x, i.shape.y, i.shape.r) : i.shape.points.map(([x, y]) => [x, y] as [number, number]);
      if (polygon.some(([x, y]) => x < -0.01 || y < -0.01 || x > sp.squaresX + 0.01 || y > sp.squaresY + 0.01)) return fail(`The shape runs off the map (${sp.squaresX} x ${sp.squaresY} squares).`);
      const floor = materialId(ctx, i.floor ?? "flagstone");
      const shape = i.shape.type === "circle"
        ? { type: "circle" as const, x: i.shape.x * sp.sub, y: i.shape.y * sp.sub, r: i.shape.r * sp.sub }
        : { type: "polygon" as const, points: polygon.map(([x, y]) => [x * sp.sub, y * sp.sub] as [number, number]) };
      ctx.execute({ op: "paint_floor", params: { shape, material: floor } }, `Room floor (${i.shape.type})`);
      let wall: MapWall | undefined;
      if (i.walls !== false) {
        wall = { id: newFeatureId("w"), kind: "wall", points: polygon, closed: true, ...style };
        ctx.execute({ op: "features", patch: { upsertWalls: [wall] }, label: `Room walls (${i.shape.type})` });
      }
      return json({ room: i.shape, wall_id: wall?.id });
    },
  }),

  define({
    name: "add_walls_around_floor",
    description:
      "Build walls along the edge of the painted floor, following its outline: the way to wall a cave or any shape made with paint_floor (strokes, polygons, circles). " +
      "Each separate outline (and each hole, such as a pillar) gets a closed wall. Walls made by this tool before are replaced (so you can paint more floor and run it again); walls you drew yourself are left alone. " +
      "Outlines shorter than 2 squares are ignored. Afterwards use add_door to cut doors in.",
    schema: z.object({
      region: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional().describe("Only outlines in this area, in squares (default: the whole map)"),
      keep_previous: z.boolean().optional().describe("Don't replace walls made by an earlier call"),
      ...WallStyleFields,
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc;
      const style = await wallStyleFrom(ctx, i);
      if (typeof style === "string") return fail(style);
      const walls = wallsAroundFloor(doc, () => newFeatureId("w"), { region: i.region }).map((w) => ({ ...w, ...style }));
      const old = i.keep_previous || i.region ? [] : (doc.features?.walls ?? []).filter((w) => w.auto).map((w) => w.id);
      if (!walls.length && !old.length) return fail("There's no floor to wall yet. Paint some with paint_floor or add_room first.");
      const r = ctx.execute({ op: "features", patch: { removeWalls: old, upsertWalls: walls }, label: `Walls around the floor (${walls.length} outline${walls.length === 1 ? "" : "s"})` });
      return json({ change: r.seq, outlines: walls.length, replaced: old.length, points: walls.reduce((n, w) => n + w.points.length, 0), note: "render_battlemap to check; add_door cuts doors into these walls." });
    },
  }),

  define({
    name: "add_wall",
    description:
      "Draw a wall (or door, secret door, window or invisible barrier) along a polyline of points in squares. Walls block movement and sight; windows block movement but not sight; invisible walls only stop movement. " +
      "To put a door in an existing wall use add_door instead (it cuts the gap).",
    schema: z.object({
      points: z.array(XY).min(2).max(400),
      kind: WallKindSchema.optional().describe("Default wall"),
      closed: z.boolean().optional().describe("Join the last point back to the first"),
      open: z.boolean().optional().describe("Doors: drawn open"),
      locked: z.boolean().optional().describe("Doors: locked (Foundry)"),
      ...WallStyleFields,
    }),
    async run(ctx, i) {
      const sp = spec(ctx);
      for (const [x, y] of i.points) if (x < -0.01 || y < -0.01 || x > sp.squaresX + 0.01 || y > sp.squaresY + 0.01) return fail("A point is off the map.");
      const style = await wallStyleFrom(ctx, i);
      if (typeof style === "string") return fail(style);
      const wall: MapWall = { id: newFeatureId("w"), kind: i.kind ?? "wall", points: i.points.map(([x, y]) => [x, y] as [number, number]), ...(i.closed && { closed: true }), ...(i.open && { open: true }), ...(i.locked && { locked: true }), ...style };
      const r = ctx.execute({ op: "features", patch: { upsertWalls: [wall] }, label: `Add ${wall.kind}` });
      return json({ change: r.seq, wall });
    },
  }),

  define({
    name: "add_door",
    description:
      "Put a door, secret door or window into the nearest wall: the wall is cut so the door sits in a gap, centred as close to (x, y) as it can be. " +
      "Fails if there's no wall within about a square of the point.",
    schema: z.object({
      x: z.number(), y: z.number(),
      width: z.number().min(0.5).max(4).optional().describe("Squares (default 1)"),
      kind: z.enum(["door", "secret", "window"]).optional(),
      open: z.boolean().optional(),
      locked: z.boolean().optional(),
      picture: PortalPictureSchema.optional(),
    }),
    async run(ctx, i) {
      const pic = await portalFrom(ctx, i.picture);
      if (typeof pic === "object") return fail(pic.problem);
      const res = insertDoor(wallsOf(ctx), i.x, i.y, i.width ?? 1, i.kind ?? "door", () => newFeatureId("w"));
      if (!res) return fail("There's no wall near that point. Use list_battle to see the walls, or add_wall with kind=door to draw a free-standing one.");
      const door: MapWall = { ...res.door, ...(i.open && { open: true }), ...(i.locked && { locked: true }), ...(i.kind !== "secret" && portalOf(pic)) };
      const add = res.add.map((w) => (w.id === door.id ? door : w));
      const r = ctx.execute({ op: "features", patch: { removeWalls: res.remove, upsertWalls: add }, label: `Add ${door.kind}` });
      return json({ change: r.seq, door: { id: door.id, kind: door.kind, from: door.points[0], to: door.points[1] } });
    },
  }),

  define({
    name: "update_wall",
    description: "Change a wall piece, door or window: open or close a door, lock it, change its kind, or give a door or window a picture from the asset packs (picture: null for the built-in look again). Ids come from list_battle. What walls are built of: set_wall_look.",
    schema: z.object({ id: z.string(), kind: WallKindSchema.optional(), open: z.boolean().optional(), locked: z.boolean().optional(), picture: PortalPictureSchema.nullable().optional() }),
    async run(ctx, i) {
      const w = wallsOf(ctx).find((x) => x.id === i.id);
      if (!w) return fail(`No wall with id ${i.id}. Use list_battle.`);
      const pic = await portalFrom(ctx, i.picture ?? undefined);
      if (typeof pic === "object") return fail(pic.problem);
      const next: MapWall = { ...w, ...(i.kind && { kind: i.kind }), ...(i.open !== undefined && { open: i.open }), ...(i.locked !== undefined && { locked: i.locked }), ...portalOf(pic) };
      if (i.picture === null) delete next.portal;
      const r = ctx.execute({ op: "features", patch: { upsertWalls: [next] }, label: `Update ${next.kind}` });
      return json({ change: r.seq, wall: next });
    },
  }),

  define({
    name: "set_wall_look",
    description:
      "Change what walls are built of: a built-in look (stone, brick, wood, plaster, rock) or a picture from the asset packs (wall_asset, an id from search_assets). " +
      "ids from list_battle; without ids, every wall on the active level. Doors keep their own look; a window's frame takes the wall's. wall_asset: null takes a picture off (the look shows again).",
    schema: z.object({
      ids: z.array(z.string()).min(1).max(400).optional(),
      wall_look: WallLookSchema.optional(),
      wall_asset: WallAssetSchema.nullable().optional(),
      wall_tile: WallStyleFields.wall_tile,
    }),
    async run(ctx, i) {
      if (!i.wall_look && i.wall_asset === undefined && !i.wall_tile) return fail("Give wall_look, wall_asset or wall_tile.");
      const style = await wallStyleFrom(ctx, { wall_look: i.wall_look, wall_asset: i.wall_asset ?? undefined, wall_tile: i.wall_tile });
      if (typeof style === "string") return fail(style);
      const all = wallsOf(ctx).filter((w) => w.kind !== "invisible");
      const pick = i.ids ? all.filter((w) => i.ids!.includes(w.id)) : all;
      if (!pick.length) return fail(i.ids ? "None of those ids are walls here. Use list_battle." : "There are no walls on this level yet.");
      const next = pick.map((w) => {
        const n: MapWall = { ...w, ...style };
        if (i.wall_asset === null) { delete n.asset; delete n.tile; }
        return n;
      });
      const what = i.wall_asset ? "a pack picture" : i.wall_asset === null ? "no picture" : i.wall_look ?? "a new repeat";
      const r = ctx.execute({ op: "features", patch: { upsertWalls: next }, label: `Walls: ${what} (${next.length})` });
      return json({ change: r.seq, walls: next.length });
    },
  }),

  define({
    name: "remove_walls",
    description: "Remove walls, doors or windows by id (from list_battle).",
    schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    async run(ctx, i) {
      const have = new Set(wallsOf(ctx).map((w) => w.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids exist. Use list_battle.");
      const r = ctx.execute({ op: "features", patch: { removeWalls: ids }, label: `Remove ${ids.length} wall piece(s)` });
      return json({ change: r.seq, removed: ids.length });
    },
  }),

  define({
    name: "add_light",
    description:
      "Add a light (torch, brazier, window glow, magical light) at a point in squares. radius is how far the dim light reaches (squares); bright defaults to half of it. " +
      "Lights show in previews, in render_battlemap and in the Foundry / Universal VTT exports. Walls, closed doors and secret doors cast shadows (the light stops there); windows, open doors and invisible walls let it through; shadows: false ignores walls. " +
      "Put a light a little inside a room, not exactly on a wall.",
    schema: z.object({
      x: z.number(), y: z.number(),
      radius: z.number().min(0.5).max(60),
      bright: z.number().min(0).max(60).optional(),
      colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("#rrggbb, default a warm torch colour"),
      intensity: z.number().min(0).max(1).optional(),
      shadows: z.boolean().optional().describe("Walls block it (default true)"),
      glow: GlowSchema.optional(),
    }),
    async run(ctx, i) {
      const g = await glowFrom(ctx, i.glow);
      if (typeof g === "object") return fail(g.problem);
      const light: MapLight = { id: newFeatureId("g"), ...(g && { glow: g }), x: i.x, y: i.y, radius: i.radius, ...(i.bright !== undefined && { bright: i.bright }), ...(i.colour && { colour: i.colour }), ...(i.intensity !== undefined && { intensity: i.intensity }), ...(i.shadows === false && { shadows: false }) };
      const r = ctx.execute({ op: "features", patch: { upsertLights: [light] }, label: "Add light" });
      return json({ change: r.seq, light });
    },
  }),

  define({
    name: "update_light",
    description: "Change a light (ids from list_battle): move it, its reach, colour, strength, whether walls block it, or its glow picture (glow: null for the round fall-off again).",
    schema: z.object({
      id: z.string(),
      x: z.number().optional(), y: z.number().optional(),
      radius: z.number().min(0.5).max(60).optional(),
      bright: z.number().min(0).max(60).optional(),
      colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      intensity: z.number().min(0).max(1).optional(),
      shadows: z.boolean().optional(),
      glow: GlowSchema.nullable().optional(),
    }),
    async run(ctx, i) {
      const l = lightsOf(ctx).find((x) => x.id === i.id);
      if (!l) return fail(`No light with id ${i.id}. Use list_battle.`);
      const g = await glowFrom(ctx, i.glow ?? undefined);
      if (typeof g === "object") return fail(g.problem);
      const { id: _id, glow: _g, ...rest } = i;
      const next: MapLight = { ...l, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), ...(g && { glow: g }) };
      if (i.glow === null) delete next.glow;
      const r = ctx.execute({ op: "features", patch: { upsertLights: [next] }, label: "Change light" });
      return json({ change: r.seq, light: next });
    },
  }),

  define({
    name: "remove_lights",
    description: "Remove lights by id (from list_battle).",
    schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    async run(ctx, i) {
      const have = new Set(lightsOf(ctx).map((l) => l.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids exist. Use list_battle.");
      const r = ctx.execute({ op: "features", patch: { removeLights: ids }, label: `Remove ${ids.length} light(s)` });
      return json({ change: r.seq, removed: ids.length });
    },
  }),

  define({
    name: "list_battle",
    description: "Everything on the level of the open battlemap that is being worked on: size, floors, and every wall piece, door, window, light, object, note, light zone, stair, ladder and hole with its id and position (squares).",
    schema: z.object({}),
    async run(ctx) {
      return json({
        summary: battleSummary(ctx),
        walls: wallsOf(ctx).map((w) => ({ id: w.id, kind: w.kind, points: w.points.map(([x, y]) => [round(x), round(y)]), ...(w.closed && { closed: true }), ...(w.open && { open: true }), ...(w.locked && { locked: true }), ...wallStyleOf(w), ...(w.portal && { picture: w.portal }), pieces: wallSegments(w).length })),
        lights: lightsOf(ctx).map((l) => ({ id: l.id, x: round(l.x), y: round(l.y), radius: l.radius, bright: l.bright, colour: l.colour, ...(l.glow && { glow: l.glow }) })),
        connectors: (ctx.session().doc.features?.connectors ?? []).map((c) => ({ id: c.id, kind: c.kind, ...(c.name && { name: c.name }), x: c.x, y: c.y, w: c.w, h: c.h, leads: connectorTo(c) })),
        roofs: (ctx.session().doc.features?.roofs ?? []).map((r) => ({ id: r.id, ...(r.name && { name: r.name }), style: r.style, ...(r.asset && { asset: r.asset }), points: r.points.map(([x, y]) => [round(x), round(y)]) })),
        notes: sortedNotes(ctx.session().doc.features?.notes).map((n) => ({ id: n.id, n: n.n, x: round(n.x), y: round(n.y), title: n.title, ...(n.text && { text: n.text }) })),
        light_zones: (ctx.session().doc.features?.zones ?? []).map((z) => ({ id: z.id, ...(z.name && { name: z.name }), level: z.ambient, points: z.points.map(([x, y]) => [round(x), round(y)]) })),
        objects: (ctx.session().doc.features?.props ?? []).map((p) => ({ id: p.id, asset: p.asset, x: round(p.x), y: round(p.y), ...(p.rotation && { rotation: p.rotation }), ...(p.scale && p.scale !== 1 && { scale: p.scale }), ...(p.layer && { layer: p.layer }) })),
      });
    },
  }),

  define({
    name: "set_battle_grid",
    description: "Choose the grid type used in exports and drawn in the editor: square, hex or none.",
    schema: z.object({ type: z.enum(["square", "hex", "none"]) }),
    async run(ctx, i) {
      const sp = spec(ctx);
      const r = ctx.execute({ op: "set_meta", patch: { battle: { ...sp, gridType: i.type } }, label: `Grid: ${i.type}` });
      return json({ change: r.seq, grid: i.type });
    },
  }),

  define({
    name: "set_battle_lighting",
    description:
      "Set how bright the battlemap is where no light reaches. level is a preset or a number from 0.05 (nearly black) to 1: " +
      "bright (the default: everything visible, lights only add a glow), dawn, dusk, dim, night (a blue tint), dark; dawn, dusk and night also colour the ambient light. " +
      "tint overrides the colour (#rrggbb, or 'none' to remove it). In a dim map only what the lights reach shows in full, so add lights (add_light) where the scene needs to be seen; " +
      "add_light_zone makes an area (a roofed building) brighter or dimmer than the rest. The exported background picture stays bright " +
      "(Foundry and other tabletops do their own lighting; the export carries the level as the scene's darkness). render_battlemap and the editor show it.",
    schema: z.object({ level: LightLevelSchema.optional(), tint: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.literal("none")]).optional() }),
    async run(ctx, i) {
      if (i.level === undefined && i.tint === undefined) return fail("Give a level, a tint, or both.");
      let next = { ...spec(ctx) };
      if (typeof i.level === "string") next = applyLightPreset(next, i.level as keyof typeof LIGHT_PRESETS);
      else if (typeof i.level === "number") {
        const a = Math.round(i.level * 100) / 100;
        const { ambient: _a, ...rest } = next;
        next = a >= 0.995 ? rest : { ...rest, ambient: a };
      }
      if (i.tint === "none") { const { ambientTint: _t, ...rest } = next; next = rest; }
      else if (i.tint) next = { ...next, ambientTint: i.tint.toLowerCase() };
      const name = lightPresetName(next);
      const r = ctx.execute({ op: "set_meta", patch: { battle: next }, label: `Light level: ${name ?? `${Math.round(ambientOf(next) * 100)}%${next.ambientTint ? ", tinted" : ""}`}` });
      return json({ change: r.seq, light_level: name ?? ambientOf(next), ...(next.ambientTint && { tint: next.ambientTint }) });
    },
  }),

  define({
    name: "add_light_zone",
    description:
      "Give an area its own light level, softly edged: a roofed building that is dimmer than the open air, a lit hall in a dark cave. Where no light reaches, the zone is " +
      "as bright as its level (a preset name or 0.05 to 1), whatever the rest of the map is set to (set_battle_lighting). Use it for indoors and outdoors on one map.",
    schema: z.object({ shape: ZoneShape, level: LightLevelSchema, name: z.string().max(60).optional() }),
    async run(ctx, i) {
      const points: [number, number][] = i.shape.type === "rect" ? [[i.shape.x, i.shape.y], [i.shape.x + i.shape.w, i.shape.y], [i.shape.x + i.shape.w, i.shape.y + i.shape.h], [i.shape.x, i.shape.y + i.shape.h]]
        : i.shape.type === "circle" ? circlePolygon(i.shape.x, i.shape.y, i.shape.r).map(([x, y]) => [round(x), round(y)] as [number, number])
        : i.shape.points.map(([x, y]) => [x, y] as [number, number]);
      const ambient = typeof i.level === "number" ? Math.round(i.level * 100) / 100 : LIGHT_PRESETS[i.level as keyof typeof LIGHT_PRESETS].ambient;
      const zone: MapAmbientZone = { id: newFeatureId("z"), points, ambient, ...(i.name && { name: i.name }) };
      const r = ctx.execute({ op: "features", patch: { upsertZones: [zone] }, label: `Add light zone${i.name ? ` ${i.name}` : ""}` });
      return json({ change: r.seq, zone: { id: zone.id, name: zone.name, level: ambient, points: points.length } });
    },
  }),

  define({
    name: "update_light_zone",
    description: "Change a light zone's level, name or outline (ids from list_battle).",
    schema: z.object({ id: z.string(), level: LightLevelSchema.optional(), name: z.string().max(60).optional(), shape: ZoneShape.optional() }),
    async run(ctx, i) {
      const z = (ctx.session().doc.features?.zones ?? []).find((x) => x.id === i.id);
      if (!z) return fail("No light zone has that id. Use list_battle.");
      const next: MapAmbientZone = { ...z };
      if (i.level !== undefined) next.ambient = typeof i.level === "number" ? Math.round(i.level * 100) / 100 : LIGHT_PRESETS[i.level as keyof typeof LIGHT_PRESETS].ambient;
      if (i.name !== undefined) next.name = i.name;
      if (i.shape) next.points = i.shape.type === "rect" ? [[i.shape.x, i.shape.y], [i.shape.x + i.shape.w, i.shape.y], [i.shape.x + i.shape.w, i.shape.y + i.shape.h], [i.shape.x, i.shape.y + i.shape.h]]
        : i.shape.type === "circle" ? circlePolygon(i.shape.x, i.shape.y, i.shape.r).map(([x, y]) => [round(x), round(y)] as [number, number]) : i.shape.points.map(([x, y]) => [x, y] as [number, number]);
      const r = ctx.execute({ op: "features", patch: { upsertZones: [next] }, label: `Change light zone${next.name ? ` ${next.name}` : ""}` });
      return json({ change: r.seq, zone: { id: next.id, name: next.name, level: next.ambient } });
    },
  }),

  define({
    name: "remove_light_zones",
    description: "Remove light zones by id (from list_battle).",
    schema: z.object({ ids: z.array(z.string()).min(1).max(100) }),
    async run(ctx, i) {
      const have = new Set((ctx.session().doc.features?.zones ?? []).map((z) => z.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids exist. Use list_battle.");
      const r = ctx.execute({ op: "features", patch: { removeZones: ids }, label: `Remove ${ids.length} light zone(s)` });
      return json({ change: r.seq, removed: ids.length });
    },
  }),

  define({
    name: "add_note",
    description:
      "Add a numbered note to the battlemap's key: a room or spot to describe (read-aloud text, who is here, treasure, traps). It shows as a numbered marker in the editor and in render_battlemap, " +
      "and in the key (export_battlemap 'key', a Markdown list); it is never drawn in the exported picture, so it can hold secrets. x, y in squares (the middle of the room). " +
      "The number defaults to the next free one. Only write what the DM has said: leave the text out rather than inventing details.",
    schema: z.object({
      x: z.number(), y: z.number(), title: z.string().min(1).max(80),
      text: z.string().max(4000).optional().describe("What is here, in the DM's words"),
      number: z.number().int().min(1).max(999).optional(),
    }),
    async run(ctx, i) {
      const note: MapNote = { id: newFeatureId("n"), x: i.x, y: i.y, n: i.number ?? nextNoteNumber(ctx.session().doc.features?.notes), title: i.title, ...(i.text && { text: i.text }) };
      const r = ctx.execute({ op: "features", patch: { upsertNotes: [note] }, label: `Add note ${note.n}` });
      return json({ change: r.seq, note });
    },
  }),

  define({
    name: "update_note",
    description: "Change a note's title, text, number or position (ids from list_battle).",
    schema: z.object({ id: z.string(), title: z.string().min(1).max(80).optional(), text: z.string().max(4000).optional(), number: z.number().int().min(1).max(999).optional(), x: z.number().optional(), y: z.number().optional() }),
    async run(ctx, i) {
      const n = (ctx.session().doc.features?.notes ?? []).find((x) => x.id === i.id);
      if (!n) return fail("No note has that id. Use list_battle.");
      const next: MapNote = { ...n, ...(i.title !== undefined && { title: i.title }), ...(i.number !== undefined && { n: i.number }), ...(i.x !== undefined && { x: i.x }), ...(i.y !== undefined && { y: i.y }) };
      if (i.text !== undefined) { if (i.text) next.text = i.text; else delete next.text; }
      const r = ctx.execute({ op: "features", patch: { upsertNotes: [next] }, label: `Change note ${next.n}` });
      return json({ change: r.seq, note: next });
    },
  }),

  define({
    name: "remove_notes",
    description: "Remove notes by id (from list_battle).",
    schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
    async run(ctx, i) {
      const have = new Set((ctx.session().doc.features?.notes ?? []).map((n) => n.id));
      const ids = i.ids.filter((id) => have.has(id));
      if (!ids.length) return fail("None of those ids exist. Use list_battle.");
      const r = ctx.execute({ op: "features", patch: { removeNotes: ids }, label: `Remove ${ids.length} note(s)` });
      return json({ change: r.seq, removed: ids.length });
    },
  }),

  define({
    name: "renumber_notes",
    description: "Renumber all notes 1, 2, 3... in reading order across the map (top to bottom, left to right), e.g. after adding or removing rooms.",
    schema: z.object({}),
    async run(ctx) {
      const notes = ctx.session().doc.features?.notes ?? [];
      if (!notes.length) return fail("There are no notes.");
      const order = readingOrderNumbers(notes);
      const r = ctx.execute({ op: "features", patch: { upsertNotes: notes.map((n) => ({ ...n, n: order[n.id] })) }, label: "Renumber notes" });
      return json({ change: r.seq, notes: sortedNotes(ctx.session().doc.features?.notes).map((n) => ({ n: n.n, title: n.title })) });
    },
  }),

  define({
    name: "render_battlemap",
    description:
      "Render the battlemap (or a region of it, in squares) to an image so you can see it, with a labelled square grid (numbers are grid squares). " +
      "Use after edits, and a region with a larger max_size to inspect detail. Roofs are left out unless you ask for them (roofs: true draws them nearly solid over the rooms): you want to see inside.",
    schema: z.object({
      roofs: z.boolean().optional().describe("Draw the level's roofs (default false)"),
      region: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional().describe("Crop in squares; omit for the whole map"),
      max_size: z.number().int().min(256).max(1568).optional().describe("Longest side of the image in px (default 1200)"),
      grid: z.boolean().optional().describe("Draw the labelled grid (default true)"),
      trace: z.boolean().optional().describe("Draw the trace picture (get_trace_picture) half see-through over the level, to redraw its rooms, walls and doors from it (default false)"),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc, sp = battleSpec(doc);
      const full: RGBAImage = ctx.render ? (await ctx.render({ roofs: !!i.roofs })).img : renderBattle(doc, { notes: true, ...(i.roofs && { roofs: 0.8 }) });
      const px = sp.pxPerSquare;
      const region: Rect = i.region ? { x: Math.floor(i.region.x * px), y: Math.floor(i.region.y * px), w: Math.ceil(i.region.w * px), h: Math.ceil(i.region.h * px) } : { x: 0, y: 0, w: full.w, h: full.h };
      const { img, scale } = cropScale(full, region, i.max_size ?? 1200);
      const traced = i.trace ? await traceOverlay(ctx, img, region, scale, px) : "";
      if (i.grid !== false) drawSquareGrid(img, region, scale, px);
      const jpg = encodeJpeg(img);
      const display = ctx.savePreview ? [await ctx.savePreview(jpg)] : undefined;
      const note = `Battlemap ${sp.squaresX}x${sp.squaresY} squares (${sp.feetPerSquare} ft each)` +
        (i.region ? `, region x${i.region.x} y${i.region.y} ${i.region.w}x${i.region.h} squares` : ", whole map") + `; image ${img.w}x${img.h}${traced}. Grid numbers are squares. Change #${ctx.session().seq}.`;
      return { content: [{ type: "text", text: note }, { type: "image", mediaType: "image/jpeg", data: toBase64(jpg) }], display };
    },
  }),

  define({
    name: "export_battlemap",
    description:
      "Write the battlemap as a file for a virtual tabletop into the project's exports folder: 'uvtt' (Universal VTT .dd2vtt: image, walls, doors and lights in one file, " +
      "for the Universal Battlemap Importer in Foundry and other virtual tabletops that read Universal VTT files; the format has no see-through wall or secret door, so windows, invisible walls and secret doors are written as plain wall, and only real doors become doors), 'foundry' (a .zip with a Foundry scene JSON and the PNG), or 'png' (the image only). " +
      "'key' (the numbered notes of every level as a Markdown list, for the DM; notes are never in the picture). " +
      "'print' (a PDF to print at table scale, one inch a square, across sheets of US Letter or A4, with an assembly page and corner marks to trim along; paper, ink_saver and grid choose how; at most 80 pages). " +
      "A battlemap with several levels: the Foundry scene holds every level (one picture each, stairs and holes included); 'png' and 'uvtt' are of one level, named with it (level: its id or name, default the one being worked on). " +
      "The Foundry scene was tried in Foundry v14 (levels, walls, doors, window, lights, stairs and floors came through); the Universal VTT file was tried with the Universal Battlemap Importer (walls, doors and lights came through). " +
      "Neither has been tried in a live player view, and what a hole does to a token in Foundry hasn't been looked at: say so if asked, and ask the user to report anything odd.",
    schema: z.object({
      format: z.enum(BATTLE_EXPORT_FORMATS),
      level: z.string().optional().describe("png, uvtt and print only: a level's id or name (from list_levels)"),
      paper: z.enum(["letter", "a4"]).optional().describe("print only: US Letter (default) or A4"),
      ink_saver: z.boolean().optional().describe("print only: grey and lighten the picture and draw the walls again dark, to save ink"),
      grid: z.boolean().optional().describe("print only: draw the grid (default true)"),
      include_gm_only: z.boolean().optional().describe("Keep the objects and lights the DM marked GM only (the DM's own copy); default false: an export is for players"),
    }),
    async run(ctx, i) {
      if (!ctx.exportBattle) return fail("Exports aren't available here.");
      const f = await ctx.exportBattle(i.format, i.level, i.format === "print" ? { paper: i.paper, ink: i.ink_saver, grid: i.grid ?? true } : undefined, i.include_gm_only);
      return json({ file: f.name, saved_to: f.path, megabytes: +(f.bytes / 1048576).toFixed(1), note: "The user can also download it from the editor's Export button." });
    },
  }),

  ...LEVEL_TOOLS,
  ...ROOF_TOOLS,
  ...PATH_TOOLS,
  ...PREFAB_TOOLS,
] as const;

/** A labelled square grid on a battlemap preview: a line every square, numbered every 5 (or 10 on big crops). */
function drawSquareGrid(img: RGBAImage, region: Rect, scale: number, px: number) {
  const cell = px * scale;
  const every = cell < 14 ? 10 : cell < 26 ? 5 : 1;
  const put = (x: number, y: number, a: number) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const o = (y * img.w + x) * 4;
    img.data[o] = img.data[o] * (1 - a) + 255 * a;
    img.data[o + 1] = img.data[o + 1] * (1 - a) + 255 * a;
    img.data[o + 2] = img.data[o + 2] * (1 - a) + 255 * a;
  };
  const labelStep = Math.max(every, cell < 14 ? 10 : 5);
  for (let gx = Math.ceil(region.x / px); gx * px < region.x + region.w; gx++) {
    const x = Math.round((gx * px - region.x) * scale);
    if (gx % every === 0) for (let y = 0; y < img.h; y++) put(x, y, gx % 5 === 0 ? 0.32 : 0.18);
    if (gx % labelStep === 0) drawLabel(img, String(gx), Math.min(Math.max(x + 3, 1), img.w - textWidth(String(gx)) - 2), 3);
  }
  for (let gy = Math.ceil(region.y / px); gy * px < region.y + region.h; gy++) {
    const y = Math.round((gy * px - region.y) * scale);
    if (gy % every === 0) for (let x = 0; x < img.w; x++) put(x, y, gy % 5 === 0 ? 0.32 : 0.18);
    if (gy % labelStep === 0 && y > 12) drawLabel(img, String(gy), 3, Math.min(y + 3, img.h - 9));
  }
}

