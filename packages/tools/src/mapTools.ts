/**
 * Claude's tools for maps that know about each other: copying a map to change the copy (the same place before and after), comparing two maps (a picture of the same area
 * of both, and what is different in words), and where a point of one map lies on another (and how far apart two points on different maps are). Looking at another map
 * without opening it is the `map` option of the look-only tools (see runTool in tools.ts). Core: mapLinks.ts, mapDiff.ts.
 */
import { z } from "zod";
import {
  type Features, type LinkedMap, type MapDoc, type RGBAImage, type Rect, cropScale, isBattle, distanceAcross, drawLabel, drawRivers, mapDifferences, mapKindOf, mapSize, mapTransform, reliefPicture,
  pointOnMap, rectOnMap, unitMetres, unitName,
} from "@mapmaker/core";
import type { ToolContext } from "./tools.ts";
import { define, fail, json } from "./toolKit.ts";
import { encodeJpeg, toBase64 } from "./images.ts";

const Region = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The open map's context, or another map's (read only). */
async function contextFor(ctx: ToolContext, map: string | undefined): Promise<ToolContext> {
  if (!map) return ctx;
  if (!ctx.peek) throw new Error("Looking at another map isn't available here.");
  return ctx.peek(map);
}

/** A named thing on a map and where it is, in the map's units: a place, a label, or (on a city) a named building or street; (on a battlemap) a note. */
function findNamed(f: Features | undefined, doc: MapDoc, name: string): { x: number; y: number; what: string } | null {
  const q = name.trim().toLowerCase();
  const p = f?.places.find((x) => x.id === name || x.name.toLowerCase() === q);
  if (p) return { x: p.x, y: p.y, what: `the ${p.type} ${p.name}` };
  const l = f?.labels.find((x) => x.id === name || x.text.toLowerCase() === q);
  if (l) return { x: l.x, y: l.y, what: `the label ${l.text}` };
  const b = f?.buildings?.find((x) => x.id === name || (x.name ?? "").toLowerCase() === q);
  if (b && b.points.length) {
    const cx = b.points.reduce((s, pt) => s + pt[0], 0) / b.points.length, cy = b.points.reduce((s, pt) => s + pt[1], 0) / b.points.length;
    return { x: cx, y: cy, what: `the building ${b.name ?? b.id}` };
  }
  const s = f?.streets?.find((x) => x.id === name || (x.name ?? "").toLowerCase() === q);
  if (s && s.points.length) { const m = s.points[Math.floor(s.points.length / 2)]; return { x: m[0], y: m[1], what: `the street ${s.name ?? s.id}` }; }
  const n = f?.notes?.find((x) => x.id === name || x.title.toLowerCase() === q || String(x.n) === q);
  if (n) return { x: n.x, y: n.y, what: `note ${n.n} (${n.title})` };
  void doc;
  return null;
}

/** A point on a map: x, y in its units, or a named thing on it. */
async function pointOf(c: ToolContext, p: { x?: number; y?: number; place?: string }): Promise<{ x: number; y: number; what: string } | string> {
  const doc = c.session().doc;
  if (p.place) return findNamed(doc.features, doc, p.place) ?? `Nothing named "${p.place}" on ${doc.meta.name} (places, labels, named buildings and streets count).`;
  if (p.x !== undefined && p.y !== undefined) return { x: p.x, y: p.y, what: `(${r1(p.x)}, ${r1(p.y)})` };
  return "";
}

/**
 * With no area asked for, the part of the first map that the other covers too, so both pictures show the same place: a detail map's area of its world map, the whole map for a
 * copy. An area smaller than a sixteenth of the first map (a battlemap's spot on a world map is a fraction of a pixel) is widened round its middle to that, inside the map.
 */
export function overlapOn(ma: LinkedMap, mb: LinkedMap, sa: { w: number; h: number }, sb: { w: number; h: number }, maps: ReadonlyMap<string, LinkedMap>): Rect {
  const whole = { x: 0, y: 0, w: sa.w, h: sa.h };
  const b = rectOnMap(mb, ma, { x: 0, y: 0, w: sb.w, h: sb.h }, maps);
  if (!b) return whole;
  const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(sa.w, b.x + b.w), y1 = Math.min(sa.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return whole;
  const min = Math.min(sa.w, sa.h) / 16, w = Math.max(min, x1 - x0), h = Math.max(min, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const x = Math.min(Math.max(0, cx - w / 2), sa.w - w), y = Math.min(Math.max(0, cy - h / 2), sa.h - h);
  return { x, y, w, h };
}

/** A map's picture, the area `r` of it (its units), at most `maxPx` across, with its name written in the corner. */
async function pictureOf(c: ToolContext, r: Rect, maxPx: number, title: string, relief = false): Promise<RGBAImage> {
  const doc = c.session().doc;
  const lakeRiv = relief ? await c.derived?.() : undefined;
  const full = relief ? { img: reliefPicture(doc, lakeRiv?.lakes), rivers: lakeRiv?.rivers ?? [] } : c.render ? await c.render() : null;
  if (!full) throw new Error("Pictures of maps aren't available here.");
  const size = mapSize(doc.meta), k = full.img.w / size.w;
  const px = { x: Math.max(0, r.x * k), y: Math.max(0, r.y * k), w: Math.min(full.img.w, r.w * k), h: Math.min(full.img.h, r.h * k) };
  const { img, scale } = cropScale(full.img, px, maxPx);
  if (full.rivers.length) drawRivers(img, px, scale, full.rivers);
  drawLabel(img, title, 6, 6, 1, true);
  return img;
}

/**
 * Land and sea of two linked world maps over an area of the first (`f` turns its px into the other's): each one's share of land, how well they match (land in both over land in
 * either), and (`maxPx` > 0) a picture of it: grey-green land in both, blue sea in both, red land only in the first, orange land only in the other.
 */
function landMatch(a: MapDoc, b: MapDoc, r: Rect, f: { s: number; x: number; y: number }, maxPx: number): { shareA: number; shareB: number; match: number; img?: RGBAImage } {
  const W = a.height.w, bw = b.height.w, bh = b.height.h, ha = a.height.data, hb = b.height.data, seaA = a.meta.seaLevel, seaB = b.meta.seaLevel;
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(a.height.h, Math.ceil(r.y + r.h));
  const w = x1 - x0, h = y1 - y0, kinds = new Uint8Array(Math.max(0, w * h));
  let la = 0, lb = 0, both = 0, either = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const bx = Math.floor(f.s * (x + 0.5) + f.x), by = Math.floor(f.s * (y + 0.5) + f.y);
    if (bx < 0 || by < 0 || bx >= bw || by >= bh) continue;
    const A = ha[y * W + x] > seaA, B = hb[by * bw + bx] > seaB;
    n++; if (A) la++; if (B) lb++; if (A && B) both++; if (A || B) either++;
    kinds[(y - y0) * w + (x - x0)] = A && B ? 1 : A ? 2 : B ? 3 : 4;
  }
  const out: { shareA: number; shareB: number; match: number; img?: RGBAImage } = { shareA: r3(la / Math.max(1, n)), shareB: r3(lb / Math.max(1, n)), match: r3(either ? both / either : 1) };
  if (maxPx > 0 && w > 0 && h > 0) {
    const COL: Record<number, [number, number, number]> = { 0: [30, 30, 34], 1: [126, 146, 104], 2: [214, 70, 52], 3: [240, 176, 52], 4: [44, 74, 122] };
    const full: RGBAImage = { w, h, data: new Uint8ClampedArray(w * h * 4) };
    for (let i = 0; i < kinds.length; i++) { const c = COL[kinds[i]]; full.data[i * 4] = c[0]; full.data[i * 4 + 1] = c[1]; full.data[i * 4 + 2] = c[2]; full.data[i * 4 + 3] = 255; }
    const img = cropScale(full, { x: 0, y: 0, w, h }, maxPx).img;
    drawLabel(img, `land in both / sea in both / only ${a.meta.name} (red) / only ${b.meta.name} (orange)`, 6, 6, 1, true);
    out.img = img;
  }
  return out;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function sideBySide(a: RGBAImage, b: RGBAImage): RGBAImage {
  const gap = 8, w = a.w + gap + b.w, h = Math.max(a.h, b.h);
  const out = { w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) };
  for (const [img, ox] of [[a, 0], [b, a.w + gap]] as const) for (let y = 0; y < img.h; y++) out.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), (y * w + ox) * 4);
  return out;
}

const metresWords = (m: number) => (m >= 1000 ? `${r1(m / 1000).toLocaleString("en")} km (${r1(m / 1609.344).toLocaleString("en")} mi)` : `${Math.round(m)} m (${Math.round(m / 0.3048)} ft)`);

export const MAP_TOOLS = [
  define({
    name: "duplicate_map",
    description:
      "Copy a map under a new name, to make a changed version of it: the same place before and after (a farmhouse before and after a fire, a town before and after a siege, a coast before and after a flood). " +
      "Everything is copied (the land or the floors, every level of a battlemap, places, walls, doors, lights, objects, buildings, the brief, reference pictures) except the original's checkpoints and history. " +
      "The copy remembers its original, lies exactly over it, and is opened (open: false keeps the open map). Then change the copy; compare_maps shows what is different. The original is never changed. Only when the DM asks for a copy.",
    schema: z.object({
      name: z.string().min(1).max(80).describe("The copy's name, e.g. \"Farmhouse after the fire\""),
      from: z.string().optional().describe("The map to copy (id or name); default the open map"),
      open: z.boolean().optional().describe("Open the copy (default true)"),
    }),
    async run(ctx, i) {
      if (!ctx.duplicateMap) return fail("Copying maps isn't available here.");
      const r = await ctx.duplicateMap({ name: i.name, from: i.from, open: i.open });
      return json({ copied: r.from, as: { id: r.id, name: r.name }, opened: i.open !== false, note: "The copy is the same as the original until you change it. compare_maps with the original shows what is different." });
    },
  }),

  define({
    name: "compare_maps",
    description:
      "Compare two maps: a picture of the same area of both, side by side, and what is different in words. The first map is the open one unless `with` names another; `map` is the other. " +
      "For a map and its copy (before and after) or two maps of the same kind and size, it lists every difference: the land (raised, lowered, coast moved) on world maps; floors on battlemaps, ground on city maps; and, matched by id, places, labels, roads, " +
      "climate regions, river sources, walls and doors, lights, objects, roofs, notes, buildings, streets, city walls and districts (added, removed, moved, changed). " +
      "Linked maps of different scales (a detail map and its world map, a battlemap or city made from a spot) are lined up: the pictures show the same area of each. Unlinked maps are shown whole. " +
      "region: an area of the first map (its units: map px, squares or metres). For two world maps that are linked it also gives each one's share of land and how well the coasts " +
      "match (coast_match: land in both / land in either, 1 = the same), and overlay: true adds a third picture of land and sea: grey-green land in both, blue sea in both, red land only in " +
      "the first map, orange land only in the other. relief: true draws both in plain relief (the shape of the land, whatever the style and climate).",
    schema: z.object({
      map: z.string().describe("The other map (id or name)"),
      with: z.string().optional().describe("The first map (id or name); default the open map"),
      region: Region.optional().describe("Only this area of the first map, in its units"),
      max_size: z.number().int().min(512).max(1568).optional().describe("Width of the side-by-side picture (default 1400)"),
      overlay: z.boolean().optional().describe("World maps: add a picture of where land and sea differ (default false)"),
      relief: z.boolean().optional().describe("World maps: draw both in plain relief (default false)"),
    }),
    async run(ctx, i) {
      if (!ctx.linkedMaps || !ctx.peek) return fail("Comparing maps isn't available here.");
      const ca = await contextFor(ctx, i.with);
      // on a battlemap with levels, the same level of the other map (a copy has the original's levels), else its first
      const level = ca === ctx && isBattle(ca.session().doc) && ctx.levels ? ctx.levels.list() : null;
      const onLevel = level && level.levels.length > 1 ? level.levels.find((l) => l.id === level.active) : undefined;
      const cb = await ctx.peek(i.map, onLevel?.id);
      const a = ca.session().doc, b = cb.session().doc;
      if (a.meta.id === b.meta.id) return fail("That is the same map twice: give two different maps.");
      const maps = await ctx.linkedMaps();
      const ma: LinkedMap = maps.get(a.meta.id) ?? a.meta, mb: LinkedMap = maps.get(b.meta.id) ?? b.meta;
      const t = mapTransform(ma, mb, maps);
      const sa = mapSize(a.meta), sb = mapSize(b.meta);
      const ra = i.region ?? (t ? overlapOn(ma, mb, sa, sb, maps) : { x: 0, y: 0, w: sa.w, h: sa.h });
      const rb = t ? rectOnMap(ma, mb, ra, maps)! : { x: 0, y: 0, w: sb.w, h: sb.h };
      const half = Math.floor((i.max_size ?? 1400) / 2) - 4;
      const relief = !!i.relief && mapKindOf(a.meta) === "world" && mapKindOf(b.meta) === "world";
      const [pa, pb] = [await pictureOf(ca, ra, half, `A: ${a.meta.name}`, relief), await pictureOf(cb, rb, half, `B: ${b.meta.name}`, relief)];
      const land = t && mapKindOf(a.meta) === "world" && mapKindOf(b.meta) === "world" ? landMatch(a, b, ra, t.f, i.overlay ? half * 2 : 0) : null;
      const sameKind = mapKindOf(a.meta) === mapKindOf(b.meta);
      // a copy and its original read as before and after, whichever of the two is open; any other pair reads from the first map to the other
      const bIsOriginal = a.meta.copiedFrom?.id === b.meta.id;
      const [from, to] = bIsOriginal ? [b, a] : [a, b];
      const diff = sameKind && t?.sameFrame ? mapDifferences(from, to, { region: i.region }) : null;
      const reading = bIsOriginal || b.meta.copiedFrom?.id === a.meta.id
        ? `Before: ${from.meta.name} (the original). After: ${to.meta.name} (the copy).`
        : `From ${from.meta.name} (A) to ${to.meta.name} (B).`;
      const facts = {
        a: { id: a.meta.id, name: a.meta.name, kind: mapKindOf(a.meta), area: { ...ra, units: unitName(a.meta) } },
        b: { id: b.meta.id, name: b.meta.name, kind: mapKindOf(b.meta), area: { x: r1(rb.x), y: r1(rb.y), w: r1(rb.w), h: r1(rb.h), units: unitName(b.meta) } },
        linked: t ? (t.how.length ? t.how : ["the same map"]) : ["not linked: each is shown whole"],
        ...(onLevel && { level: `${onLevel.name}: the level of the same id on the other map, or its first level if it has none` }),
        ...(land && { land_share_a: land.shareA, land_share_b: land.shareB, coast_match: land.match }),
        differences: diff ? [reading, ...diff.words] : !sameKind ? [`Different kinds of map (${mapKindOf(a.meta)} and ${mapKindOf(b.meta)}): compared by picture only.`] : ["Not the same area at the same scale: compared by picture only (copies and maps of the same size are compared point by point)."],
      };
      const jpg = encodeJpeg(sideBySide(pa, pb));
      const pics = [jpg, ...(land?.img ? [encodeJpeg(land.img)] : [])];
      const display = ctx.savePreview ? await Promise.all(pics.map((p) => ctx.savePreview!(p))) : undefined;
      return { content: [{ type: "text", text: JSON.stringify(facts, null, 1) }, ...pics.map((p) => ({ type: "image" as const, mediaType: "image/jpeg" as const, data: toBase64(p) }))], display };
    },
  }),

  define({
    name: "where_on_map",
    description:
      "Where a point of one map lies on another, and how far apart two points on different maps are, for maps that are linked: a detail map and its world map, a battlemap or city made from a spot (and a battlemap made in a city made on a world map), a copy and its original. " +
      "E.g. where this battlemap is on the world map, how far the farmhouse is from the capital, which way the river on the world map runs past this scene. Points are x, y in each map's units (map px, squares, metres) or a name (a place, label, named building or street). " +
      "Without a point on `to`, it says where `from` lies on it; with one, also the distance between the two.",
    schema: z.object({
      from: z.object({ map: z.string().optional().describe("Default the open map"), x: z.number().optional(), y: z.number().optional(), place: z.string().optional() }),
      to: z.object({ map: z.string(), x: z.number().optional(), y: z.number().optional(), place: z.string().optional() }),
    }),
    async run(ctx, i) {
      if (!ctx.linkedMaps || !ctx.peek) return fail("Looking across maps isn't available here.");
      const cf = await contextFor(ctx, i.from.map), ct = await ctx.peek(i.to.map);
      const df = cf.session().doc, dt = ct.session().doc;
      const maps = await ctx.linkedMaps();
      const mf: LinkedMap = maps.get(df.meta.id) ?? df.meta, mt: LinkedMap = maps.get(dt.meta.id) ?? dt.meta;
      const t = mapTransform(mf, mt, maps);
      if (!t) return fail(`${df.meta.name} and ${dt.meta.name} aren't linked (neither was made from the other, nor from a map the other was made from), so where one lies on the other isn't known.`);
      const from = await pointOf(cf, i.from);
      if (typeof from === "string" && from) return fail(from);
      const sf = mapSize(mf), whole = !from || typeof from === "string";
      const fp = whole ? { x: sf.w / 2, y: sf.h / 2, what: `the middle of ${df.meta.name}` } : from;
      const on = pointOnMap(mf, mt, fp.x, fp.y, maps)!;
      const out: Record<string, unknown> = {
        from: { map: df.meta.name, point: fp.what, x: r1(fp.x), y: r1(fp.y), units: unitName(mf) },
        on: { map: dt.meta.name, x: r1(on.x), y: r1(on.y), units: unitName(mt), inside: on.inside },
        linked: t.how.length ? t.how : ["the same map"],
      };
      if (whole) {
        const r = rectOnMap(mf, mt, { x: 0, y: 0, w: sf.w, h: sf.h }, maps)!;
        out.all_of_it_on = { x: r1(r.x), y: r1(r.y), w: Math.round(r.w * 1000) / 1000, h: Math.round(r.h * 1000) / 1000, units: unitName(mt), note: r.w < 1 && unitName(mt) === "map px" ? "smaller than one map pixel there" : undefined };
      }
      if (i.to.place || (i.to.x !== undefined && i.to.y !== undefined)) {
        const to = await pointOf(ct, i.to);
        if (typeof to === "string") return fail(to);
        const m = distanceAcross(mf, [fp.x, fp.y], mt, [to.x, to.y], maps)!;
        out.to = { point: to.what, x: r1(to.x), y: r1(to.y) };
        out.distance = metresWords(m);
        out.distance_m = Math.round(m * 10) / 10;
        const dx = to.x - on.x, dy = to.y - on.y;
        if (Math.hypot(dx, dy) > 1e-9) out.direction_from_first = compass(dx, dy);
      }
      out.scale = `one ${unitName(mf).replace(/s$/, "")} of ${df.meta.name} is ${metresWords(unitMetres(mf))}; one of ${dt.meta.name} is ${metresWords(unitMetres(mt))}`;
      return json(out);
    },
  }),
];

/** Which way (north up) from one point to another. */
function compass(dx: number, dy: number): string {
  const names = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  return names[((Math.round(a / 45) % 8) + 8) % 8];
}

export const MAP_TOOL_NAMES = MAP_TOOLS.map((t) => t.name);
