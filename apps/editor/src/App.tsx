import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { placeKind, selectionFromIds, type Features, type LabelKind, type LineKind, type PlaceType, type Rect, type RefInfo, type SelectableShape, type SelectedFeatureKind, lineLengthKm, planRegional } from "@mapmaker/core";
import { SketchDialog } from "./SketchDialog.tsx";
import { Brand } from "./Brand.tsx";
import { type RightTab, RightPanel, defaultTab } from "./RightPanel.tsx";
import { DesktopSettings } from "./DesktopSettings.tsx";
import { BATTLE_TOOLS, BattleInspector, BattleKey, BattleSettings, BattleTools, BattleView, type BattleUi, defaultBattleUi } from "./Battle.tsx";
import { type AreaShape, type Brush, type Tool, MapView } from "./MapView.tsx";
import { type ToolDef, TOOL_GROUPS } from "./toolDefs.ts";
import { ShortcutHelp } from "./ShortcutHelp.tsx";
import { SelectionBar } from "./SelectionBar.tsx";
import { useAssist } from "./useAssist.ts";
import { ask, confirmBox, DialogHost, notice } from "./dialogs.tsx";
import { regionSummary } from "./drawRegions.ts";
import { ClimatePanel, ExtrasPanel, GridPanel, GroundLegend, Inspector, LABEL_KINDS } from "./Panels.tsx";
import { PlaceKindPicker } from "./PlaceKindPicker.tsx";
import { type AppState, store } from "./store.ts";

const TOOLS: ToolDef[] = TOOL_GROUPS.flatMap((g) => g.tools);
/** What to do next with the active tool (shown under the tool buttons). */
const AREA_SHAPES: { id: AreaShape; label: string; tip: string }[] = [
  { id: "rect", label: "Rectangle", tip: "Drag from one corner to the opposite one" },
  { id: "circle", label: "Circle", tip: "Drag from the centre outwards" },
  { id: "free", label: "Freehand", tip: "Draw round the area; it closes itself when you let go" },
  { id: "poly", label: "Polygon", tip: "Click the corners; double-click, click the first corner or press Enter to close it. Backspace drops a corner, Esc cancels" },
];

function featureKindOf(f: Features, id: string): SelectedFeatureKind | null {
  if (f.places.some((p) => p.id === id)) return "place";
  if (f.labels.some((l) => l.id === id)) return "label";
  if (f.lines?.some((l) => l.id === id)) return "line";
  if (f.regions?.some((r) => r.id === id)) return "region";
  if (f.sources?.some((x) => x.id === id)) return "source";
  return null;
}

const TOOL_HINTS: Partial<Record<Tool, string>> = {
  area: "Drag out an area (pick its shape above), or for a polygon click its corners and double-click to close. Claude can see it, and while the lock is on its edits stay inside it. Click for a single point. Esc clears.",
  place: "Click on the map where the place goes. A box will ask for its name.",
  label: "Click for a straight label, or click and drag to draw a line for the name to follow. A box will ask for the text.",
  region: "Click the corners of the area, one at a time. Double-click, click the first corner, or press Enter to finish. Esc cancels.",
  line: "", // depends on the kind: see lineHint()
  battlehere: "Click the spot. A box will ask for the battlemap's name; its floors come from that spot's climate, slope, rivers, lakes and coast. You can build rooms, add objects and lights afterwards.",
  detail: "Drag a box on the map. The new map keeps this one's land, climate and names, with 2× to 16× the detail.",
  select: "Click a place, label, region or road to select it. Drag to move it. Delete removes it.",
};
function lineHint(kind: LineKind, auto: boolean): string {
  if (kind === "reef") return "Click the points along the reef (for a strait, from one coast to the other). Double-click or press Enter to finish. Backspace removes the last point, Esc cancels.";
  if (kind === "border") return "Click the points along the border. Double-click or press Enter to finish. Click the first point to close a territory. Backspace removes the last point, Esc cancels.";
  if (auto) return `Click where the ${kind} starts, then where it ends (click more points to make it pass through them). Double-click or press Enter to finish: the route is found over the terrain for you. Esc cancels.`;
  return `Click the points the ${kind} passes through. Double-click or press Enter to finish. Backspace removes the last point, Esc cancels.`;
}
/** Does the open map have any land? (A quick sample, for wording in dialogs.) */
function mapHasLand(): boolean {
  const hf = store.heights, m = store.getState().meta;
  if (!hf || !m) return false;
  for (let i = 0; i < hf.data.length; i += 37) if (hf.data[i] > m.seaLevel) return true;
  return false;
}
const BRUSHES: Tool[] = ["raise", "lower", "smooth", "flatten", "land", "water"];

export function App() {
  const s = useSyncExternalStore(store.subscribe, store.getState);
  const [tool, setTool] = useState<Tool>("pan");
  const [brush, setBrush] = useState<Brush>({ radius: 12, strength: 0.5 });
  const [showGrid, setShowGrid] = useState(false);
  const [hillshade, setHillshade] = useState(true);
  // soft pixels when zoomed in (the default), or crisp blocks; remembered
  const [smooth, setSmoothState] = useState(() => { try { return localStorage.getItem("dd.smoothZoom") !== "0"; } catch { return true; } });
  const setSmooth = (on: boolean) => { setSmoothState(on); try { localStorage.setItem("dd.smoothZoom", on ? "1" : "0"); } catch { /* private window */ } };
  // how big names and markers are drawn (a multiplier; remembered)
  const [labelSize, setLabelSizeState] = useState(() => { try { const n = Number(localStorage.getItem("dd.labelSize")); return n >= 0.4 && n <= 1.6 ? n : 1; } catch { return 1; } });
  const setLabelSize = (n: number) => { setLabelSizeState(n); try { localStorage.setItem("dd.labelSize", String(n)); } catch { /* private window */ } };
  const [showRivers, setShowRivers] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const [lineKind, setLineKind] = useState<LineKind>("road");
  const [lineAuto, setLineAuto] = useState(true);
  // a road being routed by the server: show progress until it arrives (or fails)
  const [routingId, setRoutingId] = useState<string | null>(null);
  useEffect(() => { if (routingId && s.features.lines?.some((l) => l.id === routingId)) setRoutingId(null); }, [s.features, routingId]);
  useEffect(() => setRoutingId(null), [s.error]);
  const onRouting = useCallback((id: string) => setRoutingId(id), []);
  const [areaShape, setAreaShape] = useState<AreaShape>("rect");
  // what is selected lives in the store (the server shares it with Claude); an id that isn't on the map yet (just created) waits here until it arrives
  const [pendingId, setPendingId] = useState<string | null>(null);
  const selectedId = s.selection?.kind === "feature" ? s.selection.id : pendingId;
  const [placeType, setPlaceType] = useState<PlaceType>("town");
  const [labelKind, setLabelKind] = useState<LabelKind>("region");
  const onSelect = useCallback((id: string | null) => {
    const st = store.getState();
    if (!id) {
      setPendingId(null);
      if (st.selection?.kind === "feature") store.setSelection(null);
      return;
    }
    const kind = featureKindOf(st.features, id);
    if (kind) { setPendingId(null); store.setSelection({ kind: "feature", featureKind: kind, id }); }
    else setPendingId(id);
  }, []);
  useEffect(() => {
    if (!pendingId) return;
    const kind = featureKindOf(s.features, pendingId);
    if (kind) { setPendingId(null); store.setSelection({ kind: "feature", featureKind: kind, id: pendingId }); }
  }, [s.features, pendingId]);
  const onArea = useCallback((shape: SelectableShape) => { setPendingId(null); store.setSelection({ kind: "area", shape }); }, []);
  const onPoint = useCallback((x: number, y: number) => {
    const m = store.getState().meta;
    if (!m || x < 0 || y < 0 || x > m.width || y > m.height) return;
    setPendingId(null);
    store.setSelection({ kind: "point", x, y });
  }, []);
  const clearSelection = useCallback(() => { setPendingId(null); if (store.getState().selection) store.setSelection(null); }, []);
  const style = s.meta?.style ?? "painted";
  const isBattle = s.meta?.kind === "battle";
  const [bui, setBui] = useState<BattleUi>(defaultBattleUi);
  const onBui = useCallback((p: Partial<BattleUi>) => setBui((b) => ({ ...b, ...p })), []);
  useEffect(() => setBui((b) => (b.selected || b.multi.length ? { ...b, selected: null, multi: [] } : b)), [s.meta?.id, s.levels?.active]);
  useEffect(() => { if (isBattle && bui.tool === "prop" && !bui.asset) openAssets("objects"); }, [bui.tool]);
  const [newOpen, setNewOpen] = useState(false);
  const [sketchRef, setSketchRef] = useState<RefInfo | null>(null);
  // regional maps: the ones made from this map, and a note while a new one is being built
  const childMaps = s.projects.filter((p) => p.parent && p.parent.id === s.meta?.id);
  const [making, setMaking] = useState<string | null>(null);
  useEffect(() => setMaking(null), [s.meta?.id, s.error]);
  const onBattleHere = useCallback((x: number, y: number) => {
    void ask("Name for this battlemap:", "", "Make battlemap").then((name) => {
      if (!name) return;
      setMaking(name);
      store.send({ t: "create_battle_here", name, x, y });
    });
  }, []);
  const onDetailArea = useCallback((rect: Rect) => {
    const m = store.getState().meta;
    if (!m) return;
    const plan = planRegional(rect, m.width, m.height);
    if ("error" in plan) { void notice(plan.error); return; }
    const miles = (n: number) => Math.round(n * m.kmPerPx * 0.621371).toLocaleString();
    void ask(`Name for this regional map (about ${miles(plan.rect.w)} × ${miles(plan.rect.h)} miles, ${plan.factor}× the detail):`, "", "Make map").then((name) => {
      if (!name) return;
      setMaking(name);
      store.send({ t: "create_regional", name, rect: plan.rect });
    });
  }, []);

  useEffect(() => {
    store.connect();
  }, []);
  // inside the desktop app: the top bar doubles as the window's title bar, and Settings is available
  const desktop = typeof window !== "undefined" ? window.dragonDrop : undefined;
  const assist = useAssist(s, !!desktop);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Ctrl+S: the server says when the map is on disk; show that for a moment
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => {
    if (!s.savedAt) return;
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 2500);
    return () => clearTimeout(t);
  }, [s.savedAt]);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem("dd-wide") === "1"; } catch { return false; } });
  const toggleWide = useCallback(() => setWide((w) => { try { localStorage.setItem("dd-wide", w ? "0" : "1"); } catch { /* private mode */ } return !w; }), []);
  const [rightTab, setRightTab] = useState<RightTab>(defaultTab(!!window.dragonDrop));
  const [assetFocus, setAssetFocus] = useState({ cat: "objects", n: 0 });
  const openAssets = useCallback((cat = "terrain") => { setAssetFocus((f) => ({ cat, n: f.n + 1 })); setRightTab("assets"); }, []);
  const onAsk = async (text: string, selection: string, locked: boolean) => {
    const r = await assist.ask(text, selection, locked);
    if (r.ok) setRightTab("claude"); // so the DM sees the answer
    return r;
  };
  useEffect(() => {
    if (!desktop) return;
    document.documentElement.classList.add("desktop", `platform-${desktop.platform}`);
  }, [desktop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Ctrl+S saves now, even from a text box (never inside the terminal: there Ctrl+S means "pause output")
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s" && !t.closest?.(".xterm")) { e.preventDefault(); store.send({ t: "save_now" }); return; }
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); store.send({ t: e.shiftKey ? "redo" : "undo" }); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); store.send({ t: "redo" }); return; }
      if (mod) return;
      if (e.key === "?") { e.preventDefault(); setHelpOpen((o) => !o); return; }
      if (store.getState().meta?.kind === "battle") {
        const bt = BATTLE_TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (bt) setBui((b) => ({ ...b, tool: bt.id }));
        if (e.key === "[") setBui((b) => ({ ...b, brush: Math.max(0.25, +(b.brush / 1.25).toFixed(2)) }));
        if (e.key === "]") setBui((b) => ({ ...b, brush: Math.min(10, +(b.brush * 1.25 + 0.1).toFixed(2)) }));
        if (e.key.toLowerCase() === "g") setBui((b) => ({ ...b, showGrid: !b.showGrid }));
        return;
      }
      if (e.key === "Escape") { clearSelection(); return; }
      const found = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (found) setTool(found.id);
      if (e.key === "[") setBrush((b) => ({ ...b, radius: Math.max(1, Math.round(b.radius / 1.25)) }));
      if (e.key === "]") setBrush((b) => ({ ...b, radius: Math.min(300, Math.round(b.radius * 1.25 + 1)) }));
      if (e.key.toLowerCase() === "g") setShowGrid((g) => !g);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

  return (
    <div className="app">
      <TopBar s={s} onNew={() => setNewOpen(true)} onHelp={() => setHelpOpen(true)} onSettings={desktop ? () => setSettingsOpen(true) : undefined} />
      <div className={`main${desktop && wide ? " wide" : ""}`}>
        <aside className="side">
          {isBattle && s.meta && (
            <>
              <BattleTools ui={bui} onUi={onBui} canUndo={s.canUndo} canRedo={s.canRedo} meta={s.meta} assetsOn={isBattle} onOpenAssets={() => openAssets("terrain")} />
              <BattleInspector features={s.features} levels={s.levels} selected={bui.selected} multi={bui.multi} bounds={{ w: s.meta.battle?.squaresX ?? 0, h: s.meta.battle?.squaresY ?? 0 }} onClear={() => onBui({ selected: null, multi: [] })} onSelect={(ids) => onBui(selectionFromIds(ids))} />
              <BattleKey features={s.features} selected={bui.selected} onSelect={(id) => onBui({ selected: id, multi: [], tool: "select" })} />
              <BattleSettings meta={s.meta} features={s.features} ui={bui} onUi={onBui} />
            </>
          )}
          {!isBattle && <>
          <section>
            {TOOL_GROUPS.map((g) => (
              <div key={g.name}>
                <h3>{g.name}</h3>
                <div className="tools">
                  {g.tools.map((x) => (
                    <button key={x.id} className={tool === x.id ? "on" : ""} onClick={() => setTool(x.id)} title={`${x.tip} (${x.key})`}>
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {tool === "line" && (
              <>
                <label className="field">Draw a
                  <select value={lineKind} onChange={(e) => setLineKind(e.target.value as LineKind)} data-testid="line-kind">
                    <option value="road">Road</option>
                    <option value="trail">Trail</option>
                    <option value="border">Border</option>
                    <option value="reef">Reef</option>
                  </select>
                </label>
                {(lineKind === "road" || lineKind === "trail") && (
                  <label className="check"><input type="checkbox" checked={lineAuto} onChange={(e) => setLineAuto(e.target.checked)} /> Find the route over the terrain</label>
                )}
              </>
            )}
            {tool === "area" && (
              <div className="seg" role="group" aria-label="Area shape" data-testid="area-shapes">
                {AREA_SHAPES.map((a) => (
                  <button key={a.id} className={areaShape === a.id ? "on" : ""} onClick={() => setAreaShape(a.id)} title={a.tip} data-testid={`area-${a.id}`}>{a.label}</button>
                ))}
              </div>
            )}
            {(tool === "line" || TOOL_HINTS[tool]) && <p className="tool-hint" data-testid="tool-hint">{tool === "line" ? lineHint(lineKind, lineAuto) : TOOL_HINTS[tool]}</p>}
            {tool === "place" && (
              <div className="field" data-testid="place-kinds">New place: <b className="kind-name">{placeKind(placeType).name}</b>
                <PlaceKindPicker value={placeType} onChange={setPlaceType} />
              </div>
            )}
            {tool === "label" && (
              <label className="field">New label kind
                <select value={labelKind} onChange={(e) => setLabelKind(e.target.value as LabelKind)}>
                  {LABEL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
            )}
            {BRUSHES.includes(tool) && <>
            <label className="slider">
              <span>Brush size <b>{brush.radius}</b> px</span>
              <input type="range" min={1} max={150} value={brush.radius} onChange={(e) => setBrush({ ...brush, radius: Number(e.target.value) })} />
            </label>
            <label className="slider">
              <span>Strength <b>{Math.round(brush.strength * 100)}%</b></span>
              <input type="range" min={5} max={100} value={Math.round(brush.strength * 100)} onChange={(e) => setBrush({ ...brush, strength: Number(e.target.value) / 100 })} />
            </label>
            </>}
            <div className="row">
              <button disabled={!s.canUndo} onClick={() => store.send({ t: "undo" })} title="Undo (Ctrl+Z)">↶ Undo</button>
              <button disabled={!s.canRedo} onClick={() => store.send({ t: "redo" })} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
            </div>
          </section>

          <Inspector features={s.features} selectedId={selectedId} kmPerPx={s.meta?.kmPerPx ?? 1} onClear={() => onSelect(null)} />

          <section>
            <h3>Style</h3>
            <div className="seg" role="group" aria-label="Map style">
              {(["painted", "relief"] as const).map((st) => (
                <button
                  key={st}
                  className={style === st ? "on" : ""}
                  onClick={() => style !== st && store.send({ t: "cmd", cmd: { op: "set_meta", patch: { style: st }, label: `Style: ${st}` } })}
                  title={st === "painted" ? "Painted Relief: biomes, rock, snow, coastal glow" : "Plain elevation colours, handy while sculpting"}
                >
                  {st === "painted" ? "Painted" : "Relief"}
                </button>
              ))}
            </div>
            <h3>Layers</h3>
            <label className="check"><input type="checkbox" checked={showRivers} onChange={(e) => setShowRivers(e.target.checked)} /> Rivers</label>
            <label className="check"><input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} /> Climate region outlines</label>
            {style === "relief" && (
              <label className="check"><input type="checkbox" checked={hillshade} onChange={(e) => setHillshade(e.target.checked)} /> Relief shading</label>
            )}
            <label className="check" title="When zoomed in, blend the terrain's pixels softly instead of drawing hard blocks"><input type="checkbox" data-testid="smooth-zoom" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> Smooth zoom</label>
            <label className="check" title="How big place names, labels and markers are drawn. They already grow only a little when you zoom in."><span>Label size</span> <input type="range" data-testid="label-size" min={0.4} max={1.6} step={0.1} value={labelSize} onChange={(e) => setLabelSize(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label className="check"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Coordinate numbers (G)</label>
            {s.meta && <GridPanel meta={s.meta} />}
            {s.meta && <ExtrasPanel meta={s.meta} />}
            {s.meta && <ClimatePanel meta={s.meta} />}
            {style === "painted" && <GroundLegend />}
            <div className="regions" data-testid="regions">
              <h3>Climate regions</h3>
              {(s.features.regions ?? []).length === 0 && <p className="muted">None yet. Use the Region tool (C) to outline an area whose climate overrides the gradient.</p>}
              {(s.features.regions ?? []).map((r) => (
                <button key={r.id} className={`place-row ${selectedId === r.id ? "on" : ""}`} onClick={() => { onSelect(r.id); setTool("select"); }}>
                  <span>{r.name}</span><span className="muted">{regionSummary(r)}</span>
                </button>
              ))}
            </div>
          </section>

          {(childMaps.length > 0 || s.meta?.parent) && (
            <section data-testid="regional">
              <h3>Regional maps</h3>
              {s.meta?.parent && (
                <button className="place-row" onClick={() => store.send({ t: "open_project", id: s.meta!.parent!.id })} title="Open the map this one was made from">
                  <span>⬑ {s.meta.parent.name}</span><span className="muted">parent</span>
                </button>
              )}
              {childMaps.map((c) => (
                <button key={c.id} className="place-row" onClick={() => store.send({ t: "open_project", id: c.id })} title="Open this regional map">
                  <span>{c.name} ↗</span><span className="muted">{c.parent!.factor}× detail</span>
                </button>
              ))}
            </section>
          )}

          <section>
            <h3>Places</h3>
            <div className="places" data-testid="places">
              {s.features.places.length === 0 && <p className="muted">Use the Place tool, or ask Claude, to add named places.</p>}
              {[...s.features.places].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                <button key={p.id} className={`place-row ${selectedId === p.id ? "on" : ""}`} onClick={() => { onSelect(p.id); setTool("select"); }}>
                  <span>{p.name}</span><span className="muted">{placeKind(p.type).name}</span>
                </button>
              ))}
            </div>
          </section>

          {(s.features.lines ?? []).length > 0 && (
            <section>
              <h3>Roads and borders</h3>
              <div className="places" data-testid="lines">
                {(s.features.lines ?? []).map((l) => {
                  const mi = Math.round(lineLengthKm(l.points, s.meta?.kmPerPx ?? 1, l.closed) * 0.621371);
                  return (
                    <button key={l.id} className={`place-row ${selectedId === l.id ? "on" : ""}`} onClick={() => { onSelect(l.id); setTool("select"); }}>
                      <span>{l.name ?? l.kind}</span><span className="muted">{l.kind} · {mi.toLocaleString()} mi</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          </>}

          <section>
            <h3>Checkpoints</h3>
            <div className="checkpoints" data-testid="checkpoints">
              {s.checkpoints.length === 0 && <p className="muted">Save the map before big experiments.</p>}
              {[...s.checkpoints].reverse().map((c) => (
                <div key={c.file} className="cp" title={`${c.time}${c.note ? ` - ${c.note}` : ""}`}>
                  <span className="name">{c.name}</span>
                  <button onClick={() => { void confirmBox(`Restore "${c.name}"? (You can undo this.)`, "Restore").then((yes) => { if (yes) store.send({ t: "checkpoint_restore", name: c.name }); }); }}>Restore</button>
                </div>
              ))}
            </div>
            <div className="row">
              <button onClick={() => { void ask("Name this checkpoint:", `Checkpoint ${s.checkpoints.length + 1}`, "Save").then((n) => { if (n) store.send({ t: "checkpoint_save", name: n }); }); }}>
                Save checkpoint
              </button>
            </div>
          </section>

          <section>
            <h3>References</h3>
            {s.refs.length === 0 ? (
              <p className="muted">Attach images in the chat; they're kept here for Claude to re-read.</p>
            ) : (
              <div className="refs">
                {s.refs.map((r) => (
                  <div key={r.name} className="ref">
                    <a href={r.url} target="_blank" rel="noreferrer" title={r.name}><img src={r.url} alt={r.name} /></a>
                    {!isBattle && <button onClick={() => setSketchRef(r)} title="Turn this drawing into terrain" data-testid="sketch-open">Make terrain…</button>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grow">
            <h3>History</h3>
            <div className="history" data-testid="history">
              {s.changes.length === 0 && <p className="muted">No changes yet.</p>}
              {[...s.changes].reverse().map((c) => (
                <div key={`${c.seq}-${c.kind}-${c.time}`} className={`hist ${c.kind}`}>
                  <span className={`who ${c.author}`}>{c.author === "user" ? "You" : c.author === "claude" ? "Claude" : "System"}</span>
                  <span className="what">{c.label}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>

        {isBattle ? (
          <BattleView meta={s.meta} features={s.features} levels={s.levels} ui={bui} onUi={onBui} />
        ) : (
        <MapView
          meta={s.meta} tool={tool} brush={brush} showGrid={showGrid} hillshade={hillshade} smooth={smooth} labelScale={labelSize} showRivers={showRivers}
          features={s.features} selectedId={selectedId} onSelect={onSelect} placeType={placeType} labelKind={labelKind} showRegions={showRegions}
          lineKind={lineKind} lineAuto={lineAuto} onRouting={onRouting} childMaps={childMaps} onDetailArea={onDetailArea} onBattleHere={onBattleHere}
          selection={s.selection} selectionLock={s.selectionLock} areaShape={areaShape} onArea={onArea} onPoint={onPoint}
        >
          <SelectionBar
            selection={s.selection} lock={s.selectionLock} lockPref={s.lockPref} features={s.features} kmPerPx={s.meta?.kmPerPx ?? 1}
            canAsk={!!desktop} onClear={clearSelection} onLockPref={(on) => store.setLockPref(on)} onAsk={onAsk}
          />
        </MapView>
        )}
        <RightPanel
          s={s} desktop={!!desktop} assist={assist} wide={wide} onToggleWide={toggleWide} tab={rightTab} onTab={setRightTab}
          battle={isBattle} ui={bui} onUi={onBui} focus={assetFocus}
        />
      </div>
      {newOpen && <NewMapDialog onClose={() => setNewOpen(false)} />}
      {settingsOpen && desktop && <DesktopSettings onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <ShortcutHelp battle={isBattle} onClose={() => setHelpOpen(false)} />}
      {sketchRef && <SketchDialog refInfo={sketchRef} mapHasLand={mapHasLand()} onClose={() => setSketchRef(null)} />}
      <DialogHost />
      {routingId && <div className="toast info" data-testid="routing">Finding the best route over the terrain…</div>}
      {savedFlash && <div className="toast info" data-testid="saved">Saved. Dragon Drop also saves by itself after every change.</div>}
      {making && <div className="toast info" data-testid="making">Making “{making}”… this takes a few seconds.</div>}
      {s.error && (
        <div className="toast" onClick={() => store.dismissError()}>{s.error} <span className="muted">(click to dismiss)</span></div>
      )}
    </div>
  );
}

function TopBar({ s, onNew, onHelp, onSettings }: { s: AppState; onNew: () => void; onHelp: () => void; onSettings?: () => void }) {
  return (
    <header className="top">
      <Brand />
      <select
        className="project"
        value={s.meta?.id ?? ""}
        onChange={(e) => store.send({ t: "open_project", id: e.target.value })}
        title="Open project"
      >
        {s.projects.map((p) => <option key={p.id} value={p.id}>{p.parent ? `${p.name} (part of ${p.parent.name})` : p.kind === "battle" ? `${p.name} (battlemap)` : p.name}</option>)}
      </select>
      <button className="ghost" onClick={onNew}>+ New map</button>
      <div className="spacer" />
      <span className={`conn ${s.connected ? "ok" : "bad"}`}>{s.connected ? "Connected" : "Reconnecting…"}</span>
      <button className="ghost" onClick={onHelp} title="Keyboard and mouse controls (?)" data-testid="shortcuts-button">?</button>
      {onSettings && <button className="ghost" onClick={onSettings} title="API key, maps folder, Claude Code connection" data-testid="settings-button">Settings</button>}
    </header>
  );
}

function NewMapDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<"world" | "battle">("world");
  const [name, setName] = useState("New Map");
  const [size, setSize] = useState(1024);
  const [miles, setMiles] = useState(1000);
  const [template, setTemplate] = useState("ocean");
  const [sx, setSx] = useState(30);
  const [sy, setSy] = useState(20);
  const [feet, setFeet] = useState(5);
  const [grid, setGrid] = useState<"square" | "hex" | "none">("square");
  const [room, setRoom] = useState(true);
  const kmPerPx = Number(((miles * 1.609344) / size).toFixed(3));
  const battleOk = sx >= 3 && sy >= 3 && sx <= 150 && sy <= 150 && sx * sy * 70 * 70 <= 25_000_000;
  const switchKind = (k: "world" | "battle") => {
    setName((n) => (n === "New Map" && k === "battle" ? "New Battlemap" : n === "New Battlemap" && k === "world" ? "New Map" : n));
    setKind(k);
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="new-map-dialog">
        <h2>{kind === "world" ? "New map" : "New battlemap"}</h2>
        <div className="seg" role="group" aria-label="Kind of map">
          <button className={kind === "world" ? "on" : ""} onClick={() => switchKind("world")} data-testid="new-kind-world">World map</button>
          <button className={kind === "battle" ? "on" : ""} onClick={() => switchKind("battle")} data-testid="new-kind-battle">Battlemap</button>
        </div>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="new-name" /></label>
        {kind === "world" ? (
          <>
            <label>Resolution
              <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                <option value={512}>512 × 512 (fast)</option>
                <option value={1024}>1024 × 1024</option>
                <option value={2048}>2048 × 2048 (detailed, slower)</option>
              </select>
            </label>
            <label>Width of the map in miles<input type="number" min={1} value={miles} onChange={(e) => setMiles(Number(e.target.value))} /></label>
            <p className="muted">≈ {kmPerPx} km per pixel</p>
            <label>Start from
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="ocean">Empty ocean</option>
                <option value="island">One island</option>
                <option value="archipelago">Archipelago</option>
                <option value="continent">Continent</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>Width in squares<input type="number" min={3} max={150} value={sx} onChange={(e) => setSx(Number(e.target.value))} data-testid="new-sx" /></label>
            <label>Height in squares<input type="number" min={3} max={150} value={sy} onChange={(e) => setSy(Number(e.target.value))} data-testid="new-sy" /></label>
            <label>Feet per square<input type="number" min={1} max={100} value={feet} onChange={(e) => setFeet(Number(e.target.value))} /></label>
            <label>Grid
              <select value={grid} onChange={(e) => setGrid(e.target.value as "square" | "hex" | "none")}>
                <option value="square">Square</option>
                <option value="hex">Hex</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={room} onChange={(e) => setRoom(e.target.checked)} /> Start with a walled, floored room</label>
            <p className="muted">
              {battleOk ? <>{sx * feet} × {sy * feet} ft. The image will be {sx * 70} × {sy * 70} px (70 px per square, what Foundry expects).</>
                : <>Between 3 and 150 squares each way, and no more than 25 megapixels in all.</>}
            </p>
          </>
        )}
        <div className="row end">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button
            className="primary" data-testid="new-create" disabled={kind === "battle" && !battleOk}
            onClick={() => {
              if (kind === "battle") {
                store.send({ t: "create_battle", name: name.trim() || "New Battlemap", squaresX: sx, squaresY: sy, feetPerSquare: feet, gridType: grid, ...(room && { roomMargin: Math.max(1, Math.min(2, Math.floor(Math.min(sx, sy) / 6))) }) });
              } else {
                store.send({ t: "create_project", name: name.trim() || "New Map", width: size, height: size, kmPerPx, template, seed: Math.floor(Math.random() * 1e9) });
              }
              onClose();
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
