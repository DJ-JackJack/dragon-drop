# Handoff for a fresh session (written 2026-11-19)

Read `CLAUDE.md` first (the project's own instructions), then this page. Everything below is already pushed to `main` of `DJ-JackJack/dragon-drop`.

## Where things stand

- **v0.1.9 is not tagged yet.** The last release is v0.1.8 (the bridge from the old repo). A version tag builds the installer and publishes a public GitHub Release that every installed copy updates to by itself, so **ask the person before tagging**.
  - The default Claude Code path was checked on a real PC with the CI build of `15c8d89` (itch copy, no updater): new build, no approval question, `/mcp` shows mapmaker connected (101 tools), the workspace in Documents holds no `.mcp.json` or `mapmaker.mcp.json` (the key files are in `%APPDATA%\Dragon Drop`), a climate region was added and undone, the status dot went green then gold. It passed.
  - Recommendation given: wait for RT9, then tag the current `main`; if RT9 finds a problem, tag `a6bb20b` (the tested build) instead.
  - CI-built installers are numbered 0.1.0 (only a tag sets the version), so installing one makes the in-app updater fetch v0.1.8. To test a CI build use the itch copy (artifact `Dragon-Drop-itch-windows`), which has the updater off.
- **RT9 is running** in the separate Foundry test instance (prompt: `docs/foundry-test-kit/prompts/rt9-real-roof-export.md`, with `House-foundry.zip`, a real export; SHA-256 in the prompt). It checks that roofs written the new way (tile + ceiling region) fade in a real Foundry. Results will come back as `RESULTS-RETEST-6.md` plus a redacted export: record them in `docs/FOUNDRY.md` and `docs/foundry-test-kit/results/v14.367/`.

## What was built this stretch

WebP decoder (libwebp 1.6.0 as WebAssembly, `tools/webp-wasm/`); roofs as Foundry tiles with ceiling regions (from RT6 to RT8, see `docs/FOUNDRY.md`); a server fix so a client attaching while the projects folder can't be read no longer leaves an unhandled rejection; the note about too many lakes on new maps.

## Still open

- **RT9 result**, then the v0.1.9 decision above.
- **Too many lakes on new island and continent maps** (measured: about 19% of the land is lake on a continent): in `docs/PLAN.md`, Water model. The real fix is to drain the generated terrain.
- **The Help menu (Open-source licences) can't be reached on Windows**: the window has a custom title bar and Alt does nothing. Add a button in Settings.
- **Flaky end-to-end step:** the Hole step after Page Up (`apps/editor/e2e/smoke.mjs`) timed out once in two runs.
- **Foundry not tried:** a player's (non-GM) view of a roof; a token above a ceiling (Foundry holds a token a token-height below it); what a hole does to a token.
- **The person's own to do:** make the old `AI-Mapmaker-Build` repo private (settings; the tools here were read-only), the Dependabot PR #1, the repository security settings.

## Foundry facts that cost rounds (all in `docs/FOUNDRY.md`)

- Foundry **migrates** a scene older than the running build (ours says 14.353): write old and new field forms where a migration rebuilds one from the other (a tile's `occlusion.mode` and `modes`). **Foundry's export shows the migrated form, not what to write.**
- A tile's `x` and `y` are its picture's anchor, which defaults to the centre.
- A level's foreground never fades; a Surface tile with a ceiling region does, to the region's shape, while a token the player controls is under it.

## Working with this person

- They are a DM, not a programmer: explain plainly, one step at a time, with what to expect and what to send back.
- They are watching cost: avoid wasted rounds, check a file against the known quirks before sending it to the Foundry instance, and keep replies short.
- Pushing to `main` is allowed (remote `dragon`, `git push dragon work:main` in the old checkout). Anything outward-facing (a tag, a release, making things public) needs a yes first.
- Never invent lore, and keep the person's maps out of the repo (`projects/` is gitignored).
