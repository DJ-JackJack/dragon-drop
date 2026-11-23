/**
 * Wire protocol between the map server and editor clients (WebSocket).
 * JSON text frames for control/chat; binary frames for heightmap snapshots and patches.
 */
import type { ClaudeState } from "./assist.ts";
import type { RiverSize, RoofStyle, StreetKind } from "./features.ts";
import type { MapMeta } from "./doc.ts";
import type { Rect } from "./geom.ts";
import type { ChangeEntry, Command } from "./session.ts";
import type { RiverPath } from "./hydrology.ts";
import type { Features, MapLabel } from "./features.ts";
import type { LakeShape } from "./hydroSummary.ts";
import type { NamedWater } from "./waterNames.ts";
import type { ParentLink } from "./regional.ts";
import type { SketchParams } from "./sketch.ts";
import type { Selection } from "./selection.ts";
import type { LevelsFile } from "./levels.ts";

export type WireCommand = Exclude<Command, { op: "replace_heights" | "patch_heights" }>;

export interface ProjectInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  kmPerPx: number;
  updatedAt: string;
  /** Regional maps: the map and area this one was made from. */
  parent?: ParentLink;
  /** "battle" for battlemaps (width/height are then floor cells; see meta.battle), "city" for city maps (width/height are ground cells; see meta.city). Missing means a world map. */
  kind?: "world" | "battle" | "city";
  /** A copy of another map (made to change it): which one. */
  copiedFrom?: { id: string; name: string; at: string };
  /** A battlemap or city made from a spot of another map: which map and where. */
  origin?: { id: string; name: string; x: number; y: number; unit?: "m" };
}

export interface RefInfo {
  name: string;
  url: string;
  bytes: number;
  /** Its size in pixels, when it could be read from the file's first bytes. */
  w?: number;
  h?: number;
}

export interface ChatImage {
  url: string;
  name?: string;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string; images: ChatImage[]; time: string }
  | { kind: "assistant"; id: string; text: string; thinking?: string; time: string }
  | {
      kind: "tool"; id: string; name: string; input: unknown; status: "running" | "done" | "error";
      result?: string; images?: ChatImage[]; time: string;
    }
  | { kind: "notice"; id: string; text: string; level: "info" | "error"; time: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export type ModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";
export type Effort = "low" | "medium" | "high";

export interface ChatSettings {
  model: ModelId;
  effort: Effort;
}

export type ChatEvent =
  | { type: "item_add"; item: ChatItem }
  | { type: "item_update"; id: string; patch: Partial<ChatItem> }
  | { type: "busy"; busy: boolean }
  | { type: "usage"; usage: Usage; session: Usage };

/** Which map (project id) and, on a battlemap, which level an edit was made on. Missing (scripts, tests): whatever is open. */
export interface EditTarget { projectId?: string; level?: string }

/**
 * The messages that act on the map on screen: the DM's edits and everything else that changes or reads that map (see EditTarget). The editor names the map
 * and level on each; one meant for a map or level that is no longer open is refused, not done to the next one.
 */
export const EDIT_MESSAGES = new Set([
  "cmd", "txn_begin", "txn_end", "undo", "redo",
  "checkpoint_save", "checkpoint_restore", "carve_valleys", "draw_river", "route_line", "paint_cells", "sketch_import", "selection",
  "level_set", "level_add", "level_update", "level_remove", "ref_rename", "ref_remove", "read_picture", "read_picture_as",
  "create_city_here", "create_battle_here", "create_battle_from_city", "create_regional", "regional_refresh", "duplicate_project", "chat_send",
]);

export type ClientMsg =
  | { t: "hello" }
  /** The DM's answer to a `confirm` question (from an editor). */
  | { t: "confirm_answer"; id: string; allow: boolean }
  | { t: "open_project"; id: string }
  /** The city picture reader: read buildings out of the city's trace picture (all in metres; the answer is `picture_read`, to this editor only; nothing is added until it accepts). */
  | { t: "read_picture"; area: [number, number][]; roofs: { x: number; y: number; look: RoofStyle }[]; ground: [number, number][]; tolerance: number }
  /** The same reader for streets (`samples`: points on streets) or water (`samples` with the material each becomes: 7 shallow, 8 deep); the answer is `picture_read` with `what`. */
  | { t: "read_picture_as"; what: "streets" | "water"; area: [number, number][]; samples: { x: number; y: number; material?: number }[]; ground: [number, number][]; tolerance: number }
  /** Set ground cells of the open city map, as one edit: runs along the rows ([first cell, how many] in turn) by material (what the water reader found). */
  | { t: "paint_cells"; runs: { material: number; runs: number[] }[]; label: string }
  /** Delete a map: its folder is moved into the maps folder's "Deleted maps" folder (never erased), and another map is opened if it was the open one. Only the DM does this (no tool of Claude's). */
  | { t: "delete_project"; id: string }
  | { t: "create_project"; name: string; width: number; height: number; kmPerPx: number; template: string; seed: number; lakes?: "none" | "few" | "some" | "many" }
  /** Make a battlemap (a grid-based tabletop map) and open it. */
  | { t: "create_battle"; name: string; squaresX: number; squaresY: number; feetPerSquare?: number; pxPerSquare?: number; gridType?: "square" | "hex" | "none"; roomMargin?: number }
  /** Make a battlemap of the ground at a point (map px) of the open world map, and open it. */
  | { t: "create_battle_here"; name: string; x: number; y: number; squaresX?: number; squaresY?: number; /** false: built-in looks only, no pictures from the asset packs */ packPictures?: boolean }
  /** A battlemap of a box of the open city map (metres): its ground, streets, buildings (walls, doors, roofs) and walls. */
  | { t: "create_battle_from_city"; name: string; rect: { x: number; y: number; w: number; h: number }; feetPerSquare?: number; packPictures?: boolean }
  /** Make a more detailed map of an area (map px) of the open map, and open it. */
  | { t: "create_regional"; name: string; rect: Rect }
  /** On a regional map: re-read the climate from its parent map. */
  | { t: "regional_refresh" }
  /**
   * World maps: carve valleys along the rivers as they are now (carve.ts): a checkpoint is saved first, then one edit that Undo takes back. Answered with `carved`.
   * `where` "selection": only inside the selected area (or climate region), or only along the selected river (a named river, or a river source's river).
   */
  | { t: "carve_valleys"; strength: number; floodplains: boolean; deltas: boolean; where?: "map" | "selection" }
  /** World maps: a river drawn along a line (map px, riverDraw.ts): a channel cut along it and a source at its upper end, one edit. Answered with `river_drawn`. */
  | { t: "draw_river"; points: [number, number][]; size: RiverSize }
  /** Copy the open map under a new name (to change the copy: the same place before and after); the copy is opened. Answered with `duplicated`. */
  | { t: "duplicate_project"; name: string }
  /** Where another map lies over the open one, to compare them in the editor (its picture is GET /api/projects/<id>/picture.jpg). Answered with `compare`. */
  | { t: "compare_with"; id: string }
  /** Lay a road or trail through waypoints (map px), found over the terrain. */
  | { t: "route_line"; kind: "road" | "trail"; points: [number, number][]; name?: string; id?: string }
  /** Turn a reference image into terrain (replaces the whole map; a checkpoint is saved first). */
  | { t: "sketch_import"; ref: string; params: SketchParams }
  /**
   * The DM's edits (and their undo and redo) name the map, and on a battlemap the level, they were made on (`EditTarget`, filled in by the editor's `store.send`):
   * the AI can open another map or level meanwhile, and an edit meant for the one that was on screen must not land on the next. One for a map or level that is
   * no longer open is refused.
   */
  | ({ t: "cmd"; cmd: WireCommand; label?: string } & EditTarget)
  | ({ t: "txn_begin"; label: string } & EditTarget)
  | ({ t: "txn_end" } & EditTarget)
  | ({ t: "undo" } & EditTarget)
  | ({ t: "redo" } & EditTarget)
  /** Ctrl+S: write the map to disk now (it also saves itself a moment after every change). Answered with "saved" once it is on disk. */
  | { t: "save_now" }
  | { t: "chat_send"; text: string; images: { name: string; mediaType: string; data: string }[] }
  | { t: "chat_stop" }
  | { t: "chat_settings"; settings: Partial<ChatSettings> }
  | { t: "chat_reset" }
  /** Make a city map (a city seen from above, made of buildings and streets, sized in metres) and open it. */
  | { t: "create_city"; name: string; widthM: number; heightM: number; cellM?: number }
  /** A city started from a spot on the open world map: its climate, height, slope, coast and river come from there (cityWorld.ts). */
  | { t: "create_city_here"; name: string; x: number; y: number; widthM: number; heightM: number }
  /** Reference pictures (they are added with POST /api/projects/<id>/refs): give one a new name (its file type stays), or take it off the list (it is moved to the map's backups folder). */
  | { t: "ref_rename"; name: string; to: string }
  | { t: "ref_remove"; name: string }
  | { t: "checkpoint_save"; name: string }
  | { t: "checkpoint_restore"; name: string }
  /** What the DM has selected on the map, and whether Claude's edits are held to it (an area or a climate region). */
  | { t: "selection"; selection: Selection | null; lock: boolean }
  /** What part of the map the editor is showing (map px) and how far it is zoomed in. */
  | { t: "view"; rect: Rect; zoom: number }
  /** Battlemap levels: work on another level (the editor is sent that level, as if the map had been opened). */
  | { t: "level_set"; id: string }
  /** Add a level above the highest or below the lowest, and work on it. */
  | { t: "level_add"; where: "above" | "below"; name?: string }
  | { t: "level_update"; id: string; patch: { name?: string; bottom?: number; top?: number } }
  /** Remove a level (a checkpoint is saved first). The first level can't be removed. */
  | { t: "level_remove"; id: string };

export type ServerMsg =
  | {
      t: "project";
      meta: MapMeta;
      projects: ProjectInfo[];
      changes: ChangeEntry[];
      seq: number;
      canUndo: boolean;
      canRedo: boolean;
      refs: RefInfo[];
      chat: ChatItem[];
      chatSettings: ChatSettings;
      chatBusy: boolean;
      usage: Usage;
      apiKeyConfigured: boolean;
      features: Features;
      /** Battlemaps: the levels and which one this is (a map with one level says so too). */
      levels?: LevelsFile;
    }
  | { t: "levels"; levels: LevelsFile }
  | { t: "features"; features: Features }
  | { t: "projects"; projects: ProjectInfo[] }
  | { t: "meta"; meta: MapMeta }
  | { t: "change"; change: ChangeEntry; canUndo: boolean; canRedo: boolean }
  | { t: "refs"; refs: RefInfo[] }
  | { t: "chat"; ev: ChatEvent }
  | { t: "chat_settings"; settings: ChatSettings }
  | { t: "checkpoints"; list: CheckpointInfo[] }
  /** The map is on disk: after Ctrl+S, or (`auto`) after an autosave; `failed`: an autosave didn't work (it will try again). */
  | { t: "saved"; auto?: boolean; failed?: boolean }
  /** What the picture reader found (metres), or why it couldn't read. */
  | { t: "picture_read"; what?: "buildings" | "streets" | "water"; buildings?: { points: [number, number][]; look: RoofStyle }[]; streets?: { points: [number, number][]; width: number; kind: StreetKind }[]; water?: { runs: { material: number; runs: number[] }[]; cells: number }; skipped?: { small: number; large: number }; alreadyThere?: number; error?: string }
  /** A map was deleted: its name, and where its folder now is. */
  | { t: "map_deleted"; name: string; folder: string }
  /** New derived layers are ready (sent to every client), or a battlemap or city changed. */
  | { t: "derived_ready"; projectId: string; version: number }
  /**
   * World maps: the named rivers and lakes as the water is now (waterNames.ts), sent after the rivers are worked out and whenever a name changes: the labels to draw,
   * each name's river or lake, and every lake's shore, for the River tool. `head` and `lake` refer to the rivers of the latest derived frame.
   */
  | { t: "water"; projectId: string; labels: MapLabel[]; named: NamedWater[]; lakes?: LakeShape[] }
  /** Valleys were carved (the answer to `carve_valleys`): how many cells were lowered, how deep the deepest cut is (m), and how much delta land was made. */
  | { t: "carved"; lowered: number; deepestM: number; deltaCells: number; checkpoint: string; scope?: string }
  /** The open map was copied (the answer to `duplicate_project`; the copy is opened). */
  | { t: "duplicated"; id: string; name: string; from: string }
  /**
   * The answer to `compare_with`: where the other map lies over the open one, in the open map's units (world px, squares, metres), or null when the two aren't linked
   * (they can then only be shown side by side), and how they are linked, in words.
   */
  | { t: "compare"; id: string; name: string; kind: string; rect: Rect | null; how: string[] }
  /** A river was drawn (the answer to `draw_river`): its new source, how long it is, how it ends, the deepest cut through high ground (m), and whether the line was turned round. */
  | { t: "river_drawn"; source: string; lengthKm: number; end: "sea" | "land" | "edge"; deepestM: number; reversed: boolean }
  /** The AI assistant wants to do something risky (tools risky.ts) and waits for the DM's OK: shown in every editor until answered (`confirm_done`). via: the API chat or an assistant through the map tools. `map`: the name of the map (and level) it is about, which may not be the one on screen. */
  | { t: "confirm"; id: string; via: "chat" | "mcp"; tool: string; text: string; waitMs: number; map?: string }
  /** That question is settled (answered here or elsewhere, or no answer in time). */
  | { t: "confirm_done"; id: string; answer: "allowed" | "refused" | "timeout" | "nobody" }
  /** What Claude Code last said (through its hooks): lets Assist mode wait until it is idle. */
  | { t: "claude_state"; state: ClaudeState }
  /** The selection changed (by the DM in an editor, or by Claude highlighting an area). */
  | { t: "selection"; selection: Selection | null; lock: boolean }
  | { t: "error"; message: string };

export interface FrameHeader {
  t: "snapshot" | "patch" | "derived";
  projectId: string;
  rect: Rect;
  seq: number;
  /** derived frames: river polylines (payload holds temp|moist|seaDist|landDist|lakes|snow[|rock[|volcanic]] as uint8). */
  rivers?: RiverPath[];
}

/** Binary frame: [u32 LE header length][UTF-8 JSON header][pad to 4][payload bytes]. */
export function encodeFrame(header: FrameHeader, payload: ArrayBufferView): ArrayBuffer {
  const hb = new TextEncoder().encode(JSON.stringify(header));
  const off = (4 + hb.length + 3) & ~3;
  const buf = new ArrayBuffer(off + payload.byteLength);
  new DataView(buf).setUint32(0, hb.length, true);
  new Uint8Array(buf, 4, hb.length).set(hb);
  new Uint8Array(buf, off).set(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength));
  return buf;
}

/** Just the header of a binary frame, and where its payload starts (no copy of the payload: climate frames are large). */
export function decodeFrameHeader(buf: ArrayBuffer): { header: FrameHeader; offset: number } {
  const len = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as FrameHeader;
  return { header, offset: (4 + len + 3) & ~3 };
}

export function decodeFrame(buf: ArrayBuffer): { header: FrameHeader; payload: Float32Array; bytes: Uint8Array } {
  const len = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as FrameHeader;
  const off = (4 + len + 3) & ~3;
  const body = buf.slice(off);
  return { header, payload: header.t === "derived" ? new Float32Array(0) : new Float32Array(body), bytes: new Uint8Array(body) };
}

/** Pack derived layers for the wire (rivers travel in the frame header). */
export function packDerived(d: { temp: Uint8Array; moist: Uint8Array; seaDist: Uint8Array; landDist: Uint8Array; lakes: Uint8Array; snow: Uint8Array; rock?: Uint8Array; volcanic?: Uint8Array }): Uint8Array {
  const n = d.temp.length;
  // the stone plane comes first when either optional plane is there (all zeros when only volcanic ground is), then the volcanic plane
  const out = new Uint8Array(n * (d.volcanic ? 8 : d.rock ? 7 : 6));
  if (d.rock) out.set(d.rock, 6 * n);
  if (d.volcanic) out.set(d.volcanic, 7 * n);
  out.set(d.temp, 0); out.set(d.moist, n); out.set(d.seaDist, 2 * n); out.set(d.landDist, 3 * n); out.set(d.lakes, 4 * n); out.set(d.snow, 5 * n);
  return out;
}

export function unpackDerived(bytes: Uint8Array, W: number, H: number, seq: number, rivers: RiverPath[]) {
  const n = W * H;
  return {
    W, H, seq, rivers,
    temp: bytes.subarray(0, n), moist: bytes.subarray(n, 2 * n), seaDist: bytes.subarray(2 * n, 3 * n),
    landDist: bytes.subarray(3 * n, 4 * n), lakes: bytes.subarray(4 * n, 5 * n),
    snow: bytes.length >= 6 * n ? bytes.subarray(5 * n, 6 * n) : new Uint8Array(n),
    ...(bytes.length >= 7 * n && { rock: bytes.subarray(6 * n, 7 * n) }),
    ...(bytes.length >= 8 * n && { volcanic: bytes.subarray(7 * n, 8 * n) }),
  };
}

export interface CheckpointInfo {
  name: string;
  file: string;
  time: string;
  seq: number;
  note?: string;
  /** Saved by the program on its own (a rolling backup), not by a person: only these are ever deleted to make room. */
  auto?: boolean;
}

export const MODEL_PRICES: Record<ModelId, { input: number; output: number; cacheRead: number; cacheWrite: number; label: string }> = {
  // USD per million tokens (cache write = 1.25x input)
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, label: "Opus 5.5" },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, label: "Sonnet 5.5" },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, label: "Haiku 5.5" },
};

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
}
