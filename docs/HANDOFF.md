# Handoff for a fresh session (written 2026-11-19)

Read `CLAUDE.md` first (the project's own instructions), then this page. Everything below is already pushed to `main` of `DJ-JackJack/dragon-drop`.

## Where things stand

- **v0.1.9 is released** (2026-11-20, tag on `898aa34`, release notes written by hand; a feature list page was made for the person). A version tag builds the installer and publishes a public GitHub Release that every installed copy updates to by itself, so **ask the person before tagging** the next one (the steps are in `docs/RELEASING.md`).
  - CI-built installers are numbered 0.1.0 (only a tag sets the version), so installing one makes the in-app updater fetch v0.1.8. To test a CI build use the itch copy (artifact `Dragon-Drop-itch-windows`), which has the updater off.
- **RT9 is done and passed** (`docs/foundry-test-kit/results/v14.367/RESULTS-RETEST-6.md`): a real Dragon Drop roof export behaves in Foundry as RT8 predicted. It found two small defects, both fixed (tile centres on whole pixels; no eave
  shadow in the exported roof pictures). The fixed export has not been looked at in Foundry again, but both changes only move values RT8 already proved (whole-number centres) or remove pixels (the shadow).
  **A player's (non-GM) view of a roof has not been seen**: someone needs to log in as a player who owns a token and move it under a roof.

## What was built this stretch

**After v0.1.9: reference pictures and the trace picture.** Part 1: adding pictures without the chat (the References panel's Add picture button, a picture dropped anywhere or pasted on the map), refusals with a note that says what to do (HEIC, GIF, SVG, PDF, too big), rename, remove (to `backups/removed-pictures`), a full-size viewer, "Ask Claude…" on a picture. Part 2: the trace picture, a reference laid over the map (or battlemap level) to redraw a found map: Move, Pin 2 points, Match grid, Fit, Lock, `U`, and Claude's `get_trace_picture` / `set_trace_picture` / `clear_trace_picture` and `trace: true` on the previews. See the two bullets in `CLAUDE.md`. Playwright is now a dev dependency, and `pnpm e2e` passes on the person's PC with the new steps (after `pnpm exec playwright install chromium`). **Not tried:** a real Ctrl+V of a picture copied in another program (the e2e and the browser pane can only send a simulated paste), "Ask Claude…" in the desktop app, and Claude really tracing a map from a picture.

Before v0.1.9: WebP decoder (libwebp 1.6.0 as WebAssembly, `tools/webp-wasm/`); roofs as Foundry tiles with ceiling regions (from RT6 to RT8, see `docs/FOUNDRY.md`); a server fix so a client attaching while the projects folder can't be read no longer leaves an unhandled rejection; the note about too many lakes on new maps.

## Still open

- **Too many lakes on new island and continent maps** (measured: about 19% of the land is lake on a continent): in `docs/PLAN.md`, Water model. The real fix is to drain the generated terrain.
- **The Help menu (Open-source licences) can't be reached on Windows**: the window has a custom title bar and Alt does nothing. Add a button in Settings.
- **City maps** (decided 2026-11-20 after a first attempt at a big city map failed): a third kind of map made of buildings, streets, walls and water, with a picture reader to come. Plan, stages and the reader spike's findings are in `docs/CITY-MAPS.md` and `spikes/city-reader/`. **Stage 1 (the city map kind, buildings, streets, ground, Claude's tools) is done and tried in the browser and by the end-to-end test**, with **roof pictures first** (buildings use roof textures from the asset packs and are drawn from their look only when the packs have none; rules in core `roofAssets.ts`, notes in `docs/CITY-MAPS.md`). Next is stage 2, the picture reader: lay the picture over the city (the trace picture already works there), the DM draws the area to read and clicks one example of each kind of roof, the street and the water, a preview shows what was found, accept, and the buildings appear. `spikes/city-reader/read.ts` shows what worked (red and grey roofs) and what didn't (yellow roofs on parchment: use contrast with the ground). Not tried: the desktop app with a city, Claude building a whole town from a description, whole-roof objects as buildings.
- **Screen layout redone** (2026-11-20, to be closer to other map programs): tool rail on the left, tool bar under the top bar, a right-hand Map panel (Map, History, Assets tabs) and the Claude panel, both hidable from the top bar and on by default. Done: rail, tool bar, Map panel, hiding. Not done: a bottom bar (save status, grid, zoom, Fit), an icons-only rail option, Layers as eye-toggle rows, an Objects list for cities and battlemaps. Details in `CLAUDE.md` (Screen layout) and `docs/CONTROLS.md`.
- **Timing-sensitive test:** `apps/server/test/autobackup.test.ts` ("keeps the newest few") failed once in a full `pnpm test` run and passed alone and in the next full run.
- **Flaky end-to-end step:** the Hole step after Page Up (`apps/editor/e2e/smoke.mjs`) timed out once in two runs.
- **Foundry not tried:** a player's (non-GM) view of a roof; a token above a ceiling (Foundry holds a token a token-height below it); what a hole does to a token.
- **The old repository name is a public signpost** (2026-11-20): the private old repo was renamed `AI-Mapmaker-Build-archive`, and `DJ-JackJack/AI-Mapmaker-Build` is now a new public repository with one README commit and one release (v0.1.9, the same files as `dragon-drop`'s). It exists only so copies older than 0.1.8, whose updater looks at that name, still get an update (then they look at `dragon-drop`). **Never push anything to it** (the old history holds the person's map); the old checkout in Documents has its `origin` pointed at the archive. It needs no more releases.
- **The person's own to do:** the Dependabot PR #1, the repository security settings.

## Foundry facts that cost rounds (all in `docs/FOUNDRY.md`)

- Foundry **migrates** a scene older than the running build (ours says 14.353): write old and new field forms where a migration rebuilds one from the other (a tile's `occlusion.mode` and `modes`). **Foundry's export shows the migrated form, not what to write.**
- A tile's `x` and `y` are its picture's anchor, which defaults to the centre.
- A level's foreground never fades; a Surface tile with a ceiling region does, to the region's shape, while a token the player controls is under it.

## Working with this person

- They are a DM, not a programmer: explain plainly, one step at a time, with what to expect and what to send back.
- They are watching cost: avoid wasted rounds, check a file against the known quirks before sending it to the Foundry instance, and keep replies short.
- Pushing to `main` is allowed (remote `dragon`, `git push dragon work:main` in the old checkout). Anything outward-facing (a tag, a release, making things public) needs a yes first.
- Never invent lore, and keep the person's maps out of the repo (`projects/` is gitignored).
