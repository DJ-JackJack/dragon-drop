/**
 * The bottom bar under every kind of map: whether the map is saved, what is under the pointer (or the map's size), a few quick switches for what the map shows, the zoom with
 * smaller and bigger, Fit, and the map's Export. Each view (MapView, Battle, CityView) gives it its own readout, switches and buttons; the save state comes from the store
 * (the server says when the map is on disk, after Ctrl+S or an autosave).
 */
import { type ReactNode, useSyncExternalStore } from "react";
import { store } from "./store.ts";

export interface BarSwitch { label: string; on: boolean; onToggle: () => void; title?: string; testId?: string }

/** Saved, saving or not saved, in a few words. */
function SaveState() {
  const s = useSyncExternalStore(store.subscribe, store.getState);
  if (!s.meta) return null;
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [cls, text, title] = !s.connected ? ["bad", "Not connected", "The editor has lost the server; it keeps trying to reconnect"]
    : s.saveFailed ? ["bad", "Not saved: retrying", "The last save didn't work (is the disk full or read-only?). Your changes are still open and it keeps trying"]
    : s.changedAt > s.storedAt ? ["busy", "Saving…", "Changes are saved a moment after you make them"]
    : ["ok", s.storedAt ? `Saved ${time(s.storedAt)}` : "Saved", "Everything is on disk. Ctrl+S saves straight away"];
  return <span className={`sb-save ${cls}`} title={title} data-testid="save-state"><i aria-hidden="true" />{text}</span>;
}

export function StatusBar({ info, infoTestId, zoom, zoomTitle, onZoom, onFit, switches = [], children }: {
  /** What is under the pointer, or the map's size. */
  info: ReactNode;
  infoTestId?: string;
  /** The zoom in percent (null before the map is drawn). */
  zoom: number | null;
  zoomTitle: string;
  onZoom: (dir: 1 | -1) => void;
  onFit: () => void;
  switches?: BarSwitch[];
  /** More buttons (Export). */
  children?: ReactNode;
}) {
  return (
    <div className="statusbar" data-testid="status-bar">
      <SaveState />
      <span className="sb-info" data-testid={infoTestId}>{info}</span>
      <span className="sb-right">
        {switches.map((w) => (
          <button key={w.label} className={`sb-switch${w.on ? " on" : ""}`} aria-pressed={w.on} onClick={w.onToggle} title={w.title} data-testid={w.testId}>{w.label}</button>
        ))}
        {children}
        <span className="sb-zoom" role="group" aria-label="Zoom">
          <button onClick={() => onZoom(-1)} aria-label="Zoom out" title="Zoom out (-)">−</button>
          <span className="sb-pct" title={zoomTitle} data-testid="zoom-level">{zoom === null ? "–" : `${zoom}%`}</span>
          <button onClick={() => onZoom(1)} aria-label="Zoom in" title="Zoom in (+)">+</button>
        </span>
        <button onClick={onFit} title="Fit the whole map in the window (0)">⤢ Fit</button>
      </span>
    </div>
  );
}

/** A zoom in percent worth showing: whole numbers, fewer digits when big. */
export function zoomPercent(p: number): number {
  return p >= 100 ? Math.round(p / 5) * 5 : p >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
}
