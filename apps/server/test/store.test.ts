import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NewerFormatError } from "@mapmaker/core";
import { ProjectStore, atomicWrite } from "../src/store.ts";

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

describe("the map's file format", () => {
  const readMeta = (id: string) => JSON.parse(readFileSync(path.join(root, id, "project.json"), "utf8")) as { formatVersion?: number; notes?: string };

  it("writes the version into project.json when it saves", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Versioned", width: 128, height: 128, kmPerPx: 4 });
    expect(readMeta(doc.meta.id).formatVersion).toBe(1);
  });

  it("opens a map saved before there was a version as the current one, without rewriting its files", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Old style", width: 128, height: 128, kmPerPx: 4 });
    const file = path.join(root, doc.meta.id, "project.json");
    const old = JSON.parse(readFileSync(file, "utf8"));
    delete old.formatVersion;
    writeFileSync(file, JSON.stringify(old, null, 2));
    const before = readFileSync(file, "utf8");
    const back = await store.load(doc.meta.id);
    expect(back.meta.formatVersion).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before); // (just opening a map never touches its files)
    expect(existsSync(path.join(root, doc.meta.id, "backups"))).toBe(false);
  });

  it("will not open a map from a newer format, and leaves it exactly as it was", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "From the future", width: 128, height: 128, kmPerPx: 4 });
    const file = path.join(root, doc.meta.id, "project.json");
    const future = { ...JSON.parse(readFileSync(file, "utf8")), formatVersion: 9 };
    writeFileSync(file, JSON.stringify(future, null, 2));
    const before = readFileSync(file, "utf8");
    await expect(store.load(doc.meta.id)).rejects.toBeInstanceOf(NewerFormatError);
    await expect(store.load(doc.meta.id)).rejects.toThrow(/Update Dragon Drop/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("copies an older map's files aside before bringing it up to date, then saves it in the new form", async () => {
    const old = new ProjectStore(root);
    const doc = await old.create({ name: "Migrating", width: 128, height: 128, kmPerPx: 4 });
    doc.features!.places = [{ id: "p1", name: "Keep", type: "town", x: 5, y: 6 }];
    await old.save(doc);
    const newer = new ProjectStore(root, { format: 2, migrations: { 1: (d) => { d.meta.notes = "migrated"; d.features!.places![0].name = "Kept"; } } });
    const back = await newer.load(doc.meta.id);
    expect(back.meta.formatVersion).toBe(2);
    expect(back.meta.notes).toBe("migrated");
    expect(back.features!.places![0].name).toBe("Kept");
    // saved in the new form...
    expect(readMeta(doc.meta.id)).toMatchObject({ formatVersion: 2, notes: "migrated" });
    // ...and the files as they were are kept
    const [kept] = readdirSync(path.join(root, doc.meta.id, "backups"));
    expect(kept).toMatch(/^before-format-1-/);
    const dir = path.join(root, doc.meta.id, "backups", kept);
    expect(JSON.parse(readFileSync(path.join(dir, "project.json"), "utf8")).formatVersion).toBe(1);
    expect(JSON.parse(readFileSync(path.join(dir, "features.json"), "utf8")).places[0].name).toBe("Keep");
    expect(existsSync(path.join(dir, "map", "height.f32.gz"))).toBe(true);
    expect(newer.takeNotices(doc.meta.id)[0]).toMatch(/older file format \(1\).*brought up to date \(2\)/);
    expect(newer.takeNotices(doc.meta.id)).toEqual([]); // (handed over once)
  });

  it("leaves a map alone if a step is missing, after keeping a copy", async () => {
    const old = new ProjectStore(root);
    const doc = await old.create({ name: "Stuck", width: 128, height: 128, kmPerPx: 4 });
    const before = readFileSync(path.join(root, doc.meta.id, "project.json"), "utf8");
    const broken = new ProjectStore(root, { format: 3, migrations: { 1: () => {} } }); // nothing turns 2 into 3
    await expect(broken.load(doc.meta.id)).rejects.toThrow(/format 2 to 3/);
    expect(readFileSync(path.join(root, doc.meta.id, "project.json"), "utf8")).toBe(before);
    expect(readdirSync(path.join(root, doc.meta.id, "backups"))).toHaveLength(1);
  });
});

describe("a places and labels file that can't be read", () => {
  it("is kept under another name instead of being overwritten, and the newest checkpoint's copy is used", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Damaged", width: 128, height: 128, kmPerPx: 4 });
    doc.features!.places = [{ id: "p1", name: "Safe Harbour", type: "port", x: 10, y: 10 }];
    await store.save(doc);
    await store.saveCheckpoint(doc.meta.id, "Before", doc, 1);
    const file = path.join(root, doc.meta.id, "features.json");
    writeFileSync(file, '{"places": [{"id": "p1", "na'); // cut off in the middle, as a crash or a sync tool can leave it
    const back = await store.load(doc.meta.id);
    expect(back.features!.places![0].name).toBe("Safe Harbour");
    const aside = readdirSync(path.join(root, doc.meta.id)).filter((n) => n.startsWith("features.unreadable-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(path.join(root, doc.meta.id, aside[0]), "utf8")).toBe('{"places": [{"id": "p1", "na');
    expect(existsSync(file)).toBe(false); // (so the next save writes a new one instead of replacing the damaged one's only copy)
    expect(store.takeNotices(doc.meta.id)[0]).toMatch(/couldn't be read.*features\.unreadable-.*checkpoint "Before"/);
  });

  it("opens without them when there is no checkpoint to take them from, and says so", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Damaged too", width: 128, height: 128, kmPerPx: 4 });
    writeFileSync(path.join(root, doc.meta.id, "features.json"), "null");
    const back = await store.load(doc.meta.id);
    expect(back.features!.places ?? []).toHaveLength(0);
    expect(store.takeNotices(doc.meta.id)[0]).toMatch(/opens without them/);
  });
});

describe("checkpoints and rolling backups", () => {
  const names = async (store: ProjectStore, id: string) => (await store.listCheckpoints(id)).map((c) => c.name);

  it("keeps only the newest automatic ones, and never touches one a person saved", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Rolling", width: 128, height: 128, kmPerPx: 4 });
    const id = doc.meta.id;
    await store.saveCheckpoint(id, "Mine", doc, 1);
    for (let i = 1; i <= 4; i++) {
      await store.saveCheckpoint(id, `Auto ${i}`, doc, i, "Saved automatically", { auto: true });
      await new Promise((r) => setTimeout(r, 5)); // (newest is judged by time)
    }
    await store.saveCheckpoint(id, "Also mine", doc, 9);
    await store.pruneAutoCheckpoints(id, 2);
    expect(await names(store, id)).toEqual(["Mine", "Auto 3", "Auto 4", "Also mine"]);
    const left = readdirSync(path.join(root, id, "map", "checkpoints")).filter((n) => n.endsWith(".f32.gz"));
    expect(left).toHaveLength(4); // (the pruned ones' files are gone too)
    expect((await store.listCheckpoints(id)).filter((c) => c.auto).map((c) => c.name)).toEqual(["Auto 3", "Auto 4"]);
    expect(await store.readCheckpoint(id, "Auto 4")).not.toBeNull();
    expect(await store.lastAutoCheckpointTime(id)).toBeGreaterThan(0);
    expect(await store.lastAutoCheckpointTime((await store.create({ name: "No autos", width: 128, height: 128, kmPerPx: 4 })).meta.id)).toBe(0);
  });

  it("deletes the file of a checkpoint that is saved again under the same name", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Resaved", width: 128, height: 128, kmPerPx: 4 });
    await store.saveCheckpoint(doc.meta.id, "Same", doc, 1);
    await new Promise((r) => setTimeout(r, 5));
    await store.saveCheckpoint(doc.meta.id, "same", doc, 2);
    expect(await names(store, doc.meta.id)).toEqual(["same"]);
    expect(readdirSync(path.join(root, doc.meta.id, "map", "checkpoints")).filter((n) => n.endsWith(".f32.gz"))).toHaveLength(1);
  });

  it("keeps the places as they were when it was called, even if they change while it is being written", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Snapshot", width: 128, height: 128, kmPerPx: 4 });
    doc.features!.places = [{ id: "p1", name: "Before", type: "town", x: 1, y: 1 }];
    const saving = store.saveCheckpoint(doc.meta.id, "Now", doc, 1);
    doc.features!.places![0].name = "After";
    await saving;
    expect((await store.readCheckpoint(doc.meta.id, "Now"))!.features!.places![0].name).toBe("Before");
  });

  it("gets two checkpoints saved at the same moment both into the list", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Together", width: 128, height: 128, kmPerPx: 4 });
    await Promise.all([store.saveCheckpoint(doc.meta.id, "One", doc, 1), store.saveCheckpoint(doc.meta.id, "Two", doc, 2, undefined, { auto: true })]);
    expect((await names(store, doc.meta.id)).sort()).toEqual(["One", "Two"]);
  });

  // (found 2026-11-22 by the rolling-backup test: the list was read between a first checkpoint's land file and its entry, and shown as "recovered")
  it("never shows a checkpoint half-written: the list is read after it is saved", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Half written", width: 1024, height: 1024, kmPerPx: 4 });
    const id = doc.meta.id, dir = path.join(root, id, "map", "checkpoints");
    const saving = store.saveCheckpoint(id, "Backup", doc, 1, "Saved automatically", { auto: true });
    // the moment its land file is on disk (before its entry and the list are), read the list
    const landFile = () => existsSync(dir) && readdirSync(dir).some((n) => n.endsWith(".f32.gz"));
    while (!landFile()) await new Promise((r) => setImmediate(r));
    const seen = await store.listCheckpoints(id);
    await saving;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: "Backup", auto: true, note: "Saved automatically" });
    expect(await store.lastAutoCheckpointTime(id)).toBeGreaterThan(0);
  });

  // (found 2026-11-22: a damaged list was read as empty, and the next checkpoint, an automatic backup say, wrote a list with only itself)
  it("rebuilds a damaged list from the checkpoints instead of starting a new one", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Damaged list", width: 128, height: 128, kmPerPx: 4 });
    const id = doc.meta.id, dir = path.join(root, id, "map", "checkpoints");
    doc.features!.places = [{ id: "p1", name: "Harbour", type: "town", x: 1, y: 1 }];
    await store.saveCheckpoint(id, "First", doc, 1);
    await store.saveCheckpoint(id, "Second", doc, 2, "a note", { auto: true });
    writeFileSync(path.join(dir, "index.json"), ""); // a power cut mid-save
    expect(await names(store, id)).toEqual(["First", "Second"]);
    expect(store.takeNotices(id)[0]).toMatch(/list of checkpoints was damaged/);
    expect(readdirSync(dir).some((n) => n.startsWith("index.unreadable-"))).toBe(true);
    await store.saveCheckpoint(id, "Third", doc, 3);
    expect(await names(store, id)).toEqual(["First", "Second", "Third"]);
    const back = (await store.readCheckpoint(id, "First"))!;
    expect(back.features!.places![0].name).toBe("Harbour"); // (each checkpoint's own copy of its entry keeps its places)
    expect((await store.listCheckpoints(id)).find((c) => c.name === "Second")!.auto).toBe(true);
  });

  it("brings back older checkpoints (without their own copy of the entry) by their file names", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Old list", width: 128, height: 128, kmPerPx: 4 });
    const id = doc.meta.id, dir = path.join(root, id, "map", "checkpoints");
    await store.saveCheckpoint(id, "Before the war", doc, 1);
    for (const n of readdirSync(dir)) if (n.endsWith(".entry.json")) rmSync(path.join(dir, n)); // (as saved before 2026-11-22)
    writeFileSync(path.join(dir, "index.json"), "{ not json");
    const list = await store.listCheckpoints(id);
    expect(list.map((c) => c.name)).toEqual(["before the war (recovered)"]);
    expect((await store.readCheckpoint(id, "before the war (recovered)"))!.data.length).toBe(128 * 128);
  });

  it("never takes a list that can't be read just now for an empty one", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Held list", width: 128, height: 128, kmPerPx: 4 });
    const id = doc.meta.id, dir = path.join(root, id, "map", "checkpoints");
    await store.saveCheckpoint(id, "Kept", doc, 1);
    rmSync(path.join(dir, "index.json"));
    mkdirSync(path.join(dir, "index.json")); // (reading it fails, as for a file held by another program)
    await expect(store.saveCheckpoint(id, "New", doc, 2)).rejects.toThrow();
    rmSync(path.join(dir, "index.json"), { recursive: true });
    expect(await names(store, id)).toEqual(["Kept"]); // (no list at all, but checkpoints: made again from them)
  });
});

describe("files that can't be read just now", () => {
  it("doesn't set the places aside when their file can't be read (only when it is damaged)", async () => {
    const store = new ProjectStore(root);
    const doc = await store.create({ name: "Offline places", width: 64, height: 64, kmPerPx: 4 });
    const f = path.join(root, doc.meta.id, "features.json");
    rmSync(f);
    mkdirSync(f); // (stands for an offline cloud file: reading it fails)
    await expect(store.load(doc.meta.id)).rejects.toThrow();
    expect(readdirSync(path.join(root, doc.meta.id)).some((n) => n.startsWith("features.unreadable-"))).toBe(false);
    expect(store.takeNotices(doc.meta.id)).toEqual([]);
  });

  it("writes the whole file through to the disk", async () => {
    const f = path.join(mkdtempSync(path.join(root, "aw-")), "x.json");
    await atomicWrite(f, "{\"a\":1}");
    await atomicWrite(f, new Uint8Array([123, 125]));
    expect(readFileSync(f, "utf8")).toBe("{}");
    expect(readdirSync(path.dirname(f))).toEqual(["x.json"]);
  });
});
