import { describe, expect, it } from "vitest";
import { MATERIALS, cityGroundColours, cleanGroundColours, createCityDoc, groundHex, groundMaterialId, groundSamplePoints, sampleGroundColours } from "@mapmaker/core";

const town = () => createCityDoc({ id: "town", name: "Town", widthM: 200, heightM: 100, cellM: 2 });

describe("a settlement's own ground colours", () => {
  it("replace the climate's colour of each ground they name, and only those", () => {
    const climate = { temperature: 0.7, moisture: 0.32 };
    const plain = cityGroundColours(climate), own = cityGroundColours(climate, { grass: "#b4d0a0", "deep water": "#334455" });
    expect(own[5]).toEqual([0xb4, 0xd0, 0xa0]);
    expect(own[8]).toEqual([0x33, 0x44, 0x55]);
    expect(own[6]).toEqual(plain[6]);
  });

  it("are checked: known grounds by name (any case), colours as #rrggbb", () => {
    expect(cleanGroundColours({ Grass: "B4D0A0", sand: "#aa9966" })).toEqual({ grass: "#b4d0a0", sand: "#aa9966" });
    expect(cleanGroundColours({ lava2: "#000000" })).toMatchObject({ error: /no ground "lava2"/ });
    expect(cleanGroundColours({ grass: "green" })).toMatchObject({ error: /#rrggbb/ });
    expect(cleanGroundColours({ void: "#000000" })).toMatchObject({ error: /no ground/ });
    expect(groundMaterialId("Deep Water")).toBe(8);
  });
});

describe("taking the ground's colours from a picture", () => {
  it("looks only at open ground of each kind: not under or beside a building, nor on a street", () => {
    const doc = town();
    // the right half is sand
    for (let y = 0; y < doc.height.h; y++) for (let x = doc.height.w / 2; x < doc.height.w; x++) doc.height.data[y * doc.height.w + x] = 6;
    doc.features = { ...doc.features!, buildings: [{ id: "b-1", points: [[20, 20], [60, 20], [60, 60], [20, 60]] }], streets: [{ id: "t-1", points: [[0, 80], [200, 80]], width: 8 }] };
    const groups = groundSamplePoints(doc);
    const grass = groups.find((g) => g.material === 5)!, sand = groups.find((g) => g.material === 6)!;
    expect(grass.points.length).toBeGreaterThan(100);
    expect(sand.points.length).toBeGreaterThan(100);
    expect(grass.points.every(([x]) => x < 100) && sand.points.every(([x]) => x >= 100)).toBe(true);
    expect(grass.points.some(([x, y]) => x > 17 && x < 63 && y > 17 && y < 63)).toBe(false); // (the building, and two metres round it)
    expect([...grass.points, ...sand.points].some(([, y]) => y > 75 && y < 85)).toBe(false); // (the street)
  });

  it("takes the middle colour, past the drawing's dark lines", () => {
    const w = 100, h = 50, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, line = x % 10 === 0; // (dark lines every 10 px, as a drawing's)
      const c = line ? [20, 20, 20] : x < 50 ? [180, 208, 160] : [150, 120, 70];
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    const pts = (x0: number, x1: number) => Array.from({ length: 200 }, (_, i) => [x0 + (i * 7) % (x1 - x0), 2 + ((i * 13) % (h - 4))] as [number, number]);
    const res = sampleGroundColours({ w, h, data }, [{ material: 5, points: pts(2, 48) }, { material: 6, points: pts(52, 98) }, { material: 8, points: pts(2, 6).slice(0, 5) }]);
    expect(res.map((r) => r.material)).toEqual([5, 6]); // (too few points for the water)
    expect(groundHex(res[0].rgb)).toBe("#b4d0a0");
    expect(groundHex(res[1].rgb)).toBe("#967846");
    expect(MATERIALS[res[1].material].name).toBe("sand");
  });
});
