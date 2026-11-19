/** The Foundry test kit script (scripts/foundry-test-kit.ts) still makes everything the handoff tells Claude Code to use. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = mkdtempSync(path.join(tmpdir(), "dd-kit-test-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("the Foundry test kit", () => {
  it("has the handoff, the templates, both test sets and the exports it describes", { timeout: 120_000 }, () => {
    execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "scripts/foundry-test-kit.ts"), out], { cwd: root, stdio: "pipe" });
    for (const f of [
      "HANDOFF.md", "RESULTS-TEMPLATE.md", "observed.test.example.mjs", "VERSION.txt", "levels-test/dragon-drop-foundry-levels-test.zip",
      "battlemap-test/WHAT-IS-IN-THE-MAP.md", "battlemap-test/vtt-test.png", "battlemap-test/vtt-test.dd2vtt", "battlemap-test/vtt-test-foundry.zip", "battlemap-test/vtt-test-key.md",
    ]) expect(existsSync(path.join(out, f)), f).toBe(true);
    // the handoff names every file it tells the reader to use
    const handoff = readFileSync(path.join(out, "HANDOFF.md"), "utf8");
    for (const name of ["dragon-drop-foundry-levels-test.zip", "vtt-test-foundry.zip", "vtt-test.dd2vtt", "WHAT-IS-IN-THE-MAP.md", "RESULTS-TEMPLATE.md", "observed.test.example.mjs"]) expect(handoff).toContain(name);
    // the Universal VTT file is the real thing: three doors (portals), one window (a see-through wall) and two lights
    const uvtt = JSON.parse(readFileSync(path.join(out, "battlemap-test/vtt-test.dd2vtt"), "utf8"));
    expect(uvtt.portals).toHaveLength(3);
    expect(uvtt.objects_line_of_sight).toHaveLength(1);
    expect(uvtt.lights).toHaveLength(2);
  });
});
