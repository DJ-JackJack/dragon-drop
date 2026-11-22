/** Worker-thread side of WorkerCompute: runs map jobs off the server's main thread. */
import { parentPort, workerData } from "node:worker_threads";
import type { CarveResult, Derived, RGBAImage } from "@mapmaker/core";
import { type Job, JobRunner, derivedBuffers } from "./compute.ts";
import { NoiseStore } from "./noiseStore.ts";

const noiseDir = (workerData as { noiseDir?: string | null } | null)?.noiseDir;
const runner = new JobRunner(noiseDir ? new NoiseStore(noiseDir) : undefined);

parentPort!.on("message", ({ id, job }: { id: number; job: Job }) => {
  try {
    const value = runner.run(job);
    // (map data hands its buffers back; the picture reader's answer is a plain object, copied)
    const transfer = value === null || job.op === "read" || job.op === "read_as" ? []
      : job.op === "city" ? [(value as RGBAImage).data.buffer as ArrayBuffer]
      : job.op === "carve" || job.op === "drain" ? [(value as CarveResult).heights.buffer as ArrayBuffer]
      : value instanceof Uint8ClampedArray || value instanceof Float32Array ? [value.buffer as ArrayBuffer]
      : derivedBuffers(value as Derived);
    parentPort!.postMessage({ id, ok: true, value }, transfer);
  } catch (e) {
    parentPort!.postMessage({ id, ok: false, error: (e as Error).stack ?? String(e) });
  }
});
