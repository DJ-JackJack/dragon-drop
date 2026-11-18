/**
 * Project folders on disk:
 *   projects/<id>/project.json        map metadata
 *   projects/<id>/map/height.f32.gz   live heightmap (Float32 LE, gzip) — not committed
 *   projects/<id>/seed/height.f32.gz  optional starting heightmap — committed
 *   projects/<id>/brief.md            design brief shared with Claude
 *   projects/<id>/refs/               reference images
 *   projects/<id>/map/previews/       preview images shown in chat
 *   projects/<id>/chat.json           in-app chat history — not committed
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

// Compressing or decompressing a 17 MB map on the main thread froze the server for about half a second each time (edits, tool calls and chat all waited); the async versions run on the thread pool.
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
import {
  type BaseClimate, type CheckpointInfo, type Features, type MapDoc, type MapMeta, type ProjectInfo, type RefInfo, HeightField, createDoc,
  emptyFeatures, packBaseClimate, unpackBaseClimate,
} from "@mapmaker/core";

interface CheckpointEntry extends CheckpointInfo {
  meta: Pick<Partial<MapMeta>, "seaLevel" | "style" | "climate">;
  features?: Features;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$/;

export function safeId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Invalid project id: ${id}`);
  return id;
}

export function safeFileName(name: string): string {
  const base = path.basename(name);
  if (!FILE_RE.test(base) || base.includes("..")) throw new Error(`Invalid file name: ${name}`);
  return base;
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "map";
}

export class ProjectStore {
  constructor(readonly root: string) {}

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
        out.push({ id: name, name: m.name, width: m.width, height: m.height, kmPerPx: m.kmPerPx, updatedAt: m.updatedAt, ...(m.parent && { parent: m.parent }), ...(m.kind === "battle" && { kind: "battle" as const }) });
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
    const d = this.dir(id);
    const meta = JSON.parse(await readFile(path.join(d, "project.json"), "utf8")) as MapMeta;
    meta.id = id;
    const live = path.join(d, "map", "height.f32.gz");
    const seed = path.join(d, "seed", "height.f32.gz");
    const src = existsSync(live) ? live : existsSync(seed) ? seed : null;
    const features = (await this.readJson<Features>(id, "features.json")) ?? emptyFeatures();
    if (!src) {
      const doc = createDoc({ ...meta, id });
      doc.meta = { ...doc.meta, ...meta };
      doc.features = features;
      return doc;
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
    return doc;
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
    // Take the snapshot before the first await: the compression below runs in the background, and an edit made meanwhile must not leak into this file.
    const meta = JSON.stringify(doc.meta, null, 2);
    const features = JSON.stringify(doc.features ?? emptyFeatures(), null, 1);
    const bytes = Buffer.from(doc.height.data.slice().buffer);
    const d = this.dir(doc.meta.id);
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
    for (const name of (await readdir(d)).sort()) {
      if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) continue;
      const s = await stat(path.join(d, name));
      out.push({ name, url: `/api/projects/${id}/refs/${encodeURIComponent(name)}`, bytes: s.size });
    }
    return out;
  }

  async readRef(id: string, name: string): Promise<Uint8Array | null> {
    const f = path.join(this.dir(id), "refs", safeFileName(name));
    return existsSync(f) ? new Uint8Array(await readFile(f)) : null;
  }

  async addRef(id: string, name: string, bytes: Uint8Array): Promise<RefInfo> {
    const d = path.join(this.dir(id), "refs");
    await mkdir(d, { recursive: true });
    const clean = safeFileName(name.replace(/[^A-Za-z0-9._ -]/g, "_") || "image");
    let final = clean;
    for (let i = 2; existsSync(path.join(d, final)); i++) final = clean.replace(/(\.[^.]+)?$/, `-${i}$1`);
    await writeFile(path.join(d, final), bytes);
    return { name: final, url: `/api/projects/${id}/refs/${encodeURIComponent(final)}`, bytes: bytes.byteLength };
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
    return (await this.cpIndex(id)).map(({ meta: _m, features: _f, ...info }) => info);
  }

  async saveCheckpoint(id: string, name: string, doc: MapDoc, seq: number, note?: string): Promise<CheckpointInfo> {
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("Checkpoint needs a name.");
    const bytes = Buffer.from(doc.height.data.slice().buffer); // the map as it is now, before any await
    await mkdir(this.cpDir(id), { recursive: true });
    const index = (await this.cpIndex(id)).filter((c) => c.name.toLowerCase() !== clean.toLowerCase());
    const file = `${slugify(clean)}-${Date.now()}.f32.gz`;
    await atomicWrite(path.join(this.cpDir(id), file), await gzipAsync(bytes, { level: 6 }));
    const entry: CheckpointEntry = {
      name: clean, file, time: new Date().toISOString(), seq, note,
      meta: { seaLevel: doc.meta.seaLevel, style: doc.meta.style, climate: doc.meta.climate },
      features: doc.features,
    };
    index.push(entry);
    await atomicWrite(path.join(this.cpDir(id), "index.json"), JSON.stringify(index, null, 1));
    const { meta: _m, features: _f, ...info } = entry;
    return info;
  }

  async readCheckpoint(id: string, name: string) {
    const entry = (await this.cpIndex(id)).find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (!entry) return null;
    const raw = await gunzipAsync(await readFile(path.join(this.cpDir(id), safeFileName(entry.file))));
    const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const { meta, features, ...info } = entry;
    return { data, meta, features, info };
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
  await rename(tmp, file);
}
