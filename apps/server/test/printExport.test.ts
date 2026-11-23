/** A battlemap printed at table scale: the "print" export (a PDF of pages at one inch a square), from the editor's Export dialog and Claude's export_battlemap. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeImage, runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-print-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const dir = path.join(root, `p${++n}`); mkdirSync(dir, { recursive: true }); return new Hub(new ProjectStore(dir), null); };
const ok = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
/** The JPEG pictures inside a PDF, decoded. */
function pictures(pdf: Uint8Array) {
  const s = latin1(pdf), out: { w: number; h: number }[] = [];
  for (const m of s.matchAll(/\/Width (\d+) \/Height (\d+) [^>]*\/Length (\d+) >>\nstream\n/g)) {
    const at = m.index! + m[0].length, img = decodeImage(pdf.subarray(at, at + Number(m[3])))!;
    expect([img.w, img.h]).toEqual([Number(m[1]), Number(m[2])]);
    out.push({ w: img.w, h: img.h });
  }
  return out;
}

describe("printing a battlemap at table scale", () => {
  it("makes an assembly page and a page for each part, each picture sharp enough at one inch a square", async () => {
    const hub = fresh();
    await ok(hub, "create_battlemap", { name: "Cellar", squares_x: 30, squares_y: 20 });
    await ok(hub, "add_room", { x: 2, y: 2, w: 10, h: 8 });
    const f = await hub.battleExport("print", undefined, { paper: "letter", grid: true });
    expect(f).toMatchObject({ name: "cellar-print.pdf", mime: "application/pdf" });
    const s = latin1(f.bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.match(/\/Type \/Page /g)).toHaveLength(10); // (9 pages of Letter, lying down, and the assembly page)
    expect(s).toMatch(/\(A1: row 1 of 3, column 1 of 3\. Cellar\. 1 inch = 5 ft\.\) Tj/);
    const pics = pictures(f.bytes);
    expect(pics).toHaveLength(10);
    expect(pics[1]).toEqual({ w: 1500, h: 1050 }); // (ten squares by seven, at 150 pixels an inch)
    // the ink saver: the pictures grey and light, the walls drawn again as lines
    const inked = await hub.battleExport("print", undefined, { paper: "a4", ink: true });
    expect(latin1(inked.bytes)).toMatch(/\d+(\.\d+)? w 0\.08 G \[\] 0 d [\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S/);
    await hub.close();
  });

  it("is one of Claude's exports, and refuses a map too big to print on sheets", async () => {
    const hub = fresh();
    await ok(hub, "create_battlemap", { name: "Hall", squares_x: 12, squares_y: 8 });
    const r = await ok(hub, "export_battlemap", { format: "print", paper: "a4", ink_saver: true });
    expect(r.file).toBe("hall-print.pdf");
    expect(r.saved_to).toMatch(/hall[\/]exports[\/]hall-print.pdf$/);
    expect(latin1(readFileSync(path.join(root, `p${n}`, "hall", "exports", "hall-print.pdf"))).startsWith("%PDF-1.4")).toBe(true);
    await ok(hub, "create_battlemap", { name: "Plain", squares_x: 150, squares_y: 150, px_per_square: 30 });
    await expect(hub.battleExport("print")).rejects.toThrow(/at most 80 are made/);
    await hub.close();
  });
});
