/**
 * The Ground tool's settings (groundUi.ts; core groundPaint.ts): the kind of ground to paint (from the Ground legend's kinds a brush can paint, by group, with
 * their swatches), paint or erase, the brush, land only, and Clear all. Painted ground is paint, not climate: the rain and rivers stay as they are.
 */
import { useSyncExternalStore } from "react";
import { GROUND_INFO, PAINTABLE_GROUNDS } from "@mapmaker/core";
import { store } from "./store.ts";
import { Popover } from "./ToolBar.tsx";
import { confirmBox } from "./dialogs.tsx";
import { groundCtl, groundInfo, useGroundSettings } from "./groundUi.ts";
import { BrushSize, across, half } from "./BrushSize.tsx";

export const GROUND_HINT = "Paint a kind of ground where you want it, over what the climate makes there: choose it above, then drag. Erase gives the climate its say again. It is paint only: the rain, rivers and climate stay as they are. It shows in the Painted style. Each stroke is one undo step.";

const PAINTABLE = new Set<string>(PAINTABLE_GROUNDS.map((g) => g.id));
const sw = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export function GroundToolBar() {
  const st = useGroundSettings();
  const meta = useSyncExternalStore(store.subscribe, () => store.getState().meta);
  const painted = useSyncExternalStore(store.subscribe, () => !!store.getState().features.groundCells);
  const chosen = groundInfo(st.ground);
  const groups = [...new Set(GROUND_INFO.filter((g) => PAINTABLE.has(g.id)).map((g) => g.group))];
  return (
    <>
      <Popover label={chosen ? <><span className="swatch now" style={{ background: sw(chosen.swatch) }} /> <b>{chosen.name}</b></> : "Choose a ground"} title="The kind of ground to paint" testId="ground-menu">
        {(close) => (
          <div className="ground-pick" data-testid="ground-pick">
            {groups.map((grp) => (
              <div key={grp} className="ground-group">
                <div className="muted ground-group-name">{grp}</div>
                <div className="ground-grid">
                  {GROUND_INFO.filter((g) => g.group === grp && PAINTABLE.has(g.id)).map((g) => (
                    <button key={g.id} className={`ground-kind${g.id === st.ground ? " on" : ""}`} title={g.where} onClick={() => { groundCtl.set({ ground: g.id, erase: false }); close(); }} data-testid={`ground-${g.id}`}>
                      <span className="swatch" style={{ background: sw(g.swatch) }} /> {g.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Popover>
      <div className="seg" role="group" aria-label="Paint or erase">
        <button className={st.erase ? "" : "on"} onClick={() => groundCtl.set({ erase: false })} data-testid="ground-paint">Paint</button>
        <button className={st.erase ? "on" : ""} onClick={() => groundCtl.set({ erase: true })} title="Take painted ground away under the brush: the climate decides there again" data-testid="ground-erase">Erase</button>
      </div>
      <BrushSize label="Brush" value={st.radius} min={2} max={300} show={across} unshow={half} unit="px across" testId="ground-brush" title="How wide the brush is, in map pixels. [ and ] change it too."
        onChange={(v) => groundCtl.set({ radius: v })} />
      <label className="check" title="Keep the sea and lakes out: the ground stops at the coast"><input type="checkbox" checked={st.landOnly} onChange={(e) => groundCtl.set({ landOnly: e.target.checked })} /> Land only</label>
      {painted && (
        <button onClick={async () => { if (await confirmBox("Take all the painted ground off this map? The climate decides the ground everywhere again. Undo brings it back.", "Clear all")) groundCtl.clearAll(); }} data-testid="ground-clear">Clear all</button>
      )}
      {meta && meta.style && meta.style !== "painted" && <span className="muted" data-testid="ground-style-note">Shows in the Painted style (Map panel, Style)</span>}
    </>
  );
}
