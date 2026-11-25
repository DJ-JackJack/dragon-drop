/**
 * Assist mode: while the DM works on the map, the desktop app can nudge the Claude Code panel to look at what changed
 * and suggest next steps. These are the rules, kept pure so they can be tested; the server, editor and desktop shell do the I/O.
 *
 * The one thing that must never happen is typing into Claude Code while it is working or waiting at a permission prompt
 * (an Enter there would answer the prompt). So a nudge is only sent when Claude Code has said it is idle.
 */
import type { ChangeEntry } from "./session.ts";

/** What Claude Code last told us (through its hooks). "unknown" until it has: nothing is ever sent automatically then. */
export type ClaudeState = "unknown" | "idle" | "busy" | "blocked";

/** The JSON Claude Code's hooks pipe to the command (only the fields used here). */
export interface HookEvent {
  hook_event_name?: string;
  notification_type?: string;
  message?: string;
}

export function claudeStateAfter(state: ClaudeState, ev: HookEvent): ClaudeState {
  switch (ev.hook_event_name) {
    case "SessionStart":
    case "Stop":
      return "idle";
    case "UserPromptSubmit":
      return "busy";
    case "SessionEnd":
      return "unknown";
    // (not one of Claude Code's own hooks: the desktop app reports it after the DM pressed Esc and the screen stopped looking busy, because an
    // interrupted Claude sends no Stop, and the status stayed "working": the 0.1.13 playtest)
    case "Interrupted":
      return state === "busy" || state === "blocked" ? "idle" : state;
    case "Notification": {
      const type = ev.notification_type ?? "", msg = ev.message ?? "";
      if (type === "permission_prompt" || type === "elicitation_dialog" || /permission|approve/i.test(msg)) return "blocked";
      // "waiting for your input" must not clear a permission prompt that is still open: only Stop does that
      if (type === "idle_prompt" || /waiting for your input/i.test(msg)) return state === "blocked" ? state : "idle";
      return state;
    }
    default:
      return state;
  }
}

export interface AssistSettings {
  /** The DM's edits must have been quiet this long. */
  quietMs: number;
  /** And the DM must not have typed in the Claude panel for this long. */
  typingQuietMs: number;
  /** The terminal itself must have printed nothing for this long. */
  terminalQuietMs: number;
  /** Least time between two nudges. */
  minGapMs: number;
  maxPerHour: number;
  /** Fewest separate edits worth a nudge. */
  minChanges: number;
}

export const DEFAULT_ASSIST: AssistSettings = { quietMs: 45_000, typingQuietMs: 20_000, terminalQuietMs: 3_000, minGapMs: 180_000, maxPerHour: 6, minChanges: 2 };

export interface AssistInput {
  now: number;
  enabled: boolean;
  claude: ClaudeState;
  terminal: { alive: boolean; quietMs: number; looksBusy: boolean };
  /** User-authored edits since the last nudge. */
  pending: number;
  /** When the newest of those happened (ms), if any. */
  lastEditAt: number | null;
  lastTypingAt: number | null;
  lastNudgeAt: number | null;
  nudgesLastHour: number;
  settings?: AssistSettings;
}

export type AssistDecision = { send: true } | { send: false; reason: string; retryInMs: number };

export function assistDecision(i: AssistInput): AssistDecision {
  const s = i.settings ?? DEFAULT_ASSIST;
  const no = (reason: string, retryInMs: number): AssistDecision => ({ send: false, reason, retryInMs: Math.max(1000, retryInMs) });
  if (!i.enabled) return no("off", 30_000);
  if (!i.terminal.alive) return no("Claude Code isn't running", 10_000);
  if (i.claude === "unknown") return no("Claude Code hasn't reported in yet", 10_000);
  if (i.claude === "blocked") return no("Claude is waiting for you to answer a question", 10_000);
  if (i.claude === "busy") return no("Claude is working", 5_000);
  if (i.terminal.looksBusy) return no("Claude Code looks busy", 5_000);
  if (i.terminal.quietMs < s.terminalQuietMs) return no("the terminal is still printing", s.terminalQuietMs - i.terminal.quietMs);
  if (i.pending < s.minChanges || i.lastEditAt === null) return no("nothing new to look at", 10_000);
  const sinceEdit = i.now - i.lastEditAt;
  if (sinceEdit < s.quietMs) return no("you're still editing", s.quietMs - sinceEdit);
  if (i.lastTypingAt !== null && i.now - i.lastTypingAt < s.typingQuietMs) return no("you're typing to Claude", s.typingQuietMs - (i.now - i.lastTypingAt));
  if (i.lastNudgeAt !== null && i.now - i.lastNudgeAt < s.minGapMs) return no("too soon after the last suggestion", s.minGapMs - (i.now - i.lastNudgeAt));
  if (i.nudgesLastHour >= s.maxPerHour) return no("hourly limit reached", 60_000);
  return { send: true };
}

/** What the DM changed by hand after change `since`: the count, the newest time and the distinct labels. */
export function userEditsSince(changes: ChangeEntry[], since: number): { count: number; lastAt: number | null; labels: string[] } {
  const mine = changes.filter((c) => c.seq > since && c.author === "user" && c.kind === "edit");
  const labels: string[] = [];
  for (const c of mine) if (!labels.includes(c.label)) labels.push(c.label);
  return { count: mine.length, lastAt: mine.length ? Date.parse(mine[mine.length - 1].time) : null, labels };
}

/** Make text safe to type into a terminal as one line: no control characters (an Enter inside would submit early). */
export function oneLine(s: string, max = 70): string {
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const ASK =
  "give me up to 3 short, concrete suggestions to expand, improve or fix this work, and say why each helps. " +
  "Suggest only: do not change the map, and do not invent names or lore, until I say yes.";

/**
 * The one-line message the "Ask Claude about this" box types into Claude Code: the DM's own words, and a pointer to their selection
 * (Claude reads the details with get_selection). One line, no control characters.
 */
export function askMessage(o: { text: string; selection: string; locked: boolean }): string {
  return `[Selection] About what I have selected in Dragon Drop (${oneLine(o.selection, 160)}${o.locked ? "; your edits are locked to it" : ""}), call get_selection first. ${oneLine(o.text, 600)}`;
}

/**
 * The one-line message a reference picture's "Ask Claude" button types into Claude Code: which picture (Claude looks at it with
 * view_reference) and the DM's own words. One line, no control characters.
 */
export function pictureAskMessage(o: { name: string; text: string }): string {
  return `[Picture] About the reference picture "${oneLine(o.name, 120)}" in Dragon Drop, look at it with view_reference first. ${oneLine(o.text, 600)}`;
}

/**
 * The one-line message the Assets tab's "Ask Claude to tag this pack" button types into Claude Code: which pack (its key, for search_assets) and how
 * to go about it. One line, no control characters.
 */
export function tagPackMessage(o: { pack: string; key: string; count: number }): string {
  return `[Assets] Please give the pictures of the pack "${oneLine(o.pack, 120)}" in my asset library words for what each shows (${o.count} pictures): search_assets with pack ${oneLine(o.key, 80)}, look at them with view_assets 12 at a time, and tag_assets what you see (the thing, its material, colour, mood). Only words for what is in the pictures.`;
}

/** The one-line message typed into Claude Code. `since` is the last change Claude has already been told about. */
export function assistMessage(o: { since: number; latest: number; labels: string[]; manual?: boolean }): string {
  const shown = o.labels.slice(-6).map((l) => oneLine(l));
  const more = o.labels.length > shown.length ? ` and ${o.labels.length - shown.length} more` : "";
  if (!shown.length) return `[Suggest] Look at the map as it is now with render_preview, then ${ASK}`;
  return `[${o.manual ? "Suggest" : "Assist"}] I changed the map by hand since change #${o.since} (now #${o.latest}): ${shown.join("; ")}${more}. ` +
    `Call get_changes_since ${o.since}, look at the area I touched with render_preview, then ${ASK}`;
}
