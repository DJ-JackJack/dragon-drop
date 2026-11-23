import { describe, expect, it } from "vitest";
import { type Features, type MapWall, applyFeaturesPatch, anyRevealed, isRevealed, rectPoints, revealFrom } from "../src/index.ts";

/** A 6 x 4 room at (2, 2) with a door in its right wall, and a corridor beyond it. */
const room = (open: boolean): MapWall[] => [
  { id: "w1", kind: "wall", points: [[8, 4], [8, 2], [2, 2], [2, 6], [8, 6], [8, 5]] },
  { id: "d1", kind: "door", points: [[8, 4], [8, 5]], ...(open && { open: true }) },
];

describe("the player screen's fog", () => {
  it("reveals what can be seen from a spot: the room, and through an open door", () => {
    const shut = revealFrom(room(false), 4, 4, 40);
    expect(shut.length).toBeGreaterThanOrEqual(3);
    expect(shut.every(([x, y]) => x >= 2 - 0.01 && x <= 8 + 0.01 && y >= 2 - 0.01 && y <= 6 + 0.01)).toBe(true);
    const reveals = [{ id: "a", points: shut }];
    expect(isRevealed(reveals, 5, 3)).toBe(true);
    expect(isRevealed(reveals, 10, 4.5)).toBe(false);
    const open = revealFrom(room(true), 4, 4.5, 40);
    expect(isRevealed([{ id: "b", points: open }], 10, 4.5)).toBe(true);
  });

  it("applies reveals and hides in order, and hide everything takes them all away", () => {
    const reveals = [{ id: "a", points: rectPoints(0, 0, 10, 10) }, { id: "b", points: rectPoints(2, 2, 2, 2), hide: true }, { id: "c", points: rectPoints(3, 3, 1, 1) }];
    expect(isRevealed(reveals, 1, 1)).toBe(true);
    expect(isRevealed(reveals, 2.5, 2.5)).toBe(false);
    expect(isRevealed(reveals, 3.5, 3.5)).toBe(true);
    expect(anyRevealed(reveals)).toBe(true);
    expect(anyRevealed([{ id: "h", points: rectPoints(0, 0, 1, 1), hide: true }])).toBe(false);
    const f: Features = { places: [], labels: [], reveals };
    const added = applyFeaturesPatch(f, { upsertReveals: [{ id: "d", points: rectPoints(5, 5, 1, 1) }] });
    expect(added.reveals!.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(applyFeaturesPatch(added, { removeReveals: ["*"] }).reveals).toEqual([]);
  });
});
