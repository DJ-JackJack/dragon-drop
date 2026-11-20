/** cityBridges.ts: where a street crosses water it is a bridge (stone, wood) or a ford, worked out from the street and the ground. */
import { describe, expect, it } from "vitest";
import { type MapStreet, bridgeKindFor, createCityDoc, deckDistance, renderCity, streetBridges } from "../src/index.ts";

/** A 200 x 200 m city (1 m cells) with a river across it from y 90 to 110, and a sandbank in it at x 150-153. */
function riverTown() {
  const doc = createCityDoc({ id: "r", name: "R", widthM: 200, heightM: 200, cellM: 1 });
  const { w, data } = doc.height;
  for (let y = 90; y < 110; y++) for (let x = 0; x < 200; x++) data[y * w + x] = x >= 150 && x < 153 ? 6 : y < 94 || y >= 106 ? 7 : 8;
  return doc;
}
const street = (o: Partial<MapStreet>): MapStreet => ({ id: "s", points: [[50, 20], [50, 180]], width: 7, kind: "street", ...o });

describe("bridges", () => {
  it("are stone for streets and avenues, wood for lanes and paths, and what the street says when it says", () => {
    expect(bridgeKindFor(street({}))).toBe("stone");
    expect(bridgeKindFor(street({ kind: "lane", width: 4 }))).toBe("wood");
    expect(bridgeKindFor(street({ kind: undefined, width: 3 }))).toBe("wood");
    expect(bridgeKindFor(street({ bridge: "wood" }))).toBe("wood");
    expect(bridgeKindFor(street({ kind: "path", bridge: "stone" }))).toBe("stone");
    expect(bridgeKindFor(street({ bridge: "none" }))).toBe("ford");
  });

  it("span the water from bank to bank, a little onto each, with piers in the water", () => {
    const doc = riverTown();
    const [b, ...more] = streetBridges(street({}), doc.height, 1);
    expect(more).toHaveLength(0);
    expect(b.kind).toBe("stone");
    expect(b.points[0][1]).toBeGreaterThan(86);
    expect(b.points[0][1]).toBeLessThan(90);
    expect(b.points[b.points.length - 1][1]).toBeGreaterThan(110);
    expect(b.points[b.points.length - 1][1]).toBeLessThan(114);
    expect(b.length).toBeGreaterThan(20);
    expect(b.piers.length).toBeGreaterThan(0);
    expect(b.piers.every((p) => p.y > 90 && p.y < 110)).toBe(true);
    // a street on dry land has none; a wooden one has posts along both edges
    expect(streetBridges(street({ points: [[10, 10], [190, 10]] }), doc.height, 1)).toEqual([]);
    const wood = streetBridges(street({ kind: "lane", width: 4, points: [[30, 20], [30, 180]] }), doc.height, 1)[0];
    expect(wood.kind).toBe("wood");
    expect(wood.posts.length).toBeGreaterThan(6);
  });

  it("don't stop for a sandbank, but two crossings far apart are two bridges", () => {
    const doc = riverTown();
    // along the river from x 100 to 199 at y 100: water, a 3 m sandbank at 150, water: one bridge
    expect(streetBridges(street({ points: [[100, 100], [199, 100]] }), doc.height, 1)).toHaveLength(1);
    // a street that crosses the river, goes along the bank and crosses back: two bridges
    const zig = street({ points: [[20, 20], [20, 180], [80, 180], [80, 20]] });
    expect(streetBridges(zig, doc.height, 1)).toHaveLength(2);
  });

  it("end square, and are drawn: a stone deck over the water, a ford leaves the water showing", () => {
    expect(deckDistance(50, 100, [[50, 90], [50, 110]])).toBe(0);
    expect(deckDistance(50, 89, [[50, 90], [50, 110]])).toBe(Infinity); // (beyond an end: square, not rounded)
    expect(deckDistance(53, 100, [[50, 90], [50, 110]])).toBe(3);
    const doc = riverTown();
    doc.features = { ...doc.features!, streets: [street({}), street({ id: "f", points: [[170, 20], [170, 180]], width: 3, kind: "path", bridge: "none" })] };
    const r = renderCity(doc, { maxSize: 400 }), at = (x: number, y: number) => { const o = (y * 2 * r.img.w + x * 2) * 4; return [r.img.data[o], r.img.data[o + 1], r.img.data[o + 2]]; };
    const deck = at(50, 100), water = at(100, 100), ford = at(170, 100);
    expect(deck[0]).toBeGreaterThan(140); // (stone: light, not blue)
    expect(water[2]).toBeGreaterThan(water[0] + 50);
    expect(ford[2]).toBeGreaterThan(ford[0]); // (the path under the water: still bluish)
  });
});
