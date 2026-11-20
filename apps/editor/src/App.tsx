import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { placeKind, selectionFromIds, type Features, type LabelKind, type LineKind, type PlaceType, type Rect, type RefInfo, type SelectableShape, type SelectedFeatureKind, lineLengthKm, planRegional } from "@mapmaker/core";
import { SketchDialog } from "./SketchDialog.tsx";
import { PICTURE_RULE, References } from "./References.tsx";
import { onBeforeCopy, onBeforePaste, onCopyEvent, onPasteEvent } from "./clipboard.ts";
import { traceCtl } from "./trace.ts";
import { Brand } from "./Brand.tsx";
import { type RightTab, RightPanel, defaultTab } from "./RightPanel.tsx";
import { DesktopSettings } from "./DesktopSettings.tsx";
import { AssetPanel } from "./AssetPanel.tsx";
import { CityView } from "./CityView.tsx";
import { CityInspector, CitySummary, CityToolBar } from "./CityPanels.tsx";
import { CITY_TOOL_DEFS, CITY_TOOL_GROUPS, type CityUi, defaultCityUi } from "./cityUi.ts";
import { BATTLE_TOOLS, BATTLE_TOOL_GROUPS, BattleInspector, BattleKey, BattleSettings, BattleToolBar, BattleView, type BattleUi, defaultBattleUi } from "./Battle.tsx";
import { ToolRail } from "./ToolRail.tsx";
import { WorldToolBar } from "./WorldToolBar.tsx";
import { type AreaShape, type Brush, type Tool, MapView } from "./MapView.tsx";
import { type ToolDef, TOOL_GROUPS } from "./toolDefs.ts";
import { ShortcutHelp } from "./ShortcutHelp.tsx";
import { SelectionBar } from "./SelectionBar.tsx";
import { useAssist } from "./useAssist.ts";
import { ask, confirmBox, DialogHost, notice } from "./dialogs.tsx";
import { regionSummary } from "./drawRegions.ts";
import { ClimatePanel, ExtrasPanel, GridPanel, GroundLegend, Inspector } from "./Panels.tsx";
import { type AppState, store } from "./store.ts";

const TOOLS: ToolDef[] = TOOL_GROUPS.flatMap((g) => g.tools);
function featureKindOf(f: Features, id: string): SelectedFeatureKind | null {
  if (f.places.some((p) => p.id === id)) return "place";
  if (f.labels.some((l) => l.id === id)) return "label";
  if (f.lines?.some((l) => l.id === id)) return "line";
  if (f.regions?.some((r) => r.id === id)) return "region";
  if (f.sources?.some((x) => x.id === id)) return "source";
  return null;
}

/** Does the open map have any land? (A quick sample, for wording in dialogs.) */
function mapHasLand(): boolean {
  const hf = store.heights, m = store.getState().meta;
  if (!hf || !m) return false;
  for (let i = 0; i < hf.data.length; i += 37) if (hf.data[i] > m.seaLevel) return true;
  return false;
}

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
  const isCity = s.meta?.kind === "city";
  const isWorld = !isBattle && !isCity;
  const [cui, setCui] = useState<CityUi>(defaultCityUi);
  const onCui = useCallback((p: Partial<CityUi>) => setCui((c) => ({ ...c, ...p })), []);
  useEffect(() => setCui((c) => (c.selected.length ? { ...c, selected: [] } : c)), [s.meta?.id]);
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
  // the Map panel (layers, lists, history, assets) and the Claude panel can each be hidden; both are showing by default, and the choice is remembered
  const flag = (key: string) => { try { return localStorage.getItem(key) !== "0"; } catch { return true; } };
  const [mapOpen, setMapOpenState] = useState(() => flag("dd-map-open"));
  const [claudeOpen, setClaudeOpenState] = useState(() => flag("dd-claude-open"));
  const setMapOpen = useCallback((on: boolean) => { setMapOpenState(on); try { localStorage.setItem("dd-map-open", on ? "1" : "0"); } catch { /* private window */ } }, []);
  const setClaudeOpen = useCallback((on: boolean) => { setClaudeOpenState(on); try { localStorage.setItem("dd-claude-open", on ? "1" : "0"); } catch { /* private window */ } }, []);
  const [mapTab, setMapTab] = useState<"map" | "history" | "assets">("map");
  const tabNow = mapTab === "assets" && !isBattle ? "map" : mapTab;
  // picking something on the map shows its editor (the Map tab), unless the person is browsing assets
  const selKey = isCity ? cui.selected.join(",") : isBattle ? `${bui.selected ?? ""}|${bui.multi.join(",")}` : selectedId ?? "";
  useEffect(() => { if (selKey.replace("|", "")) setMapTab((t) => (t === "history" ? "map" : t)); }, [selKey]);
  const [assetFocus, setAssetFocus] = useState({ cat: "objects", n: 0 });
  const openAssets = useCallback((cat = "terrain") => { setAssetFocus((f) => ({ cat, n: f.n + 1 })); setMapTab("assets"); setMapOpen(true); }, [setMapOpen]);
  const onAsk = async (text: string, selection: string, locked: boolean) => {
    const r = await assist.ask(text, selection, locked);
    if (r.ok) { setRightTab("claude"); setClaudeOpen(true); } // so the DM sees the answer
    return r;
  };
  const onAskPicture = async (r: RefInfo) => {
    const text = await ask(`What should Claude do with "${r.name}"? It goes to Claude Code in the terminal panel.`, "Tell me what you see in it and how it could help this map.", "Ask Claude");
    if (!text?.trim()) return;
    const res = await assist.askPicture(r.name, text);
    if (res.ok) { setRightTab("claude"); setClaudeOpen(true); } // so the DM sees the answer
    else void notice(res.message);
  };
  useEffect(() => {
    if (!desktop) return;
    document.documentElement.classList.add("desktop", `platform-${desktop.platform}`);
  }, [desktop]);

  // Pictures dropped anywhere in the window, or pasted on the map, become references. (The chat panel takes a dropped picture for its
  // message itself: it handles the drop first, so it is skipped here. Ctrl+V chooses between a picture and copied map items: clipboard.ts.)
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    let hide = 0;
    const carriesFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const over = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      if (e.defaultPrevented || !store.getState().meta) { setDropping(false); return; }
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
      setDropping(true);
      window.clearTimeout(hide);
      hide = window.setTimeout(() => setDropping(false), 250); // (dragleave fires for every element crossed: this is steadier)
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      setDropping(false);
      if (e.defaultPrevented) return;
      e.preventDefault(); // (never let the window open the file itself)
      void store.addPictures([...(e.dataTransfer?.files ?? [])]);
    };
    const copy = (e: ClipboardEvent) => onCopyEvent(e);
    const paste = (e: ClipboardEvent) => onPasteEvent(e, (files) => void store.addPictures(files));
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("beforecopy", onBeforeCopy);
    window.addEventListener("beforepaste", onBeforePaste);
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    return () => {
      window.clearTimeout(hide);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("beforecopy", onBeforeCopy);
      window.removeEventListener("beforepaste", onBeforePaste);
      window.removeEventListener("copy", copy);
      window.removeEventListener("paste", paste);
    };
  }, []);
  // "Added ... to References" goes away by itself
  useEffect(() => {
    const n = s.pictureNote;
    if (!n || n.busy) return;
    const t = setTimeout(() => store.dismissPictureNote(), 4000);
    return () => clearTimeout(t);
  }, [s.pictureNote]);

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
      if (e.key.toLowerCase() === "u" && !e.altKey && store.getState().features.trace) { traceCtl.toggleShown(); return; } // show or hide the trace picture
      if (store.getState().meta?.kind === "city") {
        const ct = CITY_TOOL_DEFS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (ct) setCui((c) => ({ ...c, tool: ct.id }));
        if (e.key === "[") setCui((c) => ({ ...c, brush: Math.max(1, Math.round(c.brush / 1.25)) }));
        if (e.key === "]") setCui((c) => ({ ...c, brush: Math.min(60, Math.round(c.brush * 1.25 + 1)) }));
        return;
      }
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
      <TopBar
        s={s} onNew={() => setNewOpen(true)} onHelp={() => setHelpOpen(true)} onSettings={desktop ? () => setSettingsOpen(true) : undefined}
        mapOpen={mapOpen} onMap={setMapOpen} claudeOpen={claudeOpen} onClaude={setClaudeOpen} claudeDot={assist.ready}
      />
      {isCity && s.meta && <CityToolBar ui={cui} onUi={onCui} />}
      {isBattle && s.meta && <BattleToolBar ui={bui} onUi={onBui} meta={s.meta} assetsOn={isBattle} onOpenAssets={() => openAssets("terrain")} />}
      {isWorld && (
        <WorldToolBar
          tool={tool} brush={brush} onBrush={setBrush} lineKind={lineKind} onLineKind={setLineKind} lineAuto={lineAuto} onLineAuto={setLineAuto}
          areaShape={areaShape} onAreaShape={setAreaShape} placeType={placeType} onPlaceType={setPlaceType} labelKind={labelKind} onLabelKind={setLabelKind}
        />
      )}
      <div className={`main${desktop && wide ? " wide" : ""}${mapOpen ? "" : " no-map"}${claudeOpen ? "" : " no-claude"}${isBattle && tabNow === "assets" && mapOpen ? " assets-wide" : ""}`}>
        {isCity ? (
          <ToolRail groups={CITY_TOOL_GROUPS} active={cui.tool} onPick={(id) => onCui({ tool: id as CityUi["tool"] })} testId={(id) => `ctool-${id}`} />
        ) : isBattle ? (
          <ToolRail groups={BATTLE_TOOL_GROUPS} active={bui.tool} onPick={(id) => onBui({ tool: id as BattleUi["tool"] })} testId={(id) => `btool-${id}`} />
        ) : (
          <ToolRail groups={TOOL_GROUPS} active={tool} onPick={(id) => setTool(id as Tool)} />
        )}
        {isCity ? (
          <CityView meta={s.meta} features={s.features} ui={cui} onUi={onCui} />
        ) : isBattle ? (
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
        <aside className={`side${mapOpen ? "" : " closed"}`} aria-label="Map panel" data-testid="map-panel">
          {mapOpen && (
            <>
              <div className="tabs" role="tablist" aria-label="Map panel">
                <button role="tab" aria-selected={tabNow === "map"} className={tabNow === "map" ? "on" : ""} onClick={() => setMapTab("map")} data-testid="mp-tab-map">Map</button>
                <button role="tab" aria-selected={tabNow === "history"} className={tabNow === "history" ? "on" : ""} onClick={() => setMapTab("history")} data-testid="mp-tab-history">History</button>
                {isBattle && <button role="tab" aria-selected={tabNow === "assets"} className={tabNow === "assets" ? "on" : ""} onClick={() => setMapTab("assets")} data-testid="tab-assets">Assets</button>}
              </div>
              <div className="side-body">
                {/* (both lists stay in the page, one hidden: a tab keeps what it was showing, and the browser test can show them all) */}
                <div className={tabNow === "map" ? "tab-on" : "tab-off"} data-testid="tab-body-map">
          {isCity && s.meta && (
            <>
              <CityInspector features={s.features} ui={cui} onUi={onCui} />
              <CitySummary meta={s.meta} features={s.features} ui={cui} onUi={onCui} />
            </>
          )}
          {isBattle && s.meta && (
            <>
              <BattleInspector features={s.features} levels={s.levels} chosenAsset={bui.asset} selected={bui.selected} multi={bui.multi} bounds={{ w: s.meta.battle?.squaresX ?? 0, h: s.meta.battle?.squaresY ?? 0 }} onClear={() => onBui({ selected: null, multi: [] })} onSelect={(ids) => onBui(selectionFromIds(ids))} />
              <BattleKey features={s.features} selected={bui.selected} onSelect={(id) => onBui({ selected: id, multi: [], tool: "select" })} />
              <BattleSettings meta={s.meta} features={s.features} ui={bui} onUi={onBui} />
            </>
          )}
          {isWorld && <>
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

                </div>
                <div className={tabNow === "history" ? "tab-on" : "tab-off"} data-testid="tab-body-history">
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

          {s.meta && <References refs={s.refs} worldMap={isWorld} addedAt={s.pictureNote && !s.pictureNote.busy ? s.pictureNote.at : 0} tracing={s.features.trace?.ref} onTrace={(r) => void traceCtl.start(s.meta!, r)} onStopTrace={() => { if (s.features.trace) traceCtl.stop(s.features.trace); }} onMakeTerrain={setSketchRef} onAskClaude={desktop ? onAskPicture : undefined} />}

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
                </div>
                {tabNow === "assets" && isBattle && <AssetPanel meta={s.meta} ui={bui} onUi={onBui} desktop={!!desktop} focus={assetFocus} />}
              </div>
            </>
          )}
        </aside>
        {claudeOpen ? (
          <RightPanel s={s} desktop={!!desktop} assist={assist} wide={wide} onToggleWide={toggleWide} tab={rightTab} onTab={setRightTab} />
        ) : (
          <div className="slot-closed" />
        )}
      </div>
      {newOpen && <NewMapDialog onClose={() => setNewOpen(false)} />}
      {settingsOpen && desktop && <DesktopSettings onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <ShortcutHelp battle={isBattle} city={isCity} onClose={() => setHelpOpen(false)} />}
      {sketchRef && <SketchDialog refInfo={sketchRef} mapHasLand={mapHasLand()} onClose={() => setSketchRef(null)} />}
      <DialogHost />
      {routingId && <div className="toast info" data-testid="routing">Finding the best route over the terrain…</div>}
      {savedFlash && <div className="toast info" data-testid="saved">Saved. Dragon Drop also saves by itself after every change.</div>}
      {making && <div className="toast info" data-testid="making">Making “{making}”… this takes a few seconds.</div>}
      {s.pictureNote && !s.error && <div className="toast info" data-testid="picture-note">{s.pictureNote.text}</div>}
      {dropping && (
        <div className="drop-overlay" data-testid="drop-overlay">
          <div><b>Drop to add to References</b><span>{PICTURE_RULE}. Claude can look at it, and on a world map you can turn a sketch into terrain.</span></div>
        </div>
      )}
      {s.error && (
        <div className="toast" onClick={() => store.dismissError()}>{s.error} <span className="muted">(click to dismiss)</span></div>
      )}
    </div>
  );
}

function TopBar({ s, onNew, onHelp, onSettings, mapOpen, onMap, claudeOpen, onClaude, claudeDot }: {
  s: AppState; onNew: () => void; onHelp: () => void; onSettings?: () => void;
  mapOpen: boolean; onMap: (on: boolean) => void; claudeOpen: boolean; onClaude: (on: boolean) => void; claudeDot: boolean;
}) {
  return (
    <header className="top">
      <Brand />
      <select
        className="project"
        value={s.meta?.id ?? ""}
        onChange={(e) => store.send({ t: "open_project", id: e.target.value })}
        title="Open project"
      >
        {s.projects.map((p) => <option key={p.id} value={p.id}>{p.parent ? `${p.name} (part of ${p.parent.name})` : p.kind === "battle" ? `${p.name} (battlemap)` : p.kind === "city" ? `${p.name} (city)` : p.name}</option>)}
      </select>
      <button className="ghost" onClick={onNew}>+ New map</button>
      <div className="spacer" />
      <button className="ghost" disabled={!s.canUndo} onClick={() => store.send({ t: "undo" })} title="Undo (Ctrl+Z)" data-testid="undo">↶ Undo</button>
      <button className="ghost" disabled={!s.canRedo} onClick={() => store.send({ t: "redo" })} title="Redo (Ctrl+Shift+Z)" data-testid="redo">↷ Redo</button>
      <button className={`ghost toggle${mapOpen ? " on" : ""}`} aria-pressed={mapOpen} onClick={() => onMap(!mapOpen)} title="Show or hide the Map panel: layers, lists, history and assets" data-testid="toggle-map-panel">Map panel</button>
      <button className={`ghost toggle${claudeOpen ? " on" : ""}`} aria-pressed={claudeOpen} onClick={() => onClaude(!claudeOpen)} title="Show or hide the Claude panel" data-testid="toggle-claude-panel">
        Claude{claudeDot && !claudeOpen ? <span className="tab-dot" title="Claude has suggestions for you"> ●</span> : null}
      </button>
      <span className={`conn ${s.connected ? "ok" : "bad"}`} title={s.connected ? "Connected to the map server" : "Reconnecting to the map server…"}>{s.connected ? "Connected" : "Reconnecting…"}</span>
      <button className="ghost" onClick={onHelp} title="Keyboard and mouse controls (?)" data-testid="shortcuts-button">?</button>
      {onSettings && <button className="ghost" onClick={onSettings} title="API key, maps folder, Claude Code connection" data-testid="settings-button">Settings</button>}
    </header>
  );
}

function NewMapDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<"world" | "battle" | "city">("world");
  const [name, setName] = useState("New Map");
  const [cw, setCw] = useState(600);
  const [ch, setCh] = useState(400);
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
  const cityOk = cw >= 50 && ch >= 50 && cw <= 6000 && ch <= 6000;
  const switchKind = (k: "world" | "battle" | "city") => {
    const stock: Record<string, string> = { world: "New Map", battle: "New Battlemap", city: "New City" };
    setName((n) => (Object.values(stock).includes(n) ? stock[k] : n));
    setKind(k);
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="new-map-dialog">
        <h2>{kind === "world" ? "New map" : kind === "city" ? "New city" : "New battlemap"}</h2>
        <div className="seg" role="group" aria-label="Kind of map">
          <button className={kind === "world" ? "on" : ""} onClick={() => switchKind("world")} data-testid="new-kind-world">World map</button>
          <button className={kind === "battle" ? "on" : ""} onClick={() => switchKind("battle")} data-testid="new-kind-battle">Battlemap</button>
          <button className={kind === "city" ? "on" : ""} onClick={() => switchKind("city")} data-testid="new-kind-city">City</button>
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
        ) : kind === "city" ? (
          <>
            <label>Width in metres<input type="number" min={50} max={6000} value={cw} onChange={(e) => setCw(Number(e.target.value))} data-testid="new-cw" /></label>
            <label>Height in metres<input type="number" min={50} max={6000} value={ch} onChange={(e) => setCh(Number(e.target.value))} data-testid="new-ch" /></label>
            <p className="muted">
              {cityOk ? <>A city seen from above, made of buildings and streets on a ground. A village is about 300 × 200 m, a walled town 1,000 × 700, a big city 3,000 × 2,000.</>
                : <>Between 50 and 6,000 metres each way.</>}
            </p>
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
            className="primary" data-testid="new-create" disabled={(kind === "battle" && !battleOk) || (kind === "city" && !cityOk)}
            onClick={() => {
              if (kind === "city") {
                store.send({ t: "create_city", name: name.trim() || "New City", widthM: cw, heightM: ch });
              } else if (kind === "battle") {
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
