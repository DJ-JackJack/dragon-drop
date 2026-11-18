import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Hub, autoBackupName } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "mapmaker-autobackup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { vi.useRealTimers(); });

const noModel = async () => { throw new Error("no model in this test"); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 200): Promise<T> {
  for (let i = 0; ; i++) {
    const v = await fn();
    if (ok(v) || i >= tries) return v; // (counted in tries, not by the clock: one test fakes the date)
    await sleep(25);
  }
}

describe("rolling backups", () => {
  it("names a backup by the local time", () => {
    expect(autoBackupName(new Date(2026, 10, 18, 9, 5))).toBe("Auto 2026-11-18 09:05");
  });

  it("takes one at the first save after an edit, then not again until the interval has passed, and never for the untouched first map", async () => {
    const dir = path.join(root, "a");
    const store = new ProjectStore(dir);
    const hub = new Hub(store, noModel, undefined, { autoBackupMs: 60_000, autoBackupKeep: 3 });
    await hub.ensureProject(); // (makes and saves the generated First Map)
    const id = hub.activeId!;
    await sleep(300);
    expect(await store.listCheckpoints(id), "nobody has touched the first map").toEqual([]);

    // (pretend the last backup was long ago, as it would be on the next day)
    (hub as unknown as { open: { lastAutoBackup: number } }).open.lastAutoBackup = Date.now() - 3_600_000;
    hub.session.execute({ op: "set_sea_level", levelM: 12 }, "user");
    await hub.flush();
    const list = await until(() => store.listCheckpoints(id), (l) => l.length > 0);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ auto: true, note: "Saved automatically" });
    expect(list[0].name).toMatch(/^Auto \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // it is a real restore point: the sea level it holds is the one at that moment
    expect((await store.readCheckpoint(id, list[0].name))!.meta.seaLevel).toBe(12);

    hub.session.execute({ op: "set_sea_level", levelM: 20 }, "user");
    await hub.flush();
    await sleep(300);
    expect(await store.listCheckpoints(id), "too soon for another").toHaveLength(1);
    await hub.close();
  }, 60000);

  it("keeps the newest few and leaves the person's own checkpoints alone", async () => {
    const dir = path.join(root, "b");
    const store = new ProjectStore(dir);
    const hub = new Hub(store, noModel, undefined, { autoBackupMs: 60_000, autoBackupKeep: 2 });
    await hub.ensureProject();
    const id = hub.activeId!;
    await hub.saveCheckpoint("Mine");
    // (only the clock is faked, and set later than the real one: a backup is named by the minute, so the edits are made twenty minutes apart)
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2030, 0, 1, 9, 0) });
    for (let i = 1; i <= 5; i++) {
      vi.setSystemTime(new Date(2030, 0, 1, 9, i * 20));
      hub.session.execute({ op: "set_sea_level", levelM: i }, "user");
      await hub.flush();
      await until(() => store.listCheckpoints(id), (l) => l.filter((c) => c.auto).length >= Math.min(i, 2) && l.some((c) => c.name === autoBackupName(new Date(2030, 0, 1, 9, i * 20))));
    }
    await until(() => store.listCheckpoints(id), (l) => l.filter((c) => c.auto).length === 2);
    const list = await store.listCheckpoints(id);
    expect(list.filter((c) => c.auto).map((c) => c.name), "only the newest two are kept").toEqual(["Auto 2030-01-01 10:20", "Auto 2030-01-01 10:40"]);
    expect(list.some((c) => c.name === "Mine" && !c.auto), "the person's own checkpoint is still there").toBe(true);
    await hub.close();
  }, 60000);

  it("is off unless asked for", async () => {
    const dir = path.join(root, "c");
    const store = new ProjectStore(dir);
    const hub = new Hub(store, noModel);
    await hub.ensureProject();
    hub.session.execute({ op: "set_sea_level", levelM: 5 }, "user");
    await hub.flush();
    await sleep(300);
    expect(await store.listCheckpoints(hub.activeId!)).toEqual([]);
    await hub.close();
  }, 60000);
});
