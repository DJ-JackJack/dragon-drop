/** The world map's tool bar: the settings of the tool in use, and what to do next with it. */
import { type LabelKind, type LineKind, type PlaceType, type RiverSize, placeKind } from "@mapmaker/core";
import { RIVER_SIZE_NAMES } from "./WaterPanel.tsx";
import { PlaceGlyph, PlaceKindPicker } from "./PlaceKindPicker.tsx";
import { LABEL_KINDS } from "./Panels.tsx";
import type { AreaShape, Brush, Tool } from "./MapView.tsx";
import { Popover, ToolBar } from "./ToolBar.tsx";
import { TOOL_GROUPS } from "./toolDefs.ts";

export const AREA_SHAPES: { id: AreaShape; label: string; tip: string }[] = [
  { id: "rect", label: "Rectangle", tip: "Drag from one corner to the opposite one" },
  { id: "circle", label: "Circle", tip: "Drag from the centre outwards" },
  { id: "free", label: "Freehand", tip: "Draw round the area; it closes itself when you let go" },
  { id: "poly", label: "Polygon", tip: "Click the corners; double-click, click the first corner or press Enter to close it. Backspace drops a corner, Esc cancels" },
];

/** What to do next with the active tool. */
export const TOOL_HINTS: Partial<Record<Tool, string>> = {
  pan: "Drag to move the map. Hold Space, or drag with the right button, to move it with any tool. + and - zoom.",
  area: "Drag out an area (pick its shape above), or for a polygon click its corners and double-click to close. Claude can see it, and while the lock is on its edits stay inside it. Click for a single point. Esc clears.",
  place: "Click on the map where the place goes. A box will ask for its name.",
  label: "Click for a straight label, or click and drag to draw a line for the name to follow. A box will ask for the text.",
  region: "Click the corners of the area, one at a time. Double-click, click the first corner, or press Enter to finish. Esc cancels.",
  line: "", // depends on the kind: see lineHint()
  cityhere: "Click a town's marker or any spot on land. A box asks for the city map's name and size; its climate, height above the sea, slope, coast, river and woods come from that spot. A world-map pixel is a kilometre or more, so it is a rough start to shape.",
  battlehere: "Click the spot. A box will ask for the battlemap's name; its floors come from that spot's climate, slope, rivers, lakes and coast. You can build rooms, add objects and lights afterwards.",
  detail: "Drag a box on the map. The new map keeps this one's land, climate and names, with 2× to 16× the detail.",
  select: "Click a place, label, region or road to select it. Drag to move it. Delete removes it.",
  river: "", // depends on the mode: see riverHint()
};

/** The River tool: what it does in each mode ("add" first: adding rivers is what people expect of it). */
export type RiverMode = "add" | "name";
export function riverHint(mode: RiverMode): string {
  return mode === "name"
    ? "Point at a river or a lake: it lights up whole, from its source to where it ends. Click to name it, or to select it if it already has a name (Claude sees what you selected). A name follows its river when the land changes."
    : "Drag from where a river starts to where it ends (the sea, a lake, or open land): the land is cut along your line so the water runs there. Or click on land to start a river that finds its own way downhill. Click a source (blue) to change or remove it.";
}

export function lineHint(kind: LineKind, auto: boolean): string {
  if (kind === "reef") return "Click the points along the reef (for a strait, from one coast to the other). Double-click or press Enter to finish. Backspace removes the last point, Esc cancels.";
  if (kind === "border") return "Click the points along the border. Double-click or press Enter to finish. Click the first point to close a territory. Backspace removes the last point, Esc cancels.";
  if (auto) return `Click where the ${kind} starts, then where it ends (click more points to make it pass through them). Double-click or press Enter to finish: the route is found over the terrain for you. Esc cancels.`;
  return `Click the points the ${kind} passes through. Double-click or press Enter to finish. Backspace removes the last point, Esc cancels.`;
}

export const BRUSHES: Tool[] = ["raise", "lower", "smooth", "flatten", "land", "water"];

export function WorldToolBar({ tool, brush, onBrush, lineKind, onLineKind, lineAuto, onLineAuto, areaShape, onAreaShape, placeType, onPlaceType, labelKind, onLabelKind, riverMode, onRiverMode, riverSize, onRiverSize }: {
  tool: Tool; brush: Brush; onBrush: (b: Brush) => void; lineKind: LineKind; onLineKind: (k: LineKind) => void; lineAuto: boolean; onLineAuto: (on: boolean) => void;
  areaShape: AreaShape; onAreaShape: (a: AreaShape) => void; placeType: PlaceType; onPlaceType: (t: PlaceType) => void; labelKind: LabelKind; onLabelKind: (k: LabelKind) => void;
  riverMode: RiverMode; onRiverMode: (m: RiverMode) => void; riverSize: RiverSize; onRiverSize: (s: RiverSize) => void;
}) {
  const hint = tool === "line" ? lineHint(lineKind, lineAuto) : tool === "river" ? riverHint(riverMode) : TOOL_HINTS[tool];
  return (
    <ToolBar hint={hint || undefined} tool={{ id: tool, name: TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.id === tool)?.label ?? tool }}>
      {tool === "line" && (
        <>
          <label className="field">Draw a
            <select value={lineKind} onChange={(e) => onLineKind(e.target.value as LineKind)} data-testid="line-kind">
              <option value="road">Road</option>
              <option value="trail">Trail</option>
              <option value="border">Border</option>
              <option value="reef">Reef</option>
            </select>
          </label>
          {(lineKind === "road" || lineKind === "trail") && (
            <label className="check"><input type="checkbox" checked={lineAuto} onChange={(e) => onLineAuto(e.target.checked)} /> Find the route over the terrain</label>
          )}
        </>
      )}
      {tool === "river" && (
        <>
          <div className="seg" role="group" aria-label="River tool" data-testid="river-modes">
            <button className={riverMode === "add" ? "on" : ""} onClick={() => onRiverMode("add")} data-testid="river-mode-add" title="Drag to draw a river's course, or click on land to start a river there">Add a river</button>
            <button className={riverMode === "name" ? "on" : ""} onClick={() => onRiverMode("name")} data-testid="river-mode-name" title="Point at a river or lake to see it; click to name or select it">Name and select</button>
          </div>
          {riverMode === "add" && (
            <label className="field">Size
              <select value={riverSize} onChange={(e) => onRiverSize(e.target.value as RiverSize)} data-testid="river-size">
                {RIVER_SIZE_NAMES.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      {tool === "area" && (
        <div className="seg" role="group" aria-label="Area shape" data-testid="area-shapes">
          {AREA_SHAPES.map((a) => (
            <button key={a.id} className={areaShape === a.id ? "on" : ""} onClick={() => onAreaShape(a.id)} title={a.tip} data-testid={`area-${a.id}`}>{a.label}</button>
          ))}
        </div>
      )}
      {tool === "place" && (
        <div className="field" data-testid="place-kinds">New place
          <Popover label={<><PlaceGlyph type={placeType} /> <b className="kind-name">{placeKind(placeType).name}</b></>} title="Choose what kind of place to add" testId="place-kind-menu">
            {(close) => <PlaceKindPicker value={placeType} onChange={(t) => { onPlaceType(t); close(); }} />}
          </Popover>
        </div>
      )}
      {tool === "label" && (
        <label className="field">New label kind
          <select value={labelKind} onChange={(e) => onLabelKind(e.target.value as LabelKind)}>
            {LABEL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
      )}
      {BRUSHES.includes(tool) && (
        <>
          <label className="slider">
            <span>Brush size <b>{brush.radius}</b> px</span>
            <input type="range" min={1} max={150} value={brush.radius} onChange={(e) => onBrush({ ...brush, radius: Number(e.target.value) })} />
          </label>
          <label className="slider">
            <span>Strength <b>{Math.round(brush.strength * 100)}%</b></span>
            <input type="range" min={5} max={100} value={Math.round(brush.strength * 100)} onChange={(e) => onBrush({ ...brush, strength: Number(e.target.value) / 100 })} />
          </label>
        </>
      )}
    </ToolBar>
  );
}
