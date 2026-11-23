/**
 * The DM's prefabs (core prefabs.ts): one JSON file each in the maps folder's "Prefabs" folder (a name that is never a map id), with a small picture beside it.
 * They are the DM's own work, like the maps: removing one moves it into "Prefabs/Removed", nothing is erased.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { type Prefab, type PrefabInfo, describePrefab, newerPrefab, readPrefab } from "@mapmaker/core";
import { atomicWrite, slugify } from "./store.ts";

export const PREFAB_DIR = "Prefabs";
const REMOVED_DIR = "Removed";
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A prefab of that name is there already (the DM is asked whether to replace it). */
export class PrefabExists extends Error {
  constructor(readonly id: string, name: string) {
    super(`There is already a prefab called "${name}". Choose another name, or replace it.`);
    this.name = "PrefabExists";
  }
}

const info = (id: string, p: Prefab, picture: boolean): PrefabInfo => ({ id, name: p.name, w: p.w, h: p.h, what: describePrefab(p), savedAt: p.savedAt, ...(p.from && { from: p.from }), picture });

export class PrefabStore {
  /** Parsed prefabs by file, kept while the file is unchanged (a list reads every file). */
  private cache = new Map<string, { mtimeMs: number; prefab: Prefab | null; newer: boolean }>();

  constructor(readonly dir: string) {}

  private json(id: string) { return path.join(this.dir, `${id}.json`); }
  picture(id: string): string | null {
    if (!ID_RE.test(id)) return null;
    const f = path.join(this.dir, `${id}.png`);
    return existsSync(f) ? f : null;
  }

  private async read(id: string): Promise<{ prefab: Prefab | null; newer: boolean } | null> {
    const file = this.json(id);
    let st;
    try { st = await stat(file); } catch { return null; }
    const had = this.cache.get(id);
    if (had && had.mtimeMs === st.mtimeMs) return had;
    let raw: unknown = null;
    try { raw = JSON.parse(await readFile(file, "utf8")); } catch { /* damaged: listed as skipped */ }
    const entry = { mtimeMs: st.mtimeMs, prefab: readPrefab(raw), newer: newerPrefab(raw) };
    this.cache.set(id, entry);
    return entry;
  }

  /** Every prefab, by name; files that can't be read (damaged, or from a newer Dragon Drop) are named in `skipped`. */
  async list(): Promise<{ prefabs: PrefabInfo[]; skipped: string[] }> {
    if (!existsSync(this.dir)) return { prefabs: [], skipped: [] };
    const prefabs: PrefabInfo[] = [], skipped: string[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith(".json")) continue;
      const id = f.slice(0, -5);
      if (!ID_RE.test(id)) continue;
      const r = await this.read(id);
      if (!r) continue;
      if (r.prefab) prefabs.push(info(id, r.prefab, !!this.picture(id)));
      else skipped.push(`${f}${r.newer ? " (saved by a newer Dragon Drop)" : ""}`);
    }
    return { prefabs: prefabs.sort((a, b) => a.name.localeCompare(b.name)), skipped };
  }

  /** A prefab by its id or its name (any case). */
  async get(ref: string): Promise<{ id: string; prefab: Prefab } | null> {
    const k = ref.trim();
    if (ID_RE.test(k)) {
      const r = await this.read(k);
      if (r?.prefab) return { id: k, prefab: r.prefab };
    }
    const q = k.toLowerCase();
    const { prefabs } = await this.list();
    const hit = prefabs.find((p) => p.name.toLowerCase() === q) ?? prefabs.find((p) => slugify(p.name) === slugify(k));
    if (!hit) return null;
    const r = await this.read(hit.id);
    return r?.prefab ? { id: hit.id, prefab: r.prefab } : null;
  }

  /** Save a prefab with its picture. A prefab of the same name is replaced only with `replace` (else PrefabExists). */
  async save(p: Prefab, picture: Uint8Array | null, replace = false): Promise<PrefabInfo> {
    await mkdir(this.dir, { recursive: true });
    const same = (await this.list()).prefabs.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (same && !replace) throw new PrefabExists(same.id, same.name);
    let id = same?.id;
    if (!id) {
      const base = slugify(p.name) || "prefab";
      id = base;
      for (let n = 2; existsSync(this.json(id)); n++) id = `${base}-${n}`;
    }
    await atomicWrite(this.json(id), JSON.stringify(p));
    if (picture) await atomicWrite(path.join(this.dir, `${id}.png`), picture);
    this.cache.delete(id);
    return info(id, p, !!picture || !!this.picture(id));
  }

  /** Give a prefab a new name (its file keeps its id). */
  async rename(id: string, name: string): Promise<PrefabInfo> {
    const r = await this.get(id);
    if (!r) throw new Error("That prefab isn't there any more.");
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!clean) throw new Error("A prefab needs a name.");
    const other = (await this.list()).prefabs.find((x) => x.id !== r.id && x.name.toLowerCase() === clean.toLowerCase());
    if (other) throw new Error(`There is already a prefab called "${other.name}".`);
    const p = { ...r.prefab, name: clean };
    await atomicWrite(this.json(r.id), JSON.stringify(p));
    this.cache.delete(r.id);
    return info(r.id, p, !!this.picture(r.id));
  }

  /** Take a prefab out of the list: its files are moved into Prefabs/Removed (never erased). Returns where they went. */
  async remove(id: string): Promise<string> {
    if (!ID_RE.test(id) || !existsSync(this.json(id))) throw new Error("That prefab isn't there any more.");
    const bin = path.join(this.dir, REMOVED_DIR);
    await mkdir(bin, { recursive: true });
    let stem = id;
    for (let n = 2; existsSync(path.join(bin, `${stem}.json`)); n++) stem = `${id}-${n}`;
    await rename(this.json(id), path.join(bin, `${stem}.json`));
    const pic = this.picture(id);
    if (pic) await rename(pic, path.join(bin, `${stem}.png`)).catch(() => {});
    this.cache.delete(id);
    return bin;
  }
}
