# RT6: how does Foundry v14 treat a level's foreground picture? (a prompt for Claude Code on the PC that has Foundry)

*Paste everything from the next heading to the end into the Claude Code session that ran the earlier Foundry tests (or any Claude Code session on the PC that has Foundry v14), and let it run. It is written to
stand on its own.*

---

You are helping test Dragon Drop (a map editor) against the person's real Foundry VTT v14. They are here and have asked for this test. Do every step you can yourself, the way you did in the earlier runs (driving Foundry in the browser pane,
using Foundry's own client API, staging files in the Foundry data folder, placing tokens by the canvas drop event); ask the person only for what you cannot do. Earlier results are in `foundry-results/` (RESULTS.md, RESULTS-RETEST.md, RESULTS-RETEST-2.md) if you
need the method.

## Why

Dragon Drop is getting roofs. A roof will be exported as a transparent PNG that becomes a level's **foreground** in a Foundry scene. We need to know how Foundry v14 really treats a level's foreground picture. The official documentation says nothing; a search of
the v14 release notes suggests that a token moving under a tile, background or foreground image at a **higher elevation** gets a new "surface" occlusion mode that fades the picture, but nobody has looked. Questions: (1) does a level's foreground show above its
background and above tokens; (2) does it fade or hide when a token is under it, and does it matter whether the token is on the same level as that foreground or a lower one; (3) does the token's elevation matter; (4) what does a viewer see of other levels' foregrounds.

## Rules

- Write only in a **new folder `foundry-results/retest/`** (create `RESULTS-RETEST-3.md` there) and in the Foundry folders you used before (`Data/maps`, the staging folder for Import Data). Do not touch earlier test scenes. Make a NEW scene.
- Redact Foundry user ids in anything you save (replace with `"REDACTED-USER"`). Do not save licence or account data.
- Report only what you observed. Mark each observation as **[screen]** (a screenshot), **[API]** (read from Foundry's client) or **[export]** (Foundry's own Export Data). Say how you read anything from the API.
- Do **not** edit the scene file (not even `_stats`). If something fails, stop and report it; do not work around it.
- Dragging tokens on the Ground floor did not work in your pane before. Do not rely on dragging: place tokens by dropping them at a position, and set their elevation through the API (say so).

## Step 1: make two test pictures

Save this as `make-roof-pngs.mjs` (Node only) and run `node make-roof-pngs.mjs <a temporary folder>`. Then copy `dd-test-roof-ground.png` and `dd-test-roof-attic.png` into `Data/maps`, next to `dd-test-cellar.png` and `dd-test-ground.png` (check those two are still there). Each picture is 1050 x 700, fully transparent except one solid rectangle with a lighter line down its middle: **BROWN** over x 140..525, y 140..560 (the west half of the room) and **BLUE** over x 525..910, y 140..560 (the east half).

```js
// node make-roof-pngs.mjs <folder>   writes two 1050 x 700 RGBA PNGs: transparent except one solid coloured rectangle (with a lighter vertical line down its middle)
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
const W = 1050, H = 700;
const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
function png(x0, y0, x1, y1, [r, g, b]) {
  const raw = Buffer.alloc((W * 4 + 1) * H); // each row: a filter byte (0), then RGBA; everything else stays 0 = fully transparent
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = y * (W * 4 + 1) + 1 + x * 4, k = Math.abs(x - (x0 + x1) / 2) < 6 ? 1.3 : 1;
    raw[o] = Math.min(255, r * k); raw[o + 1] = Math.min(255, g * k); raw[o + 2] = Math.min(255, b * k); raw[o + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const out = process.argv[2] ?? ".";
writeFileSync(path.join(out, "dd-test-roof-ground.png"), png(140, 140, 525, 560, [150, 90, 60])); // brown: the west half of the room
writeFileSync(path.join(out, "dd-test-roof-attic.png"), png(525, 140, 910, 560, [60, 100, 170])); // blue: the east half
console.log("wrote dd-test-roof-ground.png and dd-test-roof-attic.png in", out);
```

## Step 2: the scene file

Write this **exactly** (UTF-8, no BOM, one line, no trailing newline) as `RT6-roof-foreground.json`, and check its SHA-256 is `1741b49b6ea2ddd14ae41907f69bcb55caa87870ba1bda5adf5542b0b689f359` (if it differs, say so and do not use it).

```json
{"name":"Dragon Drop roof test","_stats":{"coreVersion":"14.353"},"navigation":false,"width":1050,"height":700,"padding":0,"shiftX":0,"shiftY":0,"grid":{"type":1,"size":70,"distance":5,"units":"ft","color":"#000000","alpha":0.2},"tokenVision":true,"initialLevel":"79QGVzqun9aetNmc","levels":[{"_id":"79QGVzqun9aetNmc","name":"Cellar","sort":0,"elevation":{"bottom":-10,"top":0},"background":{"src":"maps/dd-test-cellar.png"},"foreground":{"src":null},"visibility":{"levels":[]},"flags":{}},{"_id":"QeBDuEn1eQLJ6Wzl","name":"Ground floor","sort":100000,"elevation":{"bottom":0,"top":10},"background":{"src":"maps/dd-test-ground.png"},"foreground":{"src":"maps/dd-test-roof-ground.png"},"visibility":{"levels":[]},"flags":{}},{"_id":"NNUYjdWwBxQqFtOQ","name":"Attic","sort":200000,"elevation":{"bottom":10,"top":20},"background":{"src":"maps/dd-test-ground.png"},"foreground":{"src":"maps/dd-test-roof-attic.png"},"visibility":{"levels":[]},"flags":{}}],"walls":[],"lights":[],"tiles":[],"regions":[]}
```

Three levels: **Cellar** (-10..0, no foreground), **Ground floor** (0..10, foreground = the BROWN picture) and **Attic** (10..20, foreground = the BLUE picture). No walls, lights or regions. Import it with Foundry's Import Data into a new empty scene named "RT6 roof foreground" (it will be renamed to the file's name, as before), then Export Data to read back what Foundry stored.

## Tests

- **T8, import.** Does it import without error? Are the three levels, elevations and foreground paths kept? List every difference in Foundry's export (apart from ids, `_stats` and Foundry's usual defaults), including what Foundry writes for each foreground's other fields (tint, alphaThreshold, and any occlusion setting).
- **T9, what you see.** As GM with NO token selected, view each of the three levels in turn. Which pictures are drawn, and where (a screenshot of each)? In particular: does viewing the Ground floor show the brown picture over the west half? Does it show the blue one? What does the Attic view show of the brown one? What does the Cellar view show?
- **T10, the occlusion question.** Place a token by dropping it, and for EACH placement say, ideally with a screenshot beside the same view without the token, whether any foreground picture fades, goes transparent or hides, and which one:
  - (a) Ground floor, elevation 0, centre inside the brown rectangle at (300, 350);
  - (b) the same spot at elevation 5;
  - (c) Ground floor, elevation 0, inside the blue rectangle at (700, 350);
  - (d) Attic, elevation 10, inside the blue rectangle (700, 350);
  - (e) Attic, elevation 10, inside the brown rectangle (300, 350);
  - (f) Cellar, elevation -5, at (300, 350);
  - (g) Ground floor, elevation 0, outside both rectangles at (80, 80).
  If you can read the state from Foundry's API (for example each level's foreground mesh or sprite on the primary canvas group: its alpha, an "occluded" flag, its occlusion mode, its elevation), give the values for each case and say how you found them. Also say which elevation Foundry gives each level's foreground (bottom, top or something else) if you can see it.
- **T11, is it a simple setting?** In Scene Configuration > Levels > Ground floor, look for any foreground option about occlusion, fade or tint. List the options and their defaults (screenshot).

## Reply

Save the fuller notes, your redacted export and the screenshots in `foundry-results/retest/` (`RESULTS-RETEST-3.md`). Then give the person a short summary (a table: T8 to T11, and each T10 placement) that they can paste back to the Dragon Drop developer, and tell them which files to send (`RESULTS-RETEST-3.md` and the redacted export).
