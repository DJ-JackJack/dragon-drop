/** Deleting a map (the DM's own choice, from the editor): its folder is moved into "Deleted maps", never erased; another map opens if it was the open one; Claude has no tool for it. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TOOLS } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { DELETED_DIR, ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-delete-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => {
  const dir = path.join(root, `d${++n}`);
  mkdirSync(dir, { recursive: true });
  return { dir, hub: new Hub(new ProjectStore(dir), null) };
};

describe("deleting a map", () => {
  it("moves the open map's folder into Deleted maps and opens another", async () => {
    const { dir, hub } = fresh();
    await hub.createProject({ name: "Keep Me", width: 64, height: 64, kmPerPx: 1 });
    await hub.createProject({ name: "Bin Me", width: 64, height: 64, kmPerPx: 1 });
    hub.session.execute({ op: "set_meta", patch: { notes: "last words" } }, "user");
    const r = await hub.deleteProject("bin-me");
    expect(r.name).toBe("Bin Me");
    expect(hub.session.doc.meta.id).toBe("keep-me");
    expect(existsSync(path.join(dir, "bin-me"))).toBe(false);
    expect(r.folder).toBe(path.join(dir, DELETED_DIR, "bin-me"));
    // its last edit was saved before it was moved, and nothing is lost
    expect(readdirSync(r.folder)).toContain("project.json");
    expect((await new ProjectStore(path.join(dir, DELETED_DIR)).load("bin-me")).meta.notes).toBe("last words");
    // the Deleted maps folder is never listed as a map
    expect((await hub.store.list()).map((p) => p.id)).toEqual(["keep-me"]);
    await hub.close();
  });

  it("deletes a map that isn't open, keeps two deleted maps of the same name apart, and makes a First Map when the last one goes", async () => {
    const { dir, hub } = fresh();
    await hub.createProject({ name: "Twin", width: 64, height: 64, kmPerPx: 1 });
    await hub.createProject({ name: "Other", width: 64, height: 64, kmPerPx: 1 });
    await hub.deleteProject("twin");
    expect(hub.session.doc.meta.id).toBe("other"); // (still open: untouched)
    await hub.createProject({ name: "Twin", width: 64, height: 64, kmPerPx: 1 });
    await hub.deleteProject("twin");
    expect(readdirSync(path.join(dir, DELETED_DIR)).sort()).toEqual(["twin", "twin-2"]);
    await hub.deleteProject("other");
    expect(hub.session.doc.meta.name).toBe("First Map");
    await expect(hub.deleteProject("nothing-here")).rejects.toThrow(/no map/i);
    await hub.close();
  });

  it("is not one of Claude's tools", () => {
    expect(TOOLS.map((t) => t.name).filter((name) => /delete|remove_(map|project)/.test(name))).toEqual([]);
  });
});
