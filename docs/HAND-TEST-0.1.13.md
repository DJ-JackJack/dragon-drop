# Hand test for 0.1.13

Everything here passed the automatic tests and the browser test, and Claude tried most of it on a test server with your asset library. What's left needs your eyes as a DM, and a few things Claude couldn't try at all: a second screen, real paper, Windows opening your own files, and Foundry as a player.

**Where:** the test copy. Double-click **Test Dragon Drop.cmd** in `apps\desktop\release\win-unpacked` (in the Dragon Drop code folder; Windows may hide the `.cmd`, so look for **Test Dragon Drop**, a "Windows Command Script"). It has its own settings and its own maps, so your real maps are never touched. To try something on one of your own maps, **copy** (don't move) its folder into that copy's `test-maps` folder first. If your asset packs don't show, choose your asset folder in Settings → **Maps and assets**.

**How:** tick a line when it works. When something looks wrong, jot down what you did and what you saw, and tell Claude.

**Round 1 (2026-11-23):** Claude checked what it could and fixed a dungeon's leaning walls and the Ink style's jagged ripple lines. Lines it checked are marked *Claude checked*.

**Round 2 (2026-11-24):** you went through it and ticked most of it. Four things didn't work for you, and each has been changed:

- **Player screen**: you couldn't find the button. It's now also in the **bottom bar** of every battlemap (▣ Player screen, next to Export).
- **Object layers**: objects didn't go into a new layer. The Object tool's bar now has **Into layer**, so you choose the layer where you place objects. Two small fixes came with it: a layer chosen on another level no longer carries over, and placing into a hidden layer now tells you it's hidden. Claude couldn't make placing fail on its test server, so if it still fails, say what the bar along the top reads after you pick an object.
- **Settlement hills, valleys and slopes**: that line was only a count. It now has **Shape the land by hand (L)** and **Or start the land as** (Flat, Gentle slope, Rolling hills, Hilltop, Valley, Rugged). The **New settlement** box has the same choice.
- **Links to your notes**: the directions are rewritten below, step by step.

Those lines are marked **Try again** below.

**Round 3 (2026-11-24):** the second try worked for all but one line, and two things were new:

- **The layer controls** (eye, lock, ▲ ▼ ✕) couldn't be found: they were only in the Map panel's Map tab, and the Object tool switches the panel to the Assets tab. The Object tool's bar now has **Layers…**, which opens the same list, with a line explaining each control.
- **The player screen couldn't be closed** on the second monitor: a full-screen window has no frame. Now **Esc** leaves full screen, **F11** fills it again, the screen shows that when the mouse moves over it, and the editor has **Close it** (Map panel's Player screen section and the Reveal tool's bar). **Alt+F4** always closes it.
- Your ideas for next, a settlement's land as good as a world map's and the player screen for world maps, are in `CHECKLIST.md`.

## Getting started

- [x] It starts and opens First Map. Settings has four tabs: AI assistant, Maps and assets, **Access key** (the old Phone tab is gone), Help and updates. *(2026-11-24)*

## New in this update

### Ruler (`K` on world maps and settlements, `M` on battlemaps)

- [x] World map: click points along a route, double-click to finish. You see the distance, the time on foot, riding, by wagon and by ship, and what the route crosses (roads, rough ground, water, rivers, the climb). Do the times feel right for your game? *(2026-11-24)*
- [x] Change a pace; it is remembered next time. *(2026-11-24)*
- [x] Battlemap: feet and squares. Settlement: metres, feet and minutes on foot. *Claude checked: 18 squares came out as 90 ft, each leg right.*

### Printing a battlemap at table scale

- [x] Battlemap → **Export** → **Print at table scale**: it says how many pages; try Letter and A4; open the PDF. *(2026-11-24)*
- [x] Print one page at **Actual size** (not "Fit to page") and measure: **one square is one inch**. The first page shows how the pages fit together; the corner marks line up when you join two pages. *(2026-11-24)*
- [x] **Save ink**: a lighter picture with the walls as dark lines. *(2026-11-24)*

### Scatter brush

- [x] Choose a tree or rock in the **Assets** tab, then the Object tool → **Scatter**, and drag. The objects are spread out, varied in size and turn, and don't overlap. One Undo takes the whole stroke back. *(2026-11-24)*
- [x] **Only on floor** keeps them off the empty void. *(2026-11-24)*

### GM only

- [x] Tick **GM only** on a place (world map), an object and a light (battlemap), and a building's name (settlement): each shows faintly. *(2026-11-24)*
- [x] World map **Export**: **For players** is ticked and the secret place is missing from the picture. Untick it and the place is there. *(2026-11-24)*
- [x] Battlemap **Export** (picture, Universal VTT, Foundry, print): no secret object or light, and no gold mark on a secret door. Tick **My own copy** and they are back. *(2026-11-24)*

### Prefabs (`C` on battlemaps)

- [x] **Save**: drag over a room and give it a name. **Place**: choose it by its picture, `Q`/`E` turn it, `X` mirrors it, a click places it. One Undo removes it. *(2026-11-24)*
- [x] Place it on a different battlemap; any pack floors it used come along. *(2026-11-24)*
- [x] **Rename** and **Remove** in its list (removed ones go to `Prefabs\Removed` in the maps folder). *(2026-11-24)*

### Generate (Map panel)

- [x] Battlemap: **Make a dungeon** (small, medium, large; doors, torches), then a cave. Do they look like places you'd run? It asks before replacing what's there, and Undo works. *(2026-11-24)*
- [x] Type the seed from the note and make it again: the same map. *Claude checked: seed 4242 made the same six rooms twice.*
- [x] Settlement: make a hamlet, a village and a large village. On a settlement started from a world map (**Settlement here**), the village keeps out of the water and the woods. *(2026-11-24; you noted the land couldn't be shaped from the Map panel: see the next line)*
- [x] *(2026-11-24: works; you noted a settlement's land shaping is much weaker than a world map's: next in `CHECKLIST.md`)* A settlement's **Land and climate** (Map panel): **Shape the land by hand (L)** opens the Land tool. **Or start the land as**: pick Rolling hills and **Make the land**; hills appear, with shading and contour lines. Make it again (it asks first, since it replaces them), then Undo. Make a **+ New map** → Settlement and choose **The land** (Hilltop, say): it starts with that land.

### Player screen (best with a TV or second monitor plugged in)

- [x] *(2026-11-24)* On a battlemap, click **▣ Player screen** in the bottom bar, at the bottom of the map (next to **Export**). On a second screen it opens full screen there; with one screen it's a window. (It's also in the Map panel's **Player screen** section, and in the Reveal tool's bar.)
- [ ] **Try again (round 3):** getting rid of it. Open the player screen on your second monitor (it fills that screen). Move the mouse over it: a line at its top says how to get out. Press **Esc**: it becomes an ordinary window you can drag or close; **F11** fills the screen again. Then close it from the editor: the Map panel's **Player screen** section (or the Reveal tool's bar) has **Close it**.
- [x] *(2026-11-24)* Turn on **Fog** and the player screen goes black. With the **Reveal** tool (the eye in the tool rail; it has no key), click in a room: that room shows on the player screen with its lights. Then try **Area**, **Hide area**, **Hide everything**, and Undo a reveal. *Claude checked revealing from a spot and an area in a browser: the room showed with its torches, plus what can be seen through its open doorway; a closed door kept the next room dark.*
- [x] *(2026-11-24)* Nothing GM only, no room numbers and no secret-door marks appear on the player screen.
- [x] *(2026-11-24)* **Show my view** and **Whole map** (Map panel, Player screen section) change what the TV shows. Double-click the player screen for full screen; `G` shows or hides the grid.
- [x] *(2026-11-24; you'd like it to show world maps too, for overland travel: in `CHECKLIST.md`)* Open a world map in the editor: the player screen just waits; it never shows the world map.

### Realms (`B` on world maps)

- [x] **Choose a realm** → type a name → **Add**, then paint. It stops at the coast (**Land only**). *(2026-11-24)*
- [x] Make a second realm and paint it with **Round neighbours**: it fills up to the first one's border without taking its land. Try **Erase** too. *(2026-11-24)*
- [x] The names sit in the realms' middles; the list shows each one's size in km², and colour, GM, Name, Rename and Remove work. *(2026-11-24)*
- [x] Do a few other edits (add a place, move a label): every realm is still painted (a bug Claude fixed during testing). *(2026-11-24)*
- [x] The **Realms** switch in Layers hides them; an exported picture shows them. *(2026-11-24)*

### Object shadows and tints

- [x] Select an object: **Shadow**, **Tint** (try a grey "colour it yourself" picture), **Strength**, **No tint**. An exported picture looks the same. *(2026-11-24)*
- [x] The Object tool's **Shadow** tick gives new and scattered objects a shadow; with several objects selected, **Shadows: On / Off**. *(2026-11-24)*

### Links to your notes

- [x] *(2026-11-24)* On a **world map**, press `V` (the Select tool, the arrow near the top of the tool rail down the left) and click a **place's marker** (a castle, a town...; with no places yet, press `P` and click the map to add one). The Map panel on the right now shows that place: Name, Type, Notes, and under them **Your notes (a link)**. Paste a web address there (one of your wiki pages, a Google Doc, anything starting `https://`) and press **Enter**. An **Open** button appears under it; click it and the page opens in your web browser.
- [x] *(2026-11-24)* In the same box, **Choose a file…** opens a file picker: pick a Markdown, PDF or Word file. **Open** now opens it in its own program (Word for a .docx, and so on). If you use Obsidian, copy a note's link in Obsidian (right-click the note → **Copy Obsidian URL**) and paste that instead: **Open** opens Obsidian at that note.
- [x] *(2026-11-24)* A realm: press `B` (the Realm tool). At the left of the bar along the top is a button that reads **Choose a realm** (or the name of the realm you chose): open it, and each realm in its list has a **Link** button. Click it: the same **Your notes (a link)** box opens under the realm. Once a realm has a link, a **Notes ↗** button there opens it.

### Ink style

- [x] World map → Style → **Ink**: parchment, an inked coast with ripple lines, peaks, hills and woods. Does it look like a map you'd hand your players? *(2026-11-24)*
- [x] On your biggest world map (copied in first): how long it takes to draw, and whether editing still feels smooth. *Claude checked on a copy of your 2048 world map: switching to Ink took 0.7 s and reopening it 1.5 s (the Painted style takes 3 to 11 s); as a slow PC (2 cores, a page 4 times slower), 2.3 s and 4 s. A small edit showed in under 3 s, and zooming and dragging didn't stall.*
- [x] Export a picture in Ink. *(2026-11-24)*

### Object layers (battlemap Map panel)

- [x] *(2026-11-24)* In the battlemap's Map panel, **Object layers**: type a name in **New layer** and click **Add**. A note says new objects now go into it, and the Object tool's bar (press `P`) shows it under **Into layer**. Choose an object in the **Assets** tab and click the map: it appears, and the layer's count goes up. Switch **Into layer** back to **Objects (the bottom layer)** and place another.
- [ ] **Try again (round 3):** press `P` (the Object tool). In the bar along the top, click **Layers…** (right of **Into layer**): the list of layers opens under it. On your layer's row: the **eye** at the left hides it (its objects disappear from the map, an exported picture and the player screen) and shows it again; the **padlock** next to it locks it (its objects can't be clicked or moved); **▲ ▼** at the right draw it over or under the other layers; **✕** removes the layer but keeps its objects (they go to Objects, the bottom layer). The checklist page has a picture of it.

### Claude (needs Claude Code running in the app's terminal)

- [x] Ask Claude to measure a route, make a dungeon, reveal a room on the player screen, add and paint a realm you name, and save a prefab and place it. It should ask you before replacing anything. *(2026-11-24)*

## Still to try from earlier

### The asset update

- [x] How the pictures Dragon Drop picks look to you: **Battlemap here** from a world map and from a settlement. *(2026-11-24)*
- [x] Painting floors and building walls, doors, windows, paths, roofs and lights from your packs; **★ Starred** and **Recent**; words for pictures. *(2026-11-24)*
- [x] **Ask Claude to tag this pack** in the Assets tab (needs Claude Code in the terminal). *(2026-11-24)*
- [x] The Starter Pack's ten floors are there, even with no asset folder chosen. *Claude checked: with no asset folder, all ten floors were listed.*
- [x] A settlement building's roof picture chosen by sight. *(2026-11-24)*
- [x] Rivers in dry country: a new map's dry land has few rivers; **Dry land has few rivers** and **No rivers from the rain** in the Climate panel. *(2026-11-24)*
- [x] The window made narrow (down to 720 wide) is still usable. *Claude checked at 720 wide with both side panels open: the map fits itself, and every button can still be reached. The map is small; hiding a panel gives it room.*

### On your own maps and pictures (copies)

- [x] The settlement picture reader on one of your own city pictures: the trace picture's **Read the picture…** (buildings, streets, water). *(2026-11-24)*
- [x] Water on your own world map: name a river, **Carve valleys…**, **Lowland rivers**. *(2026-11-24)*

### Foundry (needs a second login as a player)

- [ ] *(2026-11-24: not possible yet)* Export a battlemap with roofs and two levels as a Foundry scene, then as a player: the roof fades over your token, a token above a ceiling, and what a hole does to a token (`FOUNDRY.md`).
