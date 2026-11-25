import { useEffect, useState } from "react";
import { NAME_SIZE_MAX, NAME_SIZE_MIN } from "@mapmaker/core";

/**
 * A name's own size on the map, as a multiple of its usual size (a place's, a river's or lake's, a realm's, a settlement's street, building or district name).
 * The slider shows the new size as it moves and sends it when let go, so one drag is one undo step; "Usual size" puts it back to 1.
 */
export function NameSizeSlider({ value, onCommit, label = "Name size", testid = "name-size" }: { value: number | undefined; onCommit: (v: number) => void; label?: string; testid?: string }) {
  const cur = value ?? 1;
  const [v, setV] = useState(cur);
  useEffect(() => setV(cur), [cur]);
  const commit = () => { if (v !== cur) onCommit(v); };
  return (
    <div className="name-size">
      <label className="slider" title="How big this name is drawn, on the map and in exports. The Label size setting makes every name bigger or smaller on top of this.">
        <span>{label} <b>{v.toFixed(2)}×</b></span>
        <input type="range" min={NAME_SIZE_MIN} max={NAME_SIZE_MAX} step={0.05} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid={testid} />
      </label>
      {cur !== 1 && <button onClick={() => onCommit(1)} title="Back to the size names of its kind usually are" data-testid={`${testid}-reset`}>Usual size</button>}
    </div>
  );
}

/** The Label size setting (every name and marker bigger or smaller), as the Map panel and the export dialogs show it. */
export const LABEL_SIZE_MIN = 0.4, LABEL_SIZE_MAX = 1.6;

/** An export's label size: it starts at the Label size setting, so the picture's names are as big as on screen (in proportion to the map), and can be changed for this export. */
export function ExportLabelSize({ value, setting, onChange }: { value: number; setting: number; onChange: (v: number) => void }) {
  return (
    <label className="slider" title="How big names, labels and markers are in the picture, in proportion to the map. It starts at your Label size setting.">
      <span>Label size <b>{value.toFixed(1)}×</b>{value !== setting && <span className="muted"> (yours is {setting.toFixed(1)}×)</span>}</span>
      <input type="range" min={LABEL_SIZE_MIN} max={LABEL_SIZE_MAX} step={0.1} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid="export-label-size" />
    </label>
  );
}
