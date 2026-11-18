// The installer must never carry anyone's campaign world: the maps in `projects/` are the DM's own work. These checks fail if a bundled sample comes back.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (rel) => readFileSync(path.resolve(here, rel), "utf8");

describe("the Windows app ships no sample project", () => {
  it("does not list a sample folder among the files the installer carries", () => {
    const pkg = JSON.parse(read("../package.json"));
    const carried = JSON.stringify(pkg.build.extraResources ?? []);
    expect(carried).not.toMatch(/sample|projects/i);
  });

  it("does not copy anything from the projects folder when it prepares the build", () => {
    const prep = read("../scripts/prepare.mjs");
    expect(prep).not.toMatch(/projects-sample/);
    expect(prep).not.toMatch(/"projects"/); // (no path.join(repo, "projects") copy)
  });

  it("does not copy a sample into a user's maps folder", () => {
    const main = read("../main.cjs");
    expect(main).not.toMatch(/copySample|projects-sample|sampleDir/);
  });
});
