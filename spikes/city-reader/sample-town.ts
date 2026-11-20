/**
 * Draws a made-up sample town with the city renderer, to see how buildings, streets and ground look together.
 * Run: node node_modules/tsx/dist/cli.mjs spikes/city-reader/sample-town.ts <out.png> [x y w h]
 */
import { writeFileSync } from "node:fs";
import { MATERIALS, createCityDoc, drawGrid, rectPolygon, renderCity, type MapBuilding, type MapStreet } from "../../packages/core/src/index.ts";
import { encodePng } from "../../packages/tools/src/images.ts";

const [, , out, ...r] = process.argv;
const d = createCityDoc({ id: "sample", name: "Sample", widthM: 600, heightM: 400 });
const mat = (n: string) => MATERIALS.find((m) => m.name === n)!.id;
const W = d.height.w;
for (let y = 0; y < d.height.h; y++) for (let x = 0; x < W; x++) {
  if (x > 470 + 25 * Math.sin(y / 35)) d.height.data[y * W + x] = mat(x > 505 + 25 * Math.sin(y / 35) ? "deep water" : "shallow water");
  else if (Math.hypot(x - 250, y - 190) < 28) d.height.data[y * W + x] = mat("cobblestone");
  else if (Math.hypot(x - 120, y - 300) < 45) d.height.data[y * W + x] = mat("forest floor");
}
const streets: MapStreet[] = [
  { id: "t1", points: [[0, 190], [250, 190], [480, 170]], width: 12, kind: "avenue" },
  { id: "t2", points: [[250, 0], [250, 190], [270, 400]], width: 7, kind: "street" },
  { id: "t3", points: [[60, 0], [80, 120], [60, 190]], width: 4, kind: "lane" },
  { id: "t4", points: [[380, 190], [390, 300], [420, 400]], width: 4, kind: "lane" },
];
d.features!.streets = streets;
const buildings: MapBuilding[] = [];
let n = 0;
const roofs = ["slate", "slate", "tile", "thatch"] as const;
// houses along each side of the first avenue and the main street
for (let x = 20; x < 460; x += 13) for (const side of [-1, 1]) {
  const y = 190 + (x > 250 ? -(x - 250) * 0.087 : 0) + side * (16 + (n % 3));
  if (Math.abs(x - 250) < 24) continue;
  buildings.push({ id: `h${n++}`, points: rectPolygon(x, y, 8 + (n % 4), 9 + (n % 3), x > 250 ? -5 : 0), roof: roofs[n % 4], kind: "house" });
}
for (let y = 15; y < 390; y += 14) for (const side of [-1, 1]) {
  if (Math.abs(y - 190) < 26) continue;
  buildings.push({ id: `h${n++}`, points: rectPolygon(250 + side * 14 + (y > 190 ? (y - 190) * 0.1 : 0), y, 9, 10, 0), roof: roofs[(n + 1) % 4], kind: "house" });
}
buildings.push({ id: "temple", points: rectPolygon(300, 120, 26, 32, 0), roof: "tile", colour: "#a8442e", kind: "temple" });
buildings.push({ id: "hall", points: [[330, 220], [370, 220], [370, 236], [352, 236], [352, 252], [330, 252]], roof: "slate", kind: "hall" });
buildings.push({ id: "barn", points: rectPolygon(110, 80, 14, 26, 8), roof: "shingle", kind: "barn" });
d.features!.buildings = buildings;

const region = r.length === 4 ? { x: +r[0], y: +r[1], w: +r[2], h: +r[3] } : undefined;
const t = Date.now();
const res = renderCity(d, { region, maxSize: 1400 });
drawGrid(res.img, res.region, res.px);
writeFileSync(out, encodePng(res.img));
console.log(`${buildings.length} buildings, ${res.img.w} x ${res.img.h} px (${res.px.toFixed(2)} px/m), ${Date.now() - t} ms`);
