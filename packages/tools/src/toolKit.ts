/** The small helpers every file of tools uses: `define` (keeps a tool's input type), and the three ways a tool answers (text, JSON, or a refusal). */
import { z } from "zod";
import { NAME_SIZE_MAX, NAME_SIZE_MIN } from "@mapmaker/core";
import type { ToolDef, ToolResult } from "./tools.ts";

export function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
export const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
export const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
export const fail = (t: string): ToolResult => ({ ...text(t), isError: true });
/** A name's own size on the map (`nameSize`): a multiple of the usual size for names of its kind. Only when the DM asks for a name bigger or smaller. */
export const NameSizeSchema = z.number().min(NAME_SIZE_MIN).max(NAME_SIZE_MAX).describe(`How big its name is drawn, as a multiple of the usual size (1 usual, ${NAME_SIZE_MIN} to ${NAME_SIZE_MAX}); only when the DM asks for it bigger or smaller`);
