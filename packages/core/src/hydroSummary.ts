/**
 * A plain account of a map's water: how many rivers and how long, where they end, what its lakes do, and what each river source feeds.
 * It is worked out alongside the climate (the rivers and the flow are at hand there) and read by the hydrology check tool, so problems such as a
 * lake nothing flows out of, or a river running through desert, can be found and explained instead of guessed from a picture.
 */
import type { Hydrology, RiverInflow } from "./hydrology.ts";
import { landCellNear } from "./hydrology.ts";

export interface HydroLake {
  /** Centre, map px. */
  x: number;
  y: number;
  areaKm2: number;
  /** "river": a drawn river leaves it; "stream": water leaves but less than a river; "none": nothing leaves (no way out was found). */
  outflow: "river" | "stream" | "none";
  /** What leaves, relative to the smallest flow drawn as a river (1 = just a river). */
  outflowSize: number;
}

export type RiverEnd = "sea" | "lake" | "river" | "elsewhere";

export interface HydroSourceReport {
  x: number;
  y: number;
  share: number;
  /** A river was found running from (or through) this point. */
  drawn: boolean;
  lengthKm: number;
  reaches: RiverEnd | null;
  /** Where that river ends, map px. */
  mouth: [number, number] | null;
}

export interface HydroSummary {
  riverCount: number;
  riverLengthKm: number;
  ends: Record<RiverEnd, number>;
  /** The share of river length over ground the depression filler had to raise (the river runs through a bowl). */
  bowlShare: number;
  /** The share of river length through very dry land. */
  dryShare: number;
  lakes: HydroLake[];
  sources: HydroSourceReport[];
}

export interface HydroInput {
  h: Float32Array;
  W: number;
  H: number;
  sea: number;
  kmPerPx: number;
  hy: Hydrology;
  /** Moisture 0..1 per cell. */
  moist: ArrayLike<number>;
  inflows?: RiverInflow[];
}

export function summariseHydrology(o: HydroInput): HydroSummary {
  const { h, W, H, sea, kmPerPx, hy } = o;
  const flow = hy.flow;
  const cellOf = (x: number, y: number) => Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));
  const owner = new Map<number, number>();
  hy.rivers.forEach((r, id) => { for (let k = 0; k < r.pts.length; k += 2) owner.set(cellOf(r.pts[k], r.pts[k + 1]), id); });
  const near = (x: number, y: number, rad: number, test: (c: number) => boolean) => {
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && test(ny * W + nx)) return true;
    }
    return false;
  };
  const endOf = (id: number): RiverEnd => {
    const p = hy.rivers[id].pts, x = p[p.length - 2], y = p[p.length - 1];
    if (near(x, y, 3, (c) => h[c] <= sea)) return "sea";
    if (near(x, y, 3, (c) => !!hy.lakes[c])) return "lake";
    if (near(x, y, 4, (c) => { const o2 = owner.get(c); return o2 !== undefined && o2 !== id; })) return "river";
    return "elsewhere";
  };
  const lengthFrom = (id: number, from: number) => {
    const p = hy.rivers[id].pts;
    let len = 0;
    for (let k = from; k + 3 < p.length; k += 2) len += Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]);
    return len * kmPerPx;
  };

  const ends: Record<RiverEnd, number> = { sea: 0, lake: 0, river: 0, elsewhere: 0 };
  let total = 0, bowl = 0, dry = 0, points = 0;
  hy.rivers.forEach((r, id) => {
    ends[endOf(id)]++;
    total += lengthFrom(id, 0);
    for (let k = 0; k < r.pts.length; k += 2) {
      const c = cellOf(r.pts[k], r.pts[k + 1]);
      points++;
      if (flow.filled[c] - h[c] > 3) bowl++;
      if (o.moist[c] < 0.12) dry++;
    }
  });

  // lakes: connected cells, with the way out of each
  const N = W * H, label = new Int32Array(N);
  const lakes: HydroLake[] = [];
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (!hy.lakes[i] || label[i]) continue;
    n++;
    let cells = 0, sx = 0, sy = 0, spill = -1, spillAcc = 0;
    const stack = [i];
    label[i] = n;
    while (stack.length) {
      const c = stack.pop()!;
      cells++;
      const x = c % W, y = (c / W) | 0;
      sx += x; sy += y;
      const rc = flow.receiver[c];
      if (rc >= 0 && !hy.lakes[rc] && flow.acc[c] > spillAcc) { spill = rc; spillAcc = flow.acc[c]; }
      if (x > 0 && hy.lakes[c - 1] && !label[c - 1]) { label[c - 1] = n; stack.push(c - 1); }
      if (x < W - 1 && hy.lakes[c + 1] && !label[c + 1]) { label[c + 1] = n; stack.push(c + 1); }
      if (y > 0 && hy.lakes[c - W] && !label[c - W]) { label[c - W] = n; stack.push(c - W); }
      if (y < H - 1 && hy.lakes[c + W] && !label[c + W]) { label[c + W] = n; stack.push(c + W); }
    }
    const size = spill >= 0 ? spillAcc / hy.riverThreshold : 0;
    lakes.push({ x: Math.round(sx / cells), y: Math.round(sy / cells), areaKm2: Math.round(cells * kmPerPx * kmPerPx), outflow: spill < 0 ? "none" : size >= 1 ? "river" : "stream", outflowSize: Math.round(size * 100) / 100 });
  }
  lakes.sort((a, b) => b.areaKm2 - a.areaKm2);

  const sources: HydroSourceReport[] = (o.inflows ?? []).map((s) => {
    const c = landCellNear(h, W, H, sea, s.x, s.y);
    const empty: HydroSourceReport = { x: s.x, y: s.y, share: s.share, drawn: false, lengthKm: 0, reaches: null, mouth: null };
    if (c < 0) return empty;
    const sx = (c % W) + 0.5, sy = ((c / W) | 0) + 0.5;
    let best: { id: number; k: number; d: number } | null = null;
    hy.rivers.forEach((r, id) => {
      for (let k = 0; k < r.pts.length; k += 2) {
        const d = Math.hypot(r.pts[k] - sx, r.pts[k + 1] - sy);
        if (d < 4 && (!best || d < best.d)) best = { id, k, d };
      }
    });
    if (!best) return empty;
    const b = best as { id: number; k: number; d: number }, p = hy.rivers[b.id].pts;
    return { x: s.x, y: s.y, share: s.share, drawn: true, lengthKm: Math.round(lengthFrom(b.id, b.k)), reaches: endOf(b.id), mouth: [Math.round(p[p.length - 2]), Math.round(p[p.length - 1])] };
  });

  return {
    riverCount: hy.rivers.length, riverLengthKm: Math.round(total), ends,
    bowlShare: points ? Math.round((bowl / points) * 1000) / 1000 : 0, dryShare: points ? Math.round((dry / points) * 1000) / 1000 : 0,
    lakes: lakes.slice(0, 20), sources,
  };
}
