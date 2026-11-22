/**
 * The name of the AI assistant in the terminal panel, for the words on screen ("Ask Codex about this", "Codex's edits are locked to this area"): Claude for
 * Claude Code (and in an ordinary browser, where the desktop app's choice isn't known), the assistant's own short name for the others the desktop app knows
 * (apps/desktop/assistants.cjs), and "the AI assistant" for a command it doesn't know. Read from the desktop app's settings at start and after they are saved
 * (`refreshAssistantName`). The API chat is always Claude, so text about the chat keeps that name.
 */
import { useSyncExternalStore } from "react";

const SHORT: Record<string, string> = { default: "Claude", claude: "Claude", codex: "Codex", gemini: "Gemini", opencode: "OpenCode", muse: "Muse" };
const GENERIC = "the AI assistant";

/** The short name for what the desktop app says the terminal runs (its `assistant` id), or the generic words. */
export function assistantNameFor(id: string | null | undefined): string {
  return id ? SHORT[id] ?? GENERIC : GENERIC;
}

let current = "Claude";
const listeners = new Set<() => void>();

/** Ask the desktop app again which assistant the terminal runs (after Settings are saved). */
export function refreshAssistantName(): void {
  const bridge = typeof window !== "undefined" ? window.dragonDrop : undefined;
  if (!bridge) return;
  void bridge.getSettings().then((s) => {
    const next = s ? assistantNameFor(s.assistant?.assistant ?? (s.terminalCommand ? null : "default")) : "Claude";
    if (next !== current) { current = next; for (const l of listeners) l(); }
  }).catch(() => {});
}

export function assistantName(): string { return current; }

/** With a capital first letter, to start a sentence ("The AI assistant can see this"). */
export function capital(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Possessive: "Claude's", "the AI assistant's". */
export function possessive(s: string): string { return `${s}'s`; }

/**
 * A piece of the editor's words with "Claude" (meaning whichever assistant works on the map: never "Claude Code", the API chat or the Claude Code setup, which
 * keep their names) said as the chosen assistant, with a capital where a sentence starts. Unchanged while it is Claude.
 */
export function forAssistant(text: string, ai: string = current): string {
  if (ai === "Claude") return text;
  return text.replace(/\bClaude\b(?! Code)/g, (_m: string, offset: number, whole: string) => {
    const before = whole.slice(0, offset);
    return before.trim() === "" || /[.!?:]\s*$/.test(before) ? capital(ai) : ai;
  });
}

/** The assistant's name in a React component, kept up to date. */
export function useAssistantName(): string {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, assistantName, assistantName);
}

refreshAssistantName();
