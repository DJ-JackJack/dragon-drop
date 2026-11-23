/**
 * Districts on a city map (`features.districts`): an outline in metres with a name and a colour, drawn as a faint tint with a dashed border, its name in big spaced capitals
 * at its middle (the editor, the export and Claude's previews). A district is the DM's: its name is canon (only names they gave or confirmed).
 */
import type { CitySpec } from "./city.ts";
import type { MapDistrict } from "./features.ts";
import { pointInPolygon } from "./geom.ts";
import { polygonCentroid } from "./regions.ts";

type Pt = [number, number];

/** The colours a district gets when none is chosen (soft, and told apart from the ground, the roofs and the water). */
export const DISTRICT_COLOURS = ["#c0504d", "#4f81bd", "#9bbb59", "#8064a2", "#f79646", "#2e9c9c", "#d4a017", "#b05f9a"] as const;

const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** A district's colour: its own, or one of DISTRICT_COLOURS picked by its id (the same every time). */
export function districtColour(d: Pick<MapDistrict, "id" | "colour">): string {
  return d.colour ?? DISTRICT_COLOURS[hash32(d.id) % DISTRICT_COLOURS.length];
}

/** Where a district's name goes: its middle, or (for a district shaped like a crescent, whose middle is outside it) the point inside it furthest from its edge. */
export function districtCentre(points: readonly (readonly number[])[]): Pt {
  const poly = points as Pt[], c = polygonCentroid(poly);
  if (pointInPolygon(c[0], c[1], poly)) return c;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  let best: Pt = poly[0], bestD = -1;
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
    const x = x0 + ((x1 - x0) * i) / 16, y = y0 + ((y1 - y0) * j) / 16;
    if (!pointInPolygon(x, y, poly)) continue;
    let d = Infinity;
    for (let k = 0; k < poly.length; k++) {
      const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % poly.length], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      d = Math.min(d, Math.hypot(ax + t * dx - x, ay + t * dy - y));
    }
    if (d > bestD) { bestD = d; best = [x, y]; }
  }
  return best;
}

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A district from outside (a message or a tool), checked and tidied; an error message when it can't be one of this city. */
export function cleanDistrict(raw: unknown, spec: CitySpec): MapDistrict | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "not a district" };
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_OK.test(o.id)) return { error: "a district needs an id" };
  if (!Array.isArray(o.points) || o.points.length < 3) return { error: `district ${o.id} needs at least 3 points` };
  if (o.points.length > 400) return { error: `district ${o.id} has more than 400 points` };
  const points: Pt[] = [];
  for (const q of o.points) {
    if (!Array.isArray(q) || q.length !== 2 || !finite(q[0]) || !finite(q[1])) return { error: `district ${o.id} has a point that isn't two numbers` };
    points.push([r2(Math.min(spec.widthM, Math.max(0, q[0]))), r2(Math.min(spec.heightM, Math.max(0, q[1])))]);
  }
  const out: MapDistrict = { id: o.id, points };
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
  if (typeof o.colour === "string" && /^#?[0-9a-f]{6}$/i.test(o.colour)) out.colour = `#${o.colour.replace("#", "").toLowerCase()}`;
  return out;
}
