/**
 * GM-only things: a place, label, road or border, battlemap object or light, or a settlement building's name the DM marks as for their eyes only
 * (`gmOnly`). The editor shows them faintly; exports and pictures for players leave them out (`playerView`), and the DM's own copy keeps them.
 */
import type { Features } from "./features.ts";

/** Whether the features hold anything GM-only. */
export function hasGmOnly(f: Features | null | undefined): boolean {
  if (!f) return false;
  return f.places.some((p) => p.gmOnly) || f.labels.some((l) => l.gmOnly) || !!f.lines?.some((l) => l.gmOnly) || !!f.props?.some((p) => p.gmOnly)
    || !!f.lights?.some((l) => l.gmOnly) || !!f.buildings?.some((b) => b.gmOnly && b.name);
}

/** The features players may see: GM-only places, labels, roads, objects and lights left out, and GM-only buildings without their names. */
export function playerView(f: Features): Features {
  if (!hasGmOnly(f)) return f;
  return {
    ...f,
    places: f.places.filter((p) => !p.gmOnly),
    labels: f.labels.filter((l) => !l.gmOnly),
    ...(f.lines && { lines: f.lines.filter((l) => !l.gmOnly) }),
    ...(f.props && { props: f.props.filter((p) => !p.gmOnly) }),
    ...(f.lights && { lights: f.lights.filter((l) => !l.gmOnly) }),
    ...(f.buildings && { buildings: f.buildings.map((b) => (b.gmOnly && b.name ? (({ name: _n, ...rest }) => rest)(b) : b)) }),
  };
}
