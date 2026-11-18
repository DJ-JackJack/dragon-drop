/** The picker for what a place is: a grid of small pictures, grouped, drawn with the same code as the markers on the map. */
import { useEffect, useRef } from "react";
import { PLACE_GROUPS, PLACE_KINDS, type PlaceType, placeKind } from "@mapmaker/core";
import { drawPlaceMarker } from "./drawFeatures.ts";

/** One marker, drawn small on a parchment chip. */
export function PlaceGlyph({ type, size = 30 }: { type: PlaceType; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    drawPlaceMarker(g, type, size / 2, size / 2, size * (placeKind(type).picture ? 0.36 : 0.3));
  }, [type, size]);
  return <canvas ref={ref} className="place-glyph" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function PlaceKindPicker({ value, onChange, testidPrefix = "place-kind" }: { value: PlaceType; onChange: (t: PlaceType) => void; testidPrefix?: string }) {
  return (
    <div className="kind-picker" role="radiogroup" aria-label="What the place is">
      {PLACE_GROUPS.map((group) => {
        const kinds = PLACE_KINDS.filter((k) => k.group === group);
        if (!kinds.length) return null;
        return (
          <div key={group}>
            <div className="kind-group">{group}</div>
            <div className="kind-grid">
              {kinds.map((k) => (
                <button
                  key={k.id} type="button" role="radio" aria-checked={k.id === value} aria-label={k.name}
                  className={`kind-btn${k.id === value ? " on" : ""}`} title={`${k.name}: ${k.hint}`} data-testid={`${testidPrefix}-${k.id}`}
                  onClick={() => onChange(k.id)}
                >
                  <PlaceGlyph type={k.id} />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
