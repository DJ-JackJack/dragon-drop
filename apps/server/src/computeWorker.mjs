// Worker entry: load TypeScript through tsx (works under `tsx`, plain node and vitest alike).
import { register } from "tsx/esm/api";

register();
await import("./computeWorker.ts");
