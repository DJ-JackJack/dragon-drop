/** The Claude panel, on the right: Claude Code (desktop) and the API chat (when it can be used). It can be hidden from the top bar. */
import { useEffect } from "react";
import { ChatPanel } from "./ChatPanel.tsx";
import { ClaudeTerminal } from "./ClaudeTerminal.tsx";
import type { Assist } from "./useAssist.ts";
import type { AppState } from "./store.ts";

export type RightTab = "claude" | "api";

export function defaultTab(desktop: boolean): RightTab {
  return desktop ? "claude" : "api";
}

export function RightPanel({ s, desktop, assist, wide, onToggleWide, tab, onTab }: {
  s: AppState; desktop: boolean; assist: Assist; wide: boolean; onToggleWide: () => void; tab: RightTab; onTab: (t: RightTab) => void;
}) {
  const tabs: { id: RightTab; label: string }[] = [];
  if (desktop) tabs.push({ id: "claude", label: "Terminal" });
  if (!desktop || s.apiKeyConfigured) tabs.push({ id: "api", label: desktop ? "API chat" : "Chat" });
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  useEffect(() => { if (active === "claude" && assist.ready) assist.clearReady(); }, [active, assist]);
  return (
    <div className="right-panel">
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} className={active === t.id ? "on" : ""} onClick={() => onTab(t.id)} data-testid={`tab-${t.id}`}>
              {t.label}{t.id === "claude" && assist.ready && active !== "claude" ? <span className="tab-dot" title="Claude has suggestions for you" data-testid="assist-ready"> ●</span> : null}
            </button>
          ))}
        </div>
      )}
      {active === "claude" && <ClaudeTerminal wide={wide} onToggleWide={onToggleWide} assist={assist} claude={s.claude} />}
      {active === "api" && <ChatPanel s={s} />}
    </div>
  );
}
