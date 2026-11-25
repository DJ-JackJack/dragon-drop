/**
 * A settlement's ground in the Map panel (core cityGroundLook.ts): each kind painted on the map (most first) with its colour (the climate's, or the map's
 * own), and its look: a gradient between a light and a dark shade following a pattern (patches, from the edges, with the height, or flat), how strong and
 * how big, and a ground texture from the asset packs tiled every so many metres. "Take them from the trace picture" measures every kind's colour and
 * shades in the picture at once (the hub: cityGround.ts). Shut until opened, since it counts the ground cells. Every change is one edit of the
 * settlement's settings (sliders when let go), so Undo takes it back.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { type GroundLook, type GroundPattern, type MapMeta, GROUND_PATTERNS, GROUND_SIZE_MAX, GROUND_SIZE_MIN, GROUND_TILE_MAX, GROUND_TILE_MIN, MATERIALS, groundHex, groundLooks, groundTileMetres } from "@mapmaker/core";
import { store } from "./store.ts";
import { PackGrid } from "./PackGrid.tsx";
import { assetUrl } from "./assetsApi.ts";

type Spec = NonNullable<MapMeta["city"]>;
const nameOf = (n: string) => n[0].toUpperCase() + n.slice(1);
const fileOf = (asset: string) => asset.split(/[/:]/).pop()!.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");

/** One settlement setting change, as one edit. */
function setCity(spec: Spec, patch: Partial<Spec>, label: string) {
  const next = { ...spec, ...patch };
  for (const k of ["ground", "groundLook"] as const) if (next[k] && !Object.keys(next[k]!).length) delete next[k];
  store.send({ t: "cmd", cmd: { op: "set_meta", patch: { city: next } }, label });
}

/** A slider that shows its value as it moves and sends it when let go (one undo step). */
function LookSlider({ label, value, min, max, step, unit, onCommit, testid }: { label: string; value: number; min: number; max: number; step: number; unit: string; onCommit: (v: number) => void; testid: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <label className="slider">
      <span>{label} <b>{v}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid={testid} />
    </label>
  );
}

export function GroundPanel({ spec, hasTrace }: { spec: Spec; hasTrace: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const busy = useSyncExternalStore(store.subscribe, () => store.getState().groundBusy);
  const own = spec.ground ?? {}, looks = spec.groundLook ?? {}, ownCount = Object.keys(own).length + Object.keys(looks).length;
  const setLook = (name: string, patch: Partial<Record<keyof GroundLook, unknown>>, label: string) => {
    const cur: Record<string, unknown> = { ...(looks[name] ?? {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete cur[k]; else cur[k] = v; }
    const next = { ...looks };
    if (Object.keys(cur).length) next[name] = cur as GroundLook; else delete next[name];
    setCity(spec, { groundLook: next }, label);
  };
  let rows: { id: number; name: string; share: number }[] = [];
  if (open && store.heights) {
    const counts = new Map<number, number>(), d = store.heights.data;
    for (let i = 0; i < d.length; i++) { const m = Math.round(d[i]); if (m > 0) counts.set(m, (counts.get(m) ?? 0) + 1); }
    rows = [...counts].filter(([id]) => MATERIALS[id]).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: MATERIALS[id].name, share: (100 * n) / d.length }));
  }
  const resolved = open ? groundLooks(spec) : [];
  return (
    <details className="ground-colours" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="city-ground-colours">
      <summary>Ground colours and textures{ownCount > 0 && <span className="muted"> · set for this map</span>}</summary>
      {rows.map((r) => {
        const L = resolved[r.id], key = r.name.replace(/ /g, "-"), mine = looks[r.name] ?? {};
        return (
          <div className="ground-kind" key={r.id}>
            <div className="kv ground-row">
              <span className="row">
                <input type="color" value={groundHex(L.colour)} onChange={(e) => setCity(spec, { ground: { ...own, [r.name]: e.target.value } }, `Ground colour: ${r.name}`)} data-testid={`city-ground-${key}`} title={`The colour of ${r.name} on this map`} />
                <span className="ground-ramp" style={{ background: L.pattern === "flat" || !L.strength ? groundHex(L.colour) : `linear-gradient(90deg, ${groundHex(L.dark)}, ${groundHex(L.colour)}, ${groundHex(L.light)})` }} title="Its gradient, dark to light" />
                {L.texture && <img className="ground-tex-thumb" src={assetUrl(L.texture, 64)} alt="" title={`Texture: ${fileOf(L.texture)}`} />}
                <span>{nameOf(r.name)} <span className="muted">{r.share >= 1 ? Math.round(r.share) : r.share.toFixed(1)}%</span></span>
              </span>
              <span className="row">
                <button onClick={() => setEditing(editing === r.name ? null : r.name)} aria-expanded={editing === r.name} data-testid={`city-ground-look-${key}`} title="Its gradient, pattern and texture">Look…</button>
                {own[r.name] && <button onClick={() => { const { [r.name]: _x, ...rest } = own; setCity(spec, { ground: rest }, `Ground colour: ${r.name} as the climate makes it`); }} title="Back to the colour the climate gives it">Reset</button>}
              </span>
            </div>
            {editing === r.name && (
              <div className="ground-look" data-testid="city-ground-look">
                <div className="row">
                  <label className="field">Light<input type="color" value={groundHex(L.light)} onChange={(e) => setLook(r.name, { light: e.target.value }, `Ground look: ${r.name}'s light shade`)} data-testid="ground-light" /></label>
                  <label className="field">Dark<input type="color" value={groundHex(L.dark)} onChange={(e) => setLook(r.name, { dark: e.target.value }, `Ground look: ${r.name}'s dark shade`)} data-testid="ground-dark" /></label>
                  {(mine.light || mine.dark) && <button onClick={() => setLook(r.name, { light: undefined, dark: undefined }, `Ground look: ${r.name}'s shades from its colour`)} title="Shades worked out from its colour again">Auto shades</button>}
                </div>
                <label className="field">Pattern
                  <select value={L.pattern} onChange={(e) => setLook(r.name, { pattern: e.target.value as GroundPattern }, `Ground look: ${r.name} ${GROUND_PATTERNS.find((p) => p.id === e.target.value)!.name.toLowerCase()}`)} data-testid="ground-pattern">
                    {GROUND_PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <p className="muted">{GROUND_PATTERNS.find((p) => p.id === L.pattern)!.hint}</p>
                {L.pattern !== "flat" && <LookSlider label="Strength" value={L.strength} min={0} max={1} step={0.05} unit="" onCommit={(v) => setLook(r.name, { strength: v }, `Ground look: ${r.name}'s strength`)} testid="ground-strength" />}
                {(L.pattern === "patches" || L.pattern === "edges") && (
                  <LookSlider label={L.pattern === "patches" ? "Patch size" : "Edge width"} value={L.size} min={GROUND_SIZE_MIN} max={GROUND_SIZE_MAX} step={1} unit=" m" onCommit={(v) => setLook(r.name, { size: v }, `Ground look: ${r.name}'s ${L.pattern === "patches" ? "patch size" : "edge width"}`)} testid="ground-size" />
                )}
                <div className="field">Texture
                  {L.texture ? (
                    <span className="row">
                      <img className="ground-tex-thumb big" src={assetUrl(L.texture, 64)} alt="" />
                      <span className="muted" title={L.texture}>{fileOf(L.texture)}</span>
                      <button onClick={() => setLook(r.name, { texture: undefined, tile: undefined }, `Ground look: ${r.name} without its texture`)} data-testid="ground-texture-remove">Remove</button>
                    </span>
                  ) : <p className="muted">None: drawn in its colours. Pick one of your packs' ground textures below to cover all of the {r.name} with it.</p>}
                </div>
                {L.texture && <LookSlider label="One tile is" value={L.tile} min={GROUND_TILE_MIN} max={GROUND_TILE_MAX} step={0.25} unit=" m" onCommit={(v) => setLook(r.name, { tile: v }, `Ground look: ${r.name}'s texture size`)} testid="ground-tile" />}
                <div className="inline-picker">
                  <PackGrid
                    kinds={[{ cat: "terrain", label: "ground" }, { cat: "patterns", label: "patterns" }]} testId="ground-textures" item="ground-tex" placeholder="Search: grass, dirt, sand, cobble…"
                    noneFound="No ground textures were found in your asset packs. Dragon Drop knows one by the words in its folder or file name (ground, terrain, floor, tiles, textures, grass...), or by its look."
                    noFolder="To use the ground textures in your asset packs, choose your asset folder in Settings (Maps and assets)."
                    stateOf={(it) => ({ on: it.id === L.texture })}
                    onChoose={(it) => setLook(r.name, { texture: it.id, tile: groundTileMetres(it.w) }, `Ground look: ${r.name} with the texture ${fileOf(it.id)}`)}
                  />
                </div>
                {Object.keys(mine).length > 0 && <div className="row"><button onClick={() => setLook(r.name, { light: undefined, dark: undefined, pattern: undefined, strength: undefined, size: undefined, texture: undefined, tile: undefined }, `Ground look: ${r.name} as it usually is`)} data-testid="ground-look-reset">Usual look</button></div>}
              </div>
            )}
          </div>
        );
      })}
      <div className="row">
        <button onClick={() => store.groundFromPicture()} disabled={!hasTrace || busy}
          title={hasTrace ? "Measure the trace picture under open ground of each kind (not under buildings, streets or woods) and use its colours and its light and dark shades" : "Lay a reference picture over the map first (References: Trace over map)"} data-testid="city-ground-from-picture">
          {busy ? "Measuring the picture…" : "Take them from the trace picture"}
        </button>
        {ownCount > 0 && <button onClick={() => { const { ground: _g, groundLook: _l, ...rest } = spec; store.send({ t: "cmd", cmd: { op: "set_meta", patch: { city: rest } }, label: "Ground as the climate makes it" }); }} data-testid="city-ground-reset" title="Every kind's colour and look as the climate makes them (textures too are taken off)">Climate's colours</button>}
      </div>
      <p className="muted">{hasTrace ? "Redrawing a found map? Paint the ground first (grass, sand, water...), then take each kind's colours from the picture." : "The climate colours the ground; give a kind its own colour, gradient or texture with Look…"}</p>
    </details>
  );
}
