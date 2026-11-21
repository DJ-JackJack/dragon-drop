# The working checklist

The list the person and Claude work through, in rough order. Tick an item when it is done (with the date), add new ones where they belong, and keep it short: details live in the
documents each item points to. Started 2026-11-21 from the handoff notes, the roadmap (`PLAN.md`), the city plan (`CITY-MAPS.md`) and the selling checklist (`SELLING.md`).

## Next release (0.1.11)

Built and on `main`, not yet tried by the person or released: city land, climate and trees; bridges; Claude's city planning tools; City here (a city from a world map);
hiding labels and markers; deleting maps; the startup fix; School and Whirlpool place kinds; the quick fixes and drained new maps below (the last three committed, not pushed).

- [ ] ~~Quick fixes and the lake problem~~ (done 2026-11-21), then a test copy with its own settings and maps folder (`RELEASING.md`), release notes, and the release.

## Quick fixes

- [x] The open-source licences can't be reached on Windows (the Help menu is hidden by the custom title bar): a button in Settings. *(2026-11-21: Settings → Licences)*
- [x] An empty strip under the top bar when the tool in use has no settings. *(2026-11-21: the tool is named there)*
- [x] Cramped headings in the battlemap's Map tab ("Light level", "Layers" sit right under the text above). *(2026-11-21)*
- [x] A test that fails now and then: `apps/server/test/autobackup.test.ts` ("keeps the newest few"). *(2026-11-21: it waited at most 5 s for a backup; now up to 30 s)*

## Bigger work

- [x] **Too many lakes on new maps** (a new continent or island is about 20% lake): drain the generated land so water runs to the sea, and a "how many lakes" setting for new maps (`PLAN.md`, Water model). *(2026-11-21: a mountainous continent 19% lake before, 1.3% now; Lakes: none, few, some, many)*
- [x] **City picture reader** (city stage 2): read a city picture's buildings onto a city map, the DM clicking one example of each kind of roof (`CITY-MAPS.md`, `spikes/city-reader/`). *(done 2026-11-21: the trace bar's Read buildings… on a city map, and Claude's `read_picture_buildings`; still to try on the DM's own city pictures)*
- [ ] **More for cities**: walls with towers and gates; names and labels; picture export and the phone page; copy and paste; a battlemap from a spot in the city with a Foundry export (`CITY-MAPS.md` stages 3 to 5).
- [ ] **Screen leftovers**: a bottom bar (save status, grid, zoom, Fit); Layers as eye-icon switches; an icons-only tool rail; an Objects list for cities and battlemaps.
- [ ] **Water, later stages**: rivers and lakes as named, selectable things with a River tool; valleys carved by rivers; meanders, oxbows and deltas (`PLAN.md`, Water model).
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
