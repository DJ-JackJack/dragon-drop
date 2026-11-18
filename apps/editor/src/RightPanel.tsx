/** The right-hand side: Claude Code (desktop), the API chat (when it can be used), and the asset browser (battlemaps). */
import { useEffect } from "react";
import { ChatPanel } from "./ChatPanel.tsx";
import { AssetPanel } from "./AssetPanel.tsx";
import { ClaudeTerminal } from "./ClaudeTerminal.tsx";
import type { Assist } from "./useAssist.ts";
import type { BattleUi } from "./Battle.tsx";
import type { AppState } from "./store.ts";

export type RightTab = "claude" | "api" | "assets";

export function defaultTab(desktop: boolean): RightTab {
  return desktop ? "claude" : "api";
}

export function RightPanel({ s, desktop, assist, wide, onToggleWide, tab, onTab, battle, ui, onUi, focus }: {
  s: AppState; desktop: boolean; assist: Assist; wide: boolean; onToggleWide: () => void; tab: RightTab; onTab: (t: RightTab) => void;
  battle: boolean; ui: BattleUi; onUi: (p: Partial<BattleUi>) => void; focus: { cat: string; n: number };
}) {
  const tabs: { id: RightTab; label: string }[] = [];
  if (desktop) tabs.push({ id: "claude", label: "Terminal" });
  if (!desktop || s.apiKeyConfigured) tabs.push({ id: "api", label: desktop ? "API chat" : "Chat" });
  if (battle) tabs.push({ id: "assets", label: "Assets" });
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
      {active === "assets" && <AssetPanel meta={s.meta} ui={ui} onUi={onUi} desktop={desktop} focus={focus} />}
    </div>
  );
}
