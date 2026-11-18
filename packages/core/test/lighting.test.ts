import { describe, expect, it } from "vitest";
import { blockingSegments, blocksLight, createBattleDoc, lightVisibility, renderBattle, visibleDistance, visibilityPolygon, type MapWall } from "../src/index.ts";

const wall = (id: string, kind: MapWall["kind"], points: [number, number][], extra: Partial<MapWall> = {}): MapWall => ({ id, kind, points, ...extra });

describe("light and shadows", () => {
  it("walls and closed doors block light; windows, open doors and invisible walls don't", () => {
    expect(blocksLight(wall("a", "wall", [[0, 0], [1, 0]]))).toBe(true);
    expect(blocksLight(wall("a", "door", [[0, 0], [1, 0]]))).toBe(true);
    expect(blocksLight(wall("a", "door", [[0, 0], [1, 0]], { open: true }))).toBe(false);
    expect(blocksLight(wall("a", "secret", [[0, 0], [1, 0]]))).toBe(true);
    expect(blocksLight(wall("a", "window", [[0, 0], [1, 0]]))).toBe(false);
    expect(blocksLight(wall("a", "invisible", [[0, 0], [1, 0]]))).toBe(false);
  });

  it("reaches the full radius in the open", () => {
    const v = lightVisibility({ id: "l", x: 5, y: 5, radius: 4 }, []);
    for (const a of [0, 1, 2.5, -3, Math.PI]) expect(visibleDistance(v, a)).toBeCloseTo(4, 6);
  });

  it("stops at a wall and still lights the space beside it", () => {
    const w = [wall("w", "wall", [[8, 0], [8, 10]])];
    const v = lightVisibility({ id: "l", x: 5, y: 5, radius: 6 }, w);
    expect(visibleDistance(v, 0)).toBeCloseTo(3, 6); // straight at it
    expect(visibleDistance(v, Math.PI)).toBeCloseTo(6, 6); // away from it
    const slant = visibleDistance(v, Math.PI / 6); // 30 degrees: hits the wall at 3 / cos(30)
    expect(slant).toBeCloseTo(3 / Math.cos(Math.PI / 6), 5);
  });

  it("light slips round the end of a short wall but not through it", () => {
    const w = [wall("w", "wall", [[8, 4], [8, 6]])];
    const v = lightVisibility({ id: "l", x: 5, y: 5, radius: 6 }, w);
    expect(visibleDistance(v, 0)).toBeCloseTo(3, 6);
    // 45 degrees passes well above the wall's end at y 4 (the ray reaches x 8 at y 8)
    expect(visibleDistance(v, Math.PI / 4)).toBeCloseTo(6, 6);
    expect(visibleDistance(v, -Math.PI / 4)).toBeCloseTo(6, 6);
  });

  it("a long wall that runs out of the light's reach still shades exactly", () => {
    // the wall's far end is beyond the radius: between the rays toward its pieces the shadow must follow the wall, not drop to the nearest value
    const w = [wall("a", "wall", [[2, 16], [2, 8]]), wall("b", "secret", [[2, 8], [2, 7]]), wall("c", "wall", [[2, 7], [2, 2]])];
    const v = lightVisibility({ id: "l", x: 3.2, y: 3.2, radius: 9 }, w);
    for (const deg of [97, 99, 101, 103]) {
      const a = (deg * Math.PI) / 180;
      expect(visibleDistance(v, a)).toBeCloseTo(Math.min(9, 1.2 / Math.abs(Math.cos(a))), 4);
    }
  });

  it("an open door lets light through, a closed one doesn't", () => {
    const door = (open: boolean) => [wall("d", "door", [[8, 4], [8, 6]], open ? { open: true } : {})];
    expect(visibleDistance(lightVisibility({ id: "l", x: 5, y: 5, radius: 6 }, door(false)), 0)).toBeCloseTo(3, 6);
    expect(visibleDistance(lightVisibility({ id: "l", x: 5, y: 5, radius: 6 }, door(true)), 0)).toBeCloseTo(6, 6);
  });

  it("a light with shadows off ignores walls", () => {
    const w = [wall("w", "wall", [[8, 0], [8, 10]])];
    expect(visibleDistance(lightVisibility({ id: "l", x: 5, y: 5, radius: 6, shadows: false }, w), 0)).toBeCloseTo(6, 6);
  });

  it("a closed room keeps its light inside", () => {
    const room = [wall("r", "wall", [[2, 2], [8, 2], [8, 8], [2, 8]], { closed: true })];
    const v = lightVisibility({ id: "l", x: 5, y: 5, radius: 10 }, room);
    for (let k = 0; k < 40; k++) {
      const a = -Math.PI + (k + 0.37) * (Math.PI / 20);
      expect(visibleDistance(v, a)).toBeLessThanOrEqual(3 / Math.min(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) + 1e-6);
    }
    const poly = visibilityPolygon(v);
    for (const [x, y] of poly) expect(x >= 1.99 && x <= 8.01 && y >= 1.99 && y <= 8.01).toBe(true);
  });

  it("blockingSegments skips what doesn't block", () => {
    const walls = [wall("a", "wall", [[0, 0], [1, 0], [1, 1]]), wall("b", "window", [[0, 0], [0, 1]]), wall("c", "door", [[2, 2], [3, 2]], { open: true })];
    expect(blockingSegments(walls)).toHaveLength(2);
  });

  it("the raster render lights the room but not what's behind the wall", () => {
    const doc = createBattleDoc({ id: "b", name: "b", squaresX: 16, squaresY: 12, pxPerSquare: 32 });
    doc.features = { places: [], labels: [], walls: [wall("w", "wall", [[8, 0], [8, 12]])], lights: [{ id: "l", x: 5, y: 6, radius: 6 }] };
    const img = renderBattle(doc, { overlay: true, lights: true });
    const doc2 = { ...doc, features: { ...doc.features, lights: [] } };
    const dark = renderBattle(doc2, { overlay: true, lights: true });
    const px = (im: typeof img, sx: number, sy: number) => { const o = (Math.floor(sy * 32) * im.w + Math.floor(sx * 32)) * 4; return im.data[o] + im.data[o + 1] + im.data[o + 2]; };
    expect(px(img, 6.5, 6.5)).toBeGreaterThan(px(dark, 6.5, 6.5)); // lit side changes
    expect(px(img, 9.5, 6.5)).toBe(px(dark, 9.5, 6.5)); // behind the wall: untouched
  });
});
