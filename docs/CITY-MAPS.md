# City maps (plan, 2026-11-20)

## Why

The DM tried to recreate a top-down city map (a large walled city on a bay: thousands of buildings, a street network, a harbour, landmarks) and it failed in three ways:

- as a **battlemap** the districts could only be flat colour patches (it looked childish);
- as a **world map** the terrain painter filled the city with wilderness;
- as a **regional map** of the whole world the city came out about 10 pixels wide.

Neither kind of map has buildings or streets, and Claude has no tool that draws them. The picture was also sent to Claude Code's terminal, not added to References, and the trace picture did not exist yet, so everything was placed by eye.

## Decision

Build a third kind of map, a **City map**, made of things: buildings, streets, walls, water, parks. Dragon Drop draws them in its own style and every piece stays editable. The result is the city redrawn in Dragon Drop's look, not a copy of the artwork.

Considered and kept for later: a **picture map** (the picture is the map's ground; places, labels and notes go on top; nothing in it is editable). It is a smaller job and keeps the artwork. Much of it (a picture as ground, a scale tool, the link to a world map place, "battlemap here" from an area) the city kind needs too, so it can be added without waste.

## What a city map is (decided in stage 1, 2026-11-20)

- **Its own small document, not a stretched battlemap.** Checked against the code: a battlemap assumes at most 150 squares a side, at least 20 pixels a square and a textured floor cell, and a city is 1 to 6 km across. So `meta.kind` is `"city"`, `meta.city` holds the size in metres and the ground cell size, and the heightfield holds the ground material of coarse cells (the battlemap's material list, grass to start). What it does reuse: the material list and `paint_floor`, the roof drawing, the trace picture, the session (undo, history), the store and the hub.
- **Buildings** (`features.buildings`) are outlines in metres with a roof look. A building seen from above is a roof, and the roof drawing made for battlemaps (`battleRoof.ts`: slate, clay tile, thatch, shingle, pitched with a ridge, shadows) draws them, at any scale. Each also has a kind (house, temple, arena...), an optional name, colour and floors.
- **Roof pictures first, a drawn roof only when there is none** (decided 2026-11-20). When the person's asset packs hold a roof texture that fits a building's roof look (slate, clay tile, thatch, shingle), the building uses it (`MapBuilding.asset` and `.tile`, the metres one repeat covers); the look is drawn only when the packs have no appropriate picture, or no library is set up. Whole-roof objects (a colourable rectangular roof, chimneys, linings) are not textures and are not used yet: they have a fixed size and shape, so placing them is a later job. The rules are in core `roofAssets.ts`: a roof texture is a picture under a patterns/roofs/terrain folder with "roof" in its path and nothing under an objects folder; packs of another setting (cyberpunk, sci-fi, modern) are skipped; one of each file name is kept (the same texture is in several packs); a default pick avoids snowy, frosty, untinted "colorable" pictures and, for tiles, purple, green, blue and pink glazes (asking by name, `match: "purple"` or `"snowy"`, still reaches them); the pick is stable for a building's id and spreads over the pictures. A real library (400,000 pictures) gives 222 roof textures: 170 tile, 30 thatch, 12 shingle, 10 slate. The packs' roof pictures end in a see-through strip (1% to 9% of the picture): `opaqueRowCount` cuts it off, in the server's tile (`AssetLibrary.tile(id, squares, true)`) and in the editor, so the tiles repeat without a dark seam. A roof also follows its own ridge: `roofTurn` turns the slope, the rows and the texture to the building's longest side, so a turned house is not drawn as an upright one. Claude's `find_roof_assets` lists what the packs offer; `add_buildings` / `update_buildings` use pictures unless told to draw (`roof_assets`); the editor's Roof pictures / Drawn switch and a building's Another / Draw it instead / Use a roof picture buttons do the same by hand. The editor fetches the list from `/api/assets/roofs`.
- **Streets** (`features.streets`) are lines with a width in metres (avenue 12, street 7, lane 4, alley 2, path 1.5). **City walls** (stage 3) will have towers and gates. **Water** and **parks** are ground (stage 3 may add outlines).
- **File format:** city maps are written in file format 2 while every other map stays in format 1, so an older Dragon Drop refuses a city (it would treat it as a world map and drop its buildings) and still opens everything else.
- **The editor** draws the ground as a small picture scaled up smoothly, and the streets and buildings as vectors, only what is in view. The server's pictures (Claude's previews) are drawn by `renderCity` with the same colours.
- **Places, labels and notes** as on world maps. Names read from a picture are suggestions: nothing becomes canon until the DM confirms it.
- Thousands of buildings: drawing is culled to the view, saving and undo must cope (one undo step per batch), and **Claude never carries thousands of polygons through chat**: the reader runs in the app and Claude starts it with a tool.

## Stages (each ends with something to look at)

1. **The city map and buildings. DONE (2026-11-20).** The New map dialog's City option, the editor view with its tools (Building, Outline, Street, Paint ground, Select, Pan), an inspector for what is selected, saving (format 2), undo, the trace picture on a city map, and Claude's tools (`create_city`, `paint_ground`, `add_buildings`, `update_buildings`, `remove_buildings`, `list_buildings`, `add_streets`, `list_streets`, `remove_streets`, `render_city`). A town of 1,440 buildings added in one edit and drawn in the editor works; 3,000 buildings render for Claude in well under 8 s. Checked by hand in the browser and by the end-to-end test. **Not tried:** the desktop app, and Claude itself building a town from a description.
2. **The picture reader.** Lay the picture over the map (the trace picture), draw the area to read, click one example of each kind of roof, the street, the water and the park, see a preview of what it found, accept it. the city's buildings appear. Includes the speed work for thousands of buildings.
3. **Streets, walls, water, parks.** The same reader for the lanes (turned into lines), the harbour and the green; the city wall with towers and gates; tools to draw them.
4. **Working in it.** Select, move, delete and group buildings; district outlines; names and labels; link it to its place on the world map ("Open city map" and back); PNG export and the phone page.
5. **A battlemap from a spot in the city.** Drag a box: a battlemap opens with the buildings' outlines as walls and roofs, ready for doors, floors and furniture, and a Foundry export.

Later: a city made from a description ("a walled port town of 5,000 people").

## The picture reader: what the spike showed

`spikes/city-reader/` (README there). On the DM's own city picture:

- red and grey roofs are found very well (tight rotated rectangles, even rows of small houses 2 px apart);
- yellow roofs, mostly outside the walls on parchment-coloured ground, are poor with colour alone: use contrast with the ground (the dark outline and shadow);
- false hits on the border frame, rope lines in the sea, boats, the compass and lettering: the DM draws the area to read, and size and shape limits come from the map's scale;
- L-shaped buildings need an outline, not a rectangle;
- colours must come from the DM's clicks, not fixed numbers;
- expect to fix some by hand or with Claude; how many is the open question until stage 2.

## Risks

- **Speed and size** with thousands of buildings (drawing, saving, history, the server's previews).
- **The yellow districts** and other low-contrast pictures, and painterly maps in general.
- **The look**: whether roofs drawn at this scale look good, not just correct.
- **Different maps**: the reader is only proven on one picture. Test pictures in the repo must be drawn by code, never the DM's own maps.
