/**
 * Project folders on disk:
 *   projects/<id>/project.json        map metadata
 *   projects/<id>/map/height.f32.gz   live heightmap (Float32 LE, gzip) — not committed
 *   projects/<id>/seed/height.f32.gz  optional starting heightmap — committed
 *   projects/<id>/brief.md            design brief shared with Claude
 *   projects/<id>/refs/               reference images
 *   projects/<id>/map/previews/       preview images shown in chat
 *   projects/<id>/chat.json           in-app chat history — not committed
 *   projects/<id>/map/checkpoints/    named restore points, and the automatic ones (rolling backups)
 *   projects/<id>/backups/            copies of the files taken before a map is migrated to a newer format, and removed reference pictures (backups/removed-pictures)
 * (docs/MAP-FILES.md describes every file; project.json's formatVersion says which form they are in, see core's format.ts.)
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

// Compressing or decompressing a 17 MB map on the main thread froze the server for about half a second each time (edits, tool calls and chat all waited); the async versions run on the thread pool.
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
import {
  type BaseClimate, type BattleLevel, type CheckpointInfo, type Features, type LevelsFile, type MapDoc, type MapMeta, type MapMigration, type ProjectInfo, type RefInfo, CURRENT_FORMAT, HeightField,
  FIRST_CITY_FORMAT, IMAGE_HEAD_BYTES, MIGRATIONS, NewerFormatError, formatFor, PICTURE_HEAD_BYTES, REFERENCE_PICTURE_EXT, cleanLevels, createDoc, defaultLevels, emptyFeatures, formatOf, imageSize, isReferenceKind,
  migrateMap, packBaseClimate, pictureKind, referencePictureProblem, unpackBaseClimate,
} from "@mapmaker/core";

type CheckpointMeta = Pick<Partial<MapMeta>, "seaLevel" | "style" | "climate">;
/** One level of a battlemap, as a checkpoint keeps it (the level the checkpoint was taken on is the entry itself). */
interface CheckpointLevel { id: string; file: string; meta: CheckpointMeta; features?: Features; /** What the level was called and where it sat, so restoring can bring a removed level back. */ info?: BattleLevel }
interface CheckpointEntry extends CheckpointInfo {
  meta: CheckpointMeta;
  features?: Features;
  /** Battlemaps with more than one level: every level's floor (the level in `file` is listed here too). */
  levels?: CheckpointLevel[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$/;

const LEVEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export function safeLevelId(id: string): string {
  if (!LEVEL_ID_RE.test(id)) throw new Error(`Invalid level id: ${id}`);
  return id;
}

export function safeId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Invalid project id: ${id}`);
  return id;
}

export function safeFileName(name: string): string {
  const base = path.basename(name);
  if (!FILE_RE.test(base) || base.includes("..")) throw new Error(`Invalid file name: ${name}`);
  return base;
}

/** A reference picture's file type was refused (not PNG, JPEG or a still WebP, empty, or too big): the message is for the person. */
export class PictureRefused extends Error {}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A safe file name for a reference picture: what the person called it, with only letters, digits, spaces, dots, dashes and
 * underscores, starting with a letter or digit, not too long, and ending in the picture's real type (.png, .jpg or .jpeg, .webp).
 */
export function refFileName(name: string, kind: "png" | "jpeg" | "webp"): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  const given = base.match(/\.(png|jpe?g|webp)$/i)?.[1].toLowerCase();
  const ext = kind === "jpeg" ? (given === "jpeg" ? "jpeg" : "jpg") : kind;
  let stem = base.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  stem = stem.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[^A-Za-z0-9]+/, "").replace(/[. _-]+$/, "").slice(0, 100).replace(/[. _-]+$/, "");
  if (!stem) stem = "picture";
  if (WINDOWS_RESERVED.test(stem)) stem = `picture-${stem}`;
  return `${stem}.${ext}`;
}

function refKindOfName(name: string): "png" | "jpeg" | "webp" {
  const e = path.extname(name).toLowerCase();
  return e === ".png" ? "png" : e === ".webp" ? "webp" : "jpeg";
}

/** `name` if no file in `dir` has it, else name-2, name-3 and so on (before the ending). */
function freeName(dir: string, name: string): string {
  let out = name;
  for (let i = 2; existsSync(path.join(dir, out)); i++) out = name.replace(/(\.[^.]+)?$/, `-${i}$1`);
  return out;
}

/** The first `n` bytes of a file (fewer if it is shorter). */
async function readHead(file: string, n: number): Promise<Uint8Array> {
  const fh = await open(file, "r");
  try {
    const buf = new Uint8Array(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "map";
}

/** Every file a checkpoint entry keeps. */
const entryFiles = (c: CheckpointEntry) => [...new Set([c.file, ...(c.levels ?? []).map((l) => l.file)])];

/** A date as a folder-name-safe stamp, e.g. 2026-11-18T18-27-43-123Z. */
const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-");

/** A copy that shares nothing with the original (checkpoints are written after an await, and the map keeps changing meanwhile). */
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export interface StoreOptions {
  /** The format this store reads and writes (tests use other numbers to try migrations). */
  format?: number;
  migrations?: Record<number, MapMigration>;
}

export class ProjectStore {
  private readonly format: number;
  private readonly steps: Record<number, MapMigration>;
  /** Things worth telling the person about a map that was just opened (a file that had to be set aside); the hub passes them on. */
  private readonly notices = new Map<string, string[]>();
  /** Checkpoint changes for one map run one after the other: each reads the index, changes it and writes it back. */
  private readonly cpQueue = new Map<string, Promise<unknown>>();

  constructor(readonly root: string, opts: StoreOptions = {}) {
    this.format = opts.format ?? CURRENT_FORMAT;
    this.steps = opts.migrations ?? MIGRATIONS;
  }

  /** Messages collected while loading `id`, handed over once. */
  takeNotices(id: string): string[] {
    const n = this.notices.get(id) ?? [];
    this.notices.delete(id);
    return n;
  }

  private notice(id: string, message: string) {
    console.error(`[${id}] ${message}`);
    this.notices.set(id, [...(this.notices.get(id) ?? []), message]);
  }

  dir(id: string) {
    return path.join(this.root, safeId(id));
  }

  async list(): Promise<ProjectInfo[]> {
    if (!existsSync(this.root)) return [];
    const out: ProjectInfo[] = [];
    for (const name of await readdir(this.root)) {
      if (!ID_RE.test(name)) continue;
      const pj = path.join(this.root, name, "project.json");
      if (!existsSync(pj)) continue;
      try {
        const m = JSON.parse(await readFile(pj, "utf8")) as MapMeta;
        out.push({ id: name, name: m.name, width: m.width, height: m.height, kmPerPx: m.kmPerPx, updatedAt: m.updatedAt, ...(m.parent && { parent: m.parent }), ...((m.kind === "battle" || m.kind === "city") && { kind: m.kind }) });
      } catch {
        /* skip unreadable */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async exists(id: string) {
    return ID_RE.test(id) && existsSync(path.join(this.root, id, "project.json"));
  }

  async uniqueId(name: string): Promise<string> {
    const base = slugify(name);
    let id = base;
    for (let i = 2; await this.exists(id); i++) id = `${base}-${i}`;
    return id;
  }

  async load(id: string): Promise<MapDoc> {
    return this.loadAt(this.dir(id), id, true);
  }

  /** The folder that holds a level's files: the project's own for the first level, levels/<id>/ for the others. */
  levelDir(id: string, levels: LevelsFile, levelId: string): string {
    if (!levels.levels.some((l) => l.id === levelId)) throw new Error(`No level "${levelId}".`);
    return levelId === levels.levels[0].id ? this.dir(id) : path.join(this.dir(id), "levels", safeLevelId(levelId));
  }

  /** A battlemap's levels file (levels.json). A map with none has one level, "Ground floor". One that can't be read is set aside, never overwritten. */
  async readLevels(id: string): Promise<LevelsFile> {
    const f = path.join(this.dir(id), "levels.json");
    if (!existsSync(f)) return defaultLevels();
    try {
      const ok = cleanLevels(JSON.parse(await readFile(f, "utf8")));
      if (ok) return ok;
    } catch {
      /* unreadable: handled below */
    }
    const aside = `levels.unreadable-${stamp()}.json`;
    await rename(f, path.join(this.dir(id), aside));
    this.notice(id, `This battlemap's list of levels couldn't be read. It has been kept as ${aside}, and the map opens with its first level only (the other levels' files are still in the levels folder).`);
    return defaultLevels();
  }

  async writeLevels(id: string, file: LevelsFile): Promise<void> {
    await mkdir(this.dir(id), { recursive: true });
    await atomicWrite(path.join(this.dir(id), "levels.json"), JSON.stringify(file, null, 2));
  }

  /** A level other than the first (the first is `load`). */
  async loadLevel(id: string, levels: LevelsFile, levelId: string): Promise<MapDoc> {
    return this.loadAt(this.levelDir(id, levels, levelId), id, false);
  }

  async saveLevel(id: string, levels: LevelsFile, levelId: string, doc: MapDoc): Promise<void> {
    await this.saveAt(this.levelDir(id, levels, levelId), doc);
  }

  /** Delete a level's files (never the first level's: those are the project's own). */
  async removeLevelFiles(id: string, levels: LevelsFile, levelId: string): Promise<void> {
    if (levelId === levels.levels[0].id) throw new Error("The first level can't be removed.");
    await rm(this.levelDir(id, levels, levelId), { recursive: true, force: true });
  }

  /** `primary`: the project's own files (an older format is backed up and migrated, an unreadable features file falls back to a checkpoint's copy). */
  private async loadAt(d: string, id: string, primary: boolean): Promise<MapDoc> {
    const meta = JSON.parse(await readFile(path.join(d, "project.json"), "utf8")) as MapMeta;
    meta.id = id;
    // A map saved by a newer program is not opened at all: an older one would drop what it doesn't understand the next time it saved.
    // (City maps began at format 2, so a city's file never means less than that; one with no stamp at all, edited by hand, is taken as current. See formatFor.)
    const fmt = formatFor(meta.kind, this.format);
    const found = meta.kind !== "city" ? formatOf(meta) : typeof meta.formatVersion === "number" ? Math.max(formatOf(meta), FIRST_CITY_FORMAT) : fmt;
    if (found > fmt) throw new NewerFormatError(found, fmt, meta.name);
    const live = path.join(d, "map", "height.f32.gz");
    const seed = path.join(d, "seed", "height.f32.gz");
    const src = existsSync(live) ? live : existsSync(seed) ? seed : null;
    const features = await this.readFeaturesAt(d, id, primary);
    if (!src) {
      const doc = createDoc({ ...meta, id });
      doc.meta = { ...doc.meta, ...meta };
      doc.features = features;
      return primary ? this.upgrade(doc, found) : this.upgradeInMemory(doc, found);
    }
    const raw = await gunzipAsync(await readFile(src));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    if (data.length !== meta.width * meta.height) {
      const side = Math.round(Math.sqrt(data.length));
      throw new Error(
        `${path.relative(this.root, src)} is ${side}x${side} but project.json says ${meta.width}x${meta.height}. ` +
        (src === live
          ? `This happens when a project's starting map is updated after you'd already edited it. Move the "map" folder in projects/${id} somewhere else to start from the new starting map.`
          : "The project files don't match."),
      );
    }
    const doc: MapDoc = { meta, height: new HeightField(meta.width, meta.height, data), features };
    const bc = path.join(d, "map", "base-climate.bin.gz");
    if (existsSync(bc)) doc.baseClimate = unpackBaseClimate(new Uint8Array(await gunzipAsync(await readFile(bc))));
    return primary ? this.upgrade(doc, found) : this.upgradeInMemory(doc, found);
  }

  /** A level's own files, from an older format: migrated in memory (they are saved in the new form with the next save; levels are newer than any older format). */
  private upgradeInMemory(doc: MapDoc, found: number): MapDoc {
    const fmt = formatFor(doc.meta.kind, this.format);
    if (found < fmt) migrateMap(doc, found, fmt, this.steps);
    doc.meta.formatVersion = fmt;
    return doc;
  }

  /**
   * A map from an older format: copy its files aside first, then bring it up to date and save it. A map already in this format is
   * only marked as such in memory (merely opening a map never rewrites it).
   */
  private async upgrade(doc: MapDoc, found: number): Promise<MapDoc> {
    const fmt = formatFor(doc.meta.kind, this.format);
    if (found >= fmt) {
      doc.meta.formatVersion = fmt;
      return doc;
    }
    const kept = await this.backupFiles(doc.meta.id, `before-format-${found}`);
    this.notice(doc.meta.id, `This map was saved in an older file format (${found}) and has been brought up to date (${fmt}). The files as they were are kept in ${path.relative(this.root, kept).split(path.sep).join("/")}.`);
    migrateMap(doc, found, fmt, this.steps);
    await this.save(doc);
    return doc;
  }

  /** Copy a map's data files into backups/<label>-<time>/ and return that folder. */
  async backupFiles(id: string, label: string): Promise<string> {
    const d = this.dir(id);
    const to = path.join(d, "backups", `${safeFileName(label)}-${stamp()}`);
    await mkdir(path.join(to, "map"), { recursive: true });
    for (const rel of ["project.json", "features.json", path.join("map", "height.f32.gz"), path.join("map", "base-climate.bin.gz")]) {
      if (existsSync(path.join(d, rel))) await copyFile(path.join(d, rel), path.join(to, rel));
    }
    return to;
  }

  /**
   * The places, labels, lines and regions. A file that is there but can't be read is never overwritten (the next save would have
   * replaced it with an empty one): it is set aside under a new name, the newest checkpoint's copy is used if there is one, and the
   * person is told.
   */
  private async readFeaturesAt(d: string, id: string, primary: boolean): Promise<Features> {
    const f = path.join(d, "features.json");
    if (!existsSync(f)) return emptyFeatures();
    try {
      const v = JSON.parse(await readFile(f, "utf8")) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Features;
    } catch {
      /* unreadable: handled below */
    }
    const aside = `features.unreadable-${stamp()}.json`;
    await rename(f, path.join(d, aside));
    const newest = primary ? (await this.cpIndex(id)).filter((c) => c.features).sort((a, b) => b.time.localeCompare(a.time))[0] : undefined;
    this.notice(
      id,
      `This map's places, labels and lines file couldn't be read. It has been kept as ${aside}, and ` +
      (newest ? `the copy from the checkpoint "${newest.name}" is being used instead.` : "the map opens without them."),
    );
    return newest?.features ?? emptyFeatures();
  }

  /** Regional maps: the climate carried over from the parent map. */
  async saveBaseClimate(id: string, b: BaseClimate): Promise<void> {
    await mkdir(path.join(this.dir(id), "map"), { recursive: true });
    await atomicWrite(path.join(this.dir(id), "map", "base-climate.bin.gz"), await gzipAsync(packBaseClimate(b), { level: 6 }));
  }

  /** Write a ready-made document as a new project (used for regional maps). */
  async createFrom(doc: MapDoc, brief: string): Promise<void> {
    await mkdir(this.dir(doc.meta.id), { recursive: true });
    await this.save(doc);
    if (doc.baseClimate) await this.saveBaseClimate(doc.meta.id, doc.baseClimate);
    await writeFile(path.join(this.dir(doc.meta.id), "brief.md"), brief);
  }

  async save(doc: MapDoc): Promise<void> {
    await this.saveAt(this.dir(doc.meta.id), doc);
  }

  private async saveAt(d: string, doc: MapDoc): Promise<void> {
    // Take the snapshot before the first await: the compression below runs in the background, and an edit made meanwhile must not leak into this file.
    const meta = JSON.stringify({ ...doc.meta, formatVersion: formatFor(doc.meta.kind, this.format) }, null, 2);
    const features = JSON.stringify(doc.features ?? emptyFeatures(), null, 1);
    const bytes = Buffer.from(doc.height.data.slice().buffer);
    await mkdir(path.join(d, "map"), { recursive: true });
    await atomicWrite(path.join(d, "project.json"), meta);
    await atomicWrite(path.join(d, "features.json"), features);
    await atomicWrite(path.join(d, "map", "height.f32.gz"), await gzipAsync(bytes, { level: 6 }));
  }

  async create(o: { name: string; width: number; height: number; kmPerPx: number; seed?: number }): Promise<MapDoc> {
    const id = await this.uniqueId(o.name);
    const doc = createDoc({ id, ...o });
    await mkdir(this.dir(id), { recursive: true });
    await this.save(doc);
    if (!existsSync(path.join(this.dir(id), "brief.md"))) {
      await writeFile(path.join(this.dir(id), "brief.md"), `# ${o.name}: Design Brief\n\n*Decisions, scale, names and open questions for this map.*\n`);
    }
    return doc;
  }

  async readBrief(id: string): Promise<string> {
    const f = path.join(this.dir(id), "brief.md");
    return existsSync(f) ? readFile(f, "utf8") : "";
  }

  async writeBrief(id: string, text: string): Promise<void> {
    await atomicWrite(path.join(this.dir(id), "brief.md"), text);
  }

  async listRefs(id: string): Promise<RefInfo[]> {
    const d = path.join(this.dir(id), "refs");
    if (!existsSync(d)) return [];
    const out: RefInfo[] = [];
    for (const name of (await readdir(d)).sort((a, b) => a.localeCompare(b))) {
      if (!REFERENCE_PICTURE_EXT.test(name)) continue;
      const f = path.join(d, name);
      const s = await stat(f);
      if (!s.isFile()) continue;
      out.push({ ...this.refInfo(id, name, s.size), ...(imageSize(await readHead(f, IMAGE_HEAD_BYTES)) ?? {}) });
    }
    return out;
  }

  private refInfo(id: string, name: string, bytes: number): RefInfo {
    return { name, url: `/api/projects/${id}/refs/${encodeURIComponent(name)}`, bytes };
  }

  async readRef(id: string, name: string): Promise<Uint8Array | null> {
    const f = path.join(this.dir(id), "refs", safeFileName(name));
    return existsSync(f) ? new Uint8Array(await readFile(f)) : null;
  }

  /**
   * Keep a reference picture. It must be a PNG, JPEG or still WebP (checked from its bytes, whatever it is called): anything else is
   * refused with a message for the person (`PictureRefused`). The name is cleaned up and given the right ending, and a name that is
   * already taken gets -2, -3 and so on.
   */
  async addRef(id: string, name: string, bytes: Uint8Array): Promise<RefInfo> {
    const kind = pictureKind(bytes.subarray(0, PICTURE_HEAD_BYTES));
    const problem = referencePictureProblem(name, kind, bytes.byteLength);
    if (problem || !isReferenceKind(kind)) throw new PictureRefused(problem ?? "Not a picture.");
    const d = path.join(this.dir(id), "refs");
    await mkdir(d, { recursive: true });
    const final = freeName(d, refFileName(name, kind));
    await writeFile(path.join(d, final), bytes);
    return { ...this.refInfo(id, final, bytes.byteLength), ...(imageSize(bytes.subarray(0, IMAGE_HEAD_BYTES)) ?? {}) };
  }

  /** Give a reference picture a new name (the person's words; its ending stays what the picture is). Returns the name it now has. */
  async renameRef(id: string, name: string, to: string): Promise<string> {
    const d = path.join(this.dir(id), "refs");
    const from = safeFileName(name);
    if (!existsSync(path.join(d, from))) throw new Error(`There is no picture called ${name}.`);
    const ext = path.extname(from);
    const wanted = refFileName(to.trim().replace(/\.(png|jpe?g|webp)$/i, "") + ext, refKindOfName(from));
    if (wanted === from) return from;
    // (a change of capitals only is the same file on Windows: rename it straight away)
    if (wanted.toLowerCase() !== from.toLowerCase() && existsSync(path.join(d, wanted))) throw new Error(`There is already a picture called ${wanted}.`);
    await rename(path.join(d, from), path.join(d, wanted));
    return wanted;
  }

  /** Take a reference picture off the list: it is moved to the map's backups folder (backups/removed-pictures), not deleted. */
  async removeRef(id: string, name: string): Promise<void> {
    const from = path.join(this.dir(id), "refs", safeFileName(name));
    if (!existsSync(from)) throw new Error(`There is no picture called ${name}.`);
    const d = path.join(this.dir(id), "backups", "removed-pictures");
    await mkdir(d, { recursive: true });
    await rename(from, path.join(d, freeName(d, path.basename(from))));
  }

  async savePreview(id: string, jpeg: Uint8Array): Promise<string> {
    const d = path.join(this.dir(id), "map", "previews");
    await mkdir(d, { recursive: true });
    const name = `preview-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
    await writeFile(path.join(d, name), jpeg);
    return `/api/projects/${id}/previews/${name}`;
  }

  /** Write an export file (for a tabletop program) under the project's exports folder; returns its path. */
  async saveExport(id: string, name: string, bytes: Uint8Array): Promise<string> {
    const d = path.join(this.dir(id), "exports");
    await mkdir(d, { recursive: true });
    const file = path.join(d, safeFileName(name));
    await atomicWrite(file, bytes);
    return path.relative(path.dirname(this.root), file).split(path.sep).join("/");
  }

  filePath(id: string, kind: "refs" | "previews", name: string): string {
    const sub = kind === "refs" ? "refs" : path.join("map", "previews");
    return path.join(this.dir(id), sub, safeFileName(name));
  }

  async readJson<T>(id: string, file: string): Promise<T | null> {
    const f = path.join(this.dir(id), safeFileName(file));
    if (!existsSync(f)) return null;
    try {
      return JSON.parse(await readFile(f, "utf8")) as T;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- checkpoints
  private cpDir(id: string) {
    return path.join(this.dir(id), "map", "checkpoints");
  }

  private async cpIndex(id: string): Promise<CheckpointEntry[]> {
    const f = path.join(this.cpDir(id), "index.json");
    if (!existsSync(f)) return [];
    try {
      return JSON.parse(await readFile(f, "utf8")) as CheckpointEntry[];
    } catch {
      return [];
    }
  }

  async listCheckpoints(id: string): Promise<CheckpointInfo[]> {
    return (await this.cpIndex(id)).map(({ meta: _m, features: _f, levels: _l, ...info }) => info);
  }

  /** Run `fn` after the earlier checkpoint changes for this map have finished. */
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.cpQueue.get(id) ?? Promise.resolve()).then(fn);
    this.cpQueue.set(id, run.catch(() => {}));
    return run;
  }

  /**
   * Save the map as it is now. `auto` marks a rolling backup the program takes on its own: only those are ever deleted to make room
   * (see pruneAutoCheckpoints), never one a person saved.
   */
  async saveCheckpoint(id: string, name: string, doc: MapDoc, seq: number, note?: string, opts: { auto?: boolean; levels?: { active: { id: string; info: BattleLevel }; others: { id: string; info: BattleLevel; doc: MapDoc }[] } } = {}): Promise<CheckpointInfo> {
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("Checkpoint needs a name.");
    // the map as it is now, before any await: it goes on being edited while the file is compressed and written
    const snap = (d: MapDoc) => ({ bytes: Buffer.from(d.height.data.slice().buffer), features: clone(d.features), meta: { seaLevel: d.meta.seaLevel, style: d.meta.style, climate: clone(d.meta.climate) } });
    const main = snap(doc);
    const others = (opts.levels?.others ?? []).map((o) => ({ id: o.id, info: { ...o.info }, ...snap(o.doc) }));
    const packed = await gzipAsync(main.bytes, { level: 6 });
    const packedOthers = await Promise.all(others.map(async (o) => ({ ...o, packed: await gzipAsync(o.bytes, { level: 6 }) })));
    return this.serial(id, async () => {
      await mkdir(this.cpDir(id), { recursive: true });
      const all = await this.cpIndex(id);
      const replaced = all.filter((c) => c.name.toLowerCase() === clean.toLowerCase());
      const index = all.filter((c) => c.name.toLowerCase() !== clean.toLowerCase());
      const stampMs = Date.now();
      const file = `${slugify(clean)}-${stampMs}.f32.gz`;
      await atomicWrite(path.join(this.cpDir(id), file), packed);
      const entry: CheckpointEntry = { name: clean, file, time: new Date().toISOString(), seq, note, ...(opts.auto && { auto: true }), meta: main.meta, features: main.features };
      if (opts.levels && packedOthers.length) {
        // a battlemap with more than one level: every level's floor goes in the checkpoint (the active level's is the entry's own file)
        entry.levels = [{ id: opts.levels.active.id, file, meta: main.meta, features: main.features, info: { ...opts.levels.active.info } }];
        for (const o of packedOthers) {
          const f = `${slugify(clean)}-${stampMs}-${safeLevelId(o.id)}.f32.gz`;
          await atomicWrite(path.join(this.cpDir(id), f), o.packed);
          entry.levels.push({ id: o.id, file: f, meta: o.meta, features: o.features, info: o.info });
        }
      }
      index.push(entry);
      await atomicWrite(path.join(this.cpDir(id), "index.json"), JSON.stringify(index, null, 1));
      for (const old of replaced) for (const f of entryFiles(old)) await rm(path.join(this.cpDir(id), safeFileName(f)), { force: true }); // (a leftover file is harmless; a dangling entry would not be)
      const { meta: _m, features: _f, levels: _l, ...info } = entry;
      return info;
    });
  }

  /** Delete all but the newest `keep` automatic checkpoints. A checkpoint a person saved is never touched. */
  pruneAutoCheckpoints(id: string, keep: number): Promise<void> {
    return this.serial(id, async () => {
      const index = await this.cpIndex(id);
      const drop = index.filter((c) => c.auto).sort((a, b) => b.time.localeCompare(a.time)).slice(Math.max(0, keep));
      if (!drop.length) return;
      const gone = new Set(drop.map((c) => c.file));
      await atomicWrite(path.join(this.cpDir(id), "index.json"), JSON.stringify(index.filter((c) => !gone.has(c.file)), null, 1));
      for (const c of drop) for (const f of entryFiles(c)) await rm(path.join(this.cpDir(id), safeFileName(f)), { force: true });
    });
  }

  /** When the newest automatic checkpoint was taken (ms since 1970), or 0 if there is none. */
  async lastAutoCheckpointTime(id: string): Promise<number> {
    return (await this.cpIndex(id)).filter((c) => c.auto).reduce((t, c) => Math.max(t, Date.parse(c.time) || 0), 0);
  }

  async readCheckpoint(id: string, name: string) {
    const entry = (await this.cpIndex(id)).find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (!entry) return null;
    const read = async (file: string) => {
      const raw = await gunzipAsync(await readFile(path.join(this.cpDir(id), safeFileName(file))));
      return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    };
    const data = await read(entry.file);
    // every level of a battlemap that had more than one when the checkpoint was taken
    const levels = entry.levels ? await Promise.all(entry.levels.map(async (l) => ({ id: l.id, data: l.file === entry.file ? data : await read(l.file), meta: l.meta, features: l.features, info: l.info }))) : undefined;
    const { meta, features, levels: _l, ...info } = entry;
    return { data, meta, features, info, levels };
  }

  async readLastOpen(): Promise<string | null> {
    const f = path.join(this.root, ".last-open.json");
    try {
      const v = JSON.parse(await readFile(f, "utf8")) as { id?: string };
      return v.id && ID_RE.test(v.id) ? v.id : null;
    } catch {
      return null;
    }
  }

  async writeLastOpen(id: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await atomicWrite(path.join(this.root, ".last-open.json"), JSON.stringify({ id: safeId(id) }));
  }

  async writeJson(id: string, file: string, value: unknown): Promise<void> {
    await atomicWrite(path.join(this.dir(id), safeFileName(file)), JSON.stringify(value));
  }
}

async function atomicWrite(file: string, data: string | Uint8Array) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  // On Windows a rename over a file that something is reading at that moment (a listing of the checkpoints, a virus scanner) fails with EPERM/EBUSY/EACCES for a few milliseconds:
  // try again a few times before giving up (an automatic backup was silently lost to this in the tests).
  for (let attempt = 0; ; attempt++) {
    try { await rename(tmp, file); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
    }
  }
}
