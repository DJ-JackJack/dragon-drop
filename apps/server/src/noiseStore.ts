/**
 * The texture noise of a map, kept on disk (in the cache folder) so it isn't worked out again at every launch: about 10 s of CPU on a 2048 map,
 * and 80 MB of data. One file per (size, seed); only the newest few are kept. Files are written whole and renamed into place, so a crash can't
 * leave a half-written one, and a file is only ever used if its header, version and length are exactly right.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type NoiseCache, deserializeNoise, noiseFileName, noiseFileSize, readNoiseHeader, serializeNoise } from "@mapmaker/core";

/** How many noise files to keep (each is 80 MB for a 2048 map). */
const KEEP = 4;
/** Sizes worth caching (the editor and tools use 128..4096). */
export const NOISE_MIN_SIDE = 64;
export const NOISE_MAX_SIDE = 4096;

export class NoiseStore {
  constructor(readonly dir: string) {}

  private folder() {
    return path.join(this.dir, "noise");
  }

  file(W: number, H: number, seed: number): string {
    return path.join(this.folder(), noiseFileName(W, H, seed));
  }

  has(W: number, H: number, seed: number): boolean {
    return existsSync(this.file(W, H, seed));
  }

  /** The size of the file for this map in bytes, or null if there isn't a good one. */
  size(W: number, H: number, seed: number): number | null {
    try {
      const n = statSync(this.file(W, H, seed)).size;
      return n === noiseFileSize(W, H) ? n : null;
    } catch {
      return null;
    }
  }

  /** The noise for this map, or null (no file, an old one, a damaged one). Synchronous: it runs inside the compute worker. */
  read(W: number, H: number, seed: number): NoiseCache | null {
    try {
      const b = readFileSync(this.file(W, H, seed));
      const c = deserializeNoise(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
      return c && c.W === W && c.H === H && c.seed >>> 0 === seed >>> 0 ? c : null;
    } catch {
      return null;
    }
  }

  write(c: NoiseCache): void {
    this.writeBytes(c.W, c.H, c.seed, new Uint8Array(serializeNoise(c)));
  }

  /** Store a noise file for this map (checked: it must be a current noise file for exactly this size and seed). */
  writeBytes(W: number, H: number, seed: number, bytes: Uint8Array): void {
    const head = readNoiseHeader(bytes);
    if (!head || head.W !== W || head.H !== H || head.seed >>> 0 !== seed >>> 0) throw new Error("That isn't the noise for this map.");
    mkdirSync(this.folder(), { recursive: true });
    const dest = this.file(W, H, seed);
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
    this.prune();
  }

  /** Keep the newest few files and drop the rest (and any leftovers of interrupted writes). */
  prune(keep = KEEP): void {
    try {
      const dir = this.folder();
      const files = readdirSync(dir).map((name) => ({ name, full: path.join(dir, name), time: statSync(path.join(dir, name)).mtimeMs }));
      const now = Date.now();
      for (const f of files) if (f.name.endsWith(".tmp") && now - f.time > 3_600_000) unlinkSync(f.full);
      files.filter((f) => f.name.endsWith(".bin")).sort((a, b) => b.time - a.time).slice(keep).forEach((f) => unlinkSync(f.full));
    } catch { /* best effort */ }
  }
}
