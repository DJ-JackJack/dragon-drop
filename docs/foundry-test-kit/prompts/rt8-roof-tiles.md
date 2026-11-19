# RT8: roofs as tiles with a ceiling each: what makes one fade? (a prompt for Claude Code on the PC that has Foundry)

*Paste everything from the next heading to the end into the Claude Code session on the PC that has Foundry v14 (the one that ran the earlier tests is best), and let it run. It stands on its own.*

---

You are helping test Dragon Drop (a map editor) against the person's real Foundry VTT v14. They have asked for this test. Do every step you can yourself, the way you did in the earlier runs (driving Foundry in the browser pane, using Foundry's client API, staging files in the Foundry data folder, placing tokens by the canvas drop event, setting elevations and a sight range through the API); ask the person only for what you cannot do. Earlier results are in `foundry-results/` (RESULTS.md, RESULTS-RETEST.md, -2, and `retest/RESULTS-RETEST-3.md` and `-4.md`) if you need the method. **Read `retest/RESULTS-RETEST-4.md` first** (your own last report).

## Why, and what we learned last time

Dragon Drop draws roofs and wants them to fade when a token goes under one, each roof on its own. RT7 showed: a level's **foreground** picture never faded, even with Define Surface (ceiling) regions over it; a **ceiling region at a Surface-mode tile's own elevation hid the tile inside the region's shape, with no token on the scene at all** (the cut was visible only on screen, the mesh values stayed alpha 1 / not occluded). Our RT7 file had one mistake: **a tile's `x`/`y` is the position of its picture's anchor, and the anchor defaults to the centre**, so the tiles sat half off the scene. This test fixes that and asks what actually decides the cut: where the viewer is.

The Foundry hint text says: *"When a controlled or detected Token is below a surface, Tiles using the "Surface" occlusion mode fade if they are at or above that surface, as do background and foreground textures. For surfaces at the top of a three-dimensional Region, fading only applies if the Token is also at or above the Region's bottom elevation. Hovering over the Region or pressing the "Highlight Objects" keybinding also triggers this effect."*

## Rules

- Write only in `foundry-results/retest/` (create `RESULTS-RETEST-5.md` there) and in the Foundry folders you used before (`Data/maps`, the staging folder for Import Data). Do not touch earlier scenes. Make a NEW scene.
- Redact Foundry user ids in anything you save (`"REDACTED-USER"`). No licence or account data.
- Report only what you observed, and mark each observation **[screen]**, **[pixel]** (colour read from the canvas), **[API]** (say how you read it) or **[export]**. Put any reading of what it means in a separate short section at the end, marked as your inference.
- Do **not** edit the scene file (not even `_stats`). If something fails, stop and report it; do not work around it.
- Do not rely on dragging tokens. Drop them at a position, then set elevation and a sight range of 60 ft through the API, and say so. Remove test tokens between placements with `TokenDocument#delete`.
- **The browser pane may be hidden, which last time made the page render 0 frames a second.** If so, emulate a 1024 x 768 viewport first (as you did), and say what you did. Wait 1.5 s after every change before reading anything.
- **The mesh values (alpha, occluded) did not show the cut last time**, so read the colour on the canvas itself. Take a screenshot of each placement and, where you can, read the pixel colour at each probe point below from the canvas (for example by rendering the primary canvas to a texture and reading it, or by zooming a screenshot); otherwise say which of "roof colour", "ground picture" or "token" you see at each probe.

## Step 1: three test pictures

Save this as `make-roof-pngs-3.mjs` (Node only), run `node make-roof-pngs-3.mjs <a temporary folder>`, and copy the three PNGs into `Data/maps` (check `dd-test-ground.png` is still there).

```js
// make-roof-pngs-3.mjs: node make-roof-pngs-3.mjs <folder>
// writes three small, fully opaque RGBA pictures, each a solid colour with a lighter vertical line down its middle:
//   dd-test-roof-brown.png  280 x 280  BROWN (150,90,60)
//   dd-test-roof-blue.png   280 x 280  BLUE  (60,100,170)
//   dd-test-roof-green.png  350 x 210  GREEN (60,150,80)
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
function png(W, H, [r, g, b]) {
  const raw = Buffer.alloc((W * 4 + 1) * H); // each row: a filter byte (0), then RGBA
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = y * (W * 4 + 1) + 1 + x * 4, k = Math.abs(x - W / 2) < 6 ? 1.3 : 1;
    raw[o] = Math.min(255, r * k); raw[o + 1] = Math.min(255, g * k); raw[o + 2] = Math.min(255, b * k); raw[o + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const out = process.argv[2] ?? ".";
writeFileSync(path.join(out, "dd-test-roof-brown.png"), png(280, 280, [150, 90, 60]));
writeFileSync(path.join(out, "dd-test-roof-blue.png"), png(280, 280, [60, 100, 170]));
writeFileSync(path.join(out, "dd-test-roof-green.png"), png(350, 210, [60, 150, 80]));
console.log("wrote three PNGs in", out);
```

## Step 2: the scene file

Write this **exactly** (UTF-8, no BOM, one line, no trailing newline) as `RT8-roof-tiles.json` and check its SHA-256 is `d395acf7b7067932a996edab24df106f3ce0e7bca1030242d4fd59c7f220f256` (if it differs, say so and do not use it). Import it with Import Data into a new empty scene named "RT8 roof tiles" (it will be renamed to the file's name), then Export Data to read back what Foundry stored.

```json
{"name":"Dragon Drop roof tiles test","_stats":{"coreVersion":"14.353"},"navigation":false,"width":1050,"height":700,"padding":0,"shiftX":0,"shiftY":0,"grid":{"type":1,"size":70,"distance":5,"units":"ft","color":"#000000","alpha":0.2},"tokenVision":true,"initialLevel":"PnYyZl6iVBmIRXWy","levels":[{"_id":"PnYyZl6iVBmIRXWy","name":"Ground floor","sort":0,"elevation":{"bottom":0,"top":10},"background":{"src":"maps/dd-test-ground.png"},"foreground":{"src":null},"visibility":{"levels":[]},"flags":{}},{"_id":"fqeFhAArtqcpJgkt","name":"Tall hall","sort":100000,"elevation":{"bottom":10,"top":30},"background":{"src":"maps/dd-test-ground.png"},"foreground":{"src":null},"visibility":{"levels":[]},"flags":{}}],"walls":[],"lights":[],"tiles":[{"_id":"NMUTXSGRxs2hngcf","texture":{"src":"maps/dd-test-roof-brown.png"},"x":210,"y":210,"width":280,"height":280,"elevation":10,"levels":["PnYyZl6iVBmIRXWy"],"occlusion":{"modes":[2],"alpha":0},"restrictions":{"light":false,"weather":false},"hidden":false,"locked":false,"flags":{}},{"_id":"MrXkMZdconnEyzVe","texture":{"src":"maps/dd-test-roof-blue.png"},"x":840,"y":210,"width":280,"height":280,"elevation":10,"levels":["PnYyZl6iVBmIRXWy"],"occlusion":{"modes":[2],"alpha":0},"restrictions":{"light":false,"weather":false},"hidden":false,"locked":false,"flags":{}},{"_id":"eMHL6s77Cih30QZj","texture":{"src":"maps/dd-test-roof-green.png"},"x":525,"y":525,"width":350,"height":210,"elevation":10,"levels":["PnYyZl6iVBmIRXWy"],"occlusion":{"modes":[2],"alpha":0},"restrictions":{"light":false,"weather":false},"hidden":false,"locked":false,"flags":{}},{"_id":"MAVZywPtKMN9ukFB","texture":{"src":"maps/dd-test-roof-brown.png"},"x":210,"y":210,"width":280,"height":280,"elevation":20,"levels":["fqeFhAArtqcpJgkt"],"occlusion":{"modes":[2],"alpha":0},"restrictions":{"light":false,"weather":false},"hidden":false,"locked":false,"flags":{}}],"regions":[{"_id":"Gld8W5rMqVN6WrjU","name":"Ground roof brown","color":"#cc28b7","shapes":[{"type":"rectangle","x":70,"y":70,"width":280,"height":280,"rotation":0,"hole":false}],"elevation":{"bottom":0,"top":10,"topInclusive":false},"levels":["PnYyZl6iVBmIRXWy"],"behaviors":[{"_id":"XOipF02DP2OZp6ed","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}},{"_id":"9oqHDsqdZAQT1uQ1","name":"Ground roof blue (exposure on)","color":"#cc28b7","shapes":[{"type":"rectangle","x":700,"y":70,"width":280,"height":280,"rotation":0,"hole":false}],"elevation":{"bottom":0,"top":10,"topInclusive":false},"levels":["PnYyZl6iVBmIRXWy"],"behaviors":[{"_id":"XnoS3LyCNFIgBDsq","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":true,"culling":false}}],"visibility":4,"locked":false,"flags":{}},{"_id":"P30UZ3qCr1Ey9VwY","name":"Ground roof green (triangle)","color":"#cc28b7","shapes":[{"type":"polygon","points":[350,420,700,420,525,630],"hole":false}],"elevation":{"bottom":0,"top":10,"topInclusive":false},"levels":["PnYyZl6iVBmIRXWy"],"behaviors":[{"_id":"PfAQH96svdQgdbCE","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}},{"_id":"BoklpUSzRy6LBWw5","name":"Hall roof brown","color":"#cc28b7","shapes":[{"type":"rectangle","x":70,"y":70,"width":280,"height":280,"rotation":0,"hole":false}],"elevation":{"bottom":10,"top":20,"topInclusive":false},"levels":["fqeFhAArtqcpJgkt"],"behaviors":[{"_id":"o8hzmiVRQG3ZcI31","name":"Define Surface","type":"defineSurface","disabled":false,"flags":{},"system":{"placement":"top","light":true,"move":true,"sight":true,"sound":true,"occlusion":true,"exposure":false,"culling":false}}],"visibility":4,"locked":false,"flags":{}}]}
```

What is in it: two levels. **Ground floor** (0..10 ft) has three roofs, each a **Tile** (Surface occlusion, `occlusion.modes: [2]`, alpha 0) at **elevation 10 (the level's top)**, each with its own **Define Surface** ceiling region (placement `top`, elevation 0..10, every restriction including Occlusion on): a **brown** square (x 70..350, y 70..350); a **blue** square (x 700..980, y 70..350) whose region has **"Reveal Elevated Surface" (exposure) ON** (the others have it off); and a **green** rectangle picture (x 350..700, y 420..630) whose region is a **triangle** (350,420) (700,420) (525,630), so the region's shape differs from the picture's. **Tall hall** (10..30 ft) has one brown square tile (x 70..350, y 70..350) at **elevation 20** (not the level's top) and a ceiling region 10..20 over it, so a token can be below the ceiling (10..20 ft) or above it (20..30 ft). Tiles are placed by centre (x = left + width/2). No walls, lights or foreground.

## Tests

**T17, import.** Imports without error? List every difference between the file and Foundry's export (apart from ids, `_stats` and the usual defaults): in particular the tiles' stored `occlusion`, and each tile's bounds (they should be exactly the rectangles above) [API/export]; the polygon region's stored points.

**T18, Ground floor, view it and read these probe points (scene coordinates).** Roof probes: **B** (130,130) brown tile; **U** (760,130) blue tile; **G1** (440,500) green tile and inside the triangle; **G2** (380,600) and **G3** (670,600) green tile but outside the triangle. Also **N** (525,250), plain ground. For each placement say, for each probe, whether you see the roof colour or the ground picture, and what the token looks like (drawn over the roof? hidden under it? faded?):

- (a) **no token on the scene**, nothing selected. Is each roof drawn over its full square, or cut away? Is the green rectangle drawn in full or cut to the triangle? Does blue (exposure on) look different from brown?
- (b) token at (210,210) elevation 0, **not selected** (click empty canvas or release it).
- (c) the same token **selected** (controlled).
- (d) token at (840,210) elevation 0, selected (inside the blue region).
- (e) token at (525,500) elevation 0, selected (inside the triangle).
- (f) token at (525,250) elevation 0, selected (inside none of the regions).
- (g) token at (210,210) elevation **9**, selected (just below the ceiling at 10; set by the API: say whether Foundry accepted it).
- (h) **two** tokens, at (210,210) and (840,210), both elevation 0, both selected. Does each fade only its own roof, or both?
- (i) press and hold the **"Highlight Objects"** keybinding (find it in Configure Controls) with no token: do roofs change? (If you can't hold a key, say so.)

**T19, Tall hall, view it; probe B** (130,130), with a token at (210,210) unless said:
- (a) no token;
- (b) elevation 15 (below the ceiling at 20, above the region's bottom 10), selected;
- (c) elevation 25 (above the ceiling, on the level), selected;
- (d) elevation 15 at (525,250) (outside the region), selected.

**T20, is a roof drawn above or below a token when it does not fade?** From the placements above where a roof stays drawn over a token's position, say whether the token is hidden by the roof, visible through it, or drawn over it.

**T21, the settings.** Read from the Define Surface region sheet and the tile sheet for the Ground floor brown roof: anything that changes the behaviour (placement, exposure, culling, tile occlusion modes and alpha). Do **not** change the scene; only report what the sheets offer. (If you want to test a setting, ask the person first and do it on a copy of the scene.)

## Reply

Save the fuller notes, your redacted export and the screenshots in `foundry-results/retest/` (`RESULTS-RETEST-5.md`). Then give the person a short summary (a table: T17 to T21, and each placement with its probe results) to paste back to the Dragon Drop developer, and tell them which files to send (`RESULTS-RETEST-5.md` and the redacted export). End with the separate "My reading" section, in two or three sentences: what decides whether a roof is cut (the viewer's position, a controlled token, elevation, the region shape), and whether each roof can be cut on its own.
