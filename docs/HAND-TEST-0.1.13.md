# Hand test for 0.1.13

Everything here passed the automatic tests and the browser test, and Claude tried most of it on a test server with your asset library. What's left needs your eyes as a DM, and a few things Claude couldn't try at all: a second screen, real paper, Windows opening your own files, and Foundry as a player.

**Where:** the test copy. Double-click **Test Dragon Drop.cmd** in `apps\desktop\release\win-unpacked` (in the Dragon Drop code folder). It has its own settings and its own maps (First Map, a battlemap and a settlement), so your real maps are never touched. To try something on one of your own maps, **copy** (don't move) its folder into that copy's `test-maps` folder first. If your asset packs don't show, choose your asset folder in Settings → **Maps and assets**.

**How:** tick a line when it works. When something looks wrong, jot down what you did and what you saw, and tell Claude.

**Already checked by Claude (2026-11-23, second round):** lines ticked below with *Claude checked* are done; skip them unless you're curious. Claude worked on the test server with your asset library and on a **copy** of your world map (your own map wasn't touched). This round found and fixed two things: a generated dungeon's walls leaned a little off the grid where a corridor met a room, and the Ink style's ripple lines out to sea were jagged close up. It also reworded the print's first page.

## Getting started

- [ ] It starts and opens First Map. Settings has four tabs: AI assistant, Maps and assets, **Access key** (the old Phone tab is gone), Help and updates.

## New in this update

### Ruler (`K` on world maps and settlements, `M` on battlemaps)

- [ ] World map: click points along a route, double-click to finish. You see the distance, the time on foot, riding, by wagon and by ship, and what the route crosses (roads, rough ground, water, rivers, the climb). Do the times feel right for your game?
- [ ] Change a pace; it is remembered next time.
- [x] Battlemap: feet and squares. Settlement: metres, feet and minutes on foot. *Claude checked: 18 squares came out as 90 ft, each leg right.*

### Printing a battlemap at table scale

- [ ] Battlemap → **Export** → **Print at table scale**: it says how many pages; try Letter and A4; open the PDF.
- [ ] Print one page at **Actual size** (not "Fit to page") and measure: **one square is one inch**. The first page shows how the pages fit together; the corner marks line up when you join two pages. *Claude checked the PDF itself: on A4, 10 squares are drawn exactly 10 inches wide and the grid lines are exactly an inch apart. What's left is whether your printer keeps it so.*
- [ ] **Save ink**: a lighter picture with the walls as dark lines.

### Scatter brush

- [ ] Choose a tree or rock in the **Assets** tab, then the Object tool → **Scatter**, and drag. The objects are spread out, varied in size and turn, and don't overlap. One Undo takes the whole stroke back.
- [ ] **Only on floor** keeps them off the empty void.

### GM only

- [ ] Tick **GM only** on a place (world map), an object and a light (battlemap), and a building's name (settlement): each shows faintly.
- [ ] World map **Export**: **For players** is ticked and the secret place is missing from the picture. Untick it and the place is there.
- [ ] Battlemap **Export** (picture, Universal VTT, Foundry, print): no secret object or light, and no gold mark on a secret door. Tick **My own copy** and they are back.

### Prefabs (`C` on battlemaps)

- [ ] **Save**: drag over a room and give it a name. **Place**: choose it by its picture, `Q`/`E` turn it, `X` mirrors it, a click places it. One Undo removes it.
- [ ] Place it on a different battlemap; any pack floors it used come along.
- [ ] **Rename** and **Remove** in its list (removed ones go to `Prefabs\Removed` in the maps folder).

### Generate (Map panel)

- [ ] Battlemap: **Make a dungeon** (small, medium, large; doors, torches), then a cave. Do they look like places you'd run? It asks before replacing what's there, and Undo works. *Claude checked that it asks first, and fixed walls that leaned where a corridor met a room. Whether they're places you'd run is yours to say.*
- [x] Type the seed from the note and make it again: the same map. *Claude checked: seed 4242 made the same six rooms twice.*
- [ ] Settlement: make a hamlet, a village and a large village. On a settlement started from a world map (**Settlement here**), the village keeps out of the water and the woods.

### Player screen (best with a TV or second monitor plugged in)

- [ ] Battlemap → Map panel → **Open the player screen**: on a second screen it opens full screen there; with one screen it's a window.
- [ ] Turn on **Fog** and the player screen goes black. With the **Reveal** tool (the eye in the tool rail; it has no key), click in a room: that room shows on the player screen with its lights. Then try **Area**, **Hide area**, **Hide everything**, and Undo a reveal. *Claude checked revealing from a spot and an area in a browser: the room showed with its torches, plus what can be seen through its open doorway; a closed door kept the next room dark.*
- [ ] Nothing GM only, no room numbers and no secret-door marks appear on the player screen.
- [ ] **Show my view** and **Whole map** change what the TV shows. Double-click the player screen for full screen; `G` shows or hides the grid.
- [ ] Open a world map in the editor: the player screen just waits; it never shows the world map.

### Realms (`B` on world maps)

- [ ] **Choose a realm** → type a name → **Add**, then paint. It stops at the coast (**Land only**).
- [ ] Make a second realm and paint it with **Round neighbours**: it fills up to the first one's border without taking its land. Try **Erase** too.
- [ ] The names sit in the realms' middles; the list shows each one's size in km², and colour, GM, Name, Rename and Remove work.
- [ ] Do a few other edits (add a place, move a label): every realm is still painted (a bug Claude fixed during testing).
- [ ] The **Realms** switch in Layers hides them; an exported picture shows them.

### Object shadows and tints

- [ ] Select an object: **Shadow**, **Tint** (try a grey "colour it yourself" picture), **Strength**, **No tint**. An exported picture looks the same.
- [ ] The Object tool's **Shadow** tick gives new and scattered objects a shadow; with several objects selected, **Shadows: On / Off**.

### Links to your notes

- [ ] A place's panel → **Your notes**: paste a web address; **Open** opens your browser.
- [ ] **Choose a file…**: pick a Markdown, PDF or Word file; **Open** opens it in its own program. If you use Obsidian, try an Obsidian link.
- [ ] A realm: **Link** in the Realm list does the same.

### Ink style

- [ ] World map → Style → **Ink**: parchment, an inked coast with ripple lines, peaks, hills and woods. Does it look like a map you'd hand your players?
- [x] On your biggest world map (copied in first): how long it takes to draw, and whether editing still feels smooth. *Claude checked on a copy of Ahvantir (2048): switching to Ink took 0.7 s and reopening it 1.5 s (the Painted style takes 3 to 11 s); as a slow PC (2 cores, a page 4 times slower), 2.3 s and 4 s. A small edit showed in under 3 s, and zooming and dragging didn't stall.*
- [ ] Export a picture in Ink.

### Object layers (battlemap Map panel)

- [ ] Add a layer and click it; place objects, and they go into it.
- [ ] Hide it: its objects disappear from the map, an exported picture and the player screen. Lock it: its objects can't be clicked. ▲ ▼ change which layer is drawn on top; ✕ removes the layer but keeps its objects.

### Claude (needs Claude Code running in the app's terminal)

- [ ] Ask Claude to measure a route, make a dungeon, reveal a room on the player screen, add and paint a realm you name, and save a prefab and place it. It should ask you before replacing anything. *Claude checked through the map tools: measure, make a dungeon, reveal and save a prefab worked, and replacing a dungeon with a cave and carving a valley both waited for your Allow (and did nothing when no one answered). Asking Claude Code in the app's terminal is still yours to try.*

## Still to try from earlier

### The asset update

- [ ] How the pictures Dragon Drop picks look to you: **Battlemap here** from a world map and from a settlement. *Claude sent you pictures of three made from a copy of your map (woodland, jungle) and a settlement; judge from those, or make your own.*
- [ ] Painting floors and building walls, doors, windows, paths, roofs and lights from your packs; **★ Starred** and **Recent**; words for pictures.
- [ ] **Ask Claude to tag this pack** in the Assets tab (needs Claude Code in the terminal).
- [x] The Starter Pack's ten floors are there, even with no asset folder chosen. *Claude checked: with no asset folder, all ten floors were listed.*
- [ ] A settlement building's roof picture chosen by sight.
- [ ] Rivers in dry country: a new map's dry land has few rivers; **Dry land has few rivers** and **No rivers from the rain** in the Climate panel.
- [x] The window made narrow (down to 720 wide) is still usable. *Claude checked at 720 wide with both side panels open: the map fits itself, and every button can still be reached. The map is small; hiding a panel gives it room.*

### On your own maps and pictures (copies)

- [ ] The settlement picture reader on one of your own city pictures: the trace picture's **Read the picture…** (buildings, streets, water). *Claude couldn't do this one: none of your maps has a city picture in it. Try it when you have one.*
- [ ] Water on your own world map: name a river, **Carve valleys…**, **Lowland rivers**. *Claude checked on a copy of Ahvantir: naming a river found it (1,363 km, to the sea) and wrote the name along it; Carve valleys' preview showed the cut; Lowland rivers is already on in your map. The carve itself waits for your Allow, so it's yours to try.*

### Foundry (needs a second login as a player)

- [ ] Export a battlemap with roofs and two levels as a Foundry scene, then as a player: the roof fades over your token, a token above a ceiling, and what a hole does to a token (`FOUNDRY.md`).
