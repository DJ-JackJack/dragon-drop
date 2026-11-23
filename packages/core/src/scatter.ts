/**
 * Strewing objects over a battlemap (the Object tool's Scatter mode and Claude's `scatter_props`): spots no closer than a spacing to one another or to what
 * is already there (dart throwing, so it looks natural rather than in rows), each object varied in size and turn, and a picture's variants mixed in
 * ("Tree_A1", "Tree_A2", "Tree_A3" in the same folder). Squares throughout.
 */

export type XY = [number, number];

/** A random number source: give a seed for the same result every time. */
export function seededRandom(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** A grid of spots already taken, for quick "is anything within `spacing`" questions. */
export class SpotIndex {
  private cells = new Map<string, XY[]>();
  constructor(private spacing: number, spots: XY[] = []) { for (const p of spots) this.add(p); }
  private key(x: number, y: number) { return `${Math.floor(x / this.spacing)},${Math.floor(y / this.spacing)}`; }
  add(p: XY) {
    const k = this.key(p[0], p[1]);
    const list = this.cells.get(k);
    if (list) list.push(p); else this.cells.set(k, [p]);
  }
  /** Whether a spot is at least `spacing` from every spot taken. */
  free(x: number, y: number): boolean {
    const cx = Math.floor(x / this.spacing), cy = Math.floor(y / this.spacing), s2 = this.spacing * this.spacing;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      for (const p of this.cells.get(`${cx + i},${cy + j}`) ?? []) if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < s2) return false;
    }
    return true;
  }
}

/** New spots in a circle (the brush under the pointer), each `spacing` from the others and from those taken; `ok` can refuse a spot (void, a wall...). */
export function scatterInCircle(cx: number, cy: number, r: number, taken: SpotIndex, rnd: () => number, tries = 14, ok: (x: number, y: number) => boolean = () => true): XY[] {
  const out: XY[] = [];
  for (let k = 0; k < tries; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (!ok(x, y) || !taken.free(x, y)) continue;
    taken.add([x, y]);
    out.push([x, y]);
  }
  return out;
}

/** Spots filling an area (a polygon, or a rectangle given as its four corners), at most `max`, each `spacing` from the others and from those taken. */
export function scatterInArea(polygon: XY[], spacing: number, taken: SpotIndex, rnd: () => number, o: { max?: number; ok?: (x: number, y: number) => boolean } = {}): XY[] {
  if (polygon.length < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of polygon) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const area = (x1 - x0) * (y1 - y0), max = Math.min(o.max ?? 2000, 2000);
  const attempts = Math.min(60000, Math.max(200, Math.ceil((area / (spacing * spacing)) * 30)));
  const out: XY[] = [];
  for (let k = 0; k < attempts && out.length < max; k++) {
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
    if (!inside(polygon, x, y) || (o.ok && !o.ok(x, y)) || !taken.free(x, y)) continue;
    taken.add([x, y]);
    out.push([x, y]);
  }
  return out;
}

function inside(poly: XY[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** How an object strewn is varied: its size within ±`vary` of `scale`, a turn and a mirror when `turn` (else the given ones). */
export function scatterLook(rnd: () => number, o: { scale: number; vary: number; turn: boolean; rotation?: number; flip?: boolean }): { scale: number; rotation: number; flip: boolean } {
  const scale = Math.max(0.05, o.scale * (1 + (rnd() * 2 - 1) * o.vary));
  return o.turn ? { scale, rotation: Math.floor(rnd() * 24) * 15, flip: rnd() < 0.5 } : { scale, rotation: o.rotation ?? 0, flip: !!o.flip };
}

/**
 * A picture's name without its variant mark ("Tree_Oak_A1" → "tree oak", "Rock 03" → "rock", "Bush-Large-b" → "bush large"): pictures in the same folder
 * with the same stem are variants of one another.
 */
export function variantStem(path: string): { dir: string; stem: string } {
  const slash = path.lastIndexOf("/"), dir = slash >= 0 ? path.slice(0, slash) : "", file = path.slice(slash + 1).replace(/\.[a-z0-9]+$/i, "");
  let s = file.replace(/[_\-.]+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*(?:\(\d+\)|[a-z]?\d+[a-z]?|\b[a-z])$/i, "").trim();
    if (!next || next === s) break;
    s = next;
  }
  return { dir, stem: s.toLowerCase() };
}
