/** Worker-thread side of WorkerCompute: runs map jobs off the server's main thread. */
import { parentPort, workerData } from "node:worker_threads";
import type { CarveResult, Derived, RGBAImage } from "@mapmaker/core";
import type { PreparedReference } from "@mapmaker/tools";
import { type Job, JobRunner, type Thumbnail, derivedBuffers } from "./compute.ts";
import { NoiseStore } from "./noiseStore.ts";

const noiseDir = (workerData as { noiseDir?: string | null } | null)?.noiseDir;
const runner = new JobRunner(noiseDir ? new NoiseStore(noiseDir) : undefined);

parentPort!.on("message", ({ id, job }: { id: number; job: Job }) => {
  try {
    const value = runner.run(job);
    // (map data hands its buffers back; the picture reader's answer is a plain object, copied)
    const transfer = value === null || job.op === "read" || job.op === "read_as" || job.op === "look" ? []
      : job.op === "city" || job.op === "decode" ? [(value as RGBAImage).data.buffer as ArrayBuffer]
      : job.op === "reference" ? [(value as PreparedReference).jpeg.buffer as ArrayBuffer]
      : job.op === "thumb" ? [(value as Thumbnail).png.buffer as ArrayBuffer]
      : job.op === "shrink" ? [] // (its pixels may be the decoded picture's own, inside a bigger buffer: copied)
      : job.op === "carve" || job.op === "drain" ? [(value as CarveResult).heights.buffer as ArrayBuffer]
      : value instanceof Uint8ClampedArray || value instanceof Float32Array ? [value.buffer as ArrayBuffer]
      : derivedBuffers(value as Derived);
    parentPort!.postMessage({ id, ok: true, value }, transfer);
  } catch (e) {
    // the message only (it can reach the person, and the AI): where in the code it happened goes to the log
    if ((e as Error).stack) console.error((e as Error).stack);
    parentPort!.postMessage({ id, ok: false, error: (e as Error).message ?? String(e) });
  }
});
