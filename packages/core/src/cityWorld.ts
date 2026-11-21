/**
 * A city started from a spot on a world map (the "City here" tool, Claude's create_city_here): the world map's climate and height above the sea at that spot, the lie of the
 * land (its slope), and, where the world map has them, the coast on the sea side and a river with its valley running through, and woods in wooded country. A world-map pixel is a
 * kilometre or more, so this is a rough start that says what it guessed; the DM and Claude then shape it. Nothing here is lore: names stay the DM's (the city takes the name
 * of the place clicked, which is theirs).
 */
import type { MapDoc } from "./doc.ts";
import type { WorldSample } from "./battleTerrain.ts";
import { type CitySpec, citySpec, cityCells } from "./city.ts";
import { CITY_CLIMATES, cleanClimate, cleanLandform, cleanTrees, climatePreset } from "./cityLand.ts";
import type { MapLandform, MapTrees } from "./features.ts";
import { distToPolyline } from "./geom.ts";

type Pt = [number, number];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const M = { grass: 5, sand: 6, shallow: 7, deep: 8 };

/** A city's size (metres) for the kind of place it is made from on the world map. */
export function citySizeForPlace(kind: string | undefined): { widthM: number; heightM: number } {
  switch (kind) {
    case "capital": return { widthM: 3000, heightM: 2000 };
    case "city": return { widthM: 2000, heightM: 1400 };
    case "village": return { widthM: 450, heightM: 320 };
    case "hamlet": case "farm": case "inn": case "mill": case "crossroads": case "camp": return { widthM: 250, heightM: 180 };
    case "fort": case "castle": case "tower": case "temple": case "lighthouse": return { widthM: 600, heightM: 420 };
    default: return { widthM: 1000, heightM: 700 };
  }
}

/** A compass word for a direction on the map (y runs down: north is up). */
export function compass(dx: number, dy: number): string {
  const a = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(a / 45) % 8];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A point kept inside the city. */
const inside = (spec: CitySpec, [x, y]: Pt): Pt => [Math.round(clamp(x, 0, spec.widthM) * 100) / 100, Math.round(clamp(y, 0, spec.heightM) * 100) / 100];

/**
 * Start a new city (made with createCityDoc) from a world-map sample: its climate and elevation, a slope as the world's ground rises, the sea and a beach on the coast's side, a
 * meandering river with its valley, woods in wooded country and a hill or two in hilly country. Returns what it did, in words for the DM. `kmPerPx` is the world map's scale.
 */
export function cityFromWorld(doc: MapDoc, s: WorldSample, o: { kmPerPx: number; seed: number }): string[] {
  const spec = citySpec(doc), W = spec.widthM, H = spec.heightM, cx = W / 2, cy = H / 2, r = rng(o.seed);
  const said: string[] = [];
  const climate = cleanClimate({ temperature: clamp(s.temp, 0, 1), moisture: clamp(s.moist, 0, 1) });
  if (!("error" in climate)) {
    spec.climate = climate;
    const p = climatePreset(climate);
    said.push(`climate from the world map: ${p ? CITY_CLIMATES.find((c) => c.id === p)!.name.toLowerCase() : "its own"} (temperature ${climate.temperature.toFixed(2)}, moisture ${climate.moisture.toFixed(2)})`);
  }
  spec.elevation = Math.max(0, Math.round(s.elevM));
  said.push(`${spec.elevation} m above the sea`);
  const land: MapLandform[] = [], trees: MapTrees[] = [];
  const addLand = (l: Record<string, unknown>) => { const c = cleanLandform(l, spec); if (!("error" in c)) land.push(c); };
  const extentAlong = (dx: number, dy: number) => Math.abs(dx) * W + Math.abs(dy) * H;
  // the slope of the world's ground across the city
  if (s.uphill && s.slope > 0.004) {
    const e = extentAlong(s.uphill.dx, s.uphill.dy), rise = Math.round(clamp(s.slope * e, 0, 80));
    if (rise >= 2) {
      addLand({ id: "h-world-slope", kind: "slope", points: [inside(spec, [cx - s.uphill.dx * e / 2, cy - s.uphill.dy * e / 2]), inside(spec, [cx + s.uphill.dx * e / 2, cy + s.uphill.dy * e / 2])], height: rise });
      said.push(`the land rises about ${rise} m toward the ${compass(s.uphill.dx, s.uphill.dy)}`);
    }
  }
  const { w: gw, h: gh } = cityCells(spec), data = doc.height.data, cell = spec.cellM;
  const wet = (x: number, y: number) => { const i = Math.floor(y / cell) * gw + Math.floor(x / cell); return data[i] === M.deep || data[i] === M.shallow; };
  // the coast: the sea over the third of the city on the sea's side, with a wandering shore, shallows and a beach, the land falling to it
  if (s.coast) {
    const { dx, dy } = s.coast, e = extentAlong(dx, dy), shore = e * 0.18, ph1 = r() * 6.28, ph2 = r() * 6.28;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const mx = (x + 0.5) * cell, my = (y + 0.5) * cell, t = (mx - cx) * dx + (my - cy) * dy, along = -(mx - cx) * dy + (my - cy) * dx;
      const d = t - (shore + e * (0.035 * Math.sin(along / (e * 0.11) + ph1) + 0.02 * Math.sin(along / (e * 0.047) + ph2)));
      data[y * gw + x] = d > 14 ? M.deep : d > 0 ? M.shallow : d > -9 ? M.sand : data[y * gw + x];
    }
    addLand({ id: "h-coast", kind: "slope", points: [inside(spec, [cx + dx * shore, cy + dy * shore]), inside(spec, [cx - dx * e * 0.2, cy - dy * e * 0.2])], height: 7 });
    said.push(`the coast: sea and a beach on the ${compass(dx, dy)} side`);
  }
  // a river through it, winding, in its valley (toward the sea when there is one)
  if (s.river) {
    let { dx, dy } = s.river;
    if (s.coast && dx * s.coast.dx + dy * s.coast.dy < 0) { dx = -dx; dy = -dy; } // (flowing toward the sea)
    const widthM = Math.round(clamp(6 + 12 * s.river.widthPx, 8, 70)), px = -dy, py = dx, L = Math.hypot(W, H);
    const off = (r() - 0.5) * 0.2 * extentAlong(px, py), amp = clamp(widthM * 1.6, 10, 60), lambda = clamp(widthM * 12, 160, 600), ph = r() * 6.28;
    const line: Pt[] = [];
    for (let u = -L; u <= L; u += 6) {
      const x = cx + px * off + dx * u + px * amp * Math.sin((u / lambda) * 6.28 + ph), y = cy + py * off + dy * u + py * amp * Math.sin((u / lambda) * 6.28 + ph);
      if (x >= -20 && y >= -20 && x <= W + 20 && y <= H + 20) line.push([x, y]);
    }
    if (line.length >= 2) {
      const half = widthM / 2;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const mx = (x + 0.5) * cell, my = (y + 0.5) * cell, d = distToPolyline(mx, my, line);
        if (d <= half && !wet(mx, my)) data[y * gw + x] = d <= half - Math.min(3, half / 3) ? M.deep : M.shallow; // (it ends where it meets the sea)
      }
      const valley = line.filter((_, i) => i % Math.max(1, Math.ceil(line.length / 150)) === 0 || i === line.length - 1).map((q) => inside(spec, q));
      addLand({ id: "h-river-valley", kind: "ridge", points: valley, height: -Math.round(clamp(3 + widthM / 6, 3, 12)), radius: Math.round(half + 35) });
      said.push(`a river about ${widthM} m wide runs through toward the ${compass(dx, dy)}, in its valley`);
    }
  }
  // wooded country: woods in the driest corners; hilly country: a hill
  const corners: { at: Pt; poly: Pt[] }[] = [[0, 0], [W, 0], [W, H], [0, H]].map(([x0, y0]) => {
    const sx = x0 ? -1 : 1, sy = y0 ? -1 : 1, a = W * 0.24, b = H * 0.26;
    return { at: [x0 + sx * a * 0.5, y0 + sy * b * 0.5] as Pt, poly: [[x0, y0], [x0 + sx * a, y0], [x0 + sx * a * 0.75, y0 + sy * b], [x0, y0 + sy * b * 0.85]].map((q) => inside(spec, q as Pt)) };
  });
  // (a corner is dry when its middle and the points halfway to its corners are dry)
  const dry = corners.filter((c) => [c.at, ...c.poly.map(([x, y]) => [(x + c.at[0]) / 2, (y + c.at[1]) / 2] as Pt)].every(([x, y]) => !wet(clamp(x, 0, W - 0.1), clamp(y, 0, H - 0.1))));
  const order = [...dry];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  if (s.moist > 0.58 && s.temp > 0.12) {
    for (const c of order.slice(0, 2)) { const t = cleanTrees({ id: `v-world-${trees.length + 1}`, kind: "wood", points: c.poly }, spec); if (!("error" in t)) trees.push(t); }
    if (trees.length) said.push(`woods in ${trees.length === 1 ? "a corner" : "two corners"} (wooded country)`);
  }
  if (s.slope > 0.06 && order.length > trees.length) {
    const c = order[trees.length], rad = Math.round(Math.min(W, H) * 0.18);
    addLand({ id: "h-world-hill", kind: "hill", points: [c.at], height: Math.round(clamp(s.slope * 400, 8, 40)), radius: rad });
    said.push("a hill (hilly country)");
  }
  doc.features = { ...doc.features!, ...(land.length && { land }), ...(trees.length && { trees }) };
  if (s.lake) said.push("a lake is there on the world map: paint it in where it lies");
  return said;
}
