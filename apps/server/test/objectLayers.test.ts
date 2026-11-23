/** Claude's object layer tools on a battlemap, and hidden layers left out of the pictures. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-olayers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const call = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("object layer tools", () => {
  it("add layers, put objects in them, reorder, hide, lock and remove them (the objects stay)", async () => {
    const dir = path.join(root, "a"); mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    await call(hub, "create_battlemap", { name: "Inn", squares_x: 10, squares_y: 8 });
    await call(hub, "add_object_layer", { name: "Furniture" });
    await call(hub, "add_object_layer", { name: "Clutter" });
    await expect(call(hub, "add_object_layer", { name: "clutter" })).rejects.toThrow(/already a layer/);
    // (add_props needs an asset library: the objects go in directly, then update_prop puts them in their layers)
    hub.session.execute({ op: "features", patch: { upsertProps: [{ id: "o1", asset: "pack:table.png", x: 3, y: 3 }, { id: "o2", asset: "pack:mug.png", x: 3, y: 3 }, { id: "o3", asset: "pack:rug.png", x: 5, y: 5 }] } }, "user");
    await call(hub, "update_prop", { id: "o1", object_layer: "Furniture" });
    await call(hub, "update_prop", { id: "o2", object_layer: "clutter" });
    await expect(call(hub, "update_prop", { id: "o3", object_layer: "Nowhere" })).rejects.toThrow(/no object layer/);
    const list = await call(hub, "list_object_layers");
    expect(list.bottom.objects).toBe(1);
    expect(list.layers.map((l: { name: string; objects: number }) => `${l.name}:${l.objects}`)).toEqual(["Furniture:1", "Clutter:1"]);
    const moved = await call(hub, "update_object_layer", { layer: "Clutter", move: "bottom", hidden: true, locked: true });
    expect(moved.order_bottom_to_top).toEqual(["Clutter", "Furniture"]);
    expect(hub.session.doc.features!.layers![0]).toMatchObject({ name: "Clutter", hidden: true, locked: true });
    const mug = hub.session.doc.features!.props!.find((p) => p.asset === "pack:mug.png")!;
    await call(hub, "update_prop", { id: mug.id, object_layer: "" });
    expect(hub.session.doc.features!.props!.find((p) => p.id === mug.id)).not.toHaveProperty("layerId");
    const gone = await call(hub, "remove_object_layer", { layer: "Furniture" });
    expect(gone.objects_moved_to_bottom).toBe(1);
    expect(hub.session.doc.features!.props).toHaveLength(3);
    await hub.close();
  });
});
