/**
 * The city picture reader in the editor: with the trace picture laid over a city, the DM picks what to read (buildings, streets or water), drags the area to read, clicks
 * examples of it (one roof of each kind, whose look is guessed from its colour and can be changed; a street; the water, deep or shallow) and what is not it (the ground between
 * the roofs, the roofs beside a street, the shore), presses Find, looks at what the server found (core cityReader.ts, read on its compute thread), and accepts it as one edit.
 * Everything here is in metres; the trace bar (TraceBar.tsx) holds the buttons, the city view (CityView.tsx) takes the clicks and draws the marks.
 */
import { type RoofStyle, type StreetKind, guessRoofLook, newFeatureId } from "@mapmaker/core";
import { sendCityFeatures } from "./cityUi.ts";
import { roofChoiceFor } from "./roofAssetsClient.ts";
import { store } from "./store.ts";

type Pt = [number, number];
type RGB = [number, number, number];

export type ReaderWhat = "buildings" | "streets" | "water";

export interface ReaderState {
  on: boolean;
  /** What is being read. */
  what: ReaderWhat;
  /** What a click on the map does now. */
  step: "area" | "roofs" | "ground";
  /** The area to read (metres), or null for the whole picture. */
  area: Pt[] | null;
  /** The examples clicked: roofs (with the look their buildings get), points on streets, or points on water (deep or shallow). */
  roofs: { x: number; y: number; look: RoofStyle; rgb: RGB; deep?: boolean }[];
  ground: { x: number; y: number; rgb: RGB }[];
  tolerance: number;
  busy: boolean;
  /** What the last Find found (metres), waiting to be accepted. */
  found: { points: Pt[]; look: RoofStyle }[] | null;
  foundStreets: { points: Pt[]; width: number; kind: StreetKind }[] | null;
  foundWater: { runs: { material: number; runs: number[] }[]; cells: number } | null;
  /** A line about the last Find (or why it failed). */
  note: string;
  /** The box being dragged for the area. */
  drag: { ax: number; ay: number; bx: number; by: number } | null;
}

/** As many as Claude's read_picture_buildings takes. */
export const MAX_ROOFS = 12, MAX_GROUND = 24;

const EMPTY: ReaderState = { on: false, what: "buildings", step: "area", area: null, roofs: [], ground: [], tolerance: 0.5, busy: false, found: null, foundStreets: null, foundWater: null, note: "", drag: null };
const NOTHING_FOUND = { found: null, foundStreets: null, foundWater: null };

class ReaderController {
  state: ReaderState = EMPTY;
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getState = () => this.state;
  set(p: Partial<ReaderState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  start() { this.set({ ...EMPTY, on: true, tolerance: this.state.tolerance }); }
  /** Read something else: the examples and what was found go (the area stays). */
  setWhat(what: ReaderWhat) { if (what !== this.state.what) this.set({ what, roofs: [], ground: [], ...NOTHING_FOUND, note: "", step: this.state.area ? "roofs" : "area" }); }
  stop() { if (this.state.on) this.set({ ...EMPTY, tolerance: this.state.tolerance }); }
  setStep(step: ReaderState["step"]) { this.set({ step }); }
  wholePicture() { this.set({ area: null, drag: null, step: "roofs", ...NOTHING_FOUND }); }
  /** A click with the reader on: the start of the area's box, a roof, or the ground (with the colour under it). */
  click(x: number, y: number, rgb: RGB | null) {
    const s = this.state;
    if (s.step === "area") { this.set({ drag: { ax: x, ay: y, bx: x, by: y } }); return; }
    if (!rgb) { this.set({ note: "The trace picture isn't loaded yet: try again in a moment." }); return; }
    if (s.step === "roofs") {
      if (s.roofs.length >= MAX_ROOFS) { this.set({ note: `That's ${MAX_ROOFS} roofs already: take one away (×) to add another.` }); return; }
      this.set({ roofs: [...s.roofs, { x, y, look: guessRoofLook(rgb), rgb, ...(s.what === "water" && { deep: true }) }], ...NOTHING_FOUND, note: "" });
    }
    else if (s.ground.length >= MAX_GROUND) this.set({ note: `That's ${MAX_GROUND} ground samples already: take one away (×) to add another.` });
    else this.set({ ground: [...s.ground, { x, y, rgb }], ...NOTHING_FOUND, note: "" });
  }
  dragTo(x: number, y: number) { if (this.state.drag) this.set({ drag: { ...this.state.drag, bx: x, by: y } }); }
  /** The area's box let go of: kept when it is more than a few metres across, then on to the roofs. */
  dragEnd() {
    const d = this.state.drag;
    if (!d) return;
    const x0 = Math.min(d.ax, d.bx), x1 = Math.max(d.ax, d.bx), y0 = Math.min(d.ay, d.by), y1 = Math.max(d.ay, d.by);
    if (x1 - x0 < 5 || y1 - y0 < 5) { this.set({ drag: null }); return; }
    this.set({ drag: null, area: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], step: "roofs", ...NOTHING_FOUND });
  }
  setLook(i: number, look: RoofStyle) { this.set({ roofs: this.state.roofs.map((r, k) => (k === i ? { ...r, look } : r)), ...NOTHING_FOUND }); }
  setDeep(i: number, deep: boolean) { this.set({ roofs: this.state.roofs.map((r, k) => (k === i ? { ...r, deep } : r)), ...NOTHING_FOUND }); }
  removeRoof(i: number) { this.set({ roofs: this.state.roofs.filter((_, k) => k !== i), ...NOTHING_FOUND }); }
  removeGround(i: number) { this.set({ ground: this.state.ground.filter((_, k) => k !== i), ...NOTHING_FOUND }); }
  setTolerance(t: number) { this.set({ tolerance: t }); }

  find() {
    const s = this.state;
    if (!s.roofs.length || s.busy) return;
    this.set({ busy: true, note: "Reading the picture…", ...NOTHING_FOUND });
    const ground = s.ground.map(({ x, y }) => [x, y] as Pt);
    if (s.what === "buildings") store.send({ t: "read_picture", area: s.area ?? [], roofs: s.roofs.map(({ x, y, look }) => ({ x, y, look })), ground, tolerance: s.tolerance });
    else store.send({ t: "read_picture_as", what: s.what, area: s.area ?? [], samples: s.roofs.map(({ x, y, deep }) => ({ x, y, ...(s.what === "water" && { material: deep === false ? 7 : 8 }) })), ground, tolerance: s.tolerance });
  }
  /** The server's answer (store.ts passes it on). */
  received(m: { what?: ReaderWhat; buildings?: { points: Pt[]; look: RoofStyle }[]; streets?: { points: Pt[]; width: number; kind: StreetKind }[]; water?: { runs: { material: number; runs: number[] }[]; cells: number }; skipped?: { small: number; large: number }; alreadyThere?: number; error?: string }) {
    if (!this.state.on || (m.what ?? "buildings") !== this.state.what) return;
    if (m.error) { this.set({ busy: false, note: m.error }); return; }
    if (m.what === "streets") {
      const n = m.streets?.length ?? 0, there = m.alreadyThere ?? 0;
      this.set({ busy: false, foundStreets: m.streets ?? [], note: n ? `Found ${n} street${n === 1 ? "" : "s"}${there ? ` (${there} already on the map, left out)` : ""}. Accept to add them, or click more of what isn't a street and Find again.` : `No streets found${there ? ` that aren't on the map already (${there})` : ""}. Click a street, what isn't one beside it, or loosen the tolerance.` });
      return;
    }
    if (m.what === "water") {
      const n = m.water?.cells ?? 0, there = m.alreadyThere ?? 0;
      this.set({ busy: false, foundWater: m.water ?? null, note: n ? `Found water in ${n.toLocaleString()} ground cells${there ? ` (${there.toLocaleString()} are that water already)` : ""}. Accept to paint it, or click more of the shore and Find again.` : "No water found. Click the water, the shore beside it, or loosen the tolerance." });
      return;
    }
    const n = m.buildings?.length ?? 0, there = m.alreadyThere ?? 0;
    this.set({
      busy: false, found: m.buildings ?? [],
      note: n ? `Found ${n} building${n === 1 ? "" : "s"}${there ? ` (${there} already on the map, left out)` : ""}. Accept to add them, or click more ground or change the tolerance and Find again.`
        : `Nothing found${there ? ` that isn't already on the map (${there})` : ""}. Click a roof of each kind, the ground between them, or loosen the tolerance.`,
    });
  }
  accept() {
    const s = this.state;
    if (s.what === "streets" && s.foundStreets?.length) {
      const streets = s.foundStreets.map((x) => ({ id: newFeatureId("t"), points: x.points, width: x.width, kind: x.kind }));
      sendCityFeatures({ upsertStreets: streets }, `Read ${streets.length} street${streets.length === 1 ? "" : "s"} from the picture`);
      this.set({ foundStreets: null, note: `Added ${streets.length}. Read another area, or Done.` });
      return;
    }
    if (s.what === "water" && s.foundWater?.cells) {
      store.send({ t: "paint_cells", runs: s.foundWater.runs, label: "Read water from the picture" });
      this.set({ foundWater: null, note: `Painted ${s.foundWater.cells.toLocaleString()} cells as water. Read another area, or Done.` });
      return;
    }
    const f = this.state.found;
    if (!f?.length) return;
    const buildings = f.map((b) => {
      const id = newFeatureId("b"), pic = roofChoiceFor(b.look, id);
      return { id, points: b.points, roof: b.look, kind: "house" as const, ...(pic && { asset: pic.asset, tile: pic.tile }) };
    });
    sendCityFeatures({ upsertBuildings: buildings }, `Read ${buildings.length} building${buildings.length === 1 ? "" : "s"} from the picture`);
    this.set({ found: null, note: `Added ${buildings.length}. Read another area, or Done.` });
  }
}

export const readerCtl = new ReaderController();
store.onPictureRead((m) => readerCtl.received(m));
