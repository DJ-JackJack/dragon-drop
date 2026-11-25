/**
 * Connection to the map server + client-side state.
 * The heightmap lives outside React state (it's large and patched in place); components
 * subscribe to `onPatch` to redraw, and to `subscribe` for everything else.
 */
import {
  type ChangeEntry, type ChatItem, type ChatSettings, type CheckpointInfo, type ClaudeState, type ClientMsg, type Features, type LevelsFile, type MapMeta,
  type ProjectInfo, type Rect, type RefInfo, type Selection, type ServerMsg, type Usage, type PrefabInfo, type GenerateRequest, HeightField, type RiverPath, decodeFrame, decodeFrameHeader, emptyUsage, selectionShape,
  PICTURE_HEAD_BYTES, pictureKind, referencePictureProblem, type LakeShape, type MapLabel, type NamedWater, type RiverSize, EDIT_MESSAGES, IMAGE_HEAD_BYTES, imageSize,
} from "@mapmaker/core";
import { repaintNeeded } from "./metaDiff.ts";

export interface AppState {
  connected: boolean;
  meta: MapMeta | null;
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
  error: string | null;
  /** When the server last confirmed the map is on disk after Ctrl+S (ms since 1970; 0 = never). */
  savedAt: number;
  /** When the open map was last written to disk (Ctrl+S or an autosave), when it last changed, and whether the last autosave failed (the bottom bar's save state). */
  storedAt: number;
  changedAt: number;
  saveFailed: boolean;
  checkpoints: CheckpointInfo[];
  features: Features;
  /** The levels of the open battlemap (null for a world map). The active one is the level the floor, walls and lights on screen belong to. */
  levels: LevelsFile | null;
  /** Bumped whenever new derived layers (climate, rivers, lakes) arrive. */
  derivedVersion: number;
  /** What Claude Code last reported through its hooks (Assist mode waits for "idle"). */
  claude: ClaudeState;
  /** What the DM has selected (shared with Claude through the server), whether Claude's edits are locked to it, and whether the DM wants that lock whenever an area is selected. */
  selection: Selection | null;
  selectionLock: boolean;
  lockPref: boolean;
  /** Pictures being added as references, or just added (a note at the bottom of the window). `at` changes each time. */
  /** A short note at the bottom of the window ("Added ... to References", "... was deleted"); it goes away by itself after `ms` (4 s when not given). */
  pictureNote: { text: string; busy: boolean; at: number; ms?: number } | null;
  /** A settlement's ground colours are being taken from its trace picture (`ground_from_picture`). */
  groundBusy: boolean;
  /** World maps: the named rivers and lakes as the water is now (labels to draw, each name's river or lake) and every lake's shore (the River tool). Null until the rivers are worked out. */
  water: { labels: MapLabel[]; named: NamedWater[]; lakes: LakeShape[] } | null;
  /** Valleys are being carved (the Carve valleys button waits). */
  carving: boolean;
  /** The AI assistant's questions waiting for the DM's OK (tools risky.ts), oldest first, with when each arrived (AskBox.tsx). */
  asks: { id: string; via: "chat" | "mcp"; tool: string; text: string; waitMs: number; at: number; map?: string }[];
  /** The DM's prefabs (core prefabs.ts; null until asked for), the files that couldn't be read, a save waiting for "replace?", and the one saved last. */
  prefabs: PrefabInfo[] | null;
  prefabsSkipped: string[];
  prefabAsk: { name: string; rect: Rect } | null;
  prefabSaved: { id: string; at: number } | null;
  /** The Generate box (GenerateBox.tsx): what was asked for or made last, its seed, and whether it is still being made. */
  generated: { what: GenerateRequest["what"]; seed: number; summary: string; busy: boolean } | null;
  /** What the player screen shows: a part of the battlemap the DM chose (squares), or all of it (null). */
  playerRect: { x: number; y: number; w: number; h: number } | null;
}

function loadLockPref(): boolean {
  try { return localStorage.getItem("dd.selectionLock") !== "0"; } catch { return true; }
}

const initial: AppState = {
  connected: false, meta: null, projects: [], changes: [], seq: 0, canUndo: false, canRedo: false, refs: [],
  chat: [], chatSettings: { model: "claude-opus-5-5", effort: "medium" }, chatBusy: false, usage: emptyUsage(),
  apiKeyConfigured: false, error: null, savedAt: 0, storedAt: 0, changedAt: 0, saveFailed: false, checkpoints: [], derivedVersion: 0, features: { places: [], labels: [] }, levels: null, claude: "unknown",
  selection: null, selectionLock: false, lockPref: loadLockPref(), pictureNote: null, groundBusy: false, water: null, carving: false, asks: [],
  prefabs: null, prefabsSkipped: [], prefabAsk: null, prefabSaved: null, generated: null, playerRect: null,
};

/** The most pictures added in one go (a whole folder dropped by mistake shouldn't start hundreds of uploads). */
const MAX_PICTURES_AT_ONCE = 20;

/** Send one picture to the server, from a worker (see pictureUploadWorker.ts). */
function uploadPicture(url: string, file: Blob, name: string): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const w = new Worker(new URL("./pictureUploadWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => { resolve(e.data); w.terminate(); };
    w.onerror = () => { resolve({ ok: false, message: `"${name}" couldn't be added: the upload didn't start.` }); w.terminate(); };
    w.postMessage({ url, file, name });
  });
}

/** The climate layers' size and rivers (the rivers are drawn as vectors on the main thread; the layers themselves live in the paint worker). */
export interface DerivedLite {
  W: number;
  H: number;
  seq: number;
  rivers: RiverPath[];
}

/** A received climate frame, to be handed on (transferred) to the paint worker: the planes start at `offset` in `buf`. */
export interface DerivedFrame {
  buf: ArrayBuffer;
  offset: number;
  length: number;
  W: number;
  H: number;
  seq: number;
  /** The rivers (painted into the map by the paint worker). */
  rivers: RiverPath[];
}

/** Why the picture needs updating: a height patch, a whole new map (snapshot), or a setting that changes how the whole map looks. */
export type PatchReason = "patch" | "snapshot" | "meta";

class Store {
  state: AppState = initial;
  heights: HeightField | null = null;
  /** Rivers and the size of the climate layers (computed by the server after edits settle); the layers themselves are in the paint worker. */
  derived: DerivedLite | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private patchListeners = new Set<(r: Rect | null, why: PatchReason) => void>();
  /** Who wants the picture reader's answers (reader.ts). */
  private readListeners = new Set<(m: Extract<ServerMsg, { t: "picture_read" }>) => void>();
  onPictureRead(cb: (m: Extract<ServerMsg, { t: "picture_read" }>) => void) {
    this.readListeners.add(cb);
    return () => { this.readListeners.delete(cb); };
  }
  /** Who wants the answer to `compare_with` (compare.ts). */
  private compareListeners = new Set<(m: Extract<ServerMsg, { t: "compare" }>) => void>();
  onCompare(cb: (m: Extract<ServerMsg, { t: "compare" }>) => void) {
    this.compareListeners.add(cb);
    return () => { this.compareListeners.delete(cb); };
  }
  /** Who wants the ruler's route surveyed (measure.ts). */
  private measureListeners = new Set<(m: Extract<ServerMsg, { t: "measured" }>) => void>();
  onMeasured(cb: (m: Extract<ServerMsg, { t: "measured" }>) => void) {
    this.measureListeners.add(cb);
    return () => { this.measureListeners.delete(cb); };
  }
  private derivedListeners = new Set<(frame: DerivedFrame) => void>();
  /** A climate frame that arrived while nobody was listening (the map view mounts a moment after the first frames). */
  private pendingDerived: DerivedFrame | null = null;
  private retry = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
  getState = () => this.state;

  onPatch(cb: (r: Rect | null, why: PatchReason) => void) {
    this.patchListeners.add(cb);
    return () => { this.patchListeners.delete(cb); };
  }

  /**
   * New climate frames, to be handed to the paint worker (the first listener takes the buffer: it is transferred, not copied). A frame that
   * arrived before anyone listened is delivered as soon as someone does.
   */
  onDerived(cb: (frame: DerivedFrame) => void) {
    this.derivedListeners.add(cb);
    const waiting = this.pendingDerived;
    if (waiting) { this.pendingDerived = null; queueMicrotask(() => cb(waiting)); }
    return () => { this.derivedListeners.delete(cb); };
  }

  /** Make a dungeon, cave or village (the Generate box): the box waits for the answer. */
  generate(req: GenerateRequest) {
    this.set({ generated: { what: req.what, seed: this.state.generated?.seed ?? 0, summary: "", busy: true } });
    this.send({ t: "generate", req });
  }

  /** A short note at the bottom of the window (it goes by itself). */
  note(text: string, ms = 5000) { this.set({ pictureNote: { text, busy: false, at: Date.now(), ms } }); }
  /** Colour the open settlement's ground from its trace picture (the answer is `ground_sampled`). */
  groundFromPicture() { this.set({ groundBusy: true }); this.send({ t: "ground_from_picture" }); }

  /** The DM chose another name instead of replacing a prefab. */
  clearPrefabAsk() { this.set({ prefabAsk: null }); }

  private set(p: Partial<AppState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  private patched(r: Rect | null, why: PatchReason) {
    for (const cb of this.patchListeners) cb(r, why);
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return; // already connecting/connected (StrictMode runs effects twice)
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ connected: true, error: null });
    };
    ws.onclose = () => {
      this.set({ connected: false, asks: [] }); // (questions still open are sent again on reconnecting)
      const wait = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.handle(JSON.parse(ev.data) as ServerMsg);
      else this.handleFrame(ev.data as ArrayBuffer);
    };
  }

  send(msg: ClientMsg) {
    // an edit says which map and level it was made on: the AI may open another meanwhile, and the server then refuses it rather than make it there
    const out = EDIT_MESSAGES.has(msg.t) ? { ...msg, projectId: this.state.meta?.id, ...(this.state.levels && { level: this.state.levels.active }) } : msg;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(out));
  }

  /** The DM selects something, or nothing. An area (or a climate region) locks Claude's edits to it while the lock preference is on. */
  setSelection(selection: Selection | null) {
    const lock = !!selection && this.state.lockPref && !!selectionShape(selection, this.state.features);
    this.set({ selection, selectionLock: lock });
    this.send({ t: "selection", selection, lock });
  }

  setLockPref(on: boolean) {
    try { localStorage.setItem("dd.selectionLock", on ? "1" : "0"); } catch { /* private window */ }
    this.set({ lockPref: on });
    if (this.state.selection) this.setSelection(this.state.selection);
  }

  private lastView = "";
  /** What part of the map is on screen (Claude can ask where the DM is looking). */
  sendView(rect: Rect, zoom: number) {
    const key = JSON.stringify([rect, zoom]);
    if (key === this.lastView) return;
    this.lastView = key;
    this.send({ t: "view", rect, zoom });
  }

  /** Switch the battlemap to another level (the server sends the level's floor, walls and lights, as it does when a map is opened). */
  setLevel(id: string) {
    if (this.state.levels && this.state.levels.active !== id) this.send({ t: "level_set", id });
  }
  addLevel(where: "above" | "below", name?: string) {
    this.send({ t: "level_add", where, name });
  }
  updateLevel(id: string, patch: { name?: string; bottom?: number; top?: number }) {
    this.send({ t: "level_update", id, patch });
  }
  removeLevel(id: string) {
    this.send({ t: "level_remove", id });
  }

  /** The DM's answer to one of the AI assistant's questions. */
  answerAsk(id: string, allow: boolean) {
    this.send({ t: "confirm_answer", id, allow });
    this.set({ asks: this.state.asks.filter((a) => a.id !== id) });
  }

  dismissError() {
    this.set({ error: null });
  }

  /** Carve valleys along the rivers (the server saves a checkpoint first; the answer is `carved`, or an error). */
  carve(o: { strength: number; floodplains: boolean; deltas: boolean; where: "map" | "selection" }) {
    this.set({ carving: true });
    this.send({ t: "carve_valleys", ...o });
  }

  /** A river drawn along a line (map px, from its source down): the server cuts a channel along it and starts a river at its upper end; the answer is `river_drawn`, or an error. */
  drawRiver(points: [number, number][], size: RiverSize) {
    this.send({ t: "draw_river", points, size });
  }

  /**
   * Add pictures as references of the open map (the Add picture button, or pictures dropped or pasted anywhere). Each is checked here
   * first with the server's own rules (`referencePictureProblem`), so one that can't be used is refused with a note that says what to do
   * instead of being sent. The new pictures come back in `refs` from the server.
   */
  async addPictures(files: File[]): Promise<void> {
    const id = this.state.meta?.id;
    if (!id || !files.length) return;
    const take = files.slice(0, MAX_PICTURES_AT_ONCE);
    this.set({ pictureNote: { text: take.length === 1 ? "Adding the picture…" : `Adding ${take.length} pictures…`, busy: true, at: Date.now() } });
    const added: string[] = [], problems: string[] = [];
    for (const f of take) {
      const head = new Uint8Array(await f.slice(0, IMAGE_HEAD_BYTES).arrayBuffer());
      const kind = pictureKind(head.subarray(0, PICTURE_HEAD_BYTES));
      const name = f.name || `pasted-picture.${kind === "jpeg" ? "jpg" : kind ?? "png"}`;
      const problem = referencePictureProblem(name, kind, f.size, imageSize(head));
      if (problem) { problems.push(problem); continue; }
      const r = await uploadPicture(`/api/projects/${encodeURIComponent(id)}/refs`, f, name);
      if (r.ok) added.push(r.name); else problems.push(r.message);
    }
    if (files.length > take.length) problems.push(`Only ${MAX_PICTURES_AT_ONCE} pictures can be added at once: the other ${files.length - take.length} were left out.`);
    const text = added.length === 1 ? `Added ${added[0]} to References.` : `Added ${added.length} pictures to References.`;
    this.set({ pictureNote: added.length ? { text, busy: false, at: Date.now() } : null, ...(problems.length && { error: problems.join(" ") }) });
  }

  dismissPictureNote() {
    this.set({ pictureNote: null });
  }

  /** Give a reference picture a new name (its file type stays), or take it off the list (the server moves it to the map's backups folder). */
  renamePicture(name: string, to: string) {
    this.send({ t: "ref_rename", name, to });
  }
  removePicture(name: string) {
    this.send({ t: "ref_remove", name });
  }

  private handleFrame(buf: ArrayBuffer) {
    const meta = this.state.meta;
    const head = decodeFrameHeader(buf);
    if (!meta || head.header.projectId !== meta.id) return;
    if (head.header.t === "derived") {
      // the layers go to the paint worker as they are (no copy); only the rivers are kept here
      const { header, offset } = head;
      this.derived = { W: header.rect.w, H: header.rect.h, seq: header.seq, rivers: header.rivers ?? [] };
      this.set({ derivedVersion: this.state.derivedVersion + 1 });
      const frame: DerivedFrame = { buf, offset, length: buf.byteLength - offset, W: header.rect.w, H: header.rect.h, seq: header.seq, rivers: header.rivers ?? [] };
      if (this.derivedListeners.size === 0) this.pendingDerived = frame;
      else { this.pendingDerived = null; for (const cb of this.derivedListeners) cb(frame); }
      return;
    }
    const { header, payload } = decodeFrame(buf);
    if (header.t === "snapshot") {
      this.heights = new HeightField(header.rect.w, header.rect.h, payload);
      this.patched(null, "snapshot");
    } else if (this.heights) {
      this.heights.pasteRect(header.rect, payload);
      this.patched(header.rect, "patch");
    }
  }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case "project":
        this.heights = null;
        this.derived = null;
        this.pendingDerived = null;
        this.set({
          storedAt: 0, changedAt: 0, saveFailed: false,
          meta: m.meta, projects: m.projects, changes: m.changes, seq: m.seq, canUndo: m.canUndo, canRedo: m.canRedo,
          refs: m.refs, chat: m.chat, chatSettings: m.chatSettings, chatBusy: m.chatBusy, usage: m.usage,
          apiKeyConfigured: m.apiKeyConfigured, features: m.features, levels: m.levels ?? null, selection: null, selectionLock: false, water: null, carving: false,
        });
        break;
      case "projects":
        this.set({ projects: m.projects });
        break;
      case "meta": {
        const prev = this.state.meta;
        this.set({ meta: m.meta });
        // a new grid, name or title only needs a redraw (the views redraw when `meta` changes); repainting the map would stall the editor
        if (repaintNeeded(prev, m.meta)) this.patched(null, "meta");
        break;
      }
      case "change":
        this.set({ changes: [...this.state.changes.slice(-199), m.change], seq: m.change.seq, canUndo: m.canUndo, canRedo: m.canRedo, changedAt: Date.now() });
        break;
      case "refs":
        this.set({ refs: m.refs });
        break;
      case "checkpoints":
        this.set({ checkpoints: m.list });
        break;
      case "saved":
        if (m.failed) this.set({ saveFailed: true });
        else this.set({ storedAt: Date.now(), saveFailed: false, ...(!m.auto && { savedAt: Date.now() }) });
        break;
      case "picture_read":
        for (const l of this.readListeners) l(m);
        break;
      case "ground_sampled": {
        const names = Object.keys(m.colours ?? {});
        this.set({ groundBusy: false, ...(m.error ? { error: m.error } : { pictureNote: { text: `Coloured the ${names.join(", ")} from the trace picture. Undo takes it back.`, busy: false, at: Date.now(), ms: 7000 } }) });
        break;
      }
      case "water":
        if (m.projectId === this.state.meta?.id) this.set({ water: { labels: m.labels, named: m.named, lakes: m.lakes ?? this.state.water?.lakes ?? [] } });
        break;
      case "carved":
        this.set({
          carving: false,
          pictureNote: { text: `Valleys carved${!m.scope || m.scope === "the whole map" ? "" : m.scope === "the selected area" ? " in the selected area" : ` along ${m.scope}`}: ${m.lowered.toLocaleString()} map pixels lowered, the deepest cut ${m.deepestM.toLocaleString()} m${m.deltaCells ? `, ${m.deltaCells.toLocaleString()} pixels of new delta land` : ""}. Undo takes it back; the checkpoint "${m.checkpoint}" has the map as it was.`, busy: false, at: Date.now(), ms: 12000 },
        });
        break;
      case "compare":
        for (const cb of this.compareListeners) cb(m);
        break;
      case "measured":
        for (const cb of this.measureListeners) cb(m);
        break;
      case "prefabs":
        this.set({ prefabs: m.list, prefabsSkipped: m.skipped });
        break;
      case "player_view":
        this.set({ playerRect: m.rect });
        break;
      case "generated":
        this.set({ generated: { what: m.what, seed: m.seed, summary: m.summary, busy: false }, pictureNote: { text: `Made ${m.summary} (seed ${m.seed}: the same seed makes it again). Undo takes it back.`, busy: false, at: Date.now(), ms: 9000 } });
        break;
      case "prefab_saved":
        this.set({ prefabAsk: null, prefabSaved: { id: m.prefab.id, at: Date.now() }, pictureNote: { text: `Saved the prefab "${m.prefab.name}" (${m.prefab.what}). Click the map to place it.`, busy: false, at: Date.now(), ms: 7000 } });
        break;
      case "prefab_exists":
        this.set({ prefabAsk: { name: m.name, rect: m.rect } });
        break;
      case "prefab_placed":
        if (m.problems.length) this.set({ pictureNote: { text: `Placed "${m.name}". ${m.problems.join(" ")}`, busy: false, at: Date.now(), ms: 9000 } });
        break;
      case "prefab_removed":
        this.set({ pictureNote: { text: `"${m.name}" is out of the list; its files were moved to ${m.where}.`, busy: false, at: Date.now(), ms: 9000 } });
        break;
      case "duplicated":
        this.set({ pictureNote: { text: `"${m.name}" is a copy of "${m.from}", now open: change it, and compare it with the original from the Map panel. The original is left as it was.`, busy: false, at: Date.now(), ms: 9000 } });
        break;
      case "confirm":
        if (!this.state.asks.some((a) => a.id === m.id)) this.set({ asks: [...this.state.asks, { id: m.id, via: m.via, tool: m.tool, text: m.text, waitMs: m.waitMs, at: Date.now(), ...(m.map && { map: m.map }) }] });
        break;
      case "confirm_done":
        this.set({ asks: this.state.asks.filter((a) => a.id !== m.id) });
        break;
      case "river_drawn": {
        const mi = Math.round(m.lengthKm * 0.621371);
        const ends = m.end === "sea" ? "to the sea" : m.end === "edge" ? "to the map's edge" : "ending on land, where it carries on downhill (or fills a hollow into a lake)";
        const cut = m.deepestM >= 40 ? ` Through high ground it cut up to ${m.deepestM.toLocaleString()} m deep.` : "";
        const turned = m.reversed ? " You drew it from the mouth up, so it runs the other way." : "";
        this.set({ pictureNote: { text: `River drawn: about ${mi.toLocaleString()} mi, ${ends}.${turned}${cut} The rivers are worked out again in a moment. Undo takes it back.`, busy: false, at: Date.now(), ms: 9000 } });
        break;
      }
      case "map_deleted":
        this.set({ pictureNote: { text: `"${m.name}" was deleted. Its folder is kept in your maps folder, under "Deleted maps", if you ever want it back.`, busy: false, at: Date.now(), ms: 9000 } });
        break;
      case "features":
        this.set({ features: m.features });
        break;
      case "levels":
        this.set({ levels: m.levels });
        break;
      case "claude_state":
        this.set({ claude: m.state });
        break;
      case "selection":
        this.set({ selection: m.selection, selectionLock: m.lock });
        break;
      case "chat_settings":
        this.set({ chatSettings: m.settings });
        break;
      case "chat": {
        const ev = m.ev;
        if (ev.type === "item_add") this.set({ chat: [...this.state.chat, ev.item] });
        else if (ev.type === "item_update") {
          this.set({ chat: this.state.chat.map((it) => (it.id === ev.id ? ({ ...it, ...ev.patch } as ChatItem) : it)) });
        } else if (ev.type === "busy") this.set({ chatBusy: ev.busy });
        else if (ev.type === "usage") this.set({ usage: ev.session });
        break;
      }
      case "error":
        this.set({ error: m.message, carving: false, ...(this.state.generated?.busy && { generated: { ...this.state.generated, busy: false } }) });
        break;
    }
  }
}

export const store = new Store();
