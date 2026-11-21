/** The city map's tool bar (the options of the chosen tool), the inspector for what is selected, and the city's own settings (its land and climate) for the Map panel. */
import { useSyncExternalStore } from "react";
import {
  BUILDING_KINDS, CITY_CLIMATES, MATERIALS, ROOF_BASE, ROOF_STYLES, ROOF_STYLE_NAMES, STREET_KINDS, TREE_SPECIES, cityClimate, climatePreset, polygonArea, pointsBounds, type BuildingKind,
  type CityClimate, type Features, type MapBuilding, type MapLandform, type MapMeta, type MapStreet, type MapTrees, type RoofStyle, type StreetKind, type TreeGroup, type TreeSpecies,
} from "@mapmaker/core";
import { type CityUi, type LandMode, landName, selectedOf, sendCityFeatures } from "./cityUi.ts";
import { store } from "./store.ts";
import { Popover, ToolBar } from "./ToolBar.tsx";
import { nextRoofPicture, roofAssetsStore, roofChoiceFor } from "./roofAssetsClient.ts";

/** A roof picture's name for people: "Roof Texture Tile Red A1". */
const pictureName = (asset: string) => (asset.split("/").pop() ?? asset).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

const HINTS: Partial<Record<CityUi["tool"], string>> = {
  pan: "Drag to move the map. Hold Space, or drag with the right button, to move it with any tool. + and - zoom.",
  building: "Click to place a house, or drag a rectangle to size one. Q and E turn it. Pick its roof above.",
  outline: "Click the corners of a building of any shape. Double-click, click the first corner or press Enter to finish.",
  street: "Click the points a street passes through. Double-click or press Enter to finish.",
  ground: "Drag to paint. [ and ] change the brush size.",
  select: "Click a building, street or trees. Drag to move them, or drag on bare ground to select several. Delete removes; Q and E turn buildings.",
};
const LAND_MODES: { id: LandMode; name: string; hint: string }[] = [
  { id: "hill", name: "Hill", hint: "Click for a hill of the size set here, or drag out from its top to size it. Click a hill's top or edge to select it." },
  { id: "ridge", name: "Ridge", hint: "Click points along the crest; double-click or press Enter to finish." },
  { id: "valley", name: "Valley", hint: "Click points along the valley floor (where a river would run); double-click or press Enter to finish." },
  { id: "plateau", name: "Plateau", hint: "Click the corners of high, level ground; double-click, click the first corner or press Enter to finish." },
  { id: "hollow", name: "Hollow", hint: "Click the corners of low ground (a basin, a lake bed); double-click, click the first corner or press Enter to finish." },
  { id: "slope", name: "Slope", hint: "Drag from the low side to the high side: the whole city rises that way (the land falling to the sea or a river)." },
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
  const roofs = useSyncExternalStore(roofAssetsStore.subscribe, roofAssetsStore.get);
  const have = roofs.pools?.[ui.roof]?.length ?? 0;
  const ground = MATERIALS[ui.material];
  return (
    <ToolBar hint={ui.tool === "hills" ? LAND_MODES.find((m) => m.id === ui.landMode)?.hint : ui.tool === "trees" ? TREE_KINDS.find((k) => k.id === ui.treeKind)?.hint : HINTS[ui.tool]}>
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
          <label className="field">What it is
            <select value={ui.kind} onChange={(e) => onUi({ kind: e.target.value as BuildingKind })} data-testid="city-kind">
              {BUILDING_KINDS.map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
            </select>
          </label>
          {ui.tool === "building" && <span className="muted">Turned {ui.angle}° (Q / E)</span>}
          <span className="muted" data-testid="city-roof-note">
            {ui.roofSource === "drawn" ? "Roofs are drawn from their look."
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
export function CitySummary({ meta, features, ui, onUi }: { meta: MapMeta | null; features: Features; ui: CityUi; onUi: (p: Partial<CityUi>) => void }) {
  const c = meta?.city;
  if (!c) return null;
  const row = (k: string, v: string) => <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>;
  const climate = cityClimate(c), preset = climatePreset(climate);
  const setCity = (patch: { climate?: CityClimate; elevation?: number }, label: string) => store.send({ t: "cmd", cmd: { op: "set_meta", patch: { city: { ...c, ...patch } } }, label });
  return (
    <>
      <section data-testid="city-summary">
        <h3>This city</h3>
        {row("Size", `${c.widthM.toLocaleString()} × ${c.heightM.toLocaleString()} m`)}
        {row("Buildings", (features.buildings ?? []).length.toLocaleString())}
        {row("Streets", (features.streets ?? []).length.toLocaleString())}
        {row("Trees", `${(features.trees ?? []).length.toLocaleString()} group${(features.trees ?? []).length === 1 ? "" : "s"}`)}
        <p className="muted">Click a building, street or trees with the Select tool to edit it here; a hill or valley with the Land tool.</p>
        {meta!.origin && (
          <>
            <p className="muted" data-testid="city-origin">Started from <b>{meta!.origin.name}</b> at map px ({meta!.origin.x}, {meta!.origin.y}).</p>
            <div className="row"><button onClick={() => store.send({ t: "open_project", id: meta!.origin!.id })} title="Open the world map this city was started from" data-testid="city-back">↑ Back to {meta!.origin.name}</button></div>
          </>
        )}
      </section>
      <section data-testid="city-land">
        <h3>Land and climate</h3>
        <label className="field">Climate
          <select value={preset ?? "own"} onChange={(e) => { const p = CITY_CLIMATES.find((x) => x.id === e.target.value); if (p) setCity({ climate: { temperature: p.temperature, moisture: p.moisture } }, `Climate: ${p.name}`); }} data-testid="city-climate">
            {CITY_CLIMATES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {!preset && <option value="own">Its own (set by Claude)</option>}
          </select>
        </label>
        <p className="muted">{CITY_CLIMATES.find((p) => p.id === preset)?.hint ?? `Temperature ${climate.temperature}, moisture ${climate.moisture} (0 to 1).`}</p>
        <label className="field">Height above the sea (m)
          <input key={`${meta!.id}-${c.elevation ?? 0}`} type="number" min={-500} max={9000} step={10} defaultValue={c.elevation ?? 0} data-testid="city-elevation"
            onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v !== (c.elevation ?? 0)) setCity({ elevation: Math.max(-500, Math.min(9000, v)) }, `Height above the sea: ${v} m`); }} />
        </label>
        {row("Hills, valleys and slopes", String((features.land ?? []).length))}
        <label className="check"><input type="checkbox" checked={ui.contours} onChange={(e) => onUi({ contours: e.target.checked })} data-testid="city-contours" /> Contour lines</label>
      </section>
    </>
  );
}

const hexOf = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** What is selected: one building or street to edit, or a group to change together. */
export function CityInspector({ features, ui, onUi }: { features: Features; ui: CityUi; onUi: (p: Partial<CityUi>) => void }) {
  const { buildings, streets, trees, land } = selectedOf(features, ui.selected);
  if (!buildings.length && !streets.length && !trees.length && !land.length) return null;
  const clear = () => onUi({ selected: [] });
  const total = buildings.length + streets.length + trees.length + land.length;
  const remove = () => {
    sendCityFeatures({
      ...(buildings.length && { removeBuildings: buildings.map((b) => b.id) }), ...(streets.length && { removeStreets: streets.map((s) => s.id) }),
      ...(trees.length && { removeTrees: trees.map((t) => t.id) }), ...(land.length && { removeLand: land.map((l) => l.id) }),
    }, total > 1 ? `Delete ${total} items` : buildings.length ? "Delete building" : streets.length ? "Delete street" : trees.length ? "Delete trees" : `Delete ${landName(land[0]).toLowerCase()}`);
    onUi({ selected: [] });
  };
  if (total === 1 && trees.length) return <TreesEditor t={trees[0]} onClear={clear} onRemove={remove} />;
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
      <p className="muted">{buildings.length} building{buildings.length === 1 ? "" : "s"}, {streets.length} street{streets.length === 1 ? "" : "s"}{trees.length ? `, ${trees.length} group${trees.length === 1 ? "" : "s"} of trees` : ""}. Drag to move them together.</p>
      {buildings.length > 0 && (
        <>
          <label className="field">Roof for all the buildings
            <select value="" onChange={(e) => e.target.value && reroof(e.target.value as RoofStyle)} data-testid="city-group-roof">
              <option value="">Change…</option>
              {ROOF_STYLES.map((r) => <option key={r} value={r}>{ROOF_STYLE_NAMES[r]}</option>)}
            </select>
          </label>
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
  return (
    <section data-testid="city-inspector">
      <h3>Building</h3>
      <p className="muted">{(bb.x1 - bb.x0).toFixed(1)} × {(bb.y1 - bb.y0).toFixed(1)} m across · {Math.round(polygonArea(b.points as [number, number][]))} m²</p>
      <label className="field">Name (only a name you chose)
        <input key={b.id + (b.name ?? "")} defaultValue={b.name ?? ""} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (b.name ?? "")) { const { name: _n, ...rest } = b; sendCityFeatures({ upsertBuildings: [v ? { ...rest, name: v } : rest] }, v ? `Name building ${v}` : "Clear building name"); } }} data-testid="city-name" />
      </label>
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
            <button disabled={available < 2} onClick={() => { const n = nextRoofPicture(look, b.asset); if (n) roofWith(n, {}, "Another roof picture"); }} title="Use the next roof picture of your packs" data-testid="city-roof-another">Another</button>
            <button onClick={() => roofWith(null, {}, "Draw the roof")} title="Draw this roof from its look instead (then you can choose its colour)" data-testid="city-roof-draw">Draw it instead</button>
          </span>
        </div>
      ) : (
        <p className="muted" data-testid="city-roof-drawn-note">
          Drawn from its look.{" "}
          {available > 0 && <button onClick={() => { const c = roofChoiceFor(look, b.id); if (c) roofWith(c, {}, "Use a roof picture"); }} data-testid="city-roof-use">Use a roof picture</button>}
          {roofs.loaded && roofs.pools && available === 0 && <>No {ROOF_STYLE_NAMES[look].toLowerCase()} roof picture in your packs.</>}
        </p>
      )}
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
