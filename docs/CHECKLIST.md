# The working checklist

The list the person and Claude work through, in rough order. Tick an item when it is done (with the date), add new ones where they belong, and keep it short: details live in the
documents each item points to. Started 2026-11-21 from the handoff notes, the roadmap (`PLAN.md`), the city plan (`CITY-MAPS.md`) and the selling checklist (`SELLING.md`).

## Release 0.1.11 (released 2026-11-21)

City land, climate and trees; bridges; Claude's city planning tools; City here (a city from a world map); hiding labels and markers; deleting maps; the startup fix; School and
Whirlpool place kinds; the quick fixes and drained new maps below; the city picture reader; city walls, names, export, phone page, copy and paste and battlemaps from a city;
water gates, districts and streets and water from a picture; the bottom bar, eye switches, pictures-only rail and Objects list; named rivers and lakes, carved valleys and lowland
rivers; drawn rivers and carving part of the map; Muse Code.

- [x] Quick fixes and the lake problem, a test copy with its own settings and maps folder (`RELEASING.md`), release notes, the person's try of it (rounds 1 to 3 good, with the Rivers tool and carving changed after round 1), and the release. *(2026-11-21: https://github.com/DJ-JackJack/dragon-drop/releases/tag/v0.1.11)*
- [ ] The person: update the installed Dragon Drop (Settings → Updates → Check now) and check it reads 0.1.11; then the Desktop test build folders can be deleted.

## Next release (0.1.12)

On `main` already: Settings says what each AI assistant needs (and whether it is paid for separately); 30 shops and trades as kinds of place (asked 2026-11-21: market, general store, tavern, blacksmith, weaponsmith, armorer, bowyer, jeweler, alchemist, apothecary, magic shop, bookshop, cartographer, bakery, butcher, fishmonger, brewery, tailor, cobbler, carpenter, potter, chandler, tinker, stables, shipwright, trading post, bank, pawnshop, guildhall, gambling den), each with its own picture.

- [x] **Maps that know about each other** (asked 2026-11-21; built 2026-11-21: Duplicate this map… and Compare with… (Fade, Swipe, Side by side) in the Map panel; Claude's `duplicate_map`, `compare_maps`, `where_on_map`, and `map` on every look-only tool; still to try with the DM's own maps). (1) **Copy a map** to make a changed version of it (a farmhouse before and after a fire, a town before and after a siege): everything is copied (land or floors, every level of a battlemap, features, the brief, reference pictures; not checkpoints or history), the copy remembers its original and links back to it; a Map panel button for the DM and a tool for Claude. (2) **Look at another map without switching to it**: Claude's look-only tools (previews, summaries, point queries, lists, the water's account) take another map's name, read it in the background and leave the open map and the editor alone; edits stay on the open map. (3) **Compare two maps**: a side-by-side picture of the same area and a list of the differences in words (land, coast, rivers and lakes, places, labels and roads; walls, doors, floors, lights and objects on battlemaps; buildings and streets in cities), and distances and positions across maps that are linked (a detail map and its world map, a battlemap or city made from a spot). The DM chose to have a compare view in the editor too.
- [x] **Rebuild and mending tools**, from the report of the failed rebuild of the DM's world map (2026-11-21): copy land and settings from another map, put back an area from a checkpoint, drain one lake, erode an area keeping peaks, ranges that change along their length with spurs, landmasses with hills and rings, everything readable back, relief previews, land-and-sea overlays with a coast-match score, a short water report, and guidance to start from the map itself. *(2026-11-21)*
- [x] **Claude's own try of 0.1.12 on copies of the DM's maps** (2026-11-21, asked before the DM's own try): the copy-and-mend prompt's phases 1 to 3 on the world map (read without opening it, a copy that matched exactly, two lakes drained, erosion held to an area, an area put back from a checkpoint), the detail map seen through the copy, and a battlemap before and after a fire. Fixed from it: a copied battlemap's upper levels kept the original's name (and lost the before-and-after reading), comparing an upper level compared it with the other map's first level (Claude's and the DM's compare view), comparing a world map with its detail map showed the whole world map, relief pictures had no lakes, and two smaller things (a relief preview said "painted style"; a copy's brief note was dated in UTC). Results in the Desktop test build folder.
- [x] **A wider smoothing brush** (found 2026-11-21 on the DM's world map): straight steps in the land tens of pixels wide (from old flat landmasses) can't be softened with `sculpt smooth` or `erode`; Claude and the DM need a smoothing that reaches across a wide step. *(2026-11-22, on `selling-prep`: the Smooth brush's **Reach** (up to 128 px) and Claude's `sculpt` smooth `reach_px`; a 300 m step that plain smoothing leaves at 63 m a pixel becomes a slope of 7 m a pixel with a reach of 30 (a brush stroke takes about 16 ms, the whole 2048 map at the widest reach about 0.2 s); the coast stays put unless `keep_coast` is false. Still to try on the DM's south-west island.)*
- [ ] ~~A test copy with its own settings and maps folder, a START HERE guide and draft notes~~ (2026-11-21: `Desktop\Dragon Drop 0.1.12 test build`, with the shops and the rebuild and mending tools, and a copy-based prompt for remaking the DM's world map; its start-up check and the whole browser test pass against it), the person's try of it, and the release.

## Quick fixes

- [x] The open-source licences can't be reached on Windows (the Help menu is hidden by the custom title bar): a button in Settings. *(2026-11-21: Settings → Licences)*
- [x] An empty strip under the top bar when the tool in use has no settings. *(2026-11-21: the tool is named there)*
- [x] Cramped headings in the battlemap's Map tab ("Light level", "Layers" sit right under the text above). *(2026-11-21)*
- [x] A test that fails now and then: `apps/server/test/autobackup.test.ts` ("keeps the newest few"). *(2026-11-21: it waited at most 5 s for a backup; now up to 30 s)*

## Bigger work

- [x] **Too many lakes on new maps** (a new continent or island is about 20% lake): drain the generated land so water runs to the sea, and a "how many lakes" setting for new maps (`PLAN.md`, Water model). *(2026-11-21: a mountainous continent 19% lake before, 1.3% now; Lakes: none, few, some, many)*
- [x] **City picture reader** (city stage 2): read a city picture's buildings onto a city map, the DM clicking one example of each kind of roof (`CITY-MAPS.md`). *(done 2026-11-21: the trace bar's Read buildings… on a city map, and Claude's `read_picture_buildings`; still to try on the DM's own city pictures)*
- [x] **More for cities**: walls with towers and gates; names and labels; picture export and the phone page; copy and paste; a battlemap from a spot in the city with a Foundry export (`CITY-MAPS.md` stages 3 to 5). *(2026-11-21: the Wall tool `W`, the Name tool `N`, Export, the phone page, Ctrl+C/V/D, Battlemap here `M`, and Claude's tools for each; then water gates, districts `D`, and streets and water from a picture; still to come: parks and gardens from a picture, and trying the reader on the DM's own city pictures)*
- [x] **Battlemaps from city maps the way the world map makes them** (asked 2026-11-21): the city's Battlemap here (`M`) takes a click for a 30 x 20 square battlemap round the spot, as the world map's does, besides a dragged box; Claude's `create_battlemap_from_city` takes a spot and a size in squares too. *(2026-11-21)*
- [x] **Screen leftovers**: a bottom bar (save status, grid, zoom, Fit); Layers as eye-icon switches; an icons-only tool rail; an Objects list for cities and battlemaps. *(2026-11-21: the bottom bar under every map, eyes on the Layers, the rail's « / » switch, the Objects tab on battlemaps and cities)*
- [x] **Water, later stages**: rivers and lakes as named, selectable things with a River tool; valleys carved by rivers; meanders, oxbows and deltas (`PLAN.md`, Water model). *(2026-11-21: the Rivers tool `I` names, selects and starts rivers; names drawn along the rivers and in lakes, on the map, the phone page and exports; Carve valleys… with floodplains and deltas, a checkpoint first; Lowland rivers with wide loops, oxbow lakes and estuaries; Claude's `name_water`, `list_waters`, `remove_water_name`, `carve_valleys`; still to try on the DM's own map)*
- [ ] **Foundry, not tried**: a player's (not the GM's) view of a roof; a token above a ceiling; what a hole does to a token. Needs someone logged in to Foundry as a player (`FOUNDRY.md`).

## Fixes from the adversarial review (2026-11-22)

Found by Claude going through the app as an attacker and a clumsy user would. Most were proven on a throwaway server; the ones marked *(read)* were found by reading the code.
In order of harm. *(All fixed 2026-11-22 on `selling-prep`, each with a test; `SECURITY-REVIEW.md` has the security ones.)*

- [x] **The checkpoint list can be wiped.** If `map/checkpoints/index.json` is ever damaged (a power cut mid-save), the next checkpoint, and so the next automatic backup, writes a new list with only itself: every earlier checkpoint drops off the list (the files stay on disk, unlisted). Set a damaged list aside and rebuild it from the files, as `features.json` is.
- [x] **An edit made while the AI opens another map is lost.** The DM's edits don't say which map they are for: one that arrives while the AI opens or creates a map (City here, Battlemap here...) goes to the old map after its last save, and is never saved. Edits should carry the map's id, and the switch should save last.
- [x] **The AI's Undo ignores the lock and the Allow box.** `undo` takes back up to 20 of the newest changes, the DM's own included, outside a locked area too; any edit after it clears Redo, so that work is then gone from history. Hold the AI's undo to its own changes (or ask first), and respect the lock.
- [x] *(read)* **A file that can't be read just now is treated as damaged**: an offline OneDrive file, say. The places and labels are set aside and the map opens without them. Only a file that reads but isn't valid JSON should count as damaged; a read error should fail the opening and try again.
- [x] *(read)* **Saves aren't flushed to the disk** before the rename (`atomicWrite`), so a power cut can leave an empty file in place of the map's (worst with the checkpoint list above).
- [x] **The window's address goes to IPv6 first.** The window opens `http://localhost:<port>/?t=<key>`, and Electron tries `[::1]` before `127.0.0.1`: another program or Windows user listening on `[::1]` at that port is sent the access key, and its page counts as the editor (the bridge, the terminal). Use `127.0.0.1` in the window, its address checks and `fromEditor`.
- [x] **A big picture in a small file.** A 137 KB PNG that claims to be 12,000 pixels square is taken as a reference; reading it froze the server for a second and took 828 MB, and a bigger one would crash it. Refuse pictures over a pixel count (asset packs already are), and decode references off the server's main thread.
- [x] *(read)* **The build can be taken over by a bad dependency.** The installer job has write access on every push to `main`, and the checkout keeps the token for later steps, so a compromised package could publish a release that every copy updates to. Give write access only to a separate publish job for version tags, and `persist-credentials: false`.
- [x] **Files in a map's `refs` or `previews` folder are served as web pages**: an `.html` or `.svg` put there (in a map someone shares) is sent as a page, with no security policy. Serve only PNG, JPEG and WebP from there, and correct `SECURITY-REVIEW.md`, which says the opposite.
- [x] *(read)* **The access key never changes.** The phone link holds it, the phone keeps it for a year, and nothing can change it. A "new access key" button in Settings.
- [x] *(read)* **The in-app chat's history never shrinks**: every preview picture stays in `chat.json` and in every request, so a long chat gets slower and dearer, then fails until reset. Drop old pictures from the history and cap its size.
- [x] *(read)* **The PC's environment reaches the sold app's server**: `MAPMAKER_ASK_BEFORE_RISKY=0` turns off the Allow box, and `ANTHROPIC_BASE_URL` would send the chat elsewhere. Pass only what the app sets.
- [x] *(read)* Small ones: clicking a picture in the in-app chat opens the web browser, which says "Unauthorized"; the chat's no-key message tells a buyer to edit a `.env` file (Settings, in the app); `render.jpg?max=abc` makes a broken picture; the sold app still accepts the developer port 5173; renaming a named place, and draining a named lake given by position, don't ask; and an assistant with a shell has the key in its environment and could answer the Allow box itself (say so in `SECURITY-REVIEW.md`).

**Second pass** (2026-11-22, after the fixes; the first pass's attacks were tried again and all failed):

- [x] The DM's other map actions (restoring a checkpoint, drawing a river, carving, the selection, levels, pictures, the chat) didn't say which map they were for either: they now do, like the edits.
- [x] **The Allow box could act on the wrong map**: while the DM decided, the AI could open another map (a copy, with the same names in it), and the action then ran there. It is now refused if the map or level changed meanwhile, and the box says which map it is about.
- [x] Browsing a pack of big pictures for the first time decoded each one on the server's main thread (the map stuttered): thumbnails and asset pictures are made on the worker now.
- [x] A pack whose author wrote "no" as text (`"false"`, `"no"`) instead of `false` was used anyway: every way of writing no counts.
- [x] The asset library's Copy report showed the Windows user name (in the folder's path): the home folder is written as `~`.
- [x] Errors from the worker thread carried the program's file paths into messages for the person and the AI: only the message now (the details go to the log).
- [x] In the fixes themselves: a drive that can't flush (some network or cloud drives) would have failed every save (now best effort), and the chat's size limit counted the pictures' data (now left out of the count).
- [x] Settings says what the map tools key is (a line under the Claude Code command, tooltips on its Copy buttons); the setup guide and the FAQ say how to connect again after a new access key. (A "changed in 0.1.13" note was tried and trimmed: only the person and two friends had an earlier version, and an older connection keeps working anyway.) Found while doing it: the Settings dialog scrolled sideways (a dropdown's long choice widened its section) and cut off the start of every line; fixed. *(2026-11-22)*
- [x] Left at first, then fixed the same day (asked 2026-11-22): `RunAsNode` is off (the map server is an Electron utility process: R2); the installed app has no developer tools (R4); the assistant gets a map tools key of its own, which can't answer the Allow box (R8); floor textures and objects are made ready on the worker. Still left, because code can't fix them: unsigned updates until signing (R3, the person's signing account), and a prompt injection in a shared map leading the AI to *add* made-up names or notes (removing and renaming ask; every addition is the AI's in History and can be undone).

## Before selling

From `SELLING.md`, where each has its details. **Sorted by what it costs** (2026-11-22): the person sells alone and can't pay a lawyer, so where the
drafts say "a lawyer" or "an accountant", read "free help, if you can get it". Nothing in group 2 or 3 blocks selling.

### 1. Free (or a few dollars), and needed before selling

- [x] **Decide about Antigravity** *(2026-11-22: taken out. No Settings choice, no project file written, and the file earlier versions wrote, which held the access key, is cleaned of our entry. OpenCode's choice now warns not to connect a Claude or Google AI subscription.)*
- [ ] **The name.** Working title chosen 2026-11-22: **"Dragon Drop: The Busy GM's Cartographer"**. The first check is in `SELLING.md`: **two products are already called Dragon Drop** (a free tabletop map tool from 2020, and a party game on Steam and itch.io whose maker registered the name for T-shirts); no live US trademark for software or games. Still to do, free: the EU and UK check on TMview (tmdn.org/tmview, a few minutes in a browser). A proper search is in group 2.
- [ ] **The privacy policy** (`PRIVACY.md`, drafted from what the app really sends, in the usual sections): fill in your name, a contact address and how long purchase records are kept (as long as tax law asks; a free adviser can say how long), then approve it.
- [ ] **The licence agreement** (`EULA.md`): fill in your name, your state and the refund promise, then approve it. A plain agreement like this is what many small sellers use.
- [ ] **A contact email just for Dragon Drop**, for buyers and for privacy and security reports (free).
- [ ] **The itch.io account and page** (`STORE-PAGE.md`, laid out field by field; `ITCH.md` for payments): the "collected by itch.io" payment mode (itch.io then collects and pays VAT and handles chargebacks), the tax interview (a free EIN from the IRS keeps your Social Security number off the form), the price and whether there is a demo, butler logged in, the AI disclosure answers. Screenshots: four of five made (`store-screenshots/`); the fifth (the assistant mid-task, with the Allow box) in the installed program; the cover image once the name is settled; who made the app icon.
- [ ] **Paperwork where you live**: a trade-name certificate if you sell under a name that isn't your own, and a local business licence if your town or county asks for one (small fees; a free small-business adviser can say which).
- [ ] **Anthropic**: send the email (`ANTHROPIC-EMAIL.md`, with where to send it) and accept the Commercial Terms on the account that ships Dragon Drop (free).
- [ ] **Where buyers ask for help** once the repository is private (`GOING-PRIVATE.md`): a public help repository (free; `pnpm help-repo` makes its pages) or the itch.io page's community. Then the move release (only `MOVED_TO` in `main.cjs` and `HELP_REPO` in `helpLinks.ts` to fill in), deleting the old build files (they are kept 1 and 7 days now; deleting needs your yes) and going private.
- [ ] **GitHub** (free): two-factor sign-in on the account; private vulnerability reporting and Dependabot security updates switched on (checked 2026-11-22: still off; secret scanning and push protection are on).
- [ ] **Security reply times**: check that the promise in `SECURITY.md` (reply in 7 days, verdict in 14, a fix for a serious problem in 30) suits you.
- [ ] **Just before launch**: re-read Anthropic's legal page (it changes; read again 2026-11-22, no change), repeat the secret scan, and scan the final installer once on VirusTotal (not private test builds: uploads are shared with security companies).

### 2. Free help, if you can get it

- [ ] **A small-business adviser** (in the US, the free Small Business Development Centers and SCORE mentors): sole proprietor or company, local licences, taxes, how long to keep records, and how US sales tax works with itch.io (its docs don't say; the questions are in `ITCH.md`).
- [ ] **A law school trademark clinic** (the US Patent and Trademark Office's programme; students supervised by professors, free): a proper search of the name, and a registration if you want one later.
- [ ] **A volunteer lawyers' group for creative people**: a look at the licence agreement (its questions are at the end of `EULA.md`) and the privacy policy.
- [ ] **A second pair of eyes on the desktop side's security**: someone who does security reviews, starting from Claude's own review (`SECURITY-REVIEW.md`; it already switched off two ways of running other code inside the program, checked by every build).

### 3. Can wait until there are sales

- [ ] **Code signing** (`SIGNING.md`; from $9.99 a month through Microsoft for an individual in the US): until then buyers see "Windows protected your PC" once, which `FAQ.md` explains. The build is ready: it signs by itself once the account's details are added as secrets.
- [ ] **Registering the trademark** (the US filing fee is about $350 per class): optional; selling doesn't need it.
- [ ] **A company (an LLC)** instead of a sole proprietorship: worth asking about once there is real income.
- [ ] **Paid legal review** of the agreement and the policy.
- [ ] **GitHub Pro** (about $4 a month): branch and tag protection on the private repository, and more build minutes if the free ones run out.
- [ ] **Try local AI models** with `pnpm model-check --driver openai` (free, but needs a model downloaded, for example through Ollama).

### Done for selling

- [x] **The work Claude could do** (2026-11-21, on the branch `selling-prep`, so 0.1.12 goes out as tested): the AI asks the DM before risky actions, in code; a smaller tool set for smaller models; `pnpm model-check` and `MODELS.md`; the chosen assistant's name in the editor's words; the phone page off unless chosen in Settings; Open backups folder; `FAQ.md`, Settings → Help and issue forms; a test with unusual folder names; a new secret scan.
- [x] **The jobs that needed no decision** (2026-11-22): build files kept 1 and 7 days; the licence agreement and the privacy policy drafted; the store page laid out field by field; the AI companies' terms read (`AI-PROVIDERS.md`: OpenAI, Gemini with an API key, Meta, OpenCode and Ollama look fine; **Google's Antigravity terms forbid use with other companies' products**); the Anthropic email drafted; itch.io's payments and taxes summarised; the first name check; code signing researched and prepared; a security review (Electron fuses); "compatible with" wording checked (the Export dialog no longer names other virtual tabletops); the move release prepared; four store screenshots.
- [x] **Testing beyond this PC**, covered from it because the person has no other PCs (2026-11-21): files held by OneDrive or antivirus, Defender scans, a slow PC, a GitHub job on an older Windows (Server 2022), and the public 0.1.11 installer on VirusTotal (2026-11-22: 0 of 67 flagged it). Not tried: Windows 10 itself.
- [x] The Dependabot pull request #1 (2026-11-21: merged).

## Done

- 2026-11-21: School and Whirlpool place kinds (from a playtester).
- 2026-11-21: From the person's first try of 0.1.11: the Rivers tool opens on **Add a river** (a drag draws a river whose land is cut so the water follows it, a click starts one), and **Carve valleys** can be held to the selected area or the selected river.
- 2026-11-21: Muse Code (Meta) in Settings → AI assistant, the map tools connected through `.mcp.json` (tried with Muse Code 1.4.25 against a running Dragon Drop; the person then tried it in the 0.1.11 test copy's terminal with a Meta sign-in: it found the map tools and answered from them).
