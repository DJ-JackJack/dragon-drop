/**
 * DEV/TEST ONLY: a scripted stand-in for Claude, enabled with MAPMAKER_FAKE_MODEL=1.
 * Lets the editor's chat UI be exercised end to end without an API key or any cost.
 * It always does the same thing: adds a small island, looks at the map, and replies.
 */
import type { ModelCall } from "./agent.ts";

export function scriptedModel(): ModelCall {
  return async (params, onEvent) => {
    const msgs = params.messages;
    const last = msgs[msgs.length - 1];
    const lastIsToolResult = Array.isArray(last.content) && last.content.some((b) => (b as { type: string }).type === "tool_result");
    const step = lastIsToolResult ? countToolTurns(msgs) : 0;
    const usage = { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 };
    const base = { id: `msg_fake_${Date.now()}`, type: "message", role: "assistant", model: params.model, stop_sequence: null, usage };
    const think = (t: string) => onEvent({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: t } } as never);
    const say = async (t: string, index = 1) => {
      for (const w of t.match(/\S+\s*/g) ?? []) {
        onEvent({ type: "content_block_delta", index, delta: { type: "text_delta", text: w } } as never);
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    const tool = (index: number, id: string, name: string) =>
      onEvent({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } } as never);

    if (step === 0) {
      think("The inner sea has open water around (520, 640). A small island there won't touch existing coasts.");
      await say("I'll add a small island in the open water of the inner sea, then check how it looks.");
      tool(2, "fake_tu_1", "add_landmass");
      return { ...base, stop_reason: "tool_use", content: [
        { type: "thinking", thinking: "", signature: "fake" },
        { type: "text", text: "I'll add a small island in the open water of the inner sea, then check how it looks." },
        { type: "tool_use", id: "fake_tu_1", name: "add_landmass", input: { shape: { type: "circle", x: 520, y: 640, r: 22 }, height_m: 220, coast_roughness: 0.6, seed: 7 } },
      ] } as never;
    }
    if (step === 1) {
      tool(0, "fake_tu_2", "render_preview");
      return { ...base, stop_reason: "tool_use", content: [
        { type: "tool_use", id: "fake_tu_2", name: "render_preview", input: { region: { x: 400, y: 520, w: 240, h: 240 }, max_size: 512 } },
      ] } as never;
    }
    const reply = "Added a **small island** at about (520, 640), roughly 340 km across at this scale.\n\n- Ragged coast with a shallow shelf\n- Lowland only, about 220 m high\n\nWant hills on it, or a name?";
    await say(reply, 0);
    return { ...base, stop_reason: "end_turn", content: [{ type: "text", text: reply }] } as never;
  };
}

function countToolTurns(msgs: { role: string; content?: unknown }[]) {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const isTool = m.role === "user" && Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "tool_result");
    if (m.role === "user" && !isTool) break;
    if (isTool) n++;
  }
  return n;
}
