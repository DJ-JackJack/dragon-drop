/** The player screen's picture (Hub.playerPicture) and Claude's reveal_to_players. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-player-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const dir = path.join(root, `p${++n}`); mkdirSync(dir, { recursive: true }); return new Hub(new ProjectStore(dir), null); };
const call = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("the player screen", () => {
  it("gets a picture of the battlemap made once per change, not again for a reveal, and none for a world map", async () => {
    const hub = fresh();
    await hub.createProject({ name: "World", width: 128, height: 128, kmPerPx: 4 });
    expect(await hub.playerPicture()).toBeNull();
    await call(hub, "create_battlemap", { name: "Hall", squares_x: 12, squares_y: 10 });
    await call(hub, "add_room", { x: 2, y: 2, w: 6, h: 5, doors: [{ side: "right", offset: 2 }] });
    const a = await hub.playerPicture();
    expect(a![0]).toBe(0xff); // (a JPEG)
    expect(await hub.playerPicture()).toBe(a);
    // revealing doesn't change the picture: the player screen draws the fog itself
    const r = await call(hub, "reveal_to_players", { action: "spot", x: 4, y: 4 });
    expect(r.fog).toBe(true);
    expect(hub.session.doc.meta.battle!.fog).toBe(true);
    expect(hub.session.doc.features!.reveals).toHaveLength(1);
    expect(await hub.playerPicture()).toBe(a);
    // a new light does
    await call(hub, "add_light", { x: 4, y: 4, radius: 4 });
    expect(await hub.playerPicture()).not.toBe(a);
    await call(hub, "reveal_to_players", { action: "hide_area", x: 0, y: 0, w: 3, h: 3 });
    expect(hub.session.doc.features!.reveals!.at(-1)!.hide).toBe(true);
    await call(hub, "reveal_to_players", { action: "hide_all" });
    expect(hub.session.doc.features!.reveals).toEqual([]);
    await call(hub, "reveal_to_players", { action: "fog_off" });
    expect(hub.session.doc.meta.battle!.fog).toBeUndefined();
    await hub.close();
  });
});
