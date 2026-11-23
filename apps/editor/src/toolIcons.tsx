/** One small line picture for each tool, in the tool rail. All are drawn in a 24 x 24 box with the current text colour. */
import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  // moving about
  pan: <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
  select: <path d="M5 3l14 7-6 2-2 6z" />,
  area: <rect x="4" y="4" width="16" height="16" strokeDasharray="3 3" />,
  measure: <><path d="M3 17L17 3l4 4L7 21z" /><path d="M7 13l2 2M10 10l2 2M13 7l2 2" /></>,
  // world terrain
  raise: <><path d="M3 19c4-9 14-9 18 0" /><path d="M12 3v7M9 6l3-3 3 3" /></>,
  lower: <><path d="M3 5c4 9 14 9 18 0" /><path d="M12 21v-7M9 18l3 3 3-3" /></>,
  smooth: <path d="M3 12c3-5 6-5 9 0s6 5 9 0" />,
  flatten: <path d="M4 7h16M4 12h16M4 17h16" />,
  land: <><path d="M3 17h18" /><path d="M6 17c1-6 5-8 8-6 3-1 4 3 4 6" /></>,
  water: <path d="M12 4c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" />,
  // names and areas
  place: <><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  label: <path d="M5 6h14M12 6v13M9 19h6" />,
  line: <path d="M4 20c2-8 6-4 8-8s4-6 8-8" />,
  river: <><path d="M5 3c3 3-2 6 1 9s-1 6 2 9" /><path d="M14 3c1 3 4 4 3 8s2 6 2 10" /></>,
  region: <path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0 1 9z" />,
  detail: <><rect x="3" y="3" width="12" height="12" /><circle cx="16" cy="16" r="4" /><path d="M19 19l3 3" /></>,
  battlehere: <><rect x="4" y="4" width="16" height="16" /><path d="M4 12h16M12 4v16" /></>,
  cityhere: <><path d="M3 20V11l4-3 4 3v9M11 20v-6l5-4 5 4v6M3 20h18" /><path d="M6 15h2M15 16h2" /></>,
  // battlemaps
  brush: <path d="M4 20c0-3 2-4 4-4l9-9a2.5 2.5 0 0 1 3 3l-9 9c0 2-2 4-7 4z" />,
  room: <><rect x="4" y="5" width="16" height="14" /><path d="M9 10h6v4H9z" /></>,
  wall: <path d="M3 7h18M3 12h18M3 17h18M9 7v5M15 12v5" />,
  door: <><path d="M6 21V4h12v17M3 21h18" /><circle cx="15" cy="13" r=".8" /></>,
  secret: <path d="M6 21V4h12v17M3 21h18" strokeDasharray="3 2" />,
  window: <><rect x="5" y="5" width="14" height="14" /><path d="M12 5v14M5 12h14" /></>,
  invisible: <><path d="M5 19L19 5" strokeDasharray="2 3" /><path d="M4 8v8M20 8v8" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  zone: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" /></>,
  note: <><path d="M5 4h14v12l-5 4H5z" /><path d="M14 20v-4h5" /></>,
  prop: <><path d="M12 3l8 4v10l-8 4-8-4V7z" /><path d="M12 12l8-5M12 12v9M12 12L4 7" /></>,
  // a banner on a pole: a realm
  realm: <><path d="M5 21V3" /><path d="M5 4h12l-3 4 3 4H5" /></>,
  // an eye: what the players see
  reveal: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  // a room plan in a dashed frame: a saved piece to place again
  prefab: <><rect x="3" y="3" width="18" height="18" strokeDasharray="3 2" /><path d="M7 7h10v10H7zM12 17v-3" /></>,
  roof: <path d="M3 13l9-8 9 8M6 11v9h12v-9" />,
  path: <path d="M5 21c1-6 5-7 6-11s0-6 2-7M13 21c0-4 3-5 4-9s1-5 2-8" />,
  stairs: <path d="M4 20h5v-4h5v-4h5V8" />,
  ladder: <path d="M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8" />,
  hole: <><ellipse cx="12" cy="9" rx="8" ry="4" /><path d="M4 9v6c0 2.2 3.6 4 8 4s8-1.8 8-4V9" /></>,
  // city maps
  building: <><rect x="5" y="4" width="14" height="16" /><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20v-4h4v4" /></>,
  outline: <path d="M5 9l7-5 7 5-2 10H7z" />,
  street: <path d="M9 21L11 3M15 21l-2-18" />,
  citylabel: <path d="M5 6h14M12 6v13M9 19h6" />,
  district: <><path d="M4 6l7-3 9 4-2 12-8 2-6-5z" strokeDasharray="3 2" /><path d="M9 12h6" /></>,
  citybattle: <><rect x="4" y="4" width="16" height="16" /><path d="M4 12h16M12 4v16" /></>,
  citywall: <path d="M2 20V12h3v2h2v-2h3v2h2v-2h3v8M15 20V7h2v2h2V7h2v13M2 20h20" />,
  hills: <><path d="M2 18c3-7 6-9 9-4 2-5 6-6 11 4" /><path d="M6 18c1.5-2.5 3-3 4.5-1.5" /></>,
  trees: <><circle cx="9" cy="9" r="5" /><circle cx="16.5" cy="12" r="4" /><path d="M9 14v6M16.5 16v4" /></>,
  ground: <><path d="M5 12l7-7 7 7-6 6a2 2 0 0 1-3 0z" /><path d="M19 17c1 1.5 1.5 2.5 1.5 3.5a1.5 1.5 0 0 1-3 0c0-1 .8-2 1.5-3.5z" /></>,
};

export function ToolIcon({ id }: { id: string }) {
  return <svg className="ticon" viewBox="0 0 24 24" aria-hidden="true">{P[id] ?? <circle cx="12" cy="12" r="6" />}</svg>;
}
