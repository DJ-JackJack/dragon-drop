import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const dir = mkdtempSync(path.join(tmpdir(), "mapmaker-first-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a brand-new install", () => {
  it("starts with a neutral generated map: some land to look at, and no names, places or notes of anyone's world", async () => {
    const hub = new Hub(new ProjectStore(dir), async () => { throw new Error("no model in this test"); });
    await hub.ensureProject();
    const doc = hub.session.doc;
    expect(doc.meta.name).toBe("First Map");
    let land = 0;
    for (const v of doc.height.data) if (v > doc.meta.seaLevel) land++;
    const share = land / doc.height.data.length;
    expect(share, "there is land").toBeGreaterThan(0.12);
    expect(share, "and plenty of sea").toBeLessThan(0.6);
    const f = doc.features;
    expect(f?.places ?? []).toHaveLength(0);
    expect(f?.labels ?? []).toHaveLength(0);
    expect(f?.regions ?? []).toHaveLength(0);
    expect(doc.meta.notes ?? "").toBe("");
    expect(hub.projectsCache.map((p) => p.name)).toEqual(["First Map"]);
    await hub.flush();
    // a second start opens the same map instead of making another
    const again = new Hub(new ProjectStore(dir), async () => { throw new Error("no model in this test"); });
    await again.ensureProject();
    expect(again.projectsCache).toHaveLength(1);
  }, 60000);
});
