/**
 * Claude's tools for the trace picture: one of the map's reference pictures laid over the map (or the battlemap level being worked on),
 * see-through, to redraw a map found elsewhere on top of it. It is a layout aid, never part of the map: no export draws it, and previews
 * show it only when asked (render_preview / render_battlemap with trace: true, see `traceOverlay`).
 */
import { z } from "zod";
import {
  IMAGE_HEAD_BYTES, type MapDoc, type RGBAImage, type TracePicture, battleSpec, citySpec, cleanTrace, fitTrace, imageSize, isBattle, isCity, overlayTrace, traceFromPins, traceSummary,
} from "@mapmaker/core";
import { decodeImage } from "./images.ts";
import type { ToolContext, ToolDef, ToolResult } from "./tools.ts";

function define<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 1));
const fail = (t: string): ToolResult => ({ ...text(t), isError: true });

/** The map's size and units: map px on a world map, squares on a battlemap, metres on a city map. */
function mapUnits(doc: MapDoc): { w: number; h: number; units: string } {
  if (isCity(doc)) { const sp = citySpec(doc); return { w: sp.widthM, h: sp.heightM, units: "metres" }; }
  if (isBattle(doc)) { const sp = battleSpec(doc); return { w: sp.squaresX, h: sp.squaresY, units: "squares" }; }
  return { w: doc.meta.width, h: doc.meta.height, units: "map px" };
}

const LOCKED = "The DM has locked the trace picture in place. Ask them to unlock it (the lock in the trace bar under the map) if it should move.";
const Pt = z.tuple([z.number(), z.number()]);

export const TRACE_TOOLS = [
  define({
    name: "get_trace_picture",
    description: "Where the trace picture lies, if there is one: which reference picture, its size, where its corners are on the map (map px on a world map, squares on a battlemap level), its scale and turn, and whether the DM locked it.",
    schema: z.object({}),
    async run(ctx) {
      const doc = ctx.session().doc, t = doc.features?.trace;
      return t ? json(traceSummary(t, mapUnits(doc).units)) : text("There is no trace picture on this map. set_trace_picture lays one of the reference pictures over it.");
    },
  }),

  define({
    name: "set_trace_picture",
    description:
      "Lay one of the reference pictures (list_references) over the map, see-through, so the map can be redrawn on top of it (on a battlemap, over the level being worked on). Use it when the DM asks to trace or recreate a map from a picture. " +
      "With only a name it is fitted inside the map. To line it up, give pins: two points, each where it is on the picture (the picture's own pixels, as view_reference shows them) and where it belongs on the map (map px, or squares on a battlemap); " +
      "the picture is moved, sized and turned (never stretched) to match. Or give x, y (its top-left corner on the map), scale (map units per picture pixel) and rotation (degrees clockwise). " +
      "Check the result with render_preview / render_battlemap and trace: true. The picture is never exported. Don't move a picture the DM has lined up unless they ask.",
    schema: z.object({
      name: z.string().min(1).describe("The reference picture's name"),
      pins: z.array(z.object({ picture: Pt, map: Pt })).length(2).optional().describe("Two matched points, far apart"),
      x: z.number().optional(),
      y: z.number().optional(),
      scale: z.number().positive().optional(),
      rotation: z.number().min(-360).max(360).optional(),
    }),
    async run(ctx, i) {
      const doc = ctx.session().doc, old = doc.features?.trace;
      if (old?.locked) return fail(LOCKED);
      const refs = await ctx.listRefs();
      const ref = refs.find((r) => r.name === i.name) ?? refs.find((r) => r.name.toLowerCase() === i.name.toLowerCase());
      if (!ref) return fail(`There is no reference picture called "${i.name}". list_references shows them; the DM adds pictures in the References panel.`);
      const bytes = await ctx.readRef(ref.name);
      const size = bytes && imageSize(bytes.subarray(0, IMAGE_HEAD_BYTES));
      if (!size) return fail(`"${ref.name}" can't be read as a picture.`);
      const { w, h, units } = mapUnits(doc);
      const base = { ref: ref.name, w: size.w, h: size.h };
      let t: TracePicture;
      if (i.pins) {
        const r = traceFromPins(base, [i.pins[0], i.pins[1]]);
        if ("error" in r) return fail(r.error);
        t = r;
      } else {
        t = old && old.ref === ref.name && old.w === size.w && old.h === size.h ? { ...old } : fitTrace(base, w, h);
        if (i.x !== undefined) t.x = i.x;
        if (i.y !== undefined) t.y = i.y;
        if (i.scale !== undefined) t.scale = i.scale;
        if (i.rotation !== undefined) t.rotation = i.rotation;
      }
      const clean = cleanTrace(t, w, h);
      if (!clean) return fail(`That would put the picture far off the map or make it absurdly big or small (the map is ${w} x ${h} ${units}).`);
      const r = ctx.execute({ op: "features", patch: { setTrace: clean }, label: `Trace picture ${ref.name}` });
      return json({ change: r.seq, ...traceSummary(clean, units) });
    },
  }),

  define({
    name: "clear_trace_picture",
    description: "Take the trace picture off the map (the reference picture itself stays in the References panel). Only when the DM asks.",
    schema: z.object({}),
    async run(ctx) {
      const t = ctx.session().doc.features?.trace;
      if (!t) return text("There is no trace picture on this map.");
      if (t.locked) return fail(LOCKED);
      const r = ctx.execute({ op: "features", patch: { setTrace: null }, label: `Stop tracing ${t.ref}` });
      return json({ change: r.seq, removed: t.ref });
    },
  }),
];

/** The last decoded trace picture (decoding a big photo for every preview would be slow). */
let decoded: { key: string; img: RGBAImage } | null = null;

/**
 * For the preview tools' trace: true: draw the map's trace picture see-through over a preview `img` that shows `region` (full-render px,
 * `unitPx` of them per map unit) at `scale`. Returns a note for Claude.
 */
export async function traceOverlay(ctx: ToolContext, img: RGBAImage, region: { x: number; y: number }, scale: number, unitPx: number): Promise<string> {
  const t = ctx.session().doc.features?.trace;
  if (!t) return ", no trace picture to draw (set_trace_picture lays one over the map)";
  const bytes = await ctx.readRef(t.ref);
  if (!bytes) return `, the trace picture ${t.ref} is missing from the references`;
  const key = `${t.ref}:${bytes.byteLength}`;
  if (decoded?.key !== key) {
    const pic = decodeImage(bytes);
    if (!pic) return `, the trace picture ${t.ref} can't be read`;
    decoded = { key, img: pic };
  }
  overlayTrace(img, decoded.img, t, { unitPx, region, scale }, 0.5);
  return `, the trace picture ${t.ref} drawn half see-through on top`;
}
