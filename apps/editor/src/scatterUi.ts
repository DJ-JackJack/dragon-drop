/**
 * The Object tool's Scatter mode (core scatter.ts): a drag strews the chosen object under a round brush, no two closer than the spacing (nor closer to
 * objects already there), each varied in size and turned and mirrored, and, when asked, the picture's variants in the same folder mixed in. What a stroke
 * places is drawn as it goes and sent as one edit when the mouse is let go (one undo step).
 */
import { type MapProp, SpotIndex, newFeatureId, parseAssetId, scatterInCircle, scatterLook, seededRandom, variantStem } from "@mapmaker/core";
import { fetchAssets } from "./assetsApi.ts";

/** The Scatter mode's settings (part of the battlemap's tool settings). */
export interface ScatterSettings {
  /** The brush's radius, squares. */
  radius: number;
  /** Squares between objects' centres. */
  spacing: number;
  /** How much sizes vary either way (0.25 = 75% to 125%). */
  vary: number;
  /** Turn and mirror each at random. */
  turn: boolean;
  /** Mix in the picture's variants ("Tree_A1", "Tree_A2"...). */
  variants: boolean;
  /** Only on floor, never on void. */
  floorOnly: boolean;
}
export const DEFAULT_SCATTER: ScatterSettings = { radius: 2, spacing: 1.2, vary: 0.25, turn: true, variants: true, floorOnly: true };

const variantCache = new Map<string, Promise<string[]>>();
/** A picture and its variants in the same folder (at most 24), looked up once per picture. */
export function variantsOf(id: string): Promise<string[]> {
  let p = variantCache.get(id);
  if (!p) {
    p = (async () => {
      const a = parseAssetId(id);
      if (!a) return [id];
      const want = variantStem(a.path);
      if (!want.stem) return [id];
      try {
        const r = await fetchAssets({ pack: a.pack, q: want.stem, offset: 0, limit: 200 });
        const out = new Set([id]);
        for (const it of r.items) {
          const v = variantStem(it.path);
          if (v.dir === want.dir && v.stem === want.stem) out.add(it.id);
          if (out.size >= 24) break;
        }
        return [...out];
      } catch { return [id]; }
    })();
    variantCache.set(id, p);
  }
  return p;
}

/** One scatter stroke: what it has placed so far. */
export class ScatterStroke {
  readonly placed: MapProp[] = [];
  private taken: SpotIndex;
  private rnd = seededRandom(Date.now() & 0x7fffffff);
  private pics: string[];
  constructor(private o: ScatterSettings & { asset: string; scale: number; rotation: number; flip: boolean; layer: "above" | "below" }, existing: [number, number][],
    private ok: (x: number, y: number) => boolean) {
    this.taken = new SpotIndex(Math.max(0.1, o.spacing), existing);
    this.pics = [o.asset];
    if (o.variants) void variantsOf(o.asset).then((list) => { if (list.length) this.pics = list; });
  }
  /** Strew under the brush at x, y (squares). */
  at(x: number, y: number) {
    for (const [px, py] of scatterInCircle(x, y, this.o.radius, this.taken, this.rnd, 14, this.ok)) {
      const look = scatterLook(this.rnd, { scale: this.o.scale, vary: this.o.vary, turn: this.o.turn, rotation: this.o.rotation, flip: this.o.flip });
      this.placed.push({
        id: newFeatureId("o"), asset: this.pics[Math.floor(this.rnd() * this.pics.length)], x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100,
        ...(look.rotation && { rotation: look.rotation }), ...(Math.abs(look.scale - 1) > 0.005 && { scale: Math.round(look.scale * 100) / 100 }), ...(look.flip && { flip: true }),
        ...(this.o.layer === "below" && { layer: "below" as const }),
      });
    }
  }
}
