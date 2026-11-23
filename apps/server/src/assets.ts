/**
 * The user's asset library, read in place (never copied): a catalog of the pictures in a folder, with search, file access,
 * thumbnails and decoded textures/sprites for renders. The library folder can hold any mix of
 *   - folders of pictures (PNG, JPEG or WebP, in any layout; the name of a folder like "Floors" or "Props" says what is in it),
 *   - .zip files of pictures,
 *   - pack files made by other map tools (Godot-style archives, found by name ending in "_pack" or ".pck" and checked by their first bytes).
 * Each folder, zip or pack file is one "pack". A pack can describe itself (packs/<id>.json or pack.json) and list tags (tags.json).
 *
 * Packs whose author has said they may not be used in other mapping programs
 * (`allow_3rd_party_mapping_software: false` in the pack's own info) are listed but never served or drawn.
 */
import { createHash } from "node:crypto";
import { type FileHandle, mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AssetCategory, type AssetItem, type RandomAccess, type RGBAImage, type ShrinkJob, type ShrunkPicture, shrinkPicture, type RoofAsset, type SpriteData, type TileData, ASSET_CATEGORIES, IMAGE_EXT, IMAGE_HEAD_BYTES, PACK_FILE_NAME, ZIP_FILE_NAME, assetId, assetLabel, boxResize,
  categoryOf, defaultTileSquares, imageSize, kindOfPackName, pictureKindHint, parseAssetId, readPck, readPckFile, roofLookOfAsset,
} from "@mapmaker/core";
import { decodeImage } from "@mapmaker/tools";
import { PNG } from "pngjs";
import { type ZipEntry, readZipFile, readZipHead, readZipIndex } from "./zip.ts";

export type PackKind = "pck" | "zip" | "folder";

export interface PackInfo {
  key: string;
  name: string;
  /** The pack file, the zip file or the folder. */
  file: string;
  kind: PackKind;
  bytes: number;
  mtimeMs: number;
  /** Pack files only. */
  formatVersion: number;
  engine: string;
  packId?: string;
  version?: string;
  author?: string;
  /** The author doesn't allow use outside the program the pack was made for: listed, never served or drawn. */
  restricted: boolean;
  /** A newer copy of the same pack is used instead. */
  supersededBy?: string;
  files: number;
  categories: Record<string, number>;
  error?: string;
}

/** One file in a pack. `offset` is where its bytes start (pack file) or where its zip header starts; a folder pack's files are found by their path. */
interface Entry {
  path: string;
  offset: number;
  size: number;
  encrypted?: boolean;
  /** what kind of asset it is (core's categoryOf), worked out once when the pack is read */
  cat?: AssetCategory;
  /** zip files */
  csize?: number;
  method?: number;
}

interface PackIndex {
  info: PackInfo;
  entries: Entry[];
  byPath: Map<string, Entry>;
  tags: Map<string, string[]>;
  packJson?: Record<string, unknown>;
}

interface Source { kind: PackKind; file: string; /** A folder pack made of only the pictures directly in the folder. */ shallow?: boolean }

interface CachedIndex {
  v: 1;
  size: number;
  mtimeMs: number;
  formatVersion: number;
  engine: string;
  entries: [string, number, number][];
}

const catOf = (e: Entry): AssetCategory => e.cat ?? (e.cat = categoryOf(e.path));
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const MAX_DECODE_PIXELS = 40_000_000;
/** At most this many pictures without names are looked at after one scan (the rest after the next: what was found is remembered). */
const MAX_LOOKS = 50_000;
/** Raise when core pictureKindHint judges differently, so every picture is looked at again. */
const PICTURE_KINDS_VERSION = 1;
const MAX_FOLDER_DEPTH = 12;

/**
 * Does a pack's own info say it may not be used by other mapping programs? `false`, but also the other ways an author writes no ("false", "no", 0):
 * a pack whose author said no must never be served or drawn, so any no counts.
 */
/** A path with the person's home folder written as ~ (it holds their Windows user name). */
export function shortHome(p: string, home = os.homedir()): string {
  return home && p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length)}` : p;
}

export function forbidsUse(v: unknown): boolean {
  return v === false || v === 0 || (typeof v === "string" && /^\s*(false|no|0|off)\s*$/i.test(v));
}
const MAX_FOLDER_FILES = 400_000;
const MAX_FOLDERS = 50_000;

const isZip = (name: string) => ZIP_FILE_NAME.test(name);
const isPackFileName = (name: string) => PACK_FILE_NAME.test(name);
const skipDir = (name: string) => name.startsWith(".") || name.startsWith("$") || name === "node_modules" || name === "System Volume Information" || name === "__MACOSX";
/** Files in a pack that describe it. */
const INFO_FILE = /^(packs\/[^/]+\.json|pack\.json)$/i;
const TAG_FILE = /^(data\/[^/]+\.[a-z0-9]+_tags|tags\.json)$/i;
const packDisplayName = (file: string) => path.basename(file).replace(/\.(zip|pck|[a-z0-9]+_pack)$/i, "");
const withoutBom = (s: string) => s.replace(/^﻿/, "");

/** Numeric-aware version comparison ("3.59-005" > "3.58-002"). */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const pa = (a ?? "").match(/\d+/g)?.map(Number) ?? [];
  const pb = (b ?? "").match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function fileAccess(fh: FileHandle, size: number): RandomAccess {
  return {
    size,
    async read(offset, length) {
      const buf = Buffer.allocUnsafe(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await fh.read(buf, got, length - got, offset + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, got);
    },
  };
}

/** How to get at a pack's files, whatever kind it is. */
interface PackSource {
  file(e: Entry): Promise<Uint8Array>;
  head(e: Entry, n: number): Promise<Uint8Array>;
}

function sourceFor(kind: PackKind, file: string, ra: RandomAccess | null): PackSource {
  if (kind === "folder") {
    return {
      file: async (e) => new Uint8Array(await readFile(path.join(file, e.path))),
      async head(e, n) {
        const fh = await open(path.join(file, e.path), "r");
        try { return await fileAccess(fh, Math.min(n, e.size || n)).read(0, Math.min(n, e.size || n)); } finally { await fh.close(); }
      },
    };
  }
  if (kind === "zip") return { file: (e) => readZipFile(ra!, e as ZipEntry), head: (e, n) => readZipHead(ra!, e as ZipEntry, n) };
  return {
    file: (e) => readPckFile(ra!, e),
    head: (e, n) => ra!.read(e.offset, Math.min(n, e.size)),
  };
}

export class AssetLibrary {
  private packs = new Map<string, PackIndex>();
  /** Open pack files (the promise, so two requests for the same file at once share one handle instead of leaking one). */
  private handles = new Map<string, Promise<FileHandle>>();
  private decoded = new Map<string, { value: unknown; bytes: number }>();
  private decodedBytes = 0;
  scanning = false;
  scanned = 0;
  total = 0;
  errors: { file: string; message: string }[] = [];
  lastScan: string | null = null;
  /** The pictures whose names say nothing, being looked at after a scan (lookAtNameless). */
  looking = { done: 0, total: 0 };
  /** Settles when that looking is done (tests wait on it). */
  looked: Promise<void> = Promise.resolve();
  private lookGen = 0;

  constructor(readonly dir: string, readonly cacheDir: string) {}

  // ---------------------------------------------------------------- scanning
  private async findSources(): Promise<Source[]> {
    const out: Source[] = [];
    // zip files and pack files, in the folder and a couple of levels down
    const visit = async (d: string, depth: number) => {
      let names;
      try { names = await readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of names) {
        const f = path.join(d, e.name);
        if (e.isFile() && isZip(e.name)) out.push({ kind: "zip", file: f });
        else if (e.isFile() && isPackFileName(e.name)) out.push({ kind: "pck", file: f });
        else if (e.isDirectory() && depth < 2 && !skipDir(e.name)) await visit(f, depth + 1);
      }
    };
    await visit(this.dir, 0);
    // loose pictures: each folder directly inside the library is a pack (with whatever is below it), and so are pictures lying in the library folder itself
    const top = await readdir(this.dir, { withFileTypes: true }).catch(() => []);
    if (top.some((e) => e.isFile() && IMAGE_EXT.test(e.name))) out.push({ kind: "folder", file: this.dir, shallow: true });
    for (const e of top) if (e.isDirectory() && !skipDir(e.name)) out.push({ kind: "folder", file: path.join(this.dir, e.name) });
    return out.sort((a, b) => a.file.localeCompare(b.file));
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.errors = [];
    this.scanned = 0;
    try {
      const sources = await this.findSources();
      this.total = sources.length;
      const found: PackIndex[] = [];
      let next = 0;
      const worker = async () => {
        while (next < sources.length) {
          const s = sources[next++];
          try {
            const p = s.kind === "folder" ? await this.indexFolder(s.file, !!s.shallow) : s.kind === "zip" ? await this.indexZip(s.file) : await this.indexPack(s.file);
            if (p) found.push(p);
          } catch (e) { this.errors.push({ file: s.file, message: (e as Error).message }); }
          this.scanned++;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      this.install(found);
      this.lastScan = new Date().toISOString();
      this.looked = this.lookAtNameless(++this.lookGen).catch((e) => console.error("Looking at the asset pictures without names stopped:", (e as Error).message));
    } finally {
      this.scanning = false;
    }
  }

  /** Give each pack a unique key; when two copies of the same pack exist, the newer one wins. */
  private install(found: PackIndex[]) {
    this.packs.clear();
    for (const h of this.handles.values()) void h.then((fh) => fh.close()).catch(() => {});
    this.handles.clear();
    this.decoded.clear();
    this.decodedBytes = 0;
    const byKey = new Map<string, PackIndex[]>();
    for (const p of found) {
      const k = slug(p.info.name) || slug(packDisplayName(p.info.file)) || "pack";
      byKey.set(k, [...(byKey.get(k) ?? []), p]);
    }
    const samePack = (a: PackIndex, b: PackIndex) =>
      (!!a.info.packId && a.info.packId === b.info.packId) || (!a.info.packId && !b.info.packId && a.info.name === b.info.name && a.info.kind === b.info.kind);
    let old = 0;
    for (const [k, group] of byKey) {
      group.sort((a, b) => compareVersions(b.info.version, a.info.version) || b.info.mtimeMs - a.info.mtimeMs); // newest first
      const winners: PackIndex[] = [];
      for (const p of group) {
        const twin = winners.find((w) => samePack(w, p));
        if (twin) {
          p.info.supersededBy = path.basename(twin.info.file);
          p.info.key = `${k}~old${++old}`;
          this.packs.set(p.info.key, p);
        } else winners.push(p);
      }
      winners.forEach((w, i) => { w.info.key = i === 0 ? k : `${k}-${i + 1}`; this.packs.set(w.info.key, w); });
    }
  }

  private cacheFile(file: string) {
    return path.join(this.cacheDir, "assets-index", `${createHash("sha1").update(file).digest("hex")}.json`);
  }

  /** The pack's description and tag lists, read from the files that carry them (best effort: the exact layout varies between packs). */
  private async readDescription(entries: Entry[], src: PackSource): Promise<{ packJson?: Record<string, unknown>; tags: Map<string, string[]> }> {
    let packJson: Record<string, unknown> | undefined;
    const infoEntry = entries.find((e) => INFO_FILE.test(e.path));
    if (infoEntry && infoEntry.size < 2_000_000) {
      try { packJson = JSON.parse(withoutBom(new TextDecoder().decode(await src.file(infoEntry)))); } catch { /* unreadable: use the file name */ }
    }
    const tags = new Map<string, string[]>();
    const tagEntry = entries.find((e) => TAG_FILE.test(e.path));
    if (tagEntry && tagEntry.size < 8_000_000) {
      try {
        const j = JSON.parse(withoutBom(new TextDecoder().decode(await src.file(tagEntry)))) as { tags?: Record<string, unknown> };
        for (const [tag, list] of Object.entries(j.tags ?? {})) {
          if (!Array.isArray(list)) continue;
          for (const p of list) if (typeof p === "string") {
            const k = p.replace(/^res:\/\//, "").toLowerCase();
            tags.set(k, [...(tags.get(k) ?? []), tag]);
          }
        }
      } catch { /* ignore */ }
    }
    return { packJson, tags };
  }

  private build(kind: PackKind, file: string, name: string, st: { size: number; mtimeMs: number }, entries: Entry[], extra: { formatVersion: number; engine: string }, d: { packJson?: Record<string, unknown>; tags: Map<string, string[]> }): PackIndex {
    const categories: Record<string, number> = {};
    // (a picture whose path says nothing takes what the pack's own name says: a folder called "Floor Textures" with a1.png, a2.png inside)
    const fromName = kindOfPackName(name);
    for (const e of entries) { let c = (e.cat = categoryOf(e.path)); if (c === "other" && fromName) c = e.cat = fromName; categories[c] = (categories[c] ?? 0) + 1; }
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : v != null && typeof v !== "object" ? String(v) : undefined);
    const info: PackInfo = {
      key: "", name: str(d.packJson?.name) ?? name, file, kind, bytes: st.size, mtimeMs: st.mtimeMs, formatVersion: extra.formatVersion, engine: extra.engine,
      packId: str(d.packJson?.id), version: str(d.packJson?.version), author: str(d.packJson?.author),
      restricted: forbidsUse(d.packJson?.allow_3rd_party_mapping_software),
      files: entries.length, categories,
    };
    return { info, entries, byPath: new Map(entries.map((e) => [e.path.toLowerCase(), e])), tags: d.tags, packJson: d.packJson };
  }

  /** A pack file made by another map tool. */
  private async indexPack(file: string): Promise<PackIndex> {
    const st = await stat(file);
    let cached: CachedIndex | null = null;
    try {
      const c = JSON.parse(await readFile(this.cacheFile(file), "utf8")) as CachedIndex;
      if (c.v === 1 && c.size === st.size && c.mtimeMs === st.mtimeMs) cached = c;
    } catch { /* no cache yet */ }
    const fh = await open(file, "r");
    try {
      const ra = fileAccess(fh, st.size);
      let formatVersion: number, engine: string, entries: Entry[];
      if (cached) {
        ({ formatVersion, engine } = cached);
        entries = cached.entries.map(([p, o, s]) => ({ path: p, offset: o, size: s }));
      } else {
        const info = await readPck(ra);
        formatVersion = info.formatVersion; engine = info.engine; entries = info.entries;
        await mkdir(path.dirname(this.cacheFile(file)), { recursive: true });
        const c: CachedIndex = { v: 1, size: st.size, mtimeMs: st.mtimeMs, formatVersion, engine, entries: entries.map((e) => [e.path, e.offset, e.size]) };
        await writeFile(this.cacheFile(file), JSON.stringify(c)).catch(() => {});
      }
      return this.build("pck", file, packDisplayName(file), st, entries, { formatVersion, engine }, await this.readDescription(entries, sourceFor("pck", file, ra)));
    } finally {
      await fh.close();
    }
  }

  /** A .zip file of pictures. */
  private async indexZip(file: string): Promise<PackIndex> {
    const st = await stat(file);
    const fh = await open(file, "r");
    try {
      const ra = fileAccess(fh, st.size);
      const entries = await readZipIndex(ra);
      if (!entries.some((e) => IMAGE_EXT.test(e.path))) throw new Error("There are no PNG, JPEG or WebP pictures in this zip file.");
      return this.build("zip", file, packDisplayName(file), st, entries, { formatVersion: 0, engine: "" }, await this.readDescription(entries, sourceFor("zip", file, ra)));
    } finally {
      await fh.close();
    }
  }

  /** A folder of pictures (and everything below it), or null if there are none. */
  private async indexFolder(root: string, shallow: boolean): Promise<PackIndex | null> {
    const entries: Entry[] = [];
    let bytes = 0, folders = 0;
    const visit = async (rel: string, depth: number) => {
      if (entries.length >= MAX_FOLDER_FILES || ++folders > MAX_FOLDERS) return;
      let names;
      try { names = await readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
      const files = names.filter((e) => e.isFile()).map((e) => ({ name: e.name, rel: rel ? `${rel}/${e.name}` : e.name }))
        .filter((f) => IMAGE_EXT.test(f.name) || INFO_FILE.test(f.rel) || TAG_FILE.test(f.rel));
      for (let i = 0; i < files.length; i += 64) {
        await Promise.all(files.slice(i, i + 64).map(async (f) => {
          try {
            const s = await stat(path.join(root, f.rel));
            entries.push({ path: f.rel, offset: 0, size: s.size });
            if (IMAGE_EXT.test(f.name)) bytes += s.size;
          } catch { /* vanished while scanning */ }
        }));
      }
      if (shallow || depth >= MAX_FOLDER_DEPTH) return;
      for (const e of names) if (e.isDirectory() && !skipDir(e.name)) await visit(rel ? `${rel}/${e.name}` : e.name, depth + 1);
    };
    await visit("", 0);
    if (!entries.some((e) => IMAGE_EXT.test(e.path))) return null;
    entries.sort((a, b) => a.path.localeCompare(b.path));
    const st = await stat(root);
    return this.build("folder", root, path.basename(root) || "Assets", { size: bytes, mtimeMs: st.mtimeMs }, entries, { formatVersion: 0, engine: "" }, await this.readDescription(entries, sourceFor("folder", root, null)));
  }

  // ---------------------------------------------------------------- pictures whose names say nothing
  /**
   * After a scan, the pictures whose names say nothing (core categoryOf found no kind: "other") are looked at one at a time on the worker thread
   * (`pictures.kind`, core pictureKindHint): an empty border makes an object, a picture made to repeat a floor texture. What was found is remembered in the
   * cache folder (picture-kinds.json, by pack file, path and size), so each picture is looked at once, not at every start. A new scan stops it.
   */
  private async lookAtNameless(gen: number): Promise<void> {
    const todo: { pack: PackIndex; e: Entry }[] = [];
    for (const p of this.packs.values()) if (!p.info.restricted) for (const e of p.entries) if (catOf(e) === "other" && !e.encrypted) todo.push({ pack: p, e });
    const batch = todo.slice(0, MAX_LOOKS);
    this.looking = { done: 0, total: batch.length };
    if (!batch.length) return;
    const memo = await this.readPictureKinds();
    let fresh = 0;
    for (const { pack, e } of batch) {
      if (gen !== this.lookGen) return;
      const key = `${pack.info.file}|${e.path}|${e.size}`;
      let kind = memo.get(key);
      if (kind === undefined) {
        kind = (await this.lookAt(pack, e)) ?? "";
        memo.set(key, kind);
        if (++fresh % 200 === 0) await this.writePictureKinds(memo);
      }
      if (gen !== this.lookGen) return;
      if (kind === "terrain" || kind === "objects") {
        pack.info.categories.other = Math.max(0, (pack.info.categories.other ?? 0) - 1);
        pack.info.categories[kind] = (pack.info.categories[kind] ?? 0) + 1;
        e.cat = kind;
      }
      this.looking.done++;
    }
    if (fresh) await this.writePictureKinds(memo);
  }

  private async lookAt(pack: PackIndex, e: Entry): Promise<"terrain" | "objects" | null> {
    try {
      const s = await this.sizeOf(pack, e);
      if (s && s.w * s.h > MAX_DECODE_PIXELS) return null;
      const bytes = await this.bytesOf(pack, e);
      if (this.pictures) return await this.pictures.kind(bytes);
      const img = decodeImage(bytes);
      return img ? pictureKindHint(img) : null;
    } catch {
      return null; // (unreadable: the same as saying nothing)
    }
  }

  private pictureKindsFile() { return path.join(this.cacheDir, "picture-kinds.json"); }

  private async readPictureKinds(): Promise<Map<string, string>> {
    try {
      const j = JSON.parse(await readFile(this.pictureKindsFile(), "utf8")) as { v?: number; kinds?: Record<string, string> };
      if (j.v === PICTURE_KINDS_VERSION && j.kinds && typeof j.kinds === "object") return new Map(Object.entries(j.kinds));
    } catch { /* none yet, or unreadable: looked at again */ }
    return new Map();
  }

  private async writePictureKinds(memo: Map<string, string>): Promise<void> {
    const f = this.pictureKindsFile(), tmp = `${f}.${process.pid}.tmp`;
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(tmp, JSON.stringify({ v: PICTURE_KINDS_VERSION, kinds: Object.fromEntries(memo) }));
      await rename(tmp, f);
    } catch { /* only a cache: looked at again next time */ }
  }

  // ---------------------------------------------------------------- catalog
  status() {
    const usable = this.usablePacks();
    return {
      dir: this.dir, scanning: this.scanning, scanned: this.scanned, total: this.total, packs: this.packs.size,
      usablePacks: usable.length, files: usable.reduce((n, p) => n + p.info.files, 0),
      restricted: [...this.packs.values()].filter((p) => p.info.restricted).length, errors: this.errors, lastScan: this.lastScan,
      ...(this.looking.done < this.looking.total && { looking: { ...this.looking } }),
    };
  }

  private usablePacks(): PackIndex[] {
    return [...this.packs.values()].filter((p) => !p.info.restricted && !p.info.supersededBy);
  }

  packList(): PackInfo[] {
    return [...this.packs.values()].map((p) => p.info).sort((a, b) => a.name.localeCompare(b.name));
  }

  list(o: { pack?: string; cat?: string; q?: string; offset?: number; limit?: number }): { total: number; items: AssetItem[] } {
    const tokens = (o.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const packs = o.pack ? this.usablePacks().filter((p) => p.info.key === o.pack) : this.usablePacks();
    const matches: { p: PackIndex; e: Entry; cat: AssetCategory }[] = [];
    for (const p of packs) {
      for (const e of p.entries) {
        const cat = catOf(e);
        if (cat === "data" || (o.cat && cat !== o.cat)) continue;
        if (tokens.length) {
          const hay = `${e.path} ${p.info.name} ${(p.tags.get(e.path.toLowerCase()) ?? []).join(" ")}`.toLowerCase();
          if (!tokens.every((t) => hay.includes(t))) continue;
        }
        matches.push({ p, e, cat });
      }
    }
    matches.sort((a, b) => a.e.path.localeCompare(b.e.path, undefined, { numeric: true }) || a.p.info.name.localeCompare(b.p.info.name));
    const offset = Math.max(0, o.offset ?? 0), limit = Math.min(200, Math.max(1, o.limit ?? 60));
    const items: AssetItem[] = matches.slice(offset, offset + limit).map(({ p, e, cat }) => ({
      id: assetId(p.info.key, e.path), pack: p.info.key, packName: p.info.name, path: e.path, name: assetLabel(e.path), cat,
      ...(p.tags.get(e.path.toLowerCase()) && { tags: p.tags.get(e.path.toLowerCase()) }),
    }));
    return { total: matches.length, items };
  }

  private roofCache: { scan: string | null; items: RoofAsset[] } | null = null;

  /**
   * Every roof texture of the usable packs, in one pass over the library (kept until the next scan): pictures meant to be tiled across a roof, of a setting that fits an old-world
   * city (core's roofAssets.ts says which pictures count). City buildings are drawn from these in preference to drawing a roof.
   */
  roofTextures(): RoofAsset[] {
    if (this.roofCache && this.roofCache.scan === this.lastScan && !this.scanning) return this.roofCache.items;
    const items: RoofAsset[] = [];
    for (const p of this.usablePacks()) {
      for (const e of p.entries) {
        if (!/roof/i.test(e.path)) continue;
        const cat = catOf(e);
        if (cat === "data") continue;
        const it: RoofAsset = { id: assetId(p.info.key, e.path), pack: p.info.key, packName: p.info.name, path: e.path, name: assetLabel(e.path), cat };
        if (roofLookOfAsset(it)) items.push(it);
      }
    }
    this.roofCache = { scan: this.lastScan, items };
    return items;
  }

  /** One asset by id (with its pixel size), or null if it doesn't exist or its pack is restricted. */
  async info(id: string): Promise<AssetItem | null> {
    const a = parseAssetId(id);
    const pack = a && this.packs.get(a.pack);
    if (!a || !pack || pack.info.restricted) return null;
    const entry = pack.byPath.get(a.path.toLowerCase());
    if (!entry) return null;
    const tags = pack.tags.get(entry.path.toLowerCase());
    const item: AssetItem = { id: assetId(pack.info.key, entry.path), pack: pack.info.key, packName: pack.info.name, path: entry.path, name: assetLabel(entry.path), cat: catOf(entry), ...(tags && { tags }) };
    return (await this.withSizes([item]))[0];
  }

  /** Fill in pixel sizes for a page of results (a few KB from each file). */
  async withSizes(items: AssetItem[]): Promise<AssetItem[]> {
    return Promise.all(items.map(async (it) => {
      const r = await this.locate(it.id).catch(() => null);
      if (!r) return it;
      const s = await this.sizeOf(r.pack, r.entry);
      return s ? { ...it, w: s.w, h: s.h } : it;
    }));
  }

  // ---------------------------------------------------------------- files
  private async handle(file: string): Promise<{ fh: FileHandle; size: number }> {
    const size = (await stat(file)).size;
    let open_ = this.handles.get(file);
    if (!open_) {
      if (this.handles.size >= 12) { const first = this.handles.keys().next().value as string; const old = this.handles.get(first)!; this.handles.delete(first); void old.then((fh) => fh.close()).catch(() => {}); }
      open_ = open(file, "r");
      this.handles.set(file, open_);
      open_.catch(() => { if (this.handles.get(file) === open_) this.handles.delete(file); });
    }
    return { fh: await open_, size };
  }

  /** The way into a pack's files (an open file for archives, the folder itself for a folder pack). */
  private async source(pack: PackIndex): Promise<PackSource> {
    if (pack.info.kind === "folder") return sourceFor("folder", pack.info.file, null);
    const { fh, size } = await this.handle(pack.info.file);
    return sourceFor(pack.info.kind, pack.info.file, fileAccess(fh, size));
  }

  private async locate(id: string): Promise<{ pack: PackIndex; entry: Entry } | null> {
    const a = parseAssetId(id);
    if (!a) return null;
    const pack = this.packs.get(a.pack);
    if (!pack || pack.info.restricted) return null;
    const entry = pack.byPath.get(a.path.toLowerCase());
    if (!entry || entry.encrypted) return null;
    return { pack, entry };
  }

  private async bytesOf(pack: PackIndex, entry: Entry): Promise<Uint8Array> {
    return (await this.source(pack)).file(entry);
  }

  /** A picture's pixel size from its first bytes (a PNG says so in 24; others need more). */
  private async sizeOf(pack: PackIndex, entry: Entry): Promise<{ w: number; h: number } | null> {
    const src = await this.source(pack);
    const small = await src.head(entry, 32).catch(() => null);
    if (!small) return null;
    const s = imageSize(small);
    if (s || entry.size <= 32) return s;
    return imageSize(await src.head(entry, IMAGE_HEAD_BYTES).catch(() => small));
  }

  async read(id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const r = await this.locate(id);
    if (!r) return null;
    const ext = r.entry.path.split(".").pop()!.toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
    try { return { bytes: await this.bytesOf(r.pack, r.entry), mime }; } catch { return null; } // (a damaged pack or zip file: the same as a missing picture)
  }

  /** The image as RGBA, or null if it can't be decoded here (WebP, huge images, damaged files). */
  async decode(id: string): Promise<{ w: number; h: number; data: Uint8ClampedArray } | null> {
    const r = await this.locate(id);
    if (!r) return null;
    const s = await this.sizeOf(r.pack, r.entry);
    if (s && s.w * s.h > MAX_DECODE_PIXELS) return null;
    try {
      const bytes = await this.bytesOf(r.pack, r.entry);
      return this.pictures ? await this.pictures.decode(bytes) : decodeImage(bytes);
    } catch {
      return null;
    }
  }

  /**
   * Where pictures are read: the server's worker thread (main.ts sets it), so browsing a pack of big pictures for the first time doesn't hold up the
   * map and the editor (found 2026-11-22: every thumbnail was a whole picture decoded on the main thread). Without one (tests), here.
   */
  pictures: {
    decode(bytes: Uint8Array): Promise<RGBAImage | null>;
    thumbnail(bytes: Uint8Array, max: number): Promise<{ png: Uint8Array; w: number; h: number } | null>;
    shrink(bytes: Uint8Array, job: ShrinkJob): Promise<ShrunkPicture | null>;
    kind(bytes: Uint8Array): Promise<"terrain" | "objects" | null>;
  } | null = null;

  private remember<T>(key: string, value: T, bytes: number): T {
    this.decoded.set(key, { value, bytes });
    this.decodedBytes += bytes;
    while (this.decodedBytes > 600_000_000 && this.decoded.size > 1) {
      const k = this.decoded.keys().next().value as string;
      this.decodedBytes -= this.decoded.get(k)!.bytes;
      this.decoded.delete(k);
    }
    return value;
  }

  /**
   * A square RGBA tile (512 px) from a terrain texture, for floors. With `roof`, a see-through strip at the bottom of the picture is cut off first (`opaqueRowCount`), so the tile
   * repeats without a seam: the roof pictures of the packs have one.
   */
  async tile(id: string, squares?: number, roof = false): Promise<TileData | null> {
    const key = `tile:${id}:${squares ?? ""}${roof ? ":roof" : ""}`;
    const hit = this.decoded.get(key);
    if (hit) return hit.value as TileData | null;
    const t = await this.shrunk(id, { kind: "tile", size: 512, roof });
    if (!t) return null;
    return this.remember(key, { data: t.data, size: 512, squares: squares ?? defaultTileSquares(t.origW) }, t.data.length);
  }

  /**
   * An object image prepared for drawing at `ratio` output pixels per source pixel: shrunk when it will be drawn
   * smaller than it is (never enlarged), and remembering its original size.
   */
  async sprite(id: string, ratio = 1): Promise<(SpriteData & { origW: number; origH: number }) | null> {
    const r = Math.min(1, Math.max(0.02, Math.round(ratio * 100) / 100));
    const key = `sprite:${id}:${r}`;
    const hit = this.decoded.get(key);
    if (hit) return hit.value as (SpriteData & { origW: number; origH: number }) | null;
    const s = await this.shrunk(id, { kind: "sprite", ratio: r });
    if (!s) return null;
    return this.remember(key, { w: s.w, h: s.h, data: s.data, origW: s.origW, origH: s.origH }, s.data.length);
  }

  /** A pack's picture made ready to draw (core shrinkPicture): on the worker thread when the server gave one (`pictures`), else here. */
  private async shrunk(id: string, job: ShrinkJob): Promise<ShrunkPicture | null> {
    const r = await this.locate(id);
    if (!r) return null;
    const s = await this.sizeOf(r.pack, r.entry);
    if (s && s.w * s.h > MAX_DECODE_PIXELS) return null;
    try {
      const bytes = await this.bytesOf(r.pack, r.entry);
      if (this.pictures) return await this.pictures.shrink(bytes, job);
      const img = decodeImage(bytes);
      return img ? shrinkPicture(img, job) : null;
    } catch {
      return null;
    }
  }

  /** A small PNG for the browser (cached on disk); other formats are passed through unchanged. `orig` is the full-size pixel size when known. */
  async thumbnail(id: string, max = 160): Promise<{ bytes: Uint8Array; mime: string; orig?: { w: number; h: number } } | null> {
    const r = await this.locate(id);
    if (!r) return null;
    const orig = (await this.sizeOf(r.pack, r.entry)) ?? undefined;
    // (the file's size is in the name, so a picture that was replaced by another of the same name is made again)
    const cacheFile = path.join(this.cacheDir, "thumbs", `${createHash("sha1").update(`${id}@${max}@${r.entry.size}`).digest("hex")}.png`);
    try { return { bytes: new Uint8Array(await readFile(cacheFile)), mime: "image/png", orig }; } catch { /* make it */ }
    if (this.pictures && !(orig && orig.w * orig.h > MAX_DECODE_PIXELS)) {
      const t = await this.bytesOf(r.pack, r.entry).then((b) => this.pictures!.thumbnail(b, max)).catch(() => null);
      if (!t) { const f = await this.read(id); return f && { ...f, orig }; }
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, t.png).catch(() => {});
      return { bytes: t.png, mime: "image/png", orig: { w: t.w, h: t.h } };
    }
    const img = await this.decode(id);
    if (!img) { const f = await this.read(id); return f && { ...f, orig }; }
    const k = Math.min(1, max / Math.max(img.w, img.h));
    const w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
    const data = k < 1 ? boxResize(img.data, img.w, img.h, w, h) : img.data;
    const png = new PNG({ width: w, height: h });
    png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const bytes = new Uint8Array(PNG.sync.write(png, { deflateLevel: 3 }));
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, bytes).catch(() => {});
    return { bytes, mime: "image/png", orig: { w: img.w, h: img.h } };
  }

  // ---------------------------------------------------------------- diagnostic report (for the user to send back)
  async report(): Promise<string> {
    const L: string[] = [];
    const st = this.status();
    const all = [...this.packs.values()];
    // (the home folder shortened: it holds the Windows user name, and this report is sent to whoever improves Dragon Drop)
    L.push(`Dragon Drop asset report ${new Date().toISOString()}`, `folder: ${shortHome(this.dir)}`);
    L.push(`packs: ${st.packs} (${st.usablePacks} usable, ${st.restricted} restricted by their authors, ${all.filter((p) => p.info.supersededBy).length} older duplicates), files in usable packs: ${st.files}`);
    const kinds: Record<string, number> = {};
    for (const p of all) kinds[p.info.kind] = (kinds[p.info.kind] ?? 0) + 1;
    L.push(`kinds of pack: ${JSON.stringify(kinds)}`);
    if (this.errors.length) { L.push("", "PACKS THAT COULDN'T BE READ:"); for (const e of this.errors) L.push(`  ${path.basename(e.file)}: ${e.message}`); }
    const ext: Record<string, number> = {}, dirs: Record<string, number> = {}, dataTypes: Record<string, number> = {};
    const dims: number[] = [];
    const formats = new Set<string>();
    for (const p of all) {
      if (p.info.kind === "pck") formats.add(`v${p.info.formatVersion} (engine ${p.info.engine})`);
      for (const e of p.entries) {
        const x = (e.path.split(".").pop() ?? "").toLowerCase();
        if (catOf(e) === "data") dataTypes[x] = (dataTypes[x] ?? 0) + 1; else ext[x] = (ext[x] ?? 0) + 1;
        const d = e.path.split("/").slice(0, 2).join("/");
        dirs[d] = (dirs[d] ?? 0) + 1;
      }
    }
    if (formats.size) L.push(`pack file formats: ${[...formats].join(", ")}`);
    L.push(`image types: ${JSON.stringify(ext)}`, `other file types: ${JSON.stringify(dataTypes)}`);
    L.push("top folders inside packs:");
    for (const [d, n] of Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`  ${d}  ${n}`);
    // sample image sizes
    for (const p of all.slice(0, 40)) {
      const imgs = p.entries.filter((e) => /\.png$/i.test(e.path)).filter((_, i) => i % Math.max(1, Math.floor(p.entries.length / 6)) === 0).slice(0, 6);
      if (!imgs.length) continue;
      const src = await this.source(p).catch(() => null);
      if (!src) continue;
      for (const e of imgs) { const s = imageSize(await src.head(e, 32).catch(() => new Uint8Array(0))); if (s) dims.push(s.w, s.h); }
    }
    if (dims.length) L.push(`sample PNG sizes (w,h pairs): ${dims.join(",")}`);
    L.push("", "PACKS:");
    for (const p of this.packList()) {
      const i = p.supersededBy ? ` [older copy, superseded by ${p.supersededBy}]` : p.restricted ? " [RESTRICTED by the author]" : "";
      L.push(`- ${p.name}${i}  (${p.kind}: ${path.basename(p.file)}; ${(p.bytes / 1e6).toFixed(0)} MB; version ${p.version ?? "?"}; author ${p.author ?? "?"}; id ${p.packId ?? "?"}; ${p.files} files; ${JSON.stringify(p.categories)})`);
    }
    L.push("", "PACK INFO FILES (first 6):");
    for (const p of all.slice(0, 6)) L.push(`${p.info.name}: ${JSON.stringify(p.packJson ?? null).slice(0, 700)}`);
    L.push("", "SAMPLE FILE PATHS (first 4 per category in 6 packs):");
    for (const p of all.filter((_, i) => i % Math.max(1, Math.floor(this.packs.size / 6)) === 0).slice(0, 6)) {
      L.push(`${p.info.name}:`);
      for (const c of [...ASSET_CATEGORIES, "data"]) for (const e of p.entries.filter((x) => catOf(x) === c).slice(0, 4)) L.push(`  [${c}] ${e.path} (${e.size} bytes)`);
    }
    // the first small data file of each kind, so the formats are known
    const seen = new Set<string>();
    L.push("", "SAMPLE DATA FILES:");
    for (const p of all) {
      for (const e of p.entries) {
        const x = (e.path.split(".").pop() ?? "").toLowerCase();
        if (catOf(e) !== "data" || seen.has(x) || e.size > 6000 || x === "json" && /^packs\//.test(e.path)) continue;
        seen.add(x);
        const src = await this.source(p).catch(() => null);
        if (!src) continue;
        L.push(`--- ${p.info.name}: ${e.path}`, new TextDecoder().decode(await src.file(e).catch(() => new Uint8Array(0))).slice(0, 1500));
      }
    }
    return L.join("\n");
  }

  async close() {
    const all = [...this.handles.values()];
    this.handles.clear();
    for (const h of all) await h.then((fh) => fh.close()).catch(() => {});
  }
}
