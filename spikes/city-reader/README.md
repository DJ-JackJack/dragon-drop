# City reader spike (2026-11-20)

A throwaway test of one question: can buildings be read out of a picture of a city map? `read.ts` classifies pixels by colour (red, grey and yellow roofs), finds each connected blob, fills its holes, fits a rotated rectangle and draws the result over the picture.

```
node node_modules/tsx/dist/cli.mjs spikes/city-reader/read.ts <picture.png, about 2000 px wide> <output-prefix> [x0 y0 x1 y1 for a zoomed overlay]
```

It was tried on the DM's own city map (4962 x 3508, shrunk to 2000 wide). The picture is the DM's work and is not in the repository; do not add it.

## What it showed

- **Red and grey roofs: very good** in the dense middle, north and east. Nearly every roof got a tight rotated rectangle, including rows of small houses separated by 2 px gaps. L-shaped buildings were found as one blob (the rectangle fit is poor for them: they need an outline, not a rectangle).
- **Yellow roofs: poor.** The thresholds were too strict inside the walls, and outside the walls the roofs are nearly the colour of the parchment ground. Colour alone will not do there: it needs contrast with the neighbouring ground (the dark outline and shadow round each roof).
- **False hits** on the picture's border frame, the sea's rope lines, boats, the compass and the lettering. The reader needs an area to read (the DM draws it) and size and shape limits worked out from the map's scale.
- **Numbers (rough):** 2,431 blobs, about 950 of them clean rectangles (200 red, 718 grey, 31 yellow). Thousands of buildings in all.
- The colours were fixed numbers here. In the real reader the DM clicks one example of each kind of roof, the street and the water, and the thresholds come from those clicks.

See `docs/CITY-MAPS.md` for the plan this feeds.
