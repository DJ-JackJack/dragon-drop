import { describe, expect, it } from "vitest";
import {
  type AssistInput, type ChangeEntry, askMessage, assistDecision, assistMessage, claudeStateAfter, oneLine, userEditsSince,
} from "../src/index.ts";

describe("what Claude Code's hooks tell us", () => {
  it("follows a turn: idle at the start, busy while it works, idle when it stops", () => {
    let s = claudeStateAfter("unknown", { hook_event_name: "SessionStart" });
    expect(s).toBe("idle");
    s = claudeStateAfter(s, { hook_event_name: "UserPromptSubmit" });
    expect(s).toBe("busy");
    s = claudeStateAfter(s, { hook_event_name: "Stop" });
    expect(s).toBe("idle");
    expect(claudeStateAfter(s, { hook_event_name: "SessionEnd" })).toBe("unknown");
  });

  it("is idle again after an interrupt, which Claude Code sends no Stop for (the desktop app reports it: the 0.1.13 playtest)", () => {
    expect(claudeStateAfter("busy", { hook_event_name: "Interrupted" })).toBe("idle");
    expect(claudeStateAfter("blocked", { hook_event_name: "Interrupted" })).toBe("idle");
    // (an Esc while nothing was running changes nothing: a Claude that hasn't reported yet stays unknown)
    expect(claudeStateAfter("unknown", { hook_event_name: "Interrupted" })).toBe("unknown");
    expect(claudeStateAfter("idle", { hook_event_name: "Interrupted" })).toBe("idle");
  });

  it("is blocked at a permission question, and only a Stop clears it (an idle reminder must not)", () => {
    let s = claudeStateAfter("busy", { hook_event_name: "Notification", message: "Claude needs your permission to use Bash" });
    expect(s).toBe("blocked");
    s = claudeStateAfter(s, { hook_event_name: "Notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" });
    expect(s).toBe("blocked");
    expect(claudeStateAfter(s, { hook_event_name: "Stop" })).toBe("idle");
    expect(claudeStateAfter("busy", { hook_event_name: "Notification", notification_type: "permission_prompt" })).toBe("blocked");
    expect(claudeStateAfter("busy", { hook_event_name: "Notification", notification_type: "elicitation_dialog" })).toBe("blocked");
  });

  it("ignores events it doesn't know", () => {
    expect(claudeStateAfter("idle", { hook_event_name: "PreToolUse" })).toBe("idle");
    expect(claudeStateAfter("busy", {})).toBe("busy");
    expect(claudeStateAfter("busy", { hook_event_name: "Notification", message: "Logged in" })).toBe("busy");
  });
});

const NOW = 10_000_000;
const ready = (over: Partial<AssistInput> = {}): AssistInput => ({
  now: NOW, enabled: true, claude: "idle", terminal: { alive: true, quietMs: 20_000, looksBusy: false },
  pending: 3, lastEditAt: NOW - 60_000, lastTypingAt: null, lastNudgeAt: null, nudgesLastHour: 0, ...over,
});

describe("when a nudge may be sent", () => {
  it("sends when the DM has paused after real edits and Claude is idle", () => {
    expect(assistDecision(ready()).send).toBe(true);
  });

  it("never sends unless Claude Code has said it is idle", () => {
    for (const claude of ["unknown", "busy", "blocked"] as const) {
      const d = assistDecision(ready({ claude }));
      expect(d.send).toBe(false);
    }
  });

  it("never sends when the terminal is not running, still printing, or looks busy", () => {
    expect(assistDecision(ready({ terminal: { alive: false, quietMs: 60_000, looksBusy: false } })).send).toBe(false);
    expect(assistDecision(ready({ terminal: { alive: true, quietMs: 500, looksBusy: false } })).send).toBe(false);
    expect(assistDecision(ready({ terminal: { alive: true, quietMs: 60_000, looksBusy: true } })).send).toBe(false);
  });

  it("waits while the DM is editing or typing to Claude, and says how long", () => {
    const editing = assistDecision(ready({ lastEditAt: NOW - 10_000 }));
    expect(editing.send).toBe(false);
    if (!editing.send) expect(editing.retryInMs).toBeGreaterThanOrEqual(30_000);
    expect(assistDecision(ready({ lastTypingAt: NOW - 5_000 })).send).toBe(false);
    expect(assistDecision(ready({ lastTypingAt: NOW - 60_000 })).send).toBe(true);
  });

  it("needs enough new edits, and respects the off switch", () => {
    expect(assistDecision(ready({ pending: 1 })).send).toBe(false);
    expect(assistDecision(ready({ pending: 0, lastEditAt: null })).send).toBe(false);
    expect(assistDecision(ready({ enabled: false })).send).toBe(false);
  });

  it("is limited in rate", () => {
    expect(assistDecision(ready({ lastNudgeAt: NOW - 60_000 })).send).toBe(false);
    expect(assistDecision(ready({ lastNudgeAt: NOW - 400_000 })).send).toBe(true);
    expect(assistDecision(ready({ nudgesLastHour: 6 })).send).toBe(false);
  });
});

const change = (seq: number, author: ChangeEntry["author"], label: string, kind: ChangeEntry["kind"] = "edit", t = seq * 1000): ChangeEntry =>
  ({ seq, kind, author, label, rect: null, time: new Date(1_700_000_000_000 + t).toISOString() });

describe("what the DM changed by hand", () => {
  const log = [change(1, "user", "Raise land"), change(2, "claude", "Add reef"), change(3, "user", "Add place Test Town"), change(4, "user", "Undo: x", "undo"), change(5, "user", "Raise land"), change(6, "user", "Add place Test Town")];

  it("counts only the DM's own edits after the last nudge, once per label", () => {
    const r = userEditsSince(log, 1);
    expect(r.count).toBe(3); // seq 3, 5, 6 (not Claude's, not the undo)
    expect(r.labels).toEqual(["Add place Test Town", "Raise land"]);
    expect(r.lastAt).toBe(Date.parse(log[5].time));
    expect(userEditsSince(log, 6)).toEqual({ count: 0, lastAt: null, labels: [] });
  });
});

describe("the message typed into Claude Code", () => {
  it("is one line with no control characters, whatever a place is called", () => {
    const evil = "Add place Bad\r\nname\u001b[31m\u0007 /exit";
    const msg = assistMessage({ since: 4, latest: 9, labels: ["Raise land", evil] });
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(msg)).toBe(false);
    expect(msg.startsWith("[Assist] ")).toBe(true);
    expect(msg).toContain("get_changes_since 4");
    expect(msg).toContain("(now #9)");
    expect(msg).toContain("Suggest only");
    expect(msg).toContain("do not invent names or lore");
  });

  it("lists the latest few edits and counts the rest, and caps long labels", () => {
    const labels = Array.from({ length: 9 }, (_, i) => `Edit number ${i + 1}`);
    const msg = assistMessage({ since: 0, latest: 9, labels });
    expect(msg).toContain("Edit number 9");
    expect(msg).not.toContain("Edit number 1;");
    expect(msg).toContain("and 3 more");
    expect(oneLine("x".repeat(200), 20).length).toBe(20);
  });

  it("asks for a look at the map as it is when nothing changed, and says Suggest for the button", () => {
    expect(assistMessage({ since: 5, latest: 5, labels: [], manual: true }).startsWith("[Suggest] Look at the map as it is now")).toBe(true);
    expect(assistMessage({ since: 1, latest: 3, labels: ["Raise land"], manual: true }).startsWith("[Suggest] ")).toBe(true);
  });
});

describe("asking Claude about a selection", () => {
  it("is one line with the DM's words and a pointer to the selection, whatever the text holds", () => {
    const m = askMessage({ text: "make this\nswampier\r\n and \u001b[31mred\u0007", selection: "a 120×90 px rectangle at (10, 20)", locked: true });
    expect(m).not.toMatch(/[\u0000-\u001f]/);
    expect(m).toContain("[Selection]");
    expect(m).toContain("a 120×90 px rectangle at (10, 20)");
    expect(m).toContain("your edits are locked to it");
    expect(m).toContain("call get_selection first");
    expect(m.endsWith("make this swampier and [31mred")).toBe(true); // the control bytes (newlines, the escape, the bell) become spaces; nothing else changes
    expect(askMessage({ text: "hi", selection: "a point", locked: false })).not.toContain("locked");
  });
  it("is cut to a sensible length", () => {
    const m = askMessage({ text: "x".repeat(5000), selection: "y".repeat(500), locked: false });
    expect(m.length).toBeLessThan(900);
  });
});
