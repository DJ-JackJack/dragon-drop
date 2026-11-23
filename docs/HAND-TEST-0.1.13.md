# Hand test for 0.1.13

Everything here passed the automatic tests and the browser test, and Claude tried most of it on a test server with your asset library. What's left needs your eyes as a DM, and a few things Claude couldn't try at all: a second screen, real paper, Windows opening your own files, and Foundry as a player.

**Where:** the test copy. Double-click **Test Dragon Drop.cmd** in `apps\desktop\release\win-unpacked` (in the Dragon Drop code folder). It has its own settings and its own maps (First Map, a battlemap and a settlement), so your real maps are never touched. To try something on one of your own maps, **copy** (don't move) its folder into that copy's `test-maps` folder first. If your asset packs don't show, choose your asset folder in Settings → **Maps and assets**.

**How:** tick a line when it works. When something looks wrong, jot down what you did and what you saw, and tell Claude.

## Getting started

- [ ] It starts and opens First Map. Settings has four tabs: AI assistant, Maps and assets, **Access key** (the old Phone tab is gone), Help and updates.

## New in this update

### Ruler (`K` on world maps and settlements, `M` on battlemaps)

- [ ] World map: click points along a route, double-click to finish. You see the distance, the time on foot, riding, by wagon and by ship, and what the route crosses (roads, rough ground, water, rivers, the climb). Do the times feel right for your game?
- [ ] Change a pace; it is remembered next time.
- [ ] Battlemap: feet and squares. Settlement: metres, feet and minutes on foot.

### Printing a battlemap at table scale

- [ ] Battlemap → **Export** → **Print at table scale**: it says how many pages; try Letter and A4; open the PDF.
- [ ] Print one page at **Actual size** (not "Fit to page") and measure: **one square is one inch**. The first page shows how the pages fit together; the corner marks line up when you join two pages.
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

- [ ] Battlemap: **Make a dungeon** (small, medium, large; doors, torches), then a cave. Do they look like places you'd run? It asks before replacing what's there, and Undo works.
- [ ] Type the seed from the note and make it again: the same map.
- [ ] Settlement: make a hamlet, a village and a large village. On a settlement started from a world map (**Settlement here**), the village keeps out of the water and the woods.

### Player screen (best with a TV or second monitor plugged in)

- [ ] Battlemap → Map panel → **Open the player screen**: on a second screen it opens full screen there; with one screen it's a window.
- [ ] Turn on **Fog** and the player screen goes black. With the **Reveal** tool (the eye in the tool rail; it has no key), click in a room: that room shows on the player screen with its lights. Then try **Area**, **Hide area**, **Hide everything**, and Undo a reveal.
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
- [ ] On your biggest world map (copied in first): how long it takes to draw, and whether editing still feels smooth.
- [ ] Export a picture in Ink.

### Object layers (battlemap Map panel)

- [ ] Add a layer and click it; place objects, and they go into it.
- [ ] Hide it: its objects disappear from the map, an exported picture and the player screen. Lock it: its objects can't be clicked. ▲ ▼ change which layer is drawn on top; ✕ removes the layer but keeps its objects.

### Claude (needs Claude Code running in the app's terminal)

- [ ] Ask Claude to measure a route, make a dungeon, reveal a room on the player screen, add and paint a realm you name, and save a prefab and place it. It should ask you before replacing anything.

## Still to try from earlier

### The asset update

- [ ] How the pictures Dragon Drop picks look to you: **Battlemap here** from a world map and from a settlement.
- [ ] Painting floors and building walls, doors, windows, paths, roofs and lights from your packs; **★ Starred** and **Recent**; words for pictures.
- [ ] **Ask Claude to tag this pack** in the Assets tab (needs Claude Code in the terminal).
- [ ] The Starter Pack's ten floors are there, even with no asset folder chosen.
- [ ] A settlement building's roof picture chosen by sight.
- [ ] Rivers in dry country: a new map's dry land has few rivers; **Dry land has few rivers** and **No rivers from the rain** in the Climate panel.
- [ ] The window made narrow (down to 720 wide) is still usable.

### On your own maps and pictures (copies)

- [ ] The settlement picture reader on one of your own city pictures: the trace picture's **Read the picture…** (buildings, streets, water).
- [ ] Water on your own world map: name a river, **Carve valleys…**, **Lowland rivers**.

### Foundry (needs a second login as a player)

- [ ] Export a battlemap with roofs and two levels as a Foundry scene, then as a player: the roof fades over your token, a token above a ceiling, and what a hole does to a token (`FOUNDRY.md`).
