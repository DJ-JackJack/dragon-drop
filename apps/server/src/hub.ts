/**
 * The authoritative app state: which project is open, its MapSession, the chat agent,
 * and every connected editor. Editors and Claude (chat or MCP) all act through here.
 */
import type { WebSocket } from "ws";
import {
  type Author, type ChatEvent, type ClientMsg, type Derived, type MapDoc, type MapSession as MapSessionT, type RGBAImage, type Rect,
  type ClaudeState, type HookEvent, type RiverPath, type ServerMsg, HeightField, MapSession, claudeStateAfter, climateOf, resolveRiverSources, cropScale, drawRivers, encodeFrame, packDerived, planRegional,
  PROP_PX_PER_SQUARE, battleFloorFromWorld, battleImageSize, battleSizeError, battleSpec, createBattleDoc, createZip, describeSample, sampleWorld, isBattle, newFeatureId, regionalFeatures, renderFull, routeWaypoints,
  battleKey, sampleBaseClimate, sketchToHeights, toFoundryScene, toUniversalVtt,
  type Selection, type ViewInfo, cleanSelection, cleanView, defaultFeather, selectionFeatureExists, selectionShape,
} from "@mapmaker/core";
import { type ToolContext, decodeImage, encodePng } from "@mapmaker/tools";
import { type ChatState, type ModelCall, ChatAgent } from "./agent.ts";
import { type MapCompute, WorkerCompute } from "./compute.ts";
import type { AssetLibrary } from "./assets.ts";
import type { NoiseStore } from "./noiseStore.ts";
import { ProjectStore } from "./store.ts";

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

interface OpenProject {
  id: string;
  session: MapSessionT;
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
  /** The user's Dungeondraft packs, when a folder is configured. */
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
    if (isBattle(op.session.doc)) { selection = null; lock = false; }
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
  async openProject(id: string): Promise<void> {
    const run = async () => {
      if (this.open?.id === id) return;
      if (!(await this.store.exists(id))) throw new Error(`No project "${id}".`);
      await this.flush();
      const doc = await this.store.load(id);
      const session = new MapSession(doc);
      const saved = await this.store.readJson<ChatState>(id, "chat.json");
      const agent = new ChatAgent(this.agentHost(id), this.modelCall, saved ?? undefined);
      const op: OpenProject = {
        id, session, agent, saveTimer: null, dirty: false, lastAutoBackup: await this.store.lastAutoCheckpointTime(id),
        derived: null, derivedVersion: -1, deriving: null, derivingVersion: -1, contentVersion: 0, derivedTimer: null,
        regionsKey: JSON.stringify([doc.features?.regions ?? [], resolveRiverSources(doc.features)]),
        metaKey: JSON.stringify([doc.meta.seaLevel, doc.meta.climate, doc.meta.style]),
      };
      session.on((e) => {
        if (this.open !== op) return;
        if (e.type === "patch") {
          const frame = encodeFrame({ t: "patch", projectId: id, rect: e.rect, seq: e.seq }, session.doc.height.copyRect(e.rect));
          for (const c of this.clients) if (!this.lite.has(c) && c.readyState === c.OPEN) c.send(frame);
          this.markDirty(op);
          this.contentChanged(op);
        } else if (e.type === "meta") {
          this.broadcast({ t: "meta", meta: e.meta });
          this.markDirty(op);
          // only settings that change the climate or the server's render need a recompute (not the grid, name or notes)
          const key = JSON.stringify([e.meta.seaLevel, e.meta.climate, e.meta.style]);
          if (key !== op.metaKey) {
            op.metaKey = key;
            this.contentChanged(op);
          }
        } else if (e.type === "features") {
          this.broadcast({ t: "features", features: e.features });
          this.markDirty(op);
          this.syncSelection(op);
          const key = JSON.stringify([e.features.regions ?? [], resolveRiverSources(e.features)]); // regions and river sources (and where their places are) feed the climate and rivers
          if (key !== op.regionsKey) {
            op.regionsKey = key;
            this.contentChanged(op); // climate regions feed the climate model
          }
        } else if (e.type === "history") {
          this.broadcast({ t: "change", change: e.change, canUndo: session.canUndo, canRedo: session.canRedo });
          // a finished brush stroke: derived layers may have been skipped while it was in progress
          if (op.derivedVersion !== op.contentVersion) this.scheduleDerived(op);
        }
      });
      this.open = op;
      this.selection = null; this.selectionLock = false; this.view = null; // a selection belongs to the map it was made on
      this.broadcast({ t: "selection", selection: null, lock: false });
      await this.store.writeLastOpen(id).catch(() => {});
      await this.refreshProjects();
      for (const c of this.clients) await this.sendProject(c);
      // something about the files had to be dealt with while loading (an older format brought up to date, a file that couldn't be read)
      for (const message of this.store.takeNotices(id)) this.broadcast({ t: "error", message });
      if (!isBattle(doc)) {
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

  /** Pack textures and object images the open battlemap needs, decoded for the render worker, and how many couldn't be had. */
  async battleAssets(doc: MapDoc): Promise<{ opts: { tiles?: Record<number, import("@mapmaker/core").TileData>; sprites?: Record<string, import("@mapmaker/core").SpriteData> }; missing: number }> {
    const lib = this.assets;
    const spec = battleSpec(doc);
    const palette = spec.palette ?? [];
    const props = doc.features?.props ?? [];
    if (!lib || (!palette.length && !props.length)) return { opts: {}, missing: palette.length + props.length };
    let missing = 0;
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
    return { opts: { tiles, sprites }, missing };
  }

  /** Make a battlemap of the ground at a point of the open world map: its climate, slope, water, coast and rivers choose the floors. */
  async createBattleFromWorld(o: { name: string; x: number; y: number; squaresX?: number; squaresY?: number; feetPerSquare?: number }) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    const parent = op.session.doc;
    if (isBattle(parent)) throw new Error("Open a world map first: this makes a battlemap from a spot on one.");
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

  /** The open battlemap as a file for a virtual tabletop: image, Universal VTT, or a Foundry scene (zip). */
  async battleExport(format: "png" | "uvtt" | "foundry" | "key"): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    const doc = op.session.doc;
    if (!isBattle(doc)) throw new Error("Only battlemaps can be exported this way.");
    if (op.session.inTransaction) op.session.commit();
    // the DM's key (numbered notes) as a Markdown list: no picture needed
    if (format === "key") return { name: `${op.id}-key.md`, mime: "text/markdown; charset=utf-8", bytes: new TextEncoder().encode(battleKey(doc)) };
    const spec = battleSpec(doc);
    const { w, h } = battleImageSize(spec);
    // the drawn art keeps walls and doors; lights and the DM's notes are left out (the tabletop does its own lighting)
    const data = await this.compute.battle(doc, { overlay: true, lights: false, ...(await this.battleAssets(doc)).opts });
    const png = encodePng({ w, h, data });
    const base = op.id;
    const enc = new TextEncoder();
    if (format === "png") return { name: `${base}.png`, mime: "image/png", bytes: png };
    if (format === "uvtt") {
      return { name: `${base}.dd2vtt`, mime: "application/json", bytes: enc.encode(JSON.stringify(toUniversalVtt(doc, Buffer.from(png).toString("base64")))) };
    }
    const scene = toFoundryScene(doc, `maps/${base}.png`);
    const readme =
      `Foundry VTT scene for "${doc.meta.name}"\r\n\r\n` +
      `1. Upload ${base}.png into your Foundry data folder (for example a "maps" folder) with the File Browser.\r\n` +
      `2. In Foundry, create a Scene (or open an existing one), right-click it in the Scenes list > Import Data, and choose ${base}-scene.json.\r\n` +
      `3. If the map doesn't show, open the scene's configuration, go to Levels and set the level's Background to where you uploaded the PNG.\r\n\r\n` +
      `This is a Foundry v14 scene: the map is one Level, with its walls, doors and lights tagged to it. It was built from Foundry's published v14\r\n` +
      `documentation and hasn't been tried in Foundry itself yet. If it doesn't import cleanly, tell us what Foundry said, or use the .dd2vtt export\r\n` +
      `with the Universal Battlemap Importer module instead.\r\n`;
    return {
      name: `${base}-foundry.zip`, mime: "application/zip",
      bytes: createZip([{ name: `${base}.png`, data: png }, { name: `${base}-scene.json`, data: enc.encode(JSON.stringify(scene, null, 2)) }, { name: "README.txt", data: enc.encode(readme) }]),
    };
  }

  /**
   * Make a regional map: a separate, more detailed map of one area of the open map, with the
   * parent's climate carried over and the places and labels inside the area copied in.
   */
  async createRegional(o: { name: string; rect: Rect }) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (isBattle(op.session.doc)) throw new Error("A battlemap can't have a regional map.");
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
    if (isBattle(op.session.doc)) return null; // battlemaps have no climate
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
  async renderMap(): Promise<{ img: RGBAImage; rivers: RiverPath[] }> {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (op.session.inTransaction) op.session.commit();
    if (isBattle(op.session.doc)) {
      const doc = op.session.doc;
      const { w, h } = battleImageSize(battleSpec(doc));
      return { img: { w, h, data: await this.compute.battle(doc, { notes: true, ...(await this.battleAssets(doc)).opts }) }, rivers: [] };
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

  private markDirty(op: OpenProject) {
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
    try {
      await this.store.save(op.session.doc);
      this.broadcast({ t: "projects", projects: await this.store.list() });
      void this.maybeAutoBackup(op);
    } catch (e) {
      console.error("save failed:", e);
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
      await this.store.saveCheckpoint(op.id, autoBackupName(new Date(now)), op.session.doc, op.session.seq, "Saved automatically", { auto: true });
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
        case "create_project": {
          const info = await this.createProject({ name: msg.name, width: msg.width, height: msg.height, kmPerPx: msg.kmPerPx });
          if (msg.template && msg.template !== "ocean") {
            this.session.execute({ op: "generate_terrain", params: { template: msg.template as never, seed: msg.seed } }, "user");
          }
          return info;
        }
        case "create_battle":
          return await this.createBattle(msg);
        case "create_battle_here":
          return await this.createBattleFromWorld({ name: msg.name, x: msg.x, y: msg.y, squaresX: msg.squaresX, squaresY: msg.squaresY });
        case "create_regional":
          return await this.createRegional({ name: msg.name, rect: msg.rect });
        case "regional_refresh":
          return await this.refreshRegionalClimate();
        case "sketch_import": {
          const op = this.open;
          if (!op) throw new Error("No project is open.");
          if (isBattle(op.session.doc)) throw new Error("Sketch import is for world maps.");
          if (!/^[\w. -]{1,120}$/.test(msg.ref)) throw new Error("Bad image name.");
          const bytes = await this.store.readRef(op.id, msg.ref);
          if (!bytes) throw new Error(`No reference image named ${msg.ref}.`);
          const img = decodeImage(bytes);
          if (!img) throw new Error("That image can't be read (use PNG or JPEG).");
          await this.saveCheckpoint("Before sketch import", `Before turning ${msg.ref} into terrain`);
          const doc = op.session.doc;
          const r = sketchToHeights(img, { W: doc.height.w, H: doc.height.h, seaLevel: doc.meta.seaLevel }, { ...msg.params, seed: msg.params.seed ?? Math.floor(Math.random() * 2 ** 31) });
          return op.session.execute({ op: "replace_heights", data: r.data, label: `Terrain from sketch ${msg.ref}` }, "user");
        }
        case "route_line": {
          const op = this.open;
          if (!op) throw new Error("No project is open.");
          if (isBattle(op.session.doc)) throw new Error("Roads are for world maps.");
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
        case "undo":
          return this.session.undo("user");
        case "redo":
          return this.session.redo("user");
        case "chat_send": {
          const op = this.open;
          if (!op) throw new Error("Open a project first.");
          const imgs = [];
          for (const im of msg.images.slice(0, 8)) {
            const bytes = new Uint8Array(Buffer.from(im.data, "base64"));
            if (bytes.byteLength > 30 * 1024 * 1024) throw new Error(`${im.name} is too large (max 30 MB).`);
            const ref = await this.store.addRef(op.id, im.name || "image.png", bytes);
            imgs.push({ name: ref.name, mediaType: im.mediaType, bytes, url: ref.url });
          }
          if (imgs.length) this.broadcast({ t: "refs", refs: await this.store.listRefs(op.id) });
          void op.agent.send(msg.text, imgs);
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
        case "checkpoint_save":
          await this.saveCheckpoint(msg.name);
          return;
        case "checkpoint_restore":
          await this.restoreCheckpoint(msg.name, "user");
          return;
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
      createBattleHere: async (o) => {
        const info = await self.createBattleFromWorld(o);
        self.projectsCache = await self.store.list();
        return info;
      },
      exportBattle: async (format) => {
        const f = await self.battleExport(format);
        return { name: f.name, bytes: f.bytes.byteLength, path: await self.store.saveExport(id(), f.name, f.bytes) };
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
      render: () => self.renderMap(),
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

  async saveCheckpoint(name: string, note?: string) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    if (op.session.inTransaction) op.session.commit();
    const info = await this.store.saveCheckpoint(op.id, name, op.session.doc, op.session.seq, note);
    this.broadcast({ t: "checkpoints", list: await this.store.listCheckpoints(op.id) });
    return info;
  }

  async restoreCheckpoint(name: string, author: Author) {
    const op = this.open;
    if (!op) throw new Error("No project is open.");
    const cp = await this.store.readCheckpoint(op.id, name);
    if (!cp) throw new Error(`No checkpoint named "${name}".`);
    if (cp.data.length !== op.session.doc.height.data.length) {
      throw new Error(`Checkpoint "${cp.info.name}" was saved before the map changed size, so it can't be restored onto this map.`);
    }
    const r = op.session.execute({ op: "restore", data: cp.data, meta: cp.meta, features: cp.features, label: `Restore checkpoint "${cp.info.name}"` }, author);
    return { seq: r.seq, label: r.label };
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
  async ensureProject(): Promise<void> {
    await this.refreshProjects();
    const last = await this.store.readLastOpen();
    const pick = last && (await this.store.exists(last)) ? last : this.projectsCache[0]?.id;
    if (pick) return this.openProject(pick);
    // a brand-new install starts with a small generated archipelago with no names or history of its own (never anyone's campaign world)
    await this.createProject({ name: "First Map", width: 1024, height: 1024, kmPerPx: 2 });
    this.session.execute({ op: "generate_terrain", params: { template: "archipelago", seed: 7, landFraction: 0.3, mountains: 0.5 } }, "system");
    if (this.open) this.open.lastAutoBackup = Date.now(); // (a map nobody has touched yet needs no rolling backup: the first one comes at the first save after the interval)
    await this.flush();
  }
}
