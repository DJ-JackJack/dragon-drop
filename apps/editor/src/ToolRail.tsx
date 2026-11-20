/**
 * The tool rail, down the left edge: one small picture and a short name for each tool, grouped, in the order of the tool lists (toolDefs.ts, Battle.tsx, cityUi.ts: one list per kind of map,
 * so the rail, the key handler and the shortcut sheet agree). The tool's full name is its accessible name; its tip and key are in the tooltip.
 */
import { ToolIcon } from "./toolIcons.tsx";

export interface RailTool { id: string; label: string; key: string; tip: string }
export interface RailGroup { name: string; tools: RailTool[] }

/** Names too long for the rail's width. */
const SHORT: Record<string, string> = { "Select area": "Area", "Secret door": "Secret", "Invisible wall": "Invisible", "Detail map": "Detail", "Battlemap here": "Battlemap", "Paint ground": "Ground" };

export function ToolRail({ groups, active, onPick, testId }: { groups: RailGroup[]; active: string; onPick: (id: string) => void; testId?: (id: string) => string }) {
  return (
    <nav className="rail" aria-label="Tools" data-testid="tool-rail">
      {groups.map((g) => (
        <div key={g.name} className="rail-group" role="group" aria-label={g.name}>
          {g.tools.map((x) => (
            <button
              key={x.id} className={`rail-tool${active === x.id ? " on" : ""}`} aria-label={x.label} aria-pressed={active === x.id}
              title={`${x.tip} (${x.key})`} onClick={() => onPick(x.id)} data-testid={testId?.(x.id)}
            >
              <ToolIcon id={x.id} />
              <span className="rail-name">{SHORT[x.label] ?? x.label}</span>
              <span className="rail-key" aria-hidden="true">{x.key}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
