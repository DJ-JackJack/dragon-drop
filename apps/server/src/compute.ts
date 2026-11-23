/**
 * Heavy map maths (texture noise, climate/hydrology, painted renders) behind one interface,
 * so it can run on a worker thread and never stall editors, chat or MCP while it works.
 */
import { Worker } from "node:worker_threads";
import {
  type BaseClimate, type ClimateNoise, type ClimateRegion, type Derived, type MapDoc, type MapMeta, type NoiseCache, type RegionalPlan, type RiverInflow,
  type Features, type SpriteData, type TileData, HeightField, boxResize, type ShrinkJob, type ShrunkPicture, shrinkPicture, pictureKindHint, buildClimateNoise, buildNoiseCache, computeDerived, regionalHeights, renderBattle, renderBattleRoofPictures, renderPainted, resolveRiverSources,
  type CarveOptions, type CarveResult, type RiverPath, carveValleys, type DrainLakeResult, drainLakeAt,
} from "@mapmaker/core";
import { type ReadResult, type ReaderOptions, type RGBAImage, type StreetReadOptions, type WaterReadOptions, readBuildings, readStreets, readWater, renderCity } from "@mapmaker/core";

/** What the picture reader is asked for: buildings, streets or water (core cityReader.ts). */
export type ReadJob = { what: "buildings"; opts: ReaderOptions } | { what: "streets"; opts: StreetReadOptions } | { what: "water"; opts: WaterReadOptions };
export type ReadAnswer = ReturnType<typeof readBuildings> | ReturnType<typeof readStreets> | ReturnType<typeof readWater>;
import { type PreparedReference, decodeImage, encodePngRgba, prepareReference } from "@mapmaker/tools";
import { NoiseStore } from "./noiseStore.ts";

export interface MapCompute {
  /** Climate, coast distances, lakes and rivers for the doc as it is now. */
  derive(doc: MapDoc, seq: number): Promise<Derived>;
  /** Painted Relief render (RGBA) of the whole map. */
  paint(doc: MapDoc, d: Derived): Promise<Uint8ClampedArray>;
  /** Battlemap image (RGBA, battleImageSize(spec) pixels). */
  battle(doc: MapDoc, opts?: BattleRenderOpts): Promise<Uint8ClampedArray>;
  /** Detailed terrain for a regional map of part of this map. */
  regional(doc: MapDoc, plan: RegionalPlan, seed: number): Promise<Float32Array>;
  /** Start preparing for paint() in the background (e.g. when a map opens). */
  warm(doc: MapDoc): void;
  /** A city map's picture (core renderCity), at most `maxSize` px a side, its roofs from the decoded asset-pack pictures given. */
  city(doc: MapDoc, opts: { maxSize: number; roofTiles?: Record<string, TileData> }): Promise<RGBAImage>;
  /** Read buildings out of a picture (the city picture reader, core cityReader.ts). `key` names the picture, so asking again about the same one doesn't decode it again. */
  readPicture(key: string, bytes: Uint8Array, opts: ReaderOptions): Promise<ReadResult>;
  /** The reader for streets or water (or buildings), the same way. */
  readPictureAs(key: string, bytes: Uint8Array, job: ReadJob): Promise<ReadAnswer>;
  /** Valleys carved along these rivers (core carve.ts): new heights, the map itself is not changed. */
  carve(doc: MapDoc, rivers: RiverPath[], opts: CarveOptions): Promise<CarveResult>;
  /** One lake drained (core terrainDrain.ts drainLakeAt): the new heights of the whole map and what was done; the map itself is not changed. */
  drain(doc: MapDoc, x: number, y: number, opts: { mode?: "auto" | "outlet" | "fill"; maxCutM?: number }): Promise<DrainLakeResult & { heights: Float32Array }>;
  /** An asset pack's picture made ready to draw (a floor or roof tile, an object at a scale: core shrinkPicture); null when it can't be read. */
  shrinkPicture(bytes: Uint8Array, job: ShrinkJob): Promise<ShrunkPicture | null>;
  /** A small PNG of a picture, at most `max` px a side, and the picture's own size (the asset library's thumbnails); null when it can't be read. */
  thumbnail(bytes: Uint8Array, max: number): Promise<Thumbnail | null>;
  /** What an asset picture is from its pixels (core pictureKindHint): for the pictures whose names say nothing. */
  pictureKind(bytes: Uint8Array): Promise<PictureKindHint | null>;
  /** A picture (PNG, JPEG, WebP) as RGBA, or null when it isn't one that can be read; a picture over PICTURE_MAX_PIXELS is refused with a message. */
  decodePicture(bytes: Uint8Array): Promise<RGBAImage | null>;
  /** A reference picture as a JPEG no bigger than `maxPx` a side (a part of it with `region`), and its size (tools images.ts prepareReference). */
  preparePicture(bytes: Uint8Array, maxPx: number, region?: { x: number; y: number; w: number; h: number }): Promise<PreparedReference | null>;
  close(): Promise<void>;
}

/** Options for a battlemap render, including the decoded pack textures and object images it needs. */
export interface BattleRenderOpts {
  overlay?: boolean;
  lights?: boolean;
  /** Draw the numbered notes (previews only: they are the DM's, so never in an export). */
  notes?: boolean;
  /** The secret doors' gold marks and the invisible walls' dashed lines (on unless false: pictures for players leave them out). */
  dmMarks?: boolean;
  tiles?: Record<number, TileData>;
  sprites?: Record<string, SpriteData>;
  /** Draw the roofs over everything at this opacity (previews). */
  roofs?: number;
  /** Return only the roofs' own pictures, one after the other (each a Foundry tile): see `renderBattleRoofPictures`. */
  roofPictures?: boolean;
  /** The decoded pictures of asset-pack roofs, by asset id. */
  roofTiles?: Record<string, TileData>;
  /** The decoded pictures of asset-pack walls (their own aspect), by asset id. */
  wallPictures?: Record<string, SpriteData>;
}

/** A thumbnail: a small PNG, and the size of the picture it was made from. */
export interface Thumbnail { png: Uint8Array; w: number; h: number }
/** What the pixels say a picture is (core pictureKindHint). */
export type PictureKindHint = "terrain" | "objects";

/** A picture made small (box filter, never enlarged) and written as PNG with its see-through parts. */
export function thumbnailOf(bytes: Uint8Array, max: number): Thumbnail | null {
  const img = decodeImage(bytes);
  if (!img) return null;
  const k = Math.min(1, max / Math.max(img.w, img.h));
  const w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const data = k < 1 ? boxResize(img.data, img.w, img.h, w, h) : img.data;
  return { png: encodePngRgba({ w, h, data }), w: img.w, h: img.h };
}

// ------------------------------------------------------------------ shared job runner
export type Job =
  | { op: "derive"; W: number; H: number; heights: Float32Array; meta: MapMeta; regions?: ClimateRegion[]; baseClimate?: BaseClimate; inflows?: RiverInflow[]; seq: number }
  | { op: "regional"; W: number; H: number; heights: Float32Array; meta: MapMeta; plan: RegionalPlan; seed: number }
  | { op: "paint"; W: number; H: number; heights: Float32Array; meta: MapMeta; derived: Derived }
  | ({ op: "battle"; W: number; H: number; heights: Float32Array; meta: MapMeta; features: Features } & BattleRenderOpts)
  | { op: "warm"; W: number; H: number; seed: number }
  | { op: "read"; key: string; bytes: Uint8Array; opts: ReaderOptions }
  | { op: "read_as"; key: string; bytes: Uint8Array; job: ReadJob }
  | { op: "city"; W: number; H: number; heights: Float32Array; meta: MapMeta; features: Features; maxSize: number; roofTiles?: Record<string, TileData> }
  | { op: "carve"; W: number; H: number; heights: Float32Array; meta: MapMeta; rivers: RiverPath[]; opts: CarveOptions }
  | { op: "drain"; W: number; H: number; heights: Float32Array; meta: MapMeta; x: number; y: number; opts: { mode?: "auto" | "outlet" | "fill"; maxCutM?: number } }
  | { op: "decode"; bytes: Uint8Array }
  | { op: "thumb"; bytes: Uint8Array; max: number }
  | { op: "shrink"; bytes: Uint8Array; job: ShrinkJob }
  | { op: "look"; bytes: Uint8Array }
  | { op: "reference"; bytes: Uint8Array; maxPx: number; region?: { x: number; y: number; w: number; h: number } };

const same = (n: { W: number; H: number; seed: number } | null, W: number, H: number, seed: number) => !!n && n.W === W && n.H === H && n.seed >>> 0 === seed >>> 0;

/** Somewhere to keep the texture noise between launches (see NoiseStore). */
export interface NoiseStorage {
  read(W: number, H: number, seed: number): NoiseCache | null;
  write(c: NoiseCache): void;
}

/**
 * Runs jobs, keeping noise per (size, seed): the cheap climate fields for derive, the full
 * texture noise (seconds to build on big maps) only for painting.
 */
export class JobRunner {
  private full: NoiseCache | null = null;
  private climate: ClimateNoise | null = null;
  /** The last picture read (decoding a big one takes a second or two: reading it again with other samples shouldn't). */
  private pic: { key: string; img: RGBAImage } | null = null;

  constructor(private storage?: NoiseStorage) {}

  /** The full texture noise: from disk if it was kept there (milliseconds), else worked out (about 10 s on a 2048 map) and kept for next time. */
  private fullNoise(W: number, H: number, seed: number) {
    if (!same(this.full, W, H, seed)) {
      this.full = this.storage?.read(W, H, seed) ?? null;
      if (!this.full) {
        this.full = buildNoiseCache(W, H, seed);
        try { this.storage?.write(this.full); } catch (e) { console.error("Couldn't keep the texture noise on disk:", (e as Error).message); }
      }
    }
    return this.full!;
  }

  private climateNoise(W: number, H: number, seed: number): ClimateNoise {
    if (same(this.full, W, H, seed)) return this.full!;
    if (!same(this.climate, W, H, seed)) this.climate = buildClimateNoise(W, H, seed);
    return this.climate!;
  }

  run(job: Job): Derived | Uint8ClampedArray | Float32Array | ReadResult | ReadAnswer | RGBAImage | CarveResult | (DrainLakeResult & { heights: Float32Array }) | PreparedReference | Thumbnail | ShrunkPicture | PictureKindHint | null {
    if (job.op === "decode") return decodeImage(job.bytes);
    if (job.op === "thumb") return thumbnailOf(job.bytes, job.max);
    if (job.op === "shrink") { const img = decodeImage(job.bytes); return img ? shrinkPicture(img, job.job) : null; }
    if (job.op === "look") { const img = decodeImage(job.bytes); return img ? pictureKindHint(img) : null; }
    if (job.op === "reference") return prepareReference(job.bytes, job.maxPx, job.region);
    if (job.op === "carve") return carveValleys(job.heights, job.W, job.H, job.meta.seaLevel, job.rivers, job.opts);
    if (job.op === "drain") { const h = job.heights.slice(); return { ...drainLakeAt(h, job.W, job.H, job.meta.seaLevel, job.x, job.y, job.opts), heights: h }; }
    if (job.op === "city") {
      const tiles = job.roofTiles;
      return renderCity({ meta: job.meta, height: new HeightField(job.W, job.H, job.heights), features: job.features }, { maxSize: job.maxSize, ...(tiles && { tileFor: (a: string) => tiles[a] ?? null }) }).img;
    }
    if (job.op === "read" || job.op === "read_as") {
      if (this.pic?.key !== job.key) {
        const img = decodeImage(job.bytes);
        if (!img) throw new Error("The trace picture couldn't be read as a picture.");
        this.pic = { key: job.key, img };
      }
      if (job.op === "read") return readBuildings(this.pic.img, job.opts);
      const j = job.job;
      return j.what === "streets" ? readStreets(this.pic.img, j.opts) : j.what === "water" ? readWater(this.pic.img, j.opts) : readBuildings(this.pic.img, j.opts);
    }
    if (job.op === "warm") {
      this.fullNoise(job.W, job.H, job.seed);
      return null;
    }
    if (job.op === "regional") {
      return regionalHeights(new HeightField(job.W, job.H, job.heights), job.plan, job.meta.seaLevel, job.seed).data;
    }
    if (job.op === "battle") {
      const bdoc: MapDoc = { meta: job.meta, height: new HeightField(job.W, job.H, job.heights), features: job.features };
      const { tiles, sprites, roofTiles, wallPictures } = job;
      const tileFor = roofTiles ? (a: string) => roofTiles[a] ?? null : undefined;
      if (job.roofPictures) return renderBattleRoofPictures(bdoc, tileFor);
      return renderBattle(bdoc, {
        overlay: job.overlay, lights: job.lights, notes: job.notes, roofs: job.roofs, roofTiles: tileFor, dmMarks: job.dmMarks,
        ...(wallPictures && { wallPictures: (a: string) => wallPictures[a] ?? null }),
        ...(tiles && { tiles: (id: number) => tiles[id] ?? null }), ...(sprites && { sprites: (id: string) => sprites[id] ?? null }),
      }).data;
    }
    const doc: MapDoc = {
      meta: job.meta, height: new HeightField(job.W, job.H, job.heights),
      ...(job.op === "derive" && job.regions && { features: { places: [], labels: [], regions: job.regions } }),
      ...(job.op === "derive" && job.baseClimate && { baseClimate: job.baseClimate }),
    };
    if (job.op === "derive") return computeDerived(doc, this.climateNoise(job.W, job.H, job.meta.seed), job.seq, { inflows: job.inflows });
    const out = new Uint8ClampedArray(job.W * job.H * 4);
    renderPainted(doc, job.derived, this.fullNoise(job.W, job.H, job.meta.seed), null, out);
    return out;
  }
}

const snapshot = (doc: MapDoc) => ({ W: doc.height.w, H: doc.height.h, heights: new Float32Array(doc.height.data), meta: structuredClone(doc.meta) });
const regionsOf = (doc: MapDoc) => (doc.features?.regions?.length ? structuredClone(doc.features.regions) : undefined);
const inflowsOf = (doc: MapDoc) => { const r = resolveRiverSources(doc.features); return r.length ? r : undefined; };

/** Same thread (tests, tools). */
export class InlineCompute implements MapCompute {
  private runner: JobRunner;
  constructor(storage?: NoiseStorage) {
    this.runner = new JobRunner(storage);
  }
  async derive(doc: MapDoc, seq: number) {
    return this.runner.run({ op: "derive", ...snapshot(doc), regions: regionsOf(doc), baseClimate: doc.baseClimate, inflows: inflowsOf(doc), seq }) as Derived;
  }
  async regional(doc: MapDoc, plan: RegionalPlan, seed: number) {
    return this.runner.run({ op: "regional", ...snapshot(doc), plan, seed }) as Float32Array;
  }
  async paint(doc: MapDoc, d: Derived) {
    return this.runner.run({ op: "paint", ...snapshot(doc), derived: d }) as Uint8ClampedArray;
  }
  async battle(doc: MapDoc, opts: BattleRenderOpts = {}) {
    return this.runner.run({ op: "battle", ...snapshot(doc), features: structuredClone(doc.features ?? { places: [], labels: [] }), ...opts }) as Uint8ClampedArray;
  }
  warm() {}
  async city(doc: MapDoc, opts: { maxSize: number; roofTiles?: Record<string, TileData> }) {
    return this.runner.run({ op: "city", ...snapshot(doc), features: structuredClone(doc.features ?? { places: [], labels: [] }), ...opts }) as RGBAImage;
  }
  async readPicture(key: string, bytes: Uint8Array, opts: ReaderOptions) {
    return this.runner.run({ op: "read", key, bytes, opts }) as ReadResult;
  }
  async readPictureAs(key: string, bytes: Uint8Array, job: ReadJob) {
    return this.runner.run({ op: "read_as", key, bytes, job }) as ReadAnswer;
  }
  async carve(doc: MapDoc, rivers: RiverPath[], opts: CarveOptions) {
    return this.runner.run({ op: "carve", ...snapshot(doc), rivers, opts }) as CarveResult;
  }

  async drain(doc: MapDoc, x: number, y: number, opts: { mode?: "auto" | "outlet" | "fill"; maxCutM?: number }) {
    return this.runner.run({ op: "drain", ...snapshot(doc), x, y, opts }) as DrainLakeResult & { heights: Float32Array };
  }
  async decodePicture(bytes: Uint8Array): Promise<RGBAImage | null> {
    return decodeImage(bytes);
  }

  async thumbnail(bytes: Uint8Array, max: number): Promise<Thumbnail | null> {
    return thumbnailOf(bytes, max);
  }

  async pictureKind(bytes: Uint8Array): Promise<PictureKindHint | null> {
    const img = decodeImage(bytes);
    return img ? pictureKindHint(img) : null;
  }

  async shrinkPicture(bytes: Uint8Array, job: ShrinkJob): Promise<ShrunkPicture | null> {
    const img = decodeImage(bytes);
    return img ? shrinkPicture(img, job) : null;
  }

  async preparePicture(bytes: Uint8Array, maxPx: number, region?: { x: number; y: number; w: number; h: number }): Promise<PreparedReference | null> {
    return prepareReference(bytes, maxPx, region);
  }

  async close() {}
}

export function derivedBuffers(d: Derived): ArrayBuffer[] {
  return [d.temp, d.moist, d.seaDist, d.landDist, d.lakes, d.snow, ...(d.rock ? [d.rock] : []), ...(d.volcanic ? [d.volcanic] : [])].map((a) => a.buffer as ArrayBuffer);
}

/** One worker thread running jobs in order. */
class JobWorker {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  dead = false;

  constructor(noiseDir?: string) {
    this.worker = new Worker(new URL("./computeWorker.mjs", import.meta.url), { workerData: { noiseDir: noiseDir ?? null } });
    this.worker.unref();
    this.worker.on("message", (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (this.pending.size === 0) this.worker.unref();
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error));
    });
    this.worker.on("error", (e: Error) => {
      console.error("Map compute worker stopped; continuing on the main thread.", e);
      this.dead = true;
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    });
  }

  call<T>(job: Job, transfer: ArrayBuffer[] = []): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.ref();
      this.worker.postMessage({ id, job }, transfer);
    });
  }

  terminate() {
    return this.worker.terminate();
  }
}

/**
 * Two worker threads: one for climate/rivers (quick, after every edit) and one for painting
 * (holds the big texture noise). Falls back to the main thread if a worker dies.
 */
export class WorkerCompute implements MapCompute {
  private deriver: JobWorker;
  private painter: JobWorker;
  private inline: InlineCompute;

  /** `noiseDir`: the cache folder where the texture noise is kept between launches (none: it is worked out each time). */
  constructor(noiseDir?: string) {
    this.deriver = new JobWorker(noiseDir);
    this.painter = new JobWorker(noiseDir);
    this.inline = new InlineCompute(noiseDir ? new NoiseStore(noiseDir) : undefined);
  }

  derive(doc: MapDoc, seq: number): Promise<Derived> {
    if (this.deriver.dead) return this.inline.derive(doc, seq);
    const s = snapshot(doc);
    return this.deriver.call<Derived>({ op: "derive", ...s, regions: regionsOf(doc), baseClimate: doc.baseClimate, inflows: inflowsOf(doc), seq }, [s.heights.buffer as ArrayBuffer]);
  }

  regional(doc: MapDoc, plan: RegionalPlan, seed: number): Promise<Float32Array> {
    if (this.painter.dead) return this.inline.regional(doc, plan, seed);
    const s = snapshot(doc);
    return this.painter.call<Float32Array>({ op: "regional", ...s, plan, seed }, [s.heights.buffer as ArrayBuffer]);
  }

  paint(doc: MapDoc, d: Derived): Promise<Uint8ClampedArray> {
    if (this.painter.dead) return this.inline.paint(doc, d);
    const s = snapshot(doc);
    // derived layers are copied (structured clone): the hub keeps using its own
    return this.painter.call<Uint8ClampedArray>({ op: "paint", ...s, derived: d }, [s.heights.buffer as ArrayBuffer]);
  }

  battle(doc: MapDoc, opts: BattleRenderOpts = {}): Promise<Uint8ClampedArray> {
    if (this.painter.dead) return this.inline.battle(doc, opts);
    const s = snapshot(doc);
    return this.painter.call<Uint8ClampedArray>({ op: "battle", ...s, features: structuredClone(doc.features ?? { places: [], labels: [] }), ...opts }, [s.heights.buffer as ArrayBuffer]);
  }

  city(doc: MapDoc, opts: { maxSize: number; roofTiles?: Record<string, TileData> }): Promise<RGBAImage> {
    if (this.painter.dead) return this.inline.city(doc, opts);
    const s = snapshot(doc);
    return this.painter.call<RGBAImage>({ op: "city", ...s, features: structuredClone(doc.features ?? { places: [], labels: [] }), ...opts }, [s.heights.buffer as ArrayBuffer]);
  }

  // (pictures are read on the painter's thread: a big one takes a second or more, and the climate thread runs after every edit)
  decodePicture(bytes: Uint8Array): Promise<RGBAImage | null> {
    if (this.painter.dead) return this.inline.decodePicture(bytes);
    const copy = bytes.slice(); // (sent over, not shared: the caller keeps its own)
    return this.painter.call<RGBAImage | null>({ op: "decode", bytes: copy }, [copy.buffer as ArrayBuffer]);
  }

  shrinkPicture(bytes: Uint8Array, job: ShrinkJob): Promise<ShrunkPicture | null> {
    if (this.painter.dead) return this.inline.shrinkPicture(bytes, job);
    const copy = bytes.slice();
    return this.painter.call<ShrunkPicture | null>({ op: "shrink", bytes: copy, job }, [copy.buffer as ArrayBuffer]);
  }

  thumbnail(bytes: Uint8Array, max: number): Promise<Thumbnail | null> {
    if (this.painter.dead) return this.inline.thumbnail(bytes, max);
    const copy = bytes.slice();
    return this.painter.call<Thumbnail | null>({ op: "thumb", bytes: copy, max }, [copy.buffer as ArrayBuffer]);
  }

  pictureKind(bytes: Uint8Array): Promise<PictureKindHint | null> {
    if (this.painter.dead) return this.inline.pictureKind(bytes);
    const copy = bytes.slice();
    return this.painter.call<PictureKindHint | null>({ op: "look", bytes: copy }, [copy.buffer as ArrayBuffer]);
  }

  preparePicture(bytes: Uint8Array, maxPx: number, region?: { x: number; y: number; w: number; h: number }): Promise<PreparedReference | null> {
    if (this.painter.dead) return this.inline.preparePicture(bytes, maxPx, region);
    const copy = bytes.slice();
    return this.painter.call<PreparedReference | null>({ op: "reference", bytes: copy, maxPx, ...(region && { region }) }, [copy.buffer as ArrayBuffer]);
  }

  readPicture(key: string, bytes: Uint8Array, opts: ReaderOptions): Promise<ReadResult> {
    if (this.painter.dead) return this.inline.readPicture(key, bytes, opts);
    return this.painter.call<ReadResult>({ op: "read", key, bytes, opts }, [bytes.buffer as ArrayBuffer]);
  }

  readPictureAs(key: string, bytes: Uint8Array, job: ReadJob): Promise<ReadAnswer> {
    if (this.painter.dead) return this.inline.readPictureAs(key, bytes, job);
    return this.painter.call<ReadAnswer>({ op: "read_as", key, bytes, job }, [bytes.buffer as ArrayBuffer]);
  }

  drain(doc: MapDoc, x: number, y: number, opts: { mode?: "auto" | "outlet" | "fill"; maxCutM?: number }): Promise<DrainLakeResult & { heights: Float32Array }> {
    if (this.painter.dead) return this.inline.drain(doc, x, y, opts);
    const s = snapshot(doc);
    return this.painter.call<DrainLakeResult & { heights: Float32Array }>({ op: "drain", ...s, x, y, opts }, [s.heights.buffer as ArrayBuffer]);
  }

  carve(doc: MapDoc, rivers: RiverPath[], opts: CarveOptions): Promise<CarveResult> {
    if (this.painter.dead) return this.inline.carve(doc, rivers, opts);
    const s = snapshot(doc);
    return this.painter.call<CarveResult>({ op: "carve", ...s, rivers, opts }, [s.heights.buffer as ArrayBuffer]);
  }

  warm(doc: MapDoc) {
    if (this.painter.dead) return;
    this.painter.call({ op: "warm", W: doc.height.w, H: doc.height.h, seed: doc.meta.seed }).catch(() => {});
  }

  async close() {
    await Promise.all([this.deriver.terminate(), this.painter.terminate()]);
  }
}
