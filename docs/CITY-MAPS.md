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
- **File format:** city maps are written in their own file format (2 in 0.1.10, 3 since their land, trees and climate) while every other map stays in format 1, so an older Dragon Drop refuses a city (it would treat it as a world map and drop its buildings) and still opens everything else.
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

## Land, climate, bridges and better planning (decided 2026-11-20, for 0.1.11)

From the DM's first try of stage 1 in the desktop app: building works, but Claude laid everything out in perfect straight rows with no thought for the land or what is on it, a street across water had no bridge, and a city had no terrain or climate. The DM chose: **each city has its own land and climate, shaped by the DM or Claude, and can optionally start from a spot on one of the DM's world maps.** In four steps, each ending with something to look at:

1. **Land and climate. BUILT (2026-11-20, not yet released or tried by the DM).** As planned, except that the land is not a second grid of heights but **shapes** (`features.land`: hills, ridges and valleys, plateaus and hollows, slopes, in core `cityLand.ts`), added up into heights for every ground cell: they are features, so undo, saving, checkpoints and the editor's sync work for them unchanged, and a hill stays one thing to select, move or change. Built: the shading and contour lines (the editor, Claude's previews and `render.jpg`), the Land (`L`) and Trees (`T`) tools, the Map panel's Land and climate (climate presets, height above the sea, contour lines), the inspector for a landform or a group of trees, and Claude's `shape_land`, `update_land`, `remove_land`, `list_land`, `land_at`, `set_city_climate`, `add_trees`, `list_trees`, `remove_trees`. There are no Smooth or Flatten brushes: the shapes are smooth by nature, and a plateau flattens. The plan as written:
   - A city gets a **height layer** (metres above the sea, one value per ground cell, beside the ground paint). It is drawn as soft hill shading and, as a layer switch, faint contour lines (every 5 m). A new city is flat, so cities made before look the same.
   - The DM shapes it with Raise, Lower, Smooth and Flatten brushes; Claude with a tool that adds hills, ridges, valleys and slopes in metres. Water stays ground paint (the DM or Claude paints the river in the valley and the sea along the low side).
   - A **climate** for the city (cold, temperate, warm and wet, Mediterranean, dry, tropical, or temperature and rainfall as numbers, as the world map's climate regions have): it sets the colour of the grass and fields, snow on roofs and ground when it is cold, dust and sand when it is dry.
   - **Trees** (groups, orchards, gardens, woods): drawn as tree tops whose kind follows the climate (firs when cold, broad trees when temperate, olives and cypresses on the Mediterranean, palms when tropical, few and thorny when dry). A Trees tool in the editor, a tool for Claude.
   - File format: the height layer and the trees are new things in a city file that 0.1.10 would drop on its next save, so city maps move to format 3 (older versions refuse them; a format 2 city is migrated with a flat height layer).
2. **Bridges.** Where a street crosses water it is drawn as a bridge, worked out from the street and the ground each time (move the street or paint the river and the bridge follows): a deck the width of the street, low walls along its sides, and stone piers or wooden posts in the water. Each street has a bridge setting: automatic (stone for avenues and streets, wood for lanes, alleys and paths), stone, wood, or none (a ford). In the editor, Claude's previews and the pictures.
3. **Claude plans like a town grew.** The straight rows come from Claude placing every building by its numbers, so it gets better building blocks:
   - **Line a street with buildings**: one or both sides of chosen streets filled with buildings that face the street and follow its curves, varied in width, depth, setback and roof, with gaps for alleys and yards, skipping water, streets, other buildings and ground too steep to build on; dense terraces in the centre, detached houses with gardens further out, farms at the edge.
   - **A street that follows the land**: from one point to another (through chosen points), bending along the slope and around water (or crossing it on a bridge where asked), and meeting existing streets at junctions.
   - **Check the city**: buildings in water, on streets or overlapping, buildings on steep ground, streets that end nowhere, very long bridges; with counts and where.
   - **Rules in Claude's instructions**: how towns grow (at a river crossing, a harbour, round a castle on a hill, along a road), the main streets following the land and the old tracks between the gates, lanes branching off at angles, irregular blocks (a grid only for a planned town), the temple on a rise or a square, the keep on the highest ground, docks on deep water, mills on the river, a market at the crossing, roofs varying by district; and checking before saying it is done.
4. **Start from a world map.** In the New map dialog and for Claude: choose a world map and a place (or a point) on it. The city takes its climate from the world map's climate there, its height from the world map's land there, and a rough first shore or river where the world map has sea or a river inside the city's area (a world-map pixel is a kilometre or more, so this is a starting point to edit). The city remembers where it is, with a way back to the world map.

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
