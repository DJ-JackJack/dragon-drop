/**
 * A city map as a picture (for Claude's previews and for exports): the ground, the streets, then the buildings drawn as roofs. The editor draws the same things as vectors on
 * its canvas (CityView), with the same colours (`buildingColour`).
 */
import { type MapDoc } from "./doc.ts";
import { MATERIALS } from "./battle.ts";
import { type LookImage, lookKit } from "./battleLook.ts";
import { type RoofTileSource, paintRoofsInto } from "./battleRoof.ts";
import { type CitySpec, buildingToRoof, citySpec } from "./city.ts";
import { type Rect, distToSegment } from "./geom.ts";
import type { RGBAImage } from "./render.ts";

const { clamp, vnoise, over } = lookKit;

export interface CityRenderOptions {
  /** The part of the city to draw, in metres (default: all of it). */
  region?: Rect;
  /** The longest side of the picture in pixels (default 1024). */
  maxSize?: number;
  /** Leave the buildings out (to see the ground and streets). */
  buildings?: boolean;
  /** The decoded roof pictures of the asset packs, by asset id (a building with a roof picture is drawn with it, or with its look when this has none for it). */
  tileFor?: RoofTileSource;
}

export interface CityRender {
  img: RGBAImage;
  /** Pixels per metre. */
  px: number;
  /** The part of the city the picture shows, in metres (the region asked for, clipped to the map and to whole pixels). */
  region: Rect;
}

/** The street surface and its edge. */
export const STREET_SURFACE: [number, number, number] = [206, 196, 170];
export const STREET_EDGE: [number, number, number] = [96, 88, 74];

/** Pixels per metre for a picture of `maxSize` px showing a region of w x h metres (at most 20: a house of 6 m is then 120 px, as close as a preview needs to go). */
export function cityPx(w: number, h: number, maxSize: number): number {
  return Math.min(20, Math.max(0.01, maxSize / Math.max(w, h)));
}

/** Draw the city (or a region of it). */
export function renderCity(doc: MapDoc, o: CityRenderOptions = {}): CityRender {
  const spec = citySpec(doc);
  const want = o.region ?? { x: 0, y: 0, w: spec.widthM, h: spec.heightM };
  const rx = Math.max(0, Math.min(spec.widthM - 1, want.x)), ry = Math.max(0, Math.min(spec.heightM - 1, want.y));
  const rw = Math.max(1, Math.min(spec.widthM - rx, want.w)), rh = Math.max(1, Math.min(spec.heightM - ry, want.h));
  const px = cityPx(rw, rh, o.maxSize ?? 1024);
  const OX = Math.round(rx * px), OY = Math.round(ry * px);
  const W = Math.max(1, Math.round(rw * px)), H = Math.max(1, Math.round(rh * px));
  const img: LookImage = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  paintGround(doc, spec, img, OX, OY, px);
  paintStreets(doc, img, OX, OY, px);
  if (o.buildings !== false) {
    const have = (a: string) => !!o.tileFor?.(a);
    const roofs = (doc.features?.buildings ?? []).filter((b) => touches(b.points, OX / px, OY / px, (OX + W) / px, (OY + H) / px)).map((b) => buildingToRoof(b, b.asset ? have(b.asset) : true));
    paintRoofsInto(img, OX, OY, Math.round(spec.widthM * px), Math.round(spec.heightM * px), px, roofs, { shadow: px >= 0.6, ...(o.tileFor && { tileFor: o.tileFor }) });
  }
  return { img, px, region: { x: OX / px, y: OY / px, w: W / px, h: H / px } };
}

function touches(points: [number, number][], x0: number, y0: number, x1: number, y1: number): boolean {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of points) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return c >= x0 - 2 && a <= x1 + 2 && d >= y0 - 2 && b <= y1 + 2;
}

/** The colour of a ground material id (grass for anything unknown). */
function groundColours(): [number, number, number][] {
  return MATERIALS.map((m) => m.colour);
}

function paintGround(doc: MapDoc, spec: CitySpec, img: LookImage, OX: number, OY: number, px: number) {
  const cols = groundColours(), grass = cols[5];
  const { w: cw, h: ch, data } = doc.height, cell = spec.cellM;
  const colour = (cx: number, cy: number): [number, number, number] => {
    const id = data[Math.max(0, Math.min(ch - 1, cy)) * cw + Math.max(0, Math.min(cw - 1, cx))];
    return cols[Math.round(id)] ?? grass;
  };
  const d = img.data;
  for (let y = 0; y < img.h; y++) {
    const my = (OY + y + 0.5) / px, v = my / cell - 0.5, y0 = Math.floor(v), fy = v - y0;
    for (let x = 0; x < img.w; x++) {
      const mx = (OX + x + 0.5) / px, u = mx / cell - 0.5, x0 = Math.floor(u), fx = u - x0;
      // the four nearest cells blended, so the edge between two grounds is soft rather than blocky
      const a = colour(x0, y0), b = colour(x0 + 1, y0), c = colour(x0, y0 + 1), e = colour(x0 + 1, y0 + 1);
      const n = 0.96 + 0.08 * vnoise(mx / 3, my / 3); // (a little mottling, on the scale of a few metres)
      const o = (y * img.w + x) * 4;
      for (let k = 0; k < 3; k++) d[o + k] = clamp(((a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + e[k] * fx) * fy) * n, 0, 255);
      d[o + 3] = 255;
    }
  }
}

function paintStreets(doc: MapDoc, img: LookImage, OX: number, OY: number, px: number) {
  const streets = doc.features?.streets ?? [];
  if (!streets.length) return;
  const fill = new Float32Array(img.w * img.h), edge = new Float32Array(img.w * img.h);
  const edgeM = Math.max(0.35, 0.8 / px); // (the edge line is at least about a pixel wide)
  for (const s of streets) {
    const half = s.width / 2;
    for (let i = 0; i + 1 < s.points.length; i++) {
      const [ax, ay] = s.points[i], [bx, by] = s.points[i + 1];
      const reach = half + edgeM + 1 / px;
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) * px - OX)), x1 = Math.min(img.w - 1, Math.ceil((Math.max(ax, bx) + reach) * px - OX));
      const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) * px - OY)), y1 = Math.min(img.h - 1, Math.ceil((Math.max(ay, by) + reach) * px - OY));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dist = distToSegment((OX + x + 0.5) / px, (OY + y + 0.5) / px, ax, ay, bx, by);
          const i2 = y * img.w + x;
          const f = clamp((half - dist) * px + 0.5, 0, 1), e = clamp((half + edgeM - dist) * px + 0.5, 0, 1);
          if (f > fill[i2]) fill[i2] = f;
          if (e > edge[i2]) edge[i2] = e;
        }
      }
    }
  }
  const d = img.data;
  for (let i = 0; i < fill.length; i++) {
    if (edge[i] <= 0) continue;
    over(d, i * 4, STREET_EDGE[0], STREET_EDGE[1], STREET_EDGE[2], edge[i] * 0.8);
    if (fill[i] > 0) over(d, i * 4, STREET_SURFACE[0], STREET_SURFACE[1], STREET_SURFACE[2], fill[i]);
  }
}
