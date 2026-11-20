/**
 * Starting up must always work, whatever is in the maps folder: the program's own updater lives behind it. A map saved by a newer Dragon Drop (found in testing: a city made by a
 * newer test copy stopped the installed program from starting at all) is skipped and left as it is, another map is opened, and the person is told once.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-startup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

/** A pretend editor window: what the server sends it. */
function client() {
  const sent: { t: string; message?: string }[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (d: unknown) => { if (typeof d === "string") sent.push(JSON.parse(d)); }, on() {}, close() {} } as never; // (the map itself goes as binary)
  return { ws, errors: () => sent.filter((m) => m.t === "error").map((m) => m.message ?? "") };
}

/** Make maps with a hub, then mark one as saved by a newer Dragon Drop. */
async function folderWith(names: string[], newer: string[], lastOpen: string) {
  const dir = path.join(root, `f${++n}`);
  mkdirSync(dir, { recursive: true });
  const hub = new Hub(new ProjectStore(dir), null);
  for (const name of names) await hub.createProject({ name, width: 64, height: 64, kmPerPx: 1 });
  await hub.openProject(lastOpen);
  await hub.flush();
  await hub.close();
  for (const id of newer) {
    const f = path.join(dir, id, "project.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), formatVersion: 99 }));
  }
  return dir;
}

describe("starting up", () => {
  it("skips the last map when a newer Dragon Drop saved it, opens another, and says so once", async () => {
    const dir = await folderWith(["Old World", "Newer Town"], ["newer-town"], "newer-town");
    const before = readFileSync(path.join(dir, "newer-town", "project.json"), "utf8");
    const hub = new Hub(new ProjectStore(dir), null);
    await hub.ensureProject();
    expect(hub.session.doc.meta.id).toBe("old-world");
    const a = client();
    await hub.addClient(a.ws);
    expect(a.errors().join(" ")).toMatch(/"Newer Town" couldn't be opened, so "Old World" was opened instead\. .*newer version/);
    const b = client();
    await hub.addClient(b.ws);
    expect(b.errors()).toEqual([]); // (told once)
    expect(readFileSync(path.join(dir, "newer-town", "project.json"), "utf8")).toBe(before); // (left exactly as it was)
    await hub.close();
  });

  it("still starts when no map at all will open: a new map is made beside them, and they are untouched", async () => {
    const dir = await folderWith(["Only Town"], ["only-town"], "only-town");
    const hub = new Hub(new ProjectStore(dir), null);
    await hub.ensureProject();
    expect(hub.session.doc.meta.id).not.toBe("only-town");
    expect(hub.session.doc.meta.name).toBe("First Map");
    const a = client();
    await hub.addClient(a.ws);
    expect(a.errors().join(" ")).toMatch(/None of your maps could be opened \("Only Town"\)/);
    expect(JSON.parse(readFileSync(path.join(dir, "only-town", "project.json"), "utf8")).formatVersion).toBe(99);
    await hub.close();
  });
});
