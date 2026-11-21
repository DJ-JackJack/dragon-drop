/** The small helpers every file of tools uses: `define` (keeps a tool's input type), and the three ways a tool answers (text, JSON, or a refusal). */
import type { z } from "zod";
import type { ToolDef, ToolResult } from "./tools.ts";

export function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
export const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
export const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
export const fail = (t: string): ToolResult => ({ ...text(t), isError: true });
