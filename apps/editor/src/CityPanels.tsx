/** The city map's tool bar (the options of the chosen tool) and the inspector for what is selected. */
import { useSyncExternalStore } from "react";
import { BUILDING_KINDS, MATERIALS, ROOF_BASE, ROOF_STYLES, ROOF_STYLE_NAMES, STREET_KINDS, polygonArea, pointsBounds, type BuildingKind, type Features, type MapBuilding, type MapMeta, type MapStreet, type RoofStyle, type StreetKind } from "@mapmaker/core";
import { type CityUi, selectedOf, sendCityFeatures } from "./cityUi.ts";
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
  select: "Click a building or street. Drag to move it, or drag on bare ground to select several. Delete removes; Q and E turn buildings.",
};
const KIND_NAMES: Record<BuildingKind, string> = { house: "House", shop: "Shop", tavern: "Tavern", inn: "Inn", temple: "Temple", hall: "Hall", tower: "Tower", barn: "Barn", warehouse: "Warehouse", arena: "Arena", gatehouse: "Gatehouse", other: "Other" };
const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;

/** The tool bar: the options of the tool in use (the roof of the next building, the kind of street, the ground to paint). The tools themselves are in the rail. */
export function CityToolBar({ ui, onUi }: { ui: CityUi; onUi: (p: Partial<CityUi>) => void }) {
  const building = ui.tool === "building" || ui.tool === "outline";
  const roofs = useSyncExternalStore(roofAssetsStore.subscribe, roofAssetsStore.get);
  const have = roofs.pools?.[ui.roof]?.length ?? 0;
  const ground = MATERIALS[ui.material];
  return (
    <ToolBar hint={HINTS[ui.tool]}>
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
        <label className="field">Kind of street
          <select value={ui.streetKind} onChange={(e) => onUi({ streetKind: e.target.value as StreetKind })} data-testid="city-street-kind">
            {STREET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.width} m wide)</option>)}
          </select>
        </label>
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
    </ToolBar>
  );
}

/** The city in numbers, for the Map panel (a city can have thousands of buildings, so they are counted here, never listed). */
export function CitySummary({ meta, features }: { meta: MapMeta | null; features: Features }) {
  const c = meta?.city;
  if (!c) return null;
  const row = (k: string, v: string) => <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>;
  return (
    <section data-testid="city-summary">
      <h3>This city</h3>
      {row("Size", `${c.widthM.toLocaleString()} × ${c.heightM.toLocaleString()} m`)}
      {row("Buildings", (features.buildings ?? []).length.toLocaleString())}
      {row("Streets", (features.streets ?? []).length.toLocaleString())}
      <p className="muted">Click a building or street with the Select tool to edit it here.</p>
    </section>
  );
}

const hexOf = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** What is selected: one building or street to edit, or a group to change together. */
export function CityInspector({ features, ui, onUi }: { features: Features; ui: CityUi; onUi: (p: Partial<CityUi>) => void }) {
  const { buildings, streets } = selectedOf(features, ui.selected);
  if (!buildings.length && !streets.length) return null;
  const clear = () => onUi({ selected: [] });
  const total = buildings.length + streets.length;
  const remove = () => { sendCityFeatures({ removeBuildings: buildings.map((b) => b.id), removeStreets: streets.map((s) => s.id) }, total === 1 ? (buildings.length ? "Delete building" : "Delete street") : `Delete ${total} items`); onUi({ selected: [] }); };
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
      <p className="muted">{buildings.length} building{buildings.length === 1 ? "" : "s"}, {streets.length} street{streets.length === 1 ? "" : "s"}. Drag to move them together.</p>
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
      <div className="row"><button onClick={onRemove} className="danger" data-testid="city-delete">Delete</button><button onClick={onClear}>Clear</button></div>
    </section>
  );
}
