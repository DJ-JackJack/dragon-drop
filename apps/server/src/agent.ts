/**
 * In-app chat: a streaming tool-use loop on the Claude API.
 *
 * - Conversation history is append-only (thinking blocks are passed back untouched).
 * - Tools come from @mapmaker/tools; every input is validated before running.
 * - Each user turn is prefixed with what the user changed by hand since Claude's last turn.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  type ChatEvent, type ChatImage, type ChatItem, type ChatSettings, type ModelId, type Usage, MODEL_PRICES, emptyUsage,
} from "@mapmaker/core";
import { MAPMAKER_INSTRUCTIONS, type ToolContext, prepareReference, runTool, toBase64, toolJsonSchemas } from "@mapmaker/tools";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type Message = Anthropic.Beta.Messages.BetaMessage;
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** One streamed model call. Swappable so tests can script Claude's replies. */
export type ModelCall = (
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
) => Promise<Message>;

export function anthropicModelCall(client = new Anthropic()): ModelCall {
  return async (params, onEvent, signal) => {
    const stream = client.beta.messages.stream(params, { signal });
    stream.on("streamEvent", (e) => onEvent(e as StreamEvent));
    return stream.finalMessage();
  };
}

export interface ChatState {
  messages: MessageParam[];
  items: ChatItem[];
  settings: ChatSettings;
  usage: Usage;
  lastSeenSeq: number;
}

export interface AgentHost {
  toolContext(): ToolContext;
  emit(ev: ChatEvent): void;
  persist(state: ChatState): Promise<void>;
  /** Changes the user made by hand since `seq` (for the per-turn context note). */
  userChangesSince(seq: number): { seq: number; lines: string[] };
  apiKeyConfigured(): boolean;
}

const MAX_STEPS = 40;
const FALLBACK_MODELS: ReadonlySet<ModelId> = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export function defaultChatState(): ChatState {
  return { messages: [], items: [], settings: { model: "claude-opus-5-5", effort: "medium" }, usage: emptyUsage(), lastSeenSeq: 0 };
}

let idCounter = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const now = () => new Date().toISOString();

export class ChatAgent {
  state: ChatState;
  busy = false;
  private abort: AbortController | null = null;

  constructor(private host: AgentHost, private call: ModelCall | null, state?: ChatState) {
    this.state = state ?? defaultChatState();
  }

  setSettings(s: Partial<ChatSettings>) {
    if (s.model && s.model in MODEL_PRICES) this.state.settings.model = s.model;
    if (s.effort && ["low", "medium", "high"].includes(s.effort)) this.state.settings.effort = s.effort;
    void this.host.persist(this.state);
  }

  stop() {
    this.abort?.abort();
  }

  async reset() {
    if (this.busy) this.stop();
    const settings = this.state.settings;
    this.state = { ...defaultChatState(), settings };
    await this.host.persist(this.state);
  }

  /** Add a display-only note (e.g. activity from Claude Code over MCP). Not sent to the model. */
  note(text: string, level: "info" | "error" = "info") {
    const item: ChatItem = { kind: "notice", id: newId("n"), text, level, time: now() };
    this.state.items.push(item);
    this.host.emit({ type: "item_add", item });
  }

  async send(text: string, images: { name: string; mediaType: string; bytes: Uint8Array; url: string }[]): Promise<void> {
    if (this.busy) {
      this.note("Claude is still working on the previous message. Stop it first or wait.", "error");
      return;
    }
    const userItem: ChatItem = {
      kind: "user", id: newId("u"), text, time: now(),
      images: images.map((i): ChatImage => ({ url: i.url, name: i.name })),
    };
    this.state.items.push(userItem);
    this.host.emit({ type: "item_add", item: userItem });

    if (!this.call || !this.host.apiKeyConfigured()) {
      this.note("No Anthropic API key is configured, so the in-app chat can't reach Claude yet. Add ANTHROPIC_API_KEY to the .env file in the project folder and restart the server (see docs/SETUP-WINDOWS.md). You can still use the map tools from Claude Code.", "error");
      await this.host.persist(this.state);
      return;
    }

    // Build the user turn: editor context, then images, then the text.
    const content: ContentBlockParam[] = [];
    const ctxNote = this.contextNote();
    if (ctxNote) content.push({ type: "text", text: ctxNote });
    for (const img of images) {
      const prep = prepareReference(img.bytes, 1568);
      if (prep) {
        content.push({ type: "text", text: `[Attached image saved as reference "${img.name}" (${prep.width}x${prep.height}); view_reference can crop it at full resolution.]` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(prep.jpeg) } });
      } else {
        content.push({ type: "text", text: `[Attached image "${img.name}" could not be decoded (use PNG or JPEG).]` });
      }
    }
    content.push({ type: "text", text: text || "(no text)" });
    this.state.messages.push({ role: "user", content });

    this.busy = true;
    this.host.emit({ type: "busy", busy: true });
    this.abort = new AbortController();
    try {
      await this.loop(this.abort.signal);
    } finally {
      this.busy = false;
      this.abort = null;
      this.state.lastSeenSeq = this.host.userChangesSince(Number.MAX_SAFE_INTEGER).seq;
      this.host.emit({ type: "busy", busy: false });
      await this.host.persist(this.state);
    }
  }

  private contextNote(): string | null {
    const { seq, lines } = this.host.userChangesSince(this.state.lastSeenSeq);
    const head = `[Editor context: the map is at change #${seq}.`;
    if (!lines.length) return this.state.messages.length ? null : `${head} This is the start of the conversation; read the brief if you haven't.]`;
    return `${head} Since your last turn the user edited the map by hand:\n${lines.join("\n")}]`;
  }

  private tools() {
    return toolJsonSchemas().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
  }

  private async loop(signal: AbortSignal) {
    const { model, effort } = this.state.settings;
    const ctx = this.host.toolContext();
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return this.note("Stopped.");
      const assistantItem: ChatItem = { kind: "assistant", id: newId("a"), text: "", thinking: "", time: now() };
      let announced = false;
      const toolItems = new Map<number, string>();
      const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: 32000,
        system: [{ type: "text", text: MAPMAKER_INSTRUCTIONS }],
        tools: this.tools(),
        messages: this.state.messages,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort },
        cache_control: { type: "ephemeral" },
        ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      };

      let msg: Message;
      try {
        msg = await this.call!(params, (e) => {
          if (e.type === "content_block_delta" && (e.delta.type === "text_delta" || e.delta.type === "thinking_delta")) {
            if (!announced) {
              announced = true;
              this.state.items.push(assistantItem);
              this.host.emit({ type: "item_add", item: assistantItem });
            }
            if (e.delta.type === "text_delta") {
              (assistantItem as { text: string }).text += e.delta.text;
              this.host.emit({ type: "item_update", id: assistantItem.id, patch: { text: (assistantItem as { text: string }).text } });
            } else {
              (assistantItem as { thinking?: string }).thinking += e.delta.thinking;
              this.host.emit({ type: "item_update", id: assistantItem.id, patch: { thinking: (assistantItem as { thinking?: string }).thinking } });
            }
          } else if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
            const item: ChatItem = { kind: "tool", id: newId("t"), name: e.content_block.name, input: {}, status: "running", time: now() };
            toolItems.set(e.index, item.id);
            this.state.items.push(item);
            this.host.emit({ type: "item_add", item });
          }
        }, signal);
      } catch (err) {
        for (const id of toolItems.values()) this.host.emit({ type: "item_update", id, patch: { status: "error", result: "Interrupted" } });
        if (signal.aborted) return this.note("Stopped.");
        return this.note(describeApiError(err), "error");
      }

      this.addUsage(msg, model);
      if (msg.stop_reason === "refusal") {
        return this.note("Claude declined this request. Try rephrasing it.", "error");
      }
      // Keep the full assistant content (thinking, text, tool_use, fallback blocks) - append-only history.
      this.state.messages.push({ role: "assistant", content: msg.content as unknown as ContentBlockParam[] });

      if (msg.stop_reason === "pause_turn") continue;
      const toolUses = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (!toolUses.length) return;
      if (msg.stop_reason === "max_tokens") {
        this.state.messages.push({ role: "user", content: toolUses.map((t) => ({
          type: "tool_result" as const, tool_use_id: t.id, is_error: true, content: "Tool input was cut off (max_tokens). Retry with a smaller input.",
        })) });
        continue;
      }

      const results: ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const idx = msg.content.indexOf(tu);
        const itemId = toolItems.get(idx);
        const r = await runTool(ctx, tu.name, tu.input);
        const textOut = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
        if (itemId) {
          this.host.emit({ type: "item_update", id: itemId, patch: {
            input: tu.input, status: r.isError ? "error" : "done", result: textOut.slice(0, 4000), images: r.display,
          } });
          const it = this.state.items.find((x) => x.id === itemId);
          if (it && it.kind === "tool") Object.assign(it, { input: tu.input, status: r.isError ? "error" : "done", result: textOut.slice(0, 4000), images: r.display });
        }
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          is_error: r.isError || undefined,
          content: r.content.map((c) => c.type === "text"
            ? { type: "text" as const, text: c.text }
            : { type: "image" as const, source: { type: "base64" as const, media_type: c.mediaType, data: c.data } }),
        });
      }
      this.state.messages.push({ role: "user", content: results });
      await this.host.persist(this.state);
    }
    this.note(`Stopped after ${MAX_STEPS} steps in one turn. Send a message to continue.`);
  }

  private addUsage(msg: Message, model: ModelId) {
    const u = msg.usage;
    const p = MODEL_PRICES[(msg.model as ModelId) in MODEL_PRICES ? (msg.model as ModelId) : model];
    const turn: Usage = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      costUsd: 0,
    };
    turn.costUsd = (turn.inputTokens * p.input + turn.outputTokens * p.output + turn.cacheReadTokens * p.cacheRead + turn.cacheWriteTokens * p.cacheWrite) / 1e6;
    const s = this.state.usage;
    s.inputTokens += turn.inputTokens;
    s.outputTokens += turn.outputTokens;
    s.cacheReadTokens += turn.cacheReadTokens;
    s.cacheWriteTokens += turn.cacheWriteTokens;
    s.costUsd += turn.costUsd;
    this.host.emit({ type: "usage", usage: turn, session: { ...s } });
  }
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env and restart the server.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model. Try another model in the chat settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The Claude API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  return `Chat error: ${(err as Error).message}`;
}
