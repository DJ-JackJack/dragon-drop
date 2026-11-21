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
- [ ] ~~A test copy with its own settings and maps folder, a START HERE guide and draft notes~~ (2026-11-21: `Desktop\Dragon Drop 0.1.12 test build`, with the shops; its start-up check and the whole browser test pass against it), the person's try of it, and the release.

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

## Before selling (mostly the person's decisions)

From `SELLING.md`, where each has its details:

- [ ] A licence for the code (the repository is public with no LICENSE file).
- [ ] A name and trademark search for "Dragon Drop".
- [ ] A short privacy policy.
- [ ] Code signing, so Windows stops warning buyers.
- [ ] Anthropic: email sales about the setup; accept the Commercial Terms for the shipping account.
- [ ] itch.io's AI disclosure, answered honestly.
- [ ] Other AI providers: which ones, where their keys live, their terms read; destructive actions confirmed in code; tools and instructions that suit smaller models; "AI assistant" wording where it isn't Claude.
- [ ] Testing on Windows 10 and 11, OneDrive-redirected Documents, odd paths, low-spec PCs, antivirus; an FAQ and a place to ask for help.
- [ ] Security: a second pair of eyes on the Electron side; a plan for vulnerability reports; keep Electron current.

## On GitHub (the person's)

- [ ] The Dependabot pull request #1 (merge after a release).
- [ ] Repository security settings: Dependabot alerts and security updates, private vulnerability reporting.
- [ ] Two-factor sign-in on the account; branch and tag protection when wanted (it would also stop Claude pushing).

## Done

- 2026-11-21: School and Whirlpool place kinds (from a playtester).
- 2026-11-21: From the person's first try of 0.1.11: the Rivers tool opens on **Add a river** (a drag draws a river whose land is cut so the water follows it, a click starts one), and **Carve valleys** can be held to the selected area or the selected river.
- 2026-11-21: Muse Code (Meta) in Settings → AI assistant, the map tools connected through `.mcp.json` (tried with Muse Code 1.4.25 against a running Dragon Drop; the person then tried it in the 0.1.11 test copy's terminal with a Meta sign-in: it found the map tools and answered from them).
