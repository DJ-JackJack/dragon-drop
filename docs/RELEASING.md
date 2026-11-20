# Publishing a version

A version tag (`v0.1.10`) is what publishes: the build workflow (`.github/workflows/desktop.yml`) builds the Windows installer with the tag as the app version, smoke-tests the unpacked and the installed app, and publishes a public GitHub Release holding the installer, its `.blockmap` and `latest.yml`. Every installed copy reads that `latest.yml` and offers the update by itself. **A tag is outward-facing: ask the person before making one.**

## Before the tag

1. `main` is pushed and its last run of the workflow ("Checks and Windows installer") is green: `gh run list --repo DJ-JackJack/dragon-drop --limit 3`.
2. Locally: `pnpm typecheck`, `pnpm test`, `pnpm build` then `pnpm e2e` pass. (`pnpm e2e` has failed once in about five runs without a code change; run it again before believing a failure.)
3. Try the build the way a person would. Every CI run uploads **Dragon-Drop-itch-windows** (the unpacked program with its updater switched off): `gh run download <run-id> --repo DJ-JackJack/dragon-drop -n Dragon-Drop-itch-windows`, unzip, run `Dragon Drop.exe` with the installed app closed (both use the same settings and the same single-instance lock). Look at: a world map, a battlemap and a city map; hide and show the Claude panel while Claude Code is running; paste a picture copied in another program with `Ctrl+V`; drag the window narrower. CI-built copies say 0.1.0, which is normal (only a tag sets the version).
4. Write the release notes in the style of the last release (`gh release view v0.1.9 --repo DJ-JackJack/dragon-drop --json body --jq .body`): what is new in the words a DM would use, then Fixes and Known issues. Have the person read them.

## The tag

```bash
git tag -a v0.1.10 -m "Dragon Drop 0.1.10" && git push origin v0.1.10
```

Then wait for the workflow run of the tag to finish (about four minutes). The Release it creates has generated notes; replace them with the written ones:

```bash
gh release edit v0.1.10 --repo DJ-JackJack/dragon-drop --notes-file <notes.md>
```

## After the tag

- The Release lists three files (`Dragon-Drop-Setup-<version>.exe`, its `.blockmap`, `latest.yml`) and is not a draft or a pre-release. `latest.yml` names the same version and the installer's size and hash: `gh release download v0.1.10 --repo DJ-JackJack/dragon-drop --pattern latest.yml --output -`.
- Open the installed Dragon Drop, Settings, check for updates: it offers the new version, downloads it and restarts into it.
- Copies older than 0.1.8 look at the old repository's name, which is now a public signpost (see `docs/SELLING.md`): it only needs a new release if a version older than 0.1.8 would otherwise be stuck, which it is not (0.1.9 already points at `dragon-drop`). Don't push anything to it.
- The itch.io copy (`docs/ITCH.md`) is separate and is the person's to upload.
