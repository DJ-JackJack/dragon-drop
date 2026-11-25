/** A map's History survives switching to another map and back (the 0.1.13 playtest found it emptied): listed as earlier changes, which can't be undone. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ServerMsg } from "@mapmaker/core";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-history-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A pretend editor window: the messages the server sends it (the map itself goes as binary). */
function client() {
  const sent: ServerMsg[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (d: unknown) => { if (typeof d === "string") sent.push(JSON.parse(d)); }, on() {}, close() {} } as never;
  return { ws, last: () => [...sent].reverse().find((m) => m.t === "project") as Extract<ServerMsg, { t: "project" }> | undefined };
}

describe("History when switching maps", () => {
  it("lists a map's earlier changes when it is opened again, apart from the ones that can still be undone", async () => {
    const hub = new Hub(new ProjectStore(root), null);
    const a = await hub.createProject({ name: "Alpha", width: 128, height: 128, kmPerPx: 2 });
    hub.session.execute({ op: "generate_terrain", params: { template: "ocean", seed: 1 } }, "user", "Make the sea");
    const b = await hub.createProject({ name: "Beta", width: 128, height: 128, kmPerPx: 2 });
    const c = client();
    await hub.addClient(c.ws);
    expect(c.last()?.meta.id).toBe(b.id);
    expect(c.last()?.earlier).toBeUndefined();
    await hub.openProject(a.id);
    const back = c.last()!;
    expect(back.meta.id).toBe(a.id);
    expect(back.changes).toEqual([]); // (the undo steps went with the map when it closed)
    expect(back.earlier?.map((e) => e.label)).toContain("Make the sea");
    // a map never changed has none
    await hub.openProject(b.id);
    expect(c.last()?.earlier).toBeUndefined();
    await hub.close();
  });
});
