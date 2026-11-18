/**
 * The user's Dungeondraft asset packs, read in place (never copied): a catalog built from each pack's index,
 * cached on disk, with search, file access, thumbnails and decoded textures/sprites for renders.
 *
 * Packs whose author has said they may not be used in other mapping programs
 * (`allow_3rd_party_mapping_software: false` in the pack's own info) are listed but never served or drawn.
 */
import { createHash } from "node:crypto";
import { type FileHandle, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AssetCategory, type AssetItem, type PckEntry, type RandomAccess, type SpriteData, type TileData, ASSET_CATEGORIES, assetId, assetLabel, boxResize, categoryOf,
  defaultTileSquares, parseAssetId, pngSize, readPck, readPckFile,
} from "@mapmaker/core";
import { decodeImage } from "@mapmaker/tools";
import { PNG } from "pngjs";

export interface PackInfo {
  key: string;
  name: string;
  file: string;
  bytes: number;
  mtimeMs: number;
  formatVersion: number;
  engine: string;
  packId?: string;
  version?: string;
  author?: string;
  /** The author doesn't allow use outside Dungeondraft: listed, never served or drawn. */
  restricted: boolean;
  /** A newer copy of the same pack is used instead. */
  supersededBy?: string;
  files: number;
  categories: Record<string, number>;
  error?: string;
}

interface PackIndex {
  info: PackInfo;
  entries: PckEntry[];
  byPath: Map<string, PckEntry>;
  tags: Map<string, string[]>;
  packJson?: Record<string, unknown>;
}

interface CachedIndex {
  v: 1;
  size: number;
  mtimeMs: number;
  formatVersion: number;
  engine: string;
  entries: [string, number, number][];
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const MAX_DECODE_PIXELS = 40_000_000;

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

export class AssetLibrary {
  private packs = new Map<string, PackIndex>();
  private handles = new Map<string, FileHandle>();
  private decoded = new Map<string, { value: unknown; bytes: number }>();
  private decodedBytes = 0;
  scanning = false;
  scanned = 0;
  total = 0;
  errors: { file: string; message: string }[] = [];
  lastScan: string | null = null;

  constructor(readonly dir: string, readonly cacheDir: string) {}

  // ---------------------------------------------------------------- scanning
  private async findPackFiles(): Promise<string[]> {
    const out: string[] = [];
    const visit = async (d: string, depth: number) => {
      let names;
      try { names = await readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of names) {
        const f = path.join(d, e.name);
        if (e.isFile() && /\.dungeondraft_pack$/i.test(e.name)) out.push(f);
        else if (e.isDirectory() && depth < 2 && !e.name.startsWith(".")) await visit(f, depth + 1);
      }
    };
    await visit(this.dir, 0);
    return out.sort((a, b) => a.localeCompare(b));
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.errors = [];
    this.scanned = 0;
    try {
      const files = await this.findPackFiles();
      this.total = files.length;
      const found: PackIndex[] = [];
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const f = files[next++];
          try { found.push(await this.indexPack(f)); } catch (e) { this.errors.push({ file: f, message: (e as Error).message }); }
          this.scanned++;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      this.install(found);
      this.lastScan = new Date().toISOString();
    } finally {
      this.scanning = false;
    }
  }

  /** Give each pack a unique key; when two copies of the same pack exist, the newer one wins. */
  private install(found: PackIndex[]) {
    this.packs.clear();
    for (const h of this.handles.values()) void h.close().catch(() => {});
    this.handles.clear();
    this.decoded.clear();
    this.decodedBytes = 0;
    const byKey = new Map<string, PackIndex[]>();
    for (const p of found) {
      const k = slug(p.info.name) || slug(path.basename(p.info.file, path.extname(p.info.file))) || "pack";
      byKey.set(k, [...(byKey.get(k) ?? []), p]);
    }
    const samePack = (a: PackIndex, b: PackIndex) =>
      (!!a.info.packId && a.info.packId === b.info.packId) || (!a.info.packId && !b.info.packId && a.info.name === b.info.name);
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
      let formatVersion: number, engine: string, entries: PckEntry[];
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
      const byPath = new Map(entries.map((e) => [e.path.toLowerCase(), e]));
      // the pack's own description, and its tag lists (best effort: the exact layout varies between packs)
      let packJson: Record<string, unknown> | undefined;
      const infoEntry = entries.find((e) => /^packs\/[^/]+\.json$/i.test(e.path));
      if (infoEntry && infoEntry.size < 2_000_000) {
        try { packJson = JSON.parse(new TextDecoder().decode(await readPckFile(ra, infoEntry)).replace(/^﻿/, "")); } catch { /* unreadable: use the file name */ }
      }
      const tags = new Map<string, string[]>();
      const tagEntry = byPath.get("data/default.dungeondraft_tags");
      if (tagEntry && tagEntry.size < 8_000_000) {
        try {
          const j = JSON.parse(new TextDecoder().decode(await readPckFile(ra, tagEntry)).replace(/^﻿/, "")) as { tags?: Record<string, unknown> };
          for (const [tag, list] of Object.entries(j.tags ?? {})) {
            if (!Array.isArray(list)) continue;
            for (const p of list) if (typeof p === "string") {
              const k = p.replace(/^res:\/\//, "").toLowerCase();
              tags.set(k, [...(tags.get(k) ?? []), tag]);
            }
          }
        } catch { /* ignore */ }
      }
      const categories: Record<string, number> = {};
      for (const e of entries) { const c = categoryOf(e.path); categories[c] = (categories[c] ?? 0) + 1; }
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : v != null && typeof v !== "object" ? String(v) : undefined);
      const name = str(packJson?.name) ?? path.basename(file).replace(/\.dungeondraft_pack$/i, "");
      const info: PackInfo = {
        key: "", name, file, bytes: st.size, mtimeMs: st.mtimeMs, formatVersion, engine,
        packId: str(packJson?.id), version: str(packJson?.version), author: str(packJson?.author),
        restricted: packJson?.allow_3rd_party_mapping_software === false,
        files: entries.length, categories,
      };
      return { info, entries, byPath, tags, packJson };
    } finally {
      await fh.close();
    }
  }

  // ---------------------------------------------------------------- catalog
  status() {
    const usable = this.usablePacks();
    return {
      dir: this.dir, scanning: this.scanning, scanned: this.scanned, total: this.total, packs: this.packs.size,
      usablePacks: usable.length, files: usable.reduce((n, p) => n + p.info.files, 0),
      restricted: [...this.packs.values()].filter((p) => p.info.restricted).length, errors: this.errors, lastScan: this.lastScan,
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
    const matches: { p: PackIndex; e: PckEntry; cat: AssetCategory }[] = [];
    for (const p of packs) {
      for (const e of p.entries) {
        const cat = categoryOf(e.path);
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

  /** One asset by id (with its pixel size), or null if it doesn't exist or its pack is restricted. */
  async info(id: string): Promise<AssetItem | null> {
    const a = parseAssetId(id);
    const pack = a && this.packs.get(a.pack);
    if (!a || !pack || pack.info.restricted) return null;
    const entry = pack.byPath.get(a.path.toLowerCase());
    if (!entry) return null;
    const tags = pack.tags.get(entry.path.toLowerCase());
    const item: AssetItem = { id: assetId(pack.info.key, entry.path), pack: pack.info.key, packName: pack.info.name, path: entry.path, name: assetLabel(entry.path), cat: categoryOf(entry.path), ...(tags && { tags }) };
    return (await this.withSizes([item]))[0];
  }

  /** Fill in pixel sizes for a page of results (a few bytes from each file). */
  async withSizes(items: AssetItem[]): Promise<AssetItem[]> {
    return Promise.all(items.map(async (it) => {
      const r = await this.locate(it.id).catch(() => null);
      if (!r) return it;
      const head = await r.ra.read(r.entry.offset, Math.min(32, r.entry.size)).catch(() => null);
      const s = head && pngSize(head);
      return s ? { ...it, w: s.w, h: s.h } : it;
    }));
  }

  // ---------------------------------------------------------------- files
  private async handle(file: string): Promise<{ fh: FileHandle; size: number }> {
    let fh = this.handles.get(file);
    const size = (await stat(file)).size;
    if (!fh) {
      if (this.handles.size >= 12) { const first = this.handles.keys().next().value as string; await this.handles.get(first)!.close().catch(() => {}); this.handles.delete(first); }
      fh = await open(file, "r");
      this.handles.set(file, fh);
    }
    return { fh, size };
  }

  private async locate(id: string): Promise<{ pack: PackIndex; entry: PckEntry; ra: RandomAccess } | null> {
    const a = parseAssetId(id);
    if (!a) return null;
    const pack = this.packs.get(a.pack);
    if (!pack || pack.info.restricted) return null;
    const entry = pack.byPath.get(a.path.toLowerCase());
    if (!entry || entry.encrypted) return null;
    const { fh, size } = await this.handle(pack.info.file);
    return { pack, entry, ra: fileAccess(fh, size) };
  }

  async read(id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const r = await this.locate(id);
    if (!r) return null;
    const ext = r.entry.path.split(".").pop()!.toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
    return { bytes: await readPckFile(r.ra, r.entry), mime };
  }

  /** The image as RGBA, or null if it can't be decoded here (WebP, huge images, damaged files). */
  async decode(id: string): Promise<{ w: number; h: number; data: Uint8ClampedArray } | null> {
    const r = await this.locate(id);
    if (!r) return null;
    const head = await r.ra.read(r.entry.offset, Math.min(32, r.entry.size));
    const s = pngSize(head);
    if (s && s.w * s.h > MAX_DECODE_PIXELS) return null;
    try {
      const img = decodeImage(await readPckFile(r.ra, r.entry));
      return img;
    } catch {
      return null;
    }
  }

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

  /** A square RGBA tile (512 px) from a terrain texture, for floors. */
  async tile(id: string, squares?: number): Promise<TileData | null> {
    const key = `tile:${id}:${squares ?? ""}`;
    const hit = this.decoded.get(key);
    if (hit) return hit.value as TileData | null;
    const img = await this.decode(id);
    if (!img) return null;
    const size = 512;
    const data = img.w === size && img.h === size ? img.data : boxResize(img.data, img.w, img.h, size, size);
    return this.remember(key, { data, size, squares: squares ?? defaultTileSquares(img.w) }, data.length);
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
    const img = await this.decode(id);
    if (!img) return null;
    const w = Math.max(1, Math.round(img.w * r)), h = Math.max(1, Math.round(img.h * r));
    const data = r < 1 ? boxResize(img.data, img.w, img.h, w, h) : img.data;
    return this.remember(key, { w, h, data, origW: img.w, origH: img.h }, data.length);
  }

  /** A small PNG for the browser (cached on disk); other formats are passed through unchanged. `orig` is the full-size pixel size when known. */
  async thumbnail(id: string, max = 160): Promise<{ bytes: Uint8Array; mime: string; orig?: { w: number; h: number } } | null> {
    const r = await this.locate(id);
    if (!r) return null;
    const orig = pngSize(await r.ra.read(r.entry.offset, Math.min(32, r.entry.size))) ?? undefined;
    const cacheFile = path.join(this.cacheDir, "thumbs", `${createHash("sha1").update(`${id}@${max}`).digest("hex")}.png`);
    try { return { bytes: new Uint8Array(await readFile(cacheFile)), mime: "image/png", orig }; } catch { /* make it */ }
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
    L.push(`Dragon Drop asset report ${new Date().toISOString()}`, `folder: ${this.dir}`);
    L.push(`packs: ${st.packs} (${st.usablePacks} usable, ${st.restricted} restricted by their authors, ${[...this.packs.values()].filter((p) => p.info.supersededBy).length} older duplicates), files in usable packs: ${st.files}`);
    if (this.errors.length) { L.push("", "PACKS THAT COULDN'T BE READ:"); for (const e of this.errors) L.push(`  ${path.basename(e.file)}: ${e.message}`); }
    const ext: Record<string, number> = {}, dirs: Record<string, number> = {}, dataTypes: Record<string, number> = {};
    const dims: number[] = [];
    const formats = new Set<string>();
    for (const p of this.packs.values()) {
      formats.add(`v${p.info.formatVersion} (Godot ${p.info.engine})`);
      for (const e of p.entries) {
        const x = (e.path.split(".").pop() ?? "").toLowerCase();
        if (categoryOf(e.path) === "data") dataTypes[x] = (dataTypes[x] ?? 0) + 1; else ext[x] = (ext[x] ?? 0) + 1;
        const d = e.path.split("/").slice(0, 2).join("/");
        dirs[d] = (dirs[d] ?? 0) + 1;
      }
    }
    L.push(`pack file formats: ${[...formats].join(", ")}`);
    L.push(`image types: ${JSON.stringify(ext)}`, `other file types: ${JSON.stringify(dataTypes)}`);
    L.push("top folders inside packs:");
    for (const [d, n] of Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`  ${d}  ${n}`);
    // sample image sizes
    for (const p of [...this.packs.values()].slice(0, 40)) {
      const imgs = p.entries.filter((e) => /\.png$/i.test(e.path)).filter((_, i) => i % Math.max(1, Math.floor(p.entries.length / 6)) === 0).slice(0, 6);
      if (!imgs.length) continue;
      const r = await this.handle(p.info.file).catch(() => null);
      if (!r) continue;
      const ra = fileAccess(r.fh, r.size);
      for (const e of imgs) { const s = pngSize(await ra.read(e.offset, 32)); if (s) dims.push(s.w, s.h); }
    }
    if (dims.length) L.push(`sample PNG sizes (w,h pairs): ${dims.join(",")}`);
    L.push("", "PACKS:");
    for (const p of this.packList()) {
      const i = p.supersededBy ? ` [older copy, superseded by ${p.supersededBy}]` : p.restricted ? " [RESTRICTED by the author]" : "";
      L.push(`- ${p.name}${i}  (${path.basename(p.file)}; ${(p.bytes / 1e6).toFixed(0)} MB; version ${p.version ?? "?"}; author ${p.author ?? "?"}; id ${p.packId ?? "?"}; ${p.files} files; ${JSON.stringify(p.categories)})`);
    }
    L.push("", "PACK INFO FILES (first 6):");
    for (const p of [...this.packs.values()].slice(0, 6)) L.push(`${p.info.name}: ${JSON.stringify(p.packJson ?? null).slice(0, 700)}`);
    L.push("", "SAMPLE FILE PATHS (first 4 per category in 6 packs):");
    for (const p of [...this.packs.values()].filter((_, i) => i % Math.max(1, Math.floor(this.packs.size / 6)) === 0).slice(0, 6)) {
      L.push(`${p.info.name}:`);
      for (const c of [...ASSET_CATEGORIES, "data"]) for (const e of p.entries.filter((x) => categoryOf(x.path) === c).slice(0, 4)) L.push(`  [${c}] ${e.path} (${e.size} bytes)`);
    }
    // the first small data file of each kind, so the formats are known
    const seen = new Set<string>();
    L.push("", "SAMPLE DATA FILES:");
    for (const p of this.packs.values()) {
      for (const e of p.entries) {
        const x = (e.path.split(".").pop() ?? "").toLowerCase();
        if (categoryOf(e.path) !== "data" || seen.has(x) || e.size > 6000 || x === "json" && /^packs\//.test(e.path)) continue;
        seen.add(x);
        const r = await this.handle(p.info.file).catch(() => null);
        if (!r) continue;
        L.push(`--- ${p.info.name}: ${e.path}`, new TextDecoder().decode(await readPckFile(fileAccess(r.fh, r.size), e)).slice(0, 1500));
      }
    }
    return L.join("\n");
  }

  async close() {
    for (const h of this.handles.values()) await h.close().catch(() => {});
    this.handles.clear();
  }
}

