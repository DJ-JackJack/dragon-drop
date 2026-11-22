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
/** Where deleted maps go, inside the maps folder (not a valid map id, so never listed as a map). */
export const DELETED_DIR = "Deleted maps";
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

/** Letters a name keeps in a file name: accents dropped ("Ährenfeld" is "ahrenfeld"), and the letters that have no accent to drop spelled out. */
const SPELLED: Record<string, string> = { "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };
export function plainLetters(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[ßæœøłđðþı]/g, (c) => SPELLED[c] ?? c);
}

export function slugify(name: string): string {
  return plainLetters(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "map";
}

/** Every file a checkpoint entry keeps (its own copy of the entry too: see `entryFileOf`). */
const entryFiles = (c: CheckpointEntry) => [...new Set([c.file, ...(c.levels ?? []).map((l) => l.file), entryFileOf(c.file)])];
/**
 * Each checkpoint keeps a copy of its own list entry beside its files (`<name>-<time>.entry.json`), so a damaged list (index.json) can be rebuilt with every
 * checkpoint's name, settings and places. (Checkpoints saved before 2026-11-22 have none: those are rebuilt from their file names.)
 */
const entryFileOf = (file: string) => file.replace(/\.f32\.gz$/, ".entry.json");
/** A checkpoint's land file: `<slug>-<ms>.f32.gz`, or `<slug>-<ms>-<level id>.f32.gz` for another level of the same checkpoint. */
const CHECKPOINT_FILE = /^(.+)-(\d{13})(?:-([a-z0-9][a-z0-9-]{0,31}))?\.f32\.gz$/;

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

  /**
   * Delete a map by moving its whole folder (levels, checkpoints, pictures, chat) into "Deleted maps" inside the maps folder, under its own id (or id-2, id-3... when that is
   * taken), so it can be brought back by moving the folder back. Nothing is erased. That folder's name can't be a map id, so it is never listed as a map.
   */
  async moveToDeleted(id: string): Promise<string> {
    if (!ID_RE.test(id) || !existsSync(path.join(this.dir(id), "project.json"))) throw new Error(`There is no map "${id}".`);
    const bin = path.join(this.root, DELETED_DIR);
    await mkdir(bin, { recursive: true });
    let dest = path.join(bin, id);
    for (let n = 2; existsSync(dest); n++) dest = path.join(bin, `${id}-${n}`);
    // (Windows can refuse a rename for a moment while another program, such as a virus scanner, is reading a file in it)
    for (let attempt = 0; ; attempt++) {
      try { await rename(this.dir(id), dest); return dest; } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (attempt >= 8 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
      }
    }
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
        out.push({
          id: name, name: m.name, width: m.width, height: m.height, kmPerPx: m.kmPerPx, updatedAt: m.updatedAt, ...(m.parent && { parent: m.parent }), ...((m.kind === "battle" || m.kind === "city") && { kind: m.kind }),
          ...(m.copiedFrom && { copiedFrom: m.copiedFrom }), ...(m.origin && { origin: m.origin }),
        });
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

  /** A map read only to look at (another map than the open one): an older one is brought up to date in memory only, and nothing on disk is touched. */
  async peek(id: string, level?: string): Promise<MapDoc> {
    if (!(await this.exists(id))) throw new Error(`There is no map "${id}".`);
    // a battlemap's level (id or name): read from levels.json without setting anything aside (looking never writes); a level it doesn't have reads as its first
    const lf = path.join(this.dir(id), "levels.json");
    if (level && existsSync(lf)) {
      let levels: LevelsFile | null = null;
      try { levels = cleanLevels(JSON.parse(await readFile(lf, "utf8"))); } catch { /* unreadable: the first level */ }
      const l = levels?.levels.find((x) => x.id === level) ?? levels?.levels.find((x) => x.name.toLowerCase() === level.toLowerCase());
      if (levels && l && l.id !== levels.levels[0].id) return this.loadLevel(id, levels, l.id);
    }
    return this.loadAt(this.dir(id), id, false);
  }

  /** Every map's project.json (for how maps are linked: mapLinks.ts). Unreadable ones are left out. */
  async metas(): Promise<MapMeta[]> {
    if (!existsSync(this.root)) return [];
    const out: MapMeta[] = [];
    for (const name of await readdir(this.root)) {
      if (!ID_RE.test(name)) continue;
      try { out.push({ ...(JSON.parse(await readFile(path.join(this.root, name, "project.json"), "utf8")) as MapMeta), id: name }); } catch { /* not a map, or unreadable */ }
    }
    return out;
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
    // (a file that can't be read just now, such as an offline cloud file, stops the opening and is left alone: only one that reads but makes no sense is set aside)
    const text = await readFile(f, "utf8");
    try {
      const ok = cleanLevels(JSON.parse(text));
      if (ok) return ok;
    } catch {
      /* not valid: handled below */
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
    const doc = await this.loadAt(this.levelDir(id, levels, levelId), id, false);
    // the map's name and links are its own (the first level's): a level's files can hold older ones (a copy of the map, a renamed map)
    const own = JSON.parse(await readFile(path.join(this.dir(id), "project.json"), "utf8")) as MapMeta;
    doc.meta = { ...doc.meta, name: own.name, copiedFrom: own.copiedFrom, origin: own.origin, parent: own.parent };
    return doc;
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
    // A file that can't be read just now (an offline OneDrive file, one held by another program) stops the opening with its error and is left as it is:
    // setting it aside would open the map without its places, and the next save would write that. Only a file that reads but isn't valid is set aside.
    const text = await readFile(f, "utf8");
    try {
      const v = JSON.parse(text) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Features;
    } catch {
      /* not valid: handled below */
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

  /**
   * Copy a map under a new name, to change the copy (the same place before and after): every file of it (land or floors, every level, features, the brief, reference
   * pictures) but its checkpoints, chat, previews, exports and backups, which belong to the original's history. `meta` is merged into the copy's project.json (its name and
   * where it was copied from). Returns the new map's id.
   */
  async duplicate(fromId: string, name: string, meta: Partial<MapMeta>, briefNote: string): Promise<string> {
    if (!(await this.exists(fromId))) throw new Error(`There is no map "${fromId}".`);
    const id = await this.uniqueId(name);
    const src = this.dir(fromId), dst = this.dir(id);
    const skip = new Set(["backups", "exports", "chat.json", "map/checkpoints", "map/previews"]);
    const copyTree = async (rel: string): Promise<void> => {
      const from = path.join(src, rel), to = path.join(dst, rel);
      await mkdir(to, { recursive: true });
      for (const e of await readdir(from, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (skip.has(r) || e.name.endsWith(".tmp") || /\.tmp-\d+(-\d+)?$/.test(e.name)) continue;
        if (e.isDirectory()) await copyTree(r);
        else if (e.isFile()) await copyFile(path.join(from, e.name), path.join(to, e.name));
      }
    };
    try {
      await copyTree("");
      const pj = path.join(dst, "project.json");
      const now = new Date().toISOString();
      const m = JSON.parse(await readFile(pj, "utf8")) as MapMeta;
      await atomicWrite(pj, JSON.stringify({ ...m, ...meta, id, name, createdAt: now, updatedAt: now }, null, 2));
      const bf = path.join(dst, "brief.md");
      const brief = existsSync(bf) ? await readFile(bf, "utf8") : `# ${name}: Design Brief\n`;
      await writeFile(bf, `${brief.replace(/\s*$/, "")}\n\n${briefNote}\n`);
    } catch (e) {
      await rm(dst, { recursive: true, force: true }).catch(() => {}); // (no half copy is left behind)
      throw e;
    }
    return id;
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
    const problem = referencePictureProblem(name, kind, bytes.byteLength, imageSize(bytes));
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

  /**
   * The list of checkpoints. A list that is damaged (or missing while checkpoint files are there) is never taken as empty: the next checkpoint would write a
   * list with only itself, and every earlier one would drop off it. It is set aside and the list is rebuilt from the checkpoints' own files. A list that
   * can't be read just now (held by another program) is an error, not an empty list.
   */
  private async cpIndex(id: string): Promise<CheckpointEntry[]> {
    const dir = this.cpDir(id);
    const f = path.join(dir, "index.json");
    if (existsSync(f)) {
      const text = await readFile(f, "utf8");
      try {
        const v = JSON.parse(text) as unknown;
        if (Array.isArray(v) && v.every((c) => c && typeof c === "object" && typeof c.name === "string" && typeof c.file === "string")) return v as CheckpointEntry[];
      } catch { /* damaged: rebuilt below */ }
      const aside = `index.unreadable-${stamp()}.json`;
      try { await rename(f, path.join(dir, aside)); } catch { /* another reader set it aside first */ }
      const rebuilt = await this.rebuildCpIndex(id);
      this.notice(id, `This map's list of checkpoints was damaged. It has been kept as map/checkpoints/${aside}, and the list was made again from the checkpoints themselves (${rebuilt.length} found).`);
      // written after whatever checkpoint change is running now (which writes a whole list itself)
      void this.serial(id, async () => { if (!existsSync(f)) await atomicWrite(f, JSON.stringify(await this.rebuildCpIndex(id), null, 1)); }).catch(() => {});
      return rebuilt;
    }
    if (!existsSync(dir)) return [];
    // no list, but checkpoints: an earlier list was lost (the first checkpoint's list is written after its files)
    return (await readdir(dir)).some((n) => CHECKPOINT_FILE.test(n)) ? this.rebuildCpIndex(id) : [];
  }

  /** The checkpoint list made again from what is in the folder: each checkpoint's own copy of its entry, or (older ones) its file names. */
  private async rebuildCpIndex(id: string): Promise<CheckpointEntry[]> {
    const dir = this.cpDir(id);
    const names = await readdir(dir);
    const out: CheckpointEntry[] = [];
    const covered = new Set<string>();
    for (const n of names.filter((x) => x.endsWith(".entry.json"))) {
      try {
        const e = JSON.parse(await readFile(path.join(dir, n), "utf8")) as CheckpointEntry;
        if (typeof e?.name !== "string" || typeof e.file !== "string" || !existsSync(path.join(dir, safeFileName(e.file)))) continue;
        out.push(e);
        for (const file of entryFiles(e)) covered.add(file);
      } catch { /* a damaged copy: its files are picked up by name below */ }
    }
    // older checkpoints (no copy of their entry): one per land file, named from the file; another level's file joins its checkpoint when the level is known
    const groups = new Map<string, { slug: string; ms: number; main?: string; levels: { id: string; file: string }[] }>();
    for (const n of names) {
      const m = CHECKPOINT_FILE.exec(n);
      if (!m || covered.has(n)) continue;
      const key = `${m[1]}-${m[2]}`;
      const g = groups.get(key) ?? { slug: m[1], ms: Number(m[2]), levels: [] };
      if (m[3]) g.levels.push({ id: m[3], file: n }); else g.main = n;
      groups.set(key, g);
    }
    const taken = new Set(out.map((c) => c.name.toLowerCase()));
    for (const g of groups.values()) {
      if (!g.main) continue;
      let name = `${g.slug.replace(/-/g, " ")} (recovered)`.slice(0, 60);
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${g.slug.replace(/-/g, " ")} (recovered ${i})`.slice(0, 60);
      taken.add(name.toLowerCase());
      const entry: CheckpointEntry = { name, file: g.main, time: new Date(g.ms).toISOString(), seq: 0, note: "Recovered from its file after the checkpoint list was damaged: its places and settings weren't kept.", meta: {} };
      // (which level the main file was isn't written in its name, so only the other levels come back with it)
      if (g.levels.length) entry.levels = g.levels.map((l) => ({ id: l.id, file: l.file, meta: {} }));
      out.push(entry);
    }
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  async listCheckpoints(id: string): Promise<CheckpointInfo[]> {
    try {
      return (await this.cpIndex(id)).map(({ meta: _m, features: _f, levels: _l, ...info }) => info);
    } catch (e) {
      console.error(`[${id}] The checkpoint list couldn't be read just now:`, (e as Error).message); // (only shown: nothing is written from this)
      return [];
    }
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
      // its own copy of the entry, beside its files: a damaged list can be made again from these (cpIndex)
      await atomicWrite(path.join(this.cpDir(id), entryFileOf(file)), JSON.stringify(entry));
      index.push(entry);
      await atomicWrite(path.join(this.cpDir(id), "index.json"), JSON.stringify(index, null, 1));
      const mine = new Set(entryFiles(entry));
      for (const old of replaced) for (const f of entryFiles(old)) if (!mine.has(f)) await rm(path.join(this.cpDir(id), safeFileName(f)), { force: true }); // (a leftover file is harmless; a dangling entry would not be)
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
    try {
      return (await this.cpIndex(id)).filter((c) => c.auto).reduce((t, c) => Math.max(t, Date.parse(c.time) || 0), 0);
    } catch {
      return 0; // (can't be read just now: the next backup tries again, and says so if it fails)
    }
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

/**
 * How long to wait between tries when a file can't be replaced because another program holds it: a listing of the checkpoints for a few milliseconds, a
 * virus scanner or OneDrive (syncing Documents) for seconds while it reads a big map. About 10 s in all; the waits don't hold up anything else.
 */
export const REPLACE_WAITS_MS = [15, 30, 60, 120, 250, 500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
let tmpCount = 0;

export async function atomicWrite(file: string, data: string | Uint8Array) {
  const tmp = `${file}.tmp-${process.pid}-${++tmpCount}`; // (its own name, so two writes of one file never share a temporary file)
  // on the disk before the rename: otherwise a power cut just after it can leave an empty file where the map's was (the rename can reach the disk first)
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(data);
    // (best effort: a drive that can't flush, such as some network or cloud drives, still saves, as it did before)
    await fh.sync().catch(() => {});
  } catch (e) {
    await fh.close().catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  await fh.close();
  // On Windows a rename over a file that another program has open fails with EPERM/EBUSY/EACCES until it lets go: try again for a while (an automatic
  // backup was lost to a short hold in the tests; OneDrive and virus scanners hold a big map for seconds), and leave no temporary file behind
  for (let attempt = 0; ; attempt++) {
    try { await rename(tmp, file); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= REPLACE_WAITS_MS.length || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        await rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
      await new Promise((r) => setTimeout(r, REPLACE_WAITS_MS[attempt]));
    }
  }
}
