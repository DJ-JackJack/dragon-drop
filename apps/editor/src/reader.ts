/**
 * The city picture reader in the editor: with the trace picture laid over a city, the DM drags the area to read, clicks one roof of each kind (its look is guessed from its
 * colour and can be changed) and the ground between them, presses Find, looks at what the server found (core cityReader.ts, read on its compute thread), and accepts it as
 * one edit. Everything here is in metres; the trace bar (TraceBar.tsx) holds the buttons, the city view (CityView.tsx) takes the clicks and draws the marks.
 */
import { type RoofStyle, guessRoofLook, newFeatureId } from "@mapmaker/core";
import { sendCityFeatures } from "./cityUi.ts";
import { roofChoiceFor } from "./roofAssetsClient.ts";
import { store } from "./store.ts";

type Pt = [number, number];
type RGB = [number, number, number];

export interface ReaderState {
  on: boolean;
  /** What a click on the map does now. */
  step: "area" | "roofs" | "ground";
  /** The area to read (metres), or null for the whole picture. */
  area: Pt[] | null;
  roofs: { x: number; y: number; look: RoofStyle; rgb: RGB }[];
  ground: { x: number; y: number; rgb: RGB }[];
  tolerance: number;
  busy: boolean;
  /** What the last Find found (metres), waiting to be accepted. */
  found: { points: Pt[]; look: RoofStyle }[] | null;
  /** A line about the last Find (or why it failed). */
  note: string;
  /** The box being dragged for the area. */
  drag: { ax: number; ay: number; bx: number; by: number } | null;
}

/** As many as Claude's read_picture_buildings takes. */
export const MAX_ROOFS = 12, MAX_GROUND = 24;

const EMPTY: ReaderState = { on: false, step: "area", area: null, roofs: [], ground: [], tolerance: 0.5, busy: false, found: null, note: "", drag: null };

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
  stop() { if (this.state.on) this.set({ ...EMPTY, tolerance: this.state.tolerance }); }
  setStep(step: ReaderState["step"]) { this.set({ step }); }
  wholePicture() { this.set({ area: null, drag: null, step: "roofs", found: null }); }
  /** A click with the reader on: the start of the area's box, a roof, or the ground (with the colour under it). */
  click(x: number, y: number, rgb: RGB | null) {
    const s = this.state;
    if (s.step === "area") { this.set({ drag: { ax: x, ay: y, bx: x, by: y } }); return; }
    if (!rgb) { this.set({ note: "The trace picture isn't loaded yet: try again in a moment." }); return; }
    if (s.step === "roofs") {
      if (s.roofs.length >= MAX_ROOFS) { this.set({ note: `That's ${MAX_ROOFS} roofs already: take one away (×) to add another.` }); return; }
      this.set({ roofs: [...s.roofs, { x, y, look: guessRoofLook(rgb), rgb }], found: null, note: "" });
    }
    else if (s.ground.length >= MAX_GROUND) this.set({ note: `That's ${MAX_GROUND} ground samples already: take one away (×) to add another.` });
    else this.set({ ground: [...s.ground, { x, y, rgb }], found: null, note: "" });
  }
  dragTo(x: number, y: number) { if (this.state.drag) this.set({ drag: { ...this.state.drag, bx: x, by: y } }); }
  /** The area's box let go of: kept when it is more than a few metres across, then on to the roofs. */
  dragEnd() {
    const d = this.state.drag;
    if (!d) return;
    const x0 = Math.min(d.ax, d.bx), x1 = Math.max(d.ax, d.bx), y0 = Math.min(d.ay, d.by), y1 = Math.max(d.ay, d.by);
    if (x1 - x0 < 5 || y1 - y0 < 5) { this.set({ drag: null }); return; }
    this.set({ drag: null, area: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], step: "roofs", found: null });
  }
  setLook(i: number, look: RoofStyle) { this.set({ roofs: this.state.roofs.map((r, k) => (k === i ? { ...r, look } : r)), found: null }); }
  removeRoof(i: number) { this.set({ roofs: this.state.roofs.filter((_, k) => k !== i), found: null }); }
  removeGround(i: number) { this.set({ ground: this.state.ground.filter((_, k) => k !== i), found: null }); }
  setTolerance(t: number) { this.set({ tolerance: t }); }

  find() {
    const s = this.state;
    if (!s.roofs.length || s.busy) return;
    this.set({ busy: true, note: "Reading the picture…", found: null });
    store.send({ t: "read_picture", area: s.area ?? [], roofs: s.roofs.map(({ x, y, look }) => ({ x, y, look })), ground: s.ground.map(({ x, y }) => [x, y] as Pt), tolerance: s.tolerance });
  }
  /** The server's answer (store.ts passes it on). */
  received(m: { buildings?: { points: Pt[]; look: RoofStyle }[]; skipped?: { small: number; large: number }; alreadyThere?: number; error?: string }) {
    if (!this.state.on) return;
    if (m.error) { this.set({ busy: false, note: m.error }); return; }
    const n = m.buildings?.length ?? 0, there = m.alreadyThere ?? 0;
    this.set({
      busy: false, found: m.buildings ?? [],
      note: n ? `Found ${n} building${n === 1 ? "" : "s"}${there ? ` (${there} already on the map, left out)` : ""}. Accept to add them, or click more ground or change the tolerance and Find again.`
        : `Nothing found${there ? ` that isn't already on the map (${there})` : ""}. Click a roof of each kind, the ground between them, or loosen the tolerance.`,
    });
  }
  accept() {
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
