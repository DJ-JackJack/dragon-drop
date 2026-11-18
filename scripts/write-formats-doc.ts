// Writes the two tables in docs/FORMATS.md from packages/core/src/formats.ts (run it with `pnpm formats` after changing that list).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATS_END, FORMATS_START, formatsMarkdown } from "../packages/core/src/formats.ts";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/FORMATS.md");
if (!existsSync(file)) throw new Error(`${file} is missing: it holds the page text around the tables.`);
const text = readFileSync(file, "utf8");
const a = text.indexOf(FORMATS_START.slice(0, 20)), b = text.indexOf(FORMATS_END);
if (a < 0 || b < 0 || b < a) throw new Error("docs/FORMATS.md has lost its markers (the formats:start and formats:end comment lines).");
const next = text.slice(0, a) + formatsMarkdown() + text.slice(b + FORMATS_END.length);
if (next === text) console.log("docs/FORMATS.md is already up to date.");
else { writeFileSync(file, next); console.log("Updated docs/FORMATS.md."); }
