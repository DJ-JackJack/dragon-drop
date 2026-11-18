import { describe, expect, it } from "vitest";
import { type Derived, derivedChange } from "../src/index.ts";

const W = 64, H = 48;
const make = (): Derived => ({
  W, H, seq: 1, rivers: [],
  temp: new Uint8Array(W * H), moist: new Uint8Array(W * H), seaDist: new Uint8Array(W * H), landDist: new Uint8Array(W * H),
  lakes: new Uint8Array(W * H), snow: new Uint8Array(W * H),
});
const copy = (d: Derived): Derived => ({
  ...d, temp: d.temp.slice(), moist: d.moist.slice(), seaDist: d.seaDist.slice(), landDist: d.landDist.slice(), lakes: d.lakes.slice(), snow: d.snow.slice(),
  ...(d.rock && { rock: d.rock.slice() }),
});

describe("what changed between two sets of derived layers", () => {
  it("says nothing changed when the layers and rivers are the same, whatever the change number", () => {
    const a = make(), b = copy(a);
    a.rivers = [{ pts: [1, 2, 3, 4], widths: [1, 1] }];
    b.rivers = [{ pts: [1, 2, 3, 4], widths: [1, 1] }];
    b.seq = 9;
    expect(derivedChange(a, b)).toBe("none");
  });

  it("counts a river that came or went as a change (rivers are painted into the map), boxed with the reach of its banks", () => {
    const a = make(), b = copy(a);
    b.rivers = [{ pts: [30, 20, 34, 24], widths: [1, 1] }];
    const c = derivedChange(a, b);
    expect(c).not.toBe("none");
    expect(c).toMatchObject({ x: 10, y: 0 }); // (the reach is 18 px and a little more, and the box stops at the map's edge)
  });

  it("gives the box around every changed cell, across all the layers", () => {
    const a = make(), b = copy(a);
    b.temp[10 * W + 20] = 7; // (20, 10)
    b.snow[30 * W + 5] = 200; // (5, 30)
    b.lakes[12 * W + 40] = 1; // (40, 12)
    expect(derivedChange(a, b)).toEqual({ x: 5, y: 10, w: 36, h: 21 });
  });

  it("finds a single changed cell, in the corners too", () => {
    for (const [x, y] of [[0, 0], [W - 1, H - 1], [0, H - 1], [W - 1, 0], [31, 17]]) {
      const a = make(), b = copy(a);
      b.moist[y * W + x] = 1;
      expect(derivedChange(a, b)).toEqual({ x, y, w: 1, h: 1 });
    }
  });

  it("treats a missing stone layer as empty, so adding or removing it is a change only where there is stone", () => {
    const a = make(), b = copy(a);
    expect(derivedChange(a, { ...b, rock: new Uint8Array(W * H) })).toBe("none");
    const c = { ...b, rock: new Uint8Array(W * H) };
    c.rock![5 * W + 6] = 255;
    expect(derivedChange(a, c)).toEqual({ x: 6, y: 5, w: 1, h: 1 });
    expect(derivedChange(c, a)).toEqual({ x: 6, y: 5, w: 1, h: 1 });
  });

  it("can't compare maps of different sizes", () => {
    const a = make();
    const b = { ...make(), W: 32, H: 24, temp: new Uint8Array(32 * 24), moist: new Uint8Array(32 * 24), seaDist: new Uint8Array(32 * 24), landDist: new Uint8Array(32 * 24), lakes: new Uint8Array(32 * 24), snow: new Uint8Array(32 * 24) };
    expect(derivedChange(a, b)).toBe("all");
  });

  it("is fast enough to run on every update of a 2048 map", () => {
    const N = 2048 * 2048;
    const mk = (): Derived => ({ W: 2048, H: 2048, seq: 1, rivers: [], temp: new Uint8Array(N), moist: new Uint8Array(N), seaDist: new Uint8Array(N), landDist: new Uint8Array(N), lakes: new Uint8Array(N), snow: new Uint8Array(N) });
    const a = mk(), b = mk();
    b.moist[1000 * 2048 + 900] = 5;
    const t = performance.now();
    const r = derivedChange(a, b);
    expect(r).toEqual({ x: 900, y: 1000, w: 1, h: 1 });
    expect(performance.now() - t).toBeLessThan(400);
  });
});
