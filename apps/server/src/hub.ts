/**
 * The authoritative app state: which project is open, its MapSession, the chat agent,
 * and every connected editor. Editors and Claude (chat or MCP) all act through here.
 */
import type { WebSocket } from "ws";
import {
  type Author, type ChatEvent, type ClientMsg, type Derived, type MapDoc, type MapSession as MapSessionT, type RGBAImage, type Rect,
  type ClaudeState, type HookEvent, type RiverPath, type ServerMsg, HeightField, MapSession, claudeStateAfter, climateOf, resolveRiverSources, cropScale, drawRivers, encodeFrame, packDerived, planRegional,
  PROP_PX_PER_SQUARE, battleFloorFromWorld, battleImageSize, battleRoofRects, battleSizeError, battleSpec, createBattleDoc, createZip, describeSample, sampleWorld, isBattle, newFeatureId, regionalFeatures, renderFull, routeWaypoints,
  type BattleExportFormat, battleKey, foundryConnectorProblems, sampleBaseClimate, sketchToHeights, toFoundryLevelsScene, toUniversalVtt, type FoundryLevelDoc,
  type Selection, type ViewInfo, cleanSelection, cleanView, defaultFeather, selectionFeatureExists, selectionShape,
  type BattleLevel, type LevelsFile, MAX_LEVELS, defaultLevels, levelsByHeight, newLevelId, newLevelName, nextLevelElevation,
  type ReferenceKind, type RefInfo, PICTURE_HEAD_BYTES, REFERENCE_KIND_TYPE, pictureKind,
  citySizeError, cityFromWorld, citySizeForPlace, createCityDoc, defaultCellM, isCity, isWorld, renderCity, type RoofPools, groupRoofAssets, CitySpace, citySpec, tracePoint, traceToPicture, type RoofStyle,
} from "@mapmaker/core";
import { type ToolContext, decodeImage, encodePng, encodePngRgba } from "@mapmaker/tools";
import { type ChatState, type ModelCall, ChatAgent } from "./agent.ts";
import { type MapCompute, WorkerCompute } from "./compute.ts";
import type { AssetLibrary } from "./assets.ts";
import type { NoiseStore } from "./noiseStore.ts";
import { PictureRefused, ProjectStore } from "./store.ts";

export interface HubOptions {
  /**
   * Rolling backups: while a map is being edited, an automatic checkpoint is saved after a save at most this often (milliseconds;
   * 0 or missing turns them off) and only the newest `autoBackupKeep` of them are kept. They show in the Checkpoints list as "Auto ..."
   * with the usual Restore button.
   */
  autoBackupMs?: number;
  autoBackupKeep?: number;
}

/** "Auto 2026-11-18 14:05": the name of a rolling backup (local time, so it matches the clock the person is looking at). */
export function autoBackupName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Auto ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A level name as a piece of a file name: lower case letters, digits and hyphens ("Upper floor" is "upper-floor"). */
function fileSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "level";
}

/** A level name made safe (no control characters, at most 60 characters), or null when nothing is left. */
function cleanLevelName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || null;
}

/** One level of an open battlemap: its own floor document and history. A map with no levels list has one. */
interface LevelRuntime {
  id: string;
  session: MapSessionT;
  dirty: boolean;
}

interface OpenProject {
  id: string;
  /** The session of the level being worked on (the editor, Claude's tools, selection and undo all act on it). */
  session: MapSessionT;
  /** The level list (battlemaps; a world map has the default one) and the floor document of each level. */
  levels: LevelsFile;
  runtime: LevelRuntime[];
  levelsDirty: boolean;
  agent: ChatAgent;
  saveTimer: NodeJS.Timeout | null;
  dirty: boolean;
  /** When the last rolling backup was taken (ms since 1970; 0 = none yet). */
  lastAutoBackup: number;
  /** Climate, coast distances, lakes and rivers, and the content version they match. */
  derived: Derived | null;
  derivedVersion: number;
  /** An in-flight recompute (on the compute worker) and the version it's for. */
  deriving: Promise<Derived> | null;
  derivingVersion: number;
  contentVersion: number;
  derivedTimer: NodeJS.Timeout | null;
  /** Climate regions as last seen (a change means the climate must be recomputed). */
  regionsKey: string;
  /** Meta settings the climate and server render depend on, as last seen. */
  metaKey: string;
}

const DERIVED_DEBOUNCE_MS = 700;
const WARM_DELAY_MS = 20_000;

export class Hub {
  private open: OpenProject | null = null;
  private clients = new Set<WebSocket>();
  /** Clients that only want JSON (the phone viewer): no heightmap or derived-layer frames. */
  private lite = new WeakSet<WebSocket>();
  private opening: Promise<void> = Promise.resolve();
  /** What happened at start that the person should know (a map that wouldn't open and was skipped): told to the first editor that connects. */
  private startupNotes: string[] = [];
  /** The user's asset library, when a folder is configured. */
  assets: AssetLibrary | null = null;
  /** Texture noise kept on disk, served to the editor (none in tests that don't want it). */
  noise: NoiseStore | null = null;
  /** What Claude Code last told us through its hooks (the editor's Assist mode waits for "idle"). */
  private claude: ClaudeState = "unknown";
  /** What the DM has selected in the editor, whether Claude's edits are locked to it, and what they are looking at (reset when another map opens). */
  private selection: Selection | null = null;
  private selectionLock = false;
  private view: ViewInfo | null = null;

  get selectionState() {
    return { selection: this.selection, lock: this.selectionLock, view: this.view };
  }

  /**
   * Set (or clear) the selection and tell every editor. An area (or a climate region) can lock Claude's edits to it: the session then clips them.
   * Battlemaps have no selection.
   */
  setSelection(selection: Selection | null, lock: boolean) {
    const op = this.open;
    if (!op) return;
    if (!isWorld(op.session.doc)) { selection = null; lock = false; }
    const shape = selectionShape(selection, op.session.doc.features);
    this.selection = selection;
    this.selectionLock = lock && !!shape;
    op.session.editLock = this.selectionLock && shape ? { shape, featherPx: defaultFeather(shape) } : null;
    this.broadcast({ t: "selection", selection: this.selection, lock: this.selectionLock });
  }

  /** The features changed: a selected feature that is gone is deselected, and a lock to a climate region follows its outline. */
  private syncSelection(op: OpenProject) {
    const sel = this.selection;
    if (!sel || sel.kind !== "feature" || this.open !== op) return;
    if (!selectionFeatureExists(sel, op.session.doc.features)) this.setSelection(null, false);
    else if (sel.featureKind === "region" && this.selectionLock) this.setSelection(sel, true);
  }

  /** A Claude Code hook fired (SessionStart, UserPromptSubmit, Stop, Notification, SessionEnd). */
  claudeHook(ev: HookEvent) {
    const next = claudeStateAfter(this.claude, ev);
    if (next === this.claude) return;
    this.claude = next;
    this.broadcast({ t: "claude_state", state: next });
  }

  get claudeState(): ClaudeState {
    return this.claude;
  }

  constructor(readonly store: ProjectStore, private modelCall: ModelCall | null, private compute: MapCompute = new WorkerCompute(), private opts: HubOptions = {}) {}

  async close() {
    await this.flush();
    await this.compute.close();
  }

  get activeId() {
    return this.open?.id ?? null;
  }

  get session(): MapSessionT {
    if (!this.open) throw new Error("No project is open. Use list_projects / open_project or create_map.");
    return this.open.session;
  }

  // ---------------------------------------------------------------- projects
  /** Hand a level's session events to the editors (the active level only), the saver and the derived-layer logic. */
  private wire(op: OpenProject, rt: LevelRuntime) {
    const session = rt.session;
    const id = op.id;
    session.on((e) => {
      if (this.open !== op) return;
      const active = op.session === session; // (a level that isn't being worked on changes only through a restore: it is saved, but the editors don't see it)
      if (e.type === "patch") {
        if (active) {
          const frame = encodeFrame({ t: "patch", projectId: id, rect: e.rect, seq: e.seq }, session.doc.height.copyRect(e.rect));
          for (const c of this.clients) if (!this.lite.has(c) && c.readyState === c.OPEN) c.send(frame);
        }
        this.markDirty(op, rt);
        if (active) this.contentChanged(op);
      } else if (e.type === "meta") {
        if (active) this.broadcast({ t: "meta", meta: e.meta });
        this.markDirty(op, rt);
        // only settings that change the climate or the server's render need a recompute (not the grid, name or notes)
        const key = JSON.stringify([e.meta.seaLevel, e.meta.climate, e.meta.style]);
        if (active && key !== op.metaKey) {
          op.metaKey = key;
          this.contentChanged(op);
        }
      } else if (e.type === "features") {
        if (active) this.broadcast({ t: "features", features: e.features });
        this.markDirty(op, rt);
        if (active) this.syncSelection(op);
        const key = JSON.stringify([e.features.regions ?? [], resolveRiverSources(e.features)]); // regions and river sources (and where their places are) feed the climate and rivers
        if (active && key !== op.regionsKey) {
          op.regionsKey = key;
          this.contentChanged(op); // climate regions feed the climate model
        }
      } else if (e.type === "history" && active) {
        this.broadcast({ t: "change", change: e.change, canUndo: session.canUndo, canRedo: session.canRedo });
        // a finished brush stroke: derived layers may have been skipped while it was in progress
        if (op.derivedVersion !== op.contentVersion) this.scheduleDerived(op);
      }
    });
  }

  async openProject(id: string): Promise<void> {
    const run = async () => {
      if (this.open?.id === id) return;
      if (!(await this.store.exists(id))) throw new Error(`No project "${id}".`);
      await this.flush();
      const doc = await this.store.load(id);
      const levels = isBattle(doc) ? await this.store.readLevels(id) : defaultLevels();
      const firstSession = new MapSession(doc);
      const runtime: LevelRuntime[] = [{ id: levels.levels[0].id, session: firstSession, dirty: false }];
      for (const l of levels.levels.slice(1)) {
        try {
          runtime.push({ id: l.id, session: new MapSession(await this.store.loadLevel(id, levels, l.id)), dirty: false });
        } catch (e) {
          throw new Error(`The level "${l.name}" of this battlemap couldn't be read, so the map was not opened (nothing was changed). ${(e as Error).message}`);
        }
      }
      const session = (runtime.find((r) => r.id === levels.active) ?? runtime[0]).session;
      const saved = await this.store.readJson<ChatState>(id, "chat.json");
      const agent = new ChatAgent(this.agentHost(id), this.modelCall, saved ?? undefined);
      const op: OpenProject = {
        id, session, levels, runtime, levelsDirty: false, agent, saveTimer: null, dirty: false, lastAutoBackup: await this.store.lastAutoCheckpointTime(id),
        derived: null, derivedVersion: -1, deriving: null, derivingVersion: -1, contentVersion: 0, derivedTimer: null,
        regionsKey: JSON.stringify([doc.features?.regions ?? [], resolveRiverSources(doc.features)]),
        metaKey: JSON.stringify([doc.meta.seaLevel, doc.meta.climate, doc.meta.style]),
      };
      for (const rt of runtime) this.wire(op, rt);
      this.open = op;
      this.selection = null; this.selectionLock = false; this.view = null; // a selection belongs to the map it was made on
      this.broadcast({ t: "selection", selection: null, lock: false });
      await this.store.writeLastOpen(id).catch(() => {});
      await this.refreshProjects();
      for (const c of this.clients) await this.sendProject(c);
      // something about the files had to be dealt with while loading (an older format brought up to date, a file that couldn't be read)
      for (const message of this.store.takeNotices(id)) this.broadcast({ t: "error", message });
      if (isWorld(doc)) {
        setTimeout(() => void this.refreshDerived(op), 0);
        // Texture noise for previews: about 10 s of CPU on a 2048 map, so it waits until the editor has started up instead of competing with it.
        setTimeout(() => { if (this.open === op) this.compute.warm(op.session.doc); }, WARM_DELAY_MS);
      }
    };
    this.opening = this.opening.then(run, run);
    return this.opening;
  }

  async createProject(o: { name: string; width: number; height: number; kmPerPx: number }) {
    const doc = await this.store.create(o);
    await this.openProject(doc.meta.id);
    return (await this.store.list()).find((p) => p.id === doc.meta.id)!;
  }

  /** Make a city map (a city seen from above, made of buildings and streets, sized in metres) and open it. */
  async createCity(o: { name: string; widthM: number; heightM: number; cellM?: number }) {
    const cell = o.cellM ?? defaultCellM(o.widthM, o.heightM);
    const err = citySizeError(o.widthM, o.heightM, cell);
    if (err) throw new Error(err);
    const name = (o.name ?? "").trim() || "City";
    const id = await this.store.uniqueId(name);
    const doc = createCityDoc({ id, name, widthM: o.widthM, heightM: o.heightM, cellM: cell, seed: Math.floor(Math.random() * 2 ** 31) });
    await this.store.createFrom(doc, `# ${name}: Design Brief\n\n*A city map, ${doc.meta.city!.widthM} x ${doc.meta.city!.heightM} metres. Record what the city is, how it is laid out and what the DM has decided. Names and history are the DM's: only record what they confirm.*\n`);
    await this.openProject(id);
    return (await this.store.list()).find((p) => p.id === id)!;
  }

  /**
   * Start a city from a spot on the open world map (the "City here" tool, Claude's create_city_here): its climate, height above the sea, slope, coast, river and woods come from
   * what the world map says is there (core cityWorld.ts), and it remembers the spot (`meta.origin`) for the way back. Refused at sea.
   */
  async createCityFromWorld(o: { name: string; x: number; y: number; widthM?: number; heightM?: number; cellM?: number; place?: string }) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    const parent = op.session.doc;
    if (!isWorld(parent)) throw new Error("Open a world map first: this starts a city from a spot on one.");
    if (op.session.inTransaction) op.session.commit();
    if (!(o.x >= 0 && o.y >= 0 && o.x < parent.height.w && o.y < parent.height.h)) throw new Error(`That point is off the map (${parent.height.w} x ${parent.height.h} px).`);
    const d = await this.refreshDerived(op, true);
    const sample = sampleWorld(parent, d, o.x, o.y);
    if (sample.underwater) throw new Error("That spot is sea on the world map. Pick a point on land (on the coast, for a harbour town).");
    const kind = parent.features?.places.find((p) => p.name === o.place)?.type;
    const size = citySizeForPlace(kind);
    const widthM = o.widthM ?? size.widthM, heightM = o.heightM ?? size.heightM, cell = o.cellM ?? defaultCellM(widthM, heightM);
    const err = citySizeError(widthM, heightM, cell);
    if (err) throw new Error(err);
    const name = (o.name ?? "").trim() || o.place || `${parent.meta.name} town`;
    const id = await this.store.uniqueId(name);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const doc = createCityDoc({ id, name, widthM, heightM, cellM: cell, seed });
    const said = cityFromWorld(doc, sample, { kmPerPx: parent.meta.kmPerPx, seed });
    const at = { x: Math.round(o.x), y: Math.round(o.y) };
    doc.meta.origin = { id: parent.meta.id, name: parent.meta.name, ...at };
    doc.meta.notes = `Started from ${parent.meta.name} at (${at.x}, ${at.y}): ${said.join("; ")}.`;
    await this.store.createFrom(doc, `# ${name}: Design Brief

*A city map, ${widthM} x ${heightM} metres, started from map px (${at.x}, ${at.y}) of **${parent.meta.name}** (project \`${parent.meta.id}\`)${o.place ? `, the place "${o.place}"` : ""}. From the world map (a rough start: a world-map pixel is ${parent.meta.kmPerPx} km): ${said.join("; ")}. Record what the city is, how it is laid out and what the DM has decided. Names are the DM's.*\n`);
    await this.openProject(id);
    const info = (await this.store.list()).find((p) => p.id === id)!;
    return { ...info, from_world: said };
  }

  /**
   * The city picture reader: read buildings out of the open city's trace picture, by roof colour (core cityReader.ts, on the compute thread). Everything in metres: the area
   * (none: the whole picture), where a roof of each kind is (and its look), where the ground is. Returns what it found, in metres, not yet added: those already covered by a
   * building are left out and counted.
   */
  async readCityPicture(o: { area?: [number, number][]; roofs: { x: number; y: number; look: RoofStyle }[]; ground?: [number, number][]; tolerance?: number; minAreaM2?: number; maxAreaM2?: number }) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    const doc = op.session.doc;
    if (!isCity(doc)) throw new Error("The picture reader is for city maps.");
    const t = doc.features?.trace;
    if (!t) throw new Error("Lay the picture over the city first (References: Trace over map) and line it up, then read it.");
    if (!o.roofs.length) throw new Error("Give at least one roof to read by (one of each kind of roof).");
    const bytes = await this.store.readRef(op.id, t.ref);
    if (!bytes) throw new Error(`The trace picture "${t.ref}" is missing from References.`);
    const toPic = ([x, y]: [number, number]) => traceToPicture(t, x, y);
    const area = o.area && o.area.length >= 3 ? o.area.map(toPic) : ([[0, 0], [t.w, 0], [t.w, t.h], [0, t.h]] as [number, number][]);
    const s2 = t.scale * t.scale;
    const res = await this.compute.readPicture(`${op.id}/${t.ref}/${t.w}x${t.h}`, new Uint8Array(bytes), {
      area, roofs: o.roofs.map((r) => { const [x, y] = toPic([r.x, r.y]); return { x, y, look: r.look }; }),
      ground: (o.ground ?? []).map((g) => { const [x, y] = toPic(g); return { x, y }; }),
      tolerance: o.tolerance, minArea: (o.minAreaM2 ?? 10) / s2, maxArea: (o.maxAreaM2 ?? 3000) / s2,
    });
    const sp = citySpec(doc), space = new CitySpace(doc), buildings: { points: [number, number][]; look: RoofStyle }[] = [];
    let alreadyThere = 0;
    for (const b of res.buildings) {
      const points = b.points.map(([u, v]) => { const [x, y] = tracePoint(t, u, v); return [Math.round(Math.min(sp.widthM, Math.max(0, x)) * 100) / 100, Math.round(Math.min(sp.heightM, Math.max(0, y)) * 100) / 100] as [number, number]; });
      if (space.onBuilding(points)) { alreadyThere++; continue; }
      buildings.push({ points, look: b.look });
    }
    return { buildings, skipped: res.skipped, alreadyThere, colours: res.colours };
  }

  /** Make a battlemap (a grid-based tabletop map) and open it. */
  async createBattle(o: { name: string; squaresX: number; squaresY: number; feetPerSquare?: number; pxPerSquare?: number; gridType?: "square" | "hex" | "none"; roomMargin?: number }) {
    const px = o.pxPerSquare ?? 70;
    const err = battleSizeError(o.squaresX, o.squaresY, px);
    if (err) throw new Error(err);
    const name = o.name.trim() || "Battlemap";
    const id = await this.store.uniqueId(name);
    const doc = createBattleDoc({ id, name, squaresX: o.squaresX, squaresY: o.squaresY, pxPerSquare: px, feetPerSquare: o.feetPerSquare, gridType: o.gridType, roomMargin: o.roomMargin, seed: Math.floor(Math.random() * 2 ** 31) });
    await this.store.createFrom(doc, `# ${name}: Design Brief\n\n*A battlemap, ${doc.meta.battle!.squaresX} x ${doc.meta.battle!.squaresY} squares at ${doc.meta.battle!.feetPerSquare} ft per square. Record what the scene is, who is here and what the DM has decided.*\n`);
    await this.openProject(id);
    return (await this.store.list()).find((p) => p.id === id)!;
  }

  private roofPoolsCache: { scan: string | null; pools: RoofPools } | null = null;

  /** The roof textures of the asset packs sorted by roof look (null when there is no asset library): what a city's buildings are drawn from before a roof is drawn. */
  roofPools(): RoofPools | null {
    const lib = this.assets;
    if (!lib) return null;
    if (this.roofPoolsCache && this.roofPoolsCache.scan === lib.lastScan && !lib.scanning) return this.roofPoolsCache.pools;
    const pools = groupRoofAssets(lib.roofTextures());
    this.roofPoolsCache = { scan: lib.lastScan, pools };
    return pools;
  }

  /** The roof pictures the open city's buildings use, decoded (by asset id), for drawing it; one that can't be had is left out (its buildings are drawn from their look). */
  async cityRoofTiles(doc: MapDoc): Promise<Record<string, import("@mapmaker/core").TileData>> {
    const lib = this.assets, out: Record<string, import("@mapmaker/core").TileData> = {};
    if (!lib) return out;
    for (const a of new Set((doc.features?.buildings ?? []).map((b) => b.asset).filter((a): a is string => !!a))) {
      const t = await lib.tile(a, undefined, true);
      if (t) out[a] = t;
    }
    return out;
  }

  /** Pack textures and object images the open battlemap needs, decoded for the render worker, and how many couldn't be had. */
  async battleAssets(doc: MapDoc): Promise<{ opts: { tiles?: Record<number, import("@mapmaker/core").TileData>; sprites?: Record<string, import("@mapmaker/core").SpriteData>; roofTiles?: Record<string, import("@mapmaker/core").TileData> }; missing: number }> {
    const lib = this.assets;
    const spec = battleSpec(doc);
    const palette = spec.palette ?? [];
    const props = doc.features?.props ?? [];
    const pictured = (doc.features?.roofs ?? []).filter((r) => r.asset);
    if (!lib || (!palette.length && !props.length && !pictured.length)) return { opts: {}, missing: palette.length + props.length + pictured.length };
    let missing = 0;
    // roofs made of a picture from an asset pack: the pictures, by asset id
    const roofTiles: Record<string, import("@mapmaker/core").TileData> = {};
    for (const r of pictured) {
      if (roofTiles[r.asset!]) continue;
      const t = await lib.tile(r.asset!, r.tile ?? 2, true);
      if (t) roofTiles[r.asset!] = t; else missing++;
    }
    const tiles: Record<number, import("@mapmaker/core").TileData> = {};
    const used = new Set<number>();
    const data = doc.height.data;
    for (let i = 0; i < data.length; i += 3) used.add(data[i] | 0);
    for (const e of palette) {
      if (!used.has(e.id)) continue;
      const t = await lib.tile(e.asset, e.squares);
      if (t) tiles[e.id] = e.squares ? { ...t, squares: e.squares } : t; else missing++;
    }
    const sprites: Record<string, import("@mapmaker/core").SpriteData> = {};
    const maxScale = new Map<string, number>();
    for (const p of props) maxScale.set(p.asset, Math.max(maxScale.get(p.asset) ?? 0, p.scale ?? 1));
    for (const [asset, sc] of maxScale) {
      const s = await lib.sprite(asset, (spec.pxPerSquare * sc) / PROP_PX_PER_SQUARE);
      if (s) sprites[asset] = s; else missing++;
    }
    return { opts: { tiles, sprites, ...(pictured.length && { roofTiles }) }, missing };
  }

  // ---------------------------------------------------------------- battlemap levels
  private battleOp(): OpenProject {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (!isBattle(op.session.doc)) throw new Error("Only battlemaps have levels.");
    return op;
  }

  /** The levels of the open battlemap, and which one is being worked on. */
  levelsInfo(): LevelsFile | null {
    return this.open && isBattle(this.open.session.doc) ? structuredClone(this.open.levels) : null;
  }

  private levelsChanged(op: OpenProject) {
    op.levelsDirty = true;
    op.dirty = true;
    if (!op.saveTimer) op.saveTimer = setTimeout(() => { op.saveTimer = null; void this.saveNow(op); }, 1500);
    this.broadcast({ t: "levels", levels: structuredClone(op.levels) });
  }

  /** Work on another level: the editors are sent that level as if the map had been opened. Nothing is undone or lost by switching. */
  async setActiveLevel(levelId: string): Promise<void> {
    const op = this.battleOp();
    const rt = op.runtime.find((r) => r.id === levelId);
    if (!rt) throw new Error(`No level "${levelId}".`);
    if (rt.session === op.session) return;
    if (op.session.inTransaction) op.session.commit();
    op.session = rt.session;
    op.levels = { ...op.levels, active: levelId };
    this.selection = null; this.selectionLock = false; // a selection belongs to the level it was made on
    this.levelsChanged(op);
    this.broadcast({ t: "selection", selection: null, lock: false });
    for (const c of this.clients) await this.sendProject(c);
  }

  /** Add an empty level above the highest or below the lowest (same size, grid, light level and floor textures as the level being worked on), and work on it. */
  async addLevel(where: "above" | "below", name?: string): Promise<BattleLevel> {
    const op = this.battleOp();
    if (op.runtime.length >= MAX_LEVELS) throw new Error(`A battlemap can have at most ${MAX_LEVELS} levels.`);
    const list = op.levels.levels;
    const level: BattleLevel = { id: newLevelId(list.map((l) => l.id)), name: cleanLevelName(name) ?? newLevelName(list, where), ...nextLevelElevation(list, where) };
    this.makeLevel(op, level);
    await this.setActiveLevel(level.id);
    return level;
  }

  /** An empty level, same size, grid, light level and floor textures as the level being worked on, added to the list (not yet worked on). */
  private makeLevel(op: OpenProject, level: BattleLevel): LevelRuntime {
    const spec = battleSpec(op.session.doc);
    const doc = createBattleDoc({ id: op.id, name: op.session.doc.meta.name, squaresX: spec.squaresX, squaresY: spec.squaresY, pxPerSquare: spec.pxPerSquare, feetPerSquare: spec.feetPerSquare, gridType: spec.gridType, sub: spec.sub, seed: Math.floor(Math.random() * 2 ** 31) });
    doc.meta.battle = { ...doc.meta.battle!, ...(spec.palette && { palette: structuredClone(spec.palette) }), ...(spec.ambient !== undefined && { ambient: spec.ambient }), ...(spec.ambientTint && { ambientTint: spec.ambientTint }) };
    const rt: LevelRuntime = { id: level.id, session: new MapSession(doc), dirty: true };
    op.runtime.push(rt);
    op.levels = { ...op.levels, levels: [...op.levels.levels, level] };
    this.wire(op, rt);
    this.levelsChanged(op);
    return rt;
  }

  /** Rename a level or change its elevations (feet). */
  async updateLevel(levelId: string, patch: { name?: string; bottom?: number; top?: number }): Promise<BattleLevel> {
    const op = this.battleOp();
    const cur = op.levels.levels.find((l) => l.id === levelId);
    if (!cur) throw new Error(`No level "${levelId}".`);
    const next = { ...cur };
    if (patch.name !== undefined) { const n = cleanLevelName(patch.name); if (!n) throw new Error("A level needs a name."); next.name = n; }
    if (patch.bottom !== undefined) { if (!Number.isFinite(patch.bottom)) throw new Error("The bottom elevation must be a number of feet."); next.bottom = patch.bottom; }
    if (patch.top !== undefined) { if (!Number.isFinite(patch.top)) throw new Error("The top elevation must be a number of feet."); next.top = patch.top; }
    if (!(next.top > next.bottom)) throw new Error("A level's top must be higher than its bottom.");
    if (op.levels.levels.some((l) => l.id !== levelId && l.name.toLowerCase() === next.name.toLowerCase())) throw new Error(`There is already a level called "${next.name}".`);
    op.levels = { ...op.levels, levels: op.levels.levels.map((l) => (l.id === levelId ? next : l)) };
    this.levelsChanged(op);
    return next;
  }

  /** Remove a level and its files. A checkpoint of the whole map is saved first, so it can be got back. The first level can't be removed. */
  async removeLevel(levelId: string): Promise<void> {
    const op = this.battleOp();
    const level = op.levels.levels.find((l) => l.id === levelId);
    if (!level) throw new Error(`No level "${levelId}".`);
    if (levelId === op.levels.levels[0].id) throw new Error("The first level can't be removed (rename it instead).");
    await this.saveCheckpoint(`Before removing ${level.name}`.slice(0, 60), `Saved automatically before the level "${level.name}" was removed`);
    if (op.levels.active === levelId) await this.setActiveLevel(op.levels.levels[0].id);
    op.runtime = op.runtime.filter((r) => r.id !== levelId);
    op.levels = { ...op.levels, levels: op.levels.levels.filter((l) => l.id !== levelId) };
    const before = { ...op.levels, levels: [...op.levels.levels, level] }; // (the list as it was, for finding the level's folder)
    await this.store.writeLevels(op.id, structuredClone(op.levels));
    op.levelsDirty = false;
    await this.store.removeLevelFiles(op.id, before, levelId);
    this.broadcast({ t: "levels", levels: structuredClone(op.levels) });
  }

  /** Make a battlemap of the ground at a point of the open world map: its climate, slope, water, coast and rivers choose the floors. */
  async createBattleFromWorld(o: { name: string; x: number; y: number; squaresX?: number; squaresY?: number; feetPerSquare?: number }) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    const parent = op.session.doc;
    if (!isWorld(parent)) throw new Error("Open a world map first: this makes a battlemap from a spot on one.");
    if (op.session.inTransaction) op.session.commit();
    if (!(o.x >= 0 && o.y >= 0 && o.x < parent.height.w && o.y < parent.height.h)) throw new Error(`That point is off the map (${parent.height.w} x ${parent.height.h} px).`);
    const sx = o.squaresX ?? 30, sy = o.squaresY ?? 20;
    const err = battleSizeError(sx, sy, 70);
    if (err) throw new Error(err);
    const d = await this.refreshDerived(op, true);
    const sample = sampleWorld(parent, d, o.x, o.y);
    const what = describeSample(sample);
    const name = o.name.trim() || `${parent.meta.name} scene`;
    const id = await this.store.uniqueId(name);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const doc = createBattleDoc({ id, name, squaresX: sx, squaresY: sy, pxPerSquare: 70, feetPerSquare: o.feetPerSquare, seed });
    battleFloorFromWorld(doc, sample, seed);
    doc.meta.origin = { id: parent.meta.id, name: parent.meta.name, x: Math.round(o.x), y: Math.round(o.y) };
    doc.meta.notes = `A scene at ${parent.meta.name} (${Math.round(o.x)}, ${Math.round(o.y)}): ${what}.`;
    await this.store.createFrom(doc, `# ${name}: Design Brief\n\n*A battlemap of ${what}, at map px (${Math.round(o.x)}, ${Math.round(o.y)}) of **${parent.meta.name}** (project \`${parent.meta.id}\`), ${sx} x ${sy} squares. The floors were chosen from that spot's climate, slope and water; everything else (walls, rooms, objects, who and what is here) is for the DM to decide.*\n`);
    await this.openProject(id);
    const info = (await this.store.list()).find((p) => p.id === id)!;
    return { ...info, description: what };
  }

  /** A level of the open battlemap by id or by name (any case); an error that lists the levels when there is none, or when a name is ambiguous. */
  private levelByRef(op: OpenProject, ref: string): BattleLevel {
    const q = ref.trim().toLowerCase();
    const byId = op.levels.levels.find((l) => l.id.toLowerCase() === q);
    if (byId) return byId;
    const byName = op.levels.levels.filter((l) => l.name.toLowerCase() === q);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) throw new Error(`More than one level is called "${ref}": use its id (${byName.map((l) => l.id).join(", ")}).`);
    throw new Error(`There is no level "${ref}". The levels are: ${levelsByHeight(op.levels.levels).map((l) => `${l.name} (${l.id})`).join(", ")}.`);
  }

  /** The floor documents of the open battlemap's levels, from the lowest to the highest. */
  private levelDocs(op: OpenProject): { level: BattleLevel; doc: MapDoc }[] {
    return levelsByHeight(op.levels.levels).map((level) => ({ level, doc: op.runtime.find((r) => r.id === level.id)!.session.doc }));
  }

  /** One level of the open battlemap drawn as it is exported: walls and doors kept, lights and the DM's notes left out (the tabletop does its own lighting). */
  private async renderLevelArt(doc: MapDoc): Promise<{ png: Uint8Array; w: number; h: number }> {
    const { w, h } = battleImageSize(battleSpec(doc));
    const data = await this.compute.battle(doc, { overlay: true, lights: false, ...(await this.battleAssets(doc)).opts });
    return { png: encodePng({ w, h, data }), w, h };
  }

  /**
   * The open battlemap as a file for a virtual tabletop: image, Universal VTT, or a Foundry scene (zip). A battlemap of several levels gives a Foundry
   * scene with every level (one picture each); the image and the Universal VTT file are of the level being worked on, named with it.
   */
  async battleExport(format: BattleExportFormat, level?: string): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (!isBattle(op.session.doc)) throw new Error("Only battlemaps can be exported this way.");
    if (op.session.inTransaction) op.session.commit();
    // the picture and the Universal VTT file are of one level: the one asked for, else the one being worked on
    const chosen = level ? this.levelByRef(op, level) : op.levels.levels.find((l) => l.id === op.levels.active)!;
    const doc = op.runtime.find((r) => r.id === chosen.id)!.session.doc;
    const docs = this.levelDocs(op);
    const many = docs.length > 1;
    const base = op.id;
    const active = chosen;
    const enc = new TextEncoder();
    // the DM's key (numbered notes) as a Markdown list: no picture needed
    if (format === "key") {
      const text = many
        ? docs.map(({ level, doc: d }) => battleKey({ ...d, meta: { ...d.meta, name: `${d.meta.name}, ${level.name}` } })).join("\n")
        : battleKey(doc);
      return { name: `${base}-key.md`, mime: "text/markdown; charset=utf-8", bytes: enc.encode(text) };
    }
    if (format === "png" || format === "uvtt") {
      const stem = many ? `${base}-${fileSlug(active.name)}` : base;
      const { png } = await this.renderLevelArt(doc);
      if (format === "png") return { name: `${stem}.png`, mime: "image/png", bytes: png };
      return { name: `${stem}.dd2vtt`, mime: "application/json", bytes: enc.encode(JSON.stringify(toUniversalVtt(doc, Buffer.from(png).toString("base64")))) };
    }
    // a Foundry scene: every level, one picture each
    const files: { name: string; data: Uint8Array }[] = [];
    const levels: FoundryLevelDoc[] = [];
    for (const [i, { level, doc: d }] of docs.entries()) {
      const image = many ? `${base}-${i + 1}-${fileSlug(level.name)}.png` : `${base}.png`;
      files.push({ name: image, data: (await this.renderLevelArt(d)).png });
      // the level's roofs, each as a picture of its own (cropped to the roof) that becomes a Foundry tile with a ceiling region over it
      let roofImages: (string | null)[] | undefined;
      const rects = battleRoofRects(d);
      if (rects.some(Boolean)) {
        const data = await this.compute.battle(d, { roofPictures: true, ...(await this.battleAssets(d)).opts });
        let at = 0;
        roofImages = rects.map((r, k) => {
          if (!r) return null;
          const n = r.w * r.h * 4, name = many ? `${base}-${i + 1}-${fileSlug(level.name)}-roof-${k + 1}.png` : `${base}-roof-${k + 1}.png`;
          files.push({ name, data: encodePngRgba({ w: r.w, h: r.h, data: data.subarray(at, at + n) }) });
          at += n;
          return `maps/${name}`;
        });
      }
      levels.push({ doc: d, name: level.name, bottom: level.bottom, top: level.top, image: `maps/${image}`, ...(roofImages && { roofImages }) });
    }
    // (the scene opens on the level being worked on)
    const first = levels.findIndex((l) => l.name === active.name);
    if (first > 0) levels.unshift(...levels.splice(first, 1));
    const scene = toFoundryLevelsScene(levels, doc.meta.name);
    const pictures = files.map((f) => f.name).join(", ");
    // stairs, ladders and holes: what they became, and any that lead to a level that isn't there
    const nConn = docs.reduce((n, d) => n + (d.doc.features?.connectors?.length ?? 0), 0);
    const problems = foundryConnectorProblems(levels);
    const hasRoofs = files.some((f) => /-roof(-\d+)?\.png$/.test(f.name));
    const roofNote = hasRoofs
      ? `The *-roof-N.png pictures are roofs. Each is a Tile at the top of its level (Surface occlusion) with a Define Surface region over the roof's outline, so in Foundry 14.367 a roof is cut away while\r\n` +
        `a token YOU CONTROL stands under it (inside its outline and below the roof), and drawn again when the token leaves; every other roof stays. A token you don't control stays hidden under the roof.\r\n` +
        `The GM can hold the "Highlight Objects" key (Alt by default) to see through every roof at once; a GM's mouse over a roof's outline does the same. The roofs have no shadow of their own in this export (it would stay behind\r\n` +
        `as a dark ring when the roof fades). Tried in the GM's view only: a player's view has not been looked at yet.\r\n\r\n`
      : "";
    const connectorNote = roofNote + (nConn
      ? `Stairs and ladders are Regions with the Change Level behaviour (walk onto one and Foundry asks whether to move to the other level). A level with a hole in its floor has a floor Region\r\n` +
        `(Define Surface) with the hole cut out of it. How a hole behaves in play hasn't been looked at in Foundry yet.\r\n` +
        (problems.length ? `Not exported: ${problems.join(" ")}\r\n` : "") + `\r\n`
      : "");
    const readme =
      `Foundry VTT scene for "${doc.meta.name}"\r\n\r\n` +
      `1. Upload ${many ? "the PNG pictures (" + pictures + ")" : files[0].name} into your Foundry data folder, in a folder called "maps", with the File Browser.\r\n` +
      `2. In Foundry, create a Scene (or open an existing one), right-click it in the Scenes list > Import Data, and choose ${base}-scene.json.\r\n` +
      `3. If a map doesn't show, open the scene's configuration, go to Levels and set each level's Background to where you uploaded its PNG.\r\n\r\n` +
      (many
        ? `This is a Foundry v14 scene with ${docs.length} Levels (${docs.map((d) => d.level.name).join(", ")}), each with its own picture, walls, doors and lights, stacked by elevation.\r\n` +
          (nConn ? "" : `No stairs, ladders or holes were placed on the map; add any in Foundry (a Region with the Change Level behaviour).\r\n`)
        : `This is a Foundry v14 scene: the map is one Level, with its walls, doors and lights tagged to it.\r\n`) +
      connectorNote +
      `The same kind of scene (one level, with its walls, doors, window and lights) was tried in Foundry v14 build 367 and worked. If yours doesn't import cleanly,\r\n` +
      `tell us what Foundry said, or use the .dd2vtt export with the Universal Battlemap Importer module instead.\r\n`;
    return {
      name: `${base}-foundry.zip`, mime: "application/zip",
      bytes: createZip([...files, { name: `${base}-scene.json`, data: enc.encode(JSON.stringify(scene, null, 2)) }, { name: "README.txt", data: enc.encode(readme) }]),
    };
  }

  /** A picture of one level of the open battlemap (floor, walls, doors and props; no lights or notes), for the editor to show faintly under the level above. */
  async levelPicture(projectId: string, levelId: string): Promise<Uint8Array | null> {
    const op = this.open;
    if (!op || op.id !== projectId || !isBattle(op.session.doc)) return null;
    const rt = op.runtime.find((r) => r.id === levelId);
    if (!rt) return null;
    if (op.session.inTransaction) op.session.commit();
    return (await this.renderLevelArt(rt.session.doc)).png;
  }

  /**
   * Make a regional map: a separate, more detailed map of one area of the open map, with the
   * parent's climate carried over and the places and labels inside the area copied in.
   */
  async createRegional(o: { name: string; rect: Rect }) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (!isWorld(op.session.doc)) throw new Error("Only a world map can have a regional map.");
    if (op.session.inTransaction) op.session.commit();
    const parent = op.session.doc;
    const plan = planRegional(o.rect, parent.height.w, parent.height.h);
    if ("error" in plan) throw new Error(plan.error);
    const name = o.name.trim() || `${parent.meta.name} detail`;
    const d = await this.refreshDerived(op, true);
    if (!d) throw new Error("The map's climate and rivers couldn't be computed.");
    const { rect, factor } = plan;
    const seed = (parent.meta.seed * 7919 + rect.x * 31 + rect.y * 17 + rect.w) % 2147483647;
    const heights = await this.compute.regional(parent, plan, seed);
    const c = climateOf(parent);
    const latAtRow = (y: number) => c.latTop + (c.latBot - c.latTop) * (y / parent.height.h);
    const id = await this.store.uniqueId(name);
    const now = new Date().toISOString();
    const doc: MapDoc = {
      meta: {
        id, name, kind: "world", width: plan.width, height: plan.height, kmPerPx: parent.meta.kmPerPx / factor,
        seaLevel: parent.meta.seaLevel, seed, createdAt: now, updatedAt: now, style: parent.meta.style,
        climate: { ...(parent.meta.climate ?? {}), latTop: latAtRow(rect.y), latBot: latAtRow(rect.y + rect.h) },
        parent: { id: parent.meta.id, name: parent.meta.name, rect, factor },
        zoom: (parent.meta.zoom ?? 1) * factor,
        ...(parent.meta.grid && { grid: parent.meta.grid }),
        notes: `Regional map of ${parent.meta.name}: area x${rect.x} y${rect.y} ${rect.w}x${rect.h} px at ${factor}x detail.`,
      },
      height: new HeightField(plan.width, plan.height, heights),
      features: regionalFeatures(parent.features, rect, factor),
      baseClimate: sampleBaseClimate(parent, d, rect),
    };
    const km = (n: number) => Math.round(n * parent.meta.kmPerPx);
    await this.store.createFrom(doc,
      `# ${name}: Design Brief\n\n*A regional map of **${parent.meta.name}** (project \`${parent.meta.id}\`): about ${km(rect.w)} x ${km(rect.h)} km, ` +
      `${factor}x the detail (${doc.meta.kmPerPx.toFixed(2)} km per px). Its top-left corner is the parent map's px (${rect.x}, ${rect.y}).*\n\n` +
      `Canon for the setting lives in the parent map's brief. Record only decisions specific to this area here.\n`);
    await this.openProject(id);
    return (await this.store.list()).find((p) => p.id === id)!;
  }

  /** On a regional map: carry the climate over from the parent map again (after the parent changed). */
  async refreshRegionalClimate() {
    const op = this.open;
    const link = op?.session.doc.meta.parent;
    if (!op || !link) throw new Error("This isn't a regional map.");
    if (!(await this.store.exists(link.id))) throw new Error(`The parent map "${link.name}" can't be found.`);
    const parent = await this.store.load(link.id);
    const d = await this.compute.derive(parent, 0);
    const base = sampleBaseClimate(parent, d, link.rect);
    if (this.open !== op) return;
    op.session.doc.baseClimate = base;
    await this.store.saveBaseClimate(op.id, base);
    this.contentChanged(op);
  }

  // ---------------------------------------------------------------- derived layers
  private contentChanged(op: OpenProject) {
    op.contentVersion++;
    this.scheduleDerived(op);
  }

  private scheduleDerived(op: OpenProject) {
    if (op.derivedTimer) clearTimeout(op.derivedTimer);
    op.derivedTimer = setTimeout(() => {
      op.derivedTimer = null;
      void this.refreshDerived(op);
    }, DERIVED_DEBOUNCE_MS);
  }

  /**
   * Recompute climate/coasts/lakes/rivers if stale (on the compute worker), and send them to
   * the editors. Resolves with the freshest layers available.
   */
  private async refreshDerived(op: OpenProject, force = false): Promise<Derived | null> {
    if (this.open !== op) return null;
    if (!isWorld(op.session.doc)) return null; // battlemaps and cities have no climate
    if (op.derived && op.derivedVersion === op.contentVersion) return op.derived;
    if (op.session.inTransaction && !force) return op.derived; // mid-brush-stroke: wait for the stroke to end
    if (op.deriving && op.derivingVersion === op.contentVersion) return op.deriving;
    const version = op.contentVersion;
    const job = this.compute.derive(op.session.doc, version).then((d) => {
      if (version > op.derivedVersion) {
        op.derived = d;
        op.derivedVersion = version;
        if (this.open === op) {
          const frame = this.derivedFrame(op);
          for (const c of this.clients) if (!this.lite.has(c) && c.readyState === c.OPEN) c.send(frame);
          this.broadcast({ t: "derived_ready", projectId: op.id, version });
        }
      }
      return d;
    });
    op.deriving = job;
    op.derivingVersion = version;
    try {
      return await job;
    } catch (e) {
      console.error("Couldn't compute climate and rivers:", e);
      return op.derived;
    } finally {
      if (op.deriving === job) op.deriving = null;
    }
  }

  private derivedFrame(op: OpenProject): ArrayBuffer {
    const d = op.derived!;
    return encodeFrame({ t: "derived", projectId: op.id, rect: { x: 0, y: 0, w: d.W, h: d.H }, seq: d.seq, rivers: d.rivers }, packDerived(d));
  }

  /** Render the whole open map in its style (fresh derived layers), for previews. */
  async renderMap(o: { roofs?: boolean } = {}): Promise<{ img: RGBAImage; rivers: RiverPath[] }> {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (op.session.inTransaction) op.session.commit();
    if (isBattle(op.session.doc)) {
      const doc = op.session.doc;
      const { w, h } = battleImageSize(battleSpec(doc));
      return { img: { w, h, data: await this.compute.battle(doc, { notes: true, ...(o.roofs && { roofs: 0.8 }), ...(await this.battleAssets(doc)).opts }) }, rivers: [] };
    }
    if (isCity(op.session.doc)) {
      const tiles = await this.cityRoofTiles(op.session.doc);
      return { img: renderCity(op.session.doc, { maxSize: 2048, tileFor: (a) => tiles[a] ?? null }).img, rivers: [] };
    }
    const d = await this.refreshDerived(op, true);
    if (!d) throw new Error("The map's climate and rivers couldn't be computed.");
    const doc = op.session.doc;
    if ((doc.meta.style ?? "painted") === "relief") return { img: renderFull(doc), rivers: d.rivers };
    const data = await this.compute.paint(doc, d);
    return { img: { w: doc.height.w, h: doc.height.h, data }, rivers: [] }; // (the painted style has its rivers in the picture)
  }

  private jpegCache: { key: string; bytes: Uint8Array } | null = null;

  /** Terrain + rivers as a JPEG (no grid/labels) for the phone viewer; cached per content version. */
  async renderJpeg(id: string, maxPx: number, encode: (img: RGBAImage) => Uint8Array): Promise<Uint8Array | null> {
    const op = this.open;
    if (!op || op.id !== id) return null;
    const key = `${id}:${op.contentVersion}:${maxPx}`;
    if (this.jpegCache?.key === key) return this.jpegCache.bytes;
    const { img, rivers } = await this.renderMap();
    const region = { x: 0, y: 0, w: img.w, h: img.h };
    const { img: out, scale } = cropScale(img, region, maxPx);
    drawRivers(out, region, scale, rivers);
    const bytes = encode(out);
    this.jpegCache = { key, bytes };
    return bytes;
  }

  private markDirty(op: OpenProject, level?: LevelRuntime) {
    (level ?? op.runtime.find((r) => r.session === op.session))!.dirty = true;
    op.dirty = true;
    if (op.saveTimer) return;
    op.saveTimer = setTimeout(() => {
      op.saveTimer = null;
      void this.saveNow(op);
    }, 1500);
  }

  private async saveNow(op: OpenProject) {
    if (!op.dirty) return;
    op.dirty = false;
    // claimed before the first await: an edit made while this is being written marks its level again
    const pending = op.runtime.filter((r) => r.dirty);
    for (const r of pending) r.dirty = false;
    const levelsFile = op.levelsDirty ? (op.levelsDirty = false, structuredClone(op.levels)) : null;
    try {
      for (const r of pending) {
        if (r.id === op.levels.levels[0].id) await this.store.save(r.session.doc);
        else await this.store.saveLevel(op.id, op.levels, r.id, r.session.doc);
      }
      if (levelsFile) await this.store.writeLevels(op.id, levelsFile);
      this.broadcast({ t: "projects", projects: await this.store.list() });
      void this.maybeAutoBackup(op);
    } catch (e) {
      console.error("save failed:", e);
      for (const r of pending) r.dirty = true;
      if (levelsFile) op.levelsDirty = true;
      op.dirty = true;
    }
  }

  /**
   * A rolling backup: right after a save, if none was taken in the last `autoBackupMs`, keep the map as an automatic checkpoint (so the
   * first save after an edit makes one, then one every so often while editing goes on). It never touches a checkpoint a person saved.
   */
  private async maybeAutoBackup(op: OpenProject) {
    const every = this.opts.autoBackupMs ?? 0;
    const now = Date.now();
    if (!(every > 0) || now - op.lastAutoBackup < every) return;
    op.lastAutoBackup = now; // claimed before the first await, so a save that follows straight away doesn't start a second one
    try {
      await this.store.saveCheckpoint(op.id, autoBackupName(new Date(now)), op.session.doc, op.session.seq, "Saved automatically", { auto: true, levels: this.checkpointLevels(op) });
      await this.store.pruneAutoCheckpoints(op.id, this.opts.autoBackupKeep ?? 6);
      if (this.open === op) this.broadcast({ t: "checkpoints", list: await this.store.listCheckpoints(op.id) });
    } catch (e) {
      console.error("automatic backup failed:", e);
    }
  }

  async flush() {
    const op = this.open;
    if (!op) return;
    if (op.saveTimer) clearTimeout(op.saveTimer);
    op.saveTimer = null;
    await this.saveNow(op);
  }

  // ---------------------------------------------------------------- clients
  async addClient(ws: WebSocket, opts: { lite?: boolean } = {}) {
    this.clients.add(ws);
    if (opts.lite) this.lite.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    await this.opening.catch(() => {});
    await this.sendProject(ws);
    this.send(ws, { t: "claude_state", state: this.claude });
    this.send(ws, { t: "selection", selection: this.selection, lock: this.selectionLock });
    // what happened at start (a map skipped), told once, to the first editor that connects
    if (!opts.lite && this.startupNotes.length) for (const message of this.startupNotes.splice(0)) this.send(ws, { t: "error", message });
  }

  /**
   * A picture the DM added (the References panel's Add picture button, or one dropped or pasted in the editor): kept as a reference of
   * the open map, where Claude finds it with list_references. Throws PictureRefused (with a message for the person) for anything that
   * isn't a PNG, JPEG or still WebP of at most 30 MB.
   */
  async addReference(projectId: string, name: string, bytes: Uint8Array): Promise<RefInfo> {
    const op = this.open;
    if (!op || op.id !== projectId) throw new Error("That map isn't open any more. Open it and add the picture again.");
    const ref = await this.store.addRef(op.id, name, bytes);
    this.broadcast({ t: "refs", refs: await this.store.listRefs(op.id) });
    return ref;
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.readyState === c.OPEN) c.send(s);
  }

  private async sendProject(ws: WebSocket) {
    const projects = await this.store.list();
    if (!this.open) {
      this.send(ws, { t: "projects", projects });
      return;
    }
    const { id, session, agent } = this.open;
    this.send(ws, {
      t: "project", meta: session.doc.meta, projects, changes: session.recent(100), seq: session.seq,
      canUndo: session.canUndo, canRedo: session.canRedo, refs: await this.store.listRefs(id),
      chat: agent.state.items.slice(-300), chatSettings: agent.state.settings, chatBusy: agent.busy,
      usage: agent.state.usage, apiKeyConfigured: this.modelCall !== null,
      features: session.doc.features ?? { places: [], labels: [] },
      ...(isBattle(session.doc) && { levels: this.open.levels }),
    });
    if (!this.lite.has(ws)) {
      const hf = session.doc.height;
      ws.send(encodeFrame({ t: "snapshot", projectId: id, rect: { x: 0, y: 0, w: hf.w, h: hf.h }, seq: session.seq }, hf.data));
      if (this.open.derived) ws.send(this.derivedFrame(this.open));
    } else if (this.open.derived) {
      this.send(ws, { t: "derived_ready", projectId: id, version: this.open.derivedVersion });
    }
    this.send(ws, { t: "checkpoints", list: await this.store.listCheckpoints(id) });
  }

  async handleClient(ws: WebSocket, msg: ClientMsg) {
    try {
      switch (msg.t) {
        case "hello":
          return this.sendProject(ws);
        case "open_project":
          return this.openProject(msg.id);
        case "read_picture": {
          try {
            const r = await this.readCityPicture({ area: msg.area, roofs: msg.roofs, ground: msg.ground, tolerance: msg.tolerance });
            this.send(ws, { t: "picture_read", buildings: r.buildings, skipped: r.skipped, alreadyThere: r.alreadyThere });
          } catch (e) { this.send(ws, { t: "picture_read", error: (e as Error).message }); }
          return;
        }
        case "delete_project": {
          const r = await this.deleteProject(msg.id);
          this.broadcast({ t: "map_deleted", name: r.name, folder: r.folder });
          return;
        }
        case "create_project": {
          const info = await this.createProject({ name: msg.name, width: msg.width, height: msg.height, kmPerPx: msg.kmPerPx });
          if (msg.template && msg.template !== "ocean") {
            this.session.execute({ op: "generate_terrain", params: { template: msg.template as never, seed: msg.seed, ...(msg.lakes && { lakes: msg.lakes }) } }, "user");
          }
          return info;
        }
        case "create_battle":
          return await this.createBattle(msg);
        case "create_city":
          return await this.createCity(msg);
        case "create_city_here": {
          const place = this.open?.session.doc.features?.places.find((p) => Math.hypot(p.x - msg.x, p.y - msg.y) < 1.5)?.name;
          await this.createCityFromWorld({ name: msg.name, x: msg.x, y: msg.y, widthM: msg.widthM, heightM: msg.heightM, place });
          return;
        }
        case "create_battle_here":
          return await this.createBattleFromWorld({ name: msg.name, x: msg.x, y: msg.y, squaresX: msg.squaresX, squaresY: msg.squaresY });
        case "create_regional":
          return await this.createRegional({ name: msg.name, rect: msg.rect });
        case "regional_refresh":
          return await this.refreshRegionalClimate();
        case "sketch_import": {
          const op = this.open;
          if (!op) throw new Error("No project is open.");
          if (!isWorld(op.session.doc)) throw new Error("Sketch import is for world maps.");
          if (!/^[\w. -]{1,120}$/.test(msg.ref)) throw new Error("Bad image name.");
          const bytes = await this.store.readRef(op.id, msg.ref);
          if (!bytes) throw new Error(`No reference image named ${msg.ref}.`);
          const img = decodeImage(bytes);
          if (!img) throw new Error("That image can't be read (use PNG, JPEG or a still WebP).");
          await this.saveCheckpoint("Before sketch import", `Before turning ${msg.ref} into terrain`);
          const doc = op.session.doc;
          const r = sketchToHeights(img, { W: doc.height.w, H: doc.height.h, seaLevel: doc.meta.seaLevel }, { ...msg.params, seed: msg.params.seed ?? Math.floor(Math.random() * 2 ** 31) });
          return op.session.execute({ op: "replace_heights", data: r.data, label: `Terrain from sketch ${msg.ref}` }, "user");
        }
        case "route_line": {
          const op = this.open;
          if (!op) throw new Error("No project is open.");
          if (!isWorld(op.session.doc)) throw new Error("Roads are for world maps. (On a city map, streets are lines with a width.)");
          const d = await this.refreshDerived(op, true);
          const r = routeWaypoints(op.session.doc, d, msg.points, { steepOk: msg.kind === "trail" });
          if ("error" in r) throw new Error(r.error);
          const line = { id: msg.id && /^m-[a-z0-9-]{4,40}$/.test(msg.id) ? msg.id : newFeatureId("m"), kind: msg.kind, points: r.points, ...(msg.name && { name: msg.name }) };
          const miles = Math.round(r.lengthKm * 0.621371);
          return op.session.execute({ op: "features", patch: { upsertLines: [line] }, label: `Add ${msg.kind}${msg.name ? ` ${msg.name}` : ""} (${miles} mi)` }, "user");
        }
        case "cmd":
          return this.session.execute(msg.cmd, "user", msg.label);
        case "txn_begin":
          return this.session.begin("user", msg.label);
        case "txn_end":
          return this.session.commit();
        case "save_now": {
          await this.flush();
          // (a failed save leaves the map marked as changed: say so instead of claiming it is saved)
          if (this.open?.dirty) throw new Error("The map couldn't be saved just now (is the disk full or read-only?). Your changes are still open in the editor, and it will keep trying.");
          this.broadcast({ t: "saved" });
          return;
        }
        case "undo":
          return this.session.undo("user");
        case "redo":
          return this.session.redo("user");
        case "chat_send": {
          const op = this.open;
          if (!op) throw new Error("Open a project first.");
          const imgs = [], refused: string[] = [];
          for (const im of msg.images.slice(0, 8)) {
            const bytes = new Uint8Array(Buffer.from(im.data, "base64"));
            try {
              const ref = await this.store.addRef(op.id, im.name || "picture.png", bytes);
              imgs.push({ name: ref.name, mediaType: REFERENCE_KIND_TYPE[pictureKind(bytes.subarray(0, PICTURE_HEAD_BYTES)) as ReferenceKind], bytes, url: ref.url });
            } catch (e) {
              if (!(e instanceof PictureRefused)) throw e;
              refused.push(e.message); // (the message still goes; only that picture is left out)
            }
          }
          if (imgs.length) this.broadcast({ t: "refs", refs: await this.store.listRefs(op.id) });
          if (refused.length) this.send(ws, { t: "error", message: `Left out of your message: ${refused.join(" ")}` });
          if (msg.text.trim() || imgs.length) void op.agent.send(msg.text, imgs);
          return;
        }
        case "chat_stop":
          return this.open?.agent.stop();
        case "chat_settings":
          this.open?.agent.setSettings(msg.settings);
          if (this.open) this.broadcast({ t: "chat_settings", settings: this.open.agent.state.settings });
          return;
        case "chat_reset":
          await this.open?.agent.reset();
          for (const c of this.clients) await this.sendProject(c);
          return;
        case "ref_rename":
        case "ref_remove": {
          const op = this.open;
          if (!op) throw new Error("No project is open.");
          // (a trace picture made from it, on any level, follows: renamed with it, or taken away with it)
          const traced = () => op.runtime.filter((rt) => rt.session.doc.features?.trace?.ref === msg.name);
          if (msg.t === "ref_rename") {
            const to = await this.store.renameRef(op.id, msg.name, String(msg.to ?? ""));
            if (to !== msg.name) for (const rt of traced()) rt.session.execute({ op: "features", patch: { setTrace: { ...rt.session.doc.features!.trace!, ref: to } }, label: `Trace picture renamed to ${to}` }, "user");
          } else {
            await this.store.removeRef(op.id, msg.name);
            for (const rt of traced()) rt.session.execute({ op: "features", patch: { setTrace: null }, label: `Stop tracing ${msg.name} (the picture was removed)` }, "user");
          }
          this.broadcast({ t: "refs", refs: await this.store.listRefs(op.id) });
          return;
        }
        case "checkpoint_save":
          await this.saveCheckpoint(msg.name);
          return;
        case "checkpoint_restore":
          await this.restoreCheckpoint(msg.name, "user");
          return;
        case "level_set":
          return this.setActiveLevel(msg.id);
        case "level_add":
          await this.addLevel(msg.where, msg.name);
          return;
        case "level_update":
          return this.updateLevel(msg.id, msg.patch);
        case "level_remove":
          return this.removeLevel(msg.id);
        case "selection": {
          const op = this.open;
          if (!op) return;
          const doc = op.session.doc;
          if (msg.selection === null) return this.setSelection(null, false);
          const sel = cleanSelection(msg.selection, doc.meta.width, doc.meta.height);
          if (!sel) throw new Error("That selection isn't valid.");
          if (sel.kind === "feature" && !selectionFeatureExists(sel, doc.features)) throw new Error("That isn't on the map any more.");
          return this.setSelection(sel, msg.lock === true);
        }
        case "view": {
          const v = cleanView({ rect: msg.rect, zoom: msg.zoom });
          if (v) this.view = v;
          return;
        }
      }
    } catch (e) {
      this.send(ws, { t: "error", message: (e as Error).message });
    }
  }

  // ---------------------------------------------------------------- Claude
  /** Tool context for Claude. `via` marks where the call came from (shown in the editor for MCP). */
  toolContext(via: "chat" | "mcp"): ToolContext {
    const author: Author = "claude";
    const self = this;
    const id = () => {
      if (!self.open) throw new Error("No project is open. Use list_projects / open_project or create_map.");
      return self.open.id;
    };
    return {
      session: () => self.session,
      projectId: () => self.activeId,
      execute: (cmd, label) => {
        const r = self.session.execute(cmd, author, label);
        if (via === "mcp") self.open?.agent.note(`Claude Code: ${r.label}`);
        return { seq: r.seq, label: r.label };
      },
      undo: () => self.session.undo(author),
      redo: () => self.session.redo(author),
      listProjects: () => self.projectsCache,
      openProject: (pid) => self.openProject(pid),
      createProject: async (o) => {
        const info = await self.createProject(o);
        self.projectsCache = await self.store.list();
        return info;
      },
      readBrief: async () => {
        const own = await self.store.readBrief(id());
        const link = self.open?.session.doc.meta.parent;
        if (!link || !(await self.store.exists(link.id))) return own;
        // a regional map's canon lives with its parent
        return `${own}\n\n---\n\n*From the parent map, ${link.name} (read-only here; open that project to edit it):*\n\n${await self.store.readBrief(link.id)}`;
      },
      derived: async () => (self.open ? await self.refreshDerived(self.open, true) : null),
      assets: self.assets ? {
        status: () => self.assets!.status(),
        search: async (o) => { const r = self.assets!.list(o); return { total: r.total, items: await self.assets!.withSizes(r.items) }; },
        thumbnail: async (aid, size) => (await self.assets!.thumbnail(aid, size))?.bytes ?? null,
        info: (aid) => self.assets!.info(aid),
      } : undefined,
      createBattle: async (o) => {
        const info = await self.createBattle(o);
        self.projectsCache = await self.store.list();
        return info;
      },
      roofPools: () => self.roofPools(),
      cityTiles: () => self.cityRoofTiles(self.session.doc),
      createCity: async (o) => {
        const info = await self.createCity(o);
        self.projectsCache = await self.store.list();
        return info;
      },
      createBattleHere: async (o) => {
        const info = await self.createBattleFromWorld(o);
        self.projectsCache = await self.store.list();
        return info;
      },
      readCityPicture: (o) => self.readCityPicture(o),
      createCityHere: async (o) => {
        const info = await self.createCityFromWorld(o);
        self.projectsCache = await self.store.list();
        return info;
      },
      exportBattle: async (format, level) => {
        const f = await self.battleExport(format, level);
        return { name: f.name, bytes: f.bytes.byteLength, path: await self.store.saveExport(id(), f.name, f.bytes) };
      },
      levels: {
        list: () => {
          const op = self.battleOp();
          return {
            active: op.levels.active,
            levels: levelsByHeight(op.levels.levels).map((l) => {
              const d = op.runtime.find((r) => r.id === l.id)!.session.doc, f = d.features, w = f?.walls ?? [], sp = battleSpec(d);
              let floor = 0;
              for (let i = 0; i < d.height.data.length; i++) if ((d.height.data[i] | 0) > 0) floor++;
              return {
                id: l.id, name: l.name, bottom: l.bottom, top: l.top,
                counts: {
                  floored_squares: Math.round(floor / (sp.sub * sp.sub)), walls: w.filter((x) => x.kind === "wall").length, doors: w.filter((x) => x.kind === "door" || x.kind === "secret").length,
                  windows: w.filter((x) => x.kind === "window").length, lights: (f?.lights ?? []).length, objects: (f?.props ?? []).length, notes: (f?.notes ?? []).length, connectors: (f?.connectors ?? []).length,
                },
              };
            }),
          };
        },
        add: async (where, name) => {
          const l = await self.addLevel(where, name);
          if (via === "mcp") self.open?.agent.note(`Claude Code: added the level ${l.name}`);
          return l;
        },
        select: async (ref) => {
          const l = self.levelByRef(self.battleOp(), ref);
          await self.setActiveLevel(l.id);
          if (via === "mcp") self.open?.agent.note(`Claude Code: switched to ${l.name}`);
          return l;
        },
        update: async (ref, patch) => {
          const l = await self.updateLevel(self.levelByRef(self.battleOp(), ref).id, patch);
          if (via === "mcp") self.open?.agent.note(`Claude Code: changed the level ${l.name}`);
          return l;
        },
      },
      createRegional: async (o) => {
        const info = await self.createRegional(o);
        self.projectsCache = await self.store.list();
        return info;
      },
      writeBrief: (t) => self.store.writeBrief(id(), t),
      listRefs: () => self.store.listRefs(id()),
      readRef: (name) => self.store.readRef(id(), name),
      savePreview: async (jpeg) => ({ url: await self.store.savePreview(id(), jpeg) }),
      render: (o) => self.renderMap(o),
      listCheckpoints: () => self.store.listCheckpoints(id()),
      saveCheckpoint: (name, note) => self.saveCheckpoint(name, note),
      selection: () => self.selectionState,
      setSelection: (sel) => {
        if (self.selectionLock) throw new Error("The DM has locked your edits to their selection: you can't change it.");
        self.setSelection(sel, false);
      },
      restoreCheckpoint: async (name) => {
        const r = await self.restoreCheckpoint(name, author);
        if (via === "mcp") self.open?.agent.note(`Claude Code: ${r.label}`);
        return r;
      },
    };
  }

  /** Every level of a battlemap that has more than one, for a checkpoint (undefined for the usual one-level map). */
  private checkpointLevels(op: OpenProject): { active: { id: string; info: BattleLevel }; others: { id: string; info: BattleLevel; doc: MapDoc }[] } | undefined {
    if (op.runtime.length < 2) return undefined;
    const info = (id: string) => op.levels.levels.find((l) => l.id === id)!;
    const active = op.runtime.find((r) => r.session === op.session)!;
    return { active: { id: active.id, info: info(active.id) }, others: op.runtime.filter((r) => r !== active).map((r) => ({ id: r.id, info: info(r.id), doc: r.session.doc })) };
  }

  async saveCheckpoint(name: string, note?: string) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (op.session.inTransaction) op.session.commit();
    const info = await this.store.saveCheckpoint(op.id, name, op.session.doc, op.session.seq, note, { levels: this.checkpointLevels(op) });
    this.broadcast({ t: "checkpoints", list: await this.store.listCheckpoints(op.id) });
    return info;
  }

  async restoreCheckpoint(name: string, author: Author) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    const cp = await this.store.readCheckpoint(op.id, name);
    if (!cp) throw new Error(`No checkpoint named "${name}".`);
    // a battlemap checkpoint taken with several levels puts each level back; an older one (or a one-level map's) is the first level's, or the only one
    // (a level that was removed since comes back, with its name and elevations, as long as the map has room for it)
    if (cp.levels) {
      for (const l of cp.levels) {
        if (op.runtime.some((r) => r.id === l.id) || !l.info || op.runtime.length >= MAX_LEVELS) continue;
        const clash = op.levels.levels.some((x) => x.name.toLowerCase() === l.info!.name.toLowerCase());
        this.makeLevel(op, { ...l.info, ...(clash && { name: `${l.info.name} (restored)`.slice(0, 60) }) });
      }
    }
    const targets = cp.levels
      ? cp.levels.flatMap((l) => { const rt = op.runtime.find((r) => r.id === l.id); return rt ? [{ rt, data: l.data, meta: l.meta, features: l.features }] : []; })
      : [{ rt: op.runtime[0], data: cp.data, meta: cp.meta, features: cp.features }];
    if (!targets.length) throw new Error(`Checkpoint "${cp.info.name}" holds levels that this map no longer has, so it can't be restored.`);
    for (const t of targets) {
      if (t.data.length !== t.rt.session.doc.height.data.length) throw new Error(`Checkpoint "${cp.info.name}" was saved before the map changed size, so it can't be restored onto this map.`);
    }
    let last = { seq: 0, label: "" };
    for (const t of targets) {
      if (t.rt.session.inTransaction) t.rt.session.commit();
      const r = t.rt.session.execute({ op: "restore", data: t.data, meta: t.meta, features: t.features, label: `Restore checkpoint "${cp.info.name}"` }, author);
      if (t.rt.session === op.session || !last.label) last = { seq: r.seq, label: r.label };
    }
    return last;
  }

  /** Synchronous list for list_projects (refreshed on open/create/save). */
  projectsCache: Awaited<ReturnType<ProjectStore["list"]>> = [];

  async refreshProjects() {
    this.projectsCache = await this.store.list();
  }

  private agentHost(id: string) {
    const self = this;
    return {
      toolContext: () => self.toolContext("chat"),
      emit: (ev: ChatEvent) => { if (self.open?.id === id) self.broadcast({ t: "chat", ev }); },
      persist: (state: ChatState) => self.store.writeJson(id, "chat.json", state),
      userChangesSince: (seq: number) => {
        const s = self.open?.id === id ? self.open.session : null;
        if (!s) return { seq: 0, lines: [] };
        const lines = s.changesSince(seq).filter((c) => c.author === "user")
          .map((c) => `- #${c.seq} ${c.kind}: ${c.label}${c.rect ? ` (area x${c.rect.x} y${c.rect.y} ${c.rect.w}x${c.rect.h})` : ""}`);
        return { seq: s.seq, lines: lines.slice(-30) };
      },
      apiKeyConfigured: () => self.modelCall !== null,
    };
  }

  /** Make sure something is open: last-opened project, else the newest, else a fresh demo map. */
  /**
   * Open a map at start: the one open last time, else the first that opens. The program must always start, whatever is in the maps folder (a map saved by a newer Dragon Drop,
   * one that can't be read): otherwise it can't even reach its own updater. A map that won't open is skipped, left exactly as it is, and the person is told when the editor connects.
   */
  async ensureProject(): Promise<void> {
    await this.refreshProjects();
    const last = await this.store.readLastOpen();
    const order = [...new Set([...(last && (await this.store.exists(last)) ? [last] : []), ...this.projectsCache.map((p) => p.id)])];
    const skipped: { name: string; why: string }[] = [];
    for (const id of order) {
      try {
        await this.openProject(id);
        if (skipped.length) {
          const opened = this.projectsCache.find((p) => p.id === id)?.name ?? id;
          for (const k of skipped) this.startupNotes.push(`"${k.name}" couldn't be opened, so "${opened}" was opened instead. ${k.why}`);
        }
        return;
      } catch (e) {
        skipped.push({ name: this.projectsCache.find((p) => p.id === id)?.name ?? id, why: (e as Error).message });
      }
    }
    // a brand-new install starts with a small generated archipelago with no names or history of its own (never anyone's campaign world);
    // so does a maps folder where nothing would open (a new map, beside the others, which are left as they are)
    if (skipped.length) this.startupNotes.push(`None of your maps could be opened (${skipped.map((k) => `"${k.name}"`).join(", ")}), so a new map was made beside them; they are untouched. ${skipped[0].why}`);
    await this.makeFirstMap();
  }

  /** The small generated archipelago a new install starts with (and what is open when the last map is deleted). */
  private async makeFirstMap() {
    await this.createProject({ name: "First Map", width: 1024, height: 1024, kmPerPx: 2 });
    this.session.execute({ op: "generate_terrain", params: { template: "archipelago", seed: 7, landFraction: 0.3, mountains: 0.5 } }, "system");
    if (this.open) this.open.lastAutoBackup = Date.now(); // (a map nobody has touched yet needs no rolling backup: the first one comes at the first save after the interval)
    await this.flush();
  }

  /**
   * Delete a map (the DM's own choice, from the editor: Claude has no tool for it). Its folder is moved into "Deleted maps" inside the maps folder, never erased. When it is the
   * open map, its last edits are saved and another map is opened first (the most recently changed; a new First Map when it was the only one), so nothing writes into it after.
   */
  async deleteProject(id: string): Promise<{ name: string; folder: string }> {
    const info = (await this.store.list()).find((p) => p.id === id);
    if (!info) throw new Error(`There is no map "${id}" to delete.`);
    if (this.open?.id === id) {
      await this.flush();
      const others = (await this.store.list()).filter((p) => p.id !== id);
      let opened = false;
      for (const p of others) { try { await this.openProject(p.id); opened = true; break; } catch { /* (one that won't open: try the next) */ } }
      if (!opened) await this.makeFirstMap();
    }
    const folder = await this.store.moveToDeleted(id);
    await this.refreshProjects();
    this.broadcast({ t: "projects", projects: this.projectsCache });
    return { name: info.name, folder };
  }
}
