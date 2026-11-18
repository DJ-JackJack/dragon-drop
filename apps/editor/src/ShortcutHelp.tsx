/**
 * The keyboard and mouse sheet (press ? or use the ? button in the top bar). The tool keys come from the same lists the toolbar and the key
 * handler use, so they can't drift; the rest is what the views and App's key handler really do.
 */
import { BATTLE_TOOL_GROUPS } from "./Battle.tsx";
import { TOOL_GROUPS } from "./toolDefs.ts";

const Key = ({ children }: { children: string }) => <kbd>{children}</kbd>;

function Row({ keys, what }: { keys: string[]; what: string }) {
  return (
    <div className="keyrow">
      <span className="keys">{keys.map((k, i) => <span key={k}>{i > 0 && <span className="or"> or </span>}<Key>{k}</Key></span>)}</span>
      <span>{what}</span>
    </div>
  );
}

export function ShortcutHelp({ battle, onClose }: { battle: boolean; onClose: () => void }) {
  const tools: { id: string; label: string; key: string }[] = (battle ? BATTLE_TOOL_GROUPS : TOOL_GROUPS).flatMap((g) => g.tools as { id: string; label: string; key: string }[]);
  return (
    <div className="modal-back" onMouseDown={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="modal wide shortcuts" role="dialog" aria-modal="true" data-testid="shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Keyboard and mouse</h2>

        <fieldset>
          <legend>Moving around</legend>
          <Row keys={["Wheel"]} what="Zoom in and out, toward the pointer" />
          <Row keys={["+", "-"]} what="Zoom in / out" />
          <Row keys={["0", "Ctrl+0"]} what="Fit the whole map in the window" />
          <Row keys={["Arrow keys"]} what="Move the view (hold Shift to go faster)" />
          <Row keys={["Space + drag", "Middle-drag", "Right-drag"]} what="Move the view with any tool" />
          <Row keys={["H"]} what="The Pan tool: drag to move the view" />
        </fieldset>

        <fieldset>
          <legend>Editing</legend>
          <Row keys={["Ctrl+Z"]} what="Undo (Claude's edits too)" />
          <Row keys={["Ctrl+Shift+Z", "Ctrl+Y"]} what="Redo" />
          <Row keys={["Shift + click"]} what="Select several: add something to the selection, or take it out" />
          <Row keys={[battle ? "Drag a box" : "Shift + drag a box"]} what={battle ? "With the Select tool, on bare ground: select everything inside the box (Shift adds to what is selected)" : "With the Select tool, on bare ground: select the places and labels inside the box"} />
          <Row keys={["Drag"]} what="Move everything that is selected together" />
          <Row keys={["Ctrl+C", "Ctrl+V"]} what={battle ? "Copy and paste the selected objects, lights, walls and light zones (it lands under the pointer)" : "Copy and paste the selected place or label (it lands under the pointer; a place is named \"... (copy)\")"} />
          <Row keys={["Ctrl+D"]} what="Duplicate the selection, a little along and down" />
          <Row keys={["Ctrl+S"]} what="Save now (the map also saves itself a moment after every change)" />
          <Row keys={["[", "]"]} what="Smaller / larger brush" />
          <Row keys={["G"]} what="Show or hide the grid" />
          <Row keys={["Esc"]} what="Cancel what you are drawing, or clear the selection" />
          <Row keys={["Enter", "Double-click"]} what="Finish a wall, line or outline" />
          <Row keys={["Backspace"]} what="Remove the last point while drawing; with something selected, delete it" />
          <Row keys={["Delete"]} what="Delete what is selected" />
          {battle && <Row keys={["Q", "E"]} what="Turn the selected object (or the one you are about to place) 15° left / right" />}
          {battle && <Row keys={["X"]} what="Flip the selected object (or the one you are about to place)" />}
          {battle && <Row keys={["Alt"]} what="Hold it while placing or moving an object to put it anywhere (it snaps to a quarter square otherwise)" />}
        </fieldset>

        <fieldset>
          <legend>Tools</legend>
          <div className="toolkeys">
            {tools.map((t) => (
              <span key={t.id} className="toolkey"><Key>{t.key}</Key> {t.label}</span>
            ))}
          </div>
        </fieldset>

        <div className="row end">
          <button className="primary" onClick={onClose} autoFocus>Close</button>
        </div>
      </div>
    </div>
  );
}
