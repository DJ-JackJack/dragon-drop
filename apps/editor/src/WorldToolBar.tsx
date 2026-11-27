/** The world map's tool bar: the settings of the tool in use, and what to do next with it. */
import { REALM_HINT, RealmToolBar } from "./RealmBar.tsx";
import { GROUND_HINT, GroundToolBar } from "./GroundBar.tsx";
import { type LabelKind, type LineKind, type PlaceType, type RiverSize, MAX_SMOOTH_REACH_PX, TRAVEL_MODES, type TravelModeId, describeRoute, placeKind, routeLength, travelEstimates, type Units, distUnit, paceFromMi, paceToMi } from "@mapmaker/core";
import { MEASURE_HINT, measureCtl, useMeasure, worldLength } from "./measure.ts";
import { store } from "./store.ts";
import { unitsNow, useMapUnits } from "./units.tsx";
import { RIVER_SIZE_NAMES } from "./WaterPanel.tsx";
import { PlaceGlyph, PlaceKindPicker } from "./PlaceKindPicker.tsx";
import { LABEL_KINDS } from "./Panels.tsx";
import type { AreaShape, Brush, Tool } from "./MapView.tsx";
import { Popover, ToolBar } from "./ToolBar.tsx";
import { TOOL_GROUPS } from "./toolDefs.ts";
import { BrushSize } from "./BrushSize.tsx";

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
  cityhere: "Click a town's marker or any spot on land. A box asks for the settlement map's name and size; its climate, height above the sea, slope, coast, river and woods come from that spot. A world-map pixel is a kilometre or more, so it is a rough start to shape.",
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

/** The ruler's second line: what the route crosses once surveyed, else what to do. */
function measureHint(ms: ReturnType<typeof useMeasure>, u: Units): string {
  if (ms.survey && ms.points.length >= 2) return `${describeRoute(ms.survey, u)}.${ms.survey.climateKnown ? "" : " (The climate isn't worked out yet: forest and marsh count as open ground.)"}`;
  return MEASURE_HINT;
}

/** The ruler on a world map: how you travel, your pace, and how far and how long. */
function WorldMeasure({ ms }: { ms: ReturnType<typeof useMeasure> }) {
  const km = routeLength(measureCtl.shown()) * (store.state.meta?.kmPerPx ?? 1);
  const u = useMapUnits();
  const mode = TRAVEL_MODES.find((m) => m.id === ms.mode) ?? TRAVEL_MODES[0];
  const est = ms.survey && ms.points.length >= 2 ? travelEstimates(ms.survey, ms.paces, TRAVEL_MODES, u).find((t) => t.mode === ms.mode) : null;
  // (paces are kept in miles a day; shown and typed in the map's units)
  const usual = Math.round(paceFromMi(mode.milesPerDay, u));
  return (
    <>
      <label className="field">Travel
        <select value={ms.mode} onChange={(e) => measureCtl.setMode(e.target.value as TravelModeId)} data-testid="measure-mode">
          {TRAVEL_MODES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="field" title={`${u === "metric" ? "Kilometres" : "Miles"} a day on open ground or a road (rough ground is slower). Change it to your own table's pace; it is remembered on this computer.`}>
        <input type="number" min={1} max={999} step={1} value={ms.paces[mode.id] ? Math.round(paceFromMi(ms.paces[mode.id]!, u)) : usual} style={{ width: 58 }} data-testid="measure-pace"
          onChange={(e) => { const v = Number(e.target.value); measureCtl.setPace(mode.id, v === usual ? null : paceToMi(v, u)); }} /> {distUnit(u)} a day
      </label>
      <span className="measure-result" data-testid="measure-result">
        {ms.points.length < 2 && !ms.hover ? "Click to start a route" : <>
          <b>{worldLength(km, u)}</b>
          {est && <> · {mode.name}: <b>{est.time}</b>{est.note ? ` (${est.note})` : ""}</>}
        </>}
      </span>
    </>
  );
}

export function WorldToolBar({ tool, brush, onBrush, lineKind, onLineKind, lineAuto, onLineAuto, areaShape, onAreaShape, placeType, onPlaceType, labelKind, onLabelKind, riverMode, onRiverMode, riverSize, onRiverSize }: {
  tool: Tool; brush: Brush; onBrush: (b: Brush) => void; lineKind: LineKind; onLineKind: (k: LineKind) => void; lineAuto: boolean; onLineAuto: (on: boolean) => void;
  areaShape: AreaShape; onAreaShape: (a: AreaShape) => void; placeType: PlaceType; onPlaceType: (t: PlaceType) => void; labelKind: LabelKind; onLabelKind: (k: LabelKind) => void;
  riverMode: RiverMode; onRiverMode: (m: RiverMode) => void; riverSize: RiverSize; onRiverSize: (s: RiverSize) => void;
}) {
  const ms = useMeasure();
  const hint = tool === "line" ? lineHint(lineKind, lineAuto) : tool === "river" ? riverHint(riverMode) : tool === "measure" ? measureHint(ms, unitsNow()) : tool === "realm" ? REALM_HINT : tool === "biome" ? GROUND_HINT : TOOL_HINTS[tool];
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
      {tool === "measure" && <WorldMeasure ms={ms} />}
      {tool === "realm" && <RealmToolBar />}
      {tool === "biome" && <GroundToolBar />}
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
          <BrushSize label="Brush size" value={brush.radius} min={1} max={300} unit="px" testId="brush-size" title="The brush's radius in map pixels. [ and ] change it too."
            onChange={(v) => onBrush({ ...brush, radius: v })} />
          <label className="slider">
            <span>Strength <b>{Math.round(brush.strength * 100)}%</b></span>
            <input type="range" min={5} max={100} value={Math.round(brush.strength * 100)} onChange={(e) => onBrush({ ...brush, strength: Number(e.target.value) / 100 })} />
          </label>
          {tool === "smooth" && (
            <label className="slider" title="How far the smoothing reaches. Raise it to soften a wide straight step or terrace in the land: it is spread into a slope about this wide. The coast stays where it is.">
              <span>Reach <b>{(brush.reach ?? 0) >= 2 ? `${brush.reach} px` : "near"}</b></span>
              <input type="range" min={1} max={MAX_SMOOTH_REACH_PX} value={Math.max(1, brush.reach ?? 1)} data-testid="smooth-reach"
                onChange={(e) => onBrush({ ...brush, reach: Number(e.target.value) })} />
            </label>
          )}
        </>
      )}
    </ToolBar>
  );
}
