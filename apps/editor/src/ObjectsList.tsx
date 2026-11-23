/**
 * The Map panel's Objects tab on a city map or a battlemap: everything on the map by kind (named things first), with a filter. A click selects the thing and brings it into
 * view (focusBus). A city can hold thousands of buildings, so each kind lists at most LIST_CAP rows; the filter finds the rest.
 */
import { useState } from "react";
import { type Features, type MapWall, STREET_KINDS, WALL_KINDS, assetLabel, districtColour, pointsBounds, polygonArea , PATH_LOOK_NAMES } from "@mapmaker/core";
import { type FocusBox, focusBus } from "./focusBus.ts";
import { landName } from "./cityUi.ts";

type Pt = [number, number];
interface Row { id: string; name: string; what: string; box: FocusBox; swatch?: string }
interface Group { title: string; rows: Row[]; note?: string }

/** The most rows one kind lists (the filter reaches the others). */
export const LIST_CAP = 150;

const boxOf = (pts: readonly (readonly number[])[], pad = 0): FocusBox => { const b = pointsBounds(pts as Pt[]); return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }; };
const around = (x: number, y: number, r: number): FocusBox => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
const length = (pts: readonly (readonly number[])[], closed = false) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : s), 0) + (closed && pts.length > 2 ? Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) : 0);
const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);

/** The groups of a city map's things. */
function cityGroups(f: Features): Group[] {
  const streetKind = (k?: string) => STREET_KINDS.find((x) => x.id === k)?.name ?? "Street";
  const buildings = (f.buildings ?? []).map((b) => ({ id: b.id, name: b.name ?? "", what: `${b.kind ?? "building"} · ${Math.round(polygonArea(b.points as Pt[]))} m²`, box: boxOf(b.points, 4) }));
  return [
    { title: "Districts", rows: (f.districts ?? []).map((d) => ({ id: d.id, name: d.name ?? "District", what: `${Math.round(polygonArea(d.points) / 100) / 100} ha`, box: boxOf(d.points), swatch: districtColour(d) })).sort(byName) },
    { title: "Names", rows: (f.labels ?? []).map((l) => ({ id: l.id, name: l.text, what: l.kind === "region" ? "district" : l.kind === "sea" ? "water" : "landmark", box: around(l.x, l.y, 30) })).sort(byName) },
    { title: "Walls", rows: (f.cityWalls ?? []).map((w) => ({ id: w.id, name: w.name ?? (WALL_KINDS.find((k) => k.id === (w.kind ?? "stone"))?.name ?? "Wall"), what: `${Math.round(length(w.points, w.closed))} m`, box: boxOf(w.points, 5) })) },
    { title: "Streets", rows: (f.streets ?? []).map((s) => ({ id: s.id, name: s.name ?? "", what: `${streetKind(s.kind).toLowerCase()} · ${Math.round(length(s.points))} m`, box: boxOf(s.points, s.width) })) },
    { title: "Buildings", rows: buildings },
    { title: "Trees", rows: (f.trees ?? []).map((t) => ({ id: t.id, name: t.name ?? "", what: t.kind === "tree" ? "a tree" : t.kind, box: boxOf(t.points, (t.size ?? 8) / 2 + 2) })) },
    { title: "Land", rows: (f.land ?? []).map((l) => ({ id: l.id, name: l.name ?? "", what: `${landName(l).toLowerCase()} · ${l.height > 0 ? "+" : ""}${l.height} m`, box: l.kind === "hill" ? around(l.points[0][0], l.points[0][1], l.radius) : boxOf(l.points, Math.min(60, l.radius)) })) },
  ];
}

/** The groups of a battlemap level's things (its walls are counted, not listed: they come in many pieces). */
function battleGroups(f: Features): Group[] {
  const walls = (f.walls ?? []) as MapWall[];
  const doors = walls.filter((w) => w.kind !== "wall");
  const doorName: Record<string, string> = { door: "Door", secret: "Secret door", window: "Window", invisible: "Invisible wall" };
  const plain = walls.length - doors.length;
  return [
    { title: "Room notes", rows: [...(f.notes ?? [])].sort((a, b) => a.n - b.n).map((n) => ({ id: n.id, name: `${n.n}. ${n.title || "Untitled"}`, what: "note", box: around(n.x, n.y, 3) })) },
    { title: "Objects", rows: (f.props ?? []).map((p) => ({ id: p.id, name: assetLabel(p.asset), what: `object${p.layer === "below" ? " (under the walls)" : ""}`, box: around(p.x, p.y, 2 * (p.scale ?? 1)) })).sort(byName) },
    { title: "Lights", rows: (f.lights ?? []).map((l, i) => ({ id: l.id, name: `Light ${i + 1}`, what: `reaches ${Math.round(l.radius)} squares`, box: around(l.x, l.y, Math.max(2, Math.min(8, l.radius))) })) },
    { title: "Doors and windows", rows: doors.map((w, i) => ({ id: w.id, name: `${doorName[w.kind] ?? w.kind} ${i + 1}`, what: w.open ? "open" : w.locked ? "locked" : "", box: boxOf(w.points, 2) })) },
    { title: "Stairs, ladders and holes", rows: (f.connectors ?? []).map((c) => ({ id: c.id, name: c.name ?? c.kind.charAt(0).toUpperCase() + c.kind.slice(1), what: `leads ${c.to ?? (c.kind === "hole" ? "down" : "")}`.trim(), box: { x0: c.x - 1, y0: c.y - 1, x1: c.x + c.w + 1, y1: c.y + c.h + 1 } })) },
    { title: "Roofs", rows: (f.roofs ?? []).map((r) => ({ id: r.id, name: r.name ?? "Roof", what: r.style, box: boxOf(r.points, 1) })) },
    { title: "Paths", rows: (f.paths ?? []).map((r, i) => ({ id: r.id, name: r.name ?? `Path ${i + 1}`, what: r.asset ? assetLabel(r.asset) : PATH_LOOK_NAMES[r.look ?? "dirt"], box: boxOf(r.points, Math.max(1, r.width ?? 1)) })) },
    { title: "Shaded areas", rows: (f.zones ?? []).map((z) => ({ id: z.id, name: z.name ?? "Shaded area", what: "light zone", box: boxOf(z.points, 1) })) },
  ].map((g) => (g.title === "Doors and windows" && plain ? { ...g, note: `and ${plain.toLocaleString()} wall piece${plain === 1 ? "" : "s"} (select them on the map)` } : g));
}

/** The list: a filter, then each kind with what it holds (named things first). */
export function ObjectsList({ kind, features, selected, onPick }: { kind: "city" | "battle"; features: Features; selected: readonly string[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = (kind === "city" ? cityGroups(features) : battleGroups(features)).map((g) => {
    const rows = words.length ? g.rows.filter((r) => words.every((w) => `${r.name} ${r.what} ${g.title}`.toLowerCase().includes(w))) : g.rows;
    // named first, by name; then the rest in the map's own order
    const named = rows.filter((r) => r.name).sort(byName), unnamed = rows.filter((r) => !r.name);
    return { ...g, rows: [...named, ...unnamed], total: rows.length };
  });
  const pick = (r: Row) => { onPick(r.id); focusBus.show(r.box); };
  return (
    <section className="objects" data-testid="objects-list">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or kind…" aria-label="Find on the map" data-testid="objects-filter" />
      {groups.every((g) => !g.total && !g.note) && <p className="muted">{words.length ? "Nothing matches." : "Nothing on this map yet."}</p>}
      {groups.map((g) => (g.total || g.note) ? (
        <details key={g.title} open={g.total <= 30 || !!words.length}>
          <summary><b>{g.title}</b> <span className="muted">{g.total.toLocaleString()}</span></summary>
          {g.rows.slice(0, LIST_CAP).map((r) => (
            <button key={r.id} className={`place-row${selected.includes(r.id) ? " on" : ""}`} onClick={() => pick(r)} title="Select it and show it on the map" data-testid="object-row">
              <span>{r.swatch && <i className="obj-swatch" style={{ background: r.swatch }} />}{r.name || <span className="muted">{g.title === "Buildings" ? "Building" : g.title === "Streets" ? "Street" : g.title === "Trees" ? "Trees" : "Unnamed"}</span>}</span>
              <span className="muted">{r.what}</span>
            </button>
          ))}
          {g.total > LIST_CAP && <p className="muted">and {(g.total - LIST_CAP).toLocaleString()} more: type in the box above to find one.</p>}
          {g.note && <p className="muted">{g.note}</p>}
        </details>
      ) : null)}
    </section>
  );
}
