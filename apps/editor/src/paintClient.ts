/**
 * The main thread's side of painting: it sends the paint worker what changes and hands back the pixels it paints.
 * The texture noise comes from the server's copy on disk when there is one (the paint worker fetches it itself, so this thread never touches those
 * 80 MB); otherwise this builds it on several threads as before, and a worker of its own keeps a copy on the server for the next launch.
 */
import { type NoiseBand, type PaintView, type Rect, noiseCacheBuffers } from "@mapmaker/core";
import type { PaintIn, PaintOut } from "./paintWorker.ts";
import type { DerivedFrame } from "./store.ts";

export interface PaintClientEvents {
  pixels(rect: Rect, data: Uint8ClampedArray): void;
  status(text: string | null): void;
}

export class PaintClient {
  private worker = new Worker(new URL("./paintWorker.ts", import.meta.url), { type: "module" });
  private gen = 0;
  private opened = false;
  private pool: Worker[] = [];
  /** Climate layers that arrived before the map was opened here. */
  private waiting: { frame: DerivedFrame; view: PaintView } | null = null;
  private map: { W: number; H: number; seed: number } | null = null;

  constructor(private events: PaintClientEvents) {
    this.worker.onmessage = (e: MessageEvent<PaintOut>) => {
      const m = e.data;
      if (m.gen !== this.gen) return; // from a map that is no longer open
      if (m.t === "pixels") this.events.pixels(m.rect, m.data);
      else if (m.t === "status") this.events.status(m.text);
      else if (m.t === "needBands") void this.buildHere();
      else if (m.t === "noiseBytes") this.keepOnServer(m.buf);
    };
  }

  private post(m: PaintIn, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  /** Open a map: the worker paints a quick preview at once and fetches the noise for the painted style. `heights` is handed over (copy it first). */
  setMap(W: number, H: number, seed: number, heights: Float32Array, view: PaintView) {
    this.stopPool();
    this.gen++;
    this.opened = true;
    this.map = { W, H, seed };
    this.post({ t: "init", gen: this.gen, W, H, heights, view, noiseQuery: this.query() }, [heights.buffer]);
    if (this.waiting) { const w = this.waiting; this.waiting = null; this.derived(w.frame, w.view); }
  }

  patch(rect: Rect, data: Float32Array, view: PaintView) {
    if (this.opened) this.post({ t: "patch", gen: this.gen, rect, data, view }, [data.buffer]);
  }

  derived(frame: DerivedFrame, view: PaintView) {
    if (!this.opened) { this.waiting = { frame, view }; return; }
    this.post({ t: "derived", gen: this.gen, buf: frame.buf, offset: frame.offset, length: frame.length, W: frame.W, H: frame.H, seq: frame.seq, rivers: frame.rivers, view }, [frame.buf]);
  }

  repaint(rect: Rect | null, view: PaintView) {
    if (this.opened) this.post({ t: "repaint", gen: this.gen, rect, view });
  }

  dispose() {
    this.stopPool();
    this.worker.terminate();
  }

  private query() {
    const m = this.map!;
    return `w=${m.W}&h=${m.H}&seed=${m.seed >>> 0}`;
  }

  /** The server had no noise: work it out on several threads (as the editor always did). */
  private async buildHere() {
    const gen = this.gen, m = this.map;
    if (!m) return;
    const bands = await this.buildBands(m.W, m.H, m.seed);
    if (!bands || gen !== this.gen) return;
    this.post({ t: "bands", gen, bands }, bands.flatMap(noiseCacheBuffers));
  }

  private buildBands(W: number, H: number, seed: number): Promise<NoiseBand[] | null> {
    this.stopPool();
    const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1, Math.ceil(H / 256)));
    const bands: NoiseBand[] = [];
    return new Promise((resolve) => {
      const mine: Worker[] = [];
      for (let k = 0; k < n; k++) {
        const w = new Worker(new URL("./noiseWorker.ts", import.meta.url), { type: "module" });
        w.onmessage = (e: MessageEvent<NoiseBand>) => {
          w.terminate();
          bands.push(e.data);
          if (bands.length === n) { this.pool = this.pool.filter((p) => !mine.includes(p)); resolve(bands); }
        };
        w.onerror = () => { this.stopPool(); resolve(null); };
        w.postMessage({ W, H, seed, y0: Math.round((H * k) / n), y1: Math.round((H * (k + 1)) / n) });
        mine.push(w);
      }
      this.pool.push(...mine);
    }).then((r) => r as NoiseBand[] | null);
  }

  /** Best effort: have the server keep the noise, uploaded by a worker of its own (the bytes never touch this thread). */
  private keepOnServer(buf: ArrayBuffer) {
    try {
      const w = new Worker(new URL("./noiseUploadWorker.ts", import.meta.url), { type: "module" });
      w.postMessage({ url: `/api/noise?${this.query()}`, buf }, [buf]);
    } catch { /* it will be worked out again next time */ }
  }

  private stopPool() {
    for (const w of this.pool) w.terminate();
    this.pool = [];
  }
}
