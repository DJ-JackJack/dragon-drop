/**
 * One-click generators: a dungeon or a cave on a battlemap level, a village on a settlement map. Seeded (the same seed gives the same map), with a few
 * settings, and then edited like anything else. They make shapes only, never names or stories: rooms are not numbered or described, buildings not named.
 *
 * - Dungeon: rectangular rooms that don't touch, joined by one-square corridors (a tree of the nearest joins, plus a few loops so it isn't a maze of dead
 *   ends); walls traced round the floor; a door (sometimes a secret one) where a corridor meets a room; torches in some rooms.
 * - Cave: caverns grown by a cellular automaton on half squares (the largest connected one kept), smoothed to the floor's own detail; rock floor with patches
 *   of earth, a few shallow pools, rough rock walls traced round it.
 * - Village: a road across the map that follows the land (routeStreet), lanes off it, cottages along them (planFrontage), denser in the middle and farms at
 *   the ends; the building nearest the middle becomes an inn, the next big one a temple.
 */
import type { MapDoc } from "./doc.ts";
import { HeightField } from "./doc.ts";
import { battleSpec, isBattle } from "./battle.ts";
import type { BuildingKind, MapBuilding, MapLight, MapStreet, MapWall, RoofStyle } from "./features.ts";
import { traceFloorOutlines, traceSquareOutlines } from "./traceWalls.ts";
import { seededRandom } from "./scatter.ts";
import { citySpec, isCity } from "./city.ts";
import { type PlannedBuilding, planFrontage, routeStreet } from "./cityPlan.ts";

export type GenSize = "small" | "medium" | "large";
export const GEN_SIZES: GenSize[] = ["small", "medium", "large"];

export interface DungeonOptions {
  style: "dungeon" | "cave";
  size?: GenSize;
  seed?: number;
  /** Dungeons: doors where corridors meet rooms (default yes). */
  doors?: boolean;
  /** Dungeons: torches in some rooms (default yes). */
  torches?: boolean;
}

export interface GeneratedLevel {
  /** The whole level's floor (material ids; 0 = void), as the map's height data. */
  data: Float32Array;
  walls: Omit<MapWall, "id">[];
  lights: Omit<MapLight, "id">[];
  seed: number;
  /** What was made, in words. */
  summary: string;
}

const FLAGSTONE = 1, DIRT = 4, SHALLOW = 7, ROCK = 13;

/** A seed from the clock, for "another one". */
export const newSeed = () => (Math.floor(Math.random() * 2 ** 31) >>> 0) || 1;

/** A dungeon or a cave filling the battlemap level (a square's margin all round). */
export function generateDungeon(doc: MapDoc, o: DungeonOptions): GeneratedLevel | { error: string } {
  if (!isBattle(doc)) return { error: "Dungeons and caves are made on battlemaps." };
  const spec = battleSpec(doc), W = spec.squaresX, H = spec.squaresY;
  if (W < 10 || H < 10) return { error: `This battlemap is ${W} x ${H} squares: a dungeon or cave needs at least 10 x 10.` };
  const seed = (o.seed ?? newSeed()) >>> 0 || 1;
  return o.style === "cave" ? cave(doc, W, H, spec.sub, o.size ?? "medium", seed) : dungeon(doc, W, H, spec.sub, o, seed);
}

interface Room { x: number; y: number; w: number; h: number }

function dungeon(doc: MapDoc, W: number, H: number, sub: number, o: DungeonOptions, seed: number): GeneratedLevel {
  const rnd = seededRandom(seed), size = o.size ?? "medium";
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  // how many rooms: by size, for the map's area (a 30 x 30 map takes 4 / 7 / 11)
  const per = { small: 4, medium: 7, large: 11 }[size];
  const want = Math.max(3, Math.min(40, Math.round(per * Math.sqrt((W * H) / 900))));
  const big = Math.max(4, Math.min(10, Math.round(Math.min(W, H) / 4)));
  const rooms: Room[] = [];
  for (let tries = 0; tries < want * 60 && rooms.length < want; tries++) {
    const w = int(3, big), h = int(3, big);
    if (w > W - 4 || h > H - 4) continue;
    const r = { x: int(2, W - w - 2), y: int(2, H - h - 2), w, h };
    // (two squares apart at least: room for a wall each and a corridor between)
    if (rooms.some((q) => r.x < q.x + q.w + 2 && q.x < r.x + r.w + 2 && r.y < q.y + q.h + 2 && q.y < r.y + r.h + 2)) continue;
    rooms.push(r);
  }
  // 0 rock, 1 room, 2 corridor; a square grid
  const g = new Uint8Array(W * H);
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g[y * W + x] = 1;
  const centre = (r: Room) => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)] as const;
  const dist = (a: Room, b: Room) => { const [ax, ay] = centre(a), [bx, by] = centre(b); return Math.abs(ax - bx) + Math.abs(ay - by); };
  // joins: the nearest-neighbour tree (Prim), then a few loops
  const joins: [number, number][] = [];
  const inTree = new Set([0]);
  while (inTree.size < rooms.length) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const i of inTree) for (let j = 0; j < rooms.length; j++) if (!inTree.has(j)) { const d = dist(rooms[i], rooms[j]); if (d < bd) { bd = d; best = [i, j]; } }
    joins.push(best!);
    inTree.add(best![1]);
  }
  const loops = Math.round(rooms.length * 0.2);
  for (let k = 0, tries = 0; k < loops && tries < 50; tries++) {
    const i = int(0, rooms.length - 1);
    const near = rooms.map((_, j) => j).filter((j) => j !== i && !joins.some(([a, b]) => (a === i && b === j) || (a === j && b === i))).sort((a, b) => dist(rooms[i], rooms[a]) - dist(rooms[i], rooms[b]))[0];
    if (near === undefined) continue;
    joins.push([i, near]);
    k++;
  }
  const dig = (x: number, y: number) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !g[y * W + x]) g[y * W + x] = 2; };
  const across = (x0: number, x1: number, y: number) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) dig(x, y); };
  const down = (y0: number, y1: number, x: number) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) dig(x, y); };
  // (an L from one room's middle to the other's, turning one way or the other)
  for (const [i, j] of joins) {
    const [ax, ay] = centre(rooms[i]), [bx, by] = centre(rooms[j]);
    if (rnd() < 0.5) { across(ax, bx, ay); down(ay, by, bx); } else { down(ay, by, ax); across(ax, bx, by); }
  }
  const data = floorFromSquares(g, W, H, sub, () => FLAGSTONE);
  // (traced along the squares' edges: the smoothed trace leans a wall where a corridor meets a room)
  const walls: Omit<MapWall, "id">[] = traceSquareOutlines((x, y) => g[y * W + x] !== 0, W, H).map((points) => ({ kind: "wall", points, closed: true, auto: true }));
  // doors: where a one-square corridor meets a room's side
  let doors = 0, secrets = 0;
  if (o.doors !== false) {
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : g[y * W + x]);
    for (const r of rooms) {
      const sides: { out: (k: number) => [number, number]; door: (k: number) => [[number, number], [number, number]]; n: number }[] = [
        { n: r.w, out: (k) => [r.x + k, r.y - 1], door: (k) => [[r.x + k, r.y], [r.x + k + 1, r.y]] },
        { n: r.w, out: (k) => [r.x + k, r.y + r.h], door: (k) => [[r.x + k, r.y + r.h], [r.x + k + 1, r.y + r.h]] },
        { n: r.h, out: (k) => [r.x - 1, r.y + k], door: (k) => [[r.x, r.y + k], [r.x, r.y + k + 1]] },
        { n: r.h, out: (k) => [r.x + r.w, r.y + k], door: (k) => [[r.x + r.w, r.y + k], [r.x + r.w, r.y + k + 1]] },
      ];
      for (const s of sides) for (let k = 0; k < s.n; k++) {
        const [x, y] = s.out(k);
        if (at(x, y) !== 2) continue;
        // only a mouth one square wide: a corridor running along the room's side has no wall to put a door in
        const [px, py] = k > 0 ? s.out(k - 1) : [-1, -1], [nx, ny] = k < s.n - 1 ? s.out(k + 1) : [-1, -1];
        if ((k > 0 && at(px, py)) || (k < s.n - 1 && at(nx, ny))) continue;
        if (rnd() > 0.7) continue; // (some are open archways)
        const secret = rnd() < 0.07;
        walls.push({ kind: secret ? "secret" : "door", points: s.door(k) });
        if (secret) secrets++; else doors++;
      }
    }
  }
  const lights: Omit<MapLight, "id">[] = [];
  if (o.torches !== false) for (const r of rooms) if (rnd() < 0.6) lights.push({ x: r.x + r.w / 2, y: r.y + 0.4, radius: 6, bright: 3, colour: "#ffb35c" });
  const summary = `a dungeon of ${rooms.length} rooms joined by corridors${doors ? `, ${doors} door${doors === 1 ? "" : "s"}` : ""}${secrets ? ` and ${secrets} secret door${secrets === 1 ? "" : "s"}` : ""}${lights.length ? `, ${lights.length} torch${lights.length === 1 ? "" : "es"}` : ""}`;
  return { data, walls, lights, seed, summary };
}

function cave(doc: MapDoc, W: number, H: number, sub: number, size: GenSize, seed: number): GeneratedLevel {
  const rnd = seededRandom(seed);
  // half squares: 1 open, 0 rock
  const gw = W * 2, gh = H * 2, N = gw * gh;
  let open = new Uint8Array(N), share = 0;
  const rockShare = { small: 0.53, medium: 0.48, large: 0.44 }[size];
  for (let attempt = 0; attempt < 4; attempt++) {
    const fill = rockShare - attempt * 0.03;
    const edge = (x: number, y: number) => x < 3 || y < 3 || x >= gw - 3 || y >= gh - 3;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) open[y * gw + x] = !edge(x, y) && rnd() >= fill ? 1 : 0;
    for (let it = 0; it < 5; it++) {
      const next = new Uint8Array(N);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        if (edge(x, y)) continue;
        let rock = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !open[(y + dy) * gw + x + dx]) rock++;
        next[y * gw + x] = rock >= 5 ? 0 : rock <= 3 ? 1 : open[y * gw + x];
      }
      open = next;
    }
    // the caverns: the largest, and the others big enough to walk into (at least 3 squares), joined to it by tunnels; specks are filled in
    const label = new Int32Array(N).fill(-1), cells: number[][] = [];
    for (let i = 0; i < N; i++) {
      if (!open[i] || label[i] >= 0) continue;
      const id = cells.length, mine: number[] = [], stack = [i];
      label[i] = id;
      while (stack.length) {
        const c = stack.pop()!, cx = c % gw, cy = (c - cx) / gw;
        mine.push(c);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = cx + dx, y = cy + dy, k = y * gw + x;
          if (x >= 0 && y >= 0 && x < gw && y < gh && open[k] && label[k] < 0) { label[k] = id; stack.push(k); }
        }
      }
      cells.push(mine);
    }
    const order = cells.map((c, id) => ({ id, n: c.length })).sort((a, b) => b.n - a.n);
    if (!order.length) continue;
    const joined: number[] = [...cells[order[0].id]];
    for (const { id, n } of order.slice(1)) {
      if (n < 12) { for (const c of cells[id]) open[c] = 0; continue; }
      // the nearest pair of cells, from a sample of each, and a winding tunnel a square wide between them
      const pick = (list: number[], k: number) => (list.length <= k ? list : Array.from({ length: k }, () => list[Math.floor(rnd() * list.length)]));
      let best: [number, number] | null = null, bd = Infinity;
      for (const a of pick(cells[id], 40)) for (const b of pick(joined, 300)) {
        const d = Math.hypot((a % gw) - (b % gw), Math.floor(a / gw) - Math.floor(b / gw));
        if (d < bd) { bd = d; best = [a, b]; }
      }
      if (best) tunnel(open, gw, gh, best[0], best[1], rnd);
      joined.push(...cells[id]);
    }
    share = open.reduce((s, v) => s + v, 0) / N;
    if (share >= 0.18) break;
  }
  // smoothed to the floor's detail: each floor cell takes the open share around it (bilinear on half squares)
  const CW = W * sub, CH = H * sub, data = new Float32Array(CW * CH);
  const at = (x: number, y: number) => open[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];
  // patches of earth on the rock floor (a coarse value noise), and a few shallow pools in the widest places
  const nz = noiseGrid(Math.ceil(W / 3) + 2, Math.ceil(H / 3) + 2, rnd);
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const u = ((cx + 0.5) / sub) * 2 - 0.5, v = ((cy + 0.5) / sub) * 2 - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    const s = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
    if (s < 0.5) continue;
    data[cy * CW + cx] = nz.at((cx + 0.5) / sub / 3, (cy + 0.5) / sub / 3) > 0.68 ? DIRT : ROCK;
  }
  // pools: in open ground at least two squares from the rock
  const clear = (sx: number, sy: number, r: number) => {
    for (let y = Math.floor((sy - r) * 2); y <= Math.ceil((sy + r) * 2); y++) for (let x = Math.floor((sx - r) * 2); x <= Math.ceil((sx + r) * 2); x++) if (!at(x, y)) return false;
    return true;
  };
  const pools = { small: 1, medium: 2, large: 3 }[size];
  let made = 0;
  for (let tries = 0; tries < 400 && made < pools; tries++) {
    const px = 2 + rnd() * (W - 4), py = 2 + rnd() * (H - 4), r = 1 + rnd() * 1.2;
    if (!clear(px, py, r + 1)) continue;
    for (let cy = Math.floor((py - r) * sub); cy <= Math.ceil((py + r) * sub); cy++) for (let cx = Math.floor((px - r) * sub); cx <= Math.ceil((px + r) * sub); cx++) {
      const dx = (cx + 0.5) / sub - px, dy = (cy + 0.5) / sub - py;
      // (a wobbly edge)
      const edge = r * (0.8 + 0.25 * Math.sin(Math.atan2(dy, dx) * 3 + px));
      if (dx * dx + dy * dy <= edge * edge && cx >= 0 && cy >= 0 && cx < CW && cy < CH && data[cy * CW + cx]) data[cy * CW + cx] = SHALLOW;
    }
    made++;
  }
  const walls: Omit<MapWall, "id">[] = traceWalls(doc, data).map((points) => ({ kind: "wall", points, closed: true, auto: true, look: "rock" }));
  const area = Math.round(share * W * H);
  return { data, walls, lights: [], seed, summary: `a cave of about ${area} squares of floor${made ? `, with ${made} pool${made === 1 ? "" : "s"}` : ""}` };
}

/** Dig a tunnel two cells wide (a square, on half squares) from cell a to cell b, wandering a little, never into the outermost cells. */
function tunnel(open: Uint8Array, gw: number, gh: number, a: number, b: number, rnd: () => number) {
  let x = a % gw, y = Math.floor(a / gw);
  const tx = b % gw, ty = Math.floor(b / gw);
  for (let steps = 0; steps < gw + gh + 200 && (x !== tx || y !== ty); steps++) {
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const px = Math.min(gw - 3, Math.max(2, x + dx)), py = Math.min(gh - 3, Math.max(2, y + dy));
      open[py * gw + px] = 1;
    }
    // mostly towards the far end, now and then sideways
    const ddx = tx - x, ddy = ty - y;
    if (rnd() < 0.25) { if (rnd() < 0.5) y += rnd() < 0.5 ? 1 : -1; else x += rnd() < 0.5 ? 1 : -1; }
    else if (Math.abs(ddx) > Math.abs(ddy) || (Math.abs(ddx) === Math.abs(ddy) && rnd() < 0.5)) x += Math.sign(ddx);
    else y += Math.sign(ddy);
    x = Math.min(gw - 3, Math.max(2, x)); y = Math.min(gh - 3, Math.max(2, y));
  }
}

/** The floor cells for a grid of squares (each square's cells take its material; 0 stays void). */
function floorFromSquares(g: Uint8Array, W: number, H: number, sub: number, material: (v: number) => number): Float32Array {
  const CW = W * sub, out = new Float32Array(CW * H * sub);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = g[y * W + x];
    if (!v) continue;
    const m = material(v);
    for (let cy = y * sub; cy < (y + 1) * sub; cy++) out.fill(m, cy * CW + x * sub, cy * CW + (x + 1) * sub);
  }
  return out;
}

/** The outlines of this floor (traceWalls.ts), traced on a copy of the map with it. */
function traceWalls(doc: MapDoc, data: Float32Array) {
  return traceFloorOutlines({ ...doc, height: new HeightField(doc.height.w, doc.height.h, data) });
}

/** A smooth value noise in 0..1 on a coarse grid. */
function noiseGrid(w: number, h: number, rnd: () => number) {
  const v = Float32Array.from({ length: w * h }, () => rnd());
  return {
    at(x: number, y: number) {
      const x0 = Math.min(w - 2, Math.max(0, Math.floor(x))), y0 = Math.min(h - 2, Math.max(0, Math.floor(y))), fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = v[y0 * w + x0], b = v[y0 * w + x0 + 1], c = v[(y0 + 1) * w + x0], d = v[(y0 + 1) * w + x0 + 1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    },
  };
}

// ------------------------------------------------------------------ villages
export type VillageSize = "hamlet" | "village" | "large";
export const VILLAGE_SIZES: VillageSize[] = ["hamlet", "village", "large"];

export interface VillageOptions { size?: VillageSize; seed?: number }

/** What a generator is asked for (the server's compute job, the editor's Generate box, Claude's tools). */
export type GenerateRequest =
  | { what: "dungeon" | "cave"; size?: GenSize; seed?: number; doors?: boolean; torches?: boolean }
  | { what: "village"; size?: VillageSize; seed?: number };

/** A request from outside (an editor's message) made safe: an unknown generator is null; unknown settings become the defaults. */
export function cleanGenerateRequest(v: unknown): GenerateRequest | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const seed = typeof o.seed === "number" && Number.isFinite(o.seed) ? Math.abs(Math.round(o.seed)) % 2 ** 32 : undefined;
  if (o.what === "village") return { what: "village", ...(VILLAGE_SIZES.includes(o.size as VillageSize) && { size: o.size as VillageSize }), ...(seed !== undefined && { seed }) };
  if (o.what !== "dungeon" && o.what !== "cave") return null;
  return {
    what: o.what, ...(GEN_SIZES.includes(o.size as GenSize) && { size: o.size as GenSize }), ...(seed !== undefined && { seed }),
    ...(typeof o.doors === "boolean" && { doors: o.doors }), ...(typeof o.torches === "boolean" && { torches: o.torches }),
  };
}

/** Run the generator asked for. */
export function runGenerator(doc: MapDoc, r: GenerateRequest): GeneratedLevel | GeneratedVillage | { error: string } {
  return r.what === "village" ? generateVillage(doc, { size: r.size, seed: r.seed }) : generateDungeon(doc, { style: r.what, size: r.size, seed: r.seed, doors: r.doors, torches: r.torches });
}

export interface GeneratedVillage {
  streets: Omit<MapStreet, "id">[];
  buildings: PlannedBuilding[];
  seed: number;
  summary: string;
}

type Pt = [number, number];

/**
 * A village on a settlement map: a road across it that follows the land, lanes off it, cottages along them. Water, woods, steep ground and what is already on the
 * map are left alone (the planner's own rules); the streets and buildings already there count as taken ground.
 */
export function generateVillage(doc: MapDoc, o: VillageOptions = {}): GeneratedVillage | { error: string } {
  if (!isCity(doc)) return { error: "Villages are made on settlement maps." };
  const sp = citySpec(doc), Wm = sp.widthM, Hm = sp.heightM;
  const seed = (o.seed ?? newSeed()) >>> 0 || 1, rnd = seededRandom(seed), size = o.size ?? "village";
  if (Math.min(Wm, Hm) < 150) return { error: `This settlement map is ${Math.round(Wm)} x ${Math.round(Hm)} m: a village needs at least 150 m each way.` };
  const R = Math.min({ hamlet: 110, village: 230, large: 380 }[size], Math.min(Wm, Hm) * 0.42);
  const c: Pt = [Wm / 2 + (rnd() - 0.5) * Wm * 0.15, Hm / 2 + (rnd() - 0.5) * Hm * 0.15];
  // the road: across the map through the middle, along the longer way more often than not
  const across = Wm >= Hm ? 0 : Math.PI / 2, ang = across + (rnd() - 0.5) * 0.9;
  const ends = lineAcross(c, ang, Wm, Hm, 3);
  const route = (pts: Pt[]): Pt[] => {
    const r = routeStreet(doc, pts, { maxGrade: 10 });
    return "error" in r ? pts : (r.points as Pt[]);
  };
  const main = route([ends[0], c, ends[1]]);
  const streets: Omit<MapStreet, "id">[] = [{ points: main, width: 6, kind: "street" }];
  // lanes off the road, near the middle, to alternate sides
  const lanes = { hamlet: int(rnd, 0, 1), village: int(rnd, 2, 3), large: int(rnd, 4, 6) }[size];
  const along = polyMeasure(main), mid = nearestAlong(main, c);
  for (let k = 0; k < lanes; k++) {
    const s = Math.min(along.total - 10, Math.max(10, mid + (rnd() - 0.5) * 1.3 * R));
    const [p, dir] = pointAt(main, along, s);
    const side = k % 2 ? 1 : -1, turn = side * (Math.PI / 2 + (rnd() - 0.5) * 0.8);
    const a = Math.atan2(dir[1], dir[0]) + turn, len = R * (0.55 + rnd() * 0.5);
    const end: Pt = [clamp(p[0] + Math.cos(a) * len, 5, Wm - 5), clamp(p[1] + Math.sin(a) * len, 5, Hm - 5)];
    if (Math.hypot(end[0] - p[0], end[1] - p[1]) < 40) continue;
    // (a gentle bend halfway, so a lane over flat ground isn't ruler-straight)
    const bend = (rnd() - 0.5) * 0.3 * len, halfway: Pt = [clamp((p[0] + end[0]) / 2 - Math.sin(a) * bend, 5, Wm - 5), clamp((p[1] + end[1]) / 2 + Math.cos(a) * bend, 5, Hm - 5)];
    streets.push({ points: route([p, halfway, end]), width: 4, kind: "lane" });
  }
  // the buildings: town-like close to the middle, cottages further out, farms at the ends (a large village)
  const temp: MapStreet[] = streets.map((s, i) => ({ ...s, id: `gen-${i}` }));
  let scratch: MapDoc = { ...doc, features: { ...(doc.features ?? { places: [], labels: [] }), streets: [...(doc.features?.streets ?? []), ...temp] } };
  const buildings: PlannedBuilding[] = [];
  const add = (st: MapStreet, start: number, end: number, character: "town" | "village" | "farm") => {
    const from = Math.max(0, start), to = Math.min(polyMeasure(st.points as Pt[]).total, end);
    if (to - from < 10) return;
    // (the middle is houses and shops only: the one inn and the temple are chosen below)
    const plan = planFrontage(scratch, [st], { character, from, to, seed: int(rnd, 1, 1e9), limit: 400, ...(character === "town" && { kinds: { house: 0.86, shop: 0.14 } }) });
    buildings.push(...plan.buildings);
    const placed: MapBuilding[] = plan.buildings.map((b, i) => ({ id: `gen-b${buildings.length}-${i}`, points: b.points, roof: b.roof, kind: b.kind }));
    scratch = { ...scratch, features: { ...scratch.features!, buildings: [...(scratch.features!.buildings ?? []), ...placed] } };
  };
  const core = size === "hamlet" ? 0 : R * 0.3;
  if (core) add(temp[0], mid - core, mid + core, "town");
  add(temp[0], mid - R, mid - core, "village");
  add(temp[0], mid + core, mid + R, "village");
  if (size === "large") { add(temp[0], mid - R * 1.6, mid - R, "farm"); add(temp[0], mid + R, mid + R * 1.6, "farm"); }
  for (const st of temp.slice(1)) add(st, 8, polyMeasure(st.points as Pt[]).total, "village");
  // an inn by the road in the middle, and a temple: the largest building near it
  const centreOf = (b: PlannedBuilding): Pt => b.points.reduce((s, q) => [s[0] + q[0] / b.points.length, s[1] + q[1] / b.points.length], [0, 0]);
  const area = (b: PlannedBuilding) => Math.abs(b.points.reduce((s, q, i) => { const n = b.points[(i + 1) % b.points.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
  const byMiddle = buildings.map((b, i) => ({ i, d: Math.hypot(centreOf(b)[0] - c[0], centreOf(b)[1] - c[1]) })).sort((a, b) => a.d - b.d);
  const special: string[] = [];
  const mark = (i: number, kind: BuildingKind, roof: RoofStyle) => { buildings[i] = { ...buildings[i], kind, roof }; special.push(kind); };
  if (size !== "hamlet" && byMiddle.length >= 6) {
    mark(byMiddle[0].i, "inn", "shingle");
    const near = byMiddle.slice(1, 8).sort((a, b) => area(buildings[b.i]) - area(buildings[a.i]))[0];
    if (near) mark(near.i, "temple", "slate");
  } else if (byMiddle.length >= 3) mark(byMiddle[0].i, "tavern", "thatch");
  const summary = `a ${size === "large" ? "large village" : size} of ${buildings.length} buildings along ${streets.length === 1 ? "one road" : `a road and ${streets.length - 1} lane${streets.length === 2 ? "" : "s"}`}${special.length ? `, with ${special.map((k) => `a${k === "inn" ? "n" : ""} ${k}`).join(" and ")} near the middle` : ""}`;
  return { streets, buildings, seed, summary };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const int = (rnd: () => number, a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

/** Where a line through `c` at angle `a` meets the map's edges (inset `m` metres): its two ends. */
function lineAcross(c: Pt, a: number, W: number, H: number, m: number): [Pt, Pt] {
  const dx = Math.cos(a), dy = Math.sin(a);
  const reach = (sx: number, sy: number) => {
    let t = Infinity;
    if (sx > 1e-9) t = Math.min(t, (W - m - c[0]) / sx); else if (sx < -1e-9) t = Math.min(t, (m - c[0]) / sx);
    if (sy > 1e-9) t = Math.min(t, (H - m - c[1]) / sy); else if (sy < -1e-9) t = Math.min(t, (m - c[1]) / sy);
    return [c[0] + sx * t, c[1] + sy * t] as Pt;
  };
  return [reach(-dx, -dy), reach(dx, dy)];
}

function polyMeasure(p: Pt[]) {
  const at = [0];
  for (let i = 1; i < p.length; i++) at.push(at[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return { at, total: at[at.length - 1] };
}

/** The point and direction at distance `s` along a line. */
function pointAt(p: Pt[], m: { at: number[] }, s: number): [Pt, Pt] {
  let i = 1;
  while (i < p.length - 1 && m.at[i] < s) i++;
  const a = p[i - 1], b = p[i], len = m.at[i] - m.at[i - 1] || 1, t = clamp((s - m.at[i - 1]) / len, 0, 1);
  return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [(b[0] - a[0]) / len, (b[1] - a[1]) / len]];
}

/** How far along the line its nearest point to `c` is. */
function nearestAlong(p: Pt[], c: Pt): number {
  const m = polyMeasure(p);
  let best = 0, bd = Infinity;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = clamp(((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l2, 0, 1), x = a[0] + dx * t, y = a[1] + dy * t, d = Math.hypot(c[0] - x, c[1] - y);
    if (d < bd) { bd = d; best = m.at[i - 1] + t * Math.sqrt(l2); }
  }
  return best;
}
