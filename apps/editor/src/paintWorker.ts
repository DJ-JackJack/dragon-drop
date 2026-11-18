/// <reference lib="webworker" />
// Paints the map off the main thread. It holds its own copy of the heights, the climate layers and the texture noise (about 130 MB on a 2048 map,
// none of it on the main thread); the editor sends it changes and draws the pixels that come back. The painting itself is core's PaintEngine.
import {
  type NoiseBand, type PaintView, type Rect, type RiverPath, PaintEngine, TILE_AREA_LIMIT, deserializeNoise, mergeNoiseBands, serializeNoise, unpackDerived,
} from "@mapmaker/core";

export type PaintIn =
  /** A new map (or a reopened one): the worker paints a quick preview of these heights at once, and fetches the map's noise from the server (`noiseQuery`). */
  | { t: "init"; gen: number; W: number; H: number; heights: Float32Array; view: PaintView; noiseQuery: string }
  /** The texture noise worked out in bands by several workers (the server had none). */
  | { t: "bands"; gen: number; bands: NoiseBand[] }
  | { t: "patch"; gen: number; rect: Rect; data: Float32Array; view: PaintView }
  /** A climate frame as received from the server: the layers start at `offset`. */
  | { t: "derived"; gen: number; buf: ArrayBuffer; offset: number; length: number; W: number; H: number; seq: number; rivers: RiverPath[]; view: PaintView }
  /** Repaint an area, or the whole map (rect null) after a change of style or settings. */
  | { t: "repaint"; gen: number; rect: Rect | null; view: PaintView };

export type PaintOut =
  | { t: "pixels"; gen: number; rect: Rect; data: Uint8ClampedArray }
  | { t: "status"; gen: number; text: string | null }
  /** The server has no usable noise for this map: please work it out and send it as bands. */
  | { t: "needBands"; gen: number }
  /** Freshly built noise as a file, for the server to keep (a separate thread uploads it). */
  | { t: "noiseBytes"; gen: number; buf: ArrayBuffer };

let engine: PaintEngine | null = null;
let gen = 0;
let view: PaintView | null = null;
/** Bumped to cancel the whole-map repaint in progress (it also numbers repaints). */
let token = 0;
let running = false;
let lastStatus: string | null | undefined;

const post = (m: PaintOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // lets queued messages (a brush stroke's tile) run between bands

function statusNow(): string | null {
  if (!engine || !view) return null;
  if (view.mode === "painted") {
    if (!engine.noise) return "Preparing painted style…";
    if (!engine.derived) return "Waiting for climate and rivers…";
  }
  return running ? "Painting…" : null;
}

function reportStatus() {
  const text = statusNow();
  if (text !== lastStatus) { lastStatus = text; post({ t: "status", gen, text }); }
}

const grow = (r: Rect): Rect => ({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });

function tileOf(rect: Rect) {
  if (!engine || !view) return;
  const px = engine.tile(rect, view);
  if (px) post({ t: "pixels", gen, rect: px.rect, data: px.data }, [px.data.buffer]);
}

/** Repaint the whole map band by band; a newer request (or a new map) cancels this one. */
async function runFull() {
  if (!engine || !view) return;
  const mine = ++token, g = gen, eng = engine;
  running = true;
  reportStatus();
  try {
    for (const px of eng.slices(view)) {
      if (mine !== token || g !== gen) return;
      post({ t: "pixels", gen: g, rect: px.rect, data: px.data }, [px.data.buffer]);
      await tick();
      if (mine !== token || g !== gen) return;
    }
  } finally {
    if (mine === token) { running = false; reportStatus(); }
  }
}

/** The server's copy of the noise (80 MB on a 2048 map: fetched here so the main thread never touches it). */
async function loadNoise(g: number, query: string) {
  try {
    const r = await fetch(`/api/noise?${query}`, { cache: "no-store" });
    if (r.ok) {
      const buf = await r.arrayBuffer();
      if (g !== gen || !engine) return;
      const n = deserializeNoise(buf);
      if (n && n.W === engine.W && n.H === engine.H) { engine.setNoise(n); noiseArrived(); return; }
    }
  } catch { /* no server copy */ }
  if (g === gen) post({ t: "needBands", gen: g });
}

function noiseArrived() {
  if (engine?.paintedReady()) void runFull();
  else reportStatus();
}

self.onmessage = (e: MessageEvent<PaintIn>) => {
  const m = e.data;
  if (m.t === "init") {
    gen = m.gen; view = m.view; token++; running = false; lastStatus = undefined;
    engine = new PaintEngine(m.W, m.H, m.heights);
    void runFull(); // not ready for the painted style yet, so this is the quick preview
    void loadNoise(m.gen, m.noiseQuery);
    return;
  }
  if (!engine || m.gen !== gen) return; // for a map that is no longer open
  if ("view" in m) view = m.view;
  switch (m.t) {
    case "bands": {
      const n = mergeNoiseBands(m.bands);
      engine.setNoise(n);
      noiseArrived();
      { const buf = serializeNoise(n); post({ t: "noiseBytes", gen, buf }, [buf]); } // for the server to keep (painting has been started)
      break;
    }
    case "patch": {
      engine.patch(m.rect, m.data);
      tileOf(grow(m.rect));
      if (running) void runFull(); // a whole-map pass in progress was working from the old heights: start it again
      break;
    }
    case "derived": {
      let change;
      try { change = engine.setDerived(unpackDerived(new Uint8Array(m.buf, m.offset, m.length), m.W, m.H, m.seq, m.rivers)); } catch { break; }
      if (!engine.noise) { reportStatus(); break; } // the painted style comes when the noise does
      if (change === "all" || (change !== "none" && change.w * change.h > TILE_AREA_LIMIT)) void runFull();
      else if (change !== "none") tileOf(grow(change)); // (a pass in progress paints the rest with the new layers)
      else reportStatus();
      break;
    }
    case "repaint": {
      if (m.rect) tileOf(m.rect);
      else void runFull();
      break;
    }
  }
};
