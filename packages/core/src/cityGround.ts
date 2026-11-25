/**
 * A settlement's ground in the colours of its trace picture, for redrawing a found map in its own colours: for each kind of ground the map has painted,
 * the middles of cells of it that nothing stands on (no building, street, wall or wood, and not right beside a building, where the picture draws its
 * shadow) are looked up in the picture, and the middle colour of them becomes that ground's colour (`CitySpec.ground`, cityLand.ts). Pure: the hub reads
 * the picture on the compute thread and applies the result as one edit.
 */
import type { MapDoc } from "./doc.ts";
import { MATERIALS } from "./battle.ts";
import { citySpec } from "./city.ts";
import { CitySpace } from "./cityPlan.ts";

type Pt = [number, number];

/** Where to look in the picture for each kind of ground: middles of cells of it that nothing stands on, at most `per` a kind, spread over the map (metres). */
export function groundSamplePoints(doc: MapDoc, per = 3000): { material: number; points: Pt[] }[] {
  const sp = citySpec(doc), c = sp.cellM, hf = doc.height, W = hf.w, H = hf.h, data = hf.data;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i++) { const m = Math.round(data[i]); if (m > 0) counts.set(m, (counts.get(m) ?? 0) + 1); }
  const space = new CitySpace(doc), seen = new Map<number, number>(), out = new Map<number, Pt[]>();
  // (a ring of cells is kept clear of buildings: a picture draws their shadows there)
  const halo = Math.max(2, c);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = Math.round(data[y * W + x]), n = counts.get(m);
    if (!n || m <= 0 || m >= MATERIALS.length) continue;
    const step = Math.max(1, Math.floor(n / per)), k = seen.get(m) ?? 0;
    seen.set(m, k + 1);
    if (k % step) continue;
    const px = (x + 0.5) * c, py = (y + 0.5) * c, probe: Pt[] = [[px - halo, py - halo], [px + halo, py - halo], [px + halo, py + halo], [px - halo, py + halo]];
    if (space.onBuilding(probe, 0) || space.onStreet(probe, 0.5) || space.onWall(probe, 0.5) || space.inWood([[px - 0.2, py - 0.2], [px + 0.2, py - 0.2], [px, py + 0.2]])) continue;
    const list = out.get(m) ?? [];
    list.push([px, py]);
    out.set(m, list);
  }
  return [...out].map(([material, points]) => ({ material, points }));
}

/**
 * The colour of each kind of ground in a picture: the middle value of each channel over its points (picture px; each the average of the 3 x 3 pixels round it),
 * leaving out the darkest quarter (the drawing's lines, shadows and small things on the ground); and its light and dark shades (the middle of the lightest
 * and of the darkest quarter of what is left), for the kind's gradient. Kinds with fewer than `min` points in the picture are left out.
 */
export function sampleGroundColours(img: { w: number; h: number; data: Uint8Array | Uint8ClampedArray }, groups: { material: number; points: Pt[] }[], min = 25): { material: number; rgb: [number, number, number]; light: [number, number, number]; dark: [number, number, number]; n: number }[] {
  const out: { material: number; rgb: [number, number, number]; light: [number, number, number]; dark: [number, number, number]; n: number }[] = [];
  for (const g of groups) {
    const px: [number, number, number][] = [];
    for (const [fx, fy] of g.points) {
      const x = Math.round(fx), y = Math.round(fy);
      if (x < 1 || y < 1 || x >= img.w - 1 || y >= img.h - 1) continue;
      let r = 0, gg = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const o = ((y + dy) * img.w + x + dx) * 4; r += img.data[o]; gg += img.data[o + 1]; b += img.data[o + 2]; }
      px.push([r / 9, gg / 9, b / 9]);
    }
    if (px.length < min) continue;
    px.sort((a, b) => 0.3 * a[0] + 0.59 * a[1] + 0.11 * a[2] - (0.3 * b[0] + 0.59 * b[1] + 0.11 * b[2]));
    const kept = px.slice(Math.floor(px.length / 4)), q = Math.max(1, Math.floor(kept.length / 4));
    const med = (set: [number, number, number][], ch: number) => { const v = set.map((p) => p[ch]).sort((a, b) => a - b); return Math.round(v[v.length >> 1]); };
    const of = (set: [number, number, number][]): [number, number, number] => [med(set, 0), med(set, 1), med(set, 2)];
    out.push({ material: g.material, rgb: of(kept), light: of(kept.slice(kept.length - q)), dark: of(kept.slice(0, q)), n: px.length });
  }
  return out;
}

/** "#rrggbb" for a colour. */
export const groundHex = (rgb: readonly number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
