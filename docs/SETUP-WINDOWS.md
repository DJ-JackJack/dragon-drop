# Setting up Dragon Drop on Windows

This gets the map editor running on your PC, turns on the chat panel inside the app, and lets you keep building from your phone with Claude Code Remote Control.

**There are two ways to run Dragon Drop.** Most people want **A**.

- **A. The installer (recommended).** A normal Windows program: one download, a Start-menu and desktop icon, no PowerShell, nothing else to install. Sections 0 and 0b below.
- **B. From the code** (what you've been doing so far, and what developers use): sections 1 to 9. It needs Node.js, Git and pnpm, and you start it with `pnpm start`.

Both open the same editor and use the same map files.

## 0. Install the app (the installer)

1. Download **`Dragon-Drop-Setup-….exe`**. It comes from the project's latest release: <https://github.com/DJ-JackJack/dragon-drop/releases/latest>. Under **Assets**, click the `.exe` and run it.
2. **Windows will warn you** ("Windows protected your PC", "unknown publisher"). That is because the installer isn't signed with a paid certificate yet. Click **More info**, then **Run anyway**.
3. It installs in a few seconds, with no questions, and starts Dragon Drop. You'll find **Dragon Drop** on your desktop and in the Start menu.
4. **First start: "Where are your maps?"** If you used the earlier version (from a `dragon-drop` or old `AI-Mapmaker-Build` folder), it finds your maps and offers **Use my existing maps**. Choose that and nothing is lost: it uses the same files. (If it didn't find them, choose the folder yourself: it is the `projects` folder inside that checkout. Your asset library has its own setting (**Settings → Asset library**, see below).) Choosing **Start fresh** keeps new maps in `Documents\Dragon Drop\projects` and begins with a small generated first map to try things on (the installer carries no one's campaign world).
5. **Add your Claude key:** click **Settings** (top right) → paste your Anthropic API key → **Save key**. It's stored on your PC only, encrypted with your Windows login.

Close the window to quit; it saves first. **Don't run the installed app and `pnpm start` at the same time on the same maps folder.**

**Updating by hand:** download the newer installer the same way and run it: it replaces the old version and keeps your maps and settings. (You need this once to get the first version that can update itself.)

**Claude Code is built in:** the right-hand panel of Dragon Drop *is* Claude Code, running in a real terminal inside the window. It starts by itself, already connected to the map tools, and uses your Claude subscription (no API key). The first time, it asks you to sign in with your Claude account in your browser (see **Claude Code on a new PC** below). Type to it like in any terminal: Ctrl+C copies selected text, Ctrl+V pastes (right-click works too). **Wider** makes the panel bigger. If you quit Claude Code (`/exit`), the bar at the bottom offers **New conversation** or **Continue last**. **Pop out** opens it in its own window instead. If Claude Code isn't installed yet, the panel shows a short setup guide with an **Install Claude Code for me** button. The conversation keeps running while you work on the map, and Dragon Drop closes it when you quit. Everything it does shows live in the editor and in History, and can be undone. It works in `Documents\Dragon Drop\Claude`, where Dragon Drop keeps a small `CLAUDE.md` (the mapmaking rules). If you add an Anthropic API key in Settings, the panel gets a second tab, **API chat**.

**Claude Code on a new PC (first time only).** Claude Code is not part of Dragon Drop, and your Claude sign-in lives on your own PC, so someone installing Dragon Drop fresh has to set it up once (a PC where Claude Code was already installed and signed in just works). Open the **Claude Code** tab on the right; if it isn't set up, you see these steps:
1. **What you need:** a paid Claude plan (Pro, Max, Team or Enterprise) or an Anthropic Console account. The free claude.ai plan doesn't include Claude Code. Windows 10 or later and an internet connection; no administrator rights, and no Git or other programs. (Without a plan you can still use the **API chat** tab with an Anthropic API key from **Settings**.)
2. **Install:** press **Install Claude Code for me**. Dragon Drop runs Anthropic's official installer (`irm https://claude.ai/install.ps1 | iex` in PowerShell) in the panel so you can watch it; it shows very little while it downloads (about a minute). To do it yourself, paste that line into PowerShell (not Command Prompt), or run `winget install Anthropic.ClaudeCode`, then press **I've installed it: start**.
3. **Sign in:** when it finishes, Claude Code starts in the panel and asks you to sign in. Choose your Claude account, sign in in the browser that opens, approve, and come back. If the browser doesn't open, select the web address in the panel, copy it (Ctrl+C) and paste it into your browser.
4. **Ready:** the dot beside **Suggest** turns green.

If something goes wrong: `irm is not recognized` means you used Command Prompt (use PowerShell); a 403 or network error means checking your internet, VPN or proxy and antivirus; "not found" after installing means closing and reopening Dragon Drop; run `claude doctor` in PowerShell for a health report, and see code.claude.com/docs/en/troubleshoot-install . **Settings** shows whether Claude Code is installed and which version.

**Suggest and Assist (ideas from Claude as you work):** above the Claude Code terminal there is a bar with a **Suggest** button, an **Assist** switch and a dot showing what Claude Code is doing (grey: not reporting yet, green: ready, gold: working, red: waiting for your answer).
- **Suggest** asks Claude to look at the map (and what you changed by hand since it last looked) and give up to three short, numbered ideas to expand, improve or fix the work. It only suggests: reply "do 1 and 3" and it does them.
- **Assist** does the same by itself. When you stop editing for about 45 seconds after at least two changes, it types the request into the terminal for you. It waits while Claude is working or has a question open, while you are typing to Claude, and for at least 3 minutes between suggestions (at most 6 an hour). It never reacts to Claude's own changes. When the Claude tab is hidden, a gold dot on the tab says the answer is ready.
- It uses your Claude Code subscription (no API key) and never changes the map or invents names by itself: Claude is told to suggest only, and to mark anything that needs a name or a fact as a proposal.
- How it knows when Claude is idle: Dragon Drop adds small **hooks** to `Documents\Dragon Drop\Claude\.claude\settings.json` (it keeps any settings you already have there). They call the built-in `curl.exe` to tell the app when Claude starts, finishes or asks a question. If the dot stays grey, Assist never types anything (Suggest still works); check that `curl.exe` runs in a terminal and that `/hooks` inside Claude Code lists the hooks.

**Smooth zoom:** under **Layers** in the Map panel (right side). On (the default), zooming into the terrain blends the pixels softly; off, you see the hard blocks. It is remembered.

**Hiding labels:** under **Layers**, **Labels and names** hides the map's labels and the names of places, and **Place markers** hides the markers, to see the land on its own (hidden, they can't be clicked either). Both are remembered.

**Deleting a map:** **Delete this map…** at the bottom of the Map panel. It asks first, then moves the map's folder into **Deleted maps** inside your maps folder (nothing is erased; move the folder back to bring the map back) and opens another map.

**A speed-up file:** the first time a map of a given size is opened, Dragon Drop works out the painted style's texture data (a few seconds) and keeps it in `%APPDATA%\Dragon Drop\cache\noise` (about 80 MB for a 2048 map; the newest four are kept). Later launches reuse it, so the map paints sooner. It is safe to delete.

**Updating:** Dragon Drop checks for a new version a few seconds after it starts and every few hours. When one is found it downloads quietly and asks **Restart now / Later** (Later installs it the next time you close the app). **Settings → Updates** shows the state, has **Check now**, and can turn automatic checks off. Your maps and settings are never touched by an update. (Updates come from the project's GitHub *Releases* page; until the first release is published, download the installer by hand as described above.)

**Using Claude Code from your own terminal instead** (the address uses `127.0.0.1`, not `localhost`: on Windows `localhost` can point at an address the app doesn't listen on, which shows up as a red ✗ in `/mcp`): the app has to be running. Open **Settings** and copy the one-line command under "AI assistant", then paste it into PowerShell once (`claude mcp add … --scope user …`; the command includes the app's map tools key, which opens the map tools and nothing else, so don't share it; "user" makes it work from any folder). Then run `claude` and type `/mcp` to check that `mapmaker` shows as connected. The phone page (§7) works the same way as before. After **Make a new access key** in Settings this connection stops working: run `claude mcp remove --scope user mapmaker` in PowerShell, then the new command from Settings.

**Open-source licences:** **Settings → Licences** opens the licences of everything Dragon Drop is built with.

**Uninstalling:** Windows Settings → Apps → Dragon Drop. Your maps are not deleted.

*Where things live:* settings in `%APPDATA%\Dragon Drop`, the log in `%APPDATA%\Dragon Drop\logs\server.log` (Settings → Open logs), maps wherever you chose.

## 0b. If the installer doesn't start

Open **Settings → Open logs** (or the folder above) and send me `server.log`. Common causes: another program already uses port 4747 (Dragon Drop then picks a free port and says so in Settings), or an antivirus blocking an unsigned program.

---

# B. Running from the code


## 1. Install the prerequisites (one time)

1. **Node.js 22 LTS or newer:** download the Windows installer from <https://nodejs.org> and keep the defaults.
2. **Git:** <https://git-scm.com/download/win>, defaults are fine.
3. **pnpm:** open **PowerShell** and run:

   ```powershell
   npm install -g pnpm
   ```

## 2. Get the code

```powershell
cd $HOME\Documents
git clone https://github.com/DJ-JackJack/dragon-drop.git
cd dragon-drop
```

> **If you cloned the old repository** (`AI-Mapmaker-Build`): the project moved to a new repository with a clean history on 2026-11-18. Don't pull into the old checkout. Clone the new one beside it, then copy the old folder's `projects` folder and `.env` file into the new one.

Then install the dependencies:

```powershell
pnpm install
```

## 3. Add your API key (for the chat panel in the app)

The in-app chat talks to Claude through the **Claude API**. That's billed per use, separately from your Claude subscription, and the chat panel shows a running cost.

1. Create a key at <https://console.anthropic.com/> under **API keys**.
2. In the project folder, copy the example settings file:

   ```powershell
   copy .env.example .env
   notepad .env
   ```

3. Paste your key after `ANTHROPIC_API_KEY=`, then save.

`.env` is ignored by git, so the key stays on your machine. Never paste it into a chat.

You can skip this step: the editor and Claude Code (step 6) both work without it.

## 4. Start the app

```powershell
pnpm start
```

The first run builds the editor (about a minute), then your browser opens at **<http://localhost:4747>**. It opens on a small generated map called **First Map** (or on the map you had open last).

- **To stop:** press `Ctrl+C` in the PowerShell window. Your map is saved automatically, and again on exit.
- **Where maps live:** `projects\<map-name>\` in the project folder. The heightmap is in `map\`, the design brief in `brief.md`, and your reference images in `refs\`.

## 5. Using the editor

**The screen.** Down the **left edge** is the **tool rail**: one picture and a short name for each tool, with its key in the corner (on a short screen the names hide so the whole rail fits; the **«** at its foot makes it pictures only and narrower, **»** brings the names back, and the choice is remembered). Under the top bar, the **tool bar** shows the settings of the tool you picked (brush size, kind of road, the roof of the next building, the floor material...) and, beneath them, what to do next with it. Bigger choices, such as the kind of place or the floor material, open from a button in the tool bar. Under the map is the **bottom bar**: whether the map is saved (**Saved** with the time, **Saving…** a moment after a change, or a warning in red if a save failed), what is under the pointer (or the map's size), a few quick switches (the coordinate numbers on a world map, the grid on a battlemap, names and contour lines on a city), **⤓ Export**, the zoom (**−**, the zoom in percent, **+**) and **⤢ Fit**. On the **right** is the **Map panel**, with tabs: **Map** (layers, the lists of places and roads, climate, settings, and the editor for what you selected; each layer has an eye to show or hide it), on battlemaps and cities **Objects** (everything on the map by kind, named things first, with a box to find one by name or kind: a click selects it and shows it on the map), **History** (what changed, who changed it, checkpoints and reference pictures) and, on battlemaps, **Assets**. **Undo** and **Redo** are in the top bar, and so are the two switches **Map panel** and **Claude**: the Claude panel is on by default, and either panel can be hidden to give the map more room (the choice is remembered).

| | |
|---|---|
| **Pan** | Pan tool **(H)**, hold **Space** and drag, or right-drag with any tool. Mouse wheel zooms. **Fit** resets the view. |
| **Sculpt** | **Raise (R)**, **Lower (L)**, **Smooth (S)**, **Flatten (F)**. `[` and `]` change brush size. |
| **Coastlines** | **Land (A)** pushes the coast out into the sea as new lowland. **Water (W)** floods land back to shallow sea. |
| **Places** | **Place (P)**: pick what the place is from the picker in the bar (settlements, strongholds, temples, caves, ports, and 30 **shops and trades**: a market, tavern, blacksmith, weaponsmith, armorer, alchemist, magic shop, bank and more), click the map and type a name. Names sit on whichever side of the marker is free (or choose a side in the panel). The **Places** list in the Map panel jumps to any of them. |
| **Labels** | **Label (T)**: pick a kind (sea, region, mountain range, island, small feature). **Click** for a straight label, then set its angle, curve and size. **Drag** to draw a line for the name to follow, along a range, a river or a coast. Range names stretch along the whole line; tick or untick "Spread" to change that. |
| **Select** | **Select (V)**: click a place or label to edit it in the Map panel on the right, drag to move it, **Delete** to remove it. |
| **Detail maps** | **Detail map (D)**: drag a box around an area (it shows the detail you'll get), name it, and a separate, much more detailed map of that area opens, with the same land, climate and names. Use the **Regional maps** list on the left to jump between it and the map it came from. Good for any area you want to work on closely. |
| **Grid** | Under **Grid** in the Map panel: **Off**, **Square** or **Hex**, with a cell size in miles (type a number, or click a quick size such as 6 mi or 60 mi). For hexes you can choose point-on-top or flat-edge-on-top, and the line strength. The size is the side of a square, or the distance across the flats of a hex. The grid is saved with the map, can be undone, and shows in the phone page and in PNG exports. Cells too small to see at the current zoom show a message at the top of the map with a **Zoom in** button. For small cells such as 6-mile hexes, a **Detail map** of the area works best. |
| **Roads and borders** | **Roads (O)**: choose Road, Trail, Border or Reef. For a road or trail, click where it starts, then double-click where it ends (click more points to make it pass through them): the route is found over the terrain for you, keeping to low ground, using passes, avoiding lakes and costly river crossings, and joining existing roads. A border or reef is drawn exactly as you click (a **reef** is a barrier of razor rocks with a pale shoal, for a strait or a coast; border: click its first point to close it). Claude can find the straits between the islands of a ring and draw a reef across each one (*"Put razor reefs across the straits"*: `find_straits`, `add_strait_reefs`), and fringe the outer coasts of the ring islands, leaving an area clear such as a landing coast (`add_coast_reefs`). The panel shows each one's length and, for roads, days on foot. Select a road to rename or drag it. |
| **Rivers and lakes** | Rivers and lakes are worked out from the land and the rain, so a river you draw is cut into the land for the water to follow. **Rivers (I)** opens on **Add a river**: **drag** from where a river starts to where it ends (the sea, a lake, or open land) and the land is cut along your line, always downhill, so the river runs there (a note says how long it is, and how deep it had to cut through high ground; drawn from the coast inland, it is turned round; Undo takes it back in one step); or **click** on land to start a river that finds its own way downhill (a great spring, a waterfall fed from beyond the map), choosing its size (stream, river, major, great). Sources show as blue dots while the tool is in use: click one to change its size or remove it. **Name and select**: point at a river or a lake and it lights up whole, from its source to where it ends (in the sea, a lake, or a bigger river); click it to name it (a box says how long it is and where it goes), or to select it if it already has a name (the Map panel then shows it, and Claude sees what you selected). The name is drawn along the river, or in the lake, on the map, the phone page and exports, and it follows its river when you reshape the land. Below a junction the bigger river keeps its name. Under **Rivers and lakes** in the Map panel: the names (click one to select it), **Lowland rivers** (big rivers on flat ground wander in wide loops with oxbow lakes beside them and widen into estuaries at the sea; every river is worked out again, so it is off unless you want it) and **Carve valleys…**, which cuts the land along every river into a valley (deeper and wider for big rivers, a narrow V where they drop steeply, flat floodplains on low ground, and deltas where big rivers meet a shallow sea). Its **Where** choice carves the whole map, only the area you selected (with the Select area tool; the edge fades out), or only along the river you selected. A checkpoint "Before carving valleys" is saved first, and Undo takes it back. Claude has the same (`draw_river`, `name_water`, `list_waters`, `remove_water_name`, `carve_valleys` with a preview and the same Where, `set_climate` with `lowland_rivers`). |
| **Terrain from a drawing** | Add a drawing of your land to **References** (see below), then click **Make terrain…** under its picture. The dialog shows a live preview of how the drawing will be read (sea, land, mountains) and lets you choose how to read it (filled drawing or outlines only; red strokes as mountain ranges), the fit, the height of lowlands and mountains, and how ragged the coast is. **Create terrain** then **replaces the whole map**: a checkpoint called "Before sketch import" is saved first, and Undo also brings the old map back. Places, labels, regions and roads stay where they are. The result is a starting point to refine with the brushes, or by asking Claude. |
| **Climate regions** | **Region (C)**: click the corners of an area, then double-click (or click the first corner, or press Enter) and name it. In the panel, tick what it overrides (temperature, moisture, ground snow, **bare dark stone** for rocky ground that shows dark rock instead of green land) and set the strength and border. The map recolours about a second later. For spirit domains, curses, eternal winters and the like. |
| **Climate** | Open **Climate** under Style: latitude of the top and bottom edges, prevailing wind (named for where it blows from: west, north-west, north... eight directions; rain shadows fall downwind), wetness, snowline, river density. Each change can be undone. |
| **Map extras** | Open **Map extras** in the Map panel: a **title** banner, a **scale bar** (miles or kilometres, any corner), a **compass rose** (any corner) and a **frame**. They show on the map, the phone page and in exports, and every change can be undone. |
| **Export** | **⤓ Export** (bottom of the map) opens a dialog: choose the size (1×, 2×, 4× or 8× the map's pixels) and what to include (rivers, places/labels/roads, grid, map extras). Up to 8192 px it's one PNG; larger sizes (8×: 16384 px) are saved as tiles of 4096 px in one `.zip`, with a README on how to put them together. The terrain is enlarged from the map's own detail, so it softens above 2×; everything else stays sharp. For sharper terrain, make a **Detail map** and export that. |
| **Sharper detail** | To double a map's resolution, stop the app and run `pnpm upscale <map-folder-name>` (for example `pnpm upscale first-map`). Shapes stay the same, edges get sharper, and places and labels move with the map. The old heightmap is kept in `map\before-upscale-…`. Checkpoints saved before the upscale can't be restored afterwards. |
| **Copies and comparing** | In the Map panel under **Other maps**: **Duplicate this map…** copies the map (everything on it, every level of a battlemap, its brief and pictures; not its checkpoints) to make a changed version of it, the same place before and after: a farmhouse before and after a fire, a town before and after a siege. The copy opens, says what it is a copy of, and the original is never changed. **Compare with** lays another map over the one you have open: **Fade** (the other map see-through over yours), **Swipe** (the other map left of a line, yours right of it; the slider moves the line) or **Side by side**. A copy lies exactly over its original, a detail map over its area of the world map, a battlemap over its spot of a city; maps that aren't linked are shown side by side. **Esc** or **Stop** ends it. Claude can do the same (`duplicate_map`, `compare_maps`, `where_on_map`), and can look at any other map while you keep working on this one. |
| **Undo / redo** | `Ctrl+Z` / `Ctrl+Shift+Z`. History is shared with Claude and shows who did what. |
| **Grid** | **G** toggles a coordinate grid. The numbers are the same coordinates Claude uses. |
| **References** | Pictures for you and Claude to look at: sketches, maps you found elsewhere, inspiration. Click **Add picture…** in the **References** section of the Map panel's **History** tab (under Checkpoints), drop pictures anywhere in the window, or copy one and press `Ctrl+V` on the map. PNG, JPEG and WebP, up to 30 MB each; anything else (an iPhone HEIC photo, a GIF, a PDF) is refused with a note saying how to save it as one that works. Click a picture to see it full size. **Ask Claude…** (desktop app) types a question about it into Claude Code; **Rename** and **Remove** do what they say (a removed picture is moved to the map's `backups\removed-pictures` folder, not deleted). |
| **Trace a map** | To recreate a map you found (or drew on paper), add it to **References** and click **Trace over map**: it lies over the map, see-through, and a bar appears under the map. **See-through** sets how solid it is, **Hide** / `U` hides it. To line it up: **Move** (drag it; **Size** and **Turn** buttons), **Pin 2 points** (click a point on the picture, then where it belongs on the map; then a second pair far from the first: it is moved, sized and turned to match), on a battlemap **Match grid** (click two crossings of the picture's own grid and say how many squares apart: its squares become your squares), and **Fit** to start over. **Lock** keeps it in place (Claude can't move it either). Then draw over it with the usual tools, or ask Claude to ("trace the coast", "draw the rooms, walls and doors from the picture"). The picture is never exported. Each battlemap level has its own. **Stop tracing** (at the start of the bar, or on the picture's own card in References) takes it off; Undo brings it back. |
| **Chat** | Type and press Enter. Attach images with 📎, by dragging them onto the chat, or by pasting into the chat box. They go with your message and are kept in References too. Pick the model and effort at the top. **New** starts a fresh conversation; the map and brief are kept. |
| **New map** | **+ New map** asks for a size in miles and a starting template, and for land, how many **Lakes** it keeps (a few by default: the rest of the land's hollows are drained so the water runs to the sea; **Many** keeps every hollow, as maps used to). Choose **Battlemap** at the top of that box instead for a tabletop map (see below). |
| **Settlement maps** | **+ New map → City**: a size in metres (600 × 400 by default; a village is about 300 × 200, a walled town 1,000 × 700, a big city 3,000 × 2,000; at most 6,000 a side). A city seen from above, made of **buildings**, **streets** and a **ground**, all in metres. The tool rail down the left edge shows the city tools, and the tool bar under the top bar holds the settings of the one you pick: **Building** (`B`: click to place a 6 × 8 m house, or drag a rectangle; `Q` and `E` turn it 15° first; pick its roof and what it is below), **Outline** (`O`: click the corners of a building of any shape), **Street** (`S`: click the points, double-click to finish; avenue, street, lane, alley or path; where it crosses water it becomes a **bridge** by itself: stone for avenues and streets, wood for lanes, alleys and paths, or choose **Over water** in the tool bar or a street's panel: stone, wood, or none for a ford), **Wall** (`W`: click the points of a city wall; click the first point again to close it into a ring, or double-click or press Enter to end it; a stone wall, a wooden palisade or an earth rampart, with towers every so many metres; wherever a street crosses the wall a gate appears by itself, with a gatehouse where an avenue or street passes; a wall's panel changes what it is built of, its thickness, its towers and whether it is a ring), **Paint ground** (`P`: water, grass, cobbles and so on; `[` and `]` change the brush), **Land** (`L`: hills, ridges, valleys, plateaus, hollows and slopes; set the height and size in the tool bar; click a hill's top or a ridge's line to select it, drag it to move it; the ground is shaded and gets contour lines, and the bottom bar shows the height and slope under the pointer), **Trees** (`T`: a wood, an orchard or scattered trees by their outline, a row along a line, or one tree by a click; their kind follows the climate unless you pick one), **Select** (`V`: click a building or street, drag to move it, drag on bare ground to select several, `Q` and `E` turn buildings, `Delete` removes, arrow keys nudge) and **Pan** (`H`). The Map panel's **Land and climate** sets the city's **climate** (cold, temperate, warm and wet, Mediterranean, dry, tropical: the colour of the grass, snow on the ground and roofs, the kinds of tree), its **height above the sea**, and whether to show **contour lines**. The panel under the tools edits what is selected: a building's name, what it is, roof look, colour and flat roof, a street's name, kind and width, or the roof and kind of a whole group at once. Everything is one undo step. A **trace picture** (see **Trace a map**) lies under the buildings. With an **asset library** set up, new buildings get a **roof picture** from your packs (slate, clay tile, thatch or wood shingle) and are drawn from the roof look only when your packs have none that fits: the **Roof pictures / Drawn** switch above the roof choice changes it for new buildings, **Choose a picture…** next to it gives every new building the one picture you pick (the roof pictures found in your packs, by look and searched, or any picture of your packs), and a building's panel (or several buildings selected together) can **Choose…** a picture by sight, take another, or draw it instead. Claude has tools to build one in batches (`create_city`, `paint_ground`, `add_streets`, `add_buildings`, `find_roof_assets`, `render_city`...). **Reading buildings from a picture:** lay a city picture over the map (**Trace over map** in References) and line it up, then press **Read the picture…** in the trace bar. Drag a box around the part to read (or press **Whole picture**), click **one roof of each kind** (a red tile roof, a grey slate one, a straw one; each gets a numbered dot, and the roof look it is guessed to be, which you can change), press **3 Ground** and click the ground between the buildings (streets, yards, grass, a paved square), then **Find** (the buttons at the start choose what to read: **Buildings**, **Streets** or **Water**; for streets click a street and then what isn't one beside it, for water click the water, say whether it is deep or shallow, and then the shore; read the water first, then the streets, then the buildings). What it found is outlined in cyan: if it took in ground, click more ground or move the slider towards **Strict**; if it missed roofs, click another roof of that kind or move it towards **Loose**, and Find again. **Accept** adds them as one edit (Undo takes them all back); buildings already on the map are left out. Expect to fix some by hand. Claude can do the same with `read_picture_buildings`. **Names** (`N`): click a street, building or wall to give it a name (a street's name runs along it once you zoom in close enough to read it), or click open ground to write a district's, water's or landmark's name there; pick which above, and its size; with Select you can drag a name, and its panel changes its text, kind, size and turn. **Names and labels** in the Map panel hides them. **Copy and paste**: `Ctrl+C`, `Ctrl+V` (under the pointer) and `Ctrl+D` (duplicate). **Export** (the ⤓ button by Fit): the city as a PNG at 1, 2, 4 or 8 pixels per metre (8 is fine enough to print), with or without names, contour lines and a scale bar; very big sizes come as tiles in a ZIP. **The phone page** (`/view`) shows a city too, with its names, and follows your edits. **Battlemap here** (`M`): click a spot for a battlemap of 30 × 20 squares round it, as on the world map, or drag a box round the place of a fight (up to about 228 m across at 5 ft a square), and name it: a battlemap of it opens with the city's ground, the streets as cobbles or dirt, every building as walls with a door toward the nearest street, a floor by what it is and its roof, and the city walls and towers; add furniture, lights and more doors there, and **↑ Back to** returns to the city. **Districts** (`D`): click the corners of a quarter or ward and name it: it gets a faint tint, a dashed border and its name over its middle; its panel changes the name and colour. Where a wall crosses water (a river, a moat) it gets a **water gate** by itself: an opening with a portcullis and a tower on each bank. Settlement maps are saved in file format 3: an older Dragon Drop refuses to open them. |
| **Battlemaps** | **+ New map → Battlemap**: a size in squares (30 × 20 by default, 5 ft each) and, if you like, a starting room. The tool rail changes to the battlemap tools, and the tool bar holds their settings: **Brush** and **Area** paint the chosen floor material (pick it from the swatches; the crossed one erases), **Room** drags out a floored, walled room, **Wall** draws walls point by point, **Door / Secret door / Window** cut one into the wall you click, **Invisible wall** stops movement only, **Light** places a torch. **Select** edits a wall piece, door (open, locked) or light (reach, colour, strength); **Delete** removes it. Walls and closed doors cast shadows: a light only lights what it can see, in the editor, in renders and in the tabletop (windows, open doors and invisible walls let it through; untick **Walls block it** on a light to ignore walls). Walls are drawn as thick stone with a soft shadow on the floor, doors are wooden (an open one swings back into the room) and windows have glass. **Light level** (Map panel, below Grid) sets how bright the map is where no light reaches: **Bright** (the default), **Dawn**, **Dusk**, **Dim**, **Night**, **Dark** or a slider (dawn, dusk and night also colour the ambient light, and you can pick your own colour); the **Shade** tool draws an area with its own level, such as a building that is dimmer than the yard around it; the **Note** tool puts numbered notes on rooms (they form the **Key** in the Map panel; they are for you and never appear in the exported picture, and **Export → Key** writes them as a list); in a dim or dark map only the lights' pools show in full. The exported background picture stays bright, because the tabletop does its own lighting (the level travels in the file as the scene's darkness). **⤓ Export** gives you a Universal VTT file (`.dd2vtt`, for the Universal Battlemap Importer in Foundry and other tabletops), a Foundry scene `.zip`, or just the image. Those two files have not been tested in Foundry yet. Ask Claude to build rooms ("a 20 × 15 tavern with a bar, a door on the south wall and a fireplace") with its battlemap tools. |
| **Battlemap from a world map** | On a world map pick **Battlemap here (M)** and click a spot: after you name it, a battlemap opens whose floors come from what the world map says is there: snow, desert, woodland, meadow or bare rock from the climate and slope; a lake, a river running the way the real river does, or the sea on the right side of a coast. It is an outdoor scene a few dozen metres across (30 × 20 squares), a starting point for rooms, objects and lights. **↑ Back to …** (Map panel) returns to the world map. Claude can do it too: *"Make a battlemap where the river meets the coast near the port."* |
| **City from a world map** | On a world map pick **Settlement here (Y)** and click a town's marker or any spot on land: a box asks for the settlement map's name (the place's, when you clicked one) and size (suggested by the kind of place: a village is smaller than a capital). The settlement map opens with the world map's **climate** and **height above the sea** at that spot, the ground's **slope**, and where the world map has them the **sea and a beach** on the coast's side, a **winding river** in its valley, **woods** in wooded country and a **hill** in hilly country. A world-map pixel is a kilometre or more, so this is a rough start to shape with the Land, Paint ground and Trees tools. **↑ Back to …** in the city's Map panel returns to the world map. Claude does the same with `create_city_here` (a place by name, or a point). |
| **Caves and odd shapes** | The **Area** and **Room** tools can make a **Rectangle**, a **Circle** (drag out from the centre) or a **Free-form** shape (click the corners, double-click or Enter to finish). For caves, paint the floor freehand with the Brush (dirt, rock...), then click **▢ Walls around the floor**: a wall is traced along the edge of all the floor, including holes such as pillars. Click it again after changing the floor and the earlier traced walls are replaced; walls you drew by hand stay. Then cut doors in with the Door tool. |
| **Asset library** | In **Settings → Asset library**, choose the folder that holds your assets (for example `D:\Map Assets`). It can hold, in any mix, **folders of pictures** (PNG, JPEG or WebP, in any layout: the words in folder and file names tell Dragon Drop what each picture is, so "Floor Textures", "Furniture & Props", "WoodenDoors" or a file called `oak_table.png` all work, and so does a pack's own name, like a folder called "Floor Textures"; a picture whose names say nothing is looked at once, in the background after the library is read: a picture drawn on nothing is an object, one made to repeat is a floor texture; a pack's own thumbnails and cover picture are left out), **.zip files** of pictures, and **asset pack files** made by other map tools (a name ending in `_pack`, or `.pck`). They are **read where they are and never copied**, so even 20+ GB of packs is fine; the first read of each pack file takes a moment and is remembered. Add a picture later and press **Rescan**. On a battlemap, the right-hand panel gets an **Assets** tab: search by name or tag, pick a pack, and click. A **floor texture** (Floors) is added to the floor swatches and the Brush picks it up; right-click a texture swatch to remove it. The floor picker in the bar above the map (Brush, Area and Room tools) also lists **every floor texture in your packs**, with a search and a choice of pack: click one to add it to the map and paint with it (one already on the map has a gold edge). An **object** (Objects) is placed with the **Object** tool: click the map (hold Alt to skip snapping), **Q / E** rotate, **X** mirrors, and with **Select** you can drag, rotate, resize, duplicate or delete it. Objects are as big as their picture at 256 pixels per square, times the size slider. **Walls** are built of a look (stone, brick, wood, plaster or cave rock) or a **wall picture** from your packs: choose it with **Walls:** in the bar above the map while the Wall or Room tool is on, or click a picture in the Assets tab's Walls; a chosen wall (or several) can be built again of something else in the inspector (**Built of**). A long wall strip is laid along the wall; a square texture (a brick or plank floor) is tiled along it. **Doors and windows** can be pictures from your packs too: **Doors:** or **Windows:** in the bar while the Door or Window tool is on, **Looks like** in the inspector for a chosen one, or click one in the Assets tab's Doors; the picture is drawn in the opening (an open door's swings with it). **Paths** (roads, tracks and streams): the **Path** tool (`Y`) takes the points of one (corners are rounded off; `Enter` finishes), with a width and what it is made of (dirt, gravel, cobblestones, a stream, or a path picture from your packs, laid along it); it lies on the ground under objects and walls and blocks nothing. Patterns show up for browsing but can't be used yet. WebP pictures work like PNG and JPEG (an animated WebP is skipped: only still pictures are drawn). Packs whose authors say they may **not** be used in other mapping programs (a setting inside the pack) are listed in Settings' count but never shown or drawn. Claude can search and look at your assets, add floor textures and place objects with its own tools. **Copy report** in Settings copies a description of what's inside your asset library (no pictures) that you can send back to improve support. |

Claude sees what you change by hand: each message you send includes a note of your edits since its last turn.

## 6. Claude Code and Remote Control (building from your phone)

Claude Code can use the same map tools through the `.mcp.json` file in this folder. Remote Control lets you drive that Claude Code session from the **Claude app on your phone**. It runs on your **Claude subscription**, so no API key is needed.

1. Install Claude Code on the PC (see <https://code.claude.com/docs>) and sign in.
2. Make sure the map app is running (`pnpm start`) in one PowerShell window.
3. In a **second** PowerShell window, in the project folder, run `claude` once. When it asks about the **mapmaker** MCP server from `.mcp.json`, approve it. Type `/mcp` to check that it shows as connected, then exit.
4. Start Remote Control in that same folder:

   ```powershell
   claude remote-control
   ```

5. On your phone, open the Claude app. The session appears under **Claude Code**. Ask things like *"Using the mapmaker tools, add a chain of reef islets off the south coast and show me."*

**Good to know:**
- The PC has to stay on and awake, with both windows open.
- Claude sees each map preview it renders. Whether the image also shows on your phone depends on the app. To watch the map itself change, open the phone map page alongside the chat (next section).
- Everything Claude does from your phone appears in the editor's History and chat as **Claude Code: …**, and can be undone.

## 6b. Using another AI assistant (Codex, Gemini CLI, OpenCode, Muse Code)

The terminal on the right runs Claude Code by default. In **Settings → AI assistant** you can pick another command-line assistant, or type any start command. For the assistants Dragon Drop knows, it connects the map tools for you: there is nothing to copy and paste. You still sign into the assistant yourself the first time it starts (its own sign-in, and its own cost).

| Assistant | What Dragon Drop sets up | Anything else |
|---|---|---|
| **Claude Code** (the default) | Hands it the map tools when it starts | You sign in once, as before |
| **Claude Code via Ollama** | `.mcp.json` in your Claude workspace folder | |
| **Codex** | `.codex/config.toml` | Codex asks once whether to trust the folder: say yes, or it ignores the map tools |
| **Gemini CLI** | `.gemini/settings.json` | It asks once to trust the folder. It also needs your own API key |
| **OpenCode** | `opencode.json` | |
| **Muse Code** (Meta) | `.mcp.json`, the same file as Claude Code's | Muse asks once whether to trust the folder: say yes, or it ignores the map tools. Install it from Meta first |
| **Anything else** | Nothing | Add the address and header shown in Settings in that assistant's own settings |

**What each one needs, and what it costs.** Each assistant has its own sign-in, and some are paid for separately from the same company's chat app. Checked against each company's own pages in November 2026; plans change, so their pricing page has the last word. From version 0.1.12, Settings shows the same line under the assistant you pick.

| Assistant | Free? | What it needs |
|---|---|---|
| **Claude Code** | No | A paid Claude plan (Pro, Max or Ultra: the same subscription as the Claude app; Team and Enterprise too), or an Anthropic Console account billed by use. The free Claude plan doesn't include it. |
| **Codex** | Yes | Sign in with a ChatGPT account: every ChatGPT plan includes it, the free one too, with usage limits that depend on the plan. An OpenAI API key, billed by use, works as well. |
| **Gemini CLI** | No | A Gemini API key from Google AI Studio, billed by use (or a business Gemini Code Assist licence). Since June 2026 a personal Google sign-in and the Google AI Pro and Ultra plans no longer work in Gemini CLI. |
| **OpenCode** | Partly | The program is free and open source; the AI comes from what you connect: a few free models from OpenCode itself, OpenCode's paid plans, an API key, or a ChatGPT Plus/Pro or GitHub Copilot account you already have. Don't connect a Claude or Google AI subscription to it: Anthropic and Google forbid using those in other tools and have suspended accounts over it. |
| **Muse Code** (Meta) | No | Its own account at dev.meta.ai: a Muse Code subscription (Accounts Center, Subscriptions, Muse Code) or pay as you go with a Meta API key. A Muse app plan doesn't include it. |
| **… via Ollama** | Local models: yes | Runs on Ollama's models instead of the company's: free local models on your own PC (a good coding model needs a strong graphics card), or Ollama's cloud models with an Ollama account (pay as you go, or a monthly plan). |

The files go in the Claude workspace folder (`Documents\Dragon Drop\Claude`). Choosing another assistant takes Dragon Drop's entry out of the others' files, and everything else you put in them stays. A file Dragon Drop can't read as valid is left alone.

The assistant is handed a key in the environment (a variable called `DRAGON_DROP_KEY`), kept out of those files because Documents is often synced to the cloud. It is the **map tools key**, not your access key: it opens the map tools and nothing else, so a command the assistant runs can't answer Dragon Drop's Allow box for you. **Antigravity CLI isn't connected any more** (from version 0.1.12): Google's terms for it forbid using it with other companies' products, and Google has suspended accounts over that. Dragon Drop no longer writes its file, and it takes its own entry out of the one an earlier version wrote (that file held your access key). For Google's models, use Gemini CLI with an API key.

Dragon Drop does not turn off the assistant's own questions: Codex, Gemini CLI, Muse Code and the others still ask before using a tool, as they normally do.

## 7. The map on your phone (Tailscale)

> **In the Windows app** the steps are shorter: do steps 1 to 3 below, then enter the address `tailscale serve` printed (without `https://`) in **Settings → Phone page** and press Save. Settings then has **Copy the phone link** (it holds your access key: open it once on your phone). The phone page is off until you do this. If the link went somewhere it shouldn't, or a phone with it is lost, **Settings → Access key → Make a new access key** stops the old key everywhere (the phone then needs the new link). Steps 4 to 6 are for the developer setup.

The app has a phone-friendly, view-only page at **/view**. It shows the map with its labels, updates live as you or Claude edit, and lets you tap a place to read its notes. Pinch to zoom, drag to pan and double-tap to zoom in. **Places** lists every named place. On the PC you can try it now at <http://localhost:4747/view>.

The app only listens on your PC, so to reach it from your phone, use **Tailscale**. It's a free private network between your own devices, and nothing is opened to the internet.

1. Install Tailscale on the PC (<https://tailscale.com/download/windows>) and on your phone (App Store or Play Store). Sign in to the **same account** on both.
2. In the Tailscale admin console (<https://login.tailscale.com/admin/dns>), make sure **MagicDNS** and **HTTPS Certificates** are both enabled.
3. On the PC, in PowerShell, run:

   ```powershell
   tailscale serve --bg 4747
   ```

   It prints an address like `https://my-pc.tail1234.ts.net/`. If it asks you to enable HTTPS, follow the link it shows, then run the command again. `--bg` keeps it running across restarts. Use `tailscale serve reset` to turn it off.
4. Tell the app to accept that name. Add this line to `.env`, using your own address without `https://`:

   ```
   MAPMAKER_ALLOWED_HOSTS=my-pc.tail1234.ts.net
   ```

5. Protect it with an access key (recommended: anyone who can reach the address could otherwise use the app). Make a long random string (16 characters or more; a password manager will make one) and add it to `.env`:

   ```
   MAPMAKER_ACCESS_TOKEN=put-your-long-random-key-here
   ```

   With a key set, the server refuses everything that doesn't carry it. Your own browser gets in by opening `http://localhost:4747/?t=your-key` once (it remembers, and the key is taken out of the address). If you use Claude Code with `.mcp.json`, add the key there too: `"headers": { "Authorization": "Bearer your-key" }` next to `"url"`. (The Windows app does all of this by itself: it makes its own key.)
6. Restart the app (`Ctrl+C`, then `pnpm start`).
7. On your phone, with Tailscale switched on, open **`https://my-pc.tail1234.ts.net/view?t=your-key`** once, then add the page to your home screen for one-tap access (the key is remembered on the phone).

**Good to know:**
- Only devices signed in to your Tailscale account can open it. Don't use `tailscale funnel`, which would put the app on the public internet.
- The **Editor** button opens the full editor on your phone. It works, but it's cramped. Anything typed into its chat panel uses your API key, the same as on the PC.
- Pair it with Remote Control: talk to Claude in the Claude app and keep `/view` open in your browser to watch the changes land.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| "Port 4747 is already in use" | The app is already running in another window. Or set `MAPMAKER_PORT=4800` in `.env`, and change the port in `.mcp.json` to match. |
| Editor says "Reconnecting…" | The server stopped. Check the PowerShell window and run `pnpm start` again. |
| Chat says no API key | Check `.env` contains `ANTHROPIC_API_KEY=...` with no spaces or quotes, then restart. |
| Chat says the key was rejected | Create a new key in the Console. Check that billing is set up there. |
| Claude Code can't see the map tools | The app must be running before you start `claude`. Run `/mcp` to check, and approve the server if asked. |
| Windows Firewall prompt | Not needed. The app only listens on this computer (localhost). You can click Cancel. |
| Phone page says "Forbidden" | `MAPMAKER_ALLOWED_HOSTS` in `.env` doesn't match the address in your phone's browser. Copy the name from `tailscale serve status`, then restart the app. |
| "…is 1024x1024 but project.json says 2048x2048" | A project's starting map was updated after you'd edited it. Move the `map` folder inside `projects\<map>` somewhere else to start from the new one. |
| Phone page won't load at all | Check that Tailscale is switched on on the phone, and that `tailscale serve status` on the PC shows port 4747. |

## 9. Updating

Stop the app first (`Ctrl+C` in its window), then:

```powershell
git pull
pnpm install
pnpm start
```

`pnpm start` rebuilds the editor by itself when the code has changed since the last build. If the page ever looks out of date (a button or panel you expect is missing), run `pnpm start --build` to force a rebuild.

## For development

```powershell
pnpm dev        # hot-reloading editor at http://localhost:5173 + server
pnpm test       # unit and integration tests
pnpm typecheck
pnpm e2e        # browser smoke test (needs Playwright: npx playwright install chromium)
```
