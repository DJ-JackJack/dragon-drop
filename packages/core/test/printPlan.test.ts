/** Printing a battlemap at table scale: the pages, their labels and the PDF (core printPlan.ts and pdf.ts). */
import { describe, expect, it } from "vitest";
import { MAX_PRINT_PAGES, describePlan, inkSaver, planPrint, printPages } from "../src/printPlan.ts";
import { pdfText, writePdf } from "../src/pdf.ts";

describe("planning the pages", () => {
  it("puts whole squares on each page, in the orientation that needs fewer sheets", () => {
    // US Letter: 7 x 9 squares a page standing up (7.7 x 9.85 in of room, less the label line), 10 x 7 lying down
    const p = planPrint(30, 20, { paper: "letter" });
    expect(p.landscape).toBe(true);
    expect([p.perX, p.perY, p.cols, p.rows]).toEqual([10, 7, 3, 3]);
    expect(p.tiles).toHaveLength(9);
    expect(p.tiles.map((t) => t.label).slice(0, 4)).toEqual(["A1", "A2", "A3", "B1"]);
    expect(p.tiles[p.tiles.length - 1]).toMatchObject({ label: "C3", x: 20, y: 14, w: 10, h: 6 }); // (the last row is short)
    expect(describePlan(p)).toBe("9 pages of US Letter, landscape (3 across, 3 down), and an assembly page");
    // a tall map stands up; A4 is a little narrower and taller
    expect(planPrint(7, 30, { paper: "letter" }).landscape).toBe(false); // (4 pages standing, 5 lying)
    expect(planPrint(7, 30, { paper: "a4" }).perY).toBeGreaterThan(planPrint(7, 30, { paper: "letter" }).perY);
    // a small map is one page
    expect(planPrint(6, 5).tiles).toHaveLength(1);
    expect(planPrint(150, 150).tiles.length).toBeGreaterThan(MAX_PRINT_PAGES);
  });
});

describe("the PDF", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // (a stand-in: the writer doesn't look inside)
  const pic = { jpeg, pw: 10, ph: 10 };

  it("has an assembly page and a page for each tile, with the picture at one inch a square, corner marks and labels", () => {
    const plan = planPrint(30, 20, { paper: "letter" });
    const pages = printPages(plan, { title: "Cellar of Ashford", feetPerSquare: 5, squaresX: 30, squaresY: 20, overview: pic, tile: () => pic, grid: true, walls: [{ points: [[0, 0], [30, 20]], kind: "wall" }] });
    expect(pages).toHaveLength(10);
    expect(pages[0].w).toBe(11 * 72);
    const first = pages[1], img = first.ops.find((o) => o.t === "image")!;
    expect(img).toMatchObject({ x: 0.4 * 72, w: 10 * 72, h: 7 * 72 }); // (ten squares across, an inch each)
    const texts = first.ops.filter((o) => o.t === "text").map((o) => (o as { text: string }).text);
    expect(texts.join("|")).toMatch(/A1: row 1 of 3, column 1 of 3\. Cellar of Ashford\. 1 inch = 5 ft\./);
    expect(texts).toContain("A2"); // (the page to its right)
    expect(texts).toContain("B1 below");
    expect(first.ops.filter((o) => o.t === "line").length).toBeGreaterThan(8 + 11 + 8); // corner marks, grid, the wall
    const pdf = new TextDecoder("latin1").decode(writePdf(pages, "Cellar"));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(10);
    expect(pdf).toMatch(/\/Count 10/);
    expect(pdf).toMatch(/\/Filter \/DCTDecode/);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    // the cross-reference table points at each object
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o, o + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });

  it("writes only text Helvetica can print, and greys and lightens a picture to save ink", () => {
    expect(pdfText("Château (Æsir) \\ x")).toBe("Chateau \\(AEsir\\) \\\\ x");
    expect(pdfText("Smörgåsbord — «ok» ✓")).toBe("Smorgasbord - ?ok? ?");
    const px = new Uint8ClampedArray([200, 20, 20, 255, 0, 0, 0, 255]);
    inkSaver(px);
    expect(px[0]).toBeGreaterThan(170); // (red, greyed and lightened)
    expect(Math.abs(px[0] - px[1])).toBeLessThan(40);
    expect(px[4]).toBeGreaterThan(150); // (black becomes a light grey)
  });
});
