# Selling Dragon Drop: what is done and what is left

A working checklist, written 2026-11-18 when selling on itch.io (Windows only) was first being considered. It is not legal advice: the legal items are
things to put in front of a lawyer or accountant, or (since 2026-11-22: the person can't pay one) free help where it can be had: a
small-business adviser, a law school clinic, a volunteer lawyers' group. `CHECKLIST.md` sorts what is left by what it costs. Tick things off as they happen.

## Prerequisite: the AI side

- [x] The assistant works with more than one AI provider (2026-11-21): the terminal runs Claude Code, Codex, Gemini CLI, OpenCode or Muse Code (Antigravity too until 2026-11-22: see below),
      each signed in by the person in its own program (Dragon Drop never holds their keys; the in-window chat's Anthropic key is in the app-data folder,
      encrypted with the Windows login where Windows offers it), and Settings says what each needs. What is sent: what the assistant reads through the map tools, to that company,
      from the person's account; nothing is sent until they start one.
- [x] Each provider's terms read for a commercial app (2026-11-22): [AI-PROVIDERS.md](AI-PROVIDERS.md). Low risk for OpenAI, Gemini with an API key,
      Meta, OpenCode and Ollama. **Google's Antigravity terms forbid using it with products Google doesn't provide**, and Google has suspended
      accounts over other tools. **Taken out 2026-11-22** (the person's decision): no Settings choice, no project file written, and the file earlier versions
      wrote (it held the access key) cleaned of our entry. OpenCode's choice warns not to connect a Claude or Google AI subscription.
- [x] Destructive actions are confirmed in code, not just in the prompt (2026-11-21, `packages/tools/src/risky.ts`): replacing a map's land, moving the sea,
      restoring a whole checkpoint, carving every river, copying land over the map, rewriting the brief, removing named things (places, labels, regions,
      river and lake names, districts) and removing 25 or more things at once wait for the DM's Allow in the editor (two minutes,
      then refused; refused when it isn't open). The selection lock is enforced in code too. The model check's injection task (a place's notes telling
      the AI to remove every place) passes with every model tried.
- [x] The tool list and instructions suit small models (2026-11-21): Settings → AI assistant → Map tools: A smaller set lists 42 tools with short
      descriptions and 3 KB of instructions (about 14,000 tokens, against about 52,000 for all 156 tools and 29 KB of instructions); `pnpm model-check`
      runs the same tasks against Claude Code or any OpenAI-compatible server (Ollama, LM Studio...), and [MODELS.md](MODELS.md) has the results.
      Still to do: try local models (none is installed here; downloading one is the person's call).
- [x] UI text names the chosen assistant where it isn't specifically Claude (2026-11-21, `apps/editor/src/assistantName.ts`): "Lock Codex's edits to
      this area", "the AI assistant" for a command Dragon Drop doesn't know; Claude Code's setup, the in-window chat and the Ask box (which needs Claude
      Code's hooks) keep Claude's name.

## Anthropic (Claude Code and the Claude API)

From [Anthropic's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) (read 2026-11-18; it has changed several times this year, so re-read it):

- An end user signing in to the unmodified Claude Code with their own subscription is allowed, including inside a product that hosts it. Dragon Drop
  doesn't bundle Claude Code: its button runs Anthropic's official installer and each user signs in themselves. We never handle Claude credentials.
- "Preinstalling or running Claude Code in your products" needs you to accept Anthropic's Commercial Terms, with the binary unmodified and no paying
  for or reselling usage on users' behalf.
- Don't offer Claude.ai login yourself. Don't put Claude or Anthropic in the product name or logo; "runs Claude Code" in plain text is fine.
- [ ] Email Anthropic describing the setup and keep the answer. The email is drafted: [ANTHROPIC-EMAIL.md](ANTHROPIC-EMAIL.md). (Re-read
      2026-11-22: the page's rules haven't changed. Its "contact sales" link now leads to a page saying the sales team only takes large deals,
      so the draft says where else to send it.)
- [ ] Accept the Commercial Terms for the account that ships the product.

## Legal and business

- [ ] Choose the entity and get an accountant's view (sole proprietor or company; sales tax and VAT on itch.io: check how itch handles them now).
- [ ] Licence: the repository is public with no LICENSE file (all rights reserved by default, but anyone can read and fork it). Decide: private repo,
      or public but proprietary. Write an EULA: users own their maps, disclaimers, refunds, no warranty. *(EULA drafted 2026-11-22 with questions
      for legal help: [EULA.md](EULA.md).)*
- [ ] Trademark and name search for "Dragon Drop" (USPTO, EUIPO, itch.io, Steam) before building the brand. **A first pass, 2026-11-22**
      (not a professional search):
      - **Products already called Dragon Drop**: "Dragon Drop: Tabletop Multi-tool" by MAMMOTH (2020, free, early access: 3D world maps and
        dungeons, tokens, fog of war, players watching on their phones; its Steam page now says unavailable and its website doesn't answer
        properly), **the closest clash, because it is a map tool for tabletop games**; "Dragon Drop" by Cloudy Games LLC, a party game on Steam
        (2022, $4.99) **and on itch.io**; "Dragon Drop" by Squish Studios, a puzzle game on Steam (2017, $3.99).
      - **US trademarks** (USPTO search, 2026-11-22): live: DRAGON DROP registered by Sorcero, Inc. (reg. 6503554, class 42: a software platform
        for machine learning and language understanding), and DRAGON DROP registered by Cloudy Games LLC for T-shirts (serial 97350187, class 25).
        Cloudy Games' application for "downloadable video game software" (class 9, serial 99071146) is abandoned, as are older ones by Big Fish
        Games (class 9 and 41) and others. No live US registration for software or games.
      - **EU and UK**: not checked (TMview wouldn't run here); free to check on TMview (tmdn.org/tmview) in a browser; a professional search covers them.
      - **What it means** (for a professional search to confirm, if one can be had): nothing registered blocks the name for software in the US, but two products already
        carry it, one of them a tabletop map tool and one sold on itch.io by a company that has registered the name for merchandise. A longer
        or different name would avoid confusion and complaints; decide before the store page, the cover image and any registration.
      - **Working title** (chosen 2026-11-22): **Dragon Drop: The Busy GM's Cartographer**. The subtitle tells it apart from the other two and says
        who it is for. Weighed and left out: "DM" (Wizards of the Coast holds a US "Dungeon Master" mark and applied for "Dungeon Masters" in
        2026; "GM" also covers other games), and "Mapwright" (already the name of several map projects, one of them a fantasy RPG map app and
        one a tool that makes maps for tabletop games). "Cartographer" is an everyday word, also used in the name of a long-established fantasy
        map program; nothing found is called "Busy GM". For a professional search to check with the rest.
- [ ] "Foundry VTT", "Universal VTT" and "D&D" only as "compatible with" wording. *(Checked 2026-11-22 across the app, the tools, the guides and the
      store page: two other virtual tabletops were named in the battlemap Export dialog and the export tool's description, now "virtual tabletops
      that read Universal VTT files"; no "D&D" anywhere a buyer sees. Left as they are: the Universal VTT file ending `.dd2vtt`, which is how
      that format is known and what importers expect; `CONTROLS.md` and `RESEARCH.md` name other map programs and stay internal (`pnpm
      help-repo` doesn't copy them); the Foundry test results name Foundry's game system.)* Other programs' names and logos don't appear in the app, its store page or its screenshots:
      the asset library is described in general terms (folders of pictures, zip files and asset packs). We read the user's own assets in place and ship none of anyone else's: the only pictures in the installer are our own Starter Pack's ten floor textures, from Poly Haven under CC0 (any use, commercial included, no credit required; checked on their licence page and API terms 2026-11-23, credited anyway in `CREDITS.txt`);
      tell users to check each pack's licence before publishing maps made with it, and keep honouring a pack's own "not for other mapping programs" flag.
- [x] The DM's own world map and brief no longer ship in the installer (a new install starts with a generated neutral "First Map") and are not in the repository (the `projects/` folder is gitignored).
- [ ] **Repository move.** The old repository (`AI-Mapmaker-Build`) still has that map in its history and in old releases, so the project moved to a fresh repository with a single clean commit (`dragon-drop`, 2026-11-18). The updater's address is baked into each installed copy, so it moves in two steps:
      1. [x] The new repository exists and has the clean tree.
      2. [x] v0.1.8 is published from the **old** repository (its updater now points at the new one), and again from the **new** one so the first update check there finds a release. (Releases up to 0.1.11 are on `dragon-drop` now.)
      3. [ ] Friends have updated (Settings shows 0.1.8 and "You're up to date").
      4. [x] The old repository is private and renamed `AI-Mapmaker-Build-archive` (2026-11-20). Its old name now belongs to a **public signpost repository** with one README commit and one release, v0.1.9 (the same installer, blockmap and `latest.yml` as `dragon-drop`'s), so copies older than 0.1.8 still find an update, which then points them at `dragon-drop`. It needs no more releases. Never copy anything from the archive (its history and releases carry the sample map) into it, and never push the old checkout to the old name.
      5. [ ] Switch on the security settings below in the new repository: they don't carry over. (Checked 2026-11-21: secret scanning and push protection are on; private vulnerability reporting and Dependabot security updates are off.)
- [ ] A short privacy policy: no analytics in the app; map data goes to the AI provider the user chooses, from their own account. Drafted
      2026-11-22: [PRIVACY.md](PRIVACY.md), in the usual sections, with what itch.io shows sellers filled in (the seller's name, a contact address,
      how long records are kept and the transfer wording still to fill in).
- [x] Third-party licences: all permissive (MIT, ISC, BSD, Apache-2.0, OFL for the Cinzel font). `apps/desktop/scripts/notices.mjs` builds
      `THIRD-PARTY-NOTICES.txt` from what is really bundled, the installer carries it (Help menu: Open-source licences), CI checks it is there, and the
      build stops on a copyleft or unknown licence.
- [ ] itch.io AI disclosure answered honestly; say on the page that the maps are procedurally painted, not generated images. Drafted 2026-11-22
      with the page text, laid out field by field as itch.io's edit page asks: [STORE-PAGE.md](STORE-PAGE.md). Payments and taxes on itch.io:
      [ITCH.md](ITCH.md).

## Technical

- [x] itch.io copy with the in-app updater off, made by every CI run (see [ITCH.md](ITCH.md)).
- [ ] **Code signing.** The installer is unsigned, so SmartScreen warns buyers. Get a certificate (or Microsoft's signing service if you qualify),
      then add it to the workflow's build step. *(Researched and prepared 2026-11-22: [SIGNING.md](SIGNING.md). Microsoft's Artifact Signing
      is from $9.99 a month but takes individuals only in the US and Canada; elsewhere a company, or an individual certificate with cloud
      signing (about $129 a year plus the signing service). The build signs by itself once the secrets are added; until then nothing changes.)*
- [x] Save-file versioning, migrations and backups, so paying users' maps never break on an update (2026-11-18): `formatVersion` in `project.json`, a map from a newer format is refused untouched, an older one is copied aside and migrated, an unreadable places file is kept instead of overwritten, and automatic rolling checkpoints (newest six, at most every 15 minutes) show in the Checkpoints list. Documented in [MAP-FILES.md](MAP-FILES.md). Still to do: the first real migration (when the format first changes) needs a test map saved in the old form kept as a fixture. (The `backups` folder can be opened from the app: the Map panel's History, **Open backups folder**, 2026-11-21.)
- [ ] Test on: Windows 10 and 11, OneDrive-redirected Documents, paths with spaces and non-ASCII characters, low-spec PCs, antivirus on the unsigned
      build and its terminal module. *(Done on 2026-11-21, Windows 11: the app installed in `Kim's Prögrams (x86)\Dragon Drop 地図` with its settings and maps
      in folders with accents, spaces and Japanese: the start-up check, and making, copying, comparing, checkpointing and exporting maps with such names.
      Map folder names now drop accents properly ("Ährenfeld" is `ahrenfeld`).)* The person has no other PCs, so the rest was covered from this one
      (2026-11-21):
      - **OneDrive and antivirus** hold a file while they read it, and Windows then refuses to replace it. Tried with a real hold on a 2048 map:
        a save gave up after a second and wasn't tried again until the next edit. Now a save waits out a hold of up to about 10 s, two saves of
        a map never overlap, and a failed save tries again by itself (2 s, then longer, up to a minute). Tested with 2 s and 5 s holds.
      - **Antivirus**: Windows Defender (real-time protection on, Dragon Drop's folders not excluded) has never flagged the installed app, the
        test copies or the builds on this PC, and a scan of the installed app and a fresh build found nothing. Other antivirus programs: the
        public 0.1.11 installer (sha256 `ebdc05f9…2f25`, from its GitHub release link) was scanned on VirusTotal on 2026-11-22: 0 of 67
        engines flagged it (Microsoft, Kaspersky, Bitdefender, Avast, AVG, McAfee, Norton/Symantec, Malwarebytes, Sophos and the rest); 2 timed
        out and 5 (mostly phone scanners) can't read an installer. Scan the final signed installer once more before the store page goes live
        (an upload is shared with security companies: never upload a private test build).
      - **A slow PC**: this PC is a 4-core Ryzen 3. The browser test passes on 2 cores (`E2E_CORES=2`), and on 2 cores with the page 4 times
        slower (`E2E_CPU_SLOWDOWN=4`): 176, 216 and 283 s. A 2048 x 2048 world map opens and is painted in 11.5 s here, 23.5 s on 2 cores, 30 s
        on 2 cores with the page 4 times slower; the server uses 370 to 540 MB.
      - **Windows 10**: a GitHub job installs the installer on Windows Server 2022 (the oldest Windows GitHub offers, a generation between 10
        and 11) and runs the installed app's start-up check. Windows 10 itself: not tried. Microsoft ended its support in October 2025.
- [x] Support: an FAQ and a place to ask (2026-11-21): [FAQ.md](FAQ.md) (installing, SmartScreen, antivirus, administrator rights, Claude Code problems,
      other assistants, smaller models, the Allow box, maps, backups, updates, privacy); Settings → Help links to it, to the setup guide
      and to the repository's issue forms (`.github/ISSUE_TEMPLATE`: a problem, a question; both warn never to paste a key). **If the repository goes
      private, move these links** (`apps/editor/src/helpLinks.ts`) to where buyers can reach, such as the store page's community. The whole move
      is planned in [GOING-PRIVATE.md](GOING-PRIVATE.md).
- [ ] Windows only. (Mac and Linux are not planned.)

## Security

Done:

- [x] The local server needs an access key (made once per install by the app; the browser window gets it as a cookie, Claude Code's map tools and hooks
      send it as a header). Tested: no key, wrong key, header, cookie, WebSocket, MCP, short keys refused, wrong Host still first.
- [x] [SECURITY.md](../SECURITY.md) (private reporting through GitHub). **You need to switch it on:** repository Settings, Code security, *Private
      vulnerability reporting*. While there, switch on *Secret scanning* and *Push protection*.
- [x] Workflow actions pinned to exact commits, with Dependabot to move the pins and the dependencies forward (weekly, grouped, each run through the full checks).
- [x] Secret scan of the working tree and all 88 commits then in history: nothing found (the only hits were a "secret door" hint and a dummy test key). Worth repeating before launch.
      Repeated 2026-11-21 over all 89 commits on every branch, the working files and the commit messages: no keys, tokens or private keys, neither of
      this PC's access keys, and none of the DM's campaign names.

Left:

- [ ] A second pair of eyes on the Electron side (the window's bridge, the terminal, the updater) from someone who does security reviews.
      Claude's own review (2026-11-22) is the starting point: [SECURITY-REVIEW.md](SECURITY-REVIEW.md). It switched off two ways of running
      other code inside the program (Electron fuses, checked by every build) and lists what is left.
- [ ] Turn on two-factor authentication, branch protection and tag protection on the GitHub account and repository: the release pipeline is what ships code to buyers.
- [x] The phone page over Tailscale exposes the server beyond this PC. It needs the access key, and in the Windows app it is off until the person enters
      their Tailscale name in Settings → Phone page (2026-11-21; the app no longer takes `MAPMAKER_ALLOWED_HOSTS` from the PC's environment).
      *(2026-11-23: the phone page is gone altogether, the person deciding it isn't needed: the server answers only this PC, whatever the environment says.)*
- [ ] Keep Electron current: Chromium security fixes arrive often, and each needs a release. Dependabot opens the pull request; someone has to merge and ship it.
- [x] A plan for a vulnerability report: who answers, how fast, how a fix is released (2026-11-22): `SECURITY.md` promises a reply in 7 days, a
      verdict in 14 and a fix for a serious problem in 30; `RELEASING.md` has the steps, and when an Electron update has to be released.
