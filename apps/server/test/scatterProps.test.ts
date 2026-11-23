/** Claude's scatter_props: objects strewn over an area, spaced, varied, with the picture's variants mixed in, only on floor. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { runTool } from "@mapmaker/tools";
import { AssetLibrary } from "../src/assets.ts";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-scatter-"));
const lib = path.join(root, "Library");
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeAll(() => {
  // trees on nothing (objects): three oaks that are variants of one another, and a pine that isn't
  const tree = () => { const p = new PNG({ width: 128, height: 128 }); for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (Math.hypot(x - 64, y - 64) < 50) p.data.set([40, 120, 50, 255], (y * 128 + x) * 4); return PNG.sync.write(p); };
  mkdirSync(path.join(lib, "Forest Kit", "Trees"), { recursive: true });
  for (const n of ["Tree_Oak_A1", "Tree_Oak_A2", "Tree_Oak_A3", "Tree_Pine_A1"]) writeFileSync(path.join(lib, "Forest Kit", "Trees", `${n}.png`), tree());
});

const call = async (hub: Hub, name: string, input: Record<string, unknown>) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("scatter_props", () => {
  it("strews a picture and its variants over an area, spaced, only on floor, as one undo step", async () => {
    const dir = path.join(root, "maps");
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    hub.assets = new AssetLibrary(lib, path.join(root, "cache"));
    await hub.assets.scan();
    await call(hub, "create_battlemap", { name: "Wood", squares_x: 20, squares_y: 12 });
    // grass on the left half; the right half stays void
    await call(hub, "paint_floor", { material: "grass", shape: { type: "rect", x: 0, y: 0, w: 10, h: 12 } });
    const oak = "forest-kit:Trees/Tree_Oak_A1.png";
    const before = hub.session.seq;
    const r = await call(hub, "scatter_props", { assets: [oak], area: { x: 0, y: 0, w: 20, h: 12 }, spacing: 1.5, seed: 5 });
    expect(r.added).toBeGreaterThan(15);
    expect(r.pictures_used.every((id: string) => /Tree_Oak_A[123]\.png$/.test(id))).toBe(true);
    expect(r.pictures_used.length).toBeGreaterThan(1); // (the variants are mixed in)
    const props = hub.session.doc.features!.props ?? [];
    expect(props).toHaveLength(r.added);
    expect(props.every((p) => p.x < 10)).toBe(true); // (never on the void)
    for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) expect(Math.hypot(props[i].x - props[j].x, props[i].y - props[j].y)).toBeGreaterThanOrEqual(1.5 - 0.02);
    expect(new Set(props.map((p) => p.rotation ?? 0)).size).toBeGreaterThan(3); // (turned)
    expect(hub.session.seq).toBe(before + 1); // (one edit)
    // a second scatter keeps clear of the first; without variants only the one picture
    const again = await call(hub, "scatter_props", { assets: ["forest-kit:Trees/Tree_Pine_A1.png"], area: { points: [[0, 0], [10, 0], [10, 12], [0, 12]] }, spacing: 1.5, mix_variants: false, turn: false, seed: 6 });
    expect(again.pictures_used).toEqual(["forest-kit:Trees/Tree_Pine_A1.png"]);
    const all = hub.session.doc.features!.props ?? [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y)).toBeGreaterThanOrEqual(1.5 - 0.02);
    await hub.close();
  });
});
