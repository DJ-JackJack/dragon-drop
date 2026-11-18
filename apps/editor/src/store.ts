/**
 * Connection to the map server + client-side state.
 * The heightmap lives outside React state (it's large and patched in place); components
 * subscribe to `onPatch` to redraw, and to `subscribe` for everything else.
 */
import {
  type ChangeEntry, type ChatItem, type ChatSettings, type CheckpointInfo, type ClaudeState, type ClientMsg, type Features, type MapMeta,
  type ProjectInfo, type Rect, type RefInfo, type Selection, type ServerMsg, type Usage, HeightField, type RiverPath, decodeFrame, decodeFrameHeader, emptyUsage, selectionShape,
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
  checkpoints: CheckpointInfo[];
  features: Features;
  /** Bumped whenever new derived layers (climate, rivers, lakes) arrive. */
  derivedVersion: number;
  /** What Claude Code last reported through its hooks (Assist mode waits for "idle"). */
  claude: ClaudeState;
  /** What the DM has selected (shared with Claude through the server), whether Claude's edits are locked to it, and whether the DM wants that lock whenever an area is selected. */
  selection: Selection | null;
  selectionLock: boolean;
  lockPref: boolean;
}

function loadLockPref(): boolean {
  try { return localStorage.getItem("dd.selectionLock") !== "0"; } catch { return true; }
}

const initial: AppState = {
  connected: false, meta: null, projects: [], changes: [], seq: 0, canUndo: false, canRedo: false, refs: [],
  chat: [], chatSettings: { model: "claude-opus-5-5", effort: "medium" }, chatBusy: false, usage: emptyUsage(),
  apiKeyConfigured: false, error: null, savedAt: 0, checkpoints: [], derivedVersion: 0, features: { places: [], labels: [] }, claude: "unknown",
  selection: null, selectionLock: false, lockPref: loadLockPref(),
};

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

  private set(p: Partial<AppState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  private patched(r: Rect | null, why: PatchReason) {
    for (const cb of this.patchListeners) cb(r, why);
  }

  /** lite: JSON only (no heightmap or climate frames) - for the phone viewer. */
  private lite = false;

  connect(lite = this.lite) {
    this.lite = lite;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return; // already connecting/connected (StrictMode runs effects twice)
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws${lite ? "?lite=1" : ""}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ connected: true, error: null });
    };
    ws.onclose = () => {
      this.set({ connected: false });
      const wait = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.handle(JSON.parse(ev.data) as ServerMsg);
      else this.handleFrame(ev.data as ArrayBuffer);
    };
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
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

  dismissError() {
    this.set({ error: null });
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
          meta: m.meta, projects: m.projects, changes: m.changes, seq: m.seq, canUndo: m.canUndo, canRedo: m.canRedo,
          refs: m.refs, chat: m.chat, chatSettings: m.chatSettings, chatBusy: m.chatBusy, usage: m.usage,
          apiKeyConfigured: m.apiKeyConfigured, features: m.features, selection: null, selectionLock: false,
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
        this.set({ changes: [...this.state.changes.slice(-199), m.change], seq: m.change.seq, canUndo: m.canUndo, canRedo: m.canRedo });
        break;
      case "refs":
        this.set({ refs: m.refs });
        break;
      case "checkpoints":
        this.set({ checkpoints: m.list });
        break;
      case "saved":
        this.set({ savedAt: Date.now() });
        break;
      case "derived_ready":
        // lite clients get no derived frames; this is their cue that the map changed
        if (this.lite && m.projectId === this.state.meta?.id) this.set({ derivedVersion: this.state.derivedVersion + 1 });
        break;
      case "features":
        this.set({ features: m.features });
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
        this.set({ error: m.message });
        break;
    }
  }
}

export const store = new Store();
