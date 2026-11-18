/** Worker-thread side of WorkerCompute: runs map jobs off the server's main thread. */
import { parentPort, workerData } from "node:worker_threads";
import type { Derived } from "@mapmaker/core";
import { type Job, JobRunner, derivedBuffers } from "./compute.ts";
import { NoiseStore } from "./noiseStore.ts";

const noiseDir = (workerData as { noiseDir?: string | null } | null)?.noiseDir;
const runner = new JobRunner(noiseDir ? new NoiseStore(noiseDir) : undefined);

parentPort!.on("message", ({ id, job }: { id: number; job: Job }) => {
  try {
    const value = runner.run(job);
    const transfer = value === null ? []
      : value instanceof Uint8ClampedArray || value instanceof Float32Array ? [value.buffer as ArrayBuffer]
      : derivedBuffers(value as Derived);
    parentPort!.postMessage({ id, ok: true, value }, transfer);
  } catch (e) {
    parentPort!.postMessage({ id, ok: false, error: (e as Error).stack ?? String(e) });
  }
});
