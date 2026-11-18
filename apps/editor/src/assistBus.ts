/**
 * Plumbing for Assist mode: when the DM last typed into the Claude Code panel, and typing a message into it.
 * (The rules for when to do that are in core's assist.ts; the timing and state live in useAssist.)
 */
let lastTypingAt: number | null = null;

/** The DM pressed a key in the terminal. */
export function markTyping() {
  lastTypingAt = Date.now();
}

export function typingAt() {
  return lastTypingAt;
}

/** Type one line into Claude Code and press Enter. Enter is a separate write: sent together with the text it would count as part of a paste. */
export async function sendToClaude(text: string): Promise<boolean> {
  const bridge = window.dragonDrop;
  if (!bridge) return false;
  const st = await bridge.termStatus();
  if (!st.alive) return false;
  bridge.termWrite(text);
  await new Promise((r) => setTimeout(r, 300));
  bridge.termWrite("\r");
  return true;
}
