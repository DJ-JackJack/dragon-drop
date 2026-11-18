/// <reference lib="webworker" />
// Builds rows [y0, y1) of the Painted Relief texture-noise cache off the main thread.
// The map view runs several of these at once and stitches the bands together.
import { buildNoiseBand, noiseCacheBuffers } from "@mapmaker/core";

self.onmessage = (e: MessageEvent<{ W: number; H: number; seed: number; y0: number; y1: number }>) => {
  const { W, H, seed, y0, y1 } = e.data;
  const band = buildNoiseBand(W, H, seed, y0, y1);
  (self as unknown as Worker).postMessage(band, noiseCacheBuffers(band));
};
