import { describe, expect, it } from "vitest";
import { PLACE_GROUPS, PLACE_ICONS, PLACE_KINDS, PLACE_SIZE, PLACE_TYPE_IDS, type IconCtx, drawPlaceIcon, hasPlaceIcon, isPlaceType, placeKind } from "../src/index.ts";

/** A drawing context that remembers what it was asked to do. */
function recorder() {
  const calls: string[] = [];
  let depth = 0, maxDepth = 0;
  const ctx = new Proxy({ fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "miter", lineCap: "butt" } as Record<string, unknown>, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...a: unknown[]) => {
        calls.push(k);
        if (k === "save") { depth++; maxDepth = Math.max(maxDepth, depth); }
        if (k === "restore") depth--;
        if (k === "arc" || k === "ellipse" || k === "quadraticCurveTo" || k === "bezierCurveTo" || k === "lineTo" || k === "moveTo" || k === "rect") {
          for (const v of a) expect(Number.isFinite(v as number), `${k} got ${String(v)}`).toBe(true);
        }
      };
    },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return { ctx: ctx as unknown as IconCtx, calls, depth: () => depth };
}

describe("the kinds of place", () => {
  it("keeps the original nine, and names every kind once with a group, a size and a hint", () => {
    for (const old of ["capital", "city", "town", "village", "fort", "port", "ruin", "landmark", "other"]) expect(PLACE_TYPE_IDS, old).toContain(old); // (saved maps must keep working)
    expect(new Set(PLACE_TYPE_IDS).size).toBe(PLACE_TYPE_IDS.length);
    for (const k of PLACE_KINDS) {
      expect(k.id, k.id).toMatch(/^[a-z][a-z_]*$/);
      expect(k.name.length).toBeGreaterThan(2);
      expect(PLACE_GROUPS, k.id).toContain(k.group);
      expect(k.hint.length).toBeGreaterThan(5);
      expect(PLACE_SIZE[k.id]).toBe(k.label);
      expect(k.label).toBeGreaterThanOrEqual(8);
    }
    for (const g of PLACE_GROUPS) expect(PLACE_KINDS.some((k) => k.group === g), g).toBe(true); // (no empty group in the picker)
  });

  it("looks a kind up, and reads one it doesn't know (a file from a newer version) as 'other'", () => {
    expect(placeKind("castle").name).toBe("Castle");
    expect(placeKind("a-kind-from-the-future").id).toBe("other");
    expect(isPlaceType("lighthouse")).toBe(true);
    expect(isPlaceType("nonsense")).toBe(false);
  });
});

describe("the place pictures", () => {
  it("every kind marked as a picture has one, and nothing else has", () => {
    for (const k of PLACE_KINDS) expect(hasPlaceIcon(k.id), k.id).toBe(k.picture);
    for (const id of Object.keys(PLACE_ICONS)) expect(isPlaceType(id), `${id} is drawn but is not a kind`).toBe(true);
  });

  it("each picture draws shapes, finishes what it started, and keeps to its box", () => {
    for (const k of PLACE_KINDS.filter((x) => x.picture)) {
      const r = recorder();
      expect(drawPlaceIcon(r.ctx, k.id, 100, 50, 10), k.id).toBe(true);
      expect(r.calls.filter((c) => c === "fill" || c === "stroke").length, `${k.id} draws nothing`).toBeGreaterThan(3);
      expect(r.calls[0]).toBe("save");
      expect(r.calls[r.calls.length - 1]).toBe("restore");
      expect(r.depth(), `${k.id} left the drawing state changed`).toBe(0);
      // the picture is drawn centred on the point and scaled to its size
      expect(r.calls.slice(0, 3)).toEqual(["save", "translate", "scale"]);
    }
  });

  it("draws nothing for the original symbols (the editor draws those) or an unknown kind", () => {
    for (const id of ["capital", "city", "fort", "landmark", "other", "nope"]) {
      const r = recorder();
      expect(drawPlaceIcon(r.ctx, id, 0, 0, 10)).toBe(false);
      expect(r.calls).toEqual([]);
    }
  });

  it("uses white outlines and ink, so a picture reads on any ground", () => {
    const seen = new Set<string>();
    const ctx = { fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "miter", lineCap: "butt", save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, rect() {}, fill() { seen.add(String(this.fillStyle)); }, stroke() { seen.add(String(this.strokeStyle)); } };
    drawPlaceIcon(ctx as unknown as IconCtx, "castle", 0, 0, 10);
    expect([...seen].sort()).toEqual(["#17171c", "#ffffff"]);
  });
});
