/**
 * Commands, shared undo/redo history and the change log.
 *
 * Both the human (editor brushes) and Claude (tools) mutate the map only through
 * MapSession.execute(), so history, attribution and sync work the same for both.
 */
import type { MapDoc, MapMeta } from "./doc.ts";
import type { Rect } from "./geom.ts";
import { clipRect, rectUnion } from "./geom.ts";
import {
  type AddLandmassParams, type GenerateTerrainParams, type MountainRangeParams, type SculptParams,
  addLandmass, addMountainRange, generateTerrain, sculpt,
} from "./terrain.ts";
import { type ErodeParams, erodeTerrain } from "./hydrology.ts";
import { type PaintFloorParams, MATERIALS, isBattle, paintFloor } from "./battle.ts";
import { type Features, type FeaturesPatch, applyFeaturesPatch, describeFeaturesPatch, emptyFeatures } from "./features.ts";
import { type EditLock, type SelectionMask, featuresOutsideLock, selectionMask } from "./selection.ts";

/** Claude tried to change something outside the area the DM has locked its edits to. */
export class LockedEditError extends Error {
  constructor(what: string) {
    super(`Locked to the DM's selection: this ${what}. Tell the DM, who can unlock the selection or select a bigger area. Don't work around it.`);
    this.name = "LockedEditError";
  }
}

export type Command =
  | { op: "generate_terrain"; params: GenerateTerrainParams }
  | { op: "add_landmass"; params: AddLandmassParams }
  | { op: "add_mountain_range"; params: MountainRangeParams }
  | { op: "sculpt"; params: SculptParams }
  | { op: "erode"; params: ErodeParams }
  | { op: "paint_floor"; params: PaintFloorParams }
  | { op: "set_sea_level"; levelM: number }
  | { op: "set_meta"; patch: Pick<Partial<MapMeta>, "style" | "climate" | "name" | "notes" | "grid" | "furniture" | "battle">; label?: string }
  | { op: "restore"; data: Float32Array; meta: Pick<Partial<MapMeta>, "seaLevel" | "style" | "climate">; features?: Features; label: string }
  | { op: "features"; patch: FeaturesPatch; label?: string }
  | { op: "replace_heights"; data: Float32Array; label?: string };

export type Author = "user" | "claude" | "system";

export interface ChangeEntry {
  seq: number;
  kind: "edit" | "undo" | "redo";
  author: Author;
  label: string;
  rect: Rect | null;
  time: string;
}

interface UndoEntry {
  seq: number;
  author: Author;
  label: string;
  rect: Rect | null;
  before: Float32Array | null;
  after: Float32Array | null;
  metaBefore?: Partial<MapMeta>;
  metaAfter?: Partial<MapMeta>;
  featuresBefore?: Features;
  featuresAfter?: Features;
}

export type SessionEvent =
  | { type: "patch"; rect: Rect; seq: number }
  | { type: "meta"; meta: MapMeta; seq: number }
  | { type: "features"; features: Features; seq: number }
  | { type: "history"; change: ChangeEntry };

export function describeCommand(cmd: Command): string {
  const r = (n: number) => Math.round(n);
  switch (cmd.op) {
    case "generate_terrain":
      return `Generate ${cmd.params.template} terrain (seed ${cmd.params.seed})`;
    case "add_landmass":
      return `Add landmass (${cmd.params.shape.type})`;
    case "add_mountain_range":
      return `Add mountain range (${cmd.params.path.length} pts, ${r(cmd.params.peakM ?? 2800)} m)`;
    case "sculpt": {
      const s = cmd.params.shape;
      const where = s.type === "circle" ? ` at ${r(s.x)},${r(s.y)}` : "";
      return `${cmd.params.mode[0].toUpperCase()}${cmd.params.mode.slice(1)} terrain${where}`;
    }
    case "erode":
      return `Erode terrain (${cmd.params.passes ?? 4} passes)`;
    case "paint_floor":
      return `Paint ${cmd.params.material >= 100 ? "texture" : (MATERIALS[cmd.params.material]?.name ?? "floor")}`;
    case "set_sea_level":
      return `Set sea level to ${r(cmd.levelM)} m`;
    case "set_meta":
      return cmd.label ?? `Change map settings (${Object.keys(cmd.patch).join(", ")})`;
    case "restore":
      return cmd.label;
    case "features":
      return cmd.label ?? describeFeaturesPatch(cmd.patch);
    case "replace_heights":
      return cmd.label ?? "Replace heightmap";
  }
}

const MAX_HISTORY_BYTES = 384 * 1024 * 1024;
/** The commands that change heights and so can be clipped to a lock. */
const LOCK_CLIPS = new Set<Command["op"]>(["generate_terrain", "add_landmass", "add_mountain_range", "sculpt", "erode", "replace_heights"]);

export class MapSession {
  doc: MapDoc;
  seq = 0;
  readonly changes: ChangeEntry[] = [];
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private txn: { author: Author; label: string; snapshot: Float32Array; rect: Rect | null; meta: MapMeta } | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  /** While set, Claude's edits are held to this area: terrain changes are clipped to it (soft edge inside, nothing outside), feature edits outside it are refused. The editor's own edits are never held. */
  editLock: EditLock | null = null;
  private lockMask: { lock: EditLock; w: number; h: number; mask: SelectionMask } | null = null;

  constructor(doc: MapDoc) {
    this.doc = doc;
  }

  on(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: SessionEvent) {
    for (const cb of this.listeners) cb(e);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get inTransaction() {
    return this.txn !== null;
  }

  /** Apply one command. Inside a transaction it is folded into the transaction's history entry. */
  execute(cmd: Command, author: Author, label?: string): { seq: number; rect: Rect | null; label: string } {
    const lbl = label ?? describeCommand(cmd);
    const hf = this.doc.height;
    const standalone = !this.txn;
    const lock = author === "claude" && this.editLock && !isBattle(this.doc) ? this.editLock : null;
    if (lock) this.checkLock(cmd, lock);
    const snapshot = standalone ? new Float32Array(hf.data) : null;
    const lockPre = lock && LOCK_CLIPS.has(cmd.op) ? (snapshot ?? new Float32Array(hf.data)) : null;
    const metaBefore = { ...this.doc.meta };
    const featuresBefore = this.doc.features ?? emptyFeatures();
    let featuresChanged = false;
    let rect: Rect | null = null;

    switch (cmd.op) {
      case "generate_terrain": rect = generateTerrain(this.doc, cmd.params); break;
      case "add_landmass": rect = addLandmass(this.doc, cmd.params); break;
      case "add_mountain_range": rect = addMountainRange(this.doc, cmd.params); break;
      case "sculpt": rect = sculpt(this.doc, cmd.params); break;
      case "paint_floor": rect = paintFloor(this.doc, cmd.params); break;
      case "erode":
        erodeTerrain(hf.data, hf.w, hf.h, this.doc.meta.seaLevel, cmd.params);
        rect = { x: 0, y: 0, w: hf.w, h: hf.h };
        break;
      case "set_sea_level":
        this.doc.meta.seaLevel = cmd.levelM;
        break;
      case "set_meta":
        Object.assign(this.doc.meta, cmd.patch);
        break;
      case "restore":
        if (cmd.data.length !== hf.data.length) throw new Error("restore: size mismatch");
        hf.data.set(cmd.data);
        Object.assign(this.doc.meta, cmd.meta);
        if (cmd.features) { this.doc.features = structuredClone(cmd.features); featuresChanged = true; }
        rect = { x: 0, y: 0, w: hf.w, h: hf.h };
        break;
      case "features":
        this.doc.features = applyFeaturesPatch(featuresBefore, cmd.patch);
        featuresChanged = true;
        break;
      case "replace_heights":
        if (cmd.data.length !== hf.data.length) throw new Error("replace_heights: size mismatch");
        hf.data.set(cmd.data);
        rect = { x: 0, y: 0, w: hf.w, h: hf.h };
        break;
    }
    rect = rect ? clipRect(rect, hf.w, hf.h) : null;
    if (lock && lockPre && rect) rect = this.clipToLock(lockPre, rect, lock);
    this.doc.meta.updatedAt = new Date().toISOString();

    if (this.txn) {
      this.txn.rect = rectUnion(this.txn.rect, rect);
      if (rect) this.emit({ type: "patch", rect, seq: this.seq });
      if (featuresChanged) this.emit({ type: "features", features: this.doc.features!, seq: this.seq });
      return { seq: this.seq, rect, label: lbl };
    }

    const metaChanged = cmd.op === "set_sea_level" || cmd.op === "set_meta" || cmd.op === "restore";
    this.seq++;
    const entry: UndoEntry = {
      seq: this.seq, author, label: lbl, rect,
      before: rect && snapshot ? cropData(snapshot, hf.w, rect) : null,
      after: rect ? hf.copyRect(rect) : null,
    };
    if (metaChanged) {
      const keys = ["seaLevel", "style", "climate", "name", "notes", "grid", "furniture", "battle"] as const;
      entry.metaBefore = {};
      entry.metaAfter = {};
      for (const key of keys) {
        (entry.metaBefore as Record<string, unknown>)[key] = structuredClone(metaBefore[key]);
        (entry.metaAfter as Record<string, unknown>)[key] = structuredClone(this.doc.meta[key]);
      }
    }
    if (featuresChanged) {
      entry.featuresBefore = featuresBefore;
      entry.featuresAfter = this.doc.features;
    }
    this.pushUndo(entry);
    this.redoStack = [];
    this.log("edit", author, lbl, rect);
    if (rect) this.emit({ type: "patch", rect, seq: this.seq });
    if (metaChanged) this.emit({ type: "meta", meta: this.doc.meta, seq: this.seq });
    if (featuresChanged) this.emit({ type: "features", features: this.doc.features!, seq: this.seq });
    return { seq: this.seq, rect, label: lbl };
  }

  /** Refuse commands whose effect can't be held to an area (the whole map's sea level or climate, a checkpoint) or that put features outside it. */
  private checkLock(cmd: Command, lock: EditLock) {
    switch (cmd.op) {
      case "set_sea_level": throw new LockedEditError("would change the sea level everywhere");
      case "restore": throw new LockedEditError("would restore a whole checkpoint");
      case "set_meta":
        if (cmd.patch.climate) throw new LockedEditError("would change the climate settings for the whole map");
        return;
      case "features": {
        const out = featuresOutsideLock(cmd.patch, this.doc.features ?? emptyFeatures(), lock);
        if (out.length) throw new LockedEditError(`would change ${out.slice(0, 3).join(", ")}${out.length > 3 ? ` and ${out.length - 3} more` : ""}, outside the selection`);
        return;
      }
    }
  }

  /** Put back everything the command changed outside the lock (and part of it across the soft edge); returns the area that can still have changed. */
  private clipToLock(pre: Float32Array, rect: Rect, lock: EditLock): Rect | null {
    const hf = this.doc.height;
    let lm = this.lockMask;
    if (!lm || lm.lock !== lock || lm.w !== hf.w || lm.h !== hf.h) {
      lm = { lock, w: hf.w, h: hf.h, mask: selectionMask(lock.shape, hf.w, hf.h, lock.featherPx) };
      this.lockMask = lm;
    }
    const { rect: mr, data: md } = lm.mask, W = hf.w, d = hf.data;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      const row = y >= mr.y && y < mr.y + mr.h;
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const w = row && x >= mr.x && x < mr.x + mr.w ? md[(y - mr.y) * mr.w + (x - mr.x)] : 0;
        if (w >= 1) continue;
        const i = y * W + x;
        d[i] = w <= 0 ? pre[i] : pre[i] + (d[i] - pre[i]) * w;
      }
    }
    const x0 = Math.max(rect.x, mr.x), y0 = Math.max(rect.y, mr.y), x1 = Math.min(rect.x + rect.w, mr.x + mr.w), y1 = Math.min(rect.y + rect.h, mr.y + mr.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** Group several commands (e.g. one brush stroke) into a single undoable step. */
  begin(author: Author, label: string) {
    if (this.txn) this.commit();
    this.txn = { author, label, snapshot: new Float32Array(this.doc.height.data), rect: null, meta: { ...this.doc.meta } };
  }

  commit(): { seq: number; rect: Rect | null } | null {
    const t = this.txn;
    if (!t) return null;
    this.txn = null;
    if (!t.rect) return null;
    const hf = this.doc.height;
    this.seq++;
    this.pushUndo({
      seq: this.seq, author: t.author, label: t.label, rect: t.rect,
      before: cropData(t.snapshot, hf.w, t.rect), after: hf.copyRect(t.rect),
    });
    this.redoStack = [];
    this.log("edit", t.author, t.label, t.rect);
    return { seq: this.seq, rect: t.rect };
  }

  undo(author: Author): ChangeEntry | null {
    if (this.txn) this.commit();
    const e = this.undoStack.pop();
    if (!e) return null;
    this.restore(e, "before");
    this.redoStack.push(e);
    this.seq++;
    return this.log("undo", author, `Undo: ${e.label}`, e.rect, e);
  }

  redo(author: Author): ChangeEntry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.restore(e, "after");
    this.undoStack.push(e);
    this.seq++;
    return this.log("redo", author, `Redo: ${e.label}`, e.rect, e);
  }

  changesSince(seq: number): ChangeEntry[] {
    return this.changes.filter((c) => c.seq > seq);
  }

  /** Recent history for UI display (newest last). */
  recent(n = 50): ChangeEntry[] {
    return this.changes.slice(-n);
  }

  private restore(e: UndoEntry, which: "before" | "after") {
    const data = which === "before" ? e.before : e.after;
    if (e.rect && data) {
      this.doc.height.pasteRect(e.rect, data);
      this.emit({ type: "patch", rect: e.rect, seq: this.seq + 1 });
    }
    const meta = which === "before" ? e.metaBefore : e.metaAfter;
    if (meta) {
      Object.assign(this.doc.meta, meta);
      this.emit({ type: "meta", meta: this.doc.meta, seq: this.seq + 1 });
    }
    const feats = which === "before" ? e.featuresBefore : e.featuresAfter;
    if (feats) {
      this.doc.features = feats;
      this.emit({ type: "features", features: feats, seq: this.seq + 1 });
    }
    this.doc.meta.updatedAt = new Date().toISOString();
  }

  private log(kind: ChangeEntry["kind"], author: Author, label: string, rect: Rect | null, _e?: UndoEntry): ChangeEntry {
    const change: ChangeEntry = { seq: this.seq, kind, author, label, rect, time: new Date().toISOString() };
    this.changes.push(change);
    if (this.changes.length > 2000) this.changes.splice(0, this.changes.length - 2000);
    this.emit({ type: "history", change });
    return change;
  }

  private pushUndo(e: UndoEntry) {
    this.undoStack.push(e);
    let bytes = 0;
    for (const u of this.undoStack) bytes += ((u.before?.byteLength ?? 0) + (u.after?.byteLength ?? 0));
    while (bytes > MAX_HISTORY_BYTES && this.undoStack.length > 1) {
      const old = this.undoStack.shift() as UndoEntry;
      bytes -= (old.before?.byteLength ?? 0) + (old.after?.byteLength ?? 0);
    }
  }
}

function cropData(full: Float32Array, W: number, r: Rect): Float32Array {
  const out = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const src = (r.y + y) * W + r.x;
    out.set(full.subarray(src, src + r.w), y * r.w);
  }
  return out;
}
