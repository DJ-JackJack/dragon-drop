# Publishing a version

A version tag (`v0.1.10`) is what publishes: the build workflow (`.github/workflows/desktop.yml`) builds the Windows installer with the tag as the app version, smoke-tests the unpacked and the installed app, and publishes a public GitHub Release holding the installer, its `.blockmap` and `latest.yml`. Every installed copy reads that `latest.yml` and offers the update by itself. **A tag is outward-facing: ask the person before making one.**

## Before the tag

1. `main` is pushed and its last run of the workflow ("Checks and Windows installer") is green: `gh run list --repo DJ-JackJack/dragon-drop --limit 3`.
2. Locally: `pnpm typecheck`, `pnpm test`, `pnpm build` then `pnpm e2e` pass. (`pnpm e2e` has failed once in about five runs without a code change; run it again before believing a failure.)
3. Try the build the way a person would. Every CI run uploads **Dragon-Drop-itch-windows** (the unpacked program with its updater switched off): `gh run download <run-id> --repo DJ-JackJack/dragon-drop -n Dragon-Drop-itch-windows`, unzip, run `Dragon Drop.exe` with the installed app closed (both use the same settings and the same single-instance lock). Look at: a world map, a battlemap and a city map; hide and show the Claude panel while Claude Code is running; paste a picture copied in another program with `Ctrl+V`; drag the window narrower. CI-built copies say 0.1.0, which is normal (only a tag sets the version).
   Before handing a copy over, run the whole browser test against it: `E2E_APP="<the unpacked folder>" node apps/editor/e2e/smoke.mjs` starts that program's own server and editor (with the settings the desktop app gives them, through your Node: the exe itself can't be run as Node; a throwaway maps folder) instead of the source code. A copy can also be built locally with `npm ci` and `npm run dist:dir` in `apps/desktop` (it lands in `release\win-unpacked`); switch its updater off with `resources\channel.json` holding `{"channel":"itch"}`, or it would fetch the released version and install it over the person's installed program.
   **Give the test copy its own settings and maps folder.** Run without that, it uses the installed program's settings and maps, and whatever it saves in a newer file format (a city map, in 0.1.10's test) the installed, older program then refuses; before 0.1.11 that even stopped the older program at start, so it couldn't update itself (the person had to install the new version by hand). Put a `Test Dragon Drop.cmd` beside `Dragon Drop.exe` that sets `DRAGON_DROP_DATA=%~dp0test-data` and starts the program, and write `test-data\settings.json` with `{"projectsDir": "<the test copy>\\test-maps"}` (an existing, empty folder, or a copy of one map to try): the first-run question is then skipped and nothing of the person's is touched.
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

- The Release lists four files (`Dragon-Drop-Setup-<version>.exe`, its `.blockmap`, `latest.yml`, `SHA256SUMS.txt`) and is not a draft or a pre-release; put the hash from `SHA256SUMS.txt` at the end of the release notes. `latest.yml` names the same version and the installer's size and hash: `gh release download v0.1.10 --repo DJ-JackJack/dragon-drop --pattern latest.yml --output -`.
- Open the installed Dragon Drop, Settings, check for updates: it offers the new version, downloads it and restarts into it.
- Copies older than 0.1.8 look at the old repository's name, which is now a public signpost (see `docs/SELLING.md`): it only needs a new release if a version older than 0.1.8 would otherwise be stuck, which it is not (0.1.9 already points at `dragon-drop`). Don't push anything to it.
- The itch.io copy (`docs/ITCH.md`) is separate and is the person's to upload.

## A security report, and a security fix

`SECURITY.md` promises a reply within 7 days, a verdict within 14, and a new version within 30 days for a serious problem. The person answers
reports (GitHub sends them by email while private vulnerability reporting is on; after going private, to the address `SECURITY.md` gives then).
Claude can help with each step below, but answering, publishing and tagging stay the person's.

1. **Reply** within 7 days: thanks, it arrived, and what happens next. Don't confirm or deny details in public, and don't open a public issue.
2. **Reproduce it** on a test copy (its own settings and maps folder, as above), never on the person's own maps. Decide how serious it is: serious
   means someone other than the person could read or change their maps or files, run something on their PC, or get the access key or an API key.
3. **Fix it privately.** In the report's draft advisory on GitHub, use **Start a temporary private fork**, fix it there with a test that fails
   without the fix, and merge it from the advisory when it is ready. Without the advisory (after going private), fix it on a branch that is not
   pushed until the release.
4. **Release** it as an ordinary version (the steps above). The release notes say "A security fix" and what to do (update), without details.
   For something serious, also say it on the store page's news.
5. **About two weeks later**, publish the advisory (or a note in the next release) with the details, and credit the reporter if they want it.

**Keeping Electron current** is part of this: Electron's releases carry Chromium's security fixes. When Dependabot opens an Electron pull
request, look at its release notes; if they mention security fixes, merge it and release within two weeks; otherwise it can wait for the next
normal release.
