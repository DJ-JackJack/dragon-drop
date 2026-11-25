/** The city map's tool bar (the options of the chosen tool), the inspector for what is selected, and the city's own settings (its land and climate) for the Map panel. */
import { GenerateBox } from "./GenerateBox.tsx";
import { useState, useSyncExternalStore } from "react";
import {
  BUILDING_KINDS, CITY_CLIMATES, CITY_LABEL_KINDS, MATERIALS, ROOF_BASE, ROOF_STYLES, ROOF_STYLE_NAMES, STREET_KINDS, TREE_SPECIES, WALL_KINDS, cityClimate, climatePreset, polygonArea, pointsBounds, type BuildingKind,
  type CityClimate, type CityLabelKind, type CityWallKind, type Features, type MapBuilding, type MapCityWall, type MapDistrict, type MapLabel, cityLabelKind, districtColour, pointInPolygon, polygonCentroid, type MapLandform, type MapMeta, type MapStreet, type MapTrees, type RoofStyle, type StreetKind, type TreeGroup, type TreeSpecies,
  cityWallPieces, wallPieces, wallSettings, cityRoute, LAND_STARTS, type LandStart, newSeed, startLand, withNameSize,
} from "@mapmaker/core";
import { LABEL_SIZE_MIN, LABEL_SIZE_MAX, NameSizeSlider } from "./NameSize.tsx";
import { GroundPanel } from "./GroundPanel.tsx";
import { CITY_TOOL_DEFS, type CityUi, type LandMode, landName, removeSelected, selectedOf, sendCityFeatures } from "./cityUi.ts";
import { MEASURE_HINT, cityLength, measureCtl, useMeasure } from "./measure.ts";
import { GmOnlyBox } from "./GmOnly.tsx";
import { store } from "./store.ts";
import { forAssistant } from "./assistantName.ts";
import { Popover, ToolBar } from "./ToolBar.tsx";
import { nextRoofPicture, roofAssetsStore, roofChoiceFor } from "./roofAssetsClient.ts";
import { RoofPicturePicker, roofPictureName } from "./RoofPicturePicker.tsx";
import { assetUrl } from "./assetsApi.ts";

/** A roof picture's name for people: "Roof Texture Tile Red A1". */
const pictureName = (asset: string) => (asset.split("/").pop() ?? asset).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

const HINTS: Partial<Record<CityUi["tool"], string>> = {
  pan: "Drag to move the map. Hold Space, or drag with the right button, to move it with any tool. + and - zoom.",
  building: "Click to place a house, or drag a rectangle to size one. Q and E turn it. Pick its roof above.",
  outline: "Click the corners of a building of any shape. Double-click, click the first corner or press Enter to finish.",
  street: "Click the points a street passes through. Double-click or press Enter to finish.",
  citybattle: "Click a spot for a battlemap of 30 × 20 squares round it, as on the world map, or drag a box round the place of a fight or scene (up to about 228 m across at 5 ft a square): a battlemap of it opens, with its ground, streets, buildings as walls with doors and roofs, and walls.",
  district: "Click the corners of a district (a quarter, a ward, the docks); click the first corner, double-click or press Enter to finish, then name it. Its name is drawn over its middle.",
  citylabel: "Click a street, building or wall to name it. Click open ground to write a name there: pick what it names above. Names are yours: Claude only uses names you gave.",
  citywall: "Click the points of the wall. Click the first point to close it into a ring, or double-click or press Enter to end it. Where a street crosses it, a gate appears.",
  ground: "Drag to paint. [ and ] change the brush size.",
  select: "Click a building, street, wall or trees. Drag to move them, or drag on bare ground to select several. Delete removes; Q and E turn buildings.",
};
const LAND_MODES: { id: LandMode; name: string; hint: string }[] = [
  { id: "hill", name: "Hill", hint: "Click for a hill of the size set here, or drag out from its top to size it. Click a hill's top or edge to select it." },
  { id: "ridge", name: "Ridge", hint: "Click points along the crest; double-click or press Enter to finish." },
  { id: "valley", name: "Valley", hint: "Click points along the valley floor (where a river would run); double-click or press Enter to finish." },
  { id: "plateau", name: "Plateau", hint: "Click the corners of high, level ground; double-click, click the first corner or press Enter to finish." },
  { id: "hollow", name: "Hollow", hint: "Click the corners of low ground (a basin, a lake bed); double-click, click the first corner or press Enter to finish." },
  { id: "slope", name: "Slope", hint: "Drag from the low side to the high side: the whole settlement rises that way (the land falling to the sea or a river)." },
];
const TREE_KINDS: { id: TreeGroup; name: string; hint: string }[] = [
  { id: "wood", name: "Wood", hint: "Click the corners of a wood; double-click, click the first corner or press Enter to finish." },
  { id: "orchard", name: "Orchard", hint: "Click the corners of an orchard (its rows run along the longest side); double-click or press Enter to finish." },
  { id: "scattered", name: "Scattered", hint: "Click the corners of an area of scattered trees; double-click or press Enter to finish." },
  { id: "row", name: "Row", hint: "Click points along a row of trees (an avenue, a hedgerow, a river bank); double-click or press Enter to finish." },
  { id: "tree", name: "One tree", hint: "Click to plant a tree." },
];
const BRIDGE_CHOICES: { id: CityUi["streetBridge"]; name: string }[] = [
  { id: "auto", name: "Bridge (stone for streets, wood for lanes)" }, { id: "stone", name: "Stone bridge" }, { id: "wood", name: "Wooden bridge" }, { id: "none", name: "No bridge (a ford)" },
];
const SPECIES_NAMES: Record<TreeSpecies, string> = { conifer: "Firs and pines", broadleaf: "Broad trees", palm: "Palms", olive: "Olives", cypress: "Cypresses", thorn: "Thorny trees" };
const KIND_NAMES: Record<BuildingKind, string> = { house: "House", shop: "Shop", tavern: "Tavern", inn: "Inn", temple: "Temple", hall: "Hall", tower: "Tower", barn: "Barn", warehouse: "Warehouse", arena: "Arena", gatehouse: "Gatehouse", other: "Other" };
const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;

/** The tool bar: the options of the tool in use (the roof of the next building, the kind of street, the ground to paint). The tools themselves are in the rail. */
export function CityToolBar({ ui, onUi }: { ui: CityUi; onUi: (p: Partial<CityUi>) => void }) {
  const building = ui.tool === "building" || ui.tool === "outline";
  useMeasure(); // (the ruler's result follows the route)
  const route = measureCtl.shown(), walked = route.length >= 2 ? cityRoute(route) : null;
  const roofs = useSyncExternalStore(roofAssetsStore.subscribe, roofAssetsStore.get);
  const have = roofs.pools?.[ui.roof]?.length ?? 0;
  const ground = MATERIALS[ui.material];
  return (
    <ToolBar tool={{ id: ui.tool, name: CITY_TOOL_DEFS.find((t) => t.id === ui.tool)?.label ?? ui.tool }} hint={ui.tool === "hills" ? LAND_MODES.find((m) => m.id === ui.landMode)?.hint : ui.tool === "trees" ? TREE_KINDS.find((k) => k.id === ui.treeKind)?.hint : ui.tool === "measure" ? MEASURE_HINT : HINTS[ui.tool]}>
      {ui.tool === "measure" && (
        <span className="measure-result" data-testid="measure-result">
          {walked ? <><b>{cityLength(walked.metres)}</b> · about {Math.max(1, Math.round(walked.walkMinutes))} minute{Math.round(walked.walkMinutes) > 1 ? "s" : ""} on foot</> : "Click to start measuring"}
        </span>
      )}
      {building && (
        <>
          <div className="seg" role="group" aria-label="Roof look" data-testid="city-roofs">
            {ROOF_STYLES.map((r) => (
              <button key={r} className={ui.roof === r ? "on" : ""} onClick={() => onUi({ roof: r })} title={ROOF_STYLE_NAMES[r]} data-testid={`city-roof-${r}`}>
                <span className="chip" style={{ background: rgb(ROOF_BASE[r]) }} /> {ROOF_STYLE_NAMES[r]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Where the roof comes from" data-testid="city-roof-source">
            <button className={ui.roofSource === "assets" ? "on" : ""} onClick={() => onUi({ roofSource: "assets" })} title="Use a roof picture from your asset packs whenever one fits the look" data-testid="city-roof-assets">Roof pictures</button>
            <button className={ui.roofSource === "drawn" ? "on" : ""} onClick={() => onUi({ roofSource: "drawn" })} title="Always draw the roof from its look" data-testid="city-roof-drawn">Drawn</button>
          </div>
          <Popover label={<>{ui.roofSource === "picture" && ui.roofPick ? <><span className="swatch now" style={{ backgroundImage: `url(${assetUrl(ui.roofPick.asset, 64)})` }} /> <b>{roofPictureName(ui.roofPick.asset)}</b></> : "Choose a picture…"}</>} title="Choose the one roof picture new buildings get" testId="city-roof-choose">
            {(close) => <RoofPicturePicker look={ui.roof} value={ui.roofSource === "picture" ? ui.roofPick?.asset ?? null : null} onPick={(p) => { onUi({ roofSource: "picture", roofPick: p }); close(); }} />}
          </Popover>
          <label className="field">What it is
            <select value={ui.kind} onChange={(e) => onUi({ kind: e.target.value as BuildingKind })} data-testid="city-kind">
              {BUILDING_KINDS.map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
            </select>
          </label>
          {ui.tool === "building" && <span className="muted">Turned {ui.angle}° (Q / E)</span>}
          <span className="muted" data-testid="city-roof-note">
            {ui.roofSource === "picture" && ui.roofPick ? `New buildings get the roof picture ${roofPictureName(ui.roofPick.asset)}.`
              : ui.roofSource === "drawn" ? "Roofs are drawn from their look."
              : !roofs.loaded ? "Looking in your asset packs…"
              : !roofs.pools ? "No asset packs are set up (Settings), so roofs are drawn."
              : have ? `${have} ${ROOF_STYLE_NAMES[ui.roof].toLowerCase()} roof picture${have === 1 ? "" : "s"} in your packs: new buildings use them.`
              : `No ${ROOF_STYLE_NAMES[ui.roof].toLowerCase()} roof picture in your packs: this look is drawn.`}
          </span>
        </>
      )}
      {ui.tool === "street" && (
        <>
          <label className="field">Kind of street
            <select value={ui.streetKind} onChange={(e) => onUi({ streetKind: e.target.value as StreetKind })} data-testid="city-street-kind">
              {STREET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.width} m wide)</option>)}
            </select>
          </label>
          <label className="field">Over water
            <select value={ui.streetBridge} onChange={(e) => onUi({ streetBridge: e.target.value as CityUi["streetBridge"] })} data-testid="city-street-bridge" title="Where the street crosses water (ground painted as water) it becomes a bridge">
              {BRIDGE_CHOICES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </>
      )}
      {ui.tool === "citywall" && (
        <>
          <div className="seg" role="group" aria-label="What the wall is built of" data-testid="city-wall-kinds">
            {WALL_KINDS.map((k) => <button key={k.id} className={ui.wallKind === k.id ? "on" : ""} onClick={() => onUi({ wallKind: k.id, wallTowers: k.towers })} title={`A ${k.hint}`} data-testid={`city-wall-${k.id}`}>{k.name}</button>)}
          </div>
          <label className="slider">
            <span>Towers {ui.wallTowers ? <>every <b>{ui.wallTowers}</b> m</> : <b>none</b>}</span>
            <input type="range" min={0} max={120} step={5} value={ui.wallTowers} onChange={(e) => { const v = Number(e.target.value); onUi({ wallTowers: v > 0 && v < 10 ? 10 : v }); }} data-testid="city-wall-towers" />
          </label>
        </>
      )}
      {ui.tool === "citylabel" && (
        <>
          <div className="seg" role="group" aria-label="What the name is for" data-testid="city-label-kinds">
            {CITY_LABEL_KINDS.map((k) => <button key={k.id} className={ui.labelKind === k.id ? "on" : ""} onClick={() => onUi({ labelKind: k.id })} data-testid={`city-label-${k.id}`}>{k.name}</button>)}
          </div>
          <label className="slider">
            <span>Size <b>{ui.labelSize.toFixed(1)}</b>×</span>
            <input type="range" min={0.5} max={3} step={0.1} value={ui.labelSize} onChange={(e) => onUi({ labelSize: Number(e.target.value) })} data-testid="city-label-size" />
          </label>
        </>
      )}
      {ui.tool === "ground" && (
        <>
          <Popover label={<><span className="swatch now" style={{ background: rgb(ground?.colour ?? [60, 60, 60]) }} /> <b>{ground?.name}</b></>} title="Choose the ground to paint" testId="city-ground-menu">
            {(close) => (
              <div className="materials" data-testid="city-materials">
                {MATERIALS.filter((m) => m.id > 0).map((m) => (
                  <button key={m.id} className={`swatch ${ui.material === m.id ? "on" : ""}`} onClick={() => { onUi({ material: m.id }); close(); }} title={m.name} style={{ background: rgb(m.colour) }} data-testid={`city-material-${m.name.replace(/\s+/g, "-")}`} />
                ))}
              </div>
            )}
          </Popover>
          <label className="slider">
            <span>Brush size <b>{(ui.brush * 2).toFixed(0)}</b> m across</span>
            <input type="range" min={1} max={60} step={1} value={ui.brush} onChange={(e) => onUi({ brush: Number(e.target.value) })} data-testid="city-brush" />
          </label>
        </>
      )}
      {ui.tool === "hills" && (
        <>
          <div className="seg" role="group" aria-label="What to make" data-testid="city-land-modes">
            {LAND_MODES.map((m) => <button key={m.id} className={ui.landMode === m.id ? "on" : ""} onClick={() => onUi({ landMode: m.id })} data-testid={`city-land-${m.id}`}>{m.name}</button>)}
          </div>
          <label className="slider">
            <span>{ui.landMode === "valley" || ui.landMode === "hollow" ? "Depth" : ui.landMode === "slope" ? "Rise" : "Height"} <b>{ui.landHeight}</b> m</span>
            <input type="range" min={1} max={80} step={1} value={ui.landHeight} onChange={(e) => onUi({ landHeight: Number(e.target.value) })} data-testid="city-land-height" />
          </label>
          {ui.landMode !== "slope" && (
            <label className="slider">
              <span>{ui.landMode === "hill" ? "Radius" : ui.landMode === "ridge" || ui.landMode === "valley" ? "Half its width" : "Soft edge"} <b>{ui.landSize}</b> m</span>
              <input type="range" min={5} max={400} step={5} value={ui.landSize} onChange={(e) => onUi({ landSize: Number(e.target.value) })} data-testid="city-land-size" />
            </label>
          )}
        </>
      )}
      {ui.tool === "trees" && (
        <>
          <div className="seg" role="group" aria-label="What to plant" data-testid="city-tree-kinds">
            {TREE_KINDS.map((k) => <button key={k.id} className={ui.treeKind === k.id ? "on" : ""} onClick={() => onUi({ treeKind: k.id })} data-testid={`city-trees-${k.id}`}>{k.name}</button>)}
          </div>
          <label className="field">Kind of tree
            <select value={ui.treeSpecies} onChange={(e) => onUi({ treeSpecies: e.target.value as TreeSpecies | "" })} data-testid="city-tree-species">
              <option value="">As the climate grows them</option>
              {TREE_SPECIES.map((sp) => <option key={sp} value={sp}>{SPECIES_NAMES[sp]}</option>)}
            </select>
          </label>
          <label className="slider">
            <span>Crown <b>{ui.treeSize || "usual"}</b>{ui.treeSize ? " m" : ""}</span>
            <input type="range" min={0} max={20} step={1} value={ui.treeSize} onChange={(e) => onUi({ treeSize: Number(e.target.value) })} data-testid="city-tree-size" />
          </label>
        </>
      )}
    </ToolBar>
  );
}

/** The city in numbers, for the Map panel (a city can have thousands of buildings, so they are counted here, never listed), and its land and climate. */
export function CitySummary({ meta, features, ui, onUi, labelSize = 1, onLabelSize }: { meta: MapMeta | null; features: Features; ui: CityUi; onUi: (p: Partial<CityUi>) => void; labelSize?: number; onLabelSize?: (n: number) => void }) {
  const c = meta?.city;
  if (!c) return null;
  const row = (k: string, v: string) => <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>;
  const climate = cityClimate(c), preset = climatePreset(climate);
  const setCity = (patch: { climate?: CityClimate; elevation?: number }, label: string) => store.send({ t: "cmd", cmd: { op: "set_meta", patch: { city: { ...c, ...patch } } }, label });
  return (
    <>
      <section data-testid="city-summary">
        <h3>This settlement</h3>
        {row("Size", `${c.widthM.toLocaleString()} × ${c.heightM.toLocaleString()} m`)}
        {row("Buildings", (features.buildings ?? []).length.toLocaleString())}
        {row("Streets", (features.streets ?? []).length.toLocaleString())}
        {row("Trees", `${(features.trees ?? []).length.toLocaleString()} group${(features.trees ?? []).length === 1 ? "" : "s"}`)}
        {(features.districts ?? []).length > 0 && row("Districts", String((features.districts ?? []).length))}
        {(features.cityWalls ?? []).length > 0 && (() => { const p = cityWallPieces(features.cityWalls, features.streets, store.heights ? { ground: store.heights, cellM: c.cellM } : null), g = p.reduce((n, w) => n + w.gates.length, 0), t = p.reduce((n, w) => n + w.towers.length, 0); return row("Walls", `${p.length} · ${g} gate${g === 1 ? "" : "s"} · ${t} tower${t === 1 ? "" : "s"}`); })()}
        <p className="muted">Click a building, street, wall or trees with the Select tool to edit it here; a hill or valley with the Land tool.</p>
        {meta!.origin && (
          <>
            <p className="muted" data-testid="city-origin">Started from <b>{meta!.origin.name}</b> at map px ({meta!.origin.x}, {meta!.origin.y}).</p>
            <div className="row"><button onClick={() => store.send({ t: "open_project", id: meta!.origin!.id })} title="Open the world map this settlement was started from" data-testid="city-back">↑ Back to {meta!.origin.name}</button></div>
          </>
        )}
      </section>
      <section>
        <GenerateBox kind="city" hasContent={(features.streets ?? []).length > 0 || (features.buildings ?? []).length > 0} />
      </section>
      <section data-testid="city-land">
        <h3>Land and climate</h3>
        <label className="field">Climate
          <select value={preset ?? "own"} onChange={(e) => { const p = CITY_CLIMATES.find((x) => x.id === e.target.value); if (p) setCity({ climate: { temperature: p.temperature, moisture: p.moisture } }, `Climate: ${p.name}`); }} data-testid="city-climate">
            {CITY_CLIMATES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {!preset && <option value="own">{forAssistant("Its own (set by Claude)")}</option>}
          </select>
        </label>
        <p className="muted">{CITY_CLIMATES.find((p) => p.id === preset)?.hint ?? `Temperature ${climate.temperature}, moisture ${climate.moisture} (0 to 1).`}</p>
        <label className="field">Height above the sea (m)
          <input key={`${meta!.id}-${c.elevation ?? 0}`} type="number" min={-500} max={9000} step={10} defaultValue={c.elevation ?? 0} data-testid="city-elevation"
            onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v !== (c.elevation ?? 0)) setCity({ elevation: Math.max(-500, Math.min(9000, v)) }, `Height above the sea: ${v} m`); }} />
        </label>
        <LandStartBox spec={c} land={features.land ?? []} onUi={onUi} />
        <GroundPanel spec={c} hasTrace={!!features.trace} />
        <h3>Layers</h3>
        <label className="check eye"><input type="checkbox" checked={ui.contours} onChange={(e) => onUi({ contours: e.target.checked })} data-testid="city-contours" /> Contour lines</label>
        <label className="check eye"><input type="checkbox" checked={ui.names} onChange={(e) => onUi({ names: e.target.checked })} data-testid="city-names" /> Names and labels</label>
        {onLabelSize && <label className="check" title="How big every name is drawn, on screen and in exports (each name can also have its own size: select it)."><span>Label size</span> <input type="range" data-testid="label-size" min={LABEL_SIZE_MIN} max={LABEL_SIZE_MAX} step={0.1} value={labelSize} onChange={(e) => onLabelSize(Number(e.target.value))} style={{ width: "100%" }} /></label>}
      </section>
    </>
  );
}

/**
 * The settlement's hills, valleys and slopes: how many there are, the Land tool to shape them by hand, and a start of a kind of country (core cityLandStart.ts) that
 * replaces them in one step (asked first when there are some; Undo takes it back).
 */
function LandStartBox({ spec, land, onUi }: { spec: NonNullable<MapMeta["city"]>; land: MapLandform[]; onUi: (p: Partial<CityUi>) => void }) {
  const [style, setStyle] = useState<LandStart>("rolling");
  const [asking, setAsking] = useState(false);
  const chosen = LAND_STARTS.find((s) => s.id === style)!;
  const make = () => {
    const made = startLand(spec, style, newSeed());
    sendCityFeatures({ ...(land.length && { removeLand: land.map((l) => l.id) }), ...(made.length && { upsertLand: made }) }, `Land: ${chosen.name.toLowerCase()}`);
    setAsking(false);
  };
  return (
    <div className="land-start" data-testid="city-land-start">
      <div className="kv"><span>Hills, valleys and slopes</span><b>{land.length}</b></div>
      <div className="row"><button onClick={() => onUi({ tool: "hills" })} title="The Land tool: add a hill, ridge, valley, plateau, hollow or slope where you want it, or click one to change it" data-testid="city-land-tool">Shape the land by hand (L)</button></div>
      <label className="field">Or start the land as
        <select value={style} onChange={(e) => { setStyle(e.target.value as LandStart); setAsking(false); }} data-testid="city-land-style">
          {LAND_STARTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <p className="muted">{chosen.hint}{style !== "flat" && " A new one each time you click."}</p>
      {asking ? (
        <div className="row">
          <span className="muted">This replaces the {land.length === 1 ? "one hill, valley or slope" : `${land.length} hills, valleys and slopes`} here. Undo takes it back.</span>
          <button className="danger" onClick={make} data-testid="city-land-confirm">Replace</button>
          <button onClick={() => setAsking(false)}>Cancel</button>
        </div>
      ) : (
        <div className="row"><button className="primary" onClick={() => (land.length ? setAsking(true) : make())} disabled={style === "flat" && !land.length} data-testid="city-land-make">{style === "flat" ? "Make it flat" : "Make the land"}</button></div>
      )}
    </div>
  );
}

const hexOf = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** What is selected: one building or street to edit, or a group to change together. */
export function CityInspector({ features, ui, onUi }: { features: Features; ui: CityUi; onUi: (p: Partial<CityUi>) => void }) {
  const [picking, setPicking] = useState(false); // (the group's roof picture picker: a hook, so before any early return)
  const { buildings, streets, trees, land, walls, labels, districts } = selectedOf(features, ui.selected);
  if (!buildings.length && !streets.length && !trees.length && !land.length && !walls.length && !labels.length && !districts.length) return null;
  const clear = () => onUi({ selected: [] });
  const total = buildings.length + streets.length + trees.length + land.length + walls.length + labels.length + districts.length;
  const remove = () => { if (removeSelected(features, ui.selected)) onUi({ selected: [] }); };
  if (total === 1 && trees.length) return <TreesEditor t={trees[0]} onClear={clear} onRemove={remove} />;
  if (total === 1 && districts.length) return <DistrictEditor d={districts[0]} features={features} onClear={clear} onRemove={remove} />;
  if (total === 1 && labels.length) return <LabelEditor l={labels[0]} onClear={clear} onRemove={remove} />;
  if (total === 1 && walls.length) return <WallEditor w={walls[0]} streets={features.streets ?? []} cellM={store.getState().meta?.city?.cellM ?? 1} onClear={clear} onRemove={remove} />;
  if (total === 1 && land.length) return <LandEditor l={land[0]} onClear={clear} onRemove={remove} />;
  const change = (patch: Partial<MapBuilding>, label: string) => sendCityFeatures({ upsertBuildings: buildings.map((b) => ({ ...b, ...patch })) }, label);
  /** A new roof look for every selected building: each gets a picture of the packs that fits it (a different one each) unless roofs are set to be drawn. */
  const reroof = (look: RoofStyle) => sendCityFeatures({
    upsertBuildings: buildings.map((b) => {
      const { asset: _a, tile: _t, colour: _c, ...rest } = b;
      const pic = ui.roofSource === "assets" ? roofChoiceFor(look, b.id) : null;
      return { ...rest, roof: look, ...(pic && { asset: pic.asset, tile: pic.tile }) };
    }),
  }, `Roof: ${ROOF_STYLE_NAMES[look]}`);
  if (buildings.length === 1 && !streets.length) return <BuildingEditor b={buildings[0]} roofSource={ui.roofSource} onClear={clear} onRemove={remove} />;
  if (streets.length === 1 && !buildings.length) return <StreetEditor s={streets[0]} onClear={clear} onRemove={remove} />;
  return (
    <section data-testid="city-inspector">
      <h3>{total} selected</h3>
      <p className="muted">{buildings.length} building{buildings.length === 1 ? "" : "s"}, {streets.length} street{streets.length === 1 ? "" : "s"}{walls.length ? `, ${walls.length} wall${walls.length === 1 ? "" : "s"}` : ""}{trees.length ? `, ${trees.length} group${trees.length === 1 ? "" : "s"} of trees` : ""}. Drag to move them together.</p>
      {buildings.length > 0 && (
        <>
          <label className="field">Roof for all the buildings
            <select value="" onChange={(e) => e.target.value && reroof(e.target.value as RoofStyle)} data-testid="city-group-roof">
              <option value="">Change…</option>
              {ROOF_STYLES.map((r) => <option key={r} value={r}>{ROOF_STYLE_NAMES[r]}</option>)}
            </select>
          </label>
          <button className="built-of" onClick={() => setPicking((v) => !v)} aria-expanded={picking} data-testid="city-group-roof-picture">One roof picture for them all… <span aria-hidden="true">{picking ? "▴" : "▾"}</span></button>
          {picking && (
            <div className="inline-picker">
              <RoofPicturePicker look={buildings[0].roof ?? "slate"} value={null} onPick={(p) => {
                sendCityFeatures({ upsertBuildings: buildings.map((b) => { const { colour: _c, ...rest } = b; return { ...rest, asset: p.asset, tile: p.tile }; }) }, `Roof picture ${roofPictureName(p.asset)} (${buildings.length})`);
                setPicking(false);
              }} />
            </div>
          )}
          <label className="field">What they are
            <select value="" onChange={(e) => e.target.value && change({ kind: e.target.value as BuildingKind }, `Kind: ${e.target.value}`)} data-testid="city-group-kind">
              <option value="">Change…</option>
              {BUILDING_KINDS.map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
            </select>
          </label>
        </>
      )}
      <div className="row"><button onClick={remove} className="danger" data-testid="city-delete">Delete</button><button onClick={clear}>Clear</button></div>
    </section>
  );
}

function BuildingEditor({ b, roofSource, onClear, onRemove }: { b: MapBuilding; roofSource: CityUi["roofSource"]; onClear: () => void; onRemove: () => void }) {
  const set = (patch: Partial<MapBuilding>, label: string) => sendCityFeatures({ upsertBuildings: [{ ...b, ...patch }] }, label);
  const roofs = useSyncExternalStore(roofAssetsStore.subscribe, roofAssetsStore.get);
  const look = b.roof ?? "slate";
  const available = roofs.pools?.[look]?.length ?? 0;
  /** Replace the building's roof: a picture (or none), dropping a colour a picture would have to be tinted by. */
  const roofWith = (pic: { asset: string; tile: number } | null, patch: Partial<MapBuilding>, label: string) => {
    const { asset: _a, tile: _t, colour: _c, ...rest } = b;
    sendCityFeatures({ upsertBuildings: [{ ...rest, ...patch, ...(pic && { asset: pic.asset, tile: pic.tile }) }] }, label);
  };
  const bb = pointsBounds(b.points as [number, number][]);
  const [picking, setPicking] = useState(false);
  return (
    <section data-testid="city-inspector">
      <h3>Building</h3>
      <p className="muted">{(bb.x1 - bb.x0).toFixed(1)} × {(bb.y1 - bb.y0).toFixed(1)} m across · {Math.round(polygonArea(b.points as [number, number][]))} m²</p>
      <label className="field">Name (only a name you chose)
        <input key={b.id + (b.name ?? "")} defaultValue={b.name ?? ""} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (b.name ?? "")) { const { name: _n, ...rest } = b; sendCityFeatures({ upsertBuildings: [v ? { ...rest, name: v } : rest] }, v ? `Name building ${v}` : "Clear building name"); } }} data-testid="city-name" />
      </label>
      {b.name && <GmOnlyBox on={!!b.gmOnly} what="this building's name" onChange={(on) => set({ gmOnly: on || undefined }, on ? `Make ${b.name} GM only` : `Show ${b.name} to players`)} />}
      {b.name && <NameSizeSlider value={b.nameSize} onCommit={(v) => sendCityFeatures({ upsertBuildings: [withNameSize(b, v)] }, `Name size of ${b.name}`)} testid="city-name-size" />}
      <label className="field">What it is
        <select value={b.kind ?? "other"} onChange={(e) => set({ kind: e.target.value as BuildingKind }, `Kind: ${e.target.value}`)} data-testid="city-edit-kind">
          {BUILDING_KINDS.map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
        </select>
      </label>
      <label className="field">Roof
        <select value={b.roof ?? "slate"} onChange={(e) => { const l = e.target.value as RoofStyle; roofWith(roofSource === "assets" ? roofChoiceFor(l, b.id) : null, { roof: l }, `Roof: ${ROOF_STYLE_NAMES[l]}`); }} data-testid="city-edit-roof">
          {ROOF_STYLES.map((r) => <option key={r} value={r}>{ROOF_STYLE_NAMES[r]}</option>)}
        </select>
      </label>
      {b.asset ? (
        <div className="field" data-testid="city-roof-picture">Roof picture
          <p className="muted" title={b.asset}>{pictureName(b.asset)}</p>
          <span className="row">
            <button onClick={() => setPicking((v) => !v)} aria-expanded={picking} title="Choose the roof picture by sight" data-testid="city-roof-choose-one">Choose…</button>
            <button disabled={available < 2} onClick={() => { const n = nextRoofPicture(look, b.asset); if (n) roofWith(n, {}, "Another roof picture"); }} title="Use the next roof picture of your packs" data-testid="city-roof-another">Another</button>
            <button onClick={() => roofWith(null, {}, "Draw the roof")} title="Draw this roof from its look instead (then you can choose its colour)" data-testid="city-roof-draw">Draw it instead</button>
          </span>
        </div>
      ) : (
        <p className="muted" data-testid="city-roof-drawn-note">
          Drawn from its look.{" "}
          {available > 0 && <button onClick={() => { const c = roofChoiceFor(look, b.id); if (c) roofWith(c, {}, "Use a roof picture"); }} data-testid="city-roof-use">Use a roof picture</button>}{" "}
          {roofs.pools && <button onClick={() => setPicking((v) => !v)} aria-expanded={picking} data-testid="city-roof-choose-one">Choose…</button>}
          {roofs.loaded && roofs.pools && available === 0 && <>No {ROOF_STYLE_NAMES[look].toLowerCase()} roof picture in your packs.</>}
        </p>
      )}
      {picking && <div className="inline-picker"><RoofPicturePicker look={look} value={b.asset ?? null} onPick={(p) => { roofWith(p, {}, `Roof picture ${roofPictureName(p.asset)}`); setPicking(false); }} /></div>}
      <label className="check" title="No ridge: a flat roof"><input type="checkbox" checked={!!b.flat} onChange={(e) => { const { flat: _f, ...rest } = b; sendCityFeatures({ upsertBuildings: [e.target.checked ? { ...rest, flat: true } : rest] }, "Roof pitch"); }} /> Flat roof</label>
      {!b.asset && (
        <label className="field">Colour
          <span className="row">
            <input type="color" value={b.colour ?? hexOf(ROOF_BASE[b.roof ?? "slate"])} onChange={(e) => set({ colour: e.target.value }, "Roof colour")} data-testid="city-colour" />
            {b.colour && <button onClick={() => { const { colour: _c, ...rest } = b; sendCityFeatures({ upsertBuildings: [rest] }, "Roof colour reset"); }}>Reset</button>}
          </span>
        </label>
      )}
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}

function StreetEditor({ s, onClear, onRemove }: { s: MapStreet; onClear: () => void; onRemove: () => void }) {
  const set = (patch: Partial<MapStreet>, label: string) => sendCityFeatures({ upsertStreets: [{ ...s, ...patch }] }, label);
  let len = 0;
  for (let i = 1; i < s.points.length; i++) len += Math.hypot(s.points[i][0] - s.points[i - 1][0], s.points[i][1] - s.points[i - 1][1]);
  return (
    <section data-testid="city-inspector">
      <h3>Street</h3>
      <p className="muted">{Math.round(len)} m long · {s.points.length} points</p>
      <label className="field">Name (only a name you chose)
        <input key={s.id + (s.name ?? "")} defaultValue={s.name ?? ""} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.name ?? "")) { const { name: _n, ...rest } = s; sendCityFeatures({ upsertStreets: [v ? { ...rest, name: v } : rest] }, v ? `Name street ${v}` : "Clear street name"); } }} data-testid="city-name" />
      </label>
      {s.name && <NameSizeSlider value={s.nameSize} onCommit={(v) => sendCityFeatures({ upsertStreets: [withNameSize(s, v)] }, `Name size of ${s.name}`)} testid="city-name-size" />}
      <label className="field">Kind
        <select value={s.kind ?? ""} onChange={(e) => { const k = STREET_KINDS.find((x) => x.id === e.target.value); if (k) set({ kind: k.id, width: k.width }, `Street kind: ${k.name}`); }} data-testid="city-street-edit-kind">
          {!s.kind && <option value="">(custom)</option>}
          {STREET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </label>
      <label className="slider"><span>Width <b>{s.width}</b> m</span>
        <input type="range" min={1} max={30} step={0.5} value={Math.min(30, s.width)} onChange={(e) => set({ width: Number(e.target.value) }, "Street width")} data-testid="city-street-width" />
      </label>
      <label className="field">Over water
        <select value={s.bridge ?? "auto"} onChange={(e) => { const { bridge: _b, ...rest } = s; const v = e.target.value; sendCityFeatures({ upsertStreets: [v === "auto" ? rest : { ...rest, bridge: v as MapStreet["bridge"] }] }, v === "none" ? "No bridge (a ford)" : `Bridge: ${v === "auto" ? "automatic" : v}`); }} data-testid="city-street-edit-bridge">
          {BRIDGE_CHOICES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}

/** One district: its name, its colour, and what is in it. */
function DistrictEditor({ d, features, onClear, onRemove }: { d: MapDistrict; features: Features; onClear: () => void; onRemove: () => void }) {
  const inside = (features.buildings ?? []).filter((b) => { const [x, y] = polygonCentroid(b.points as [number, number][]); return pointInPolygon(x, y, d.points); }).length;
  return (
    <section data-testid="city-inspector">
      <h3>{d.name ?? "District"}</h3>
      <p className="muted" data-testid="city-district-info">{Math.round(polygonArea(d.points) / 100) / 100} hectares · {inside} building{inside === 1 ? "" : "s"} in it</p>
      <label className="field">Name (only a name you chose)
        <input key={d.id + (d.name ?? "")} defaultValue={d.name ?? ""} maxLength={80} data-testid="city-name" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (d.name ?? "")) { const { name: _n, ...rest } = d; sendCityFeatures({ upsertDistricts: [v ? { ...rest, name: v } : rest] }, v ? `Name district ${v}` : "Clear district name"); } }} />
      </label>
      {d.name && <NameSizeSlider value={d.nameSize} onCommit={(v) => sendCityFeatures({ upsertDistricts: [withNameSize(d, v)] }, `Name size of ${d.name}`)} testid="city-name-size" />}
      <label className="field">Colour
        <span className="row">
          <input type="color" value={districtColour(d)} onChange={(e) => sendCityFeatures({ upsertDistricts: [{ ...d, colour: e.target.value }] }, "District colour")} data-testid="city-district-colour" />
          {d.colour && <button onClick={() => { const { colour: _c, ...rest } = d; sendCityFeatures({ upsertDistricts: [rest] }, "District colour reset"); }}>Reset</button>}
        </span>
      </label>
      <p className="muted">Drag its name (or its border) with the Select tool to move it.</p>
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}

/** One name on the city: its text, what it names, its size and turn. */
function LabelEditor({ l, onClear, onRemove }: { l: MapLabel; onClear: () => void; onRemove: () => void }) {
  const set = (patch: Partial<MapLabel>, label: string) => sendCityFeatures({ upsertLabels: [{ ...l, ...patch }] }, label);
  return (
    <section data-testid="city-inspector">
      <h3>{l.text}</h3>
      <label className="field">Text
        <input key={l.id + l.text} defaultValue={l.text} maxLength={80} data-testid="city-label-text" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.text) set({ text: v }, `Rename ${l.text} to ${v}`); }} />
      </label>
      <GmOnlyBox on={!!l.gmOnly} what="this name" onChange={(on) => set({ gmOnly: on || undefined }, on ? `Make ${l.text} GM only` : `Show ${l.text} to players`)} />
      <label className="field">What it names
        <select value={cityLabelKind(l.kind)} onChange={(e) => set({ kind: CITY_LABEL_KINDS.find((k) => k.id === (e.target.value as CityLabelKind))!.kind }, `Name kind: ${e.target.value}`)} data-testid="city-label-edit-kind">
          {CITY_LABEL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </label>
      <label className="slider"><span>Size <b>{(l.size ?? 1).toFixed(1)}</b>×</span>
        <input type="range" min={0.3} max={4} step={0.1} value={l.size ?? 1} onChange={(e) => set({ size: Number(e.target.value) }, "Name size")} data-testid="city-label-edit-size" />
      </label>
      <label className="slider"><span>Turned <b>{l.angle ?? 0}</b>°</span>
        <input type="range" min={-90} max={90} step={1} value={l.angle ?? 0} onChange={(e) => set({ angle: Number(e.target.value) }, "Turn name")} data-testid="city-label-angle" />
      </label>
      <p className="muted">Drag it with the Select or Name tool to move it.</p>
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}

/** One city wall: what it is built of, how thick, how far apart its towers are, ring or not, a name; and what stands on it (its towers and gates). */
function WallEditor({ w, streets, cellM, onClear, onRemove }: { w: MapCityWall; streets: readonly MapStreet[]; cellM: number; onClear: () => void; onRemove: () => void }) {
  const set = (patch: Partial<MapCityWall>, label: string) => sendCityFeatures({ upsertCityWalls: [{ ...w, ...patch }] }, label);
  const s = wallSettings(w), p = wallPieces(w, streets, store.heights ? { ground: store.heights, cellM } : null), kind = WALL_KINDS.find((k) => k.id === s.kind)!;
  const streetName = (id: string) => { const st = streets.find((x) => x.id === id); return st?.name ?? STREET_KINDS.find((k) => k.id === st?.kind)?.name.toLowerCase() ?? "street"; };
  return (
    <section data-testid="city-inspector">
      <h3>{w.name ?? kind.name}</h3>
      <p className="muted" data-testid="city-wall-info">{Math.round(p.length)} m {p.closed ? "round" : "long"} · {p.towers.length} tower{p.towers.length === 1 ? "" : "s"} · {p.gates.length} gate{p.gates.length === 1 ? "" : "s"}</p>
      {p.gates.length > 0 && <p className="muted">Gates: {p.gates.map((g) => (g.water ? "a water gate" : `${streetName(g.streetId ?? "")}${g.gatehouse ? " (gatehouse)" : ""}`)).join(", ")}.</p>}
      {p.closed && !p.gates.length && <p className="muted">No street crosses this ring yet, so it has no gate.</p>}
      <label className="field">Name (only a name you chose)
        <input key={w.id + (w.name ?? "")} defaultValue={w.name ?? ""} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (w.name ?? "")) { const { name: _n, ...rest } = w; sendCityFeatures({ upsertCityWalls: [v ? { ...rest, name: v } : rest] }, v ? `Name wall ${v}` : "Clear wall name"); } }} data-testid="city-name" />
      </label>
      <label className="field">Built of
        <select value={s.kind} onChange={(e) => { const { thickness: _t, towers: _w, ...rest } = w; sendCityFeatures({ upsertCityWalls: [{ ...rest, kind: e.target.value as CityWallKind }] }, `Wall: ${WALL_KINDS.find((k) => k.id === e.target.value)!.name}`); }} data-testid="city-wall-edit-kind">
          {WALL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </label>
      <label className="field">Thickness (m)
        <input key={`${w.id}-t-${s.thickness}`} type="number" min={0.3} max={30} step={0.1} defaultValue={s.thickness} data-testid="city-wall-thickness"
          onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0.3 && v <= 30 && v !== s.thickness) set({ thickness: v }, `Wall: ${v} m thick`); }} />
      </label>
      <label className="field">Towers every (m, 0 for none)
        <input key={`${w.id}-w-${s.towers}`} type="number" min={0} max={500} step={5} defaultValue={s.towers} data-testid="city-wall-edit-towers"
          onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && (v === 0 || (v >= 8 && v <= 500)) && v !== s.towers) set({ towers: v }, v ? `Towers every ${v} m` : "No towers"); }} />
      </label>
      {w.points.length >= 3 && (
        <label className="check" title="Join the last point back to the first"><input type="checkbox" checked={!!w.closed} onChange={(e) => { const { closed: _c, ...rest } = w; sendCityFeatures({ upsertCityWalls: [e.target.checked ? { ...rest, closed: true } : rest] }, e.target.checked ? "Close the wall" : "Open the wall"); }} data-testid="city-wall-ring" /> A ring (closed)</label>
      )}
      <p className="muted">A gate appears wherever a street crosses the wall (a gatehouse for avenues and streets), and a water gate wherever it crosses water.</p>
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}

/** One group of trees: what it is, the kind of tree, the crown size, a name. */
function TreesEditor({ t, onClear, onRemove }: { t: MapTrees; onClear: () => void; onRemove: () => void }) {
  const set = (patch: Partial<MapTrees>, label: string) => sendCityFeatures({ upsertTrees: [{ ...t, ...patch }] }, label);
  const kind = TREE_KINDS.find((k) => k.id === t.kind)?.name ?? t.kind;
  return (
    <section data-testid="city-inspector">
      <h3>{t.name ?? (t.kind === "tree" ? "A tree" : kind)}</h3>
      <label className="field">Kind of tree
        <select value={t.species ?? ""} onChange={(e) => { const { species: _s, ...rest } = t; set(e.target.value ? { ...rest, species: e.target.value as TreeSpecies } : rest, "Kind of tree"); }} data-testid="city-trees-species">
          <option value="">As the climate grows them</option>
          {TREE_SPECIES.map((sp) => <option key={sp} value={sp}>{SPECIES_NAMES[sp]}</option>)}
        </select>
      </label>
      <label className="field">Crown across (m)
        <input key={`${t.id}-${t.size ?? 0}`} type="number" min={1} max={40} step={0.5} defaultValue={t.size ?? ""} placeholder="usual" data-testid="city-trees-size"
          onBlur={(e) => { const v = Number(e.target.value); if (e.target.value && Number.isFinite(v) && v >= 1 && v <= 40 && v !== t.size) set({ size: v }, "Tree size"); }} />
      </label>
      <label className="field">Name
        <input key={`${t.id}-${t.name ?? ""}`} defaultValue={t.name ?? ""} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.name ?? "")) { const { name: _n, ...rest } = t; set(v ? { ...rest, name: v } : rest, "Name trees"); } }} />
      </label>
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}

/** One landform: how high (or deep) and how big. */
function LandEditor({ l, onClear, onRemove }: { l: MapLandform; onClear: () => void; onRemove: () => void }) {
  const set = (patch: Partial<MapLandform>, label: string) => sendCityFeatures({ upsertLand: [{ ...l, ...patch }] }, label);
  const sunk = l.height < 0, num = (key: string, label: string, value: number, min: number, max: number, apply: (v: number) => void, testId: string) => (
    <label className="field">{label}
      <input key={`${l.id}-${key}-${value}`} type="number" min={min} max={max} step={1} defaultValue={value} data-testid={testId}
        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min && v <= max && v !== value) apply(v); }} />
    </label>
  );
  return (
    <section data-testid="city-inspector">
      <h3>{landName(l)}</h3>
      {num("h", l.kind === "slope" ? "Rise (m)" : sunk ? "Depth (m)" : "Height (m)", Math.abs(l.height), 0.1, 1500, (v) => set({ height: sunk ? -v : v }, `${landName(l)}: ${v} m`), "city-land-edit-height")}
      {l.kind !== "slope" && num("r", l.kind === "hill" ? "Radius (m)" : l.kind === "ridge" ? "Half its width (m)" : "Soft edge (m)", l.radius, 1, 10000, (v) => set({ radius: v }, `${landName(l)}: ${v} m wide`), "city-land-edit-size")}
      {(l.kind === "ridge" || l.kind === "plateau") && (
        <div className="row"><button onClick={() => set({ height: -l.height }, sunk ? (l.kind === "ridge" ? "Make a ridge" : "Make a plateau") : (l.kind === "ridge" ? "Make a valley" : "Make a hollow"))} data-testid="city-land-flip">
          {sunk ? (l.kind === "ridge" ? "Make it a ridge" : "Make it a plateau") : (l.kind === "ridge" ? "Make it a valley" : "Make it a hollow")}
        </button></div>
      )}
      <p className="muted">Drag its mark with the Land tool to move it.</p>
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}
