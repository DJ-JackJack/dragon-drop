/**
 * A start for a settlement's land (the Land and climate section, the New settlement box, Claude's create_city `land`): a few landforms of a kind of country, so a new
 * settlement needn't begin dead flat. Only shapes (`features.land`: cityLand.ts adds them up), seeded so the same seed gives the same land, and each one an ordinary
 * landform the DM can then move, change or remove with the Land tool. Nothing here is named: a hill's name is the DM's.
 */
import type { CitySpec } from "./city.ts";
import type { MapLandform } from "./features.ts";
import { seededRandom } from "./scatter.ts";

type Pt = [number, number];

export const LAND_STARTS = [
  { id: "flat", name: "Flat", hint: "Level ground, with no hills, valleys or slopes." },
  { id: "gentle", name: "Gentle slope", hint: "The whole settlement rises a little one way, as most towns do." },
  { id: "rolling", name: "Rolling hills", hint: "A gentle slope with a few low hills." },
  { id: "hilltop", name: "Hilltop", hint: "One broad hill in the middle, for a castle or a temple on top." },
  { id: "valley", name: "Valley", hint: "A valley across the settlement, where a river would run (paint its water with the Ground tool), rising on both sides." },
  { id: "rugged", name: "Rugged", hint: "A ridge, hills and a hollow: hard country to build on." },
] as const;
export type LandStart = (typeof LAND_STARTS)[number]["id"];
export const LAND_START_IDS = LAND_STARTS.map((s) => s.id) as [LandStart, ...LandStart[]];
export const isLandStart = (v: unknown): v is LandStart => typeof v === "string" && (LAND_START_IDS as string[]).includes(v);

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** The landforms for a start (none for "flat"). Heights grow a little with the settlement's size: a big city's hills are bigger than a hamlet's. */
export function startLand(spec: Pick<CitySpec, "widthM" | "heightM">, style: LandStart, seed: number): MapLandform[] {
  const rnd = seededRandom((seed >>> 0) || 1);
  const W = spec.widthM, H = spec.heightM, S = Math.min(W, H);
  const k = clamp(S / 600, 0.6, 2.5); // (metres of height for a settlement of this size)
  const between = (a: number, b: number) => a + (b - a) * rnd();
  const inside = (x: number, y: number): Pt => [r2(clamp(x, 0, W)), r2(clamp(y, 0, H))];
  const tag = (seed >>> 0).toString(36);
  let n = 0;
  const id = (kind: string) => `h-${kind}-${tag}-${n++}`;
  const out: MapLandform[] = [];

  /** The whole map rising `rise` metres in a direction (radians). */
  const slope = (rise: number, dir = rnd() * Math.PI * 2) => {
    const dx = Math.cos(dir), dy = Math.sin(dir), e = Math.abs(W * dx) + Math.abs(H * dy);
    out.push({ id: id("slope"), kind: "slope", points: [inside(W / 2 - (dx * e) / 2, H / 2 - (dy * e) / 2), inside(W / 2 + (dx * e) / 2, H / 2 + (dy * e) / 2)], height: r2(rise), radius: 0 });
  };
  /** Hills kept apart from each other and from `avoid` (points with a radius). */
  const hills = (count: number, rad: [number, number], high: [number, number], avoid: { at: Pt; r: number }[] = []) => {
    const placed = [...avoid];
    for (let i = 0, tries = 0; i < count && tries < count * 40; tries++) {
      const r = between(rad[0], rad[1]) * S, at = inside(between(0.12, 0.88) * W, between(0.12, 0.88) * H);
      if (placed.some((p) => Math.hypot(p.at[0] - at[0], p.at[1] - at[1]) < 0.8 * (p.r + r))) continue;
      placed.push({ at, r });
      out.push({ id: id("hill"), kind: "hill", points: [at], height: r2(between(high[0], high[1]) * k), radius: r2(r) });
      i++;
    }
  };
  /** A line across the map (along its longer side unless `across`), wandering a little, as points. */
  const line = (wander: number, across = false): Pt[] => {
    const alongX = across ? W < H : W >= H, pts: Pt[] = [], steps = 5, off = between(0.35, 0.65);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, side = off + (rnd() - 0.5) * wander;
      pts.push(alongX ? inside(t * W, side * H) : inside(side * W, t * H));
    }
    return pts;
  };

  switch (style) {
    case "flat":
      break;
    case "gentle":
      slope(between(6, 14) * k);
      break;
    case "rolling":
      slope(between(4, 9) * k);
      hills(3 + Math.floor(rnd() * 3), [0.12, 0.22], [5, 14]);
      break;
    case "hilltop": {
      const at = inside(W / 2 + (rnd() - 0.5) * 0.16 * W, H / 2 + (rnd() - 0.5) * 0.16 * H);
      out.push({ id: id("hill"), kind: "hill", points: [at], height: r2(between(18, 32) * k), radius: r2(between(0.3, 0.4) * S) });
      slope(between(2, 5) * k);
      break;
    }
    case "valley": {
      const floor = line(0.18);
      out.push({ id: id("valley"), kind: "ridge", points: floor, height: -r2(between(8, 16) * k), radius: r2(between(0.22, 0.3) * S) });
      // (the valley falls one way along its floor, as a river runs)
      const [a, b] = [floor[0], floor[floor.length - 1]];
      slope(between(2, 6) * k, Math.atan2(b[1] - a[1], b[0] - a[0]) + (rnd() < 0.5 ? Math.PI : 0));
      break;
    }
    case "rugged": {
      const crest = line(0.3, rnd() < 0.5);
      out.push({ id: id("ridge"), kind: "ridge", points: crest, height: r2(between(15, 30) * k), radius: r2(between(0.12, 0.18) * S) });
      slope(between(5, 12) * k);
      hills(2 + Math.floor(rnd() * 2), [0.1, 0.18], [8, 20], crest.map((at) => ({ at, r: 0.15 * S })));
      // a hollow: a sunken plateau, a rough ring of corners
      const c = inside(between(0.2, 0.8) * W, between(0.2, 0.8) * H), rr = between(0.08, 0.13) * S, ring: Pt[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, q = rr * between(0.75, 1.2);
        ring.push(inside(c[0] + Math.cos(a) * q, c[1] + Math.sin(a) * q));
      }
      out.push({ id: id("hollow"), kind: "plateau", points: ring, height: -r2(between(5, 10) * k), radius: r2(0.06 * S) });
      break;
    }
  }
  return out;
}
