/**
 * A brush size control for every brush (the person, 2026-11-26: the sliders were "finnicky and hard to actually dial in"): a slider that is logarithmic, so
 * small sizes get as much of its travel as large ones (1 to 10 px is as long as 30 to 300); a box beside it to type the exact size; the arrow keys on the
 * slider change it by one step (Shift: about a tenth); and [ and ] still change the active brush (App's key handler).
 * `value` is the brush's own number (a radius, in map px, squares or metres); `show` and `unshow` turn it into what the person reads and types (a width,
 * feet) and back.
 */
import { useEffect, useState } from "react";

const TRAVEL = 1000;

export interface BrushSizeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** The smallest change, in the brush's own units (1 px; 0.25 squares). */
  step?: number;
  onChange: (v: number) => void;
  /** What is shown and typed (default: the value itself), and back. */
  show?: (v: number) => number;
  unshow?: (n: number) => number;
  /** After the number: "px across", "squares", "ft". */
  unit: string;
  testId?: string;
  title?: string;
}

/** Where a value sits on the slider (0..TRAVEL), on a log scale. */
export const sliderPos = (v: number, min: number, max: number) => Math.round((TRAVEL * Math.log(Math.max(min, Math.min(max, v)) / min)) / Math.log(max / min));
/** The value at a slider position, snapped to `step`. */
export const sliderValue = (pos: number, min: number, max: number, step: number) => snap(min * Math.pow(max / min, pos / TRAVEL), min, max, step);
/** A value held to min..max and rounded to `step`. */
export function snap(v: number, min: number, max: number, step: number): number {
  const s = Math.round(Math.max(min, Math.min(max, v)) / step) * step;
  return +Math.max(min, Math.min(max, s)).toFixed(4);
}
/** The next size up or down: one step, or with `big` about a tenth (at least one step). */
export const nudge = (v: number, dir: 1 | -1, min: number, max: number, step: number, big = false) => snap(v + dir * (big ? Math.max(step, v * 0.1) : step), min, max, step);

const fmt = (n: number) => String(+n.toFixed(2));

export function BrushSize({ label, value, min, max, step = 1, onChange, show = (v) => v, unshow = (n) => n, unit, testId, title }: BrushSizeProps) {
  const [text, setText] = useState(fmt(show(value)));
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setText(fmt(show(value))); }, [value, typing, show]);
  const commit = () => {
    setTyping(false);
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) { setText(fmt(show(value))); return; }
    const v = snap(unshow(n), min, max, step);
    setText(fmt(show(v)));
    if (v !== value) onChange(v);
  };
  return (
    <span className="brush-size" title={title}>
      <span className="brush-size-label">{label}</span>
      <input type="range" min={0} max={TRAVEL} step={1} value={sliderPos(value, min, max)} aria-label={label} data-testid={testId}
        onChange={(e) => { const v = sliderValue(Number(e.target.value), min, max, step); if (v !== value) onChange(v); }}
        onKeyDown={(e) => {
          // (one step at a time: on a log slider the browser's own arrow step would round back to the same size at small sizes)
          const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          const v = nudge(value, dir, min, max, step, e.shiftKey);
          if (v !== value) onChange(v);
        }} />
      <input type="number" className="brush-size-box" min={fmt(show(min))} max={fmt(show(max))} step="any" value={text} aria-label={`${label} (${unit})`}
        data-testid={testId ? `${testId}-box` : undefined}
        onChange={(e) => { setTyping(true); setText(e.target.value); }} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { setTyping(false); setText(fmt(show(value))); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); setTyping(false); const v = nudge(value, e.key === "ArrowUp" ? 1 : -1, min, max, step, e.shiftKey); if (v !== value) onChange(v); }
        }} />
      <span className="brush-size-unit">{unit}</span>
    </span>
  );
}

/** A brush kept as a radius and shown as its width, and back. */
export const across = (r: number) => r * 2;
export const half = (n: number) => n / 2;
