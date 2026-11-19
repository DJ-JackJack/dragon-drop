# RT7: can a roof fade when a token goes under it? (a prompt for Claude Code on the PC that has Foundry)

*Paste everything from the next heading to the end into the Claude Code session on the PC that has Foundry v14 (the one that ran the earlier tests is best), and let it run. It stands on its own.*

---

You are helping test Dragon Drop (a map editor) against the person's real Foundry VTT v14. They are here and have asked for this test. Do every step you can yourself, the way you did in the earlier runs (driving Foundry in the browser pane, using Foundry's own client API, staging files in the Foundry data folder, placing tokens by the canvas drop event, setting elevations and sight through the API); ask the person only for what you cannot do. Earlier results are in `foundry-results/` (RESULTS.md, RESULTS-RETEST.md, -2, and `retest/RESULTS-RETEST-3.md`, the foreground test) if you need the method.

## Why

Dragon Drop is getting roofs. The previous test (RT6) showed that a level's **foreground** picture is drawn above the tokens, hides a token under it, and **does not fade by itself**, even though its occlusion mode is SURFACE. Foundry's own hint for the **Define Surface** behaviour says that when a controlled or detected token is *below a surface*, Surface-mode tiles and the background and foreground textures *at or above that surface* fade. So a roof might fade if there is a Define Surface region ("ceiling": `placement: "top"`, Occlusion on) over it. This test asks three things:

- **Part A (Ground floor):** one foreground picture holding two roofs (brown west, blue east), with one ceiling region over each. Does a token under one roof make the picture fade? The **whole** picture (both roofs) or only the one over the token? (A level has only one foreground picture, so this decides whether the foreground can work for several buildings.)
- **Part B (Attic):** the same two roofs as two separate **Tiles** (each its own picture, Surface occlusion), with a ceiling region under each. Does a token under one fade only that tile?
- **Part C (Cellar):** a ceiling region with a **polygon** shape (a triangle): does Foundry keep it, and does its geometry test right?

## Rules

- Write only in `foundry-results/retest/` (create `RESULTS-RETEST-4.md` there) and in the Foundry folders you used before (`Data/maps`, the staging folder for Import Data). Do not touch earlier test scenes. Make a NEW scene.
- Redact Foundry user ids in anything you save (`"REDACTED-USER"`). No licence or account data.
- Report only what you observed. Mark each observation **[screen]**, **[API]** (say how you read it) or **[export]**.
- Do **not** edit the scene file (not even `_stats`). If something fails, stop and report; do not work around it.
- Do not rely on dragging tokens. Place them by dropping at a position, then set elevation (and a sight range of 60 ft, as before, so a selected token can see) through the API, and say so. Test with the token **controlled** (selected), as before, and also not selected.

## Step 1: three test pictures

Save this as `make-roof-pngs-2.mjs` (Node only), run `node make-roof-pngs-2.mjs <a temporary folder>`, and copy the three PNGs into `Data/maps` (the first two replace the identical ones from the last test; check `dd-test-cellar.png` and `dd-test-ground.png` are still there).

```js
// make-roof-pngs-2.mjs: node make-roof-pngs-2.mjs <folder>
// writes three 1050 x 700 RGBA PNGs, transparent except solid coloured rectangles (each with a lighter vertical line down its middle):
//   dd-test-roof-ground.png  BROWN over x 140..525, y 140..560   (the same as in the earlier test)
//   dd-test-roof-attic.png   BLUE over x 525..910, y 140..560    (the same as in the earlier test)
//   dd-test-roof-both.png    the brown AND the blue rectangle in ONE picture
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
const W = 1050, H = 700;
const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
function png(rects) { // rects: [x0, y0, x1, y1, [r, g, b]]
  const raw = Buffer.alloc((W * 4 + 1) * H); // each row: a filter byte (0), then RGBA; everything else stays 0 = fully transparent
  for (const [x0, y0, x1, y1, [r, g, b]] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = y * (W * 4 + 1) + 1 + x * 4, k = Math.abs(x - (x0 + x1) / 2) < 6 ? 1.3 : 1;
    raw[o] = Math.min(255, r * k); raw[o + 1] = Math.min(255, g * k); raw[o + 2] = Math.min(255, b * k); raw[o + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const brown = [140, 140, 525, 560, [150, 90, 60]], blue = [525, 140, 910, 560, [60, 100, 170]];
const out = process.argv[2] ?? ".";
writeFileSync(path.join(out, "dd-test-roof-ground.png"), png([brown]));
writeFileSync(path.join(out, "dd-test-roof-attic.png"), png([blue]));
writeFileSync(path.join(out, "dd-test-roof-both.png"), png([brown, blue]));
console.log("wrote three PNGs in", out);
```

## Step 2: the scene file

Write this **exactly** (UTF-8, no BOM, one line, no trailing newline) as `RT7-roof-fade.json` and check its SHA-256 is `7289cb2842f73a7da89f1f0b7aeec24371befa7d0138ea844fdb1a64647b9df0` (if it differs, say so and do not use it). Import it with Import Data into a new empty scene named "RT7 roof fade" (it will be renamed to the file's name), then Export Data to read back what Foundry stored.

```json
{"name":"Dragon Drop roof fade test","_stats":{"coreVersion":"14.353"},"navigation":false,"width":1050,"height":700,"padding":0,"shiftX":0,"shiftY":0,"grid":{"type":1,"size":70,"distance":5,"units":"ft","color":"#000000","alpha":0.2},"tokenVision":true,"initialLevel":"79QGVzqun9aetNmc","levels":[{"_id":"79QGVzqun9aetNmc","name":"Cellar","sort":0,"elevation":{"bottom":-10,"top":0},"background":{"src":"maps/dd-test-cellar.png"},"foreground":{"src":null},"visibility":{"levels":[]},"flags":{}},{"_id":"QeBDuEn1eQLJ6Wzl","name":"Ground floor","sort":100000,"elevation":{"bottom":0,"top":10},"background":{"src":"maps/dd-test-ground.png"},"foreground":{"src":"maps/dd-test-roof-both.png"},"visibility":{"levels":[]},"flags":{}},{"_id":"NNUYjdWwBxQqFtOQ","name":"Attic","sort":200000,"elevation":{"bottom":10,"top":20},"background":{"src":"maps/dd-test-ground.png"},"foreground":{"src":null},"visibility":{"levels":[]},"flags":{}}],"walls":[],"lights":[],"tiles":[{"_id":"VsSRH647zoqzzoaJ","texture":{"src":"maps/dd-test-roof-ground.png"},"x":0,"y":0,"width":1050,"height":700,"elevation":20,"levels":["NNUYjdWwBxQqFtOQ"],"occlusion":{"mode":2,"alpha":0},"restrictions":{"light":false,"weather":false},"hidden":false,"locked":false,"flags":{}},{"_id":"qJ76I3FuYtzWurz8","texture":{"src":"maps/dd-test-roof-attic.png"},"x":0,"y":0,"width":1050,"height":700,"elevation":20,"levels":["NNUYjdWwBxQqFtOQ"],"occlusion":{"mode":2,"alpha":0},"restrictions":{"light":false,"weather":false},"hidden":false,"locked":false,"flags":{}}],"regions":[{"_id":"Mnzsclv0ujvWy5xS","name":"Ground roof west","color":"#cc28b7","shapes":[{"type":"rectangle","x":140,"y":140,"width":385,"height":420,"rotation":0,"hole":false}],"elevation":{"bottom":0,"top":10,"topInclusive":false},"levels":["QeBDuEn1eQLJ6Wzl"],"behaviors":[{"_id":"sLbogB9QG35ienPG","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}},{"_id":"acLvAgD1omP3qO5b","name":"Ground roof east","color":"#cc28b7","shapes":[{"type":"rectangle","x":525,"y":140,"width":385,"height":420,"rotation":0,"hole":false}],"elevation":{"bottom":0,"top":10,"topInclusive":false},"levels":["QeBDuEn1eQLJ6Wzl"],"behaviors":[{"_id":"SZ7mGzZoKnZuQjxA","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}},{"_id":"GCZ3GWLrWKTDMqBt","name":"Attic roof west","color":"#cc28b7","shapes":[{"type":"rectangle","x":140,"y":140,"width":385,"height":420,"rotation":0,"hole":false}],"elevation":{"bottom":10,"top":20,"topInclusive":false},"levels":["NNUYjdWwBxQqFtOQ"],"behaviors":[{"_id":"J6ERvASj9sUzdQuR","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}},{"_id":"03B4qFlCWpXogTZu","name":"Attic roof east","color":"#cc28b7","shapes":[{"type":"rectangle","x":525,"y":140,"width":385,"height":420,"rotation":0,"hole":false}],"elevation":{"bottom":10,"top":20,"topInclusive":false},"levels":["NNUYjdWwBxQqFtOQ"],"behaviors":[{"_id":"SE9XQAvbwGV5SOJT","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}},{"_id":"dx02fFqYLDmcBH2A","name":"Cellar roof triangle","color":"#cc28b7","shapes":[{"type":"polygon","points":[210,210,700,210,455,490],"rotation":0,"hole":false}],"elevation":{"bottom":-10,"top":0,"topInclusive":false},"levels":["79QGVzqun9aetNmc"],"behaviors":[{"_id":"pyaXtkgXpKwn9AIf","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}}]}
```

What is in it: three levels, Cellar (-10..0), Ground floor (0..10) and Attic (10..20). **Ground floor**: foreground `dd-test-roof-both.png`, and two Define Surface regions, "Ground roof west" and "Ground roof east" (rectangles x 140..525 and x 525..910, y 140..560, placement top, elevation 0..10, every restriction including Occlusion true). **Attic**: no foreground, but two tiles at elevation 20 (full-canvas pictures: brown `dd-test-roof-ground.png`, blue `dd-test-roof-attic.png`, each transparent except its roof, occlusion mode 2 = Surface, alpha 0), and two Define Surface regions "Attic roof west" and "Attic roof east" (the same rectangles, placement top, elevation 10..20). **Cellar**: one Define Surface region "Cellar roof triangle", a POLYGON with corners (210,210), (700,210), (455,490), placement top, elevation -10..0. No walls or lights.

## Tests

- **T12, import.** Does it import without error? List every difference between the file and Foundry's export (apart from ids, `_stats` and Foundry's usual defaults). In particular: what does Foundry store for the two **tiles** (every field it adds or changes: texture, occlusion, restrictions, elevation, levels, sort) and for the **polygon** shape (are the `points` kept as written; any added fields)?
- **T13, Part A (view the Ground floor; foreground + two ceiling regions).** For each placement say, with a screenshot beside the same view without the token if you can, whether the foreground picture fades, goes transparent or hides, and **how much of it** (the whole picture, both roofs, or only the roof over the token). Give the foreground mesh's state from the API (alpha, occluded, occlusion mode and state, as you did in RT6) and say how you found it:
  - (a) elevation 0, under the brown roof at (300, 350);
  - (b) elevation 0, under the blue roof at (700, 350);
  - (c) elevation 0, outside both at (80, 80);
  - (d) elevation 5, under the brown roof;
  - (e) elevation 10 (at the surface), under the brown roof.
- **T14, Part B (view the Attic; two tiles + two ceiling regions).** Same questions for each of the two tiles (find them on the canvas, for example `canvas.tiles.placeables`, and read each one's mesh state, or from the primary canvas group), with tokens at:
  - (a) elevation 10, under the brown roof at (300, 350);
  - (b) elevation 10, under the blue roof at (700, 350);
  - (c) elevation 10, outside both at (80, 80);
  - (d) elevation 15, under the brown roof;
  - (e) elevation 20 (at the surface), under the brown roof.
  Does only the tile above the token fade? Are the tiles drawn above the tokens (a token under a tile is hidden when nothing fades)? Do transparent parts of a tile hide anything?
- **T15, Part C (view the Cellar; the polygon region).** Use `RegionDocument#testPoint({x, y, elevation: -5})` (or the region's polygon tests) at (455, 300) and (300, 260), which should be **true**, and at (230, 480), (150, 150), (680, 480) and (455, 500), which should be **false**. Report what you got, and show the Region layer (screenshot: is the triangle drawn as a triangle?).
- **T16, any simple switch?** If you notice any other setting that decides whether a foreground or tile fades (on the Region's Define Surface panel, a tile's sheet, or a Scene/Level option), list it with its default.

## Reply

Save the fuller notes, your redacted export and screenshots in `foundry-results/retest/` (`RESULTS-RETEST-4.md`). Then give the person a short summary (a table: T12 to T16, and each placement) to paste back to the Dragon Drop developer, and tell them which files to send (`RESULTS-RETEST-4.md` and the redacted export).
