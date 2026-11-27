# Faster painting and sculpting: measurements and plan

The person, 2026-11-26: "often I'm waiting several seconds for the brush to catch up with me." This page is what a stroke costs today, why it
falls behind, and what to change, in order. Measure with `pnpm bench:brush` (`scripts/brush-bench.ts`; a 2048 world map by default, `pnpm bench:brush 1024`
for another size) before and after each step.

## What a stroke costs (2026-11-26, a generated 2048 × 2048 continent, the person's PC)

| Step | Time |
|---|---|
| A sculpt dab on the server (the edit and its undo), radius 20 / 60 / 150 px | 0.1 / 0.8 / 3.7 ms |
| Painting the patch a dab changed (Painted style, in the editor's paint worker), radius 20 / 60 / 150 | **21 / 72 / 304 ms** |
| The whole climate and all the rivers worked out again (server, compute thread) | **2,280 ms** |
| The painted ground's own planes (all a Ground stroke needs) | 75 ms |
| The climate frame sent to the editor | **42 MB** (packing it: 7 ms) |
| The editor finding what changed in it | 47 ms |
| A whole-map repaint (Painted style) | 4,560 ms |
| The texture noise, made once per map (then cached on disk) | 8,100 ms |

## Why the brush falls behind

**Sculpting.** The server's part is tiny. The editor paints each dab's patch as it arrives, one after another, and never merges them. Dabs are spaced
0.3 of the radius apart (`MapView.tsx`, up to 20 per mouse move), so each dab's square overlaps the last by about two thirds and every pixel along a stroke is
painted 3 to 7 times. At radius 60 one quick mouse move of 300 px sends 16 dabs: about 1.2 s of painting for a move that took a fraction of that. The
queue grows for as long as the stroke lasts, and the picture catches up seconds after the mouse stops. At radius 150 each dab alone takes 0.3 s.

**The Ground brush.** A stroke is one edit when the mouse is let go. Because the painted ground was added to the climate's inputs (`Hub` regions key),
the server then works out the whole climate and all the rivers again (2.3 s), although painted ground changes neither (it is paint only), sends the
whole 42 MB frame, and the editor looks for what changed and repaints that box. The stroke's own preview is only the brush outline until all that is done.

**After a sculpt stroke** the same 2.3 s climate and rivers run (on the compute thread, so nothing freezes), then the 42 MB frame, then a repaint of
whatever changed, which is large when the rivers move.

## The plan, in order

### Stage 1: never fall behind (small changes, the biggest gain)

1. **The paint worker merges patches.** On a patch: take the heights at once (cheap), add the rect to what is waiting, and paint what is waiting once the
   worker's queue is empty (a `setTimeout(0)` after the last message), as one rect or a few. A stroke then paints each pixel about once per frame
   instead of 3 to 7 times, and the picture is never more than one paint behind the mouse. (`paintWorker.ts`, `case "patch"`.)
2. **A Ground stroke works out only the painted ground.** Keep `groundCells` out of the key that sets off the climate and rivers; when only it changed,
   the server works out `groundPaintPlanes` (75 ms) and sends just those two planes, only the box that changed. (`Hub` features handler, `refreshDerived`,
   a smaller frame message.) From 2.3 s and 42 MB to well under 0.2 s and a few hundred KB.
3. **Send the dabs of one mouse move together.** One `sculpt` command with all its dabs (or the server merging the patches of one message) gives one
   patch per mouse move instead of up to 20: fewer messages and fewer, larger rects for step 1 to merge.

### Stage 2: paint a patch faster

4. **Find where a patch's paint goes** (`node --cpu-prof` on `PaintEngine.tile`). Suspects: each tile works out the blurred layers again (`paintPrep`:
   the climate's blurs don't change while sculpting, so they can be kept between dabs), the rivers rasterised for every tile (`rasterRivers`), and the
   ground's weights per pixel (`biomeWeights`, with `applyPaintedGround`). Aim: 2 to 3 times faster.
5. **Use more cores for a stroke's patch.** Today one paint worker paints everything (the short-lived pool in `paintClient.ts` only builds the texture
   noise). A second or third painter would each need its own copy of the heights, the noise and the climate layers (hundreds of MB on a 2048 map) unless
   they can share memory (`SharedArrayBuffer`, which needs the page to be cross-origin isolated: a header change to try in the desktop app). Worth it
   only if steps 1 to 4 aren't enough.
6. **If still not enough: a quick look while the mouse is down.** Paint the stroke's patches at half resolution (a quarter of the work) and paint them
   properly when the stroke ends.

### Stage 3: what comes after a stroke

7. **Send only what changed of the climate frame**: the planes and the box that differ (usually a few MB at most instead of 42), and let the editor skip
   its own comparison for them.
8. **Show the Ground stroke as it is painted**: the paint worker works out the painted ground for the stroke's box itself (`groundPaintPlanes` is pure
   core code) and repaints it while dragging, with step 1's merging.
9. **Look into the rivers after a sculpt stroke**: whether small edits can skip the climate (it barely moves) and rework only the rivers near the edit.
10. **Optional: the sculpt dab drawn by the editor at once** (the same core `sculpt` on its own heights) before the server's patch arrives. On one PC the
    round trip is short, so this matters only on slow PCs; it comes last.

## How we'll know it worked

- `pnpm bench:brush` before and after each step; the numbers go into this page.
- A stroke at radius 60 on a 2048 map keeps up with the mouse (the picture is never more than about a tenth of a second behind it).
- A Ground stroke shows painted within about 0.3 s of letting go.
- The browser test can play a slow PC (`E2E_CORES=2`, `E2E_CPU_SLOWDOWN=4`): a step that strokes the brush and waits for the paint to settle, timed.
