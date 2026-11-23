/** Every battlemap export the formats list names really is produced, with the file name the page gives. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BATTLE_EXPORT_FORMATS, FORMATS_WRITTEN } from "@mapmaker/core";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-formats-"));
let hub: Hub;
beforeAll(async () => {
  hub = new Hub(new ProjectStore(path.join(root, "projects")), null);
  await hub.createBattle({ name: "Formats test", squaresX: 8, squaresY: 6, pxPerSquare: 40 });
});
afterAll(async () => { await hub.close(); rmSync(root, { recursive: true, force: true }); });

const SUFFIX: Record<string, string> = { png: ".png", uvtt: ".dd2vtt", foundry: "-foundry.zip", key: "-key.md", print: "-print.pdf" };

describe("battlemap exports", () => {
  it.each([...BATTLE_EXPORT_FORMATS])("%s is written, with the file name the formats page describes", async (format) => {
    const f = await hub.battleExport(format);
    expect(f.bytes.byteLength).toBeGreaterThan(20);
    expect(f.name.endsWith(SUFFIX[format])).toBe(true);
    const row = FORMATS_WRITTEN.find((r) => r.exportFormat === format)!;
    expect(row.files).toContain(SUFFIX[format].replace(/^-key/, ""));
  });
});
