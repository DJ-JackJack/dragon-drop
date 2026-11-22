// Saving when another program holds a map's file (OneDrive syncing Documents, a virus scanner): a failed save is tried again by itself, with no further edit.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { MapDoc } from "@mapmaker/core";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const dir = mkdtempSync(path.join(tmpdir(), "mapmaker-retry-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A store whose next saves fail as Windows fails them while another program holds the file. */
class HeldStore extends ProjectStore {
  failNext = 0;
  saved = 0;
  override async save(doc: MapDoc): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      const e = new Error("EPERM: operation not permitted, rename") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    }
    await super.save(doc);
    this.saved++; // (counted once it is on disk)
  }
}

describe("a save that fails because a file is held", () => {
  it("is tried again by itself until it works", async () => {
    const store = new HeldStore(dir);
    const hub = new Hub(store, null);
    await hub.createProject({ name: "Held World", width: 64, height: 64, kmPerPx: 2 });
    await hub.flush();
    const before = store.saved;
    store.failNext = 1;
    hub.session.execute({ op: "set_sea_level", levelM: 25 }, "user");
    // the autosave (after 1.5 s) fails; nobody edits again; the retry (2 s later) saves it
    for (let i = 0; i < 120 && store.saved === before; i++) await new Promise((r) => setTimeout(r, 100));
    expect(store.saved).toBeGreaterThan(before);
    expect((await store.load(hub.session.doc.meta.id)).meta.seaLevel).toBe(25);
  }, 20_000);
});
