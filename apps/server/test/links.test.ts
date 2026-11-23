/** Links to the DM's own notes on places and realms (core links.ts) through Claude's tools. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "@mapmaker/tools";
import { Hub } from "../src/hub.ts";
import { ProjectStore } from "../src/store.ts";

const root = mkdtempSync(path.join(tmpdir(), "dd-links-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const call = async (hub: Hub, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(hub.toolContext("mcp"), name, input);
  const t = (r.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};

describe("note links", () => {
  it("are kept on places and realms, refused for programs and odd addresses, and taken off with an empty text", async () => {
    const dir = path.join(root, "a"); mkdirSync(dir, { recursive: true });
    const hub = new Hub(new ProjectStore(dir), null);
    await hub.createProject({ name: "World", width: 128, height: 128, kmPerPx: 4 });
    await call(hub, "add_place", { name: "Ashford", type: "town", x: 40, y: 40, link: "https://example.com/wiki/Ashford" });
    expect(hub.session.doc.features!.places[0].link).toBe("https://example.com/wiki/Ashford");
    await expect(call(hub, "update_place", { place: "Ashford", link: "C:\\Windows\\notepad.exe" })).rejects.toThrow(/not \.exe files/);
    await expect(call(hub, "update_place", { place: "Ashford", link: "javascript:alert(1)" })).rejects.toThrow(/javascript:/);
    await call(hub, "update_place", { place: "Ashford", link: "C:\\Campaign\\Places\\Ashford.md" });
    expect(hub.session.doc.features!.places[0].link).toBe("C:\\Campaign\\Places\\Ashford.md");
    await call(hub, "update_place", { place: "Ashford", link: "" });
    expect(hub.session.doc.features!.places[0]).not.toHaveProperty("link");
    await call(hub, "add_realm", { name: "Westmarch" });
    await call(hub, "update_realm", { realm: "Westmarch", link: "obsidian://open?vault=Campaign&file=Westmarch" });
    expect(hub.session.doc.features!.realms![0].link).toBe("obsidian://open?vault=Campaign&file=Westmarch");
    await hub.close();
  });
});
