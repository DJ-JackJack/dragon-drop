# Testing Dragon Drop on your PC

Everything so far was built and tested in a cloud container: unit tests, a scripted browser test and many screenshots. **Nothing has run on Windows, with your real API key, through Remote Control or from your phone.** This guide walks you through all of it. It takes about an hour end to end; sections are independent, so do as many as you like.

**What to send back:** for each section, Pass / Fail / Skipped, plus a note and a screenshot for anything odd. A copy-paste template is at the end. Send it to the chat, or just describe what you saw.

> **Your maps are safe.** Test edits go into the open map's own folder under `projects\` (for a new install, `projects\first-map\map\`), which git ignores. Section 1 saves a checkpoint first so you can put the map back, and deleting a map's `map` folder resets it to its starting terrain.

---

## 0. Before you start

You need the prerequisites from [SETUP-WINDOWS.md](SETUP-WINDOWS.md) §1 (Git, Node 22 or newer, pnpm). Use a **normal PowerShell** (not "Run as administrator"), and work from your Documents folder, not `C:\WINDOWS\system32`:

```powershell
cd $HOME\Documents
node --version     # v22 or higher (newer is fine)
pnpm --version     # 10.x
git --version
```

If `pnpm` isn't recognised, install it, then **close PowerShell and open a new one** (so it finds the new command), and check again:

```powershell
npm install -g pnpm
```

**First time on this PC:**

```powershell
git clone https://github.com/DJ-JackJack/dragon-drop.git
cd dragon-drop
pnpm install
copy .env.example .env
```

**Already cloned:**

```powershell
cd dragon-drop
git pull
pnpm install
```

(If the page ever looks out of date, start with `pnpm start --build` to force a rebuild.)

> If you opened a map from an earlier build, the app may say your saved map's size doesn't match. Rename that map's `map` folder to `map-old` and start again.

Add your key to `.env` (a line `ANTHROPIC_API_KEY=sk-ant-...`, no quotes) before section 10. Everything before that works without it.

---

## 1. Start, automated checks, safety checkpoint

### 1a. Automated checks (about 3 minutes)

```powershell
pnpm typecheck
pnpm test
pnpm build
```

**Expect:** `typecheck` prints nothing and exits cleanly. `pnpm test` ends with every test passing (49 at the time of writing, in 6 files). `pnpm build` ends with `built in …ms`.

Optional, needs a one-time download: `npx playwright install chromium`, then `pnpm e2e`. **Expect** `E2E OK`.

### 1b. Start the app

```powershell
pnpm start
```

**Expect:**
- The first run builds the editor (about a minute), then your browser opens at `http://localhost:4747`.
- The PowerShell window prints a banner with `Editor`, `MCP`, `Project: first-map` (or the map you had open last) and a `Chat:` line (it says "no ANTHROPIC_API_KEY" if you haven't added one yet: fine for now).
- **No Windows Firewall prompt** (if one appears, click Cancel; the app only listens on this PC).
- The page shows **Connected** at the top right.
- **Watch the PowerShell window for the whole session.** Any line starting with `Map compute worker stopped` or `save failed` or `Couldn't compute` is a problem: copy it into your report.

### 1c. Save a safety checkpoint

In the left panel, **Save checkpoint**, name it `Before testing`. **Expect** it to appear in the Checkpoints list. Restore it at the end of testing if you want the map back exactly as shipped.

---

## 2. First load and speed (the part I couldn't measure on your hardware)

Reload the page (`F5`) and time it.

| Check | Expect |
|---|---|
| Map appears | Within a second or two, in a plain relief look first |
| Status text near the map | "Preparing painted style…", then "Painting…", then it disappears |
| Full painted look | Within about 10 to 20 seconds of loading, on a typical PC. **Note how long yours takes** |
| Bottom-left of the map | `2048×2048 px · 3.902 km/px · 4,967 mi across` |
| Fan noise / CPU | A burst during loading, then idle |

**Report:** the seconds to painted look, and your CPU (for example "Ryzen 5 5600, 16 GB").

If the map stays plain forever, press `F12`, open the Console tab and copy any red text into your report.

---

## 3. The First Map check

A brand-new install starts on a small generated map called **First Map**. (Your own world maps, if you have them, are in your maps folder and are never part of the installer.) Use the hover read-out near the bottom-left (it shows pixel position and elevation).

- [ ] The map dropdown shows **First Map**, a 1024 × 1024 px archipelago at about 2 km per pixel.
- [ ] **Places**, **Roads and borders** and **Climate regions** are all empty ("None yet"): the starter map has no names or history of its own.
- [ ] Several islands of different sizes, with mountains (brown with white specks), forest and lowland, and lighter blue-green shallows round the coasts.
- [ ] Hover over a mountain: elevations reach a few thousand metres.
- [ ] The north is greyer and cooler, the south warmer and richer: the cold-to-warm gradient.

**Report:** anything that looks wrong or unnatural (scale, shapes, colours). This is the most useful feedback of all.

---

## 4. Moving around and views

| Do | Expect |
|---|---|
| Mouse wheel | Zooms toward the pointer, smoothly, even at 2048 px |
| **Pan** tool (H), or hold **Space**, or right-drag | Drags the map |
| **Fit** button (bottom right) | Whole map back in view |
| `G` | Coordinate numbers on/off (they are map pixels) |
| **Relief** / **Painted** buttons | Switches look; both undoable (they appear in History) |
| **Rivers** checkbox | Rivers on/off |
| Zoom in a lot on a coast | Crisp, not blocky |

---

## 5. Terrain tools and undo

Zoom to a small area of open sea or a quiet coast first.

| Tool (key) | Do | Expect |
|---|---|---|
| **Raise** (R) | Drag a stroke on land | Land rises; shading updates as you paint, no big lag |
| **Lower** (L) | Drag on land | Land sinks |
| **Smooth** (S) | Drag over rough ground | Softens |
| **Flatten** (F) | Drag across a slope | Levels it |
| **Land** (A) | Drag from the coast into the sea | New low land appears, coast pushes out |
| **Water** (W) | Drag along a coast | Land floods to shallow sea |
| `[` and `]` | | Brush gets smaller / bigger |
| **Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z) | After each stroke | Whole stroke undone in one step; History shows "You: …" |

Then: after you stop painting, wait about a second. **Expect** rivers and lakes to redraw to match the new terrain.

**Report:** whether painting felt smooth (no lag, no stalls) and how big a brush you could use comfortably.

---

## 6. Places, labels, selection

**Places**
1. **Place** tool (P): a hint appears under the tool buttons. Pick a type, click the map, and a box **inside the page** asks for a name. Type one and press Enter. **Expect** a marker and name appear, the place is selected, and an inspector appears on the left. (Cancel adds nothing.)
2. In the inspector: change the **Type**, **Name position** (right/left/above/below) and the name. Each is one undo step.
3. Add three more places very close together. **Expect** their names to sit on different sides of their markers instead of overlapping.
4. **Select** tool (V): click a place, drag it. **Expect** it follows the mouse and the move is one undo step. **Delete** removes the selected place.
5. Untick "Show marker" on a place: the marker vanishes and the name stays (a name with no marker dot suits a peak or a region).

**Labels**
1. **Label** tool (T), pick **Mountain range**, **click** and type a name: a straight label.
2. With **Label** still active, **drag** along a ridge or coast, release, type a name. **Expect** the name follows your line, centred, reading left to right. Range names stretch along the whole line.
3. Select it: the inspector offers **Spread** and **Straighten**. Drag it with Select: the whole line moves.
4. For a plain label, try the **Angle**, **Curve** and **Size** sliders.

When finished, delete your test places and labels (or use the checkpoint).

---

**Grid** (left panel, under Layers)
1. Click **Hex**. **Expect** a hex grid over the map, a size box, quick-size buttons (1 mi, 5 mi, 6 mi …) and an orientation choice.
2. Type `60` in the size box and press Enter, or click **60 mi**. **Expect** the hexes get that size, and the text under it says how many cells fit across the map.
3. Click **Square**: square cells at the same size. Try **Flat edge on top** for hexes, and the **Line strength** slider.
4. Click **6 mi**. At the full-map view the cells are too small to see, so a message appears at the top of the map with a **Zoom in to see the grid** button. Click it: the view zooms until the hexes are readable (the ground looks blocky there, because on the world map one pixel is about 2.4 miles). For small cells, make a **Detail map** of one island and set a 6 mi hex grid there: the cells are then about 20 pixels wide.
5. **Ctrl+Z** steps back through your grid changes. **Off** removes it.
6. Check the grid on `/view` and in a **⤓ PNG** export.

## 7. Climate panel and climate regions

**Climate panel** (open **Climate** under Style): move **Wetness**, **Snowline**, **Top edge latitude**. **Expect** the map to recolour about a second after you release a slider; each change is undoable. Put them back with Undo.

**A climate region** (clearly a test, delete it afterwards)
1. **Climate** tool (C). Click four or five corners round an area of land, then **double-click** (or click the first corner, or press **Enter**) to close it. Name it `Test frost`. `Esc` cancels while drawing.
2. In the inspector, tick **Temperature**, drag it to *frozen*; tick **Ground snow**. Leave the border **Soft**.
3. **Expect** the land inside to turn white and cold-coloured with a soft fade at the edge, about a second after each change.
4. Switch the border to **Hard**: the edge becomes sharp. Try **Strength** 50%.
5. **Select** tool: click inside it to select, drag to move, **Delete** to remove it. Undo brings it back.

---

## 8. Detail maps (regional maps)

1. **Detail map** tool (D). Drag a box round one island or coast, about 250 map pixels wide (you'll see a caption under the box like `8× detail: 2048×2048 px, 0.30 mi per px`; a red caption means too small or too big).
2. Release, type a name such as `Coast (detail)`.
3. **Expect** a toast "Making the regional map…", then (about 10 to 40 seconds) the new map opens by itself. Check:
   - [ ] It looks like a closer view of that area, with the same mountains, bays and coast shapes, plus extra detail.
   - [ ] Any place or label you had inside the box came across.
   - [ ] No big round lake that the world map doesn't have.
   - [ ] The left panel has a **Regional maps** section with a `⬑ First Map  parent` button.
   - [ ] The map dropdown at the top shows it as "… (part of First Map)".
   - [ ] The climate looks the same as on the world map (colours, snow). In the Climate panel it says the climate comes from the parent, with an "Update from …" button.
4. Press the `parent` button: back on the world map, with a **dashed white outline** and a name tag showing where the detail map sits.
5. Edits in one map don't change the other (try raising a hill in the detail map, then look at the parent).

---

## 9. Export, viewer and persistence

**Map extras and export**
1. Open **Map extras** in the left panel. Type a title, tick **Scale bar** and **Compass rose**, and try **Frame**. **Expect** a title banner, a scale bar (0, a half, and a tidy full length such as 500 mi) and a compass rose to appear on the map; each change is one undo step. Try other corners and **Kilometres**. (The title can cover a coastline: move it to the bottom, or turn it off.)
2. Click **⤓ Export**. Pick **2×** and click **Export**. **Expect** a file such as `First Map.png`, 4096 × 4096, with rivers, names, the extras and any grid you've set. Open it and zoom in: the lettering, lines and compass should be sharp even though the terrain is softer.
3. Try **8×**: the dialog says "16 tiles in one .zip". It takes a few seconds to a minute on a normal PC and makes a `…_tiles.zip` (hundreds of MB) holding 16 images of 4096 px and a README. Unzip it. **Expect** the tiles to line up with no visible seams. If your PC runs out of memory, tell me, and use 4× instead.
4. Turn the checkboxes off in the dialog (rivers, names…) and export 1×: those things should be missing from the file.

**Phone viewer page, on this PC first:** open `http://localhost:4747/view` in another tab.
- [ ] Map appears with labels.
- [ ] Mouse wheel zooms, drag pans, double-click zooms in.
- [ ] **Places** button lists places; tapping one flies to it and shows a card with its notes (give one place some notes first).
- [ ] Paint something in the editor tab: **within a couple of seconds** the viewer shows "Updating…" and then the change.

**Persistence**
1. Make one visible change (for example raise a hill). Wait about 3 seconds.
2. In PowerShell press `Ctrl+C`. **Expect** "Saving and shutting down…".
3. `pnpm start` again. **Expect** your change is still there, along with your places and labels.
4. Look in the open map's `map\` folder under `projects\`: `height.f32.gz` exists. `git status` must **not** list anything under `map\` (it's ignored).

**Robustness:** while the app runs, stop it with `Ctrl+C` and watch the editor: it should say **Reconnecting…**. Start it again: it reconnects by itself and shows the map. Open the editor in two tabs and paint in one: the other updates live.

---

## 10. In-app chat (needs your API key; spends API credit)

The header shows the model and effort, and a running cost (`$0.00`). A short session like this should cost well under a few dollars on **Medium** effort. Start with the cheaper **Sonnet 5.5** if you prefer.

Try these in order, and **Save a checkpoint** first:

1. **"What's on the map right now?"** Expect: tool chips ("Checked the map", "Read the brief", "Looked at the map"), a preview image in the chat, and a description of the islands, mountains and seas that really are on the map. It should not invent names or history.
2. **"Add a small island about 60 miles across in the open sea south-west of the biggest island and show me."** Expect it to convert miles to pixels, add land, then look at the result. The island appears live in the editor and History shows a **Claude** entry. Undo removes it (Claude's edits are undoable like yours).
3. **"Raise a ridge on that island and weather it."** Expect `add_mountain_range` or sculpting, then erosion.
4. **Lore guard:** **"Name the capital of that island."** Expect Claude to *propose* names and ask which you want, and **not** add one to the map or the brief on its own.
5. **Your edits:** paint something by hand, then ask **"What did I just change?"** Expect it to describe your stroke (it reads the change log).
6. **Roads:** place two test towns on the same island, then ask **"Lay a road from the first town to the second and tell me how long it is."** Expect a road drawn over the terrain and a length in miles and days on foot that matches what the editor's inspector shows (the path depends on the terrain: it should climb mountains at passes, and never go over the sea).
7. **Reference image:** paste or drag a rough sketch into the chat and ask "make an island like this". Expect it to be saved under References and used.
8. Click **New** in the chat: the conversation clears but the map and brief stay.

**Report:** how long a typical answer took, the cost shown after the session, and any tool error chips (red).

When finished, restore the `Before testing` checkpoint (or undo the test changes).

---

## 11. Claude Code through MCP (the same tools, from a terminal)

1. Install Claude Code if you haven't (<https://code.claude.com/docs>) and sign in.
2. With the app running, open a **second** PowerShell window in the project folder and run `claude`.
3. It asks about the **mapmaker** MCP server from `.mcp.json`: approve it. Type `/mcp`: mapmaker should be **connected** with about 44 tools.
4. Ask: **"Using the mapmaker tools, give me the map summary and a preview."**
5. Ask: **"Add a climate region over the biggest island called 'MCP test' that is cold with snow, then show me."** Check the editor: the region appears, History says "Claude Code: …", and Undo removes it. Remove it afterwards.

**Expect** that Claude Code follows `CLAUDE.md`: it uses the tools rather than editing files, and it doesn't invent lore.

---

## 12. Remote Control from your phone

1. Keep the app running. In the second PowerShell window, in the project folder: `claude remote-control`.
2. On your phone, open the Claude app. The session appears under **Claude Code**.
3. Send something small: **"Using the mapmaker tools, tell me what places are on the map."**
4. Then a change: **"Add a test place called 'Phone test' on the biggest island."** Watch it appear in the editor on the PC. (Delete it afterwards.)

**Report:** whether the session appeared, any delay, and whether preview images show on the phone.

---

## 13. The map on your phone (Tailscale)

Follow [SETUP-WINDOWS.md](SETUP-WINDOWS.md) §7: Tailscale on the PC and the phone, `tailscale serve --bg 4747`, `MAPMAKER_ALLOWED_HOSTS` in `.env`, restart, then open `https://<your-pc>.ts.net/view` on the phone.

- [ ] The map loads with labels.
- [ ] Pinch-zoom and drag work; double-tap zooms in.
- [ ] **Places** lists places; tapping one flies to it.
- [ ] Making a change from the PC (or from the phone's Claude session) shows up on the phone within a few seconds.
- [ ] The header fits on the phone (buttons not cut off).
- [ ] A browser on a device **not** on your Tailscale network cannot open it.

If you see "Forbidden", the name in `.env` doesn't match the address in the browser: copy it from `tailscale serve status`.

---

## 14. Roads and borders

Draw them yourself with the **Roads** tool (O), or ask Claude (section 10, step 6).

**A road you draw**
1. Click **Roads** (a hint appears; "Draw a" is set to Road and "Find the route over the terrain" is ticked).
2. Click where the road starts (try the south coast of the biggest island), then **double-click** where it ends (try its north-west). **Expect** a brief "Finding the best route…" message, then a brown road with a pale edge, and the inspector on the left showing its length in miles and days on foot.
3. The road should keep to low ground and climb mountain ranges at passes, not straight up the steepest slope. Try a road to a place across the sea: you should get an error saying water is in the way (use "Border" or untick the box to draw a straight line over water).
4. Click more points before the final double-click to make the road pass through them. **Backspace** removes the last point, **Esc** cancels.
5. Untick "Find the route over the terrain" to draw the road exactly as you click it.

**A trail or border**
1. Set "Draw a" to **Trail** (dotted, tolerates steeper ground) or **Border** (dash-dot purple, drawn exactly as you click).
2. For a border, click points round a territory and **click the first point again to close it** (or double-click to leave it open).

**Afterwards**
- [ ] The **Roads and borders** list on the left shows each with its length. Clicking one selects it.
- [ ] **Select** tool: click right on a road to select it (blue glow); drag it to move the whole line; **Delete** removes it; **Ctrl+Z** brings it back.
- [ ] In the inspector you can name it, change its kind and add notes.
- [ ] Roads show on the phone page and in the PNG export.
- [ ] A detail map made over a road keeps the part of the road inside its box.

---

## 14b. Terrain from a drawing

This **replaces the whole map**, so first click **Save checkpoint** (it also saves one called "Before sketch import" itself, and Undo works).

**Quick check first (file types):** attach a **GIF** picture with the paperclip in the chat. It is left out and a note says only PNG, JPEG and WebP can be attached; a PNG, JPEG or WebP picture attaches (and Claude can see it).

1. Find the **References** area in the left panel (attach a rough sketch in the chat first if there is none: green land on blue sea, with red strokes for mountain ranges if you like). Click **Make terrain…** under it.
2. **Expect** a dialog with a small coloured preview: blue sea, green land, and (if "Red strokes mark mountain ranges" is ticked) brown mountain strokes along any red lines. The preview should look like your sketch: its islands and their shapes. Move the "How different from the sea counts as land" slider and watch the preview change.
3. Leave the defaults and click **Create terrain**. After a few seconds **Expect** the map to be replaced by one with the same islands and ranges (rougher and plainer than a map refined by hand over many passes: this is a starting point). History shows "Terrain from sketch …", and the Checkpoints list has "Before sketch import".
4. **Ctrl+Z** (Undo) brings your old map back exactly, or use the checkpoint's **Restore**.
5. Try it again with **Stretch it over the whole map**, taller mountains, and a smoother or more ragged coastline.
6. Ask Claude in the chat: **"Turn the reference image into terrain."** Expect it to look at the image first, ask before replacing the map (the map already has land), and then run the import.

Please say how well it read your sketch: any islands missing or merged, mountains in the wrong places, the ring formation.

---

## 14c. Battlemaps and tabletop export

1. Click **+ New map**, choose **Battlemap**, leave 30 × 20 squares and "Start with a walled, floored room", click **Create**. **Expect** a stone-floored room with a dark wall outline. Scroll to zoom, drag with the Pan tool to move.
2. Pick the **Room** tool and the wooden swatch, then drag a 6 × 4 room inside the big one. **Expect** a planked floor and walls, and the size ("6 × 4 squares · 30 × 20 ft") while dragging. **Ctrl+Z** twice undoes the walls and the floor.
3. Pick **Door** and click on the new room's wall. **Expect** a brown door in a gap in the wall. Click it with **Select**: a panel offers *Open* and *Locked*. Try **Door** on bare floor: **Expect** a note that there's no wall there.
4. Pick **Light**, click inside the room, then Select it. **Expect** a warm glow that stops at the room's walls and closed doors (turn on **Lights** in the view options if it's hidden), and sliders for reach, bright part and strength plus a colour picker. Make a door **open** in Select: light should now spill through it; a window lets light through too. Untick **Walls block it**: the glow becomes a plain circle again.
5. Pick **Brush**, the water swatch, and paint a pond with a wiggly drag. **Expect** soft, rounded edges. One **Ctrl+Z** removes the whole stroke. **[** and **]** change the brush size.
6. Try **Wall** (click points, double-click to finish) and **Window**.
7. Under **Grid**, switch Square / Hex / None. **Expect** the grid on the map to change.
8. Click **⤓ Export**. Download the **Universal VTT** file and the **Foundry scene**. If you have Foundry v14: follow the README inside the zip (upload the PNG, then right-click a Scene → Import Data) and check that the walls block movement and sight, doors open, lights glow and the grid lines up. Or try the `.dd2vtt` with the Universal Battlemap Importer: in it **only the doors should be doors**. A window and an invisible wall come through as **plain walls** (the format has no see-through wall; Foundry's own scene export keeps them), and a secret door should look like plain wall (the format has no secret door; add the door by hand when you reveal it). **The Foundry scene was tried in Foundry v14 (build 367) and works; the `.dd2vtt` was tried with the Universal Battlemap Importer, where the lights are faint** (see [FOUNDRY.md](FOUNDRY.md)). Please still tell me exactly what Foundry does or says on your build, including any message, a wrong grid size, missing walls or a missing background.
9. Ask Claude in the chat: **"Make a 24 by 16 battlemap of a small tavern: a main room with a bar, two doors and a window, and a cellar with a trapdoor."** Expect it to create the map, build rooms, preview with `render_battlemap`, and say what it can't do (no furniture yet).
10. Switch back to the world map in the project picker: **Expect** the world map unchanged.

Please say how drawing felt (snapping, the Room tool, doors), how the floors look to you, and anything missing.

---

## 14d. The installed app (Dragon Drop installer)

Do this on a PC (or after closing the program you've been running with `pnpm start`; don't run both on the same maps at once).

1. Download the installer as described in [SETUP-WINDOWS.md](SETUP-WINDOWS.md) §0 and run it. **Expect** a "Windows protected your PC" warning (unsigned): **More info → Run anyway**. It installs without questions and Dragon Drop opens.
2. **Expect** a welcome box asking "Where are your maps?". If you have the older version's folder, it should offer **Use my existing maps** with the right path. Choose it. **Expect** the maps you've been working on, with your places, labels and checkpoints.
3. **Expect** the black and gold look and a title bar that is part of the app (the window buttons at the top right are Windows' own). The window should drag by the top bar. Tell me if the buttons overlap anything.
4. Click **Settings**, paste your API key, **Save key**. **Expect** the window to reload and the chat to work (ask it something small). Close Settings and reopen it: it should say a key is saved.
5. Make a small edit, then close the window straight away. Start Dragon Drop again from the desktop icon. **Expect** the edit to be there (it saves on quit).
6. Start it a second time while it's running. **Expect** the existing window to come to the front, not a second copy.
7. In **Settings**, copy the Claude Code command, run it in a terminal, then start `claude` and ask it to `list_projects`. (Optional.)
8. Open `http://localhost:4747/view` on this PC, or on your phone through Tailscale as before.
9. **Settings → Change…** under "Your maps" and pick another folder (an empty one is fine: a new first map is started in it). **Expect** the editor to reload with that folder's maps. Switch back.
10. **The Claude Code panel (right-hand side).** **Expect** it to start by itself ("Running"). If Claude Code isn't installed it shows how to install it. The first time, Claude Code asks you to sign in (your browser opens). Then type `/mcp`: `mapmaker` should show a green ✓. Ask it to list the projects. Check: you can type normally, **Ctrl+C** copies a selection and **Ctrl+V** pastes, **Wider** helps readability, `/exit` shows the bar with **New conversation** / **Continue last**, and **Pop out** opens a separate window. Switching to another map and back should keep the conversation. (If you registered `mapmaker` yourself earlier, you can remove it: `claude mcp remove mapmaker --scope user`.)
11. **Settings → Updates**: **Expect** the version number and a message. Once a release has been published, a newer version should download by itself and offer **Restart now**.
12. Quit from the window's close button, then check Task Manager: there should be no leftover "Dragon Drop" processes after a few seconds.

Report anything odd, especially: the Windows warning text, anything that looks cut off at the title bar, how long it took to start, and whether the exports (Foundry / Universal VTT) still download and ask where to save.

---

## 14d2. Other AI assistants (one click)

Only do the ones you have installed. Each is a few minutes. **Settings → AI assistant**, pick the assistant, **Save**.

1. The line under the box says the map tools are connected automatically and names the file. Open `Documents\Dragon Drop\Claude` and check that file exists, that the others (`.mcp.json`, `.codex`, `.gemini`, `opencode.json`, `.agents`) do not, and that **no file in the folder contains your access key** (search the folder for the key from Settings → Copy header), except `.agents\mcp_config.json` while Antigravity is chosen.
2. Start it in the Terminal tab. Answer its trust question (Codex, Gemini CLI) with yes and sign in if it asks. Ask it: *"What map tools do you have? Then list the places on this map."* It should name the mapmaker tools and use one.
3. Switch back to Claude Code. The assistant's file is gone from the workspace folder, and Claude Code still shows `mapmaker` connected in `/mcp`.
4. Pick **Custom** and type a command that isn't one of these. The line says Dragon Drop can't connect the map tools by itself and shows the address and header to use.

Checked by the developer on Linux against a running server, with the access key supplied only through the environment: Gemini CLI 0.68 and OpenCode 1.19 connected and listed the map server (and failed with 401 when the variable was missing); Codex 0.170 read the file once the folder was trusted. **Not checked with the real program:** Codex's connection and tool calls, Antigravity, and everything on Windows.

---

## 14e. Asset library

1. **Settings → Asset library → Choose folder…** and pick your assets folder (best: one with a mix, such as a folder of loose PNG or JPEG files, a `.zip` of pictures and an asset pack file if you have one). The app restarts its server and the box shows "Reading assets… n of N", then something like "N packs read: M usable (… files)". A folder, a zip file and a pack file each count as one pack. The first read of your biggest pack files takes the longest; the next time it's quick. **Tell me the numbers**, and anything that says "couldn't be read" or "not used because their authors don't allow other programs".
2. Click **Copy report** and paste it into the chat with me (it has no pictures; it's a few hundred lines). **This is the most useful thing you can send**: it shows me how your assets are laid out so I can support walls, paths, doors and roofs next.
3. Open a battlemap (or make one). In the right-hand panel open the **Assets** tab. Try **Objects**: search "table", "torch", "barrel". Thumbnails should appear within a second or two (large images take longer the first time). Click one, then click the map.
4. Try **Floors**: click a texture. It appears among the floor swatches and the Brush is ready; paint a floor with it. **Tell me how big the pattern looks** (each texture repeats every pixel width / 256 squares by default; if that looks wrong for your packs I'll change the rule).
5. Object sizes: place a table and a tree. **Tell me if they look too big or small** against the 5 ft grid.
6. Put one more picture into a folder of your library, press **Rescan** in Settings, and search for it in the Assets tab. It should appear. A picture inside a folder named `Floors` should be listed under Floors, one in `Props` under Objects. WebP pictures should show in the panel and appear in exports and previews like any other (an animated WebP is skipped).
7. Ask Claude (in the Claude Code panel): *"Search my assets for a wooden table and four chairs, show me them, then furnish the tavern."* It should search, show a contact sheet, place objects, render and check.
7. **⤓ Export** the map: objects and pack floors are in the picture.

---

## 14f. Scenes, caves and odd shapes

1. On a world map pick **Battlemap here** and click: the middle of an island, a coast, a river, a mountain, the sea. Each time name it. **Expect** a battlemap that fits the spot (the left panel says where it came from; **↑ Back to the world map** returns). Try it where a river runs and on a coast: the river should run the same way as on the world map, and the sea should be on the sea's side.
2. In a battlemap choose **Area** with **Circle** and drag out a pond; **Room** with **Free-form**: click corners, double-click to close. **Expect** a round or polygon floor, and with Room a wall all the way round.
3. Paint a cave with the Brush (dirt) in blobs and a corridor, then click **▢ Walls around the floor**. **Expect** a wall along the whole edge, with holes walled too. Paint a bit more floor and click again: the walls should follow the new shape without doubling up.
4. Cut a door into the traced wall (Door tool).
5. Ask Claude: *"Make a cave with three chambers joined by tunnels, torches in two of them, and a lake in the biggest."*

Tell me how natural the scene floors look, and whether the cave walls follow the edge the way you'd draw them.

---

## 14g. Walls, doors and the light level

1. In a battlemap with a room, a door and a window, look closely (zoom in with the wheel). **Expect** thick grey stone walls with a lit top-left edge and a soft shadow on the floor to their right and below; wooden doors (a brass handle when shut; **Open** swings the door back into the room); a window with pale blue glass; a small gold diamond on a secret door; a dashed purple line for an invisible wall. Zooming in keeps the edges sharp after a moment.
2. Under **Light level** (left panel, below Grid) click **Dim**, then **Dark**. **Expect** everything to darken except where a light reaches (its pool, shaped by the walls: a torch in a closed room lights only that room, through an open door it spills out). **Bright** puts it back. Drag the slider for in-between levels. Untick **Light glows** to see the whole map while you build.
3. **⤓ Export** with Dim or Dark set, and look at the PNG. **Expect** it to stay bright with the walls drawn in (the tabletop does its own lighting). The Foundry scene file carries the level as its Darkness Level (`environment.darknessLevel`) and the Universal VTT file as a grey `ambient_light`. **The dim Foundry scene was tried in Foundry v14 (Darkness Level shows, the scene looks dark except round the lights); the Universal VTT ambient light has not been tried; please tell me what you see.**
4. Ask Claude: *"Make this scene dark with two torches"* (it uses `set_battle_lighting` and `add_light`) and *"Render it for me."*
5. **Time of day:** click **Dawn**, **Dusk**, **Night**. **Expect** a level and a colour each (pink-gold, orange, blue). Pick your own **Ambient colour**; **No colour** removes it.
6. **Shade tool:** draw a rectangle over a building in a dark or night map. **Expect** the inside to be brighter (or dimmer in a bright map), with a soft edge; select it to set its level and name. Lights still brighten it.
7. **Notes:** pick **Note**, click three rooms. **Expect** numbered gold markers and a **Key** list on the left; click an entry, give it a title and text, drag a marker with Select. **Renumber in order** renumbers top to bottom. **⤓ Export → Key** downloads a Markdown list; the PNG, Foundry and Universal VTT files must **not** show the markers.
8. Ask Claude: *"Number the rooms of this tavern and put a note in each, only titles; I'll write the text."*

Tell me whether the walls read as walls at normal zoom, and whether Dim and Dark are the right amounts of dark (they are 55% and 25%).

---

## 14g2. Levels (a cellar, a ground floor, an attic)

Open or make a battlemap with a room in it.
1. A small **Levels** panel sits in the top-left corner of the map with one level, **Ground floor** (0 to 10 ft). **Expect** a **+ Level above** and a **+ Level below** button.
2. Click **+ Level above**. **Expect** a new **Upper floor** (10 to 20 ft), lit gold, with an empty map: and the room below showing **faintly** through it, where the new floor has nothing.
3. Paint a room on the Upper floor (partly over the room below), add a door and a light. Click **Ground floor** in the panel. **Expect** the ground floor as you left it (its own room, door and light), and the upper floor's room showing nothing (you only see the level *below*). Press **Page Up**: back on the Upper floor. **Page Down**: the ground floor.
4. **Undo** on the Upper floor undoes only what you did there; switching level doesn't undo anything.
5. Click the **pencil** on a level: change the name (then the floor and ceiling heights in feet). **Expect** the panel to show the new name and heights. Try a ceiling below the floor: **expect** it to be refused with a message.
6. **⤓ Export**, **Foundry scene**. **Expect** a zip with a picture for each level (`-1-ground-floor.png`, `-2-upper-floor.png`), the scene file and a README that names both levels. **Universal VTT** and **Image only** are of the level on screen and say so in their file names.
7. Close Dragon Drop and open the map again. **Expect** both levels back, with the same names and heights, and the same level on screen.
8. Click the **bin** on the Upper floor and confirm. **Expect** it gone and the ground floor on screen. Open **Checkpoints**: there is a **Before removing Upper floor** one; **Restore** brings the upper floor back with its room.
9. **Expect** the bin on the first level to be greyed out (the first level can't be removed).

## 14g3. Stairs, ladders and holes between levels

Use a battlemap with two levels (14g2) and a room on each.
1. On the **Ground floor** pick **Stairs** (left panel, "Between levels", or `T`). **Expect** a hint about Change Level, and **Leads up / Leads down** buttons. Drag a rectangle (1 square wide, 3 long). **Expect** pale stone steps with a ▲ on them, and the inspector says **Stairs** and "Leads up to Upper floor".
2. Switch the stairs to **Leads down** in the inspector. **Expect** "There is no level below this one: it won't be in a Foundry scene". Switch back to Up.
3. Pick **Ladder** (`J`) and just click: **Expect** a one-square wooden ladder. Pick **Hole** (`O`) and click: **Expect** a dark pit with a stone rim and a ▼ (a hole always leads down; its Leads box is greyed out).
4. With only one level, try a stair tool. **Expect** a message to add another level first.
5. Switch to the **Upper floor** (`Page Up`). **Expect** the stairs you made below showing faintly where the upper floor has no floor. Put a **Hole** in the upper floor's room.
6. Select a stair, drag it, press `Ctrl+Z`, `Ctrl+C` then `Ctrl+V`, `Delete`. **Expect** each to work like any other object, one undo step each, and a box drag round it to select it with other things.
7. **⤓ Export → Foundry scene**, import it into Foundry (the README in the zip says how). **Expect** walking a token onto the stairs to ask "Do you want to move … to Upper floor?". **Expect** the upper floor to have a floor Region with a hole (open the Regions layer). **Tell me what a token does at the hole**: how it behaves in play hasn't been looked at in Foundry yet.
8. The exported picture of each level shows its stairs, ladders and pits.
9. **With Claude** (the terminal panel or the chat): *"Add a cellar under this room, and put a ladder in this room down to it."* **Expect** it to use `add_level` (the Levels panel shows a new **Cellar**, you are taken to it), then to switch back and add the ladder (a 1-square ladder in the Ground floor, leading down), and to say what it did. Ask *"What's on each level?"* (`list_levels`). Ask it to remove the cellar: **expect** it to say that is yours to do in the editor.
10. **⤓ Export** on a map with levels: **Expect** a **Level** picker above the cards; pick the Cellar and download the **Image** and the **Universal VTT** file: the names end with the cellar's name and the picture is the cellar's.

## 14g4. Roofs

Use a battlemap with a room on the Ground floor.
1. Pick **Roof** (left panel, "Roofs", or `F`). **Expect** a hint, and a "New roofs look like" box. Drag a rectangle a little wider than the room. **Expect** a faint slate roof over the room (you can see the room through it), the inspector says **Roof** with its look.
2. In the inspector change the **Look** to Clay tile, Thatch and Wood shingles in turn, tick **Own colour** and pick one, tick **Flat**. **Expect** each change at once, one undo step each. A pitched roof has a light slope, a dark slope and a ridge along its longer side.
3. In the left panel (Layers → **Roofs**) choose **Solid**: **Expect** the roof to hide the room; **Hidden**: gone.
4. Pick the **Circle** or **Free-form** shape under the Roof tool and make an odd-shaped roof. Select a roof and drag it, `Ctrl+C`/`Ctrl+V` it, `Delete` it.
5. In the **Assets** tab choose a floor or roof texture from your packs (a picture, not an object), select a roof and press **Use the picture chosen in Assets**: **Expect** the picture repeated across the roof; change **One repeat is** to resize it.
6. **⤓ Export → Image only** and **Universal VTT**: **Expect** no roof in them. **Foundry scene**: **Expect** a `...-roof-1.png` (one for each roof, cropped to it) next to the level's picture, and in Foundry a **Tile** and a **Define Surface** region (a ceiling) for each roof. Select a token (so you control it) and move it under a roof: **expect** that roof to disappear while the token is under it and come back when it leaves, other roofs staying; a token you haven't selected stays hidden under the roof; holding **Alt** (Highlight Objects) shows the inside of every roof. **Tell me what a player's view does** (log in as a player who owns a token): that hasn't been looked at.
7. **With Claude**: *"Put a clay tile roof on the tavern, a bit wider than its walls."* **Expect** `add_roof`; ask it to show you the map with the roof (`render_battlemap` with roofs).

## 14h. Reefs, the northwesterly wind and the new places

1. **Roads** tool, choose **Reef**, click along a strait (or any stretch of sea) and double-click. **Expect** a pale shoal with razor rocks and foam along the line, listed as a reef; Delete removes it.
2. Ask Claude: *"Find the straits between the islands, then put razor reefs across them."* **Expect** it to list the straits first, then one reef per strait (one undo step for the lot), each a wavy line from coast to coast. Look at one close up.
3. **Climate → Prevailing wind**: pick **From the north-west** (or ask Claude: *"Set the prevailing wind to northwesterly"*). **Expect** the dry rain shadows to move to the south-east side of the mountain ranges.
4. **Outer coasts and dark stone:** ask Claude: *"Fringe the outer coasts of the islands with razor reefs, leaving the south coast of the biggest island clear, and make the smallest island's land dark stone."* **Expect** a pale reef band with rocks along every outer shore except the one you asked to keep clear (and none on shores facing an inner sea), and the stone island charcoal grey with no green. One undo step each.
5. Ask Claude to mark a **waterfall** on the east face of a mountain range (it should use a river source at a place of that name, and tell you where it put it); drag the marker (Select) where you want it.

Tell me whether the reefs (straits and coasts) read as reefs at the zoom you use, and whether the dark stone looks right.

## 14i. Jungle and desert

1. **Region** tool (C), draw a loop over some lowland, set **Temperature 0.95** and **Moisture 0.95**, soft border. **Expect** a dense, lumpy canopy, clearly different from the grass around it, with darker and lighter stands (old growth and regrowth, the odd open clearing) rather than one uniform green, blending softly at the edge.
2. Draw a second loop on other lowland with **Temperature 0.95** and **Moisture 0.04**. **Expect** sand: pale, ochre and rust patches with dune ridges that run across the wind (set the wind under Climate to see them turn), darker steep sides, and a few scrub tufts on the flats. Zoom in: the ridges read as lines of dunes.
3. **Climate → Prevailing wind**: change it. **Expect** the dune ridges in the desert to turn with it.
4. Delete both regions (or undo). **Expect** the land goes back to its ordinary grass, and **no** other part of the map changed (the dry parts of the map stay olive, not sand).

Tell me whether the jungle and desert now read as different kinds of ground, and what you'd change (more or less dune, redder or paler sand, a darker or lighter canopy, more or less contrast between the stands).

---

## 14j. Smooth zoom, Suggest and Assist

1. **Smooth zoom:** in the left panel under **Layers**, **Smooth zoom** is ticked. Zoom a long way into the terrain. **Expect** soft blending (not hard blocks; the coastline still steps a little). Untick it: hard blocks again. Reload the page: the choice is remembered.
2. **The Claude bar:** open the **Claude Code** tab (desktop app). **Expect** a bar with **Suggest**, **Assist** and a dot. A few seconds after Claude Code starts, the dot turns **green** ("ready"). If it stays grey, tell me (the hooks aren't reaching the app).
3. **Suggest:** make a change (add a place, raise some land), then click **Suggest**. **Expect** a line starting `[Assist]` or `[Suggest]` to be typed into the terminal and sent; the dot goes gold while Claude works, and Claude answers with up to three numbered suggestions and **does not change the map**. The dot goes green again. Click Suggest *while Claude is working*: **expect** a message that it is busy, and nothing typed.
4. Reply "do 1" in the terminal. **Expect** Claude carries out suggestion 1 as a normal request (and it can be undone in History).
5. **Assist:** tick **Assist**. Make at least two or three edits, then leave the map alone for about 45 seconds. **Expect** the `[Assist] I changed the map by hand…` line to be typed by itself, and Claude to answer. Switch to another tab before it answers: **expect** a gold dot on the Claude Code tab when the answer is ready.
6. **Assist stays polite:** keep editing (nothing should be typed); type something in the terminal without pressing Enter (nothing should be typed over it); ask Claude something slow and edit during its answer (nothing should be typed until it finishes); after a suggestion, edit again straight away (the next one waits at least 3 minutes).
7. Untick **Assist**: **expect** nothing is ever typed for you.

Tell me whether the suggestions are useful (too many, too few, wrong kind of ideas), and whether the timing felt right.

---

## 14k. Claude Code on a new PC

This needs a PC (or a Windows user account) that has never had Claude Code. On your own PC you can only check the dialog wording.
1. Install Dragon Drop and open the **Claude Code** tab. **Expect** "Set up Claude Code": what you need (paid plan), **Step 1** with **Install Claude Code for me**, **Step 2** sign in, **Step 3** ready, and two folded sections ("Rather do it yourself?", "Something went wrong?").
2. Press **Install Claude Code for me**. **Expect** a banner "Installing Claude Code…" and the installer's text in the terminal; it may be quiet for about a minute. **Expect** it to finish by itself and Claude Code to start in the panel with a banner about signing in.
3. **Sign in** in the browser that opens (use a paid Claude account). **Expect** to return to Dragon Drop, and the dot beside **Suggest** to turn green; the banner disappears.
4. Open **Settings**. **Expect** "Claude Code: installed (version …)".
5. Failure path: turn off the internet and press the install button again. **Expect** "The installation didn't finish" with **Try again**, the manual steps, and the troubleshooting list.

Tell me where any step was unclear, and what the installer or sign-in showed if it didn't go as described.

---

## 14l. Speed

1. Open your biggest map (2048 px if you have one) from a cold start of the app. **Expect** a quick, blocky relief picture almost at once, then the painted map a few seconds later, without the window freezing in between.
2. Raise or lower some land with a brush and let go. **Expect** the map not to freeze a few seconds later when the climate catches up: only the area around your stroke (and downwind of it) is redrawn.
3. Make a change that affects the whole climate (Climate panel: change the wind). **Expect** the whole map to redraw, in pieces, without a long freeze.
4. While Claude works (or you save), keep painting. **Expect** no half-second hiccups every time the map is saved.

5. **Second launch:** close Dragon Drop and start it again. **Expect** the map to be painted a few seconds after the window opens (the first launch of a map size does a one-off, a few seconds longer, build). While it paints, the window should stay responsive.
6. In `%APPDATA%\Dragon Drop\cache\noise` there should be a file such as `2048x2048-<number>-v1.bin` (about 80 MB). It is safe to delete (it is built again); the newest four are kept.
7. Paint a stroke, then undo it a few seconds later. **Expect** the stroke to show at once, and the land to come back exactly when you undo.

Tell me if anything felt slow, and where (starting, painting, after letting go, saving, or asking Claude for something).

---

## 14m. Rivers, lakes and river sources

(This is in the release after 0.1.3.) The rivers are now worked out from rainfall, so **on an existing map some rivers will move or change size** when you first open it. That is the point; use **Undo** or a checkpoint if you want the old ones back.

1. Open a world map. Look at the rivers. **Expect** rivers in wet country (jungle, the windward mountain faces) and almost none through deserts; **expect** every lake to have a river running out of it to the sea.
2. In Claude Code, ask: *"Add a river source at a place called 'Test Falls' on a mountain slope, size major, then check the hydrology and show me."* **Expect** a river to start at the marker and run to the sea, and a summary with its length and where it ends. (Don't ask it to name the river: you haven't picked a name.)
3. Ask Claude to *list the river sources*. **Expect** Test Falls with its size and the length of its river. Delete the test place afterwards.
4. Drag the Test Falls marker somewhere else on land. **Expect** the river to start from the new spot a second or so later. Drag it into the sea: **expect** the river to disappear and `check_hydrology` to say that source isn't drawn.
5. Press **Undo**. **Expect** the marker back and the river back.
6. Ask Claude *"does the water on this map make sense?"* **Expect** a plain list of problems it can see: lakes with no way out, rivers over very dry ground, rivers through hollows. (The last one still shows; fixing it is stage 2.)

7. **How rivers look** (painted style): zoom in on a river. **Expect** it to look painted into the land, not drawn on it: pale and clear when small, deeper blue when big, white at rapids and falls, darker and calmer on flat ground, darker banks and a valley that deepens in the mountains, and partly hidden by the canopy in jungle. It should run straighter down steep ground and wander on the flat, and a tributary should meet its river exactly. Untick **Rivers** under Layers: **expect** the rivers to disappear from the picture after about a second, and come back when you tick it again. The Relief style still draws rivers as lines.

Tell me if a river now looks wrong, or if a source's river runs somewhere that doesn't fit your story.

---

## 14n. Selecting an area for Claude

(This is in the release after 0.1.3.)

1. Press **E** (or click **Select area**). Under the tool buttons pick **Rectangle**, drag a box on the map. **Expect** a gold outline, and a bar at the top left saying what is selected, with a checked box "Claude's edits are locked to this area", and a gold "locked" tag on the outline.
2. Try **Circle** (drag from the middle outwards), **Freehand** (draw round something; it closes when you let go) and **Polygon** (click the corners, then double-click, click the first corner or press Enter to close it; Backspace takes back a corner, Esc cancels). Click without dragging: **expect** a single point ("the point (x, y)") and no lock box.
3. With the **Select** tool (V), click a place, label, road or climate region: **expect** the bar to name it. Click bare ground: **expect** a point. **Esc** (or **Clear**) removes the selection.
4. In Claude Code, select an area and say **"make this a swamp"** (or any change that isn't tied to a name). **Expect** Claude to call `get_selection` first and work inside the box. Ask it to add a mountain range much bigger than the box: **expect** the mountains only inside the box, with a soft edge, and nothing changed outside. Ask it to move a town that sits outside the box: **expect** it to tell you it's locked.
5. Untick the lock box and repeat the big change: **expect** it to affect the whole range. **Undo** takes it back in one step either way.
6. Select an area and say **"show me what I've selected"**: **expect** a picture of it with a gold outline. Say **"highlight the biggest island for me"** (lock off): **expect** the box to appear on your map without changing anything.
7. In the desktop app, type into the **Ask Claude about this** box and press Enter. **Expect** the question to appear in the Claude Code panel (with "[Selection]" in front) and Claude to answer it about your selection. While Claude is busy, **expect** a note saying so and nothing typed.

Tell me if the lock ever lets a change through outside the box, or gets in your way when you didn't expect it.

---

## 14o. Biomes

(This is in the release after 0.1.5.) The painted style no longer makes all land look like grass.

1. Open a world map in the painted style and look at the whole map. **Expect** the islands to differ with their climate: pale, grey-olive tundra on the cold northern land and high ground, dark blue-green conifer forest where it is cool, mid-green mixed woods in the middle, brighter, richer warm forest in the south, and golden steppe or savanna in the dry patches. The change from one to the next should be gradual, with no hard lines.
2. Zoom in on each kind. **Expect** texture, not flat colour: small dark conifer crowns, mottled leafy woods with a few lighter meadows, golden grass with scattered dark trees, streaky straw-coloured steppe.
3. Ask Claude (with an area selected) *"what is the ground here?"*. **Expect** it to say the biome (`get_selection` reports it) along with the temperature and moisture.
4. Look at the high ground. **Expect** the forest to thin out and stop at about 700 m, with short mountain meadow (and bare rock where it is steep) above it. Look along the bigger rivers on low flat ground: **expect** darker, wetter ground with reeds and pools, wider on the flats.
5. Select a whole island and ask Claude *"what is the ground like here?"*: **expect** a breakdown such as "temperate forest 60%, alpine meadow 20%, marsh 10%".
6. Look for the finer ground: a thin pale beach on gentle low coast, a yellow-green reed fringe round lakes (and wet ground behind it), blue-white glacier with crevasses on the highest coldest peaks, patches of purple-brown heather moor in the cool uplands, grey-olive scrub on warm, moderately dry ground, and layered terracotta and cream bands in dry rugged country. Where a warm, wet, low coast meets the sea, expect dark mangrove with channels.
7. Wet forests: on a wet cool coast **expect** deep emerald rainforest with pale mist in the hollows; on warm wet mountainsides a blue-green, mist-banked cloud forest; bright yellow-green bamboo stands in warm lowland woods; and stands of gold, orange and red among the cooler mixed woods.
8. Volcanic ground: select a climate region (Region tool, C, draw an area) and tick **Volcanic ground**, or ask Claude for a volcanic region on a part of the map you describe. **Expect** pale ash plains with cinder-brown patches and near-black basalt, blending into the land at a soft border, and lava flows: tongues that start at the summits and upper slopes and run *downhill* (longer down steep flanks, short across flat ground), narrow at the vent and broader towards a blunt front, sometimes forking. About a third glow (a dark crust over orange, a bright core, a reddish scorch beside them); the rest are cooled black basalt. They stay inside the volcanic ground and may bury a river they cross. Zoom in and out: they must not shift or flicker, and a repaint after sculpting the mountain should move the flows with the new slopes. Rivers elsewhere in it keep grey banks.
9. Open **Ground legend** in the left sidebar (painted style). **Expect** every kind of ground grouped with a colour swatch and where it appears.
10. Names and markers: zoom all the way in on a town. **Expect** the name and the marker to stay a sensible size (a little bigger than at full view, never huge), and the **Label size** slider in the left sidebar (Layers) to make every name and marker smaller or larger, remembered next time. The phone page (/view) behaves the same way.
11. In the Claude Code terminal ask *"What grounds does the map have, and how would I make a tundra island?"*. **Expect** it to call `list_grounds` (or know the list already) and answer with the same grounds as the Ground legend, with a recipe such as a region with a low temperature (about 0.08) for tundra. (Before this was added, the terminal knew nothing about the legend.)
12. Tell me which islands look wrong for the weather and flow of this world, and which looks you want next.

### Access key and the itch copy (release after 0.1.7)

(The Windows app now protects its own server with a key, lists the open-source licences it ships, and every CI run makes an itch.io copy.)

1. Start Dragon Drop as usual. **Expect** everything to work exactly as before: the editor, the Claude Code panel and its map tools, and the Assist status. After you restart the app, Claude Code (new session) must still connect (`/mcp` shows `mapmaker` connected).
2. In a normal browser open `http://localhost:4747/` (the port in Settings) while the app is running. **Expect** the page to load but stay disconnected, and the address `http://localhost:4747/api/health` to say *Unauthorized*. The Windows app's own window has the key, so nothing is wrong with it.
3. Settings → Claude Code and Remote Control: **Expect** the one-line command to show *(your access key)* in place of the key, and **Copy** to put the full command on the clipboard; pasting it in PowerShell connects Claude Code from your own terminal.
4. Help menu → **Open-source licences**. **Expect** a text file listing the packages with their licence texts.
5. From a CI run's artifacts, download **Dragon-Drop-itch-windows**, unzip it and start `Dragon Drop.exe`. **Expect** it to work, and Settings → Updates to say that the itch app updates this copy (no "Check now").

### Place icons (release after 0.1.7)

1. Choose the **Place** tool. **Expect** a grid of small pictures under "New place", in groups (Settlements, Strongholds, Faith and magic, Wild places, Travel and trade, Land, Work, Events and dangers, General), with the chosen one outlined in gold and its name beside "New place". Hover one for its name and a short description.
2. Pick a castle, click the map, name it. **Expect** a small castle picture with its name beside it, on forest, sand and sea alike (white outline), and "Castle" in the Places list.
3. Select a place, open **Type** in the inspector and choose another kind. **Expect** the picture to change at once, and the history to say "Make <name> a <kind>"; Undo puts it back.
4. Zoom right in and right out. **Expect** the pictures to stay sharp, neither huge nor unreadable, and the **Label size** slider to scale them with the names.
5. Ask Claude *"put a lighthouse and a ruined temple on the north cape"* (give it names). **Expect** it to use the matching kinds. Old maps look as they did (circles, the fort square, the ruin cross).
6. The phone page and an exported PNG show the same pictures.

---

## 14p. Map safety: automatic backups and file versions

(This is in the release after 0.1.8.) Your maps are now protected in three ways; see [MAP-FILES.md](MAP-FILES.md).

1. Open a map, make a change (a brush stroke is enough) and wait a few seconds. **Expect** a new entry called **Auto 2026-…** (today's date and time on your PC) in the **Checkpoints** list in the left panel. Hover over it: "Saved automatically".
2. Make a different change, click **Restore** on that Auto entry and confirm. **Expect** the map to go back to how it was when the backup was taken, and **Undo** to bring your change back. (Another Auto entry won't appear for 15 minutes: that is on purpose.)
3. Save a checkpoint of your own called `Mine`. Keep editing for a while (30 minutes or more if you can). **Expect** at most six **Auto** entries, the oldest dropping off, and `Mine` still there.
4. Close Dragon Drop. In the map's folder (`projects\<map>\project.json`) **expect** `"formatVersion": 1` near the top.
5. **A newer file format** (optional): close Dragon Drop, open a copy of a map's `project.json` in Notepad, change `"formatVersion": 1` to `"formatVersion": 7`, save, and open the map. **Expect** a message that it was saved by a newer version and that you should update, and the map **not** opening. Put the number back to 1 afterwards.

Tell me if an Auto backup never appears, if the list fills up with them, or if Restore didn't put the map back.

## 14q. Controls and shortcuts

(This is in the release after 0.1.8.) The keys other map programs use now work too; see [CONTROLS.md](CONTROLS.md).

1. Open a world map and click on the page background (not in a text box). Press **+** a few times, then **-**: **Expect** the map to zoom in and out about the middle of the window. Press **0** (or **Ctrl+0**): **Expect** the whole map to fit again. Press the **arrow keys**: **Expect** the view to move (hold **Shift** for bigger steps).
2. Make a change, then press **Ctrl+S**. **Expect** a "Saved" note at the bottom for a couple of seconds, and no browser "save page" box if you are in a browser.
3. Press **?** (or click the **?** button in the top bar). **Expect** a list of the keys, with the tool letters for the kind of map you have open. **Esc** closes it.
4. Open a battlemap and try **+**, **-**, **0** and the arrow keys again, and press **?**: the list should now show the battlemap tools and the **Q**, **E**, **X** and **Alt** keys for objects.
5. In the installed app, click in the Claude terminal and type a **+**, a **-** and **0**, and press an arrow key: **Expect** them to go to the terminal and the map not to move.

6. Copy and paste: on a world map select a place (click it in the Places list), press **Ctrl+D**. **Expect** a new place called "<name> (copy)" a little along from it, selected. Press **Delete** to remove it. Press **Ctrl+C**, move the pointer over the map and press **Ctrl+V**: **Expect** a copy under the pointer. Paste again without moving the pointer: **Expect** the next copy a little to one side, not exactly on top.
7. In a battlemap select an object or a light, then **Ctrl+D**, **Ctrl+C** and **Ctrl+V**: **Expect** copies, each one undo step ("Duplicate 1 item", "Paste 1 item"). A wall you copy comes in as an ordinary wall.

8. Select several: in a battlemap with the Select tool, drag a box round a few objects and lights on bare floor. **Expect** a box that follows the pointer, a "N things selected" panel on the left that says what they are, and gold outlines on each. Drag one of them: **Expect** all of them to move, snapping as they would one at a time (hold **Alt** to move anywhere), as one undo step ("Move N items"). Press **Delete**: all are removed in one step. **Shift**-click adds one, or takes one out. Click bare ground: nothing is selected.
9. Same on a world map: with the Select tool, **Shift**-drag a box round several places and labels. **Expect** a note at the bottom-left ("N places and labels selected"), then drag one to move them all and **Delete** to remove them. A plain drag on bare ground still moves the view.

10. Arrow keys: select a place (or, in a battlemap, an object or a light) and tap an **arrow key** a few times quickly. **Expect** it to move a little each time and to be one undo step ("Nudge ..."). Hold **Shift** for bigger steps. Press **Esc** to clear the selection: the arrow keys now move the view.

11. Snapping: in a battlemap drag an object a very small way (less than a quarter square): **Expect** it to snap back. Start the drag, then hold **Shift** (or **Alt**) and drag the same small way: **Expect** it to land exactly where you let go.

Tell me about any key you expected to work and didn't, and any that did something you didn't expect.

## 15. What's not built yet (so you don't report it as a bug)

- Scatter on battlemaps, wall, path, portal and roof graphics from asset packs (only floors and objects work), what a hole does to a token in Foundry (the stairs, ladders and holes themselves work: 14g3). The Universal VTT and Foundry exports exist but are untested (above).
- GPU erosion; automatic label placement for sea/region names (place names do place themselves).

---

## Troubleshooting

| Problem | Try |
|---|---|
| `pnpm start` says port 4747 is in use | The app is already running in another window, or set `MAPMAKER_PORT=4800` in `.env` and change the port in `.mcp.json` |
| Painted look never appears | `F12`, Console tab, copy the red text; check the PowerShell window for errors |
| "…is 1024x1024 but project.json says 2048x2048" | Rename that map's `map` folder (under `projects\`) to `map-old` and restart |
| Chat says no API key / key rejected | `.env` needs `ANTHROPIC_API_KEY=...` with no spaces or quotes; restart the app. Check billing in the Anthropic Console |
| Claude Code can't see the map tools | The app must be running before you start `claude`; run `/mcp` and approve the server |
| Detail map seems stuck | Wait up to a minute at 2048 px; if nothing happens, check the PowerShell window for an error |
| Everything is slow | Close other heavy programs; note your CPU in the report |

## Report template

```
PC: (CPU, RAM, Windows version)   Browser:
Commit: (run `git log -1 --oneline`)

1  Start + automated checks:  Pass / Fail / Skipped   notes:
2  First load and speed:      seconds to painted look =    notes:
3  First Map check:           Pass / Fail   anything that looks wrong:
4  Moving around:             Pass / Fail
5  Terrain tools + undo:      Pass / Fail   smoothness:
6  Places and labels:         Pass / Fail
7  Climate + regions:         Pass / Fail
8  Detail maps:               Pass / Fail   time to make =
9  Export / viewer / saving:  Pass / Fail
10 In-app chat:               Pass / Fail   cost shown =    answer time =
11 Claude Code (MCP):         Pass / Fail / Skipped
12 Remote Control:            Pass / Fail / Skipped
13 Phone over Tailscale:      Pass / Fail / Skipped
14 Roads and borders:         Pass / Fail   (did the route look sensible?)
14b Terrain from a drawing:   Pass / Fail   (how well did it read the sketch?)
Other things I noticed (including things that felt clunky):
```
