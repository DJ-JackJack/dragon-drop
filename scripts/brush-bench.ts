// pnpm bench:brush [size]: where a brush stroke's time goes, on a generated world map (2048 a side unless given): a sculpt dab on the server, painting the
// patch it changed, the whole climate and rivers worked out again (what follows a Ground stroke and the end of a sculpt stroke), the painted ground's
// planes, the frame sent to the editor, finding what changed, and a whole-map repaint. Times in ms (median of the runs). docs/BRUSH-SPEED.md has the
// numbers from 2026-11-26 and the plan they led to. (A 2048 map needs a few GB: NODE_OPTIONS=--max-old-space-size=8192 if it runs out.)
import {
  MapSession, PaintEngine, buildClimateNoise, buildNoiseCache, computeDerived, createDoc, decodeRealmCells, derivedChange, encodeRealmCells, generateTerrain,
  groundCode, groundGridOf, groundPaintPlanes, packDerived, paintRealmCells, renderPainted, cropGroundPlanes, groundPlanesBox,
} from "../packages/core/src/index.ts";
import { type Waiting, addRect } from "../apps/editor/src/rectQueue.ts";

const N = Number(process.argv[2] ?? 2048);
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const time = (f: () => void, runs = 5) => { const t: number[] = []; for (let i = 0; i < runs; i++) { const s = performance.now(); f(); t.push(performance.now() - s); } return Math.round(med(t) * 10) / 10; };
const out: Record<string, number | string> = { map: `${N} x ${N}` };

const doc = createDoc({ id: "b", name: "Bench", width: N, height: N, kmPerPx: 1, seed: 5 });
doc.meta.style = "painted";
generateTerrain(doc, { template: "continent", seed: 5 } as never);
const cn = buildClimateNoise(N, N, 5);
let s = performance.now();
const noise = buildNoiseCache(N, N, 5);
out.noise_build_once = Math.round(performance.now() - s);

out.climate_and_rivers = time(() => computeDerived(doc, cn, 0), 2);
const d0 = computeDerived(doc, cn, 0);

// a ground painted by hand over part of the map
const g = groundGridOf(doc), cells = decodeRealmCells(g);
paintRealmCells(cells, g, { n: groundCode("desert"), circle: { x: N / 2, y: N / 2, r: N / 6 } });
doc.features = { places: [], labels: [], groundCells: encodeRealmCells(g, cells) };
out.ground_planes = time(() => groundPaintPlanes(doc), 5);
const d1 = computeDerived(doc, cn, 0);
out.climate_with_painted_ground = time(() => computeDerived(doc, cn, 0), 2);
const packed = packDerived(d1 as never);
out.frame_MB = Math.round((packed.byteLength / 1e6) * 10) / 10;
out.pack_frame = time(() => packDerived(d1 as never), 3);
out.find_what_changed = time(() => derivedChange(d0, d1), 3);

// sculpt dabs on the server (the session's execute: the edit and its undo)
const session = new MapSession(doc);
for (const r of [20, 60, 150]) {
  const t: number[] = [];
  session.begin("user", "bench");
  for (let i = 0; i < 15; i++) {
    const x = N / 2 + (i - 7) * r * 0.3, y = N / 3;
    const st = performance.now();
    session.execute({ op: "sculpt", params: { mode: "raise", shape: { type: "circle", x, y, r }, amountM: 80, strength: 0.5, falloff: 0.6 } } as never, "user");
    t.push(performance.now() - st);
  }
  session.commit();
  out[`sculpt_dab_r${r}`] = Math.round(med(t) * 10) / 10;
}

// painting the patch a dab changed (what the editor's paint worker does for each dab)
const eng = new PaintEngine(N, N, doc.height.data);
eng.setNoise(noise);
eng.setDerived(d1);
const view = { mode: "painted" as const, meta: doc.meta, hillshade: true, rivers: true };
for (const r of [20, 60, 150]) {
  const pad = 4, rect = { x: Math.round(N / 2 - r - pad), y: Math.round(N / 3 - r - pad), w: 2 * (r + pad), h: 2 * (r + pad) };
  out[`paint_patch_r${r}`] = time(() => eng.tile(rect, view), 5);
}
// stage 1: a stroke of 16 dabs at radius 60, 0.3 r apart, painted dab by dab (before) and as the paint worker now paints it (waiting patches joined)
const dabRect = (x: number, y: number, r: number) => ({ x: Math.round(x - r - 1), y: Math.round(y - r - 1), w: 2 * r + 2, h: 2 * r + 2 });
const stroke = Array.from({ length: 16 }, (_, i) => dabRect(N / 2 - 150 + i * 18, N / 3, 60));
out.stroke_r60_dab_by_dab = time(() => { for (const r of stroke) eng.tile(r, view); }, 3);
out.stroke_r60_joined = time(() => { let w: Waiting[] = []; for (const r of stroke) w = addRect(w, r); for (const x of w) eng.tile(x.r, view); }, 3);
// stage 1: a Ground stroke now works out only its planes and the box that changed, and sends that box
const before = groundPaintPlanes(doc);
paintRealmCells(cells, g, { n: groundCode("moor"), circle: { x: N / 3, y: (2 * N) / 3, r: 60 } });
doc.features = { places: [], labels: [], groundCells: encodeRealmCells(g, cells) };
let box: ReturnType<typeof groundPlanesBox> = null, after: ReturnType<typeof groundPaintPlanes> = null;
out.ground_stroke_now = time(() => { after = groundPaintPlanes(doc); box = groundPlanesBox(before, after, N, N); }, 3);
out.ground_frame_KB = box ? Math.round(cropGroundPlanes(after, N, box).byteLength / 1024) : 0;
const px = new Uint8ClampedArray(N * N * 4);
out.whole_map_repaint = time(() => renderPainted(doc, d1, noise, null, px), 1);
console.log(JSON.stringify(out, null, 1));
