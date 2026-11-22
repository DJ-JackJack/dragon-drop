/**
 * The tool bar, under the top bar: the settings of the tool in use (sizes, kinds, shapes), and below them what to do next with it. Big pickers (the floor materials, the kind of place)
 * open from a button in it (`Popover`) instead of taking room in the bar. Each kind of map fills it with its own settings (WorldToolBar.tsx, Battle.tsx, CityPanels.tsx).
 */
import { Children, type ReactNode, useEffect, useRef, useState } from "react";
import { ToolIcon } from "./toolIcons.tsx";
import { forAssistant, useAssistantName } from "./assistantName.ts";

/** `tool`: the tool in use, named at the start of the bar when it has no settings (so the bar is never an empty strip). */
export function ToolBar({ children, hint, tool }: { children?: ReactNode; hint?: string; tool?: { id: string; name: string } }) {
  const ai = useAssistantName();
  const empty = Children.toArray(children).length === 0;
  return (
    <div className="toolbar" data-testid="toolbar">
      <div className="tb-row">{empty && tool ? <span className="tb-tool" data-testid="toolbar-tool"><ToolIcon id={tool.id} /> {tool.name}</span> : children}</div>
      <p className={`tool-hint${hint ? "" : " empty"}`} data-testid={hint ? "tool-hint" : undefined}>{hint ? forAssistant(hint, ai) : ""}</p>
    </div>
  );
}

/** A button that opens a panel below it. It closes on a click anywhere else or Esc. */
export function Popover({ label, children, testId, title }: { label: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); testId?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div className="pop" ref={box}>
      <button className="pop-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} title={title} data-testid={testId}>{label} <span aria-hidden="true">▾</span></button>
      {open && <div className="pop-body" data-testid={testId ? `${testId}-body` : undefined}>{typeof children === "function" ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}
