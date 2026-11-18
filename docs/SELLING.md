# Selling Dragon Drop: what is done and what is left

A working checklist, written 2026-11-18 when selling on itch.io (Windows only) was first being considered. It is not legal advice: the legal items are
things to put in front of a lawyer or accountant. Tick things off as they happen.

## Prerequisite: the AI side

- [ ] The assistant works with more than one AI provider (in progress, Beas). Before selling, pin down: which providers, where each key is kept
      (the OS keystore, one per provider, never in the page), what exactly is sent to the model, and that nothing is sent until the user picks a provider.
- [ ] Each provider's terms read for a commercial app that calls its API. (Not done: only Anthropic's have been read.)
- [ ] Destructive actions are confirmed in code, not just in the prompt: weaker models follow prompt rules less reliably, and text inside a project
      (place names, the brief) can steer a model. The selection lock is already enforced in code.
- [ ] The tool list and instructions suit small models (about 89 tools and 14 KB of instructions today), and a supported-model list is tested.
- [ ] UI text says "AI assistant" where it isn't specifically Claude.

## Anthropic (Claude Code and the Claude API)

From [Anthropic's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) (read 2026-11-18; it has changed several times this year, so re-read it):

- An end user signing in to the unmodified Claude Code with their own subscription is allowed, including inside a product that hosts it. Dragon Drop
  doesn't bundle Claude Code: its button runs Anthropic's official installer and each user signs in themselves. We never handle Claude credentials.
- "Preinstalling or running Claude Code in your products" needs you to accept Anthropic's Commercial Terms, with the binary unmodified and no paying
  for or reselling usage on users' behalf.
- Don't offer Claude.ai login yourself. Don't put Claude or Anthropic in the product name or logo; "runs Claude Code" in plain text is fine.
- [ ] Email Anthropic (contact sales) describing the setup and keep the answer.
- [ ] Accept the Commercial Terms for the account that ships the product.

## Legal and business

- [ ] Choose the entity and get an accountant's view (sole proprietor or company; sales tax and VAT on itch.io: check how itch handles them now).
- [ ] Licence: the repository is public with no LICENSE file (all rights reserved by default, but anyone can read and fork it). Decide: private repo,
      or public but proprietary. Write an EULA: users own their maps, disclaimers, refunds, no warranty.
- [ ] Trademark and name search for "Dragon Drop" (USPTO, EUIPO, itch.io, Steam) before building the brand.
- [ ] "Foundry VTT", "Universal VTT" and "D&D" only as "compatible with" wording. Other programs' names and logos don't appear in the app, its store page or its screenshots:
      the asset library is described in general terms (folders of pictures, zip files and asset packs). We read the user's own assets in place and never ship any;
      tell users to check each pack's licence before publishing maps made with it, and keep honouring a pack's own "not for other mapping programs" flag.
- [x] The DM's own world map and brief no longer ship in the installer (a new install starts with a generated neutral "First Map") and are not in the repository (the `projects/` folder is gitignored).
- [ ] **Repository move.** The old repository (`AI-Mapmaker-Build`) still has that map in its history and in old releases, so the project moved to a fresh repository with a single clean commit (`dragon-drop`, 2026-11-18). The updater's address is baked into each installed copy, so it moves in two steps:
      1. [ ] The new repository exists and has the clean tree.
      2. [ ] v0.1.8 is published from the **old** repository (its updater now points at the new one), and again from the **new** one so the first update check there finds a release.
      3. [ ] Friends have updated (Settings shows 0.1.8 and "You're up to date").
      4. [ ] Then, and only then: delete the old repository's releases (the v0.1.x installers carry the sample) and make it private.
      5. [ ] Switch on the security settings below in the new repository: they don't carry over.
- [ ] A short privacy policy: no analytics in the app; map data goes to the AI provider the user chooses, from their own account.
- [x] Third-party licences: all permissive (MIT, ISC, BSD, Apache-2.0, OFL for the Cinzel font). `apps/desktop/scripts/notices.mjs` builds
      `THIRD-PARTY-NOTICES.txt` from what is really bundled, the installer carries it (Help menu: Open-source licences), CI checks it is there, and the
      build stops on a copyleft or unknown licence.
- [ ] itch.io AI disclosure answered honestly; say on the page that the maps are procedurally painted, not generated images.

## Technical

- [x] itch.io copy with the in-app updater off, made by every CI run (see [ITCH.md](ITCH.md)).
- [ ] **Code signing.** The installer is unsigned, so SmartScreen warns buyers. Get a certificate (or Microsoft's signing service if you qualify),
      then add it to the workflow's build step.
- [x] Save-file versioning, migrations and backups, so paying users' maps never break on an update (2026-11-18): `formatVersion` in `project.json`, a map from a newer format is refused untouched, an older one is copied aside and migrated, an unreadable places file is kept instead of overwritten, and automatic rolling checkpoints (newest six, at most every 15 minutes) show in the Checkpoints list. Documented in [MAP-FILES.md](MAP-FILES.md). Still to do: the first real migration (when the format first changes) needs a test map saved in the old form kept as a fixture; and a way to see the `backups` folder from the app.
- [ ] Test on: Windows 10 and 11, OneDrive-redirected Documents, paths with spaces and non-ASCII characters, low-spec PCs, antivirus on the unsigned
      build and its terminal module.
- [ ] Support: an FAQ and a place to ask (Claude Code install problems, administrator prompts, antivirus).
- [ ] Windows only. (Mac and Linux are not planned.)

## Security

Done:

- [x] The local server needs an access key (made once per install by the app; the browser window gets it as a cookie, Claude Code's map tools and hooks
      send it as a header). Tested: no key, wrong key, header, cookie, WebSocket, MCP, short keys refused, wrong Host still first.
- [x] [SECURITY.md](../SECURITY.md) (private reporting through GitHub). **You need to switch it on:** repository Settings, Code security, *Private
      vulnerability reporting*. While there, switch on *Secret scanning* and *Push protection*.
- [x] Workflow actions pinned to exact commits, with Dependabot to move the pins and the dependencies forward (weekly, grouped, each run through the full checks).
- [x] Secret scan of the working tree and all 88 commits then in history: nothing found (the only hits were a "secret door" hint and a dummy test key). Worth repeating before launch.

Left:

- [ ] A second pair of eyes on the Electron side (the window's bridge, the terminal, the updater) from someone who does security reviews.
- [ ] Turn on two-factor authentication, branch protection and tag protection on the GitHub account and repository: the release pipeline is what ships code to buyers.
- [ ] The phone page over Tailscale exposes the server beyond this PC. It now supports the access key (see SETUP-WINDOWS §7); keep it off by default in the paid build.
- [ ] Keep Electron current: Chromium security fixes arrive often, and each needs a release. Dependabot opens the pull request; someone has to merge and ship it.
- [ ] A plan for a vulnerability report: who answers, how fast, how a fix is released.
