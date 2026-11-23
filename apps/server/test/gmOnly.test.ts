/** GM-only things (core secrets.ts): left out of exports for players, kept in the DM's own copy; Claude's set_gm_only marks them. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type Features, hasGmOnly, playerView } from "@mapmaker/core";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-gm-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const dir = path.join(root, `p${++n}`); mkdirSync(dir, { recursive: true }); return new Hub(new ProjectStore(dir), null); };
const call = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("the player version", () => {
  it("leaves out GM-only places, labels, roads, objects and lights, and GM-only buildings' names", () => {
    const f: Features = {
      places: [{ id: "p1", name: "Ashford", type: "town", x: 1, y: 1 }, { id: "p2", name: "The Hidden Shrine", type: "temple", x: 2, y: 2, gmOnly: true }],
      labels: [{ id: "l1", text: "Sea of Glass", kind: "sea", x: 0, y: 0, gmOnly: true }],
      lines: [{ id: "r1", kind: "road", points: [[0, 0], [1, 1]], gmOnly: true }, { id: "r2", kind: "road", points: [[0, 0], [2, 2]] }],
      props: [{ id: "o1", asset: "k:a.png", x: 1, y: 1, gmOnly: true }],
      lights: [{ id: "g1", x: 1, y: 1, radius: 4, bright: 2, colour: "#fff", gmOnly: true }],
      buildings: [{ id: "b1", name: "Thieves' Den", gmOnly: true, points: [[0, 0], [1, 0], [1, 1]] } as never],
    };
    expect(hasGmOnly(f)).toBe(true);
    const p = playerView(f);
    expect(p.places.map((x) => x.name)).toEqual(["Ashford"]);
    expect(p.labels).toHaveLength(0);
    expect(p.lines!.map((x) => x.id)).toEqual(["r2"]);
    expect(p.props).toHaveLength(0);
    expect(p.lights).toHaveLength(0);
    expect(p.buildings![0]).not.toHaveProperty("name"); // (the building stays, its name goes)
    expect(hasGmOnly(p)).toBe(false);
    const plain: Features = { places: [], labels: [] };
    expect(playerView(plain)).toBe(plain);
  });
});

describe("exports and Claude", () => {
  it("marks things GM only by name or id, and battlemap exports leave them out unless it is the DM's own copy", async () => {
    const hub = fresh();
    await call(hub, "create_battlemap", { name: "Crypt", squares_x: 12, squares_y: 8 });
    await call(hub, "add_light", { x: 3, y: 3, radius: 5 });
    await call(hub, "add_light", { x: 8, y: 4, radius: 5 });
    const lights = hub.session.doc.features!.lights!;
    const r = await call(hub, "set_gm_only", { items: [lights[1].id], gm_only: true });
    expect(r.marked).toEqual([lights[1].id]);
    expect(hub.session.doc.features!.lights![1].gmOnly).toBe(true);
    const uvtt = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
    expect(uvtt((await hub.battleExport("uvtt")).bytes).lights).toHaveLength(1); // (for players)
    expect(uvtt((await hub.battleExport("uvtt", undefined, {}, true)).bytes).lights).toHaveLength(2); // (the DM's own copy)
    const own = await call(hub, "export_battlemap", { format: "uvtt", include_gm_only: true });
    expect(own.file).toBe("crypt.dd2vtt");
    // and back to the players
    await call(hub, "set_gm_only", { items: [lights[1].id], gm_only: false });
    expect(hub.session.doc.features!.lights![1]).not.toHaveProperty("gmOnly");
    await hub.close();
  });

  it("leaves the gold mark off a secret door in the players' picture", async () => {
    const hub = fresh();
    await call(hub, "create_battlemap", { name: "Vault", squares_x: 8, squares_y: 6 });
    await call(hub, "add_room", { x: 1, y: 1, w: 6, h: 4, doors: [{ side: "bottom", offset: 2, kind: "secret" }] });
    const { decodeImage } = await import("@mapmaker/tools");
    const gold = (png: Uint8Array) => {
      const img = decodeImage(png)!;
      let n = 0;
      for (let o = 0; o < img.data.length; o += 4) if (img.data[o] > 215 && img.data[o + 1] > 170 && img.data[o + 1] < 210 && img.data[o + 2] < 120) n++;
      return n;
    };
    const mine = gold((await hub.battleExport("png", undefined, {}, true)).bytes);
    const theirs = gold((await hub.battleExport("png")).bytes);
    expect(mine).toBeGreaterThan(theirs);
    await hub.close();
  });

  it("marks a world map's place by its name", async () => {
    const hub = fresh();
    await hub.createProject({ name: "World", width: 256, height: 256, kmPerPx: 4 });
    await call(hub, "add_place", { name: "Ashford", type: "town", x: 50, y: 50 });
    await call(hub, "add_place", { name: "The Hidden Shrine", type: "temple", x: 80, y: 80 });
    await call(hub, "set_gm_only", { items: ["the hidden shrine"], gm_only: true });
    const places = (await call(hub, "list_places")) as { name: string; gmOnly?: boolean }[];
    expect(places.find((p) => p.name === "The Hidden Shrine")?.gmOnly).toBe(true);
    expect(places.find((p) => p.name === "Ashford")?.gmOnly).toBeUndefined();
    await expect(call(hub, "set_gm_only", { items: ["Nowhere"], gm_only: true })).rejects.toThrow(/Nothing found/);
    await hub.close();
  });
});
