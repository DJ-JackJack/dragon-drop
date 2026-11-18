import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "mapmaker-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("saving and loading maps", () => {
  it("saves the map as it was when save() was called, even if it is edited while the file is being written", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Race", width: 512, height: 512, kmPerPx: 4 });
    doc.height.data.fill(111);
    const saving = store.save(doc);
    doc.height.data.fill(999); // an edit lands while the compression runs in the background
    doc.meta.name = "Changed meanwhile";
    await saving;
    const back = await store.load(doc.meta.id);
    expect(back.height.data[0]).toBe(111);
    expect(back.height.data[512 * 512 - 1]).toBe(111);
    expect(new Set(back.height.data).size).toBe(1); // not a mix of the two states
    expect(back.meta.name).toBe("Race");
    await store.save(doc);
    expect((await store.load(doc.meta.id)).height.data[10]).toBe(999);
  });

  it("does not stall the rest of the server while a big map is saved", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Big", width: 2048, height: 2048, kmPerPx: 4 });
    for (let i = 0; i < doc.height.data.length; i++) doc.height.data[i] = Math.sin(i * 0.0007) * 800 + (i % 97);
    let worst = 0, last = performance.now();
    const timer = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; }, 5);
    await new Promise((r) => setTimeout(r, 30));
    worst = 0;
    await store.save(doc);
    clearInterval(timer);
    // a synchronous gzip of 17 MB held the event loop for about half a second; this only copies the map first
    expect(worst).toBeLessThan(150);
    expect((await store.load(doc.meta.id)).height.data[12345]).toBe(doc.height.data[12345]);
  }, 60000);

  it("keeps checkpoints consistent with the moment they were taken", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Cp", width: 256, height: 256, kmPerPx: 4 });
    doc.height.data.fill(5);
    const saving = store.saveCheckpoint(doc.meta.id, "before", doc, 1);
    doc.height.data.fill(6);
    await saving;
    const cp = await store.readCheckpoint(doc.meta.id, "before");
    expect(cp && new Set(cp.data).size).toBe(1);
    expect(cp!.data[0]).toBe(5);
  });
});
